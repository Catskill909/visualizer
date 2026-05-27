# Animation System — Design & Planning Doc

**Last updated:** 2026-05-27

---

## 📊 Status Dashboard

*Read this section first. It is the single source of truth for where the animation system stands. Update it immediately when any phase ships or stalls.*

### Legend

| Mark | Meaning |
|---|---|
| ✅ | Shipped |
| 🔧 | In progress |
| ⬜ | Planned — not started |
| 🔬 | Research / design only |
| ⏸ | Deferred |

### Current status

**P0 ✅ + A1 Gate 1 ✅ + A1 Gate 2 ✅ + A2 ✅ + A3 ✅ shipped & user-verified 2026-05-27.** Entrance + Exit + Idle pipelines all live in the editor. Per-preset tunable params (Distance / Start size / Pop from / Start blur). Modal is draggable, tab-aware, layer delete commits the exit.

**Remaining:** A1 Gate 3 (custom visual scrubber + visual bezier editor) — polish on already-working controls. A4 (CSS UI polish — card add/remove transitions, modal scale-in, chip cross-fades) is last.

### 🎯 Up Next — priority order

> Reorder rows to re-prioritise. Top unbuilt row = what gets built next.

| # | Phase | What | Status |
|---|-------|------|--------|
| 1 | **P0** — Infrastructure | `_anim` object on entries + 5 q-register slots per layer + per-frame eq line + save/load | ✅ |
| 2 | **A1** — Modal shell + Entrance | Modal trigger on layer card, entrance chip picker, duration scrubber, bezier easing editor, Preview button | ✅ Gate 1 / ✅ Gate 2 (contextual panels) / ⬜ Gate 3 (visual scrubber + bezier) |
| 3 | **A2** — Exit tab | Mirror of entrance; layer waits for exit tween before hiding | ✅ |
| 4 | **A3** — Idle tab | Hybrid: Sway/Spin/Drift = shader props; Float/Pulse/Breathe = GSAP yoyo on `_anim`. Chip row + speed slider. | ✅ |
| 5 | **A4** — UI polish | Layer card add/remove transitions, modal open animation, chip/tab cross-fades | ⬜ |
| 6 | **B1** — Beat-step locomotion | Step sequence per layer, beat clock advances states, stutter-motion feel | ⏸ design first |
| 7 | **B2** — Keyframe sequences | Per-layer GSAP Timeline from serialised keyframe array | ⏸ |
| 8 | **C1** — Performance triggering | Keyboard / MIDI / OSC fire animations live | ⏸ |

### Recently shipped

- **2026-05-27 — A1 Gate 2 ✅ shipped & user-verified.** Each entrance / exit preset now exposes one tunable parameter where it makes sense — Slide → **Distance** (0.3–2.0 UV), Scale Up → **Start size** (0.0–0.7), Scale Down → **Start size** (1.2–3.0), Pop → **Pop from** (0.0–0.5; elastic still provides overshoot on top), Blur → **Start blur** (0.1–1.0). Exit mirrors with **End size / Pop to / End blur** semantics (some defaults flipped — scale-up exit grows away, scale-down exit shrinks away). Contextual rows live above Duration + Ease and show only for the relevant preset (`data-for-preset` matches via `_syncAnimateParamRows`). Sliders bind generically through `data-bind` keys matching `entry.animation.*` field names — adding a future param is HTML-only. `DEFAULT_ANIMATION` carries all defaults so old presets stay byte-identical.
- **2026-05-27 — A2 Exit tab ✅ shipped & user-verified.** New export `playExitAnimation(entry, cfg, { resetAfter })` in [src/editor/animation.js](src/editor/animation.js) — mirror of entrance with 9 exit-pose presets (fade-out, scale up/down, slide L/R/U/D, pop, blur). 5 `.in` eases — **Smooth** (`expo.in`), **Snappy** (`power3.in`), **Linger** (`back.in` — pulls back slightly before exit), **Wobble** (`elastic.in` — wiggles before exit), **Linear** (`none`). Modal: Exit tab now has chip row + duration slider (0.1–10s) + ease dropdown + tab-aware Preview button. Preview uses `resetAfter:true` so the layer snaps back to view after the tween — convenient for tuning. Layer delete (`_performDeleteLayer`) now `await`s the exit tween before splicing; the card greys out during the tween to prevent double-clicks. Preset-load swap (`_clearForLoad`) stays instant — exit-on-preset-swap is a timeline-era concern. `DEFAULT_ANIMATION` already had the `exit`/`exitDuration`/`exitEase` fields so no save-schema change.
  - **First-test fix (2026-05-27):** layer "came back" for a single frame after the exit tween completed. Cause: `_performDeleteLayer` was calling `stopIdleAnimation(entry)` after `await playExitAnimation`, which resets `_anim` to NEUTRAL. The compiled comp shader doesn't swap mid-frame; the OLD comp renders one more frame after the splice, with its q-registers defaulting to NEUTRAL (because the entry is now absent from `__dcAnim`), making the layer visible at full opacity for that one frame. Fix: in the discard path, don't call `stopIdleAnimation` — just `gsap.killTweensOf(entry._gsapProxy)` to stop tweens. `_anim` stays at the exit pose so even if the OLD comp renders one extra frame, the layer is still invisible. The entry is being discarded anyway, so its `_anim` values don't matter for itself.
  - **Second-test fix — Preview UX (2026-05-27, rolled back):** briefly tried making Preview leave the layer at the exit pose, with restoration via chip-switch / modal-close. User pushed back: "Preview is just a preview, not a trigger" — and noticed the obvious dead-end where changing the ease dropdown wouldn't trigger restoration. Reverted to `resetAfter: true` (the original design): both entrance and exit Preview always tween, then snap back to NEUTRAL. Real-delete (`_performDeleteLayer`) is the only commit-to-exit path. This is cleaner mentally: Preview is replay, delete is commit.
