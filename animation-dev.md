# Animation System — Design & Brainstorm Doc

**Status:** Research / pre-build
**Last updated:** 2026-05-23

---

## Scope

**v1 — pre-show setup tool.** The animator modal ships as a creative planning tool: you build your layers, set entrance/exit/idle animations, and the preset saves and plays them. No live triggering. No MIDI. No keyboard shortcuts to fire animations mid-show. That's a separate, later problem.

**Future — performance mode.** Triggering animations live (keyboard, MIDI, OSC, tap tempo) is a big-picture direction — captured at the bottom of this doc. Don't design it now. Build the pre-planning layer first; performance triggering plugs into the same animation engine later.

**Interface principle:** remove features before adding complexity. If a control needs a sub-menu to access something used in every session, it belongs on the surface. If it's set-and-forget, a modal is right. If it's rarely used, cut it.

---

## What this solves

Layers currently have static properties — `cx`, `cy`, `size`, `opacity`, `angle` etc. are set once and held. Animation means making those properties change over time in a controllable, expressive way: a logo that floats, a title that fades in, a layer that dissolves out when a preset changes. This doc covers **functional layer animation** (what layers do) and **editor UI animation** (how the interface feels).

---

## Two separate domains

### Domain A — Layer animation (functional)

Properties on the `entry` object (`cx`, `cy`, `size`, `opacity`, `angle`, `hueSpinSpeed`, etc.) are read by the WebGL compositing shader on every `requestAnimationFrame` tick. If you change them over time, the canvas reflects it instantly — the render loop is already there. Animation here = a system that mutates `entry` properties on a curve over time.

### Domain B — UI/interface animation

The editor panels, layer card transitions, modal entrances, the timeline scrubber — these are DOM elements. Standard CSS transitions and keyframes handle most of it. A few complex sequences (staggered layer card reorder, panel slide-in) benefit from a JS tween.

Both domains can share the same library, but they solve different problems. Don't conflate them when planning phases.

---

## Recommended library: GSAP

**Why GSAP over build-from-scratch:**

| | GSAP | Custom tween |
|---|---|---|
| Tween arbitrary JS object props | Yes — core feature | Yes — ~50 lines |
| Easing library (30+ curves) | Built-in | You write them |
| Sequencing / timelines | Built-in | ~200 lines |
| Stagger, repeat, yoyo, delay | Built-in | Each = more lines |
| Beat-sync (kill + restart mid-tween) | `gsap.killTweensOf(entry)` | Manage manually |
| DOM UI animation | Yes | Yes |
| Bundle cost | ~30KB | 0 |
| Vanilla JS (no React) | Yes | Yes |

GSAP's killer feature here: it tweens **plain JS objects**, not just DOM nodes. `gsap.to(entry, { opacity: 0, size: 0.5, duration: 0.8 })` works because the rAF loop reads `entry.opacity` and `entry.size` every frame. No adapter code needed.

**Install:** `npm install gsap`

**Free tier covers everything.** Club plugins (ScrollTrigger, Draggable, etc.) not needed.

---

## Layer animation types

### 1. Entrance
Fires once when a layer becomes visible. Common presets:

| Name | What happens |
|---|---|
| Fade In | `opacity: 0 → entry.opacity` |
| Scale Up | `size: 0 → entry.size` |
| Scale Down | `size: entry.size * 2 → entry.size` |
| Slide Left | `cx: entry.cx + 0.3 → entry.cx` |
| Slide Right | `cx: entry.cx - 0.3 → entry.cx` |
| Drop In | `cy: entry.cy - 0.2 → entry.cy` |
| Pop | scale overshoots then settles (`elastic.out` ease) |

Implementation pattern:
```js
// store the "resting" values, tween from an offset
const rest = { opacity: entry.opacity, size: entry.size, cx: entry.cx, cy: entry.cy };
gsap.from(entry, { opacity: 0, size: rest.size * 0.4, duration: 0.7, ease: 'expo.out' });
```

### 2. Exit
Mirror of entrance — fires when layer is hidden/removed. Same presets but reversed. Should respect the `duration` setting so the caller can `await` it before actually hiding the layer.

