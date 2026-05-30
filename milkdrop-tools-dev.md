# MilkDrop Creation Tools — Dev Plan

Last updated: 2026-05-30

> The problem: **the Preset Studio's from-scratch creation surface is limited** — a blank canvas
> can only vary palette / motion sliders / one wave / layers, so it reaches maybe ~12 perceptible
> "themes." The 1,144 bundled presets are infinitely richer because they carry engine internals
> (`frame_eqs`, custom `warp` shaders, custom shapes/waves) we don't let users author. This plan
> raises the creation ceiling **without** turning the Studio into a wall of code and knobs.
>
> Companion docs: [milkdrop-dev.md](milkdrop-dev.md) (editor + butterchurn fork — shipped work),
> [milkdrop-import-dev.md](milkdrop-import-dev.md) (.milk ingest), and
> [docs/handoff-milkdrop-research-may2026.md](docs/handoff-milkdrop-research-may2026.md)
> (the editor-by-editor survey this plan builds on).

---

## 🚦 Phase tracker — PICK UP HERE

**This block is the single source of truth for where we are. Update it on every change.**
Per-phase detail is in §3; the rationale for the ordering is in §4.

| Phase | What | Adds or replaces? | State | Next action |
|---|---|---|---|---|
| 0 | Brainstorm + direction survey | — | ✅ **DONE** (2026-05-30) | — |
| 1 | **Generative Motion Engines** (frame_eqs-backed motion presets, 2 knobs each) | **Adds** a new "living motion" category beside the existing 6 static presets | ✅ **DONE** (2026-05-30) — reviewed & approved | Engine (Breathe/Sway/Spin + Speed/Depth) + auto-wake shipped. Follow-ups (4th engine, Remix-rolls-engine) deferred. |
| 2 | **Custom Shapes Composer** (up to 4 shapes, placement-first cards) | **Adds** — shapes don't exist in the editor today | ✅ **DONE** (2026-05-30) — reviewed & approved ("works great") | Shipped. Post-review fix: opacity slider now uses a `pos²` curve (`SHAPE_OPACITY_CURVE`) so low-alpha gets the travel. |
| 3 | **Shape Motion & Reactivity** (Motion: Spin/Orbit · Reactivity: Size/Opacity/Spin/Shake/Sides + Trail) — *reframed from the abstract "Modulator / LFO bank", see §9.0* | **Adds** motion + reactivity onto Phase 2's shape cards | ✅ **DONE** (2026-05-30) — reviewed & approved | Shipped + post-review fixes (§9.7) + Trail control & expanded reactivity (§9.8). |
| 3b | ~~Modulator / LFO bank (raw q-var wiring)~~ | — | ⏸ **Deferred** — from-scratch presets have no q-var consumers (§9.0); revisit only with a source→destination matrix |
| 4 | **Warp Shader Variants picker** (4–6 GLSL warps as chips) | **Adds** a Motion-tab picker | ⏸ **DEFERRED to its own session + doc** | Touches the *shared* warp shader → can regress all 1,144 presets. Needs a dedicated `warp-variants-dev.md`: vendor/override strategy + cross-preset regression plan. Seed: milkdrop-dev.md "GLSL future work". |
| 5 | **Expert eqn / shader drawer** (opt-in EEL/GLSL textareas) | **Adds** an opt-in expert mode | ⬜ Optional / post-import | Only if we decide a code escape hatch is on-brand |
| 6 | **Color Studio** — palette generator + harmony tools | **Adds** to the Palette tab beside the 12 quick palettes / My Mix | 🟢 **v1 SHIPPED — builds** (🎲 Colors random roll). Foundation for more (§10.5). | Re-test the roll; then build out: rule picker, HSL sliders, gradient ramp, mood presets. |

**Current state in one line:** Phases 0–3 ✅ DONE. **Phase 6 (Color Studio) v1 SHIPPED** — 🎲 Colors
harmony-aware random roll (§10.5), built as the FOUNDATION for a larger Color Studio build-out (rule
picker, HSL, gradient, mood presets). Phase 4 (Warp Variants) deferred to its own session + doc.

**Does this add or replace? → It ADDS.** The existing Palette / Motion sliders / basic Wave / Layers
surface stays untouched. Every phase is a new surface layered on top. The *only* "replace" candidate
is Phase 1 optionally upgrading a couple of the 6 static Motion Presets to frame_eq-backed versions —
and even that is additive (new category beside the old, not a wipe). See §0 below.

---

## 0. Add or replace? (design principle)

**Additive by default.** Nothing in this plan removes a control the user already knows. The current
four-tab Studio (Palette, Motion sliders, basic Wave, Layers) is preserved verbatim. Each phase
introduces a *new* surface:

| Phase | Relationship to existing controls |
|---|---|
| 1 — Generative Motion Engines | New "living motion" category **beside** today's 6 static Motion Presets. The static presets stay. *Optional* later: convert 1–2 of the existing 6 to frame_eq-backed versions — a per-preset call, never a bulk replace. |
| 2 — Custom Shapes Composer | Brand-new surface. Shapes are not exposed in the editor today → pure add. |
| 3 — Modulator / LFO bank | Brand-new surface → pure add. |
| 4 — Warp Variants picker | New Motion-tab picker → pure add (the default warp remains the default). |
| 5 — Expert drawer | New opt-in mode → pure add, hidden unless invoked. |
| 6 — Color Studio | New generator button + harmony tools in the Palette tab → pure add; the 12 quick palettes, color rows, and My Mix all stay. |

This matches the house preference for additive work over tearing out existing controls, and keeps
the discovery aesthetic intact — no user loses a dial they already rely on.

---

## IA decision — two starting mechanisms + where new controls live

