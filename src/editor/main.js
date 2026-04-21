/**
 * Preset Studio — Entry point
 * Bootstraps the engine and hands off to EditorInspector once
 * the user picks an audio source.
 */

import { VisualizerEngine } from '../visualizer.js';
import { EditorInspector, showToast } from './inspector.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const startEl = document.getElementById('editor-start');
const shellEl = document.getElementById('editor-shell');
const canvasEl = document.getElementById('editor-canvas');
const btnMic = document.getElementById('start-mic');
const btnFile = document.getElementById('start-file');
const fileInput = document.getElementById('start-file-input');

// Mini player refs
const miniPlayer = document.getElementById('mini-player');
const mpFilename = document.getElementById('mp-filename');
const mpTime = document.getElementById('mp-time');
const mpPlay = document.getElementById('mp-play');
const mpIconPlay = document.getElementById('mp-icon-play');
const mpIconPause = document.getElementById('mp-icon-pause');
const mpSeek = document.getElementById('mp-seek');
const mpVol = document.getElementById('mp-vol');

// ─── Engine ───────────────────────────────────────────────────────────────────

let engine = null;
let inspector = null;

function sizeCanvas() {
    if (!engine) return;
    const panelW = 340;
    const w = Math.max(120, window.innerWidth - panelW);
    engine.setSize(w, window.innerHeight);
}

// ─── Mini player wiring ───────────────────────────────────────────────────────

function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function mountMiniPlayer(audio, filename) {
    mpFilename.textContent = filename.length > 32 ? filename.slice(0, 30) + '…' : filename;
    miniPlayer.hidden = false;

    const updateUI = () => {
        const cur = audio.currentTime;
        const dur = audio.duration || 0;
        mpTime.textContent = `${fmt(cur)} / ${fmt(dur)}`;
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        mpSeek.value = dur > 0 ? cur / dur : 0;
        mpSeek.style.setProperty('--pct', `${pct.toFixed(1)}%`);
        mpIconPlay.hidden = !audio.paused;
        mpIconPause.hidden = audio.paused;
    };

    audio.addEventListener('timeupdate', updateUI);
    audio.addEventListener('play', updateUI);
    audio.addEventListener('pause', updateUI);
    audio.addEventListener('durationchange', updateUI);

    mpPlay.addEventListener('click', () => {
        if (audio.paused) audio.play(); else audio.pause();
    });

    let seeking = false;
    mpSeek.addEventListener('mousedown', () => { seeking = true; });
    mpSeek.addEventListener('input', () => {
        const pct = parseFloat(mpSeek.value);
        mpSeek.style.setProperty('--pct', `${(pct * 100).toFixed(1)}%`);
        if (audio.duration) audio.currentTime = pct * audio.duration;
    });
    mpSeek.addEventListener('mouseup', () => { seeking = false; });

    mpVol.addEventListener('input', () => {
        audio.volume = parseFloat(mpVol.value);
        mpVol.style.setProperty('--pct', `${(audio.volume * 100).toFixed(1)}%`);
    });

    updateUI();
}

async function boot(connectAudioFn) {
    // Init engine on the canvas
    engine = new VisualizerEngine();
    engine.init(canvasEl);
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    // Connect the chosen audio source
    try {
        await connectAudioFn(engine);
    } catch (err) {
        console.warn('[Studio] Audio unavailable:', err.message);
        showToast('Audio unavailable — visual preview only');
    }

    // Fade out start screen and reveal editor
    startEl.style.transition = 'opacity 0.25s';
    startEl.style.opacity = '0';
    startEl.style.pointerEvents = 'none';
    setTimeout(() => { startEl.hidden = true; }, 260);
    shellEl.hidden = false;

    // Wire up the inspector panel
    inspector = new EditorInspector(engine);

    // Editor owns its own preset state — stop the engine's auto-cycle
    // so it never overrides what the user is building.
    engine.stopAutoCycle();
    engine.autoCycleEnabled = false;

    console.log(
        '%c✦ Preset Studio%c — blank canvas, go build something',
        'color:#fff;font-weight:700',
        'color:#666'
    );
}

// ─── Audio sources ────────────────────────────────────────────────────────────

btnMic.addEventListener('click', () => {
    boot(async (eng) => {
        await eng.connectMicrophone();
        showToast('Microphone connected');
    });
});

btnFile.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    boot(async (eng) => {
        const audio = await eng.connectAudioFile(file);
        audio.play();
        mountMiniPlayer(audio, file.name);
        showToast('Playing: ' + file.name);
    });
});

// ─── Global keyboard shortcuts ────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
    if (!inspector) return;
    const ctrl = e.metaKey || e.ctrlKey;
    if (ctrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); inspector.undo(); }
    if (ctrl && e.shiftKey && e.key === 'z') { e.preventDefault(); inspector.redo(); }
});