- **2026-05-27 — A3 Idle tab ✅ shipped & user-verified.** New exports `startIdleAnimation(entry, cfg, refresh)` and `stopIdleAnimation(entry, refresh)` in [src/editor/animation.js](src/editor/animation.js). The doc's plan was contradictory ("re-skin existing shader motion" vs the example code at top showing GSAP yoyo); resolved as a **hybrid** because not every preset has an existing shader prop. Mapping: **Sway** → `swayAmt`/`swaySpeed` (shader), **Spin** → `spinSpeed` (shader), **Drift** → `panMode='bounce'` two-axis with distinct per-axis rates (shader), **Float** → GSAP yoyo `cyOffset` ±0.05 / 3s (pipe), **Pulse** → GSAP yoyo `scale` 1.0 ↔ 1.08 / 2s (pipe), **Breathe** → GSAP yoyo `opacity` 1.0 ↔ 0.55 / 3s (pipe). Speed slider scales the period inversely for GSAP paths and scales the rate for shader paths. Lifecycle: idle stops before entrance (`playEntranceAnimation` calls `stopIdleAnimation`), stops on layer delete (`_performDeleteLayer`), stops on `_clearForLoad` (preset swap), and auto-fires on `loadPresetData` after entrance settles. UI: idle controls in the modal's Idle tab; Preview button hidden on Idle (loop is its own preview).
  - **First-test fix (2026-05-27):** Drift was implemented with `panMode: 'drift'` (one-way continuous translation), which slid single-image layers off-canvas forever — only sensible for tiled layers where the tile repeat behind. Switched to `panMode: 'bounce'` with two distinct per-axis rates (0.15 / 0.11 cycles/sec scaled by speed, ±0.08 UV amplitude). Image now oscillates around its anchor with the desync the doc's "two independent loops, different durations" intended. Added `panRange` to `IDLE_SHADER_KEYS` so stop also resets it.
  - **Second-test fix (2026-05-27):** Breathe (and Float / Pulse) appeared to stop after using entrance Preview. Root cause: `playEntranceAnimation` was calling the full `stopIdleAnimation`, which (a) was overkill — shader-side idle (Sway / Spin / Drift) composes naturally with entrance because they touch different state (shader props vs `_anim`) — and (b) once entrance completed, the Preview button didn't restart the GSAP-side idle. Fixes: entrance now only does `gsap.killTweensOf(_gsapProxy)` inline (no shader-prop reset), and the Preview button's handler restarts idle in the `.then()` of the entrance promise. Same pattern was already in `loadPresetData` for auto-fire. Net effect: Sway / Spin / Drift keep running through an entrance tween; Float / Pulse / Breathe pause for the entrance and auto-resume after.