### 3. Idle / loop
Continuous motion while the layer is visible. Runs indefinitely (`repeat: -1`, `yoyo: true`).

| Name | What it tweens |
|---|---|
| Float | `cy` ±0.015 with `sine.inOut`, 2–4s |
| Pulse | `size` ±5–10%, `sine.inOut`, 1–3s |
| Breathe | `opacity` 0.7 → 1.0, `sine.inOut`, 2–4s |
| Spin | `angle` continuous rotation, linear |
| Drift | `cx` + `cy` slow wander (two independent loops, different durations so they don't sync) |
| Sway | `angle` ±8–15°, `sine.inOut` — pendulum feel |

Implementation pattern:
```js
// Kill any previous idle tween for this entry first
gsap.killTweensOf(entry, 'cy');
gsap.to(entry, {
  cy: entry.cy + 0.018,
  duration: 2.8,
  ease: 'sine.inOut',
  yoyo: true,
  repeat: -1,
});
```

### 4. Beat-step locomotion (phase 2+)
**Not** another reactivity modulator — that already exists (size pulse, opacity flicker, orbit are all covered by the existing audio-reactivity sliders). Beat-step is categorically different: the beat is a **trigger that commits a new position/state**, and the layer holds there until the next beat.

Examples:
- Logo slides one grid-step right on each kick, holds between kicks
- Layer rotates 45° on every 4th beat and holds
- Opacity alternates 100% / 40% on each beat — a strobe-hold, not a flicker

The feel is stutter-motion / stop-motion. The layer has a **step sequence** (a list of property snapshots) and the beat clock advances through it.

Implementation sketch:
```js
// entry.animation.steps = [{ cx: 0.3 }, { cx: 0.5 }, { cx: 0.7 }, { cx: 0.5 }]
// On each beat, advance stepIndex and tween to the next step
function onBeat() {
  entry._stepIndex = (entry._stepIndex + 1) % entry.animation.steps.length;
  const target = entry.animation.steps[entry._stepIndex];
  gsap.to(entry, { ...target, duration: 0.06, ease: 'power3.out' }); // snap fast, hold
}
```

This is closer to a mini-sequencer than a reactivity slider — design the UI separately. Out of scope for phase 1.

### 5. Keyframe sequences (phase 2+)
A mini timeline per layer — keyframes at t=0, t=1s, t=2s etc. with arbitrary property values. Think: at 0s opacity=0, at 0.5s opacity=1, at 3s cx shifts right, at 4s fade out. This is the power-user path. Implementation = a GSAP Timeline (`gsap.timeline()`) built from a serialized keyframe array stored on `entry.keyframes`. Out of scope for phase 1 but the data model should not block it.

---

## Interface design

### Principles

- **No default browser form controls** — no `<select>`, no `<input type="range">` with default styling, no plain text boxes. Every control is custom-built or custom-styled to match the app's glassmorphic/material aesthetic.
- **Contextual UI** — selecting an effect reveals only the controls that effect needs. No fixed form where half the fields are irrelevant. The panel morphs to the selection.
- **Modern time controls** — duration and easing are visual, not numeric entry. A scrub bar for time. A bezier curve editor for easing. These are the two most-used controls; they deserve a proper interface.
- **Space-efficient by design** — the modal must stay compact enough to use on a laptop screen while the canvas plays behind it. Controls expand vertically only when needed.
- **Cross-platform parity** — every control must look and behave identically on web, macOS (Tauri/WKWebView), and Windows (Tauri/WebView2). No hover-only interactions. Touch-friendly target sizes (min 44×44px) for tablet use. No native OS form widgets.

---

### Decision: animation controls live in a modal, not the layer card

The layer card is already long. Inline controls would add vertical space to every layer even for users who never animate. The right pattern is a dedicated **Animate modal** triggered from a single icon button on the layer card header.

**Precedent in this app:** the GIF Optimizer modal — a button on the layer card opens a focused panel. Same pattern.

---

### Layer card trigger

One icon button in the layer card header row (alongside solo/mute/rename):

```
[ ✦ ]   ← animate icon; gains a filled accent dot when any animation is active
```

- No dot — no animation configured
- Accent dot — at least one animation type is active
- Click → opens the Animate modal scoped to that layer

No inline controls on the card. The dot communicates state without adding UI.

---

### Modal — growth strategy

The modal is the long-lived container. It must be designed to grow from 3 tabs (v1) to 6+ tabs (future) without redesigning the shell. Shell is fixed; tabs are additive.

```
┌──────────────────────────────────────────────────┐
│  ✦  Animate — Layer name                  [ × ]  │
├──────────────────────────────────────────────────┤
│  [ Entrance ]  [ Exit ]  [ Idle ]  [ Beat ] ···  │  ← tab bar; ··· overflow for future tabs
├──────────────────────────────────────────────────┤
│                                                  │
│   (contextual panel — changes per tab)           │
│                                                  │
│                        [ ▶ Preview ]             │
└──────────────────────────────────────────────────┘
```

- Tab bar scrolls horizontally if tabs overflow (not a dropdown — tabs stay visible)
- Future tabs: Beat, Keyframes, Trigger (performance) — each ships as a new tab without touching existing ones
- Preview button is always visible at the bottom regardless of active tab

---

### Effect selection — chips, not dropdowns

Selecting an animation style uses a **chip row**, not a `<select>`. Each chip is a pill button. The selected chip is filled/highlighted. Selecting a chip immediately reveals that effect's controls below via a smooth expand.

```
Entrance
[ None ]  [ Fade ]  [ Scale ▲ ]  [ Slide ]  [ Pop ]  [ Blur ]  [ Wipe ] …

▼ (controls for selected effect appear here)
```

**Why chips over a dropdown:**
- Scannable at a glance — all options visible without opening anything
- Single tap to switch — no open → scroll → select → close cycle
- Adding a new effect = adding a chip, not editing a long select list
- Works identically across web, macOS, Windows — no OS-native widget involved

If the chip row grows beyond one line, it scrolls horizontally with a fade-out mask on the right edge. It does not wrap to two lines.

---

### Duration control — visual scrubber

Duration is not a number input or a basic slider. It is a **time scrubber** — a horizontal track with a drag handle and a live time readout that updates as you drag.

```
  0.1s  ──────●──────────────────────  3.0s
              0.7s
```

- Track has subtle tick marks at 0.5s intervals
- Handle is large enough to tap on mobile/tablet (min 44px touch target)
- Time value displays above or beside the handle in the app's type style — not in an input box
- Double-tap the value to type an exact number (rare power-user case)
- Range: 0.1s–3.0s for entrance/exit; 0.25×–4× multiplier for idle speed

---

### Easing control — visual bezier editor

Easing is not a dropdown of names. It is a **visual cubic-bezier editor** with a preset chip row above it.

```
Ease
[ Linear ]  [ Ease Out ]  [ Ease In ]  [ Spring ]  [ Bounce ]  [ Custom ]

    ╭────╮
   ╱      ╲        ← SVG curve preview, updates live as handles move
──╱────────╲──
  ●          ●    ← draggable control handles
```

- Preset chips set the bezier values and update the curve preview instantly
- In Custom mode, the two bezier handles are draggable directly on the SVG
- The raw cubic-bezier values (e.g. `0.22, 1, 0.36, 1`) are not shown unless the user asks — the visual curve is the interface
- This is the same component reused on Entrance, Exit, and any future tab that needs easing

**GSAP easing names map to bezier values for the preview:**

| Chip | GSAP string | Bezier approx |
|---|---|---|
| Ease Out | `expo.out` | `0.16, 1, 0.3, 1` |
| Ease In | `expo.in` | `0.7, 0, 0.84, 0` |
| Ease In-Out | `expo.inOut` | `0.87, 0, 0.13, 1` |
| Spring | `elastic.out(1, 0.5)` | visual only — no bezier equiv |
| Bounce | `bounce.out` | visual only |
| Linear | `none` | `0, 0, 1, 1` |

Spring and Bounce show a curve preview but don't expose bezier handles (they're not cubic-bezier functions).

