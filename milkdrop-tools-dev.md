# MilkDrop Creation Tools — Dev Plan

Last updated: 2026-06-02

> **The mission:** raise the Preset Studio's *from-scratch* creation ceiling to rival the 1,144 bundled
> presets — **without** a wall of code/knobs. *Simple to use, great for the creative user* is the hard
> constraint. **Status: the core mission is DONE — Phases 1–13 shipped, the creator tools are beta-ready.**
> The headline edge is **audio reactivity** ([[project_audio_reactivity_differentiator]]).
>
> **Companion docs:** [milkdrop-tools-archive.md](milkdrop-tools-archive.md) (original brainstorm/survey +
> Phases 1–3 + Color Studio execution detail) · [milkdrop-dev.md](milkdrop-dev.md) (editor + butterchurn
> fork) · [milkdrop-import-dev.md](milkdrop-import-dev.md) (.milk ingest).

---

## 🚦 Phase tracker — PICK UP HERE

**Single source of truth. Update on every change.** Per-phase essentials are §2; the next-up plan is §3.

| Phase | What | State |
|---|---|---|
| 0 | Brainstorm + direction survey | ✅ done (archive §2–§6) |
| 1 | **Motion Engine** — living `frame_eqs` motion (Breathe/Sway/Spin + Speed/Depth) | ✅ shipped |
| 2 | **Custom Shapes Composer** — up to 4 placement-first shapes | ✅ shipped |
| 3 | **Shape Motion & Reactivity** — Spin/Orbit + Source/Curve/amounts + Trail | ✅ shipped |
| 6 | **Color Studio** — 🎲 + rule/tone/Base-Hue generator + Color Roll + Glow/Accent bloom | ✅ shipped |
| 7 | **Flow Style** — per-preset warp-shader library (7 flows) + Density | ✅ shipped |
| 8 | **The Colour Field** — generated background (spatial Shift) + fg/bg colour split + Motion-tab reorg | ✅ shipped |
| 9 | **Full-stack 🎲 Remix** + **Roll-and-lock** | ✅ shipped |
| 10 | **Palette declutter + Color adjustments** (Brightness/Contrast/Gamma/Temperature tune any preset) | ✅ shipped |
| 11 | **Remix content variety** + the shape/A-B fixes it surfaced | ✅ shipped |
| 12 | **Color Reactivity** — the colour adjustments pulse to the beat over any preset | ✅ shipped |
| 13 | **Colour Field v2** — Spin · Conic/Spiral · Sharpness · 3-colour · beat-reactive field | ✅ shipped & approved |
| 14 | **Scene FX rack** — Posterize / Vignette / Scan lines / Film grain (tune any preset) | ✅ shipped & approved |
| **15** | **Push from-scratch further** — more Flow styles, a second wave | 📋 **NEXT** |
| — | ~~Templates~~ ❌ dropped (redundant: Remix + Library + Random already give starting points) · ~~Expert eqn/shader drawer~~ ❌ removed (off-brand) · ~~Modulator/LFO bank~~ ⏸ deferred | — |

**Current state (one line):** A from-scratch preset now has all three MilkDrop layers — a **living
colour-field background**, a **motion/flow field**, and **foreground content** (wave/shapes) — each its own
colour, all audio-reactive. One **🎲 Remix** rolls a complete, varied preset (rolling a *content type*:
wave / shapes / pure field); **Roll-and-lock** pins what you love. **Color adjustments + Color Reactivity**
(+ Saturation/Hue/Roll/toggles) re-mood and beat-pulse *any* loaded preset, including the 1,144 bundled.
The "thin spinning line / one colour / no variety" problem is fully resolved.

**What's next:** **Phase 15** (more Flow styles, a 2nd wave) — §4. (Phase 14 Scene FX shipped, §3.) Beyond
the creator: finish Timeline + three.js 3D layers ([[project_v1_beta_scope]]). Optional minors: Remix
"subtle↔wild" dial · feedback-mode Remix variety · a "Content" Remix-lock for shapes.

---

## 0. Design principles (the hard constraints — still binding)

- **Additive, no tab explosion.** Each tool nests into the dimension it belongs to (Palette / Motion / Wave
  / Layers).
- **Discovery aesthetic.** Chips + a couple of dials over textareas/dense panels. No code surfaces, no
  accent-hue UI. ([[feedback_slider_discovery_ux]], [[feedback_no_accent_color_timeline_ui]])
- **Compose, don't fight.** Any injection (frame_eqs / warp / colour / grade) layers cleanly over a bundled
  base's own equations.
- **One shared builder = editor↔player parity by construction.** Anything generated (engine eqs, shape eqs,
  warp, comp post-FX) is built by ONE function in `customPresets.js`/`inspector.js` and used in **both**
  `_buildRuntimePreset` (editor) and the player path. Forgetting the second = "plays in editor, dies in
  player" (the A5 trap). *(Most of our generated GLSL is baked into `state.comp`/`state.warp`, which the
  player renders as-is — parity free.)*
