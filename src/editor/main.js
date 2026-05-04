/**
 * Preset Studio — Entry point
 * Bootstraps the engine and hands off to EditorInspector once
 * the user picks an audio source.
 */

import { VisualizerEngine } from '../visualizer.js';
import { EditorInspector, showToast } from './inspector.js';
import { PresetLibrary } from './presetLibrary.js';
import { getCustomPreset, loadAllCustomPresets, CUSTOM_PREFIX } from '../customPresets.js';
import { initAuthGate } from '../auth-gate.js';
import { pickAndConnect } from '../devicePicker.js';

initAuthGate();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const startEl  = document.getElementById('editor-start');
const shellEl  = document.getElementById('editor-shell');
const canvasEl = document.getElementById('editor-canvas');
const btnMic   = document.getElementById('start-mic');
const btnFile  = document.getElementById('start-file');
const fileInput = document.getElementById('start-file-input');

// Mini player refs
const miniPlayer  = document.getElementById('mini-player');
const mpFilename  = document.getElementById('mp-filename');
const mpTime      = document.getElementById('mp-time');
const mpPlay      = document.getElementById('mp-play');
const mpIconPlay  = document.getElementById('mp-icon-play');
const mpIconPause = document.getElementById('mp-icon-pause');
const mpSeek      = document.getElementById('mp-seek');
const mpVol       = document.getElementById('mp-vol');
const mpLoad      = document.getElementById('mp-load');
const mpFileInput = document.getElementById('mp-file-input');

// Panel mode ref
const panelEl = document.getElementById('editor-panel');

// ─── Engine + Inspector state ──────────────────────────────────────────────────

let engine    = null;
let inspector = null;
let library   = null;

// Active preset tracking
let activePresetId   = null;  // id of the custom preset currently loaded in editor
let isDirty          = false; // true when unsaved changes exist

let playerAbortCtrl  = null;  // AbortController for current mini-player listeners

function markDirty() { isDirty = true; }
function markClean() { isDirty = false; }

// ─── Sidebar mode toggle ──────────────────────────────────────────────────────

function setMode(mode) {
    panelEl.dataset.mode = mode;

    document.querySelectorAll('.mode-seg').forEach(seg => {
        seg.classList.toggle('active', seg.dataset.mode === mode);
    });

    if (mode === 'library') library?.refresh();
}

function initModeToggle() {
    document.querySelectorAll('.mode-seg').forEach(seg => {
        seg.addEventListener('click', () => setMode(seg.dataset.mode));
    });
}

// ─── Thumbnail capture ────────────────────────────────────────────────────────
// Must be called after engine exists. Resolves on the next rendered frame so the
// WebGL buffer is guaranteed to be populated (preserveDrawingBuffer is false).

function captureThumb() {
    return engine?.captureNextFrame() ?? Promise.resolve(null);
}

// ─── Save flow ────────────────────────────────────────────────────────────────

function openSaveModal(prefillName) {
    const modal     = document.getElementById('save-modal');
    const nameInput = document.getElementById('save-modal-name');
    if (!modal || !nameInput) return;
    nameInput.value = prefillName || document.getElementById('preset-name-input')?.value || 'Untitled preset';
    modal.hidden = false;
    setTimeout(() => nameInput.select(), 50);
}

/** Overwrite the current preset silently (Cmd+S). */
async function saveOverwrite() {
    if (!inspector) return;
    const name  = document.getElementById('preset-name-input')?.value || 'Untitled preset';
    const thumb = await captureThumb();
    try {
        const record = inspector.saveCurrent(name, activePresetId, thumb);
        activePresetId = record.id;
        markClean();
        library?.refresh();
        library?.setActiveId(record.id);
        showToast(`Saved · ${name}`);
    } catch (err) {
        showToast('Save failed: ' + err.message, true);
    }
}

// ─── Styled dirty-state confirmation ─────────────────────────────────────────

