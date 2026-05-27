# Handoff — Animation System (May 26–27, 2026)

Pick up here for the next animation session. The hub doc with full architecture, design rationale, and per-phase detail is [`animation-dev.md`](../animation-dev.md). **Always read its §0 status block first** — that's the single source of truth for what's shipped vs. pending.

---

## Status as of 2026-05-27

| Phase | What | Status |
|---|---|---|
| **P0** | `_anim` on every entry + q1..q25 q-register pipe + per-frame eq line + save/load | ✅ shipped |
| **A1 Gate 1** | Modal shell, entrance chip picker, duration slider, ease dropdown, Preview, draggable header | ✅ shipped |
| **A1 Gate 2** | Per-preset contextual params (Distance / Start size / Pop from / Start blur) | ✅ shipped |
| **A2** | Exit tab — mirror of entrance with `.in` eases; layer delete awaits exit tween | ✅ shipped |
| **A3** | Idle tab — hybrid (Sway/Spin/Drift = shader props; Float/Pulse/Breathe = GSAP yoyo) | ✅ shipped |
| **A1 Gate 3** | Custom visual scrubber + visual cubic-bezier easing editor | ⬜ next |
| **A4** | CSS polish (layer card add/remove, modal scale-in, chip cross-fades) | ⬜ |
| **B1 / B2 / C1** | Beat-step locomotion, keyframe sequences, performance triggering | ⏸ design later |

---

## Architecture you must not forget

1. **Q-register pipe, not WebGL uniforms.** The original plan called for `gl.uniform1f(...)`. That doesn't work — Butterchurn owns the comp program. Instead, we multiply/offset baked GLSL literals with bare `q{N}` identifiers, and inject a per-frame eq line that copies `window.__dcAnim[i]` into the layer's q-register tuple. See `animation-dev.md` § Architecture correction.

2. **Never `gsap.to(entry._anim, …)` directly.** GSAP attaches a circular `_gsap` Tween reference to its target. `JSON.stringify(currentState)` (used by `deepClone` inside `_buildRuntimePreset` on every slider `refresh()`) chokes on circular refs and silently dead-stops every layer-card slider. Fix in place: tween a separate non-enumerable `entry._gsapProxy` and copy values into the plain `entry._anim` via `onUpdate`. **If you add any new GSAP tween in this codebase, follow that pattern.**

3. **Entrance from-states all start at `opacity: 0`** so frame 0 is invisible — no "appear at neutral then animate" flash. Slide offsets are ±1.2 so the centre lands well off-canvas. `gsap.fromTo(..., { immediateRender: true })` applies the start pose synchronously.

4. **Entrance eases are all `.out` variants** (decelerate to rest). `.in` eases back-load the motion ("nothing for 6s then rushes in at long durations" — see the audit in the hub doc). Exit eases are all `.in` variants (accelerate away). If you ever add eases to entrance, **don't include `.in` curves**.

5. **`_anim` is runtime tween state — never persisted.** `_normalizeImageEntry` resets it to NEUTRAL on every load. Saved presets get a fresh `_anim` on hydrate. `animation` (the user-set config — entrance preset, ease, duration, Gate-2 params) IS persisted.

---

## Files of interest

| File | Role |
|---|---|
| [`animation-dev.md`](../animation-dev.md) | Hub doc — design, architecture, per-phase implementation detail, Recently shipped log. **Start here.** |
| [`src/editor/animation.js`](../src/editor/animation.js) | Engine — `playEntranceAnimation`, `playExitAnimation`, `startIdleAnimation`, `stopIdleAnimation`. All GSAP work lives here. |
| [`src/editor/inspector.js`](../src/editor/inspector.js) | Modal HTML wiring (`_showAnimateModal`, `_syncAnimateModal`, `_syncAnimateParamRows`); layer card `✦` button + dot; `_performDeleteLayer` awaits exit; `loadPresetData` auto-fires entrance+idle. |
| [`editor.html`](../editor.html) | `#animate-modal` markup (3 tabs, chip rows, contextual param rows, duration/ease, Preview button). |
| [`src/editor/style.css`](../src/editor/style.css) | `.animate-modal`, `.animate-chip`, `.animate-param-row`, `.animate-coming-soon`, `.layer-action-btn.layer-animate`. |
| [`src/visualizer.js`](../src/visualizer.js) | rAF loop publishes `window.__dcAnim` from `currentState.images[i]._anim` each frame. |

