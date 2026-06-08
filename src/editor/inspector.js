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

import { createCustomPreset, saveCustomPreset, getImage, storeImage, generateId, buildMotionReactFrameEqs, buildWaveReactFrameEqs, buildAnimFrameEqs, buildMotionEngineFrameEqs, buildShapeMotionEqs, MOTION_ENGINES, buildWarpShader, buildImageWarp, WARP_STYLES } from '../customPresets.js';
import {
    parseGifFile, processGifFrames, generateFrameStrip,
    shouldOptimize, getRecommendedSettings, formatBytes,
    estimateGpuMemory
} from './gifOptimizer.js';
import { transcodeTo720p, needsTranscode, stripAudio } from '../videoTranscoder.js';
import { gsap } from 'gsap';
import { playEntranceAnimation, playExitAnimation, startIdleAnimation, stopIdleAnimation, ENTRANCE_EASES, EXIT_EASES } from './animation.js';

// ─── Perceptual (log) Speed mapping (image-texture-dev.md §17) ────────────────
// Flow Speed is perceptually logarithmic — a linear fader crams all the slow/extreme-
// slowdown range (where Melt/Liquid get hypnotic) into the bottom few %. These map a
// slider POSITION t∈[0,1] ↔ actual speed geometrically over [SPEED_MIN, SPEED_MAX], so
// the slow end gets fine resolution while the top still reaches fast. The MODEL stores
// the real speed (engine/saved presets unchanged); only the UI mapping is non-linear.
const SPEED_MIN = 0.02, SPEED_MAX = 4.0;
const _speedToPos = (s) => Math.log(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(s) || SPEED_MIN)) / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
const _posToSpeed = (t) => SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, Math.min(1, Math.max(0, t)));

// ─── Phase 1: layer limits + upload resize ───────────────────────────────────
// Cap surface area for Phase 1. Internals (shader builder, state array) are
// N-generic — raising this later is a one-line change.
const MAX_LAYERS = 5;
const STD_MAX_DIM = 1024;   // Standard upload max dimension (longest side)
const HD_MAX_DIM = 2048;    // "HD" toggle max dimension

// animation-dev.md P0-D. User-set entrance/exit/idle config — persisted on each
// layer. `_anim` is the runtime tween state and is NOT persisted (reset to
// neutral on load). UI to set this lands in Phase A.
const DEFAULT_ANIMATION = {
    // animation-dev.md A6 — per-layer schedule WITHIN a preset: when (seconds
    // after preset load, 0–180) the layer enters / exits. 0 = enter immediately /
    // no scheduled exit. Separate from the entrance/exit tween DURATION. Drives
    // playback in the player & timeline; the editor stays a workbench.
    entranceAt: 0, exitAt: 0,
    entrance: 'none', entranceDuration: 0.7, entranceEase: 'expo.out',
    // Phase A1 Gate 2 — per-preset tunable params. Defaults match the
    // pre-Gate-2 hard-coded values so existing presets stay byte-identical.
    entranceDistance: 1.2,      // slide-*: UV offset distance
    entranceScaleUpFrom: 0.3,   // scale-up: starting scale (small)
    entranceScaleDownFrom: 1.8, // scale-down: starting scale (large)
    entrancePopFrom: 0.0,       // pop: starting scale before elastic
    entranceBlurStart: 0.6,     // blur: starting blur amount

    exit:     'none', exitDuration:     0.5, exitEase:     'expo.in',
    exitDistance: 1.2,
    exitScaleUpFrom: 1.5,       // scale-up exit: ends large
    exitScaleDownFrom: 0.0,     // scale-down exit: ends tiny
    exitPopFrom: 0.0,           // pop exit: ends tiny
    exitBlurStart: 0.6,         // blur exit: ends blurry

    idle:     'none', idleSpeed:        1.0,
    beatSteps: []
};
const NEUTRAL_ANIM = { opacity: 1.0, scale: 1.0, cxOffset: 0.0, cyOffset: 0.0, blur: 0.0 };

/**
 * Format seconds as MM:SS for video time display.
 */
function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Animate-modal custom controls (animation-dev.md Phase A1 Gate 3) ────────
// Two small DOM widgets used inside the Animate modal — kept here so the
// rest of the modal wiring stays co-located. Both replace native form
// controls (range / select) per the doc's "no default browser form controls"
// rule. Each returns a handle with setValue/getValue so the modal's
// `_syncAnimateModal` can push state in without re-binding listeners.

// Visual time scrubber. Used for entrance duration, exit duration, idle speed.
// Hydrates an empty <div class="anim-scrub" data-min data-max data-step
// data-value data-format data-label> into a full track + handle + readout.
function _hydrateScrubber(el, { onInput } = {}) {
    const min  = parseFloat(el.dataset.min);
    const max  = parseFloat(el.dataset.max);
    const step = parseFloat(el.dataset.step);
    const fmt  = el.dataset.format || '';
    const label = el.dataset.label || '';
    let value = parseFloat(el.dataset.value);

    // `time` format (Enter at / Exit at, 0:00–3:00): m:ss readout, magnitude-aware
    // snapping (1s under a minute, 5s above) and labeled landmark ticks so the
    // long range reads like a timeline ruler. All other formats ('s' duration,
    // 'x' speed) keep the original fixed-step + 11-even-tick behaviour exactly.
    const isTime = fmt === 'time';

    el.innerHTML = `
      <div class="anim-scrub-head">
        <span class="anim-scrub-label">${label}</span>
        <span class="anim-scrub-value"></span>
      </div>
      <div class="anim-scrub-track" tabindex="0" role="slider"
           aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}">
        <div class="anim-scrub-rail"><div class="anim-scrub-fill"></div></div>
        <div class="anim-scrub-ticks"></div>
        <div class="anim-scrub-handle"></div>
      </div>
      <div class="anim-scrub-labels"></div>`;

    const valEl      = el.querySelector('.anim-scrub-value');
    const track      = el.querySelector('.anim-scrub-track');
    const fill       = el.querySelector('.anim-scrub-fill');
    const handle     = el.querySelector('.anim-scrub-handle');
    const ticksWrap  = el.querySelector('.anim-scrub-ticks');
    const labelsWrap = el.querySelector('.anim-scrub-labels');

    const posOf = (v) => (max > min) ? (v - min) / (max - min) : 0;

    if (isTime) {
        // Labeled landmark ticks at meaningful times — reads like a timeline ruler.
        // Endpoints align inward (translateX 0 / -100%) so they don't clip.
        const landmarks = [
            { v: 0,   t: '0:00' }, { v: 30, t: '0:30' }, { v: 60, t: '1:00' },
            { v: 120, t: '2:00' }, { v: 180, t: '3:00' },
        ];
        for (const lm of landmarks) {
            if (lm.v < min || lm.v > max) continue;
            const pct = posOf(lm.v) * 100;
            const tick = document.createElement('span');
            tick.className = 'anim-scrub-tick major anim-scrub-tick--mark';
            tick.style.left = `${pct}%`;
            ticksWrap.appendChild(tick);
            const lab = document.createElement('span');
            lab.className = 'anim-scrub-tick-label';
            lab.style.left = `${pct}%`;
            lab.style.transform = `translateX(${pct <= 2 ? '0' : pct >= 98 ? '-100%' : '-50%'})`;
            lab.textContent = lm.t;
            labelsWrap.appendChild(lab);
        }
    } else {
        // Eleven evenly-spaced ticks (every other one "major"). Reads as a ruler.
        for (let i = 0; i < 11; i++) {
            const t = document.createElement('span');
            t.className = 'anim-scrub-tick' + (i % 2 === 0 ? ' major' : '');
            ticksWrap.appendChild(t);
        }
    }

    const fmtTime = (v) => {
        const m = Math.floor(v / 60);
        const s = Math.round(v - m * 60);
        if (s === 60) return `${m + 1}:00`;
        return `${m}:${String(s).padStart(2, '0')}`;
    };
    const fmtVal = (v) => isTime ? fmtTime(v)
                       : fmt === 's' ? `${v.toFixed(2)}s`
                       : fmt === 'x' ? `${v.toFixed(2)}×`
                       : v.toFixed(2);

    // Magnitude-aware snap for the time scrubber (coarser as time grows); other
    // scrubbers keep their fixed step grid anchored at min.
    const snapStepFor = (v) => isTime ? (v < 60 ? 1 : 5) : step;
    const snap = (v) => {
        const s = snapStepFor(v);
        const snapped = isTime ? Math.round(v / s) * s
                              : Math.round((v - min) / step) * step + min;
        return Math.max(min, Math.min(max, parseFloat(snapped.toFixed(4))));
    };
    const render = () => {
        const pct = posOf(value) * 100;
        fill.style.width = `${pct}%`;
        handle.style.left = `${pct}%`;
        valEl.textContent = fmtVal(value);
        track.setAttribute('aria-valuenow', value);
    };
    const setValue = (v, fire = false) => {
        const next = snap(v);
        if (next === value) { if (fire) onInput?.(value); return; }
        value = next;
        render();
        if (fire) onInput?.(value);
    };

    let dragging = false;
    const updateFromClientX = (clientX) => {
        const r = track.getBoundingClientRect();
        const t = r.width > 0 ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
        setValue(min + t * (max - min), true);
    };
    track.addEventListener('pointerdown', (e) => {
        dragging = true;
        el.classList.add('dragging');
        try { track.setPointerCapture(e.pointerId); } catch {}
        updateFromClientX(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        updateFromClientX(e.clientX);
    });
    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('dragging');
        try { track.releasePointerCapture(e.pointerId); } catch {}
    };
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    track.addEventListener('keydown', (e) => {
        const s = snapStepFor(value);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')  { setValue(value - s, true); e.preventDefault(); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { setValue(value + s, true); e.preventDefault(); }
        if (e.key === 'Home') { setValue(min, true); e.preventDefault(); }
        if (e.key === 'End')  { setValue(max, true); e.preventDefault(); }
    });

    render();
    return { setValue: (v) => setValue(v, false), getValue: () => value };
}

// Ease picker — chip row + SVG curve preview. Samples the GSAP ease function
// directly so elastic / bounce overshoots render correctly (no cubic-bezier
// approximation). Chips define the value; the SVG is read-only.
function _hydrateEasePicker(el, options, { initial, onInput } = {}) {
    // Build chip row + SVG once. `options` is [{ id, label }, ...].
    el.innerHTML = `
      <div class="anim-ease-chips">
        ${options.map(o => `<button type="button" class="anim-ease-chip" data-ease="${o.id}">${o.label}</button>`).join('')}
      </div>
      <svg class="anim-ease-preview" viewBox="-4 -18 108 108" preserveAspectRatio="none" aria-hidden="true">
        <line class="anim-ease-axis" x1="0" y1="0"   x2="100" y2="0"></line>
        <line class="anim-ease-axis" x1="0" y1="80"  x2="100" y2="80"></line>
        <polyline class="anim-ease-curve" points=""></polyline>
      </svg>`;
    const chipsWrap = el.querySelector('.anim-ease-chips');
    const curve     = el.querySelector('.anim-ease-curve');
    let current = initial;

    // ViewBox is -4..104 horizontal, -18..90 vertical. Map t∈[0,1] → x∈[0,100],
    // v∈[0,1] → y∈[80,0] (flipped). Overshoot/undershoot stay visible because
    // the viewBox has padding above (-18) and below (90 vs 80 baseline).
    const samplePoints = (easeName) => {
        let fn;
        try { fn = gsap.parseEase(easeName); }
        catch { fn = (t) => t; }
        const N = 80;
        const pts = new Array(N + 1);
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            const v = fn(t);
            pts[i] = `${(t * 100).toFixed(2)},${(80 - v * 80).toFixed(2)}`;
        }
        return pts.join(' ');
    };
    const setActive = (name) => {
        current = name;
        el.querySelectorAll('.anim-ease-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.ease === name);
        });
        curve.setAttribute('points', samplePoints(name));
    };
    chipsWrap.addEventListener('click', (e) => {
        const chip = e.target.closest('.anim-ease-chip');
        if (!chip) return;
        setActive(chip.dataset.ease);
        onInput?.(chip.dataset.ease);
    });

    setActive(initial);
    return { setActive, getValue: () => current };
}

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
// `roll` (rad/s) > 0 → the hue angle cycles over `time` (Color Roll); 0 = static
// hue, byte-identical to before. Applied to `col` only so image layers don't roll.
function buildSatHueOnColGlsl(sat, hue, roll) {
    const s = (typeof sat === 'number' && isFinite(sat)) ? sat : 1.0;
    const h = (typeof hue === 'number' && isFinite(hue)) ? hue : 0;
    const sp = (typeof roll === 'number' && isFinite(roll)) ? roll : 0;
    const satLine = (Math.abs(s - 1.0) < 0.001) ? '' :
        `  float _bg_lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(_bg_lum), col, ${s.toFixed(4)});
`;
    let hueLine = '';
    if (Math.abs(sp) > 1e-4) {
        // Time-driven hue roll about the (1,1,1) luma axis (Rodrigues rotation).
        const base = (h * Math.PI / 180).toFixed(6);
        hueLine = `  { float _ba = ${base} + time * ${sp.toFixed(4)};
  float _bc = cos(_ba), _bs = sin(_ba); vec3 _bgk = vec3(0.57735);
  col = col * _bc + cross(_bgk, col) * _bs + _bgk * dot(_bgk, col) * (1.0 - _bc); }
`;
    } else if (Math.abs(h) >= 0.01) {
        const rad = h * Math.PI / 180;
        const cosA = Math.cos(rad).toFixed(6);
        const sinA = Math.sin(rad).toFixed(6);
        const oneMinusCos = (1 - Math.cos(rad)).toFixed(6);
        hueLine = `  { vec3 _bgk = vec3(0.57735);
  col = col * ${cosA} + cross(_bgk, col) * ${sinA} + _bgk * dot(_bgk, col) * ${oneMinusCos}; }
`;
    }
    return satLine + hueLine;
}

// `roll` (rad/s) > 0 → hue angle cycles over the comp shader's `time` uniform
// (Color Roll), so the whole frame's colours rotate continuously — works in both
// solid/shift and feedback modes. 0 = static hue (byte-identical to before).
function buildStudioPostFxGlsl(opts) {
    const o = opts || {};
    const num = (x, d) => (typeof x === 'number' && isFinite(x)) ? x : d;
    const s = num(o.sat, 1.0);
    const h = num(o.hue, 0);
    const sp = num(o.roll, 0);
    // Grade rack — continuous faders, each a no-op string at its default so existing
    // presets stay byte-identical. Operate on the final `ret.rgb` so they tune ANY
    // preset (bundled or custom). Order: brightness → contrast → gamma → temperature.
    const br = num(o.brightness, 1.0), con = num(o.contrast, 1.0), gam = num(o.gamma, 1.0), tmp = num(o.temp, 0);
    // Phase 12 — audio-reactive grade. Each fader can pulse to the beat: when its
    // react amount > 0 it bakes a LIVE expression (`base + signal·amount`) instead of
    // a static literal, where `signal = curve(source)` reads the same audio uniforms
    // the Shift pulse uses. Zero amount → the original static line (byte-identical).
    const brR = num(o.brightnessReact, 0), conR = num(o.contrastReact, 0), gamR = num(o.gammaReact, 0), tmpR = num(o.tempReact, 0);
    const anyReact = !!(brR || conR || gamR || tmpR);
    let sigDecl = '';
    if (anyReact) {
        const src = { bass: 'bass', mid: 'mid', treb: 'treb', vol: 'vol', flux: 'q31' }[o.gradeReactSource] || 'bass';
        let cexpr;
        switch (o.gradeReactCurve) {
            case 'squared': cexpr = '_gr * _gr'; break;
            case 'cubed': cexpr = '_gr * _gr * _gr'; break;
            case 'threshold': cexpr = 'step(0.3, _gr)'; break;
            default: cexpr = '_gr';
        }
        sigDecl = `\n    float _gr = ${src};\n    float _gs = ${cexpr};`;
    }
    // Per-fader expression: live `(base + _gs·amount)` when reactive, else the literal.
    const brExpr = brR ? `(${br.toFixed(4)} + _gs * ${brR.toFixed(4)})` : br.toFixed(4);
    const conExpr = conR ? `(${con.toFixed(4)} + _gs * ${conR.toFixed(4)})` : con.toFixed(4);
    const tmpExpr = tmpR ? `(${tmp.toFixed(4)} + _gs * ${tmpR.toFixed(4)})` : tmp.toFixed(4);
    const brLine = (Math.abs(br - 1.0) < 0.001 && !brR) ? '' : `\n    ret.rgb *= ${brExpr};`;
    const conLine = (Math.abs(con - 1.0) < 0.001 && !conR) ? '' : `\n    ret.rgb = (ret.rgb - 0.5) * ${conExpr} + 0.5;`;
    // Gamma: non-reactive keeps the precomputed `1/gam` literal (byte-identical);
    // reactive divides at runtime, clamped > 0.01 so it never blows up.
    const gamLine = (Math.abs(gam - 1.0) < 0.001 && !gamR) ? '' :
        (gamR ? `\n    ret.rgb = pow(max(ret.rgb, vec3(0.0)), vec3(1.0 / max(${gam.toFixed(4)} + _gs * ${gamR.toFixed(4)}, 0.01)));`
              : `\n    ret.rgb = pow(max(ret.rgb, vec3(0.0)), vec3(${(1.0 / gam).toFixed(4)}));`);
    const tmpLine = (Math.abs(tmp) < 0.001 && !tmpR) ? '' : `\n    ret.rgb += vec3(${tmpExpr}, 0.0, -(${tmpExpr}));`;
    const satLine = (Math.abs(s - 1.0) < 0.001) ? '' :
        `\n    float _lum = dot(ret.rgb, vec3(0.299, 0.587, 0.114));\n    ret.rgb = mix(vec3(_lum), ret.rgb, ${s.toFixed(4)});`;
    let hueLine = '';
    if (Math.abs(sp) > 1e-4) {
        const base = (h * Math.PI / 180).toFixed(6);
        hueLine = `\n    float _ra = ${base} + time * ${sp.toFixed(4)};\n    float _rc = cos(_ra), _rs = sin(_ra); vec3 _k = vec3(0.57735);\n    ret.rgb = ret.rgb * _rc + cross(_k, ret.rgb) * _rs + _k * dot(_k, ret.rgb) * (1.0 - _rc);`;
    } else if (Math.abs(h) >= 0.01) {
        const rad = h * Math.PI / 180;
        const cosA = Math.cos(rad).toFixed(6);
        const sinA = Math.sin(rad).toFixed(6);
        const oneMinusCos = (1 - Math.cos(rad)).toFixed(6);
        hueLine = `\n    vec3 _k = vec3(0.57735);\n    ret.rgb = ret.rgb * ${cosA} + cross(_k, ret.rgb) * ${sinA} + _k * dot(_k, ret.rgb) * ${oneMinusCos};`;
    }
    // Phase 14 — Scene FX. Final-image treatments on `ret.rgb` (uv/time in scope),
    // applied AFTER colour grading. Each a no-op string at 0 → byte-identical when off.
    const post = num(o.posterize, 0), vig = num(o.vignette, 0), scan = num(o.scanlines, 0), grain = num(o.grain, 0), bloom = num(o.bloom, 0);
    // Scene Bloom (Phase 15.2): add the BLURRED feedback as a soft glow over the final
    // pixel — softens/fills ANY preset incl. the 1,144 bundled (referencing sampler_blur1
    // auto-runs the blur pass). Applied first so the rest of the FX treat the bloomed image.
    const bloomLine = (bloom < 0.001) ? '' :
        `\n    ret.rgb += ${(bloom * 1.5).toFixed(4)} * texture(sampler_blur1, uv).rgb;`;
    // Posterize: amount→levels, punchy — even a small nudge bands (0.2→~6 levels … 1→2).
    const postLine = (post < 0.001) ? '' :
        (() => { const lv = Math.max(2, Math.round(8 - post * 6)); return `\n    ret.rgb = floor(ret.rgb * ${lv}.0 + 0.5) / ${lv}.0;`; })();
    // Vignette: strong radial falloff that reaches WAY into the centre — darkening
    // saturates by mid-frame so only a small central bubble stays bright (not a
    // corner ring). smoothstep(0.05, 0.6) → ~43% dark at r=0.3, full by the edges.
    const vigLine = (vig < 0.001) ? '' :
        `\n    ret.rgb *= 1.0 - ${vig.toFixed(4)} * smoothstep(0.05, 0.6, length(uv - 0.5));`;
    // Scan lines: soft CRT horizontal banding (fixed density).
    const scanLine = (scan < 0.001) ? '' :
        `\n    ret.rgb *= 1.0 - ${(scan * 0.4).toFixed(4)} * (0.5 + 0.5 * sin(uv.y * 700.0));`;
    // Film grain: animated noise, ± up to ~0.25 at full.
    const grainLine = (grain < 0.001) ? '' :
        `\n    ret.rgb += ${(grain * 0.5).toFixed(4)} * (fract(sin(dot(uv * (time + 1.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5);`;
    // 🌙 Club / Dark Mode (§18) — the one-knob FINAL-OUTPUT dark-room tune. The enemy in a club is
    // BLOWN WHITE (bright AND desaturated — it lights the room). Detect that specifically and crush it,
    // while leaving vivid colour alone and pushing it DEEPER — so whites collapse toward dark but
    // reds/blues/greens get richer, not dimmer ("kill the white, keep the colour"). Applied LAST on the
    // composited output (after grade + Scene FX). Braced so its locals can't collide with the grade's
    // `_lum` (satLine). Gated: club < 0.001 → no line → byte-identical no-op. Coefficients tuned by eye.
    const club = num(o.club, 0);
    const clubLine = (club < 0.001) ? '' :
        `\n    { float _cl = dot(ret.rgb, vec3(0.299, 0.587, 0.114));` +
        `\n      float _cmx = max(ret.r, max(ret.g, ret.b)), _cmn = min(ret.r, min(ret.g, ret.b));` +
        `\n      float _cw = _cl * (1.0 - (_cmx - _cmn) / (_cmx + 1e-4));` +              // bright + desaturated = room-white
        `\n      ret.rgb *= 1.0 - ${club.toFixed(4)} * _cw * 0.85;` +                      // 1) crush whites specifically
        `\n      ret.rgb = mix(vec3(_cl), ret.rgb, 1.0 + ${club.toFixed(4)} * 0.6);` +     // 2) deepen / push primaries
        `\n      ret.rgb = ret.rgb / (1.0 + ${club.toFixed(4)} * 0.5 * max(ret.rgb - 0.5, 0.0));` + // 3) highlight roll-off
        `\n      ret.rgb *= 1.0 - ${club.toFixed(4)} * 0.12;` +                            // 4) gentle overall dim
        `\n      ret.rgb = clamp(ret.rgb, 0.0, 1.0); }`;
    return `    /* STUDIO_POST_FX */\n    if (brighten != 0) ret = sqrt(ret);\n    if (darken != 0) ret = ret * ret;\n    if (solarize != 0) ret = ret * (1.0 - ret) * 4.0;\n    if (invert != 0) ret = 1.0 - ret;${sigDecl}${brLine}${conLine}${gamLine}${tmpLine}${satLine}${hueLine}${bloomLine}${postLine}${vigLine}${scanLine}${grainLine}${clubLine}\n`;
}

// Build the full grade-opts object the STUDIO_POST_FX inject reads, from a baseVals.
// One source of truth for every injectStudioPostFx call site (sat/hue/roll already
// existed; the four grade faders are the 2026-06-01 addition).
function gradeOpts(state) {
    const st = state || {};
    const b = st.baseVals || {};
    return {
        sat: b.studio_saturation ?? 1.0, hue: b.studio_hue_rotate ?? 0, roll: b.studio_hue_roll ?? 0,
        contrast: b.studio_contrast ?? 1.0, brightness: b.studio_brightness ?? 1.0,
        gamma: b.studio_gamma ?? 1.0, temp: b.studio_temp ?? 0,
        // Phase 12 — per-fader audio-reactive amounts (baseVals) + shared source/curve (top-level).
        brightnessReact: b.studio_brightness_react ?? 0, contrastReact: b.studio_contrast_react ?? 0,
        gammaReact: b.studio_gamma_react ?? 0, tempReact: b.studio_temp_react ?? 0,
        gradeReactSource: st.studio_grade_react_source ?? 'bass',
        gradeReactCurve: st.studio_grade_react_curve ?? 'linear',
        // Phase 14 — Scene FX amounts (baseVals).
        posterize: b.studio_posterize ?? 0, vignette: b.studio_vignette ?? 0,
        scanlines: b.studio_scanlines ?? 0, grain: b.studio_grain ?? 0, bloom: b.studio_bloom ?? 0,
        // §18 — Club / Dark Mode (top-level, whole-preset output control; not a baseVals fader).
        club: st.clubMode ?? 0,
    };
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
    const glsl = buildStudioPostFxGlsl(opts || {});
    return `${clean.slice(0, lastCurly)}\n${glsl}${clean.slice(lastCurly)}`;
}

// Minimal passthrough comp shader — butterchurn won't accept an empty string.
const BLANK_COMP_RAW = ' shader_body { \n  vec4 tmpvar_1;\n  tmpvar_1.w = 1.0;\n  tmpvar_1.xyz = (texture (sampler_main, uv).xyz * 2.0);\n  ret = tmpvar_1.xyz;\n }';
const BLANK_COMP = injectStudioPostFx(BLANK_COMP_RAW);

const BLANK = {
    baseVals: {
        zoom: 1.0, rot: 0.0, warp: 0.0, warpanimspeed: 1.0, warpscale: 1.0,
        zoomexp: 1.0,
        decay: 0.90, gammaadj: 2.0,   // clean default — warp flows but clears in ~1s (was 0.98 = permanent haze)
        echo_zoom: 1.0, echo_orient: 0, echo_alpha: 0,
        dx: 0, dy: 0,
        sx: 1.0, sy: 1.0,
        cx: 0.5, cy: 0.5,
        wave_mode: 3,
        // Soft coloured accent, not a stark white string. (The A/B "A" baseline is
        // this BLANK; palette/Shift overwrite the colour in normal use.)
        wave_r: 0.4, wave_g: 0.7, wave_b: 1.0, wave_a: 0.6,
        wave_scale: 1.0, wave_mystery: 0.0,
        wave_smoothing: 0.75, wave_x: 0.5, wave_y: 0.5,
        wave_thick: 0, wave_thickness: 0, wave_fill: 0, wave_rot: 0, additivewave: 0, wave_usedots: 0, wave_brighten: 0,
        ob_size: 0.0, ob_r: 0.0, ob_g: 0.0, ob_b: 0.0, ob_a: 0.0,
        ib_size: 0.0, ib_r: 0.0, ib_g: 0.0, ib_b: 0.0, ib_a: 0.0,
        mv_x: 12, mv_y: 9, mv_l: 0.9, mv_r: 0.0, mv_g: 0.0, mv_b: 1.0, mv_a: 0.0,
        darken: 0, invert: 0, brighten: 0, solarize: 0, darken_center: 0,
        modwavealphabyvolume: 0,
        studio_saturation: 1.0, studio_hue_rotate: 0, studio_hue_roll: 0,
        // Grade rack — bolts onto ANY preset's final colour (bundled or custom) via
        // the STUDIO_POST_FX inject. Defaults are identity (no-op) → existing presets
        // byte-identical. Tunes the 1,144 bundled presets too (they keep their own
        // shader; the grade block is appended). See buildStudioPostFxGlsl.
        studio_contrast: 1.0, studio_brightness: 1.0, studio_gamma: 1.0, studio_temp: 0,
        // Phase 12 — per-fader audio-reactive amounts (0 = static; the grade pulses to
        // the beat when > 0). Shared Source/Curve live top-level (strings stay out of
        // baseVals, like solidReactSource). All default-off → byte-identical.
        studio_brightness_react: 0, studio_contrast_react: 0, studio_gamma_react: 0, studio_temp_react: 0,
        // Phase 14 — Scene FX (final-image treatments; 0 = off → byte-identical).
        studio_posterize: 0, studio_vignette: 0, studio_scanlines: 0, studio_grain: 0, studio_bloom: 0,
        // Glow / Accent bloom (a colored halo from the blurred feedback buffer,
        // tinted by the Glow / Accent colour). 0 = off → comp is byte-identical.
        studio_glow: 0, studio_accent: 0,
        b1ed: 0.5,
    },
    shapes: [], waves: [],
    warp: '',          // empty warp is valid
    comp: BLANK_COMP,  // must be a valid GLSL shader_body string
    init_eqs_str: '', frame_eqs_str: '', pixel_eqs_str: '',
    images: [],
    paletteOpacity: 1.0,
    imagesOnly: false,     // layers-only base (persists; was previously instance-only)
    bgTransparent: false,  // transparent canvas behind layers (Phase 1/2)
    sceneMirror: 'none',  // 'none' | 'h' | 'v' | 'both' | 'kaleido'
    sceneMirrorKaleidoSpeed: 0.00,
    // Motion Engine — autonomous, time-driven generative motion (Phase 1,
    // milkdrop-tools-dev.md §7). id 'none' = static; speed/depth are the two
    // universal knobs every engine reads. Round-trips via the standard BLANK
    // overlay (no save/load surgery).
    motionEngine: { id: 'none', speed: 1.0, depth: 0.5 },
    flowStyle: { id: 'none', speed: 1.0, depth: 0.5, density: 0.5 },  // Phase 7 — per-preset warp field
    // Image-as-texture (image-texture-dev.md Phase 2) — melt a loaded image layer
    // INTO the feedback loop. `texName` references one of `images[]`. When enabled it
    // OVERRIDES flowStyle's warp via buildImageWarp. Round-trips via the BLANK overlay.
    imageWarp: { enabled: false, texName: '', flow: 'liquid', size: 1.0, cx: 0.5, cy: 0.5, mirror: 'none', kaleidoSpeed: 0.0, blendMode: 'mix', bright: 1.0, contrast: 1.0, sat: 1.0, hue: 0, invert: false, speed: 1.0, depth: 0.5, spin: 0.0, zoomPulse: 0.0, flowPulse: 0.0, lumaKey: 0.0, mask: 0.0, disp: 0.0, flowMap: 0.0, tint: 0.0, imgPalette: null, edgeFeather: 0.5, reseed: 0.20, audioSource: 'none', audioAmt: 0.50 },
    motionReact: {
        source: 'bass',
        curve: 'linear',
        zoomAmt: 0.00,
        rotAmt: 0.00,
        warpAmt: 0.00,
        warpSpeedAmt: 0.00,
        driftXAmt: 0.00,
        driftYAmt: 0.00,
        pulseAmp: 0.00,
        bounceAmp: 0.00,
        shakeAmp: 0.00,
        beatFadeAmp: 0.00,
        strobeAmp: 0.00,
        shrink: 0,
    },
    waveReact: {
        source: 'bass',
        curve: 'linear',
        scaleAmt:   0.00,  // react drives wave_scale (+/-)
        opacityAmt: 0.00,  // react drives wave_a (+/-)
        mysteryAmt: 0.00,  // react drives wave_mystery (+/-)
        orbitAmt:   0.00,  // react orbits wave_x/wave_y in a circle (0..1)
        // Per-slider source override. Empty string = use the global `source`
        // above. Otherwise one of: 'bass' | 'mid' | 'treb' | 'vol' | 'flux'.
        // Lets a user pump wave size with bass while shape morphs with treble.
        perSrc: { scaleAmt: '', opacityAmt: '', mysteryAmt: '', orbitAmt: '' },
    },
    // Solid-mode fx — only applied when a variation with a `solid:` base is active.
    // All default to 0 so "Solid" out of the box is truly static (no breath, no pulse).
    solidPulse: 0,        // bass multiplier: col *= (1 + bass * pulse)
    solidBreath: 0,       // slow sine amplitude: col *= mix(1, 0.5+0.5*sin(t*0.6), breath)
    solidShift: 0,        // beat-driven mix amount toward solidColorB (uses bass_att)
    solidColorB: [0, 0, 0],
    solidReactSource: 'bass',  // 'bass' | 'mid' | 'treb' | 'vol'
    solidReactCurve: 'linear', // 'linear' | 'squared' | 'cubed' | 'threshold'
    // Phase 12 — shared Source/Curve for the audio-reactive Grade rack (the per-fader
    // amounts live in baseVals). Top-level strings, mirroring solidReactSource/Curve.
    studio_grade_react_source: 'bass', studio_grade_react_curve: 'linear',
    // §18 — Club / Dark Mode: one-knob final-output dark-room tune (crush blown white,
    // deepen primaries). 0 = off → byte-identical. Top-level (whole-preset output op),
    // round-trips with save/load like studio_grade_react_source.
    clubMode: 0,
    // Phase 8 — Color Field. Spreads the Shift A→B blend across SPACE, not just
    // time: 'flat' = the classic flat Shift (byte-identical, so old presets are
    // unchanged); linear/radial/plasma make the background a moving multi-colour
    // field that still pulses with the audio. scale = pattern frequency, speed =
    // how fast it drifts. Lives outside baseVals; round-trips via ...currentState.
    bgField: { style: 'flat', scale: 1.0, speed: 0.3, spin: 0, sharp: 0, tri: false, react: 0 },  // Phase 13: spin (rotate over time), sharp (0=gradient,1=hard bands), tri (3-colour A→B→C), react (field breathes to the beat)
    // Phase 8.2 — Background colour A, distinct from the foreground wave colour
    // (wave_r/g/b). null = fall back to the wave colour (so old presets that never
    // had this are byte-identical). Set by the palette/roll to a contrasting
    // harmony colour so the background field ≠ the wave/shapes/flow on top of it.
    bgColorA: null,
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
            decay: 0.90, gammaadj: 2.0,
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
            decay: 0.90, gammaadj: 2.0,
            wave_a: 0,
        },
    },
    // NOTE: the motion/wave "variations" (Drift/Pulse/Storm/Ripple/Radiate/Scatter/
    // Bloom) were removed 2026-06-01 — canned looks that didn't aid creativity and
    // overlapped the 1,144 bundled library + 🎲 Remix. Solid + Shift stay because
    // they're background colour MODES (the engine behind the Colour Field), not
    // presets. DEFAULT_VARIATION_INDEX (1 = Shift) is unchanged.
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

// ─── Color Studio (Phase 6 — milkdrop-tools-dev.md §10) ─────────────────────────
// Foundation for richer colour tooling. `buildHarmonyPalette(rule, hue)` turns a
// base hue + a colour-theory rule into a coherent { wave, glow, accent } that
// _applyPalette() can consume directly (locks honoured). Future controls (rule
// picker, HSL sliders, gradient ramp, mood presets) build on these primitives.
const HARMONY_RULES = [
    { id: 'mono',   name: 'Monochrome',      offsets: [0, 0, 0] },
    { id: 'analog', name: 'Analogous',       offsets: [0, 30, -30] },
    { id: 'comp',   name: 'Complementary',   offsets: [0, 0, 180] },
    { id: 'split',  name: 'Split-complement', offsets: [0, 150, 210] },
    { id: 'triad',  name: 'Triadic',         offsets: [0, 120, 240] },
];

/** HSL → RGB. h in degrees [0,360), s/l in [0,1]. Returns [r,g,b] in [0,1]. */
function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const f = (n) => {
        const k = (n + h * 12) % 12;
        return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
}

// Tone presets — adjust saturation/lightness of a rolled scheme without touching
// hue/harmony, so they compose with the rule picker + Base Hue (no hue conflict,
// unlike warm/cool temperature biases which would fight the Base Hue control).
const MOODS = [
    { id: 'vivid',  name: 'Vivid',  sMul: 1.00, lOff:  0.00 },
    { id: 'neon',   name: 'Neon',   sMul: 1.20, lOff:  0.06 },
    { id: 'pastel', name: 'Pastel', sMul: 0.45, lOff:  0.22 },
    { id: 'deep',   name: 'Deep',   sMul: 0.95, lOff: -0.18 },
];

/** HSL → RGB with a tone (mood) profile applied to S/L. Undefined mood = Vivid
 *  (identity) → byte-identical to the pre-mood output. */
function _moodHsl(h, s, l, mood) {
    const m = MOODS.find(x => x.id === mood) || MOODS[0];
    const S = Math.max(0, Math.min(1, s * m.sMul));
    const L = Math.max(0.04, Math.min(0.96, l + m.lOff));
    return hslToRgb(h, S, L);
}

/** Build a coherent { wave, glow, accent } from a base hue + harmony rule + tone.
 *  Vivid saturation, mid-high lightness; mono differentiates by lightness since
 *  all three share a hue. Deterministic for a given (rule, hue, mood). */
function buildHarmonyPalette(rule, hue, mood) {
    if (rule === 'mono') {
        return {
            wave:   _moodHsl(hue, 0.85, 0.56, mood),
            glow:   _moodHsl(hue, 0.90, 0.40, mood),
            accent: _moodHsl(hue, 0.75, 0.60, mood),   // deepened (was 0.75 lightness — the lightest)
        };
    }
    const r = HARMONY_RULES.find(x => x.id === rule) || HARMONY_RULES[1];
    const [oW, oG, oA] = r.offsets;
    return {
        wave:   _moodHsl(hue + oW, 0.90, 0.56, mood),   // foreground — kept visible
        glow:   _moodHsl(hue + oG, 0.85, 0.46, mood),   // deepened a touch
        accent: _moodHsl(hue + oA, 0.95, 0.52, mood),   // deepened (was 0.60; accent fed the bright bg)
    };
}

// ─── Motion presets ──────────────────────────────────────────────────────────
// One-click coherent motion configurations. Apply touches only motion-related
// baseVals — colors / wave / palette / reactivity stay as the user has them.
// Each entry's `bv` is shallow-merged over current state.

const MOTION_PRESETS = [
    {
        name: 'Vortex', desc: 'Spinning tunnel',
        bv: { zoom: 0.98, rot: 0.35, warp: 2.2, warpanimspeed: 1.8, echo_zoom: 1.6, echo_alpha: 0.35, dx: 0, dy: 0, sx: 1.0, sy: 1.0, cx: 0.5, cy: 0.5, zoomexp: 1.0, warpscale: 1.0 },
    },
    {
        name: 'Calm Drift', desc: 'Slow & dreamy',
        bv: { zoom: 0.998, rot: 0.04, warp: 0.4, warpanimspeed: 0.35, echo_zoom: 1.3, echo_alpha: 0.15, dx: 0.005, dy: 0.003, sx: 1.0, sy: 1.0, cx: 0.5, cy: 0.5, zoomexp: 1.0, warpscale: 1.5 },
    },
    {
        name: 'Earthquake', desc: 'Jittery shake',
        bv: { zoom: 1.005, rot: 0, warp: 0.6, warpanimspeed: 2.5, echo_zoom: 1.1, echo_alpha: 0.1, dx: 0.03, dy: 0.025, sx: 1.0, sy: 1.0, cx: 0.5, cy: 0.5, zoomexp: 1.0, warpscale: 0.8 },
    },
    {
        name: 'Tunnel In', desc: 'Zooming into the void',
        bv: { zoom: 0.92, rot: 0.08, warp: 0.8, warpanimspeed: 0.6, echo_zoom: 2.0, echo_alpha: 0.4, dx: 0, dy: 0, sx: 1.0, sy: 1.0, cx: 0.5, cy: 0.5, zoomexp: 1.2, warpscale: 1.0 },
    },
    {
        name: 'Spin Lock', desc: 'Pure rotation',
        bv: { zoom: 1.0, rot: 0.55, warp: 0, warpanimspeed: 0.4, echo_zoom: 1.0, echo_alpha: 0, dx: 0, dy: 0, sx: 1.0, sy: 1.0, cx: 0.5, cy: 0.5, zoomexp: 1.0, warpscale: 1.0 },
    },
    {
        name: 'Hyperspace', desc: 'Streaks outward',
        bv: { zoom: 1.12, rot: 0, warp: 0.3, warpanimspeed: 0.8, echo_zoom: 1.0, echo_alpha: 0, dx: 0, dy: 0, sx: 1.0, sy: 1.0, cx: 0.5, cy: 0.5, zoomexp: 1.5, warpscale: 1.0 },
    },
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

// ─── Custom shapes (Phase 2 — milkdrop-tools-dev.md §8) ─────────────────────────
// The engine renders up to 4 custom shapes (butterchurn inits range(4)). A static
// shape is pure baseVals — no eqs needed. We expose a curated, no-code subset.
const MAX_SHAPES = 4;
// Opacity slider curve exponent: alpha = pos^N. >1 expands the low-alpha range
// (where the 2× feedback amplification puts most of the visible change) across
// more of the slider, so the bottom isn't twitchy and the top isn't wasted.
const SHAPE_OPACITY_CURVE = 2.0;
// Sides slider curve: sides = MIN + (MAX-MIN)*pos^N. The distinct polygons live
// at low side counts (3–12); past ~20 it's all "circle". N>1 gives the low end
// most of the slider so you can dial an exact triangle/pentagon/hexagon.
const SHAPE_SIDES_MIN = 3;
const SHAPE_SIDES_MAX = 64;
const SHAPE_SIDES_CURVE = 2.5;
// A fresh shape preset defaults to this decay (short, crisp trail) instead of the
// global 0.98 (long, "permanent"-looking smear) so new shapes read clean. Applied in
// all modes on the first shape (see _addShape). Trail slider bottoms out at true zero.
const SHAPE_DEFAULT_DECAY = 0.85;
// Picking a Flow Style seeds a fuller feedback so the warp field actually FILLS the
// screen (MilkDrop fills via high decay + the warp loop; our clean 0.88–0.92 default
// left flows thin — milkdrop-tools-dev.md §3.10). Opt-in (you picked a flow), so it
// never reintroduces the permanent-gray BLANK default; seed-when-clean only, Trail
// still dials it back.
const FLOW_FILL_DECAY = 0.96;
// Mirrors butterchurn's shapeBaseValsDefaults; a fresh shape is enabled, magenta,
// centred, hexagonal, no border, normal blend.
function makeShapeDefaults() {
    return {
        baseVals: {
            enabled: 1, sides: 6, additive: 0, thickoutline: 0, textured: 0, num_inst: 1,
            tex_zoom: 1, tex_ang: 0, x: 0.5, y: 0.5, rad: 0.15, ang: 0,
            // Shapes are a 2-colour radial gradient (centre r/g/b/a → edge r2/g2/b2/a2).
            // We expose one Fill colour and keep the edge matched to it (mono-colour)
            // so a shape is the colour you pick — no stray green from the stock edge
            // default. (A real gradient control is a deferred follow-up.)
            r: 1, g: 0.2, b: 0.6, a: 1, r2: 1, g2: 0.2, b2: 0.6, a2: 1,
            border_r: 1, border_g: 1, border_b: 1, border_a: 0,
        },
        // Phase 3 — per-shape animation. motion = time-driven; react = audio-driven
        // (full Source/Curve/per-slider menu like the Wave tab). 0 = static.
        // frame_eqs_str is generated from these at runtime, never stored.
        motion: { spin: 0, orbit: 0 },
        react: {
            source: 'bass', curve: 'linear',
            sizeAmt: 0, opacityAmt: 0, spinAmt: 0, shakeAmt: 0, sidesAmt: 0,
            perSrc: { sizeAmt: '', opacityAmt: '', spinAmt: '', shakeAmt: '', sidesAmt: '' },
        },
        init_eqs_str: '', frame_eqs_str: '',
    };
}

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

// ─── Palette UI persistence ──────────────────────────────────────────────────
// Locks and My Mix live in localStorage, not in the preset. They're user-level
// preferences (muscle-memory across sessions), not preset state.

const PALETTE_LOCKS_KEY = 'dc.palette.locks';
const MY_MIX_KEY = 'dc.palette.myMix';

function loadPaletteLocks() {
    try {
        const raw = localStorage.getItem(PALETTE_LOCKS_KEY);
        if (!raw) return { wave: false, glow: false, accent: false };
        const v = JSON.parse(raw);
        return { wave: !!v.wave, glow: !!v.glow, accent: !!v.accent };
    } catch { return { wave: false, glow: false, accent: false }; }
}
function savePaletteLocks(locks) {
    try { localStorage.setItem(PALETTE_LOCKS_KEY, JSON.stringify(locks)); } catch { /* quota / SSR */ }
}

// Remix (🎲 full-stack roll) per-group locks — pin a group and Remix re-rolls only
// the rest. Session preference (localStorage), not saved per-preset.
const REMIX_LOCKS_KEY = 'dc.remix.locks';
const REMIX_LOCK_GROUPS = ['colours', 'field', 'motion', 'flow', 'reactivity'];
function loadRemixLocks() {
    const blank = { colours: false, field: false, motion: false, flow: false, reactivity: false };
    try {
        const v = JSON.parse(localStorage.getItem(REMIX_LOCKS_KEY) || '{}');
        REMIX_LOCK_GROUPS.forEach(k => { blank[k] = !!v[k]; });
        return blank;
    } catch { return blank; }
}
function saveRemixLocks(locks) {
    try { localStorage.setItem(REMIX_LOCKS_KEY, JSON.stringify(locks)); } catch { /* quota / SSR */ }
}

function loadMyMix() {
    try {
        const raw = localStorage.getItem(MY_MIX_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (!Array.isArray(v.wave) || !Array.isArray(v.glow) || !Array.isArray(v.accent)) return null;
        return v;
    } catch { return null; }
}
function saveMyMix(mix) {
    try { localStorage.setItem(MY_MIX_KEY, JSON.stringify(mix)); } catch { /* quota */ }
}

/**
 * Build a labeled range slider row and append it to `container`.
 * Returns the <input type="range"> element.
 *
 * Double-clicking the slider's label resets it to its initial `value` (the
 * BLANK default for most sliders). The reset is wired by dispatching a
 * synthetic pointerdown → input → pointerup sequence on the input element, so
 * the existing handlers' snapshot logic fires and the reset is undoable.
 */
function makeSlider(container, { id, label, min, max, step, value, decimals = 2 }) {
    const pct = ((value - min) / (max - min)) * 100;
    const wrap = document.createElement('div');
    wrap.className = 'slider-row';
    wrap.innerHTML = `
    <div class="slider-header">
      <span class="slider-label is-resettable" title="Double-click to reset to ${Number(value).toFixed(decimals)}">${label}</span>
      <span class="slider-value" id="${id}-val">${Number(value).toFixed(decimals)}</span>
    </div>
    <input
      type="range" id="${id}" class="slider"
      min="${min}" max="${max}" step="${step}" value="${value}"
      style="--pct:${pct}%"
    />
  `;
    container.appendChild(wrap);
    const input = wrap.querySelector('input');
    const labelEl = wrap.querySelector('.slider-label');
    labelEl.addEventListener('dblclick', () => {
        if (parseFloat(input.value) === Number(value)) return;
        input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    });
    return input;
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

        // Palette UI state — session-only, persisted to localStorage. Locks
        // gate palette-chip writes per channel; My Mix is a user-saved 13th
        // chip; hover backup powers transient preview without polluting undo.
        this._paletteLock = loadPaletteLocks();
        this._remixLock = loadRemixLocks();
        this._rolling = false;   // batch flag: true only during _rollFullStack (defers engine reloads)
        this._bundledBase = false;   // true when a raw bundled MilkDrop preset is the active base (Meld can't override its warp → blocked w/ a modal). Cleared the moment the editor takes over the warp (Flow style / Remix) or on any reset/load.
        this._myMix = loadMyMix();
        this._palettePreviewBackup = null;

        this.onchange = null;   // set by main.js for dirty-state tracking

        this._buildBaseVariations();
        this._buildPaletteChips();
        this._bindPaletteLocks();
        this._bindMyMixSave();
        this._bindColorStudio();
        this._buildPaletteStrengthSliders();
        this._buildPaletteSliders();
        this._buildGradeReactPanel();
        this._buildSceneFxPanel();
        this._bindPaletteOpacity();
        this._bindClubMode();
        this._buildSolidFxPanel();
        this._buildFlowStyleSection();
        this._buildImageWarpSection();
        this._buildMotionEngineSection();
        this._buildMotionPresetsGrid();
        this._bindSurpriseButton();
        this._bindRemixLocks();
        this._buildMotionSliders();
        this._buildMotionReactPanel();
        this._buildWaveReactPanel();
        this._buildWaveModeGrid();
        this._buildWaveSliders();
        this._buildShapesSection();
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
        this._bindBgTransparent();
        this._bindHdUploads();
        this._bindCollapseAll();
        this._bindAddTextLayer();
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
        // A/B "A" = the entry baseline. Init applied the Shift landing to currentState
        // but originalState was still BLANK (which carries a wave) — so pressing A
        // showed a stray wave string instead of the clean Shift entry. Re-baseline it
        // to the actual landing so A == what you started on.
        this.originalState = deepClone(this.currentState);

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
        // Reset Images Only + Transparent BG when switching to a (non-layers) variation
        this._imagesOnly = false;
        this.currentState.imagesOnly = false;
        this.currentState.bgTransparent = false;
        const ioToggle = document.getElementById('toggle-images-only');
        if (ioToggle) ioToggle.checked = false;
        const bgToggle = document.getElementById('toggle-bg-transparent');
        if (bgToggle) bgToggle.checked = false;
        this.engine?.canvas?.classList.remove('bg-transparent-checker');
        this._postSnap();
        if (!this._rolling) {            // batched by _rollFullStack → one reload at the end
            this._buildCompShader();
            this._applyToEngine();
            this._syncAllControls();
        }
        this._clearPaletteActive();
        this._updateSolidFxVisibility(v);
        document.querySelectorAll('.base-var-btn').forEach((el, idx) => {
            el.classList.toggle('active', idx === i);
        });
    }

    /**
     * Ensure the feedback buffer has content to show. Solid/Shift variations paint
     * a flat colour and ship wave_a:0, so a bare wave / motion / flow would be
     * invisible — seed a wave when nothing is drawn so there's something to see.
     *
     * Does NOT clear the Solid colour: all content composites OVER the Palette
     * colour (see _buildCompShader), so the background is never blacked out. This
     * replaced the old _wakeFeedbackIfSolid, which cleared solid → black on every
     * wave/shape/motion touch (the "everything goes black" bug). Caller owns
     * pre/postSnap; rebuilds the comp + re-applies so the seeded wave shows.
     */
    _ensureFeedbackContent() {
        // A shape IS content — so only seed a wave when there's no enabled shape
        // AND the wave is hidden. Otherwise adding a shape would also switch on an
        // unwanted oscilloscope.
        const hasShape = (this.currentState.shapes || []).some(s => s && s.baseVals && s.baseVals.enabled !== 0);
        if (!hasShape && this.currentState.baseVals.wave_a < 0.001) {
            this.currentState.baseVals.wave_a = 0.8;
            this._syncWaveControls?.();
        }
        this._buildCompShader();
        this._applyToEngine();
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

        // ── Color Field (Phase 8): style picker + Scale / Motion sliders ──
        const fieldBtns = document.querySelectorAll('#bgfield-style .lseg');
        fieldBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this._preSnap();
                fieldBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                (this.currentState.bgField || (this.currentState.bgField = deepClone(BLANK.bgField))).style = btn.dataset.field;
                this._postSnap();
                this._buildCompShader();
                this._applyToEngine();
            });
        });
        const fieldSliders = document.getElementById('bgfield-sliders');
        if (fieldSliders) {
            [
                { id: 'bgf-scale', label: 'Scale', min: 0.2, max: 3.0, step: 0.05, key: 'scale' },
                { id: 'bgf-speed', label: 'Motion', min: 0.0, max: 2.0, step: 0.05, key: 'speed' },
                { id: 'bgf-spin', label: 'Spin', min: -1.0, max: 1.0, step: 0.02, key: 'spin' },
                { id: 'bgf-sharp', label: 'Sharpness', min: 0.0, max: 1.0, step: 0.02, key: 'sharp' },
                { id: 'bgf-react', label: 'Beat', min: 0.0, max: 1.0, step: 0.02, key: 'react' },
            ].forEach(cfg => {
                const bgf = this.currentState.bgField || (this.currentState.bgField = deepClone(BLANK.bgField));
                const input = makeSlider(fieldSliders, { ...cfg, value: bgf[cfg.key] });
                const valEl = document.getElementById(`${cfg.id}-val`);
                input.addEventListener('pointerdown', () => this._preSnap());
                input.addEventListener('input', () => {
                    const v = parseFloat(input.value);
                    if (valEl) valEl.textContent = v.toFixed(2);
                    input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                    (this.currentState.bgField || (this.currentState.bgField = deepClone(BLANK.bgField)))[cfg.key] = v;
                    this._buildCompShader();
                    this._applyToEngine();
                });
                input.addEventListener('pointerup', () => this._postSnap());
            });
        }
        const triToggle = document.getElementById('bgfield-tri');
        if (triToggle) {
            triToggle.addEventListener('change', () => {
                this._preSnap();
                (this.currentState.bgField || (this.currentState.bgField = deepClone(BLANK.bgField))).tri = triToggle.checked;
                this._postSnap();
                this._buildCompShader();
                this._applyToEngine();
            });
        }
    }

    /** Reflect bgField state onto the Color Field controls (style button + sliders). */
    _syncBgField() {
        const bgf = this.currentState.bgField || (this.currentState.bgField = deepClone(BLANK.bgField));
        if (bgf.spin == null) bgf.spin = 0;     // backfill pre-v2 presets
        if (bgf.sharp == null) bgf.sharp = 0;
        if (bgf.react == null) bgf.react = 0;
        document.querySelectorAll('#bgfield-style .lseg').forEach(b => {
            b.classList.toggle('active', b.dataset.field === (bgf.style || 'flat'));
        });
        const triToggle = document.getElementById('bgfield-tri');
        if (triToggle) triToggle.checked = !!bgf.tri;
        [['bgf-scale', 'scale', 0.2, 3.0], ['bgf-speed', 'speed', 0.0, 2.0], ['bgf-spin', 'spin', -1.0, 1.0], ['bgf-sharp', 'sharp', 0.0, 1.0], ['bgf-react', 'react', 0.0, 1.0]].forEach(([id, key, min, max]) => {
            const input = document.getElementById(id);
            if (!input) return;
            const v = bgf[key];
            input.value = v;
            const valEl = document.getElementById(`${id}-val`);
            if (valEl) valEl.textContent = Number(v).toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
        });
    }

    // ─── Palette chips ────────────────────────────────────────────────────────

    /** Color Studio (Phase 6 v1). Bind the 🎲 Colors roll. Future colour controls
     *  (rule picker, HSL, gradient, mood presets) wire up here too. Called once. */
    _bindColorStudio() {
        // Generator state (transient tool settings — not persisted with the preset).
        // _csRule / _csMood are nullable: null = "not chosen" (no chip highlighted).
        // A rule/mood chip is a toggle (click again to clear); 🎲 Colors picks a
        // random rule + mood + hue and reflects them in the chips. When a dimension
        // is null we build with a sensible default (rule→Analogous, mood→Vivid).
        if (this._csHue == null) this._csHue = Math.floor(Math.random() * 360);
        if (this._csRule === undefined) this._csRule = null;
        if (this._csMood === undefined) this._csMood = null;
        this._buildColorStudioControls();
        document.getElementById('btn-roll-colors')?.addEventListener('click', () => this._rollRandomPalette());
    }

    /** Build the harmony-rule chips, the tone/mood chips, and the Base Hue slider.
     *  All drive the same buildHarmonyPalette primitives the 🎲 roll uses, so the
     *  roll is steerable; chips toggle (click the active one to clear). */
    _buildColorStudioControls() {
        const buildChips = (wrapId, defs, dataKey, handler) => {
            const wrap = document.getElementById(wrapId);
            if (!wrap || wrap.children.length) return;
            defs.forEach(d => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'cs-rule-chip';
                b.dataset[dataKey] = d.id;
                b.textContent = d.name;
                b.addEventListener('click', () => handler(d.id));
                wrap.appendChild(b);
            });
        };
        buildChips('cs-rule-chips', HARMONY_RULES, 'rule', id => this._pickColorRule(id));
        buildChips('cs-mood-chips', MOODS, 'mood', id => this._pickColorMood(id));
        const hueWrap = document.getElementById('cs-hue-row');
        if (hueWrap && !document.getElementById('cs-hue')) {
            const input = makeSlider(hueWrap, { id: 'cs-hue', label: 'Base Hue', min: 0, max: 360, step: 1, value: this._csHue, decimals: 0 });
            const valEl = document.getElementById('cs-hue-val');
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(0);
                input.style.setProperty('--pct', `${(v / 360) * 100}%`);
                this._csHue = v;
                this._applyColorStudio(false); // snap=false: one undo step per drag
            });
            input.addEventListener('pointerup', () => this._postSnap());
        }
        this._syncColorStudioControls();
    }

    /** Build + apply a scheme from the current generator state. null rule/mood fall
     *  back to Analogous / Vivid so the scheme is always coherent. */
    _applyColorStudio(snap = true) {
        const rule = this._csRule || 'analog';
        this._applyPalette({ name: 'Custom', ...buildHarmonyPalette(rule, this._csHue, this._csMood) }, 'random', snap);
        this._syncColorStudioControls();
    }

    /** Toggle a harmony rule (click the active one to clear → back to no selection). */
    _pickColorRule(rule) {
        this._csRule = (this._csRule === rule) ? null : rule;
        this._applyColorStudio();
    }

    /** Toggle a tone (Vivid / Neon / Pastel / Deep); clear by clicking the active one. */
    _pickColorMood(mood) {
        this._csMood = (this._csMood === mood) ? null : mood;
        this._applyColorStudio();
    }

    /** 🎲 Colors — fully random: random hue + random rule + random tone, then
     *  reflect all three in the chips/slider. Honours per-channel 🔒 locks. */
    _rollRandomPalette(darkBias = false) {
        this._csHue = Math.floor(Math.random() * 360);
        this._csRule = HARMONY_RULES[Math.floor(Math.random() * HARMONY_RULES.length)].id;
        if (darkBias) {
            // VJ/DJ darkening (Remix only): weight the tone toward DEEP/VIVID and make the
            // white-pushers (Pastel/Neon) rare — not banned, just much better odds for richness.
            // (Was uniform 25% each.) Standalone 🎲 Colors stays neutral.
            const m = Math.random();
            this._csMood = m < 0.42 ? 'vivid' : m < 0.74 ? 'deep' : m < 0.90 ? 'neon' : 'pastel';
        } else {
            this._csMood = MOODS[Math.floor(Math.random() * MOODS.length)].id;
        }
        this._applyColorStudio();
    }

    /** Reflect generator state in the UI. null rule/mood → no chip highlighted. */
    _syncColorStudioControls() {
        document.querySelectorAll('#cs-rule-chips .cs-rule-chip').forEach(el =>
            el.classList.toggle('active', el.dataset.rule === this._csRule));
        document.querySelectorAll('#cs-mood-chips .cs-rule-chip').forEach(el =>
            el.classList.toggle('active', el.dataset.mood === this._csMood));
        this._syncSlider('cs-hue', this._csHue, 0, 360, 0);
    }

    _buildPaletteChips() {
        const grid = document.getElementById('palette-grid');
        grid.innerHTML = '';
        const chipDefs = PALETTES.map((p, i) => ({ p, key: String(i) }));
        // My Mix appears as the last chip when saved. Key 'mymix' is used to
        // distinguish from numeric palette indices in click/hover handlers.
        if (this._myMix) {
            chipDefs.push({ p: { name: 'My Mix', ...this._myMix }, key: 'mymix' });
        }
        chipDefs.forEach(({ p, key }) => {
            const wHex = rgbToHex(...p.wave);
            const gHex = rgbToHex(...p.glow);
            const aHex = rgbToHex(...p.accent);
            const btn = document.createElement('button');
            btn.className = 'palette-chip' + (key === 'mymix' ? ' palette-chip--mymix' : '');
            btn.setAttribute('data-tooltip', p.name);
            btn.dataset.palette = key;
            btn.innerHTML = `
        <span class="chip-dots">
          <span class="chip-dot" style="background:${wHex}"></span>
          <span class="chip-dot chip-dot--glow" style="background:${gHex}"></span>
          <span class="chip-dot chip-dot--accent" style="background:${aHex}"></span>
        </span>
        <span class="chip-name">${p.name}</span>
      `;
            btn.addEventListener('mouseenter', () => this._previewPaletteEnter(p));
            btn.addEventListener('mouseleave', () => this._previewPaletteLeave());
            btn.addEventListener('click', () => this._applyPalette(p, key));
            grid.appendChild(btn);
        });
    }

    /**
     * Apply a palette to currentState. `p` is { wave, glow, accent }; `key` is
     * the chip's identifier ('0'..'11' for builtins, 'mymix' for the saved
     * mix) used to highlight the active chip. Locked channels are skipped.
     */
    _applyPalette(p, key, snap = true) {
        // Clear the hover backup so the upcoming mouseleave doesn't restore
        // over the colors we're about to commit.
        this._palettePreviewBackup = null;
        // snap=false lets a live drag (e.g. Base Hue) bracket the whole gesture in
        // one undo step via its own pointerdown/up _preSnap/_postSnap.
        if (snap) this._preSnap();
        const bv = this.currentState.baseVals;
        if (!this._paletteLock.wave) {
            [bv.wave_r, bv.wave_g, bv.wave_b] = p.wave;
        }
        if (!this._paletteLock.glow) {
            [bv.ob_r, bv.ob_g, bv.ob_b] = p.glow;
            // Shift Color B = Glow for cohesive two-color blends
            this.currentState.solidColorB = p.glow.slice();
        }
        if (!this._paletteLock.accent) {
            [bv.ib_r, bv.ib_g, bv.ib_b] = p.accent;
            // 8.2 — give the background field its own colour (the accent), so the
            // field (bgColorA→Shift) differs from the foreground wave (= p.wave).
            this.currentState.bgColorA = p.accent.slice();
        }
        // NOTE: do not touch ob_a/ob_size/ib_a/ib_size here. Chip paints colors
        // only; border intensity is owned by the Glow/Accent Strength sliders
        // (Palette tab) and the matching Appearance sliders.
        if (snap) this._postSnap();
        // Rebuild comp shader so solid-color base picks up the new wave_r/g/b.
        // Skipped during a Remix roll — _rollFullStack does one reload at the end.
        if (!this._rolling) {
            this._buildCompShader();
            this._applyToEngine();
        }
        this._syncColorSwatches();
        this._syncPaletteSliders();
        this._syncSolidFx(); // Update shift color swatch
        // Highlight active chip
        document.querySelectorAll('.palette-chip').forEach((el) => {
            el.classList.toggle('active', el.dataset.palette === String(key));
        });
    }

    /**
     * Hover preview — paint palette colors live without snapping undo. Skips
     * locked channels so a "wave-locked + remix glow" flow shows the same wave
     * the user has now. Backup is restored by _previewPaletteLeave.
     */
    _previewPaletteEnter(p) {
        // If a preview is already active (rapid chip-to-chip mouseover), keep
        // the original backup — only the first enter captures the true state.
        const bv = this.currentState.baseVals;
        if (!this._palettePreviewBackup) {
            this._palettePreviewBackup = {
                wave: [bv.wave_r, bv.wave_g, bv.wave_b],
                glow: [bv.ob_r, bv.ob_g, bv.ob_b],
                accent: [bv.ib_r, bv.ib_g, bv.ib_b],
                solidColorB: (this.currentState.solidColorB || [0, 0, 0]).slice(),
                bgColorA: this.currentState.bgColorA ? this.currentState.bgColorA.slice() : null,
            };
        }
        if (!this._paletteLock.wave) {
            [bv.wave_r, bv.wave_g, bv.wave_b] = p.wave;
        }
        if (!this._paletteLock.glow) {
            [bv.ob_r, bv.ob_g, bv.ob_b] = p.glow;
            this.currentState.solidColorB = p.glow.slice();
        }
        if (!this._paletteLock.accent) {
            [bv.ib_r, bv.ib_g, bv.ib_b] = p.accent;
            this.currentState.bgColorA = p.accent.slice();
        }
        this._buildCompShader();
        this._applyToEngine(true);
    }

    _previewPaletteLeave() {
        if (!this._palettePreviewBackup) return;
        const bv = this.currentState.baseVals;
        const b = this._palettePreviewBackup;
        [bv.wave_r, bv.wave_g, bv.wave_b] = b.wave;
        [bv.ob_r, bv.ob_g, bv.ob_b] = b.glow;
        [bv.ib_r, bv.ib_g, bv.ib_b] = b.accent;
        this.currentState.solidColorB = b.solidColorB.slice();
        this.currentState.bgColorA = b.bgColorA;
        this._palettePreviewBackup = null;
        this._buildCompShader();
        this._applyToEngine(true);
    }

    /** Wire the three per-channel lock buttons. Lock state persists across sessions. */
    _bindPaletteLocks() {
        const channels = ['wave', 'glow', 'accent'];
        channels.forEach(ch => {
            const btn = document.getElementById(`lock-${ch}`);
            if (!btn) return;
            const sync = () => {
                const locked = !!this._paletteLock[ch];
                btn.textContent = locked ? '🔒' : '🔓';
                btn.setAttribute('aria-pressed', String(locked));
            };
            sync();
            btn.addEventListener('click', () => {
                this._paletteLock[ch] = !this._paletteLock[ch];
                savePaletteLocks(this._paletteLock);
                sync();
            });
        });
    }

    /** Wire the "+ Save current mix" button. Rebuilds the chip grid so the new
     *  mix appears as the 13th chip immediately. */
    _bindMyMixSave() {
        const btn = document.getElementById('btn-save-mymix');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const bv = this.currentState.baseVals;
            this._myMix = {
                wave:   [bv.wave_r, bv.wave_g, bv.wave_b],
                glow:   [bv.ob_r,   bv.ob_g,   bv.ob_b],
                accent: [bv.ib_r,   bv.ib_g,   bv.ib_b],
            };
            saveMyMix(this._myMix);
            this._buildPaletteChips();
        });
    }

    // ─── Palette strength sliders (Glow / Accent bloom) ─────────────────────
    // Live under the Quick Palettes grid. Drive a colored bloom (blurred feedback
    // tinted by the Glow / Accent colour) baked into the comp shader — see
    // _buildCompShader. Replaced the old border-ring mapping (ob_a/ib_a), which
    // only ever drew an edge rectangle; the literal border rings are still on the
    // Appearance Outer/Inner Border sliders for anyone who wants them.

    _buildPaletteStrengthSliders() {
        const container = document.getElementById('palette-strength-sliders');
        if (!container) return;
        // Glow / Accent Strength drive a colored BLOOM (a soft halo from the blurred
        // feedback buffer, tinted by the Glow / Accent colour) baked into the comp
        // shader — a real glow on the visualisation, NOT the old edge-border ring
        // (which only ever drew a rectangle at the screen edge). The literal border
        // rings are still available via the Appearance Outer/Inner Border sliders.
        // studio_glow/studio_accent save via baseVals (free player parity); 0 = off.
        const configs = [
            { id: 'ps-glow-strength',   label: 'Glow Strength',   key: 'studio_glow' },
            { id: 'ps-accent-strength', label: 'Accent Strength', key: 'studio_accent' },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, { ...cfg, min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals[cfg.key] ?? 0 });
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${v * 100}%`);
                this.currentState.baseVals[cfg.key] = v;
                // Bloom is baked into the comp shader → rebuild (like paletteOpacity).
                this._buildCompShader();
                this._applyToEngine(true);
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });
    }

    // ─── Palette appearance sliders (Brightness, Trail) ──────────────────────

    _buildPaletteSliders() {
        const container = document.getElementById('palette-sliders');
        const configs = [
            { id: 'ps-decay', label: 'Trail', min: 0.85, max: 0.999, step: 0.001, value: BLANK.baseVals.decay, decimals: 3, key: 'decay' },
            { id: 'ps-ob-size', label: 'Outer Border Size', min: 0, max: 0.1, step: 0.001, value: BLANK.baseVals.ob_size, decimals: 3, key: 'ob_size' },
            { id: 'ps-ob-a', label: 'Outer Border Alpha', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.ob_a, key: 'ob_a' },
            { id: 'ps-ib-size', label: 'Inner Border Size', min: 0, max: 0.1, step: 0.001, value: BLANK.baseVals.ib_size, decimals: 3, key: 'ib_size' },
            { id: 'ps-ib-a', label: 'Inner Border Alpha', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.ib_a, key: 'ib_a' },
            { id: 'ps-wavefade', label: 'Fade Wave in Silence', min: 0, max: 2.0, step: 0.01, value: BLANK.baseVals.modwavealphabyvolume, key: 'modwavealphabyvolume' },
            { id: 'ps-saturation', label: 'Saturation', min: 0, max: 2.0, step: 0.01, value: 1.0, key: 'studio_saturation', reInject: true },
            { id: 'ps-hue', label: 'Hue Rotate', min: 0, max: 360, step: 1, value: 0, key: 'studio_hue_rotate', reInject: true },
            { id: 'ps-color-roll', label: 'Color Roll', min: 0, max: 1.5, step: 0.01, value: 0, key: 'studio_hue_roll', reInject: true },
            // Grade rack — tunes ANY loaded preset (bundled or custom). Defaults = identity.
            { id: 'ps-brightness', label: 'Brightness', min: 0.5, max: 2.0, step: 0.01, value: 1.0, key: 'studio_brightness', reInject: true },
            { id: 'ps-contrast', label: 'Contrast', min: 0.5, max: 2.0, step: 0.01, value: 1.0, key: 'studio_contrast', reInject: true },
            { id: 'ps-gamma', label: 'Gamma', min: 0.4, max: 2.5, step: 0.01, value: 1.0, key: 'studio_gamma', reInject: true },
            { id: 'ps-temp', label: 'Temperature', min: -0.3, max: 0.3, step: 0.01, value: 0, key: 'studio_temp', reInject: true },
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
                if (cfg.mirror) this._syncSlider(cfg.mirror, v, cfg.min, cfg.max, 2);
                if (cfg.reInject) this._rebuildPostFx();
                else this._applyToEngine(true);
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });
    }

    // ─── Palette opacity ──────────────────────────────────────────────────────

    _bindPaletteOpacity() {
        const input = document.getElementById('ps-opacity');
        const valEl = document.getElementById('ps-opacity-val');
        if (!input) return;
        input.dataset.defaultPos = '1';
        const label = input.closest('.slider-row')?.querySelector('.slider-label');
        if (label) {
            label.classList.add('is-resettable');
            label.addEventListener('dblclick', () => {
                input.value = input.dataset.defaultPos;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${v * 100}%`);
            this.currentState.paletteOpacity = v;
            this._buildCompShader();
            this._applyToEngine(true);
        });
        input.addEventListener('pointerup', () => this._postSnap());
    }

    // ─── 🌙 Club / Dark Mode (§18) — one-knob final-output dark-room tune ──────

    /** Bind the Club slider + one-tap "Club it" snap. Writes the top-level
     *  `currentState.clubMode` and re-injects the post-FX (it bakes into the comp
     *  tail, same path as the grade faders), so it tunes ANY loaded preset live. */
    _bindClubMode() {
        const input = document.getElementById('ps-club');
        const valEl = document.getElementById('ps-club-val');
        if (!input) return;
        const apply = (v) => {
            v = Math.max(0, Math.min(1, v));
            input.value = v;
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${v * 100}%`);
            this.currentState.clubMode = v;
            this._rebuildPostFx();
        };
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => apply(parseFloat(input.value)));
        input.addEventListener('pointerup', () => this._postSnap());
        // Double-click the label resets to 0 (off) — matches every other fader.
        input.closest('.layer-slider-row')?.querySelector('.is-resettable')
            ?.addEventListener('dblclick', () => { this._preSnap(); apply(0); this._postSnap(); });
        // One-tap "Club it" — snaps to a good default (mirrors the user's one-click Invert habit).
        document.getElementById('ps-club-snap')?.addEventListener('click', () => {
            this._preSnap();
            apply(this.currentState.clubMode >= 0.6 ? 0 : 0.6);  // toggle a strong default on/off
            this._postSnap();
        });
    }

    /** Reflect clubMode onto its slider (called from the palette sync on load/remix). */
    _syncClubMode() {
        const v = this.currentState.clubMode ?? 0;
        const input = document.getElementById('ps-club');
        const valEl = document.getElementById('ps-club-val');
        if (!input) return;
        input.value = v;
        input.style.setProperty('--pct', `${v * 100}%`);
        if (valEl) valEl.textContent = Number(v).toFixed(2);
    }

    // ─── Post-FX shader rebuild (saturation / hue rotate) ────────────────────

    _rebuildPostFx() {
        const bv = this.currentState.baseVals;
        const opts = gradeOpts(this.currentState);
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

    // ─── Grade Reactivity (Phase 12 — beat-pulse the grade over any preset) ──────

    /** Shared Source + Curve + four per-fader pulse-amount sliders. Each control
     *  re-injects the post-FX (the reactive grade bakes into the comp), so it tunes
     *  any loaded preset live — the audio-reactivity differentiator on the 1,144. */
    _buildGradeReactPanel() {
        const srcSel = document.getElementById('grade-react-source');
        if (srcSel) {
            srcSel.value = this.currentState.studio_grade_react_source || 'bass';
            srcSel.addEventListener('change', () => {
                this._preSnap();
                this.currentState.studio_grade_react_source = srcSel.value;
                this._postSnap();
                this._rebuildPostFx();
            });
        }
        const curveBtns = document.querySelectorAll('#grade-react-curve .lseg');
        curveBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curve === (this.currentState.studio_grade_react_curve || 'linear'));
            btn.addEventListener('click', () => {
                this._preSnap();
                curveBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentState.studio_grade_react_curve = btn.dataset.curve;
                this._postSnap();
                this._rebuildPostFx();
            });
        });
        const container = document.getElementById('grade-react-sliders');
        if (!container) return;
        [
            { id: 'gr-brightness', label: 'Brightness pulse', min: 0, max: 1.0, step: 0.01, key: 'studio_brightness_react' },
            { id: 'gr-contrast', label: 'Contrast pulse', min: 0, max: 1.0, step: 0.01, key: 'studio_contrast_react' },
            { id: 'gr-gamma', label: 'Gamma pulse', min: 0, max: 1.0, step: 0.01, key: 'studio_gamma_react' },
            { id: 'gr-temp', label: 'Temperature pulse', min: 0, max: 0.3, step: 0.01, key: 'studio_temp_react' },
        ].forEach(cfg => {
            const input = makeSlider(container, { ...cfg, value: this.currentState.baseVals[cfg.key] ?? 0 });
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.baseVals[cfg.key] = v;
                this._rebuildPostFx();   // reactive grade is baked into the comp
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });
    }

    /** Phase 14 — Scene FX sliders (Posterize / Vignette / Scan lines / Film grain).
     *  Final-image treatments baked into the post-FX block; re-inject on change so they
     *  tune any loaded preset. Ride baseVals → save/player-parity free. */
    _buildSceneFxPanel() {
        const container = document.getElementById('scene-fx-sliders');
        if (!container) return;
        [
            { id: 'sfx-bloom', label: 'Bloom', min: 0, max: 1.0, step: 0.01, key: 'studio_bloom' },
            { id: 'sfx-posterize', label: 'Posterize', min: 0, max: 1.0, step: 0.01, key: 'studio_posterize' },
            { id: 'sfx-vignette', label: 'Vignette', min: 0, max: 1.0, step: 0.01, key: 'studio_vignette' },
            { id: 'sfx-scanlines', label: 'Scan lines', min: 0, max: 1.0, step: 0.01, key: 'studio_scanlines' },
            { id: 'sfx-grain', label: 'Film grain', min: 0, max: 1.0, step: 0.01, key: 'studio_grain' },
        ].forEach(cfg => {
            const input = makeSlider(container, { ...cfg, value: this.currentState.baseVals[cfg.key] ?? 0 });
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.baseVals[cfg.key] = v;
                this._rebuildPostFx();   // scene FX bake into the comp post-FX block
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });
    }

    _syncSceneFx() {
        const bv = this.currentState.baseVals;
        this._syncSlider('sfx-bloom', bv.studio_bloom ?? 0, 0, 1.0, 2);
        this._syncSlider('sfx-posterize', bv.studio_posterize ?? 0, 0, 1.0, 2);
        this._syncSlider('sfx-vignette', bv.studio_vignette ?? 0, 0, 1.0, 2);
        this._syncSlider('sfx-scanlines', bv.studio_scanlines ?? 0, 0, 1.0, 2);
        this._syncSlider('sfx-grain', bv.studio_grain ?? 0, 0, 1.0, 2);
    }

    /** Reflect Grade Reactivity state onto its controls. */
    _syncGradeReact() {
        const srcSel = document.getElementById('grade-react-source');
        if (srcSel) srcSel.value = this.currentState.studio_grade_react_source || 'bass';
        document.querySelectorAll('#grade-react-curve .lseg').forEach(b =>
            b.classList.toggle('active', b.dataset.curve === (this.currentState.studio_grade_react_curve || 'linear')));
        const bv = this.currentState.baseVals;
        this._syncSlider('gr-brightness', bv.studio_brightness_react ?? 0, 0, 1.0, 2);
        this._syncSlider('gr-contrast', bv.studio_contrast_react ?? 0, 0, 1.0, 2);
        this._syncSlider('gr-gamma', bv.studio_gamma_react ?? 0, 0, 1.0, 2);
        this._syncSlider('gr-temp', bv.studio_temp_react ?? 0, 0, 0.3, 2);
    }

    // ─── Color swatches ────────────────────────────────────────────────────────

    _bindColorSwatches() {
        this._bindSwatch('wave', (hex) => {
            const [r, g, b] = hexToRgb(hex);
            this.currentState.baseVals.wave_r = r; this.currentState.baseVals.wave_g = g; this.currentState.baseVals.wave_b = b;
            // When the Background is on auto (bgColorA null), it shows the wave colour
            // as its fallback — keep that swatch in sync as the wave changes.
            if (!this.currentState.bgColorA) this._setSwatchHex('bg', hex);
        });
        this._bindSwatch('glow', (hex) => {
            const [r, g, b] = hexToRgb(hex);
            this.currentState.baseVals.ob_r = r; this.currentState.baseVals.ob_g = g; this.currentState.baseVals.ob_b = b;
        });
        this._bindSwatch('accent', (hex) => {
            const [r, g, b] = hexToRgb(hex);
            this.currentState.baseVals.ib_r = r; this.currentState.baseVals.ib_g = g; this.currentState.baseVals.ib_b = b;
        });
        // 8.2 — background field colour A, independent of the foreground wave.
        this._bindSwatch('bg', (hex) => { this.currentState.bgColorA = hexToRgb(hex); });
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
        // bg swatch shows the effective background colour (falls back to the wave
        // colour when bgColorA is unset, matching the shader).
        const bgA = this.currentState.bgColorA;
        this._setSwatchHex('bg', bgA ? rgbToHex(bgA[0], bgA[1], bgA[2]) : rgbToHex(bv.wave_r, bv.wave_g, bv.wave_b));
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

    /** Wire the footer "Remix" 🎲 button — Phase 9: the full-stack roll. One press
     *  rolls the WHOLE preset across all three creative axes — Colour (palette +
     *  Colour Field + fg/bg split), Motion (living engine), and Flow (warp field) —
     *  landing on the Shift colour engine so the field + beat-pulse are live. The
     *  result is a complete, varied, colourful, moving preset every time (not a
     *  thin line on a slab). Reuses the tested apply paths (multi-step undo). */
    _bindSurpriseButton() {
        const btn = document.getElementById('btn-surprise');
        if (!btn) return;
        btn.addEventListener('click', () => this._rollFullStack());
    }

    _rollFullStack() {
        const L = this._remixLock || {};
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];
        const rnd = (lo, hi) => +(lo + Math.random() * (hi - lo)).toFixed(2);

        // Perf: a Remix touches ~5 axes, each of which would normally rebuild the
        // comp shader + reload the engine (5 GLSL compiles per click = main-thread
        // jank). Batch them: the sub-apply methods (_applyPalette/_applyVariation/
        // _applyMotionEngine/_applyFlowStyle) skip their reload tail while _rolling,
        // and we do ONE rebuild+apply+sync at the end. Cleared right before that
        // single reload, so it's exception-safe (only the final apply can throw).
        this._rolling = true;

        // A from-scratch Remix is a NEW preset — it is NOT the Random'd MilkDrop preset that was loaded.
        // Clear the inherited parent link + wipe its title from the name field, so the stuck MilkDrop name
        // doesn't ride along into the header or a save (bug: Random title stuck after Remix). Only fires when
        // there WAS a parent (i.e. a Random'd/bundled base), so re-rolling a named custom preset keeps its name.
        if (this.currentState.parentPresetName) {
            this.currentState.parentPresetName = null;
            const nameEl = document.getElementById('preset-name-input');
            if (nameEl) nameEl.value = 'Untitled preset';
        }

        // Ensure the Shift colour engine (solid mode) is on so the Colour Field +
        // beat-pulse run. Only flips when currently in feedback mode, so repeated
        // rolls don't reset a locked palette/field.
        if (!this._solidColor) this._applyVariation(DEFAULT_VARIATION_INDEX);

        // Each group rolls only when UNLOCKED — a locked group keeps its current
        // values, so you can pin what you love and gamble the rest (Roll-and-lock).
        // ── Colours: harmony rule + tone + hue → wave/glow/accent + contrasting bgColorA.
        if (!L.colours) {
            this._rollRandomPalette(true);   // dark-biased tone (Remix is a VJ/DJ tool — see _rollRandomPalette)
            // VJ darkness — most rolls put the BACKGROUND field DARK / near-black so the bright primaries
            // pop ON black (user: "where is black?"). A deep tint of the scheme hue: reads as near-black but
            // stays alive for pure-field rolls. ~30% keep a lit background for variety. Foreground stays vivid.
            if (Math.random() < 0.7) {
                const _h = this._csHue ?? Math.floor(Math.random() * 360);
                // Floor lightness at ~0.08 — reads near-black but never DEAD (a pure-field roll on a
                // 0.05 bg could fall to pure black). Deep tint, not pure black, so the field stays alive.
                this.currentState.bgColorA = hslToRgb(_h, rnd(0.4, 0.85), rnd(0.08, 0.18));
                // Shift Color-B (the beat-pulse target) also deep → the field pulses dark↔deep, never flashes white.
                this.currentState.solidColorB = hslToRgb((_h + 40) % 360, rnd(0.4, 0.85), rnd(0.08, 0.18));
            }
            // Scene FX (Phase 14) — a final-image finish; rides the Colours/look lock.
            // Clear each roll, then rarely add ONE subtle FX (they read strong).
            const _sfx = this.currentState.baseVals;
            _sfx.studio_posterize = 0; _sfx.studio_vignette = 0; _sfx.studio_scanlines = 0; _sfx.studio_grain = 0;
            if (Math.random() < 0.25) {
                const fx = pick(['studio_posterize', 'studio_vignette', 'studio_scanlines', 'studio_grain']);
                _sfx[fx] = (fx === 'studio_vignette' || fx === 'studio_posterize') ? rnd(0.2, 0.45) : rnd(0.15, 0.3);
            }
            // 🌙 Club / Dark Mode (§18) — the structural output-darkening lever (kills blown white on the
            // FINAL frame, where the input biases above can't fully reach). ~half the rolls dial in some
            // club so the deck trends club-dark; the rest leave it off for brighter variety.
            this.currentState.clubMode = Math.random() < 0.5 ? rnd(0.2, 0.7) : 0;
        }
        // ── Colour Field + Reactivity (separate locks) + a visible wave — one snapped step.
        this._preSnap();
        if (!L.field) {
            // Mutate (don't replace) so bgField.react — rolled in the Reactivity block —
            // survives a Field-unlocked + Reactivity-locked roll.
            const _f = this.currentState.bgField || (this.currentState.bgField = deepClone(BLANK.bgField));
            _f.style = pick(['linear', 'stripes', 'weave', 'radial', 'diamond', 'moire', 'conic', 'spiral', 'rays', 'vortex', 'mandala', 'plasma', 'clouds', 'marble', 'ripples', 'checker', 'hex']);
            _f.scale = rnd(0.5, 2.5);
            _f.speed = rnd(0.15, 0.95);
            _f.spin = Math.random() < 0.5 ? 0 : rnd(-0.6, 0.6);     // sometimes a slow spin
            _f.sharp = Math.random() < 0.35 ? rnd(0.3, 0.9) : 0;    // sometimes hard bands
            _f.tri = Math.random() < 0.5;                           // ~half 3-colour
        }
        if (!L.reactivity) {
            // The audio response itself is rollable — audio reactivity is the
            // differentiator, so Remix exercises EVERY reactive axis we build.
            // 1) Shift pulse — depth + which band drives it + the response curve.
            this.currentState.solidShift = rnd(0.35, 0.85);
            this.currentState.solidReactSource = pick(['bass', 'mid', 'treb', 'vol', 'flux']);
            this.currentState.solidReactCurve = pick(['linear', 'squared', 'cubed', 'threshold']);
            // 2) Color Reactivity (Phase 12) — the colour adjustments pulse to the beat.
            //    Reuse the SAME band/curve as the Shift pulse for one cohesive audio
            //    identity. Pulse ONE main fader (brightness or contrast) + sometimes a
            //    subtle temperature sway — tasteful, not strobing chaos.
            this.currentState.studio_grade_react_source = this.currentState.solidReactSource;
            this.currentState.studio_grade_react_curve = this.currentState.solidReactCurve;
            const _gb = this.currentState.baseVals;
            _gb.studio_brightness_react = 0; _gb.studio_contrast_react = 0;
            _gb.studio_gamma_react = 0; _gb.studio_temp_react = 0;
            if (Math.random() < 0.5) _gb.studio_brightness_react = rnd(0.25, 0.5);
            else _gb.studio_contrast_react = rnd(0.25, 0.5);
            if (Math.random() < 0.4) _gb.studio_temp_react = rnd(0.05, 0.12);
            // 3) Beat-reactive Colour Field (Phase 13) — the field breathes/zooms on the
            //    beat (reuses _sr, same band). Mutate bgField so it rides the Reactivity
            //    lock independent of the Field lock's shape roll.
            (this.currentState.bgField || (this.currentState.bgField = deepClone(BLANK.bgField))).react =
                Math.random() < 0.6 ? rnd(0.3, 0.7) : 0;
        }
        this._postSnap();
        // ── Living Motion (engine).
        if (!L.motion) {
            this.currentState.motionEngine.speed = rnd(0.4, 2.2);
            this.currentState.motionEngine.depth = rnd(0.3, 0.9);
            this._applyMotionEngine(pick(MOTION_ENGINES).id);
        }
        // ── Flow (warp field) — ~35% none; else weighted ~65% toward the SOFT flows
        //    (bloom/smoke/melt) over the sharp ones, because sharp flow + high decay
        //    smears bright content into thin "string" threads (Phase 15.3 anti-string).
        if (!L.flow) {
            const _iw = this.currentState.imageWarp;
            const _driving = _iw && _iw.enabled && (this.currentState.images || []).some(e => e.texName === _iw.texName);
            if (_driving) {
                // A Drive layer is active → the melt IS the warp/flow (it overrides flowStyle).
                // Gamble the melt LOOK (flow/speed/depth/spin/zoom/flow-pulse/mirror/luma-key/
                // presence/audio) instead of flowStyle. Sliders re-sync via _syncAllControls below.
                this._rollImageWarp(pick, rnd);
            } else {
                this.currentState.flowStyle.speed = rnd(0.4, 2.2);
                this.currentState.flowStyle.depth = rnd(0.3, 0.9);
                this.currentState.flowStyle.density = rnd(0.3, 0.8);
                const _flowId = Math.random() < 0.35 ? 'none'
                    : (Math.random() < 0.65 ? pick(['bloom', 'smoke', 'melt'])
                        : pick(['tunnel', 'spiral', 'ripple', 'swirl', 'plasma', 'liquid', 'kaleido']));
                this._applyFlowStyle(_flowId);
            }
        }
        // ── Content — rolled LAST (authoritative): the Motion/Flow applies above call
        //    _ensureFeedbackContent, which would otherwise re-seed a thin wave onto a
        //    "pure" roll. Type: wave ~30% / shapes ~45% (audio-reactive blobs) /
        //    pure ~25% (field+flow carry it). Phase 16.2 RESTORED wave content now that
        //    waves can fill: within a wave roll, ~75% FILLED (broad disc/wedge via
        //    wave_fill) + ~25% thin (a deliberate accent string). A filled wave + the
        //    flow rolled above = broad blooming motion, not a thread.
        this._preSnap();
        this.currentState.shapes = [];
        this.currentState.baseVals.wave_a = 0;
        this.currentState.baseVals.wave_fill = 0;
        // When a MELD is driving, the melt IS the content — so mostly run CLEAN and let it shine instead
        // of stamping a wave/shape slab over it (user: shapes kept covering the gorgeous melt). Melt → wave
        // ~10% (thin accent only, no filled disc), shapes ~12% (ONE gentle small/translucent accent, never
        // a hero), else ~78% pure melt. NO meld → the from-scratch distribution is UNCHANGED (wave ~30% /
        // shapes ~45% / pure ~25%; shapes are the show there).
        const _meld = !!(this.currentState.imageWarp && this.currentState.imageWarp.enabled && this.currentState.imageWarp.texName);
        const _waveMax = _meld ? 0.10 : 0.30;
        const _shapeMax = _meld ? 0.22 : 0.75;
        const _content = Math.random();
        if (_content < _waveMax) {
            const _wb = this.currentState.baseVals;
            _wb.wave_mode = Math.floor(Math.random() * 8);
            _wb.wave_scale = rnd(0.5, 2.5);
            _wb.wave_a = rnd(0.3, 0.5);              // dimmer (the filled-wave rolls were the bright cluster)
            if (!_meld && Math.random() < 0.55) {    // over a melt: thin accent only (a filled disc/wedge would cover it)
                // FILLED — the broad default look: a solid disc/wedge, not a string.
                _wb.wave_fill = rnd(0.4, 0.85);
                _wb.wave_thickness = Math.random() < 0.5 ? rnd(1, 4) : 0;
            } else {
                // THIN — a deliberate, occasional accent string.
                _wb.wave_fill = 0;
                _wb.wave_thickness = Math.random() < 0.5 ? rnd(1, 3) : 0;
            }
        } else if (_content < _shapeMax) {
            const _nr = Math.random();
            const _n = _meld ? 1 : (_nr < 0.55 ? 1 : _nr < 0.85 ? 2 : 3);   // over a melt: at most ONE accent; else fewer-biased 1–3
            for (let _i = 0; _i < _n; _i++) this._addRemixShape(_meld);      // _meld → gentle (small/translucent/no hero)
        }
        // else: pure field + flow — no thin content (or, with a meld, the clean melt carries it).
        this._postSnap();
        // End the batch and do the ONE real rebuild+apply+sync for the whole roll.
        this._rolling = false;
        this._buildCompShader();
        this._applyToEngine();
        this._syncAllControls();
        const anyLocked = REMIX_LOCK_GROUPS.some(k => L[k]);
        showToast?.(anyLocked ? '🎲 Remixed — locks kept' : '🎲 Remixed');
    }

    /** Remix the Drive melt LOOK (image-texture-dev.md Phase 7). Mutates currentState.imageWarp
     *  only — no engine reload (respects the _rolling batch; the final _applyToEngine +
     *  _syncAllControls in _rollFullStack do the one rebuild + slider re-sync). Rolls the full melt
     *  incl. framing (size/position) — only which image drives (texName/enabled) is left alone.
     *  Biased gently AWAY from blown-out white. Every rolled combo renders (boring-not-broken). */
    _rollImageWarp(pick, rnd) {
        const iw = this.currentState.imageWarp;
        if (!iw) return;
        // ~45% of rolls land a "PRESENT meld" — the source image stays recognizable (high presence +
        // gentler depth/speed, no obliterating kaleido, full image visible). The rest keep the abstract,
        // dissolved variety. (User: bump the odds of actually SEEING the meld image, without killing the
        // variation — same philosophy as the white tweak.)
        const _present = Math.random() < 0.45;
        iw.flow = pick(['tunnel', 'spiral', 'ripple', 'swirl', 'plasma', 'liquid', 'kaleido', 'bloom', 'smoke', 'melt']);
        iw.speed = _present ? rnd(0.4, 1.4) : rnd(0.1, 2.2);              // gentler evolution when present
        iw.depth = _present ? rnd(0.2, 0.5) : rnd(0.35, 0.9);            // softer warp → image not obliterated
        iw.spin = Math.random() < 0.4 ? rnd(0.1, 0.6) : 0;
        iw.zoomPulse = Math.random() < 0.4 ? rnd(0.2, 0.6) : 0;
        // ── Shared DISTORTION budget — Flow Pulse / Displacement / Flow Map each FRACTURE the melt.
        // Rolled independently they used to STACK (2–3 at once → the image shattered / animated out on
        // ~30% of rolls). Each one's odds + range are UNCHANGED, but now AT MOST ONE wins per roll: the
        // three rollers are shuffled (so no single effect is favoured) and we stop at the first hit, so they
        // never pile up. (User: the breakup is fantastic — keep it as the occasional surprise, not every roll.)
        iw.flowPulse = 0; iw.disp = 0; iw.flowMap = 0;
        const _distRollers = [
            () => { if (Math.random() < 0.4) iw.flowPulse = rnd(0.3, 0.8); return iw.flowPulse > 0; },                  // §13.6 Flow Pulse
            () => { if (Math.random() < 0.4) iw.disp = _present ? rnd(0.0, 0.3) : rnd(0.2, 0.8); return iw.disp > 0; }, // §16.A Displacement (gentle on present)
            () => { if (Math.random() < 0.3) iw.flowMap = _present ? rnd(0.15, 0.45) : rnd(0.3, 0.9); return iw.flowMap > 0; }, // §16 #4 Flow Map
        ];
        for (let i = _distRollers.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_distRollers[i], _distRollers[j]] = [_distRollers[j], _distRollers[i]]; }
        for (const _roll of _distRollers) { if (_roll()) break; }
        iw.lumaKey = (!_present && Math.random() < 0.5) ? rnd(0.3, 0.8) : 0;  // keep the whole image when present
        // Mask (§16 #3): the image's bright shape becomes a crisp stencil (logo-like). Special-occasion
        // (~20%); never paired with Luma Key (both gate presence — together they'd over-thin the image).
        iw.mask = (iw.lumaKey === 0 && Math.random() < 0.2) ? rnd(0.4, 0.9) : 0;
        // Palette-from-image (§19): tint the melt by the image's own colours. ~35%; stronger when present
        // (the image's colour mood reads on the recognizable source). Needs a palette — extract if missing.
        iw.tint = Math.random() < 0.35 ? (_present ? rnd(0.35, 0.75) : rnd(0.25, 0.6)) : 0;
        if (iw.tint > 0 && !iw.imgPalette && iw.texName) {
            this._extractImagePalette(iw.texName).then((pal) => {
                const cw = this.currentState.imageWarp;
                if (pal && cw && cw.texName === iw.texName) { cw.imgPalette = pal; this._applyToEngine(); }
            });
        }
        // Present rolls rarely kaleido (it folds the image into a pattern → unrecognizable).
        iw.mirror = Math.random() < (_present ? 0.15 : 0.35) ? pick(_present ? ['h', 'v', 'quad'] : ['h', 'v', 'quad', 'kaleido']) : 'none';
        iw.kaleidoSpeed = iw.mirror === 'kaleido' ? rnd(0.05, 0.6) : 0;
        // Blend mode — weighted. The white-LIGHTENING modes (add/screen) blow out to bright white, so
        // roll them a bit LESS and pair them with a gentler presence (user: "roll bright white a little
        // less"). mix/overlay/multiply/difference don't blow white.
        const _bm = Math.random();
        iw.blendMode = _present
            // Present roll → image-faithful blends (skip Difference; rare Multiply) so the source reads.
            ? (_bm < 0.5 ? 'mix' : _bm < 0.7 ? 'overlay' : _bm < 0.85 ? 'add' : _bm < 0.95 ? 'screen' : 'multiply')
            : (_bm < 0.42 ? 'mix' : _bm < 0.62 ? 'overlay' : _bm < 0.76 ? 'add'
                : _bm < 0.86 ? 'screen' : _bm < 0.94 ? 'multiply' : 'difference');
        const _lightens = (iw.blendMode === 'add' || iw.blendMode === 'screen');
        // Presence: HIGH on a present roll (image reads clearly); otherwise the dissolved/abstract range.
        // Lightening blends keep a gentler presence (white-blow guard) even when present.
        iw.reseed = _present ? (_lightens ? rnd(0.32, 0.5) : rnd(0.5, 0.78))
                             : (_lightens ? rnd(0.10, 0.22) : rnd(0.15, 0.40));
        // Audio reactivity is the differentiator — Remix exercises it.
        iw.audioSource = Math.random() < 0.6 ? pick(['bass', 'mid', 'treb']) : 'none';
        iw.audioAmt = rnd(0.3, 0.7);
        // Colour/Grade (Phase 4b) — Brightness biased toward ≤1 (often a bit darker → also helps the
        // "less blown white" goal); occasional vivify / hue-shift / reverse.
        iw.bright = Math.random() < 0.5 ? rnd(0.55, 1.0) : 1.0;
        iw.contrast = rnd(0.85, 1.3);
        iw.sat = rnd(0.7, 1.6);
        iw.hue = Math.random() < 0.4 ? Math.round(rnd(0, 360)) : 0;
        iw.invert = Math.random() < 0.12;
        // Full-chaos reframe (user: "move also") — Remix now also moves/resizes the image. ~⅓ land
        // full-frame centered; the rest reframe, kept on-screen (centre in the middle ⅓) so it never
        // flies off. Size/Position sliders + pad re-sync via _syncAllControls.
        if (Math.random() < 0.35) { iw.size = 1.0; iw.cx = 0.5; iw.cy = 0.5; }
        else { iw.size = rnd(0.45, 1.25); iw.cx = rnd(0.32, 0.68); iw.cy = rnd(0.32, 0.68); }
    }

    /** Add one randomised, audio-reactive editor shape for a Remix roll — a blob or
     *  polygon that pulses to the beat. Coloured from the palette's WAVE colour so it
     *  contrasts the background field (which blends accent→Shift-colour). This is the
     *  "shapes & blobs" content type that gives Remix variety beyond the wave. */
    _addRemixShape(gentle = false) {
        const shapes = this.currentState.shapes || (this.currentState.shapes = []);
        if (shapes.filter(s => this._isEditorShape(s)).length >= MAX_SHAPES) return;
        const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
        const pick = arr => arr[Math.floor(Math.random() * arr.length)];
        const sh = makeShapeDefaults();
        const b = sh.baseVals;
        b.sides = pick([3, 4, 5, 6, 8, 16, 32, 64]);   // triangle → blob/circle
        // Additive ("glow") shapes ADD light → stacked, they were the big blown-white chunks. Make them
        // RARE (15%, was 50%) and, when additive, SMALL + lower opacity (a glint, not a white slab).
        b.additive = Math.random() < 0.15 ? 1 : 0;
        // Solid shapes: MOSTLY toned down (smaller + more translucent so the feedback shows THROUGH
        // them, not a slab on top), but ~20% land a deliberate BOLD "hero" shape up front — a big
        // bold shape is good sometimes (user), just no longer the default. Additive glows already
        // tamed (small/low-opacity). `gentle` (a shape placed OVER a melt) forces a small, translucent
        // accent — never a hero — so the melt always shows through.
        const _hero = !gentle && !b.additive && Math.random() < 0.20;
        b.rad = b.additive ? rnd(0.12, 0.30) : (_hero ? rnd(0.42, 0.60) : gentle ? rnd(0.12, 0.30) : rnd(0.15, 0.42));
        b.a   = b.additive ? rnd(0.30, 0.55) : (_hero ? rnd(0.70, 0.92) : gentle ? rnd(0.25, 0.50) : rnd(0.35, 0.72));
        b.x = rnd(0.22, 0.78); b.y = rnd(0.22, 0.78);   // wider spread → less central overlap (was 0.32–0.68)
        b.ang = rnd(0, 6.2832);
        // Foreground colour = the palette's WAVE colour → contrasts the background field.
        const cb = this.currentState.baseVals;
        b.r = cb.wave_r; b.g = cb.wave_g; b.b = cb.wave_b;
        b.r2 = b.r; b.g2 = b.g; b.b2 = b.b;
        // Motion — gentle spin / optional orbit.
        sh.motion.spin = rnd(-1, 1);
        sh.motion.orbit = Math.random() < 0.5 ? rnd(0.1, 0.5) : 0;
        // Audio reactivity — the differentiator: pulse size (+ sometimes opacity) to the beat.
        sh.react.source = pick(['bass', 'mid', 'treb']);
        sh.react.curve = pick(['linear', 'squared']);
        sh.react.sizeAmt = rnd(0.25, 0.8);
        if (Math.random() < 0.5) sh.react.opacityAmt = rnd(0.2, 0.6);
        shapes.push(sh);
    }

    /** Wire the Remix lock chips (pin a group; Remix re-rolls only the rest).
     *  Locks persist across sessions in localStorage, like the palette locks. */
    _bindRemixLocks() {
        const chips = document.querySelectorAll('#remix-locks .remix-lock');
        chips.forEach(chip => {
            const group = chip.dataset.lock;
            const sync = () => {
                const locked = !!this._remixLock[group];
                chip.classList.toggle('locked', locked);
                chip.setAttribute('aria-pressed', String(locked));
                chip.title = locked ? `${group} locked — Remix keeps it` : `${group} — Remix re-rolls it`;
            };
            sync();
            chip.addEventListener('click', () => {
                this._remixLock[group] = !this._remixLock[group];
                saveRemixLocks(this._remixLock);
                sync();
            });
        });
    }

    // ─── Motion Engine (living, time-driven motion) ─────────────────────────────

    _buildMotionEngineSection() {
        const grid = document.getElementById('motion-engine-grid');
        if (grid) {
            MOTION_ENGINES.forEach(eng => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'motion-preset-btn motion-engine-btn';
                btn.dataset.engine = eng.id;
                btn.innerHTML = `
        <span class="motion-preset-name">${eng.name}</span>
        <span class="motion-preset-desc">${eng.desc}</span>`;
                btn.addEventListener('click', () => this._applyMotionEngine(eng.id));
                grid.appendChild(btn);
            });
        }
        // Two universal knobs — Speed (rate) + Depth (amount).
        const knobWrap = document.getElementById('motion-engine-knobs');
        if (knobWrap) {
            const me = this.currentState.motionEngine;
            const speedIn = makeSlider(knobWrap, { id: 'me-speed', label: 'Speed', min: 0.1, max: 4.0, step: 0.05, value: me.speed });
            const depthIn = makeSlider(knobWrap, { id: 'me-depth', label: 'Depth', min: 0.0, max: 1.0, step: 0.01, value: me.depth });
            this._bindEngineKnob(speedIn, 'speed');
            this._bindEngineKnob(depthIn, 'depth');
        }
        this._syncMotionEngine();
    }

    _bindEngineKnob(input, key) {
        const valEl = document.getElementById(`${input.id}-val`);
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${((v - input.min) / (input.max - input.min)) * 100}%`);
            this.currentState.motionEngine[key] = v;
            // A knob nudge while an engine is active should wake feedback so the
            // change shows; nudging on 'none' just stores the value (no surprise).
            if (this.currentState.motionEngine.id !== 'none') this._ensureFeedbackContent();
            this._applyToEngine();
        });
        input.addEventListener('pointerup', () => this._postSnap());
    }

    /** Select a Motion Engine (or 'none'). Auto-wakes feedback so the living
     *  motion is visible even from the default Shift landing surface. */
    _applyMotionEngine(id) {
        this._preSnap();
        this.currentState.motionEngine.id = id;
        if (id !== 'none') this._ensureFeedbackContent();
        this._postSnap();
        if (!this._rolling) {            // batched by _rollFullStack → one reload at the end
            this._applyToEngine();
            this._syncMotionEngine();
        }
    }

    _syncMotionEngine() {
        const me = this.currentState.motionEngine || (this.currentState.motionEngine = deepClone(BLANK.motionEngine));
        document.querySelectorAll('.motion-engine-btn').forEach(el => {
            el.classList.toggle('active', el.dataset.engine === me.id);
        });
        [['me-speed', 'speed', 0.1, 4.0], ['me-depth', 'depth', 0.0, 1.0]].forEach(([id, key, min, max]) => {
            const input = document.getElementById(id);
            if (!input) return;
            const v = me[key];
            input.value = v;
            const valEl = document.getElementById(`${id}-val`);
            if (valEl) valEl.textContent = Number(v).toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
        });
    }

    // ─── Flow Style (Phase 7 — per-preset warp field) ──────────────────────────
    // Mirrors the Motion Engine: chips + Speed/Depth knobs. Picking a flow sets a
    // per-preset warp shader (buildWarpShader → runtime.warp). Auto-wakes feedback
    // since the warp field only shows in feedback mode (like the Motion Engine).
    _buildFlowStyleSection() {
        const grid = document.getElementById('flow-style-grid');
        if (grid) {
            WARP_STYLES.forEach(fs => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'motion-preset-btn motion-engine-btn';
                btn.dataset.flow = fs.id;
                btn.innerHTML = `
        <span class="motion-preset-name">${fs.name}</span>
        <span class="motion-preset-desc">${fs.desc}</span>`;
                btn.addEventListener('click', () => this._applyFlowStyle(fs.id));
                grid.appendChild(btn);
            });
        }
        const knobWrap = document.getElementById('flow-style-knobs');
        if (knobWrap) {
            const fl = this.currentState.flowStyle;
            // Speed is log-mapped (§17): slider value is the position 0..1; model stores real speed.
            makeSlider(knobWrap, { id: 'fl-speed', label: 'Speed', min: 0, max: 1, step: 0.001, value: _speedToPos(fl.speed) });
            const depthIn = makeSlider(knobWrap, { id: 'fl-depth', label: 'Depth', min: 0.0, max: 1.0, step: 0.01, value: fl.depth });
            const densIn = makeSlider(knobWrap, { id: 'fl-density', label: 'Density', min: 0.0, max: 1.0, step: 0.01, value: fl.density ?? 0.5 });
            this._bindLogSpeedSlider('fl-speed',
                () => this.currentState.flowStyle.speed,
                (s) => { this.currentState.flowStyle.speed = s; });
            this._bindFlowKnob(depthIn, 'depth');
            this._bindFlowKnob(densIn, 'density');
        }
        this._syncFlowStyle();
    }

    _bindFlowKnob(input, key) {
        const valEl = document.getElementById(`${input.id}-val`);
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${((v - input.min) / (input.max - input.min)) * 100}%`);
            this.currentState.flowStyle[key] = v;
            // Knob nudges only re-bake the warp — they must NOT clear solid mode
            // (the flow plays over the Solid/Shift colour; see _applyFlowStyle).
            this._applyToEngine();
        });
        input.addEventListener('pointerup', () => this._postSnap());
    }

    /** Select a Flow Style (or 'none'). Unlike the Motion Engine, a flow plays
     *  OVER the Solid/Shift palette colour (not on black): we KEEP solid mode and
     *  let _buildCompShader composite the warped feedback over the flat colour
     *  (its `_flowActive` branch). Only seed a wave so the feedback buffer has
     *  content for the warp to act on (solid variations ship wave_a:0). */
    _applyFlowStyle(id) {
        this._preSnap();
        // The editor now owns the warp (a Flow style replaces it) → no longer a raw bundled preset, so
        // Meld is allowed again. Also covers 🎲 Remix, which calls this.
        this._bundledBase = false;
        this.currentState.flowStyle.id = id;
        if (id !== 'none') {
            // Feedback needs *some* content to warp. A shape counts — only seed a
            // wave when there's no enabled shape AND the wave is hidden.
            const hasShape = (this.currentState.shapes || []).some(s => s && s.baseVals && s.baseVals.enabled !== 0);
            if (!hasShape && this.currentState.baseVals.wave_a < 0.001) {
                this.currentState.baseVals.wave_a = 0.8;
            }
            // Fill: a flow needs feedback persistence to build big shapes. Seed a
            // fuller decay when the current trail is below the fill threshold —
            // never stomp a higher one (§3.10).
            if (this.currentState.baseVals.decay < FLOW_FILL_DECAY) {
                this.currentState.baseVals.decay = FLOW_FILL_DECAY;
            }
        }
        this._postSnap();
        if (!this._rolling) {            // batched by _rollFullStack → one reload at the end
            this._buildCompShader();   // bake/clear the flow→Solid composite (_flowActive branch)
            this._applyToEngine();
            this._syncFlowStyle();
            // Trail lives on two tabs — keep both in sync after the decay seed.
            this._syncTrailSlider();
            this._syncSlider('ps-decay', this.currentState.baseVals.decay, 0.85, 0.999, 3);
            this._syncWaveControls?.();  // wave_a may have changed
        }
    }

    _syncFlowStyle() {
        const fl = this.currentState.flowStyle || (this.currentState.flowStyle = deepClone(BLANK.flowStyle));
        if (fl.density == null) fl.density = 0.5;  // backfill pre-Density presets
        document.querySelectorAll('.motion-engine-btn[data-flow]').forEach(el => {
            el.classList.toggle('active', el.dataset.flow === fl.id);
        });
        this._syncLogSpeed('fl-speed', fl.speed);  // §17 log Speed
        [['fl-depth', 'depth', 0.0, 1.0], ['fl-density', 'density', 0.0, 1.0]].forEach(([id, key, min, max]) => {
            const input = document.getElementById(id);
            if (!input) return;
            const v = fl[key];
            input.value = v;
            const valEl = document.getElementById(`${id}-val`);
            if (valEl) valEl.textContent = Number(v).toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
        });
    }

    // ─── Drive preset with image (image-texture-dev.md Phase 2) ─────────────────
    // Melt a loaded image LAYER into the preset's feedback loop. Reuses an existing
    // layer's texture (already uploaded + bound by the overlay system) and overrides
    // the warp via buildImageWarp. Self-contained in the Images tab; the Flow select
    // reuses WARP_STYLES for the melt motion.
    _buildImageWarpSection() {
        // Flow as a click-to-explore chip grid (like the Palette → Field selector),
        // not a dropdown — far better for discovering the melt motions.
        const flowGrid = document.getElementById('image-warp-flow-grid');
        if (flowGrid && !flowGrid.children.length) {
            WARP_STYLES.filter(fs => fs.id && fs.id !== 'none').forEach(fs => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'lseg';
                b.dataset.flow = fs.id;
                b.textContent = fs.name;
                if (fs.desc) b.dataset.tooltip = fs.desc;
                b.addEventListener('click', () => {
                    this.currentState.imageWarp.flow = fs.id;
                    flowGrid.querySelectorAll('.lseg').forEach(x => x.classList.toggle('active', x === b));
                    this._applyToEngine();
                });
                flowGrid.appendChild(b);
            });
        }
        document.getElementById('image-warp-audio')?.addEventListener('change', (e) => {
            this.currentState.imageWarp.audioSource = e.target.value;
            const amtRow = document.getElementById('image-warp-audio-amt-row');
            if (amtRow) amtRow.style.display = e.target.value === 'none' ? 'none' : '';
            this._applyToEngine();
        });
        this._bindImageWarpSlider('image-warp-size-sl', 'size');
        this._buildImageWarpPad();   // Position via the same 2D Center pad regular layers use
        this._bindLogSpeedSlider('image-warp-speed-sl',  // §17 perceptual (log) Speed
            () => this.currentState.imageWarp.speed,
            (s) => { this.currentState.imageWarp.speed = s; });
        // Mirror chip-row (Off/H/V/Quad/Kaleido) — folds the image-sample coord. Shows the
        // Kaleido Speed slider only in kaleido mode.
        document.querySelectorAll('#image-warp-mirror-grid .lseg').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentState.imageWarp.mirror = btn.dataset.mirror;
                document.querySelectorAll('#image-warp-mirror-grid .lseg').forEach(b => b.classList.toggle('active', b === btn));
                const krow = document.getElementById('image-warp-kaleido-speed-row');
                if (krow) krow.style.display = btn.dataset.mirror === 'kaleido' ? '' : 'none';
                this._applyToEngine();
            });
        });
        this._bindImageWarpSlider('image-warp-kaleido-speed-sl', 'kaleidoSpeed');
        // Blend chip-row (Mix/Add/Screen/Multiply/Difference/Overlay) — HOW the image fuses with the melt.
        document.querySelectorAll('#image-warp-blend-grid .lseg').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentState.imageWarp.blendMode = btn.dataset.blend;
                document.querySelectorAll('#image-warp-blend-grid .lseg').forEach(b => b.classList.toggle('active', b === btn));
                this._applyToEngine();
            });
        });
        this._bindImageWarpSlider('image-warp-depth-sl', 'depth');
        this._bindImageWarpSlider('image-warp-spin-sl', 'spin');
        this._bindImageWarpSlider('image-warp-zoom-sl', 'zoomPulse');
        this._bindImageWarpSlider('image-warp-flowpulse-sl', 'flowPulse');
        this._bindImageWarpSlider('image-warp-lumakey-sl', 'lumaKey');
        this._bindImageWarpSlider('image-warp-mask-sl', 'mask');  // §16 #3 Mask (melding tool)
        this._bindImageWarpSlider('image-warp-disp-sl', 'disp');  // §16.A Displacement (melding tool)
        this._bindImageWarpSlider('image-warp-flowmap-sl', 'flowMap');  // §16 #4 Image-driven flow (melding tool)
        this._bindImageWarpSlider('image-warp-tint-sl', 'tint');  // §19 Palette-from-image (melding tool)
        this._bindImageWarpSlider('image-warp-feather-sl', 'edgeFeather');  // transparent-video cutout edge clean-up
        // Lazy palette extraction: if Tint goes up but the source colours weren't captured yet (race,
        // or a pre-feature preset), extract them now and re-apply so the tint takes effect.
        document.getElementById('image-warp-tint-sl')?.addEventListener('input', () => {
            const iw = this.currentState.imageWarp;
            if (iw && iw.enabled && iw.tint > 0 && !iw.imgPalette && iw.texName) {
                this._extractImagePalette(iw.texName).then((pal) => {
                    const cw = this.currentState.imageWarp;
                    if (pal && cw && cw.texName === iw.texName) { cw.imgPalette = pal; this._applyToEngine(); }
                });
            }
        });
        this._bindImageWarpSlider('image-warp-reseed-sl', 'reseed');
        this._bindImageWarpSlider('image-warp-audio-amt-sl', 'audioAmt');
        // Phase 4b — Colour/Grade on the melted image.
        this._bindImageWarpSlider('image-warp-bright-sl', 'bright');
        this._bindImageWarpSlider('image-warp-contrast-sl', 'contrast');
        this._bindImageWarpSlider('image-warp-sat-sl', 'sat');
        this._bindImageWarpSlider('image-warp-hue-sl', 'hue');
        document.querySelectorAll('#image-warp-invert-seg .lseg').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentState.imageWarp.invert = btn.dataset.invert === '1';
                document.querySelectorAll('#image-warp-invert-seg .lseg').forEach(b => b.classList.toggle('active', b === btn));
                this._applyToEngine();
            });
        });
        // Double-click a slider's label to reset it to default — matches every other
        // fader in the editor. The panel moves between cards/home, so the handler lives
        // on the panel itself; defaults are stamped from BLANK.imageWarp.
        // NB: speed slider is position-mapped (log); its default POSITION = _speedToPos(1.0).
        const iwDefaults = { 'image-warp-size-sl': 1.0, 'image-warp-speed-sl': _speedToPos(1.0), 'image-warp-depth-sl': 0.5, 'image-warp-spin-sl': 0.0, 'image-warp-zoom-sl': 0.0, 'image-warp-flowpulse-sl': 0.0, 'image-warp-kaleido-speed-sl': 0.0, 'image-warp-lumakey-sl': 0.0, 'image-warp-mask-sl': 0.0, 'image-warp-disp-sl': 0.0, 'image-warp-flowmap-sl': 0.0, 'image-warp-tint-sl': 0.0, 'image-warp-feather-sl': 0.5, 'image-warp-bright-sl': 1.0, 'image-warp-contrast-sl': 1.0, 'image-warp-sat-sl': 1.0, 'image-warp-hue-sl': 0, 'image-warp-reseed-sl': 0.2, 'image-warp-audio-amt-sl': 0.5 };
        for (const [id, def] of Object.entries(iwDefaults)) {
            const sl = document.getElementById(id);
            if (!sl) continue;
            sl.dataset.defaultPos = def;
            sl.closest('.layer-slider-row')?.querySelector('.layer-ctrl-label')?.classList.add('is-resettable');
        }
        document.getElementById('image-warp-controls')?.addEventListener('dblclick', (e) => {
            const label = e.target.closest('.is-resettable');
            if (!label) return;
            e.stopPropagation();  // don't also fire the host card's delegated reset
            const sl = label.closest('.layer-slider-row')?.querySelector('input[type=range]');
            if (!sl || sl.dataset.defaultPos === undefined) return;
            sl.value = sl.dataset.defaultPos;
            sl.dispatchEvent(new Event('input', { bubbles: true }));
        });
        this._syncImageWarpSection();
    }

    _bindImageWarpSlider(id, key) {
        const sl = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!sl) return;
        sl.addEventListener('pointerdown', () => this._preSnap());
        sl.addEventListener('input', () => {
            const v = parseFloat(sl.value);
            if (valEl) valEl.textContent = v.toFixed(2);
            const min = parseFloat(sl.min), max = parseFloat(sl.max);
            sl.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
            this.currentState.imageWarp[key] = v;
            this._applyToEngine();
        });
        sl.addEventListener('pointerup', () => this._postSnap());
    }

    /** Bind a Speed slider with LOGARITHMIC mapping (§17): the slider's native value is the
     *  position t∈[0,1]; the model stores the real speed (_posToSpeed). `get`/`set` read/write
     *  the speed on the owning object; the readout shows the real speed value. */
    _bindLogSpeedSlider(id, get, set) {
        const sl = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!sl) return;
        sl.addEventListener('pointerdown', () => this._preSnap());
        sl.addEventListener('input', () => {
            const t = parseFloat(sl.value);
            const s = _posToSpeed(t);
            set(s);
            if (valEl) valEl.textContent = s.toFixed(2);
            sl.style.setProperty('--pct', `${t * 100}%`);
            this._applyToEngine();
        });
        sl.addEventListener('pointerup', () => this._postSnap());
    }

    /** Reflect a real speed value onto a log Speed slider (position + readout). */
    _syncLogSpeed(id, speed) {
        const sl = document.getElementById(id);
        if (!sl) return;
        const t = _speedToPos(speed);
        sl.value = t;
        sl.style.setProperty('--pct', `${t * 100}%`);
        const valEl = document.getElementById(`${id}-val`);
        if (valEl) valEl.textContent = Number(speed).toFixed(2);
    }

    /** Position via the SAME 2D Center pad regular layers use (drag the dot), bound to
     *  imageWarp.cx/cy. The panel is a single moved-around element, so the pad is built once;
     *  `this._iwPadDraw` lets _syncImageWarpSection redraw the dot after load/state changes. */
    _buildImageWarpPad() {
        const pad = document.getElementById('image-warp-xy-pad');
        if (!pad) return;
        const ctx = pad.getContext('2d');
        const PAD = 96;
        const iw = () => this.currentState.imageWarp || (this.currentState.imageWarp = deepClone(BLANK.imageWarp));
        const draw = () => {
            ctx.clearRect(0, 0, PAD, PAD);
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath(); ctx.roundRect(0, 0, PAD, PAD, 4); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD / 2, 0); ctx.lineTo(PAD / 2, PAD); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, PAD / 2); ctx.lineTo(PAD, PAD / 2); ctx.stroke();
            ctx.strokeRect(0.5, 0.5, PAD - 1, PAD - 1);
            const w = iw();
            ctx.beginPath(); ctx.arc((w.cx ?? 0.5) * PAD, (w.cy ?? 0.5) * PAD, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#cdbcff';  // violet dot to match the Drive accent
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        };
        this._iwPadDraw = draw;
        draw();
        const move = (e) => {
            const rect = pad.getBoundingClientRect();
            const px = e.touches ? e.touches[0].clientX : e.clientX;
            const py = e.touches ? e.touches[0].clientY : e.clientY;
            const w = iw();
            w.cx = Math.max(0, Math.min(1, (px - rect.left) / rect.width));
            w.cy = Math.max(0, Math.min(1, (py - rect.top) / rect.height));
            draw();
            this._applyToEngine();
        };
        let dragging = false;
        pad.addEventListener('mousedown', (e) => { dragging = true; this._preSnap(); move(e); });
        pad.addEventListener('touchstart', (e) => { dragging = true; this._preSnap(); move(e); e.preventDefault(); }, { passive: false });
        window.addEventListener('mousemove', (e) => { if (dragging) move(e); });
        window.addEventListener('mouseup', () => { if (dragging) { dragging = false; this._postSnap(); } });
        window.addEventListener('touchmove', (e) => { if (dragging) move(e); }, { passive: true });
        window.addEventListener('touchend', () => { if (dragging) { dragging = false; this._postSnap(); } });
        document.getElementById('image-warp-xy-reset')?.addEventListener('click', () => {
            const w = iw(); this._preSnap(); w.cx = 0.5; w.cy = 0.5; draw(); this._applyToEngine(); this._postSnap();
        });
    }

    /** Per-card Overlay|Drive switch. Clicking Drive on a card makes THAT image drive the
     *  preset (radio — turns Drive off everywhere else); clicking it again returns to
     *  Overlay. Moves the shared Drive panel into the active card and seeds decay so the
     *  melt persists (mirrors _applyFlowStyle's wake; no wave seed — the image IS content). */
    _toggleCardDrive(entry) {
        const iw = this.currentState.imageWarp || (this.currentState.imageWarp = deepClone(BLANK.imageWarp));
        const turningOn = !(iw.enabled && iw.texName === entry.texName);
        // Meld can't override a raw bundled MilkDrop preset's warp — explain + offer the path instead of
        // silently doing nothing. (Allow turning OFF in case a stale state ever leaves one enabled.)
        if (turningOn && this._bundledBase) { this._showMeldBundledModal(); return; }
        this._preSnap();
        if (turningOn) {
            iw.texName = entry.texName;
            iw.enabled = true;
            if (this.currentState.baseVals.decay < FLOW_FILL_DECAY) {
                this.currentState.baseVals.decay = FLOW_FILL_DECAY;
            }
            // Palette-from-image (§19): extract the image's dominant colours now so the Tint knob is
            // ready when the user reaches for it. Async; applies (+ rebuilds if tint is already up).
            this._extractImagePalette(entry.texName).then((pal) => {
                const cw = this.currentState.imageWarp;
                if (pal && cw && cw.texName === entry.texName) {
                    cw.imgPalette = pal;
                    if (cw.tint > 0) this._applyToEngine();
                }
            });
        } else {
            iw.enabled = false;
        }
        this._postSnap();
        this._buildCompShader();   // imageWarp.enabled now counts as feedback content
        this._applyToEngine();
        this._syncImageWarpSection();
        this._syncTrailSlider?.();
        this._syncSlider('ps-decay', this.currentState.baseVals.decay, 0.85, 0.999, 3);
    }

    /**
     * Palette-from-image (§19) — extract the source's dominant DARK + LIGHT colours into
     * `{ lo:[r,g,b], hi:[r,g,b] }` (0..1) for the duotone Tint. Downscales the source to a tiny
     * canvas and averages the darkest/lightest luma quartiles. Source priority: the engine's live
     * video upload canvas → a video element → the image/gif/text dataURL. Returns null on failure
     * (tainted canvas, video object-URL that can't load as an Image, < 4 opaque pixels) → Tint then
     * gracefully no-ops. Async (an Image may need to decode). Caches nothing here — the caller stores
     * the result on `imageWarp.imgPalette` (which serialises into the saved preset, so loaded presets
     * tint with no source re-decode).
     */
    async _extractImagePalette(texName) {
        const texObj = this._imageTextures[texName];
        if (!texObj) return null;
        let drawable = null;
        try {
            const vid = this.engine?._videoAnimations?.get?.(texName);
            if (vid?.uploadCanvas) drawable = vid.uploadCanvas;
            else if (texObj.videoElement && texObj.videoElement.readyState >= 2) drawable = texObj.videoElement;
        } catch { /* engine internals optional */ }
        if (!drawable) {
            const src = texObj.isText
                ? this.engine?._renderTextTexture?.(texObj.textLayer)?.dataURL
                : texObj.data;
            if (!src || typeof src !== 'string' || src.startsWith('blob:')) return null; // blob: = video, not Image-loadable
            drawable = await new Promise((res) => {
                const im = new Image();
                im.onload = () => res(im);
                im.onerror = () => res(null);
                im.src = src;
            });
            if (!drawable) return null;
        }
        const N = 32;
        const cv = document.createElement('canvas');
        cv.width = N; cv.height = N;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        let px;
        try { ctx.drawImage(drawable, 0, 0, N, N); px = ctx.getImageData(0, 0, N, N).data; }
        catch { return null; } // drawImage or tainted-canvas read failed
        const pts = [];
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] / 255 < 0.15) continue; // skip near-transparent pixels
            const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
            pts.push([r, g, b, 0.299 * r + 0.587 * g + 0.114 * b]);
        }
        if (pts.length < 4) return null;
        pts.sort((a, b) => a[3] - b[3]);
        const avg = (arr) => {
            let r = 0, g = 0, b = 0;
            for (const p of arr) { r += p[0]; g += p[1]; b += p[2]; }
            const n = arr.length || 1;
            return [r / n, g / n, b / n];
        };
        const k = Math.max(1, Math.floor(pts.length * 0.25));
        return { lo: avg(pts.slice(0, k)), hi: avg(pts.slice(pts.length - k)) };
    }

    /** Park the Drive panel back in its hidden home (so it survives card deletes/reorders
     *  and isn't removed with a card). */
    _homeDrivePanel() {
        const panel = document.getElementById('image-warp-controls');
        const home = document.getElementById('image-warp-home');
        if (panel && home && panel.parentElement !== home) home.appendChild(panel);
    }

    /** Friendly block when the user clicks Meld on a raw bundled MilkDrop preset (Meld can't override
     *  its baked-in warp). Offers a one-click 🎲 Remix that converts it to a custom preset they CAN meld. */
    _showMeldBundledModal() {
        const modal = document.getElementById('meld-bundled-modal');
        const okBtn = document.getElementById('meld-bundled-ok');
        const remixBtn = document.getElementById('meld-bundled-remix');
        if (!modal || !okBtn) { showToast?.('Meld needs a custom preset — hit New or 🎲 Remix first', true); return; }
        modal.hidden = false;
        okBtn.focus();
        const cleanup = () => {
            modal.hidden = true;
            okBtn.removeEventListener('click', onOk);
            remixBtn?.removeEventListener('click', onRemix);
            modal.removeEventListener('click', onBackdrop);
            window.removeEventListener('keydown', onKey);
        };
        const onOk = () => cleanup();
        const onRemix = () => { cleanup(); this._rollFullStack(); };  // converts to a from-scratch custom preset (clears _bundledBase)
        const onBackdrop = (e) => { if (e.target === modal) cleanup(); };
        const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); cleanup(); } };
        okBtn.addEventListener('click', onOk);
        remixBtn?.addEventListener('click', onRemix);
        modal.addEventListener('click', onBackdrop);
        window.addEventListener('keydown', onKey);
    }

    /** Reflect imageWarp state into the cards: place the Drive panel inside the driving
     *  card (or home it), toggle each card's drive-mode class + Drive button, and sync the
     *  panel's control values. Called on every add/delete/load via _updateLayersBar and on
     *  toggle. Graceful degrade: if the source layer is gone, Drive auto-disables. */
    _syncImageWarpSection() {
        const iw = this.currentState.imageWarp || (this.currentState.imageWarp = deepClone(BLANK.imageWarp));
        const imgs = this.currentState.images || [];
        if (iw.enabled && !imgs.some(e => e.texName === iw.texName)) iw.enabled = false; // source vanished
        const panel = document.getElementById('image-warp-controls');
        const cards = document.querySelectorAll('#image-layers .image-layer-card');
        let activeCard = null;
        cards.forEach(card => {
            const isDriving = iw.enabled && card.dataset.texName === iw.texName;
            card.classList.toggle('drive-mode', isDriving);
            const btn = card.querySelector('.layer-drive');
            if (btn) { btn.classList.toggle('active', isDriving); btn.setAttribute('aria-pressed', isDriving ? 'true' : 'false'); }
            if (isDriving) activeCard = card;
        });
        // Relocate the single shared panel into the driving card (after its overlay body,
        // which CSS hides in drive-mode), or back home when nothing drives.
        if (activeCard && panel && panel.parentElement !== activeCard) {
            activeCard.appendChild(panel);
        } else if (!activeCard) {
            this._homeDrivePanel();
        }
        // Sync the panel control values from imageWarp.
        const flow = iw.flow || 'liquid';
        document.querySelectorAll('#image-warp-flow-grid .lseg').forEach(b => b.classList.toggle('active', b.dataset.flow === flow));
        const mir = iw.mirror || 'none';
        document.querySelectorAll('#image-warp-mirror-grid .lseg').forEach(b => b.classList.toggle('active', b.dataset.mirror === mir));
        const krow = document.getElementById('image-warp-kaleido-speed-row');
        if (krow) krow.style.display = mir === 'kaleido' ? '' : 'none';
        this._syncSlider('image-warp-kaleido-speed-sl', iw.kaleidoSpeed ?? 0, 0, 1, 2);
        const blend = iw.blendMode || 'mix';
        document.querySelectorAll('#image-warp-blend-grid .lseg').forEach(b => b.classList.toggle('active', b.dataset.blend === blend));
        this._syncSlider('image-warp-bright-sl', iw.bright ?? 1, 0, 2, 2);
        this._syncSlider('image-warp-contrast-sl', iw.contrast ?? 1, 0, 2, 2);
        this._syncSlider('image-warp-sat-sl', iw.sat ?? 1, 0, 2, 2);
        this._syncSlider('image-warp-hue-sl', iw.hue ?? 0, 0, 360, 0);
        const inv = iw.invert ? '1' : '0';
        document.querySelectorAll('#image-warp-invert-seg .lseg').forEach(b => b.classList.toggle('active', b.dataset.invert === inv));
        const audioSel = document.getElementById('image-warp-audio');
        if (audioSel) audioSel.value = iw.audioSource || 'none';
        const amtRow = document.getElementById('image-warp-audio-amt-row');
        if (amtRow) amtRow.style.display = (iw.audioSource && iw.audioSource !== 'none') ? '' : 'none';
        this._syncSlider('image-warp-size-sl', iw.size ?? 1.0, 0.1, 2, 2);
        this._iwPadDraw?.();  // redraw the Position pad dot from imageWarp.cx/cy
        this._syncLogSpeed('image-warp-speed-sl', iw.speed ?? 1.0);  // §17 log Speed
        this._syncSlider('image-warp-depth-sl', iw.depth ?? 0.5, 0, 1, 2);
        this._syncSlider('image-warp-spin-sl', iw.spin ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-zoom-sl', iw.zoomPulse ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-flowpulse-sl', iw.flowPulse ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-lumakey-sl', iw.lumaKey ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-mask-sl', iw.mask ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-disp-sl', iw.disp ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-flowmap-sl', iw.flowMap ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-tint-sl', iw.tint ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-feather-sl', iw.edgeFeather ?? 0, 0, 1, 2);
        this._syncSlider('image-warp-reseed-sl', iw.reseed ?? 0.2, 0, 1, 2);
        this._syncSlider('image-warp-audio-amt-sl', iw.audioAmt ?? 0.5, 0, 1, 2);
    }

    _buildMotionPresetsGrid() {
        const grid = document.getElementById('motion-presets-grid');
        if (!grid) return;
        MOTION_PRESETS.forEach((mp, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'motion-preset-btn';
            // No data-tooltip: name + desc are both rendered inside the button.
            btn.innerHTML = `
        <span class="motion-preset-name">${mp.name}</span>
        <span class="motion-preset-desc">${mp.desc}</span>
      `;
            btn.addEventListener('click', () => this._applyMotionPreset(i));
            grid.appendChild(btn);
        });
        // Reset button beside the section header — snaps every motion field
        // back to BLANK defaults so the user can always "go back" after trying
        // a preset.
        document.getElementById('btn-motion-reset')?.addEventListener('click', () => this._resetMotion());
    }

    /** Shallow-merge a MOTION_PRESETS entry's bv over currentState.baseVals.
     *  Touches only motion fields; wave / palette / echo orient / reactivity
     *  stay untouched on purpose so a user can stack motion looks on top of
     *  the colors and shape they've already dialed in. */
    _applyMotionPreset(i) {
        const mp = MOTION_PRESETS[i];
        if (!mp) return;
        this._preSnap();
        Object.assign(this.currentState.baseVals, mp.bv);
        this._ensureFeedbackContent();  // motion presets shape the feedback buffer — wake so they show
        this._postSnap();
        this._applyToEngine();
        this._syncMotionSliders();
    }

    /** Snap every motion field back to BLANK defaults. Same set of fields
     *  MOTION_PRESETS write to, so this is the symmetric undo of any preset
     *  click. Wave / palette / reactivity / echo orient stay untouched. */
    _resetMotion() {
        const defaults = {
            zoom: BLANK.baseVals.zoom, rot: BLANK.baseVals.rot, warp: BLANK.baseVals.warp,
            warpanimspeed: BLANK.baseVals.warpanimspeed, echo_zoom: BLANK.baseVals.echo_zoom,
            echo_alpha: BLANK.baseVals.echo_alpha, dx: BLANK.baseVals.dx, dy: BLANK.baseVals.dy,
            sx: BLANK.baseVals.sx, sy: BLANK.baseVals.sy, cx: BLANK.baseVals.cx, cy: BLANK.baseVals.cy,
            zoomexp: BLANK.baseVals.zoomexp, warpscale: BLANK.baseVals.warpscale,
        };
        this._preSnap();
        Object.assign(this.currentState.baseVals, defaults);
        this._postSnap();
        this._applyToEngine();
        this._syncMotionSliders();
    }

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
                // Motion shapes the feedback buffer, which solid mode ignores —
                // wake feedback the moment a motion slider is touched.
                input.addEventListener('pointerdown', () => { this._preSnap(); this._ensureFeedbackContent(); });
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
            this._ensureFeedbackContent();
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
        // "Active" highlight follows actual rendered visibility (wave_a > 0).
        // wave_mode is always in 0..7 (engine constraint), so highlighting it
        // unconditionally would imply something is rendering even after Reset.
        const initiallyActive = BLANK.baseVals.wave_a > 0.001;
        WAVE_MODES.forEach(({ mode, label, icon }) => {
            const btn = document.createElement('button');
            const isActive = initiallyActive && mode === BLANK.baseVals.wave_mode;
            btn.className = 'wave-mode-btn' + (isActive ? ' active' : '');
            btn.dataset.mode = mode;
            // No data-tooltip: the label is already rendered inside the button.
            btn.innerHTML = `
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">${icon}</svg>
        <span class="wave-mode-label">${label}</span>
      `;
            btn.addEventListener('click', () => {
                this._preSnap();
                const bv = this.currentState.baseVals;
                bv.wave_mode = mode;
                // If wave was hidden via Reset, picking a shape should make it
                // visible again — otherwise the click looks like a no-op.
                if (bv.wave_a < 0.001) bv.wave_a = 0.8;
                // The wave draws into the feedback buffer, which solid mode never
                // samples — wake feedback so the shape is actually visible.
                this._ensureFeedbackContent();
                this._postSnap();
                this._applyToEngine();
                this._syncWaveControls();
            });
            grid.appendChild(btn);
        });
        // Reset button — hides the wave without touching wave_mode. Symmetric
        // partner to clicking a shape (which re-shows the wave).
        document.getElementById('btn-wave-reset')?.addEventListener('click', () => this._resetWaveShape());
    }

    _resetWaveShape() {
        this._preSnap();
        this.currentState.baseVals.wave_a = 0;
        this._postSnap();
        this._applyToEngine();
        this._syncWaveControls();
    }

    // ─── Custom Shapes Composer (Phase 2 — milkdrop-tools-dev.md §8) ──────────────

    // Trail slider ⇄ decay mapping. Position 0 → decay 0 (TRUE no trail, the
    // buffer is fully cleared each frame); position 1 → decay 0.999 (max). The
    // curve front-loads the "no/short trail" zone (decay 0–0.8 ≈ invisible) into
    // the bottom and spreads the perceptible long-trail range (0.9–0.999) across
    // the top, so the useful range isn't crammed into the last few %.
    _trailDecayFromPos(pos) {
        if (pos <= 0.0001) return 0;
        return 0.999 * (1 - Math.pow(1 - pos, 5));
    }
    _trailPosFromDecay(decay) {
        if (decay <= 0.0001) return 0;
        return 1 - Math.pow(1 - Math.min(decay, 0.999) / 0.999, 1 / 5);
    }
    /** Reflect the current decay onto the curved Trail slider (label shows decay). */
    _syncTrailSlider() {
        const t = document.getElementById('sh-trail');
        if (!t) return;
        const decay = this.currentState.baseVals.decay;
        const pos = this._trailPosFromDecay(decay);
        t.value = pos;
        t.style.setProperty('--pct', `${pos * 100}%`);
        const valEl = document.getElementById('sh-trail-val');
        if (valEl) valEl.textContent = decay.toFixed(3);
    }

    _buildShapesSection() {
        document.getElementById('btn-add-shape')?.addEventListener('click', () => this._addShape());
        // Trail = the global feedback decay (same field as Palette → Trail), surfaced
        // here because it's the dominant control over how much a shape smears/echoes.
        // Curved so the bottom is TRUE zero (no trail) and the top is long trails.
        const trailWrap = document.getElementById('shape-trail-slider');
        if (trailWrap && !trailWrap.dataset.built) {
            trailWrap.dataset.built = '1';
            const pos0 = this._trailPosFromDecay(this.currentState.baseVals.decay);
            const t = makeSlider(trailWrap, { id: 'sh-trail', label: 'Trail', min: 0, max: 1, step: 0.005, value: pos0 });
            t.setAttribute('data-tooltip', 'Trail length');
            const valEl = document.getElementById('sh-trail-val');
            if (valEl) valEl.textContent = this.currentState.baseVals.decay.toFixed(3);
            t.addEventListener('pointerdown', () => this._preSnap());
            t.addEventListener('input', () => {
                const pos = parseFloat(t.value);
                const decay = this._trailDecayFromPos(pos);
                this.currentState.baseVals.decay = decay;
                if (valEl) valEl.textContent = decay.toFixed(3);
                t.style.setProperty('--pct', `${pos * 100}%`);
                this._applyToEngine(true);
            });
            t.addEventListener('pointerup', () => { this._postSnap(); this._clearTrail(); });
        }
        this._renderShapeCards();
    }

    _addShape() {
        const shapes = this.currentState.shapes || (this.currentState.shapes = []);
        // Count only editor shapes — bundled shapes from a remixed preset occupy the
        // array but aren't "ours", so they must not block adding (or be counted).
        const editorCount = shapes.filter(s => this._isEditorShape(s)).length;
        if (editorCount >= MAX_SHAPES) return;
        const isFirst = editorCount === 0;
        this._preSnap();
        shapes.push(makeShapeDefaults());
        // Shapes render over Solid/Shift too (the composite in _buildCompShader), so
        // we DON'T flip out of solid — keep whatever background the user has. On the
        // first shape, give it a short, clean trail so it doesn't drown in a permanent
        // gray smear — IN EVERY MODE (the old `&& this._solidColor` gate skipped this
        // for feedback variations, whose decay 0.96–0.99 left exactly the "permanent
        // trail" the user kept hitting). Only lowered when the current trail is longer
        // than clean, so a short trail the user already dialled is never stomped; raise
        // it back any time via the Trail slider.
        if (isFirst && this.currentState.baseVals.decay > SHAPE_DEFAULT_DECAY) {
            this.currentState.baseVals.decay = SHAPE_DEFAULT_DECAY;
        }
        this._postSnap();
        this._renderShapeCards();
        this._buildCompShader();   // include the shape→solid composite when in solid mode
        this._applyToEngine();
        this._clearTrail();
        this._syncTrailSlider();
        this._syncSlider('ps-decay', this.currentState.baseVals.decay, 0.85, 0.999, 3);
    }

    _removeShape(index) {
        const shapes = this.currentState.shapes || [];
        if (index < 0 || index >= shapes.length) return;
        this._preSnap();
        shapes.splice(index, 1);
        this._postSnap();
        this._renderShapeCards();
        this._buildCompShader();   // drop the shape→solid composite if no shapes remain
        this._applyToEngine();
        this._clearTrail();
    }

    /** Is this shape one the EDITOR made (so its card actually controls something)?
     *  Editor shapes always carry the editor's `motion` + `react` objects
     *  (makeShapeDefaults adds them). Bundled MilkDrop shapes never do — they're raw
     *  baseVals + equations. So `motion && react` is the reliable test, and it works
     *  for old saved editor presets too (no marker/migration needed). */
    _isEditorShape(entry) {
        return !!(entry && entry.motion && entry.react);
    }

    /** Rebuild the card list from state.shapes. Loading a bundled MilkDrop preset must
     *  NEVER add shape cards to our UI — its shapes are raw (equation/baseVals-driven),
     *  the editor's sliders can't control them, and they'd render as dead "NaN" menus.
     *  So ONLY editor-made shapes get a card; bundled shapes stay in state (preserved
     *  for the visual + remix-save) but are never shown. Add/limit count editor shapes
     *  only, so the section is purely about the shapes you created here. */
    _renderShapeCards() {
        const list = document.getElementById('shapes-list');
        if (!list) return;
        list.innerHTML = '';
        const shapes = this.currentState.shapes || [];
        let editorCount = 0;
        shapes.forEach((entry, i) => {
            if (!this._isEditorShape(entry)) return;   // bundled raw shape — never a card
            list.appendChild(this._buildShapeCard(entry, i));
            editorCount++;
        });
        const addBtn = document.getElementById('btn-add-shape');
        if (addBtn) addBtn.disabled = editorCount >= MAX_SHAPES;
    }

    _buildShapeCard(entry, index) {
        const bv = entry.baseVals;
        const card = document.createElement('div');
        card.className = 'shape-card';
        const fillHex = rgbToHex(bv.r, bv.g, bv.b);
        const borderHex = rgbToHex(bv.border_r, bv.border_g, bv.border_b);
        card.innerHTML = `
      <div class="shape-card-head">
        <span class="shape-card-title">Shape ${index + 1}</span>
        <button class="shape-remove" type="button" data-tooltip="Delete shape" aria-label="Delete shape">✕</button>
      </div>
      <div class="shape-card-body">
        <div class="shape-xy-row">
          <div class="xy-pad-wrap">
            <canvas class="xy-pad shape-xy-pad" width="96" height="96" data-tooltip="Drag to place the shape"></canvas>
          </div>
          <div class="shape-sliders"></div>
        </div>
        <div class="shape-prop-row">
          <span class="shape-prop-label">Fill</span>
          <span class="shape-swatch-wrap" data-tooltip="Shape fill colour">
            <span class="shape-color-swatch shape-fill-swatch" style="background:${fillHex}"></span>
            <input type="color" class="shape-fill-picker" value="${fillHex}">
          </span>
        </div>
        <div class="shape-prop-row">
          <label class="shape-prop-label shape-check">
            <input type="checkbox" class="shape-border-toggle" ${bv.border_a > 0 ? 'checked' : ''}> Border
          </label>
          <span class="shape-swatch-wrap shape-border-swatch-wrap${bv.border_a > 0 ? '' : ' is-disabled'}" data-tooltip="Border colour">
            <span class="shape-color-swatch shape-border-swatch" style="background:${borderHex}"></span>
            <input type="color" class="shape-border-picker" value="${borderHex}">
          </span>
        </div>
        <div class="shape-prop-row">
          <label class="shape-prop-label shape-check">
            <input type="checkbox" class="shape-additive-toggle" ${bv.additive ? 'checked' : ''}> Glow
          </label>
        </div>
        <p class="shape-motion-label">Motion</p>
        <div class="shape-motion"></div>
        <p class="shape-motion-label">Reactivity</p>
        <div class="shape-react-head">
          <select class="shape-react-source layer-react-source" data-tooltip="Audio band driving this shape's reactivity">
            <option value="bass">Bass</option>
            <option value="mid">Mid</option>
            <option value="treb">Treble</option>
            <option value="vol">Volume</option>
            <option value="flux">Flux</option>
          </select>
          <div class="shape-react-curve layer-react-curve" role="group" aria-label="Shape reactivity curve">
            <button class="lseg" data-curve="linear">Linear</button>
            <button class="lseg" data-curve="squared">Squared</button>
            <button class="lseg" data-curve="cubed">Cubed</button>
            <button class="lseg" data-curve="threshold">Gate</button>
          </div>
        </div>
        <div class="shape-react-sliders"></div>
      </div>`;

        // ── Sliders: Size / Sides / Angle / Opacity ──
        const sl = card.querySelector('.shape-sliders');
        const sizeIn = makeSlider(sl, { id: `sh${index}-rad`, label: 'Size', min: 0.02, max: 1.50, step: 0.01, value: bv.rad });
        const sidesPos = Math.pow((clamp(bv.sides, SHAPE_SIDES_MIN, SHAPE_SIDES_MAX) - SHAPE_SIDES_MIN) / (SHAPE_SIDES_MAX - SHAPE_SIDES_MIN), 1 / SHAPE_SIDES_CURVE);
        const sidesIn = makeSlider(sl, { id: `sh${index}-sides`, label: 'Sides', min: 0, max: 1, step: 0.001, value: sidesPos });
        const angIn = makeSlider(sl, { id: `sh${index}-ang`, label: 'Angle', min: 0, max: 6.28, step: 0.02, value: bv.ang });
        this._bindShapeSlider(sizeIn, bv, 'rad', 0.02, 1.50);
        this._bindShapeSides(sidesIn, bv);
        this._bindShapeSlider(angIn, bv, 'ang', 0, 6.28);
        // Opacity: the shape draws into the feedback buffer which the comp shader
        // amplifies 2×, so most of the visible change lives in low alpha. Map the
        // slider through a power curve (pos^2) so the low end gets the travel.
        const opaIn = makeSlider(sl, { id: `sh${index}-a`, label: 'Opacity', min: 0, max: 1.0, step: 0.01, value: Math.pow(clamp(bv.a, 0, 1), 1 / SHAPE_OPACITY_CURVE) });
        this._bindShapeOpacity(opaIn, bv);

        // ── Motion (time-driven): Spin / Orbit ──
        const motion = entry.motion || (entry.motion = { spin: 0, orbit: 0 });
        // Migrate old shapes: the former bass-only "Pulse" → Reactivity Size.
        const react = entry.react || (entry.react = { source: 'bass', curve: 'linear', sizeAmt: 0, opacityAmt: 0, spinAmt: 0, shakeAmt: 0, sidesAmt: 0, perSrc: {} });
        if (motion.pulse && !react.sizeAmt) { react.sizeAmt = motion.pulse; }
        delete motion.pulse;
        react.perSrc = react.perSrc || {};
        for (const k of ['sizeAmt', 'opacityAmt', 'spinAmt', 'shakeAmt', 'sidesAmt']) {
            if (!(k in react.perSrc)) react.perSrc[k] = '';
        }
        const ml = card.querySelector('.shape-motion');
        const spinIn = makeSlider(ml, { id: `sh${index}-spin`, label: 'Spin', min: -2, max: 2, step: 0.05, value: motion.spin });
        const orbitIn = makeSlider(ml, { id: `sh${index}-orbit`, label: 'Orbit', min: 0, max: 1, step: 0.01, value: motion.orbit });
        this._bindShapeMotionSlider(spinIn, motion, 'spin', -2, 2);
        this._bindShapeMotionSlider(orbitIn, motion, 'orbit', 0, 1);

        // ── Reactivity (audio-driven): Source + Curve + Size/Opacity w/ per-slider pills ──
        const srcSel = card.querySelector('.shape-react-source');
        srcSel.value = react.source || 'bass';
        srcSel.addEventListener('change', () => {
            this._preSnap();
            react.source = srcSel.value;
            this._postSnap();
            this._applyToEngine(true);
        });
        const curveBtns = card.querySelectorAll('.shape-react-curve .lseg');
        curveBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curve === (react.curve || 'linear'));
            btn.addEventListener('click', () => {
                this._preSnap();
                curveBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                react.curve = btn.dataset.curve;
                this._postSnap();
                this._applyToEngine(true);
            });
        });
        const rl = card.querySelector('.shape-react-sliders');
        [
            { id: `sh${index}-rsize`, label: 'Size', min: -1.5, max: 1.5, key: 'sizeAmt' },
            { id: `sh${index}-ropacity`, label: 'Opacity', min: -1.0, max: 1.0, key: 'opacityAmt' },
            { id: `sh${index}-rspin`, label: 'Spin', min: -1.0, max: 1.0, key: 'spinAmt' },
            { id: `sh${index}-rshake`, label: 'Shake', min: 0.0, max: 1.0, key: 'shakeAmt' },
            { id: `sh${index}-rsides`, label: 'Sides', min: -1.0, max: 1.0, key: 'sidesAmt' },
        ].forEach(cfg => {
            const input = makeSlider(rl, { id: cfg.id, label: cfg.label, min: cfg.min, max: cfg.max, step: 0.01, value: react[cfg.key] || 0 });
            this._bindShapeReactSlider(input, react, cfg.key, cfg.min, cfg.max);
        });

        // ── XY pad (reuses the image-layer pad pattern) ──
        const pad = card.querySelector('.shape-xy-pad');
        const ctx = pad.getContext('2d');
        const PAD = 96;
        const drawPad = () => {
            ctx.clearRect(0, 0, PAD, PAD);
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath(); ctx.roundRect(0, 0, PAD, PAD, 4); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD / 2, 0); ctx.lineTo(PAD / 2, PAD); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, PAD / 2); ctx.lineTo(PAD, PAD / 2); ctx.stroke();
            ctx.strokeRect(0.5, 0.5, PAD - 1, PAD - 1);
            ctx.beginPath();
            ctx.arc(bv.x * PAD, bv.y * PAD, 5, 0, Math.PI * 2);  // shape y is down-positive (y=0 top), like the pad
            ctx.fillStyle = rgbToHex(bv.r, bv.g, bv.b); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        };
        drawPad();
        // Window listeners are added on mousedown and removed on mouseup so
        // re-rendering cards (every load/undo) never leaks accumulating handlers.
        const onMove = (e) => {
            const rect = pad.getBoundingClientRect();
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            bv.x = clamp((cx - rect.left) / rect.width, 0, 1);
            bv.y = clamp((cy - rect.top) / rect.height, 0, 1);   // shape y is down-positive (engine: y*-2+1)
            drawPad();
            this._applyToEngine(true);
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
            this._postSnap();
            this._clearTrail();
        };
        const onDown = (e) => {
            this._preSnap();
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('touchend', onUp);
            onMove(e);
        };
        pad.addEventListener('mousedown', onDown);
        pad.addEventListener('touchstart', (e) => { onDown(e); e.preventDefault(); }, { passive: false });

        // ── Colour pickers ──
        const fillPick = card.querySelector('.shape-fill-picker');
        const fillSw = card.querySelector('.shape-fill-swatch');
        fillPick.addEventListener('input', () => {
            const [r, g, b] = hexToRgb(fillPick.value);
            this._preSnap();
            bv.r = r; bv.g = g; bv.b = b;
            bv.r2 = r; bv.g2 = g; bv.b2 = b;   // keep edge matched to fill (mono-colour)
            fillSw.style.background = fillPick.value;
            this._postSnap();
            this._applyToEngine(true);
            this._clearTrail();
        });
        const borderPick = card.querySelector('.shape-border-picker');
        const borderSw = card.querySelector('.shape-border-swatch');
        borderPick.addEventListener('input', () => {
            const [r, g, b] = hexToRgb(borderPick.value);
            this._preSnap();
            bv.border_r = r; bv.border_g = g; bv.border_b = b;
            borderSw.style.background = borderPick.value;
            this._postSnap();
            this._applyToEngine(true);
            this._clearTrail();
        });

        // ── Toggles: Border on/off, Additive (Glow) ──
        const borderToggle = card.querySelector('.shape-border-toggle');
        const borderSwatchWrap = card.querySelector('.shape-border-swatch-wrap');
        borderToggle.addEventListener('change', () => {
            this._preSnap();
            bv.border_a = borderToggle.checked ? 1.0 : 0;
            borderSwatchWrap?.classList.toggle('is-disabled', !borderToggle.checked);  // border colour only matters when on
            this._postSnap();
            this._applyToEngine(true);
            this._clearTrail();
        });
        const addToggle = card.querySelector('.shape-additive-toggle');
        addToggle.addEventListener('change', () => {
            this._preSnap();
            bv.additive = addToggle.checked ? 1 : 0;
            this._postSnap();
            this._applyToEngine(true);
            this._clearTrail();
        });

        // ── Delete ──
        card.querySelector('.shape-remove').addEventListener('click', () => this._removeShape(index));

        return card;
    }

    _bindShapeSlider(input, bv, key, min, max, decimals = 2) {
        const valEl = document.getElementById(`${input.id}-val`);
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (valEl) valEl.textContent = v.toFixed(decimals);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
            bv[key] = v;
            this._applyToEngine(true);
        });
        input.addEventListener('pointerup', () => { this._postSnap(); this._clearTrail(); });
    }

    /** Per-shape motion slider (Spin / Orbit) → entry.motion[key].
     *  The frame_eqs are regenerated from these in _buildRuntimePreset. */
    _bindShapeMotionSlider(input, motion, key, min, max) {
        const valEl = document.getElementById(`${input.id}-val`);
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
            motion[key] = v;
            this._applyToEngine(true);
        });
        input.addEventListener('pointerup', () => { this._postSnap(); this._clearTrail(); });
    }

    /** Per-shape audio-reactivity slider (Size / Opacity) → react[key], with a
     *  per-slider source pill (· = global, B/M/T/V/F override) mirroring the
     *  Wave-tab reactivity panel. */
    _bindShapeReactSlider(input, react, key, min, max) {
        const valEl = document.getElementById(`${input.id}-val`);
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
            react[key] = v;
            this._applyToEngine(true);
        });
        input.addEventListener('pointerup', () => { this._postSnap(); this._clearTrail(); });

        const header = input.closest('.slider-row')?.querySelector('.slider-header');
        if (header) {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'react-src-pill';
            pill.id = `${input.id}-src`;
            pill.setAttribute('data-tooltip', 'Audio source (click to cycle)');
            header.insertBefore(pill, valEl);
            pill.addEventListener('click', () => {
                this._preSnap();
                react.perSrc = react.perSrc || {};
                const cycle = ['', 'bass', 'mid', 'treb', 'vol', 'flux'];
                const cur = react.perSrc[key] || '';
                react.perSrc[key] = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
                this._postSnap();
                this._renderReactSrcPill(pill, react.perSrc[key]);
                this._applyToEngine(true);
            });
            this._renderReactSrcPill(pill, react.perSrc?.[key] || '');
        }
    }

    /** Sides slider with a power curve: raw pos∈[0,1] → sides =
     *  round(MIN+(MAX-MIN)·pos^N). Low side counts (where the distinct polygons
     *  are) get most of the travel. The value label shows the integer count. */
    _bindShapeSides(input, bv) {
        const valEl = document.getElementById(`${input.id}-val`);
        if (valEl) valEl.textContent = String(Math.round(bv.sides));
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const pos = parseFloat(input.value);
            const sides = Math.round(SHAPE_SIDES_MIN + (SHAPE_SIDES_MAX - SHAPE_SIDES_MIN) * Math.pow(pos, SHAPE_SIDES_CURVE));
            bv.sides = sides;
            if (valEl) valEl.textContent = String(sides);
            input.style.setProperty('--pct', `${pos * 100}%`);
            this._applyToEngine(true);
        });
        input.addEventListener('pointerup', () => { this._postSnap(); this._clearTrail(); });
    }

    /** Opacity slider with a power curve: the raw slider position is pos∈[0,1],
     *  stored alpha = pos^SHAPE_OPACITY_CURVE. The value label shows real alpha. */
    _bindShapeOpacity(input, bv) {
        const valEl = document.getElementById(`${input.id}-val`);
        if (valEl) valEl.textContent = clamp(bv.a, 0, 1).toFixed(2);   // show true alpha, not raw pos
        input.addEventListener('pointerdown', () => this._preSnap());
        input.addEventListener('input', () => {
            const pos = parseFloat(input.value);
            const alpha = Math.pow(pos, SHAPE_OPACITY_CURVE);
            bv.a = alpha; bv.a2 = alpha;   // centre + edge fade together (mono-colour)
            if (valEl) valEl.textContent = alpha.toFixed(2);
            input.style.setProperty('--pct', `${pos * 100}%`);
            this._applyToEngine(true);
        });
        input.addEventListener('pointerup', () => { this._postSnap(); this._clearTrail(); });
    }

    // ─── Wave style sliders ────────────────────────────────────────────────────

    _buildWaveSliders() {
        const container = document.getElementById('wave-sliders');
        const configs = [
            { id: 'ws-scale', label: 'Size', min: 0.10, max: 4.0, step: 0.05, value: BLANK.baseVals.wave_scale, key: 'wave_scale' },
            { id: 'ws-opacity', label: 'Opacity', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_a, key: 'wave_a' },
            { id: 'ws-thickness', label: 'Thickness', min: 0, max: 8.0, step: 0.5, value: BLANK.baseVals.wave_thickness, key: 'wave_thickness' },
            { id: 'ws-fill', label: 'Fill', min: 0, max: 1.0, step: 0.05, value: BLANK.baseVals.wave_fill, key: 'wave_fill' },
            { id: 'ws-smoothing', label: 'Smoothing', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_smoothing, key: 'wave_smoothing' },
            { id: 'ws-mystery', label: 'Mystery', min: -1.0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_mystery, key: 'wave_mystery' },
            { id: 'ws-pos-x', label: 'Position X', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_x, key: 'wave_x' },
            { id: 'ws-pos-y', label: 'Position Y', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.wave_y, key: 'wave_y' },
            { id: 'ws-rot', label: 'Rotation', min: -180, max: 180, step: 1, value: BLANK.baseVals.wave_rot, key: 'wave_rot' },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            // The wave renders into the feedback buffer that solid mode discards —
            // wake feedback when a wave slider is touched so the change is visible.
            input.addEventListener('pointerdown', () => { this._preSnap(); this._ensureFeedbackContent(); });
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.baseVals[cfg.key] = v;
                this._applyToEngine(true);
            });
            input.addEventListener('pointerup', () => this._postSnap());
        });

        document.getElementById('btn-randomize-wave')?.addEventListener('click', () => {
            this._preSnap();
            this._ensureFeedbackContent();
            const bv = this.currentState.baseVals;
            bv.wave_mode = Math.floor(Math.random() * 8);
            bv.wave_scale = 0.3 + Math.random() * 3.2;
            bv.wave_a = 0.4 + Math.random() * 0.6;
            bv.wave_thickness = Math.random() > 0.5 ? 0.5 + Math.random() * 4.5 : 0;
            bv.wave_thick = 0;
            bv.wave_fill = Math.random() > 0.5 ? 0.4 + Math.random() * 0.6 : 0;
            bv.wave_usedots = Math.random() > 0.80 ? 1 : 0;
            bv.additivewave = Math.random() > 0.65 ? 1 : 0;
            bv.wave_mystery = (Math.random() * 2) - 1;
            bv.wave_smoothing = Math.random();
            bv.wave_x = 0.3 + Math.random() * 0.4;
            bv.wave_y = 0.3 + Math.random() * 0.4;
            bv.wave_brighten = Math.random() > 0.70 ? 1 : 0;
            bv.wave_rot = Math.random() > 0.5 ? Math.floor(Math.random() * 360 - 180) : 0;
            this._postSnap();
            this._applyToEngine();
            this._syncWaveControls();
        });
    }

    _syncWaveControls() {
        const bv = this.currentState.baseVals;
        // Grid buttons — only highlight when the wave is actually visible.
        // wave_a == 0 means Reset was clicked (or preset has no wave); we don't
        // want a button to look "selected" when nothing is rendering.
        const visible = bv.wave_a > 0.001;
        document.querySelectorAll('.wave-mode-btn').forEach(btn => {
            btn.classList.toggle('active', visible && parseInt(btn.dataset.mode) === bv.wave_mode);
        });
        // Sliders
        const map = [
            ['ws-scale', 'wave_scale', 0.1, 4.0],
            ['ws-opacity', 'wave_a', 0, 1.0],
            ['ws-thickness', 'wave_thickness', 0, 8.0],
            ['ws-fill', 'wave_fill', 0, 1.0],
            ['ws-smoothing', 'wave_smoothing', 0, 1.0],
            ['ws-mystery', 'wave_mystery', -1.0, 1.0],
            ['ws-pos-x', 'wave_x', 0, 1.0],
            ['ws-pos-y', 'wave_y', 0, 1.0],
            ['ws-rot', 'wave_rot', -180, 180],
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
        // Toggles
        this._syncToggle('toggle-dots', 'wave_usedots');
        this._syncToggle('toggle-additive', 'additivewave');
        this._syncToggle('toggle-brighten', 'wave_brighten');
    }

    // ─── Wave reactivity (preset-only) ───────────────────────────────────────

    _buildWaveReactPanel() {
        const container = document.getElementById('wave-react-sliders');
        if (!container) return;

        const srcSel = document.getElementById('wave-react-source');
        if (srcSel) {
            srcSel.value = this.currentState.waveReact?.source || 'bass';
            srcSel.addEventListener('change', () => {
                this._preSnap();
                this.currentState.waveReact.source = srcSel.value;
                this._postSnap();
                this._applyToEngine(true);
            });
        }

        const curveBtns = document.querySelectorAll('#wave-react-curve .lseg');
        curveBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.curve === (this.currentState.waveReact?.curve || 'linear'));
            btn.addEventListener('click', () => {
                this._preSnap();
                curveBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentState.waveReact.curve = btn.dataset.curve;
                this._postSnap();
                this._applyToEngine(true);
            });
        });

        const configs = [
            { id: 'wr-scale',   label: 'Size',     min: -1.50, max: 1.50, step: 0.01, value: 0, key: 'scaleAmt' },
            { id: 'wr-opacity', label: 'Opacity',  min: -1.00, max: 1.00, step: 0.01, value: 0, key: 'opacityAmt' },
            { id: 'wr-mystery', label: 'Shape',    min: -1.00, max: 1.00, step: 0.01, value: 0, key: 'mysteryAmt' },
            { id: 'wr-orbit',   label: 'Orbit',    min:  0.00, max: 1.00, step: 0.01, value: 0, key: 'orbitAmt' },
        ];
        configs.forEach(cfg => {
            const input = makeSlider(container, cfg);
            const valEl = document.getElementById(`${cfg.id}-val`);
            input.addEventListener('pointerdown', () => this._preSnap());
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (valEl) valEl.textContent = v.toFixed(2);
                input.style.setProperty('--pct', `${((v - cfg.min) / (cfg.max - cfg.min)) * 100}%`);
                this.currentState.waveReact[cfg.key] = v;
                this._applyToEngine(true);
            });
            input.addEventListener('pointerup', () => this._postSnap());

            // Per-slider source pill — click to cycle source override.
            // '·' means use the global Source dropdown above; B/M/T/V/F override
            // for this one slider only. Keeps the source choice per-slider so a
            // user can drive different wave aspects from different bands.
            const header = input.closest('.slider-row')?.querySelector('.slider-header');
            if (header) {
                const pill = document.createElement('button');
                pill.type = 'button';
                pill.className = 'react-src-pill';
                pill.id = `${cfg.id}-src`;
                pill.setAttribute('data-tooltip', 'Audio source (click to cycle)');
                header.insertBefore(pill, valEl);
                pill.addEventListener('click', () => {
                    this._preSnap();
                    const wr = this.currentState.waveReact;
                    wr.perSrc = wr.perSrc || {};
                    const cycle = ['', 'bass', 'mid', 'treb', 'vol', 'flux'];
                    const cur = wr.perSrc[cfg.key] || '';
                    const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
                    wr.perSrc[cfg.key] = next;
                    this._postSnap();
                    this._renderReactSrcPill(pill, next);
                    this._applyToEngine(true);
                });
                this._renderReactSrcPill(pill, this.currentState.waveReact?.perSrc?.[cfg.key] || '');
            }
        });
    }

    /** Update a react-source pill's label + active state. */
    _renderReactSrcPill(pill, src) {
        const labels = { '': '·', bass: 'B', mid: 'M', treb: 'T', vol: 'V', flux: 'F' };
        pill.textContent = labels[src] ?? '·';
        pill.classList.toggle('react-src-pill--override', !!src);
    }

    _syncWaveReact() {
        const wr = this.currentState.waveReact || (this.currentState.waveReact = deepClone(BLANK.waveReact));
        const srcSel = document.getElementById('wave-react-source');
        if (srcSel) srcSel.value = wr.source || 'bass';
        const curveBtns = document.querySelectorAll('#wave-react-curve .lseg');
        curveBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.curve === (wr.curve || 'linear')));

        const map = [
            ['wr-scale',   'scaleAmt',   -1.50, 1.50],
            ['wr-opacity', 'opacityAmt', -1.00, 1.00],
            ['wr-mystery', 'mysteryAmt', -1.00, 1.00],
            ['wr-orbit',   'orbitAmt',    0.00, 1.00],
        ];
        const perSrc = wr.perSrc || {};
        map.forEach(([id, key, min, max]) => {
            const input = document.getElementById(id);
            if (!input) return;
            const v = Number(wr[key] || 0);
            input.value = v;
            const valEl = document.getElementById(`${id}-val`);
            if (valEl) valEl.textContent = v.toFixed(2);
            input.style.setProperty('--pct', `${((v - min) / (max - min)) * 100}%`);
            const pill = document.getElementById(`${id}-src`);
            if (pill) this._renderReactSrcPill(pill, perSrc[key] || '');
        });
    }

    // ─── Motion reactivity (preset-only) ─────────────────────────────────────

    _buildMotionReactPanel() {
        const container = document.getElementById('motion-react-sliders');
        if (!container) return;
        const fxContainer = document.getElementById('motion-react-fx-sliders');

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

        if (fxContainer) {
            const fxConfigs = [
                { id: 'mrf-pulse', label: 'Pulse', min: 0, max: 2.0, step: 0.01, value: 0, key: 'pulseAmp' },
                { id: 'mrf-bounce', label: 'Bounce', min: 0, max: 2.0, step: 0.01, value: 0, key: 'bounceAmp' },
                { id: 'mrf-shake', label: 'Shake', min: 0, max: 2.0, step: 0.01, value: 0, key: 'shakeAmp' },
                { id: 'mrf-beatfade', label: 'Beat Fade', min: 0, max: 2.0, step: 0.01, value: 0, key: 'beatFadeAmp' },
                { id: 'mrf-strobe', label: 'Strobe', min: 0, max: 2.0, step: 0.01, value: 0, key: 'strobeAmp' },
            ];
            fxConfigs.forEach(cfg => {
                const input = makeSlider(fxContainer, cfg);
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

        const shrinkToggle = document.getElementById('motion-react-shrink');
        if (shrinkToggle) {
            shrinkToggle.checked = !!this.currentState.motionReact?.shrink;
            shrinkToggle.addEventListener('change', () => {
                this._preSnap();
                this.currentState.motionReact.shrink = shrinkToggle.checked ? 1 : 0;
                this._postSnap();
                this._applyToEngine(true);
            });
        }
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
            ['mrf-pulse', 'pulseAmp', 0, 2.0],
            ['mrf-bounce', 'bounceAmp', 0, 2.0],
            ['mrf-shake', 'shakeAmp', 0, 2.0],
            ['mrf-beatfade', 'beatFadeAmp', 0, 2.0],
            ['mrf-strobe', 'strobeAmp', 0, 2.0],
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
        const shrinkToggle = document.getElementById('motion-react-shrink');
        if (shrinkToggle) shrinkToggle.checked = !!mr.shrink;
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
            'toggle-dots': 'wave_usedots',
            'toggle-additive': 'additivewave',
            'toggle-brighten': 'wave_brighten',
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
        const smKaleidoSpeedRow = document.getElementById('scene-kaleido-speed-row');
        const smKaleidoSpeedSl = document.getElementById('scene-kaleido-speed-sl');
        const smKaleidoSpeedVal = document.getElementById('scene-kaleido-speed-val');
        const updateSmKaleidoRow = () => {
            if (smKaleidoSpeedRow) smKaleidoSpeedRow.style.display =
                (this.currentState.sceneMirror === 'kaleido') ? '' : 'none';
        };
        if (smSeg) {
            smSeg.querySelectorAll('.seg').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._preSnap();
                    this.currentState.sceneMirror = btn.dataset.smirror;
                    this._postSnap();
                    this._buildCompShader();
                    this._applyToEngine();
                    smSeg.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b === btn));
                    updateSmKaleidoRow();
                });
            });
        }
        if (smKaleidoSpeedSl) {
            smKaleidoSpeedSl.dataset.defaultPos = smKaleidoSpeedSl.value;
            smKaleidoSpeedSl.addEventListener('input', () => {
                const pos = parseFloat(smKaleidoSpeedSl.value);
                const abs = Math.abs(pos);
                const v = Math.sign(pos) * abs * abs * abs * 2.0;
                this.currentState.sceneMirrorKaleidoSpeed = v;
                smKaleidoSpeedVal.textContent = v.toFixed(2);
                const pct = (pos + 1) / 2 * 100;
                smKaleidoSpeedSl.style.setProperty('--pct-lo', `${pos >= 0 ? 50 : pct.toFixed(1)}%`);
                smKaleidoSpeedSl.style.setProperty('--pct-hi', `${pos >= 0 ? pct.toFixed(1) : 50}%`);
                this._buildCompShader();
                this._applyToEngine();
            });
            const smKalSpeedLabel = document.querySelector('#scene-kaleido-speed-row .layer-ctrl-label');
            if (smKalSpeedLabel) {
                smKalSpeedLabel.classList.add('is-resettable');
                smKalSpeedLabel.addEventListener('dblclick', () => {
                    smKaleidoSpeedSl.value = smKaleidoSpeedSl.dataset.defaultPos;
                    smKaleidoSpeedSl.dispatchEvent(new Event('input', { bubbles: true }));
                });
            }
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
        // Kaleido speed row — show/hide and restore slider position
        const smKalSpeedRow = document.getElementById('scene-kaleido-speed-row');
        const smKalSpeedSl = document.getElementById('scene-kaleido-speed-sl');
        const smKalSpeedVal = document.getElementById('scene-kaleido-speed-val');
        if (smKalSpeedRow) smKalSpeedRow.style.display = sm === 'kaleido' ? '' : 'none';
        if (smKalSpeedSl && smKalSpeedVal) {
            const stored = this.currentState.sceneMirrorKaleidoSpeed || 0;
            const pos = Math.sign(stored) * Math.cbrt(Math.abs(stored) / 2);
            smKalSpeedSl.value = pos.toFixed(4);
            const pct = (pos + 1) / 2 * 100;
            smKalSpeedSl.style.setProperty('--pct-lo', `${pos >= 0 ? 50 : pct.toFixed(1)}%`);
            smKalSpeedSl.style.setProperty('--pct-hi', `${pos >= 0 ? pct.toFixed(1) : 50}%`);
            smKalSpeedVal.textContent = stored.toFixed(2);
        }
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
        // Footer button (re-purposed from "Reset" to "UNDO" — handy during live use): step back one
        // history state, same as the top Undo / ⌘Z. The old clear-to-default logic moved to
        // _resetToBlank() below, still used by the New button.
        document.getElementById('btn-reset')?.addEventListener('click', () => this._undo());
    }

    /** Clear the editor to the known-clean default (Shift) base. Used by the New button (main.js), which is
     *  "blank canvas + fresh identity". (This was the footer Reset handler before it became Undo.) */
    _resetToBlank() {
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
        // Re-baseline A/B "A" to the reset (Shift) state, so A isn't a stale wave.
        this.originalState = deepClone(this.currentState);
        // Re-highlight the default variation (Shift)
        document.querySelectorAll('.base-var-btn').forEach((el, idx) => {
            el.classList.toggle('active', idx === DEFAULT_VARIATION_INDEX);
        });
    }

    /** Reset the editor to a known-clean state. Shared by reset, loadBundledPreset,
     *  and loadPresetData so all three start from the same baseline. Callers then
     *  overlay their own data on top. */
    _clearForLoad() {
        // Park the shared Drive/Meld panel back in its safe home FIRST. When a meld is active the
        // single `#image-warp-controls` node lives INSIDE a layer card (inside `#image-layers`); the
        // `innerHTML=''` wipe below would otherwise DESTROY it, so every later Meld would find no panel
        // (drive-mode hides the card body, panel gone → "can't access Meld settings / retract dead").
        // `#image-warp-home` is a separate sibling div the wipe doesn't touch. (Same guard the delete
        // flow uses.) See video-cutout-edge-noise-dev.md sibling bug notes / Meld panel relocation.
        this._homeDrivePanel();
        this._bundledBase = false;   // reset/load starts from a clean (non-bundled) base; loadBundledPreset re-sets it
        // animation-dev.md A3 — stop any idle tweens on the old layers before
        // they're discarded. Otherwise GSAP keeps the detached entries alive.
        for (const entry of (this.currentState?.images || [])) {
            stopIdleAnimation(entry);
        }
        const layersEl = document.getElementById('image-layers');
        if (layersEl) layersEl.innerHTML = '';
        for (const texName of Object.keys(this._imageTextures)) {
            this.engine.removeGifAnimation?.(texName);
            this.engine.removeVideoAnimation?.(texName);
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
        const bgToggle = document.getElementById('toggle-bg-transparent');
        if (bgToggle) bgToggle.checked = false;
        this.engine?.canvas?.classList.remove('bg-transparent-checker');

        // Wipe butterchurn's feedback buffer so pixels from the previous preset
        // don't bleed through (the auto-built comp shader samples sampler_main
        // and amplifies it 2×, which prevents natural decay).
        this.engine.clearFeedbackBuffer?.();
    }

    // ─── Image dropzone ────────────────────────────────────────────────────────

    _bindImageDropzone() {
        const zone = document.getElementById('image-dropzone');
        const fileInput = document.getElementById('image-file-input');
        const dropzoneText = document.getElementById('dropzone-text');
        if (!zone || !fileInput) return;

        // macOS Tauri: change text since drag-drop doesn't work in WKWebView
        if (window.__TAURI__ && navigator.userAgent.includes('Mac') && dropzoneText) {
            dropzoneText.textContent = 'Click to browse';
            zone.setAttribute('aria-label', 'Click to browse for image or video');
        }

        zone.addEventListener('click', async (e) => {
            if (e.target === fileInput) return;
            // Tauri macOS only: native file picker (drag-drop doesn't work in WKWebView)
            // Windows Tauri uses standard HTML file input (drag-drop works in WebView2)
            if (window.__TAURI__ && navigator.userAgent.includes('Mac')) {
                const result = await window.__TAURI__.invoke('pick_image_file');
                if (!result) return;
                const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
                // Native picker drops the MIME type; restore it from the extension so
                // downstream `file.type === 'image/gif'` checks (resizeImageFile etc.) work.
                const ext = result.name.split('.').pop()?.toLowerCase();
                const mimeMap = {
                    gif: 'image/gif',
                    png: 'image/png',
                    jpg: 'image/jpeg', jpeg: 'image/jpeg',
                    webp: 'image/webp',
                    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
                };
                const file = new File([bytes], result.name, { type: mimeMap[ext] || '' });
                if (ext === 'mp4' || ext === 'webm' || ext === 'mov') {
                    const isMacTauri = !!window.__TAURI__ && navigator.userAgent.includes('Mac');
                    if (isMacTauri && ext === 'webm') {
                        await this._handleWebmAlphaUpload(file);
                    } else {
                        this._addVideoLayer(file);
                    }
                } else if (ext === 'gif') {
                    await this._handleGifUpload(file);
                } else {
                    this._addImageLayer(file);
                }
                return;
            }
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
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                showToast('Drop an image or video file here (JPG, PNG, GIF, WebP, MP4, WebM…)', true);
                return;
            }
            // Handle video files
            if (file.type.startsWith('video/')) {
                const isMacTauri = !!window.__TAURI__ && navigator.userAgent.includes('Mac');
                const isWebM = file.name.toLowerCase().endsWith('.webm') || file.type === 'video/webm';
                if (isMacTauri && isWebM) {
                    await this._handleWebmAlphaUpload(file);
                } else {
                    this._addVideoLayer(file);
                }
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
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
                showToast('Please choose an image or video file (JPG, PNG, GIF, WebP, MP4, WebM…)', true);
                fileInput.value = '';
                return;
            }
            // Handle video files
            if (file.type.startsWith('video/')) {
                const isMacTauri = !!window.__TAURI__ && navigator.userAgent.includes('Mac');
                const isWebM = file.name.toLowerCase().endsWith('.webm') || file.type === 'video/webm';
                if (isMacTauri && isWebM) {
                    await this._handleWebmAlphaUpload(file);
                } else {
                    this._addVideoLayer(file);
                }
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

    // ─── Animate modal (animation-dev.md Phase A1 Gate 1) ──────────────────────
    // The modal is a floating panel (no backdrop) that targets ONE layer at a
    // time. Listeners are bound ONCE on first open and operate on the entry
    // currently held in `this._animateModalEntry`. Cloning listeners on every
    // open destroyed runtime `<select>.value` state, so we don't do that.

    _showAnimateModal(entry) {
        const modal = document.getElementById('animate-modal');
        if (!modal || !entry) return;
        // _normalizeImageEntry adds defaults on load; freshly-added layers may
        // not have run through it. Fill in the gap here so the UI has a stable
        // object to write into.
        if (!entry.animation) {
            entry.animation = {
                entrance: 'none', entranceDuration: 0.7, entranceEase: 'expo.out',
                exit:     'none', exitDuration:     0.5, exitEase:     'expo.in',
                idle:     'none', idleSpeed:        1.0,
                beatSteps: []
            };
        }

        // Make this the active entry. All listeners read/write through it.
        this._animateModalEntry = entry;

        // First-time setup: bind every control to read/write the *current*
        // `_animateModalEntry.animation`, NOT a captured one.
        if (!this._animateModalBound) {
            this._animateModalBound = true;
            const chipsWrap   = document.getElementById('animate-entrance-chips');
            const previewBtn  = document.getElementById('animate-modal-preview');
            const closeBtn    = document.getElementById('animate-modal-close');
            const header      = document.getElementById('animate-modal-header');

            // ── Gate 3 — hydrate custom scrubbers + ease pickers. Each helper
            // returns a handle stored on `this` so `_syncAnimateModal` can push
            // values without re-binding listeners.
            this._animateScrubEntrance = _hydrateScrubber(document.getElementById('animate-duration'), {
                onInput: (v) => {
                    const tgt = this._animateModalEntry;
                    if (!tgt) return;
                    tgt.animation.entranceDuration = v;
                    this.onchange?.();
                },
            });
            // A6 — "Enter at" time (when the layer enters during playback). Editor
            // is a workbench (layers stay visible); the schedule plays in the
            // player & timeline via the engine. Saved by saveCurrent (spreads
            // currentState.images), so just storing the value + onchange is enough.
            this._animateScrubEntranceAt = _hydrateScrubber(document.getElementById('animate-entrance-at'), {
                onInput: (v) => {
                    const tgt = this._animateModalEntry;
                    if (!tgt) return;
                    tgt.animation.entranceAt = v;
                    this.onchange?.();
                },
            });
            this._animateEaseEntrance = _hydrateEasePicker(
                document.getElementById('animate-ease'), ENTRANCE_EASES,
                {
                    initial: 'expo.out',
                    onInput: (id) => {
                        const tgt = this._animateModalEntry;
                        if (!tgt) return;
                        tgt.animation.entranceEase = id;
                        this.onchange?.();
                    },
                });
            this._animateScrubExit = _hydrateScrubber(document.getElementById('animate-exit-duration'), {
                onInput: (v) => {
                    const tgt = this._animateModalEntry;
                    if (!tgt) return;
                    tgt.animation.exitDuration = v;
                    this.onchange?.();
                },
            });
            // A6 — "Exit at" time (when the layer leaves during playback). 0 = none.
            this._animateScrubExitAt = _hydrateScrubber(document.getElementById('animate-exit-at'), {
                onInput: (v) => {
                    const tgt = this._animateModalEntry;
                    if (!tgt) return;
                    tgt.animation.exitAt = v;
                    this.onchange?.();
                },
            });
            this._animateEaseExit = _hydrateEasePicker(
                document.getElementById('animate-exit-ease'), EXIT_EASES,
                {
                    initial: 'expo.in',
                    onInput: (id) => {
                        const tgt = this._animateModalEntry;
                        if (!tgt) return;
                        tgt.animation.exitEase = id;
                        this.onchange?.();
                    },
                });
            this._animateScrubIdleSpeed = _hydrateScrubber(document.getElementById('animate-idle-speed'), {
                onInput: (v) => {
                    const tgt = this._animateModalEntry;
                    if (!tgt) return;
                    tgt.animation.idleSpeed = v;
                    // Re-apply idle so the new speed takes effect immediately —
                    // mirror of the old <input>'s onInput behaviour.
                    if (tgt.animation.idle && tgt.animation.idle !== 'none') {
                        startIdleAnimation(tgt, tgt.animation, () => {
                            this._buildCompShader();
                            this._applyToEngine();
                        });
                    }
                    this.onchange?.();
                },
            });

            // Tab switching — Entrance + Exit functional; Idle has its own loop (no preview).
            modal.querySelectorAll('.animate-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const which = tab.dataset.tab;
                    modal.querySelectorAll('.animate-tab').forEach(t => t.classList.toggle('active', t === tab));
                    modal.querySelectorAll('.animate-panel').forEach(p => {
                        p.hidden = p.dataset.panel !== which;
                    });
                    // A4-4: re-trigger the fade-in keyframe on the newly visible panel.
                    // display:none → block doesn't reliably restart `animation` across
                    // browsers, so we remove + reflow + re-add the class explicitly.
                    const activePanel = modal.querySelector(`.animate-panel[data-panel="${which}"]`);
                    if (activePanel) {
                        activePanel.classList.remove('animate-fade-in');
                        void activePanel.offsetWidth;
                        activePanel.classList.add('animate-fade-in');
                    }
                    // Preview is meaningful on entrance + exit (replays the tween).
                    // Idle is a continuous loop — picking a chip is its own preview.
                    if (previewBtn) previewBtn.style.display = which === 'idle' ? 'none' : '';
                    this._activeAnimateTab = which;
                });
            });
            this._activeAnimateTab = 'entrance';

            // Drag the header — vanilla pointer events. Position persists for the
            // session via `this._animateModalPos`; reset on reload.
            if (header) {
                let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
                header.addEventListener('pointerdown', (e) => {
                    if (e.target.closest('button')) return; // don't start drag from the × button
                    dragging = true;
                    const rect = modal.getBoundingClientRect();
                    // Switch from right-anchored to left-anchored on first drag
                    // so we can write `left` cleanly.
                    modal.style.left = rect.left + 'px';
                    modal.style.top  = rect.top  + 'px';
                    modal.style.right = 'auto';
                    startX = e.clientX; startY = e.clientY;
                    startLeft = rect.left; startTop = rect.top;
                    header.setPointerCapture(e.pointerId);
                });
                header.addEventListener('pointermove', (e) => {
                    if (!dragging) return;
                    const nx = Math.max(0, Math.min(window.innerWidth - 100, startLeft + (e.clientX - startX)));
                    const ny = Math.max(0, Math.min(window.innerHeight - 60, startTop  + (e.clientY - startY)));
                    modal.style.left = nx + 'px';
                    modal.style.top  = ny + 'px';
                });
                header.addEventListener('pointerup', (e) => {
                    if (!dragging) return;
                    dragging = false;
                    header.releasePointerCapture(e.pointerId);
                    // Remember position for this session so re-opening lands where you left it.
                    this._animateModalPos = { left: modal.style.left, top: modal.style.top };
                });
            }

            chipsWrap?.addEventListener('click', (e) => {
                const chip = e.target.closest('.animate-chip');
                if (!chip) return;
                const tgt = this._animateModalEntry;
                if (!tgt) return;
                tgt.animation.entrance = chip.dataset.preset;
                this._syncAnimateModal();   // also re-syncs Gate-2 param visibility
                tgt._refreshAnimateDot?.();
                this.onchange?.();
            });

            // Gate 2 — contextual param sliders (entrance + exit). Generic
            // delegate by `data-bind` to keep this from blowing up to one
            // listener per slider. Each slider's data-bind matches a field on
            // entry.animation; we read step from the slider for the precision.
            const wireParams = (containerSel) => {
                const container = document.querySelector(containerSel);
                if (!container) return;
                container.addEventListener('input', (e) => {
                    const sl = e.target.closest('.animate-param-slider');
                    if (!sl) return;
                    const tgt = this._animateModalEntry;
                    if (!tgt) return;
                    const key = sl.dataset.bind;
                    const v = parseFloat(sl.value);
                    tgt.animation[key] = v;
                    const valEl = sl.parentNode.querySelector(`.animate-param-val[data-bind="${key}"]`);
                    if (valEl) valEl.textContent = v.toFixed(2);
                    this.onchange?.();
                });
            };
            wireParams('.animate-params[data-tab="entrance"]');
            wireParams('.animate-params[data-tab="exit"]');

            // Exit chip row (Phase A2). Duration + ease are scrubber + ease
            // picker (hydrated above) — same source-of-truth as entrance.
            const exitChips = document.getElementById('animate-exit-chips');
            exitChips?.addEventListener('click', (e) => {
                const chip = e.target.closest('.animate-chip');
                if (!chip) return;
                const tgt = this._animateModalEntry;
                if (!tgt) return;
                tgt.animation.exit = chip.dataset.preset;
                this._syncAnimateModal();
                tgt._refreshAnimateDot?.();
                this.onchange?.();
            });

            // Idle chip row (Phase A3). Speed is the scrubber hydrated above.
            const idleChips = document.getElementById('animate-idle-chips');
            idleChips?.addEventListener('click', (e) => {
                const chip = e.target.closest('.animate-chip');
                if (!chip) return;
                const tgt = this._animateModalEntry;
                if (!tgt) return;
                tgt.animation.idle = chip.dataset.idle;
                this._syncAnimateModal();
                tgt._refreshAnimateDot?.();
                // Restart idle with the new preset. Always re-applies cleanly.
                startIdleAnimation(tgt, tgt.animation, () => {
                    this._buildCompShader();
                    this._applyToEngine();
                });
                this.onchange?.();
            });
            previewBtn?.addEventListener('click', () => {
                const tgt = this._animateModalEntry;
                if (!tgt) return;
                const refreshCb = () => { this._buildCompShader(); this._applyToEngine(); };
                const isExit = this._activeAnimateTab === 'exit';
                // Preview is JUST a preview — never a trigger. Both entrance
                // and exit return the layer to the NEUTRAL rest pose when the
                // tween completes so the user can re-tune (change ease, change
                // duration, switch chip) and re-preview cleanly. Real delete
                // (`_performDeleteLayer`) is the only place that commits to the
                // exit pose by actually splicing the entry.
                const tween = isExit
                    ? playExitAnimation(tgt, tgt.animation, { resetAfter: true })
                    : playEntranceAnimation(tgt, tgt.animation);
                tween.then(() => {
                    // GSAP-side idle was killed by the preview tween (shared
                    // _gsapProxy). Restart it so Float/Pulse/Breathe resume.
                    if (tgt.animation.idle && tgt.animation.idle !== 'none') {
                        startIdleAnimation(tgt, tgt.animation, refreshCb);
                    }
                });
            });
            const close = () => { modal.hidden = true; this._animateModalEntry = null; };
            closeBtn?.addEventListener('click', close);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !modal.hidden) close();
            });
        }

        this._syncAnimateModal();

        // Restore last drag position if the user moved it earlier this session.
        if (this._animateModalPos) {
            modal.style.left = this._animateModalPos.left;
            modal.style.top  = this._animateModalPos.top;
            modal.style.right = 'auto';
        }

        modal.hidden = false;
    }

    // Gate 2: show only the param row(s) whose `data-for-preset` includes the
    // currently-selected preset. Generic for both entrance and exit panels.
    _syncAnimateParamRows(panelSel, selectedPreset) {
        document.querySelectorAll(`.animate-params[data-tab="${panelSel}"] .animate-param-row`).forEach(row => {
            const applies = (row.dataset.forPreset || '').split(/\s+/).includes(selectedPreset);
            row.hidden = !applies;
        });
    }

    // Push the current entry.animation values into the modal controls.
    // Called on open and after any chip-select to keep the active highlight in sync.
    _syncAnimateModal() {
        const entry = this._animateModalEntry;
        if (!entry?.animation) return;
        const a = entry.animation;

        const titleEl = document.getElementById('animate-modal-layer-name');
        if (titleEl) titleEl.textContent = entry.name || entry.fileName || 'Layer';

        // Entrance — chip highlight + Gate-3 scrubber/ease handles.
        document.querySelectorAll('#animate-entrance-chips .animate-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.preset === a.entrance);
        });
        this._animateScrubEntrance?.setValue(a.entranceDuration);
        this._animateScrubEntranceAt?.setValue(a.entranceAt ?? 0);   // A6
        this._animateEaseEntrance?.setActive(a.entranceEase || 'expo.out');

        // Gate 2 — sync entrance param sliders + show only the relevant row
        this._syncAnimateParamRows('entrance', a.entrance);
        const syncSlider = (key, fallback) => {
            const sl = document.querySelector(`.animate-param-slider[data-bind="${key}"]`);
            const v = a[key] ?? fallback;
            if (sl) sl.value = v;
            const valEl = document.querySelector(`.animate-param-val[data-bind="${key}"]`);
            if (valEl) valEl.textContent = Number(v).toFixed(2);
        };
        syncSlider('entranceDistance',      1.2);
        syncSlider('entranceScaleUpFrom',   0.3);
        syncSlider('entranceScaleDownFrom', 1.8);
        syncSlider('entrancePopFrom',       0.0);
        syncSlider('entranceBlurStart',     0.6);

        // Exit (Phase A2) — chip highlight + Gate-3 scrubber/ease handles.
        document.querySelectorAll('#animate-exit-chips .animate-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.preset === (a.exit || 'none'));
        });
        this._animateScrubExit?.setValue(a.exitDuration ?? 0.5);
        this._animateScrubExitAt?.setValue(a.exitAt ?? 0);   // A6
        this._animateEaseExit?.setActive(a.exitEase || 'expo.in');

        // Gate 2 — same for exit
        this._syncAnimateParamRows('exit', a.exit || 'none');
        syncSlider('exitDistance',      1.2);
        syncSlider('exitScaleUpFrom',   1.5);
        syncSlider('exitScaleDownFrom', 0.0);
        syncSlider('exitPopFrom',       0.0);
        syncSlider('exitBlurStart',     0.6);

        // Idle (Phase A3) — chip highlight + Gate-3 speed scrubber.
        document.querySelectorAll('#animate-idle-chips .animate-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.idle === (a.idle || 'none'));
        });
        this._animateScrubIdleSpeed?.setValue(a.idleSpeed ?? 1.0);
    }

    // ─── Images Only ───────────────────────────────────────────────────────────

    _bindImagesOnly() {
        const cb = document.getElementById('toggle-images-only');
        if (!cb) return;
        cb.addEventListener('change', () => {
            this._imagesOnly = cb.checked;
            this.currentState.imagesOnly = cb.checked;   // persist (round-trips via currentState)
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

    // ─── Transparent background toggle (only effective in "Show layers only") ───
    _bindBgTransparent() {
        const cb = document.getElementById('toggle-bg-transparent');
        if (!cb) return;
        cb.addEventListener('change', () => {
            this.currentState.bgTransparent = cb.checked;
            // Editor-only affordance: a checkerboard behind the canvas shows the
            // transparent areas (the canvas's CSS bg shows through alpha pixels).
            // Timeline/output zones have no such bg, so they reveal real content.
            this.engine?.canvas?.classList.toggle('bg-transparent-checker', cb.checked);
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

    // ─── Text layer button ──────────────────────────────────────────────────────

    _bindAddTextLayer() {
        const btn = document.getElementById('btn-add-text-layer');
        if (!btn) return;
        btn.addEventListener('click', () => this._addTextLayer());
    }

    // ─── Phase 1: layers count + dropzone-disabled bar state ───────────────────

    _updateLayersBar() {
        const countEl = document.getElementById('layers-count');
        const dropzone = document.getElementById('image-dropzone');
        const imgs = this.currentState.images || [];
        if (countEl) countEl.textContent = `Layers: ${imgs.length} / ${MAX_LAYERS}`;
        if (dropzone) dropzone.classList.toggle('disabled', imgs.length >= MAX_LAYERS);
        // Keep the image-drive source picker in sync — this runs on every add/delete/load.
        this._syncImageWarpSection?.();
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

    async _performDeleteLayer(entry, card, texName) {
        // animation-dev.md A2 — if an exit animation is configured, await it
        // before removing the layer. The layer remains rendered (and visible
        // for the duration of the tween) by virtue of still being in
        // currentState.images. We freeze the card visually (pointer-events:none
        // + dim) so the user can't double-click delete during the tween.
        const exitConfigured = entry.animation?.exit && entry.animation.exit !== 'none';
        if (exitConfigured) {
            card.style.pointerEvents = 'none';
            card.style.opacity = '0.5';
            await playExitAnimation(entry, entry.animation, { resetAfter: false });
        }
        // animation-dev.md A2/A3 — discard path. We DON'T call stopIdleAnimation
        // here because it would reset _anim to NEUTRAL. The compiled comp shader
        // doesn't swap mid-frame; if the OLD comp renders one more frame after
        // we splice the entry, its q-registers default to neutral (because the
        // entry is gone from __dcAnim) and the layer would flash visible. By
        // leaving _anim at its exit pose (opacity:0 etc.), even if the old comp
        // renders one extra frame, the entry stays invisible. We only need to
        // kill GSAP tweens so they don't keep mutating a detached object.
        if (entry._gsapProxy) gsap.killTweensOf(entry._gsapProxy);
        const idx = this.currentState.images.indexOf(entry);
        if (idx !== -1) this.currentState.images.splice(idx, 1);
        // If this layer was driving the preset, disable Drive and park the panel back
        // home FIRST — otherwise card.remove() below would take the panel with it.
        const _iw = this.currentState.imageWarp;
        const _wasDriving = !!(_iw && _iw.texName === texName);
        if (_wasDriving) { _iw.enabled = false; this._homeDrivePanel(); }
        // Clean up video blob URL if present
        const texObj = this._imageTextures[texName];
        if (texObj?._videoUrl) {
            URL.revokeObjectURL(texObj._videoUrl);
        }
        delete this._imageTextures[texName];
        this.engine.removeGifAnimation(texName);
        this.engine.removeVideoAnimation(texName);
        this._buildCompShader();
        this._applyToEngine();
        // The melt lives IN the feedback buffer (sampler_main), kept alive by the high decay Meld sets.
        // Disabling Drive + removing the texture isn't enough — the last melted frames keep recirculating
        // and stay "stuck" on screen. Clear the feedback so the deleted melt actually vanishes. (Only when
        // it was the DRIVING layer; overlay layers aren't in the feedback, so skip the flash for those.)
        if (_wasDriving) this.engine.clearFeedbackBuffer?.();
        // A4-2: slide-up + fade the card before pulling it from the DOM. The
        // canvas-side layer already disappeared (above); this just makes the
        // card list compact gracefully instead of a hard pop. ~220ms.
        await new Promise(resolve => {
            card.classList.add('card-removing');
            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            card.addEventListener('animationend', finish, { once: true });
            setTimeout(finish, 320); // safety: never hang if animationend doesn't fire
        });
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
        // A sole layer stays OPEN — "a layer is open unless there's another one." Catches
        // a last survivor left collapsed by a prior accordion (e.g. add a 2nd layer, then
        // delete it). Only forces open at the 1-layer transition; doesn't fight manual
        // collapse while multiple layers exist.
        if (total === 1) {
            const only = this.currentState.images[0];
            if (only) only.collapsed = false;
            cards[0].classList.remove('collapsed');
            cards[0].querySelector('.layer-header')?.setAttribute('aria-expanded', 'true');
        }
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
        // …but never squash the card that's DRIVING the preset — its body IS the Drive
        // panel you're working in, so keep it open when a new layer arrives.
        const _driveTex = this.currentState.imageWarp?.enabled ? this.currentState.imageWarp.texName : null;
        this.currentState.images.forEach(e => { if (e.texName !== _driveTex) e.collapsed = true; });
        document.querySelectorAll('#image-layers .image-layer-card').forEach(c => {
            if (c.dataset.texName !== _driveTex) c.classList.add('collapsed');
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
            kaleidoSpeed: 0.00,
            tintR: 1.00,        // tint color red (1=white = no tint)
            tintG: 1.00,
            tintB: 1.00,
            hueSpinSpeed: 0.00, // tint hue rotation speed (cycles/sec)
            imageSaturation: 1.00, // per-layer saturation (0=grey, 1=original, 2=vivid)
            imageHue: 0,           // per-layer static hue offset in degrees (0–360)
            brightness: 1.0,       // per-layer brightness multiplier (0=black, 1=original, 2=double)
            contrast: 1.0,         // per-layer contrast (0=flat grey, 1=original, 2=high contrast)
            gamma: 1.0,            // per-layer gamma curve (0.5=bright mids, 1=original, 2.5=dark mids)
            fade: 0.0,             // per-layer fade/lift — lifts black point for faded film look (0–0.5)
            colorTemp: 0.0,        // per-layer color temperature: negative=cool/blue, positive=warm/orange (−1 to +1)
            sepia: 0.0,            // per-layer sepia tone blend (0=off, 1=full classic sepia)
            blur: 0.0,             // per-layer soft blur — re-samples texture at offset UVs (0=off, 1=heavy)
            shadows: 0.0,          // per-layer shadow brightness (−1=crush, 0=off, +1=lift)
            highlights: 0.0,       // per-layer highlight brightness (−1=pull down, 0=off, +1=boost)
            lift: 0.0,             // per-layer shadow bias — affects darks more than lights (−0.5 to +0.5)
            gain: 0.0,             // per-layer highlight boost — affects lights more than darks (−0.5 to +0.5)
            tintMG: 0.0,           // per-layer tint: negative=magenta, positive=green (−1 to +1)
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
            gifSpeed: 1.0,      // playback multiplier: 2 = twice as fast, 0.5 = half speed (default = native pace; applied at load via setUserTexture→_loadGifTexture)
            gifStability: 0.0,  // timing smoothing: 0 = native delays, 1 = perfectly even cadence. NOTE: only applied live via the slider (setGifAnimationStability) — NOT synced at load, so a non-zero default here would be a no-op until the slider is touched. Keep 0 so UI matches engine.
            alphaMode: (resized.isGif || false) ? 'preserve' : 'fade',  // 'fade' = raw alpha (default for stills), 'preserve' = silhouette stays solid while opacity fades
            reactSource: 'bass',   // Phase 5: 'bass' | 'mid' | 'treb' | 'vol'
            reactCurve: 'linear',  // Phase 5: 'linear' | 'squared' | 'cubed' | 'threshold'
            orbitMode: 'circle',   // Phase 6: 'circle' | 'lissajous'
            lissFreqX: 0.50,       // Lissajous X-axis frequency (Hz)
            lissFreqY: 0.75,       // Lissajous Y-axis frequency (Hz) — 3:2 ratio default
            lissPhase: 0.25,       // Lissajous X phase offset (0–1 cycles)
            strobeAmp: 0.00,       // Phase 6: hard beat-cut intensity (0=off, 1=full black)
            strobeThr: 0.40,       // audio threshold to trigger strobe
            tiltAmp: 0.00,         // beat-driven rotation (rad envelope, max ≈15°)
            tiltDir: 1,            // +1 = tilt right (CW), -1 = tilt left (CCW)
            hopAmp: 0.00,          // beat-driven X-axis displacement (UV envelope)
            hopDir: 1,             // +1 = hop right, -1 = hop left
            huePulse: 0.00,        // beat-driven hue shift (0=off, 1=full 360° on a hit)
            blurPulse: 0.00,       // beat-driven blur add (0=off, 1=max focus pull)
            squashAmp: 0.00,       // beat-driven asymmetric scale (0=off, 1=max distort)
            squashAxis: 'wide',    // 'wide' = X stretch + Y crush; 'tall' = inverse
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
            lumaKeyLo: 0.00,       // luma key low threshold (0–1): pixels darker than this become transparent
            lumaKeyHi: 0.00,       // luma key high threshold (0–1): pixels brighter than this become transparent
            waveAmp: 0.00,         // wave distort amplitude (0–1): sinusoidal UV warp strength
            waveFreq: 4.0,         // wave distort frequency (1–20): number of sine cycles across image
            invertMix: 0.00,       // color inversion mix (0–1): 0=normal, 1=fully inverted
            solarizeMix: 0.00,     // solarize fold mix (0–1): 0=off, 1=full tone-curve fold
            thresholdCutoff: 0.00, // threshold cutoff (0–1): 0=off, >0=binary B&W at that luminance
            pixelate: 0.00,        // pixelate/mosaic amount (0–1): 0=off, 1=maximum blockiness
            scanLines: 0.00,       // CRT scan lines intensity (0–1): 0=off, 1=full dark bands
            filmGrain: 0.00,       // animated noise overlay (0–1): 0=off, 1=heavy grain
            perspX: 0.00,          // perspective tilt X (−1 to +1): horizontal vanishing point
            perspY: 0.00,          // perspective tilt Y (−1 to +1): vertical vanishing point
            vignette: 0,           // 0 = off, 1 = on
            vignetteCX: 0.5,       // center X (0-1) — full screen position
            vignetteCY: 0.5,       // center Y (0-1) — full screen position
            vignetteW: 0.5,        // width of mask area (0-1)
            vignetteH: 0.5,        // height of mask area (0-1)
            vignetteCorner: 0.3,   // corner roundness (0-1): 0=sharp, 1=fully rounded
            vignetteStrength: 0.5, // how dark/tinted it gets (0-1)
            vignetteFeather: 0.3,  // edge softness (0-1)
            vignetteColor: '#000000', // vignette tint color
            isHd: hdMode,          // badge shown in card header
            // Phase 1: Per-Cell controls (tile-gated)
            tileOffsetAxis: 'none',     // 'none' | 'row' | 'col' — brick / half-drop stagger axis
            tileOffsetAmount: 0.00,     // half-drop amount in cell units (0.5 = classic brick)
            tileRotateVariance: 0.00,   // per-cell random rotation amount (0=aligned, 1=full random)
            tileRotateSnap: false,      // snap=on: variance acts as probability of a random 90° rotation
            tilePopcornAmount: 0.00,    // per-cell audio pulse with hashed phase (0=uniform, 1=full chaos)
            // Phase 2: Variance suite
            tileSizeVariance: 0.00,     // per-cell scale deviation (0=uniform, 1=±50% size per cell)
            tileJitterX: 0.00,          // per-cell horizontal content offset (0=aligned, 1=full slot width)
            tileJitterY: 0.00,          // per-cell vertical content offset
            tileOpacityVariance: 0.00,  // per-cell opacity deviation (0=uniform, 1=full range)
            tileDepthVariance: 0.00,    // per-cell depth scale (tunnel: parallax depth field; no tunnel: static zoom)
            tileVarianceSeed: 0,        // int 0–9999 — shifts all per-cell hash patterns
            tileVarianceSeedLocked: true, // true=seed frozen; false=save bumps seed by 1
            // Phase 3: Grid mode
            tileMode: 'density',        // 'density' (Size-driven count) | 'grid' (explicit Cols×Rows)
            tileCols: 3,                // grid mode: columns (integer ≥ 1)
            tileRows: 3,                // grid mode: rows (integer ≥ 1)
            tileFit: 'fill',            // grid mode: 'fill' (stretch to cell) | 'fit' (aspect-preserve + transparent pad)
            tileGridScale: 1.0,         // grid mode: overall grid scale (1=fills canvas, <1=centered with margin)
            // Phase 4: Recursive grids (grid mode only)
            tileSubdivide: 1,           // each grid cell → S×S inner cells (1=off, integer 1–6)
            tileOuterGap: 0,            // gap between outer cells, 0–0.5 (0=collapses to flat grid)
            // Animation system (animation-dev.md P0). Neutral values are the
            // identity for the q-register pipe: opacity*1, size*1, cx+0, cy+0,
            // blur+0 — byte-equivalent to no animation. Mutated by GSAP later.
            _anim: { opacity: 1.0, scale: 1.0, cxOffset: 0.0, cyOffset: 0.0, blur: 0.0 },
        };
        this.currentState.images.push(entry);

        const texObj = {
            data: resized.dataURL,
            width: optimizedGifData ? optimizedGifData.width : resized.width,
            height: optimizedGifData ? optimizedGifData.height : resized.height,
            isGif: resized.isGif || false,
            gifSpeed: entry.gifSpeed,
            gifStability: entry.gifStability,
            optimizedGifData // Pass pre-processed frames to visualizer if available
        };
        this._mountLayerCard(entry, texObj);
        if (!resized.resized) showToast('Image layer added');
        if (this.currentState.images.length === 1) showHint();
    }

    // ─── Transparent WebM on macOS — Stacked-Alpha conversion ─────────────────
    // WKWebView drops VP9 alpha. Convert the WebM to a stacked-alpha VP9 (RGB top,
    // alpha-as-luma bottom) via a native ffmpeg sidecar, then route through the
    // regular video layer path with isStackedAlpha=true so the visualizer
    // composites top/bottom into RGBA on every frame.

    async _handleWebmAlphaUpload(file) {
        if (!this.currentState.images) this.currentState.images = [];
        if (this.currentState.images.length >= MAX_LAYERS) {
            showToast(`Max ${MAX_LAYERS} layers`, true);
            return;
        }
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const startTime = Date.now();
        showToast(`Converting transparent video (${sizeMB}MB)… 0s`, false, 0);

        let unlisten = null;
        if (window.__TAURI__?.event) {
            unlisten = await window.__TAURI__.event.listen('webm-convert-progress', () => {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                showToast(`Converting transparent video… ${elapsed}s`, false, 0);
            });
        }

        try {
            const buf = await file.arrayBuffer();
            const u8 = new Uint8Array(buf);
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < u8.length; i += chunk) {
                binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
            }
            const inputB64 = btoa(binary);
            // Bytes arrive via Tauri IPC (same-origin). Rust runs ffmpeg to produce
            // a stacked-alpha H.264 MP4 — see src-tauri/src/main.rs for the codec
            // choice rationale (TL;DR: VP9 is cross-origin-tainted in production
            // WKWebView, H.264 is not).
            const outputB64 = await window.__TAURI__.invoke('convert_to_stacked_alpha_b64', { inputB64 });
            const outBin = atob(outputB64);
            const outBytes = new Uint8Array(outBin.length);
            for (let i = 0; i < outBin.length; i++) outBytes[i] = outBin.charCodeAt(i);
            const mp4Name = file.name.replace(/\.webm$/i, '.mp4');
            const stackedFile = new File([outBytes], mp4Name, { type: 'video/mp4' });
            showToast(`Loading layer (${(outBytes.length/1024/1024).toFixed(1)}MB)…`, false, 1500);
            await this._addVideoLayer(stackedFile, { isStackedAlpha: true });
        } catch (err) {
            console.error('[Editor] Stacked-alpha conversion failed:', err);
            showToast('Transparent WebM conversion failed: ' + (err?.message || err), true);
        } finally {
            if (unlisten) unlisten();
        }
    }

    // ─── Add a video layer ─────────────────────────────────────────────────────
    // Videos support tiling (video-tiling-dev.md): default single-instance, with
    // playback controls and color grading; Tile toggles Density/Grid like images.
    // Auto-transcodes oversized videos to 720p using FFmpeg.wasm.
    //
    // Invariant: every video stored in this app MUST be audio-free. Oversized
    // videos lose audio via `-an` in `transcodeTo720p`; all other videos pass
    // through `stripAudio` below. Audio-laden video elements grabbed the
    // MediaSession in WKWebView and broke the main audio player — see
    // milkdrop-dev.md "Video audio strip" entry.

    async _addVideoLayer(file, opts = {}) {
        const isStackedAlpha = !!opts.isStackedAlpha;
        if (!this.currentState.images) this.currentState.images = [];
        if (this.currentState.images.length >= MAX_LAYERS) {
            showToast(`Max ${MAX_LAYERS} layers (images + videos)`, true);
            return;
        }

        // ── 720p upload guard with auto-transcoding ────────────────────────────
        const MAX_VIDEO_WIDTH = 1280;
        const MAX_VIDEO_HEIGHT = 720;

        // Create video element to check dimensions
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.playsInline = true;  // Critical for WKWebView inline playback
        video.muted = true;        // WKWebView autoplay requires muted initially
        video.volume = 0;          // Belt-and-suspenders — audio is already stripped, but never trust the file
        video.loop = true;         // Required for continuous playback
        let videoUrl = URL.createObjectURL(file);

        let videoWidth = 0;
        let videoHeight = 0;
        let videoDuration = 0;

        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('video metadata never loaded (10s timeout)')), 10000);
                video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
                video.onerror = () => { clearTimeout(timer); reject(new Error('Could not load video')); };
                video.src = videoUrl;
            });

            videoWidth = video.videoWidth;
            videoHeight = video.videoHeight;
            videoDuration = video.duration || 0;

            // Auto-transcode oversized videos instead of rejecting
            // WebM files skip transcoding — VP9 streams don't need a frame RAM budget,
            // and libvpx-vp9 encoding is not available in the FFmpeg.wasm CDN build.
            const isWebM = file.name.toLowerCase().endsWith('.webm') || file.type === 'video/webm';
            if (!isWebM && (videoWidth > MAX_VIDEO_WIDTH || videoHeight > MAX_VIDEO_HEIGHT)) {
                URL.revokeObjectURL(videoUrl);
                
                const originalSize = formatBytes(file.size);
                showToast(`Video is ${videoWidth}×${videoHeight}. Optimizing to 720p...`, false, 0); // persistent toast
                
                try {
                    // Transcode with progress updates
                    file = await transcodeTo720p(file, (progress) => {
                        const percent = Math.round(progress.percent);
                        showToast(`Optimizing video... ${percent}%`, false, 0);
                    });
                    
                    showToast(`Optimized: ${originalSize} → ${formatBytes(file.size)}`, false, 3000);
                    
                    // Re-check dimensions after transcode
                    const newVideo = document.createElement('video');
                    newVideo.preload = 'metadata';
                    const newUrl = URL.createObjectURL(file);
                    await new Promise((resolve, reject) => {
                        newVideo.onloadedmetadata = resolve;
                        newVideo.onerror = reject;
                        newVideo.src = newUrl;
                    });
                    videoWidth = newVideo.videoWidth;
                    videoHeight = newVideo.videoHeight;
                    URL.revokeObjectURL(newUrl);
                } catch (transcodeErr) {
                    showToast('Video optimization failed. Please use 720p or smaller.', true);
                    console.error('[Editor] Transcode failed:', transcodeErr);
                    return;
                }
            } else {
                // Non-transcoded path: strip audio via FFmpeg remux (no re-encode,
                // a few seconds even on 50MB+ clips). Oversized videos already lose
                // audio via `-an` in transcodeTo720p above. See invariant block at
                // top of _addVideoLayer for why this is non-negotiable.
                URL.revokeObjectURL(videoUrl);
                try {
                    showToast('Stripping audio from video…');
                    file = await stripAudio(file);
                } catch (stripErr) {
                    console.error('[Editor] Audio strip failed:', stripErr);
                    showToast('Could not strip audio from video', true);
                    return;
                }
                // Rebuild the probe element from the stripped file so finalVideo
                // (which is set to `video` below) plays the audio-free version.
                video.src = '';
                video.load();
                videoUrl = URL.createObjectURL(file);
                try {
                    await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('reload timeout')), 10000);
                        video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
                        video.onerror = () => { clearTimeout(timer); reject(new Error('reload failed')); };
                        video.src = videoUrl;
                    });
                } catch (e) {
                    URL.revokeObjectURL(videoUrl);
                    showToast('Could not reload stripped video', true);
                    return;
                }
            }
        } catch (err) {
            URL.revokeObjectURL(videoUrl);
            showToast('Could not load video', true);
            return;
        }

        // ── Prepare video element (original or transcoded) ────────────────────
        // If we transcoded, create new video element for the transcoded file
        let finalVideo = video;
        let finalVideoUrl = videoUrl;
        
        if (videoWidth !== video.videoWidth || videoHeight !== video.videoHeight) {
            // Dimensions changed — we transcoded. Create new element for transcoded file.
            URL.revokeObjectURL(videoUrl); // Clean up original
            
            finalVideo = document.createElement('video');
            finalVideo.playsInline = true;
            finalVideo.muted = true;
            finalVideo.volume = 0;        // Audio stripped at transcode (-an); guard anyway
            finalVideo.loop = true;
            finalVideo.preload = 'auto';  // Changed from 'metadata' for continuous playback
            finalVideoUrl = URL.createObjectURL(file);
            
            // WKWebView: append to DOM BEFORE setting src for proper initialization
            finalVideo.style.position = 'fixed';
            finalVideo.style.left = '-9999px';
            finalVideo.style.width = '1px';
            finalVideo.style.height = '1px';
            finalVideo.style.opacity = '0';
            finalVideo.style.pointerEvents = 'none';
            document.body.appendChild(finalVideo);
            
            // Load metadata to get final dimensions and duration
            try {
                await new Promise((resolve, reject) => {
                    finalVideo.onloadedmetadata = resolve;
                    finalVideo.onerror = reject;
                    finalVideo.src = finalVideoUrl;
                });
                videoDuration = finalVideo.duration || videoDuration;
            } catch (e) {
                console.warn('[Editor] Could not reload transcoded video metadata');
            }
        }

        // For non-transcoded videos, append to DOM now (transcoded already appended above)
        if (!finalVideo.parentNode) {
            // WKWebView fix: video must be in DOM to decode properly
            finalVideo.style.position = 'fixed';
            finalVideo.style.left = '-9999px';
            finalVideo.style.width = '1px';
            finalVideo.style.height = '1px';
            finalVideo.style.opacity = '0';
            finalVideo.style.pointerEvents = 'none';
            document.body.appendChild(finalVideo);
        }

        // Smart accordion: collapse every existing card before we add the new one.
        // …but never squash the card that's DRIVING the preset — its body IS the Drive
        // panel you're working in, so keep it open when a new layer arrives.
        const _driveTex = this.currentState.imageWarp?.enabled ? this.currentState.imageWarp.texName : null;
        this.currentState.images.forEach(e => { if (e.texName !== _driveTex) e.collapsed = true; });
        document.querySelectorAll('#image-layers .image-layer-card').forEach(c => {
            if (c.dataset.texName !== _driveTex) c.classList.add('collapsed');
        });

        const texName = `uservid${Date.now().toString(36)}`;
        const videoId = generateId();

        // Store the video file blob
        storeImage(videoId, file).catch(err => {
            console.warn('[Editor] storeVideo failed:', err.message);
        });

        // Video defaults — single instance (no tiling), different blend/scale defaults
        const entry = {
            type: 'video',         // Distinguishes from image layers
            texName,
            videoId,
            fileName: file.name,
            // Playback
            isPlaying: true,
            loop: true,
            speed: 1.0,
            currentTime: 0,
            duration: videoDuration || 0,
            // Transform (simplified — no tiling)
            scale: 0.6,            // Coverage % instead of tile density
            opacity: 1.0,          // Full opacity - video appears as-is
            blendMode: 'overlay',  // Natural overlay - preserves video colors
            spinSpeed: 0.00,
            orbitRadius: 0.00,
            cx: 0.50,
            cy: 0.50,
            bounceAmp: 0.00,
            swayAmt: 0.00,
            swaySpeed: 1.00,
            wanderAmt: 0.00,
            wanderSpeed: 0.50,
            mirror: 'none',        // Duplication via mirror only
            mirrorScope: 'field',    // Always whole-image for videos
            kaleidoSpeed: 0.00,
            // Tile-related properties — opaque video can tile (video-tiling-dev.md Phase A);
            // defaults keep a freshly-added video single-instance until Tile is turned on.
            tile: false,
            spacing: 0,
            tileScaleX: 1.0,
            tileScaleY: 1.0,
            groupSpin: false,
            radius: 0,
            // Per-cell + grid fields (shared with image/text tiling) — all no-ops at default
            tileOffsetAxis: 'none', tileOffsetAmount: 0.00,
            tileRotateVariance: 0.00, tileRotateSnap: false,
            tilePopcornAmount: 0.00,
            tileSizeVariance: 0.00, tileJitterX: 0.00, tileJitterY: 0.00,
            tileOpacityVariance: 0.00, tileDepthVariance: 0.00,
            tileVarianceSeed: 0, tileVarianceSeedLocked: true,
            tileMode: 'density', tileCols: 3, tileRows: 3, tileFit: 'fill', tileGridScale: 1.0,
            tileSubdivide: 1, tileOuterGap: 0,
            isGif: false,
            alphaMode: isStackedAlpha ? 'preserve' : 'fade',
            // Color grading (new for video)
            brightness: 1.0,
            contrast: 1.0,
            gamma: 1.0,
            fade: 0.0,
            colorTemp: 0.0,
            sepia: 0.0,
            blur: 0.0,
            shadows: 0.0,
            highlights: 0.0,
            lift: 0.0,
            gain: 0.0,
            tintMG: 0.0,
            // Effects (reused)
            tintR: 1.00, tintG: 1.00, tintB: 1.00,
            hueSpinSpeed: 0.00,
            imageSaturation: 1.00,
            imageHue: 0,
            chromaticAberration: 0.00,
            chromaticSpeed: 1.00,
            posterize: 0,
            shakeAmp: 0.00,
            angle: 0.00,
            skewX: 0.00, skewY: 0.00,
            perspX: 0.00, perspY: 0.00,
            tunnelSpeed: 0.00,
            strobeAmp: 0.00, strobeThr: 0.40,
            tiltAmp: 0.00, tiltDir: 1,
            hopAmp: 0.00, hopDir: 1,
            huePulse: 0.00,
            blurPulse: 0.00,
            squashAmp: 0.00, squashAxis: 'wide',
            edgeSobel: false,
            lumaKeyLo: 0.00,       // luma key low threshold (0–1): pixels darker than this become transparent
            lumaKeyHi: 0.00,       // luma key high threshold (0–1): pixels brighter than this become transparent
            waveAmp: 0.00,         // wave distort amplitude (0–1): sinusoidal UV warp strength
            waveFreq: 4.0,         // wave distort frequency (1–20): number of sine cycles across image
            invertMix: 0.00,       // color inversion mix (0–1): 0=normal, 1=fully inverted
            solarizeMix: 0.00,     // solarize fold mix (0–1): 0=off, 1=full tone-curve fold
            thresholdCutoff: 0.00, // threshold cutoff (0–1): 0=off, >0=binary B&W at that luminance
            pixelate: 0.00,        // pixelate/mosaic amount (0–1): 0=off, 1=maximum blockiness
            scanLines: 0.00,       // CRT scan lines intensity (0–1): 0=off, 1=full dark bands
            filmGrain: 0.00,       // animated noise overlay (0–1): 0=off, 1=heavy grain
            // Border (video-only)
            vidBorderWidth: 0.00,
            vidBorderColor: '#ffffff',
            vidBorderFeather: 0.00,
            // Audio reactivity (reused)
            opacityPulse: 0.00,
            audioPulse: 0.00,
            pulseInvert: false,
            reactSource: 'bass',
            reactCurve: 'linear',
            // Animation
            orbitMode: 'circle',
            lissFreqX: 0.50, lissFreqY: 0.75, lissPhase: 0.25,
            panMode: 'off', panSpeedX: 0.00, panSpeedY: 0.00, panRange: 0.20,
            depthOffset: 0.00,
            // UI state
            collapsed: false,
            solo: false,
            muted: false,
            name: file.name.replace(/\.[^.]+$/, '') || 'Video Layer',
            // Metadata
            texW: finalVideo.videoWidth,
            texH: isStackedAlpha ? Math.floor(finalVideo.videoHeight / 2) : finalVideo.videoHeight,
            isHd: false,  // Videos don't use HD toggle
            isStackedAlpha,
            // Animation system (animation-dev.md P0). Neutral values; see _addImageLayer.
            _anim: { opacity: 1.0, scale: 1.0, cxOffset: 0.0, cyOffset: 0.0, blur: 0.0 },
        };

        this.currentState.images.push(entry);

        // Create video texture object
        const texObj = {
            data: finalVideoUrl,        // Object URL for video element
            width: finalVideo.videoWidth,
            height: isStackedAlpha ? Math.floor(finalVideo.videoHeight / 2) : finalVideo.videoHeight,
            isVideo: true,              // Flag for visualizer
            videoElement: finalVideo,   // Reference for texture upload loop
            videoId,
            _videoUrl: finalVideoUrl,   // Keep reference for cleanup
            isStackedAlpha,
        };

        this._mountLayerCard(entry, texObj);
        showToast(`Video layer added (${finalVideo.videoWidth}×${finalVideo.videoHeight})`);
        if (this.currentState.images.length === 1) showHint();

        // Start video playback - critical for texture upload loop.
        // Surface rejection as a toast — production hardened-runtime WKWebView
        // can silently reject autoplay even with muted+playsInline, and a
        // bare .catch(console.warn) is invisible without devtools.
        finalVideo.play().catch(err => {
            console.warn('[Editor] Video autoplay failed:', err.message);
            showToast('autoplay rejected: ' + (err?.name || '') + ': ' + (err?.message || err), true);
        });

        // NOTE: We do NOT revoke the blob URL here - WKWebView needs it to stay
        // valid for the entire playback. It will be cleaned up when the layer
        // is deleted via the delete button.
    }

    // ─── Add a text layer ──────────────────────────────────────────────────────
    // No file picker — creates entry with type:'text' and renders initial texture.

    _addTextLayer() {
        if (!this.currentState.images) this.currentState.images = [];
        if (this.currentState.images.length >= MAX_LAYERS) {
            showToast(`Max ${MAX_LAYERS} layers`, true);
            return;
        }

        // Smart accordion: collapse existing cards
        // …but never squash the card that's DRIVING the preset — its body IS the Drive
        // panel you're working in, so keep it open when a new layer arrives.
        const _driveTex = this.currentState.imageWarp?.enabled ? this.currentState.imageWarp.texName : null;
        this.currentState.images.forEach(e => { if (e.texName !== _driveTex) e.collapsed = true; });
        document.querySelectorAll('#image-layers .image-layer-card').forEach(c => {
            if (c.dataset.texName !== _driveTex) c.classList.add('collapsed');
        });

        const texName = `usertxt${Date.now().toString(36)}`;

        const entry = {
            type: 'text',
            texName,
            // Content
            text: 'Hello\nWorld',
            // Typography
            fontFamily: 'Inter',
            fontSize: 64,
            fontWeight: 'bold',
            color: '#ffffff',
            textAlign: 'center',
            letterSpacing: 0,
            lineHeight: 1.2,
            // Effects
            textShadow: { enabled: true, color: '#000000', blur: 8, offsetX: 3, offsetY: 3 },
            textOutline: { enabled: false, color: '#000000', width: 2 },
            backgroundBox: { enabled: false, color: '#000000', padding: 10, opacity: 0.5 },
            // Transforms — same defaults as image layers
            blendMode: 'normal',
            size: 0.50,
            opacity: 1.0,
            opacityPulse: 0.00,
            spinSpeed: 0.00,
            orbitRadius: 0.00,
            orbitMode: 'circle',
            lissFreqX: 0.50,
            lissFreqY: 0.75,
            lissPhase: 0.25,
            bounceAmp: 0.00,
            cx: 0.50,
            cy: 0.50,
            swayAmt: 0.00,
            swaySpeed: 1.00,
            wanderAmt: 0.00,
            wanderSpeed: 0.50,
            panMode: 'off',
            panSpeedX: 0.00,
            panSpeedY: 0.00,
            panRange: 0.20,
            mirror: 'none',
            mirrorScope: 'tile',
            kaleidoSpeed: 0.00,
            tintR: 1.00, tintG: 1.00, tintB: 1.00,
            hueSpinSpeed: 0.00,
            imageSaturation: 1.00,
            imageHue: 0,
            brightness: 1.0,
            contrast: 1.0,
            gamma: 1.0,
            fade: 0.0,
            colorTemp: 0.0,
            sepia: 0.0,
            blur: 0.0,
            shadows: 0.0,
            highlights: 0.0,
            lift: 0.0,
            gain: 0.0,
            tintMG: 0.0,
            tile: false,
            spacing: 0.00,
            tileScaleX: 1.00,
            tileScaleY: 1.00,
            tunnelSpeed: 0.00,
            depthOffset: 0.00,
            groupSpin: false,
            audioPulse: 0.00,
            pulseInvert: false,
            angle: 0.00,
            skewX: 0.00,
            skewY: 0.00,
            perspX: 0.00,
            perspY: 0.00,
            radius: 0.00,
            chromaticAberration: 0.00,
            chromaticSpeed: 1.00,
            shakeAmp: 0.00,
            strobeAmp: 0.00,
            strobeThr: 0.40,
            tiltAmp: 0.00, tiltDir: 1,
            hopAmp: 0.00, hopDir: 1,
            huePulse: 0.00,
            blurPulse: 0.00,
            squashAmp: 0.00, squashAxis: 'wide',
            posterize: 0,
            edgeSobel: false,
            lumaKeyLo: 0.00,
            lumaKeyHi: 0.00,
            waveAmp: 0.00,
            waveFreq: 4.0,
            invertMix: 0.00,
            solarizeMix: 0.00,
            thresholdCutoff: 0.00,
            pixelate: 0.00,
            scanLines: 0.00,
            filmGrain: 0.00,
            reactSource: 'bass',
            reactCurve: 'linear',
            solo: false,
            muted: false,
            collapsed: false,
            isGif: false,
            isText: true,
            name: 'Text',
            // Phase 1: Per-Cell controls (tile-gated, off by default for text since tile=false)
            tileOffsetAxis: 'none',
            tileOffsetAmount: 0.00,
            tileRotateVariance: 0.00,
            tileRotateSnap: false,
            tilePopcornAmount: 0.00,
            // Phase 2: Variance suite
            tileSizeVariance: 0.00,
            tileJitterX: 0.00,
            tileJitterY: 0.00,
            tileOpacityVariance: 0.00,
            tileDepthVariance: 0.00,
            tileVarianceSeed: 0,
            tileVarianceSeedLocked: true,
            // Phase 3: Grid mode
            tileMode: 'density',
            tileCols: 3,
            tileRows: 3,
            tileFit: 'fill',
            tileGridScale: 1.0,
            // Phase 4: Recursive grids
            tileSubdivide: 1,
            tileOuterGap: 0,
            // Animation system (animation-dev.md P0). Neutral values; see _addImageLayer.
            _anim: { opacity: 1.0, scale: 1.0, cxOffset: 0.0, cyOffset: 0.0, blur: 0.0 },
        };
        this.currentState.images.push(entry);

        const initRendered = this.engine._renderTextTexture(entry);
        entry.texW = initRendered.width;
        entry.texH = initRendered.height;
        const texObj = { isText: true, textLayer: entry, width: initRendered.width, height: initRendered.height };
        this._mountLayerCard(entry, texObj);
        showToast('Text layer added');
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
              <button class="layer-action-btn layer-drive layer-drive-pill" type="button"
                      aria-pressed="false" data-tooltip="Meld THIS image INTO the preset — its warp engine melts, tunnels & pulses the image (replaces its overlay)">Meld</button>
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
                <button class="layer-action-btn layer-animate" type="button"
                        data-tooltip="Animate this layer (entrance / exit / idle)" aria-label="Animate this layer">✦<span class="layer-animate-dot" hidden></span></button>
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
            ${entry.type === 'video' ? `
            <p class="layer-section-label">Playback</p>
            <div class="layer-row-inline">
              <button class="layer-video-play-btn" type="button">${entry.isPlaying ? '⏸ Pause' : '▶ Play'}</button>
              <span class="layer-ctrl-label" style="margin-left:12px">Loop</span>
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-video-loop" ${entry.loop ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Speed</span>
              <input type="range" class="slider layer-video-speed-sl" min="0.25" max="4" step="0.25"
                value="${entry.speed}" style="--pct:${pct(entry.speed, 0.25, 4)}">
              <span class="lsv layer-video-speed-val">${entry.speed.toFixed(2)}×</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Scrub</span>
              <input type="range" class="slider layer-video-scrub-sl" min="0" max="1" step="0.001"
                value="${entry.currentTime / Math.max(entry.duration, 1)}" style="--pct:${((entry.currentTime / Math.max(entry.duration, 1)) * 100).toFixed(1)}%">
              <span class="lsv layer-video-time-val">${formatTime(entry.currentTime)} / ${formatTime(entry.duration)}</span>
            </div>
            <div class="layer-section-divider"></div>
            ` : ''}
            ${entry.type === 'text' ? `
            <p class="layer-section-label">Content</p>
            <textarea class="layer-text-input" spellcheck="false" rows="3">${entry.text || ''}</textarea>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Typography</p>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Font</span>
              <select class="layer-font-family">
                <optgroup label="Standard">
                  <option value="Inter"${entry.fontFamily === 'Inter' ? ' selected' : ''}>Inter</option>
                  <option value="Roboto"${entry.fontFamily === 'Roboto' ? ' selected' : ''}>Roboto</option>
                  <option value="Poppins"${entry.fontFamily === 'Poppins' ? ' selected' : ''}>Poppins</option>
                  <option value="Montserrat"${entry.fontFamily === 'Montserrat' ? ' selected' : ''}>Montserrat</option>
                  <option value="Raleway"${entry.fontFamily === 'Raleway' ? ' selected' : ''}>Raleway</option>
                </optgroup>
                <optgroup label="Display">
                  <option value="Oswald"${entry.fontFamily === 'Oswald' ? ' selected' : ''}>Oswald</option>
                  <option value="Anton"${entry.fontFamily === 'Anton' ? ' selected' : ''}>Anton</option>
                  <option value="Bebas Neue"${entry.fontFamily === 'Bebas Neue' ? ' selected' : ''}>Bebas Neue</option>
                  <option value="Bangers"${entry.fontFamily === 'Bangers' ? ' selected' : ''}>Bangers</option>
                  <option value="Black Ops One"${entry.fontFamily === 'Black Ops One' ? ' selected' : ''}>Black Ops One</option>
                  <option value="Russo One"${entry.fontFamily === 'Russo One' ? ' selected' : ''}>Russo One</option>
                  <option value="Righteous"${entry.fontFamily === 'Righteous' ? ' selected' : ''}>Righteous</option>
                  <option value="Cinzel"${entry.fontFamily === 'Cinzel' ? ' selected' : ''}>Cinzel</option>
                </optgroup>
                <optgroup label="Tech / Sci-Fi">
                  <option value="Orbitron"${entry.fontFamily === 'Orbitron' ? ' selected' : ''}>Orbitron</option>
                  <option value="Exo 2"${entry.fontFamily === 'Exo 2' ? ' selected' : ''}>Exo 2</option>
                  <option value="Chakra Petch"${entry.fontFamily === 'Chakra Petch' ? ' selected' : ''}>Chakra Petch</option>
                </optgroup>
                <optgroup label="Retro / Pixel">
                  <option value="Press Start 2P"${entry.fontFamily === 'Press Start 2P' ? ' selected' : ''}>Press Start 2P</option>
                  <option value="VT323"${entry.fontFamily === 'VT323' ? ' selected' : ''}>VT323</option>
                </optgroup>
                <optgroup label="Handwritten">
                  <option value="Pacifico"${entry.fontFamily === 'Pacifico' ? ' selected' : ''}>Pacifico</option>
                  <option value="Permanent Marker"${entry.fontFamily === 'Permanent Marker' ? ' selected' : ''}>Permanent Marker</option>
                </optgroup>
              </select>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Weight</span>
              <select class="layer-font-weight">
                <option value="normal"${entry.fontWeight === 'normal' ? ' selected' : ''}>Normal</option>
                <option value="bold"${entry.fontWeight === 'bold' ? ' selected' : ''}>Bold</option>
              </select>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Size</span>
              <input type="range" class="slider layer-font-size-sl" min="24" max="200" step="1"
                value="${entry.fontSize || 64}" style="--pct:${pct(entry.fontSize || 64, 24, 200)}">
              <span class="lsv layer-font-size-val">${entry.fontSize || 64}px</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Space between letters (px)">Letter</span>
              <input type="range" class="slider layer-letter-spacing-sl" min="-10" max="30" step="1"
                value="${entry.letterSpacing || 0}" style="--pct:${pct(entry.letterSpacing || 0, -10, 30)}">
              <span class="lsv layer-letter-spacing-val">${entry.letterSpacing || 0}px</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Line height multiplier">Line</span>
              <input type="range" class="slider layer-line-height-sl" min="1.0" max="3.0" step="0.1"
                value="${(entry.lineHeight || 1.2).toFixed(1)}" style="--pct:${pct(entry.lineHeight || 1.2, 1.0, 3.0)}">
              <span class="lsv layer-line-height-val">${(entry.lineHeight || 1.2).toFixed(1)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Align</span>
              <div class="layer-text-align-seg" role="group" aria-label="Text alignment">
                <button class="lseg${(entry.textAlign || 'center') === 'left' ? ' active' : ''}" data-text-align="left">L</button>
                <button class="lseg${(entry.textAlign || 'center') === 'center' ? ' active' : ''}" data-text-align="center">C</button>
                <button class="lseg${(entry.textAlign || 'center') === 'right' ? ' active' : ''}" data-text-align="right">R</button>
              </div>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Color</span>
              <div class="layer-text-color-wrap">
                <span class="layer-text-color-swatch" style="background:${entry.color || '#ffffff'}"></span>
                <input type="color" class="layer-text-color-picker" value="${entry.color || '#ffffff'}">
              </div>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Effects</p>
            <div class="layer-row-inline">
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-text-shadow-cb" ${entry.textShadow?.enabled ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              <span class="layer-ctrl-label" style="margin-left:6px">Shadow</span>
            </div>
            <div class="layer-text-fx-detail layer-text-shadow-detail" style="${entry.textShadow?.enabled ? '' : 'display:none'}">
              <div class="layer-slider-row">
                <span class="layer-ctrl-label">Blur</span>
                <input type="range" class="slider layer-shadow-blur-sl" min="0" max="40" step="1"
                  value="${entry.textShadow?.blur ?? 8}" style="--pct:${pct(entry.textShadow?.blur ?? 8, 0, 40)}">
                <span class="lsv layer-shadow-blur-val">${entry.textShadow?.blur ?? 8}</span>
              </div>
              <div class="layer-row-inline">
                <span class="layer-ctrl-label">X / Y</span>
                <input type="range" class="slider layer-shadow-x-sl" min="-20" max="20" step="1"
                  value="${entry.textShadow?.offsetX ?? 3}" style="--pct:${pct(entry.textShadow?.offsetX ?? 3, -20, 20)}">
                <input type="range" class="slider layer-shadow-y-sl" min="-20" max="20" step="1"
                  value="${entry.textShadow?.offsetY ?? 3}" style="--pct:${pct(entry.textShadow?.offsetY ?? 3, -20, 20)}">
              </div>
              <div class="layer-row-inline">
                <span class="layer-ctrl-label">Color</span>
                <div class="layer-shadow-color-wrap">
                  <span class="layer-shadow-color-swatch" style="background:${entry.textShadow?.color || '#000000'}"></span>
                  <input type="color" class="layer-shadow-color-picker" value="${entry.textShadow?.color || '#000000'}">
                </div>
              </div>
            </div>
            <div class="layer-row-inline" style="margin-top:4px">
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-text-outline-cb" ${entry.textOutline?.enabled ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              <span class="layer-ctrl-label" style="margin-left:6px">Outline</span>
            </div>
            <div class="layer-text-fx-detail layer-text-outline-detail" style="${entry.textOutline?.enabled ? '' : 'display:none'}">
              <div class="layer-slider-row">
                <span class="layer-ctrl-label">Width</span>
                <input type="range" class="slider layer-outline-width-sl" min="1" max="16" step="1"
                  value="${entry.textOutline?.width ?? 3}" style="--pct:${pct(entry.textOutline?.width ?? 3, 1, 16)}">
                <span class="lsv layer-outline-width-val">${entry.textOutline?.width ?? 3}px</span>
              </div>
              <div class="layer-row-inline">
                <span class="layer-ctrl-label">Color</span>
                <div class="layer-outline-color-wrap">
                  <span class="layer-outline-color-swatch" style="background:${entry.textOutline?.color || '#000000'}"></span>
                  <input type="color" class="layer-outline-color-picker" value="${entry.textOutline?.color || '#000000'}">
                </div>
              </div>
            </div>
            <div class="layer-section-divider"></div>
            ` : ''}
            <div class="layer-row-inline">
              <span class="layer-ctrl-label">Blend</span>
              <select class="layer-blend">
                <option value="normal"${(entry.blendMode || 'overlay') === 'normal' ? ' selected' : ''}>Normal</option>
                <option value="screen"${(entry.blendMode || 'overlay') === 'screen' ? ' selected' : ''}>Screen</option>
                <option value="overlay"${(entry.blendMode || 'overlay') === 'overlay' ? ' selected' : ''}>Overlay</option>
                <option value="additive"${(entry.blendMode || 'overlay') === 'additive' ? ' selected' : ''}>Additive</option>
                <option value="multiply"${(entry.blendMode || 'overlay') === 'multiply' ? ' selected' : ''}>Multiply</option>
              </select>
              <span class="layer-ctrl-label" style="margin-left:8px">Tile</span>
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-tile" ${entry.tile ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Opacity</span>
              <input type="range" class="slider" min="0" max="1" step="0.01"
                value="${entry.opacity}" style="--pct:${pct(entry.opacity, 0, 1)}">
              <span class="lsv">${entry.opacity.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-size-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label layer-size-label">${entry.type === 'video' ? (entry.tile ? 'Size' : 'Scale') : 'Size'}</span>
              <input type="range" class="slider layer-size-sl" min="0" max="1" step="0.01"
                value="${entry.type === 'video' ? Math.sqrt((entry.scale - 0.1) / 1.9).toFixed(3) : Math.sqrt((entry.size - 0.05) / 1.45).toFixed(3)}" style="--pct:${entry.type === 'video' ? (Math.sqrt((entry.scale - 0.1) / 1.9) * 100).toFixed(1) : (Math.sqrt((entry.size - 0.05) / 1.45) * 100).toFixed(1)}%">
              <span class="lsv layer-size-val">${entry.type === 'video' ? entry.scale.toFixed(2) : entry.size.toFixed(2)}</span>
            </div>
            <div class="layer-row-inline layer-tilemode-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Density: Size sets the count. Grid: explicit Cols×Rows">Mode</span>
              <div class="layer-tilemode-seg" role="group" aria-label="Tile mode">
                <button class="lseg lseg-tilemode${(entry.tileMode || 'density') === 'density' ? ' active' : ''}" data-tile-mode="density">Density</button>
                <button class="lseg lseg-tilemode${entry.tileMode === 'grid' ? ' active' : ''}" data-tile-mode="grid">Grid</button>
              </div>
            </div>
            <div class="layer-row-inline layer-grid-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label">Cols</span>
              <input type="number" class="layer-grid-cols" min="1" max="16" step="1" value="${entry.tileCols || 3}" style="width:46px">
              <span class="layer-ctrl-label" style="margin-left:10px">Rows</span>
              <input type="number" class="layer-grid-rows" min="1" max="16" step="1" value="${entry.tileRows || 3}" style="width:46px">
            </div>
            <div class="layer-row-inline layer-grid-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Split each cell into an S×S inner sub-grid">Subdivide</span>
              <input type="number" class="layer-grid-subdiv" min="1" max="6" step="1" value="${entry.tileSubdivide || 1}" style="width:46px">
            </div>
            <div class="layer-slider-row layer-grid-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Gap between the outer cells — separates the sub-grids into clusters">Outer Gap</span>
              <input type="range" class="slider layer-outergap-sl" min="0" max="0.5" step="0.01"
                value="${entry.tileOuterGap !== undefined ? entry.tileOuterGap : 0}" style="--pct:${pct(entry.tileOuterGap !== undefined ? entry.tileOuterGap : 0, 0, 0.5)}">
              <span class="lsv layer-outergap-val">${(entry.tileOuterGap !== undefined ? entry.tileOuterGap : 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-grid-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Scale the whole grid — below 1 = centred with margin, above 1 = zoom in (edge cells cropped)">Scale</span>
              <input type="range" class="slider layer-gridscale-sl" min="0.1" max="3" step="0.01"
                value="${entry.tileGridScale !== undefined ? entry.tileGridScale : 1.0}" style="--pct:${pct(entry.tileGridScale !== undefined ? entry.tileGridScale : 1.0, 0.1, 3)}">
              <span class="lsv layer-gridscale-val">${(entry.tileGridScale !== undefined ? entry.tileGridScale : 1.0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline layer-grid-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Fill: stretch image to cell. Fit: keep aspect, transparent pad">Fit</span>
              <div class="layer-tilefit-seg" role="group" aria-label="Fit mode">
                <button class="lseg lseg-tilefit${(entry.tileFit || 'fill') === 'fill' ? ' active' : ''}" data-tile-fit="fill">Fill</button>
                <button class="lseg lseg-tilefit${entry.tileFit === 'fit' ? ' active' : ''}" data-tile-fit="fit">Fit</button>
              </div>
            </div>
            <div class="layer-row-inline layer-aspect-row" style="margin-top:4px${entry.tile && (entry.tileMode || 'density') === 'grid' ? ';display:none' : ''}">
              <span class="layer-ctrl-label" data-tooltip="Lock: keep this layer's true shape on any canvas. Fluid: let it adapt to the canvas (legacy).">Aspect</span>
              <div class="layer-aspect-seg" role="group" aria-label="Aspect mode">
                <button class="lseg lseg-aspect${(entry.aspectMode || 'lock') === 'lock' ? ' active' : ''}" data-aspect-mode="lock">Lock</button>
                <button class="lseg lseg-aspect${(entry.aspectMode || 'lock') === 'fluid' ? ' active' : ''}" data-aspect-mode="fluid">Fluid</button>
              </div>
            </div>
            ${entry.type === 'video' ? `
            <div class="layer-slider-row layer-vid-scale-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label" data-tooltip="Horizontal scale multiplier">Width</span>
              <input type="range" class="slider layer-vid-sx-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.tileScaleX - 0.25) / 3.75).toFixed(3)}" style="--pct:${(Math.sqrt((entry.tileScaleX - 0.25) / 3.75) * 100).toFixed(1)}%">
              <span class="lsv layer-vid-sx-val">${entry.tileScaleX.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-vid-scale-row"${entry.tile && (entry.tileMode || 'density') === 'grid' ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label" data-tooltip="Vertical scale multiplier">Height</span>
              <input type="range" class="slider layer-vid-sy-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.tileScaleY - 0.25) / 3.75).toFixed(3)}" style="--pct:${(Math.sqrt((entry.tileScaleY - 0.25) / 3.75) * 100).toFixed(1)}%">
              <span class="lsv layer-vid-sy-val">${entry.tileScaleY.toFixed(2)}</span>
            </div>
            ` : ''}
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
            <div class="layer-slider-row layer-tile-scale-row"${entry.tile && entry.type !== 'video' && (entry.tileMode || 'density') !== 'grid' ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label">Width</span>
              <input type="range" class="slider layer-tile-sx-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.tileScaleX - 0.25) / 3.75).toFixed(3)}" style="--pct:${(Math.sqrt((entry.tileScaleX - 0.25) / 3.75) * 100).toFixed(1)}%">
              <span class="lsv layer-tile-sx-val">${entry.tileScaleX.toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-tile-scale-row"${entry.tile && entry.type !== 'video' && (entry.tileMode || 'density') !== 'grid' ? '' : ' style="display:none"'}>
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
            <div class="layer-slider-row layer-tunnel-row layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Per-cell depth scale — parallax depth field with tunnel, static zoom depth without">Phase Var</span>
              <input type="range" class="slider layer-depthvar-sl" min="0" max="1" step="0.01"
                value="${(entry.tileDepthVariance || 0).toFixed(2)}" style="--pct:${pct(entry.tileDepthVariance || 0, 0, 1)}">
              <span class="lsv layer-depthvar-val">${(entry.tileDepthVariance || 0).toFixed(2)}</span>
            </div>
            <div class="layer-section-divider layer-percell-row"${entry.tile ? '' : ' style="display:none"'}></div>
            <p class="layer-section-label layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>Per-Cell</p>
            <div class="layer-row-inline layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Stagger alternating rows or columns">Offset</span>
              <div class="layer-offset-axis-seg" role="group" aria-label="Offset axis">
                <button class="lseg lseg-offset${(entry.tileOffsetAxis || 'none') === 'none' ? ' active' : ''}" data-offset-axis="none">Off</button>
                <button class="lseg lseg-offset${entry.tileOffsetAxis === 'row' ? ' active' : ''}" data-offset-axis="row">Row</button>
                <button class="lseg lseg-offset${entry.tileOffsetAxis === 'col' ? ' active' : ''}" data-offset-axis="col">Col</button>
              </div>
            </div>
            <div class="layer-slider-row layer-percell-row layer-offset-amt-row"${entry.tile && (entry.tileOffsetAxis && entry.tileOffsetAxis !== 'none') ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Stagger amount">Amount</span>
              <input type="range" class="slider layer-offset-amt-sl" min="0" max="1" step="0.01"
                value="${(entry.tileOffsetAmount || 0).toFixed(2)}" style="--pct:${pct(entry.tileOffsetAmount || 0, 0, 1)}">
              <span class="lsv layer-offset-amt-val">${(entry.tileOffsetAmount || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Random rotation per cell">Cell Rotate</span>
              <input type="range" class="slider layer-slider-inline layer-rotvar-sl" min="0" max="1" step="0.01"
                value="${(entry.tileRotateVariance || 0).toFixed(2)}" style="--pct:${pct(entry.tileRotateVariance || 0, 0, 1)}">
              <span class="lsv layer-rotvar-val">${(entry.tileRotateVariance || 0).toFixed(2)}</span>
              <span class="layer-ctrl-label" style="margin-left:8px;width:auto" data-tooltip="Snap to 90° increments">Snap</span>
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-rotsnap" ${entry.tileRotateSnap ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
            <div class="layer-slider-row layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Per-cell audio pulse">Popcorn</span>
              <input type="range" class="slider layer-popcorn-sl" min="0" max="1" step="0.01"
                value="${(entry.tilePopcornAmount || 0).toFixed(2)}" style="--pct:${pct(entry.tilePopcornAmount || 0, 0, 1)}">
              <span class="lsv layer-popcorn-val">${(entry.tilePopcornAmount || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Random size per cell">Size Var</span>
              <input type="range" class="slider layer-sizevar-sl" min="0" max="1" step="0.01"
                value="${(entry.tileSizeVariance || 0).toFixed(2)}" style="--pct:${pct(entry.tileSizeVariance || 0, 0, 1)}">
              <span class="lsv layer-sizevar-val">${(entry.tileSizeVariance || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Random horizontal offset per cell">Jitter X</span>
              <input type="range" class="slider layer-jitterx-sl" min="0" max="1" step="0.01"
                value="${(entry.tileJitterX || 0).toFixed(2)}" style="--pct:${pct(entry.tileJitterX || 0, 0, 1)}">
              <span class="lsv layer-jitterx-val">${(entry.tileJitterX || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Random vertical offset per cell">Jitter Y</span>
              <input type="range" class="slider layer-jittery-sl" min="0" max="1" step="0.01"
                value="${(entry.tileJitterY || 0).toFixed(2)}" style="--pct:${pct(entry.tileJitterY || 0, 0, 1)}">
              <span class="lsv layer-jittery-val">${(entry.tileJitterY || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Random opacity per cell">Opacity Var</span>
              <input type="range" class="slider layer-opacityvar-sl" min="0" max="1" step="0.01"
                value="${(entry.tileOpacityVariance || 0).toFixed(2)}" style="--pct:${pct(entry.tileOpacityVariance || 0, 0, 1)}">
              <span class="lsv layer-opacityvar-val">${(entry.tileOpacityVariance || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline layer-percell-row"${entry.tile ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Shift the randomization pattern — each value gives a different layout">Seed</span>
              <span class="lsv layer-seed-display" style="min-width:36px;text-align:right;margin-right:6px">${entry.tileVarianceSeed || 0}</span>
              <button class="lseg layer-seed-rand" style="padding:0 8px" data-tooltip="Pick a random seed">Rand</button>
              <label class="toggle-switch toggle-switch--sm" style="margin-left:8px" data-tooltip="Lock seed so saves don't bump it">
                <input type="checkbox" class="layer-seed-lock" ${(entry.tileVarianceSeedLocked !== false) ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              <span class="layer-ctrl-label" style="width:auto;margin-left:4px">Lock</span>
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
            <div class="layer-mirror-scope" role="group" aria-label="Mirror scope"${entry.tile ? '' : ' style="display:none"'}>
              <button class="lseg lseg-scope active" data-scope="tile" data-tooltip="Fold inside each tile">Per Tile</button>
              <button class="lseg lseg-scope" data-scope="field" data-tooltip="Fold the whole tiled group">Whole Image</button>
            </div>
            <div class="layer-slider-row layer-kaleido-speed-row"${entry.mirror === 'kaleido' ? '' : ' style="display:none"'}>
              <span class="layer-ctrl-label" data-tooltip="Speed at which the kaleidoscope pattern rotates. Zero = frozen.">Speed</span>
              <input type="range" class="slider slider--bipolar layer-kaleido-speed-sl" min="-1" max="1" step="0.01"
                value="${(Math.sign(entry.kaleidoSpeed || 0) * Math.cbrt(Math.abs(entry.kaleidoSpeed || 0) / 2)).toFixed(4)}"
                style="${(() => { const _p = Math.sign(entry.kaleidoSpeed||0)*Math.cbrt(Math.abs(entry.kaleidoSpeed||0)/2); const _pct=(_p+1)/2*100; return `--pct-lo:${_p>=0?50:_pct.toFixed(1)}%;--pct-hi:${_p>=0?_pct.toFixed(1):50}%`; })()}">
              <span class="lsv layer-kaleido-speed-val">${(entry.kaleidoSpeed || 0).toFixed(2)}</span>
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
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Multiply brightness — 0=black, 1=original, 2=double">Brightness</span>
              <input type="range" class="slider layer-brightness-sl" min="0" max="2" step="0.01"
                value="${(entry.brightness ?? 1.0).toFixed(2)}" style="--pct:${pct(entry.brightness ?? 1.0, 0, 2)}">
              <span class="lsv layer-brightness-val">${(entry.brightness ?? 1.0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Contrast — 0=flat grey, 1=original, 2=high contrast">Contrast</span>
              <input type="range" class="slider layer-contrast-sl" min="0" max="2" step="0.01"
                value="${(entry.contrast ?? 1.0).toFixed(2)}" style="--pct:${pct(entry.contrast ?? 1.0, 0, 2)}">
              <span class="lsv layer-contrast-val">${(entry.contrast ?? 1.0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Gamma — below 1 lifts midtones bright, above 1 darkens them">Gamma</span>
              <input type="range" class="slider layer-gamma-sl" min="0.5" max="2.5" step="0.05"
                value="${(entry.gamma ?? 1.0).toFixed(2)}" style="--pct:${pct(entry.gamma ?? 1.0, 0.5, 2.5)}">
              <span class="lsv layer-gamma-val">${(entry.gamma ?? 1.0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Lift black point — faded/vintage film look (0=none, 0.5=heavy fade)">Fade</span>
              <input type="range" class="slider layer-fade-sl" min="0" max="0.5" step="0.01"
                value="${(entry.fade ?? 0).toFixed(2)}" style="--pct:${pct(entry.fade ?? 0, 0, 0.5)}">
              <span class="lsv layer-fade-val">${(entry.fade ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Color temperature — negative=cool/blue, positive=warm/orange">Temp</span>
              <input type="range" class="slider layer-colortemp-sl" min="-1" max="1" step="0.01"
                value="${(entry.colorTemp ?? 0).toFixed(2)}" style="--pct:${pct(entry.colorTemp ?? 0, -1, 1)}">
              <span class="lsv layer-colortemp-val">${(entry.colorTemp ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Sepia tone — 0=off, 1=full classic warm sepia">Sepia</span>
              <input type="range" class="slider layer-sepia-sl" min="0" max="1" step="0.01"
                value="${(entry.sepia ?? 0).toFixed(2)}" style="--pct:${pct(entry.sepia ?? 0, 0, 1)}">
              <span class="lsv layer-sepia-val">${(entry.sepia ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Soft blur — re-samples texture at offset UVs (0=off, 1=heavy)">Blur</span>
              <input type="range" class="slider layer-blur-sl" min="0" max="1" step="0.01"
                value="${(entry.blur ?? 0).toFixed(2)}" style="--pct:${pct(entry.blur ?? 0, 0, 1)}">
              <span class="lsv layer-blur-val">${(entry.blur ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Shadows — negative crushes darks, positive lifts them (luma-weighted)">Shadows</span>
              <input type="range" class="slider layer-shadows-sl" min="-1" max="1" step="0.01"
                value="${(entry.shadows ?? 0).toFixed(2)}" style="--pct:${pct(entry.shadows ?? 0, -1, 1)}">
              <span class="lsv layer-shadows-val">${(entry.shadows ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Highlights — negative pulls down brights, positive boosts them (luma-weighted)">Highlights</span>
              <input type="range" class="slider layer-highlights-sl" min="-1" max="1" step="0.01"
                value="${(entry.highlights ?? 0).toFixed(2)}" style="--pct:${pct(entry.highlights ?? 0, -1, 1)}">
              <span class="lsv layer-highlights-val">${(entry.highlights ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Lift — shadow bias: affects darks more than lights (−0.5 to +0.5)">Lift</span>
              <input type="range" class="slider layer-lift-sl" min="-0.5" max="0.5" step="0.01"
                value="${(entry.lift ?? 0).toFixed(2)}" style="--pct:${pct(entry.lift ?? 0, -0.5, 0.5)}">
              <span class="lsv layer-lift-val">${(entry.lift ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Gain — highlight boost: affects lights more than darks (−0.5 to +0.5)">Gain</span>
              <input type="range" class="slider layer-gain-sl" min="-0.5" max="0.5" step="0.01"
                value="${(entry.gain ?? 0).toFixed(2)}" style="--pct:${pct(entry.gain ?? 0, -0.5, 0.5)}">
              <span class="lsv layer-gain-val">${(entry.gain ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Tint — negative=magenta (+R +B), positive=green (+G), color balance axis">Tint M/G</span>
              <input type="range" class="slider layer-tintmg-sl" min="-1" max="1" step="0.01"
                value="${(entry.tintMG ?? 0).toFixed(2)}" style="--pct:${pct(entry.tintMG ?? 0, -1, 1)}">
              <span class="lsv layer-tintmg-val">${(entry.tintMG ?? 0).toFixed(2)}</span>
            </div>
            <div class="layer-section-divider"></div>
            ${entry.type === 'video' ? `
            <div class="layer-vid-border-group"${entry.tile ? ' style="display:none"' : ''}>
            <p class="layer-section-label">Border</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Width</span>
              <input type="range" class="slider layer-vid-border-w-sl" min="0" max="1" step="0.01"
                value="${Math.sqrt((entry.vidBorderWidth || 0) / 0.12).toFixed(3)}" style="--pct:${(Math.sqrt((entry.vidBorderWidth || 0) / 0.12) * 100).toFixed(1)}%">
              <span class="lsv layer-vid-border-w-val">${(entry.vidBorderWidth || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline" style="gap:8px;margin-bottom:6px">
              <span class="layer-ctrl-label">Color</span>
              <div class="layer-vid-border-color-wrap">
                <span class="layer-vid-border-swatch" style="background:${entry.vidBorderColor || '#ffffff'}"></span>
                <input type="color" class="layer-vid-border-picker" value="${entry.vidBorderColor || '#ffffff'}" tabindex="-1" />
              </div>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label">Feather</span>
              <input type="range" class="slider layer-vid-border-feather-sl" min="0" max="1" step="0.01"
                value="${(entry.vidBorderFeather || 0).toFixed(2)}" style="--pct:${((entry.vidBorderFeather || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-vid-border-feather-val">${(entry.vidBorderFeather || 0).toFixed(2)}</span>
            </div>
            <div class="layer-section-divider"></div>
            </div>
            ` : ''}
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
            <p class="layer-section-sub" style="margin-top:6px;margin-bottom:2px">Luma Key</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Luma Key Lo — pixels darker than this threshold become transparent. Use to cut out dark backgrounds.">Key Lo</span>
              <input type="range" class="slider layer-luma-lo-sl" min="0" max="1" step="0.01"
                value="${(entry.lumaKeyLo || 0).toFixed(2)}" style="--pct:${((entry.lumaKeyLo || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-luma-lo-val">${(entry.lumaKeyLo || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Luma Key Hi — pixels brighter than this threshold become transparent. Use to cut out bright/white backgrounds.">Key Hi</span>
              <input type="range" class="slider layer-luma-hi-sl" min="0" max="1" step="0.01"
                value="${(entry.lumaKeyHi || 0).toFixed(2)}" style="--pct:${((entry.lumaKeyHi || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-luma-hi-val">${(entry.lumaKeyHi || 0).toFixed(2)}</span>
            </div>
            <p class="layer-section-sub" style="margin-top:6px;margin-bottom:2px">Wave Distort</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Wave amplitude — how far pixels are displaced. Audio-reactive: bass hits make waves bigger.">Wave</span>
              <input type="range" class="slider layer-wave-amp-sl" min="0" max="1" step="0.01"
                value="${(entry.waveAmp || 0).toFixed(2)}" style="--pct:${((entry.waveAmp || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-wave-amp-val">${(entry.waveAmp || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row layer-wave-freq-row"${(entry.waveAmp || 0) <= 0 ? ' style="display:none"' : ''}>
              <span class="layer-ctrl-label" data-tooltip="Wave frequency — number of sine cycles across the image. Low = gentle sway, high = tight ripples.">Freq</span>
              <input type="range" class="slider layer-wave-freq-sl" min="0" max="1" step="0.01"
                value="${(((entry.waveFreq || 4) - 1) / 19).toFixed(3)}" style="--pct:${((((entry.waveFreq || 4) - 1) / 19) * 100).toFixed(1)}%">
              <span class="lsv layer-wave-freq-val">${(entry.waveFreq || 4).toFixed(1)}</span>
            </div>
            <p class="layer-section-sub" style="margin-top:6px;margin-bottom:2px">Color FX</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Invert — blend between normal and inverted colors. 0 = normal, 1 = fully negative image.">Invert</span>
              <input type="range" class="slider layer-invert-sl" min="0" max="1" step="0.01"
                value="${(entry.invertMix || 0).toFixed(2)}" style="--pct:${((entry.invertMix || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-invert-val">${(entry.invertMix || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Solarize — folds the tone curve so midtones blow bright while darks and highlights crush down. 0 = off, 1 = full solarize.">Solarize</span>
              <input type="range" class="slider layer-solarize-sl" min="0" max="1" step="0.01"
                value="${(entry.solarizeMix || 0).toFixed(2)}" style="--pct:${((entry.solarizeMix || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-solarize-val">${(entry.solarizeMix || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Threshold — converts image to binary B&W at this luminance cutoff. Audio-reactive: bass shifts the cutoff for pulsing silhouettes.">Thresh</span>
              <input type="range" class="slider layer-thresh-sl" min="0" max="1" step="0.01"
                value="${(entry.thresholdCutoff || 0).toFixed(2)}" style="--pct:${((entry.thresholdCutoff || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-thresh-val">${(entry.thresholdCutoff || 0).toFixed(2)}</span>
            </div>
            <p class="layer-section-sub" style="margin-top:6px;margin-bottom:2px">Texture</p>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Pixelate — reduces resolution into chunky blocks. Creates retro mosaic / 8-bit look.">Pixelate</span>
              <input type="range" class="slider layer-pixelate-sl" min="0" max="1" step="0.01"
                value="${(entry.pixelate || 0).toFixed(2)}" style="--pct:${((entry.pixelate || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-pixelate-val">${(entry.pixelate || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Scan Lines — horizontal CRT-style dark bands. Higher = more visible lines.">Scan</span>
              <input type="range" class="slider layer-scanlines-sl" min="0" max="1" step="0.01"
                value="${(entry.scanLines || 0).toFixed(2)}" style="--pct:${((entry.scanLines || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-scanlines-val">${(entry.scanLines || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Film Grain — animated noise overlay for a cinematic / analog film texture.">Grain</span>
              <input type="range" class="slider layer-grain-sl" min="0" max="1" step="0.01"
                value="${(entry.filmGrain || 0).toFixed(2)}" style="--pct:${((entry.filmGrain || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-grain-val">${(entry.filmGrain || 0).toFixed(2)}</span>
            </div>
            <div class="layer-section-divider"></div>
            <p class="layer-section-label">Overlay</p>
            <div class="layer-row-inline" style="margin-bottom:6px">
              <label class="toggle-switch toggle-switch--sm">
                <input type="checkbox" class="layer-vignette-cb" ${entry.vignette ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
              <span class="layer-ctrl-label" style="margin-left:6px">Enable</span>
            </div>
            <div class="layer-vignette-detail" style="${entry.vignette ? '' : 'display:none'}">
              <div class="layer-center-row">
                <span class="layer-ctrl-label" style="margin-bottom:5px">Center</span>
                <div class="xy-pad-wrap vignette-xy-wrap">
                  <canvas class="xy-pad vignette-xy-pad" width="96" height="96" data-tooltip="Drag to position overlay on screen"></canvas>
                  <button class="xy-reset vignette-xy-reset" data-tooltip="Reset to center">↺</button>
                </div>
              </div>
              <div class="layer-slider-row">
                <span class="layer-ctrl-label" data-tooltip="Width of overlay shape — 0 = narrow, 1 = full screen">Width</span>
                <input type="range" class="slider layer-vignette-w-sl" min="0" max="1" step="0.01"
                  value="${(entry.vignetteW ?? 0.5).toFixed(2)}" style="--pct:${((entry.vignetteW ?? 0.5) * 100).toFixed(1)}%">
                <span class="lsv layer-vignette-w-val">${(entry.vignetteW ?? 0.5).toFixed(2)}</span>
              </div>
              <div class="layer-slider-row">
                <span class="layer-ctrl-label" data-tooltip="Height of overlay shape — 0 = short, 1 = full screen">Height</span>
                <input type="range" class="slider layer-vignette-h-sl" min="0" max="1" step="0.01"
                  value="${(entry.vignetteH ?? 0.5).toFixed(2)}" style="--pct:${((entry.vignetteH ?? 0.5) * 100).toFixed(1)}%">
                <span class="lsv layer-vignette-h-val">${(entry.vignetteH ?? 0.5).toFixed(2)}</span>
              </div>
              <div class="layer-slider-row">
                <span class="layer-ctrl-label" data-tooltip="Corner roundness — 0 = sharp corners, 1 = fully rounded">Corner</span>
                <input type="range" class="slider layer-vignette-corner-sl" min="0" max="1" step="0.01"
                  value="${(entry.vignetteCorner ?? 0.3).toFixed(2)}" style="--pct:${((entry.vignetteCorner ?? 0.3) * 100).toFixed(1)}%">
                <span class="lsv layer-vignette-corner-val">${(entry.vignetteCorner ?? 0.3).toFixed(2)}</span>
              </div>
              <div class="layer-slider-row">
                <span class="layer-ctrl-label" data-tooltip="How opaque the overlay is — 0 = invisible, 1 = fully covers">Strength</span>
                <input type="range" class="slider layer-vignette-str-sl" min="0" max="1" step="0.01"
                  value="${(entry.vignetteStrength ?? 0.5).toFixed(2)}" style="--pct:${((entry.vignetteStrength ?? 0.5) * 100).toFixed(1)}%">
                <span class="lsv layer-vignette-str-val">${(entry.vignetteStrength ?? 0.5).toFixed(2)}</span>
              </div>
              <div class="layer-slider-row">
                <span class="layer-ctrl-label" data-tooltip="Edge softness — 0 = hard edge, 1 = very soft">Feather</span>
                <input type="range" class="slider layer-vignette-fea-sl" min="0" max="1" step="0.01"
                  value="${(entry.vignetteFeather ?? 0.3).toFixed(2)}" style="--pct:${((entry.vignetteFeather ?? 0.3) * 100).toFixed(1)}%">
                <span class="lsv layer-vignette-fea-val">${(entry.vignetteFeather ?? 0.3).toFixed(2)}</span>
              </div>
              <div class="layer-row-inline" style="gap:8px;margin-top:4px">
                <span class="layer-ctrl-label">Color</span>
                <div class="layer-vignette-color-wrap">
                  <span class="layer-vignette-swatch" style="background:${entry.vignetteColor || '#000000'}"></span>
                  <input type="color" class="layer-vignette-picker" value="${entry.vignetteColor || '#000000'}" tabindex="-1" />
                </div>
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
                <option value="flux">Flux</option>
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
              <span class="layer-ctrl-label" data-tooltip="Snap-rotate on each beat — short rotational kick toward the chosen direction">Tilt</span>
              <input type="range" class="slider layer-slider-inline layer-tilt-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.tiltAmp || 0).toFixed(3)}" style="--pct:${(Math.cbrt(entry.tiltAmp || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-tilt-val">${(entry.tiltAmp || 0).toFixed(2)}</span>
              <div class="layer-tilt-dir" role="group" aria-label="Tilt direction" style="margin-left:8px">
                <button class="lseg${(entry.tiltDir || 1) < 0 ? ' active' : ''}" data-tilt-dir="-1" tabindex="-1">←</button>
                <button class="lseg${(entry.tiltDir || 1) > 0 ? ' active' : ''}" data-tilt-dir="1" tabindex="-1">→</button>
              </div>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="Directional X-axis kick on each beat — the side-cousin of Bounce">Hop</span>
              <input type="range" class="slider layer-slider-inline layer-hop-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.hopAmp || 0).toFixed(3)}" style="--pct:${(Math.cbrt(entry.hopAmp || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-hop-val">${(entry.hopAmp || 0).toFixed(2)}</span>
              <div class="layer-hop-dir" role="group" aria-label="Hop direction" style="margin-left:8px">
                <button class="lseg${(entry.hopDir || 1) < 0 ? ' active' : ''}" data-hop-dir="-1" tabindex="-1">←</button>
                <button class="lseg${(entry.hopDir || 1) > 0 ? ' active' : ''}" data-hop-dir="1" tabindex="-1">→</button>
              </div>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Hue shift on every beat — rides on top of any Hue Spin you've set">Hue Pulse</span>
              <input type="range" class="slider layer-huepulse-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.huePulse || 0).toFixed(3)}" style="--pct:${(Math.cbrt(entry.huePulse || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-huepulse-val">${(entry.huePulse || 0).toFixed(2)}</span>
            </div>
            <div class="layer-slider-row">
              <span class="layer-ctrl-label" data-tooltip="Focus pull on every beat — adds blur on the hit and clears between">Blur Pulse</span>
              <input type="range" class="slider layer-blurpulse-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.blurPulse || 0).toFixed(3)}" style="--pct:${(Math.cbrt(entry.blurPulse || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-blurpulse-val">${(entry.blurPulse || 0).toFixed(2)}</span>
            </div>
            <div class="layer-row-inline">
              <span class="layer-ctrl-label" data-tooltip="Cartoon scale on every beat — stretches one axis and crushes the other">Squash</span>
              <input type="range" class="slider layer-slider-inline layer-squash-sl" min="0" max="1" step="0.01"
                value="${Math.cbrt(entry.squashAmp || 0).toFixed(3)}" style="--pct:${(Math.cbrt(entry.squashAmp || 0) * 100).toFixed(1)}%">
              <span class="lsv layer-squash-val">${(entry.squashAmp || 0).toFixed(2)}</span>
              <div class="layer-squash-axis" role="group" aria-label="Squash axis" style="margin-left:8px">
                <button class="lseg${(entry.squashAxis || 'wide') === 'wide' ? ' active' : ''}" data-squash-axis="wide" tabindex="-1">Wide</button>
                <button class="lseg${(entry.squashAxis || 'wide') === 'tall' ? ' active' : ''}" data-squash-axis="tall" tabindex="-1">Tall</button>
              </div>
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

        if (blendSel) blendSel.addEventListener('change', () => { entry.blendMode = blendSel.value; refresh(); });
        const tunnelRow = card.querySelector('.layer-tunnel-row');
        const spacingRow = card.querySelector('.layer-spacing-row');
        const groupSpinWrap = card.querySelector('.layer-group-spin-wrap');
        const mirrorScopeRow = card.querySelector('.layer-mirror-scope');
        const tileScaleRows = card.querySelectorAll('.layer-tile-scale-row');
        // Video tiling (Phase A): the video-only Width/Height rows + the Scale/Size
        // label that flips meaning when tile is on (Scale=coverage → Size=density).
        const vidScaleRows = card.querySelectorAll('.layer-vid-scale-row');
        const sizeLabel = card.querySelector('.layer-size-label');
        // Video border ring is single-instance only (frames the one video); hide it when tiling.
        const vidBorderGroup = card.querySelector('.layer-vid-border-group');
        // Phase 1: Per-Cell row visibility helper — referenced by tileCb and the
        // offset-axis segmented buttons. The Amount row is double-gated: tile=on
        // AND offset axis ≠ 'none'.
        const percellRows = card.querySelectorAll('.layer-percell-row');
        const offsetAmtRow = card.querySelector('.layer-offset-amt-row');
        const syncPerCellVisibility = () => {
            const tileOn = entry.tile;
            percellRows.forEach(r => {
                if (r === offsetAmtRow) return;
                r.style.display = tileOn ? '' : 'none';
            });
            if (offsetAmtRow) {
                offsetAmtRow.style.display = (tileOn && (entry.tileOffsetAxis || 'none') !== 'none') ? '' : 'none';
            }
        };

        // Phase 3: Grid-mode row visibility — Mode toggle (tile on), Cols/Rows/Fit
        // rows (grid mode only), Size slider (hidden in grid mode — count is explicit),
        // Width/Height (density mode only — Cols:Rows ratio is the grid's shape control).
        const tileModeRow = card.querySelector('.layer-tilemode-row');
        const gridDetailRows = card.querySelectorAll('.layer-grid-row');
        const sizeRow = card.querySelector('.layer-size-row');
        const aspectRow = card.querySelector('.layer-aspect-row');
        const syncGridVisibility = () => {
            const tileOn = entry.tile;
            const gridOn = tileOn && (entry.tileMode || 'density') === 'grid';
            if (tileModeRow) tileModeRow.style.display = tileOn ? '' : 'none';
            gridDetailRows.forEach(r => { r.style.display = gridOn ? '' : 'none'; });
            if (sizeRow) sizeRow.style.display = gridOn ? 'none' : '';
            tileScaleRows.forEach(r => { r.style.display = (tileOn && !gridOn) ? '' : 'none'; });
            // Video W/H is inert in grid mode (Cols:Rows is the shape control) — hide it there
            vidScaleRows.forEach(r => { r.style.display = gridOn ? 'none' : ''; });
            // Lock/Fluid aspect mode drives aspectPreScale, which grid mode skips — grid's
            // shape control is Fit/Fill, so the toggle is inert in grid. Hide it there.
            if (aspectRow) aspectRow.style.display = gridOn ? 'none' : '';
        };

        if (tileCb) tileCb.addEventListener('change', () => {
            entry.tile = tileCb.checked;
            if (tunnelRow) tunnelRow.style.display = entry.tile ? '' : 'none';
            if (spacingRow) spacingRow.style.display = entry.tile ? '' : 'none';
            if (groupSpinWrap) groupSpinWrap.style.display = entry.tile ? '' : 'none';
            if (mirrorScopeRow) mirrorScopeRow.style.display = (entry.mirror !== 'none') ? '' : 'none';
            // Video: the Scale slider becomes a density (Size) control when tiling
            if (sizeLabel && entry.type === 'video') sizeLabel.textContent = entry.tile ? 'Size' : 'Scale';
            if (vidBorderGroup) vidBorderGroup.style.display = entry.tile ? 'none' : '';
            syncGridVisibility();
            syncPerCellVisibility();
            if (entry.type === 'text') this.engine._loadTextTexture(entry.texName, entry);
            refresh();
        });
        if (pulseInvCb) pulseInvCb.addEventListener('change', () => { entry.pulseInvert = pulseInvCb.checked; refresh(); });
        if (groupSpinCb) groupSpinCb.addEventListener('change', () => { entry.groupSpin = groupSpinCb.checked; refresh(); });

        // ─── Phase 3: Grid mode ───────────────────────────────────────────────
        // Density/Grid segmented toggle
        card.querySelectorAll('.layer-tilemode-seg .lseg-tilemode').forEach(btn => {
            btn.addEventListener('click', () => {
                card.querySelectorAll('.layer-tilemode-seg .lseg-tilemode').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.tileMode = btn.dataset.tileMode;
                syncGridVisibility();
                refresh();
            });
        });
        // Fill/Fit segmented toggle
        card.querySelectorAll('.layer-tilefit-seg .lseg-tilefit').forEach(btn => {
            btn.addEventListener('click', () => {
                card.querySelectorAll('.layer-tilefit-seg .lseg-tilefit').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.tileFit = btn.dataset.tileFit;
                refresh();
            });
        });
        // Aspect mode (Lock/Fluid) segmented toggle — keep true shape vs adapt to canvas
        card.querySelectorAll('.layer-aspect-seg .lseg-aspect').forEach(btn => {
            btn.addEventListener('click', () => {
                card.querySelectorAll('.layer-aspect-seg .lseg-aspect').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.aspectMode = btn.dataset.aspectMode;
                refresh();
            });
        });
        // Cols / Rows integer steppers (clamped 1–16). stopPropagation so typing
        // in the field never bubbles to the card-header collapse toggle.
        const gridColsInput = card.querySelector('.layer-grid-cols');
        const gridRowsInput = card.querySelector('.layer-grid-rows');
        const bindGridStepper = (inputEl, key, max = 16) => {
            if (!inputEl) return;
            inputEl.addEventListener('click', (e) => e.stopPropagation());
            inputEl.addEventListener('keydown', (e) => e.stopPropagation());
            inputEl.addEventListener('change', () => {
                const v = Math.max(1, Math.min(max, Math.round(parseFloat(inputEl.value) || 1)));
                inputEl.value = v;
                entry[key] = v;
                refresh();
            });
        };
        bindGridStepper(gridColsInput, 'tileCols');
        bindGridStepper(gridRowsInput, 'tileRows');
        // Phase 4: Subdivide stepper (1–6) — each grid cell → S×S inner cells
        bindGridStepper(card.querySelector('.layer-grid-subdiv'), 'tileSubdivide', 6);
        // Grid Scale slider — scales the whole grid (1 = fills canvas, <1 = margin)
        const gridScaleSl = card.querySelector('.layer-gridscale-sl');
        const gridScaleVal = card.querySelector('.layer-gridscale-val');
        if (gridScaleSl && gridScaleVal) gridScaleSl.addEventListener('input', () => {
            const v = parseFloat(gridScaleSl.value);
            entry.tileGridScale = v;
            gridScaleVal.textContent = v.toFixed(2);
            gridScaleSl.style.setProperty('--pct', `${((v - 0.1) / 2.9 * 100).toFixed(1)}%`);
            refresh();
        });
        // Phase 4: Outer Gap slider — gap between outer cells (0–0.5)
        const outerGapSl = card.querySelector('.layer-outergap-sl');
        const outerGapVal = card.querySelector('.layer-outergap-val');
        if (outerGapSl && outerGapVal) outerGapSl.addEventListener('input', () => {
            const v = parseFloat(outerGapSl.value);
            entry.tileOuterGap = v;
            outerGapVal.textContent = v.toFixed(2);
            outerGapSl.style.setProperty('--pct', `${(v / 0.5 * 100).toFixed(1)}%`);
            refresh();
        });

        // ─── Phase 1: Per-Cell controls ───────────────────────────────────────
        // Offset axis segmented (Off / Row / Col)
        card.querySelectorAll('.layer-offset-axis-seg .lseg-offset').forEach(btn => {
            btn.addEventListener('click', () => {
                card.querySelectorAll('.layer-offset-axis-seg .lseg-offset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                entry.tileOffsetAxis = btn.dataset.offsetAxis;
                syncPerCellVisibility();
                refresh();
            });
        });
        const offsetAmtSl = card.querySelector('.layer-offset-amt-sl');
        const offsetAmtVal = card.querySelector('.layer-offset-amt-val');
        if (offsetAmtSl && offsetAmtVal) offsetAmtSl.addEventListener('input', () => {
            const v = parseFloat(offsetAmtSl.value);
            entry.tileOffsetAmount = v;
            offsetAmtVal.textContent = v.toFixed(2);
            offsetAmtSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const rotVarSl = card.querySelector('.layer-rotvar-sl');
        const rotVarVal = card.querySelector('.layer-rotvar-val');
        if (rotVarSl && rotVarVal) rotVarSl.addEventListener('input', () => {
            const v = parseFloat(rotVarSl.value);
            entry.tileRotateVariance = v;
            rotVarVal.textContent = v.toFixed(2);
            rotVarSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const rotSnapCb = card.querySelector('.layer-rotsnap');
        if (rotSnapCb) rotSnapCb.addEventListener('change', () => {
            entry.tileRotateSnap = rotSnapCb.checked;
            refresh();
        });
        const popcornSl = card.querySelector('.layer-popcorn-sl');
        const popcornVal = card.querySelector('.layer-popcorn-val');
        if (popcornSl && popcornVal) popcornSl.addEventListener('input', () => {
            const v = parseFloat(popcornSl.value);
            entry.tilePopcornAmount = v;
            popcornVal.textContent = v.toFixed(2);
            popcornSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        // ─── Phase 2: Variance suite controls ────────────────────────────────
        const sizeVarSl = card.querySelector('.layer-sizevar-sl');
        const sizeVarVal = card.querySelector('.layer-sizevar-val');
        if (sizeVarSl && sizeVarVal) sizeVarSl.addEventListener('input', () => {
            const v = parseFloat(sizeVarSl.value);
            entry.tileSizeVariance = v;
            sizeVarVal.textContent = v.toFixed(2);
            sizeVarSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const jitterXSl = card.querySelector('.layer-jitterx-sl');
        const jitterXVal = card.querySelector('.layer-jitterx-val');
        if (jitterXSl && jitterXVal) jitterXSl.addEventListener('input', () => {
            const v = parseFloat(jitterXSl.value);
            entry.tileJitterX = v;
            jitterXVal.textContent = v.toFixed(2);
            jitterXSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const jitterYSl = card.querySelector('.layer-jittery-sl');
        const jitterYVal = card.querySelector('.layer-jittery-val');
        if (jitterYSl && jitterYVal) jitterYSl.addEventListener('input', () => {
            const v = parseFloat(jitterYSl.value);
            entry.tileJitterY = v;
            jitterYVal.textContent = v.toFixed(2);
            jitterYSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const opacityVarSl = card.querySelector('.layer-opacityvar-sl');
        const opacityVarVal = card.querySelector('.layer-opacityvar-val');
        if (opacityVarSl && opacityVarVal) opacityVarSl.addEventListener('input', () => {
            const v = parseFloat(opacityVarSl.value);
            entry.tileOpacityVariance = v;
            opacityVarVal.textContent = v.toFixed(2);
            opacityVarSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const depthVarSl = card.querySelector('.layer-depthvar-sl');
        const depthVarVal = card.querySelector('.layer-depthvar-val');
        if (depthVarSl && depthVarVal) depthVarSl.addEventListener('input', () => {
            const v = parseFloat(depthVarSl.value);
            entry.tileDepthVariance = v;
            depthVarVal.textContent = v.toFixed(2);
            depthVarSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const seedDisplay = card.querySelector('.layer-seed-display');
        const seedRandBtn = card.querySelector('.layer-seed-rand');
        const seedLockCb = card.querySelector('.layer-seed-lock');
        if (seedRandBtn) seedRandBtn.addEventListener('click', () => {
            entry.tileVarianceSeed = Math.floor(Math.random() * 10000);
            if (seedDisplay) seedDisplay.textContent = entry.tileVarianceSeed;
            refresh();
        });
        if (seedLockCb) seedLockCb.addEventListener('change', () => {
            entry.tileVarianceSeedLocked = seedLockCb.checked;
        });

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
        if (pulseSlider && pulseVal) pulseSlider.addEventListener('input', () => {
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

        // Beat-reactive effects (animation-dev.md B1'). All ride the existing
        // `_r` envelope (Source × Curve, same as Bounce/Shake/etc.). Stored amp
        // is normalised 0–1; the comp shader applies the per-effect scale.
        const wireBeatSlider = (slClass, valClass, key) => {
            const sl = card.querySelector(`.${slClass}`);
            const val = card.querySelector(`.${valClass}`);
            if (!sl || !val) return;
            sl.addEventListener('input', () => {
                const pos = parseFloat(sl.value);
                const stored = pos * pos * pos;
                entry[key] = stored;
                val.textContent = stored.toFixed(2);
                sl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
                refresh();
            });
        };
        wireBeatSlider('layer-tilt-sl',      'layer-tilt-val',      'tiltAmp');
        wireBeatSlider('layer-hop-sl',       'layer-hop-val',       'hopAmp');
        wireBeatSlider('layer-huepulse-sl',  'layer-huepulse-val',  'huePulse');
        wireBeatSlider('layer-blurpulse-sl', 'layer-blurpulse-val', 'blurPulse');
        wireBeatSlider('layer-squash-sl',    'layer-squash-val',    'squashAmp');

        const wireChipPair = (groupClass, dataAttr, key, parseFn) => {
            const group = card.querySelector(`.${groupClass}`);
            if (!group) return;
            group.querySelectorAll('button.lseg').forEach(btn => {
                btn.addEventListener('click', () => {
                    const v = parseFn(btn.dataset[dataAttr]);
                    entry[key] = v;
                    group.querySelectorAll('button.lseg').forEach(b => b.classList.toggle(
                        'active',
                        parseFn(b.dataset[dataAttr]) === v
                    ));
                    refresh();
                });
            });
        };
        wireChipPair('layer-tilt-dir',    'tiltDir',    'tiltDir',    v => parseInt(v, 10));
        wireChipPair('layer-hop-dir',     'hopDir',     'hopDir',     v => parseInt(v, 10));
        wireChipPair('layer-squash-axis', 'squashAxis', 'squashAxis', v => v);

        // Size/Scale slider — squared curve so value 1.0 lands near ~82% of travel
        // Videos use 'scale' (0.1-2.0), images use 'size' (0.05-1.5)
        const sizeSlider = card.querySelector('.layer-size-sl');
        const sizeVal = card.querySelector('.layer-size-val');
        if (sizeSlider && sizeVal) sizeSlider.addEventListener('input', () => {
            const pos = parseFloat(sizeSlider.value);
            const isVideo = entry.type === 'video';
            // Video: pos² maps [0,1] → [0.1, 2.0] (0.1 + 1.9*pos²)
            // Image: pos² maps [0,1] → [0.05, 1.5] (0.05 + 1.45*pos²)
            const stored = isVideo ? 0.1 + 1.9 * pos * pos : 0.05 + 1.45 * pos * pos;
            if (isVideo) entry.scale = stored;
            else entry.size = stored;
            sizeVal.textContent = stored.toFixed(2);
            sizeSlider.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Tile scale X/Y sliders — squared curve: pos² maps [0,1] → [0.25,4.0]
        const tileSxSl = card.querySelector('.layer-tile-sx-sl');
        const tileSxVal = card.querySelector('.layer-tile-sx-val');
        if (tileSxSl && tileSxVal) tileSxSl.addEventListener('input', () => {
            const pos = parseFloat(tileSxSl.value);
            const stored = 0.25 + 3.75 * pos * pos;
            entry.tileScaleX = stored;
            tileSxVal.textContent = stored.toFixed(2);
            tileSxSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });
        const tileSySl = card.querySelector('.layer-tile-sy-sl');
        const tileSyVal = card.querySelector('.layer-tile-sy-val');
        if (tileSySl && tileSyVal) tileSySl.addEventListener('input', () => {
            const pos = parseFloat(tileSySl.value);
            const stored = 0.25 + 3.75 * pos * pos;
            entry.tileScaleY = stored;
            tileSyVal.textContent = stored.toFixed(2);
            tileSySl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Video border — width, color, feather
        const vidBorderWSl = card.querySelector('.layer-vid-border-w-sl');
        const vidBorderWVal = card.querySelector('.layer-vid-border-w-val');
        if (vidBorderWSl && vidBorderWVal) vidBorderWSl.addEventListener('input', () => {
            const pos = parseFloat(vidBorderWSl.value);
            const stored = 0.12 * pos * pos;
            entry.vidBorderWidth = stored;
            vidBorderWVal.textContent = stored.toFixed(2);
            vidBorderWSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });
        const vidBorderSwatch = card.querySelector('.layer-vid-border-swatch');
        const vidBorderPicker = card.querySelector('.layer-vid-border-picker');
        if (vidBorderSwatch && vidBorderPicker) {
            vidBorderSwatch.addEventListener('click', () => vidBorderPicker.click());
            vidBorderPicker.addEventListener('input', () => {
                entry.vidBorderColor = vidBorderPicker.value;
                vidBorderSwatch.style.background = vidBorderPicker.value;
                refresh();
            });
        }
        const vidBorderFeatherSl = card.querySelector('.layer-vid-border-feather-sl');
        const vidBorderFeatherVal = card.querySelector('.layer-vid-border-feather-val');
        if (vidBorderFeatherSl && vidBorderFeatherVal) vidBorderFeatherSl.addEventListener('input', () => {
            const v = parseFloat(vidBorderFeatherSl.value);
            entry.vidBorderFeather = v;
            vidBorderFeatherVal.textContent = v.toFixed(2);
            vidBorderFeatherSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        // Video width/height sliders — independent aspect ratio control (same math as tile sliders)
        const vidSxSl = card.querySelector('.layer-vid-sx-sl');
        const vidSxVal = card.querySelector('.layer-vid-sx-val');
        if (vidSxSl && vidSxVal) vidSxSl.addEventListener('input', () => {
            const pos = parseFloat(vidSxSl.value);
            const stored = 0.25 + 3.75 * pos * pos;
            entry.tileScaleX = stored;
            vidSxVal.textContent = stored.toFixed(2);
            vidSxSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });
        const vidSySl = card.querySelector('.layer-vid-sy-sl');
        const vidSyVal = card.querySelector('.layer-vid-sy-val');
        if (vidSySl && vidSyVal) vidSySl.addEventListener('input', () => {
            const pos = parseFloat(vidSySl.value);
            const stored = 0.25 + 3.75 * pos * pos;
            entry.tileScaleY = stored;
            vidSyVal.textContent = stored.toFixed(2);
            vidSySl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
            refresh();
        });

        // Remaining slider rows — DOM order must match sliderKeys exactly:
        // opacity, spacing, orbitRadius, tunnelSpeed,
        // swayAmt, swaySpeed, wanderAmt, wanderSpeed, hueSpinSpeed

        const sliderKeys = ['opacity', 'spacing', 'orbitRadius', 'tunnelSpeed', 'depthOffset',
            'swayAmt', 'swaySpeed', 'wanderAmt', 'wanderSpeed', 'hueSpinSpeed'];
        const sliderMins = [0, 0, 0, -2, 0, 0, 0, 0, 0, 0];
        const sliderMaxes = [1, 0.8, 0.45, 2, 1, 0.4, 4, 0.4, 2, 2];
        const sliderExclude = [
            'layer-bounce-sl','layer-size-sl','layer-liss-sl','layer-strobe-thr-sl',
            'layer-pan-x-sl','layer-pan-y-sl','layer-pan-range-sl','layer-beat-fade-sl',
            'layer-tile-sx-sl','layer-tile-sy-sl','layer-vid-sx-sl','layer-vid-sy-sl',
            'layer-vid-border-w-sl','layer-vid-border-feather-sl','layer-shake-sl',
            'layer-persp-x-sl','layer-persp-y-sl','layer-radius-sl',
            'layer-gif-speed-sl','layer-gif-stability-sl','layer-video-speed-sl','layer-video-scrub-sl',
            'layer-font-size-sl','layer-letter-spacing-sl','layer-line-height-sl',
            'layer-shadow-blur-sl','layer-shadow-x-sl','layer-shadow-y-sl',
            'layer-outline-width-sl','layer-kaleido-speed-sl',
            'layer-brightness-sl','layer-contrast-sl','layer-gamma-sl',
            'layer-fade-sl','layer-colortemp-sl','layer-sepia-sl','layer-blur-sl',
            'layer-shadows-sl','layer-highlights-sl','layer-lift-sl','layer-gain-sl','layer-tintmg-sl',
            // Phase 1: Per-Cell sliders — own dedicated handlers below
            'layer-offset-amt-sl','layer-rotvar-sl','layer-popcorn-sl',
            // Phase 2: Variance suite — own dedicated handlers below
            'layer-sizevar-sl','layer-jitterx-sl','layer-jittery-sl',
            'layer-opacityvar-sl','layer-depthvar-sl',
            // Phase 3: Grid mode — own dedicated handler below
            'layer-gridscale-sl',
            // Phase 4: Recursive grids — own dedicated handler below
            'layer-outergap-sl',
            // Color FX — own dedicated handler below
            'layer-solarize-sl',
            // Beat-reactive (animation-dev.md B1') — own dedicated handlers below.
            // Tilt/Hop/Squash sliders live in .layer-row-inline (not swept), but the
            // class is listed here too for defence-in-depth if the row class ever changes.
            'layer-tilt-sl','layer-hop-sl','layer-huepulse-sl','layer-blurpulse-sl','layer-squash-sl',
        ].map(c => `:not(.${c})`).join('');
        card.querySelectorAll(`.layer-slider-row input[type=range]${sliderExclude}`).forEach((sl, i) => {
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
        const kaleidoSpeedRow = card.querySelector('.layer-kaleido-speed-row');
        const mirrorLabels = { none: 'Off', h: 'H', v: 'V', quad: 'Quad', kaleido: 'Kaleido' };
        const scopeLabels = { tile: 'Per Tile', field: 'Whole Image' };
        const updateStatus = () => {
            if (!mirrorStatus) return;
            const m = mirrorLabels[entry.mirror] || 'Off';
            if (entry.mirror === 'none') mirrorStatus.textContent = 'Off';
            else mirrorStatus.textContent = `${m} · ${scopeLabels[entry.mirrorScope || 'tile']}`;
            if (scopeRow) scopeRow.style.display = entry.mirror === 'none' ? 'none' : '';
            if (kaleidoSpeedRow) kaleidoSpeedRow.style.display = entry.mirror === 'kaleido' ? '' : 'none';
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

        // Kaleido speed slider (shown only when mirror === 'kaleido')
        const kaleidoSpeedSl = card.querySelector('.layer-kaleido-speed-sl');
        const kaleidoSpeedVal = card.querySelector('.layer-kaleido-speed-val');
        if (kaleidoSpeedSl) {
            kaleidoSpeedSl.addEventListener('input', () => {
                const pos = parseFloat(kaleidoSpeedSl.value);
                const abs = Math.abs(pos);
                const v = Math.sign(pos) * abs * abs * abs * 2.0;
                entry.kaleidoSpeed = v;
                kaleidoSpeedVal.textContent = v.toFixed(2);
                const pct = (pos + 1) / 2 * 100;
                kaleidoSpeedSl.style.setProperty('--pct-lo', `${pos >= 0 ? 50 : pct.toFixed(1)}%`);
                kaleidoSpeedSl.style.setProperty('--pct-hi', `${pos >= 0 ? pct.toFixed(1) : 50}%`);
                refresh();
            });
        }
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
                    // Keep the cached texObj in sync so any future re-decode
                    // (_applyToEngine after the gif is removed/re-added) honors
                    // the current speed instead of reverting to the mount-time value.
                    if (this._imageTextures[entry.texName]) this._imageTextures[entry.texName].gifSpeed = v;
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
                    // Mirror the gifSpeed sync: keep the cached texObj current so a
                    // later re-decode restores this stability instead of 0.
                    if (this._imageTextures[entry.texName]) this._imageTextures[entry.texName].gifStability = v;
                    gifStabilityVal.textContent = v.toFixed(2);
                    gifStabilitySl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
                    this.engine.setGifAnimationStability(entry.texName, v);
                });
            }
        }

        // Video playback controls (only present for video layers)
        if (entry.type === 'video') {
            const videoPlayBtn = card.querySelector('.layer-video-play-btn');
            const videoLoopCb = card.querySelector('.layer-video-loop');
            const videoSpeedSl = card.querySelector('.layer-video-speed-sl');
            const videoSpeedVal = card.querySelector('.layer-video-speed-val');
            const videoScrubSl = card.querySelector('.layer-video-scrub-sl');
            const videoTimeVal = card.querySelector('.layer-video-time-val');

            if (videoPlayBtn) {
                videoPlayBtn.addEventListener('click', () => {
                    entry.isPlaying = !entry.isPlaying;
                    videoPlayBtn.textContent = entry.isPlaying ? '⏸ Pause' : '▶ Play';
                    // Notify engine to play/pause video
                    const anim = this.engine._videoAnimations?.get(entry.texName);
                    if (anim?.videoElement) {
                        if (entry.isPlaying) anim.videoElement.play();
                        else anim.videoElement.pause();
                    }
                });
            }

            if (videoLoopCb) {
                videoLoopCb.addEventListener('change', () => {
                    entry.loop = videoLoopCb.checked;
                    const anim = this.engine._videoAnimations?.get(entry.texName);
                    if (anim?.videoElement) anim.videoElement.loop = entry.loop;
                });
            }

            if (videoSpeedSl && videoSpeedVal) {
                videoSpeedSl.addEventListener('input', () => {
                    const v = parseFloat(videoSpeedSl.value);
                    entry.speed = v;
                    videoSpeedVal.textContent = v.toFixed(2) + '×';
                    videoSpeedSl.style.setProperty('--pct', `${((v - 0.25) / 3.75 * 100).toFixed(1)}%`);
                    const anim = this.engine._videoAnimations?.get(entry.texName);
                    if (anim?.videoElement) anim.videoElement.playbackRate = v;
                });
            }

            if (videoScrubSl && videoTimeVal) {
                videoScrubSl.addEventListener('input', () => {
                    const pos = parseFloat(videoScrubSl.value);
                    const anim = this.engine._videoAnimations?.get(entry.texName);
                    if (anim?.videoElement) {
                        const t = pos * anim.videoElement.duration;
                        anim.videoElement.currentTime = t;
                        entry.currentTime = t;
                    }
                    videoTimeVal.textContent = formatTime(entry.currentTime) + ' / ' + formatTime(entry.duration);
                    videoScrubSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
                });
            }
        }

        // Text layer controls (only present for type:'text' layers)
        if (entry.type === 'text') {
            // Direct GL upload — bypasses loadExtraImages name-collision cache
            const reRender = () => {
                this.engine._loadTextTexture(entry.texName, entry);
                // Update thumbnail
                const thumbCanvas = card.querySelector('.layer-thumb');
                if (thumbCanvas) {
                    const rendered = this.engine._renderTextTexture(entry);
                    const thumbImg = new Image();
                    thumbImg.onload = () => {
                        const ctx = thumbCanvas.getContext('2d');
                        ctx.clearRect(0, 0, thumbCanvas.width, thumbCanvas.height);
                        ctx.fillStyle = '#0a0a0a';
                        ctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
                        const srcAR = rendered.canvas.width / rendered.canvas.height;
                        const dstAR = thumbCanvas.width / thumbCanvas.height;
                        let dw, dh, dx, dy;
                        if (srcAR > dstAR) { dw = thumbCanvas.width; dh = dw / srcAR; dx = 0; dy = (thumbCanvas.height - dh) / 2; }
                        else { dh = thumbCanvas.height; dw = dh * srcAR; dy = 0; dx = (thumbCanvas.width - dw) / 2; }
                        ctx.drawImage(thumbImg, dx, dy, dw, dh);
                    };
                    thumbImg.src = rendered.dataURL;
                }
            };

            const textInput = card.querySelector('.layer-text-input');
            if (textInput) {
                let _textDebounce;
                textInput.addEventListener('input', () => {
                    clearTimeout(_textDebounce);
                    _textDebounce = setTimeout(() => {
                        entry.text = textInput.value;
                        reRender();
                    }, 150);
                });
            }

            const fontFamilySel = card.querySelector('.layer-font-family');
            if (fontFamilySel) {
                fontFamilySel.addEventListener('change', () => {
                    entry.fontFamily = fontFamilySel.value;
                    reRender();
                });
            }

            const fontWeightSel = card.querySelector('.layer-font-weight');
            if (fontWeightSel) {
                fontWeightSel.addEventListener('change', () => {
                    entry.fontWeight = fontWeightSel.value;
                    reRender();
                });
            }

            const fontSizeSl = card.querySelector('.layer-font-size-sl');
            const fontSizeVal = card.querySelector('.layer-font-size-val');
            if (fontSizeSl && fontSizeVal) {
                fontSizeSl.addEventListener('input', () => {
                    const v = parseInt(fontSizeSl.value, 10);
                    entry.fontSize = v;
                    fontSizeVal.textContent = `${v}px`;
                    fontSizeSl.style.setProperty('--pct', `${pct(v, 24, 200)}`);
                    reRender();
                });
            }

            const letterSl = card.querySelector('.layer-letter-spacing-sl');
            const letterVal = card.querySelector('.layer-letter-spacing-val');
            if (letterSl && letterVal) {
                letterSl.addEventListener('input', () => {
                    const v = parseInt(letterSl.value, 10);
                    entry.letterSpacing = v;
                    letterVal.textContent = `${v}px`;
                    letterSl.style.setProperty('--pct', `${pct(v, -10, 30)}`);
                    reRender();
                });
            }

            const lineHSl = card.querySelector('.layer-line-height-sl');
            const lineHVal = card.querySelector('.layer-line-height-val');
            if (lineHSl && lineHVal) {
                lineHSl.addEventListener('input', () => {
                    const v = parseFloat(lineHSl.value);
                    entry.lineHeight = v;
                    lineHVal.textContent = v.toFixed(1);
                    lineHSl.style.setProperty('--pct', `${pct(v, 1.0, 3.0)}`);
                    reRender();
                });
            }

            const alignBtns = card.querySelectorAll('.layer-text-align-seg .lseg');
            alignBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    alignBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    entry.textAlign = btn.dataset.textAlign;
                    reRender();
                });
            });

            const colorPicker = card.querySelector('.layer-text-color-picker');
            const colorSwatch = card.querySelector('.layer-text-color-swatch');
            if (colorPicker) {
                colorPicker.addEventListener('input', () => {
                    entry.color = colorPicker.value;
                    colorSwatch.style.background = colorPicker.value;
                    reRender();
                });
            }

            // Shadow
            const shadowCb = card.querySelector('.layer-text-shadow-cb');
            const shadowDetail = card.querySelector('.layer-text-shadow-detail');
            if (shadowCb) {
                shadowCb.addEventListener('change', () => {
                    if (!entry.textShadow) entry.textShadow = { blur: 8, offsetX: 3, offsetY: 3, color: '#000000' };
                    entry.textShadow.enabled = shadowCb.checked;
                    if (shadowDetail) shadowDetail.style.display = shadowCb.checked ? '' : 'none';
                    reRender();
                });
            }
            const shadowBlurSl = card.querySelector('.layer-shadow-blur-sl');
            const shadowBlurVal = card.querySelector('.layer-shadow-blur-val');
            if (shadowBlurSl) {
                shadowBlurSl.addEventListener('input', () => {
                    const v = parseInt(shadowBlurSl.value, 10);
                    if (!entry.textShadow) entry.textShadow = { blur: 8, offsetX: 3, offsetY: 3, color: '#000000' };
                    entry.textShadow.blur = v;
                    if (shadowBlurVal) shadowBlurVal.textContent = v;
                    shadowBlurSl.style.setProperty('--pct', `${pct(v, 0, 40)}`);
                    reRender();
                });
            }
            const shadowXSl = card.querySelector('.layer-shadow-x-sl');
            if (shadowXSl) {
                shadowXSl.addEventListener('input', () => {
                    if (!entry.textShadow) entry.textShadow = { blur: 8, offsetX: 3, offsetY: 3, color: '#000000' };
                    entry.textShadow.offsetX = parseInt(shadowXSl.value, 10);
                    shadowXSl.style.setProperty('--pct', `${pct(entry.textShadow.offsetX, -20, 20)}`);
                    reRender();
                });
            }
            const shadowYSl = card.querySelector('.layer-shadow-y-sl');
            if (shadowYSl) {
                shadowYSl.addEventListener('input', () => {
                    if (!entry.textShadow) entry.textShadow = { blur: 8, offsetX: 3, offsetY: 3, color: '#000000' };
                    entry.textShadow.offsetY = parseInt(shadowYSl.value, 10);
                    shadowYSl.style.setProperty('--pct', `${pct(entry.textShadow.offsetY, -20, 20)}`);
                    reRender();
                });
            }
            const shadowColorSwatch = card.querySelector('.layer-shadow-color-swatch');
            const shadowColorPicker = card.querySelector('.layer-shadow-color-picker');
            if (shadowColorPicker) {
                shadowColorPicker.addEventListener('input', () => {
                    if (!entry.textShadow) entry.textShadow = { blur: 8, offsetX: 3, offsetY: 3, color: '#000000' };
                    entry.textShadow.color = shadowColorPicker.value;
                    shadowColorSwatch.style.background = shadowColorPicker.value;
                    reRender();
                });
            }

            // Outline
            const outlineCb = card.querySelector('.layer-text-outline-cb');
            const outlineDetail = card.querySelector('.layer-text-outline-detail');
            if (outlineCb) {
                outlineCb.addEventListener('change', () => {
                    if (!entry.textOutline) entry.textOutline = { color: '#000000', width: 3 };
                    entry.textOutline.enabled = outlineCb.checked;
                    if (outlineDetail) outlineDetail.style.display = outlineCb.checked ? '' : 'none';
                    reRender();
                });
            }
            const outlineWidthSl = card.querySelector('.layer-outline-width-sl');
            const outlineWidthVal = card.querySelector('.layer-outline-width-val');
            if (outlineWidthSl) {
                outlineWidthSl.addEventListener('input', () => {
                    const v = parseInt(outlineWidthSl.value, 10);
                    if (!entry.textOutline) entry.textOutline = { color: '#000000', width: 3 };
                    entry.textOutline.width = v;
                    if (outlineWidthVal) outlineWidthVal.textContent = `${v}px`;
                    outlineWidthSl.style.setProperty('--pct', `${pct(v, 1, 16)}`);
                    reRender();
                });
            }
            const outlineColorSwatch = card.querySelector('.layer-outline-color-swatch');
            const outlineColorPicker = card.querySelector('.layer-outline-color-picker');
            if (outlineColorPicker) {
                outlineColorPicker.addEventListener('input', () => {
                    if (!entry.textOutline) entry.textOutline = { color: '#000000', width: 3 };
                    entry.textOutline.color = outlineColorPicker.value;
                    outlineColorSwatch.style.background = outlineColorPicker.value;
                    reRender();
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

        // Per-layer Brightness slider
        const brightSl = card.querySelector('.layer-brightness-sl');
        const brightVal = card.querySelector('.layer-brightness-val');
        if (brightSl) {
            brightSl.addEventListener('input', () => {
                entry.brightness = parseFloat(brightSl.value);
                brightVal.textContent = entry.brightness.toFixed(2);
                brightSl.style.setProperty('--pct', `${(entry.brightness / 2 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Contrast slider
        const contrastSl = card.querySelector('.layer-contrast-sl');
        const contrastVal = card.querySelector('.layer-contrast-val');
        if (contrastSl) {
            contrastSl.addEventListener('input', () => {
                entry.contrast = parseFloat(contrastSl.value);
                contrastVal.textContent = entry.contrast.toFixed(2);
                contrastSl.style.setProperty('--pct', `${(entry.contrast / 2 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Gamma slider
        const gammaSl = card.querySelector('.layer-gamma-sl');
        const gammaVal = card.querySelector('.layer-gamma-val');
        if (gammaSl) {
            gammaSl.addEventListener('input', () => {
                entry.gamma = parseFloat(gammaSl.value);
                gammaVal.textContent = entry.gamma.toFixed(2);
                gammaSl.style.setProperty('--pct', `${((entry.gamma - 0.5) / 2.0 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Fade slider
        const fadeSl = card.querySelector('.layer-fade-sl');
        const fadeVal = card.querySelector('.layer-fade-val');
        if (fadeSl) {
            fadeSl.addEventListener('input', () => {
                entry.fade = parseFloat(fadeSl.value);
                fadeVal.textContent = entry.fade.toFixed(2);
                fadeSl.style.setProperty('--pct', `${(entry.fade / 0.5 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Color Temperature slider
        const colorTempSl = card.querySelector('.layer-colortemp-sl');
        const colorTempVal = card.querySelector('.layer-colortemp-val');
        if (colorTempSl) {
            colorTempSl.addEventListener('input', () => {
                entry.colorTemp = parseFloat(colorTempSl.value);
                colorTempVal.textContent = entry.colorTemp.toFixed(2);
                colorTempSl.style.setProperty('--pct', `${((entry.colorTemp + 1) / 2 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Sepia slider
        const sepiaSl = card.querySelector('.layer-sepia-sl');
        const sepiaVal = card.querySelector('.layer-sepia-val');
        if (sepiaSl) {
            sepiaSl.addEventListener('input', () => {
                entry.sepia = parseFloat(sepiaSl.value);
                sepiaVal.textContent = entry.sepia.toFixed(2);
                sepiaSl.style.setProperty('--pct', `${(entry.sepia * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Blur slider
        const blurSl = card.querySelector('.layer-blur-sl');
        const blurVal = card.querySelector('.layer-blur-val');
        if (blurSl) {
            blurSl.addEventListener('input', () => {
                entry.blur = parseFloat(blurSl.value);
                blurVal.textContent = entry.blur.toFixed(2);
                blurSl.style.setProperty('--pct', `${(entry.blur * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Shadows slider
        const shadowsSl = card.querySelector('.layer-shadows-sl');
        const shadowsVal = card.querySelector('.layer-shadows-val');
        if (shadowsSl) {
            shadowsSl.addEventListener('input', () => {
                entry.shadows = parseFloat(shadowsSl.value);
                shadowsVal.textContent = entry.shadows.toFixed(2);
                shadowsSl.style.setProperty('--pct', `${((entry.shadows + 1) / 2 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Highlights slider
        const highlightsSl = card.querySelector('.layer-highlights-sl');
        const highlightsVal = card.querySelector('.layer-highlights-val');
        if (highlightsSl) {
            highlightsSl.addEventListener('input', () => {
                entry.highlights = parseFloat(highlightsSl.value);
                highlightsVal.textContent = entry.highlights.toFixed(2);
                highlightsSl.style.setProperty('--pct', `${((entry.highlights + 1) / 2 * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Lift slider
        const liftSl = card.querySelector('.layer-lift-sl');
        const liftVal = card.querySelector('.layer-lift-val');
        if (liftSl) {
            liftSl.addEventListener('input', () => {
                entry.lift = parseFloat(liftSl.value);
                liftVal.textContent = entry.lift.toFixed(2);
                liftSl.style.setProperty('--pct', `${((entry.lift + 0.5) * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Gain slider
        const gainSl = card.querySelector('.layer-gain-sl');
        const gainVal = card.querySelector('.layer-gain-val');
        if (gainSl) {
            gainSl.addEventListener('input', () => {
                entry.gain = parseFloat(gainSl.value);
                gainVal.textContent = entry.gain.toFixed(2);
                gainSl.style.setProperty('--pct', `${((entry.gain + 0.5) * 100).toFixed(1)}%`);
                refresh();
            });
        }

        // Per-layer Tint M/G slider
        const tintMGSl = card.querySelector('.layer-tintmg-sl');
        const tintMGVal = card.querySelector('.layer-tintmg-val');
        if (tintMGSl) {
            tintMGSl.addEventListener('input', () => {
                entry.tintMG = parseFloat(tintMGSl.value);
                tintMGVal.textContent = entry.tintMG.toFixed(2);
                tintMGSl.style.setProperty('--pct', `${((entry.tintMG + 1) / 2 * 100).toFixed(1)}%`);
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

        // Luma Key Lo/Hi sliders
        const lumaLoSl = card.querySelector('.layer-luma-lo-sl');
        const lumaLoVal = card.querySelector('.layer-luma-lo-val');
        if (lumaLoSl) lumaLoSl.addEventListener('input', () => {
            const v = parseFloat(lumaLoSl.value);
            entry.lumaKeyLo = v;
            lumaLoVal.textContent = v.toFixed(2);
            lumaLoSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const lumaHiSl = card.querySelector('.layer-luma-hi-sl');
        const lumaHiVal = card.querySelector('.layer-luma-hi-val');
        if (lumaHiSl) lumaHiSl.addEventListener('input', () => {
            const v = parseFloat(lumaHiSl.value);
            entry.lumaKeyHi = v;
            lumaHiVal.textContent = v.toFixed(2);
            lumaHiSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        // Wave Distort sliders
        const waveAmpSl = card.querySelector('.layer-wave-amp-sl');
        const waveAmpVal = card.querySelector('.layer-wave-amp-val');
        const waveFreqRow = card.querySelector('.layer-wave-freq-row');
        const waveFreqSl = card.querySelector('.layer-wave-freq-sl');
        const waveFreqVal = card.querySelector('.layer-wave-freq-val');
        if (waveAmpSl) waveAmpSl.addEventListener('input', () => {
            const v = parseFloat(waveAmpSl.value);
            entry.waveAmp = v;
            waveAmpVal.textContent = v.toFixed(2);
            waveAmpSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            if (waveFreqRow) waveFreqRow.style.display = v > 0 ? '' : 'none';
            refresh();
        });
        if (waveFreqSl) waveFreqSl.addEventListener('input', () => {
            const norm = parseFloat(waveFreqSl.value);
            const freq = 1 + norm * 19;  // map 0–1 → 1–20
            entry.waveFreq = freq;
            waveFreqVal.textContent = freq.toFixed(1);
            waveFreqSl.style.setProperty('--pct', `${(norm * 100).toFixed(1)}%`);
            refresh();
        });

        // Invert + Threshold sliders
        const invertSl = card.querySelector('.layer-invert-sl');
        const invertVal = card.querySelector('.layer-invert-val');
        if (invertSl) invertSl.addEventListener('input', () => {
            const v = parseFloat(invertSl.value);
            entry.invertMix = v;
            invertVal.textContent = v.toFixed(2);
            invertSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const threshSl = card.querySelector('.layer-thresh-sl');
        const threshVal = card.querySelector('.layer-thresh-val');
        if (threshSl) threshSl.addEventListener('input', () => {
            const v = parseFloat(threshSl.value);
            entry.thresholdCutoff = v;
            threshVal.textContent = v.toFixed(2);
            threshSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });
        const solarizeSl = card.querySelector('.layer-solarize-sl');
        const solarizeVal = card.querySelector('.layer-solarize-val');
        if (solarizeSl) solarizeSl.addEventListener('input', () => {
            const v = parseFloat(solarizeSl.value);
            entry.solarizeMix = v;
            solarizeVal.textContent = v.toFixed(2);
            solarizeSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        // Pixelate slider
        const pixSl = card.querySelector('.layer-pixelate-sl');
        const pixVal = card.querySelector('.layer-pixelate-val');
        if (pixSl) pixSl.addEventListener('input', () => {
            const v = parseFloat(pixSl.value);
            entry.pixelate = v;
            pixVal.textContent = v.toFixed(2);
            pixSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        // Scan Lines slider
        const scanSl = card.querySelector('.layer-scanlines-sl');
        const scanVal = card.querySelector('.layer-scanlines-val');
        if (scanSl) scanSl.addEventListener('input', () => {
            const v = parseFloat(scanSl.value);
            entry.scanLines = v;
            scanVal.textContent = v.toFixed(2);
            scanSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        // Film Grain slider
        const grainSl = card.querySelector('.layer-grain-sl');
        const grainVal = card.querySelector('.layer-grain-val');
        if (grainSl) grainSl.addEventListener('input', () => {
            const v = parseFloat(grainSl.value);
            entry.filmGrain = v;
            grainVal.textContent = v.toFixed(2);
            grainSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        // Vignette controls
        const vignetteCb = card.querySelector('.layer-vignette-cb');
        const vignetteDetail = card.querySelector('.layer-vignette-detail');
        if (vignetteCb && vignetteDetail) {
            vignetteCb.addEventListener('change', () => {
                entry.vignette = vignetteCb.checked ? 1 : 0;
                vignetteDetail.style.display = entry.vignette ? '' : 'none';
                refresh();
            });
        }

        // Vignette XY Pad — center point
        const vXY = card.querySelector('.vignette-xy-pad');
        const vXYReset = card.querySelector('.vignette-xy-reset');
        if (vXY) {
            const vCtx = vXY.getContext('2d');
            const PAD = 96;
            const drawVPad = () => {
                vCtx.clearRect(0, 0, PAD, PAD);
                vCtx.fillStyle = 'rgba(255,255,255,0.04)';
                vCtx.beginPath();
                vCtx.roundRect(0, 0, PAD, PAD, 4);
                vCtx.fill();
                vCtx.strokeStyle = 'rgba(255,255,255,0.10)';
                vCtx.lineWidth = 1;
                vCtx.beginPath(); vCtx.moveTo(PAD / 2, 0); vCtx.lineTo(PAD / 2, PAD); vCtx.stroke();
                vCtx.beginPath(); vCtx.moveTo(0, PAD / 2); vCtx.lineTo(PAD, PAD / 2); vCtx.stroke();
                vCtx.strokeRect(0.5, 0.5, PAD - 1, PAD - 1);
                const dx = (entry.vignetteCX ?? 0.5) * PAD;
                const dy = (entry.vignetteCY ?? 0.5) * PAD;
                vCtx.beginPath();
                vCtx.arc(dx, dy, 5, 0, Math.PI * 2);
                vCtx.fillStyle = '#ffffff';
                vCtx.fill();
                vCtx.strokeStyle = 'rgba(0,0,0,0.5)';
                vCtx.lineWidth = 1.5;
                vCtx.stroke();
            };
            drawVPad();
            const onVMove = (e) => {
                const rect = vXY.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                entry.vignetteCX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                entry.vignetteCY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
                drawVPad();
                refresh();
            };
            let vDragging = false;
            vXY.addEventListener('mousedown', (e) => { vDragging = true; onVMove(e); });
            vXY.addEventListener('touchstart', (e) => { vDragging = true; onVMove(e); e.preventDefault(); }, { passive: false });
            window.addEventListener('mousemove', (e) => { if (vDragging) onVMove(e); });
            window.addEventListener('mouseup', () => { vDragging = false; });
            window.addEventListener('touchmove', (e) => { if (vDragging) onVMove(e); }, { passive: true });
            window.addEventListener('touchend', () => { vDragging = false; });
            if (vXYReset) vXYReset.addEventListener('click', () => {
                entry.vignetteCX = 0.5;
                entry.vignetteCY = 0.5;
                drawVPad();
                refresh();
            });
        }

        const vignetteWSl = card.querySelector('.layer-vignette-w-sl');
        const vignetteWVal = card.querySelector('.layer-vignette-w-val');
        if (vignetteWSl) vignetteWSl.addEventListener('input', () => {
            const v = parseFloat(vignetteWSl.value);
            entry.vignetteW = v;
            vignetteWVal.textContent = v.toFixed(2);
            vignetteWSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        const vignetteHSl = card.querySelector('.layer-vignette-h-sl');
        const vignetteHVal = card.querySelector('.layer-vignette-h-val');
        if (vignetteHSl) vignetteHSl.addEventListener('input', () => {
            const v = parseFloat(vignetteHSl.value);
            entry.vignetteH = v;
            vignetteHVal.textContent = v.toFixed(2);
            vignetteHSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        const vignetteCornerSl = card.querySelector('.layer-vignette-corner-sl');
        const vignetteCornerVal = card.querySelector('.layer-vignette-corner-val');
        if (vignetteCornerSl) vignetteCornerSl.addEventListener('input', () => {
            const v = parseFloat(vignetteCornerSl.value);
            entry.vignetteCorner = v;
            vignetteCornerVal.textContent = v.toFixed(2);
            vignetteCornerSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        const vignetteStrSl = card.querySelector('.layer-vignette-str-sl');
        const vignetteStrVal = card.querySelector('.layer-vignette-str-val');
        if (vignetteStrSl) vignetteStrSl.addEventListener('input', () => {
            const v = parseFloat(vignetteStrSl.value);
            entry.vignetteStrength = v;
            vignetteStrVal.textContent = v.toFixed(2);
            vignetteStrSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        const vignetteFeaSl = card.querySelector('.layer-vignette-fea-sl');
        const vignetteFeaVal = card.querySelector('.layer-vignette-fea-val');
        if (vignetteFeaSl) vignetteFeaSl.addEventListener('input', () => {
            const v = parseFloat(vignetteFeaSl.value);
            entry.vignetteFeather = v;
            vignetteFeaVal.textContent = v.toFixed(2);
            vignetteFeaSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
            refresh();
        });

        const vignetteSwatch = card.querySelector('.layer-vignette-swatch');
        const vignettePicker = card.querySelector('.layer-vignette-picker');
        if (vignetteSwatch && vignettePicker) {
            vignetteSwatch.addEventListener('click', () => vignettePicker.click());
            vignettePicker.addEventListener('input', () => {
                entry.vignetteColor = vignettePicker.value;
                vignetteSwatch.style.background = vignettePicker.value;
                refresh();
            });
        }

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
        if (lissFxSl && lissFxVal) lissFxSl.addEventListener('input', () => {
            entry.lissFreqX = parseFloat(lissFxSl.value);
            lissFxVal.textContent = entry.lissFreqX.toFixed(2);
            lissFxSl.style.setProperty('--pct', `${pct(entry.lissFreqX, 0.25, 4)}`);
            refresh();
        });
        const lissFySl = card.querySelector('.layer-liss-fy-sl');
        const lissFyVal = card.querySelector('.layer-liss-fy-val');
        if (lissFySl && lissFyVal) lissFySl.addEventListener('input', () => {
            entry.lissFreqY = parseFloat(lissFySl.value);
            lissFyVal.textContent = entry.lissFreqY.toFixed(2);
            lissFySl.style.setProperty('--pct', `${pct(entry.lissFreqY, 0.25, 4)}`);
            refresh();
        });
        const lissPhSl = card.querySelector('.layer-liss-ph-sl');
        const lissPhVal = card.querySelector('.layer-liss-ph-val');
        if (lissPhSl && lissPhVal) lissPhSl.addEventListener('input', () => {
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

        // ── Image-as-texture (Phase 2.5): per-card Overlay|Drive switch. Toggling
        // Drive moves the shared Drive panel into THIS card, hides its overlay body,
        // and radio-disables Drive on every other card.
        card.querySelector('.layer-drive')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleCardDrive(entry);
        });

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
        // animation-dev.md A1 — animate button opens the modal scoped to this entry.
        const animateBtn = card.querySelector('.layer-animate');
        if (animateBtn) {
            animateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showAnimateModal(entry);
            });
            // Dot indicator reflects whether any animation is configured.
            const dot = animateBtn.querySelector('.layer-animate-dot');
            const refreshDot = () => {
                const a = entry.animation || {};
                const active = (a.entrance && a.entrance !== 'none') || (a.exit && a.exit !== 'none') || (a.idle && a.idle !== 'none');
                if (dot) dot.hidden = !active;
            };
            refreshDot();
            entry._refreshAnimateDot = refreshDot; // called by the modal on change
        }

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
            const thumbSrc = texObj.isText
                ? this.engine._renderTextTexture(texObj.textLayer).dataURL
                : texObj.data;
            thumbImg.src = thumbSrc;
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

        // Text layers have no blob — reset by removing and re-adding a fresh default entry
        if (entry.type === 'text') {
            this._preSnap();
            const origIdx = this.currentState.images.indexOf(entry);
            if (origIdx !== -1) this.currentState.images.splice(origIdx, 1);
            delete this._imageTextures[entry.texName];
            card.remove();
            this._addTextLayer();
            const arr = this.currentState.images;
            const newEntry = arr[arr.length - 1];
            if (newEntry && origIdx !== -1 && origIdx < arr.length - 1) {
                arr.pop();
                arr.splice(origIdx, 0, newEntry);
                const layers = document.getElementById('image-layers');
                const byTex = new Map();
                layers.querySelectorAll('.image-layer-card').forEach(c => byTex.set(c.dataset.texName, c));
                arr.forEach(e => { const c = byTex.get(e.texName); if (c) layers.appendChild(c); });
            }
            this._updateLayerIndices();
            this._buildCompShader();
            this._applyToEngine();
            this._postSnap();
            showToast('Reset text layer');
            return;
        }

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
        // Phase 3 — generate each shape's frame_eqs from its motion params (Spin/
        // Pulse/Orbit). Generated at runtime, never stored (saved frame_eqs_str
        // stays ''). Player mirrors this in refreshCustomPresets for parity.
        // Editor shapes claim engine slots FIRST, then bundled raw shapes fill the
        // remainder — so user-added shapes are never starved by a bundled preset's own
        // shapes (the engine renders only MAX_SHAPES slots). Player mirrors this ordering
        // in refreshCustomPresets for save parity.
        const allShapes = runtime.shapes || [];
        const shapes = [
            ...allShapes.filter(s => this._isEditorShape(s)),
            ...allShapes.filter(s => !this._isEditorShape(s)),
        ].slice(0, MAX_SHAPES);
        for (const sh of shapes) {
            if (sh && sh.baseVals && (sh.motion || sh.react)) {
                sh.frame_eqs_str = buildShapeMotionEqs(sh.baseVals, sh.motion, sh.react) || sh.frame_eqs_str || '';
            }
        }
        // The engine iterates 4 shape renderers and indexes preset.shapes[i], so
        // pad to 4 slots with disabled stubs (matches how bundled presets ship)
        // to avoid drawCustomShape(undefined) on empty slots. Clone only — never
        // mutates the saved state.shapes.
        while (shapes.length < MAX_SHAPES) shapes.push({ baseVals: { enabled: 0 }, init_eqs_str: '', frame_eqs_str: '' });
        runtime.shapes = shapes;
        // Phase 7 — Flow Style: a per-preset warp shader (the motion field). '' when
        // 'none' → keep the preset's own warp (default / bundled). Player mirrors this
        // in refreshCustomPresets for parity.
        const flowWarp = buildWarpShader(state.flowStyle);
        if (flowWarp) runtime.warp = flowWarp;
        // Image-as-texture (Phase 2): when enabled AND its source layer still exists,
        // the image-warp OVERRIDES flowStyle's warp — the preset's motion now melts the
        // image through the feedback loop. Player mirrors this in refreshCustomPresets.
        const iw = state.imageWarp;
        const iwDrive = iw && iw.enabled && iw.texName
            ? (state.images || []).find(e => e.texName === iw.texName) : null;
        if (iwDrive) {
            runtime.warp = buildImageWarp({
                imgName: iw.texName, flow: iw.flow, size: iw.size, cx: iw.cx, cy: iw.cy,
                mirror: iw.mirror, kaleidoSpeed: iw.kaleidoSpeed, blendMode: iw.blendMode,
                bright: iw.bright, contrast: iw.contrast, sat: iw.sat, hue: iw.hue, invert: iw.invert,
                speed: iw.speed, depth: iw.depth,
                spin: iw.spin, zoomPulse: iw.zoomPulse, flowPulse: iw.flowPulse, lumaKey: iw.lumaKey, mask: iw.mask, disp: iw.disp, flowMap: iw.flowMap,
                tint: iw.tint, palette: iw.imgPalette, edgeFeather: iw.edgeFeather,
                reseed: iw.reseed, audioSource: iw.audioSource, audioAmt: iw.audioAmt,
                isStackedAlpha: !!iwDrive.isStackedAlpha,
            });
        }
        // Engine runs first (a living motion baseline), then motionReact/waveReact
        // punch audio on top. All additive + clamped, so order only affects which
        // clamp wins on extremes — engine-before-react reads cleanest.
        const injectedEngine = buildMotionEngineFrameEqs(state.motionEngine);
        const injectedMotion = buildMotionReactFrameEqs(state.motionReact);
        const injectedWave = buildWaveReactFrameEqs(state.waveReact);
        const baseFrame = runtime.frame_eqs_str || '';
        // q-register injection — CRITICAL: skip for a RAW bundled MilkDrop preset.
        // Custom MilkDrop presets feed their OWN warp/comp/shape shaders through the
        // q1–q32 registers; the flux line (q31) and the per-layer anim lines (q1–q25)
        // would overwrite the preset's shader inputs → BLACK. ~50 bundled presets
        // (martin/shifter/ORB/Geiss/Dark One…) broke this way. The player never injects
        // these for bundled presets (they load raw, never through refreshCustomPresets),
        // so gating on `_bundledBase` ACHIEVES editor↔player parity. Once the user takes
        // over the warp (Flow style / Remix → `_bundledBase` cleared, editor owns the
        // shaders), injection resumes for the editor's own animation/flux features.
        // Tradeoff: a raw bundled preset can't use "flux" as a grade-reactivity source
        // (q31 unpopulated) — acceptable, since populating it is what breaks the preset.
        const fluxLine = this._bundledBase ? '' : 'a.q31=(typeof __dcFlux!=="undefined"?__dcFlux:0);';
        // animation-dev.md P0-C: pull `window.__dcAnim[i]` into per-layer q-slots
        // each frame. Now built by the SHARED helper so the editor and the
        // player/timeline (visualizer.refreshCustomPresets) inject byte-identical
        // lines — single source of truth, see customPresets.buildAnimFrameEqs().
        const animLines = this._bundledBase ? '' : buildAnimFrameEqs();
        runtime.frame_eqs_str = [baseFrame, injectedEngine, injectedMotion, injectedWave, fluxLine, animLines].filter(Boolean).join('\n').trim();
        return runtime;
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

    /** Wipe the warp feedback buffer so a shape edit doesn't leave a stale ghost
     *  (the decay trail of the shape's previous size/position). Called on shape
     *  edit COMMITS (pointerup / add / delete), never per-frame — so it clears
     *  remnants without flickering during a drag. Decay (Palette → Trail) is left
     *  untouched, so a live animating shape still trails per the user's setting. */
    _clearTrail() {
        this.engine?.clearFeedbackBuffer?.();
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
        let visibleImages = anySolo
            ? images.filter(img => img.solo)
            : images.filter(img => !img.muted);
        // Image-as-texture (Phase 2): the layer DRIVING the preset must not also sit on
        // top as a flat overlay — it's being melted into the feedback loop instead. Drop
        // it from the comp composite while Drive is on (its texture stays bound for the
        // warp; toggling Drive off restores the overlay).
        const _iw = this.currentState.imageWarp;
        if (_iw && _iw.enabled && _iw.texName) {
            visibleImages = visibleImages.filter(img => img.texName !== _iw.texName);
        }
        const _po = this.currentState.paletteOpacity ?? 1.0;
        // Transparent background (Phase 1) — only meaningful for layers-only presets
        // (_imagesOnly). Gated this way so MilkDrop/solid modes are byte-identical
        // (avoids the May-2026 "turns off the layers too" regression).
        const _bgT = this._imagesOnly && !!this.currentState.bgTransparent;
        const _glow = this.currentState.baseVals.studio_glow ?? 0;
        const _accent = this.currentState.baseVals.studio_accent ?? 0;
        if (visibleImages.length === 0 && !this._solidColor && sm === 'none' && _po >= 1.0 && !_bgT
            && _glow === 0 && _accent === 0) {
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
        } else if (sm === 'kaleido') {
            const ks = (this.currentState.sceneMirrorKaleidoSpeed || 0).toFixed(4);
            uvFold = '  vec2 uv_m;\n' +
                      '  { vec2 _kp = uv - 0.5;\n' +
                      '    float _kang = atan(_kp.y, _kp.x);\n' +
                      '    float _krad = length(_kp);\n' +
                      '    float _ksect = 6.28318530718 / 6.0;\n' +
                      '    float _ka = mod(_kang, _ksect);\n' +
                      '    if (_ka > _ksect * 0.5) _ka = _ksect - _ka;\n' +
                     `    _ka += time * ${ks} * 6.28318;\n` +
                      '    uv_m = vec2(cos(_ka) * _krad, sin(_ka) * _krad) + 0.5;\n' +
                      '  }\n';
        } else {
            uvFold = '  vec2 uv_m = uv;\n';
        }
        const mainSample = _po >= 1.0
            ? 'texture(sampler_main, uv_m).xyz * 2.0'
            : `texture(sampler_main, uv_m).xyz * 2.0 * ${_po.toFixed(4)}`;

        let base;
        // Solid/Shift mode paints a flat colour and ignores sampler_main (the
        // feedback buffer where the wave, shapes, flow + motion all draw). We
        // composite that buffer OVER the flat colour (keyed by its own brightness)
        // so EVERYTHING plays over the Palette colour — the background is never
        // blacked out (the old "wake feedback → clear solid → black" path is gone).
        // No-op when the buffer is black, so a pure flat colour is unchanged.
        const _hasShapes = (this.currentState.shapes || []).some(s => s && s.baseVals && s.baseVals.enabled !== 0);
        // Image-drive also actively writes the feedback buffer (its warp seeds the image),
        // so treat it like an active flow for the Solid-mode composite + content checks.
        const _imageWarpActive = !!(this.currentState.imageWarp && this.currentState.imageWarp.enabled && this.currentState.imageWarp.texName);
        const _flowActive = _imageWarpActive || !!(this.currentState.flowStyle && this.currentState.flowStyle.id && this.currentState.flowStyle.id !== 'none');
        const _meActive = !!(this.currentState.motionEngine && this.currentState.motionEngine.id && this.currentState.motionEngine.id !== 'none');
        const _waveVisible = (this.currentState.baseVals.wave_a ?? 0) > 0.001;
        // Composite the feedback buffer whenever anything could be drawing into it.
        const _hasFeedbackContent = _hasShapes || _flowActive || _meActive || _waveVisible;

        if (this._imagesOnly) {
            base = uvFold + '  vec3 col = vec3(0.0);\n' + (_bgT ? '  float col_a = 0.0;\n' : '');
        } else if (this._solidColor) {
            const bv = this.currentState.baseVals;
            // Background field Colour A — its own colour (8.2), independent of the
            // foreground wave (wave_r/g/b). Used only when the background is actually
            // dynamic (non-flat field or Shift on); in a plain flat Solid the "Color"
            // swatch (wave) still drives the colour, so that mode is unchanged. null
            // → wave fallback (old presets byte-identical).
            const bgA = this.currentState.bgColorA;
            const _bgDyn = !!((this.currentState.bgField && this.currentState.bgField.style && this.currentState.bgField.style !== 'flat') || Number(this.currentState.solidShift || 0) > 0);
            const _useBg = bgA && _bgDyn;
            const aR = (_useBg ? bgA[0] : (bv.wave_r ?? this._solidColor[0])).toFixed(4);
            const aG = (_useBg ? bgA[1] : (bv.wave_g ?? this._solidColor[1])).toFixed(4);
            const aB = (_useBg ? bgA[2] : (bv.wave_b ?? this._solidColor[2])).toFixed(4);
            const cb = this.currentState.solidColorB || [0, 0, 0];
            const bR = Number(cb[0]).toFixed(4);
            const bG = Number(cb[1]).toFixed(4);
            const bB = Number(cb[2]).toFixed(4);
            const pulse = Number(this.currentState.solidPulse || 0).toFixed(4);
            const breath = Number(this.currentState.solidBreath || 0).toFixed(4);
            const shift = Number(this.currentState.solidShift || 0).toFixed(4);
            const reactSrc = { bass: 'bass', mid: 'mid', treb: 'treb', vol: 'vol', flux: 'q31' }[this.currentState.solidReactSource || 'bass'] || 'bass';
            const solidCurve = this.currentState.solidReactCurve || 'linear';
            let solidCurveExpr;
            switch (solidCurve) {
                case 'squared': solidCurveExpr = '_sr_raw * _sr_raw'; break;
                case 'cubed': solidCurveExpr = '_sr_raw * _sr_raw * _sr_raw'; break;
                case 'threshold': solidCurveExpr = 'step(0.3, _sr_raw)'; break;
                default: solidCurveExpr = '_sr_raw';
            }
            // Color Field — spreads the A→B blend across SPACE (Phase 8). 'flat'
            // returns 0.0 → _shiftT reduces to the classic audio-only Shift (byte-
            // identical). The others build a spatial 0..1 field from uv_m + time, so
            // the background becomes a moving multi-colour gradient; the audio shift
            // still rides on top (clamped sum) so the beat-pulse is preserved.
            const bgf = this.currentState.bgField || { style: 'flat', scale: 1.0, speed: 0.3 };
            const fsc = Number(bgf.scale ?? 1).toFixed(4);
            const fsp = Number(bgf.speed ?? 0.3).toFixed(4);
            const fspin = Number(bgf.spin ?? 0);
            const fsharp = Number(bgf.sharp ?? 0);
            const _isFlatField = !bgf.style || bgf.style === 'flat';
            // Build the `_field` GLSL (a 0..1 spatial pattern). 'flat' → 0.0 (byte-
            // identical Shift). Phase 13: Spin rotates the field coord over time;
            // Conic/Spiral add angular styles; Sharpness quantises into hard bands.
            let fieldGlsl;
            if (_isFlatField) {
                fieldGlsl = `  float _field = 0.0;\n`;
            } else {
                const coordDecl = (Math.abs(fspin) > 1e-4)
                    ? `  vec2 _fc = uv_m - 0.5;\n  float _fa = time * ${fspin.toFixed(4)};\n  float _fco = cos(_fa), _fsi = sin(_fa);\n  vec2 _fuv = vec2(_fc.x * _fco - _fc.y * _fsi, _fc.x * _fsi + _fc.y * _fco) + 0.5;\n`
                    : `  vec2 _fuv = uv_m;\n`;
                // Beat-reactive field (13.3): on the beat the field zooms/breathes —
                // scale _fuv toward centre by the audio signal (_sr, the same band as
                // the Shift pulse → one cohesive audio identity). 0 = static.
                const freact = Number(bgf.react ?? 0);
                const reactDecl = (freact > 0.001)
                    ? `  _fuv = (_fuv - 0.5) * (1.0 - _sr * ${freact.toFixed(4)} * 0.6) + 0.5;\n`
                    : '';
                let fieldExpr;
                switch (bgf.style) {
                    case 'linear': fieldExpr = `0.5 + 0.5 * sin((_fuv.x + _fuv.y) * ${fsc} * 3.14159 + time * ${fsp})`; break;
                    case 'radial': fieldExpr = `0.5 + 0.5 * sin(length(_fuv - 0.5) * ${fsc} * 14.0 - time * ${fsp} * 2.0)`; break;
                    case 'plasma': fieldExpr = `0.5 + 0.5 * sin(_fuv.x * ${fsc} * 7.0 + time * ${fsp}) * cos(_fuv.y * ${fsc} * 7.0 - time * ${fsp} * 0.8)`; break;
                    case 'conic':  fieldExpr = `0.5 + 0.5 * sin(atan(_fuv.y - 0.5, _fuv.x - 0.5) * ${fsc} * 3.0 + time * ${fsp})`; break;
                    case 'spiral': fieldExpr = `0.5 + 0.5 * sin(atan(_fuv.y - 0.5, _fuv.x - 0.5) * 3.0 + length(_fuv - 0.5) * ${fsc} * 14.0 - time * ${fsp} * 1.5)`; break;
                    // Phase 17 — Diamond: square-radial (Manhattan-distance) rings.
                    case 'diamond': fieldExpr = `0.5 + 0.5 * sin((abs(_fuv.x - 0.5) + abs(_fuv.y - 0.5)) * ${fsc} * 14.0 - time * ${fsp} * 2.0)`; break;
                    // Phase 17 — Checker: scrolling hard tiles (0/1 lattice).
                    case 'checker': fieldExpr = `mod(floor(_fuv.x * ${fsc} * 8.0 + time * ${fsp} * 0.5) + floor(_fuv.y * ${fsc} * 8.0), 2.0)`; break;
                    // Phase 17 — Clouds: domain-warped pseudo-organic plasma (billowing).
                    case 'clouds': fieldExpr = `0.5 + 0.5 * sin(_fuv.x * ${fsc} * 4.0 + time * ${fsp} + 2.0 * sin(_fuv.y * ${fsc} * 3.0 - time * ${fsp} * 0.5)) * cos(_fuv.y * ${fsc} * 4.0 - time * ${fsp} * 0.6 + 1.5 * sin(_fuv.x * ${fsc} * 2.5))`; break;
                    // Phase 19 — Stripes: straight axis-aligned bands (Linear is diagonal).
                    case 'stripes': fieldExpr = `0.5 + 0.5 * sin(_fuv.x * ${fsc} * 10.0 + time * ${fsp})`; break;
                    // Phase 19 — Weave: soft crosshatch (X + Y bands).
                    case 'weave': fieldExpr = `0.5 + 0.25 * (sin(_fuv.x * ${fsc} * 10.0 + time * ${fsp}) + sin(_fuv.y * ${fsc} * 10.0 - time * ${fsp}))`; break;
                    // Phase 19 — Vortex: perspective rings + swirl into centre (tunnel).
                    case 'vortex': fieldExpr = `0.5 + 0.5 * sin(1.0 / (length(_fuv - 0.5) + 0.1) * ${fsc} * 2.0 + atan(_fuv.y - 0.5, _fuv.x - 0.5) * 3.0 - time * ${fsp} * 2.0)`; break;
                    // Phase 19 — Rays: spokes from centre (Conic w/ a higher ray count).
                    case 'rays': fieldExpr = `0.5 + 0.5 * sin(atan(_fuv.y - 0.5, _fuv.x - 0.5) * ${fsc} * 8.0 + time * ${fsp})`; break;
                    // Phase 19 — Ripples: two circular sources summed → interference shimmer.
                    case 'ripples': fieldExpr = `0.5 + 0.25 * (sin(length(_fuv - vec2(0.35, 0.4)) * ${fsc} * 24.0 - time * ${fsp} * 2.0) + sin(length(_fuv - vec2(0.65, 0.6)) * ${fsc} * 24.0 + time * ${fsp} * 2.0))`; break;
                    // Phase 19 — Moiré: two close radial freqs multiplied → beat pattern.
                    case 'moire': fieldExpr = `0.5 + 0.5 * sin(length(_fuv - 0.5) * ${fsc} * 14.0 - time * ${fsp}) * sin(length(_fuv - 0.5) * ${fsc} * 15.0 + time * ${fsp})`; break;
                    // Phase 19 — Marble: domain-warped stripes (veined, cousin of Clouds).
                    case 'marble': fieldExpr = `0.5 + 0.5 * sin(_fuv.x * ${fsc} * 6.0 + 3.0 * sin(_fuv.y * ${fsc} * 2.0 - time * ${fsp}) + time * ${fsp} * 0.3)`; break;
                    // Phase 19 — Mandala: angular fold → kaleidoscopic symmetry.
                    case 'mandala': fieldExpr = `0.5 + 0.5 * sin(abs(mod(atan(_fuv.y - 0.5, _fuv.x - 0.5) * 6.0, 6.28318) - 3.14159) * ${fsc} * 2.0 + length(_fuv - 0.5) * 8.0 - time * ${fsp})`; break;
                    // Phase 19 — Hex: three 60°-offset plane waves → honeycomb lattice.
                    case 'hex': fieldExpr = `0.5 + 0.166 * (sin(_fuv.x * ${fsc} * 16.0 + time * ${fsp}) + sin((_fuv.x * 0.5 + _fuv.y * 0.866) * ${fsc} * 16.0 - time * ${fsp} * 0.5) + sin((_fuv.x * 0.5 - _fuv.y * 0.866) * ${fsc} * 16.0 + time * ${fsp} * 0.5))`; break;
                    default: fieldExpr = '0.0';
                }
                fieldGlsl = coordDecl + reactDecl + `  float _field = ${fieldExpr};\n`;
                if (fsharp > 0.001) {
                    const bands = Math.max(2, Math.round(2 + fsharp * 6));  // 2..8 hard bands
                    fieldGlsl += `  _field = floor(_field * ${bands}.0 + 0.5) / ${bands}.0;\n`;
                }
            }
            // Breath: lerp between 1.0 (off) and a slow sine (0..1) by breath amount.
            // Pulse:  multiplies brightness by (1 + signal * pulse).
            // Shift:  mixes A→B by (spatial field + shaped signal * shift), clamped.
            base = uvFold +
                `  float _sr_raw = ${reactSrc};\n` +
                `  float _sr = ${solidCurveExpr};\n` +
                `  float _breath = mix(1.0, 0.5 + 0.5 * sin(time * 0.6), ${breath});\n` +
                `  float _pulse = 1.0 + _sr * ${pulse};\n` +
                fieldGlsl +
                `  float _shiftT = clamp(_field + _sr * ${shift}, 0.0, 1.0);\n` +
                `  vec3 _colA = vec3(${aR}, ${aG}, ${aB});\n` +
                `  vec3 _colB = vec3(${bR}, ${bG}, ${bB});\n` +
                // 3-colour stop (13.2): blend A→B→C across the field, where C = the
                // palette's WAVE colour (the 3rd harmony colour), so the background is
                // a richer multi-colour gradient, not two-tone. Off = classic A→B.
                (bgf.tri
                    ? `  vec3 _colC = vec3(${(bv.wave_r ?? 1).toFixed(4)}, ${(bv.wave_g ?? 1).toFixed(4)}, ${(bv.wave_b ?? 1).toFixed(4)});\n  vec3 col = (_shiftT < 0.5 ? mix(_colA, _colB, _shiftT * 2.0) : mix(_colB, _colC, (_shiftT - 0.5) * 2.0)) * _breath * _pulse;\n`
                    : `  vec3 col = mix(_colA, _colB, _shiftT) * _breath * _pulse;\n`) +
                (_po < 1.0 ? `  col *= ${_po.toFixed(4)};\n` : '');
            // Composite the feedback buffer (wave + shapes + warped flow + motion,
            // with their trail) over the solid/shift background. Key the over-composite
            // on its own brightness so the flat colour shows where there's no content.
            // No-op when the buffer is black, so a pure flat colour is unchanged.
            if (_hasFeedbackContent) {
                base +=
                    `  vec3 _shp = texture(sampler_main, uv_m).xyz * 2.0;\n` +
                    `  float _shpCov = clamp(max(_shp.r, max(_shp.g, _shp.b)), 0.0, 1.0);\n` +
                    `  col = mix(col, _shp, _shpCov);\n`;
            }
        } else {
            base = uvFold + `  vec3 col = ${mainSample};\n`;
        }
        const _bv = this.currentState.baseVals;
        // Glow / Accent bloom — a colored halo from the BLURRED feedback buffer
        // (engine auto-runs the blur passes because we reference sampler_blur1/2),
        // tinted by the Glow (ob) / Accent (ib) colours. This is the real "glow"
        // the border rings never were, and it makes all three palette colours show
        // at once. Only emitted when on (so getHighestBlur=0 → no blur cost when
        // off), and skipped in imagesOnly mode (empty feedback buffer = nothing to
        // bloom). The ×3 scale gives the 0–1 slider a visible-but-not-blown range.
        if ((_glow > 0 || _accent > 0) && !this._imagesOnly) {
            const f = (n) => Number(n || 0).toFixed(4);
            if (_glow > 0) {
                base += `  col += texture(sampler_blur1, uv_m).rgb * vec3(${f(_bv.ob_r)}, ${f(_bv.ob_g)}, ${f(_bv.ob_b)}) * ${(_glow * 3).toFixed(4)};\n`;
            }
            if (_accent > 0) {
                base += `  col += texture(sampler_blur2, uv_m).rgb * vec3(${f(_bv.ib_r)}, ${f(_bv.ib_g)}, ${f(_bv.ib_b)}) * ${(_accent * 3).toFixed(4)};\n`;
            }
        }
        const _sat = _bv.studio_saturation ?? 1.0;
        const _hue = _bv.studio_hue_rotate ?? 0;
        const _roll = _bv.studio_hue_roll ?? 0;
        const _hasImages = visibleImages.length > 0;

        let body = base;
        // When images are present, apply sat/hue/roll to `col` HERE — after `col` is
        // initialised from the MilkDrop background but BEFORE any image layer is
        // composited into it.  That way image pixels are never colour-shifted/rolled.
        if (_hasImages) {
            const _satHue = buildSatHueOnColGlsl(_sat, _hue, _roll);
            if (_satHue) body += _satHue;
        }
        for (const img of visibleImages) {
            // animation-dev.md P0-B: pass the layer's index in the FULL images array
            // so its q-slot base (idx*5+1) is stable regardless of solo/mute state.
            body += this._buildImageBlock(img, _bgT, images.indexOf(img));
        }
        body += '  ret = col;\n';
        if (_bgT) body += '  ret_a = col_a;\n';
        const _rawComp = `${uniforms}\n shader_body {\n${body} }`;
        this._baseComp = _rawComp;
        // With images: end-block forces sat/hue/roll to defaults (already applied to
        // `col` above so layers aren't colour-shifted), but the four grade faders
        // (brightness/contrast/gamma/temp) still apply whole-frame. Without images:
        // the end-block carries the full grade as before.
        const _grade = gradeOpts(this.currentState);
        this.currentState.comp = injectStudioPostFx(_rawComp, _hasImages ? { ..._grade, sat: 1.0, hue: 0, roll: 0 } : _grade);
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
    _buildImageBlock(img, trackAlpha = false, layerIdx = 0) {
        const isVideo = img.type === 'video';
        // animation-dev.md P0-B: per-layer q-register slot identifiers. Used as
        // multipliers on opacity/size and adders on cx/cy/blur in the emitted
        // GLSL below. Default neutral values in the JS eq pipe (1.0 / 0.0) make
        // the un-animated case byte-equivalent to the pre-animation shader.
        const _qBase = layerIdx * 5 + 1;       // 1, 6, 11, 16, 21
        const _qOp   = `q${_qBase + 0}`;
        const _qSc   = `q${_qBase + 1}`;
        const _qDx   = `q${_qBase + 2}`;
        const _qDy   = `q${_qBase + 3}`;
        const _qBlur = `q${_qBase + 4}`;
        // Phase B (video-tiling-dev.md): stacked-alpha video tiling. A stacked-alpha
        // clip is a 2×-tall texture (RGB top, alpha-as-luma bottom); every tiled sample
        // must recombine the halves. `stackedTiled` also disables the texture-resample
        // FX (chromatic/blur/sobel), which would read the raw 2× texture — deferred (§B.2).
        const stackedTiled = isVideo && !!img.isStackedAlpha && img.tile;
        // Videos use 'scale' (0.1-2.0 coverage), images use 'size' (tile density)
        const sz = isVideo ? (img.scale || 0.6).toFixed(4) : img.size.toFixed(4);
        const sp = img.spinSpeed.toFixed(4);
        const op = img.opacity.toFixed(4);
        const pu = img.audioPulse.toFixed(4);
        const opa = (img.opacityPulse || 0).toFixed(4);
        const orb = (img.orbitRadius || 0).toFixed(4);
        const bnc = (img.bounceAmp || 0).toFixed(4);
        const ts = Math.abs(img.tunnelSpeed || 0).toFixed(4);
        const spc = (isVideo && !img.tile) ? '0.0' : (img.spacing || 0).toFixed(4);  // Single-instance video has no spacing; tiled video uses it
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
        // Single-instance video uses 'field' scope; tiled video + images use stored scope
        const mirrorScope = (isVideo && !img.tile) ? 'field' : (img.mirrorScope || 'tile');
        const kspd = (img.kaleidoSpeed || 0).toFixed(4);
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
        // Beat-reactive effects (animation-dev.md B1'). Each rides the `_r` envelope.
        const tiltAmpVal = (img.tiltAmp || 0).toFixed(4);
        const tiltDirVal = ((img.tiltDir || 1) < 0 ? -1 : 1).toFixed(1);
        const hasTilt = parseFloat(tiltAmpVal) > 0.0001;
        const hopAmpVal = (img.hopAmp || 0).toFixed(4);
        const hopDirVal = ((img.hopDir || 1) < 0 ? -1 : 1).toFixed(1);
        const hasHop = parseFloat(hopAmpVal) > 0.0001;
        const huePulseVal = (img.huePulse || 0).toFixed(4);
        const hasHuePulse = parseFloat(huePulseVal) > 0.0001;
        const blurPulseVal = (img.blurPulse || 0).toFixed(4);
        const hasBlurPulse = parseFloat(blurPulseVal) > 0.0001;
        const squashAmpVal = (img.squashAmp || 0).toFixed(4);
        const squashSign = ((img.squashAxis || 'wide') === 'tall' ? -1 : 1).toFixed(1);
        const hasSquash = parseFloat(squashAmpVal) > 0.0001;
        const chromAmt = (img.chromaticAberration || 0).toFixed(4);
        const chromSpd = (img.chromaticSpeed !== undefined ? img.chromaticSpeed : 1.0).toFixed(4);
        const hasChromatic = parseFloat(chromAmt) > 0.001 && !stackedTiled;
        // All layer types now support independent width/height scaling via tileScaleX/Y
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
        const hasEdge = !!img.edgeSobel && !stackedTiled;
        const lumaKeyLo = (img.lumaKeyLo || 0).toFixed(4);
        const lumaKeyHi = (img.lumaKeyHi || 0).toFixed(4);
        const hasLumaKey = parseFloat(lumaKeyLo) > 0.001 || parseFloat(lumaKeyHi) > 0.001;
        const waveAmp = (img.waveAmp || 0).toFixed(4);
        const waveFreq = (img.waveFreq || 4.0).toFixed(4);
        const hasWave = parseFloat(waveAmp) > 0.001;
        const invertMix = (img.invertMix || 0).toFixed(4);
        const hasInvert = parseFloat(invertMix) > 0.001;
        const solarizeMix = (img.solarizeMix || 0).toFixed(4);
        const hasSolarize = parseFloat(solarizeMix) > 0.001;
        const threshCut = (img.thresholdCutoff || 0).toFixed(4);
        const hasThreshold = parseFloat(threshCut) > 0.001;
        const pixelateAmt = (img.pixelate || 0).toFixed(4);
        const hasPixelate = parseFloat(pixelateAmt) > 0.001;
        const scanLinesAmt = (img.scanLines || 0).toFixed(4);
        const hasScanLines = parseFloat(scanLinesAmt) > 0.001;
        const filmGrainAmt = (img.filmGrain || 0).toFixed(4);
        const hasFilmGrain = parseFloat(filmGrainAmt) > 0.001;
        const blurAmt = (img.blur || 0.0).toFixed(4);
        const hasBlur = (parseFloat(blurAmt) > 0.001 || hasBlurPulse) && !stackedTiled;
        // Pixel step for Sobel and Blur: 1/texW × 1/texH, falling back to 1/512
        const edgeStepX = img.texW ? (1.0 / img.texW).toFixed(6) : '0.001953';
        const edgeStepY = img.texH ? (1.0 / img.texH).toFixed(6) : '0.001953';
        const tex = `sampler_${img.texName}`;
        const imgAsp = (img.texW && img.texH) ? (img.texW / img.texH).toFixed(4) : '1.0000';

        const reactSrc = { bass: 'bass', mid: 'mid', treb: 'treb', vol: 'vol', flux: 'q31' }[img.reactSource || 'bass'] || 'bass';
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
        // Phase 1: Per-Cell variance flags — all tile-only, no-op when img.tile=false.
        // Brick / half-drop offset: stagger alternating rows or columns.
        const offsetAxis = img.tileOffsetAxis || 'none';
        const offsetAmount = (img.tileOffsetAmount || 0).toFixed(4);
        const hasOffset = img.tile && offsetAxis !== 'none' && parseFloat(offsetAmount) > 0.001;
        // Per-cell rotation variance — adds hashed rotation to each cell's spin.
        const rotVar = (img.tileRotateVariance || 0).toFixed(4);
        const rotSnap = !!img.tileRotateSnap;
        const hasRotVar = img.tile && parseFloat(rotVar) > 0.001;
        // Per-cell audio popcorn — each cell pulses on different beat phases.
        const popcornAmt = (img.tilePopcornAmount || 0).toFixed(4);
        const hasPopcorn = img.tile && parseFloat(popcornAmt) > 0.001;
        // Phase 2: Variance suite flags
        const sizeVar = (img.tileSizeVariance || 0).toFixed(4);
        const hasSizeVar = img.tile && parseFloat(sizeVar) > 0.001;
        const jitterX = (img.tileJitterX || 0).toFixed(4);
        const hasJitterX = img.tile && parseFloat(jitterX) > 0.001;
        const jitterY = (img.tileJitterY || 0).toFixed(4);
        const hasJitterY = img.tile && parseFloat(jitterY) > 0.001;
        const opacityVar = (img.tileOpacityVariance || 0).toFixed(4);
        const hasOpacityVar = img.tile && parseFloat(opacityVar) > 0.001;
        const depthVar = (img.tileDepthVariance || 0).toFixed(4);
        const hasDepthVar = img.tile && parseFloat(depthVar) > 0.001;
        const varSeed = (img.tileVarianceSeed || 0);
        // Seed threads through all per-cell hashes. seed=0 → vec2(0,0) added → identical to Phase 1.
        const seedVec = `vec2(${varSeed}.0, ${varSeed}.0)`;

        // hasSpin includes hasRotVar so the per-tile spin block emits even when
        // base spin/angle are zero (rotation variance alone needs the block).
        // hasTilt also forces the block so beat-driven tilt has a `_spinAng` to add to.
        const hasSpin = parseFloat(sp) !== 0 || hasAngle || hasRotVar || hasTilt;
        const hasOrbit = parseFloat(orb) !== 0;
        const hasLissajous = hasOrbit && orbitMode === 'lissajous';
        const hasBounce = parseFloat(bnc) !== 0;
        // Videos never have tunnel (no tiles), images respect tile setting
        const hasTunnel = parseFloat(ts) !== 0 && img.tile;
        const hasSway = parseFloat(swayAmt) !== 0;
        const hasWander = parseFloat(wanderAmt) !== 0;
        const hasPanDrift = panMode === 'drift' && (parseFloat(panSx) !== 0 || parseFloat(panSy) !== 0);
        const hasPanBounce = panMode === 'bounce' && (parseFloat(panSx) !== 0 || parseFloat(panSy) !== 0) && parseFloat(panRng) !== 0;
        const hasMirror = mirror !== 'none';
        const fieldMirror = hasMirror && mirrorScope === 'field';
        const tileMirror = hasMirror && mirrorScope === 'tile';
        const hasTint = parseFloat(hueSpin) !== 0 || parseFloat(tintR) !== 1 || parseFloat(tintG) !== 1 || parseFloat(tintB) !== 1 || hasHuePulse;
        // Videos are never tiled, so no group spin vs per-tile spin distinction.
        // Group spin only when there's a real angular velocity/angle (rotVar by itself
        // is per-cell, never a whole-grid rotation).
        const groupSpin = img.tile && (parseFloat(sp) !== 0 || hasAngle) && !!img.groupSpin;
        // perTileSpin emits when any rotation source exists and groupSpin is off.
        const perTileSpin = img.tile && hasSpin && !img.groupSpin;
        const fwd = (img.tunnelSpeed || 0) >= 0;

        // Phase 2.5: Scatter sampling — free per-cell jitter + tile overlap via
        // 3×3 neighbour accumulation. The plain fract() path locks each tile into
        // its own [0,1] cell box; jitter there can only slide a crop around. The
        // scatter path lets a fragment sample neighbouring cells' images, so tiles
        // move freely past cell edges and overlap. Gated to jitter-active,
        // non-tunnel, real tile layers — every other preset keeps the fract() path.
        const useScatter = (hasJitterX || hasJitterY) && img.tile && !hasTunnel;

        // Phase 3: Grid mode — an explicit COLS×ROWS grid as an alternative to
        // density-driven tiling. Inert when tunnel is active (a finite grid cannot
        // tunnel — §5.6 of tile-custom.md). Density mode is byte-for-byte unchanged.
        const tileModeVal = img.tileMode || 'density';
        const gridCols = Math.max(1, Math.round(img.tileCols || 3));
        const gridRows = Math.max(1, Math.round(img.tileRows || 3));
        const tileFitMode = img.tileFit || 'fill';
        // Grid scale: 1 = grid fills the canvas; < 1 = grid sits smaller, centred,
        // with transparent margin. Clamped ≥ 0.1 to keep the divisor safe.
        const gridScale = Math.max(0.1, img.tileGridScale !== undefined ? img.tileGridScale : 1.0).toFixed(4);
        const useGrid = img.tile && tileModeVal === 'grid' && !hasTunnel;
        // Phase 4: Recursive grids — each grid cell → S×S inner cells, with a
        // separate gap BETWEEN the outer cells (clusters). Grid-mode only.
        // useRecursion only when it changes the output: S>1 OR an outer gap is set
        // (at S=1, gap=0 the recursion path is byte-identical to plain Grid mode).
        const tileSubdivide = Math.max(1, Math.min(6, Math.round(img.tileSubdivide || 1)));
        const tileOuterGap = Math.max(0, Math.min(0.5, img.tileOuterGap !== undefined ? img.tileOuterGap : 0));
        const useRecursion = useGrid && (tileSubdivide > 1 || tileOuterGap > 0);
        // Derivative rescale so textureGrad picks the right mip on the S× finer,
        // gap-rescaled inner grid (dFdx of the smooth _gu, not the fract-jumping _innerGu).
        const recurDxScale = (tileSubdivide / Math.max(1 - 2 * tileOuterGap, 0.001)).toFixed(4);
        const outerGapHalf = (tileOuterGap * 0.5).toFixed(4);
        // Cell aspect ratio for per-cell rotation. Density cells are aspect-pre-scaled
        // square, so `aspect.y` is right; a Grid cell is canvasAR × Rows/Cols, so
        // rotation must correct by that or non-square grids shear as they rotate.
        // Phase 3 (aspect-ratio.md): grid uses aspect.y/aspect.x (not bare aspect.y) so the
        // correction is orientation-independent — no-op in landscape, portrait-correct too.
        const cellAspectExpr = useGrid ? `(aspect.y / max(aspect.x, 0.01) * ${gridRows}.0 / ${gridCols}.0)` : 'aspect.y';

        let blendLine;
        switch (img.blendMode) {
            case 'normal':   blendLine = `col = mix(col, _src, _t.w * _op);`; break;
            case 'additive': blendLine = `col += _src * _op;`; break;
            case 'multiply': blendLine = `col = mix(col, col * _src, _op);`; break;
            case 'overlay':  blendLine = `col = mix(col, _src, _op);`; break;
            default: blendLine = `col = mix(col, 1.0 - (1.0 - col) * (1.0 - _src), _op);`;
        }

        let angLines = '';
        if (hasOrbit && !hasLissajous) angLines += `    float _orbAng = time * 0.5;\n`;
        if (hasSpin) {
            // Phase 1: when only hasRotVar is set (no spin/angle), default to 0
            // so per-cell rotation variance can add to it.
            const baseSpinPresent = parseFloat(sp) !== 0 || hasAngle;
            let spinExpr = baseSpinPresent
                ? (parseFloat(sp) !== 0
                    ? (hasAngle ? `time * ${sp} + ${angleRad}` : `time * ${sp}`)
                    : angleRad)
                : '0.0';
            // Tilt: beat-driven rotational kick (~15° max), signed by tiltDir.
            if (hasTilt) spinExpr = `(${spinExpr}) + _r * ${tiltAmpVal} * ${tiltDirVal} * 0.26`;
            angLines += `    float _spinAng = ${spinExpr};\n`;
        }

        // Image centre (anchor + orbit + bounce + sway + wander)
        // P0-B: cx/cy carry the q-offset so every downstream cxExpr/cyExpr usage
        // automatically picks it up. qDx/qDy default to 0 → no-op when unanimated.
        let cxExpr = `(${cx} + ${_qDx})`;
        let cyExpr = `(${cy} + ${_qDy})`;
        if (hasSway) cxExpr = `(${cx} + ${_qDx}) + sin(time * ${swaySpd}) * ${swayAmt}`;
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
        // Hop: beat-driven X-axis kick (cousin of Bounce on cy), signed by hopDir.
        // Folded into cxExpr so it flows through every centerLines branch.
        if (hasHop) cxExpr = `(${cxExpr}) + _r * ${hopAmpVal} * ${hopDirVal} * 0.3`;

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
                    `      _kang += time * ${kspd} * 6.28318;\n` +
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
        // cellIdVar: name for the declared `vec2` cell-index variable (used by Phase 1
        //   per-cell variance — rotation, popcorn). Each call site must use a unique
        //   name so tunnel mode (two applyTileUV calls) doesn't collide.
        const applyTileUV = (varName, sizeExpr, maskVar = null, dxVar = null, dyVar = null, cellIdVar = '_cellId') => {
            let s = '';
            if (useGrid) {
                // Phase 3: Grid mode — an explicit COLS×ROWS grid fills the canvas once.
                // _gu ∈ [0,COLS]×[0,ROWS]; the cell index is floor(_gu); per-cell UV is
                // fract(_gu). No infinite fract-wrap — fragments outside the grid (e.g.
                // rotated-out corners under Group Spin) are masked transparent.
                s += `    vec2 _gu = (${varName} / max(${gridScale} * ${pulseFactor}, 0.05) + 0.5) * vec2(${gridCols}.0, ${gridRows}.0);\n`;
                if (hasOffset) {
                    if (offsetAxis === 'row') {
                        s += `    _gu.x += mod(floor(_gu.y), 2.0) * ${offsetAmount};\n`;
                    } else if (offsetAxis === 'col') {
                        s += `    _gu.y += mod(floor(_gu.x), 2.0) * ${offsetAmount};\n`;
                    }
                }
                if (useRecursion) {
                    // Phase 4: Recursive grid — each outer cell holds an S×S inner
                    // sub-grid; tileOuterGap channels the outer cells into clusters.
                    // _cellId is the combined fine-grid index, so every per-cell
                    // effect varies per inner cell for free (§13.4 of tile-custom.md).
                    s += `    vec2 _outerId = clamp(floor(_gu), vec2(0.0), vec2(${gridCols}.0 - 1.0, ${gridRows}.0 - 1.0));\n`;
                    s += `    vec2 _outerUV = fract(_gu);\n`;
                    if (maskVar) {
                        s += `    ${maskVar} *= step(0.0, _gu.x) * step(_gu.x, ${gridCols}.0)\n`;
                        s += `                * step(0.0, _gu.y) * step(_gu.y, ${gridRows}.0);\n`;
                    }
                    if (tileOuterGap > 0) {
                        // Mask the outer-cell border; rescale the inner region to fill it.
                        s += `    { float _og = ${outerGapHalf};\n`;
                        if (maskVar) {
                            s += `      ${maskVar} *= step(_og, _outerUV.x) * step(_og, 1.0 - _outerUV.x)\n`;
                            s += `                  * step(_og, _outerUV.y) * step(_og, 1.0 - _outerUV.y);\n`;
                        }
                        s += `      if (1.0 - 2.0 * _og > 0.001) _outerUV = clamp((_outerUV - _og) / (1.0 - 2.0 * _og), 0.0, 1.0); }\n`;
                    }
                    s += `    vec2 _innerGu = _outerUV * ${tileSubdivide}.0;\n`;
                    if (dxVar && dyVar) {
                        s += `    vec2 ${dxVar} = dFdx(_gu) * ${recurDxScale}; vec2 ${dyVar} = dFdy(_gu) * ${recurDxScale};\n`;
                    }
                    s += `    vec2 ${cellIdVar} = _outerId * ${tileSubdivide}.0 + clamp(floor(_innerGu), 0.0, ${tileSubdivide}.0 - 1.0);\n`;
                    s += `    ${varName} = fract(_innerGu);\n`;
                } else {
                    if (dxVar && dyVar) {
                        s += `    vec2 ${dxVar} = dFdx(_gu); vec2 ${dyVar} = dFdy(_gu);\n`;
                    }
                    s += `    vec2 ${cellIdVar} = clamp(floor(_gu), vec2(0.0), vec2(${gridCols}.0 - 1.0, ${gridRows}.0 - 1.0));\n`;
                    if (maskVar) {
                        s += `    ${maskVar} *= step(0.0, _gu.x) * step(_gu.x, ${gridCols}.0)\n`;
                        s += `                * step(0.0, _gu.y) * step(_gu.y, ${gridRows}.0);\n`;
                    }
                    s += `    ${varName} = fract(_gu);\n`;
                }
                // Fit mode: preserve the image aspect inside each cell, transparent pad.
                if (tileFitMode === 'fit') {
                    s += `    { float _cellAR = aspect.y / max(aspect.x, 0.01) * ${gridRows}.0 / ${gridCols}.0;\n`;
                    s += `      float _sf = ${imgAsp} / _cellAR;\n`;
                    s += `      ${varName}.x = (${varName}.x - 0.5) * max(1.0 / _sf, 1.0) + 0.5;\n`;
                    s += `      ${varName}.y = (${varName}.y - 0.5) * max(_sf, 1.0) + 0.5;\n`;
                    if (maskVar) {
                        s += `      ${maskVar} *= step(0.0, ${varName}.x) * step(${varName}.x, 1.0)\n`;
                        s += `                  * step(0.0, ${varName}.y) * step(${varName}.y, 1.0);\n`;
                    }
                    s += `      ${varName} = clamp(${varName}, 0.0, 1.0); }\n`;
                }
            } else {
                s += `    ${varName}.x *= aspect.y;\n`;
                s += `    ${varName} /= ${sizeExpr};\n`;
                s += `    ${varName}.x /= aspect.y;\n`;
                // Capture smooth derivatives BEFORE fract so textureGrad picks the right mip level.
                // Without this, the UV jump at each tile edge (0.999→0.001) makes dFdx/dFdy huge
                // and the GPU samples the lowest mipmap, producing a visible seam line.
                if (dxVar && dyVar) {
                    s += `    vec2 ${dxVar} = dFdx(${varName}); vec2 ${dyVar} = dFdy(${varName});\n`;
                }
                // Phase 1: brick / half-drop offset. Computed BEFORE cell-id so the
                // cell hash reflects the staggered visible position (shifted-row cells
                // get unique IDs from non-shifted-row cells).
                if (hasOffset) {
                    if (offsetAxis === 'row') {
                        s += `    ${varName}.x += mod(floor(${varName}.y + 0.5), 2.0) * ${offsetAmount};\n`;
                    } else if (offsetAxis === 'col') {
                        s += `    ${varName}.y += mod(floor(${varName}.x + 0.5), 2.0) * ${offsetAmount};\n`;
                    }
                }
                // Phase 1: cell id captured BEFORE fract so per-cell hashes are stable.
                s += `    vec2 ${cellIdVar} = floor(${varName} + 0.5);\n`;
                s += `    ${varName} = fract(${varName} + 0.5);\n`;
            }
            // Per-tile / per-cell rotation block — emits whenever EITHER a base
            // per-tile spin is active OR per-cell rotation variance is set.
            // This way Group Spin (which makes perTileSpin=false) does NOT silently
            // disable Cell Rotate; the two compose cleanly:
            //   Group Spin = whole grid layout rotates
            //   Cell Rotate = each tile's contents rotates independently
            if (perTileSpin || hasRotVar) {
                s += `    { vec2 _tl = ${varName} - 0.5; _tl.x *= ${cellAspectExpr};\n`;
                s += `      float _localAng = ${perTileSpin ? '_spinAng' : '0.0'};\n`;
                if (hasRotVar) {
                    // Per-cell rotation: hash the cell id, add an angle.
                    // snap=on: variance is the *probability* a cell gets a random 90° quarter-turn.
                    // snap=off: variance scales a continuous 0..360° rotation per cell.
                    // seedVec offsets all hashes — seed=0 → vec2(0,0) → identical to pre-seed output.
                    s += `      float _ch = fract(sin(dot(${cellIdVar} + ${seedVec}, vec2(127.1, 311.7))) * 43758.5);\n`;
                    if (rotSnap) {
                        s += `      float _doRot = step(1.0 - ${rotVar}, fract(_ch * 7.17));\n`;
                        s += `      _localAng += floor(_ch * 4.0) * 1.5708 * _doRot;\n`;
                    } else {
                        s += `      _localAng += _ch * 6.28318 * ${rotVar};\n`;
                    }
                }
                s += `      float _ca = cos(_localAng); float _sa = sin(_localAng);\n`;
                s += `      _tl = vec2(_ca*_tl.x - _sa*_tl.y, _sa*_tl.x + _ca*_tl.y);\n`;
                s += `      _tl.x /= ${cellAspectExpr}; ${varName} = _tl + 0.5; }\n`;
            }
            // Phase 1 fix: when per-cell rotation is active, mask the rotated-out
            // corners. The rotated square's corners extend beyond [0,1] of the cell;
            // sampling there wraps the texture and shows a faint "duplicate" sliver
            // (the texture's opposite side). Mask those areas to alpha=0 instead,
            // letting the MilkDrop background show through cleanly.
            // Gated by hasRotVar so uniform Spin alone keeps its existing behaviour.
            if (hasRotVar && maskVar) {
                s += `    { float _rotMask = step(0.0, ${varName}.x) * step(${varName}.x, 1.0)\n`;
                s += `                     * step(0.0, ${varName}.y) * step(${varName}.y, 1.0);\n`;
                s += `      ${maskVar} *= _rotMask;\n`;
                s += `      ${varName} = clamp(${varName}, 0.0, 1.0); }\n`;
            }
            // Phase 2: Size Var + Jitter X/Y — unified object-space transform.
            // Both are applied in one pass so they compose correctly:
            //   texUV = (_u - jitterOffset - 0.5) * szF + 0.5
            // Applying them sequentially caused jitter to scroll the texture crop
            // rather than reposition the image object within the cell.
            if (hasSizeVar || hasJitterX || hasJitterY) {
                s += `    {\n`;
                // Size factor: 1.0 (no size var) → 1.0 + hash * variance (zoom-out only)
                if (hasSizeVar) {
                    s += `      float _szH = fract(sin(dot(${cellIdVar} + ${seedVec}, vec2(317.1, 227.7))) * 37158.5);\n`;
                    s += `      float _szF = 1.0 + _szH * ${sizeVar};\n`;
                } else {
                    s += `      float _szF = 1.0;\n`;
                }
                // Jitter offset in cell space (0.0 on unused axes)
                if (hasJitterX) {
                    s += `      float _jxH = fract(sin(dot(${cellIdVar} + ${seedVec}, vec2(419.2, 371.9))) * 28731.5);\n`;
                    s += `      float _jOx = (_jxH - 0.5) * ${jitterX};\n`;
                } else {
                    s += `      float _jOx = 0.0;\n`;
                }
                if (hasJitterY) {
                    s += `      float _jyH = fract(sin(dot(${cellIdVar} + ${seedVec}, vec2(153.7, 479.3))) * 52631.5);\n`;
                    s += `      float _jOy = (_jyH - 0.5) * ${jitterY};\n`;
                } else {
                    s += `      float _jOy = 0.0;\n`;
                }
                // Combined transform: shift to image-object space
                s += `      ${varName} = (${varName} - vec2(_jOx, _jOy) - 0.5) * _szF + 0.5;\n`;
                if (maskVar) {
                    s += `      float _objMask = step(0.0, ${varName}.x) * step(${varName}.x, 1.0)\n`;
                    s += `                     * step(0.0, ${varName}.y) * step(${varName}.y, 1.0);\n`;
                    s += `      ${maskVar} *= _objMask;\n`;
                }
                s += `      ${varName} = clamp(${varName}, 0.0, 1.0);\n`;
                s += `    }\n`;
            }
            // Phase 2: Depth variance — per-cell additional zoom factor.
            // Same mask fix as Size Var — out-of-bounds goes transparent, not wrapped.
            if (hasDepthVar) {
                s += `    { float _dvH = fract(sin(dot(${cellIdVar} + ${seedVec}, vec2(91.3, 137.1))) * 21943.5);\n`;
                s += `      float _dvF = 1.0 + (_dvH * 2.0 - 1.0) * ${depthVar} * 0.5;\n`;
                s += `      ${varName} = (${varName} - 0.5) * _dvF + 0.5;\n`;
                if (maskVar) {
                    s += `      float _dvMask = step(0.0, ${varName}.x) * step(${varName}.x, 1.0)\n`;
                    s += `                    * step(0.0, ${varName}.y) * step(${varName}.y, 1.0);\n`;
                    s += `      ${maskVar} *= _dvMask;\n`;
                }
                s += `      ${varName} = clamp(${varName}, 0.0, 1.0); }\n`;
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
        // Aspect mode (aspect-ratio.md): 'lock' (default) keeps the layer's true shape
        // on any canvas via factor aspect.y/aspect.x — a no-op on landscape (aspect.x=1),
        // un-squishing only on portrait. 'fluid' = legacy one-sided aspect.y (today's
        // behavior; lets the layer adapt/squish to the canvas in portrait).
        const aspFactor = img.aspectMode === 'fluid'
            ? 'aspect.y'
            : '(aspect.y / max(aspect.x, 0.01))';
        // Squash: beat-driven asymmetric scale. 'wide' (sign +1) stretches X and
        // crushes Y on the hit; 'tall' (sign -1) does the inverse. Folded into the
        // axis divisors so it composes with tileScaleX/Y. No-op when hasSquash=false.
        const _sqX = hasSquash ? ` * (1.0 + _r * ${squashAmpVal} * ${squashSign})` : '';
        const _sqY = hasSquash ? ` * (1.0 - _r * ${squashAmpVal} * ${squashSign})` : '';
        const aspectPreScale = (varName) => {
            let s = `    ${varName}.x /= ${imgAsp} * ${aspFactor}`;
            if (!tscXIsDefault) s += ` * ${tileScaleX}`;
            s += _sqX;
            s += `;\n`;
            if (!tscYIsDefault || hasSquash) {
                s += `    ${varName}.y /= ${tscYIsDefault ? '1.0' : tileScaleY}${_sqY};\n`;
            }
            return s;
        };

        // P0-B: sz wrapped with qSc multiplier (1.0 neutral → no-op when unanimated).
        const sizeBase = hasStrobe
            ? `(${sz} * ${_qSc}) * (1.0 ${pulseSign} _r * ${pu}) * mix(1.0, _strobeWave, ${stbAmp})`
            : `(${sz} * ${_qSc}) * (1.0 ${pulseSign} _r * ${pu})`;
        // Phase 3: audio size-modulation factor (Pulse + Strobe), extracted from
        // sizeBase without the base `sz`. Density divides _u by sizeBase; Grid mode
        // has no such divisor, so it folds this factor into the grid scale instead.
        // pu = 0 and no strobe → 1.0 → no-op (backward compatible).
        const pulseFactor = hasStrobe
            ? `((1.0 ${pulseSign} _r * ${pu}) * mix(1.0, _strobeWave, ${stbAmp}))`
            : `(1.0 ${pulseSign} _r * ${pu})`;

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
                m += `      _kang += time * ${kspd} * 6.28318;\n`;
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

        // Phase B (video-tiling-dev.md): stacked-alpha-aware texture sample for the
        // TILED paths. A stacked-alpha video is a 2×-tall texture — RGB in the top
        // half, alpha-as-luma in the bottom half — so we sample twice (top for colour,
        // bottom .r for alpha) and recombine into one vec4. The y-derivative is halved
        // because the sampled v is uv.y*0.5. For every other layer this is a plain
        // textureGrad. The non-tiled branch keeps its own inline composite (untouched).
        const sampleGrad = (uvE, dxE, dyE) => {
            if (!img.isStackedAlpha) return `textureGrad(${tex}, ${uvE}, ${dxE}, ${dyE})`;
            return (
                `vec4(textureGrad(${tex}, vec2((${uvE}).x, (${uvE}).y * 0.5), ` +
                `vec2((${dxE}).x, (${dxE}).y * 0.5), vec2((${dyE}).x, (${dyE}).y * 0.5)).rgb, ` +
                `textureGrad(${tex}, vec2((${uvE}).x, (${uvE}).y * 0.5 + 0.5), ` +
                `vec2((${dxE}).x, (${dxE}).y * 0.5), vec2((${dyE}).x, (${dyE}).y * 0.5)).r)`
            );
        };

        // Phase 2.5: Scatter sample — neighbour-accumulation tile renderer.
        // Replaces the single-cell fract() sample. `_u` arrives in field UV; this
        // converts it to continuous grid coordinates (1 unit = 1 cell), then every
        // fragment scans the 3×3 block of cells around it. For each neighbour cell
        // it computes that cell's jittered/scaled/rotated placement and, where the
        // fragment lands inside that tile, composites it. Tiles therefore move
        // freely past cell edges and overlap — no clipping container. All per-cell
        // effects (size/depth/rotation/popcorn/opacity/spacing/radius/mirror) are
        // applied inside the loop keyed to the neighbour's cell id. Produces vec4 _t.
        const buildScatterSample = () => {
            let s = '';
            // Field UV → continuous grid coordinates (1 unit = 1 cell, integers = cell centres)
            if (useGrid) {
                // Phase 3: Grid mode — explicit COLS×ROWS. Shift by -0.5 so cell
                // centres land on integers, matching the density convention below.
                // Phase 4: scatter + recursion → treat as a flat fine grid
                // Cols·S × Rows·S; tileOuterGap is ignored when jitter is active
                // (documented limitation — §13.5 of tile-custom.md).
                s += `    _u = (_u / max(${gridScale} * ${pulseFactor}, 0.05) + 0.5) * vec2(${gridCols * tileSubdivide}.0, ${gridRows * tileSubdivide}.0) - 0.5;\n`;
            } else {
                s += `    _u.x *= aspect.y;\n`;
                s += `    _u /= ${sizeBase};\n`;
                s += `    _u.x /= aspect.y;\n`;
            }
            // Brick / half-drop offset — shifts which cell a fragment falls in
            if (hasOffset) {
                if (offsetAxis === 'row') {
                    s += `    _u.x += mod(floor(_u.y + 0.5), 2.0) * ${offsetAmount};\n`;
                } else if (offsetAxis === 'col') {
                    s += `    _u.y += mod(floor(_u.x + 0.5), 2.0) * ${offsetAmount};\n`;
                }
            }
            s += `    vec2 _homeCell = floor(_u + 0.5);\n`;
            // Derivatives captured OUTSIDE the loop (dFdx is illegal in non-uniform flow)
            s += `    vec2 _sdx = dFdx(_u); vec2 _sdy = dFdy(_u);\n`;
            s += `    vec4 _scAccum = vec4(0.0);\n`;
            s += `    for (int _ny = -1; _ny <= 1; _ny++) {\n`;
            s += `    for (int _nx = -1; _nx <= 1; _nx++) {\n`;
            s += `      vec2 _C = _homeCell + vec2(float(_nx), float(_ny));\n`;
            // Per-cell jitter offset (0 on an inactive axis)
            s += `      float _jxH = fract(sin(dot(_C + ${seedVec}, vec2(419.2, 371.9))) * 28731.5);\n`;
            s += `      float _jyH = fract(sin(dot(_C + ${seedVec}, vec2(153.7, 479.3))) * 52631.5);\n`;
            s += `      vec2 _jOff = vec2((_jxH - 0.5) * ${hasJitterX ? jitterX : '0.0'}, (_jyH - 0.5) * ${hasJitterY ? jitterY : '0.0'});\n`;
            // Per-cell scale factor: size variance (zoom-out only) × depth variance (±)
            s += `      float _szF = 1.0;\n`;
            if (hasSizeVar) {
                s += `      { float _szH = fract(sin(dot(_C + ${seedVec}, vec2(317.1, 227.7))) * 37158.5);\n`;
                s += `        _szF *= 1.0 + _szH * ${sizeVar}; }\n`;
            }
            if (hasDepthVar) {
                // Zoom-out only in scatter mode: keeps every tile's footprint ≤ 1 cell
                // so the 3×3 neighbour scan always covers it (jitter ≤ 1 + szF ≥ 1).
                s += `      { float _dvH = fract(sin(dot(_C + ${seedVec}, vec2(91.3, 137.1))) * 21943.5);\n`;
                s += `        _szF *= 1.0 + _dvH * ${depthVar}; }\n`;
            }
            // Fragment position relative to this cell's centre, scaled
            s += `      vec2 _lc = (_u - _C - _jOff) * _szF;\n`;
            // Per-cell rotation (uniform per-tile spin + hashed variance)
            if (perTileSpin || hasRotVar) {
                s += `      { _lc.x *= ${cellAspectExpr};\n`;
                s += `        float _localAng = ${perTileSpin ? '_spinAng' : '0.0'};\n`;
                if (hasRotVar) {
                    s += `        float _ch = fract(sin(dot(_C + ${seedVec}, vec2(127.1, 311.7))) * 43758.5);\n`;
                    if (rotSnap) {
                        s += `        float _doRot = step(1.0 - ${rotVar}, fract(_ch * 7.17));\n`;
                        s += `        _localAng += floor(_ch * 4.0) * 1.5708 * _doRot;\n`;
                    } else {
                        s += `        _localAng += _ch * 6.28318 * ${rotVar};\n`;
                    }
                }
                s += `        float _ca = cos(_localAng); float _sa = sin(_localAng);\n`;
                s += `        _lc = vec2(_ca * _lc.x - _sa * _lc.y, _sa * _lc.x + _ca * _lc.y);\n`;
                s += `        _lc.x /= ${cellAspectExpr}; }\n`;
            }
            s += `      vec2 _luv = _lc + 0.5;\n`;
            // Phase 3: Grid Fit — preserve image aspect inside the cell. Padding
            // pixels land outside [0,1] and are dropped by the coverage test below.
            if (useGrid && tileFitMode === 'fit') {
                s += `      { float _cellAR = aspect.y / max(aspect.x, 0.01) * ${gridRows}.0 / ${gridCols}.0;\n`;
                s += `        float _sf = ${imgAsp} / _cellAR;\n`;
                s += `        _luv.x = (_luv.x - 0.5) * max(1.0 / _sf, 1.0) + 0.5;\n`;
                s += `        _luv.y = (_luv.y - 0.5) * max(_sf, 1.0) + 0.5; }\n`;
            }
            // Per-tile mirror fold
            s += applyMirrorUV('_luv');
            // Coverage: is this fragment inside the tile's [0,1] footprint?
            s += `      float _cov = step(0.0, _luv.x) * step(_luv.x, 1.0) * step(0.0, _luv.y) * step(_luv.y, 1.0);\n`;
            // Spacing gap — mask the border, rescale so the image fills the inner area
            if (parseFloat(spc) > 0) {
                s += `      { float _sg = ${spc} * 0.5;\n`;
                s += `        _cov *= step(_sg, _luv.x) * step(_sg, 1.0 - _luv.x) * step(_sg, _luv.y) * step(_sg, 1.0 - _luv.y);\n`;
                s += `        if (1.0 - 2.0 * _sg > 0.001) _luv = clamp((_luv - _sg) / (1.0 - 2.0 * _sg), 0.0, 1.0); }\n`;
            }
            // Per-tile rounded-corner radius
            if (hasRadius) {
                s += `      { vec2 _rq = abs(_luv - 0.5) - (0.5 - ${rad});\n`;
                s += `        float _rd2 = length(max(_rq, 0.0)) + min(max(_rq.x, _rq.y), 0.0) - ${rad};\n`;
                s += `        _cov *= 1.0 - smoothstep(-0.004, 0.004, _rd2); }\n`;
            }
            // Sample — mip derivatives scaled by this cell's zoom factor
            s += `      vec2 _suvc = clamp(_luv, 0.0, 1.0); vec2 _sdxz = _sdx * _szF; vec2 _sdyz = _sdy * _szF;\n`;
            s += `      vec4 _sc = ${sampleGrad('_suvc', '_sdxz', '_sdyz')};\n`;
            s += `      vec3 _scol = _sc.xyz;\n`;
            s += `      float _a = _sc.w * _cov;\n`;
            // Phase 3: Grid mode is finite — drop neighbour cells outside the grid.
            if (useGrid) {
                s += `      _a *= step(0.0, _C.x) * step(_C.x, ${gridCols * tileSubdivide}.0 - 1.0)\n`;
                s += `          * step(0.0, _C.y) * step(_C.y, ${gridRows * tileSubdivide}.0 - 1.0);\n`;
            }
            // Per-cell popcorn — hashed audio brightness pulse
            if (hasPopcorn) {
                s += `      { float _pcH = fract(sin(dot(_C, vec2(269.5, 183.3))) * 43758.5);\n`;
                s += `        float _pcM = 0.5 + 0.5 * sin(time * 6.0 + _pcH * 6.28318);\n`;
                s += `        _scol *= 1.0 + _r * 1.8 * ${popcornAmt} * _pcM; }\n`;
            }
            // Per-cell opacity variance — applied to coverage alpha (true transparency)
            if (hasOpacityVar) {
                s += `      { float _ovH = fract(sin(dot(_C + ${seedVec}, vec2(421.7, 183.1))) * 31415.9);\n`;
                s += `        _a *= 1.0 - _ovH * ${opacityVar}; }\n`;
            }
            // Composite "over" — later neighbour wins where tiles overlap
            s += `      _scAccum.xyz = _scAccum.xyz * (1.0 - _a) + _scol * _a;\n`;
            s += `      _scAccum.w = _scAccum.w * (1.0 - _a) + _a;\n`;
            s += `    }}\n`;
            s += `    vec4 _t = _scAccum;\n`;
            return s;
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
                applyTileUV('_uA', `${sizeBase} * _tz1`, '_gapMaskA', '_dxA', '_dyA', '_cellIdA') +
                applyMirrorUV('_uA') +
                applyRadius('_uA', '_gapMaskA') +
                `    vec2 _uB = _u;\n` +
                aspectPreScale('_uB') +
                applyTileUV('_uB', `${sizeBase} * _tz2`, '_gapMaskB', '_dxB', '_dyB', '_cellIdB') +
                applyMirrorUV('_uB') +
                applyRadius('_uB', '_gapMaskB');
            sampleLine =
                `    vec4 _tA = ${sampleGrad('_uA', '_dxA', '_dyA')};\n` +
                `    vec4 _tB = ${sampleGrad('_uB', '_dxB', '_dyB')};\n` +
                `    vec4 _t = mix(_tA, _tB, _tf);\n` +
                `    float _gapMask = mix(_gapMaskA, _gapMaskB, _tf);\n`;
        } else if (useScatter) {
            // Phase 2.5: Scatter path — free per-cell jitter + tile overlap.
            // buildScatterSample owns the texture sample (3×3 neighbour loop), so
            // it declares vec4 _t itself; sampleLine stays empty.
            pipeline = groupSpinLines +
                applySkew('_u') +
                applyPersp('_u') +
                `    float _gapMask = 1.0;\n` +
                (useGrid ? '' : aspectPreScale('_u')) +
                buildScatterSample();
            sampleLine = '';
        } else if (img.tile) {
            // Plain tiled — group spin rotates field first, then tile (with optional per-tile spin)
            // Opaque video tiles here too (Phase A); stacked-alpha video tiling is Phase B.
            pipeline = groupSpinLines +
                applySkew('_u') +
                applyPersp('_u') +
                `    float _gapMask = 1.0;\n` +
                (useGrid ? '' : aspectPreScale('_u')) +
                applyTileUV('_u', sizeBase, '_gapMask', '_dx', '_dy') +
                applyMirrorUV('_u') +
                applyRadius('_u', '_gapMask');
            sampleLine = `    vec4 _t = ${sampleGrad('_u', '_dx', '_dy')};\n`;
        } else {
            // Non-tiled: show single instance (no fract wrapping)
            // aspectPreScale handles aspect ratio + tileScaleX/Y (width/height for videos)
            // Center (_u=0) is never affected by any divisor — no drift possible
            const rotLines = hasSpin
                ? `    float _ca = cos(_spinAng); float _sa = sin(_spinAng);\n` +
                `    _u = vec2(_ca*_u.x - _sa*_u.y, _sa*_u.x + _ca*_u.y);\n`
                : '';
            pipeline =
                `    float _gapMask = 1.0;\n` +
                aspectPreScale('_u') +
                `    _u /= ${sizeBase};\n` +
                rotLines +
                applySkew('_u') +
                applyPersp('_u') +
                `    vec2 _uInstanced = _u + 0.5;\n` +
                `    float _rd = 0.0;\n` +
                `    { vec2 _rq = abs(_uInstanced - 0.5) - (0.5 - ${rad});\n` +
                `      _rd = length(max(_rq, 0.0)) + min(max(_rq.x, _rq.y), 0.0) - ${rad};\n` +
                `      _gapMask = 1.0 - smoothstep(-0.004, 0.004, _rd); }\n` +
                `    _u = clamp(_uInstanced, 0.0, 1.0);\n` +
                applyMirrorUV('_u');
            // Stacked-alpha texture is 2× tall: top half is RGB, bottom half is
            // alpha-as-luma. Sample top half for color, bottom-half R for alpha.
            // For non-stacked layers this is the standard single sample.
            sampleLine = img.isStackedAlpha
                ? `    vec4 _t = vec4(texture(${tex}, vec2(_u.x, _u.y * 0.5)).rgb, texture(${tex}, vec2(_u.x, _u.y * 0.5 + 0.5)).r);\n`
                : `    vec4 _t = texture(${tex}, _u);\n`;
        }

        // Chromatic aberration: generate offset UV sampling based on which mode we're in
        // Scatter mode owns the texture sample inside its loop; these post-/pre-sample
        // resample effects assume a single `_u` UV and are deferred when scatter is on.
        const chromaticLines = (hasChromatic && !useScatter)
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

        // Wave distort: sinusoidal UV warp applied just before texture sample
        const waveLines = (hasWave && !useScatter)
            ? (() => {
                // Warp both axes with slightly different freq/phase for organic look.
                // Amplitude is modulated by _r (audio signal) for beat-reactive waves.
                const ampExpr = `${waveAmp} * 0.1 * (1.0 + _r * 0.5)`;
                if (hasTunnel) {
                    // Tunnel: warp each tile layer's UV independently
                    return (
                        `    { float _wAmp = ${ampExpr};\n` +
                        `      _uA.x += sin(_uA.y * ${waveFreq} + time * 2.0) * _wAmp;\n` +
                        `      _uA.y += sin(_uA.x * ${waveFreq} * 0.7 + time * 1.3) * _wAmp;\n` +
                        `      _uA = clamp(_uA, 0.0, 1.0);\n` +
                        `      _uB.x += sin(_uB.y * ${waveFreq} + time * 2.0) * _wAmp;\n` +
                        `      _uB.y += sin(_uB.x * ${waveFreq} * 0.7 + time * 1.3) * _wAmp;\n` +
                        `      _uB = clamp(_uB, 0.0, 1.0); }\n`
                    );
                }
                return (
                    `    { float _wAmp = ${ampExpr};\n` +
                    `      _u.x += sin(_u.y * ${waveFreq} + time * 2.0) * _wAmp;\n` +
                    `      _u.y += sin(_u.x * ${waveFreq} * 0.7 + time * 1.3) * _wAmp;\n` +
                    `      _u = clamp(_u, 0.0, 1.0); }\n`
                );
            })()
            : '';

        // Pixelate: quantize UV into blocks before texture sample
        const pixelateLines = (hasPixelate && !useScatter)
            ? (() => {
                // Map 0–1 slider to 4–128 blocks (low slider = subtle, high = chunky)
                const blocks = `mix(128.0, 4.0, ${pixelateAmt})`;
                if (hasTunnel) {
                    return (
                        `    { float _pxB = ${blocks};\n` +
                        `      _uA = floor(_uA * _pxB) / _pxB;\n` +
                        `      _uB = floor(_uB * _pxB) / _pxB; }\n`
                    );
                }
                return `    { float _pxB = ${blocks}; _u = floor(_u * _pxB) / _pxB; }\n`;
            })()
            : '';

        return (
            `  {\n` +
            reactLines +
            angLines +
            centerLines +
            pipeline +
            waveLines +
            pixelateLines +
            sampleLine +
            chromaticLines +
            `    vec3 _src = _t.xyz;\n` +
            // Phase 1: Per-cell popcorn — modulate this cell's brightness with a
            // hashed phase so cells dance on different beats. Uses _cellIdA in
            // tunnel mode (the closer of the two zoom layers), _cellId otherwise.
            (hasPopcorn && !useScatter ? (() => {
                const pcCell = hasTunnel ? '_cellIdA' : '_cellId';
                return (
                    `    { float _pcH = fract(sin(dot(${pcCell}, vec2(269.5, 183.3))) * 43758.5);\n` +
                    `      float _pcM = 0.5 + 0.5 * sin(time * 6.0 + _pcH * 6.28318);\n` +
                    `      _src *= 1.0 + _r * 1.8 * ${popcornAmt} * _pcM; }\n`
                );
            })() : '') +
            // Phase 2: Per-cell opacity variance — each cell fades to a different opacity.
            // Uses _cellIdA in tunnel mode (closer zoom layer), _cellId otherwise.
            // Multiplies _src directly so it composes cleanly with popcorn above.
            (hasOpacityVar && !useScatter ? (() => {
                const opCell = hasTunnel ? '_cellIdA' : '_cellId';
                return (
                    `    { float _ovH = fract(sin(dot(${opCell} + ${seedVec}, vec2(421.7, 183.1))) * 31415.9);\n` +
                    `      _src *= 1.0 - _ovH * ${opacityVar}; }\n`
                );
            })() : '') +
            // Blur: 5-tap cross re-sample using texture-space pixel step baked at build time
            (hasBlur && !useScatter ? (() => {
                const bsuv = hasTunnel ? `mix(_uA, _uB, _tf)` : `_u`;
                // P0-B: blurAmt + qBlur (0.0 neutral → no-op when unanimated).
                // Blur Pulse adds a beat-driven focus pull (`_r * blurPulse`).
                const _blurPulsePart = hasBlurPulse ? ` + _r * ${blurPulseVal}` : '';
                const bscale = `(${blurAmt} + ${_qBlur}${_blurPulsePart}) * 15.0`;
                return (
                    `    { vec2 _bluv = ${bsuv};\n` +
                    `      float _bx = ${edgeStepX} * ${bscale}; float _by = ${edgeStepY} * ${bscale};\n` +
                    `      _src = (_src + texture(${tex}, clamp(_bluv+vec2(_bx,0.),0.,1.)).xyz\n` +
                    `             + texture(${tex}, clamp(_bluv+vec2(-_bx,0.),0.,1.)).xyz\n` +
                    `             + texture(${tex}, clamp(_bluv+vec2(0.,_by),0.,1.)).xyz\n` +
                    `             + texture(${tex}, clamp(_bluv+vec2(0.,-_by),0.,1.)).xyz) * 0.2; }\n`
                );
            })() : '') +
            (hasEdge && !useScatter ? (() => {
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
                if (parseFloat(hueSpin) !== 0 || hasHuePulse) {
                    // Rotate hue over time using RGB rotation matrix approximation.
                    // Hue Pulse adds a beat-driven offset (`_r * huePulse`, full 360° at 1.0)
                    // on top of any continuous Hue Spin.
                    const _hueAngExpr = hasHuePulse
                        ? `(time * ${hueSpin} + _r * ${huePulseVal}) * 6.28318`
                        : `time * ${hueSpin} * 6.28318`;
                    return (
                        `    { float _ha = ${_hueAngExpr};\n` +
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
            // Invert: blend between normal and inverted colors
            (hasInvert ? `    _src = mix(_src, 1.0 - _src, ${invertMix});\n` : '') +
            // Solarize: tone-curve fold (4x(1-x)), blended by amount
            (hasSolarize ? `    _src = mix(_src, _src * (1.0 - _src) * 4.0, ${solarizeMix});\n` : '') +
            // Threshold: binary B&W at luminance cutoff, audio-reactive shift
            (hasThreshold ? `    { float _tLum = dot(_src, vec3(0.299, 0.587, 0.114)); _src = vec3(step(${threshCut} - _r * 0.2, _tLum)); }\n` : '') +
            // Scan Lines: horizontal CRT bands darkening
            (hasScanLines ? `    _src *= 1.0 - ${scanLinesAmt} * 0.5 * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159));\n` : '') +
            // Film Grain: animated hash-based noise overlay
            (hasFilmGrain ? `    { float _gn = fract(sin(dot(uv + fract(time * 0.1), vec2(12.9898, 78.233))) * 43758.5453); _src += (_gn - 0.5) * ${filmGrainAmt} * 0.4; }
` : '') +
            // Color grading — brightness, contrast, gamma, fade, colorTemp, sepia, shadows, highlights, lift, gain, tintMG (all layer types)
            (() => {
                const br = (img.brightness || 1.0).toFixed(4);
                const ct = (img.contrast || 1.0).toFixed(4);
                const gm = (img.gamma || 1.0).toFixed(4);
                const fd = (img.fade || 0.0).toFixed(4);
                const tp = (img.colorTemp || 0.0).toFixed(4);
                const sp = (img.sepia || 0.0).toFixed(4);
                const sh = (img.shadows || 0.0).toFixed(4);
                const hl = (img.highlights || 0.0).toFixed(4);
                const lf = (img.lift || 0.0).toFixed(4);
                const gn = (img.gain || 0.0).toFixed(4);
                const mg = (img.tintMG || 0.0).toFixed(4);
                const hasBr = parseFloat(br) !== 1.0;
                const hasCt = parseFloat(ct) !== 1.0;
                const hasGm = parseFloat(gm) !== 1.0;
                const hasFd = parseFloat(fd) > 0.001;
                const hasTp = Math.abs(parseFloat(tp)) > 0.001;
                const hasSp = parseFloat(sp) > 0.001;
                const hasSh = Math.abs(parseFloat(sh)) > 0.001;
                const hasHl = Math.abs(parseFloat(hl)) > 0.001;
                const hasLf = Math.abs(parseFloat(lf)) > 0.001;
                const hasGn = Math.abs(parseFloat(gn)) > 0.001;
                const hasMG = Math.abs(parseFloat(mg)) > 0.001;
                if (!hasBr && !hasCt && !hasGm && !hasFd && !hasTp && !hasSp && !hasSh && !hasHl && !hasLf && !hasGn && !hasMG) return '';
                let s = '';
                // Brightness: multiply
                if (hasBr) s += `    _src *= ${br};\n`;
                // Contrast: (value - 0.5) * contrast + 0.5
                if (hasCt) s += `    _src = (_src - 0.5) * ${ct} + 0.5;\n`;
                // Gamma: pow(value, gamma)
                if (hasGm) s += `    _src = pow(max(_src, 0.0), vec3(${gm}));\n`;
                // Fade: lift black point for faded/vintage film look
                if (hasFd) s += `    _src = _src * (1.0 - ${fd}) + vec3(${fd});\n`;
                // Color Temperature: warm (positive) shifts R up/B down; cool (negative) shifts B up/R down
                if (hasTp) s += `    { float _ct = ${tp}; _src = clamp(_src + vec3(_ct, 0.0, -_ct) * 0.15, 0.0, 1.0); }\n`;
                // Sepia: blend toward classic warm sepia tone
                if (hasSp) s += `    { vec3 _sep = vec3(dot(_src,vec3(0.393,0.769,0.189)),dot(_src,vec3(0.349,0.686,0.168)),dot(_src,vec3(0.272,0.534,0.131))); _src = mix(_src,_sep,${sp}); }\n`;
                // Shadows: luma-weighted add to dark areas
                if (hasSh) s += `    { float _sl = dot(_src,vec3(0.299,0.587,0.114)); _src = clamp(_src + ${sh}*max(0.,0.5-_sl)*2., 0., 1.); }\n`;
                // Highlights: luma-weighted add to bright areas
                if (hasHl) s += `    { float _sl = dot(_src,vec3(0.299,0.587,0.114)); _src = clamp(_src + ${hl}*max(0.,_sl-0.5)*2., 0., 1.); }\n`;
                // Lift: shadow bias — additive offset weighted toward darks
                if (hasLf) s += `    { float _sl = dot(_src,vec3(0.299,0.587,0.114)); _src = clamp(_src + ${lf}*(1.-_sl), 0., 1.); }\n`;
                // Gain: highlight boost — multiplicative offset weighted toward lights
                if (hasGn) s += `    { float _sl = dot(_src,vec3(0.299,0.587,0.114)); _src = clamp(_src*(1.+${gn}*_sl), 0., 1.); }\n`;
                // Tint M/G: magenta/green color balance axis
                // Pre-negate in JS to avoid --literal in GLSL (invalid syntax when mg is negative)
                if (hasMG) { const nmg = (-parseFloat(mg)).toFixed(4); s += `    { _src = clamp(_src + vec3(${nmg},${mg},${nmg})*0.15, 0., 1.); }\n`; }
                return s;
            })() +
            // Luma Key: darken-below-lo and brighten-above-hi thresholds cut alpha
            (hasLumaKey ? (() => {
                let lk = `    { float _luma = dot(_src, vec3(0.299, 0.587, 0.114));\n`;
                if (parseFloat(lumaKeyLo) > 0.001) {
                    lk += `      _t.w *= smoothstep(0.0, ${lumaKeyLo}, _luma);\n`;
                }
                if (parseFloat(lumaKeyHi) > 0.001) {
                    const hiThresh = (1.0 - parseFloat(lumaKeyHi)).toFixed(4);
                    lk += `      _t.w *= 1.0 - smoothstep(${hiThresh}, 1.0, _luma);\n`;
                }
                lk += `    }\n`;
                return lk;
            })() : '') +
            // P0-B: op multiplied by qOp (1.0 neutral → no-op when unanimated).
            (img.alphaMode === 'preserve'
                ? `    float _alphaMask = step(0.1, _t.w);\n    float _op = _alphaMask * _gapMask * clamp((${op} * ${_qOp}) + _r * ${opa}, 0.0, 1.0);\n`
                : `    float _op = _t.w * _gapMask * clamp((${op} * ${_qOp}) + _r * ${opa}, 0.0, 1.0);\n`) +
            `    ${blendLine}\n` +
            // Transparent-bg (§H): accumulate this layer's alpha into col_a using
            // the SAME coverage the RGB blend used (_t.w*_op for normal; _op for the
            // others, which already fold _t.w into _op). "over" compositing.
            (trackAlpha ? `    col_a = col_a + (${img.blendMode === 'normal' ? '_t.w * _op' : '_op'}) * (1.0 - col_a);\n` : '') +
            // Video border ring: drawn outside video edge using signed distance _rd.
            // _rd only exists in the single-instance (non-tiled) branch, so the border
            // is single-instance only — a per-tile border is video-tiling-dev.md §7 backlog.
            (isVideo && !img.tile && (img.vidBorderWidth || 0) > 0.001 ? (() => {
                const bw = (img.vidBorderWidth || 0).toFixed(4);
                const bf = `max(${(img.vidBorderFeather || 0).toFixed(4)} * 0.04, 0.002)`;
                const hex = img.vidBorderColor || '#ffffff';
                const br = (parseInt(hex.slice(1,3),16)/255).toFixed(4);
                const bg = (parseInt(hex.slice(3,5),16)/255).toFixed(4);
                const bb = (parseInt(hex.slice(5,7),16)/255).toFixed(4);
                return (
                    `    { float _bf = ${bf};\n` +
                    `      float _bOuter = 1.0 - smoothstep(${bw} - _bf, ${bw} + _bf, _rd);\n` +
                    `      float _bMask = _bOuter * (1.0 - _gapMask);\n` +
                    `      col = mix(col, vec3(${br}, ${bg}, ${bb}), _bMask); }\n`
                );
            })() : '') +
            // Screen overlay: applied immediately after this layer blends in,
            // so layers stacked above will render on top of it.
            (!img.vignette ? '' : (() => {
                const vCX = (img.vignetteCX ?? 0.5).toFixed(4);
                const vCY = (img.vignetteCY ?? 0.5).toFixed(4);
                const vW  = (img.vignetteW  ?? 0.5).toFixed(4);
                const vH  = (img.vignetteH  ?? 0.5).toFixed(4);
                const vCorner   = (img.vignetteCorner   ?? 0.3).toFixed(4);
                const vStrength = (img.vignetteStrength ?? 0.5).toFixed(4);
                const vFeather  = (img.vignetteFeather  ?? 0.3).toFixed(4);
                const vColor = img.vignetteColor || '#000000';
                const vR = (parseInt(vColor.slice(1,3),16)/255).toFixed(4);
                const vG = (parseInt(vColor.slice(3,5),16)/255).toFixed(4);
                const vB = (parseInt(vColor.slice(5,7),16)/255).toFixed(4);
                return `    { vec2 _vsuv = uv; float _vsx = ${vCX}; float _vsy = ${vCY}; float _vsw = ${vW} * 0.7; float _vsh = ${vH} * 0.7; float _vsc = ${vCorner} * min(_vsw, _vsh); float _vsf = ${vFeather} * 0.3 + 0.001; vec2 _vsd = abs(vec2(_vsuv.x - _vsx, _vsuv.y - _vsy)); vec2 _vsb = _vsd - vec2(_vsw, _vsh) + _vsc; float _vsdf = length(max(_vsb, 0.0)) + min(max(_vsb.x, _vsb.y), 0.0) - _vsc; float _vsa = smoothstep(-_vsf, _vsf, -_vsdf); col = mix(col, vec3(${vR}, ${vG}, ${vB}), _vsa * ${vStrength}); }\n`;
            })()) +
            `  }\n`
        );
    }


    _syncAllControls() {
        this._syncColorSwatches();
        this._syncFlowStyle();
        this._syncImageWarpSection();
        this._syncMotionEngine();
        this._renderShapeCards();
        this._syncMotionSliders();
        this._syncMotionReact();
        this._syncWaveReact();
        this._syncWaveControls();
        this._syncEchoOrient();
        this._syncPaletteSliders();
        this._syncFeelSliders();
        this._syncSolidFx();
        this._syncBgField();
        this._syncGradeReact();
        this._syncSceneFx();
        this._syncToggle('toggle-invert', 'invert');
        this._syncToggle('toggle-darken', 'darken');
        this._syncToggle('toggle-brighten-fx', 'brighten');
        this._syncToggle('toggle-solarize', 'solarize');
    }

    _syncPaletteSliders() {
        this._syncSlider('ps-opacity', this.currentState.paletteOpacity ?? 1.0, 0, 1.0, 2);
        const bv = this.currentState.baseVals;
        this._syncSlider('ps-glow-strength', bv.studio_glow ?? 0, 0, 1.0, 2);
        this._syncSlider('ps-accent-strength', bv.studio_accent ?? 0, 0, 1.0, 2);
        this._syncSlider('ps-decay', bv.decay, 0.85, 0.999, 3);
        this._syncTrailSlider();   // shapes-section Trail mirrors the same decay (curved)
        this._syncSlider('ps-ob-size', bv.ob_size, 0, 0.1, 3);
        this._syncSlider('ps-ob-a', bv.ob_a, 0, 1.0, 2);
        this._syncSlider('ps-ib-size', bv.ib_size, 0, 0.1, 3);
        this._syncSlider('ps-ib-a', bv.ib_a, 0, 1.0, 2);
        this._syncSlider('ps-wavefade', bv.modwavealphabyvolume, 0, 2.0, 2);
        this._syncSlider('ps-saturation', bv.studio_saturation ?? 1.0, 0, 2.0, 2);
        this._syncSlider('ps-hue', bv.studio_hue_rotate ?? 0, 0, 360, 0);
        this._syncSlider('ps-color-roll', bv.studio_hue_roll ?? 0, 0, 1.5, 2);
        this._syncSlider('ps-brightness', bv.studio_brightness ?? 1.0, 0.5, 2.0, 2);
        this._syncSlider('ps-contrast', bv.studio_contrast ?? 1.0, 0.5, 2.0, 2);
        this._syncSlider('ps-gamma', bv.studio_gamma ?? 1.0, 0.4, 2.5, 2);
        this._syncSlider('ps-temp', bv.studio_temp ?? 0, -0.3, 0.3, 2);
        this._syncClubMode();  // §18 — Club / Dark Mode slider
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
    // ⚠️ PERSISTENCE BOUNDARY ⚠️
    // If you add a `this._foo` instance variable on EditorInspector that affects
    // RENDERING (comp shader, baseVals, image textures, butterchurn state), you
    // MUST persist it here AND restore it in `loadPresetData`. Otherwise saved
    // presets reload missing that state and the user sees a regression that's
    // invisible until they hit the specific configuration.
    //
    // Burned 1.5 days on `_solidColor` not being persisted (May 14 2026). See
    // memory: project_solidcolor_persistence.md and apng-dev.md "Black-background-
    // on-reload fix" section.
    //
    // Already covered:
    //   - currentState.* — round-trips via the spread below
    //   - _imagesOnly   — round-trips via currentState.imagesOnly
    //   - _imageTextures — repopulated on layer mount during load
    //   - _baseComp     — internal cache, rebuilt by _buildCompShader
    //   - _solidColor   — persisted explicitly below
    saveCurrent(name, id, thumbDataUrl = null) {
        const presetNameInput = document.getElementById('preset-name-input');
        if (presetNameInput) presetNameInput.value = name;

        // Phase 2: bump tileVarianceSeed for any unlocked layers on each save.
        // Locked layers (default) keep their seed frozen for deterministic Timeline playback.
        this.currentState.images.forEach(img => {
            if (img.tileVarianceSeed !== undefined && !img.tileVarianceSeedLocked) {
                img.tileVarianceSeed = (img.tileVarianceSeed + 1) % 10000;
            }
        });

        const data = {
            name,
            ...this.currentState,
            // Instance var, not part of currentState — drives _buildCompShader's
            // solid-color vs sampler_main branch. See PERSISTENCE BOUNDARY above.
            solidColor: this._solidColor,
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
            mirror: 'none', mirrorScope: 'tile', kaleidoSpeed: 0.00,
            isGif: false, gifSpeed: 1.0, gifStability: 0.0, alphaMode: 'fade',
            reactSource: 'bass', reactCurve: 'linear',
            orbitMode: 'circle', lissFreqX: 0.50, lissFreqY: 0.75, lissPhase: 0.25,
            strobeAmp: 0.00, strobeThr: 0.40,
            // Beat-reactive effects (animation-dev.md B1') — 0/neutral → old presets unchanged
            tiltAmp: 0.00, tiltDir: 1, hopAmp: 0.00, hopDir: 1,
            huePulse: 0.00, blurPulse: 0.00, squashAmp: 0.00, squashAxis: 'wide',
            chromaticAberration: 0.00, chromaticSpeed: 1.0,
            tileScaleX: 1.00, tileScaleY: 1.00,
            aspectMode: 'lock',   // 'lock' = keep true shape on any canvas (default); 'fluid' = legacy canvas-adaptive

            angle: 0.00, skewX: 0.00, skewY: 0.00, shakeAmp: 0.00, posterize: 0, depthOffset: 0.00, edgeSobel: false, lumaKeyLo: 0.00, lumaKeyHi: 0.00, waveAmp: 0.00, waveFreq: 4.0, invertMix: 0.00, solarizeMix: 0.00, thresholdCutoff: 0.00, pixelate: 0.00, scanLines: 0.00, filmGrain: 0.00, perspX: 0.00, perspY: 0.00,
            vignette: 0, vignetteCX: 0.5, vignetteCY: 0.5, vignetteW: 0.5, vignetteH: 0.5, vignetteCorner: 0.3, vignetteStrength: 0.5, vignetteFeather: 0.3, vignetteColor: '#000000',
            audioPulse: 0.00, pulseInvert: false,
            blendMode: 'overlay', tile: true, groupSpin: false,
            hueSpinSpeed: 0.00, imageSaturation: 1.00, imageHue: 0, brightness: 1.0, contrast: 1.0, gamma: 1.0, fade: 0.0, colorTemp: 0.0, sepia: 0.0, blur: 0.0, shadows: 0.0, highlights: 0.0, lift: 0.0, gain: 0.0, tintMG: 0.0, tintR: 1.0, tintG: 1.0, tintB: 1.0,
            name: 'Layer', fileName: '', collapsed: false,
            isHd: false, solo: false, muted: false,
            // Phase 1: Per-Cell controls — defaults preserve pre-feature behaviour
            tileOffsetAxis: 'none', tileOffsetAmount: 0.00,
            tileRotateVariance: 0.00, tileRotateSnap: false,
            tilePopcornAmount: 0.00,
            // Phase 2: Variance suite — all 0/true → identical output for old presets
            tileSizeVariance: 0.00, tileJitterX: 0.00, tileJitterY: 0.00,
            tileOpacityVariance: 0.00, tileDepthVariance: 0.00,
            tileVarianceSeed: 0, tileVarianceSeedLocked: true,
            // Phase 3: Grid mode — 'density' default → old presets unchanged
            tileMode: 'density', tileCols: 3, tileRows: 3, tileFit: 'fill', tileGridScale: 1.0,
            // Phase 4: Recursive grids — defaults are no-ops → old presets unchanged
            tileSubdivide: 1, tileOuterGap: 0,
            // P0-D: forward-compat — old presets without an animation config get
            // neutral defaults so future GSAP code can read .animation safely.
            animation: { ...DEFAULT_ANIMATION },
        };
        const merged = { ...D, ...entry };
        // P0-D: _anim is RUNTIME tween state. Always reset to neutral on load —
        // a preset saved mid-tween must not deserialize into that frozen pose.
        merged._anim = { ...NEUTRAL_ANIM };
        return merged;
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

        // Overlay bundled MilkDrop data on top of the BLANK base.
        // CRITICAL: fields the preset OMITS must fall back to butterchurn's OWN preset
        // defaults (what the player gets — butterchurn does Object.assign({}, baseValsDefaults,
        // preset.baseVals) on load), NOT the editor's from-scratch BLANK defaults. BLANK is a
        // clean-slate creation base and intentionally differs (e.g. mv_a:0 = no motion vectors,
        // wave_mode:3). A sparse bundled preset whose look IS the motion-vector grid (e.g.
        // "Rovastar - Space _Twisted Dimension Mix_") rendered BLACK because BLANK forced mv_a:0,
        // hiding the grid that seeds its feedback. Interposing butterchurn's defaults keeps the
        // editor-only fields (studio_*, darken_center…) while making MilkDrop fields faithful to
        // the player. Read from the same pinned vendor at runtime → zero drift.
        const mdDefaults = this.engine.visualizer?.baseValsDefaults || {};
        this.currentState.baseVals = {
            ...deepClone(BLANK.baseVals),
            ...deepClone(mdDefaults),
            ...deepClone(bundled.baseVals || {}),
        };
        // Keep the bundled preset's own shapes — for some presets (empty warp + empty
        // comp + near-zero wave, e.g. phat_Phenethylamine) the shapes ARE the entire
        // look, so dropping them rendered the preset black in the editor. They're raw
        // (no .motion/.react) so _isEditorShape() returns false → they never get a card
        // and never count against the add-limit (editor UI is unchanged). _buildRuntimePreset
        // orders editor shapes FIRST into the engine's 4 slots, so user-added shapes are
        // never starved by these bundled ones.
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
        this.currentState.comp = injectStudioPostFx(_bundledRaw, gradeOpts(this.currentState));

        // Track remix origin so a save references the parent
        this.currentState.parentPresetName = name;
        // This is a RAW bundled MilkDrop preset — its warp/comp/eqs ARE its look. Meld would override
        // the warp (clobbering it), so block Meld with a modal until the user takes over the warp via a
        // Flow style or 🎲 Remix (which clears this flag in _applyFlowStyle). See milkdrop-control-dev.md.
        this._bundledBase = true;

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

        // ⚠️ PERSISTENCE BOUNDARY ⚠️
        // Mirror of `saveCurrent` — every render-affecting instance variable
        // saved there must be restored here. See the long comment above
        // `saveCurrent` for the full audit list and the bug history.
        this._imagesOnly = !!this.currentState.imagesOnly;
        // Restore _solidColor (instance var, not in currentState). Without this,
        // presets saved while in a solid-color variation reload with a black
        // background because _buildCompShader falls back to sampler_main when
        // the underlying preset has no visible Butterchurn output (e.g. wave_a=0).
        this._solidColor = Array.isArray(stateFields.solidColor) ? stateFields.solidColor.slice() : null;

        // Restore image layers (async — fetch blobs from IndexedDB)
        const savedImages = stateFields.images || [];
        for (const savedEntry of savedImages) {
            try {
                // Text layers have no imageId — restore directly from saved properties
                if (savedEntry.type === 'text') {
                    const entry = this._normalizeImageEntry(deepClone(savedEntry));
                    const texObj = { isText: true, textLayer: entry, width: 512, height: 256 };
                    this.currentState.images.push(entry);
                    this._mountLayerCard(entry, texObj);
                    continue;
                }

                // Video layers — stored under videoId, need a <video> element
                if (savedEntry.type === 'video') {
                    const blob = await getImage(savedEntry.videoId);
                    if (!blob) { console.warn('[Studio] Video blob not found:', savedEntry.videoId); continue; }
                    const videoUrl = URL.createObjectURL(blob);
                    const video = document.createElement('video');
                    video.preload = 'metadata';
                    video.playsInline = true;
                    video.muted = true;
                    video.volume = 0;       // Stored blobs are audio-stripped at upload/import; guard anyway
                    video.loop = true;
                    await new Promise((res, rej) => {
                        video.onloadedmetadata = res;
                        video.onerror = () => rej(new Error('Video metadata failed'));
                        video.src = videoUrl;
                    });
                    // Self-test: warn if a stored video still reports audio tracks.
                    // Means the upload/import strip step missed it — file a bug.
                    const trackCount = video.audioTracks?.length;
                    if (trackCount && trackCount > 0) {
                        console.warn('[Studio] Stored video has audio tracks — strip step missed it:', savedEntry.fileName, 'tracks:', trackCount);
                    }
                    const isStackedAlpha = !!savedEntry.isStackedAlpha;
                    const entry = this._normalizeImageEntry(deepClone(savedEntry));
                    entry.texW = video.videoWidth;
                    entry.texH = isStackedAlpha ? Math.floor(video.videoHeight / 2) : video.videoHeight;
                    entry.duration = video.duration || 0;
                    entry.isStackedAlpha = isStackedAlpha;
                    const texObj = {
                        data: videoUrl,
                        width: video.videoWidth,
                        height: isStackedAlpha ? Math.floor(video.videoHeight / 2) : video.videoHeight,
                        isVideo: true,
                        videoElement: video,
                        videoId: savedEntry.videoId,
                        _videoUrl: videoUrl,
                        isStackedAlpha,
                    };
                    this.currentState.images.push(entry);
                    this._mountLayerCard(entry, texObj);
                    video.play().catch(err => {
                        showToast('preset-load play() rejected: ' + (err?.name || '') + ': ' + (err?.message || err), true);
                    });
                    continue;
                }

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
                const texObj = { data: dataUrl, width, height, isGif: !!entry.isGif, gifSpeed: entry.gifSpeed, gifStability: entry.gifStability };

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
        const bgToggle = document.getElementById('toggle-bg-transparent');
        if (bgToggle) bgToggle.checked = !!this.currentState.bgTransparent;
        this.engine?.canvas?.classList.toggle('bg-transparent-checker', !!this.currentState.bgTransparent);

        // animation-dev.md A1 + A3 — replay entrance + start idle for any loaded
        // layer that has one configured. _anim was reset to neutral in
        // _normalizeImageEntry, so entrance starts from its preset's offset
        // state. Idle starts AFTER entrance so the idle loop doesn't fight the
        // entrance tween (playEntranceAnimation calls stopIdleAnimation before
        // launching, but that's only relevant if idle is already running).
        const refreshCb = () => { this._buildCompShader(); this._applyToEngine(); };
        for (const entry of this.currentState.images) {
            const a = entry.animation;
            if (!a) continue;
            if (a.entrance && a.entrance !== 'none') {
                playEntranceAnimation(entry, a).then(() => {
                    if (a.idle && a.idle !== 'none') startIdleAnimation(entry, a, refreshCb);
                });
            } else if (a.idle && a.idle !== 'none') {
                startIdleAnimation(entry, a, refreshCb);
            }
        }

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
    if (isError) {
        // Error toasts stack and persist until clicked
        const existing = document.querySelectorAll('.toast-error-persistent');
        let offset = 0;
        existing.forEach(e => { offset += (e.offsetHeight || 44) + 8; });
        const err = document.createElement('div');
        err.className = 'toast toast--error toast-error-persistent';
        err.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);cursor:pointer;z-index:99999;bottom:calc(1rem + ' + offset + 'px);';
        err.textContent = '\u2715 ' + msg;
        err.title = 'Click to dismiss';
        err.onclick = () => err.remove();
        document.body.appendChild(err);
        return;
    }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast';
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
}
