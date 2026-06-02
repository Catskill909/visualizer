# MilkDrop Creation Tools — Dev Plan

Last updated: 2026-06-01

> The problem: **the Preset Studio's from-scratch creation surface is limited.** A blank canvas can
> vary palette / motion sliders / one wave / shapes / layers — but the 1,144 bundled presets get their
> character from engine layers (`frame_eqs`, custom `warp` shaders) we don't let users author. This
> plan raises the creation ceiling **without** turning the Studio into a wall of code and knobs —
> *simple to use, great for the creative user* is the hard constraint.
>
> **Companion docs:**
> [milkdrop-tools-archive.md](milkdrop-tools-archive.md) — shipped execution detail (Phases 1–3 +
> Color Studio) + the original brainstorm/survey. Open it for "how did X get built."
> · [milkdrop-dev.md](milkdrop-dev.md) (editor + butterchurn fork)
> · [milkdrop-import-dev.md](milkdrop-import-dev.md) (.milk ingest)
> · [docs/handoff-milkdrop-research-may2026.md](docs/handoff-milkdrop-research-may2026.md) (editor survey).

---

## 🚦 Phase tracker — PICK UP HERE

**Single source of truth for where we are. Update on every change.** Shipped-phase execution detail
lives in the **archive**; this doc holds the live plan. Phases 1–11 are **shipped** — the from-scratch
creator tools are **beta-ready**. Detailed shipped writeups for the recent work are §3.8–§3.16.