function confirmDirty() {
    return new Promise(resolve => {
        const modal      = document.getElementById('dirty-modal');
        const confirmBtn = document.getElementById('dirty-modal-confirm');
        const cancelBtn  = document.getElementById('dirty-modal-cancel');
        if (!modal) { resolve(true); return; }

        modal.hidden = false;
        confirmBtn.focus();

        const close = result => {
            modal.hidden = true;
            resolve(result);
        };

        const onKeydown = e => {
            if (e.key === 'Escape') { cleanup(); close(false); }
            if (e.key === 'Enter')  { cleanup(); close(true);  }
        };

        const cleanup = () => {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click',  onCancel);
            document.removeEventListener('keydown', onKeydown);
        };

        const onConfirm = () => { cleanup(); close(true);  };
        const onCancel  = () => { cleanup(); close(false); };

        confirmBtn.addEventListener('click', onConfirm, { once: true });
        cancelBtn.addEventListener('click',  onCancel,  { once: true });
        document.addEventListener('keydown', onKeydown);
    });
}

// ─── Library callbacks ────────────────────────────────────────────────────────

async function handleLibraryLoad(id) {
    if (!inspector) return;

    if (isDirty) {
        const proceed = await confirmDirty();
        if (!proceed) return;
    }

    const preset = loadAllCustomPresets()[id];
    if (!preset) { showToast('Preset not found', true); return; }

    try {
        await inspector.loadPresetData(preset);
        activePresetId = id;
        markClean();

        const nameInput = document.getElementById('preset-name-input');
        if (nameInput) nameInput.value = preset.name;

        library?.setActiveId(id);
        setMode('edit');
        showToast(`Loaded · ${preset.name}`);
    } catch (err) {
        showToast('Load failed: ' + err.message, true);
        console.error('[Studio] loadPresetData error:', err);
    }
}

function handleLibraryNew() {
    setMode('edit');
    // Small delay so the mode transition completes before the reset
    setTimeout(() => {
        document.getElementById('btn-reset')?.click();
        activePresetId = null;
        markClean();
        document.getElementById('preset-name-input').value = 'Untitled preset';
        showToast('New preset');
    }, 60);
}

// ─── Canvas sizing ────────────────────────────────────────────────────────────

function sizeCanvas() {
    if (!engine) return;
    const panelW  = 340;
    const topbarH = document.querySelector('.editor-topbar')?.offsetHeight ?? 40;
    const w = Math.max(120, window.innerWidth - panelW);
    engine.setSize(w, window.innerHeight - topbarH);
}

// ─── Mini player wiring ───────────────────────────────────────────────────────