---

### Entrance tab — contextual panels

Each effect chip reveals a different control set. Only the relevant controls appear — no fixed form with hidden/disabled rows.

**Fade**
```
Duration  [ scrubber ─────● ]  0.7s
Ease      [ Out ] [ In ] [ In-Out ] [ Custom ]
          [ bezier curve editor ]
```

**Scale Up / Scale Down**
```
Duration  [ scrubber ]
Ease      [ chip row + bezier ]
From      [ scrubber ]  20%   ← starting scale (Scale Up: from small; Scale Down: from large)
```

**Slide (Left / Right / Up / Down)**
```
Direction  [ ← ] [ → ] [ ↑ ] [ ↓ ]   ← icon button group, one selected
Distance   [ scrubber ]  30%          ← how far it slides from (% of canvas dimension)
Duration   [ scrubber ]
Ease       [ chip row + bezier ]
```

**Pop** (scale overshoot)
```
Duration    [ scrubber ]
Overshoot   [ scrubber ]  20%    ← how far past 100% the scale goes before settling
```

**Blur** (focus-in from blurred)
```
Duration    [ scrubber ]
Blur start  [ scrubber ]  12px
Ease        [ chip row + bezier ]
```

**Wipe** (directional reveal — phase 2)
```
Direction  [ ← ] [ → ] [ ↑ ] [ ↓ ]
Duration   [ scrubber ]
```

