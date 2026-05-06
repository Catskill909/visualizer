/**
 * Timeline Editor — Entry point
 * Mirrors the boot pattern from src/editor/main.js
 */

import { VisualizerEngine } from '../visualizer.js';
import { TimelineEditor }   from './timelineEditor.js';
import { initAuthGate }     from '../auth-gate.js';
import { pickAndConnect } from '../devicePicker.js';

initAuthGate();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const startEl     = document.getElementById('tl-start');
const shellEl     = document.getElementById('tl-shell');
const btnMic      = document.getElementById('start-mic');
const btnFile     = document.getElementById('start-file');
const btnNoAudio  = document.getElementById('start-no-audio');
const fileInput   = document.getElementById('start-file-input');

// Mini player
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

// ─── State ────────────────────────────────────────────────────────────────────

let engine   = null;
let editor   = null;
let playerAbortCtrl = null;

// ─── Canvas container ─────────────────────────────────────────────────────────

const canvasContainer = document.getElementById('tl-canvas-container');

function makeCanvas() {
    const c = document.createElement('canvas');
    c.style.position = 'absolute';
    c.style.inset    = '0';
    c.style.width    = '100%';
    c.style.height   = '100%';
    canvasContainer.appendChild(c);
    c.width  = window.innerWidth;
    c.height = window.innerHeight;
    return c;
}

function sizeCanvas() {
    if (!engine) return;
    engine.setSize(window.innerWidth, window.innerHeight);
    editor?.resizeAllZones();
}

// ─── Mini player ─────────────────────────────────────────────────────────────