function fmt(s) {
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function mountMiniPlayer(audio, filename) {
    // Tear down previous player's listeners before attaching new ones
    playerAbortCtrl?.abort();
    playerAbortCtrl = new AbortController();
    const { signal } = playerAbortCtrl;

    mpFilename.textContent = filename.length > 32 ? filename.slice(0, 30) + '…' : filename;
    miniPlayer.hidden = false;

    const updateUI = () => {
        const cur = audio.currentTime;
        const dur = audio.duration || 0;
        mpTime.textContent = `${fmt(cur)} / ${fmt(dur)}`;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        mpSeek.value = dur > 0 ? cur / dur : 0;
        mpSeek.style.setProperty('--pct', `${pct.toFixed(1)}%`);
        mpIconPlay.style.display  = audio.paused ? '' : 'none';
        mpIconPause.style.display = audio.paused ? 'none' : '';
    };

    audio.addEventListener('timeupdate',     updateUI, { signal });
    audio.addEventListener('play',           updateUI, { signal });
    audio.addEventListener('pause',          updateUI, { signal });
    audio.addEventListener('durationchange', updateUI, { signal });

    mpPlay.addEventListener('click', () => {
        if (audio.paused) audio.play(); else audio.pause();
    }, { signal });

    mpSeek.addEventListener('input', () => {
        const pct = parseFloat(mpSeek.value);
        mpSeek.style.setProperty('--pct', `${(pct * 100).toFixed(1)}%`);
        if (audio.duration) audio.currentTime = pct * audio.duration;
    }, { signal });

    mpVol.addEventListener('input', () => {
        audio.volume = parseFloat(mpVol.value);
        mpVol.style.setProperty('--pct', `${(audio.volume * 100).toFixed(1)}%`);
    }, { signal });

    updateUI();
}

// ─── Topbar mic input widget ──────────────────────────────────────────────────

const micWidget        = document.getElementById('topbar-mic-widget');
const micWidgetLabel   = micWidget.querySelector('.tmw-label');
const micWidgetPanel   = micWidget.querySelector('.tmw-panel');
const micWidgetTrigger = micWidget.querySelector('.tmw-trigger');

function _tmwClose() {
    micWidgetPanel.hidden = true;
    micWidgetTrigger.classList.remove('is-open');
}
function _tmwOpen() {
    micWidgetPanel.hidden = false;
    micWidgetTrigger.classList.add('is-open');
}

micWidgetTrigger.addEventListener('click', e => {
    e.stopPropagation();
    micWidgetPanel.hidden ? _tmwOpen() : _tmwClose();
});
document.addEventListener('pointerdown', e => {
    if (!micWidgetPanel.hidden && !micWidget.contains(e.target)) _tmwClose();
});

async function mountMicWidget(deviceId, label) {
    micWidgetLabel.textContent = label || 'Live Input';
    micWidget.hidden = false;
    miniPlayer.hidden = true;

    const devices     = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');

    micWidgetPanel.innerHTML = '';
    audioInputs.forEach((device, i) => {
        const name = device.label || `Input ${i + 1}`;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tmw-item' + (device.deviceId === deviceId ? ' is-active' : '');
        item.innerHTML = `
            <svg class="tmw-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" width="13" height="13" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>${name}</span>
        `;
        item.addEventListener('click', async () => {
            try {
                await engine.connectMicrophone(device.deviceId);
                micWidgetLabel.textContent = name;
                micWidgetPanel.querySelectorAll('.tmw-item').forEach(el => el.classList.remove('is-active'));
                item.classList.add('is-active');
                _tmwClose();
                showToast('Switched to: ' + name);
            } catch (err) {
                console.error('[Studio] Mic switch failed:', err);
            }
        });
        micWidgetPanel.appendChild(item);
    });
}

// ─── Remix Picker ─────────────────────────────────────────────────────────────
// Searchable modal that lists all 1,144 bundled library presets.
// Opens from the "Remix…" footer button; calls loadBundledPreset on selection.

let _rpNames = null; // cached bundled preset name list — built once after engine init

function _rpBuild() {
    if (_rpNames || !engine) return;
    _rpNames = engine.getPresetNames().filter(n => !n.startsWith(CUSTOM_PREFIX));
}

function _rpRender(filter) {
    const list  = document.getElementById('remix-picker-list');
    const count = document.getElementById('remix-picker-count');
    if (!list) return;
    const lf = (filter || '').toLowerCase().trim();
    const hits = lf ? _rpNames.filter(n => n.toLowerCase().includes(lf)) : _rpNames;
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    const cap = Math.min(hits.length, 800);
    for (let i = 0; i < cap; i++) {
        const li = document.createElement('li');
        li.textContent = hits[i];
        li.dataset.name = hits[i];
        li.addEventListener('click', () => _rpSelect(hits[i]));
        frag.appendChild(li);
    }
    list.appendChild(frag);
    if (count) count.textContent = `${hits.length} preset${hits.length !== 1 ? 's' : ''}${lf ? ` matching "${filter}"` : ''}`;
}

async function _rpSelect(name) {
    if (!inspector) return;
    if (isDirty) {
        const proceed = await confirmDirty();
        if (!proceed) return;
    }
    try {
        inspector.loadBundledPreset(name);
        const nameInput = document.getElementById('preset-name-input');
        if (nameInput) nameInput.value = name;
        activePresetId = null;
        markDirty();
        _rpClose();
        setMode('edit');
        showToast(`Remixing: ${name}`);
    } catch (err) {
        showToast('Load failed: ' + err.message, true);
        console.warn('[Studio] Remix pick failed:', err.message);
    }
}

function _rpOpen() {
    _rpBuild();
    const modal  = document.getElementById('remix-picker-modal');
    const search = document.getElementById('remix-picker-search');
    if (!modal || !_rpNames) return;
    if (search) search.value = '';
    _rpRender('');
    modal.hidden = false;
    setTimeout(() => search?.focus(), 50);
}

function _rpClose() {
    const modal  = document.getElementById('remix-picker-modal');
    const search = document.getElementById('remix-picker-search');
    if (modal)  modal.hidden = true;
    if (search) search.value = '';
}

// Static listeners — safe to wire once at module load (they guard on modal.hidden)
document.getElementById('remix-picker-close')?.addEventListener('click', _rpClose);
document.getElementById('remix-picker-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) _rpClose();
});
document.getElementById('remix-picker-search')?.addEventListener('input', e => {
    _rpRender(e.target.value);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot(connectAudioFn) {
    engine = new VisualizerEngine();
    engine.init(canvasEl);
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    try {
        await connectAudioFn(engine);
    } catch (err) {
        console.warn('[Studio] Audio unavailable:', err.message);
        showToast('Audio unavailable — visual preview only');
    }

    // Fade out start screen and reveal editor
    startEl.style.transition = 'opacity 0.25s';
    startEl.style.opacity    = '0';
    startEl.style.pointerEvents = 'none';
    setTimeout(() => { startEl.hidden = true; }, 260);
    shellEl.hidden = false;

    // Wire inspector
    inspector = new EditorInspector(engine);
    inspector.onchange = markDirty;
    window.__editorInspector = inspector;

    // Wire library
    library = new PresetLibrary({
        onLoad:  handleLibraryLoad,
        onNew:   handleLibraryNew,
        engine,
    });

    // Wire "Remix…" button in the Edit panel footer — opens the library picker
    document.getElementById('btn-browse-library')?.addEventListener('click', _rpOpen);

    // Wire New Preset button in the Edit panel footer
    document.getElementById('btn-new-preset-footer')?.addEventListener('click', async () => {
        if (isDirty) {
            const proceed = await confirmDirty();
            if (!proceed) return;
        }
        handleLibraryNew();
    });

    // Wire mode toggle
    initModeToggle();

    _wireSaveModal();

    engine.stopAutoCycle();
    engine.autoCycleEnabled = false;

    console.log(
        '%c✦ Preset Studio%c — blank canvas, go build something',
        'color:#fff;font-weight:700',
        'color:#666'
    );

    // Wire help modal
    const helpModal   = document.getElementById('help-modal');
    const helpClose   = document.getElementById('help-modal-close');
    const helpToggle  = document.getElementById('help-toggle');
    const helpContent = document.getElementById('help-modal-content');
    const helpNavLinks = document.querySelectorAll('.help-nav-link');

    function openHelp() { helpModal.hidden = false; }
    function closeHelp() { helpModal.hidden = true; }

    helpToggle?.addEventListener('click', openHelp);
    helpClose?.addEventListener('click', closeHelp);
    helpModal?.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });

    // Sidebar nav — scroll to section and mark active
    function scrollToSection(id) {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        helpNavLinks.forEach(l => l.classList.remove('active'));
        document.querySelector(`.help-nav-link[href="#${id}"]`)?.classList.add('active');
    }

    helpNavLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            scrollToSection(link.getAttribute('href').slice(1));
        });
    });

    // Inline search — build index from section headings + text
    const hmSearch      = document.getElementById('hm-search');
    const hmResults     = document.getElementById('hm-search-results');
    const hmNavTree     = document.getElementById('hm-nav-tree');

    const searchIndex = [];
    document.querySelectorAll('.hm-section').forEach(sec => {
        const heading = sec.querySelector('h2');
        if (!heading) return;
        searchIndex.push({
            id: sec.id,
            title: heading.textContent.trim(),
            text: sec.innerText.toLowerCase(),
        });
    });

    hmSearch?.addEventListener('input', () => {
        const q = hmSearch.value.trim().toLowerCase();
        if (!q) {
            hmResults.style.display = 'none';
            hmNavTree.style.display = '';
            return;
        }
        const hits = searchIndex.filter(s => s.text.includes(q) || s.title.toLowerCase().includes(q));
        hmNavTree.style.display = 'none';
        hmResults.style.display = '';
        if (!hits.length) {
            hmResults.innerHTML = `<div class="hm-no-results">No results for "${q}"</div>`;
            return;
        }
        hmResults.innerHTML = hits.map(h => {
            const hl = h.title.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
            return `<a class="hm-search-result" data-id="${h.id}">${hl}</a>`;
        }).join('');
        hmResults.querySelectorAll('.hm-search-result').forEach(r => {
            r.addEventListener('click', () => {
                scrollToSection(r.dataset.id);
                hmSearch.value = '';
                hmResults.style.display = 'none';
                hmNavTree.style.display = '';
            });
        });
    });

    // Wire focus / preview toggle button
    document.getElementById('focus-toggle')?.addEventListener('click', toggleFocusMode);

    // Clicking the canvas restores the panel when in focus mode
    canvasEl.addEventListener('click', () => { if (focusMode) toggleFocusMode(); });

    // URL params — must run after engine + inspector are fully initialized.
    const _params = new URLSearchParams(window.location.search);

    // ?preset=NAME — load a bundled library preset for remixing
    const _remixName = _params.get('preset');
    if (_remixName) {
        const decoded = decodeURIComponent(_remixName);
        try {
            inspector.loadBundledPreset(decoded);
            const nameInput = document.getElementById('preset-name-input');
            if (nameInput) nameInput.value = decoded;
            activePresetId = null;
            markDirty();
            showToast(`Remixing: ${decoded}`);
        } catch (err) {
            showToast(`Preset not found: ${decoded}`, true);
            console.warn('[Studio] ?preset param load failed:', err.message);
        }
    }

    // ?custom=REGISTRY_KEY — reopen a saved custom preset for editing.
    // Registry key format: custom:<id>:<name> — extract id to call handleLibraryLoad.
    const _customKey = _params.get('custom');
    if (_customKey) {
        const key = decodeURIComponent(_customKey);
        const id  = key.startsWith(CUSTOM_PREFIX)
            ? key.slice(CUSTOM_PREFIX.length).split(':')[0]
            : key;
        await handleLibraryLoad(id);
    }
}