---

### Exit tab

Mirror of Entrance — same chip row, same contextual panels, same scrubber + bezier components. The layer holds its exit tween to completion before the layer is removed from the composite. Exit effect does not have to match entrance — they are independent.

---

### Idle tab

```
Motion
[ None ]  [ Float ]  [ Pulse ]  [ Breathe ]  [ Spin ]  [ Drift ]  [ Sway ]

▼ (contextual controls per motion)
```

**Float / Sway / Breathe / Drift** — Speed multiplier scrubber (0.25×–4×)
**Pulse** — Speed + Intensity (how far size expands, %)
**Spin** — Speed + Direction ([ CW ] [ CCW ] chip pair)

A **Stop** button appears in the bottom-right of the idle panel (alongside Preview) while an idle animation is running.

---

### Beat tab (phase B1 — placeholder in v1)

Visible but shows a "Coming soon" state with a brief description of what it will do: step-sequence locomotion, beat-advance, stutter-motion. Not grayed out in a way that looks broken — just a clean informational state.

---

### Keyframes tab (phase B2 — placeholder in v1)

Same treatment: visible, clean informational state. Sets expectations without being a dead end.

---

### Modal behavior

- Canvas and layer continue playing while the modal is open — edits are live
- **Preview button** (always visible at bottom) replays the entrance tween on the live canvas; useful for tuning without closing the modal
- Auto-saves on every change — no Save button, same pattern as every other control in the editor
- Modal is dismissible via × button, `Escape`, or clicking the backdrop
- Modal position: centered, max-width ~480px, max-height ~85vh, internally scrollable if content exceeds height (rare in v1)
- On small screens (web mobile, tablet) the modal slides up from the bottom as a sheet rather than floating centered

### Editor UI polish (Domain B)

The modal itself should feel as animated as the features it controls. CSS handles these — no GSAP needed:

- Layer card add/remove: slide + fade (currently abrupt)
- Chip selection: filled highlight transition, not instant swap
- Contextual panel reveal: smooth height expand when an effect chip is selected
- Modal open: scale-up + fade from center (`transform: scale(0.95) → 1`, `opacity: 0 → 1`, ~150ms)
- Tab switch: panel cross-fade, not instant replace

No native form controls anywhere in the modal. Every interactive element is a custom component.

---

## Architecture audit — conflicts with existing motion system

**This section must be resolved before any animation code is written.**

### How the existing layer system works (from code audit)

The custom layer system uses a **shader-baking model**. When any property changes, `_buildImageBlock()` embeds the current `entry.cx`, `entry.cy`, `entry.size`, `entry.opacity` etc. as float literals directly into GLSL source code — then `_buildCompShader()` recompiles the shader program. There are no per-property WebGL uniforms for these values.