- **2026-05-26 — A1 Gate 1 (animations work; UX fixes in flight).** GSAP installed. New module [src/editor/animation.js](src/editor/animation.js) exports `playEntranceAnimation(entry, cfg)` with 9 presets (fade, scale-up/down, slide L/R/U/D, pop, blur). `✦` button on layer card header opens a focused modal (#animate-modal in editor.html) with Entrance chip row + Duration slider + Ease dropdown + Preview button. Tween targets `entry._anim.*` and snaps back to neutral on complete. Auto-fires for any loaded preset's layers whose entrance ≠ none.
  - **First user feedback (2026-05-26):** effects work, but (1) the modal used the `.save-modal` full-page backdrop which blocked the canvas, (2) duration capped at 3s — too short for musical / group-entrance pacing, (3) easings appeared inert because the open-modal path was clone-replacing the controls each open, which silently reset `<select>.value` on reopen. Fixes: dropped `.save-modal`, added a floating non-blocking `.animate-modal` class (no backdrop), duration extended to 0.1–10.0s in HTML / 15s clamp in the engine, listeners are now bound ONCE and operate on `this._animateModalEntry` so the dropdown keeps its state across opens. Pop no longer force-overrides the user's ease.
  - **Critical bug (2026-05-26 — fixed):** after a Preview animation ran, **every** layer-card control (size / opacity / colour / audio reactivity / etc.) went dead. Root cause: `gsap.to(entry._anim, ...)` pollutes its tween target with a `_gsap` Tween reference whose internals are circular. `deepClone(state)` inside `_buildRuntimePreset` (called on every `refresh()` from a slider input) used `JSON.parse(JSON.stringify(...))`, which throws on circular refs. The throw killed the whole shader-rebuild path, making every slider appear inert. Fix: tween a separate `entry._gsapProxy` (non-enumerable so it's invisible to `JSON.stringify`), and copy values into the plain `entry._anim` via `onUpdate`. `_anim` stays a flat 5-prop object that clones safely.
  - **Modal polish (2026-05-26):** modal is now draggable by its header (pointer events, position persists for session). Default position anchors top-right of canvas, well clear of the layer being animated. Exit/Idle tabs now switch instead of being grayed out — each shows a clean informational placeholder describing what lands in A2 / A3 (per doc spec).
  - **Entrance felt wrong, fixed (2026-05-26):** slide-in animations were "appearing then animating" instead of starting off-canvas. Two causes: (1) slide offset was only ±0.4 — image centre still 10% inside the canvas edge so the image stayed visible; (2) `gsap.to` lazy-resolves the from-state, so frame 0 could briefly render at the neutral pose before the tween took over. Fixes: bumped slide offsets to ±1.2 (centre well past the canvas edge), added `opacity:0` to every preset's from-state (frame 0 is always invisible), switched to `gsap.fromTo(..., { immediateRender: true })` so the start pose is synchronous and the very first rendered frame is already the off-canvas / faded state.
  - **Easings — entrance ease audit (2026-05-26):** at long durations (e.g. 9s) the layer would stay invisible for ~6s then rush in over the last 3s — the user picked "Ease In" (`expo.in`). `.in` eases are mathematically back-loaded (slow start, fast end) and are categorically wrong for entrance animations. Entrances must decelerate into rest, which is `.out`. Audit removed `expo.in` and `expo.inOut` from the entrance dropdown and renamed the remaining options to plain-English labels: **Smooth** (`expo.out`, default), **Snappy** (`power3.out`), **Spring** (`elastic.out(1, 0.5)`), **Bounce** (`bounce.out`), **Linear** (`none`). All five front-load the visible motion so picking 9s does what you'd expect. Exit animations (A2) will ship with their own dropdown of `.in` eases since accelerating-away is correct for exits.
  - Gate 2 (contextual panels per chip) and Gate 3 (visual scrubber + bezier editor) still ⬜.
- **2026-05-26 — P0 infrastructure.** `_anim` on every entry, q1..q25 wired through comp shader as multipliers/offsets on baked opacity/size/cx/cy/blur, per-frame eq line pulls from `window.__dcAnim` global written by visualizer's rAF loop. Verified: mutating `_anim.opacity` blanks the layer next frame with no rebuild. Existing layer behaviour unchanged at neutral defaults.

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

## Audio reactivity + animation — UX and compositing

### How they relate

These are two **independent, additive systems** that run at different times and on different properties. They are designed to coexist, not compete.

| System | Where it runs | When it fires | What it touches |
|---|---|---|---|
| Audio reactivity | GPU shader, every frame | Always-on, continuous | Shader-internal opacity/scale/position modulations, driven by `bass`/`mid`/`treble` uniforms |
| Animation (entrance/exit) | CPU (GSAP), `entry._anim.*` uniforms | Event-triggered (layer show/hide) | `u_anim_opacity`, `u_anim_scale`, `u_anim_cx_offset`, `u_anim_cy_offset` |
| Idle (existing shader motion) | GPU shader, every frame | Always-on while layer is visible | `spinSpeed`, `swayAmt`, `bounceAmp`, `orbitRadius` — shader time-based motion |

### Compositing order

The GPU composes these layers multiplicatively at render time:

```
final_opacity  = baked_opacity  × u_anim_opacity  × audio_factor
final_scale    = baked_size     × u_anim_scale     × audio_scale_factor
final_position = (baked_cx + u_anim_cx_offset) + audio_position_offset
```

**During a fade-in entrance:** `u_anim_opacity` goes 0 → 1 over the tween duration. The audio reactivity factor is also applied every frame. The layer fades in while already reacting to the beat — it arrives alive, not static. This is correct and desirable.

**After the entrance completes:** `u_anim_opacity` rests at 1.0 (neutral). Only audio reactivity remains. Identical to a layer with no animation configured.

**During an exit:** `u_anim_opacity` goes 1 → 0. Audio reactivity continues — the layer pulses as it fades out. Also correct.

### UX — where the controls live

**No cross-linking needed in the UI.** The two systems operate independently and the stacking is automatic. Do not add reactivity controls to the animate modal, and do not add animation controls to the reactivity section of the layer card.

```
Layer card
├── [existing reactivity sliders]  — source (Bass/Mid/Treble), curve, intensity
│    └── always visible, always-on, user sets the continuous "behaviour"
└── [✦ animate button]  → opens modal
     └── entrance / exit / idle  — event-driven, user sets the "moments"
```

These answer different questions:
- **Reactivity sliders:** "how does this layer behave moment-to-moment with the music?"
- **Animation modal:** "how does this layer arrive and leave?"

### Edge case: aggressive reactivity during entrance

If a layer has audio-reactive opacity set very high (e.g. heavy bass gating — opacity drops to near 0 between kicks), and the entrance tween is also fading in, the two will fight visually during the entrance. The layer will flicker as it tries to fade in.

This is not a bug — it is the expected composition of two user-configured systems. Document it in user-facing notes (not tooltips — the dev doc) and let the user decide. Do not add a "suppress reactivity during entrance" toggle — that is complexity for a fringe case.

### Idle tab and reactivity — same story

The Idle tab controls (`spinSpeed`, `swayAmt` etc.) are also always-on shader motion. Audio reactivity modulates on top of them. A layer spinning at `spinSpeed = 0.3` with bass-reactive orbit radius will spin continuously AND pulse in orbit with the kick. This is the intended VJ layering effect — the controls are designed to stack.

**Summary: no UI needed to manage the interaction. Document the stacking behaviour here. Let it compose.**

---



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

### Architecture correction (2026-05-26) — q-register pipe, not raw uniforms

Direct `gl.uniform1f(...)` from the rAF loop **cannot work** here. Butterchurn owns the comp program — we never call `getUniformLocation` / `useProgram` on it; we hand it a GLSL string (`currentState.comp`) and it compiles. The existing comment at [inspector.js:6233–6238](src/editor/inspector.js#L6233-L6238) is explicit: *"All per-image parameters are baked as float literals so no custom uniforms are needed."*

**The actual bridge that does work** is Butterchurn's q-register pipe — the same pipe spectral flux already uses ([inspector.js:6218](src/editor/inspector.js#L6218)):

```js
// existing pattern, see fluxLine
runtime.frame_eqs_str += 'a.q31 = (typeof __dcFlux !== "undefined" ? __dcFlux : 0);';
// then in comp shader_body: `float x = q31;` — bare identifier, no declaration needed
```

The frame_eqs_str runs as real JS each frame (Butterchurn translates MilkDrop eqs to JS at parse time), so it can read any `window.*` global and assign to `a.q{n}`. The `q1..q32` namespace is then visible inside the comp `shader_body { }` block as bare identifiers.

### The right architecture: q-register slots per layer

The existing baked values stay untouched; q-registers are offsets/multipliers stacked on top, identical in spirit to the original "animation uniforms" plan — just routed through Butterchurn's eq pipe instead of raw `gl.uniform*` calls.

**Slot map.** 5 animation channels × max 5 layers (`MAX_LAYERS`) = 25 q-registers. Reserved range **q1..q25**. q31 stays with flux. q26..q30 free for future.

| Layer index | Slot base | Channels (offset 0..4) |
|---|---|---|
| 0 | q1 | opacity, scale, cxOffset, cyOffset, blur |
| 1 | q6 | same |
| 2 | q11 | same |
| 3 | q16 | same |
| 4 | q21 | same |

| Channel (per-layer offset) | Purpose | Neutral |
|---|---|---|
| +0 | Multiplies baked opacity | 1.0 |
| +1 | Multiplies baked size | 1.0 |
| +2 | Adds to baked cx | 0.0 |
| +3 | Adds to baked cy | 0.0 |
| +4 | Adds to existing blur | 0.0 |

**Data flow each frame:**

```
GSAP / direct mutation
  ↓ writes
entry._anim.{ opacity, scale, cxOffset, cyOffset, blur }
  ↓ rAF tick reads into a flat global
window.__dcAnim = [{op,sc,dx,dy,bl}, ...]   // one slot per layer index
  ↓ Butterchurn runs frame_eqs_str
a.q1 = __dcAnim[0]?.op ?? 1.0;  a.q2 = __dcAnim[0]?.sc ?? 1.0;  ...
  ↓ comp shader_body uses bare q-identifiers
float _op = ${bakedOp} * q1;   // layer 0
float _sz = ${bakedSz} * q2;
vec2  _center = vec2(${bakedCx} + q3, ${bakedCy} + q4);
```

**Why this is byte-equivalent to direct uniforms at neutral values:** with all `_anim` at defaults, every q-slot resolves to its identity (1.0 or 0.0), and `bakedOp * 1.0 == bakedOp`. The shader output is unchanged until something writes a non-neutral value to `_anim`.

**Zero recompile during tween.** Same guarantee as the original plan. GSAP mutates `_anim`, rAF copies into the global, eq pulls into q-registers, comp shader reads q-registers — no string rebuild anywhere.

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

| Layer type | File | Insertion point (actual, verified 2026-05-26) |
|---|---|---|
| Image | inspector.js | end of entry literal at **2874** (after `tileOuterGap: 0,`) |
| Video | inspector.js | end of entry literal at **3240** (after `isStackedAlpha,`) |
| Text  | inspector.js | end of entry literal at **3413** (after `tileOuterGap: 0,`) |

Add: `_anim: { opacity: 1.0, scale: 1.0, cxOffset: 0.0, cyOffset: 0.0, blur: 0.0 }`

#### P0-B — Wire q-registers into the comp shader

**Replaces the original "uniform declarations" plan.** No `uniform float u_anim_*;` is added — Butterchurn would ignore them anyway. Instead, multiply/offset the baked literals in `_buildImageBlock()` ([inspector.js:6376](src/editor/inspector.js#L6376)) with the layer's q-slot identifiers.

The layer's slot base = `layerIndex * 5 + 1`. Pass the index into `_buildImageBlock` from the loop at [inspector.js:6348](src/editor/inspector.js#L6348).

```js
// inside _buildImageBlock(img, trackAlpha, layerIdx):
const qBase = layerIdx * 5 + 1;        // q1, q6, q11, q16, q21
const qOp   = `q${qBase + 0}`;
const qSc   = `q${qBase + 1}`;
const qDx   = `q${qBase + 2}`;
const qDy   = `q${qBase + 3}`;
const qBlur = `q${qBase + 4}`;

// then in the GLSL string:
//   opacity:  was `${op}`         → `(${op} * ${qOp})`
//   size:     was `${sz}`         → `(${sz} * ${qSc})`
//   cx:       was `${cx}`         → `(${cx} + ${qDx})`
//   cy:       was `${cy}`         → `(${cy} + ${qDy})`
//   blur:     was `${blurAmt}`    → `(${blurAmt} + ${qBlur})`
```

No location lookup; no `_buildCompShader` change beyond passing the index.

#### P0-C — Per-frame eq line + global bridge

Two changes, neither touches `gl.*`:

**1. Inspector — extend the eq injection.** In `_buildRuntimePreset` ([inspector.js:6213](src/editor/inspector.js#L6213)) — the same place the flux line is injected — append one line per layer slot that copies `window.__dcAnim[i]` into the layer's 5 q-registers, neutral on absence:

```js
// alongside fluxLine
const animLines = [];
for (let i = 0; i < MAX_LAYERS; i++) {
  const b = i * 5 + 1;
  animLines.push(
    `a.q${b+0}=(typeof __dcAnim!=="undefined"&&__dcAnim[${i}]?__dcAnim[${i}].op:1);`,
    `a.q${b+1}=(typeof __dcAnim!=="undefined"&&__dcAnim[${i}]?__dcAnim[${i}].sc:1);`,
    `a.q${b+2}=(typeof __dcAnim!=="undefined"&&__dcAnim[${i}]?__dcAnim[${i}].dx:0);`,
    `a.q${b+3}=(typeof __dcAnim!=="undefined"&&__dcAnim[${i}]?__dcAnim[${i}].dy:0);`,
    `a.q${b+4}=(typeof __dcAnim!=="undefined"&&__dcAnim[${i}]?__dcAnim[${i}].bl:0);`
  );
}
runtime.frame_eqs_str = [baseFrame, injectedMotion, injectedWave, fluxLine, animLines.join('')].filter(Boolean).join('\n').trim();
```

**2. Visualizer (or inspector) — refresh the global each rAF tick.** Single line before `this.visualizer.render()` at [visualizer.js:640](src/visualizer.js#L640) — or, more local, in the existing per-frame tick paths in the inspector. Read currentState.images and write a flat array:

```js
// each frame, before visualizer.render():
const imgs = window.__editorInspector?.currentState?.images;
if (imgs) {
  window.__dcAnim = imgs.map(e => e._anim || null);
}
```

(Exact integration point — visualizer.js engine global vs. inspector tick — picked at code time; doc updated when chosen.)

#### P0-D — Serialize / deserialize animation config

In `saveCurrent()` ([inspector.js:7604](src/editor/inspector.js#L7604)) — add `animation` field to each serialized entry.

In `loadPresetData()` ([inspector.js:7737](src/editor/inspector.js#L7737)) — on restore, merge `entry.animation = { ...DEFAULT_ANIMATION, ...saved.animation }`. Presets without the field get defaults silently. Also ensure `_anim` is reset to neutral on load (it's runtime state, not persisted).

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
1. Open editor at `/editor.html`, add an image layer
2. In console: `window.__editorInspector.currentState.images[0]._anim.opacity = 0`
3. Confirm the layer goes invisible on the next frame **without calling `_buildCompShader()` or `_applyToEngine()`**
4. Set back to `1.0`, confirm it returns
5. Repeat for `scale` (0.5 → half size), `cxOffset` (0.2 → shifts right), `blur` (0.5 → blurry)
6. Only after this passes does GSAP get wired in

---

## Phase detail

*Priority order lives in the § Status Dashboard up top. This section contains the implementation detail for each phase.*

### Phase 0 — Pre-build infrastructure (no UI, no visible features)

| Step | What | Location (verified 2026-05-26) |
|---|---|---|
| P0-A | Add `_anim` object to all 3 entry defaults | inspector.js:2874, 3240, 3413 |
| P0-B | Multiply/offset baked literals with per-layer q-slots in `_buildImageBlock` | inspector.js:6376 (loop caller at :6348) |
| P0-C | Per-layer eq lines in `_buildRuntimePreset` + per-frame global refresh | inspector.js:6213, visualizer.js:639 |
| P0-D | Add `animation` field to save/load; reset `_anim` to neutral on load | inspector.js:7604, 7737 |
| P0-E | Console smoke test — `_anim.opacity = 0` blanks layer with no rebuild | — |

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
