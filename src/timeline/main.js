/**
 * Timeline Editor — Entry point
 * Mirrors the boot pattern from src/editor/main.js
 */

import { VisualizerEngine } from '../visualizer.js';
import { TimelineEditor }   from './timelineEditor.js';
import { initAuthGate }     from '../auth-gate.js';

initAuthGate();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const startEl     = document.getElementById('tl-start');
const shellEl     = document.getElementById('tl-shell');
const btnMic      = document.getElementById('start-mic');
const btnFile     = document.getElementById('start-file');
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
        await eng.connectMicrophone();
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
    });
});

// Mini player file swap (after boot)
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
    } catch (err) {
        console.error('[Timeline] Audio swap failed:', err);
    }
});