function _wireSaveModal() {
    const modal     = document.getElementById('save-modal');
    const nameInput = document.getElementById('save-modal-name');
    const confirmBtn = document.getElementById('save-modal-confirm');
    if (!modal || !confirmBtn) return;

    async function attemptSave() {
        const name = nameInput?.value?.trim() || 'Untitled preset';
        const all  = loadAllCustomPresets();
        const existing = Object.values(all).find(p =>
            p.name?.toLowerCase() === name.toLowerCase()
        );

        if (existing) {
            // Name already exists — always confirm before overwriting
            modal.hidden = true;
            const confirmed = await confirmOverwrite(name);
            if (confirmed) await doSave(name, existing.id);
        } else {
            // New name — create
            await doSave(name, null);
        }
    }

    async function doSave(name, id) {
        const thumb = await captureThumb();
        try {
            const record = inspector.saveCurrent(name, id, thumb);
            activePresetId = record.id;
            markClean();
            modal.hidden = true;
            library?.refresh();
            library?.setActiveId(record.id);
            showToast(`"${name}" saved`);
        } catch (err) {
            showToast('Save failed: ' + err.message, true);
        }
    }

    confirmBtn.addEventListener('click', attemptSave);
    modal.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); attemptSave(); }
    });
}

function confirmOverwrite(name) {
    return new Promise(resolve => {
        const overwriteModal = document.getElementById('overwrite-modal');
        const msg            = document.getElementById('overwrite-modal-msg');
        const confirmBtn     = document.getElementById('overwrite-modal-confirm');
        const cancelBtn      = document.getElementById('overwrite-modal-cancel');
        if (!overwriteModal) { resolve(true); return; }

        if (msg) msg.textContent = `This will overwrite "${name}". This can't be undone.`;
        overwriteModal.hidden = false;
        confirmBtn.focus();

        const close = result => {
            overwriteModal.hidden = true;
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };

        const onKey = e => {
            if (e.key === 'Escape') close(false);
            if (e.key === 'Enter')  close(true);
        };

        confirmBtn.addEventListener('click', () => close(true),  { once: true });
        cancelBtn.addEventListener('click',  () => close(false), { once: true });
        document.addEventListener('keydown', onKey);
    });
}