---

## Quick mental model

```
User picks entrance chip + duration + ease + Gate-2 params (e.g. Slide Right, 2s, Smooth, Distance=1.2)
  ↓ stored on entry.animation
User clicks Preview (or layer auto-fires on preset load)
  ↓
playEntranceAnimation(entry, entry.animation)
  ├─ gsap.killTweensOf(entry._gsapProxy)
  ├─ Object.assign(entry._anim, fromState)            ← frame 0 already off-canvas
  └─ gsap.fromTo(entry._gsapProxy, fromState, toNeutral, { onUpdate: copy proxy→_anim })
       ↓ every frame
       entry._anim mutated by GSAP onUpdate
       ↓
Visualizer rAF reads currentState.images, writes window.__dcAnim
       ↓
Butterchurn frame_eqs_str runs: a.q3 = __dcAnim[0].cxOffset  (layer 0 slot)
       ↓
Comp shader_body: (baked_cx + q3) → image position offset
       ↓
GPU renders the offset → image slides in
```

Exit / Idle follow the same pattern; idle has both a shader-side branch (Sway / Spin / Drift mutate `entry.swayAmt` etc. and call `refresh()` to rebuild the comp once) and a GSAP-yoyo branch (Float / Pulse / Breathe).

---

## Recommended next session

**Phase A1 Gate 3** — replace the temporary duration slider + ease dropdown with the doc-spec visual components:

- **Time scrubber** for duration — horizontal track with a drag handle and live time readout; tick marks at 0.5s intervals; touch-friendly target.
- **Visual cubic-bezier editor** for easing — SVG curve preview, preset chip row above (Linear / Ease Out / Ease In / Spring / Bounce / Custom), draggable handles in Custom mode. Spring and Bounce show a preview but don't expose bezier handles.

Both components reused on Entrance, Exit, and any future tab that needs easing. Gate 3 is pure UX polish on already-working controls — no engine changes, no save-schema changes. Visual cubic-bezier is the larger sub-task (custom SVG component); time scrubber is a custom-styled range.

**Alternative if Gate 3 feels too cosmetic:** **A4 CSS polish** — layer card add/remove transitions, modal scale-in animation, chip selection cross-fades, contextual panel reveal height transition. All CSS, no JS. Visible win with low complexity.

Both are stop-or-go decisions for the user.

---

## Known good user flows

- Add image layer → click `✦` → Entrance → pick **Slide Right, 3s, Spring, Distance=1.5** → ▶ Preview → image rockets in from off-left, springs into place.
- Same layer → Idle tab → pick **Spin, speed 1.5×** → image starts spinning continuously.
- Same layer → Exit tab → pick **Fade, 1.5s, Linger** → ▶ Preview → image fades + holds + fades (Linger pulls back). After preview, image is restored.
- Delete the layer (Delete button → Confirm) → image plays the configured exit, *then* the card is removed.
- All of the above survive a page reload (Vite HMR) and a save/load cycle.

---

## Known caveats

- **Sway / Spin / Drift overwrite the layer-card sliders for those shader props.** Last-write-wins. Documented in the doc and in the modal UI itself ("Sway / Spin / Drift use the same shader properties as the layer card sliders — picking a preset will overwrite those values").
- **Idle is reset, not restored, when stopped.** "None" zeros `swayAmt` etc. — it doesn't restore whatever the user had set before picking the idle preset.
- **Exit-on-preset-swap is instant** (no exit animation). `_clearForLoad` wipes layers before the new preset loads. Awaiting exits-on-swap is a timeline-era concern.
- **Headless verification doesn't work** with this Butterchurn + WebGL stack. `engine.init()` hangs silently in headless Chrome. All verification has been browser-driven by the user.
