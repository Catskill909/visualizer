// animation-dev.md Phase A1 / A3 — entrance / idle animation engine.
// GSAP tweens entry._anim.* (opacity / scale / cxOffset / cyOffset / blur).
// Those values flow through window.__dcAnim → q-register pipe → comp shader
// (see animation-dev.md § Architecture correction). Zero shader rebuilds.

import { gsap } from 'gsap';

export const ENTRANCE_PRESETS = ['none', 'fade', 'scale-up', 'scale-down', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'pop', 'blur'];

export const EXIT_PRESETS = ENTRANCE_PRESETS;

export const IDLE_PRESETS = ['none', 'float', 'pulse', 'sway', 'spin', 'drift', 'breathe'];

// Entrance eases are all `.out` variants (decelerate to rest). `.in` eases
// back-load the motion which feels "invisible for 6s then rushes in" at long
// durations — see animation-dev.md audit. Exit animations get their own list.
export const ENTRANCE_EASES = [
    { id: 'expo.out',            label: 'Smooth' },
    { id: 'power3.out',          label: 'Snappy' },
    { id: 'elastic.out(1, 0.5)', label: 'Spring' },
    { id: 'bounce.out',          label: 'Bounce' },
    { id: 'none',                label: 'Linear' },
];

// Exit eases mirror the entrance set but use `.in` variants — accelerate away
// from rest. Linger (back.in) pulls back slightly before exit; Wobble
// (elastic.in) wiggles before exit.
export const EXIT_EASES = [
    { id: 'expo.in',             label: 'Smooth' },
    { id: 'power3.in',           label: 'Snappy' },
    { id: 'back.in',             label: 'Linger' },
    { id: 'elastic.in(1, 0.5)',  label: 'Wobble' },
    { id: 'none',                label: 'Linear' },
];

// Each entrance preset describes the OFFSET from neutral that we tween FROM.
// Tween target is always neutral (1, 1, 0, 0, 0). On complete, _anim is reset
// to NEUTRAL_ANIM so the q-register pipe carries identity values — exactly the
// same end-state as no animation at all.
const NEUTRAL = { opacity: 1.0, scale: 1.0, cxOffset: 0.0, cyOffset: 0.0, blur: 0.0 };

// Every preset starts with opacity:0 so the image is INVISIBLE on frame 0 — no
// "appear at neutral then animate" flash. cfg holds Gate-2 per-preset params
// (entranceDistance / entranceScaleUpFrom / entranceScaleDownFrom / entrancePopFrom
// / entranceBlurStart). Each falls back to the pre-Gate-2 hard-coded default so
// presets created before Gate 2 behave identically.
function startState(preset, cfg) {
    const dist  = cfg?.entranceDistance     ?? 1.2;
    const sUp   = cfg?.entranceScaleUpFrom  ?? 0.3;
    const sDown = cfg?.entranceScaleDownFrom ?? 1.8;
    const pop   = cfg?.entrancePopFrom      ?? 0.0;
    const blur  = cfg?.entranceBlurStart    ?? 0.6;
    switch (preset) {
        case 'fade':         return { ...NEUTRAL, opacity: 0 };
        case 'scale-up':     return { ...NEUTRAL, opacity: 0, scale: sUp };
        case 'scale-down':   return { ...NEUTRAL, opacity: 0, scale: sDown };
        case 'slide-left':   return { ...NEUTRAL, opacity: 0, cxOffset:  dist };
        case 'slide-right':  return { ...NEUTRAL, opacity: 0, cxOffset: -dist };
        case 'slide-up':     return { ...NEUTRAL, opacity: 0, cyOffset:  dist };
        case 'slide-down':   return { ...NEUTRAL, opacity: 0, cyOffset: -dist };
        case 'pop':          return { ...NEUTRAL, opacity: 0, scale: pop }; // elastic.out gives overshoot on top
        case 'blur':         return { ...NEUTRAL, opacity: 0, blur };
        default:             return null;
    }
}

/**
 * Play the entrance tween for one layer. Idempotent — kills any previous tween
 * on the same _anim object before starting. Resolves when the tween completes.
 *
 * @param {object} entry — the layer entry; must have entry._anim
 * @param {object} cfg   — { entrance, entranceDuration, entranceEase } (entry.animation)
 * @returns {Promise<void>}
 */