- **🎲 Remix exercises every axis (standing rule).** Every new creative axis — especially a *reactive* one —
  gets wired into `_rollFullStack` under the right lock group (audio-reactive → the **Reactivity** lock). A
  feature the dice never rolls is half-shipped.
- **Lean HEAVY on audio reactivity** — it's the differentiator ([[project_audio_reactivity_differentiator]]).
- **No collapsible menus for headline features.** Audio reactivity etc. stay visible, not hidden behind a
  disclosure (user, 2026-06-02). Fine controls can collapse (the Motion "Adjust").

---

## 1. Why from-scratch was limited (the orientation)

A blank canvas varied only *surface* dimensions (palette, motion sliders, one wave, layers). A MilkDrop
preset's richness is **three engine layers**, none of which a blank build authored:

1. **Generated colour field** — the comp shader paints the *whole frame* (gradient/plasma by position +
   time + audio). → built as the **Colour Field** (Phase 8/13).
2. **Motion field** — the `warp` shader (the per-pixel tunnel/ripple/kaleido flow; ~85% of bundled presets
   get their look here). → built as **Flow Style** (Phase 7).
3. **Foreground content** — wave + shapes (Phases 1–3). The wave/shapes are *accents*, not the variety.

Plus the realisation that **the way to tune a *bundled* preset is the comp post-FX inject** (the
`STUDIO_POST_FX` grade block) — it bolts onto any preset's final pixel without touching its internals.
That's the reliable bridge to the 1,144 (the motion sliders only partly reach them — a bundled preset's own
`frame_eqs` overwrite them each frame).

---

## 2. Shipped — the essentials (Phases 1–13)

Tight per-phase facts (the "why/how" that prevents regressions). Full Phases 1–3 + Color Studio writeups are
in the archive; the deep narrative for 7–13 lives in git history + memory.

**1 — Motion Engine.** `MOTION_ENGINES` + `buildMotionEngineFrameEqs` inject living per-frame motion;
auto-wake; player parity via the shared builder.

**2/3 — Custom Shapes + Motion/Reactivity.** `MAX_SHAPES=4`, placement-first cards; `buildShapeMotionEqs`
(Spin/Orbit + Source/Curve/Size/Opacity/Spin/Shake/Sides + Trail). **Trail/decay root-cause fix:** default
`decay` lowered across BLANK + variations (no permanent gray trails) — see [[project_shape_trail_decay_gate]].

**6 — Color Studio.** 🎲 + steerable harmony rule/tone/Base-Hue generator + Color Roll + Glow/Accent **bloom**.