**Clarification (verified 2026-05-30):** the Palette tab's "START FROM" variations are **not** full
presets — all 9 are static `baseVals` snapshots on the shared default engine ([inspector.js:463](src/editor/inspector.js#L463)):

- **Solid / Shift** — the basic pair; flip the comp shader to a flat-color base (`solid:`), bypassing
  the warp feedback engine. `wave_a:0` (no waveform).
- **Drift / Pulse / Storm / Ripple / Radiate / Scatter / Bloom** — *richer* baseVals snapshots
  (zoom/warp/decay/echo + wave mode/color/borders) but **no warp shader, no frame_eqs, no shapes** —
  same static engine. This is §1 in miniature: even the "richest" starter is frozen baseVals.

**Two distinct starting mechanisms — keep them unconfused:**

| Mechanism | What it is | Where |
|---|---|---|
| **The editor (4 tabs)** | the **from-scratch toolkit** — primitives only (variations, palettes, motion, wave, layers, and every new tool here) | Palette / Layers / Motion / Wave |
| **Footer 🎲 Random / 🎨 Remix** | **start from a real preset** — loads one of the 1,144 full presets to remix | footer, not a tab |

Every tool in this plan is a **from-scratch primitive**, not a "load a preset" — Phase 1 is the first
one that adds the missing *engine layer* (`frame_eqs` = living motion) the static snapshots never reach.

**Stay at 4 tabs — nest each phase into the dimension it belongs to** (no tab explosion):

| New tool | Lives in | Why |
|---|---|---|
| Phase 1 — Motion Engine | **Motion** (top, above Motion Presets) | it *is* movement |
| Phase 4 — Warp Variants | **Motion** (chips near the Engine) | warp = movement character |
| Phase 2 — Custom Shapes | **Wave**, reframed "**Shapes & Wave**" | shapes + wave are both drawn vector primitives |
| Custom Waves (E) | **Wave** | siblings of the basic wave |
| Phase 3 — Modulator/LFO | small block in **Motion**; own tab only if it grows | cross-cutting; Motion is first consumer |
| Phase 5 — Expert drawer | global **slide-over**, not a tab | opt-in power mode, off the main surface |
| Phase 6 — Color Studio | **Palette** tab | color is the Palette dimension; sits beside quick palettes + My Mix |

Resulting mental buckets: **Palette** = color · **Layers** = content · **Motion** = all movement
(Engine + Warp + Presets + reactivity) · **Wave→Shapes** = all drawn generative primitives.

---

## 1. The diagnosis — why creation feels limited

When the Studio starts from `BLANK`, every preset shares the **same engine** and only varies four
*surface* dimensions:

- Palette (colors)
- Motion sliders → `baseVals` — a **static snapshot at frame 0**
- One basic wave shape
- Image / text / GIF layers

The 1,144 bundled presets get their character from three *engine* layers a blank build **never
touches**:

| Engine layer | What it does | Blank canvas | Bundled presets |
|---|---|---|---|
| `frame_eqs` | Per-frame math that makes zoom / rot / warp / center **evolve & breathe** | none — frozen baseVals | unique per preset |
| `warp` shader (GLSL) | Defines the signature look (tunnel / ripple / kaleidoscope flow) | one shared default | unique per preset |
| Custom shapes / waves | Engine supports **4 of each**; we expose only the single basic wave | 1 basic wave | up to 4+4, scripted |

**Root cause in one line:** a from-scratch preset is *static* (baseVals only) and *generic* (shared
warp/comp), so it can't reach the living, signature looks the bundled library gets for free.

This was already self-diagnosed in [milkdrop-dev.md](milkdrop-dev.md) §"Remix Family → Why this is
the next move" — Remix-from-bundled was the *consumption-side* fix (start from 1,144 points instead
of 1). This doc is the *creation-side* question: how do we raise the ceiling for users who build
from blank.

---

## 2. What the GitHub editors expose (condensed survey)

Full notes in the May research handoff. The headline:

| Editor | Creation surface | Takeaway |
|---|---|---|
| Winamp MilkDrop 2 | Keyboard menu over ~35 baseVals + **in-canvas code editors** | All params, zero GUI |
| butterchurn-editor-electron (jberg) | **Raw textareas** per section (eqs / shapes / waves / shaders) | Code-only |
| MilkDrop3 / BeatDrop | 6 named sliders + **shader editor** (autocomplete, recompile); 16 shapes/waves, q1–q64, 500-sided shapes, `get_fft()` in shaders, 28+ transitions | Code + a few sliders |
| projectM | renderer only | No authoring UI |
| NestDrop | VJ playback (blend / strobe / LFO) | No baseVal editing |

**The pattern that matters:** *every* editor that lets you create rich presets does it through
**code** — EEL equations + HLSL/GLSL shaders. None solved "author a living preset without writing
code." Our Studio already **beats all of them** on baseVal coverage, image layers, per-layer
reactivity, GIF, and per-layer effects (chromatic / posterize / mirror / sway / wander / orbit /
tunnel). They beat us *only* on the three engine layers in §1, purely because they expose the code.

**So the design problem is specific:** give blank-canvas builds access to `frame_eqs` / `warp` /
custom shapes **without** the grid-of-knobs / code-box aesthetic the project is deliberately moving
away from (see memory `[[feedback_slider_discovery_ux]]` + the Remix "Discovery aesthetic" section).

---

## 3. Six expansion directions

Ranked loosely by payoff-to-effort and fit with the discovery aesthetic. None are committed.

### A. Generative Motion Engines (frame_eqs-backed presets) — ★ best payoff/effort → **Phase 1**
Today's 6 Motion Presets are **static `baseVals` snapshots**. Augment/replace them with *parametric
frame_eq templates* — pre-written motion math, each exposing 2–3 knobs.

- Example: **"Breathing Tunnel"** = frame_eqs oscillating `echo_zoom` + `cx/cy` on a Lissajous,
  knobs = Speed + Depth. **"Pulse Vortex"** = `rot` + `zoom` driven by a decaying beat envelope.
- This attacks the **root cause** (static baseVals) directly — turns blank presets from frozen to
  alive, which is the single biggest "why do mine look flat" complaint.
- **Plumbing partly exists:** the animation system already pipes values into q-registers
  (`[[project_animation_system]]`, q-register pipe not uniforms). frame_eqs can read those q-vars,
  so generative motion can ride existing infrastructure rather than inventing a new injection path.
- Aesthetic fit: **excellent** — still "pick a vibe, turn 2 dials."
- Risk: a bundled-preset base already has its own frame_eqs; injected motion must *compose* with
  them, not fight (same caveat already documented for motionReact in the Remix taxonomy table).

### B. Custom Shapes Composer — already planned (handoff Phase 13) → **Phase 2**
Engine supports **4 custom shapes** (polygons, n-gons, textured, additive). Placement-first card UI
mirroring image layers: each card = XY pad + sides + size + color + border + toggles.

- Unlocks **off-center composition** and hard geometry the single wave can't do — the documented
  answer to "why does everything radiate from the center?"
- Aesthetic fit: **good** — reuses the existing image-layer card + XY-pad pattern.
- Effort: medium. 25 fields/shape exist in the engine; composer exposes a curated subset.

### C. Warp Shader Variants picker — highest visual ceiling, real GLSL (deferred Phase 9) → **Phase 4 (stretch)**
A dictionary of 4–6 hand-written warp GLSL strings (radial / stripes / spiral / tunnel /
ripple-zoom) selectable as chips in the Motion tab.

- This is **the** thing that defines named-MilkDrop looks — biggest expressive jump available.
- Implementation sketch already in [milkdrop-dev.md](milkdrop-dev.md) §"GLSL future work" (Option B:
  `WARP_VARIANTS` dict + `warpShader.updateShader()` per variant).
- Aesthetic fit: **good** (chips, not code) once the shaders are written.
- Risk: **high** — warp is a shared webpacked submodule; breaking it breaks every shipping preset.
  Needs cross-preset regression testing. This is genuine shader engineering, not a slider.

### D. Modulator / LFO bank for q-variables — most "DiscoCast-flavored" power tool → **Phase 3**
MilkDrop's `q1`–`q32` are the glue between frame_eqs, per-pixel math, and shaders. Build a **visual**
modulator bank: assign LFO sources (sine / saw / random / bass / mid / treb / vol) to q-vars by
drag, then let motion/warp read them — **no code**.

- "bass → q1 → warp depth" becomes a wiring gesture, not an EEL line. Modular-synth feel.
- Aesthetic fit: **good-to-novel** — could become a signature DiscoCast surface, closer to "spin
  the dial" than a textarea. Pairs naturally with A (the motion engines read the q-vars).
- Effort: medium-high (new UI paradigm). Best scoped *after* A proves the frame_eq injection path.

### E. Custom Waves expansion — moderate → **unscheduled (sibling to Phase 2)**
The **4 custom waves** (separate from the basic wave) each carry spectrum / shape / smoothing / EEL.
Multi-wave = layered oscilloscope art. Lower ceiling than A–C; a natural sibling to B.

### F. Equation / shader editor — the escape hatch, *against* the aesthetic (Phases 10/11) → **Phase 5 (opt-in)**
A hidden **"Advanced"** drawer with EEL / GLSL textareas, like butterchurn-electron. Unlocks
literally everything, but it's exactly the grid-of-knobs / geek surface the project steers away
from. **Frame as opt-in expert mode, never the default.** It's also the natural editing home for
*imported* `.milk` presets (whose motion lives in raw `frame_eqs_str`, per
[milkdrop-import-dev.md](milkdrop-import-dev.md) §7.2) — so import + expert editor reinforce each
other if both ship.

### G. Color Studio — palette generator + harmony tools → **Phase 6** (after Phases 1–5)
The Palette tab today gives fixed choices (12 quick palettes, RGB color rows, My Mix). Add real
*color creation* from scratch:

- **Random color generator** (the headline) — one-click "🎲 Colors" that rolls a **coherent** scheme
  using color-theory rules (complementary / analogous / triadic / split-complementary / monochrome),
  not three random RGBs. Seed one hue, derive wave / glow / accent from it. Plays nicely with the
  existing per-channel 🔒 locks: lock a hue you like, reroll the rest.
- **Harmony tools** — pick a base color + a harmony rule and auto-fill the three channels.
- **Possible extras** — HSL sliders (current rows are RGB swatches), a two-color gradient/ramp mapped
  across wave→glow→accent, color-temperature / mood presets (warm / cool / neon / pastel).
- Aesthetic fit: **excellent** — "roll the dice, get a beautiful scheme" is pure discovery aesthetic.
- Lives in the **Palette** tab (color dimension; fits the 4-tab IA). Additive — every existing color
  control stays.

---

## 4. Recommended reading of the field

The order that maximizes "blank canvas feels rich" while respecting the no-code aesthetic:

```
A  Generative Motion Engines     ← attacks the root cause (static baseVals); rides q-register pipe
B  Custom Shapes Composer        ← off-center composition; reuses card/XY-pad pattern (Phase 13)
D  Modulator / LFO bank          ← visual q-var wiring; pairs with A
─────────────────────────────────
C  Warp Variants picker          ← high ceiling, high risk; stretch goal, real shader work
F  Expert eqn/shader drawer      ← opt-in only; also the editing home for imported .milk
```

**Why A first:** it's the only direction that fixes the *root* problem (frozen baseVals) rather than
adding more surface, and the q-register plumbing already exists. B is the strongest composition
unlock and reuses patterns we have. D is the differentiated power tool but should wait until A
proves the injection path. C is the dream but carries regression risk across all 1,144 presets. F
should exist only as an expert opt-in, made far more valuable if `.milk` import ships.

---

## 5. Cross-cutting considerations

- **Beta scope:** per `[[project_v1_beta_scope]]`, the project is close to beta with Timeline + 3D
  layers as the remaining headline work. Most of §3 is likely **post-beta** — flag before scheduling.
- **Compose, don't fight:** any frame_eq / q-var injection (A, D) must layer cleanly on top of a
  bundled base's own equations, exactly like motionReact/waveReact do today. The Remix taxonomy
  table (milkdrop-dev.md) already maps which fields "stick" vs. get "stomped" every frame — reuse it.
- **Discovery aesthetic is a hard constraint:** prefer chips / 2-knob templates / drag-wiring over
  textareas and dense panels (`[[feedback_no_accent_color_timeline_ui]]`, `[[feedback_slider_discovery_ux]]`).
- **Don't over-build:** ship one direction, evaluate, then decide the next — same stop-and-evaluate
  discipline the butterchurn fork used. (See `[[feedback_heed_own_ux_warnings]]`.)

---

## 6. Open questions (for the user — no decisions yet)

1. **Which direction first?** A (generative motion) is my recommendation as the root-cause fix.
2. **Beta gating** — is any of this in-scope before the v1 beta, or strictly after Timeline + 3D?
3. **Expert mode (F)** — do we want a code escape hatch at all, or is it firmly off-brand? (It
   becomes much more valuable if `.milk` import ships, since imported presets need somewhere editable.)
4. **Relationship to import** — should creation-tools work wait until `.milk` import lands, so the
   two share the "edit a code-driven preset" surface? Or are they independent tracks?

---

## 7. Phase 1 — Execution plan (audit complete, awaiting code approval)

**Goal:** add a *Motion Engine* — autonomous, time-driven motion that makes a blank canvas breathe
and evolve instead of sitting frozen on static `baseVals`. Additive; the existing static Motion
Presets and every other control stay exactly as they are.

### 7.0 ⚠️ PREREQUISITE — the solid-mode default trap (verified 2026-05-30)

**Discovered while reviewing the live editor.** The Motion and Wave tabs appear to "do nothing" on a
fresh preset. This is **not** a control bug — it's a render-mode trap, and it blocks Phase 1 if not
addressed first.

- The editor has **two render modes**:
  - **Solid / Shift** = *flat-color mode*. The comp shader builds output from `vec3(wave_r,g,b)` and
    **never samples `sampler_main`** (the warp feedback buffer) — [inspector.js:7042-7073](src/editor/inspector.js#L7042-L7073).
  - **Drift / Pulse / Storm / Ripple / Radiate / Scatter / Bloom** = *feedback mode*. Comp samples
    `sampler_main` (`texture(sampler_main, uv_m).xyz*2.0`), so warp/zoom/rot/echo + wave all show.
- **The app boots into Shift** (`DEFAULT_VARIATION_INDEX = 1`, [inspector.js:569](src/editor/inspector.js#L569))
  — the one mode where Motion + Wave are inert (the moving buffer is ignored; `wave_a:0` anyway).
- **Why this blocks Phase 1:** the Motion Engine drives `zoom/cx/rot` on the feedback buffer. In
  solid mode the comp discards that buffer → the new control would look just as dead as the existing
  Motion/Wave controls. Same root cause.

**Resolution (chosen 2026-05-30): keep Shift as the default, add auto-wake.** The user likes Shift as
the landing surface — it shows audio reactivity immediately and gives a flat background for layering
assets. So instead of changing the default, `_wakeFeedbackIfSolid()` flips the base from flat-color
to feedback the *moment* the user touches a Motion/Wave control or picks a Motion Engine. Shift stays
the friendly start; it just "wakes up" on use. Wired into: Motion Engine select + knobs, Motion
sliders, Motion Presets, motion randomize, Wave mode grid, Wave sliders, wave randomize. Seeds
`wave_a=0.8` if hidden so the feedback buffer has content to act on; clears the Solid-FX panel +
variation-chip highlight on wake. (Undo of the wake mirrors existing variation-change undo behaviour —
`_solidColor` is an instance var outside `currentState`; pre-existing, not newly introduced.)

### 7.1 Verified architecture (read-only audit, 2026-05-30)

- **Injection mechanism:** `frame_eqs_str` is plain JS compiled via `new Function('a', str+'return a;')`
  ([src/vendor/butterchurn.js:6721](src/vendor/butterchurn.js#L6721)). It reads/writes the `a.`
  namespace: `a.zoom / a.rot / a.warp / a.warpanimspeed / a.cx / a.cy / a.dx / a.dy / a.sx / a.sy /
  a.decay / a.gammaadj / a.echo_zoom / a.time / a.bass / a.mid / a.treb / a.vol / a.q1..q32`.
- **The composition order is the load-bearing fact** ([src/editor/inspector.js:6963](src/editor/inspector.js#L6963)):
  `frame_eqs_str = [baseFrame, injectedMotion, injectedWave, fluxLine, animLines].join('\n')`.
  The preset's own `frame_eqs` run **first**; our injected lines read the post-base value and **add**
  on top. Every existing builder uses `a.field = clamp(a.field + signal*amt)` — purely additive.
  This is *why* an engine composes cleanly over any bundled base instead of fighting it.
- **Player parity:** the player/timeline rebuilds the identical string in
  [src/visualizer.js:589-599](src/visualizer.js#L589-L599) via the same `customPresets.js` builders
  (single source of truth). **Any new injection MUST be added in both places** or it plays in the
  editor only — the A5 regression trap from `[[project_animation_system]]`.
- **q-register budget:** q1–q25 = animation layers, q31 = flux. Engines **don't need q-vars** — they
  drive straight off `a.time` (+ optionally audio), exactly like `buildMotionReactFrameEqs`. Avoid
  q-vars entirely in Phase 1 → zero collision risk.
- **State round-trips for free:** `saveCurrent` spreads `...this.currentState`
  ([src/editor/inspector.js:8413](src/editor/inspector.js#L8413)); `loadPresetData` overlays onto
  `deepClone(BLANK)`. A new `state.motionEngine` field saves automatically and old presets
  default-fill it. **No save/load surgery** (contrast `_solidColor`, which needed explicit
  round-tripping — `[[project_solidcolor_persistence]]`).

### 7.2 Design — concept + interface

- **Concept split (honest + additive):** the existing 6 **Motion Presets** stay as static *starting
  looks*. A new **Motion Engine** section adds *living, evolving* motion on top — and the two
  compose (apply a preset AND an engine). Engine = autonomous, time-driven life; `motionReact` stays
  the audio-driven beat punch. No functional overlap.
- **Two universal knobs only:** every engine exposes **Speed** + **Depth**. Pick an engine chip →
  the two sliders configure it. That's the whole aesthetic — *pick a vibe, turn two dials* — no
  per-engine knob sprawl, fits `[[feedback_slider_discovery_ux]]`.
- **Interface** (Motion tab, new section directly above `#motion-presets-grid`):

  ```
  ┌─ Motion Engine ───────────────────────  ↺ ─┐
  │  ◯ None   ◉ Breathe   ◯ Sway   ◯ Spin     │   chips reuse .motion-preset-btn
  │           pulsing zoom                      │
  │  Speed   ●──────────○        1.0×          │   makeSlider → dbl-click reset free
  │  Depth   ●────○              0.5           │
  └─────────────────────────────────────────────┘
  ┌─ Motion Presets ──────────────────────  ↺ ─┐   EXISTING — untouched
  │  [Vortex] [Calm Drift] [Earthquake] ...     │
  └─────────────────────────────────────────────┘
  ```
  Selected chip gets the conditional active highlight (mirrors the wave-mode grid). Neutral styling,
  no accent hues. Plays **live** in the editor preview (injection runs every frame) and in the
  player/timeline.

- **The three starter engines** (distinct axes, all additive on `a.`, time-driven):
  | Engine | Equation sketch | Feel |
  |---|---|---|
  | **Breathe** | `a.zoom += sin(time·speed)·depth·0.04` | hypnotic in/out pulse |
  | **Sway** | `a.cx += sin(time·speed)·depth·0.12; a.cy += cos(time·speed·0.8)·depth·0.12` | warp center drifts in a Lissajous — the *dynamic* answer to "why does everything radiate from center?" |
  | **Spin** | `a.rot += sin(time·speed)·depth·0.15` | rocking / oscillating rotation |

  Exact coefficients to be tuned during implementation; every write is clamped to the same safe
  ranges `buildMotionReactFrameEqs` already uses (no runaway zoom / blackouts).

### 7.3 State shape

```js
// BLANK addition:
motionEngine: { id: 'none', speed: 1.0, depth: 0.5 }
// id ∈ { 'none' | 'breathe' | 'sway' | 'spin' }
```

`id:'none'` → builder returns `''` → blank presets stay byte-identical (truly static), and
frame_eqs aren't bloated when the feature is unused.

### 7.4 Touch-points (4 files, all mirroring existing patterns)

| # | File | Change |
|---|---|---|
| 1 | [src/customPresets.js](src/customPresets.js) | New `MOTION_ENGINES` catalog (`{id,name,desc,eqs(speed,depth)→string}`) + `buildMotionEngineFrameEqs(me)` (mirrors `buildMotionReactFrameEqs`; `''` when `id==='none'`; clamps every write). Catalog lives here so editor + player share one definition. |
| 2 | [src/editor/inspector.js](src/editor/inspector.js) | `BLANK.motionEngine` default; add `injectedEngine` to the `_buildRuntimePreset` array **before** `injectedMotion`; `_buildMotionEngineSection()` (chips + 2 `makeSlider` knobs + ↺), `_applyMotionEngine(id)`, sync on load; optional Remix/randomize hook (can defer). |
| 3 | [src/visualizer.js](src/visualizer.js) | Add the same `buildMotionEngineFrameEqs(preset.motionEngine)` injection to `refreshCustomPresets` (~L589) so engines play in player/timeline. **Parity step — not optional.** |
| 4 | [editor.html](editor.html) | Motion Engine section markup above `#motion-presets-grid` (chip container + 2 slider rows + reset button). |

### 7.5 Risk / done

- **Risk: low.** Additive injection composes with any base; `''`-when-off keeps blanks static; no
  q-var collisions; no save/load changes; one shared builder = editor/player parity by construction.
- **The one trap to not repeat:** forgetting touch-point #3 → engines play in the editor but die in
  the player (the A5 single-source-of-truth lesson).
- **Done =** picking an engine chip makes a blank canvas visibly breathe/drift/rock live in the
  editor; Speed + Depth scale it; ↺ and `None` return it to frozen; save → reload round-trips the
  engine; the *same* motion plays in the main player and timeline; a bundled-base preset gains the
  engine's motion layered on top of its own without breaking; old presets load with `id:'none'`
  (unchanged). Then **stop and evaluate** before Phase 2.

### 7.6 ✅ Shipped & approved 2026-05-30

Implemented across the 4 planned touch-points; `npm run build` passes (only the known butterchurn
UMD-in-ESM warnings). Reviewed in the editor and signed off ("great basics").

| File | What landed |
|---|---|
| [src/customPresets.js](src/customPresets.js) | `MOTION_ENGINES` catalog (none / breathe / sway / spin) + `buildMotionEngineFrameEqs(me)` — additive, clamped, `''` when off. |
| [src/editor/inspector.js](src/editor/inspector.js) | `BLANK.motionEngine = {id:'none',speed:1,depth:0.5}`; `injectedEngine` first in `_buildRuntimePreset`; `_buildMotionEngineSection` / `_bindEngineKnob` / `_applyMotionEngine` / `_syncMotionEngine`; `_wakeFeedbackIfSolid()` + wired into engine, motion sliders/presets/randomize, wave grid/sliders/randomize; `_syncMotionEngine` added to `_syncAllControls`. |
| [src/visualizer.js](src/visualizer.js) | `buildMotionEngineFrameEqs(preset.motionEngine)` injected first in `refreshCustomPresets` reactBlock — player/timeline parity. |
| [editor.html](editor.html) | Motion Engine section (chips `#motion-engine-grid` + knobs `#motion-engine-knobs`) above Motion Presets. |
| [src/editor/style.css](src/editor/style.css) | `.motion-engine-btn.active` neutral white-outline selected state. |

**Not yet verified (needs a human in the editor):** that the motion visibly plays, auto-wake feels
right (not jarring when leaving Shift), Speed/Depth ranges feel good, and player/timeline parity. Tune
engine coefficients after first look. Optional follow-ups: 4th engine (Throb/warp), Remix rolling an
engine.

---

## 8. Phase 2 — Execution plan: Custom Shapes Composer (audit complete, awaiting code approval)

**Goal:** let users place up to 4 geometric shapes (polygons / rings) from scratch — the first
control that gives **off-center composition** and hard geometry the single basic wave can't. Pure
`baseVals`, no code. Additive; everything else stays.

### 8.1 Verified architecture (read-only audit, 2026-05-30)

- **Shapes are a NATIVE engine field, not an injection.** The engine inits exactly **4** custom-shape
  renderers (`this.customShapes = range(4).map(...)`, [butterchurn.js:2370](src/vendor/butterchurn.js#L2370))
  and on each frame draws `customShapes.forEach((s,i) => s.drawCustomShape(..., preset.shapes[i], ...))`
  ([butterchurn.js:2845](src/vendor/butterchurn.js#L2845)).
- **Each `preset.shapes[i]` = `{ baseVals: {…}, init_eqs_str, frame_eqs_str }`.** baseVals defaults
  (24 fields) at [butterchurn.js:6648](src/vendor/butterchurn.js#L6648): `enabled, sides, additive,
  thickoutline, textured, num_inst, tex_zoom, tex_ang, x, y, rad, ang, r/g/b/a, r2/g2/b2/a2,
  border_r/g/b/a`. A shape only renders when `baseVals.enabled !== 0` ([butterchurn.js:6730](src/vendor/butterchurn.js#L6730)).
- **A static shape needs NO eqs** — `init_eqs_str:'' / frame_eqs_str:''` compile fine; baseVals alone
  draw the polygon. **Pure no-code.**
- **Player/timeline parity is FREE.** `state.shapes` already saves via the `...currentState` spread
  and the engine reads `preset.shapes` directly — so, unlike Phase 1, there is **no `visualizer.js`
  injection** and no shared builder needed.
- **Shapes draw into the feedback buffer** (before the comp pass) → invisible in solid mode → **reuse
  `_wakeFeedbackIfSolid()`** (Phase 1) when a shape is added/edited. No new trap.
- **State today:** `BLANK.shapes = []` ([inspector.js:410](src/editor/inspector.js#L410));
  `loadBundledPreset` already deep-clones `bundled.shapes`. So the field is wired through save/load —
  the composer just needs to populate it.
- ⚠️ **One thing to verify first in code:** `customShapes.forEach` iterates 4 renderers and indexes
  `preset.shapes[i]`; with fewer than 4 entries, `preset.shapes[i]` is `undefined` for empty slots.
  **Safe pattern: maintain a fixed 4-slot `shapes` array** (unused slots = `{ baseVals:{enabled:0}, … }`),
  exactly how bundled presets ship. Confirm `drawCustomShape(undefined)` either never happens (because
  we always pad to 4) — pad in `_buildRuntimePreset` to be defensive.

### 8.2 Design — concept + interface

- **Concept:** a "Custom Shapes" section with up to **4** shapes, each a placement-first card
  mirroring the image-layer card pattern (collapsible, XY-pad, add/delete/enable). Curated to the
  meaningful no-code baseVals — **no 24-field dump**:
  | Card control | baseVal | Notes |
  |---|---|---|
  | Position (XY pad) | `x`, `y` | reuse the image-layer XY-pad pattern → off-center composition |
  | Size | `rad` | |
  | Sides | `sides` (3–100) | triangle → square → … → circle |
  | Angle | `ang` | static rotation |
  | Color + Opacity | `r/g/b` swatch + `a` | fill |
  | Border | toggle → `border_a` + `border_r/g/b` | outline on/off + colour |
  | Glow (additive) | `additive` toggle | additive blend |
- **Deferred from v1** (keep it simple): `num_inst` (only meaningful with eqs — overlapping copies do
  nothing without per-instance offset), `r2/g2/b2/a2` gradient center, `textured`/`tex_*` (image-fill),
  `thickoutline`. Per-shape **audio reactivity** (pulse `rad`/`ang` with bass) is a clean follow-up
  via a generated `frame_eqs_str` — note, not v1.
- **Optional nicety:** a small row of quick-shape chips (Triangle / Square / Hexagon / Ring) that
  seed a card's `sides`/border — same discovery feel as Motion Presets. Optional.
- **Where it lives — DECISION NEEDED (§8.6).** Documented IA says **Wave tab, reframed "Shapes & Wave"**
  (shapes + wave are both drawn vector primitives). Alternative: the **Layers tab**, which already has
  the card + XY-pad machinery (least new code), though Layers is conceptually "imported content." My
  lean: Wave tab per the IA, card stack at the top under a "Custom Shapes" header.

### 8.3 State shape

```js
// BLANK.shapes stays []; the composer builds entries shaped like bundled presets:
{ baseVals: { enabled:1, sides:6, x:0.5, y:0.5, rad:0.1, ang:0,
              r:1,g:0,b:0,a:1, border_r:1,border_g:1,border_b:1,border_a:0,
              additive:0, /* + the rest defaulted from shapeBaseValsDefaults */ },
  init_eqs_str:'', frame_eqs_str:'' }
```
`_buildRuntimePreset` pads `runtime.shapes` to 4 slots (disabled stubs) for engine safety.

### 8.4 Touch-points (3 files — no customPresets.js, no visualizer.js)

| # | File | Change |
|---|---|---|
| 1 | [src/editor/inspector.js](src/editor/inspector.js) | Shape card build/add/edit/delete/enable → write `state.shapes`; `_applyToEngine` + sync; `_wakeFeedbackIfSolid()` on shape add/edit; pad-to-4 in `_buildRuntimePreset`; optional randomize. |
| 2 | [editor.html](editor.html) | "Custom Shapes" section + "+ Add Shape" button (in Wave tab, pending §8.6). |
| 3 | [src/editor/style.css](src/editor/style.css) | Shape card styles (reuse layer-card / XY-pad classes where possible). |

### 8.5 Risk / done

- **Risk: low-medium.** Native field (no injection, free parity); the only real gotcha is the 4-slot
  padding (8.1) — resolve first. Reuses auto-wake, XY-pad, and card patterns already in the codebase.
- **Done =** add a shape → a polygon appears off-center, live, auto-waking from Shift; Position/Size/
  Sides/Angle/Color/Border/Additive all work; up to 4 shapes compose; save → reload round-trips; the
  shapes play identically in the main player (free); old presets (no shapes) unaffected. Then **stop
  and evaluate** before Phase 3.

### 8.6 Open question (for the user) — RESOLVED

**Where does the Custom Shapes section live?** → **Wave tab** (chosen 2026-05-30). Sits at the top of
the Wave tab under a "Custom Shapes" header; the existing wave-mode section was relabeled "Wave Shape"
to disambiguate from custom shapes. Layers stays = imported content.

### 8.7 ✅ Shipped — code complete 2026-05-30 (awaiting visual review)

Implemented in 3 files (no `customPresets.js`, no `visualizer.js` — shapes are a native field);
`npm run build` passes.

| File | What landed |
|---|---|
| [src/editor/inspector.js](src/editor/inspector.js) | `MAX_SHAPES=4` + `makeShapeDefaults()`; `_buildShapesSection` / `_addShape` / `_removeShape` / `_renderShapeCards` / `_buildShapeCard` / `_bindShapeSlider`; pad-to-4 in `_buildRuntimePreset`; `_renderShapeCards` in `_syncAllControls`; auto-wake on every shape edit; XY-pad reuses the image-layer pad pattern with **add/remove-on-demand window listeners** (no leak across re-renders). |
| [editor.html](editor.html) | "Custom Shapes" section + `#shapes-list` + `+ Add Shape` button at the top of the Wave tab; existing wave section relabeled "Wave Shape". |
| [src/editor/style.css](src/editor/style.css) | `.shape-card` + swatch-wrap / toggle styles (reuses `.xy-pad`). |

**Curated controls (no-code):** Position (XY-pad) · Size (`rad`) · Sides (`sides` 3–64) · Angle (`ang`)
· Opacity (`a`) · Fill colour · Border on/off + colour · Glow (`additive`). Deferred: `num_inst`,
gradient (`r2/g2/b2`), texture, per-shape audio reactivity.

**Reviewed & approved** ("works great"). Post-review fixes: (1) opacity `pos²` curve; (2) **shape-Y
pad orientation corrected** — the engine maps `y` down-positive (`y*-2+1`, y=0=top, [butterchurn.js:4746](src/vendor/butterchurn.js#L4746)),
so the pad now maps directly (no flip), matching the image-layer pad; (3) **stray green removed** — a
shape is a 2-colour gradient (centre `r/g/b/a` → edge `r2/g2/b2/a2`); the stock edge default is green
`(0,1,0)`. We only expose Fill, so the edge now tracks Fill (mono-colour): `makeShapeDefaults` edge =
fill, the Fill picker writes `r2/g2/b2`, and Opacity writes `a2`. (A true gradient control is a deferred
follow-up.) (4) **Sides slider curved** (`pos^2.5`, `SHAPE_SIDES_CURVE`) — low side counts (the distinct
polygons) get most of the travel; the "circle" range is compressed into the top. (5) **Color/Border/Glow
UI redesigned** into clear labeled rows (Fill / Border+colour / Glow); the Border colour swatch dims when
Border is off. Border outline confirmed working (most visible with motion paused). (6) **Auto-wake no
longer seeds a wave when a shape exists** — adding a shape was switching on an unwanted oscilloscope
wave; `_wakeFeedbackIfSolid` now only seeds `wave_a` when there's no enabled shape. (Residual soft trail
on a fresh shape is feedback-mode warp/decay — tunable via Motion→Warp + Palette→Trail.)

---

## 9. Phase 3 — Execution plan: Shape Motion & Reactivity (audit complete, awaiting code approval)

**Goal:** make the Phase-2 shapes *move* — per-shape Spin / Pulse / Orbit, time- and audio-driven —
so a from-scratch shape can be alive, not frozen. Additive onto the existing shape cards.

### 9.0 Why this replaces the abstract "Modulator / LFO bank" (audit, 2026-05-30)

- **Shape `frame_eqs` get the inputs we need:** the engine seeds each shape's eq context with
  `time, bass, mid, treb, q1..q32` ([butterchurn.js:1142](src/vendor/butterchurn.js#L1142)) and reads
  `sides/rad/ang/x/y/r/g/b/a` back from the per-frame result ([butterchurn.js:4739](src/vendor/butterchurn.js#L4739)).
  So a shape can react to audio or animate on time **directly in its own equations** — no q-vars.
- **A raw q-var LFO bank would be inert from scratch.** Spare q-vars (q26–q30, q32 are free; q1–q25 =
  anim layers, q31 = flux) only matter if something *reads* them — a preset's own shaders/eqs. From a
  blank base nothing does, and the useful audio/time→motion+wave routings are **already** covered by
  the Motion Engine + motionReact + waveReact. So the abstract modulator is deferred (tracker 3b);
  the concrete, high-value move is animating the shapes we just built.

### 9.1 Design

- Per shape card, a small **Motion** sub-section with 2–3 sliders (matches the Motion-Engine ethos):
  | Control | Drives | Equation (base values baked as literals) |
  |---|---|---|
  | **Spin** | `ang` | `a.ang = <baseAng> + a.time * spin` (continuous rotation) |
  | **Pulse** | `rad` | `a.rad = <baseRad> * (1 + a.bass * pulse)` (beat-reactive size) |
  | **Orbit** | `x`, `y` | `a.x = <baseX> + cos(a.time*sp)*orbit; a.y = <baseY> + sin(a.time*sp)*orbit` |
- All clamped. Defaults 0 → a new shape is static until dialed. Source for Pulse defaults to `bass`
  (a per-shape source pill is a clean follow-up, not v1).

### 9.2 Architecture — base literals + shared builder (mirrors Phase 1)

- **Bake base values as literals**, not `a.rad * …` — shape eq context may persist frame-to-frame, so
  reading `a.rad` could compound into runaway. `buildShapeMotionEqs(baseVals, motion)` emits literals
  from `baseVals` and returns `''` when no motion is active.
- **Generate at runtime, not stored**, via a shared builder in [customPresets.js](src/customPresets.js):
  `_buildRuntimePreset` (editor) sets `runtime.shapes[i].frame_eqs_str = buildShapeMotionEqs(...)`
  when `shape.motion` is active; `refreshCustomPresets` (player) does the identical thing → byte-
  identical parity. Bundled shapes (no `.motion`) keep their own `frame_eqs_str` untouched.

### 9.3 Touch-points (4 files)

| # | File | Change |
|---|---|---|
| 1 | [src/customPresets.js](src/customPresets.js) | `buildShapeMotionEqs(baseVals, motion)` — additive/clamped, `''` when off. |
| 2 | [src/editor/inspector.js](src/editor/inspector.js) | `motion:{spin:0,pulse:0,orbit:0}` in `makeShapeDefaults`; Motion sliders in `_buildShapeCard`; per-shape eq generation in `_buildRuntimePreset`. |
| 3 | [src/visualizer.js](src/visualizer.js) | Same per-shape eq generation in `refreshCustomPresets` — player/timeline parity. |
| 4 | [src/editor/style.css](src/editor/style.css) | Minor: Motion sub-row label. |

### 9.4 Risk / done

- **Risk: low.** Same shared-builder + parity pattern as Phase 1; base-literal baking avoids
  compounding; reuses the shape card + auto-wake.
- **Done =** a shape spins / pulses to the beat / orbits live in the editor; params save & reload;
  identical in the player; static when all 0; bundled-preset shapes unaffected. Then **stop & evaluate**.

### 9.5 ✅ Shipped — code complete 2026-05-30 (awaiting visual review)

`npm run build` passes. 4 files, mirroring the Phase 1 shared-builder + parity pattern.

| File | What landed |
|---|---|
| [src/customPresets.js](src/customPresets.js) | `buildShapeMotionEqs(baseVals, motion)` — Spin (`a.ang=base+time*spin`), Pulse (`a.rad=base*(1+bass*pulse)`), Orbit (`a.x/y=base+cos/sin(time*1.3)*orbit*0.3`); base values baked as literals; clamped; `''` when off. |
| [src/editor/inspector.js](src/editor/inspector.js) | `motion:{spin,pulse,orbit}` in `makeShapeDefaults`; Motion sub-section (3 sliders) + `_bindShapeMotionSlider` in the shape card; per-shape eq generation in `_buildRuntimePreset` (before the 4-slot pad; runtime-only, never stored). |
| [src/visualizer.js](src/visualizer.js) | Same per-shape eq generation in `refreshCustomPresets` → player/timeline parity. |
| [src/editor/style.css](src/editor/style.css) | `.shape-motion-label` + `.shape-motion` sub-row styles. |

**Ranges:** Spin ±2 (rad/s), Pulse 0–2 (bass-driven size), Orbit 0–1 (→ ≤0.3 radius, 1.3 rad/s). All
tunable.

### 9.6 Reactivity expanded to the full Wave-style menu (2026-05-30)

Per user request, the single bass-only "Pulse" was generalized into a full per-shape **Reactivity**
panel mirroring the Wave tab. Shape animation is now two clear groups:

- **Motion (time-driven):** Spin, Orbit.
- **Reactivity (audio-driven):** **Source** dropdown (bass/mid/treb/vol/flux) + **Curve** (Linear/
  Squared/Cubed/Gate) + **Size** & **Opacity** amount sliders, each with a **per-slider source pill**
  (·/B/M/T/V/F) — same UX as the Wave panel.

Data: `shape.motion = {spin, orbit}` + `shape.react = {source, curve, sizeAmt, opacityAmt, perSrc}`.
`buildShapeMotionEqs(baseVals, motion, react)` emits both (one owner per field — ang←Spin, x/y←Orbit,
rad←Size, a/a2←Opacity — so no `a.field=` collisions). The old `motion.pulse` migrates to
`react.sizeAmt` on load. Size/Opacity not mapped to Wave's "Shape(mystery)"/audio-Orbit (no shape
analogue; Orbit is a time control here). Builds clean. **Awaiting visual review.**

### 9.7 Deep audit + bug fixes (2026-05-30)

User reported shapes "very buggy" after reactivity landed. Audit traced 5 symptoms to 2 root causes:

- **🔴 Shapes vanish on the beat / "sync feels off"** — ROOT: `rad = baseRad*(1+signal*sizeAmt)` with a
  negative `sizeAmt` and a loud beat drove the factor negative → `rad` clamped to 0.001 → shape
  flickered out (and Opacity react `a→0` likewise). Not a timing regression — the shape was vanishing
  on beats. **FIX:** floor the size factor — `rad = baseRad*Math.max(0.05, 1+signal*sizeAmt)` — so a
  negative amount shrinks but never zeroes the shape. Engine clamp raised 2.0→2.5.
- **🟡 Dark-gray "remnants" / changes "don't bake"** — ROOT: the feedback **Trail** (decay 0.98,
  BLANK default) retains the *envelope* of an animating shape (pulsing/spinning) as a slow-decaying
  ghost; slider edits didn't clear the buffer so stale ghosts lingered. **FIX (user's call: don't
  touch decay):** clear the feedback buffer on shape edit **commits** — `_clearTrail()` (=
  `engine.clearFeedbackBuffer()`) on every shape slider `pointerup`, XY-pad release, colour/toggle
  change, and shape add/delete. Never per-frame (no drag flicker). **Trade-off:** a *continuously*
  animating shape still trails per the live decay setting (decay untouched by design) — lower
  Palette → Trail to kill that too.
- **🟡 Shapes too small** — ROOT: Size slider capped at rad 0.60. **FIX:** max → 1.50 (engine has no
  rad clamp; large rad just overfills/clips — verified [butterchurn.js:4788](src/vendor/butterchurn.js#L4788)).
- **"Sliders don't reset" / "don't bake"** — fell out of the two root causes above; no separate
  state-corruption path found (base values bake correctly into the regenerated eqs).

Builds clean. **Awaiting re-test** — confirm shapes no longer vanish on beats, ghosts clear on edit,
and Size reaches full-frame. Then Phase 3 done → stop & evaluate.

### 9.8 Trail control + expanded reactivity (2026-05-30)

Per user request ("can trail be controlled? can we have more than Size?"):

- **Trail slider in the Custom Shapes section** — `#shape-trail-slider`, built in `_buildShapesSection`,
  drives the **global `decay`** (same field as Palette → Trail, range 0.85–0.999). Surfaced here since
  trail is the dominant control over shape smear/echo. Synced both ways via `_syncSlider('sh-trail', …)`
  in `_syncAllControls` (the two sliders live on different tabs, so no live cross-update needed). Clears
  the buffer on release.
- **Reactivity expanded Size/Opacity → Size / Opacity / Spin / Shake / Sides**, each with a per-slider
  source pill. `buildShapeMotionEqs` now **merges contributions per field** so time-motion and beat-
  reactivity coexist without `a.field=` collisions: `ang` = baseAng + time·Spin + signal·SpinReact·1.5;
  `x/y` = base + Orbit(time) + Shake(pseudo-random·signal); `rad` = Size (floored); `a/a2` = Opacity;
  `sides` = round(base + signal·SidesReact·16), clamped 3–64. `react` gained `spinAmt/shakeAmt/sidesAmt`
  + perSrc keys (defaulted for old shapes). Shapes can't mirror every image-layer effect (no separate
  X/Y scale, hue pipeline) — these five are the meaningful shape targets. Builds clean; awaiting review.

### 9.9 Trail default fix (2026-05-30)

User: "trails stay forever / Trail slider is almost all the way up by default!!" ROOT: the global
`decay` default is **0.98**, which on the Trail range (0.85–0.999) sits at **~87%** — a long trail —
so every fresh shape smeared. (Decay *does* fade: pulling to 0.85 = no trails confirmed it; the bug
was purely the default.) FIX: a fresh shape preset (the auto-wake transition in `_addShape`) now
defaults `decay` to **`SHAPE_DEFAULT_DECAY = 0.90`** — a short, clean trail (~1/3 up the slider) — so
new shapes read crisply and the user opts *into* longer trails by raising Trail. Only set on the wake
transition, never stomping a trail the user already dialled. Both decay sliders re-synced.

### 9.10 Shapes over Solid/Shift backgrounds (2026-05-30)

User: shapes show over feedback variations (Drift/Pulse/…) but **vanish behind Solid/Shift**. ROOT:
the same solid-mode trap — the solid comp paints a flat colour and never samples `sampler_main` (where
shapes draw). FIX: when enabled shapes exist, the solid-mode comp now **composites the shape buffer
over the solid/shift base**, keyed by the shape's own brightness:
`col = mix(solidBase, texture(sampler_main, uv_m).xyz*2.0, shapeCoverage)`. So you can have **a shape
on a flat Solid/Shift background** (incl. the beat-mix Shift). No-op when the buffer is black
(shapeless) → plain Solid/Shift presets are byte-identical. `_buildCompShader` rebuilds on variation
change (which is when this matters), so picking Shift with a shape present shows the shape over it.

### 9.11 Shapes no longer auto-wake out of Solid (2026-05-30)

Follow-on from §9.10: user found that **Add Shape made the background go dark gray** — because
`_addShape`/shape edits called `_wakeFeedbackIfSolid()`, flipping OUT of Solid/Shift (→ empty feedback
buffer = dark gray), discarding the background. Now that shapes render *over* solid (§9.10), that wake
is obsolete and harmful. FIX: **removed `_wakeFeedbackIfSolid()` from ALL shape handlers** (add, sliders,
react, XY pad, colour pickers, toggles) — shapes keep whatever background you have (Solid/Shift OR a
feedback variation). `_addShape`/`_removeShape` now call `_buildCompShader()` so the shape→solid
composite is added/removed as shapes come and go. First shape over a Solid/Shift base still defaults to
a crisp trail (`SHAPE_DEFAULT_DECAY`, §9.9), gated on `this._solidColor` so feedback variations keep
their decay. **Auto-wake stays for Motion/Wave only** (they genuinely need feedback mode to show).

### 9.12 Trail reaches true zero (2026-05-30)

User: "can we get Trail to zero? there's a trail no matter what." ROOT: the Trail slider min was decay
**0.85**, which still leaves a few-frame residual (0.85ⁿ); true no-trail needs decay **0** (warp wipes
the buffer each frame). FIX: the shapes-section Trail is now a **curved 0→1 slider** —
`decay = pos===0 ? 0 : 0.999·(1−(1−pos)⁵)` (inverse `_trailPosFromDecay` for sync). Bottom = **decay 0
= crisp, no trail**; the curve front-loads the invisible 0–0.8 decay zone into the low end and spreads
the perceptible long-trail range (0.9–0.999) across the top. Helpers `_trailDecayFromPos` /
`_trailPosFromDecay` + `_syncTrailSlider`; the fresh-shape default (`SHAPE_DEFAULT_DECAY 0.90`) sits at
~37%. (Palette → Trail stays linear 0.85–0.999 — the wave/feedback control; the shapes Trail is the one
that bottoms to zero.)
---

## 10. Phase 6 — Execution plan: Color Studio (audit complete, awaiting code approval)

**Goal:** add real *color creation* to the Palette tab — a one-click **harmony-aware random palette
generator** (the headline) plus the groundwork for harmony tools. Additive; the 12 quick palettes,
color rows, locks, and My Mix all stay.

### 10.1 Verified architecture (read-only audit, 2026-05-30)

- **`_applyPalette(p, key)` does all the work** ([inspector.js:1124](src/editor/inspector.js#L1124)):
  takes a `{ wave:[r,g,b], glow:[r,g,b], accent:[r,g,b] }` object, **respects the per-channel 🔒 locks**
  (`_paletteLock.wave/glow/accent`), writes `wave_r/g/b` + `ob_r/g/b` + `ib_r/g/b` + `solidColorB`,
  rebuilds the comp shader, syncs swatches/sliders, highlights the active chip. So the generator only
  needs to **produce a `{wave, glow, accent}`** and call `_applyPalette(p, 'random')`.
- **"Lock a hue → reroll the rest" is free** — `_applyPalette` already skips locked channels.
- **No engine / eq / parity work** — colors are plain `baseVals`, saved + applied through the existing
  path. Player parity is automatic. (Contrast Phase 1/3 which needed shared builders + visualizer.js.)
- Existing helpers: `rgbToHex`, `hexToRgb`. **Need to add `hslToRgb`** for harmony math.

### 10.2 Design

- **Random color generator ("🎲 Colors")** — one click: pick a random base hue + a random harmony
  rule → build a coherent `{wave, glow, accent}` → `_applyPalette`. Respects locks (lock what you like,
  reroll the rest). Pure "roll the dice, get a beautiful scheme" — fits the discovery aesthetic.
- **Harmony rules** (`buildHarmonyPalette(rule, hue)` → 3 hues, vivid S, mid-high L):
  | Rule | Hues (wave / glow / accent) |
  |---|---|
  | Monochrome | h / h / h (vary lightness) |
  | Analogous | h / h+30 / h−30 |
  | Complementary | h / h / h+180 |
  | Triadic | h / h+120 / h+240 |
  | Split-complementary | h / h+150 / h+210 |
- **v1 = one-click random** (rule chosen at random each roll). A **rule picker** (chips) is a clean
  v1.1 follow-up if the user wants to steer the scheme. HSL sliders / gradient ramp / mood presets
  remain future extras (§3.G).
- **Where it lives:** Palette tab, beside "Quick Palettes" / "+ Save current mix" — color is the
  Palette dimension. A "🎲 Colors" button next to the section header.

### 10.3 Touch-points (2 files — no customPresets.js, no visualizer.js)

| # | File | Change |
|---|---|---|
| 1 | [src/editor/inspector.js](src/editor/inspector.js) | `hslToRgb(h,s,l)` + `buildHarmonyPalette(rule, hue)` helpers; wire a "🎲 Colors" button → roll random hue+rule → `_applyPalette(p, 'random')`. |
| 2 | [editor.html](editor.html) | "🎲 Colors" button by the Quick Palettes header (+ optional CSS). |

### 10.4 Risk / done

- **Risk: very low.** Reuses `_applyPalette` wholesale; no engine, eq, or parity changes; locks honored
  for free.
- **Done =** clicking 🎲 Colors produces a coherent, good-looking scheme every time; locked channels
  are preserved; the scheme applies live + saves/reloads like any palette; old presets unaffected.

### 10.5 v1 shipped — 🎲 Colors random roll (2026-05-30) · FOUNDATION

Shipped the quick win; **explicitly a foundation** — Color Studio is a build-out, this is step 1.

| File | What landed |
|---|---|
| [src/editor/inspector.js](src/editor/inspector.js) | `HARMONY_RULES` (mono/analogous/complementary/split/triadic) + `hslToRgb()` + `buildHarmonyPalette(rule, hue)` (reusable primitives); `_rollRandomPalette()` (random hue + rule → `_applyPalette`); `_bindColorStudio()` (called once in init). |
| [editor.html](editor.html) | "🎲 Colors" button in a section-label-row beside Quick Palettes. |

Reuses `_applyPalette` wholesale → honours per-channel 🔒 locks (lock + reroll), rebuilds the comp
shader, syncs swatches, free player parity (colours are `baseVals`). No engine/eq/visualizer work.

**Build-on roadmap (the "more thought" pass):**
- **Harmony rule picker** — chips to choose the rule (mono/analogous/…) instead of pure-random; reuses
  `buildHarmonyPalette` directly.
- **Base-hue control** — a hue wheel/slider to drive the scheme from a chosen colour.
- **HSL sliders** on the colour rows (today they're RGB swatches).
- **Gradient ramp** — two-colour ramp mapped across wave→glow→accent.
- **Mood presets** — warm / cool / neon / pastel S/L profiles applied to a rolled hue.
- Possibly factor the colour helpers into their own module if this grows.