Key findings from `visualizer.js`:
- `opacity` → baked at line 6298: `const op = img.opacity.toFixed(4)` → embedded as a GLSL constant
- `cx`, `cy`, `size` → same pattern, lines 6305–6306, 6296
- All motion coefficients (`spinSpeed`, `swayAmt`, `bounceAmp`, `orbitRadius`, `panSpeedX/Y`) → baked as GLSL constants
- Only texture samplers are actual WebGL uniforms
- Shader rebuild is debounced at 16ms (`refresh()`, line 4300) to cap slider-drag rebuilds at ~62/sec

**Motion runs entirely in the shader.** `spinSpeed`, `swayAmt`, `bounceAmp`, `orbitRadius` are baked as GLSL float literals. At render time, the shader computes `sin(time * swaySpeed) * swayAmt` using the `time` uniform. The CPU never touches these values frame-to-frame — they are permanently encoded in the compiled shader until the next rebuild.

### Why this matters for GSAP

If GSAP tweens `entry.cx` from 0.6 to 0.5 over 700ms, **nothing happens on screen** — the shader was compiled with `cx = 0.6000` baked in. The new value is invisible until `_buildCompShader()` is called. Even if we trigger a rebuild on every GSAP tick, shader recompilation at 60fps would cause severe frame drops. The 16ms debounce exists precisely because rebuilding every input event was already too expensive.

**GSAP tweening entry properties directly = will not work for smooth animation.**

### The right architecture: animation uniforms

The correct approach is to add a small set of **animation-only WebGL uniforms** — properties that can be updated each frame via `gl.uniform*()` calls without recompiling anything. The existing baked values stay untouched; the animation uniforms are offsets/multipliers on top.

Proposed animation uniforms (added to the comp shader once, during normal build):

| Uniform | Type | Purpose | Neutral value |
|---|---|---|---|
| `u_anim_opacity` | `float` | Multiplies the baked opacity | 1.0 |
| `u_anim_scale` | `float` | Multiplies the baked size | 1.0 |
| `u_anim_cx_offset` | `float` | Adds to baked cx | 0.0 |
| `u_anim_cy_offset` | `float` | Adds to baked cy | 0.0 |
| `u_anim_blur` | `float` | Additional blur for blur-in effect | 0.0 |

At render time (every rAF tick), the loop calls `gl.uniform1f(u_anim_opacity, entry._anim.opacity)` etc. — no shader recompile, just uniform upload. The shader computes `final_opacity = baked_opacity * u_anim_opacity`.

GSAP then tweens `entry._anim.opacity` from 0 → 1 for a fade-in. The rAF loop uploads it as a uniform every frame. **Smooth 60fps, zero recompiles during animation.**

When the tween completes, all animation uniforms return to their neutral values (1.0 / 0.0). The baked values reassert. No permanent state change.

### What this means for the "Idle" tab

The existing motion controls (`spinSpeed`, `swayAmt`, `bounceAmp`, `orbitRadius`, `panSpeedX/Y`) are already GPU-computed, time-based, continuous animations that run in the shader. They are already the idle animation system. They just have scattered, technical-sounding slider labels.

**The Idle tab should NOT replace these with GSAP tweens.** It should **re-skin and curate** them — the named presets (Float, Sway, Drift, Spin, Pulse, Bounce) map to sensible combinations of the existing properties, with a speed multiplier. The underlying mechanism stays in the shader where it belongs.

This also means Idle animations have zero conflict with the GSAP entrance/exit system — they run on different properties in different systems.

### Tiling controls — safe

Tiling (grid mode, cell rotate, jitter, popcorn, scatter) are also baked shader coefficients. They don't touch `cx/cy/size/opacity` — they control instancing and per-cell UV offsets. The animation uniform system doesn't touch them. No conflict.

### Summary

| Feature | Mechanism | Conflict with GSAP |
|---|---|---|
| Entrance / Exit | New animation uniforms (this work) | None — new system |
| Idle (Float, Sway, etc.) | Existing baked shader motion re-skinned | None — separate properties |
| Audio reactivity (size, opacity pulse) | Baked shader math on `bass`/`mid`/`treble` uniforms | None — runs in GPU |
| Tiling / grid | Baked shader instancing | None |
| Butterchurn MilkDrop motion | Butterchurn's own frame_eqs system | None — completely separate |

### Pre-build gate — exact locations

All of this must pass before any GSAP or modal code is written. These are infrastructure changes only — no UI, no visible features.