// ─── Audio sources ────────────────────────────────────────────────────────────

btnMic.addEventListener('click', () => {
    boot(async eng => {
        const result = await pickAndConnect(eng);
        if (result.connected) {
            showToast('Microphone connected: ' + result.label);
            await mountMicWidget(result.deviceId, result.label);
        }
    });
});

const pickAudioFile = async () => {
    if (window.__TAURI__) {
        const result = await window.__TAURI__.invoke('pick_audio_file');
        if (!result) return null;
        const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
        return new File([bytes], result.name, { type: 'audio/mpeg' });
    }
    return null;
};

btnFile.addEventListener('click', async () => {
    if (window.__TAURI__) {
        const file = await pickAudioFile();
        if (!file) return;
        boot(async eng => {
            const audio = await eng.connectAudioFile(file);
            audio.play();
            mountMiniPlayer(audio, file.name);
            showToast('Playing: ' + file.name);
        });
    } else {
        fileInput.click();
    }
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    boot(async eng => {
        const audio = await eng.connectAudioFile(file);
        audio.play();
        mountMiniPlayer(audio, file.name);
        showToast('Playing: ' + file.name);
    });
});

// Mini-player load button — swap audio file without restarting the editor
mpLoad.addEventListener('click', async () => {
    if (window.__TAURI__) {
        const file = await pickAudioFile();
        if (!file || !engine) return;
        try {
            const audio = await engine.connectAudioFile(file);
            audio.play();
            mountMiniPlayer(audio, file.name);
            showToast('Playing: ' + file.name);
        } catch (err) {
            showToast('Failed to load: ' + err.message, true);
        }
    } else {
        mpFileInput.value = '';
        mpFileInput.click();
    }
});