| Phase | What | State | Next action |
|---|---|---|---|
| 0 | Brainstorm + direction survey | ✅ DONE — archive §2–§6 | — |
| 1 | **Motion Engine** (living `frame_eqs` motion — Breathe/Sway/Spin + Speed/Depth) | ✅ **SHIPPED & approved** — archive §7 | Optional: 4th engine, Remix-rolls-engine |
| 2 | **Custom Shapes Composer** (up to 4 placement-first shapes) | ✅ **SHIPPED & approved** — archive §8 | — |
| 3 | **Shape Motion & Reactivity** (Spin/Orbit + Source/Curve/Size/Opacity/Spin/Shake/Sides + Trail) | ✅ **SHIPPED & approved** — archive §9 | — |
| 3b | ~~Modulator / LFO bank~~ | ⏸ **Deferred** — inert from scratch (nothing reads spare q-vars); Phase 3 delivered the concrete version | — |
| 4 | ~~Warp Shader Variants picker~~ | ↻ **REVIVED as Phase 7** — the "breaks the app" fear was a misread (shared-mutation impl); per-preset warp is isolated & safe, **verified** (§3.1) | see Phase 7 |
| 5 | ~~Expert eqn / shader drawer~~ | ❌ **REMOVED** — off-brand code surface; revisit only if `.milk` import ships (§4) | — |
| 6 | **Color Studio** (🎲 random + rule/Base-Hue/tone generator + Color Roll + Glow/Accent bloom) | ✅ **SHIPPED & approved** — archive §10 | Optional: HSL sliders, gradient ramp |
| **7** | **Flow Style** — per-preset warp-shader library (the motion *field*) | 🟢 **7.1✅ · library (7 flows) · FILL+Kaleido (§3.10) · Density (§3.11) · ROOT FIX: palette-colour bg everywhere SHIPPED+confirmed; rich fresh-start tried & reverted (§3.12) · bundled-remix dead shape-cards fixed (§3.13).** | Then 7.4 polish (Remix-rolls-a-flow, 4K perf); update README/help/promo once settled |
| **8** | **The Colour Field** — the missing layer 1: a *generated* background colour field (extends Shift) so presets aren't a thin line on a flat slab | ✅ **8.1 Colour Field · 8.2 fg/bg split · 8.3 Motion tab reorg — all SHIPPED · docs banked.** | — |
| **9** | **Full-stack 🎲 Remix** — one button rolls the whole preset (colour field + 3 colours + motion + flow + wave) | ✅ **SHIPPED** — footer Remix → `_rollFullStack()`. **+ 9.1 Roll-and-lock ✅** — pin Colours/Field/Motion/Flow/**Reactivity**, Remix re-rolls only the rest. | — |
| **10** | **Palette declutter + Grade rack** — drop canned variations; grow the controls that tune ANY loaded preset | ✅ **SHIPPED (code, §3.14)** — removed Drift/Pulse/Storm/Ripple/Radiate/Scatter/Bloom (kept Solid+Shift); added **Brightness / Contrast / Gamma / Temperature** grade faders that bolt onto any preset (incl. the 1,144 bundled) via the STUDIO_POST_FX inject. | Optional: Posterize / Vignette; ✗ Templates (dropped — redundant with Remix+Library+Random) |
| **11** | **Remix content variety + shape/A-B fixes** — stop forcing a wave (string) on every roll; fix the shape bugs the variety work surfaced | ✅ **SHIPPED (code, §3.15–§3.16)** — Remix rolls a content TYPE: wave ~20% (subtle coloured accent) / **shapes ~55%** (audio-reactive blobs & polygons via `_addRemixShape`) / pure field+flow ~25%; BLANK base wave softened (white→soft blue 0.6). **A/B "A" re-baselined** to the Shift entry (was stale BLANK string). **`currentState.shapes` is now EDITOR-ONLY** — bundled preset shapes no longer pollute the array / starve the 4 render slots (the "Shape 6"/won't-render bug). | — |
| **12** | **Audio-reactive Grade rack** — make the grade pulse to the beat over ANY loaded preset (the headline next; the audio-reactivity differentiator) | 📋 **PLANNED (deep plan §6)** | **NEXT** — build 12.1 GLSL → 12.2 UI → 12.3 wire/save |
| **13** | **Colour Field v2** — Spin/Angle · 3rd colour stop (A→B→C) · Conic + Spiral styles · Sharpness/Bands · beat-reactive field | 📋 **PLANNED (deep plan §6)** | After 12 |
| **14** | **Scene FX rack** — Posterize / Vignette / RGB-split / scene Mirror, via the grade block; each audio-reactive | 📋 PLANNED | After 13 |
| **15** | **Push from-scratch further** — more Flow warp styles, a second wave | 📋 PLANNED | After 14 |

**Current state in one line:** ✅ **DONE & beta-ready** — Phases 1–11 **shipped**: Motion Engine, Custom
Shapes + Motion/Reactivity, Color Studio, **Flow Style** (7-warp library), **Colour Field** (+ fg/bg colour
split + Motion-tab reorg), **full-stack 🎲 Remix** (+ Roll-and-lock), **Grade rack** (Brightness/Contrast/
Gamma/Temperature tuning *any* preset incl. the 1,144 bundled), and **Remix content variety** (wave/shapes/
pure). The "thin spinning line / one colour / no variety" problem is fully resolved: a from-scratch preset
has all three layers (living colour-field background · motion/flow field · foreground content), each its own
colour, all audio-reactive — one Remix rolls a complete, varied preset, and any control can re-mood the
bundled library. **Differentiator (user-confirmed, the headline edge):** lean HEAVY on audio reactivity —
Remix randomises the reactivity itself; "you can do this in other VJ software but it's a whole thing."
See [[project_audio_reactivity_differentiator]].

**What's next (regroup — phased, deep plan §6):**
1. **Phase 12 — Audio-reactive Grade rack** *(NEXT)* — make Brightness/Contrast/Gamma/Temperature **pulse to
   the beat** so loading any of the 1,144 bundled presets gives it live audio-reactive grading. Sits in BOTH
   bridges (more control over MilkDrop presets **and** the audio-reactivity edge). Contained extension of the
   STUDIO_POST_FX block (§3.14).
2. **Phase 13 — Colour Field v2** — Spin/Angle · 3rd colour stop (A→B→C) · Conic+Spiral styles · Sharpness/
   Bands · beat-reactive field (built alongside 12). Backlog of further field ideas noted in §6.
3. **Phase 14 — Scene FX** — Posterize / Vignette / RGB-split / scene Mirror, via the same grade block.
4. **Phase 15 — Push from-scratch further** — more Flow styles, a second wave.
   *(Honest limit: motion sliders only partly reach bundled presets — their own eqs overwrite them; the
   grade/FX layer is the reliable bridge.)*
Bigger v1 picture beyond the creator: finish Timeline + three.js 3D layers ([[project_v1_beta_scope]]).
Optional minor: Remix "subtle↔wild" dial · feedback-mode Remix variety · a "Content" Remix-lock for shapes.

---

## 0. Design principles (the hard constraints)

- **Additive by default.** No phase removes a control the user already knows. Each is a *new* surface
  layered onto the 4-tab Studio (Palette / Motion / Wave→Shapes / Layers). No tab explosion — each tool
  nests into the dimension it belongs to.
- **Discovery aesthetic.** Prefer **chips + 2-knob templates** over textareas and dense panels. "Pick a
  vibe, turn two dials." No code surfaces, no accent-hue UI. (`[[feedback_slider_discovery_ux]]`,
  `[[feedback_no_accent_color_timeline_ui]]`.)
- **Compose, don't fight.** Any injection (frame_eqs / warp / colour) must layer cleanly over a bundled
  base's own equations, like motionReact/waveReact already do.
- **One shared builder = editor↔player parity by construction.** Anything generated (engine eqs, shape
  eqs, comp post-FX, and now warp) is built by a single function in `customPresets.js` and called in
  **both** `inspector.js` (`_buildRuntimePreset`) and `visualizer.js` (`refreshCustomPresets`). Forget
  the second call and it plays in the editor but dies in the player — the recurring A5 trap.
- **Ship one slice, evaluate, then decide the next.** Don't over-build.
- **IA:** the new Flow Style picker lives in the **Motion** tab (warp = movement character), beside the
  Motion Engine. Full IA rationale in archive (§"IA decision").

---

## 1. The diagnosis — why from-scratch creation feels limited

A `BLANK` preset varies only *surface* dimensions: palette, motion **sliders** (a static `baseVals`
snapshot at frame 0), one basic wave, and image/text/GIF layers. The bundled library gets its character
from two *engine* layers a blank build never authored:

| Engine layer | What it does | Blank canvas | Status |
|---|---|---|---|
| `frame_eqs` | per-frame math that makes motion **evolve & breathe** | none (frozen) | ✅ now authored — **Motion Engine** (Phase 1) + Shape Motion (Phase 3) |
| `warp` shader (GLSL) | the **per-pixel motion field** — the signature tunnel/ripple/kaleidoscope flow | one shared default | ❌ **not authored → Phase 7 (Flow Style)** |

**Phases 1–3 + Color Studio closed the `frame_eqs` and colour gaps.** The remaining gap — and the
biggest one — is the **warp field.**

---

## 2. Where the variety actually comes from (verified 2026-05-31)

User insight, confirmed by audit: **the wave and shapes are *foreground primitives* — they're not where
MilkDrop's variety lives.** The wave is always an oscilloscope (8 modes, all lines you can thicken);
shapes are always polygons. A hexagon reads as a hexagon. They can't deliver the morphing fields that
make presets look wildly different from each other.

**That variety comes from the warp/comp shaders.** A 100-preset sample of the bundled library:

| Source of a preset's look | % of bundled presets |
|---|---|
| **Custom warp shader** (the per-pixel motion field) | **85%** |
| Custom shapes | 52% |
| Custom waves | 32% |
| Animated colour in `frame_eqs` | ~18% |

So the warp field **is** the preset; the wave is a small accent drawn on top. To make from-scratch
presets look as varied as the library, we have to let users author the warp field — no-code.

---

## 3. Phase 7 — Flow Style (per-preset warp-shader library) · DEEP PLAN

**Goal:** a **Flow Style** picker in the Motion tab — pick a motion *field* (Tunnel / Spiral / Ripple /
Kaleidoscope / Plasma / Liquid / Swirl) + the two universal knobs, and a from-scratch preset gets a
signature flowing look instead of the one generic default warp. Additive; chips, not code.

### 3.1 Verified architecture (read-only audit, 2026-05-31)

- **`warp` is a PER-PRESET string field.** `BLANK.warp = ''` ([inspector.js:436](src/editor/inspector.js#L436));
  each bundled preset carries its own `warp`; `loadBundledPreset` copies `bundled.warp`
  ([inspector.js:9350](src/editor/inspector.js#L9350)).
- **The engine recompiles the warp PER preset load** — `warpShader.updateShader(warpText)`
  ([butterchurn.js:2455](src/vendor/butterchurn.js#L2455)), with a `prevWarpShader`/`warpShader` swap
  ([butterchurn.js:2448](src/vendor/butterchurn.js#L2448)) that gives a free cross-preset blend on load.
- **`state.warp` saves & plays for free.** It rides the `...currentState` spread on save and the engine
  reads `preset.warp` directly — same path as `comp` and `shapes`. **No save/load surgery.**
- **🔑 The old "breaks the app" fear was a misread.** §4 (ex-Phase-4) said warp is a "shared submodule"
  that "regresses all 1,144 presets." That risk only exists in a **shared-mutation** implementation (a
  global `warpShader` object a picker mutates). A **per-preset warp string** is fully isolated — bad
  GLSL fails *that preset's* compile only, never another's. **We already safely author per-preset comp
  shaders** (bloom / images / sat-hue-roll all bake GLSL into `state.comp`); per-preset warp is the
  identical proven pattern. The real cost is **GLSL craft**, not cross-preset risk.

### 3.2 ⚠️ Audit unknowns to nail in 7.1 (before building the library)

These need a focused read of the fork's warp shader + 2–3 bundled warps:

1. **The warp-shader GLSL contract.** What `shader_body` provides for the *warp* pass (vs the comp pass
   we already know): `uv` / `uv_orig`, `rad`, `ang`, `time`, `bass/mid/treb`, `q1..q32`, the `sampler_*`
   set — and **what it must write** (`ret` = the displaced/sampled previous-frame colour). The comp
   shader contract is known; the warp pass differs and must be confirmed from the engine source.
2. **Composition with the Motion sliders.** Does the warp pass read the standard `zoom/rot/warp/cx/cy/
   warpanimspeed` uniforms so the existing Motion Engine + Motion sliders still modulate the field?
   (Compose-don't-fight.) Confirm which are available in the warp stage.
3. **Live-switch blend.** Behaviour of the `prevWarpShader` swap when the user changes Flow Style live
   in the editor (we reload the runtime preset on every edit).
4. **Scene Mirror / kaleidoscope overlap.** We already have a Canvas-Mirror kaleidoscope in the comp;
   make sure a Kaleidoscope flow doesn't double up confusingly.

### 3.3 Design — parametric template, not N hand-maintained files

Mirror the proven Motion-Engine / bloom pattern exactly:

- **`WARP_STYLES` catalog** in `customPresets.js` — `{ id, name, glsl(speed, depth) → string }`. Each
  entry is a hand-written warp GLSL template that displaces `uv` into a signature field (tunnel = radial
  push; spiral = `ang += rad`; ripple = `rad += sin(rad·k − time)`; kaleidoscope = angle fold; etc.),
  reading the standard warp uniforms so Motion still modulates it.
- **`buildWarpShader(flow)`** → warp string; **`''` when `id==='none'`** → the preset keeps its existing
  `state.warp` (from-scratch = engine default; remixed bundled = its own warp) → **byte-identical when
  unused.**
- **Two universal knobs** — Speed + Depth (named per-style if clearer, e.g. Scale/Twist), baked as
  literals into the template. Same "pick a vibe, two dials" ethos as the Motion Engine.
- **Interface:** a **Flow Style** chip row in the Motion tab, directly above/beside the Motion Engine
  (reuse `.motion-engine-btn`), + 2 `makeSlider` knobs + ↺ + a **None** chip. Neutral styling.

### 3.4 State shape

```js
// BLANK addition:
flowStyle: { id: 'none', speed: 1.0, depth: 0.5 }
// id ∈ { 'none' | 'tunnel' | 'spiral' | 'ripple' | 'kaleido' | 'plasma' | 'liquid' | 'swirl' }
```
`id:'none'` → `buildWarpShader` returns `''` → `runtime.warp` falls back to `state.warp` (unchanged).
Saves free via `...currentState`; old presets default-fill `none`.

### 3.5 Touch-points (mirrors Phase 1 exactly)

| # | File | Change |
|---|---|---|
| 1 | [src/customPresets.js](src/customPresets.js) | `WARP_STYLES` catalog + `buildWarpShader(flow)` (shared builder; `''` when none; knobs baked as literals). |
| 2 | [src/editor/inspector.js](src/editor/inspector.js) | `BLANK.flowStyle`; in `_buildRuntimePreset`, `const w = buildWarpShader(state.flowStyle); if (w) runtime.warp = w;`; `_buildFlowStyleSection` (chips + 2 knobs + ↺), `_applyFlowStyle`, `_syncFlowStyle` in `_syncAllControls`. |
| 3 | [src/visualizer.js](src/visualizer.js) | The **identical** `buildWarpShader(preset.flowStyle)` in `refreshCustomPresets`. **Parity step — not optional** (A5 trap). |
| 4 | [editor.html](editor.html) | Flow Style section in the Motion tab. |
| 5 | [src/editor/style.css](src/editor/style.css) | Reuse `.motion-engine-btn.active` (likely no new CSS). |

### 3.6 Phased sub-steps (each its own stop-and-evaluate)

- **7.1 — De-risk: audit the dialect + ship ONE flow (Tunnel) end-to-end.** Read the warp shader source
  (§3.2), write a single correct **Tunnel** warp, wire `buildWarpShader` + `runtime.warp` + the
  visualizer parity call + state, and verify: it plays live in the editor, **plays in the player &
  timeline**, survives save→reload, **composes** with the Motion sliders, and a bundled preset is
  untouched. This one slice proves the contract + parity + isolation for the whole phase. **Stop.**
- **7.2 — Picker UI + 2 knobs.** Chips + Speed/Depth + None + sync. (Tunnel already proven.)
- **7.3 — Expand the library.** Add Spiral / Ripple / Kaleidoscope / Plasma / Liquid / Swirl, tuning
  each live in the editor. Bounded GLSL craft, one at a time.
- **7.4 — Polish.** Remix/🎲 rolls a flow; live-switch blend feel; Scene-Mirror overlap; 4K perf check.

### 3.7 Risk / done

- **Risk: medium — and it's *craft*, not *blast radius*.** Per-preset warp is isolated (verified §3.1):
  bad GLSL breaks only that preset's compile, never the other 1,144. Free parity via the shared builder
  + `state.warp`. The real work is writing correct, performant warp GLSL in the fork's dialect — which
  7.1 de-risks before we commit to the full library.
- **Done (7.1) =** pick **Tunnel** → a tunnel motion field flows live in the editor, plays identically
  in the player & timeline, survives reload, still responds to the Motion sliders/Engine, and bundled
  presets are byte-identical. Then build out the library (7.3).
- **This is the headline variety unlock** — it's the missing engine layer (§1/§2) and the no-code answer
  to "MilkDrop presets do so much more."

### 3.8 ✅ 7.1 SHIPPED (code) — Tunnel end-to-end + warp contract confirmed (2026-05-31)

The de-risking slice is in; `npm run build` passes. **Awaiting visual review** before expanding the
library (7.3).

**Warp shader_body contract — CONFIRMED from the fork source** ([butterchurn.js:4279+](src/vendor/butterchurn.js#L4279)):
- **Inputs:** `vec2 uv` (the sample coord — *already* warped by the per-vertex motion mesh: zoom / rot /
  warp / cx / cy / dx / dy / sx / sy → **flows compose with the Motion sliders & Motion Engine for free**),
  `vec2 uv_orig` (unwarped screen UV), `float rad` (`length(uv_orig-0.5)`), `float ang`, `time`, `decay`,
  `bass/mid/treb/vol` (+`_att`), `frame`, `fps`, `q1..q32`, `aspect`, `texsize`, samplers (`sampler_main`,
  `sampler_blur1-3`, noise), `slow_roam_*`/`roam_*`, `PI`.
- **Output:** `vec3 ret`. Default warp = `ret = texture(sampler_main, uv).rgb * decay`. Format must be
  `shader_body { … }` (engine splits on `shader_body`).
- A flow = `ret = texture(sampler_main, uv + <per-style displacement>).rgb * decay` — faded by `decay`
  so the **Trail slider still controls smear**, displacement built from `uv_orig`/`rad`/`ang`/`time`.

**What landed:**

| File | What |
|---|---|
| [src/customPresets.js](src/customPresets.js) | `WARP_STYLES` catalog (`none`, `tunnel`) + `buildWarpShader(flow)` — `''` when none; knobs baked as literals; Tunnel = radial push + gentle swirl × depth, oscillating on time×speed. |
| [src/editor/inspector.js](src/editor/inspector.js) | `BLANK.flowStyle={id:'none',speed:1,depth:0.5}`; `runtime.warp = buildWarpShader(state.flowStyle)` in `_buildRuntimePreset` (only when a flow is active → non-destructive to `state.warp`); `_buildFlowStyleSection`/`_bindFlowKnob`/`_applyFlowStyle`/`_syncFlowStyle` (mirror the Motion Engine, auto-wake feedback); wired into init + `_syncAllControls`. |
| [src/visualizer.js](src/visualizer.js) | Same `buildWarpShader(preset.flowStyle)` in `refreshCustomPresets` → **player/timeline parity**. |
| [editor.html](editor.html) | "Flow Style" section (`#flow-style-grid` + `#flow-style-knobs`) at the top of the Motion tab, above Motion Engine. |

**Confirmed safe:** per-preset `warp` string, recompiled per preset load — isolated from the other 1,144
(the §4 "breaks the app" fear was a shared-mutation misread). `flowStyle` saves free via `...currentState`;
old presets default `none` → byte-identical. Player parity via the shared builder.

**Review checklist (then 7.3):** does Tunnel read as a tunnel field; do Speed/Depth feel right; does it
compose with the Motion sliders + Motion Engine; save→reload + player/timeline parity; `None` returns to
the default warp; tune the Tunnel coefficients before cloning the pattern into the rest of the library.

### 3.9 ✅ 7.1 approved + 7.3 SHIPPED (code) — full Flow Style library (2026-05-31)

**7.1 reviewed & approved** — *"tunnel works well; saved and loaded the preset and it maintained the
tunnel and other slider effects."* Contract + parity + save/load all confirmed in the live editor.

**7.3 — library expanded** (UI is data-driven from `WARP_STYLES`, so this was `customPresets.js` only —
no inspector/html/visualizer changes). `npm run build` passes. Seven flows + None, all cloning the proven
`texture(sampler_main, uv + displacement).rgb * decay` form (Kaleido is the one exception — it folds the
sample angle and `mix(uv, foldedUV, depth)`, so depth 0 = off):

| Flow | Field | Displacement |
|---|---|---|
| **Tunnel** | rushing depth | radial push + gentle swirl, oscillating |
| **Spiral** | twisting in | rotation growing with radius + slight inward pull |
| **Ripple** | liquid rings | radial `sin(rad·22 − time)` waves |
| **Swirl** | whirlpool | rotation `× 1/(rad+k)` — faster near centre |
| **Plasma** | flowing noise | high-freq sin/cos field of `uv_orig` |
| **Liquid** | slow drift | low-freq domain-warped sin |
| **Kaleido** | mirror fold | 6-sector angle fold, depth-mixed recursive feedback |

A shared `wrap(body)` helper builds the 6 displacement flows from one template; knobs baked as literals;
`''` when none. All compose with the Motion sliders (they ride `uv`), fade by `decay` (Trail), and have
free player parity via the shared builder.

**Review the 6 new flows** (Tunnel already approved): each reads as its name; Speed/Depth feel right;
Kaleido at low depth is subtle → full at depth 1; no flow blows out or goes black; player parity. Then
**7.4 polish** — Remix/🎲 rolls a flow, live-switch blend feel, Scene-Mirror overlap check, 4K perf.

### 3.10 🔬 Research + fix — "everything's string-like, nothing draws big" (2026-05-31)

User: flows work but the output stays thin/oscilloscope-like; Kaleido looks wrong. Online research into
the MilkDrop authoring model ([geisswerks guide](https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html))
pinpointed a real architectural gap, not a tuning issue.

**How MilkDrop fills the screen (the two-shader feedback loop):**
- **Warp shader** samples the *previous* frame at warped UVs and fades it (`ret = tex(prev,uv)*decay`) —
  the **feedback loop**.
- **Comp shader** runs on *every* pixel and **generates colour** (`ret = crisp + GetBlur1(uv)*0.5` +
  noise + overbright `ret*=1.8`).
- The **big, filled, sculptural** look comes from **high decay (0.97–0.99) + zoom>1 + gamma**: a thin
  bright wave is **smeared and expanded every frame until it fills the screen**. *The wave is just the
  seed; the feedback loop is the fill.*

**Why ours is string-like — the headline:** to kill the permanent-gray trails (§9.14) we dropped `decay`
to 0.88–0.92. **That is the exact mechanism that fills the screen in MilkDrop.** Low decay = clean ✅ but
also thin/empty ❌. Two lesser gaps: our **comp only *shows* the buffer** (`tex(sampler_main)*2`), it
doesn't *generate* fill; and our **flows only *displace*** — with low decay nothing accumulates.

**The reconciling principle:** *clean is the BLANK default; fill is a deliberate per-flow choice.* The
§9.14 "no permanent trails" rule is about the **blank** canvas. Picking a **Flow Style** is the user
saying "I want a rich field," so a flow may bring fuller feedback (higher decay) — Trail still dials it
back. Resolves the trail-vs-fill tension without regressing the blank default.

**Plan (lever-by-lever, impact order):**
1. **Flow-fill via decay seed (this slice).** On Flow-Style select, if the current trail is below a fill
   threshold, seed `decay = FLOW_FILL_DECAY (0.96)` — *seed-when-clean only* (never stomp a higher one),
   the SHAPE_DEFAULT_DECAY pattern but upward. The flow's warp now accumulates → fills. Opt-in, so the
   clean blank default is untouched.
2. **Kaleido fix.** Current fold skipped aspect + mixed two UV spaces. Replace with the proven
   scene-mirror fold (recompute `_kp/_kang/_krad`, reflect into N sectors, reconstruct `cos/sin*_krad`),
   Depth driving the sector count (2→12).
3. *(Later, lever 2)* a comp **fill field** — amplify the blur textures across the whole frame / a
   generative colour field — if decay-fill alone isn't enough. Deferred until we see lever 1.

**✅ SHIPPED (code, 2026-05-31) — levers 1 + 2 (kaleido):** `npm run build` passes.
- `FLOW_FILL_DECAY = 0.96` ([inspector.js](src/editor/inspector.js)); `_applyFlowStyle` seeds it on
  flow-select when current decay is lower (seed-when-clean), re-syncs both Trail sliders. Flows now
  accumulate → fill.
- **Kaleido rewritten** ([customPresets.js](src/customPresets.js)) to the proven scene-mirror fold
  (recompute `_kp/_kang/_krad`, reflect into N sectors, reconstruct `cos/sin·_krad`, sample directly);
  **Depth → sector count (2→12)**, Speed → slow spin. No more mixed-UV-space distortion.

**Review:** pick each flow → does it now FILL the screen (not thin lines)? Is 0.96 fill right (or do we
want zoom too / a Density knob)? Does Kaleido read as a proper kaleidoscope, busier with Depth? If fill
still feels thin, escalate to **lever 2** (comp fill field).

### 3.11 ✅ SHIPPED (code, 2026-05-31) — Density knob + flow-over-Solid/Shift background

Two follow-ups from the fill review, requested together.

**Density knob (fill, lever 1 made explicit).** Adds the third Flow knob (Speed/Depth/**Density**). Density
bakes a per-frame **zoom-out-of-centre** into the warp shader — content magnifies outward and accumulates
through the feedback loop, so thin lines bloom into a full field (MilkDrop's real screen-fill mechanic,
orthogonal to Trail: decay = how long it persists, Density = how much it expands each frame).
- [customPresets.js](src/customPresets.js) `buildWarpShader`: reads `f.density`, bakes `_z = density*0.03`
  and samples `_zuv = (uv-0.5)*(1-_z)+0.5` for every flow; Kaleido scales `_krad*(1-density*0.03)`.
  Coefficient `0.03` (≈3 %/frame at max) is the tuning dial.
- [inspector.js](src/editor/inspector.js): `BLANK.flowStyle.density = 0.5`; Density slider in
  `_buildFlowStyleSection`; `_syncFlowStyle` backfills `density` for pre-Density presets. Rides inside the
  `flowStyle` object → saves/loads free, player parity free (`buildWarpShader(preset.flowStyle)`).

**Flow plays over the Solid/Shift palette colour (not black).** Previously selecting a flow called
`_wakeFeedbackIfSolid()`, which cleared `_solidColor` → comp base became `sampler_main` → **black**
background, palette colour discarded. Now a flow **keeps Solid/Shift mode on** and the comp composites the
warped feedback over the flat colour (the brightness-keyed `mix(col, _shp, cov)` path, previously
shapes-only).
- `_applyFlowStyle`: no longer wakes/clears solid; only seeds a wave (so the buffer has content to warp)
  + the fill decay, then rebuilds comp. `_bindFlowKnob`: dropped its `_wakeFeedbackIfSolid()` so knob
  nudges don't clear solid either.
- `_buildCompShader`: new `_flowActive` flag; composite trigger `if (_hasShapes || _flowActive)`. Still
  inside the `_solidColor` branch → **no solid set = unchanged** (flow renders on black as before, the
  fallback). Plain Solid/Shift presets (no flow, no shapes) are byte-identical (buffer black → no-op).
- **Player parity:** comp is baked + saved by the editor; the player renders `preset.comp` as-is and does
  not rebuild it, so no [visualizer.js](src/visualizer.js) change. `_solidColor` already round-trips on
  save/load (see [[project_solidcolor_persistence]]).
- **Scope note:** done for Flow Style only (the explicit ask). The **Motion Engine still wakes feedback**
  (renders on black) — left as-is; can get the same flow-over-Solid treatment if wanted.

`npm run build` passes. **Awaiting review:** does Density visibly fill more as you raise it? Does each flow
now play over the Solid/Shift colour instead of black?

### 3.12 ✅ SHIPPED (code, 2026-05-31) — ROOT FIX: palette colour is the background everywhere + rich fresh start

**The "off track" moment.** §3.11's flow-over-Solid was applied to **one of nine** entry points. Every wave
button, wave slider, shape-add, Motion Engine, and Motion Preset still called `_wakeFeedbackIfSolid()`,
which **cleared the Solid colour → black background** + thin line. So flows kept the colour but everything
else blacked out → the "everything's black / string-like, why is the research not applied?" report. Root
cause = the wake-feedback path, in 8 call sites. Fixed at the source, not per-button.

**A — palette colour is the background, everywhere (delete the black-maker).**
- `_wakeFeedbackIfSolid` → **`_ensureFeedbackContent`**: keeps the useful half (seed a wave so there's
  content) but **no longer nulls `_solidColor`**, no longer hides the Solid-FX panel / clears the variation
  chip. All 8 call sites renamed. Competing path deleted, not patched around.
- `_buildCompShader`: composite trigger generalised `_hasShapes || _flowActive` →
  **`_hasFeedbackContent`** = `_hasShapes || _flowActive || _meActive || _waveVisible`. So the feedback
  buffer (wave + shapes + flow + motion) always composites OVER the flat Solid/Shift colour. No-op when the
  buffer is black, so a pure flat colour stays byte-identical. Result: **nothing ever blacks out** — wave,
  shapes, Motion Engine, flows all play over the Palette colour, consistently across every tab.

**B — fresh canvas starts RICH — ⛔ REVERTED same day (user).** Briefly seeded a gentle `liquid` flow +
fill on init + Reset (`_applyFreshStartDefaults()`). User: "the default was loading ONLY shift, and now it
loads shift **and** a preset animation" — the startup/Reset landing is the clean **Shift** asset-layering
surface and must stay colour-only, not auto-animate. Helper + both call sites deleted; default landing is
clean Shift again. **A made B unnecessary anyway:** richness is now one click away — pick any flow and it
plays over the colour and fills (Density). So "start rich" = pick a flow, not force one at startup. BLANK
was never touched (always stayed clean), so nothing else regressed.

**Player parity:** none needed. A's composite is baked into `preset.comp` (saved); B's flow + decay are
saved state; the player rebuilds warp from `preset.flowStyle`. Old presets render from their own saved comp.

`npm run build` passes. **A confirmed working by user** ("it works"). B reverted (above). **Net result:**
palette colour is the background everywhere (never black); the Shift landing stays clean colour-only;
richness comes from picking a flow (over the colour, + Density fill).

### 3.13 ✅ SHIPPED (code, 2026-05-31) — bundled preset must NEVER add shape cards (fixed twice)

**Bug:** loading a bundled MilkDrop preset populated the Wave tab's Custom Shapes list with a card per native
shape that did nothing (sliders read **NaN**). User rule: **a bundled preset must NEVER add menu items to our
UI.** **First fix (insufficient):** `_isRawShape` skipped shapes with non-empty eq strings — but bundled
*static* shapes (empty eqs, raw baseVals, no editor fields) slipped through and rendered as NaN cards, so it
recurred. **Real fix:** render a card ONLY for shapes the editor made, detected by `_isEditorShape(entry)` =
`!!(entry.motion && entry.react)` — editor shapes always carry those objects (makeShapeDefaults); bundled
MilkDrop shapes never do. Works for old saved editor presets too (no marker/migration). Bundled shapes
**stay in `currentState.shapes`** (preserved for the visual + remix-save) but are never shown. `_renderShapeCards`
+ `_addShape` now count **editor** shapes only (the `+ Add Shape` limit/first-shape logic ignores bundled
shapes occupying the array). From-scratch + saved editor presets unchanged.

### 3.14 ✅ SHIPPED (code, 2026-06-01) — Palette declutter + Grade rack (tune ANY preset)

Two mandates from a reassessment of "do templates help?" — answer: no (Remix + Library + Random already
cover starting points; a Templates feature/tab was **dropped as redundant**). The real creative lever is
**tuning loaded presets harder** — so:

**Mandate 1 — declutter "Start from".** Removed the 7 canned motion/wave variations (Drift/Pulse/Storm/
Ripple/Radiate/Scatter/Bloom) from `BASE_VARIATIONS` — they didn't aid creativity and overlapped the 1,144
library + Remix. **Kept Solid + Shift** (they're background colour *modes* — the engine behind the Colour
Field — not presets). `DEFAULT_VARIATION_INDEX (1=Shift)` and all 6 references unchanged → no breakage.

**Mandate 2 — grow the Grade rack.** The mechanism that lets Palette tune a *bundled* preset is
`injectStudioPostFx` — it appends a `/* STUDIO_POST_FX */` block onto **any** preset's comp (the preset
keeps its own shader; we bolt a grade on the end). Added four continuous faders into
`buildStudioPostFxGlsl`, operating on the final `ret.rgb`: **Brightness** (×), **Contrast** (pivot 0.5),
**Gamma** (pow), **Temperature** (R/B shift). Each emits an **empty string at its default → existing
presets byte-identical**. New `gradeOpts(bv)` is the single source of truth for the inject opts, used at all
three call sites (`_rebuildPostFx`, `_buildCompShader`, `loadBundledPreset`). Sliders are data-driven
(`reInject:true` in `_buildPaletteSliders`) so **no HTML change**; synced in `_syncPaletteSliders`. Ride
`baseVals` → save/load + player parity free (grade baked into saved comp, like sat/hue). With image layers,
sat/hue stay col-stage (don't shift layers) while the four grade faders apply whole-frame.

**Result:** load any of the 1,144 bundled presets → Brightness/Contrast/Gamma/Temperature (+ Saturation/Hue/
Roll/Invert/Solarize/Brighten/Darken) now grade it live — "load a preset and *make it yours*." `npm run
build` passes.

---

### 3.15 ✅ SHIPPED (code, 2026-06-01) — Remix content variety (not a string every time)

User caught the root via A/B: pressing **A** always showed a white oscilloscope "string" — because A loads
`originalState` = the **BLANK** base, which shipped `wave_mode 3, wave_r/g/b 1,1,1, wave_a 0.8` (a stark
white wave). And **Remix forced `wave_a = 0.8` + a random wave on every roll** → every preset was
string-dominated, no variety. The Colour Field/flow gave a rich *background*, but the *content* on top was
always the same oscilloscope.

**Fix — Remix rolls a content TYPE** (`_rollFullStack`): **wave ~20%** (a subtle, *coloured* accent —
random mode/scale, `wave_a 0.3–0.6`, not a dominant white string) / **shapes ~55%** (1–3 audio-reactive
blobs & polygons via new `_addRemixShape` — random sides 3→64, size, position, palette WAVE colour to
contrast the field, spin/orbit, + beat-reactive size/opacity) / **pure ~25%** (no thin content — the filled
colour field + flow carry it). Each roll clears the previous content first (drops editor shapes, `wave_a=0`)
so types don't stack. Result: mostly **blobs & flowing colour**, strings only ~1 in 5 — real variety.
Supporting: **BLANK base wave softened** (white→soft blue, `wave_a 0.8→0.6`). Shapes ride the existing
Phase 2/3 system → free player parity + editable cards after a roll. `npm run build` passes.

**The actual root of "A always shows a string" (2nd audit, 2026-06-01).** Softening BLANK was a band-aid —
the real bug: A/B "A" loads `originalState`, which the constructor set to **BLANK** (carries a wave) and
which was **only re-set on preset LOAD** (`loadBundledPreset`/`loadPresetData`/`saveCurrent`) — **never
after init/Reset/New applied the Shift landing**. So on a fresh canvas you *saw* Shift (wave_a:0, no string)
but A still held BLANK → pressing A showed a stray wave. **Fix:** re-baseline `this.originalState =
deepClone(this.currentState)` at the end of **init** and at the end of **Reset** (New routes through Reset →
covered for free; Load already did it). Now A == the actual entry (clean Shift, no string). Requires an
editor reload to take (originalState is captured at init).

---

### 3.16 ✅ SHIPPED (code, 2026-06-01) — editor shapes are independent of preset shapes (the real Remix-shape bug)

User found the true root of "shapes don't render after Remix": a bundled preset's own shapes were kept in
`currentState.shapes` (§3.13 "for the visual") but their cards were *hidden*. So they silently occupied the
array — adding a shape read **"Shape 6"**, and worse: the engine renders only **4** shape slots and
`_buildRuntimePreset` does `slice(0, MAX_SHAPES)` — so the (hidden) bundled shapes **ate all 4 slots** and
the editor shape you added got **sliced off and never drawn** (card + controls present, nothing on canvas).
Remix's content clear used `filter(!_isEditorShape)`, which *kept* the bundled shapes, so they persisted
across every roll.

**Fix — `currentState.shapes` is now EDITOR-ONLY (user mandate: "make our shapes have nothing to do with
presets").** `loadBundledPreset` no longer copies `bundled.shapes` into the array (`shapes = []`); Remix
clears all shapes (`shapes = []`, a full content reroll). So editor shapes never compete with preset shapes
for slots, the count is correct, and added shapes always render. **Trade-off:** a loaded bundled preset no
longer renders its *own* custom shapes (it keeps its warp/comp/waves — the bulk of its look). If preserving
bundled custom shapes matters later, the clean path is a separate `_bundledShapes` field merged
editor-first in `_buildRuntimePreset` — deferred. `npm run build` passes.

---

## 3.5 Phase 8 — THE COLOUR FIELD (honest reassessment, the steer back on track)

**Why everything from-scratch looks the same (the real, structural reason).** A MilkDrop preset's richness
is **three independent layers**: (1) a **generated colour field** — the comp shader procedurally paints the
*whole frame* (gradients, radial glows, plasma, colour cycling by position+time+audio); (2) a **motion
field** — the warp shader (✅ we built this as Flow Style); (3) **foreground content** — wave + shapes. We
only ever built layers 2 + 3 **plus a flat colour.** Our comp shader does exactly one of: show the feedback
buffer (`texture(sampler_main)×2`) or paint one flat colour. **It never generated colour across the frame.**
So every from-scratch preset is structurally `thin wave + warp + flat slab` = a spinning thin line on a
monochrome background. No wave/warp slider can fix that — the missing ingredient is **layer 1**. The docs
named it ("lever 2 — comp fill field", §3.10/§3.11) and it was deferred every time in favour of slider
tweaks. **That was the mistake.** (User reassessment 2026-05-31: "everything looks the same… one palette
controls the animation AND the background, same colour… stronger tools needed.")

**The Shift insight (why this is an extension, not a rewrite).** Shift is the app's headline working
feature — dynamic colour + beat-pulse blend for dance/VJ — and it ALREADY is a colour field: it blends
Colour A→B by an audio signal. It's just **flat** (same blend across the whole screen at once). Make that
blend vary across **space** as well as time and the flat slab becomes a living multi-colour background —
**without losing Shift or the audio reactivity.** We build on the best working element.

**What stays / what was right.** Layers = phenomenal (keep). Bundled-preset loading = great (keep). Audio
reactivity = on point (the load-bearing strength — every field/motion must remain audio-driven).

**Phase 8 plan:**
- **8.1 — Spatial Colour Field ✅ SHIPPED (code, §7).** New `bgField {style, scale, speed}` in BLANK
  (default `flat` → byte-identical, old presets untouched). In `_buildCompShader`'s solid branch the flat
  `_shiftT = clamp(_sr*shift)` becomes `_field + _sr*shift` (clamped), where `_field` is a 0..1 spatial
  pattern from `uv_m`+`time`: **Flat** (=0, classic Shift), **Linear** (diagonal gradient), **Radial**
  (rings), **Plasma** (sin×cos). Same Colour A/B, same audio pulse on top. UI: Field picker + Scale/Motion
  sliders inside the Shift (Solid-FX) panel. Saved free via `...currentState`; player renders the baked comp
  (no visualizer change). *Default stays flat so the Shift landing is unchanged — user opts into a field;
  promote to the Shift default later if liked (NOT silently, after the fresh-start revert §3.12).*
- **8.2 — Foreground/background colour split ✅ SHIPPED (code, §7).** The background field's Colour A read
  `wave_r/g/b` — the SAME value the foreground wave draws in → monochrome collapse. New nullable
  `currentState.bgColorA` gives the field its own Colour A; the shader falls back to `wave_r` when null (old
  presets byte-identical) and only uses `bgColorA` when the background is **dynamic** (non-flat field OR
  Shift on) — so a plain flat Solid still shows the user's "Color" swatch (unchanged). Palette apply / 🎲
  roll set `bgColorA = p.accent` → background field = accent→Shift-colour, foreground wave = `p.wave`: three
  distinct-but-harmonious colours. UI: a **Background** swatch in the Color Field panel (shows the effective
  colour, editable). Preview hover backs up/restores `bgColorA`; rides in `...currentState` for save/load;
  player renders the baked comp (no visualizer change).
- **8.3 — Consolidate the Motion tab ✅ SHIPPED (code, §7).** The three systems are genuinely *different
  mechanisms*, not redundant: **Motion Engine** = living frame_eqs animation (Breathe/Sway/Spin + Speed/
  Depth); **Flow Style** = the per-pixel warp field (+ Density); **Motion Presets** = one-tap baseVals
  snapshots of the raw sliders. Stacking a living Motion + a Flow warp is real power. So 8.3 was an
  **information-architecture** pass, NOT an amputation (user mandate: "keep the controls, one place, ease +
  power"). The Motion tab is now one clean band — **Motion** (engine, renamed) → **Flow** (renamed) →
  **Quick Looks** (the 6 presets, renamed) — with **every** fine control (Movement, Echo, Drift, Warp
  Center, Randomize, Reactivity) tucked into a collapsible `<details class="motion-adjust">` "Adjust — fine
  controls" so the looks stay clean but the power is one click away. **Purely structure + labels: no state,
  save, logic, or event-wiring changes** (JS targets unchanged IDs) → zero regression risk. **8.3 is the
  ENABLER for Phase 9** — the looks now read as clear, rollable axes (Motion / Flow / Colour) for the dice.

**The path AFTER consolidation (what 8.3 unlocks):**
- **Phase 9 — full-stack 🎲 Remix ✅ SHIPPED (code, §7).** The footer **Remix** button (`btn-surprise`) now
  rolls the *entire stack* in one press via `_rollFullStack()`: lands on **Shift** (DEFAULT_VARIATION_INDEX —
  the colour engine, so the field + beat-pulse run) → rolls **colours** (`_rollRandomPalette` → harmony rule/
  tone/hue → wave/glow/accent + contrasting `bgColorA`) → a lively **Colour Field** (style biased to radial/
  plasma/linear + random scale/speed) + a moderate **Shift pulse** + visible wave → a living **Motion**
  engine (random look + knobs) → a **Flow** warp (~35 % none, else random + knobs, seeds fill decay) → a
  random **wave shape** (existing wave randomizer). Reuses the tested apply paths (multi-step undo, like the
  old Surprise). Result: a complete, varied, colourful, *moving* preset every press — not a thin line on a
  slab. **v1:** always lands on the Shift colour engine (variety comes from field/colours/motion/flow/wave
  within it); feedback-mode variety could be added later.
- **Phase 9.1 — Roll-and-lock ✅ SHIPPED (code, §7).** Turns the dice into a compositional tool: a
  collapsible **"🎲 Remix locks"** strip above the footer with five toggle chips — **Colours / Field /
  Motion / Flow / Reactivity**. Pin the ones you love and Remix re-rolls only the rest (each group in
  `_rollFullStack` is gated `if (!L.group)`; a locked group keeps its current values). Locks persist in
  localStorage (`dc.remix.locks`, `loadRemixLocks`/`saveRemixLocks`), like the palette locks, via
  `_bindRemixLocks`. **Reactivity is a first-class lockable group** (Shift pulse depth + audio Source +
  Curve are rolled/pinned) — keeps the audio-reactivity differentiator front-and-centre
  ([[project_audio_reactivity_differentiator]]). `_applyVariation(Shift)` now only fires when in feedback
  mode (`!this._solidColor`), so repeated rolls never reset a locked palette/field. Wave shape is the
  always-rolled content seed (not separately lockable in v1).
- **Starting templates** — a handful of field+motion+content combos so a blank canvas never opens as a bare
  line.
- **→ v1 beta lock** — README/help/promo already current for the Colour Field; final pass at beta.

---

## 6. Phase 12+ — Audio-reactive Grade & beyond (deep plan, 2026-06-01)

Two bridges to keep building: **(A) more of our controls reach a loaded MilkDrop preset** (lever = the
`STUDIO_POST_FX` grade block, §3.14 — bolts onto any preset's final pixel) and **(B) push our from-scratch
tools toward MilkDrop's range** (lever = our generated layers). *Honest limit: motion sliders only partly
reach bundled presets — their own `frame_eqs` overwrite them each frame; the grade/FX layer is the reliable
A-bridge.* User-confirmed north star: **lean HEAVY on audio reactivity** ([[project_audio_reactivity_differentiator]]).

### Phase 12 — Audio-reactive Grade rack (NEXT)

Make Brightness/Contrast/Gamma/Temperature **pulse to the beat** over ANY loaded preset. Sits in *both*
bridges (more control over MilkDrop presets + the audio edge). **UI:** a collapsible **"Grade Reactivity"**
sub-section in the **Palette tab, directly under the grade faders** — a **Source** dropdown + **Curve**
segmented control + per-fader **pulse-amount** sliders (mirrors the Wave/Solid-FX reactivity idiom). **Tech:**
extend `buildStudioPostFxGlsl` so a grade fader bakes a *live expression* (`base + signal·amount`) instead
of a static literal, reading the audio uniforms the Shift pulse already uses (`bass/mid/treb/vol/q31`).
- **12.1 — GLSL:** each grade op optionally `base + curve(source)·amount`; shared Source+Curve. No-op (amount
  0) → byte-identical. Works on bundled + custom alike (same inject path).
- **12.2 — UI:** Grade Reactivity sub-section (Source/Curve/amount sliders), data-driven like `_buildPaletteSliders`.
- **12.3 — Wire/save:** new `baseVals` (`studio_*_react` amounts + `studio_grade_react_source/curve`); `gradeOpts`
  extended; `_syncPaletteSliders`. Rides `baseVals` → save/load + player parity free (grade baked into comp).

### Phase 13 — Colour Field v2 (deepen the background field)

The Colour Field (§3.5 / §8.1–8.2) is the headline background layer; v2 widens its vocabulary. **Shortlist
(approved 2026-06-01):**
- **Spin / Angle** — rotate the field. Linear → gradient angle; Radial/Plasma/etc. → rotate the pattern.
  A continuous spin or a set angle. (Bake a rotation of `uv_m` about centre before the field math.)
- **Third colour stop (A→B→C)** — the field uses a *third* palette colour (the accent) as a mid/end stop,
  so it's a real multi-colour gradient, not two-tone. The single biggest "richness" win. (Palette/🎲 already
  produce 3 harmonious colours — wire the accent in as stop C.)
- **Conic + Spiral styles** — two new field shapes: **Conic** = colour sweep around the centre angle (the
  colour-wheel look, spins beautifully); **Spiral** = colour spirals out (angle + radius blend).
- **Sharpness / Bands** — a knob from soft gradient → hard posterized steps (quantise the field value into N
  bands). Free graphic/retro variety from the same field.
- **Beat-reactive field** — field **scale / spin / blend pulses to the beat**. *Build this alongside Phase
  12* (same audio-uniform-in-comp pattern) so the field breathes with the music.

All ride `bgField` (saves/player-parity free, like §8.1) + the existing comp inject. Same "pick a style,
turn dials" ethos.

**🔭 Colour Field — future / backlog (brainstormed 2026-06-01, NOT in v2):** more styles — **Rings/Bands**
(hard concentric/parallel), **Clouds/Noise** (turbulent fbm, lava-lamp), **Checker/Grid**, **Diamond**
(square-radial); **Drift direction** (field flows a chosen way); **Mirror/Symmetry** (kaleido-fold the
field); **Hue-cycle field** (the field cycles hue over space, tied to Color Roll). Pull from here when v2
proves out.

### Phase 14 — Scene FX rack
Posterize / Vignette / RGB-split (chromatic) / scene Mirror-Kaleido — all in the same grade block, operating
on the final pixel so they tune any preset. Each can reuse Phase 12's reactivity pattern (beat-pulsed FX).

### Phase 15 — Push from-scratch further
More **Flow** warp styles · a **second wave** / richer wave options. The B-bridge — widen the generated-layer
vocabulary. (Colour Field expansion moved up to its own Phase 13.)

---

## 4. Parked & removed

- **Phase 5 — Expert eqn/shader drawer — ❌ removed.** Raw EEL/GLSL textareas are exactly the code-box
  aesthetic the project avoids; the target user (no-code builder) gains nothing. Only resurrects if
  `.milk` import ships and imported presets need an edit home. (Full reasoning: archive §11.2.)
- **Phase 3b — Modulator / LFO bank — ⏸ deferred.** Inert from scratch (nothing reads spare q-vars on a
  blank base); Phase 3 shipped the concrete version (animate the shapes directly). Revisit only with a
  source→destination matrix. (Archive §11.3.)
- **Phase 4 — Warp Variants — ↻ revived as Phase 7.** Originally removed for a "regresses all 1,144
  presets" fear; the audit (§3.1) showed that only applies to a shared-mutation implementation, not the
  per-preset warp string we'll actually use. Reframed and active as Phase 7.

---

## 5. Shipped — execution detail in the archive

Full per-phase writeups (audit → design → what landed → post-review fixes) are in
[milkdrop-tools-archive.md](milkdrop-tools-archive.md):

| Phase | Archive § | One-line |
|---|---|---|
| 1 — Motion Engine | §7 | `MOTION_ENGINES` + `buildMotionEngineFrameEqs`; auto-wake; player parity. |
| 2 — Custom Shapes Composer | §8 | `MAX_SHAPES=4`, placement-first cards, 4-slot pad; shapes render over Solid/Shift too. |
| 3 — Shape Motion & Reactivity | §9 | `buildShapeMotionEqs`; Spin/Orbit + full reactivity + Trail. **§9.13–9.14 = the trail/decay root-cause fix** (default decay lowered across BLANK + all variations; see memory [[project_shape_trail_decay_gate]]). |
| 6 — Color Studio | §10 | 🎲 random + steerable rule/Base-Hue/tone generator (§10.8–10.9.1) + Color Roll (§10.7) + Glow/Accent **bloom** (§10.10). |
