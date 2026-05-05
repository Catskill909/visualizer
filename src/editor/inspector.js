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
import {
    parseGifFile, processGifFrames, generateFrameStrip,
    shouldOptimize, getRecommendedSettings, formatBytes,
    estimateGpuMemory
} from './gifOptimizer.js';

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


// ─── Blank start state ────────────────────────────────────────────────────────

// Generates inline GLSL to apply sat/hue to `col` (vec3 background) BEFORE image
// layers are composited. Returns empty string at defaults → zero cost.
function buildSatHueOnColGlsl(sat, hue) {
    const s = (typeof sat === 'number' && isFinite(sat)) ? sat : 1.0;
    const h = (typeof hue === 'number' && isFinite(hue)) ? hue : 0;
    const satLine = (Math.abs(s - 1.0) < 0.001) ? '' :
        `  float _bg_lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(_bg_lum), col, ${s.toFixed(4)});
`;
    const rad = h * Math.PI / 180;
    const cosA = Math.cos(rad).toFixed(6);
    const sinA = Math.sin(rad).toFixed(6);
    const oneMinusCos = (1 - Math.cos(rad)).toFixed(6);
    const hueLine = (Math.abs(h) < 0.01) ? '' :
        `  { vec3 _bgk = vec3(0.57735);
  col = col * ${cosA} + cross(_bgk, col) * ${sinA} + _bgk * dot(_bgk, col) * ${oneMinusCos}; }
`;
    return satLine + hueLine;
}

function buildStudioPostFxGlsl(sat, hue) {
    const s = (typeof sat === 'number' && isFinite(sat)) ? sat : 1.0;
    const h = (typeof hue === 'number' && isFinite(hue)) ? hue : 0;
    const rad = h * Math.PI / 180;
    const cosA = Math.cos(rad).toFixed(6);
    const sinA = Math.sin(rad).toFixed(6);
    const oneMinusCos = (1 - Math.cos(rad)).toFixed(6);
    const satLine = (Math.abs(s - 1.0) < 0.001) ? '' :
        `\n    float _lum = dot(ret.rgb, vec3(0.299, 0.587, 0.114));\n    ret.rgb = mix(vec3(_lum), ret.rgb, ${s.toFixed(4)});`;
    const hueLine = (Math.abs(h) < 0.01) ? '' :
        `\n    vec3 _k = vec3(0.57735);\n    ret.rgb = ret.rgb * ${cosA} + cross(_k, ret.rgb) * ${sinA} + _k * dot(_k, ret.rgb) * ${oneMinusCos};`;
    return `    /* STUDIO_POST_FX */\n    if (brighten != 0) ret = sqrt(ret);\n    if (darken != 0) ret = ret * ret;\n    if (solarize != 0) ret = ret * (1.0 - ret) * 4.0;\n    if (invert != 0) ret = 1.0 - ret;${satLine}${hueLine}\n`;
}

function stripStudioPostFx(compText) {
    if (!compText) return compText;
    const markerPos = compText.indexOf('/* STUDIO_POST_FX */');
    if (markerPos === -1) return compText;
    const nlBefore = compText.lastIndexOf('\n', markerPos - 1);
    const lastCurly = compText.lastIndexOf('}');
    if (nlBefore === -1 || lastCurly === -1) return compText;
    return compText.slice(0, nlBefore) + compText.slice(lastCurly);
}

function injectStudioPostFx(compText, opts) {
    if (!compText || compText.indexOf('shader_body') === -1) return compText;
    const clean = stripStudioPostFx(compText);
    const lastCurly = clean.lastIndexOf('}');
    if (lastCurly === -1) return clean;
    const sat = (opts && opts.sat != null) ? opts.sat : 1.0;
    const hue = (opts && opts.hue != null) ? opts.hue : 0;
    const glsl = buildStudioPostFxGlsl(sat, hue);
    return `${clean.slice(0, lastCurly)}\n${glsl}${clean.slice(lastCurly)}`;
}

// Minimal passthrough comp shader — butterchurn won't accept an empty string.
const BLANK_COMP_RAW = ' shader_body { \n  vec4 tmpvar_1;\n  tmpvar_1.w = 1.0;\n  tmpvar_1.xyz = (texture (sampler_main, uv).xyz * 2.0);\n  ret = tmpvar_1.xyz;\n }';
const BLANK_COMP = injectStudioPostFx(BLANK_COMP_RAW);