mpFileInput.addEventListener('change', async () => {
    const file = mpFileInput.files?.[0];
    if (!file || !engine) return;
    try {
        const audio = await engine.connectAudioFile(file);
        audio.play();
        mountMiniPlayer(audio, file.name);
        showToast('Playing: ' + file.name);
    } catch (err) {
        showToast('Failed to load: ' + err.message, true);
    }
});

// ─── Global keyboard shortcuts ────────────────────────────────────────────────

document.addEventListener('keydown', e => {
    const ctrl = e.metaKey || e.ctrlKey;

    // Undo / Redo
    if (inspector) {
        if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); inspector.undo(); }
        if (ctrl &&  e.shiftKey && e.key === 'z') { e.preventDefault(); inspector.redo(); }
    }

    // Toggle Library panel
    if (!ctrl && !e.shiftKey && !e.altKey && e.key === 'p' && !isInputFocused()) {
        e.preventDefault();
        const nextMode = panelEl?.dataset.mode === 'library' ? 'edit' : 'library';
        setMode(nextMode);
    }

    // Save (Cmd+S) — overwrite if known preset, else open Save As modal
    if (ctrl && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        if (!inspector) return;
        if (activePresetId) {
            saveOverwrite();
        } else {
            openSaveModal();
        }
    }

    // Save As (Cmd+Shift+S) — always opens modal
    if (ctrl && e.shiftKey && e.key === 's') {
        e.preventDefault();
        if (inspector) openSaveModal();
    }

    // Escape — close remix picker first; then library mode; then help modal
    if (e.key === 'Escape') {
        const rpModal = document.getElementById('remix-picker-modal');
        if (rpModal && !rpModal.hidden) { _rpClose(); return; }
        if (panelEl?.dataset.mode === 'library') { setMode('edit'); return; }
    }
});

function isInputFocused() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// ─── Focus / preview mode ─────────────────────────────────────────────────────

let focusMode = false;

function toggleFocusMode() {
    focusMode = !focusMode;
    shellEl.classList.toggle('focus-mode', focusMode);
    setTimeout(sizeCanvas, 320);
}

document.addEventListener('keydown', e => {
    if (e.key === '\\' && !isInputFocused() && !shellEl.hidden) {
        e.preventDefault();
        toggleFocusMode();
    }
    if (e.key === 'Escape') {
        const helpModal = document.getElementById('help-modal');
        if (helpModal && !helpModal.hidden) { helpModal.hidden = true; }
    }
});