**Files involved:** `inspector.js` (layer system), `visualizer.js` (rAF loop + WebGL)

---

#### P0-A — Add `_anim` to all entry defaults

| Layer type | File | Line | Add |
|---|---|---|---|
| Image | inspector.js | 2716 | `_anim: { opacity: 1.0, scale: 1.0, cxOffset: 0.0, cyOffset: 0.0, blur: 0.0 }` |
| Video | inspector.js | 3095 | same |
| Text | inspector.js | 3246 | same |

#### P0-B — Add animation uniforms to the comp shader

In `_buildImageBlock()` (inspector.js:6293), add 5 new uniform declarations to the GLSL source string and use them to offset the baked values:

```glsl
uniform float u_anim_opacity;    // multiplier: baked_op * u_anim_opacity
uniform float u_anim_scale;      // multiplier: baked_size * u_anim_scale
uniform float u_anim_cx_offset;  // adder: baked_cx + u_anim_cx_offset
uniform float u_anim_cy_offset;  // adder: baked_cy + u_anim_cy_offset
uniform float u_anim_blur;       // adder to any existing blur
```

In `_buildCompShader()` (inspector.js:6162), look up the uniform locations after shader link and store them on the program object.

#### P0-C — Upload uniforms each frame

In the rAF loop (visualizer.js:599), before the render call at line 640, add a loop over active entries that calls `gl.uniform1f()` for each of the 5 animation uniforms from `entry._anim`. This runs every frame with zero shader recompilation.

```js
// before visualizer.render() at line 640
for (const entry of activeEntries) {
  gl.uniform1f(locs.u_anim_opacity,    entry._anim.opacity);
  gl.uniform1f(locs.u_anim_scale,      entry._anim.scale);
  gl.uniform1f(locs.u_anim_cx_offset,  entry._anim.cxOffset);
  gl.uniform1f(locs.u_anim_cy_offset,  entry._anim.cyOffset);
  gl.uniform1f(locs.u_anim_blur,       entry._anim.blur);
}
```

#### P0-D — Serialize / deserialize animation config

In `saveCurrent()` (inspector.js:7484) — add `animation` field to each serialized entry.

In `loadPresetData()` (inspector.js:7615) — on restore, merge `entry.animation = { ...DEFAULT_ANIMATION, ...saved.animation }`. Presets without the field get defaults silently.

```js
const DEFAULT_ANIMATION = {
  entrance: 'none', entranceDuration: 0.7, entranceEase: 'expo.out',
  exit: 'none',     exitDuration: 0.5,     exitEase: 'expo.in',
  idle: 'none',     idleSpeed: 1.0,
  beatSteps: []
};
```

#### P0-E — Manual smoke test (console)

Before touching any UI:
1. Open editor, add an image layer
2. In console: `window._inspector._images[0]._anim.opacity = 0` (or whatever the inspector reference is)
3. Confirm the layer goes invisible on the next frame without calling `refresh()`
4. Set back to `1.0`, confirm it returns
5. Only after this passes does GSAP get wired in

---

## Phase plan

### Phase 0 — Pre-build infrastructure (no UI, no visible features)

| Step | What | Location |
|---|---|---|
| P0-A | Add `_anim` object to all 3 entry defaults | inspector.js:2716, 3095, 3246 |
| P0-B | Add 5 animation uniforms to comp shader GLSL + location lookup | inspector.js:6293, 6162 |
| P0-C | Add per-frame uniform upload in rAF loop | visualizer.js:599 (before :640) |
| P0-D | Add `animation` field to save/load | inspector.js:7484, 7615 |
| P0-E | Console smoke test — opacity uniform works without shader rebuild | — |

**Gate: all 5 steps pass before moving to Phase A1.**

---

### Phase A1 — Modal shell + Entrance tab

