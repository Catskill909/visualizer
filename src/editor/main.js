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

// ─── Engine ───────────────────────────────────────────────────────────────────

let engine = null;
let inspector = null;

function sizeCanvas() {
    if (!engine) return;
    const panelW = 340;
    const w = Math.max(120, window.innerWidth - panelW);
    engine.setSize(w, window.innerHeight);
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