function fmt(s) {
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function mountMiniPlayer(audio, filename) {
    playerAbortCtrl?.abort();
    playerAbortCtrl = new AbortController();
    const { signal } = playerAbortCtrl;

    mpFilename.textContent = filename.length > 32 ? filename.slice(0, 30) + '…' : filename;
    mpFilename.dataset.tooltip = filename; // Set tooltip to full filename
    miniPlayer.hidden = false;
    // Re-enable controls (in case they were disabled from No Audio mode)
    mpPlay.disabled = false;
    mpSeek.disabled = false;
    mpPlay.style.opacity = '';
    mpSeek.style.opacity = '';

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
        audio.paused ? audio.play() : audio.pause();
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
    miniPlayer.hidden = true; // mic mode never needs the file transport bar

    const devices     = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');

    micWidgetPanel.innerHTML = '';
    audioInputs.forEach((device, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tmw-item' + (device.deviceId === deviceId ? ' is-active' : '');
        item.innerHTML = `
            <svg class="tmw-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" width="13" height="13" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>${device.label || `Input ${i + 1}`}</span>
        `;
        item.addEventListener('click', async () => {
            try {
                await engine.connectMicrophone(device.deviceId);
                const name = device.label || `Input ${i + 1}`;
                micWidgetLabel.textContent = name;
                micWidgetPanel.querySelectorAll('.tmw-item').forEach(el => el.classList.remove('is-active'));
                item.classList.add('is-active');
                _tmwClose();
                editor?._toast('Switched to: ' + name);
            } catch (err) {
                console.error('[Timeline] Mic switch failed:', err);
            }
        });
        micWidgetPanel.appendChild(item);
    });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot(connectAudioFn) {
    const canvas = makeCanvas();
    engine = new VisualizerEngine();
    engine.init(canvas);
    engine.stopAutoCycle();
    engine.autoCycleEnabled = false;
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    try {
        await connectAudioFn(engine);
    } catch (err) {
        console.warn('[Timeline] Audio unavailable:', err.message);
    }

    // connectAudioFn restarts the render loop — stop it now. The TimelineEditor
    // constructor adds a CSS blackout overlay so the canvas stays visually blank
    // until play or a picker preview lifts it.
    engine.stopRenderLoop();

    // Fade out start screen
    startEl.style.transition  = 'opacity 0.25s';
    startEl.style.opacity     = '0';
    startEl.style.pointerEvents = 'none';
    setTimeout(() => { startEl.hidden = true; }, 260);
    shellEl.hidden = false;

    // Load custom presets (not included in engine.init())
    engine.refreshCustomPresets();

    // Create the editor
    editor = new TimelineEditor({ engine, canvasContainer });

    // Handle query params
    const params = new URLSearchParams(window.location.search);
    const initialTimeline = params.get('id');
    const initialPreset   = params.get('preset');
    const playerMode      = params.get('play') === '1';
    if (initialTimeline) {
        editor.openTimeline(initialTimeline);
        if (playerMode) editor.enterPlayerMode();
    } else if (initialPreset) {
        editor.addEntry(initialPreset);
    }

    // Wire global keyboard shortcuts
    document.addEventListener('keydown', e => {
        const ctrl = e.metaKey || e.ctrlKey;
        const inInput = isInputFocused();

        // Save
        if (ctrl && e.key === 's') {
            e.preventDefault();
            editor.saveTimeline();
        }
        // T — toggle strip visibility
        if (!ctrl && !e.shiftKey && e.key === 't' && !inInput) {
            e.preventDefault();
            editor.toggleStrip();
        }
        // F — toggle fullscreen
        if (!ctrl && !e.shiftKey && e.key === 'f' && !inInput) {
            e.preventDefault();
            editor.toggleFullscreen();
        }
        // Escape — close any open overlay or stop playback
        if (e.key === 'Escape') {
            editor.handleEscape();
        }
        // Delete / Backspace — remove selected block
        if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
            editor.deleteSelected();
        }
        // Space — play/stop
        if (e.key === ' ' && !inInput) {
            e.preventDefault();
            editor.togglePlayback();
        }
        // ? or / — toggle keyboard guide
        if (!ctrl && !inInput && (e.key === '?' || e.key === '/')) {
            e.preventDefault();
            editor.toggleKeyboardGuide();
        }
        // 1-9 — jump to marker
        if (!ctrl && !inInput && e.key >= '1' && e.key <= '9') {
            const num = parseInt(e.key, 10);
            editor.jumpToMarker(num - 1);
        }
        // Home — reset to start and stop
        if (e.key === 'Home' && !inInput) {
            e.preventDefault();
            editor.stop();
            editor._scrubTo(0);
        }
        // Up/Down — nudge playhead (±1s, ±5s with Shift)
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !inInput && !ctrl) {
            e.preventDefault();
            const nudgeSec = e.shiftKey ? 5 : 1;
            const dir = e.key === 'ArrowUp' ? 1 : -1; // Up = forward, Down = backward
            const newTime = Math.max(0, editor._currentTime + (dir * nudgeSec));
            editor._scrubTo(newTime);
        }
        // Left/Right — jump to prev/next block boundary
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inInput && !ctrl) {
            e.preventDefault();
            if (e.key === 'ArrowRight') editor._skipToNextBlock();
            else editor._skipToPrevBlock();
        }
        // 1-9 — jump to marker by index
        if (!ctrl && !inInput && e.key >= '1' && e.key <= '9') {
            e.preventDefault();
            const num = parseInt(e.key, 10);
            editor.jumpToMarker(num - 1);
        }
    });

    // Help button click delegation
    document.addEventListener('click', e => {
        if (e.target.closest('#tl-btn-help')) {
            editor?.toggleKeyboardGuide();
        }
    });

    console.log(
        '%c✦ Timeline Editor%c — ready',
        'color:#b8b0e8;font-weight:700',
        'color:#666'
    );
}

function isInputFocused() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// ─── Audio source handlers ────────────────────────────────────────────────────

btnMic.addEventListener('click', () => {
    boot(async eng => {
        const result = await pickAndConnect(eng);
        if (result.connected) {
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
    });
});

btnNoAudio?.addEventListener('click', () => {
    boot(async () => {
        // No audio connected — show empty mini player so user can load later
        miniPlayer.hidden = false;
        mpFilename.textContent = 'No audio loaded';
        mpFilename.dataset.tooltip = 'Click Load button to add audio';
        mpTime.textContent = '— / —';
        mpSeek.value = 0;
        mpSeek.style.setProperty('--pct', '0%');
        // Disable play/seek - only load button works until audio added
        mpPlay.disabled = true;
        mpSeek.disabled = true;
        mpPlay.style.opacity = '0.4';
        mpSeek.style.opacity = '0.4';
    });
});

// Mini player file swap (after boot)
mpLoad.addEventListener('click', async () => {
    if (window.__TAURI__) {
        const file = await pickAudioFile();
        if (!file || !engine) return;
        try {
            const audio = await engine.connectAudioFile(file);
            audio.play();
            mountMiniPlayer(audio, file.name);
        } catch (err) {
            console.error('[Timeline] Audio swap failed:', err);
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
    } catch (err) {
        console.error('[Timeline] Audio swap failed:', err);
    }
});
