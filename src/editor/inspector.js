/**
 * EditorInspector — tab-based preset builder panel.
 *
 * Tabs: Palette | Motion | Wave | Feel | Image
 *
 * Color system
 * ────────────
 *  Wave    → wave_r / wave_g / wave_b   (the audio waveform colour)
 *  Glow    → ob_r / ob_g / ob_b         (outer-border glow ring)
 *  Accent  → ib_r / ib_g / ib_b         (inner-border accent ring)
 *
 *  Palette chips set Wave + Glow simultaneously as a matched pair.
 *  All three swatches can be freely overridden after applying a palette.
 */

import { createCustomPreset, saveCustomPreset, getImage, storeImage, generateId } from '../customPresets.js';

// ─── Phase 1: layer limits + upload resize ───────────────────────────────────
// Cap surface area for Phase 1. Internals (shader builder, state array) are
// N-generic — raising this later is a one-line change.
const MAX_LAYERS = 5;
const STD_MAX_DIM = 1024;   // Standard upload max dimension (longest side)
const HD_MAX_DIM = 2048;    // "HD" toggle max dimension

/**
 * Downscale an image file to at most `maxDim` on its longest side.
 * Destructive — the original blob is not retained anywhere.
 * Returns a new Blob (original format preserved when possible) plus dimensions
 * so callers can report the before/after size in a toast.
 */
async function resizeImageFile(file, maxDim) {
    const dataURL = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
    });

    // GIFs must never pass through canvas — drawImage() freezes on frame 1.
    // Store the raw bytes; the visualizer decodes frames from the dataURL directly.
    if (file.type === 'image/gif') {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('decode failed'));
            el.src = dataURL;
        });
        return { blob: file, dataURL, width: img.naturalWidth, height: img.naturalHeight, resized: false, originalW: img.naturalWidth, originalH: img.naturalHeight, isGif: true };
    }

    const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('decode failed'));
        el.src = dataURL;
    });
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= maxDim) {
        // Already small enough — keep as-is, but still return dimensions.
        return { blob: file, dataURL, width: img.naturalWidth, height: img.naturalHeight, resized: false, originalW: img.naturalWidth, originalH: img.naturalHeight };
    }
    const scale = maxDim / longest;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    // Prefer the original mime type (JPEG stays JPEG for size; PNG keeps alpha).
    const outType = (file.type === 'image/jpeg' || file.type === 'image/webp') ? file.type : 'image/png';
    const blob = await new Promise(r => canvas.toBlob(r, outType, 0.92));
    const outDataURL = canvas.toDataURL(outType, 0.92);
    return { blob, dataURL: outDataURL, width: w, height: h, resized: true, originalW: img.naturalWidth, originalH: img.naturalHeight };
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Blank start state ────────────────────────────────────────────────────────

// Minimal passthrough comp shader — butterchurn won't accept an empty string.
const BLANK_COMP = ' shader_body { \n  vec4 tmpvar_1;\n  tmpvar_1.w = 1.0;\n  tmpvar_1.xyz = (texture (sampler_main, uv).xyz * 2.0);\n  ret = tmpvar_1.xyz;\n }';

const BLANK = {
    baseVals: {
        zoom: 1.0, rot: 0.0, warp: 0.0, warpanimspeed: 1.0, warpscale: 1.0,
        decay: 0.98, gammaadj: 2.0,
        echo_zoom: 1.0, echo_orient: 0,
        wave_mode: 3,
        wave_r: 1.0, wave_g: 1.0, wave_b: 1.0, wave_a: 0.8,
        wave_scale: 1.0, wave_mystery: 0.0,
        wave_thick: 0, additivewave: 0, wave_usedots: 0, wave_brighten: 0,
        ob_size: 0.0, ob_r: 0.0, ob_g: 0.0, ob_b: 0.0, ob_a: 0.0,
        ib_size: 0.0, ib_r: 0.0, ib_g: 0.0, ib_b: 0.0, ib_a: 0.0,
        mv_x: 12, mv_y: 9, mv_l: 0.9, mv_r: 0.0, mv_g: 0.0, mv_b: 1.0, mv_a: 0.0,
        darken: 0, invert: 0, b1ed: 0.5,
    },
    shapes: [], waves: [],
    warp: '',          // empty warp is valid
    comp: BLANK_COMP,  // must be a valid GLSL shader_body string
    init_eqs_str: '', frame_eqs_str: '', pixel_eqs_str: '',
    images: [],
    sceneMirror: 'none',  // 'none' | 'h' | 'v' | 'both'
    // Solid-mode fx — only applied when a variation with a `solid:` base is active.
    // All default to 0 so "Solid" out of the box is truly static (no breath, no pulse).
    solidPulse: 0,        // bass multiplier: col *= (1 + bass * pulse)
    solidBreath: 0,       // slow sine amplitude: col *= mix(1, 0.5+0.5*sin(t*0.6), breath)
    solidShift: 0,        // beat-driven mix amount toward solidColorB (uses bass_att)
    solidColorB: [0, 0, 0],
};

// ─── Base Variations ─────────────────────────────────────────────────────────
// Full starting-point snapshots. Each overrides selected BLANK baseVals.
// `color` is used for the card's preview strip (CSS gradient).

const BASE_VARIATIONS = [
    {
        // One flat color. Pulse/Breath default to 0 — truly static unless the
        // user dials them up. `solid:` tells the comp shader to use a flat base
        // color instead of the warp feedback buffer.
        name: 'Solid', desc: 'One color', color: '#2a0050',
        solid: [0.16, 0.04, 0.44],
        bv: {
            decay: 0.98, gammaadj: 2.0,
            wave_a: 0,  // no audio waveform overlay by default
        },
    },
    {
        // Two colors that cross-fade on the beat. Same comp shader path as Solid
        // but with a non-zero solidShift driving a mix() toward solidColorB.
        name: 'Shift', desc: 'Two-color beat mix', color: '#d02060',
        solid: [0.88, 0.12, 0.38],
        solidColorB: [0.10, 0.20, 0.90],
        solidPulse: 0.3,
        solidBreath: 0.2,
        solidShift: 0.7,
        bv: {
            decay: 0.98, gammaadj: 2.0,
            wave_a: 0,
        },
    },
    {
        name: 'Drift', desc: 'Slow & dreamy', color: '#5010c0',
        bv: {
            zoom: 0.97, rot: 0.12, warp: 1.5, warpanimspeed: 0.4,
            decay: 0.985, gammaadj: 2.2,
            echo_zoom: 1.8,
            wave_mode: 3,
            wave_r: 0.7, wave_g: 0.2, wave_b: 1.0, wave_a: 0.75, wave_scale: 0.8,
            ob_size: 0.015, ob_r: 0.4, ob_g: 0.0, ob_b: 0.9, ob_a: 0.6,
        },
    },
    {
        name: 'Pulse', desc: 'Neon heartbeat', color: '#0090ff',
        bv: {
            zoom: 0.94, decay: 0.97, gammaadj: 2.8,
            echo_zoom: 1.6,
            wave_mode: 3,
            wave_r: 0.0, wave_g: 0.85, wave_b: 1.0, wave_a: 0.95,
            wave_scale: 1.4, wave_thick: 1, additivewave: 1,
            ob_size: 0.02, ob_r: 0.0, ob_g: 0.25, ob_b: 0.9, ob_a: 0.7,
        },
    },
    {
        name: 'Storm', desc: 'Chaotic energy', color: '#cccccc',
        bv: {
            zoom: 1.02, warp: 3.5, warpanimspeed: 2.2,
            decay: 0.975,
            echo_zoom: 1.1,
            wave_mode: 1,
            wave_r: 1.0, wave_g: 1.0, wave_b: 1.0, wave_a: 0.85,
            wave_scale: 1.8, wave_thick: 1, additivewave: 1,
        },
    },
    {
        name: 'Ripple', desc: 'Liquid rings', color: '#1060c0',
        bv: {
            zoom: 0.98, warp: 0.5, warpanimspeed: 0.8,
            decay: 0.99,
            echo_zoom: 2.2,
            wave_mode: 7,
            wave_r: 0.1, wave_g: 0.65, wave_b: 1.0, wave_a: 0.9, wave_scale: 1.0,
            ob_size: 0.012, ob_r: 0.0, ob_g: 0.2, ob_b: 0.8, ob_a: 0.5,
        },
    },
    {
        name: 'Radiate', desc: 'Warm spin', color: '#c07000',
        bv: {
            zoom: 1.0, rot: 0.25, warp: 0.8,
            decay: 0.978, gammaadj: 2.5,
            echo_zoom: 1.4,
            wave_mode: 6,
            wave_r: 1.0, wave_g: 0.75, wave_b: 0.0, wave_a: 0.9,
            wave_scale: 1.2, additivewave: 1,
            ob_size: 0.018, ob_r: 1.0, ob_g: 0.35, ob_b: 0.05, ob_a: 0.65,
        },
    },
    {
        name: 'Scatter', desc: 'Acid dots', color: '#50b800',
        bv: {
            warp: 1.0, warpanimspeed: 1.5,
            decay: 0.96, gammaadj: 3.0,
            wave_mode: 5,
            wave_r: 0.7, wave_g: 1.0, wave_b: 0.0, wave_a: 1.0,
            wave_scale: 2.0, wave_usedots: 1, additivewave: 1,
        },
    },
    {
        name: 'Bloom', desc: 'Soft center', color: '#cc2060',
        bv: {
            zoom: 0.99, warp: 0.3, warpanimspeed: 0.6,
            decay: 0.988, gammaadj: 2.8,
            echo_zoom: 3.5,
            wave_mode: 0,
            wave_r: 1.0, wave_g: 0.25, wave_b: 0.55, wave_a: 0.9,
            wave_scale: 0.9, wave_thick: 1,
            ob_size: 0.025, ob_r: 0.9, ob_g: 0.05, ob_b: 0.35, ob_a: 0.75,
        },
    },
];

// ─── Palettes ─────────────────────────────────────────────────────────────────
// Each entry: wave colour + glow colour (ob_r/g/b), both normalised 0-1.

const PALETTES = [
    { name: 'Mono', wave: [1.00, 1.00, 1.00], glow: [0.80, 0.80, 0.80] },
    { name: 'Neon', wave: [0.00, 0.90, 1.00], glow: [0.00, 0.30, 1.00] },
    { name: 'Electric', wave: [0.20, 1.00, 0.40], glow: [0.00, 0.60, 0.20] },
    { name: 'Fire', wave: [1.00, 0.30, 0.00], glow: [1.00, 0.70, 0.00] },
    { name: 'Violet', wave: [0.80, 0.20, 1.00], glow: [0.40, 0.00, 0.90] },
    { name: 'Ocean', wave: [0.10, 0.70, 1.00], glow: [0.00, 0.20, 0.80] },
    { name: 'Sunset', wave: [1.00, 0.40, 0.20], glow: [0.90, 0.10, 0.70] },
    { name: 'Ice', wave: [0.70, 0.90, 1.00], glow: [0.50, 0.80, 1.00] },
    { name: 'Gold', wave: [1.00, 0.80, 0.00], glow: [1.00, 0.40, 0.10] },
    { name: 'Rose', wave: [1.00, 0.30, 0.60], glow: [0.90, 0.10, 0.40] },
    { name: 'Acid', wave: [0.80, 1.00, 0.00], glow: [0.30, 0.90, 0.10] },
    { name: 'Plasma', wave: [1.00, 0.00, 0.80], glow: [0.20, 0.80, 1.00] },
];

// ─── Wave mode definitions ────────────────────────────────────────────────────