export function playEntranceAnimation(entry, cfg) {
    return new Promise(resolve => {
        if (!entry?._anim) return resolve();
        const preset = cfg?.entrance || 'none';
        if (preset === 'none') return resolve();
        const from = startState(preset, cfg);
        if (!from) return resolve();

        // CRITICAL: tween a THROWAWAY target, not entry._anim directly.
        // GSAP pollutes its target object with a `_gsap` Tween back-reference
        // that contains circular references. If GSAP touches entry._anim,
        // JSON.stringify(currentState) — called by deepClone() inside
        // _buildRuntimePreset on every refresh() — throws, which dead-stops
        // every layer-card slider. Keep entry._anim as a plain 5-prop object.
        const dur = Math.max(0.05, Math.min(15.0, cfg?.entranceDuration ?? 0.7));
        const ease = cfg?.entranceEase || 'expo.out';

        // Reuse / create a per-entry GSAP proxy. NON-ENUMERABLE so JSON.stringify
        // (used by deepClone elsewhere) skips it AND any GSAP-attached _gsap
        // circular reference on it. Same reason _anim stays plain — anything
        // GSAP touches must not appear in the JSON shape of currentState.
        if (!entry._gsapProxy) {
            Object.defineProperty(entry, '_gsapProxy', {
                value: { ...NEUTRAL },
                enumerable: false,
                writable: true,
                configurable: true,
            });
        }

        // Apply the from-state to BOTH the GSAP target and the plain _anim
        // before the tween begins. The next visualizer rAF tick will see _anim
        // at the from-state, so frame 0 already shows the image off-screen /
        // invisible — no "appear at neutral, then animate" flash.
        Object.assign(entry._gsapProxy, from);
        Object.assign(entry._anim, from);

        // GSAP-side idle (Float / Pulse / Breathe) shares _gsapProxy with the
        // entrance tween, so the existing `gsap.killTweensOf` below would kill
        // them automatically. Shader-side idle (Sway / Spin / Drift) writes
        // shader props and composes naturally with entrance — no need to
        // touch it. Caller restarts idle on entrance complete if configured.
        gsap.killTweensOf(entry._gsapProxy);
        gsap.fromTo(entry._gsapProxy, from, {
            opacity: 1.0,
            scale: 1.0,
            cxOffset: 0.0,
            cyOffset: 0.0,
            blur: 0.0,
            duration: dur,
            ease,
            immediateRender: true,
            onUpdate: () => {
                // Copy current tween values into the plain _anim object that
                // the q-pipe reads from. No GSAP metadata ever lands on _anim.
                entry._anim.opacity  = entry._gsapProxy.opacity;
                entry._anim.scale    = entry._gsapProxy.scale;
                entry._anim.cxOffset = entry._gsapProxy.cxOffset;
                entry._anim.cyOffset = entry._gsapProxy.cyOffset;
                entry._anim.blur     = entry._gsapProxy.blur;
            },
            onComplete: () => {
                Object.assign(entry._anim, NEUTRAL); // snap to exact identity
                resolve();
            },
        });
    });
}

// ─── Exit (Phase A2) ──────────────────────────────────────────────────────────
// Mirror of entrance. Layer starts at NEUTRAL (visible) and tweens TO the exit
// pose (off-canvas / invisible / blurred). Caller awaits the returned Promise
// before removing the layer from the composite. `resetAfter:true` (Preview
// mode) snaps `_anim` back to neutral so the layer pops back into view —
// useful for tuning. Real-delete callers pass `resetAfter:false`.

// Exit poses mirror entrance from-states with their own Gate-2 params.
// `scale-up` exit = grow + fade (default end 1.5); `scale-down` exit = shrink
// + fade (default end 0.0). Slide directions intentionally MIRROR entrance:
// slide-left exit moves the layer AWAY to the left (cxOffset → -dist), the
// natural opposite of slide-left entrance which arrives FROM the left.
function exitToState(preset, cfg) {
    const dist  = cfg?.exitDistance     ?? 1.2;
    const sUp   = cfg?.exitScaleUpFrom  ?? 1.5;
    const sDown = cfg?.exitScaleDownFrom ?? 0.0;
    const pop   = cfg?.exitPopFrom      ?? 0.0;
    const blur  = cfg?.exitBlurStart    ?? 0.6;
    switch (preset) {
        case 'fade':         return { ...NEUTRAL, opacity: 0 };
        case 'scale-up':     return { ...NEUTRAL, opacity: 0, scale: sUp };
        case 'scale-down':   return { ...NEUTRAL, opacity: 0, scale: sDown };
        case 'slide-left':   return { ...NEUTRAL, opacity: 0, cxOffset: -dist };
        case 'slide-right':  return { ...NEUTRAL, opacity: 0, cxOffset:  dist };
        case 'slide-up':     return { ...NEUTRAL, opacity: 0, cyOffset: -dist };
        case 'slide-down':   return { ...NEUTRAL, opacity: 0, cyOffset:  dist };
        case 'pop':          return { ...NEUTRAL, opacity: 0, scale: pop };
        case 'blur':         return { ...NEUTRAL, opacity: 0, blur };
        default:             return null;
    }
}

