/**
 * Preset Studio — Entry point
 * Bootstraps the engine and hands off to EditorInspector once
 * the user picks an audio source.
 */

import { VisualizerEngine } from '../visualizer.js';
import { EditorInspector, showToast, showOnboarding } from './inspector.js';
import { PresetLibrary } from './presetLibrary.js';
import { getCustomPreset, loadAllCustomPresets } from '../customPresets.js';
import { initAuthGate } from '../auth-gate.js';

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
        onLoad: handleLibraryLoad,
        onNew:  handleLibraryNew,
    });

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

    // Wire the save button (existing "Save preset" → always Save As for new presets,
    // but the modal confirm now routes through inspector.saveCurrent)
    _rewireSaveModal();

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

    // Show onboarding tips modal (skipped if user clicked "Never show again")
    showOnboarding();
}

// Override the inspector's default save modal confirm to route through our
// saveCurrent flow (which captures the thumbnail and tracks the active id).
function _rewireSaveModal() {
    const confirm   = document.getElementById('save-modal-confirm');
    const modal     = document.getElementById('save-modal');
    const nameInput = document.getElementById('save-modal-name');
    if (!confirm) return;

    // Replace existing listeners by cloning the node
    const fresh = confirm.cloneNode(true);
    confirm.replaceWith(fresh);

    fresh.addEventListener('click', async () => {
        const name  = nameInput?.value?.trim() || 'Untitled preset';
        const thumb = await captureThumb();
        try {
            const record = inspector.saveCurrent(name, null, thumb);  // always new
            activePresetId = record.id;
            markClean();
            modal.hidden = true;
            library?.refresh();
            library?.setActiveId(record.id);
            showToast(`"${name}" saved`);
        } catch (err) {
            showToast('Save failed: ' + err.message, true);
        }
    });
}

// ─── Audio sources ────────────────────────────────────────────────────────────

btnMic.addEventListener('click', () => {
    boot(async eng => {
        await eng.connectMicrophone();
        showToast('Microphone connected');
    });
});

btnFile.addEventListener('click', () => fileInput.click());

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
mpLoad.addEventListener('click', () => {
    mpFileInput.value = '';
    mpFileInput.click();
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

    // Escape in library → return to edit
    if (e.key === 'Escape' && panelEl?.dataset.mode === 'library') {
        setMode('edit');
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