| Step | What | Location |
|---|---|---|
| A1-1 | Add animate icon button to layer card header | inspector.js:3421–3429 (alongside solo/mute/dupe) |
| A1-2 | Add modal HTML to editor.html | editor.html (after gif-optimizer-modal at :747, same pattern) |
| A1-3 | Wire modal open scoped to entry | inspector.js, following `_showGifOptimizerModal` pattern at :2083 |
| A1-4 | `npm install gsap` + import | inspector.js or a new animation.js module |
| A1-5 | Entrance chip row + contextual panels (Fade, Scale, Slide, Pop, Blur) | Modal JS |
| A1-6 | Duration scrubber component (custom, no `<input range>`) | Reusable component |
| A1-7 | Easing bezier editor (SVG + preset chips) | Reusable component |
| A1-8 | Preview button — replays tween on live canvas | Modal JS |
| A1-9 | `playEntranceAnimation(entry)` — tweens `entry._anim.*` via GSAP | animation.js |
| A1-10 | Wire entrance to fire on layer show / preset load | inspector.js layer lifecycle |

---

### Phase A2 — Exit tab

| Step | What | Location |
|---|---|---|
| A2-1 | Exit tab in modal (mirrors Entrance) | Modal JS |
| A2-2 | `playExitAnimation(entry, onComplete)` | animation.js |
| A2-3 | Wire exit to fire before layer hide/remove — hold until tween completes | inspector.js layer lifecycle |

---

### Phase A3 — Idle tab

| Step | What | Location |
|---|---|---|
| A3-1 | Idle tab in modal — chip row (Float, Pulse, Sway, Spin, Drift, Breathe) + speed slider | Modal JS |
| A3-2 | Each idle preset maps to existing entry properties (not new GSAP tweens) | — |
| A3-3 | Float → `swayAmt`, Spin → `spinSpeed`, Drift → `panSpeedX/Y`, Bounce → `bounceAmp` | inspector.js entry props |
| A3-4 | Selecting a preset sets the underlying props + calls `refresh()` once | inspector.js |
| A3-5 | Speed slider scales the coefficient (e.g. `swayAmt = preset.base * idleSpeed`) | inspector.js |

Note: Idle tab is a **better UI** for existing shader motion — no new animation engine. GSAP not needed here.

---

### Phase A4 — UI polish

| Step | What |
|---|---|
| A4-1 | Layer card add: CSS slide-down + fade-in (currently abrupt) |
| A4-2 | Layer card remove: CSS slide-up + fade-out |
| A4-3 | Modal open: scale(0.95→1) + opacity(0→1), ~150ms |
| A4-4 | Tab switch: panel cross-fade |
| A4-5 | Chip selection: filled-highlight transition |
| A4-6 | Contextual panel reveal: smooth height expand |

All CSS — no GSAP needed.

---

### Future phases (design later, not now)

| Phase | What | Notes |
|---|---|---|
| B1 | Beat-step locomotion | Step sequence per layer, beat clock advances states — stutter-motion. Design UI separately. |
| B2 | Keyframe sequences | GSAP Timeline from keyframe array. Power-user path. |
| C1 | Performance triggering | Keyboard / MIDI / OSC fire animations live. See § Performance below. |

---

## Performance (future — big picture, not v1)

The v1 modal is a **setup tool** — you configure before a show. Performance mode is the second chapter: being able to trigger, retrigger, and override animations live while the show is running.

What this means for VJ/DJ artists:

- **Keyboard triggers** — assign a key to replay a layer's entrance, fire a beat-step sequence, or cut to a specific idle state. The existing hype keys (`S` strobe, `B` blackout) are the precedent.
- **MIDI mapping** — map any animation parameter (entrance style, idle speed, opacity) to a hardware knob or pad. A DJ can spin a knob to slow the float, tap a pad to retrigger an entrance. This is the highest-value hardware integration.
- **OSC / Ableton Link** — sync beat-step locomotion to an external BPM clock. Ableton Link gives zero-drift sync with a DAW or another app on the same network.
- **Scene triggers** — fire a layer's entrance/exit on a timeline block transition. The timeline already plays presets on cue; animation events could hook into the same block lifecycle.

**Design principle for performance controls:** if it needs more than one click or one keypress during a live set, it's too deep. Performance triggers must be immediate — single key, single pad, single knob. Configuration (what that key/pad does) lives in a separate mapping panel opened before the show.

**Don't design the performance UI now.** The animation engine (GSAP tweening `entry` properties) is the foundation both modes share. Build the engine in v1. Performance triggering is a layer on top.