export function playExitAnimation(entry, cfg, { resetAfter = false } = {}) {
    return new Promise(resolve => {
        if (!entry?._anim) return resolve();
        const preset = cfg?.exit || 'none';
        if (preset === 'none') return resolve();
        const to = exitToState(preset, cfg);
        if (!to) return resolve();

        if (!entry._gsapProxy) {
            Object.defineProperty(entry, '_gsapProxy', {
                value: { ...NEUTRAL },
                enumerable: false,
                writable: true,
                configurable: true,
            });
        }
        // Kill any in-flight tween (entrance or GSAP-side idle). Shader-side
        // idle keeps running and composes — same composability as entrance.
        gsap.killTweensOf(entry._gsapProxy);

        // Start from current _anim (whatever state the layer is in — usually
        // neutral) so the exit feels continuous, not snapped.
        Object.assign(entry._gsapProxy, entry._anim);

        const dur = Math.max(0.05, Math.min(15.0, cfg?.exitDuration ?? 0.5));
        const ease = cfg?.exitEase || 'expo.in';

        gsap.to(entry._gsapProxy, {
            ...to,
            duration: dur,
            ease,
            onUpdate: () => {
                entry._anim.opacity  = entry._gsapProxy.opacity;
                entry._anim.scale    = entry._gsapProxy.scale;
                entry._anim.cxOffset = entry._gsapProxy.cxOffset;
                entry._anim.cyOffset = entry._gsapProxy.cyOffset;
                entry._anim.blur     = entry._gsapProxy.blur;
            },
            onComplete: () => {
                if (resetAfter) {
                    // Preview: snap back to neutral so the layer reappears.
                    Object.assign(entry._anim, NEUTRAL);
                    Object.assign(entry._gsapProxy, NEUTRAL);
                }
                resolve();
            },
        });
    });
}

// ─── Idle motion (Phase A3) ───────────────────────────────────────────────────
// Continuous looping motion while a layer is on screen. Hybrid pipeline:
//   - Sway / Spin / Drift: existing shader-side motion props (no GSAP).
//     Picking the preset just sets entry.swayAmt/spinSpeed/panMode etc. and
//     calls refresh() to rebuild the comp shader once. GPU runs the loop.
//   - Float / Pulse / Breathe: no shader prop covers them, so GSAP yoyo-tweens
//     entry._gsapProxy (NOT entry._anim — same circular-ref reason as entrance)
//     and copies into _anim via onUpdate. The q-pipe carries the values to GLSL.
//
// stopIdleAnimation() must reverse BOTH paths cleanly. Called before exit and
// on layer removal so we don't leave a GSAP tween mutating a dead _anim.

const IDLE_SHADER_KEYS = ['swayAmt', 'swaySpeed', 'wanderAmt', 'wanderSpeed',
    'spinSpeed', 'panMode', 'panSpeedX', 'panSpeedY', 'panRange'];

/**
 * Start an idle loop on a layer. Idempotent — stops any prior idle first.
 *
 * @param {object} entry      — the layer entry
 * @param {object} cfg        — { idle, idleSpeed } (entry.animation)
 * @param {function} refresh  — callback to rebuild the comp shader (for the
 *                              shader-side presets); typically inspector.refresh.
 */