**7 — Flow Style.** Per-preset `warp` string (isolated — bad GLSL fails only that preset's compile, the old
"breaks the app" fear was a shared-mutation misread). `WARP_STYLES` + `buildWarpShader(flow)` → 7 flows
(Tunnel/Spiral/Ripple/Swirl/Plasma/Liquid/Kaleido) + Speed/Depth/**Density** (a per-frame zoom-out-of-centre
that fills the screen). `FLOW_FILL_DECAY=0.96` seeded on flow-select (fill is opt-in; clean stays the BLANK
default). Saves/parity free (`buildWarpShader` in editor + player).

**8 — The Colour Field.** Shift's A→B beat-blend, spread across *space* (`bgField {style,scale,speed}`):
Flat (=byte-identical Shift) / Linear / Radial / Plasma, in `_buildCompShader`'s solid branch. **fg/bg split:**
`bgColorA` gives the field its own Colour A (falls back to `wave_r`; palette/🎲 set it to a contrasting
harmony colour) so the background ≠ the foreground wave. **Motion-tab reorg:** Motion / Flow / Quick Looks +
a collapsible "Adjust" for fine controls (structure only, no logic change). **Root fix — palette colour is
the background everywhere:** the old `_wakeFeedbackIfSolid` (which blacked out on every wave/shape/motion
touch) → `_ensureFeedbackContent` (never clears solid); `_buildCompShader` composites the feedback buffer
over the flat colour whenever there's content (`_hasFeedbackContent`).

**9 — Full-stack 🎲 Remix + Roll-and-lock.** `_rollFullStack` lands on Shift then rolls colours + Colour
Field + Shift pulse + a Motion + a Flow + content. **Roll-and-lock:** a "🎲 Remix locks" strip (Colours /
Field / Motion / Flow / Reactivity) pins groups; persists in localStorage (`dc.remix.locks`).

**10 — Palette declutter + Color adjustments.** Removed the 7 canned variations (kept Solid + Shift — they're
background colour *modes*). **Color adjustments** = Brightness/Contrast/Gamma/Temperature faders, baked into
the `STUDIO_POST_FX` block via `injectStudioPostFx`/`gradeOpts` — tune the final pixel of *any* preset
(incl. the 1,144 bundled); no-op at default → existing presets byte-identical.

**11 — Remix content variety (+ fixes).** Remix rolls a content TYPE — wave ~20% (subtle coloured accent) /
**shapes ~55%** (audio-reactive blobs via `_addRemixShape`) / pure field+flow ~25% — so it's not a string
every time. Fixes it surfaced: **A/B "A" re-baselined** to the live entry (was a stale BLANK wave; re-set
`originalState` on init/Reset/New, not just on load); **`currentState.shapes` is EDITOR-ONLY** — bundled
preset shapes no longer pollute the array or starve the 4 render slots (the "Shape 6"/won't-render bug). See
[[project_bundled_no_shape_cards]].

**12 — Color Reactivity.** The colour adjustments **pulse to the beat** over any preset: `buildStudioPostFxGlsl`
bakes `base + curve(source)·amount` (live `bass/mid/treb/vol/q31`) when a per-fader amount > 0 (else
byte-identical). State: `studio_*_react` (baseVals) + `studio_grade_react_source/_curve` (top-level).
**Always-visible "Color Reactivity" panel** in Palette (Source + Curve + 4 pulse sliders). User-facing name
is **Color** (not "Grade"); internal code keeps `grade*`. Rolled by 🎲 Remix (Reactivity lock, cohesive with
the Shift pulse band).

**13 — Colour Field v2.** All on `bgField`: **Spin** (rotate field over time), **Conic/Spiral** angular
styles, **Sharpness** (quantise into 2→8 hard bands), **3-colour** (`tri` — A→B→C, C = palette wave),
**beat-reactive field** (`react` — zooms/breathes on the beat via `_sr`). Rolled by 🎲 Remix (shape → Field
lock; beat → Reactivity lock). All baked into the comp → saves/parity free.

---

## 3. Phase 14 — Scene FX rack ✅ SHIPPED (code, 2026-06-02)

Final-image FX that tune **any** loaded preset, baked into the `STUDIO_POST_FX` block (on `ret.rgb`, after
colour grading; `uv`/`time` in scope). **Posterize** (`floor(ret·n)/n`, amount→2..15 bands) · **Vignette**
(`smoothstep(length(uv-0.5))` edge darken) · **Scan lines** (soft CRT `sin(uv.y·700)`) · **Film grain**
(animated `hash(uv·time)` noise). State `studio_{posterize,vignette,scanlines,grain}` (baseVals) → `gradeOpts`
→ no-op at 0 (byte-identical when off; verified), save/player-parity free. UI: a **"Scene FX"** section in
the Palette tab (4 reInject sliders), `_buildSceneFxPanel` + `_syncSceneFx`. **🎲 Remix:** clears scene FX
each roll, ~25% adds ONE subtle FX, under the **Colours** lock (look/finish family). Posterize curve tuned punchy (amount→8..2 bands; 0.3 already
reads). `npm run build` passes. **✅ Approved by user 2026-06-02.** *(Vignette/Posterize are content-dependent
— they need bright/full content to show; dark-edged/sparse presets show little, by design.)*

**Audit notes (what shaped the scope):** scene **Mirror/Kaleido** dropped — already shipped as the Canvas
Mirror (`sceneMirror`). **RGB-split/Pixelate deferred** — they need a 2nd render pass (can't re-sample the
*computed* `ret`) and already exist per-layer. Per-FX **beat-pulse deferred** for v1 (scene FX are a static
finish; the post-FX block can't rely on `_sr` existing for non-solid presets — would need its own audio read
like the grade does); Remix rolling them satisfies the "exercise every axis" rule for now.

---

## 4. Phase 15 + backlog

**Phase 15 — push from-scratch further (the B-bridge):** more **Flow** warp styles · a **second wave** /
richer wave options.

**🔭 Colour Field — future ideas (brainstormed, not in v2):** more styles — Rings/Bands, Clouds/Noise,
Checker/Grid, Diamond (square-radial); Drift direction; Mirror/Symmetry (kaleido-fold the field); Hue-cycle
field. Pull from here when wanted.

---

## 5. Parked & removed

- **Templates / Templates tab — ❌ dropped (2026-06-01).** Redundant: Remix (a complete editable preset),
  the Library (saved presets), and Random (1,144 bundled) already cover "starting points." A handful of
  curated templates added nothing the dice doesn't.
- **Expert eqn/shader drawer — ❌ removed.** Off-brand code surface. Revisit only if `.milk` import ships.
- **Modulator / LFO bank — ⏸ deferred.** Inert from scratch; Phase 3 shipped the concrete version (animate
  shapes directly).

---

## 6. Shipped execution detail — archive pointer

Full per-phase writeups (audit → design → what landed → fixes) for the early phases:
[milkdrop-tools-archive.md](milkdrop-tools-archive.md) — §7 Motion Engine · §8 Custom Shapes · §9 Shape
Motion/Reactivity (incl. §9.13–9.14 trail/decay fix) · §10 Color Studio · §2–§6 original brainstorm/survey.