const WAVE_MODES = [
    {
        mode: 0, label: 'Center',
        icon: `<polyline points="2,10 5,6 9,14 13,6 17,10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
        mode: 1, label: 'Lines',
        icon: `<line x1="2" y1="7" x2="18" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="2" y1="13" x2="18" y2="13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
    },
    {
        mode: 2, label: 'Sides',
        icon: `<polyline points="7,2 7,8 13,10 7,12 7,18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
        mode: 3, label: 'Pulse',
        icon: `<circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
    },
    {
        mode: 4, label: 'Star',
        icon: `<polygon points="10,2.5 11.8,7.8 17.4,7.8 12.8,11.1 14.6,16.4 10,13.1 5.4,16.4 7.2,11.1 2.6,7.8 8.2,7.8" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
    },
    {
        mode: 5, label: 'Dots',
        icon: `<circle cx="5" cy="8" r="1.6" fill="currentColor"/><circle cx="10" cy="5" r="1.6" fill="currentColor"/><circle cx="15" cy="8" r="1.6" fill="currentColor"/><circle cx="7" cy="13" r="1.6" fill="currentColor"/><circle cx="13" cy="13" r="1.6" fill="currentColor"/>`,
    },
    {
        mode: 6, label: 'Radial',
        icon: `<circle cx="10" cy="10" r="2" fill="currentColor"/><line x1="10" y1="3" x2="10" y2="7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="10" y1="12.5" x2="10" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="10" x2="7.5" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="12.5" y1="10" x2="17" y2="10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    },
    {
        mode: 7, label: 'Ripple',
        icon: `<circle cx="10" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1" stroke-opacity="0.55"/><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="0.7" stroke-opacity="0.25"/>`,
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rgbToHex(r, g, b) {
    const h = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

function hexToRgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
    ];
}

/**
 * Build a labeled range slider row and append it to `container`.
 * Returns the <input type="range"> element.
 */
function makeSlider(container, { id, label, min, max, step, value, decimals = 2 }) {
    const pct = ((value - min) / (max - min)) * 100;
    const wrap = document.createElement('div');
    wrap.className = 'slider-row';
    wrap.innerHTML = `
    <div class="slider-header">
      <span class="slider-label">${label}</span>
      <span class="slider-value" id="${id}-val">${Number(value).toFixed(decimals)}</span>
    </div>
    <input
      type="range" id="${id}" class="slider"
      min="${min}" max="${max}" step="${step}" value="${value}"
      style="--pct:${pct}%"
    />
  `;
    container.appendChild(wrap);
    return wrap.querySelector('input');
}

// ─── EditorInspector class ────────────────────────────────────────────────────

export class EditorInspector {
    constructor(engine) {
        this.engine = engine;
        this.currentState = deepClone(BLANK);
        this.originalState = deepClone(BLANK);
        this.undoStack = [];
        this.redoStack = [];
        this._snap = null;   // pending pre-pointer snapshot
        this._abActive = false;
        this._imageTextures = {};     // texName → { data, width, height } — survives preset reloads
        this._imagesOnly = false;     // when true: black comp base, no wave
        this._solidColor = BASE_VARIATIONS[0].solid || null;  // solid color base for first variation
        this._hdUploads = false;      // when true: next upload is resized to HD_MAX_DIM instead of STD_MAX_DIM
        this._lastBuildMs = 0;        // dev monitor: last shader rebuild time

        this.onchange = null;   // set by main.js for dirty-state tracking

        this._buildBaseVariations();
        this._buildPaletteChips();
        this._buildPaletteSliders();
        this._buildSolidFxPanel();
        this._buildMotionSliders();
        this._buildWaveModeGrid();
        this._buildWaveSliders();
        this._buildFeelSliders();
        this._bindColorSwatches();
        this._bindToggles();
        this._bindEchoOrient();
        this._bindTabs();
        this._bindUndoRedo();
        this._bindAB();
        this._bindSave();
        this._bindReset();
        this._bindImageDropzone();
        this._bindImagesOnly();
        this._bindHdUploads();
        this._bindCollapseAll();
        this._initDevHud();
        this._updateLayersBar();

        // Apply the first variation (Solid) as the startup state — gives users
        // something to look at immediately instead of a black screen.
        const v0 = BASE_VARIATIONS[0];
        this.currentState.baseVals = { ...deepClone(BLANK.baseVals), ...v0.bv };
        if (v0.solid) {
            this.currentState.baseVals.wave_r = v0.solid[0];
            this.currentState.baseVals.wave_g = v0.solid[1];
            this.currentState.baseVals.wave_b = v0.solid[2];
        }
        this.currentState.solidPulse = v0.solidPulse ?? 0;
        this.currentState.solidBreath = v0.solidBreath ?? 0;
        this.currentState.solidShift = v0.solidShift ?? 0;
        this.currentState.solidColorB = (v0.solidColorB || [0, 0, 0]).slice();
        // _buildCompShader must run here so the solid-color GLSL is baked into
        // currentState.comp before the first _applyToEngine call.
        this._buildCompShader();

        this._applyToEngine();
        this._syncAllControls();
        this._updateSolidFxVisibility(v0);

        // Butterchurn may be mid-blend from the engine's initial randomPreset() call.
        // Hammer the preset for several frames to guarantee we win the blend race.
        const forceApply = (n) => {
            if (n <= 0) return;
            this._buildCompShader();
            this._applyToEngine();
            requestAnimationFrame(() => forceApply(n - 1));
        };
        requestAnimationFrame(() => forceApply(5));
    }

    // ─── Public undo/redo (called from main.js keyboard handler) ────────────────

    undo() { this._undo(); }
    redo() { this._redo(); }

    // ─── Base variations ──────────────────────────────────────────────────────

    _buildBaseVariations() {
        const grid = document.getElementById('base-var-grid');
        if (!grid) return;
        BASE_VARIATIONS.forEach((v, i) => {
            const btn = document.createElement('button');
            btn.className = 'base-var-btn' + (i === 0 ? ' active' : '');
            btn.dataset.variation = i;
            btn.setAttribute('data-tooltip', v.desc);
            btn.innerHTML = `
        <span class="bv-strip" style="background:${v.color}"></span>
        <span class="bv-body">
          <span class="bv-name">${v.name}</span>
          <span class="bv-desc">${v.desc}</span>
        </span>
      `;
            btn.addEventListener('click', () => this._applyVariation(i));
            grid.appendChild(btn);
        });
    }

    _applyVariation(i) {
        const v = BASE_VARIATIONS[i];
        this._preSnap();
        // Merge BLANK baseVals with the variation's overrides
        this.currentState.baseVals = { ...deepClone(BLANK.baseVals), ...v.bv };
        // If the variation sets a solid base, copy its wave_r/g/b from `solid:`
        // so the swatch and shader agree. Non-solid variations keep BLANK's defaults.
        if (v.solid) {
            this.currentState.baseVals.wave_r = v.solid[0];
            this.currentState.baseVals.wave_g = v.solid[1];
            this.currentState.baseVals.wave_b = v.solid[2];
        }
        // Solid-mode fx: reset to BLANK defaults, then apply variation overrides.
        this.currentState.solidPulse = v.solidPulse ?? 0;
        this.currentState.solidBreath = v.solidBreath ?? 0;
        this.currentState.solidShift = v.solidShift ?? 0;
        this.currentState.solidColorB = (v.solidColorB || [0, 0, 0]).slice();
        // Reset equations but preserve comp (may have image layers)
        this.currentState.init_eqs_str = '';
        this.currentState.frame_eqs_str = '';
        this.currentState.pixel_eqs_str = '';
        this.currentState.warp = '';
        // Solid color base: bake into comp shader; clear when not present
        this._solidColor = v.solid || null;
        // Reset Images Only when switching variations
        this._imagesOnly = false;
        const ioToggle = document.getElementById('toggle-images-only');
        if (ioToggle) ioToggle.checked = false;
        this._postSnap();
        this._buildCompShader();
        this._applyToEngine();
        this._syncAllControls();
        this._clearPaletteActive();
        this._updateSolidFxVisibility(v);
        document.querySelectorAll('.base-var-btn').forEach((el, idx) => {
            el.classList.toggle('active', idx === i);
        });
    }

    /**
     * Show/hide the Solid-FX panel and the Shift color row based on the active
     * variation. Also relabels the main Wave swatch to match the current mode:
     *   Solid → "Color"
     *   Shift → "Color A"
     *   other → "Wave"   (waveform color, original meaning)
     */
    _updateSolidFxVisibility(variation) {
        const panel = document.getElementById('solid-fx-panel');
        const shiftRow = document.getElementById('solid-colorb-row');
        const waveLabel = document.getElementById('wave-row-label');
        const hasSolid = !!(variation && variation.solid);
        const isShift = hasSolid && variation.name === 'Shift';
        if (panel) panel.hidden = !hasSolid;
        if (shiftRow) shiftRow.hidden = !isShift;
        if (waveLabel) waveLabel.textContent = isShift ? 'Color A' : hasSolid ? 'Color' : 'Wave';
    }

    /**
     * Build the Solid-FX panel: Pulse, Breath, Shift sliders and the Shift-color
     * swatch binding. Shift slider is created but conceptually only meaningful
     * in Shift mode — the Shift color row hides in Solid mode, so moving the
     * slider there has no visible effect (mix toward (0,0,0) at pulse=0 is fine).
     */
    _buildSolidFxPanel() {
        const container = document.getElementById('solid-fx-sliders');
        if (!container) return;
        const configs = [
            { id: 'sf-pulse', label: 'Pulse', min: 0, max: 2.0, step: 0.01, value: 0, key: 'solidPulse' },
            { id: 'sf-breath', label: 'Breath', min: 0, max: 1.0, step: 0.01, value: 0, key: 'solidBreath' },
            { id: 'sf-shift', label: 'Shift', min: 0, max: 1.0, step: 0.01, value: 0, key: 'solidShift' },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState[cfg.key] = v;
                this._buildCompShader();
                this._applyToEngine();
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });

        // Shift color swatch (Color B)
        const swatch = document.getElementById('swatch-shift');
        const native = document.getElementById('color-shift');
        const hexLabel = document.getElementById('hex-shift');
        if (swatch && native) {
            swatch.addEventListener('click', () => native.click());
            let needsSnap = true;
            native.addEventListener('input', () => {
                if (needsSnap) { this._preSnap(); needsSnap = false; }
                swatch.style.background = native.value;
                if (hexLabel) hexLabel.textContent = native.value.toUpperCase();
                this.currentState.solidColorB = hexToRgb(native.value);
                this._buildCompShader();
                this._applyToEngine();
            });
            native.addEventListener('change', () => {
                this._postSnap();
                needsSnap = true;
            });
        }
    }

    // ─── Palette chips ────────────────────────────────────────────────────────

    _buildPaletteChips() {
        const grid = document.getElementById('palette-grid');
        PALETTES.forEach((p, i) => {
            const wHex = rgbToHex(...p.wave);
            const gHex = rgbToHex(...p.glow);
            const btn = document.createElement('button');
            btn.className = 'palette-chip';
            btn.setAttribute('data-tooltip', p.name);
            btn.dataset.palette = i;
            btn.innerHTML = `
        <span class="chip-dots">
          <span class="chip-dot" style="background:${wHex}"></span>
          <span class="chip-dot chip-dot--glow" style="background:${gHex}"></span>
        </span>
        <span class="chip-name">${p.name}</span>
      `;
            btn.addEventListener('click', () => this._applyPalette(i));
            grid.appendChild(btn);
        });
    }

    _applyPalette(i) {
        const p = PALETTES[i];
        this._preSnap();
        const bv = this.currentState.baseVals;
        [bv.wave_r, bv.wave_g, bv.wave_b] = p.wave;
        [bv.ob_r, bv.ob_g, bv.ob_b] = p.glow;
        bv.ob_a = 0.75;
        bv.ob_size = 0.02;
        this._postSnap();
        // Rebuild comp shader so solid-color base picks up the new wave_r/g/b
        this._buildCompShader();
        this._applyToEngine();
        this._syncColorSwatches();
        // Highlight active chip
        document.querySelectorAll('.palette-chip').forEach((el, idx) => {
            el.classList.toggle('active', idx === i);
        });
    }

    // ─── Palette appearance sliders (Brightness, Trail) ──────────────────────

    _buildPaletteSliders() {
        const container = document.getElementById('palette-sliders');
        const configs = [
            { id: 'ps-gamma', label: 'Brightness', min: 0.5, max: 4.0, step: 0.05, value: BLANK.baseVals.gammaadj, key: 'gammaadj' },
            { id: 'ps-decay', label: 'Trail', min: 0.85, max: 0.999, step: 0.001, value: BLANK.baseVals.decay, decimals: 3, key: 'decay' },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(cfg.decimals ?? 2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.baseVals[cfg.key] = v;
                this._applyToEngine();
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });
    }

    // ─── Color swatches ────────────────────────────────────────────────────────

    _bindColorSwatches() {
        this._bindSwatch('wave', (hex) => { const [r, g, b] = hexToRgb(hex); this.currentState.baseVals.wave_r = r; this.currentState.baseVals.wave_g = g; this.currentState.baseVals.wave_b = b; });
        this._bindSwatch('glow', (hex) => {
            const [r, g, b] = hexToRgb(hex);
            this.currentState.baseVals.ob_r = r; this.currentState.baseVals.ob_g = g; this.currentState.baseVals.ob_b = b;
            if (!this.currentState.baseVals.ob_a) { this.currentState.baseVals.ob_a = 0.75; this.currentState.baseVals.ob_size = 0.02; }
        });
        this._bindSwatch('accent', (hex) => {
            const [r, g, b] = hexToRgb(hex);
            this.currentState.baseVals.ib_r = r; this.currentState.baseVals.ib_g = g; this.currentState.baseVals.ib_b = b;
            if (!this.currentState.baseVals.ib_a) { this.currentState.baseVals.ib_a = 0.5; this.currentState.baseVals.ib_size = 0.01; }
        });
    }

    /** Wire up one colour swatch + its hidden native <input type=color>. */
    _bindSwatch(name, applyFn) {
        const swatch = document.getElementById(`swatch-${name}`);
        const native = document.getElementById(`color-${name}`);
        const hexLabel = document.getElementById(`hex-${name}`);
        if (!swatch || !native) return;

        // Clicking the visible swatch opens the native colour picker
        swatch.addEventListener('click', () => native.click());

        let needsSnap = true;
        native.addEventListener('input', () => {
            if (needsSnap) { this._preSnap(); needsSnap = false; }
            swatch.style.background = native.value;
            if (hexLabel) hexLabel.textContent = native.value.toUpperCase();
            applyFn(native.value);
            this._buildCompShader();
            this._applyToEngine();
            this._clearPaletteActive();
        });
        native.addEventListener('change', () => {
            this._postSnap();
            needsSnap = true;
        });
    }

    _syncColorSwatches() {
        const bv = this.currentState.baseVals;
        this._setSwatchHex('wave', rgbToHex(bv.wave_r, bv.wave_g, bv.wave_b));
        this._setSwatchHex('glow', rgbToHex(bv.ob_r, bv.ob_g, bv.ob_b));
        this._setSwatchHex('accent', rgbToHex(bv.ib_r, bv.ib_g, bv.ib_b));
    }

    _setSwatchHex(name, hex) {
        const swatch = document.getElementById(`swatch-${name}`);
        const native = document.getElementById(`color-${name}`);
        const hexLabel = document.getElementById(`hex-${name}`);
        if (swatch) swatch.style.background = hex;
        if (native) native.value = hex;
        if (hexLabel) hexLabel.textContent = hex.toUpperCase();
    }

    _clearPaletteActive() {
        document.querySelectorAll('.palette-chip').forEach(el => el.classList.remove('active'));
    }

    // ─── Motion sliders ────────────────────────────────────────────────────────

    _buildMotionSliders() {
        const container = document.getElementById('motion-sliders');
        const configs = [
            { id: 'ms-zoom', label: 'Zoom', min: 0.50, max: 1.80, step: 0.01, value: BLANK.baseVals.zoom, key: 'zoom' },
            { id: 'ms-rot', label: 'Spin', min: -1.0, max: 1.00, step: 0.01, value: BLANK.baseVals.rot, key: 'rot' },
            { id: 'ms-warp', label: 'Warp', min: 0, max: 5.00, step: 0.05, value: BLANK.baseVals.warp, key: 'warp' },
            { id: 'ms-wspd', label: 'Warp Speed', min: 0.10, max: 3.00, step: 0.05, value: BLANK.baseVals.warpanimspeed, key: 'warpanimspeed' },
            { id: 'ms-ezoom', label: 'Echo Zoom', min: 1.00, max: 4.00, step: 0.05, value: BLANK.baseVals.echo_zoom, key: 'echo_zoom' },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.baseVals[cfg.key] = v;
                this._applyToEngine();
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });

        document.getElementById('btn-randomize-motion')?.addEventListener('click', () => {
            this._preSnap();
            const bv = this.currentState.baseVals;
            bv.zoom = 0.80 + Math.random() * 0.60;
            bv.rot = (Math.random() - 0.5) * 0.70;
            bv.warp = Math.random() * 4.5;
            bv.warpanimspeed = 0.20 + Math.random() * 2.60;
            bv.echo_zoom = 1.00 + Math.random() * 3.00;
            this._postSnap();
            this._applyToEngine();
            this._syncMotionSliders();
        });
    }

    _syncMotionSliders() {
        const bv = this.currentState.baseVals;
        const map = [
            ['ms-zoom', 'zoom', 0.5, 1.8],
            ['ms-rot', 'rot', -1, 1],
            ['ms-warp', 'warp', 0, 5],
            ['ms-wspd', 'warpanimspeed', 0.1, 3.0],
            ['ms-ezoom', 'echo_zoom', 1.0, 4.0],
        ];
        map.forEach(([id, key, min, max]) => {
            const input = document.getElementById(id);
            if (!input) return;
            const v = bv[key];
            input.value = v;
            const valEl = document.getElementById(`${id}-val`);
            if (valEl) valEl.textContent = Number(v).toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
        });
    }

    // ─── Wave mode grid ────────────────────────────────────────────────────────

    _buildWaveModeGrid() {
        const grid = document.getElementById('wave-mode-grid');
        WAVE_MODES.forEach(({ mode, label, icon }) => {
            const btn = document.createElement('button');
            btn.className = 'wave-mode-btn' + (mode === BLANK.baseVals.wave_mode ? ' active' : '');
            btn.dataset.mode = mode;
            btn.setAttribute('data-tooltip', label);
            btn.innerHTML = `
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">${icon}</svg>
        <span class="wave-mode-label">${label}</span>
      `;
            btn.addEventListener('click', () => {
                this._preSnap();
                this.currentState.baseVals.wave_mode = mode;
                this._postSnap();
                this._applyToEngine();
                grid.querySelectorAll('.wave-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
            });
            grid.appendChild(btn);
        });
    }

    // ─── Wave style sliders ────────────────────────────────────────────────────

    _buildWaveSliders() {
        const container = document.getElementById('wave-sliders');
        const configs = [
            { id: 'ws-scale', label: 'Size', min: 0.10, max: 4.0, step: 0.05, value: BLANK.baseVals.wave_scale, key: 'wave_scale' },
            { id: 'ws-opacity', label: 'Opacity', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_a, key: 'wave_a' },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.baseVals[cfg.key] = v;
                this._applyToEngine();
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });

        // Thickness — binary on/off rendered as an inline toggle row in the slider container
        {
            const row = document.createElement('div');
            row.className = 'slider-row wave-thick-row';
            row.innerHTML = `
              <div class="slider-header">
                <span class="slider-label">Thickness</span>
                <label class="toggle-switch toggle-switch--sm" style="margin-left:auto">
                  <input type="checkbox" id="toggle-thick" role="switch" />
                  <span class="toggle-track"><span class="toggle-thumb"></span></span>
                </label>
              </div>`;
            container.appendChild(row);
            const thickCb = row.querySelector('#toggle-thick');
            thickCb.addEventListener('change', () => {
                this._preSnap();
                this.currentState.baseVals.wave_thick = thickCb.checked ? 1 : 0;
                this._postSnap();
                this._applyToEngine();
            });
        }

        document.getElementById('btn-randomize-wave')?.addEventListener('click', () => {
            this._preSnap();
            const bv = this.currentState.baseVals;
            bv.wave_mode = Math.floor(Math.random() * 8);
            bv.wave_scale = 0.3 + Math.random() * 3.2;
            bv.wave_a = 0.4 + Math.random() * 0.6;
            bv.wave_thick = Math.random() > 0.65 ? 1 : 0;
            bv.wave_usedots = Math.random() > 0.80 ? 1 : 0;
            bv.additivewave = Math.random() > 0.65 ? 1 : 0;
            this._postSnap();
            this._applyToEngine();
            this._syncWaveControls();
        });
    }

    _syncWaveControls() {
        const bv = this.currentState.baseVals;
        // Grid buttons
        document.querySelectorAll('.wave-mode-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.mode) === bv.wave_mode);
        });
        // Sliders
        const map = [['ws-scale', 'wave_scale', 0.1, 4.0], ['ws-opacity', 'wave_a', 0, 1.0]];
        map.forEach(([id, key, min, max]) => {
            const input = document.getElementById(id);
            if (!input) return;
            const v = bv[key];
            input.value = v;
            const valEl = document.getElementById(`${id}-val`);
            if (valEl) valEl.textContent = Number(v).toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
        });
        // Thickness toggle sync
        this._syncToggle('toggle-thick', 'wave_thick');
        // Toggles
        this._syncToggle('toggle-dots', 'wave_usedots');
        this._syncToggle('toggle-additive', 'additivewave');
    }

    // ─── Feel sliders ──────────────────────────────────────────────────────────

    _buildFeelSliders() {
        const container = document.getElementById('feel-sliders');
        const configs = [
            { id: 'fs-energy', label: 'Energy', min: 0.1, max: 5.0, step: 0.1, value: this.engine.energyMultiplier, decimals: 1 },
            { id: 'fs-bass', label: 'Bass Sensitivity', min: 0.1, max: 5.0, step: 0.1, value: this.engine.baseSensitivity, decimals: 1 },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(1);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                if (cfg.id === 'fs-energy') this.engine.energyMultiplier = v;
                if (cfg.id === 'fs-bass') this.engine.baseSensitivity = v;
            });
        });
        document.getElementById('toggle-agc')?.addEventListener('change', (e) => {
            this.engine.agcEnabled = e.target.checked;
        });
    }

    // ─── Toggles ───────────────────────────────────────────────────────────────

    _bindToggles() {
        const map = {
            'toggle-invert': 'invert',
            'toggle-darken': 'darken',
            'toggle-dots': 'wave_usedots',
            'toggle-additive': 'additivewave',
            // toggle-thick is wired in _buildWaveSliders (created dynamically)
        };
        Object.entries(map).forEach(([id, key]) => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                this._preSnap();
                this.currentState.baseVals[key] = e.target.checked ? 1 : 0;
                this._postSnap();
                this._applyToEngine();
            });
        });
    }

    _syncToggle(id, key) {
        const el = document.getElementById(id);
        if (el) el.checked = this.currentState.baseVals[key] === 1;
    }

    // ─── Echo orient ───────────────────────────────────────────────────────────

    _bindEchoOrient() {
        const seg = document.getElementById('echo-orient-seg');
        if (!seg) return;
        seg.querySelectorAll('.seg').forEach(btn => {
            btn.addEventListener('click', () => {
                this._preSnap();
                this.currentState.baseVals.echo_orient = parseInt(btn.dataset.orient);
                this._postSnap();
                this._applyToEngine();
                seg.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b === btn));
            });
        });

        // Scene Mirror
        const smSeg = document.getElementById('scene-mirror-seg');
        if (smSeg) {
            smSeg.querySelectorAll('.seg').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._preSnap();
                    this.currentState.sceneMirror = btn.dataset.smirror;
                    this._postSnap();
                    this._applyToEngine();
                    smSeg.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b === btn));
                });
            });
        }
    }

    _syncEchoOrient() {
        const orient = this.currentState.baseVals.echo_orient;
        document.querySelectorAll('#echo-orient-seg .seg').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.orient) === orient);
        });
        // Scene Mirror
        const sm = this.currentState.sceneMirror || 'none';
        document.querySelectorAll('#scene-mirror-seg .seg').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.smirror === sm);
        });
    }

    _applySceneMirror() { }

    // ─── Tab switching ─────────────────────────────────────────────────────────

    _bindTabs() {
        document.querySelectorAll('.tab-bar .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const name = tab.dataset.tab;
                document.querySelectorAll('.tab-bar .tab').forEach(t => {
                    t.classList.toggle('active', t === tab);
                    t.setAttribute('aria-selected', String(t === tab));
                });
                document.querySelectorAll('.tab-panel').forEach(panel => {
                    const isTarget = panel.id === `tab-${name}`;
                    panel.hidden = !isTarget;
                });
            });
        });
    }

    // ─── Undo / Redo ───────────────────────────────────────────────────────────

    _preSnap() {
        if (this._snap === null) this._snap = deepClone(this.currentState);
    }

    _postSnap() {
        if (this._snap !== null) {
            this.undoStack.push(this._snap);
            if (this.undoStack.length > 50) this.undoStack.shift();
            this.redoStack = [];
            this._snap = null;
            this._refreshUndoRedo();
        }
    }

    _refreshUndoRedo() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
        if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
    }

    _bindUndoRedo() {
        document.getElementById('btn-undo')?.addEventListener('click', () => this._undo());
        document.getElementById('btn-redo')?.addEventListener('click', () => this._redo());
    }

    _undo() {
        if (!this.undoStack.length) return;
        this.redoStack.push(deepClone(this.currentState));
        this.currentState = this.undoStack.pop();
        this._applyToEngine();
        this._syncAllControls();
        this._refreshUndoRedo();
    }

    _redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push(deepClone(this.currentState));
        this.currentState = this.redoStack.pop();
        this._applyToEngine();
        this._syncAllControls();
        this._refreshUndoRedo();
    }

    // ─── A/B comparison ────────────────────────────────────────────────────────

    _bindAB() {
        const btn = document.getElementById('btn-ab');
        if (!btn) return;
        btn.addEventListener('pointerdown', () => {
            this._abActive = true;
            btn.classList.add('active');
            this.engine.loadPresetObject(this.originalState, 0);
        });
        const end = () => {
            if (!this._abActive) return;
            this._abActive = false;
            btn.classList.remove('active');
            this.engine.loadPresetObject(this.currentState, 0);
        };
        btn.addEventListener('pointerup', end);
        btn.addEventListener('pointerleave', end);
    }

    // ─── Save modal ────────────────────────────────────────────────────────────

    _bindSave() {
        const btnSave = document.getElementById('btn-save');
        const modal = document.getElementById('save-modal');
        const nameInput = document.getElementById('save-modal-name');
        const confirm = document.getElementById('save-modal-confirm');
        const cancel = document.getElementById('save-modal-cancel');
        const presetName = document.getElementById('preset-name-input');

        btnSave?.addEventListener('click', () => {
            if (nameInput) nameInput.value = presetName?.value || 'Untitled preset';
            if (modal) modal.hidden = false;
            setTimeout(() => nameInput?.select(), 50);
        });

        confirm?.addEventListener('click', () => {
            const name = nameInput?.value?.trim() || 'Untitled preset';
            if (presetName) presetName.value = name;
            try {
                createCustomPreset({ name, ...this.currentState });
                modal.hidden = true;
                this.originalState = deepClone(this.currentState);
                showToast(`"${name}" saved`);
            } catch (err) {
                showToast('Save failed: ' + err.message, true);
            }
        });

        cancel?.addEventListener('click', () => { if (modal) modal.hidden = true; });

        modal?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') modal.hidden = true;
            if (e.key === 'Enter') confirm?.click();
        });
    }

    // ─── Reset ─────────────────────────────────────────────────────────────────

    _bindReset() {
        document.getElementById('btn-reset')?.addEventListener('click', () => {
            this._preSnap();
            this.currentState = deepClone(BLANK);
            const v0 = BASE_VARIATIONS[0];
            this._solidColor = v0.solid || null;
            this.currentState.baseVals = { ...deepClone(BLANK.baseVals), ...v0.bv };
            if (v0.solid) {
                this.currentState.baseVals.wave_r = v0.solid[0];
                this.currentState.baseVals.wave_g = v0.solid[1];
                this.currentState.baseVals.wave_b = v0.solid[2];
            }
            this.currentState.solidPulse = v0.solidPulse ?? 0;
            this.currentState.solidBreath = v0.solidBreath ?? 0;
            this.currentState.solidShift = v0.solidShift ?? 0;
            this.currentState.solidColorB = (v0.solidColorB || [0, 0, 0]).slice();
            this._imagesOnly = false;
            const ioToggle = document.getElementById('toggle-images-only');
            if (ioToggle) ioToggle.checked = false;
            this._postSnap();
            this._buildCompShader();
            this._applyToEngine();
            this._syncAllControls();
            this._clearPaletteActive();
            this._updateSolidFxVisibility(v0);
            // Re-highlight the first variation (Solid)
            document.querySelectorAll('.base-var-btn').forEach((el, idx) => {
                el.classList.toggle('active', idx === 0);
            });
        });
    }

    // ─── Image dropzone ────────────────────────────────────────────────────────

    _bindImageDropzone() {
        const zone = document.getElementById('image-dropzone');
        const fileInput = document.getElementById('image-file-input');
        if (!zone || !fileInput) return;

        zone.addEventListener('click', (e) => {
            if (e.target === fileInput) return;
            fileInput.click();
        });
        zone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
        });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer?.files?.[0];
            if (file?.type.startsWith('image/')) this._addImageLayer(file);
        });
        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (file) { this._addImageLayer(file); fileInput.value = ''; }
        });
    }

    // ─── Images Only ───────────────────────────────────────────────────────────

    _bindImagesOnly() {
        const cb = document.getElementById('toggle-images-only');
        if (!cb) return;
        cb.addEventListener('change', () => {
            this._imagesOnly = cb.checked;
            // Suppress wave when images-only; restore when off
            if (this._imagesOnly) {
                this._savedWaveA = this.currentState.baseVals.wave_a;
                this.currentState.baseVals.wave_a = 0;
            } else {
                if (this._savedWaveA != null) {
                    this.currentState.baseVals.wave_a = this._savedWaveA;
                }
            }
            this._buildCompShader();
            this._applyToEngine();
        });
    }

    // ─── Phase 1: HD uploads toggle ────────────────────────────────────────────

    _bindHdUploads() {
        const cb = document.getElementById('toggle-hd-uploads');
        if (!cb) return;
        cb.addEventListener('change', () => {
            this._hdUploads = cb.checked;
        });
    }

    // ─── Phase 1: collapse-all / expand-all toggle ─────────────────────────────

    _bindCollapseAll() {
        const btn = document.getElementById('btn-collapse-all');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const imgs = this.currentState.images || [];
            // If ANY card is currently expanded, the action collapses all.
            // If everything is already collapsed, the action expands all.
            const anyExpanded = imgs.some(e => !e.collapsed);
            const target = anyExpanded;  // true = collapse, false = expand
            imgs.forEach(e => { e.collapsed = target; });
            document.querySelectorAll('#image-layers .image-layer-card').forEach((c, i) => {
                c.classList.toggle('collapsed', target);
                const h = c.querySelector('.layer-header');
                if (h) h.setAttribute('aria-expanded', String(!target));
            });
        });
    }

    // ─── Phase 1: layers count + dropzone-disabled bar state ───────────────────

    _updateLayersBar() {
        const countEl = document.getElementById('layers-count');
        const dropzone = document.getElementById('image-dropzone');
        const imgs = this.currentState.images || [];
        if (countEl) countEl.textContent = `Layers: ${imgs.length} / ${MAX_LAYERS}`;
        if (dropzone) dropzone.classList.toggle('disabled', imgs.length >= MAX_LAYERS);
    }

    // ─── Phase 1: delete confirmation modal ────────────────────────────────────

    _confirmDeleteLayer(entry, card, texName) {
        const modal = document.getElementById('layer-delete-modal');
        const confirmBtn = document.getElementById('layer-delete-confirm');
        const cancelBtn = document.getElementById('layer-delete-cancel');
        const msg = document.getElementById('layer-delete-msg');
        if (!modal || !confirmBtn || !cancelBtn) {
            // No modal in DOM — fall back to immediate delete (shouldn't happen)
            this._performDeleteLayer(entry, card, texName);
            return;
        }

        if (msg) {
            const name = entry.fileName ? `"${entry.fileName}"` : 'this layer';
            msg.textContent = `Remove ${name} and all its settings? This can't be undone.`;
        }

        modal.hidden = false;
        confirmBtn.focus();

        const cleanup = () => {
            modal.hidden = true;
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            window.removeEventListener('keydown', onKey);
        };
        const onConfirm = () => { cleanup(); this._performDeleteLayer(entry, card, texName); };
        const onCancel = () => { cleanup(); };
        const onBackdrop = (e) => { if (e.target === modal) onCancel(); };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
        };
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        window.addEventListener('keydown', onKey);
    }

    _performDeleteLayer(entry, card, texName) {
        const idx = this.currentState.images.indexOf(entry);
        if (idx !== -1) this.currentState.images.splice(idx, 1);
        delete this._imageTextures[texName];
        this.engine.removeGifAnimation(texName);
        this._buildCompShader();
        this._applyToEngine();
        card.remove();
        this._updateLayersBar();
        this._updateLayerIndices();
    }

    // ─── Phase 2: drag-to-reorder + keyboard reorder ──────────────────────────

    _updateLayerIndices() {
        const cards = document.querySelectorAll('#image-layers .image-layer-card');
        const total = cards.length;
        cards.forEach((c, i) => {
            const badge = c.querySelector('.layer-index-badge');
            if (badge) badge.textContent = `#${i + 1}`;
            // Disable up/down ends for arrow-reorder UX clarity via CSS data attrs
            c.dataset.atTop = i === 0 ? '1' : '0';
            c.dataset.atBottom = i === total - 1 ? '1' : '0';
        });
    }

    _reorderImage(fromIdx, toIdx) {
        const arr = this.currentState.images;
        if (fromIdx < 0 || fromIdx >= arr.length) return;
        if (toIdx < 0 || toIdx > arr.length) return;
        // Drop at own position or the slot immediately after = no-op
        if (fromIdx === toIdx || fromIdx + 1 === toIdx) return;

        this._preSnap();
        const [moved] = arr.splice(fromIdx, 1);
        const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
        arr.splice(adjustedTo, 0, moved);

        // Resync DOM to match array order — re-appending moves each node to the end
        const layers = document.getElementById('image-layers');
        const byTex = new Map();
        layers.querySelectorAll('.image-layer-card').forEach(c => {
            byTex.set(c.dataset.texName, c);
        });
        arr.forEach(e => {
            const c = byTex.get(e.texName);
            if (c) layers.appendChild(c);
        });

        this._updateLayerIndices();
        this._buildCompShader();
        this._applyToEngine();
        this._postSnap();
    }

    _wireDragReorder(card, entry, dragHandle) {
        // Handle-only drag initiator: set draggable=true only while the handle
        // is pressed so the rest of the card's controls stay responsive. A
        // document-level mouseup guarantees we reset even if the release
        // happens off the handle (mousedown-then-drag-off-without-drag case).
        const enable = () => {
            card.draggable = true;
            const off = () => { card.draggable = false; document.removeEventListener('mouseup', off); };
            document.addEventListener('mouseup', off);
        };
        dragHandle.addEventListener('mousedown', enable);
        dragHandle.addEventListener('touchstart', enable, { passive: true });
        dragHandle.addEventListener('touchend', () => { card.draggable = false; });

        card.addEventListener('dragstart', (e) => {
            if (!card.draggable) return;
            card.classList.add('dragging');
            this._dragSrcEntry = entry;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'layer-drag');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            card.draggable = false;
            document.querySelectorAll('#image-layers .image-layer-card').forEach(c => {
                c.classList.remove('drop-above', 'drop-below');
            });
            this._dragSrcEntry = null;
        });
        card.addEventListener('dragover', (e) => {
            if (!this._dragSrcEntry || this._dragSrcEntry === entry) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = card.getBoundingClientRect();
            const isAbove = (e.clientY - rect.top) < rect.height / 2;
            card.classList.toggle('drop-above', isAbove);
            card.classList.toggle('drop-below', !isAbove);
        });
        card.addEventListener('dragleave', (e) => {
            // Only clear if leaving the card itself, not moving to a child
            if (!card.contains(e.relatedTarget)) {
                card.classList.remove('drop-above', 'drop-below');
            }
        });
        card.addEventListener('drop', (e) => {
            if (!this._dragSrcEntry || this._dragSrcEntry === entry) return;
            e.preventDefault();
            const rect = card.getBoundingClientRect();
            const isAbove = (e.clientY - rect.top) < rect.height / 2;
            card.classList.remove('drop-above', 'drop-below');
            const fromIdx = this.currentState.images.indexOf(this._dragSrcEntry);
            const targetIdx = this.currentState.images.indexOf(entry);
            if (fromIdx === -1 || targetIdx === -1) return;
            const insertIdx = isAbove ? targetIdx : targetIdx + 1;
            this._reorderImage(fromIdx, insertIdx);
        });

        // Keyboard reorder — arrows on the handle move the layer up/down
        dragHandle.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const idx = this.currentState.images.indexOf(entry);
            if (idx === -1) return;
            const newIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 2;
            if ((e.key === 'ArrowUp' && idx === 0) ||
                (e.key === 'ArrowDown' && idx === this.currentState.images.length - 1)) return;
            this._reorderImage(idx, newIdx);
            // Restore focus on this card's handle (DOM moved but reference is stable)
            requestAnimationFrame(() => dragHandle.focus());
        });
    }

    // ─── Phase 1: dev overhead monitor (Shift+F12) ─────────────────────────────

    _initDevHud() {
        const hud = document.getElementById('dev-hud');
        if (!hud) return;
        this._hudEls = {
            hud,
            fps: document.getElementById('hud-fps'),
            frame: document.getElementById('hud-frame'),
            layers: document.getElementById('hud-layers'),
            vram: document.getElementById('hud-vram'),
            build: document.getElementById('hud-build'),
        };
        this._hudVisible = false;
        this._hudTimes = [];       // rolling frame timestamps
        this._hudLastTs = 0;

        // Keybinding: backtick (`) toggles HUD. macOS doesn't give you F12
        // without Fn, and Shift+F12 was getting eaten by the OS. Backtick is
        // the classic dev-overlay convention and has zero OS/browser conflict.
        // Skip when typing in an input/textarea/contenteditable.
        window.addEventListener('keydown', (e) => {
            if (e.key !== '`' && e.key !== '~') return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
            this._hudVisible = !this._hudVisible;
            hud.hidden = !this._hudVisible;
            hud.setAttribute('aria-hidden', String(!this._hudVisible));
        });

        const tick = (ts) => {
            if (this._hudVisible) {
                if (this._hudLastTs) {
                    const dt = ts - this._hudLastTs;
                    this._hudTimes.push(dt);
                    if (this._hudTimes.length > 60) this._hudTimes.shift();
                    const avg = this._hudTimes.reduce((a, b) => a + b, 0) / this._hudTimes.length;
                    this._hudEls.fps.textContent = (1000 / avg).toFixed(0);
                    this._hudEls.frame.textContent = avg.toFixed(1);
                }
                const imgs = this.currentState.images || [];
                this._hudEls.layers.textContent = imgs.length;
                let bytes = 0;
                for (const name in this._imageTextures) {
                    const t = this._imageTextures[name];
                    bytes += (t.width || 0) * (t.height || 0) * 4;
                }
                this._hudEls.vram.textContent = (bytes / (1024 * 1024)).toFixed(1);
                this._hudEls.build.textContent = this._lastBuildMs.toFixed(1);
            }
            this._hudLastTs = ts;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    async _addImageLayer(file) {
        if (!this.currentState.images) this.currentState.images = [];
        if (this.currentState.images.length >= MAX_LAYERS) {
            showToast(`Max ${MAX_LAYERS} image layers`, true);
            return;
        }

        // ── Resize on upload (destructive) ───────────────────────────────────
        const maxDim = this._hdUploads ? HD_MAX_DIM : STD_MAX_DIM;
        const hdMode = this._hdUploads;
        let resized;
        try {
            resized = await resizeImageFile(file, maxDim);
        } catch (err) {
            showToast('Could not load image', true);
            return;
        }
        const storeBlob = resized.blob;
        if (resized.resized) {
            showToast(`Resized ${resized.originalW}×${resized.originalH} → ${resized.width}×${resized.height} (${formatBytes(file.size)} → ${formatBytes(storeBlob.size)})`);
        }

        const texName = `userimg${Date.now().toString(36)}`;
        const imageId = generateId();

        // Persist the (resized) blob so the preset survives reloads. Fire-and-forget —
        // failure only affects cross-session loading, not the live preview.
        storeImage(imageId, storeBlob).catch(err => {
            console.warn('[Editor] storeImage failed:', err.message);
        });

        // Smart accordion: collapse every existing card before we add the new one.
        // The new card goes in expanded so user focus follows what they just dropped.
        this.currentState.images.forEach(e => { e.collapsed = true; });
        document.querySelectorAll('#image-layers .image-layer-card').forEach(c => {
            c.classList.add('collapsed');
        });

        // Full per-image control state — all values baked into GLSL on change
        const entry = {
            texName,
            imageId,
            fileName: file.name,
            opacity: 0.80,
            opacityPulse: 0.00,  // bass drives opacity up
            size: 0.25,
            spinSpeed: 0.00,
            orbitRadius: 0.00,  // orbit around screen center at 0.5 rad/s
            bounceAmp: 0.00,  // bass Y-displacement (up on beat)
            tunnelSpeed: 0.00,  // seamless zoom-through all tiles (+ = toward, - = away)
            spacing: 0.00,      // gap between tiles (0 = none, 0.8 = mostly gap)
            cx: 0.50,           // anchor point X (0=left, 1=right)
            cy: 0.50,           // anchor point Y (0=top, 1=bottom)
            swayAmt: 0.00,      // sinusoidal X oscillation amplitude
            swaySpeed: 1.00,    // sway cycles per second
            wanderAmt: 0.00,    // organic random drift amplitude
            wanderSpeed: 0.50,  // wander drift rate
            panMode: 'off',     // 'off' | 'drift' | 'bounce' — whole-group L/R + U/D translation
            panSpeedX: 0.00,    // drift: UV/sec along X (signed). bounce: cycles/sec
            panSpeedY: 0.00,    // ditto for Y
            panRange: 0.20,     // bounce only: half-amplitude in UV units
            mirror: 'none',     // 'none' | 'h' | 'v' | 'quad' | 'kaleido'
            mirrorScope: 'tile',  // 'tile' = fold inside each tile, 'field' = fold the whole tiled group
            tintR: 1.00,        // tint color red (1=white = no tint)
            tintG: 1.00,
            tintB: 1.00,
            hueSpinSpeed: 0.00, // tint hue rotation speed (cycles/sec)
            tile: true,
            blendMode: 'overlay',
            audioPulse: 0.00,  // bass drives size
            pulseInvert: false, // shrink instead of grow on beat
            groupSpin: false,   // when tile=ON: spin the whole grid instead of each tile
            collapsed: false,   // Phase 1: card collapse state
            hdMode,             // Phase 1: true if uploaded at HD (2048px) instead of Std (1024px)
            texW: resized.width,
            texH: resized.height,
            solo: false,        // Phase 4: solo-override (only soloed layers render when any solo is on)
            muted: false,       // Phase 4: hide this layer unless another layer is solo'd
            name: file.name.replace(/\.[^.]+$/, '') || 'Layer',  // Phase 4: user-editable display name
            isGif: resized.isGif || false,
            gifSpeed: 1.2,      // playback multiplier: 2 = twice as fast, 0.5 = half speed
            reactSource: 'bass',   // Phase 5: 'bass' | 'mid' | 'treb' | 'vol'
            reactCurve: 'linear',  // Phase 5: 'linear' | 'squared' | 'cubed' | 'threshold'
            orbitMode: 'circle',   // Phase 6: 'circle' | 'lissajous'
            lissFreqX: 0.50,       // Lissajous X-axis frequency (Hz)
            lissFreqY: 0.75,       // Lissajous Y-axis frequency (Hz) — 3:2 ratio default
            lissPhase: 0.25,       // Lissajous X phase offset (0–1 cycles)
            strobeAmp: 0.00,       // Phase 6: hard beat-cut intensity (0=off, 1=full black)
            strobeThr: 0.40,       // audio threshold to trigger strobe
            isHd: hdMode,          // badge shown in card header
        };
        this.currentState.images.push(entry);

        const texObj = { data: resized.dataURL, width: resized.width, height: resized.height, isGif: resized.isGif || false, gifSpeed: entry.gifSpeed };
        this._mountLayerCard(entry, texObj);
        if (!resized.resized) showToast('Image layer added');
    }

    // ─── Mount a layer card from an entry + texObj ─────────────────────────────
    // Used by both _addImageLayer (new upload) and loadPresetData (library load).

    _mountLayerCard(entry, texObj) {
        const layers = document.getElementById('image-layers');
        const card = document.createElement('div');
        card.className = 'image-layer-card';

        const shortName = (entry.fileName || '').length > 24
            ? (entry.fileName || '').slice(0, 22) + '…'
            : (entry.fileName || '');
        const pct = (v, min, max) =>
            `${(((v - min) / (max - min)) * 100).toFixed(1)}%`;

        card.innerHTML = `
          <div class="layer-header" role="button" aria-expanded="true" tabindex="0">
            <span class="layer-drag-handle" data-tooltip="Drag to reorder (↑ / ↓ while focused)"
                  tabindex="0" role="button" aria-label="Reorder layer">
              <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                <circle cx="3" cy="2"  r="1.1" fill="currentColor"/>
                <circle cx="7" cy="2"  r="1.1" fill="currentColor"/>
                <circle cx="3" cy="7"  r="1.1" fill="currentColor"/>
                <circle cx="7" cy="7"  r="1.1" fill="currentColor"/>
                <circle cx="3" cy="12" r="1.1" fill="currentColor"/>
                <circle cx="7" cy="12" r="1.1" fill="currentColor"/>
              </svg>
            </span>
            <svg class="layer-chevron" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <canvas class="layer-thumb" width="48" height="48" aria-hidden="true"></canvas>
            <div class="layer-meta">
              <div class="layer-meta-top">
                <span class="layer-index-badge" aria-hidden="true">#1</span>
                ${entry.isHd ? '<span class="layer-hd-badge" data-tooltip="Uploaded at HD (2048px). Re-upload to change.">HD</span>' : ''}
              </div>
              <input type="text" class="layer-name-input" maxlength="32" spellcheck="false"
                     aria-label="Layer name" />
            </div>
            <div class="layer-actions">
              <button class="layer-action-btn layer-solo" type="button"
                      aria-pressed="false" data-tooltip="Solo (show only this layer)">Solo</button>
              <button class="layer-action-btn layer-mute" type="button"
                      aria-pressed="false" data-tooltip="Mute (hide this layer)">Mute</button>
              <button class="layer-action-btn layer-reset" type="button"
                      data-tooltip="Reset this layer (undoable)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                </svg>
              </button>
              <button class="layer-remove" aria-label="Delete layer" data-tooltip="Delete layer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/>
                  <path d="M14 11v6"/>
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="layer-controls">
            ${entry.isGif ? `
            <p class="layer-section-label">Animation</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="GIF playback speed (0.25× to 4×). Default 1.2× — most GIFs feel a touch slow at native speed.">Speed</span>
              <input type="range" class="slider layer-gif-speed-sl" min="0.25" max="4" step="0.05"
                value="${entry.gifSpeed}" style="--pct:${pct(entry.gifSpeed, 0.25, 4)}">
              <span class="lsv layer-gif-speed-val">${entry.gifSpeed.toFixed(2)}×</span>
            </div>
            <div class="layer-section-divider"></div>
            ` : ''}
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Blend</span>
              <select class="layer-blend">
                <option value="screen">Screen</option>
                <option value="overlay" selected>Overlay</option>
                <option value="additive">Additive</option>
                <option value="multiply">Multiply</option>
              </select>
              <span class="layer-ctrl-label" style="margin-left:8px">Tile</span>
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-tile" checked />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Opacity</span>
              <input type="range" class="slider" min="0" max="1" step="0.01"
                value="${entry.opacity}" style="--pct:${pct(entry.opacity, 0, 1)}">
              <span class="lsv">${entry.opacity.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Beat Fade</span>
              <input type="range" class="slider" min="0" max="1" step="0.01"
                value="${entry.opacityPulse}" style="--pct:${pct(entry.opacityPulse, 0, 1)}">
              <span class="lsv">${entry.opacityPulse.toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="Hard opacity cut when audio crosses threshold — instant strobe flash">Strobe</span>
              <input type="range" class="slider layer-slider-inline layer-strobe-sl" min="0" max="1" step="0.01"
                value="${entry.strobeAmp}" style="--pct:${pct(entry.strobeAmp, 0, 1)}">
              <span class="lsv layer-strobe-amp-val">${entry.strobeAmp.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-strobe-thr-row"${entry.strobeAmp <= 0 ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label">Threshold</span>
              <input type="range" class="slider layer-strobe-thr-sl" min="0.1" max="0.9" step="0.05"
                value="${entry.strobeThr}" style="--pct:${pct(entry.strobeThr, 0.1, 0.9)}">
              <span class="lsv layer-strobe-thr-val">${entry.strobeThr.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Size</span>
              <input type="range" class="slider layer-size-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.size - 0.05) / 1.45).toFixed(3)}" style="--pct:${(Math.sqrt((entry.size - 0.05) / 1.45) * 100).toFixed(1)}%">
              <span class="lsv layer-size-val">${entry.size.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Spacing</span>
              <input type="range" class="slider" min="0" max="0.8" step="0.01"
                value="${entry.spacing}" style="--pct:${pct(entry.spacing, 0, 0.8)}">
              <span class="lsv">${entry.spacing.toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Pulse</span>
              <input type="range" class="slider layer-slider-inline layer-pulse-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt(entry.audioPulse / 2).toFixed(3)}" style="--pct:${(Math.sqrt(entry.audioPulse / 2) * 100).toFixed(1)}%">
              <span class="lsv layer-pulse-val">${entry.audioPulse.toFixed(2)}</span>
              <span class="layer-ctrl-label" style="margin-left:8px;width:auto" data-tooltip="Shrink on beat instead of grow">Shrink</span>
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-pulse-inv" />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Spin</span>
              <input type="range" class="slider layer-slider-inline layer-spin-sl" min="-3" max="3" step="0.05"
                value="${entry.spinSpeed}" style="--pct:${pct(entry.spinSpeed, -3, 3)}">
              <span class="lsv layer-spin-val">${entry.spinSpeed.toFixed(2)}</span>
              <span class="layer-ctrl-label" style="margin-left:8px;width:auto" data-tooltip="Rotate the whole tile grid instead of each tile">Group</span>
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-group-spin" />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Orbit</span>
              <input type="range" class="slider" min="0" max="0.45" step="0.01"
                value="${entry.orbitRadius}" style="--pct:${pct(entry.orbitRadius, 0, 0.45)}">
              <span class="lsv">${entry.orbitRadius.toFixed(2)}</span>
            </div>
            <div class="layer-row-inline layer-orbit-mode-row">
              <span class="layer-ctrl-label" data-tooltip="Circle: uniform orbit · Lissajous: figure-8 / clover paths via independent X/Y frequencies">Path</span>
              <div class="layer-orbit-mode" role="group" aria-label="Orbit path shape">
                <button class="lseg${entry.orbitMode !== 'lissajous' ? ' active' : ''}" data-orbit-mode="circle">Circle</button>
                <button class="lseg${entry.orbitMode === 'lissajous' ? ' active' : ''}" data-orbit-mode="lissajous">Lissajous</button>
              </div>
            </div>
            <div class="layer-slider-row layer-liss-row"${entry.orbitMode !== 'lissajous' ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label" data-tooltip="X-axis frequency (Hz) — try 2:3, 3:4 ratios with Freq Y">Freq X</span>
              <input type="range" class="slider layer-liss-sl layer-liss-fx-sl" min="0.25" max="4" step="0.25"
                value="${entry.lissFreqX}" style="--pct:${pct(entry.lissFreqX, 0.25, 4)}">
              <span class="lsv layer-liss-fx-val">${entry.lissFreqX.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-liss-row"${entry.orbitMode !== 'lissajous' ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label" data-tooltip="Y-axis frequency (Hz) — ratio to Freq X sets the figure shape">Freq Y</span>
              <input type="range" class="slider layer-liss-sl layer-liss-fy-sl" min="0.25" max="4" step="0.25"
                value="${entry.lissFreqY}" style="--pct:${pct(entry.lissFreqY, 0.25, 4)}">
              <span class="lsv layer-liss-fy-val">${entry.lissFreqY.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-liss-row"${entry.orbitMode !== 'lissajous' ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label" data-tooltip="Phase offset on X axis — rotates the figure">Phase</span>
              <input type="range" class="slider layer-liss-sl layer-liss-ph-sl" min="0" max="1" step="0.05"
                value="${entry.lissPhase}" style="--pct:${pct(entry.lissPhase, 0, 1)}">
              <span class="lsv layer-liss-ph-val">${entry.lissPhase.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Bounce</span>
              <input type="range" class="slider layer-bounce-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt(entry.bounceAmp / 0.4).toFixed(3)}" style="--pct:${(Math.sqrt(entry.bounceAmp / 0.4) * 100).toFixed(1)}%">
              <span class="lsv layer-bounce-val">${entry.bounceAmp.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Tunnel</span>
              <input type="range" class="slider" min="-2" max="2" step="0.05"
                value="${entry.tunnelSpeed}" style="--pct:${pct(entry.tunnelSpeed, -2, 2)}">
              <span class="lsv">${entry.tunnelSpeed.toFixed(2)}</span>
            </div>
            <div class="layer-center-row">
              <span class="layer-ctrl-label" style="margin-bottom:5px">Center</span>
              <div class="xy-pad-wrap">
                <canvas class="xy-pad" width="96" height="96" data-tooltip="Drag to set anchor point"></canvas>
                <button class="xy-reset" data-tooltip="Reset to center">↺</button>
              </div>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Sway</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Amount</span>
              <input type="range" class="slider" min="0" max="0.4" step="0.01"
                value="${entry.swayAmt}" style="--pct:${pct(entry.swayAmt, 0, 0.4)}">
              <span class="lsv">${entry.swayAmt.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Speed</span>
              <input type="range" class="slider" min="0" max="4" step="0.05"
                value="${entry.swaySpeed}" style="--pct:${pct(entry.swaySpeed, 0, 4)}">
              <span class="lsv">${entry.swaySpeed.toFixed(2)}</span>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Wander</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Amount</span>
              <input type="range" class="slider" min="0" max="0.4" step="0.01"
                value="${entry.wanderAmt}" style="--pct:${pct(entry.wanderAmt, 0, 0.4)}">
              <span class="lsv">${entry.wanderAmt.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Speed</span>
              <input type="range" class="slider" min="0" max="2" step="0.02"
                value="${entry.wanderSpeed}" style="--pct:${pct(entry.wanderSpeed, 0, 2)}">
              <span class="lsv">${entry.wanderSpeed.toFixed(2)}</span>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label" data-tooltip="Whole-group L/R + U/D translation. Drift = continuous travel (pairs with Tile ON for endless scroll). Bounce = ping-pong around anchor.">Pan</p>
            <div class="layer-row-inline layer-pan-mode-row">
              <span class="layer-ctrl-label">Mode</span>
              <div class="layer-pan-mode" role="group" aria-label="Pan mode">
                <button class="lseg${(entry.panMode || 'off') === 'off' ? ' active' : ''}" data-pan-mode="off">Off</button>
                <button class="lseg${entry.panMode === 'drift' ? ' active' : ''}" data-pan-mode="drift">Drift</button>
                <button class="lseg${entry.panMode === 'bounce' ? ' active' : ''}" data-pan-mode="bounce">Bounce</button>
              </div>
            </div>
            <div class="layer-pan-pad-wrap layer-pan-row"${(entry.panMode || 'off') === 'off' ? ' style="display:none"' : ''}>
              <canvas class="pan-pad" width="96" height="96" data-tooltip="Drag to set direction &amp; speed — distance from center = speed"></canvas>
              <button class="xy-reset pan-pad-reset" data-tooltip="Reset to stopped">↺</button>
              <span class="pan-pad-readout">${entry.panSpeedX.toFixed(2)} / ${entry.panSpeedY.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-pan-range-row"${entry.panMode !== 'bounce' ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label">Range</span>
              <input type="range" class="slider layer-pan-range-sl" min="0" max="1" step="0.01"
                value="${entry.panRange}" style="--pct:${pct(entry.panRange, 0, 1)}">
              <span class="lsv layer-pan-range-val">${entry.panRange.toFixed(2)}</span>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Mirror <span class="lseg-status">Off</span></p>
            <div class="layer-mirror-seg" role="group">
              <button class="lseg active" data-mirror="none">Off</button>
              <button class="lseg" data-mirror="h">↔ H</button>
              <button class="lseg" data-mirror="v">↕ V</button>
              <button class="lseg" data-mirror="quad">⊞ Quad</button>
              <button class="lseg" data-mirror="kaleido">✦ Kaleido</button>
            </div>
            <div class="layer-mirror-scope" role="group" aria-label="Mirror scope" hidden>
              <button class="lseg lseg-scope active" data-scope="tile" data-tooltip="Fold inside each tile">Per Tile</button>
              <button class="lseg lseg-scope" data-scope="field" data-tooltip="Fold the whole tiled group">Whole Image</button>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Tint</p>
            <div class="layer-row-inline" style="gap:8px;margin-bottom:6px">
              <span class="layer-ctrl-label">Color</span>
              <div class="layer-tint-wrap">
                <span class="layer-tint-swatch" style="background:#ffffff"></span>
                <input type="color" class="layer-tint-picker" value="#ffffff" tabindex="-1" />
              </div>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Hue Spin</span>
              <input type="range" class="slider" min="0" max="2" step="0.02"
                value="${entry.hueSpinSpeed}" style="--pct:${pct(entry.hueSpinSpeed, 0, 2)}">
              <span class="lsv">${entry.hueSpinSpeed.toFixed(2)}</span>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Audio Reactivity</p>
            <p class="layer-section-sub">Source &amp; Curve shape the audio signal that powers all sound-driven animation on this layer.</p>
            <p class="layer-section-sub" style="margin-top:-3px;margin-bottom:8px;color:var(--text-2)">↳ Pulse · Bounce · Beat Fade · Strobe</p>
            <div class="layer-row-inline" style="gap:8px;margin-bottom:6px">
              <span class="layer-ctrl-label" data-tooltip="Which frequency band drives this layer — Bass = kicks, Mid = melody/snare, Treble = hi-hats, Volume = overall mix loudness">Source</span>
              <select class="layer-react-source">
                <option value="bass" selected>Bass</option>
                <option value="mid">Mid</option>
                <option value="treb">Treble</option>
                <option value="vol">Volume</option>
              </select>
            </div>
            <div class="layer-row-inline" style="gap:8px;margin-bottom:4px">
              <span class="layer-ctrl-label" data-tooltip="How the signal is shaped before reaching controls — Squared suppresses quiet hits, Cubed reserves reaction for the very loudest peaks, Gate flips binary on/off at 30%">Curve</span>
              <div class="layer-react-curve" role="group" aria-label="Reactivity curve">
                <button class="lseg active" data-curve="linear">Linear</button>
                <button class="lseg" data-curve="squared">Squared</button>
                <button class="lseg" data-curve="cubed">Cubed</button>
                <button class="lseg" data-curve="threshold">Gate</button>
              </div>
            </div>
          </div>
        `;

        // Populate the editable name input (value-set is safe — no innerHTML path)
        const nameInput = card.querySelector('.layer-name-input');
        nameInput.value = entry.name;
        nameInput.title = `Filename: ${entry.fileName || ''}`;

        // ── Wire controls ───────────────────────────────────────────────────
        const refresh = () => { this._buildCompShader(); this._applyToEngine(); };

        const blendSel = card.querySelector('.layer-blend');
        const tileCb = card.querySelector('.layer-tile');
        const pulseInvCb = card.querySelector('.layer-pulse-inv');

        const groupSpinCb = card.querySelector('.layer-group-spin');

        blendSel.addEventListener('change', () => { entry.blendMode = blendSel.value; refresh(); });
        tileCb.addEventListener('change', () => { entry.tile = tileCb.checked; refresh(); });
        pulseInvCb.addEventListener('change', () => { entry.pulseInvert = pulseInvCb.checked; refresh(); });
        groupSpinCb.addEventListener('change', () => { entry.groupSpin = groupSpinCb.checked; refresh(); });

        // Spin inline slider
        const spinSlider = card.querySelector('.layer-spin-sl');
        const spinVal = card.querySelector('.layer-spin-val');
        spinSlider.addEventListener('input', () => {
            const v = parseFloat(spinSlider.value);
            entry.spinSpeed = v;
            spinVal.textContent = v.toFixed(2);
            spinSlider.style.setProperty('--pct', `${(((v - -3) / 6) * 100).toFixed(1)}%`);
            refresh();
        });

        // Pulse inline slider — squared curve for more subtle range at low end
        const pulseSlider = card.querySelector('.layer-pulse-sl');
        const pulseVal = card.querySelector('.layer-pulse-val');
        pulseSlider.addEventListener('input', () => {
            const pos = parseFloat(pulseSlider.value);
            const stored = pos * pos * 2;
            entry.audioPulse = stored;
            pulseVal.textContent = stored.toFixed(2);
            pulseSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Bounce slider — squared curve for more subtle range at low end
        const bounceSlider = card.querySelector('.layer-bounce-sl');
        const bounceVal = card.querySelector('.layer-bounce-val');
        bounceSlider.addEventListener('input', () => {
            const pos = parseFloat(bounceSlider.value);
            const stored = pos * pos * 0.4;
            entry.bounceAmp = stored;
            bounceVal.textContent = stored.toFixed(2);
            bounceSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Size slider — squared curve so value 1.0 lands near ~82% of travel
        const sizeSlider = card.querySelector('.layer-size-sl');
        const sizeVal = card.querySelector('.layer-size-val');
        sizeSlider.addEventListener('input', () => {
            const pos = parseFloat(sizeSlider.value);
            const stored = 0.05 + 1.45 * pos * pos;
            entry.size = stored;
            sizeVal.textContent = stored.toFixed(2);
            sizeSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Remaining slider rows — DOM order must match sliderKeys exactly:
        // opacity, opacityPulse, spacing, orbitRadius, tunnelSpeed,
        // swayAmt, swaySpeed, wanderAmt, wanderSpeed, hueSpinSpeed
        const sliderKeys = ['opacity', 'opacityPulse', 'spacing', 'orbitRadius', 'tunnelSpeed',
            'swayAmt', 'swaySpeed', 'wanderAmt', 'wanderSpeed', 'hueSpinSpeed'];
        const sliderMins = [0, 0, 0, 0, -2, 0, 0, 0, 0, 0];
        const sliderMaxes = [1, 1, 0.8, 0.45, 2, 0.4, 4, 0.4, 2, 2];

        card.querySelectorAll('.layer-slider-row input[type=range]:not(.layer-bounce-sl):not(.layer-size-sl):not(.layer-liss-sl):not(.layer-strobe-thr-sl):not(.layer-pan-x-sl):not(.layer-pan-y-sl):not(.layer-pan-range-sl)').forEach((sl, i) => {
            const valEl = sl.nextElementSibling;
            sl.addEventListener('input', () => {
                const v = parseFloat(sl.value);
                entry[sliderKeys[i]] = v;
                valEl.textContent = v.toFixed(2);
                sl.style.setProperty('--pct',
                    `${((v - sliderMins[i]) / (sliderMaxes[i] - sliderMins[i]) * 100).toFixed(1)}%`);
                refresh();
            });
        });

        // Mirror segmented controls — updates entry.mirror + entry.mirrorScope,
        // plus a live label readout and auto show/hide of the scope toggle.
        const mirrorStatus = card.querySelector('.lseg-status');
        const scopeRow = card.querySelector('.layer-mirror-scope');
        const mirrorLabels = { none: 'Off', h: 'H', v: 'V', quad: 'Quad', kaleido: 'Kaleido' };
        const scopeLabels = { tile: 'Per Tile', field: 'Whole Image' };
        const updateStatus = () => {
            if (!mirrorStatus) return;
            const m = mirrorLabels[entry.mirror] || 'Off';
            if (entry.mirror === 'none') mirrorStatus.textContent = 'Off';
            else mirrorStatus.textContent = `${m} · ${scopeLabels[entry.mirrorScope || 'tile']}`;
            if (scopeRow) scopeRow.hidden = entry.mirror === 'none';
        };
        card.querySelectorAll('.layer-mirror-seg .lseg').forEach(btn => {
            btn.addEventListener('click', () => {
                card.querySelectorAll('.layer-mirror-seg .lseg').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.mirror = btn.dataset.mirror;
                updateStatus();
                refresh();
            });
        });
        card.querySelectorAll('.lseg-scope').forEach(btn => {
            btn.addEventListener('click', () => {
                card.querySelectorAll('.lseg-scope').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.mirrorScope = btn.dataset.scope;
                updateStatus();
                refresh();
            });
        });

        // GIF speed slider (only present for animated GIF layers)
        if (entry.isGif) {
            const gifSpeedSl = card.querySelector('.layer-gif-speed-sl');
            const gifSpeedVal = card.querySelector('.layer-gif-speed-val');
            if (gifSpeedSl) {
                gifSpeedSl.addEventListener('input', () => {
                    const v = parseFloat(gifSpeedSl.value);
                    entry.gifSpeed = v;
                    gifSpeedVal.textContent = `${v.toFixed(2)}×`;
                    gifSpeedSl.style.setProperty('--pct', `${pct(v, 0.25, 4)}`);
                    this.engine.setGifAnimationSpeed(entry.texName, v);
                });
            }
        }

        // Tint color swatch
        const tintSwatch = card.querySelector('.layer-tint-swatch');
        const tintPicker = card.querySelector('.layer-tint-picker');
        const rgbToHexLocal = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
        tintSwatch.addEventListener('click', () => tintPicker.click());
        tintPicker.addEventListener('input', () => {
            const hex = tintPicker.value;
            entry.tintR = parseInt(hex.slice(1, 3), 16) / 255;
            entry.tintG = parseInt(hex.slice(3, 5), 16) / 255;
            entry.tintB = parseInt(hex.slice(5, 7), 16) / 255;
            tintSwatch.style.background = hex;
            refresh();
        });

        // Reactivity section — Phase 5
        const reactSrcSel = card.querySelector('.layer-react-source');
        reactSrcSel.value = entry.reactSource || 'bass';
        reactSrcSel.addEventListener('change', () => { entry.reactSource = reactSrcSel.value; refresh(); });

        const curveBtns = card.querySelectorAll('.layer-react-curve .lseg');
        curveBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curve === (entry.reactCurve || 'linear'));
            btn.addEventListener('click', () => {
                curveBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.reactCurve = btn.dataset.curve;
                refresh();
            });
        });

        // Phase 6: Strobe
        const strobeSlider = card.querySelector('.layer-strobe-sl');
        const strobeAmpVal = card.querySelector('.layer-strobe-amp-val');
        const strobeThrRow = card.querySelector('.layer-strobe-thr-row');
        const strobeThrSl = card.querySelector('.layer-strobe-thr-sl');
        const strobeThrVal = card.querySelector('.layer-strobe-thr-val');
        strobeSlider.addEventListener('input', () => {
            entry.strobeAmp = parseFloat(strobeSlider.value);
            strobeAmpVal.textContent = entry.strobeAmp.toFixed(2);
            strobeSlider.style.setProperty('--pct', `${pct(entry.strobeAmp, 0, 1)}`);
            strobeThrRow.style.display = entry.strobeAmp > 0 ? '' : 'none';
            console.log('[STROBE]', { strobeAmp: entry.strobeAmp, opacity: entry.opacity });
            refresh();
        });
        strobeThrSl.addEventListener('input', () => {
            entry.strobeThr = parseFloat(strobeThrSl.value);
            strobeThrVal.textContent = entry.strobeThr.toFixed(2);
            strobeThrSl.style.setProperty('--pct', `${pct(entry.strobeThr, 0.1, 0.9)}`);
            refresh();
        });

        // Phase 6: Lissajous orbit mode
        const orbitModeBtns = card.querySelectorAll('.layer-orbit-mode .lseg');
        const lissRows = card.querySelectorAll('.layer-liss-row');
        orbitModeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                orbitModeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.orbitMode = btn.dataset.orbitMode;
                lissRows.forEach(r => { r.style.display = entry.orbitMode === 'lissajous' ? '' : 'none'; });
                refresh();
            });
        });
        const lissFxSl = card.querySelector('.layer-liss-fx-sl');
        const lissFxVal = card.querySelector('.layer-liss-fx-val');
        lissFxSl.addEventListener('input', () => {
            entry.lissFreqX = parseFloat(lissFxSl.value);
            lissFxVal.textContent = entry.lissFreqX.toFixed(2);
            lissFxSl.style.setProperty('--pct', `${pct(entry.lissFreqX, 0.25, 4)}`);
            refresh();
        });
        const lissFySl = card.querySelector('.layer-liss-fy-sl');
        const lissFyVal = card.querySelector('.layer-liss-fy-val');
        lissFySl.addEventListener('input', () => {
            entry.lissFreqY = parseFloat(lissFySl.value);
            lissFyVal.textContent = entry.lissFreqY.toFixed(2);
            lissFySl.style.setProperty('--pct', `${pct(entry.lissFreqY, 0.25, 4)}`);
            refresh();
        });
        const lissPhSl = card.querySelector('.layer-liss-ph-sl');
        const lissPhVal = card.querySelector('.layer-liss-ph-val');
        lissPhSl.addEventListener('input', () => {
            entry.lissPhase = parseFloat(lissPhSl.value);
            lissPhVal.textContent = entry.lissPhase.toFixed(2);
            lissPhSl.style.setProperty('--pct', `${pct(entry.lissPhase, 0, 1)}`);
            refresh();
        });

        // Pan — whole-group L/R + U/D translation
        const panModeBtns = card.querySelectorAll('.layer-pan-mode .lseg');
        const panRows = card.querySelectorAll('.layer-pan-row');
        const panRangeRow = card.querySelector('.layer-pan-range-row');
        const updatePanVisibility = () => {
            const m = entry.panMode || 'off';
            panRows.forEach(r => { r.style.display = m === 'off' ? 'none' : ''; });
            panRangeRow.style.display = m === 'bounce' ? '' : 'none';
        };
        panModeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                panModeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.panMode = btn.dataset.panMode;
                updatePanVisibility();
                refresh();
            });
        });
        // Pan joystick pad — center = stopped, direction = pan dir, distance = speed (max ±2)
        // Power curve (^2) on input gives 4× more physical travel in the slow/medium range.
        // Forward:  t ∈ [-1,1] (normalized pad pos) → speed = sign(t) * t² * PAN_MAX
        // Inverse:  speed → t = sign(speed) * sqrt(|speed| / PAN_MAX)  (for dot placement)
        const panPad = card.querySelector('.pan-pad');
        const panPadReset = card.querySelector('.pan-pad-reset');
        const panPadReadout = card.querySelector('.pan-pad-readout');
        const panPadCtx = panPad.getContext('2d');
        const PAN_PAD = 96;
        const PAN_MAX = 2.0;
        const panCurve    = (t) => Math.sign(t) * t * t * PAN_MAX;          // pos → speed
        const panCurveInv = (s) => { const f = s / PAN_MAX; return Math.sign(f) * Math.sqrt(Math.abs(f)); }; // speed → pos

        const drawPanPad = () => {
            panPadCtx.clearRect(0, 0, PAN_PAD, PAN_PAD);
            // background
            panPadCtx.fillStyle = 'rgba(255,255,255,0.04)';
            panPadCtx.beginPath();
            panPadCtx.roundRect(0, 0, PAN_PAD, PAN_PAD, 4);
            panPadCtx.fill();
            // speed rings at 33% and 66% radius
            const cx = PAN_PAD / 2, cy = PAN_PAD / 2;
            panPadCtx.strokeStyle = 'rgba(255,255,255,0.07)';
            panPadCtx.lineWidth = 1;
            [0.33, 0.66].forEach(r => {
                panPadCtx.beginPath();
                panPadCtx.arc(cx, cy, r * PAN_PAD / 2, 0, Math.PI * 2);
                panPadCtx.stroke();
            });
            // crosshair
            panPadCtx.strokeStyle = 'rgba(255,255,255,0.10)';
            panPadCtx.beginPath(); panPadCtx.moveTo(cx, 0); panPadCtx.lineTo(cx, PAN_PAD); panPadCtx.stroke();
            panPadCtx.beginPath(); panPadCtx.moveTo(0, cy); panPadCtx.lineTo(PAN_PAD, cy); panPadCtx.stroke();
            // border
            panPadCtx.strokeStyle = 'rgba(255,255,255,0.10)';
            panPadCtx.strokeRect(0.5, 0.5, PAN_PAD - 1, PAN_PAD - 1);
            // dot — inverse curve maps stored speed back to physical pad position
            const tx = panCurveInv(entry.panSpeedX);
            const ty = panCurveInv(entry.panSpeedY);
            const dx = cx + tx * (PAN_PAD / 2);
            const dy = cy + ty * (PAN_PAD / 2);
            panPadCtx.beginPath();
            panPadCtx.arc(dx, dy, 5, 0, Math.PI * 2);
            panPadCtx.fillStyle = '#ffffff';
            panPadCtx.fill();
            panPadCtx.strokeStyle = 'rgba(0,0,0,0.5)';
            panPadCtx.lineWidth = 1.5;
            panPadCtx.stroke();
        };
        drawPanPad();

        const onPanPadMove = (e) => {
            const rect = panPad.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const tx = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width  - 0.5) * 2));
            const ty = Math.max(-1, Math.min(1, ((clientY - rect.top)  / rect.height - 0.5) * 2));
            entry.panSpeedX = panCurve(tx);
            entry.panSpeedY = panCurve(ty);
            panPadReadout.textContent = `${entry.panSpeedX.toFixed(2)} / ${entry.panSpeedY.toFixed(2)}`;
            drawPanPad();
            refresh();
        };
        let draggingPanPad = false;
        panPad.addEventListener('mousedown', (e) => { draggingPanPad = true; onPanPadMove(e); });
        panPad.addEventListener('touchstart', (e) => { draggingPanPad = true; onPanPadMove(e); e.preventDefault(); }, { passive: false });
        window.addEventListener('mousemove', (e) => { if (draggingPanPad) onPanPadMove(e); });
        window.addEventListener('mouseup', () => { draggingPanPad = false; });
        window.addEventListener('touchmove', (e) => { if (draggingPanPad) onPanPadMove(e); }, { passive: true });
        window.addEventListener('touchend', () => { draggingPanPad = false; });
        panPadReset.addEventListener('click', () => {
            entry.panSpeedX = 0; entry.panSpeedY = 0;
            panPadReadout.textContent = '0.00 / 0.00';
            drawPanPad(); refresh();
        });

        const panRangeSl = card.querySelector('.layer-pan-range-sl');
        const panRangeVal = card.querySelector('.layer-pan-range-val');
        panRangeSl.addEventListener('input', () => {
            entry.panRange = parseFloat(panRangeSl.value);
            panRangeVal.textContent = entry.panRange.toFixed(2);
            panRangeSl.style.setProperty('--pct', `${pct(entry.panRange, 0, 1)}`);
            refresh();
        });

        // XY Pad — anchor / center point
        const xyPad = card.querySelector('.xy-pad');
        const xyReset = card.querySelector('.xy-reset');
        const xyCtx = xyPad.getContext('2d');
        const PAD = 96;

        const drawPad = () => {
            xyCtx.clearRect(0, 0, PAD, PAD);
            // background
            xyCtx.fillStyle = 'rgba(255,255,255,0.04)';
            xyCtx.beginPath();
            xyCtx.roundRect(0, 0, PAD, PAD, 4);
            xyCtx.fill();
            // crosshair
            xyCtx.strokeStyle = 'rgba(255,255,255,0.10)';
            xyCtx.lineWidth = 1;
            xyCtx.beginPath(); xyCtx.moveTo(PAD / 2, 0); xyCtx.lineTo(PAD / 2, PAD); xyCtx.stroke();
            xyCtx.beginPath(); xyCtx.moveTo(0, PAD / 2); xyCtx.lineTo(PAD, PAD / 2); xyCtx.stroke();
            // border
            xyCtx.strokeStyle = 'rgba(255,255,255,0.10)';
            xyCtx.strokeRect(0.5, 0.5, PAD - 1, PAD - 1);
            // dot
            const dx = entry.cx * PAD;
            const dy = entry.cy * PAD;
            xyCtx.beginPath();
            xyCtx.arc(dx, dy, 5, 0, Math.PI * 2);
            xyCtx.fillStyle = '#ffffff';
            xyCtx.fill();
            xyCtx.strokeStyle = 'rgba(0,0,0,0.5)';
            xyCtx.lineWidth = 1.5;
            xyCtx.stroke();
        };
        drawPad();

        const onPadMove = (e) => {
            const rect = xyPad.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            entry.cx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            entry.cy = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
            drawPad();
            refresh();
        };
        let draggingPad = false;
        xyPad.addEventListener('mousedown', (e) => { draggingPad = true; onPadMove(e); });
        xyPad.addEventListener('touchstart', (e) => { draggingPad = true; onPadMove(e); e.preventDefault(); }, { passive: false });
        window.addEventListener('mousemove', (e) => { if (draggingPad) onPadMove(e); });
        window.addEventListener('mouseup', () => { draggingPad = false; });
        window.addEventListener('touchmove', (e) => { if (draggingPad) onPadMove(e); }, { passive: true });
        window.addEventListener('touchend', () => { draggingPad = false; });
        xyReset.addEventListener('click', () => { entry.cx = 0.5; entry.cy = 0.5; drawPad(); refresh(); });

        const removeBtn = card.querySelector('.layer-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();   // don't trigger header toggle
            this._confirmDeleteLayer(entry, card, entry.texName);
        });

        // Collapse / expand via the whole header strip (but not the drag handle / delete)
        const header = card.querySelector('.layer-header');
        const toggleCollapse = () => {
            entry.collapsed = !entry.collapsed;
            card.classList.toggle('collapsed', entry.collapsed);
            header.setAttribute('aria-expanded', String(!entry.collapsed));
        };
        header.addEventListener('click', (e) => {
            if (e.target.closest('.layer-remove')) return;
            if (e.target.closest('.layer-drag-handle')) return;
            toggleCollapse();
        });
        header.addEventListener('keydown', (e) => {
            if (e.target.closest('.layer-drag-handle')) return;  // handle manages its own keys
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(); }
        });

        // ── Phase 2: drag-to-reorder (handle-only initiator) ─────────────────
        card.dataset.texName = entry.texName;  // lets _reorderImage resync DOM → array
        const dragHandle = card.querySelector('.layer-drag-handle');
        this._wireDragReorder(card, entry, dragHandle);

        // ── Phase 4: inline name edit ────────────────────────────────────────
        // Stop clicks on the input from toggling collapse. Commit on Enter/blur,
        // cancel on Escape. preSnap/postSnap make rename undoable.
        nameInput.addEventListener('click', (e) => e.stopPropagation());
        nameInput.addEventListener('keydown', (e) => e.stopPropagation());
        let nameBeforeEdit = entry.name;
        nameInput.addEventListener('focus', () => { nameBeforeEdit = entry.name; });
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); nameInput.value = nameBeforeEdit; nameInput.blur(); }
        });
        nameInput.addEventListener('blur', () => {
            const v = nameInput.value.trim() || 'Layer';
            nameInput.value = v;
            if (v === nameBeforeEdit) return;
            this._preSnap();
            entry.name = v;
            this._postSnap();
        });

        // ── Phase 4: Solo / Mute / Reset ─────────────────────────────────────
        const soloBtn = card.querySelector('.layer-solo');
        const muteBtn = card.querySelector('.layer-mute');
        const resetBtn = card.querySelector('.layer-reset');

        const syncSoloMute = () => {
            soloBtn.classList.toggle('active', !!entry.solo);
            soloBtn.setAttribute('aria-pressed', String(!!entry.solo));
            muteBtn.classList.toggle('active', !!entry.muted);
            muteBtn.setAttribute('aria-pressed', String(!!entry.muted));
            card.classList.toggle('layer-muted', !!entry.muted);
            card.classList.toggle('layer-soloed', !!entry.solo);
        };
        syncSoloMute();

        soloBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._preSnap();
            entry.solo = !entry.solo;
            this._postSnap();
            syncSoloMute();
            refresh();
        });
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._preSnap();
            entry.muted = !entry.muted;
            this._postSnap();
            syncSoloMute();
            refresh();
        });
        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._resetImageLayer(entry, card);
        });

        layers.appendChild(card);
        this._updateLayersBar();
        this._updateLayerIndices();

        this._imageTextures[entry.texName] = texObj;
        this.engine.setUserTexture(entry.texName, texObj);
        this._buildCompShader();
        this._applyToEngine();

        // Render the static thumbnail into the header canvas (letterboxed).
        const thumbCanvas = card.querySelector('.layer-thumb');
        if (thumbCanvas) {
            const thumbImg = new Image();
            thumbImg.onload = () => {
                const ctx = thumbCanvas.getContext('2d');
                const W = thumbCanvas.width, H = thumbCanvas.height;
                ctx.fillStyle = '#0a0a0a';
                ctx.fillRect(0, 0, W, H);
                const srcAR = thumbImg.naturalWidth / thumbImg.naturalHeight;
                const dstAR = W / H;
                let dw, dh, dx, dy;
                if (srcAR > dstAR) { dw = W; dh = W / srcAR; dx = 0; dy = (H - dh) / 2; }
                else { dh = H; dw = H * srcAR; dy = 0; dx = (W - dw) / 2; }
                ctx.drawImage(thumbImg, dx, dy, dw, dh);
            };
            thumbImg.src = texObj.data;
            thumbCanvas.setAttribute('data-tooltip', entry.fileName || '');
        }
        if (entry.collapsed) {
            card.classList.add('collapsed');
            card.querySelector('.layer-header')?.setAttribute('aria-expanded', 'false');
        }
    }

    // ─── Phase 4: reset a single layer to defaults ─────────────────────────────

    /**
     * Reset a layer: remove it and re-add the same image from its cached
     * texture blob. Re-addition goes through _addImageLayer, which builds a
     * fresh card with every control at default values. Preserves the user's
     * chosen name; the array position is restored after the async re-add.
     */
    async _resetImageLayer(entry, card) {
        const texObj = this._imageTextures[entry.texName];
        if (!texObj) return;
        this._preSnap();
        const origIdx = this.currentState.images.indexOf(entry);
        const origName = entry.name;
        const origHdMode = !!entry.hdMode;
        const origFileName = entry.fileName || 'image';

        // Remove the old entry + card + texture binding
        if (origIdx !== -1) this.currentState.images.splice(origIdx, 1);
        delete this._imageTextures[entry.texName];
        card.remove();

        // Convert the cached dataURL back to a File so _addImageLayer's existing
        // flow works unchanged. Skip the resize toast by forcing HD mode to match
        // whatever it was — texObj is already at the right size, so resize is a no-op.
        const savedHd = this._hdUploads;
        this._hdUploads = origHdMode;
        try {
            const resp = await fetch(texObj.data);
            const blob = await resp.blob();
            const file = new File([blob], origFileName, { type: blob.type || 'image/png' });
            await this._addImageLayer(file);
        } finally {
            this._hdUploads = savedHd;
        }

        // The new entry is at the end of the array — move it back to original index
        // and restore the user-chosen name.
        const arr = this.currentState.images;
        const newEntry = arr[arr.length - 1];
        if (newEntry && origIdx !== -1 && origIdx < arr.length - 1) {
            arr.pop();
            arr.splice(origIdx, 0, newEntry);
        }
        if (newEntry) {
            newEntry.name = origName;
            // Sync the input value in the freshly-built card
            const newCard = document.querySelector(`.image-layer-card[data-tex-name="${newEntry.texName}"]`);
            const input = newCard?.querySelector('.layer-name-input');
            if (input) input.value = origName;
            // Resync DOM order to match array
            const layers = document.getElementById('image-layers');
            const byTex = new Map();
            layers.querySelectorAll('.image-layer-card').forEach(c => byTex.set(c.dataset.texName, c));
            arr.forEach(e => {
                const c = byTex.get(e.texName);
                if (c) layers.appendChild(c);
            });
        }

        this._updateLayerIndices();
        this._buildCompShader();
        this._applyToEngine();
        this._postSnap();
        showToast(`Reset "${origName}"`);
    }

    // ─── Apply & sync ──────────────────────────────────────────────────────────

    _applyToEngine() {
        this._buildCompShader();
        this.engine.loadPresetObject(this.currentState, 0);
        for (const [name, texObj] of Object.entries(this._imageTextures)) {
            this.engine.setUserTexture(name, texObj);
        }
        this.onchange?.();
    }

    /**
     * Rebuild currentState.comp to include sampler uniforms + per-image
     * animated GLSL (spin, scale, tile, audio pulse, blend mode).
     * All per-image parameters are baked as float literals so no custom
     * uniforms are needed — only the standard butterchurn comp uniforms
     * (time, bass, aspect, uv, ret, sampler_main) are used.
     */
    _buildCompShader() {
        const _t0 = performance.now();
        const images = this.currentState.images || [];
        const sm = this.currentState.sceneMirror || 'none';
        // Phase 4: solo / mute filter. If any layer is soloed, only soloed
        // layers render; otherwise everything except muted layers renders.
        const anySolo = images.some(img => img.solo);
        const visibleImages = anySolo
            ? images.filter(img => img.solo)
            : images.filter(img => !img.muted);
        if (visibleImages.length === 0 && !this._solidColor && sm === 'none') {
            this.currentState.comp = BLANK_COMP;
            this._lastBuildMs = performance.now() - _t0;
            return;
        }
        const uniforms = visibleImages
            .map(img => `uniform sampler2D sampler_${img.texName};`)
            .join('\n');

        // UV fold for canvas mirror — always declare uv_m as a local alias so
        // both sampler_main and image layer _u = uv_m - center use it.
        // We CANNOT redeclare `uv` because the comp shader already has
        //   vec2 uv = vUv;
        // in main() at the same scope level.
        let uvFold;
        if (sm === 'h') {
            uvFold = '  vec2 uv_m = vec2(1.0 - abs(uv.x * 2.0 - 1.0), uv.y);\n';
        } else if (sm === 'v') {
            uvFold = '  vec2 uv_m = vec2(uv.x, 1.0 - abs(uv.y * 2.0 - 1.0));\n';
        } else if (sm === 'both') {
            uvFold = '  vec2 uv_m = vec2(1.0 - abs(uv.x * 2.0 - 1.0), 1.0 - abs(uv.y * 2.0 - 1.0));\n';
        } else {
            uvFold = '  vec2 uv_m = uv;\n';
        }
        const mainSample = 'texture(sampler_main, uv_m).xyz * 2.0';

        let base;
        if (this._imagesOnly) {
            base = uvFold + '  vec3 col = vec3(0.0);\n';
        } else if (this._solidColor) {
            const bv = this.currentState.baseVals;
            const aR = (bv.wave_r ?? this._solidColor[0]).toFixed(4);
            const aG = (bv.wave_g ?? this._solidColor[1]).toFixed(4);
            const aB = (bv.wave_b ?? this._solidColor[2]).toFixed(4);
            const cb = this.currentState.solidColorB || [0, 0, 0];
            const bR = Number(cb[0]).toFixed(4);
            const bG = Number(cb[1]).toFixed(4);
            const bB = Number(cb[2]).toFixed(4);
            const pulse = Number(this.currentState.solidPulse || 0).toFixed(4);
            const breath = Number(this.currentState.solidBreath || 0).toFixed(4);
            const shift = Number(this.currentState.solidShift || 0).toFixed(4);
            // Breath: lerp between 1.0 (off) and a slow sine (0..1) by breath amount.
            // Pulse:  multiplies brightness by (1 + bass * pulse).
            // Shift:  mixes A→B by bass_att * shift, clamped 0..1. bass_att is the
            //         attack-smoothed bass — feels like a beat, not a wobble.
            base = uvFold +
                `  float _breath = mix(1.0, 0.5 + 0.5 * sin(time * 0.6), ${breath});\n` +
                `  float _pulse = 1.0 + bass * ${pulse};\n` +
                `  float _shiftT = clamp(bass_att * ${shift}, 0.0, 1.0);\n` +
                `  vec3 _colA = vec3(${aR}, ${aG}, ${aB});\n` +
                `  vec3 _colB = vec3(${bR}, ${bG}, ${bB});\n` +
                `  vec3 col = mix(_colA, _colB, _shiftT) * _breath * _pulse;\n`;
        } else {
            base = uvFold + `  vec3 col = ${mainSample};\n`;
        }
        let body = base;
        for (const img of visibleImages) {
            body += this._buildImageBlock(img);
        }
        body += '  ret = col;\n';
        this.currentState.comp = `${uniforms}\n shader_body {\n${body} }`;
        this._lastBuildMs = performance.now() - _t0;
    }

    /**
     * Generate a GLSL block for one image layer.
     *
     * Angle logic:
     *   - _orbAng = time * 0.5  (orbit always at a steady 0.5 rad/s, independent of spin)
     *   - _spinAng = time * sp  (in-place or per-tile rotation at spinSpeed)
     *
     * Tile spin:    when tile=ON + spin≠0 → each tile rotates around its OWN centre.
     * Tunnel:       when tile=ON + tunnelSpeed≠0 → seamless infinite zoom through all tiles.
     *               positive speed = forward (tiles grow), negative = backward (tiles shrink).
     *               Uses pow(2, fract(t*s)) so snap-back is invisible (tiles repeat at 2× scale).
     * Non-tile:     whole-field spin (original behaviour).
     * Orbit:        image centre follows a circular path even when spin=0.
     * Bounce:       bass pushes the image upward on every beat.
     */
    _buildImageBlock(img) {
        const sz = img.size.toFixed(4);
        const sp = img.spinSpeed.toFixed(4);
        const op = img.opacity.toFixed(4);
        const pu = img.audioPulse.toFixed(4);
        const opa = (img.opacityPulse || 0).toFixed(4);
        const orb = (img.orbitRadius || 0).toFixed(4);
        const bnc = (img.bounceAmp || 0).toFixed(4);
        const ts = Math.abs(img.tunnelSpeed || 0).toFixed(4);
        const spc = (img.spacing || 0).toFixed(4);
        const cx = (img.cx !== undefined ? img.cx : 0.5).toFixed(4);
        const cy = (img.cy !== undefined ? img.cy : 0.5).toFixed(4);
        const swayAmt = (img.swayAmt || 0).toFixed(4);
        const swaySpd = (img.swaySpeed !== undefined ? img.swaySpeed : 1.0).toFixed(4);
        const wanderAmt = (img.wanderAmt || 0).toFixed(4);
        const wanderSpd = (img.wanderSpeed !== undefined ? img.wanderSpeed : 0.5).toFixed(4);
        const panMode = img.panMode || 'off';
        const panSx = (img.panSpeedX || 0).toFixed(4);
        const panSy = (img.panSpeedY || 0).toFixed(4);
        const panRng = (img.panRange !== undefined ? img.panRange : 0.2).toFixed(4);
        const mirror = img.mirror || 'none';
        const mirrorScope = img.mirrorScope || 'tile';
        const tintR = (img.tintR !== undefined ? img.tintR : 1.0).toFixed(4);
        const tintG = (img.tintG !== undefined ? img.tintG : 1.0).toFixed(4);
        const tintB = (img.tintB !== undefined ? img.tintB : 1.0).toFixed(4);
        const hueSpin = (img.hueSpinSpeed || 0).toFixed(4);
        const orbitMode = img.orbitMode || 'circle';
        const lissFreqX = (img.lissFreqX !== undefined ? img.lissFreqX : 0.5).toFixed(4);
        const lissFreqY = (img.lissFreqY !== undefined ? img.lissFreqY : 0.75).toFixed(4);
        const lissPhase = (img.lissPhase !== undefined ? img.lissPhase : 0.25).toFixed(4);
        const stbAmp = (img.strobeAmp || 0).toFixed(4);
        const stbThr = (img.strobeThr !== undefined ? img.strobeThr : 0.4).toFixed(4);
        const hasStrobe = parseFloat(stbAmp) !== 0;
        const tex = `sampler_${img.texName}`;
        const imgAsp = (img.texW && img.texH) ? (img.texW / img.texH).toFixed(4) : '1.0000';

        const reactSrc = { bass: 'bass', mid: 'mid', treb: 'treb', vol: 'vol' }[img.reactSource || 'bass'] || 'bass';
        const curve = img.reactCurve || 'linear';
        let curveExpr;
        switch (curve) {
            case 'squared':   curveExpr = '_r_raw * _r_raw'; break;
            case 'cubed':     curveExpr = '_r_raw * _r_raw * _r_raw'; break;
            case 'threshold': curveExpr = 'step(0.3, _r_raw)'; break;
            default:          curveExpr = '_r_raw'; // linear
        }
        const strobeLines = hasStrobe
            ? `    float _strobeFq = ${stbThr} * 6.0 * (1.0 + _r_raw * 2.0);\n` +
              `    float _strobeWave = step(0.5, fract(time * _strobeFq));\n`
            : '';
        const reactLines =
            `    float _r_raw = ${reactSrc};
` +
            `    float _r = ${curveExpr};
` +
            strobeLines;

        const pulseSign = img.pulseInvert ? '-' : '+';
        const hasSpin = parseFloat(sp) !== 0;
        const hasOrbit = parseFloat(orb) !== 0;
        const hasLissajous = hasOrbit && orbitMode === 'lissajous';
        const hasBounce = parseFloat(bnc) !== 0;
        const hasTunnel = parseFloat(ts) !== 0 && img.tile;
        const hasSway = parseFloat(swayAmt) !== 0;
        const hasWander = parseFloat(wanderAmt) !== 0;
        const hasPanDrift = panMode === 'drift' && (parseFloat(panSx) !== 0 || parseFloat(panSy) !== 0);
        const hasPanBounce = panMode === 'bounce' && (parseFloat(panSx) !== 0 || parseFloat(panSy) !== 0) && parseFloat(panRng) !== 0;
        const hasMirror = mirror !== 'none';
        const fieldMirror = hasMirror && mirrorScope === 'field';
        const tileMirror = hasMirror && mirrorScope === 'tile';
        const hasTint = parseFloat(hueSpin) !== 0 || parseFloat(tintR) !== 1 || parseFloat(tintG) !== 1 || parseFloat(tintB) !== 1;
        const groupSpin = img.tile && hasSpin && !!img.groupSpin;
        const perTileSpin = img.tile && hasSpin && !img.groupSpin;
        const fwd = (img.tunnelSpeed || 0) >= 0;

        let blendLine;
        switch (img.blendMode) {
            case 'additive': blendLine = `col += _src * _op;`; break;
            case 'multiply': blendLine = `col = mix(col, col * _src, _op);`; break;
            case 'overlay': blendLine = `col = mix(col, _src, _op);`; break;
            default: blendLine = `col = mix(col, 1.0 - (1.0 - col) * (1.0 - _src), _op);`;
        }

        let angLines = '';
        if (hasOrbit && !hasLissajous) angLines += `    float _orbAng = time * 0.5;\n`;
        if (hasSpin) angLines += `    float _spinAng = time * ${sp};\n`;

        // Image centre (anchor + orbit + bounce + sway + wander)
        let cxExpr = cx;
        let cyExpr = cy;
        if (hasSway) cxExpr = `${cx} + sin(time * ${swaySpd}) * ${swayAmt}`;
        if (hasWander) {
            cxExpr = `(${cxExpr}) + (sin(time*${wanderSpd}*0.7+1.3)*0.6 + sin(time*${wanderSpd}*1.3+2.7)*0.4) * ${wanderAmt}`;
            cyExpr = `${cyExpr} + (sin(time*${wanderSpd}*0.9+0.5)*0.6 + sin(time*${wanderSpd}*1.7+3.1)*0.4) * ${wanderAmt}`;
        }
        if (hasPanDrift) {
            cxExpr = `(${cxExpr}) + time * ${panSx}`;
            cyExpr = `(${cyExpr}) + time * ${panSy}`;
        } else if (hasPanBounce) {
            cxExpr = `(${cxExpr}) + sin(time * ${panSx} * 6.28318) * ${panRng}`;
            cyExpr = `(${cyExpr}) + sin(time * ${panSy} * 6.28318) * ${panRng}`;
        }

        // Image UV source — either straight uv_m, or uv_m with a whole-group
        // mirror fold applied BEFORE the tile pipeline (so the entire tiled
        // image field gets mirrored, not just the inside of each tile).
        let fieldLines = `    vec2 _uvf = uv_m;\n`;
        if (fieldMirror) {
            if (mirror === 'h') {
                fieldLines += `    _uvf.x = 1.0 - abs(_uvf.x * 2.0 - 1.0);\n`;
            } else if (mirror === 'v') {
                fieldLines += `    _uvf.y = 1.0 - abs(_uvf.y * 2.0 - 1.0);\n`;
            } else if (mirror === 'quad') {
                fieldLines += `    _uvf.x = 1.0 - abs(_uvf.x * 2.0 - 1.0);\n`;
                fieldLines += `    _uvf.y = 1.0 - abs(_uvf.y * 2.0 - 1.0);\n`;
            } else if (mirror === 'kaleido') {
                fieldLines +=
                    `    { vec2 _kp = _uvf - 0.5;\n` +
                    `      float _kang = atan(_kp.y, _kp.x);\n` +
                    `      float _krad = length(_kp);\n` +
                    `      float _kseg = 3.14159265 / 3.0;\n` +
                    `      _kang = mod(_kang, _kseg * 2.0);\n` +
                    `      if (_kang > _kseg) _kang = _kseg * 2.0 - _kang;\n` +
                    `      _uvf = vec2(cos(_kang), sin(_kang)) * _krad + 0.5; }\n`;
            }
        }

        let centerLines;
        if (hasLissajous) {
            const bncPart = hasBounce ? ` - _r * ${bnc}` : '';
            centerLines =
                `    vec2 _c = vec2(${cxExpr} + sin(time * ${lissFreqX} * 6.28318 + ${lissPhase} * 6.28318) * ${orb},\n` +
                `                  ${cyExpr} + cos(time * ${lissFreqY} * 6.28318) * ${orb} / aspect.y${bncPart});\n` +
                `    vec2 _u = _uvf - _c;\n`;
        } else if (hasOrbit) {
            const bncPart = hasBounce ? ` - _r * ${bnc}` : '';
            centerLines =
                `    vec2 _c = vec2(${cxExpr} + cos(_orbAng) * ${orb},\n` +
                `                  ${cyExpr} + sin(_orbAng) * ${orb} / aspect.y${bncPart});\n` +
                `    vec2 _u = _uvf - _c;\n`;
        } else if (hasBounce) {
            centerLines = `    vec2 _u = _uvf - vec2(${cxExpr}, (${cyExpr}) - _r * ${bnc});\n`;
        } else {
            centerLines = `    vec2 _u = _uvf - vec2(${cxExpr}, ${cyExpr});\n`;
        }
        centerLines = fieldLines + centerLines;

        // Group spin: rotate the whole UV field around canvas center before tiling
        const groupSpinLines = groupSpin
            ? `    { _u.x *= aspect.y;
` +
            `      float _ca = cos(_spinAng); float _sa = sin(_spinAng);
` +
            `      _u = vec2(_ca*_u.x - _sa*_u.y, _sa*_u.x + _ca*_u.y);
` +
            `      _u.x /= aspect.y; }
`
            : '';

        // Helper: apply tiled UV to an already-declared vec2 variable, with optional per-tile spin.
        // The variable is modified in-place (no redeclaration).
        // dxVar / dyVar: if provided, will emit  vec2 <dxVar> = dFdx(…)  BEFORE the fract wrap
        //   so the caller can use textureGrad(tex, uv, dxVar, dyVar) to avoid mip-seams.
        // maskVar: if provided, a float variable to multiply by 0 in the gap region.
        const applyTileUV = (varName, sizeExpr, maskVar = null, dxVar = null, dyVar = null) => {
            let s = '';
            s += `    ${varName}.x *= aspect.y;\n`;
            s += `    ${varName} /= ${sizeExpr};\n`;
            s += `    ${varName}.x /= aspect.y;\n`;
            // Capture smooth derivatives BEFORE fract so textureGrad picks the right mip level.
            // Without this, the UV jump at each tile edge (0.999→0.001) makes dFdx/dFdy huge
            // and the GPU samples the lowest mipmap, producing a visible seam line.
            if (dxVar && dyVar) {
                s += `    vec2 ${dxVar} = dFdx(${varName}); vec2 ${dyVar} = dFdy(${varName});\n`;
            }
            s += `    ${varName} = fract(${varName} + 0.5);\n`;
            if (perTileSpin) {
                s +=
                    `    { vec2 _tl = ${varName} - 0.5; _tl.x *= aspect.y;\n` +
                    `      float _ca = cos(_spinAng); float _sa = sin(_spinAng);\n` +
                    `      _tl = vec2(_ca*_tl.x - _sa*_tl.y, _sa*_tl.x + _ca*_tl.y);\n` +
                    `      _tl.x /= aspect.y; ${varName} = _tl + 0.5; }\n`;
            }
            if (parseFloat(spc) > 0 && maskVar) {
                s += `    { float _sg = ${spc} * 0.5;\n`;
                s += `      ${maskVar} *= step(_sg, ${varName}.x) * step(_sg, 1.0 - ${varName}.x)\n`;
                s += `                  * step(_sg, ${varName}.y) * step(_sg, 1.0 - ${varName}.y);\n`;
                s += `      if (1.0 - 2.0 * _sg > 0.001) ${varName} = clamp((${varName} - _sg) / (1.0 - 2.0 * _sg), 0.0, 1.0); }\n`;
            }
            return s;
        };

        // Aspect-correct tiling: pre-scale _u.x by (imgAsp * aspect.y) BEFORE applyTileUV so
        // the tile cells themselves have the image's native aspect ratio in screen pixels.
        // Portrait image → portrait-shaped tiles; square → square tiles; 16:9 image on 16:9 → no-op.
        // Must be applied to each UV variable (or copy) just before its applyTileUV call.
        const aspectPreScale = (varName) =>
            `    ${varName}.x /= ${imgAsp} * aspect.y;\n`;

        const sizeBase = hasStrobe
            ? `${sz} * (1.0 ${pulseSign} _r * ${pu}) * mix(1.0, _strobeWave, ${stbAmp})`
            : `${sz} * (1.0 ${pulseSign} _r * ${pu})`;

        // Mirror UV fold helper — generates GLSL to fold a vec2 variable in-place.
        // Only emits for the per-tile scope; whole-group scope already folded _uvf upstream.
        const applyMirrorUV = (varName) => {
            if (!tileMirror) return '';
            let m = '';
            if (mirror === 'h') {
                m += `    ${varName}.x = 1.0 - abs(${varName}.x * 2.0 - 1.0);\n`;
            } else if (mirror === 'v') {
                m += `    ${varName}.y = 1.0 - abs(${varName}.y * 2.0 - 1.0);\n`;
            } else if (mirror === 'quad') {
                m += `    ${varName}.x = 1.0 - abs(${varName}.x * 2.0 - 1.0);\n`;
                m += `    ${varName}.y = 1.0 - abs(${varName}.y * 2.0 - 1.0);\n`;
            } else if (mirror === 'kaleido') {
                m += `    { vec2 _kp = ${varName} - 0.5;\n`;
                m += `      float _kang = atan(_kp.y, _kp.x);\n`;
                m += `      float _krad = length(_kp);\n`;
                m += `      float _kseg = 3.14159265 / 3.0;\n`;
                m += `      _kang = mod(_kang, _kseg * 2.0);\n`;
                m += `      if (_kang > _kseg) _kang = _kseg * 2.0 - _kang;\n`;
                m += `      ${varName} = vec2(cos(_kang), sin(_kang)) * _krad + 0.5; }\n`;
            }
            return m;
        };

        let pipeline = '';
        let sampleLine = '';

        if (hasTunnel) {
            // Seamless two-layer crossfade tunnel
            const tz1Expr = fwd ? `pow(2.0, _tp)` : `pow(2.0, -_tp)`;
            const tz2Expr = fwd ? `pow(2.0, _tp - 1.0)` : `pow(2.0, 1.0 - _tp)`;
            pipeline =
                groupSpinLines +
                `    float _tp = fract(time * ${ts});\n` +
                `    float _tz1 = ${tz1Expr};\n` +
                `    float _tz2 = ${tz2Expr};\n` +
                `    float _tf = smoothstep(0.5, 1.0, _tp);\n` +
                `    float _gapMaskA = 1.0; float _gapMaskB = 1.0;\n` +
                `    vec2 _uA = _u;\n` +
                aspectPreScale('_uA') +
                applyTileUV('_uA', `${sizeBase} * _tz1`, '_gapMaskA', '_dxA', '_dyA') +
                applyMirrorUV('_uA') +
                `    vec2 _uB = _u;\n` +
                aspectPreScale('_uB') +
                applyTileUV('_uB', `${sizeBase} * _tz2`, '_gapMaskB', '_dxB', '_dyB') +
                applyMirrorUV('_uB');
            sampleLine =
                `    vec4 _tA = textureGrad(${tex}, _uA, _dxA, _dyA);\n` +
                `    vec4 _tB = textureGrad(${tex}, _uB, _dxB, _dyB);\n` +
                `    vec4 _t = mix(_tA, _tB, _tf);\n` +
                `    float _gapMask = mix(_gapMaskA, _gapMaskB, _tf);\n`;
        } else if (img.tile) {
            // Plain tiled — group spin rotates field first, then tile (with optional per-tile spin)
            pipeline = groupSpinLines +
                `    float _gapMask = 1.0;\n` +
                aspectPreScale('_u') +
                applyTileUV('_u', sizeBase, '_gapMask', '_dx', '_dy') +
                applyMirrorUV('_u');
            sampleLine = `    vec4 _t = textureGrad(${tex}, _u, _dx, _dy);\n`;
        } else {
            // Non-tiled: clamp edges, optional spin
            const rotLines = hasSpin
                ? `    float _ca = cos(_spinAng); float _sa = sin(_spinAng);\n` +
                `    _u = vec2(_ca*_u.x - _sa*_u.y, _sa*_u.x + _ca*_u.y);\n`
                : '';
            pipeline =
                `    float _gapMask = 1.0;\n` +
                `    _u.x *= aspect.y;\n` +
                `    _u /= ${sizeBase};\n` +
                rotLines +
                `    _u.x /= aspect.y;\n` +
                `    _u = clamp(_u + 0.5, 0.0, 1.0);\n` +
                applyMirrorUV('_u');
            sampleLine = `    vec4 _t = texture(${tex}, _u);\n`;
        }

        return (
            `  {\n` +
            reactLines +
            angLines +
            centerLines +
            pipeline +
            sampleLine +
            `    vec3 _src = _t.xyz;\n` +
            (hasTint ? (() => {
                if (parseFloat(hueSpin) !== 0) {
                    // Rotate hue over time using RGB rotation matrix approximation
                    // hue angle in radians
                    return (
                        `    { float _ha = time * ${hueSpin} * 6.28318;\n` +
                        `      float _hc = cos(_ha); float _hs = sin(_ha);\n` +
                        `      float _lum = dot(_src, vec3(0.299, 0.587, 0.114));\n` +
                        `      vec3 _tc = vec3(${tintR}, ${tintG}, ${tintB});\n` +
                        `      vec3 _rh = vec3(_hc + (1.0-_hc)*0.299,\n` +
                        `                      (1.0-_hc)*0.587 - _hs*0.114,\n` +
                        `                      (1.0-_hc)*0.114 + _hs*0.587);\n` +
                        `      vec3 _gh = vec3((1.0-_hc)*0.299 + _hs*0.114,\n` +
                        `                      _hc + (1.0-_hc)*0.587,\n` +
                        `                      (1.0-_hc)*0.114 - _hs*0.299);\n` +
                        `      vec3 _bh = vec3((1.0-_hc)*0.299 - _hs*0.587,\n` +
                        `                      (1.0-_hc)*0.587 + _hs*0.299,\n` +
                        `                      _hc + (1.0-_hc)*0.114);\n` +
                        `      vec3 _tinted = vec3(dot(_src, _rh), dot(_src, _gh), dot(_src, _bh));\n` +
                        `      _src = _tinted * _tc; }\n`
                    );
                } else {
                    return `    _src *= vec3(${tintR}, ${tintG}, ${tintB});\n`;
                }
            })() : '') +
            `    float _op = _t.w * _gapMask * clamp(${op} + _r * ${opa}, 0.0, 1.0);\n` +
            `    ${blendLine}\n` +
            `  }\n`
        );
    }

    _syncAllControls() {
        this._syncColorSwatches();
        this._syncMotionSliders();
        this._syncWaveControls();
        this._syncEchoOrient();
        this._syncPaletteSliders();
        this._syncSolidFx();
        this._syncToggle('toggle-invert', 'invert');
        this._syncToggle('toggle-darken', 'darken');
    }

    _syncPaletteSliders() {
        const bv = this.currentState.baseVals;
        this._syncSlider('ps-gamma', bv.gammaadj, 0.5, 4.0, 2);
        this._syncSlider('ps-decay', bv.decay, 0.85, 0.999, 3);
    }

    _syncSolidFx() {
        this._syncSlider('sf-pulse', this.currentState.solidPulse || 0, 0, 2.0, 2);
        this._syncSlider('sf-breath', this.currentState.solidBreath || 0, 0, 1.0, 2);
        this._syncSlider('sf-shift', this.currentState.solidShift || 0, 0, 1.0, 2);
        const cb = this.currentState.solidColorB || [0, 0, 0];
        const hex = rgbToHex(cb[0], cb[1], cb[2]);
        const swatch = document.getElementById('swatch-shift');
        const native = document.getElementById('color-shift');
        const hexLabel = document.getElementById('hex-shift');
        if (swatch) swatch.style.background = hex;
        if (native) native.value = hex;
        if (hexLabel) hexLabel.textContent = hex.toUpperCase();
    }

    _syncSlider(id, value, min, max, decimals = 2) {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) return;
        input.value = value;
        if (valEl) valEl.textContent = Number(value).toFixed(decimals);
        input.style.setProperty('--pct', `${((value - min) / (max - min)) * 100}%`);
    }

    // ─── Public: save current state (overwrite or new) ────────────────────────

    /**
     * Save the current editor state.
     * @param {string}      name         - preset name to save under
     * @param {string|null} id           - if set, overwrite that preset; if null, create new
     * @param {string|null} thumbDataUrl - JPEG data URL for the thumbnail (optional)
     * @returns {object} the saved preset record
     */
    saveCurrent(name, id, thumbDataUrl = null) {
        const presetNameInput = document.getElementById('preset-name-input');
        if (presetNameInput) presetNameInput.value = name;

        const data = {
            name,
            ...this.currentState,
            ...(thumbDataUrl ? { thumbnailDataUrl: thumbDataUrl } : {}),
        };

        let record;
        if (id) {
            record = saveCustomPreset({ ...data, id, updatedAt: Date.now() });
        } else {
            record = createCustomPreset(data);
        }

        this.originalState = deepClone(this.currentState);
        return record;
    }

    // ─── Fill missing numeric fields on a loaded image entry ─────────────────
    // Presets saved before a field was added will be missing it; calling
    // .toFixed() on undefined throws. Merge against the same defaults used
    // when _addImageLayer creates a fresh entry.

    _normalizeImageEntry(entry) {
        const D = {
            opacity: 0.80, opacityPulse: 0.00, size: 0.25, spinSpeed: 0.00,
            orbitRadius: 0.00, bounceAmp: 0.00, tunnelSpeed: 0.00,
            spacing: 0.00, cx: 0.50, cy: 0.50,
            swayAmt: 0.00, swaySpeed: 1.00, wanderAmt: 0.00, wanderSpeed: 0.50,
            panMode: 'off', panSpeedX: 0.00, panSpeedY: 0.00, panRange: 0.20,
            mirror: 'none', mirrorScope: 'tile',
            isGif: false, gifSpeed: 1.0,
            reactSource: 'bass', reactCurve: 'linear',
            orbitMode: 'circle', lissFreqX: 0.50, lissFreqY: 0.75, lissPhase: 0.25,
            strobeAmp: 0.00, strobeThr: 0.40,
            audioPulse: 0.00, pulseInvert: false,
            blendMode: 'overlay', tile: true, groupSpin: false,
            hueSpinSpeed: 0.00, tintR: 1.0, tintG: 1.0, tintB: 1.0,
            name: 'Layer', fileName: '', collapsed: false,
            isHd: false, solo: false, muted: false,
        };
        return { ...D, ...entry };
    }

    // ─── Public: load a saved preset into the editor ──────────────────────────

    /**
     * Load a full custom preset object (from customPresets.js) into the editor.
     * Restores baseVals, shapes, waves, and image layers (fetching blobs from IndexedDB).
     * @param {object} presetData - preset object as returned by loadAllCustomPresets()
     */
    async loadPresetData(presetData) {
        // 1. Clear existing image layers
        const layersEl = document.getElementById('image-layers');
        if (layersEl) layersEl.innerHTML = '';
        for (const texName of Object.keys(this._imageTextures)) {
            this.engine.removeGifAnimation?.(texName);
        }
        this._imageTextures = {};

        // 2. Set state from preset (strip library-only metadata)
        const { id: _id, name: _name, schemaVersion: _sv, createdAt: _ca, updatedAt: _ua,
                thumbnailDataUrl: _th, ...stateFields } = presetData;
        this.currentState = deepClone({ ...stateFields, images: [] });
        this.originalState = deepClone(this.currentState);

        // 3. Sync all non-image controls
        this._buildCompShader();
        this._syncAllControls();

        // 4. Restore image layers (async — fetch blobs from IndexedDB)
        const savedImages = stateFields.images || [];
        for (const savedEntry of savedImages) {
            try {
                const blob = await getImage(savedEntry.imageId);
                if (!blob) continue;

                const dataUrl = await new Promise((res, rej) => {
                    const reader = new FileReader();
                    reader.onload = e => res(e.target.result);
                    reader.onerror = rej;
                    reader.readAsDataURL(blob);
                });

                const { width, height } = await new Promise((res, rej) => {
                    const img = new Image();
                    img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
                    img.onerror = rej;
                    img.src = dataUrl;
                });

                const entry = this._normalizeImageEntry(deepClone(savedEntry));
                const texObj = { data: dataUrl, width, height, isGif: !!entry.isGif };

                this.currentState.images.push(entry);
                this._mountLayerCard(entry, texObj);
            } catch (err) {
                console.warn('[Studio] Could not restore image layer:', savedEntry.imageId, err.message);
            }
        }

        this._applyToEngine();
        this._updateLayersBar();
        this._updateLayerIndices();

        // Sync scene mirror segment
        const smSeg = document.querySelectorAll('#scene-mirror-seg .seg');
        const sm = this.currentState.sceneMirror || 'none';
        smSeg.forEach(s => s.classList.toggle('active', s.dataset.smirror === sm));

        // Sync Images Only toggle
        const ioToggle = document.getElementById('toggle-images-only');
        if (ioToggle) ioToggle.checked = !!this.currentState.imagesOnly;
        this._imagesOnly = !!this.currentState.imagesOnly;
    }
}

// ─── Toast (exported for main.js) ────────────────────────────────────────────

export function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' toast--error' : '');
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
}