export function startIdleAnimation(entry, cfg, refresh) {
    if (!entry) return;
    const preset = cfg?.idle || 'none';
    const speed = Math.max(0.05, Math.min(8, cfg?.idleSpeed ?? 1.0));

    stopIdleAnimation(entry, refresh);

    if (preset === 'none') return;

    // ── GSAP yoyo path — covers presets the shader doesn't already handle ──
    if (preset === 'float' || preset === 'pulse' || preset === 'breathe') {
        if (!entry._gsapProxy) {
            Object.defineProperty(entry, '_gsapProxy', {
                value: { ...NEUTRAL }, enumerable: false, writable: true, configurable: true,
            });
        }
        // Always start from neutral so the yoyo midpoint is the "rest" pose.
        Object.assign(entry._gsapProxy, NEUTRAL);
        Object.assign(entry._anim, NEUTRAL);

        let target;
        let dur;
        let ease = 'sine.inOut';
        if (preset === 'float') {
            // Vertical bob ±0.05 in UV space, ~3s default period.
            target = { cyOffset: 0.05 };
            dur = 3.0 / speed;
        } else if (preset === 'pulse') {
            // Scale oscillation ±8%, ~2s default period.
            target = { scale: 1.08 };
            dur = 2.0 / speed;
        } else /* breathe */ {
            // Opacity 1.0 → 0.55 → 1.0, ~3s default period.
            target = { opacity: 0.55 };
            dur = 3.0 / speed;
        }

        gsap.to(entry._gsapProxy, {
            ...target,
            duration: dur,
            ease,
            repeat: -1,
            yoyo: true,
            onUpdate: () => {
                entry._anim.opacity  = entry._gsapProxy.opacity;
                entry._anim.scale    = entry._gsapProxy.scale;
                entry._anim.cxOffset = entry._gsapProxy.cxOffset;
                entry._anim.cyOffset = entry._gsapProxy.cyOffset;
                entry._anim.blur     = entry._gsapProxy.blur;
            },
        });
        return;
    }

    // ── Shader-side path — set the underlying props and rebuild once ──
    // Save originals so stopIdleAnimation can restore them. Stored
    // non-enumerable so JSON.stringify(currentState) doesn't pick them up.
    if (!entry._idleSavedShader) {
        Object.defineProperty(entry, '_idleSavedShader', {
            value: {}, enumerable: false, writable: true, configurable: true,
        });
    }
    for (const k of IDLE_SHADER_KEYS) entry._idleSavedShader[k] = entry[k];

    if (preset === 'sway') {
        entry.swayAmt   = 0.06;
        entry.swaySpeed = 1.0 * speed;
    } else if (preset === 'spin') {
        entry.spinSpeed = 0.3 * speed;
    } else if (preset === 'drift') {
        // Two-axis BOUNCE (not drift) so single-image layers stay on-canvas.
        // `panMode: 'drift'` is a one-way continuous translation — fine for
        // tiled layers (endless scroll), but slides a single image off-screen.
        // Bounce mode oscillates around (cx, cy); two different rates per axis
        // give the wandering "no-sync" feel the doc describes.
        entry.panMode   = 'bounce';
        entry.panSpeedX = 0.15 * speed;   // cycles / sec
        entry.panSpeedY = 0.11 * speed;   // distinct rate so axes don't sync
        entry.panRange  = 0.08;           // half-amplitude in UV units
    }
    refresh?.();
}

/**
 * Stop the current idle loop on a layer. Reverses both pipelines.
 * Always safe to call — no-op if nothing is running.
 */
export function stopIdleAnimation(entry, refresh) {
    if (!entry) return;
    let shaderChanged = false;

    // GSAP yoyo path — kill the tween and snap _anim to neutral.
    if (entry._gsapProxy) {
        gsap.killTweensOf(entry._gsapProxy);
        Object.assign(entry._gsapProxy, NEUTRAL);
    }
    if (entry._anim) Object.assign(entry._anim, NEUTRAL);

    // Shader path — zero the props that idle presets manipulate. We don't
    // restore the saved values because "stop" semantically means "no motion."
    // If the user wants their old values back, they can re-drag the sliders.
    for (const k of IDLE_SHADER_KEYS) {
        if (k === 'panMode') {
            if (entry[k] !== 'off') { entry[k] = 'off'; shaderChanged = true; }
        } else if (k === 'swayAmt' || k === 'wanderAmt' || k === 'spinSpeed' ||
                   k === 'panSpeedX' || k === 'panSpeedY') {
            // Amplitude / speed props that, when zero, produce no visible motion.
            // We leave swaySpeed / wanderSpeed alone since they're rate-only and
            // produce nothing without an amplitude.
            if (entry[k] !== 0) { entry[k] = 0; shaderChanged = true; }
        }
    }
    if (shaderChanged) refresh?.();
}