const BLANK = {
    baseVals: {
        zoom: 1.0, rot: 0.0, warp: 0.0, warpanimspeed: 1.0, warpscale: 1.0,
        zoomexp: 1.0,
        decay: 0.98, gammaadj: 2.0,
        echo_zoom: 1.0, echo_orient: 0, echo_alpha: 0,
        dx: 0, dy: 0,
        sx: 1.0, sy: 1.0,
        cx: 0.5, cy: 0.5,
        wave_mode: 3,
        wave_r: 1.0, wave_g: 1.0, wave_b: 1.0, wave_a: 0.8,
        wave_scale: 1.0, wave_mystery: 0.0,
        wave_smoothing: 0.75, wave_x: 0.5, wave_y: 0.5,
        wave_thick: 0, additivewave: 0, wave_usedots: 0, wave_brighten: 0,
        ob_size: 0.0, ob_r: 0.0, ob_g: 0.0, ob_b: 0.0, ob_a: 0.0,
        ib_size: 0.0, ib_r: 0.0, ib_g: 0.0, ib_b: 0.0, ib_a: 0.0,
        mv_x: 12, mv_y: 9, mv_l: 0.9, mv_r: 0.0, mv_g: 0.0, mv_b: 1.0, mv_a: 0.0,
        darken: 0, invert: 0, brighten: 0, solarize: 0, darken_center: 0,
        modwavealphabyvolume: 0,
        studio_saturation: 1.0, studio_hue_rotate: 0,
        b1ed: 0.5,
    },
    shapes: [], waves: [],
    warp: '',          // empty warp is valid
    comp: BLANK_COMP,  // must be a valid GLSL shader_body string
    init_eqs_str: '', frame_eqs_str: '', pixel_eqs_str: '',
    images: [],
    sceneMirror: 'none',  // 'none' | 'h' | 'v' | 'both'
    motionReact: {
        source: 'bass',
        curve: 'linear',
        zoomAmt: 0.00,
        rotAmt: 0.00,
        warpAmt: 0.00,
        warpSpeedAmt: 0.00,
        driftXAmt: 0.00,
        driftYAmt: 0.00,
    },
    // Solid-mode fx — only applied when a variation with a `solid:` base is active.
    // All default to 0 so "Solid" out of the box is truly static (no breath, no pulse).
    solidPulse: 0,        // bass multiplier: col *= (1 + bass * pulse)
    solidBreath: 0,       // slow sine amplitude: col *= mix(1, 0.5+0.5*sin(t*0.6), breath)
    solidShift: 0,        // beat-driven mix amount toward solidColorB (uses bass_att)
    solidColorB: [0, 0, 0],
    solidReactSource: 'bass',  // 'bass' | 'mid' | 'treb' | 'vol'
    solidReactCurve: 'linear', // 'linear' | 'squared' | 'cubed' | 'threshold'
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

const DEFAULT_VARIATION_INDEX = 1; // Shift

// ─── Palettes ─────────────────────────────────────────────────────────────────
// Each entry: wave + glow + accent colours, normalized 0-1.

const PALETTES = [
    { name: 'Mono', wave: [1.00, 1.00, 1.00], glow: [0.80, 0.80, 0.80], accent: [0.50, 0.50, 0.50] },
    { name: 'Neon', wave: [0.00, 0.90, 1.00], glow: [0.00, 0.30, 1.00], accent: [1.00, 0.00, 0.50] },
    { name: 'Electric', wave: [0.20, 1.00, 0.40], glow: [0.00, 0.60, 0.20], accent: [0.60, 0.00, 1.00] },
    { name: 'Fire', wave: [1.00, 0.30, 0.00], glow: [1.00, 0.70, 0.00], accent: [1.00, 0.55, 0.00] },
    { name: 'Violet', wave: [0.80, 0.20, 1.00], glow: [0.40, 0.00, 0.90], accent: [0.00, 0.90, 0.90] },
    { name: 'Ocean', wave: [0.10, 0.70, 1.00], glow: [0.00, 0.20, 0.80], accent: [1.00, 0.40, 0.20] },
    { name: 'Sunset', wave: [1.00, 0.40, 0.20], glow: [0.90, 0.10, 0.70], accent: [1.00, 0.75, 0.00] },
    { name: 'Ice', wave: [0.70, 0.90, 1.00], glow: [0.50, 0.80, 1.00], accent: [0.90, 1.00, 1.00] },
    { name: 'Gold', wave: [1.00, 0.80, 0.00], glow: [1.00, 0.40, 0.10], accent: [1.00, 0.10, 0.00] },
    { name: 'Rose', wave: [1.00, 0.30, 0.60], glow: [0.90, 0.10, 0.40], accent: [0.70, 0.20, 1.00] },
    { name: 'Acid', wave: [0.80, 1.00, 0.00], glow: [0.30, 0.90, 0.10], accent: [0.00, 0.50, 1.00] },
    { name: 'Plasma', wave: [1.00, 0.00, 0.80], glow: [0.20, 0.80, 1.00], accent: [1.00, 0.40, 0.00] },
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
        this._solidColor = BASE_VARIATIONS[DEFAULT_VARIATION_INDEX].solid || null;
        this._hdUploads = false;      // when true: next upload is resized to HD_MAX_DIM instead of STD_MAX_DIM
        this._lastBuildMs = 0;        // dev monitor: last shader rebuild time
        this._baseComp = BLANK_COMP_RAW;  // pre-injection comp; re-injected when sat/hue change

        this.onchange = null;   // set by main.js for dirty-state tracking

        this._buildBaseVariations();
        this._buildPaletteChips();
        this._buildPaletteSliders();
        this._buildSolidFxPanel();
        this._buildMotionSliders();
        this._buildMotionReactPanel();
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
        this._bindGifOptimizer();
        this._bindImagesOnly();
        this._bindHdUploads();
        this._bindCollapseAll();
        this._initDevHud();
        this._updateLayersBar();

        // Apply the default variation (Shift) as the startup state.
        const v0 = BASE_VARIATIONS[DEFAULT_VARIATION_INDEX];
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
        this.currentState.solidReactSource = v0.solidReactSource ?? 'bass';
        this.currentState.solidReactCurve = v0.solidReactCurve ?? 'linear';
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
            btn.className = 'base-var-btn' + (i === DEFAULT_VARIATION_INDEX ? ' active' : '');
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
        this.currentState.solidReactSource = v.solidReactSource ?? 'bass';
        this.currentState.solidReactCurve = v.solidReactCurve ?? 'linear';
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

        // ── Audio Reactivity source + curve (mirrors image layer pattern) ──
        const reactSrcSel = document.getElementById('solid-react-source');
        if (reactSrcSel) {
            reactSrcSel.value = this.currentState.solidReactSource || 'bass';
            reactSrcSel.addEventListener('change', () => {
                this.currentState.solidReactSource = reactSrcSel.value;
                this._buildCompShader();
                this._applyToEngine();
            });
        }
        const curveBtns = document.querySelectorAll('#solid-react-curve .lseg');
        curveBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curve === (this.currentState.solidReactCurve || 'linear'));
            btn.addEventListener('click', () => {
                curveBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentState.solidReactCurve = btn.dataset.curve;
                this._buildCompShader();
                this._applyToEngine();
            });
        });

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
            const aHex = rgbToHex(...p.accent);
            const btn = document.createElement('button');
            btn.className = 'palette-chip';
            btn.setAttribute('data-tooltip', p.name);
            btn.dataset.palette = i;
            btn.innerHTML = `
        <span class="chip-dots">
          <span class="chip-dot" style="background:${wHex}"></span>
          <span class="chip-dot chip-dot--glow" style="background:${gHex}"></span>
          <span class="chip-dot chip-dot--accent" style="background:${aHex}"></span>
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
        [bv.ib_r, bv.ib_g, bv.ib_b] = p.accent;
        bv.ob_a = 0.75;
        bv.ob_size = 0.02;
        if (!bv.ib_a) bv.ib_a = 0.5;
        if (!bv.ib_size) bv.ib_size = 0.01;
        this._postSnap();
        // Rebuild comp shader so solid-color base picks up the new wave_r/g/b
        this._buildCompShader();
        this._applyToEngine();
        this._syncColorSwatches();
        this._syncPaletteSliders();
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
            { id: 'ps-ob-size', label: 'Outer Border Size', min: 0, max: 0.1, step: 0.001, value: BLANK.baseVals.ob_size, decimals: 3, key: 'ob_size' },
            { id: 'ps-ob-a', label: 'Outer Border Alpha', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.ob_a, key: 'ob_a' },
            { id: 'ps-ib-size', label: 'Inner Border Size', min: 0, max: 0.1, step: 0.001, value: BLANK.baseVals.ib_size, decimals: 3, key: 'ib_size' },
            { id: 'ps-ib-a', label: 'Inner Border Alpha', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.ib_a, key: 'ib_a' },
            { id: 'ps-wavefade', label: 'Fade Wave in Silence', min: 0, max: 2.0, step: 0.01, value: BLANK.baseVals.modwavealphabyvolume, key: 'modwavealphabyvolume' },
            { id: 'ps-saturation', label: 'Saturation', min: 0, max: 2.0, step: 0.01, value: 1.0, key: 'studio_saturation', reInject: true },
            { id: 'ps-hue', label: 'Hue Rotate', min: 0, max: 360, step: 1, value: 0, key: 'studio_hue_rotate', reInject: true },
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
                if (cfg.reInject) this._rebuildPostFx();
                else this._applyToEngine(true);
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });
    }

    // ─── Post-FX shader rebuild (saturation / hue rotate) ────────────────────

    _rebuildPostFx() {
        const bv = this.currentState.baseVals;
        const opts = { sat: bv.studio_saturation ?? 1.0, hue: bv.studio_hue_rotate ?? 0 };
        // When images are present, sat/hue must be baked inline into `col` BEFORE
        // image layers blend in (_buildCompShader handles this). The end-block
        // strip+re-inject can't reach that position, so delegate to a full rebuild.
        if ((this.currentState.images || []).length > 0) {
            this._buildCompShader();
            this._applyToEngine(true);
            return;
        }
        // No images — strip old post-FX from current comp and re-inject with new values.
        // Do NOT use this._baseComp here — solid-mode variations build their comp
        // through a separate path that doesn't update _baseComp.
        this.currentState.comp = injectStudioPostFx(this.currentState.comp, opts);
        this._applyToEngine(true);
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
            this._syncPaletteSliders(); // sync ob_a/ob_size/ib_a/ib_size if auto-set
            this._buildCompShader();
            this._applyToEngine(true);
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
        // Each entry pairs a container id with its slider configs.
        // Splitting into sections keeps the Motion tab scannable as it grows.
        const sections = [
            {
                container: 'motion-sliders',
                configs: [
                    { id: 'ms-zoom', label: 'Zoom', min: 0.50, max: 1.80, step: 0.01, value: BLANK.baseVals.zoom, key: 'zoom' },
                    { id: 'ms-rot', label: 'Spin', min: -1.0, max: 1.00, step: 0.01, value: BLANK.baseVals.rot, key: 'rot' },
                    { id: 'ms-warp', label: 'Warp', min: 0, max: 5.00, step: 0.05, value: BLANK.baseVals.warp, key: 'warp' },
                    { id: 'ms-wspd', label: 'Warp Speed', min: 0.10, max: 3.00, step: 0.05, value: BLANK.baseVals.warpanimspeed, key: 'warpanimspeed' },
                    { id: 'ms-ezoom', label: 'Echo Zoom', min: 1.00, max: 4.00, step: 0.05, value: BLANK.baseVals.echo_zoom, key: 'echo_zoom' },
                    { id: 'ms-wscale', label: 'Warp Scale', min: 0.01, max: 4.00, step: 0.05, value: BLANK.baseVals.warpscale, key: 'warpscale' },
                ],
            },
            {
                container: 'motion-echo-alpha',
                configs: [
                    { id: 'ms-ealpha', label: 'Echo Opacity', min: 0, max: 1.00, step: 0.01, value: BLANK.baseVals.echo_alpha, key: 'echo_alpha' },
                ],
            },
            {
                container: 'motion-drift-sliders',
                configs: [
                    { id: 'ms-dx', label: 'Drift H', min: -0.10, max: 0.10, step: 0.005, value: BLANK.baseVals.dx, key: 'dx' },
                    { id: 'ms-dy', label: 'Drift V', min: -0.10, max: 0.10, step: 0.005, value: BLANK.baseVals.dy, key: 'dy' },
                    { id: 'ms-sx', label: 'Stretch H', min: 0.80, max: 1.20, step: 0.005, value: BLANK.baseVals.sx, key: 'sx' },
                    { id: 'ms-sy', label: 'Stretch V', min: 0.80, max: 1.20, step: 0.005, value: BLANK.baseVals.sy, key: 'sy' },
                    { id: 'ms-zexp', label: 'Zoom Curve', min: 0.50, max: 2.00, step: 0.01, value: BLANK.baseVals.zoomexp, key: 'zoomexp' },
                ],
            },
            {
                container: 'motion-center-sliders',
                configs: [
                    { id: 'ms-cx', label: 'Warp Center X', min: 0, max: 1.00, step: 0.01, value: BLANK.baseVals.cx, key: 'cx' },
                    { id: 'ms-cy', label: 'Warp Center Y', min: 0, max: 1.00, step: 0.01, value: BLANK.baseVals.cy, key: 'cy' },
                ],
            },
        ];

        sections.forEach(({ container: containerId, configs }) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            configs.forEach(cfg => {
                const input = makeSlider(container, cfg);
                const valEl = document.getElementById(`${cfg.id}-val`);
                input.addEventListener('pointerdown', () => this._preSnap());
                input.addEventListener('input', () => {
                    const v = parseFloat(input.value);
                    if (valEl) valEl.textContent = v.toFixed(2);
                    input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                    this.currentState.baseVals[cfg.key] = v;
                    this._applyToEngine(true);
                });
                input.addEventListener('pointerup', () => this._postSnap());
            });
        });

        document.getElementById('btn-randomize-motion')?.addEventListener('click', () => {
            this._preSnap();
            const bv = this.currentState.baseVals;
            bv.zoom = 0.80 + Math.random() * 0.60;
            bv.rot = (Math.random() - 0.5) * 0.70;
            bv.warp = Math.random() * 4.5;
            bv.warpanimspeed = 0.20 + Math.random() * 2.60;
            bv.echo_zoom = 1.00 + Math.random() * 3.00;
            bv.warpscale = 0.2 + Math.random() * 3.8;
            // Phase 8 fields — conservative ranges. Most rolls leave these near defaults
            // so randomize doesn't feel chaotic; occasionally a bigger value lands.
            bv.echo_alpha = Math.random() < 0.7 ? 0 : 0.2 + Math.random() * 0.4;
            bv.dx = Math.random() < 0.65 ? 0 : (Math.random() - 0.5) * 0.04;
            bv.dy = Math.random() < 0.65 ? 0 : (Math.random() - 0.5) * 0.04;
            bv.sx = 0.95 + Math.random() * 0.10;
            bv.sy = 0.95 + Math.random() * 0.10;
            bv.zoomexp = 0.80 + Math.random() * 0.50;
            bv.cx = Math.random() < 0.7 ? 0.5 : 0.3 + Math.random() * 0.4;
            bv.cy = Math.random() < 0.7 ? 0.5 : 0.3 + Math.random() * 0.4;
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
            ['ms-wscale', 'warpscale', 0.01, 4.0],
            ['ms-ealpha', 'echo_alpha', 0, 1.0],
            ['ms-dx', 'dx', -0.1, 0.1],
            ['ms-dy', 'dy', -0.1, 0.1],
            ['ms-sx', 'sx', 0.8, 1.2],
            ['ms-sy', 'sy', 0.8, 1.2],
            ['ms-zexp', 'zoomexp', 0.5, 2.0],
            ['ms-cx', 'cx', 0, 1.0],
            ['ms-cy', 'cy', 0, 1.0],
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
            { id: 'ws-smoothing', label: 'Smoothing', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_smoothing, key: 'wave_smoothing' },
            { id: 'ws-mystery', label: 'Mystery', min: -1.0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_mystery, key: 'wave_mystery' },
            { id: 'ws-pos-x', label: 'Position X', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_x, key: 'wave_x' },
            { id: 'ws-pos-y', label: 'Position Y', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_y, key: 'wave_y' },
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
                this._applyToEngine(true);
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
            bv.wave_mystery = (Math.random() * 2) - 1;
            bv.wave_smoothing = Math.random();
            bv.wave_x = 0.3 + Math.random() * 0.4;
            bv.wave_y = 0.3 + Math.random() * 0.4;
            bv.wave_brighten = Math.random() > 0.70 ? 1 : 0;
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
        const map = [
            ['ws-scale', 'wave_scale', 0.1, 4.0],
            ['ws-opacity', 'wave_a', 0, 1.0],
            ['ws-smoothing', 'wave_smoothing', 0, 1.0],
            ['ws-mystery', 'wave_mystery', -1.0, 1.0],
            ['ws-pos-x', 'wave_x', 0, 1.0],
            ['ws-pos-y', 'wave_y', 0, 1.0],
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
        // Thickness toggle sync
        this._syncToggle('toggle-thick', 'wave_thick');
        // Toggles
        this._syncToggle('toggle-dots', 'wave_usedots');
        this._syncToggle('toggle-additive', 'additivewave');
        this._syncToggle('toggle-brighten', 'wave_brighten');
    }

    // ─── Motion reactivity (preset-only) ─────────────────────────────────────

    _buildMotionReactPanel() {
        const container = document.getElementById('motion-react-sliders');
        if (!container) return;

        const srcSel = document.getElementById('motion-react-source');
        if (srcSel) {
            srcSel.value = this.currentState.motionReact?.source || 'bass';
            srcSel.addEventListener('change', () => {
                this._preSnap();
                this.currentState.motionReact.source = srcSel.value;
                this._postSnap();
                this._applyToEngine(true);
            });
        }

        const curveBtns = document.querySelectorAll('#motion-react-curve .lseg');
        curveBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curve === (this.currentState.motionReact?.curve || 'linear'));
            btn.addEventListener('click', () => {
                this._preSnap();
                curveBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentState.motionReact.curve = btn.dataset.curve;
                this._postSnap();
                this._applyToEngine(true);
            });
        });

        const configs = [
            { id: 'mr-zoom', label: 'Zoom', min: -0.25, max: 0.25, step: 0.01, value: 0, key: 'zoomAmt' },
            { id: 'mr-rot', label: 'Spin', min: -0.30, max: 0.30, step: 0.01, value: 0, key: 'rotAmt' },
            { id: 'mr-warp', label: 'Warp', min: -2.00, max: 2.00, step: 0.05, value: 0, key: 'warpAmt' },
            { id: 'mr-wspd', label: 'Warp Speed', min: -1.00, max: 1.00, step: 0.02, value: 0, key: 'warpSpeedAmt' },
            { id: 'mr-dx', label: 'Drift H', min: -0.08, max: 0.08, step: 0.002, value: 0, key: 'driftXAmt' },
            { id: 'mr-dy', label: 'Drift V', min: -0.08, max: 0.08, step: 0.002, value: 0, key: 'driftYAmt' },
        ];

        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.motionReact[cfg.key] = v;
                this._applyToEngine(true);
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });
    }

    _syncMotionReact() {
        const mr = this.currentState.motionReact || (this.currentState.motionReact = deepClone(BLANK.motionReact));
        const srcSel = document.getElementById('motion-react-source');
        if (srcSel) srcSel.value = mr.source || 'bass';
        const curveBtns = document.querySelectorAll('#motion-react-curve .lseg');
        curveBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.curve === (mr.curve || 'linear')));

        const map = [
            ['mr-zoom', 'zoomAmt', -0.25, 0.25],
            ['mr-rot', 'rotAmt', -0.30, 0.30],
            ['mr-warp', 'warpAmt', -2.00, 2.00],
            ['mr-wspd', 'warpSpeedAmt', -1.00, 1.00],
            ['mr-dx', 'driftXAmt', -0.08, 0.08],
            ['mr-dy', 'driftYAmt', -0.08, 0.08],
        ];
        map.forEach(([id, key, min, max]) => {
            const input = document.getElementById(id);
            if (!input) return;
            const v = Number(mr[key] || 0);
            input.value = v;
            const valEl = document.getElementById(`${id}-val`);
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
        });
    }

    // ─── Feel sliders ──────────────────────────────────────────────────────────

    _buildFeelSliders() {
        const container = document.getElementById('motion-feel-sliders');
        if (!container) return;

        // Beat sensitivity (baseVal) — saved in preset, requires undo snap
        const b1edCfg = { id: 'fs-b1ed', label: 'Beat Sensitivity', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.b1ed };
        const b1edInput = makeSlider(container, b1edCfg);
        const b1edValEl = document.getElementById('fs-b1ed-val');
        b1edInput.addEventListener('pointerdown', () => this._preSnap());
        b1edInput.addEventListener('input', () => {
            const v = parseFloat(b1edInput.value);
            if (b1edValEl) b1edValEl.textContent = v.toFixed(2);
            b1edInput.style.setProperty('--pct', `${v * 100}%`);
            this.currentState.baseVals.b1ed = v;
            this._applyToEngine(true);
        });
        b1edInput.addEventListener('pointerup', () => this._postSnap());
    }

    _syncFeelSliders() {
        this._syncSlider('fs-b1ed', this.currentState.baseVals.b1ed, 0, 1.0, 2);
    }

    // ─── Toggles ───────────────────────────────────────────────────────────────

    _bindToggles() {
        const map = {
            'toggle-invert': 'invert',
            'toggle-darken': 'darken',
            'toggle-brighten-fx': 'brighten',
            'toggle-solarize': 'solarize',
            'toggle-darken-center': 'darken_center',
            'toggle-dots': 'wave_usedots',
            'toggle-additive': 'additivewave',
            'toggle-brighten': 'wave_brighten',
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
                    this._buildCompShader();
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
            this._loadStateToEngine(this.originalState);
        });
        const end = () => {
            if (!this._abActive) return;
            this._abActive = false;
            btn.classList.remove('active');
            this._loadStateToEngine(this.currentState);
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

        cancel?.addEventListener('click', () => { if (modal) modal.hidden = true; });

        modal?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') modal.hidden = true;
        });
    }

    // ─── Reset ─────────────────────────────────────────────────────────────────

    _bindReset() {
        document.getElementById('btn-reset')?.addEventListener('click', () => {
            this._preSnap();
            this._clearForLoad();

            const v0 = BASE_VARIATIONS[DEFAULT_VARIATION_INDEX];
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
            this.currentState.solidReactSource = v0.solidReactSource ?? 'bass';
            this.currentState.solidReactCurve = v0.solidReactCurve ?? 'linear';

            this._postSnap();
            this._buildCompShader();
            this._applyToEngine();
            this._syncAllControls();
            this._updateLayersBar();
            this._updateSolidFxVisibility(v0);
            // Re-highlight the default variation (Shift)
            document.querySelectorAll('.base-var-btn').forEach((el, idx) => {
                el.classList.toggle('active', idx === DEFAULT_VARIATION_INDEX);
            });
        });
    }

    /** Reset the editor to a known-clean state. Shared by reset, loadBundledPreset,
     *  and loadPresetData so all three start from the same baseline. Callers then
     *  overlay their own data on top. */
    _clearForLoad() {
        const layersEl = document.getElementById('image-layers');
        if (layersEl) layersEl.innerHTML = '';
        for (const texName of Object.keys(this._imageTextures)) {
            this.engine.removeGifAnimation?.(texName);
        }
        this._imageTextures = {};

        this.currentState = deepClone(BLANK);
        this._baseComp = BLANK_COMP_RAW;

        this._solidColor = null;
        this._imagesOnly = false;

        this._clearPaletteActive();
        document.querySelectorAll('.base-var-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('#scene-mirror-seg .seg').forEach(s => {
            s.classList.toggle('active', s.dataset.smirror === 'none');
        });
        const ioToggle = document.getElementById('toggle-images-only');
        if (ioToggle) ioToggle.checked = false;

        // Wipe butterchurn's feedback buffer so pixels from the previous preset
        // don't bleed through (the auto-built comp shader samples sampler_main
        // and amplifies it 2×, which prevents natural decay).
        this.engine.clearFeedbackBuffer?.();
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
        zone.addEventListener('drop', async (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showToast('Drop an image file here (JPG, PNG, GIF, WebP…)', true);
                return;
            }
            // Intercept GIFs for optimization check
            if (file.type === 'image/gif') {
                await this._handleGifUpload(file);
                return;
            }
            this._addImageLayer(file);
        });
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showToast('Please choose an image file (JPG, PNG, GIF, WebP…)', true);
                fileInput.value = '';
                return;
            }
            // Intercept GIFs for optimization check
            if (file.type === 'image/gif') {
                await this._handleGifUpload(file);
                fileInput.value = '';
                return;
            }
            this._addImageLayer(file);
            fileInput.value = '';
        });
    }

    // ─── GIF Optimizer ─────────────────────────────────────────────────────────

    async _handleGifUpload(file) {
        // Check layer limit first
        if (!this.currentState.images) this.currentState.images = [];
        if (this.currentState.images.length >= MAX_LAYERS) {
            showToast(`Max ${MAX_LAYERS} image layers`, true);
            return;
        }

        try {
            // Parse the GIF to check if optimization is needed
            const gifData = await parseGifFile(file);

            // If it doesn't need optimization, add directly
            if (!shouldOptimize(gifData)) {
                this._addImageLayer(file);
                return;
            }

            // Show optimizer modal
            await this._showGifOptimizerModal(file, gifData);
        } catch (err) {
            console.error('GIF parse error:', err);
            // Fallback: add as-is if parsing fails
            this._addImageLayer(file);
        }
    }

    async _showGifOptimizerModal(file, gifData) {
        const modal = document.getElementById('gif-optimizer-modal');
        if (!modal) {
            // Modal not found, add as-is
            this._addImageLayer(file);
            return;
        }

        // Store current optimization state
        this._gifOptimizerState = {
            file,
            gifData,
            keepEveryN: 1,
            targetSize: 0,
            processed: null,
            _rec: null
        };

        // Get recommendations
        const rec = getRecommendedSettings(gifData);
        this._gifOptimizerState._rec = rec;
        this._gifOptimizerState.keepEveryN = rec.keepEveryN;
        this._gifOptimizerState.targetSize = rec.targetSize;

        // Update stats display
        document.getElementById('gif-opt-filename').textContent = gifData.fileName;
        document.getElementById('gif-opt-size').textContent = `${gifData.width} × ${gifData.height}`;
        document.getElementById('gif-opt-frames').textContent = `${gifData.frameCount} frames`;
        document.getElementById('gif-opt-filesize').textContent = formatBytes(gifData.fileSize);

        const gpuBytes = estimateGpuMemory(gifData.width, gifData.height, gifData.frameCount);
        document.getElementById('gif-opt-gpu').textContent = `~${formatBytes(gpuBytes)} GPU`;

        // Show warning if applicable
        const warningEl = document.getElementById('gif-opt-warning');
        if (rec.reason) {
            warningEl.textContent = `⚠️ ${rec.reason}`;
            warningEl.style.display = 'block';
        } else {
            warningEl.style.display = 'none';
        }

        // Set initial control values
        const nthSlider = document.getElementById('gif-opt-nth');
        nthSlider.value = this._gifOptimizerState.keepEveryN;
        document.getElementById('gif-opt-nth-val').textContent = this._gifOptimizerState.keepEveryN;

        // Set initial size button
        document.querySelectorAll('.gif-opt-size-btn').forEach(btn => {
            const size = parseInt(btn.dataset.size);
            btn.classList.toggle('active', size === this._gifOptimizerState.targetSize);
            if (size === this._gifOptimizerState.targetSize) {
                btn.style.background = 'var(--accent)';
                btn.style.color = 'white';
            } else {
                btn.style.background = 'var(--bg-1)';
                btn.style.color = '';
            }
        });

        // Initial preview update
        await this._updateGifOptimizerPreview();

        // Show modal
        modal.hidden = false;
    }

    async _updateGifOptimizerPreview() {
        const state = this._gifOptimizerState;
        if (!state) return;

        const { gifData, keepEveryN, targetSize } = state;

        // Process frames with current settings
        const processed = await processGifFrames(gifData, { keepEveryN, targetSize });
        state.processed = processed;

        // Update result text
        const originalBytes = estimateGpuMemory(gifData.width, gifData.height, gifData.frameCount);
        const newBytes = estimateGpuMemory(processed.width, processed.height, processed.frameCount);
        const savings = ((originalBytes - newBytes) / originalBytes * 100).toFixed(0);

        // Cadence stats from processed delays
        const avgMs = Math.round(processed.delays.reduce((a, b) => a + b, 0) / processed.delays.length);
        const minMs = Math.min(...processed.delays);
        const maxMs = Math.max(...processed.delays);
        const variance = maxMs - minMs;
        const cadenceStr = variance <= 5
            ? `${avgMs}ms/frame (even)`
            : `${avgMs}ms/frame avg · ±${Math.round(variance / 2)}ms`;

        document.getElementById('gif-opt-result-frames').textContent = `${processed.frameCount} frames`;
        document.getElementById('gif-opt-result-text').innerHTML =
            `${processed.width} × ${processed.height} · ${processed.frameCount} frames · ~${formatBytes(newBytes)} GPU ` +
            `<span style="color:var(--success);">(${savings}% smaller)</span>` +
            `<br><span style="color:var(--text-3);font-size:12px;">Cadence: ${cadenceStr}</span>`;

        // Update resize dims text
        if (targetSize > 0 && (gifData.width > targetSize || gifData.height > targetSize)) {
            const scale = targetSize / Math.max(gifData.width, gifData.height);
            const newW = Math.round(gifData.width * scale);
            const newH = Math.round(gifData.height * scale);
            document.getElementById('gif-opt-resize-dims').textContent = `${newW} × ${newH}`;
        } else {
            document.getElementById('gif-opt-resize-dims').textContent = 'Original size';
        }

        // Generate frame strip preview
        const strip = document.getElementById('gif-opt-frame-strip');
        strip.innerHTML = '';

        const previews = await generateFrameStrip(processed, 20);
        previews.forEach((preview, idx) => {
            const thumb = document.createElement('div');
            thumb.style.cssText = 'flex-shrink:0;width:80px;height:80px;border-radius:6px;overflow:hidden;position:relative;box-shadow:0 2px 4px rgba(0,0,0,0.3);';
            thumb.innerHTML = `
                <img src="${preview.dataUrl}" style="width:100%;height:100%;object-fit:cover;">
                <span style="position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.8);color:white;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:500;">${preview.index + 1}</span>
            `;
            strip.appendChild(thumb);
        });
    }

    _bindGifOptimizer() {
        const modal = document.getElementById('gif-optimizer-modal');
        if (!modal) return;

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this._closeGifOptimizer(false);
        });

        // Cancel button
        document.getElementById('gif-opt-cancel')?.addEventListener('click', () => {
            this._closeGifOptimizer(false);
        });

        // Use As-Is button
        document.getElementById('gif-opt-as-is')?.addEventListener('click', () => {
            const state = this._gifOptimizerState;
            if (state?.file) {
                this._closeGifOptimizer(false);
                this._addImageLayer(state.file);
            }
        });

        // Apply button
        document.getElementById('gif-opt-apply')?.addEventListener('click', async () => {
            const state = this._gifOptimizerState;
            if (!state?.processed) return;

            this._closeGifOptimizer(false);

            // Create a modified file with processed frames
            // We pass the processed data directly to _addImageLayer
            await this._addOptimizedGifLayer(state.file, state.processed);
        });

        // Nth frame slider
        const nthSlider = document.getElementById('gif-opt-nth');
        nthSlider?.addEventListener('input', async (e) => {
            const n = parseInt(e.target.value);
            document.getElementById('gif-opt-nth-val').textContent = n;
            if (this._gifOptimizerState) {
                this._gifOptimizerState.keepEveryN = n;
                await this._updateGifOptimizerPreview();
            }
        });

        // Size buttons
        document.querySelectorAll('.gif-opt-size-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const size = parseInt(btn.dataset.size);
                if (this._gifOptimizerState) {
                    this._gifOptimizerState.targetSize = size;

                    // Update button styling
                    document.querySelectorAll('.gif-opt-size-btn').forEach(b => {
                        const bSize = parseInt(b.dataset.size);
                        b.classList.toggle('active', bSize === size);
                        if (bSize === size) {
                            b.style.background = 'var(--accent)';
                            b.style.color = 'white';
                        } else {
                            b.style.background = 'var(--bg-1)';
                            b.style.color = '';
                        }
                    });

                    await this._updateGifOptimizerPreview();
                }
            });
        });

        // Intent preset buttons
        document.querySelectorAll('.gif-opt-intent-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!this._gifOptimizerState) return;
                const { intent } = btn.dataset;
                const rec = this._gifOptimizerState._rec || { keepEveryN: 3 };
                const presets = {
                    smooth: { keepEveryN: 1, targetSize: 0 },
                    detail: { keepEveryN: 2, targetSize: 0 },
                    light: { keepEveryN: Math.max(rec.keepEveryN, 3), targetSize: 128 },
                };
                const p = presets[intent];
                if (!p) return;
                this._gifOptimizerState.keepEveryN = p.keepEveryN;
                this._gifOptimizerState.targetSize = p.targetSize;

                // Sync nth slider
                const nthSlider = document.getElementById('gif-opt-nth');
                if (nthSlider) { nthSlider.value = p.keepEveryN; document.getElementById('gif-opt-nth-val').textContent = p.keepEveryN; }

                // Sync size buttons
                document.querySelectorAll('.gif-opt-size-btn').forEach(b => {
                    const bSize = parseInt(b.dataset.size);
                    b.classList.toggle('active', bSize === p.targetSize);
                    b.style.background = bSize === p.targetSize ? 'var(--accent)' : 'var(--bg-1)';
                    b.style.color = bSize === p.targetSize ? 'white' : '';
                });

                // Highlight active intent
                document.querySelectorAll('.gif-opt-intent-btn').forEach(b => {
                    b.style.borderColor = b === btn ? 'var(--accent)' : 'var(--border)';
                    b.style.color = b === btn ? 'var(--accent)' : '';
                });

                await this._updateGifOptimizerPreview();
            });
        });
    }

    _closeGifOptimizer(cancelled) {
        const modal = document.getElementById('gif-optimizer-modal');
        if (modal) modal.hidden = true;
        this._gifOptimizerState = null;
    }

    async _addOptimizedGifLayer(originalFile, processedData) {
        // Create a wrapper that the visualizer will recognize as a pre-processed GIF
        // We need to pass the processed frames directly to avoid re-parsing

        // Generate a data URL from the first frame as the "preview"
        const canvas = document.createElement('canvas');
        canvas.width = processedData.width;
        canvas.height = processedData.height;
        const ctx = canvas.getContext('2d');

        if (processedData.frames.length > 0) {
            const imageData = new ImageData(processedData.frames[0], processedData.width, processedData.height);
            ctx.putImageData(imageData, 0, 0);
        }

        const previewDataUrl = canvas.toDataURL('image/png');

        // Store processed data for the visualizer to pick up
        const processedGifKey = `processed_gif_${Date.now()}`;
        this._processedGifCache = this._processedGifCache || new Map();
        this._processedGifCache.set(processedGifKey, {
            frames: processedData.frames,
            delays: processedData.delays,
            width: processedData.width,
            height: processedData.height,
            originalFileName: originalFile.name
        });

        // Create a modified file object that carries the cache key
        const modifiedFile = new File([originalFile], originalFile.name, {
            type: originalFile.type
        });
        modifiedFile._processedGifKey = processedGifKey;

        this._addImageLayer(modifiedFile);

        showToast(`Added optimized GIF: ${processedData.frameCount} frames, ${processedData.width}×${processedData.height}`, false);
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

        // ── Check for pre-processed optimized GIF ──────────────────────────────
        let optimizedGifData = null;
        if (file._processedGifKey && this._processedGifCache?.has(file._processedGifKey)) {
            optimizedGifData = this._processedGifCache.get(file._processedGifKey);
            // Clean up cache entry
            this._processedGifCache.delete(file._processedGifKey);
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
        if (resized.resized && !optimizedGifData) {
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
            imageSaturation: 1.00, // per-layer saturation (0=grey, 1=original, 2=vivid)
            imageHue: 0,           // per-layer static hue offset in degrees (0–360)
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
            gifSpeed: 2.0,      // playback multiplier: 2 = twice as fast, 0.5 = half speed
            gifStability: 0.0,  // timing smoothing: 0 = native delays, 1 = perfectly even cadence
            alphaMode: (resized.isGif || false) ? 'preserve' : 'fade',  // 'fade' = raw alpha (default for stills), 'preserve' = silhouette stays solid while opacity fades
            reactSource: 'bass',   // Phase 5: 'bass' | 'mid' | 'treb' | 'vol'
            reactCurve: 'linear',  // Phase 5: 'linear' | 'squared' | 'cubed' | 'threshold'
            orbitMode: 'circle',   // Phase 6: 'circle' | 'lissajous'
            lissFreqX: 0.50,       // Lissajous X-axis frequency (Hz)
            lissFreqY: 0.75,       // Lissajous Y-axis frequency (Hz) — 3:2 ratio default
            lissPhase: 0.25,       // Lissajous X phase offset (0–1 cycles)
            strobeAmp: 0.00,       // Phase 6: hard beat-cut intensity (0=off, 1=full black)
            strobeThr: 0.40,       // audio threshold to trigger strobe
            chromaticAberration: 0.00,  // RGB split amount (0-1)
            chromaticSpeed: 1.00,       // animation speed multiplier
            tileScaleX: 1.00,      // independent tile cell width multiplier (1 = auto/native aspect)
            tileScaleY: 1.00,      // independent tile cell height multiplier (1 = auto/native aspect)
            angle: 0.00,           // static rotation offset in degrees (−180 to +180); added to _spinAng
            skewX: 0.00,           // horizontal shear (−1 to +1); applied after rotation
            skewY: 0.00,           // vertical shear (−1 to +1); applied after rotation
            shakeAmp: 0.00,        // beat shake: random 2D UV impulse on each beat (0–1)
            posterize: 0,          // color bucket count (0 = off, 2–16 steps)
            depthOffset: 0.00,     // tunnel Z-phase offset (0–1) for parallax depth
            edgeSobel: false,      // Edge / Sobel mode: replaces image with neon line art
            perspX: 0.00,          // perspective tilt X (−1 to +1): horizontal vanishing point
            perspY: 0.00,          // perspective tilt Y (−1 to +1): vertical vanishing point
            isHd: hdMode,          // badge shown in card header
        };
        this.currentState.images.push(entry);

        const texObj = {
            data: resized.dataURL,
            width: optimizedGifData ? optimizedGifData.width : resized.width,
            height: optimizedGifData ? optimizedGifData.height : resized.height,
            isGif: resized.isGif || false,
            gifSpeed: entry.gifSpeed,
            optimizedGifData // Pass pre-processed frames to visualizer if available
        };
        this._mountLayerCard(entry, texObj);
        if (!resized.resized) showToast('Image layer added');
        if (this.currentState.images.length === 1) showHint();
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
            <div class="layer-header-row1">
              <span class="layer-drag-handle"
                    tabindex="0" role="button" aria-label="Drag to reorder layer">
                <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true">
                  <circle cx="3" cy="2"  r="1.1" fill="currentColor"/>
                  <circle cx="7" cy="2"  r="1.1" fill="currentColor"/>
                  <circle cx="3" cy="7"  r="1.1" fill="currentColor"/>
                  <circle cx="7" cy="7"  r="1.1" fill="currentColor"/>
                  <circle cx="3" cy="12" r="1.1" fill="currentColor"/>
                  <circle cx="7" cy="12" r="1.1" fill="currentColor"/>
                </svg>
              </span>
              <canvas class="layer-thumb" width="64" height="64" aria-hidden="true"></canvas>
              <div class="layer-meta">
                <input type="text" class="layer-name-input" maxlength="32" spellcheck="false"
                       aria-label="Layer name" />
              </div>
              <svg class="layer-chevron" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="layer-header-row2">
              <div class="layer-header-row2-badges">
                ${entry.isHd ? '<span class="layer-hd-badge" data-tooltip="Uploaded at HD (2048px). Re-upload to change.">HD</span>' : ''}
              </div>
              <div class="layer-header-row2-actions">
                <button class="layer-action-btn layer-solo" type="button"
                        aria-pressed="false" data-tooltip="Solo (show only this layer)">Solo</button>
                <button class="layer-action-btn layer-mute" type="button"
                        aria-pressed="false" data-tooltip="Mute (hide this layer)">Mute</button>
                <button class="layer-action-btn layer-copy" type="button"
                        data-tooltip="Duplicate this layer">Dupe</button>
                <button class="layer-action-btn layer-reset" type="button"
                        data-tooltip="Reset this layer (undoable)">Reset</button>
                <button class="layer-remove" type="button" data-tooltip="Delete layer">Delete</button>
              </div>
            </div>
          </div>
          <div class="layer-controls">
            ${entry.isGif ? `
            <p class="layer-section-label">Animation</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="GIF playback speed (0.25× to 8×). Default 1.2× — most GIFs feel a touch slow at native speed.">Speed</span>
              <input type="range" class="slider layer-gif-speed-sl" min="0" max="1" step="0.001"
                value="${(Math.log(entry.gifSpeed / 0.25) / Math.log(32)).toFixed(4)}" style="--pct:${((Math.log(entry.gifSpeed / 0.25) / Math.log(32)) * 100).toFixed(1)}%">
              <span class="lsv layer-gif-speed-val">${entry.gifSpeed.toFixed(2)}×</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Smooths uneven per-frame timing — 0 = native GIF delays, 1 = perfectly even cadence. Helps stuttery GIFs.">Stability</span>
              <input type="range" class="slider layer-gif-stability-sl" min="0" max="1" step="0.01"
                value="${(entry.gifStability || 0).toFixed(2)}" style="--pct:${((entry.gifStability || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-gif-stability-val">${(entry.gifStability || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline" style="margin-top:4px">
              <span class="layer-ctrl-label" data-tooltip="Fade: opacity multiplies raw alpha — soft edges disappear first. Preserve: silhouette is held solid, the whole image fades uniformly.">Alpha</span>
              <div class="layer-alpha-mode-seg" role="group" aria-label="Alpha mode">
                <button class="lseg${(entry.alphaMode || 'fade') === 'fade' ? ' active' : ''}" data-alpha-mode="fade">Fade</button>
                <button class="lseg${(entry.alphaMode || 'fade') === 'preserve' ? ' active' : ''}" data-alpha-mode="preserve">Preserve</button>
              </div>
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
              <span class="layer-ctrl-label">Size</span>
              <input type="range" class="slider layer-size-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.size - 0.05) / 1.45).toFixed(3)}" style="--pct:${(Math.sqrt((entry.size - 0.05) / 1.45) * 100).toFixed(1)}%">
              <span class="lsv layer-size-val">${entry.size.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="0 = square · 0.5 = circle">Radius</span>
              <input type="range" class="slider layer-radius-sl" min="0" max="0.5" step="0.01"
                value="${(entry.radius || 0).toFixed(2)}" style="--pct:${pct(entry.radius || 0, 0, 0.5)}">
              <span class="lsv layer-radius-val">${(entry.radius || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-spacing-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label">Spacing</span>
              <input type="range" class="slider layer-spacing-sl" min="0" max="0.8" step="0.01"
                value="${entry.spacing}" style="--pct:${pct(entry.spacing, 0, 0.8)}">
              <span class="lsv layer-spacing-val">${entry.spacing.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-tile-scale-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label">Width</span>
              <input type="range" class="slider layer-tile-sx-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.tileScaleX - 0.25) / 3.75).toFixed(3)}" style="--pct:${(Math.sqrt((entry.tileScaleX - 0.25) / 3.75) * 100).toFixed(1)}%">
              <span class="lsv layer-tile-sx-val">${entry.tileScaleX.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-tile-scale-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label">Height</span>
              <input type="range" class="slider layer-tile-sy-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.tileScaleY - 0.25) / 3.75).toFixed(3)}" style="--pct:${(Math.sqrt((entry.tileScaleY - 0.25) / 3.75) * 100).toFixed(1)}%">
              <span class="lsv layer-tile-sy-val">${entry.tileScaleY.toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Spin</span>
              <input type="range" class="slider layer-slider-inline layer-spin-sl" min="-3" max="3" step="0.05"
                value="${entry.spinSpeed}" style="--pct:${pct(entry.spinSpeed, -3, 3)}">
              <span class="lsv layer-spin-val">${entry.spinSpeed.toFixed(2)}</span>
              <span class="layer-group-spin-wrap"${entry.tile ? '' : ' style="display:none"'}>
                <span class="layer-ctrl-label" style="margin-left:8px;width:auto" data-tooltip="Rotate the whole tile grid instead of each tile">Group</span>
                <label class="toggle-switch toggle-switch--sm">
                  <input type="checkbox" class="layer-group-spin" />
                  <span class="toggle-track"><span class="toggle-thumb"></span></span>
                </label>
              </span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Angle</span>
              <input type="range" class="slider layer-slider-inline layer-angle-sl" min="-180" max="180" step="1"
                value="${(entry.angle || 0).toFixed(0)}" style="--pct:${pct(entry.angle || 0, -180, 180)}">
              <span class="lsv layer-angle-val">${(entry.angle || 0).toFixed(0)}°</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Skew X</span>
              <input type="range" class="slider layer-slider-inline layer-skewx-sl" min="-1" max="1" step="0.01"
                value="${(entry.skewX || 0).toFixed(2)}" style="--pct:${pct(entry.skewX || 0, -1, 1)}">
              <span class="lsv layer-skewx-val">${(entry.skewX || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Skew Y</span>
              <input type="range" class="slider layer-slider-inline layer-skewy-sl" min="-1" max="1" step="0.01"
                value="${(entry.skewY || 0).toFixed(2)}" style="--pct:${pct(entry.skewY || 0, -1, 1)}">
              <span class="lsv layer-skewy-val">${(entry.skewY || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="Horizontal perspective — left/right edges converge to a vanishing point. Combine with Skew for full projective control.">Persp X</span>
              <input type="range" class="slider layer-slider-inline layer-persp-x-sl" min="-1" max="1" step="0.01"
                value="${(entry.perspX || 0).toFixed(2)}" style="--pct:${pct(entry.perspX || 0, -1, 1)}">
              <span class="lsv layer-persp-x-val">${(entry.perspX || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="Vertical perspective — top/bottom edges converge. Great for floor-tile or billboard-lean effects.">Persp Y</span>
              <input type="range" class="slider layer-slider-inline layer-persp-y-sl" min="-1" max="1" step="0.01"
                value="${(entry.perspY || 0).toFixed(2)}" style="--pct:${pct(entry.perspY || 0, -1, 1)}">
              <span class="lsv layer-persp-y-val">${(entry.perspY || 0).toFixed(2)}</span>
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
            <div class="layer-slider-row layer-tunnel-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label">Tunnel</span>
              <input type="range" class="slider layer-tunnel-sl" min="-2" max="2" step="0.05"
                value="${entry.tunnelSpeed}" style="--pct:${pct(entry.tunnelSpeed, -2, 2)}">
              <span class="lsv layer-tunnel-val">${entry.tunnelSpeed.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-tunnel-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Shift this layer's zoom phase — offset two layers to get genuine parallax depth">Depth</span>
              <input type="range" class="slider layer-depth-sl" min="0" max="1" step="0.01"
                value="${(entry.depthOffset || 0).toFixed(2)}" style="--pct:${pct(entry.depthOffset || 0, 0, 1)}">
              <span class="lsv layer-depth-val">${(entry.depthOffset || 0).toFixed(2)}</span>
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
            <p class="layer-section-label">Pan</p>
            <div class="layer-row-inline layer-pan-mode-row">
              <span class="layer-ctrl-label">Mode</span>
              <div class="layer-pan-mode" role="group" aria-label="Pan mode">
                <button class="lseg${(entry.panMode || 'off') === 'off' ? ' active' : ''}" data-pan-mode="off">Off</button>
                <button class="lseg${entry.panMode === 'drift' ? ' active' : ''}" data-pan-mode="drift">Drift</button>
                <button class="lseg${entry.panMode === 'bounce' ? ' active' : ''}" data-pan-mode="bounce">Bounce</button>
              </div>
            </div>
            <div class="layer-pan-pad-wrap layer-pan-row"${(entry.panMode || 'off') === 'off' ? ' style="display:none"' : ''}>
              <canvas class="pan-pad" width="96" height="96" data-tooltip="Drag to set direction & speed — distance from center = speed"></canvas>
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
            <div class="layer-mirror-scope" role="group" aria-label="Mirror scope" hidden${entry.tile ? '' : ' style="display:none"'}>
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
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Saturation of this image layer (0=greyscale, 1=original, 2=vivid)">Saturation</span>
              <input type="range" class="slider layer-img-sat-sl" min="0" max="2" step="0.01"
                value="${(entry.imageSaturation ?? 1.0).toFixed(2)}" style="--pct:${pct(entry.imageSaturation ?? 1.0, 0, 2)}">
              <span class="lsv layer-img-sat-val">${(entry.imageSaturation ?? 1.0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Static hue rotation for this image layer (0–360°)">Hue</span>
              <input type="range" class="slider layer-img-hue-sl" min="0" max="360" step="1"
                value="${(entry.imageHue ?? 0)}" style="--pct:${pct(entry.imageHue ?? 0, 0, 360)}">
              <span class="lsv layer-img-hue-val">${(entry.imageHue ?? 0).toFixed(0)}°</span>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Visual Effects</p>
            <p class="layer-section-sub">Fluid color effects independent of audio.</p>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="RGB channel split — animates red and blue in opposite directions for a glitchy chromatic look">Chromatic</span>
              <input type="range" class="slider layer-slider-inline layer-chromatic-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt(entry.chromaticAberration).toFixed(3)}" style="--pct:${(Math.sqrt(entry.chromaticAberration) * 100).toFixed(1)}%">
              <span class="lsv layer-chromatic-val">${entry.chromaticAberration.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-chromatic-speed-row"${entry.chromaticAberration <= 0 ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label">Speed</span>
              <input type="range" class="slider layer-chromatic-speed-sl" min="0" max="4" step="0.1"
                value="${entry.chromaticSpeed}" style="--pct:${pct(entry.chromaticSpeed, 0, 4)}">
              <span class="lsv layer-chromatic-speed-val">${entry.chromaticSpeed.toFixed(1)}</span>
            </div>
            <div class="layer-row-inline" style="margin-top:4px">
              <span class="layer-ctrl-label">Posterize</span>
              <div class="layer-posterize-seg" role="group" aria-label="Posterize levels">
                <button class="lseg${(entry.posterize || 0) === 0 ? ' active' : ''}" data-posterize="0">Off</button>
                <button class="lseg${(entry.posterize || 0) === 2 ? ' active' : ''}" data-posterize="2">2</button>
                <button class="lseg${(entry.posterize || 0) === 4 ? ' active' : ''}" data-posterize="4">4</button>
                <button class="lseg${(entry.posterize || 0) === 8 ? ' active' : ''}" data-posterize="8">8</button>
                <button class="lseg${(entry.posterize || 0) === 16 ? ' active' : ''}" data-posterize="16">16</button>
              </div>
            </div>
            <div class="layer-row-inline" style="margin-top:4px">
              <span class="layer-ctrl-label" data-tooltip="Replaces the image with a Sobel edge-detected outline — neon line art mode. Pairs well with Tint + Hue Spin.">Edge</span>
              <div class="layer-edge-seg" role="group" aria-label="Edge detect">
                <button class="lseg${entry.edgeSobel ? '' : ' active'}" data-edge="off">Off</button>
                <button class="lseg${entry.edgeSobel ? ' active' : ''}" data-edge="on">On</button>
              </div>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Audio Reactivity</p>
            <p class="layer-section-sub">Source &amp; Curve shape the audio signal that powers all sound-driven effects on this layer.</p>
            <div class="layer-row-inline" style="gap:8px;margin-bottom:6px">
              <span class="layer-ctrl-label" data-tooltip="Which frequency band drives this layer — Bass = kicks, Mid = melody/snare, Treble = hi-hats, Volume = overall mix loudness">Source</span>
              <select class="layer-react-source">
                <option value="bass" selected>Bass</option>
                <option value="mid">Mid</option>
                <option value="treb">Treble</option>
                <option value="vol">Volume</option>
              </select>
            </div>
            <div class="layer-row-inline" style="gap:8px;margin-bottom:8px">
              <span class="layer-ctrl-label" data-tooltip="How the signal is shaped before reaching controls — Squared suppresses quiet hits, Cubed reserves reaction for the very loudest peaks, Gate flips binary on/off at 30%">Curve</span>
              <div class="layer-react-curve" role="group" aria-label="Reactivity curve">
                <button class="lseg active" data-curve="linear">Linear</button>
                <button class="lseg" data-curve="squared">Squared</button>
                <button class="lseg" data-curve="cubed">Cubed</button>
                <button class="lseg" data-curve="threshold">Gate</button>
              </div>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="Beat-driven size pulse — image grows (or shrinks) on every hit">Pulse</span>
              <input type="range" class="slider layer-slider-inline layer-pulse-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.audioPulse / 2).toFixed(3)}" style="--pct:${(Math.cbrt(entry.audioPulse / 2) * 100).toFixed(1)}%">
              <span class="lsv layer-pulse-val">${entry.audioPulse.toFixed(2)}</span>
              <span class="layer-ctrl-label" style="margin-left:8px;width:auto" data-tooltip="Shrink on beat instead of grow">Shrink</span>
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-pulse-inv" />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Bass pushes the image upward on every beat">Bounce</span>
              <input type="range" class="slider layer-bounce-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.bounceAmp / 0.4).toFixed(3)}" style="--pct:${(Math.cbrt(entry.bounceAmp / 0.4) * 100).toFixed(1)}%">
              <span class="lsv layer-bounce-val">${entry.bounceAmp.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Random 2D jolt on each beat — omnidirectional impulse, different from the directional Bounce">Shake</span>
              <input type="range" class="slider layer-shake-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.shakeAmp / 0.15).toFixed(3)}" style="--pct:${(Math.cbrt(entry.shakeAmp / 0.15) * 100).toFixed(1)}%">
              <span class="lsv layer-shake-val">${entry.shakeAmp.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Fades opacity in on every beat — layer pulses in and out with the music">Beat Fade</span>
              <input type="range" class="slider layer-beat-fade-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.opacityPulse).toFixed(3)}" style="--pct:${(Math.cbrt(entry.opacityPulse) * 100).toFixed(1)}%">
              <span class="lsv layer-beat-fade-val">${entry.opacityPulse.toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="Hard opacity cut when audio crosses threshold — instant strobe flash">Strobe</span>
              <input type="range" class="slider layer-slider-inline layer-strobe-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.strobeAmp).toFixed(3)}" style="--pct:${(Math.cbrt(entry.strobeAmp) * 100).toFixed(1)}%">
              <span class="lsv layer-strobe-amp-val">${entry.strobeAmp.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-strobe-thr-row"${entry.strobeAmp <= 0 ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label">Threshold</span>
              <input type="range" class="slider layer-strobe-thr-sl" min="0.1" max="0.9" step="0.05"
                value="${entry.strobeThr}" style="--pct:${pct(entry.strobeThr, 0.1, 0.9)}">
              <span class="lsv layer-strobe-thr-val">${entry.strobeThr.toFixed(2)}</span>
            </div>
          </div>
        `;

        // Populate the editable name input (value-set is safe — no innerHTML path)
        const nameInput = card.querySelector('.layer-name-input');
        nameInput.value = entry.name;
        nameInput.title = `Filename: ${entry.fileName || ''}`;

        // ── Wire controls ───────────────────────────────────────────────────
        // Debounced: prevents 30+ shader recompiles/sec during rapid slider moves.
        // One frame (16 ms) is enough to coalesce burst changes into a single rebuild.
        const refresh = () => {
            clearTimeout(this._shaderRebuildTimer);
            this._shaderRebuildTimer = setTimeout(() => {
                this._buildCompShader();
                this._applyToEngine();
            }, 16);
        };

        const blendSel = card.querySelector('.layer-blend');
        const tileCb = card.querySelector('.layer-tile');
        const pulseInvCb = card.querySelector('.layer-pulse-inv');

        const groupSpinCb = card.querySelector('.layer-group-spin');

        blendSel.addEventListener('change', () => { entry.blendMode = blendSel.value; refresh(); });
        const tunnelRow = card.querySelector('.layer-tunnel-row');
        const spacingRow = card.querySelector('.layer-spacing-row');
        const groupSpinWrap = card.querySelector('.layer-group-spin-wrap');
        const mirrorScopeRow = card.querySelector('.layer-mirror-scope');
        const tileScaleRows = card.querySelectorAll('.layer-tile-scale-row');
        tileCb.addEventListener('change', () => {
            entry.tile = tileCb.checked;
            if (tunnelRow) tunnelRow.style.display = entry.tile ? '' : 'none';
            if (spacingRow) spacingRow.style.display = entry.tile ? '' : 'none';
            if (groupSpinWrap) groupSpinWrap.style.display = entry.tile ? '' : 'none';
            if (mirrorScopeRow && entry.mirror !== 'none') mirrorScopeRow.style.display = entry.tile ? '' : 'none';
            tileScaleRows.forEach(r => { r.style.display = entry.tile ? '' : 'none'; });
            refresh();
        });
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

        // Angle inline slider — linear, degrees displayed with ° suffix
        const angleSlider = card.querySelector('.layer-angle-sl');
        const angleVal = card.querySelector('.layer-angle-val');
        angleSlider.addEventListener('input', () => {
            const v = parseFloat(angleSlider.value);
            entry.angle = v;
            angleVal.textContent = `${v.toFixed(0)}°`;
            angleSlider.style.setProperty('--pct', `${(((v - -180) / 360) * 100).toFixed(1)}%`);
            refresh();
        });

        // Skew X/Y sliders — linear, range −1 to +1
        const skewXSl = card.querySelector('.layer-skewx-sl');
        const skewXVal = card.querySelector('.layer-skewx-val');
        skewXSl.addEventListener('input', () => {
            const v = parseFloat(skewXSl.value);
            entry.skewX = v;
            skewXVal.textContent = v.toFixed(2);
            skewXSl.style.setProperty('--pct', `${(((v + 1) / 2) * 100).toFixed(1)}%`);
            refresh();
        });
        const skewYSl = card.querySelector('.layer-skewy-sl');
        const skewYVal = card.querySelector('.layer-skewy-val');
        skewYSl.addEventListener('input', () => {
            const v = parseFloat(skewYSl.value);
            entry.skewY = v;
            skewYVal.textContent = v.toFixed(2);
            skewYSl.style.setProperty('--pct', `${(((v + 1) / 2) * 100).toFixed(1)}%`);
            refresh();
        });

        // Pulse inline slider — cubic curve: fine control in low end, extreme at top quarter
        const pulseSlider = card.querySelector('.layer-pulse-sl');
        const pulseVal = card.querySelector('.layer-pulse-val');
        pulseSlider.addEventListener('input', () => {
            const pos = parseFloat(pulseSlider.value);
            const stored = pos * pos * pos * 2;
            entry.audioPulse = stored;
            pulseVal.textContent = stored.toFixed(2);
            pulseSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Bounce slider — cubic curve: fine control in low end, extreme at top quarter
        const bounceSlider = card.querySelector('.layer-bounce-sl');
        const bounceVal = card.querySelector('.layer-bounce-val');
        bounceSlider.addEventListener('input', () => {
            const pos = parseFloat(bounceSlider.value);
            const stored = pos * pos * pos * 0.4;
            entry.bounceAmp = stored;
            bounceVal.textContent = stored.toFixed(2);
            bounceSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Shake slider — cubic curve: pos³ * 0.15 maps [0,1] → [0, 0.15] UV units
        const shakeSlider = card.querySelector('.layer-shake-sl');
        const shakeVal = card.querySelector('.layer-shake-val');
        shakeSlider.addEventListener('input', () => {
            const pos = parseFloat(shakeSlider.value);
            const stored = pos * pos * pos * 0.15;
            entry.shakeAmp = stored;
            shakeVal.textContent = stored.toFixed(2);
            shakeSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
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

        // Tile scale X/Y sliders — squared curve: pos² maps [0,1] → [0.25,4.0]
        const tileSxSl = card.querySelector('.layer-tile-sx-sl');
        const tileSxVal = card.querySelector('.layer-tile-sx-val');
        tileSxSl.addEventListener('input', () => {
            const pos = parseFloat(tileSxSl.value);
            const stored = 0.25 + 3.75 * pos * pos;
            entry.tileScaleX = stored;
            tileSxVal.textContent = stored.toFixed(2);
            tileSxSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });
        const tileSySl = card.querySelector('.layer-tile-sy-sl');
        const tileSyVal = card.querySelector('.layer-tile-sy-val');
        tileSySl.addEventListener('input', () => {
            const pos = parseFloat(tileSySl.value);
            const stored = 0.25 + 3.75 * pos * pos;
            entry.tileScaleY = stored;
            tileSyVal.textContent = stored.toFixed(2);
            tileSySl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Remaining slider rows — DOM order must match sliderKeys exactly:
        // opacity, spacing, orbitRadius, tunnelSpeed,
        // swayAmt, swaySpeed, wanderAmt, wanderSpeed, hueSpinSpeed
        const sliderKeys = ['opacity', 'spacing', 'orbitRadius', 'tunnelSpeed', 'depthOffset',
            'swayAmt', 'swaySpeed', 'wanderAmt', 'wanderSpeed', 'hueSpinSpeed'];
        const sliderMins = [0, 0, 0, -2, 0, 0, 0, 0, 0, 0];
        const sliderMaxes = [1, 0.8, 0.45, 2, 1, 0.4, 4, 0.4, 2, 2];

        card.querySelectorAll('.layer-slider-row input[type=range]:not(.layer-bounce-sl):not(.layer-size-sl):not(.layer-liss-sl):not(.layer-strobe-thr-sl):not(.layer-pan-x-sl):not(.layer-pan-y-sl):not(.layer-pan-range-sl):not(.layer-beat-fade-sl):not(.layer-tile-sx-sl):not(.layer-tile-sy-sl):not(.layer-shake-sl):not(.layer-persp-x-sl):not(.layer-persp-y-sl):not(.layer-radius-sl):not(.layer-gif-speed-sl):not(.layer-gif-stability-sl)').forEach((sl, i) => {
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
                    const pos = parseFloat(gifSpeedSl.value);
                    const v = 0.25 * Math.pow(32, pos);
                    entry.gifSpeed = v;
                    gifSpeedVal.textContent = `${v.toFixed(2)}×`;
                    gifSpeedSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
                    this.engine.setGifAnimationSpeed(entry.texName, v);
                });
            }

            const alphaModebtns = card.querySelectorAll('.layer-alpha-mode-seg .lseg');
            alphaModebtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    alphaModebtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    entry.alphaMode = btn.dataset.alphaMode;
                    refresh();
                });
            });

            const gifStabilitySl = card.querySelector('.layer-gif-stability-sl');
            const gifStabilityVal = card.querySelector('.layer-gif-stability-val');
            if (gifStabilitySl) {
                gifStabilitySl.addEventListener('input', () => {
                    const v = parseFloat(gifStabilitySl.value);
                    entry.gifStability = v;
                    gifStabilityVal.textContent = v.toFixed(2);
                    gifStabilitySl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
                    this.engine.setGifAnimationStability(entry.texName, v);
                });
            }
        }

        // Tint color swatch
        const tintSwatch = card.querySelector('.layer-tint-swatch');
        // Per-layer Saturation slider
        const imgSatSl = card.querySelector('.layer-img-sat-sl');
        const imgSatVal = card.querySelector('.layer-img-sat-val');
        if (imgSatSl) {
            imgSatSl.addEventListener('input', () => {
                entry.imageSaturation = parseFloat(imgSatSl.value);
                imgSatVal.textContent = entry.imageSaturation.toFixed(2);
                imgSatSl.style.setProperty('--pct', `${(entry.imageSaturation / 2 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Hue slider
        const imgHueSl = card.querySelector('.layer-img-hue-sl');
        const imgHueVal = card.querySelector('.layer-img-hue-val');
        if (imgHueSl) {
            imgHueSl.addEventListener('input', () => {
                entry.imageHue = parseFloat(imgHueSl.value);
                imgHueVal.textContent = entry.imageHue.toFixed(0) + '°';
                imgHueSl.style.setProperty('--pct', `${(entry.imageHue / 360 * 100).toFixed(1)}%`);
                refresh();
            });
        }

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
        // Beat Fade slider — cubic curve
        const beatFadeSlider = card.querySelector('.layer-beat-fade-sl');
        const beatFadeVal = card.querySelector('.layer-beat-fade-val');
        beatFadeSlider.addEventListener('input', () => {
            const pos = parseFloat(beatFadeSlider.value);
            const stored = pos * pos * pos;
            entry.opacityPulse = stored;
            beatFadeVal.textContent = stored.toFixed(2);
            beatFadeSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        strobeSlider.addEventListener('input', () => {
            const pos = parseFloat(strobeSlider.value);
            const stored = pos * pos * pos;
            entry.strobeAmp = stored;
            strobeAmpVal.textContent = stored.toFixed(2);
            strobeSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            strobeThrRow.style.display = entry.strobeAmp > 0 ? '' : 'none';
            refresh();
        });
        strobeThrSl.addEventListener('input', () => {
            entry.strobeThr = parseFloat(strobeThrSl.value);
            strobeThrVal.textContent = entry.strobeThr.toFixed(2);
            strobeThrSl.style.setProperty('--pct', `${pct(entry.strobeThr, 0.1, 0.9)}`);
            refresh();
        });

        // Visual Effects: Chromatic Aberration
        const chromaticSl = card.querySelector('.layer-chromatic-sl');
        const chromaticVal = card.querySelector('.layer-chromatic-val');
        const chromaticSpeedRow = card.querySelector('.layer-chromatic-speed-row');
        const chromaticSpeedSl = card.querySelector('.layer-chromatic-speed-sl');
        const chromaticSpeedVal = card.querySelector('.layer-chromatic-speed-val');
        chromaticSl.addEventListener('input', () => {
            const pos = parseFloat(chromaticSl.value);
            const stored = pos * pos; // squared curve - more responsive at low end
            entry.chromaticAberration = stored;
            chromaticVal.textContent = stored.toFixed(2);
            chromaticSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            chromaticSpeedRow.style.display = stored > 0 ? '' : 'none';
            refresh();
        });
        chromaticSpeedSl.addEventListener('input', () => {
            entry.chromaticSpeed = parseFloat(chromaticSpeedSl.value);
            chromaticSpeedVal.textContent = entry.chromaticSpeed.toFixed(1);
            chromaticSpeedSl.style.setProperty('--pct', `${pct(entry.chromaticSpeed, 0, 4)}`);
            refresh();
        });

        // Perspective X / Y sliders
        const perspXSl = card.querySelector('.layer-persp-x-sl');
        const perspXVal = card.querySelector('.layer-persp-x-val');
        const perspYSl = card.querySelector('.layer-persp-y-sl');
        const perspYVal = card.querySelector('.layer-persp-y-val');
        perspXSl.addEventListener('input', () => {
            entry.perspX = parseFloat(perspXSl.value);
            perspXVal.textContent = entry.perspX.toFixed(2);
            perspXSl.style.setProperty('--pct', `${pct(entry.perspX, -1, 1)}`);
            refresh();
        });
        perspYSl.addEventListener('input', () => {
            entry.perspY = parseFloat(perspYSl.value);
            perspYVal.textContent = entry.perspY.toFixed(2);
            perspYSl.style.setProperty('--pct', `${pct(entry.perspY, -1, 1)}`);
            refresh();
        });

        const radiusSl = card.querySelector('.layer-radius-sl');
        const radiusVal = card.querySelector('.layer-radius-val');
        radiusSl.addEventListener('input', () => {
            entry.radius = parseFloat(radiusSl.value);
            radiusVal.textContent = entry.radius.toFixed(2);
            radiusSl.style.setProperty('--pct', `${pct(entry.radius, 0, 0.5)}`);
            refresh();
        });

        // Posterize segmented buttons
        const posterizeBtns = card.querySelectorAll('.layer-posterize-seg .lseg');
        posterizeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                posterizeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.posterize = parseInt(btn.dataset.posterize, 10);
                refresh();
            });
        });

        // Edge / Sobel toggle
        const edgeBtns = card.querySelectorAll('.layer-edge-seg .lseg');
        edgeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                edgeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.edgeSobel = btn.dataset.edge === 'on';
                refresh();
            });
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
        const panCurve = (t) => Math.sign(t) * t * t * PAN_MAX;          // pos → speed
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
            const tx = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width - 0.5) * 2));
            const ty = Math.max(-1, Math.min(1, ((clientY - rect.top) / rect.height - 0.5) * 2));
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
            if (e.target.closest('.layer-action-btn')) return;
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
        const copyBtn = card.querySelector('.layer-copy');
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._duplicateImageLayer(entry);
        });

        // ── Double-click label to reset slider ──────────────────────────────
        // Stamp each range input with its initial pos+val so we can restore without
        // knowing the per-slider curve. Then one delegated dblclick on any label
        // finds its sibling slider and fires a synthetic 'input' event to trigger
        // all the existing handler logic (entry update, display, --pct, refresh).
        card.querySelectorAll('.layer-row-inline, .layer-slider-row').forEach(row => {
            const sl = row.querySelector('input[type=range]');
            if (!sl) return;
            sl.dataset.defaultPos = sl.value;
            const label = row.querySelector('.layer-ctrl-label');
            if (label) label.classList.add('is-resettable');
        });
        card.addEventListener('dblclick', (e) => {
            const label = e.target.closest('.is-resettable');
            if (!label) return;
            const row = label.closest('.layer-row-inline, .layer-slider-row');
            if (!row) return;
            const sl = row.querySelector('input[type=range]');
            if (!sl || sl.dataset.defaultPos === undefined) return;
            sl.value = sl.dataset.defaultPos;
            sl.dispatchEvent(new Event('input', { bubbles: true }));
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
            const blob = (() => {
                const dataUrl = texObj.data;
                const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
                if (!match) throw new Error('Invalid cached texture data URL');
                const mime = match[1] || 'image/png';
                const isBase64 = !!match[2];
                const payload = match[3] || '';
                if (isBase64) {
                    const binary = atob(payload);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    return new Blob([bytes], { type: mime });
                }
                return new Blob([decodeURIComponent(payload)], { type: mime });
            })();
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

    // ─── Duplicate a layer ────────────────────────────────────────────────────

    _duplicateImageLayer(entry) {
        const texObj = this._imageTextures[entry.texName];
        if (!texObj) return;
        this._preSnap();

        // Generate a smart name: "face" → "face 2", "face 2" → "face 3", etc.
        const baseName = entry.name.replace(/ \d+$/, '');
        const existingNums = this.currentState.images
            .map(e => { const m = e.name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`)); return m ? parseInt(m[1]) : (e.name === baseName ? 1 : 0); })
            .filter(n => n > 0);
        const nextNum = existingNums.length ? Math.max(...existingNums) + 1 : 2;
        const newName = `${baseName} ${nextNum}`;

        // Deep-copy entry state; give it a fresh unique texName; start collapsed
        const newTexName = 'tex_' + Math.random().toString(36).slice(2, 9);
        const newEntry = { ...entry, texName: newTexName, name: newName, collapsed: true };
        this._imageTextures[newTexName] = texObj;

        // Collapse the source card
        entry.collapsed = true;
        const srcCard = document.querySelector(`#image-layers .image-layer-card[data-tex-name="${entry.texName}"]`);
        if (srcCard) {
            srcCard.classList.add('collapsed');
            srcCard.querySelector('.layer-header')?.setAttribute('aria-expanded', 'false');
        }

        // Insert into array right after the source entry
        const srcIdx = this.currentState.images.indexOf(entry);
        if (srcIdx !== -1) {
            this.currentState.images.splice(srcIdx + 1, 0, newEntry);
        } else {
            this.currentState.images.push(newEntry);
        }

        // Mount the card (appends to DOM), then move it into position
        this._mountLayerCard(newEntry, texObj);
        const layers = document.getElementById('image-layers');
        const byTex = new Map();
        layers.querySelectorAll('.image-layer-card').forEach(c => byTex.set(c.dataset.texName, c));
        this.currentState.images.forEach(e => {
            const c = byTex.get(e.texName);
            if (c) layers.appendChild(c);
        });

        // Scroll new card into view and flash its name
        const newCard = document.querySelector(`#image-layers .image-layer-card[data-tex-name="${newTexName}"]`);
        if (newCard) {
            newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            const nameInput = newCard.querySelector('.layer-name-input');
            if (nameInput) {
                nameInput.classList.add('layer-name-flash');
                setTimeout(() => nameInput.classList.remove('layer-name-flash'), 2500);
            }
        }

        this._updateLayerIndices();
        this._buildCompShader();
        this._applyToEngine();
        this._postSnap();
        showToast(`Duplicated as "${newName}"`);
    }

    // ─── Apply & sync ──────────────────────────────────────────────────────────

    _loadStateToEngine(state) {
        this.engine.loadPresetObject(this._buildRuntimePreset(state), 0);
    }

    _buildRuntimePreset(state) {
        const runtime = deepClone(state);
        const injected = this._buildMotionReactFrameEqs(state.motionReact);
        const baseFrame = runtime.frame_eqs_str || '';
        runtime.frame_eqs_str = injected
            ? `${baseFrame}\n${injected}`.trim()
            : baseFrame;
        return runtime;
    }

    _buildMotionReactFrameEqs(mr) {
        // butterchurn compiles frame_eqs_str as JavaScript with `a` as scope.
        // Use a.* properties and Math.* helpers (not bare MilkDrop identifiers).
        const conf = mr || BLANK.motionReact;
        const srcMap = { bass: 'a.bass', mid: 'a.mid', treb: 'a.treb', vol: 'a.vol' };
        const src = srcMap[conf.source] || 'a.bass';
        const curve = conf.curve || 'linear';

        const zoomAmt = Number(conf.zoomAmt || 0).toFixed(4);
        const rotAmt = Number(conf.rotAmt || 0).toFixed(4);
        const warpAmt = Number(conf.warpAmt || 0).toFixed(4);
        const warpSpeedAmt = Number(conf.warpSpeedAmt || 0).toFixed(4);
        const driftXAmt = Number(conf.driftXAmt || 0).toFixed(4);
        const driftYAmt = Number(conf.driftYAmt || 0).toFixed(4);

        const hasAny = [zoomAmt, rotAmt, warpAmt, warpSpeedAmt, driftXAmt, driftYAmt]
            .some(v => Math.abs(Number(v)) > 0.00001);
        if (!hasAny) return '';

        let curveExpr = '_mr_raw';
        if (curve === 'squared') curveExpr = '_mr_raw*_mr_raw';
        else if (curve === 'cubed') curveExpr = '_mr_raw*_mr_raw*_mr_raw';
        else if (curve === 'threshold') curveExpr = 'Math.max(0,Math.min(1,(_mr_raw-0.3)*8))';

        return [
            `var _mr_raw=${src};`,
            `var _mr=${curveExpr};`,
            `a.zoom=Math.max(0.30,Math.min(2.50,a.zoom+_mr*${zoomAmt}));`,
            `a.rot=Math.max(-2.00,Math.min(2.00,a.rot+_mr*${rotAmt}));`,
            `a.warp=Math.max(0.00,Math.min(5.00,a.warp+_mr*${warpAmt}));`,
            `a.warpanimspeed=Math.max(0.05,Math.min(5.00,a.warpanimspeed+_mr*${warpSpeedAmt}));`,
            `a.dx=Math.max(-0.25,Math.min(0.25,a.dx+_mr*${driftXAmt}));`,
            `a.dy=Math.max(-0.25,Math.min(0.25,a.dy+_mr*${driftYAmt}));`,
        ].join('\n');
    }

    _applyToEngine(skipTextures = false) {
        this._loadStateToEngine(this.currentState);
        if (!skipTextures) {
            for (const [name, texObj] of Object.entries(this._imageTextures)) {
                this.engine.setUserTexture(name, texObj);
            }
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
            const reactSrc = { bass: 'bass', mid: 'mid', treb: 'treb', vol: 'vol' }[this.currentState.solidReactSource || 'bass'] || 'bass';
            const solidCurve = this.currentState.solidReactCurve || 'linear';
            let solidCurveExpr;
            switch (solidCurve) {
                case 'squared': solidCurveExpr = '_sr_raw * _sr_raw'; break;
                case 'cubed': solidCurveExpr = '_sr_raw * _sr_raw * _sr_raw'; break;
                case 'threshold': solidCurveExpr = 'step(0.3, _sr_raw)'; break;
                default: solidCurveExpr = '_sr_raw';
            }
            // Breath: lerp between 1.0 (off) and a slow sine (0..1) by breath amount.
            // Pulse:  multiplies brightness by (1 + signal * pulse).
            // Shift:  mixes A→B by shaped signal * shift, clamped 0..1.
            base = uvFold +
                `  float _sr_raw = ${reactSrc};\n` +
                `  float _sr = ${solidCurveExpr};\n` +
                `  float _breath = mix(1.0, 0.5 + 0.5 * sin(time * 0.6), ${breath});\n` +
                `  float _pulse = 1.0 + _sr * ${pulse};\n` +
                `  float _shiftT = clamp(_sr * ${shift}, 0.0, 1.0);\n` +
                `  vec3 _colA = vec3(${aR}, ${aG}, ${aB});\n` +
                `  vec3 _colB = vec3(${bR}, ${bG}, ${bB});\n` +
                `  vec3 col = mix(_colA, _colB, _shiftT) * _breath * _pulse;\n`;
        } else {
            base = uvFold + `  vec3 col = ${mainSample};\n`;
        }
        const _bv = this.currentState.baseVals;
        const _sat = _bv.studio_saturation ?? 1.0;
        const _hue = _bv.studio_hue_rotate ?? 0;
        const _hasImages = visibleImages.length > 0;

        let body = base;
        // When images are present, apply sat/hue to `col` HERE — after `col` is
        // initialised from the MilkDrop background but BEFORE any image layer is
        // composited into it.  That way image pixels are never colour-shifted.
        if (_hasImages) {
            const _satHue = buildSatHueOnColGlsl(_sat, _hue);
            if (_satHue) body += _satHue;
        }
        for (const img of visibleImages) {
            body += this._buildImageBlock(img);
        }
        body += '  ret = col;\n';
        const _rawComp = `${uniforms}\n shader_body {\n${body} }`;
        this._baseComp = _rawComp;
        // With images: end-block uses defaults (sat=1, hue=0) — sat/hue already applied above.
        // Without images: end-block carries the full sat/hue as before.
        this.currentState.comp = injectStudioPostFx(_rawComp, _hasImages ? { sat: 1.0, hue: 0 } : { sat: _sat, hue: _hue });
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
        const chromAmt = (img.chromaticAberration || 0).toFixed(4);
        const chromSpd = (img.chromaticSpeed !== undefined ? img.chromaticSpeed : 1.0).toFixed(4);
        const hasChromatic = parseFloat(chromAmt) > 0.001;
        const tileScaleX = (img.tileScaleX !== undefined ? img.tileScaleX : 1.0).toFixed(4);
        const tileScaleY = (img.tileScaleY !== undefined ? img.tileScaleY : 1.0).toFixed(4);
        const angleDeg = (img.angle || 0);
        const angleRad = (angleDeg * Math.PI / 180).toFixed(6);
        const hasAngle = Math.abs(angleDeg) > 0.01;
        const skewX = (img.skewX || 0).toFixed(4);
        const skewY = (img.skewY || 0).toFixed(4);
        const hasSkew = Math.abs(img.skewX || 0) > 0.001 || Math.abs(img.skewY || 0) > 0.001;
        const shakeAmp = (img.shakeAmp || 0).toFixed(4);
        const hasShake = parseFloat(shakeAmp) > 0.0001;
        const posterize = parseInt(img.posterize || 0, 10);
        const hasPosterize = posterize >= 2;
        const depthOffset = (img.depthOffset || 0).toFixed(4);
        const perspX = (img.perspX || 0).toFixed(4);
        const perspY = (img.perspY || 0).toFixed(4);
        const hasPersp = Math.abs(img.perspX || 0) > 0.001 || Math.abs(img.perspY || 0) > 0.001;
        const rad = (img.radius || 0).toFixed(4);
        const hasRadius = parseFloat(rad) > 0.001;
        const hasEdge = !!img.edgeSobel;
        // Pixel step for Sobel: 1/texW × 1/texH, falling back to 1/512
        const edgeStepX = img.texW ? (1.0 / img.texW).toFixed(6) : '0.001953';
        const edgeStepY = img.texH ? (1.0 / img.texH).toFixed(6) : '0.001953';
        const tex = `sampler_${img.texName}`;
        const imgAsp = (img.texW && img.texH) ? (img.texW / img.texH).toFixed(4) : '1.0000';

        const reactSrc = { bass: 'bass', mid: 'mid', treb: 'treb', vol: 'vol' }[img.reactSource || 'bass'] || 'bass';
        const curve = img.reactCurve || 'linear';
        let curveExpr;
        switch (curve) {
            case 'squared': curveExpr = '_r_raw * _r_raw'; break;
            case 'cubed': curveExpr = '_r_raw * _r_raw * _r_raw'; break;
            case 'threshold': curveExpr = 'step(0.3, _r_raw)'; break;
            default: curveExpr = '_r_raw'; // linear
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
        const hasSpin = parseFloat(sp) !== 0 || hasAngle;
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
        const perTileSpin = img.tile && hasSpin && !img.groupSpin && (parseFloat(sp) !== 0 || hasAngle);
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
        if (hasSpin) {
            const spinExpr = parseFloat(sp) !== 0
                ? (hasAngle ? `time * ${sp} + ${angleRad}` : `time * ${sp}`)
                : angleRad;
            angLines += `    float _spinAng = ${spinExpr};\n`;
        }

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

        // Beat shake: random 2D UV impulse each beat, driven by audio reactivity.
        // hash2(floor(time*24)) gives a new random direction ~24 times/sec (faster than most tempos)
        // so it always fires on the beat. Amplitude scales with _r (the shaped audio signal).
        if (hasShake) {
            centerLines +=
                `    { vec2 _shk; float _st = floor(time * 24.0);
` +
                `      _shk.x = fract(sin(_st * 127.1 + 311.7) * 43758.5453) - 0.5;
` +
                `      _shk.y = fract(sin(_st * 269.5 + 183.3) * 43758.5453) - 0.5;
` +
                `      _u += _shk * _r * ${shakeAmp} * 2.0; }\n`;
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

        // Skew (2×2 shear) — applied after rotation, before tiling/sizing.
        // u.x += skewX * u.y;  u.y += skewY * u_x_orig
        // Only emitted when at least one skew value is non-zero.
        const applySkew = (varName) => {
            if (!hasSkew) return '';
            let s = `    { float _sx = ${varName}.x;
`;
            if (Math.abs(img.skewX || 0) > 0.001) s += `      ${varName}.x += ${skewX} * ${varName}.y;\n`;
            if (Math.abs(img.skewY || 0) > 0.001) s += `      ${varName}.y += ${skewY} * _sx;\n`;
            s += `    }\n`;
            return s;
        };

        // Perspective projective warp — applied after skew, before aspectPreScale.
        // Divides each axis by a depth term that varies linearly across the other axis,
        // making parallel lines converge to a vanishing point.
        // Clamp denominator to avoid singularity at extreme slider values.
        const applyPersp = (varName) => {
            if (!hasPersp) return '';
            let s = `    {\n`;
            if (Math.abs(img.perspY || 0) > 0.001)
                s += `      float _dpx = clamp(1.0 + ${perspY} * ${varName}.y, 0.1, 10.0);\n` +
                    `      ${varName}.x /= _dpx;\n`;
            if (Math.abs(img.perspX || 0) > 0.001)
                s += `      float _dpy = clamp(1.0 + ${perspX} * ${varName}.x, 0.1, 10.0);\n` +
                    `      ${varName}.y /= _dpy;\n`;
            s += `    }\n`;
            return s;
        };

        // Aspect-correct tiling: pre-scale _u.x by (imgAsp * aspect.y * tileScaleX) and
        // _u.y by tileScaleY BEFORE applyTileUV so tile cells have the correct shape.
        // tileScaleX/Y default to 1.0 → same output as before (fully backward-compatible).
        // Must be applied to each UV variable (or copy) just before its applyTileUV call.
        const tscXIsDefault = parseFloat(tileScaleX) === 1.0;
        const tscYIsDefault = parseFloat(tileScaleY) === 1.0;
        const aspectPreScale = (varName) => {
            let s = `    ${varName}.x /= ${imgAsp} * aspect.y`;
            if (!tscXIsDefault) s += ` * ${tileScaleX}`;
            s += `;\n`;
            if (!tscYIsDefault) s += `    ${varName}.y /= ${tileScaleY};\n`;
            return s;
        };

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

        const applyRadius = (varName, maskVar) => {
            if (!hasRadius) return '';
            return (
                `    { vec2 _rq = abs(${varName} - 0.5) - (0.5 - ${rad});\n` +
                `      float _rd = length(max(_rq, 0.0)) + min(max(_rq.x, _rq.y), 0.0) - ${rad};\n` +
                `      ${maskVar} *= 1.0 - smoothstep(-0.004, 0.004, _rd); }\n`
            );
        };

        let pipeline = '';
        let sampleLine = '';

        if (hasTunnel) {
            // Seamless two-layer crossfade tunnel
            const tz1Expr = fwd ? `pow(2.0, _tp)` : `pow(2.0, -_tp)`;
            const tz2Expr = fwd ? `pow(2.0, _tp - 1.0)` : `pow(2.0, 1.0 - _tp)`;
            pipeline =
                groupSpinLines +
                applySkew('_u') +
                applyPersp('_u') +
                `    float _tp = fract(time * ${ts} + ${depthOffset});\n` +
                `    float _tz1 = ${tz1Expr};\n` +
                `    float _tz2 = ${tz2Expr};\n` +
                `    float _tf = smoothstep(0.5, 1.0, _tp);\n` +
                `    float _gapMaskA = 1.0; float _gapMaskB = 1.0;\n` +
                `    vec2 _uA = _u;\n` +
                aspectPreScale('_uA') +
                applyTileUV('_uA', `${sizeBase} * _tz1`, '_gapMaskA', '_dxA', '_dyA') +
                applyMirrorUV('_uA') +
                applyRadius('_uA', '_gapMaskA') +
                `    vec2 _uB = _u;\n` +
                aspectPreScale('_uB') +
                applyTileUV('_uB', `${sizeBase} * _tz2`, '_gapMaskB', '_dxB', '_dyB') +
                applyMirrorUV('_uB') +
                applyRadius('_uB', '_gapMaskB');
            sampleLine =
                `    vec4 _tA = textureGrad(${tex}, _uA, _dxA, _dyA);\n` +
                `    vec4 _tB = textureGrad(${tex}, _uB, _dxB, _dyB);\n` +
                `    vec4 _t = mix(_tA, _tB, _tf);\n` +
                `    float _gapMask = mix(_gapMaskA, _gapMaskB, _tf);\n`;
        } else if (img.tile) {
            // Plain tiled — group spin rotates field first, then tile (with optional per-tile spin)
            pipeline = groupSpinLines +
                applySkew('_u') +
                applyPersp('_u') +
                `    float _gapMask = 1.0;\n` +
                aspectPreScale('_u') +
                applyTileUV('_u', sizeBase, '_gapMask', '_dx', '_dy') +
                applyMirrorUV('_u') +
                applyRadius('_u', '_gapMask');
            sampleLine = `    vec4 _t = textureGrad(${tex}, _u, _dx, _dy);\n`;
        } else {
            // Non-tiled: use same aspectPreScale as tiled, but show single instance (no fract wrapping)
            // After scaling, check if UV is within [0,1] range of the first image instance
            const rotLines = hasSpin
                ? `    float _ca = cos(_spinAng); float _sa = sin(_spinAng);\n` +
                `    _u = vec2(_ca*_u.x - _sa*_u.y, _sa*_u.x + _ca*_u.y);\n`
                : '';
            pipeline =
                `    float _gapMask = 1.0;\n` +
                aspectPreScale('_u') +  // Same as tiled: _u.x /= imgAsp * aspect.y
                `    _u /= ${sizeBase};\n` +
                rotLines +
                applySkew('_u') +
                applyPersp('_u') +
                `    vec2 _uInstanced = _u + 0.5;\n` +  // Center the UV (now range depends on aspect)
                `    { vec2 _rq = abs(_uInstanced - 0.5) - (0.5 - ${rad});\n` +
                `      float _rd = length(max(_rq, 0.0)) + min(max(_rq.x, _rq.y), 0.0) - ${rad};\n` +
                `      _gapMask = 1.0 - smoothstep(-0.004, 0.004, _rd); }\n` +
                `    _u = clamp(_uInstanced, 0.0, 1.0);\n` +  // Clamp for texture sampling
                applyMirrorUV('_u');
            sampleLine = `    vec4 _t = texture(${tex}, _u);\n`;
        }

        // Chromatic aberration: generate offset UV sampling based on which mode we're in
        const chromaticLines = hasChromatic
            ? (() => {
                const chromOffset = `${chromAmt} * 0.08`; // increased for more visible effect at low slider values
                const chromPhase = `time * ${chromSpd}`;
                // For tunnel mode, we apply chromatic to the final mixed _t by resampling both A and B (clamped)
                if (hasTunnel) {
                    return (
                        `    float _caOff = sin(${chromPhase}) * ${chromOffset};\n` +
                        `    vec2 _caU_ar = clamp(_uA + vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                        `    vec2 _caU_ab = clamp(_uA - vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                        `    vec2 _caU_br = clamp(_uB + vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                        `    vec2 _caU_bb = clamp(_uB - vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                        `    _t.x = mix(textureGrad(${tex}, _caU_ar, _dxA, _dyA).r, textureGrad(${tex}, _caU_br, _dxB, _dyB).r, _tf);\n` +
                        `    _t.z = mix(textureGrad(${tex}, _caU_ab, _dxA, _dyA).b, textureGrad(${tex}, _caU_bb, _dxB, _dyB).b, _tf);\n`
                    );
                }
                // For tiled mode, resample using the tiled UV in _u (clamped to prevent sampling neighboring tiles)
                if (img.tile) {
                    return (
                        `    float _caOff = sin(${chromPhase}) * ${chromOffset};\n` +
                        `    vec2 _caU_r = clamp(_u + vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                        `    vec2 _caU_b = clamp(_u - vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                        `    _t.x = textureGrad(${tex}, _caU_r, _dx, _dy).r;\n` +
                        `    _t.z = textureGrad(${tex}, _caU_b, _dx, _dy).b;\n`
                    );
                }
                // Non-tiled mode: apply chromatic within bounds only
                return (
                    `    float _caOff = sin(${chromPhase}) * ${chromOffset};\n` +
                    `    vec2 _caDx = dFdx(_u); vec2 _caDy = dFdy(_u);\n` +
                    `    vec2 _caU_r = clamp(_u + vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                    `    vec2 _caU_b = clamp(_u - vec2(_caOff, 0.0), 0.0, 1.0);\n` +
                    `    _t.x = mix(_t.x, textureGrad(${tex}, _caU_r, _caDx, _caDy).r, _gapMask);\n` +
                    `    _t.z = mix(_t.z, textureGrad(${tex}, _caU_b, _caDx, _caDy).b, _gapMask);\n`
                );
            })()
            : '';

        return (
            `  {\n` +
            reactLines +
            angLines +
            centerLines +
            pipeline +
            sampleLine +
            chromaticLines +
            `    vec3 _src = _t.xyz;\n` +
            (hasEdge ? (() => {
                // Sobel edge detect — sample 3x3 neighbourhood in texture space,
                // compute luminance gradient, replace _src with edge magnitude.
                // _suv is the UV used for the primary sample (already in scope from pipeline).
                const suv = hasTunnel ? `mix(_uA, _uB, _tf)` : `_u`;
                return (
                    `    { float _ex = ${edgeStepX}; float _ey = ${edgeStepY};\n` +
                    `      vec2 _suv = ${suv};\n` +
                    `      float _e00 = dot(texture(${tex}, clamp(_suv + vec2(-_ex,-_ey), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _e10 = dot(texture(${tex}, clamp(_suv + vec2( 0.0,-_ey), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _e20 = dot(texture(${tex}, clamp(_suv + vec2( _ex,-_ey), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _e01 = dot(texture(${tex}, clamp(_suv + vec2(-_ex, 0.0), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _e21 = dot(texture(${tex}, clamp(_suv + vec2( _ex, 0.0), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _e02 = dot(texture(${tex}, clamp(_suv + vec2(-_ex, _ey), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _e12 = dot(texture(${tex}, clamp(_suv + vec2( 0.0, _ey), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _e22 = dot(texture(${tex}, clamp(_suv + vec2( _ex, _ey), 0.0, 1.0)).xyz, vec3(0.299,0.587,0.114));\n` +
                    `      float _gx = -_e00 + _e20 - 2.0*_e01 + 2.0*_e21 - _e02 + _e22;\n` +
                    `      float _gy = -_e00 - 2.0*_e10 - _e20 + _e02 + 2.0*_e12 + _e22;\n` +
                    `      float _edge = clamp(sqrt(_gx*_gx + _gy*_gy) * 4.0, 0.0, 1.0);\n` +
                    `      _src = vec3(_edge); }\n`
                );
            })() : '') +
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
            (() => {
                const _iSat = (img.imageSaturation !== undefined ? img.imageSaturation : 1.0);
                const _iHue = (img.imageHue !== undefined ? img.imageHue : 0);
                const hasSat = Math.abs(_iSat - 1.0) >= 0.001;
                const hasHue = Math.abs(_iHue) >= 0.01;
                if (!hasSat && !hasHue) return '';
                const satLine = hasSat
                    ? `    { float _isl = dot(_src, vec3(0.299, 0.587, 0.114)); _src = mix(vec3(_isl), _src, ${_iSat.toFixed(4)}); }\n`
                    : '';
                let hueLine = '';
                if (hasHue) {
                    const _iRad = _iHue * Math.PI / 180;
                    const _icA = Math.cos(_iRad).toFixed(6);
                    const _isA = Math.sin(_iRad).toFixed(6);
                    const _ioC = (1 - Math.cos(_iRad)).toFixed(6);
                    hueLine = `    { vec3 _ihk = vec3(0.57735); _src = _src * ${_icA} + cross(_ihk, _src) * ${_isA} + _ihk * dot(_ihk, _src) * ${_ioC}; }\n`;
                }
                return satLine + hueLine;
            })() +
            (hasPosterize ? `    { float _pn = ${posterize}.0; _src = floor(_src * _pn + 0.5) / _pn; }\n` : '') +
            (img.alphaMode === 'preserve'
                ? `    float _alphaMask = step(0.1, _t.w);\n    float _op = _alphaMask * _gapMask * clamp(${op} + _r * ${opa}, 0.0, 1.0);\n`
                : `    float _op = _t.w * _gapMask * clamp(${op} + _r * ${opa}, 0.0, 1.0);\n`) +
            `    ${blendLine}\n` +
            `  }\n`
        );
    }


    _syncAllControls() {
        this._syncColorSwatches();
        this._syncMotionSliders();
        this._syncMotionReact();
        this._syncWaveControls();
        this._syncEchoOrient();
        this._syncPaletteSliders();
        this._syncFeelSliders();
        this._syncSolidFx();
        this._syncToggle('toggle-invert', 'invert');
        this._syncToggle('toggle-darken', 'darken');
        this._syncToggle('toggle-brighten-fx', 'brighten');
        this._syncToggle('toggle-solarize', 'solarize');
        this._syncToggle('toggle-darken-center', 'darken_center');
    }

    _syncPaletteSliders() {
        const bv = this.currentState.baseVals;
        this._syncSlider('ps-gamma', bv.gammaadj, 0.5, 4.0, 2);
        this._syncSlider('ps-decay', bv.decay, 0.85, 0.999, 3);
        this._syncSlider('ps-ob-size', bv.ob_size, 0, 0.1, 3);
        this._syncSlider('ps-ob-a', bv.ob_a, 0, 1.0, 2);
        this._syncSlider('ps-ib-size', bv.ib_size, 0, 0.1, 3);
        this._syncSlider('ps-ib-a', bv.ib_a, 0, 1.0, 2);
        this._syncSlider('ps-wavefade', bv.modwavealphabyvolume, 0, 2.0, 2);
        this._syncSlider('ps-saturation', bv.studio_saturation ?? 1.0, 0, 2.0, 2);
        this._syncSlider('ps-hue', bv.studio_hue_rotate ?? 0, 0, 360, 0);
    }

    _syncSolidFx() {
        this._syncSlider('sf-pulse', this.currentState.solidPulse || 0, 0, 2.0, 2);
        this._syncSlider('sf-breath', this.currentState.solidBreath || 0, 0, 1.0, 2);
        this._syncSlider('sf-shift', this.currentState.solidShift || 0, 0, 1.0, 2);
        const reactSrcSel = document.getElementById('solid-react-source');
        if (reactSrcSel) reactSrcSel.value = this.currentState.solidReactSource || 'bass';
        const curveBtns = document.querySelectorAll('#solid-react-curve .lseg');
        curveBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.curve === (this.currentState.solidReactCurve || 'linear')));
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
            isGif: false, gifSpeed: 1.0, gifStability: 0.0, alphaMode: 'fade',
            reactSource: 'bass', reactCurve: 'linear',
            orbitMode: 'circle', lissFreqX: 0.50, lissFreqY: 0.75, lissPhase: 0.25,
            strobeAmp: 0.00, strobeThr: 0.40,
            chromaticAberration: 0.00, chromaticSpeed: 1.0,
            tileScaleX: 1.00, tileScaleY: 1.00,
            angle: 0.00, skewX: 0.00, skewY: 0.00, shakeAmp: 0.00, posterize: 0, depthOffset: 0.00, edgeSobel: false, perspX: 0.00, perspY: 0.00,
            audioPulse: 0.00, pulseInvert: false,
            blendMode: 'overlay', tile: true, groupSpin: false,
            hueSpinSpeed: 0.00, imageSaturation: 1.00, imageHue: 0, tintR: 1.0, tintG: 1.0, tintB: 1.0,
            name: 'Layer', fileName: '', collapsed: false,
            isHd: false, solo: false, muted: false,
        };
        return { ...D, ...entry };
    }

    // ─── Public: load a bundled library preset into the editor ───────────────

    /**
     * Load any of the 1,144 bundled library presets into the editor for remixing.
     * Preserves the bundled comp/warp shaders and all MilkDrop structure (shapes,
     * waves, equations) — does NOT call _buildCompShader() so the visual is unchanged.
     * _buildCompShader() will only run when the user actively adds image layers or
     * changes the variation, which is the correct and intentional point of divergence.
     *
     * @param {string} name - exact registry key as in engine.presets (plain bundled name)
     */
    loadBundledPreset(name) {
        const bundled = this.engine.presets?.[name];
        if (!bundled) throw new Error(`Preset not found: ${name}`);

        this._clearForLoad();

        // Overlay bundled MilkDrop data on top of the BLANK base
        if (bundled.baseVals) {
            this.currentState.baseVals = { ...deepClone(BLANK.baseVals), ...bundled.baseVals };
        }
        this.currentState.shapes = deepClone(bundled.shapes || []);
        this.currentState.waves = deepClone(bundled.waves || []);
        this.currentState.warp = bundled.warp || '';

        // Equation strings — handle old butterchurn naming (init_eqs → init_eqs_str)
        this.currentState.init_eqs_str = bundled.init_eqs_str || bundled.init_eqs || '';
        this.currentState.frame_eqs_str = bundled.frame_eqs_str || bundled.frame_eqs || '';
        this.currentState.pixel_eqs_str = bundled.pixel_eqs_str || bundled.pixel_eqs || '';

        // Preserve the bundled comp shader exactly — do NOT call _buildCompShader() here.
        // The bundled comp is what makes the preset look the way it does. It will only
        // be replaced when the user adds image layers or picks a new variation.
        const _bundledRaw = stripStudioPostFx(bundled.comp || BLANK_COMP_RAW);
        this._baseComp = _bundledRaw;
        const _bbv = this.currentState.baseVals;
        this.currentState.comp = injectStudioPostFx(_bundledRaw, { sat: _bbv.studio_saturation ?? 1.0, hue: _bbv.studio_hue_rotate ?? 0 });

        // Track remix origin so a save references the parent
        this.currentState.parentPresetName = name;

        this._applyToEngine();
        this._syncAllControls();
        this._updateSolidFxVisibility({ solid: null });
        this._updateLayersBar();
        this._updateLayerIndices();

        this.originalState = deepClone(this.currentState);
    }

    // ─── Public: load a saved preset into the editor ──────────────────────────

    /**
     * Load a full custom preset object (from customPresets.js) into the editor.
     * Restores baseVals, shapes, waves, and image layers (fetching blobs from IndexedDB).
     * @param {object} presetData - preset object as returned by loadAllCustomPresets()
     */
    async loadPresetData(presetData) {
        this._clearForLoad();

        // Strip library-only metadata
        const { id: _id, name: _name, schemaVersion: _sv, createdAt: _ca, updatedAt: _ua,
            thumbnailDataUrl: _th, ...stateFields } = presetData;

        // Overlay onto BLANK so fields missing from older saves fall back to defaults
        // (avoids `undefined` propagating into _syncSlider → NaN value labels).
        // baseVals is merged at the inner level — top-level spread alone replaces it
        // wholesale, which would drop BLANK defaults for any field not in the saved file.
        this.currentState = {
            ...deepClone(BLANK),
            ...deepClone(stateFields),
            baseVals: { ...deepClone(BLANK.baseVals), ...deepClone(stateFields.baseVals || {}) },
            images: [],
        };

        // Restore internal flags from the loaded state
        this._imagesOnly = !!this.currentState.imagesOnly;

        // Restore image layers (async — fetch blobs from IndexedDB)
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

        // Build comp AFTER images are loaded so the GLSL includes their layer code.
        this._buildCompShader();
        this._applyToEngine();

        this._syncAllControls();
        this._updateSolidFxVisibility({ solid: this._solidColor });
        this._updateLayersBar();
        this._updateLayerIndices();

        // Sync scene mirror + Images Only from the loaded currentState
        // (clearForLoad reset them to defaults; now restore from saved state)
        const sm = this.currentState.sceneMirror || 'none';
        document.querySelectorAll('#scene-mirror-seg .seg').forEach(s =>
            s.classList.toggle('active', s.dataset.smirror === sm));
        const ioToggle = document.getElementById('toggle-images-only');
        if (ioToggle) ioToggle.checked = !!this.currentState.imagesOnly;

        this.originalState = deepClone(this.currentState);
    }
}

// ─── Toast (exported for main.js) ────────────────────────────────────────────

const ONBOARDING_KEY = 'discocast_onboarding_never';
export function showOnboarding() {
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    const modal = document.getElementById('onboarding-modal');
    if (!modal) return;
    modal.hidden = false;

    const close = (permanently) => {
        modal.hidden = true;
        if (permanently) localStorage.setItem(ONBOARDING_KEY, '1');
        // clean up listeners
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onEsc);
    };

    const onBackdrop = (e) => { if (e.target === modal) close(false); };
    const onEsc = (e) => { if (e.key === 'Escape') close(false); };

    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);

    document.getElementById('onboarding-got-it-btn')
        ?.addEventListener('click', () => close(false), { once: true });
    document.getElementById('onboarding-never-btn')
        ?.addEventListener('click', () => close(true), { once: true });
    document.getElementById('onboarding-help-btn')
        ?.addEventListener('click', () => {
            close(false);
            const modal = document.getElementById('help-modal');
            if (modal) modal.hidden = false;
        }, { once: true });
}

const HINT_KEY = 'discocast_hint_slider_reset_seen';
export function showHint() {
    if (localStorage.getItem(HINT_KEY)) return;
    localStorage.setItem(HINT_KEY, '1');
    const el = document.getElementById('hint');
    if (!el) return;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 5000);
}

export function showToast(msg, isError = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' toast--error' : '');
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
}
