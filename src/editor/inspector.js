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

import { createCustomPreset, storeImage, generateId } from '../customPresets.js';

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
};

// ─── Base Variations ─────────────────────────────────────────────────────────
// Full starting-point snapshots. Each overrides selected BLANK baseVals.
// `color` is used for the card's preview strip (CSS gradient).

const BASE_VARIATIONS = [
    {
        name: 'Color', desc: 'Solid ambient glow', color: '#2a0050',
        // solid: [r,g,b] tells the comp shader to use a flat base color
        // instead of the warp feedback buffer — gives a clean starting canvas
        solid: [0.08, 0.02, 0.22],
        bv: {
            decay: 0.98, gammaadj: 2.0,
            wave_mode: 3,
            wave_r: 0.75, wave_g: 0.25, wave_b: 1.0, wave_a: 0.75, wave_scale: 0.9,
        },
    },
    {
        name: 'Clear', desc: 'Blank canvas', color: '#333333',
        solid: [0, 0, 0],   // comp shader outputs black — no feedback buffer bleed
        bv: { decay: 0.5 },
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

        this._buildBaseVariations();
        this._buildPaletteChips();
        this._buildPaletteSliders();
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

        // Apply the first variation (Color) as the startup state — gives users
        // something vivid to look at immediately instead of a black screen.
        this.currentState.baseVals = { ...deepClone(BLANK.baseVals), ...BASE_VARIATIONS[0].bv };
        // _buildCompShader must run here so the solid-color GLSL is baked into
        // currentState.comp before the first _applyToEngine call.
        this._buildCompShader();

        this._applyToEngine();
        this._syncAllControls();

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
            btn.title = v.desc;
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
        document.querySelectorAll('.base-var-btn').forEach((el, idx) => {
            el.classList.toggle('active', idx === i);
        });
    }

    // ─── Palette chips ────────────────────────────────────────────────────────

    _buildPaletteChips() {
        const grid = document.getElementById('palette-grid');
        PALETTES.forEach((p, i) => {
            const wHex = rgbToHex(...p.wave);
            const gHex = rgbToHex(...p.glow);
            const btn = document.createElement('button');
            btn.className = 'palette-chip';
            btn.title = p.name;
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
            btn.title = label;
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
            this._solidColor = BASE_VARIATIONS[0].solid || null;
            this.currentState.baseVals = { ...deepClone(BLANK.baseVals), ...BASE_VARIATIONS[0].bv };
            this._imagesOnly = false;
            const ioToggle = document.getElementById('toggle-images-only');
            if (ioToggle) ioToggle.checked = false;
            this._postSnap();
            this._buildCompShader();
            this._applyToEngine();
            this._syncAllControls();
            this._clearPaletteActive();
            // Re-highlight the first variation (Color)
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

    _addImageLayer(file) {
        if (!this.currentState.images) this.currentState.images = [];
        if (this.currentState.images.length >= 2) {
            showToast('Max 2 image layers', true);
            return;
        }

        const texName = `userimg${Date.now().toString(36)}`;
        const imageId = generateId();

        // Persist the blob so the preset survives reloads. Fire-and-forget —
        // failure only affects cross-session loading, not the live preview.
        storeImage(imageId, file).catch(err => {
            console.warn('[Editor] storeImage failed:', err.message);
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
            mirror: 'none',     // 'none' | 'h' | 'v' | 'quad' | 'kaleido'
            tintR: 1.00,        // tint color red (1=white = no tint)
            tintG: 1.00,
            tintB: 1.00,
            hueSpinSpeed: 0.00, // tint hue rotation speed (cycles/sec)
            tile: true,
            blendMode: 'overlay',
            audioPulse: 0.00,  // bass drives size
            pulseInvert: false, // shrink instead of grow on beat
            groupSpin: false,   // when tile=ON: spin the whole grid instead of each tile
        };
        this.currentState.images.push(entry);

        // ── Build card ──────────────────────────────────────────────────────
        const layers = document.getElementById('image-layers');
        const card = document.createElement('div');
        card.className = 'image-layer-card';

        const shortName = file.name.length > 24 ? file.name.slice(0, 22) + '…' : file.name;
        const pct = (v, min, max) =>
            `${(((v - min) / (max - min)) * 100).toFixed(1)}%`;

        card.innerHTML = `
          <div class="layer-header">
            <span class="layer-name" title="${file.name}">${shortName}</span>
            <button class="layer-remove" aria-label="Remove layer">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="layer-controls">
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
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Size</span>
              <input type="range" class="slider" min="0.05" max="1.5" step="0.01"
                value="${entry.size}" style="--pct:${pct(entry.size, 0.05, 1.5)}">
              <span class="lsv">${entry.size.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Spacing</span>
              <input type="range" class="slider" min="0" max="0.8" step="0.01"
                value="${entry.spacing}" style="--pct:${pct(entry.spacing, 0, 0.8)}">
              <span class="lsv">${entry.spacing.toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Pulse</span>
              <input type="range" class="slider layer-slider-inline" min="0" max="2" step="0.05"
                value="${entry.audioPulse}" style="--pct:${pct(entry.audioPulse, 0, 2)}">
              <span class="lsv layer-pulse-val">${entry.audioPulse.toFixed(2)}</span>
              <span class="layer-ctrl-label" style="margin-left:8px;width:auto" title="Shrink on beat instead of grow">Shrink</span>
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
              <span class="layer-ctrl-label" style="margin-left:8px;width:auto" title="Rotate the whole tile grid instead of each tile">Group</span>
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
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Bounce</span>
              <input type="range" class="slider" min="0" max="0.4" step="0.01"
                value="${entry.bounceAmp}" style="--pct:${pct(entry.bounceAmp, 0, 0.4)}">
              <span class="lsv">${entry.bounceAmp.toFixed(2)}</span>
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
                <canvas class="xy-pad" width="96" height="96" title="Drag to set anchor point"></canvas>
                <button class="xy-reset" title="Reset to center">↺</button>
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
            <p class="layer-section-label">Mirror</p>
            <div class="layer-mirror-seg" role="group">
              <button class="lseg active" data-mirror="none">Off</button>
              <button class="lseg" data-mirror="h">↔ H</button>
              <button class="lseg" data-mirror="v">↕ V</button>
              <button class="lseg" data-mirror="quad">⊞ Quad</button>
              <button class="lseg" data-mirror="kaleido">✦ Kaleido</button>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Tint</p>
            <div class="layer-row-inline" style="gap:8px;margin-bottom:6px">
              <span class="layer-ctrl-label">Color</span>
              <div class="layer-tint-wrap">
                <span class="layer-tint-swatch" style="background:#ffffff"></span>
                <input type="color" class="layer-tint-picker" value="#ffffff" tabindex="-1" aria-hidden="true" />
              </div>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Hue Spin</span>
              <input type="range" class="slider" min="0" max="2" step="0.02"
                value="${entry.hueSpinSpeed}" style="--pct:${pct(entry.hueSpinSpeed, 0, 2)}">
              <span class="lsv">${entry.hueSpinSpeed.toFixed(2)}</span>
            </div>
          </div>
        `;

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

        // Pulse inline slider (not inside .layer-slider-row, wired separately)
        const pulseSlider = card.querySelector('.layer-slider-inline');
        const pulseVal = card.querySelector('.layer-pulse-val');
        pulseSlider.addEventListener('input', () => {
            const v = parseFloat(pulseSlider.value);
            entry.audioPulse = v;
            pulseVal.textContent = v.toFixed(2);
            pulseSlider.style.setProperty('--pct', `${((v / 2) * 100).toFixed(1)}%`);
            refresh();
        });

        // Remaining slider rows — DOM order must match sliderKeys exactly:
        // opacity, opacityPulse, size, spacing, orbitRadius, bounceAmp, tunnelSpeed,
        // swayAmt, swaySpeed, wanderAmt, wanderSpeed, hueSpinSpeed
        const sliderKeys = ['opacity', 'opacityPulse', 'size', 'spacing', 'orbitRadius', 'bounceAmp', 'tunnelSpeed',
            'swayAmt', 'swaySpeed', 'wanderAmt', 'wanderSpeed', 'hueSpinSpeed'];
        const sliderMins = [0, 0, 0.05, 0, 0, 0, -2, 0, 0, 0, 0, 0];
        const sliderMaxes = [1, 1, 1.5, 0.8, 0.45, 0.4, 2, 0.4, 4, 0.4, 2, 2];

        card.querySelectorAll('.layer-slider-row input[type=range]').forEach((sl, i) => {
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

        // Mirror segmented control
        card.querySelectorAll('.lseg').forEach(btn => {
            btn.addEventListener('click', () => {
                card.querySelectorAll('.lseg').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.mirror = btn.dataset.mirror;
                refresh();
            });
        });

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

        card.querySelector('.layer-remove').addEventListener('click', () => {
            const idx = this.currentState.images.indexOf(entry);
            if (idx !== -1) this.currentState.images.splice(idx, 1);
            delete this._imageTextures[texName];
            this._buildCompShader();
            this._applyToEngine();
            card.remove();
        });

        layers.appendChild(card);

        // ── Load texture async ──────────────────────────────────────────────
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataURL = e.target.result;
            const img = new Image();
            img.onload = () => {
                const texObj = { data: dataURL, width: img.naturalWidth, height: img.naturalHeight };
                this._imageTextures[texName] = texObj;
                this.engine.setUserTexture(texName, texObj);
                this._buildCompShader();
                this._applyToEngine();
                showToast('Image layer added');
            };
            img.onerror = () => showToast('Could not load image', true);
            img.src = dataURL;
        };
        reader.readAsDataURL(file);
    }

    // ─── Apply & sync ──────────────────────────────────────────────────────────

    _applyToEngine() {
        this._buildCompShader();
        this.engine.loadPresetObject(this.currentState, 0);
        for (const [name, texObj] of Object.entries(this._imageTextures)) {
            this.engine.setUserTexture(name, texObj);
        }
    }

    /**
     * Rebuild currentState.comp to include sampler uniforms + per-image
     * animated GLSL (spin, scale, tile, audio pulse, blend mode).
     * All per-image parameters are baked as float literals so no custom
     * uniforms are needed — only the standard butterchurn comp uniforms
     * (time, bass, aspect, uv, ret, sampler_main) are used.
     */
    _buildCompShader() {
        const images = this.currentState.images || [];
        const sm = this.currentState.sceneMirror || 'none';
        if (images.length === 0 && !this._solidColor && sm === 'none') {
            this.currentState.comp = BLANK_COMP;
            return;
        }
        const uniforms = images
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
            const r = (bv.wave_r ?? this._solidColor[0]).toFixed(4);
            const g = (bv.wave_g ?? this._solidColor[1]).toFixed(4);
            const b = (bv.wave_b ?? this._solidColor[2]).toFixed(4);
            base = uvFold +
                `  float _breath = 0.55 + 0.45 * sin(time * 0.6);\n` +
                `  float _bass_b = 1.0 + bass * 0.5;\n` +
                `  vec3 col = vec3(${r}, ${g}, ${b}) * _breath * _bass_b;\n`;
        } else {
            base = uvFold + `  vec3 col = ${mainSample};\n`;
        }
        let body = base;
        for (const img of images) {
            body += this._buildImageBlock(img);
        }
        body += '  ret = col;\n';
        this.currentState.comp = `${uniforms}\n shader_body {\n${body} }`;
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
        const mirror = img.mirror || 'none';
        const tintR = (img.tintR !== undefined ? img.tintR : 1.0).toFixed(4);
        const tintG = (img.tintG !== undefined ? img.tintG : 1.0).toFixed(4);
        const tintB = (img.tintB !== undefined ? img.tintB : 1.0).toFixed(4);
        const hueSpin = (img.hueSpinSpeed || 0).toFixed(4);
        const tex = `sampler_${img.texName}`;

        const pulseSign = img.pulseInvert ? '-' : '+';
        const hasSpin = parseFloat(sp) !== 0;
        const hasOrbit = parseFloat(orb) !== 0;
        const hasBounce = parseFloat(bnc) !== 0;
        const hasTunnel = parseFloat(ts) !== 0 && img.tile;
        const hasSway = parseFloat(swayAmt) !== 0;
        const hasWander = parseFloat(wanderAmt) !== 0;
        const hasMirror = mirror !== 'none';
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
        if (hasOrbit) angLines += `    float _orbAng = time * 0.5;\n`;
        if (hasSpin) angLines += `    float _spinAng = time * ${sp};\n`;

        // Image centre (anchor + orbit + bounce + sway + wander)
        let cxExpr = cx;
        let cyExpr = cy;
        if (hasSway) cxExpr = `${cx} + sin(time * ${swaySpd}) * ${swayAmt}`;
        if (hasWander) {
            cxExpr = `(${cxExpr}) + (sin(time*${wanderSpd}*0.7+1.3)*0.6 + sin(time*${wanderSpd}*1.3+2.7)*0.4) * ${wanderAmt}`;
            cyExpr = `${cyExpr} + (sin(time*${wanderSpd}*0.9+0.5)*0.6 + sin(time*${wanderSpd}*1.7+3.1)*0.4) * ${wanderAmt}`;
        }

        let centerLines;
        if (hasOrbit) {
            const bncPart = hasBounce ? ` - bass * ${bnc}` : '';
            centerLines =
                `    vec2 _c = vec2(${cxExpr} + cos(_orbAng) * ${orb},\n` +
                `                  ${cyExpr} + sin(_orbAng) * ${orb} / aspect.y${bncPart});\n` +
                `    vec2 _u = uv_m - _c;\n`;
        } else if (hasBounce) {
            centerLines = `    vec2 _u = uv_m - vec2(${cxExpr}, (${cyExpr}) - bass * ${bnc});\n`;
        } else {
            centerLines = `    vec2 _u = uv_m - vec2(${cxExpr}, ${cyExpr});\n`;
        }

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

        const sizeBase = `${sz} * (1.0 ${pulseSign} bass * ${pu})`;

        // Mirror UV fold helper — generates GLSL to fold a vec2 variable in-place
        const applyMirrorUV = (varName) => {
            if (!hasMirror) return '';
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
                `    float _tf = _tp;\n` +
                `    float _gapMaskA = 1.0; float _gapMaskB = 1.0;\n` +
                `    vec2 _uA = _u;\n` +
                applyTileUV('_uA', `${sizeBase} * _tz1`, '_gapMaskA', '_dxA', '_dyA') +
                applyMirrorUV('_uA') +
                `    vec2 _uB = _u;\n` +
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
            `    float _op = _t.w * _gapMask * clamp(${op} + bass * ${opa}, 0.0, 1.0);\n` +
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
        this._syncToggle('toggle-invert', 'invert');
        this._syncToggle('toggle-darken', 'darken');
    }

    _syncPaletteSliders() {
        const bv = this.currentState.baseVals;
        this._syncSlider('ps-gamma', bv.gammaadj, 0.5, 4.0, 2);
        this._syncSlider('ps-decay', bv.decay, 0.85, 0.999, 3);
    }

    _syncSlider(id, value, min, max, decimals = 2) {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) return;
        input.value = value;
        if (valEl) valEl.textContent = Number(value).toFixed(decimals);
        input.style.setProperty('--pct', `${((value - min) / (max - min)) * 100}%`);
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
