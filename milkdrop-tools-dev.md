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
| 4 | ~~**Warp Shader Variants picker** (4–6 GLSL warps as chips)~~ | — | ❌ **REMOVED from plan** (2026-05-31) | **Can break the app.** Touches the *shared* warp submodule → regresses all 1,144 presets; genuine shader engineering, not a slider. See §11 for the full issue write-up. *(This is also the only dev that would author bundled presets' shader-driven colour — see §10.6.)* |
| 5 | ~~**Expert eqn / shader drawer** (opt-in EEL/GLSL textareas)~~ | — | ❌ **REMOVED from plan** (2026-05-31) | **Off-brand / not recommended.** It's exactly the grid-of-knobs / code-box surface the project steers away from. See §11. Revisit only if `.milk` import ships and needs an edit home. |
| 6 | **Color Studio** — palette generator + harmony tools | **Adds** to the Palette tab beside the 12 quick palettes / My Mix | 🟢 **Shipping in slices** — 🎲 Random + Color Roll + rule picker + Base Hue + tone/mood + **Glow/Accent bloom (border fix)** all SHIPPED (§10.5–10.10, builds). | Next: HSL sliders, gradient ramp (§10.6). |

**Current state in one line:** Phases 0–3 ✅ DONE. **Phase 6 (Color Studio) v1 SHIPPED** — 🎲 Colors
harmony-aware random roll (§10.5) + **Color Roll** (§10.7) + **steerable generator: rule picker, Base
Hue & tone/mood** (§10.8–10.9); next queued = HSL sliders, gradient ramp + the gradient-tint
multi-colour fill (§10.6/10.7). **Phases 4 (Warp Variants) and 5 (Expert drawer) REMOVED from the plan**
— Phase 4 can regress all 1,144 presets, Phase 5 is off-brand; full reasons in §11.

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
| ~~4 — Warp Variants picker~~ | ❌ **REMOVED** — see §11 (regresses all 1,144 presets). |
| ~~5 — Expert drawer~~ | ❌ **REMOVED** — see §11 (off-brand code surface). |
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

### C. ~~Warp Shader Variants picker~~ — ❌ **REMOVED (2026-05-31), see §11**
A dictionary of 4–6 hand-written warp GLSL strings (radial / stripes / spiral / tunnel /
ripple-zoom) selectable as chips in the Motion tab.

- This *was* the biggest expressive jump available — it's what defines named-MilkDrop looks (and the
  shader-driven colour in 85% of the bundled library, §10.6).
- **Removed because it can break the app:** warp is a shared webpacked submodule; breaking it breaks
  every shipping preset. Genuine shader engineering with cross-preset regression risk, not a slider.
  Full write-up in §11.

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

### F. ~~Equation / shader editor — the escape hatch~~ — ❌ **REMOVED (2026-05-31), see §11**
A hidden **"Advanced"** drawer with EEL / GLSL textareas, like butterchurn-electron. Would unlock
literally everything, but it's exactly the grid-of-knobs / geek surface the project deliberately
steers away from — **off-brand, removed.** Its one redeeming use was as the editing home for
*imported* `.milk` presets (whose motion lives in raw `frame_eqs_str`, per
[milkdrop-import-dev.md](milkdrop-import-dev.md) §7.2) — so revisit *only* if `.milk` import ships and
needs an edit surface. Full write-up in §11.

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
A  Generative Motion Engines     ← ✅ SHIPPED (Phase 1). Root-cause fix; rides q-register pipe
B  Custom Shapes Composer        ← ✅ SHIPPED (Phase 2). Off-center composition; card/XY-pad reuse
D  Shape Motion & Reactivity     ← ✅ SHIPPED (Phase 3). Replaced the abstract LFO bank (§9.0)
G  Color Studio                  ← 🟢 v1 SHIPPED, build-out active (Phase 6 / §10.6)
─────────────────────────────────
C  Warp Variants picker          ← ❌ REMOVED — regresses all 1,144 presets (§11)
F  Expert eqn/shader drawer      ← ❌ REMOVED — off-brand code surface (§11)
```

**Why this order held:** A fixed the *root* problem (frozen baseVals) and the q-register plumbing
already existed; B was the strongest composition unlock and reused patterns we had; D became the
concrete "animate the shapes we just built" rather than an inert-from-scratch LFO bank (§9.0); G adds
no-code colour creation with zero engine risk. **C and F are removed** — C carries cross-preset
regression risk (it edits the shared warp submodule), F is the exact code-box aesthetic the project
avoids. Both reasons are detailed in §11.

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

1. ~~**Which direction first?**~~ → RESOLVED: A→B→D→G shipped in that order.
2. **Beta gating** — is any of this in-scope before the v1 beta, or strictly after Timeline + 3D?
3. ~~**Expert mode (F)**~~ → RESOLVED (2026-05-31): firmly off-brand → **removed** (§11). Revisit only
   if `.milk` import ships and needs an edit home.
4. **Relationship to import** — if `.milk` import ever lands, it (not an expert drawer) becomes the
   reason to reconsider a code-edit surface. Independent of the Color Studio build-out.

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
`_trailPosFromDecay` + `_syncTrailSlider`; the fresh-shape default (`SHAPE_DEFAULT_DECAY`) sits low.
(Palette → Trail stays linear 0.85–0.999 — the wave/feedback control; the shapes Trail is the one
that bottoms to zero.)

### 9.13 🔴 Permanent gray trail on shape-add — the REAL root cause (2026-05-31)

User (frustrated, recurring): *"I started from Shapes and it leaves a gray area in the canvas… nobody
wants permanent trails!!!"* This had been "fixed" twice before (§9.9, §9.12) yet kept returning. The
actual root cause, finally: the clean-trail reset in `_addShape` was **gated to solid mode** —
`if (isFirst && this._solidColor)`. When the user added a shape **on a feedback variation** (warp
visible, `_solidColor` null), the gate failed, so `decay` stayed at the variation's **0.96–0.99** → a
long, permanent-looking gray smear. The earlier fixes only ever covered the solid-mode half, which is
why it "kept coming up over and over."

**FIX (decisive, all modes):**
- `_addShape` now lowers decay on the first shape **in every mode**, gated on *value not mode*:
  `if (isFirst && decay > SHAPE_DEFAULT_DECAY) decay = SHAPE_DEFAULT_DECAY`. So any preset whose trail
  is longer than clean (the 0.98 blank default **and** every feedback variation) gets brought down to a
  crisp trail; a short trail the user already dialled is never stomped. Raise it back anytime via Trail.
- `SHAPE_DEFAULT_DECAY` lowered **0.90 → 0.85** (crisp; `0.85⁶⁰≈7e-5`, fades in <0.5 s — no permanent
  ghost) while keeping a hair of smoothing. `_clearTrail()` on add still wipes the existing buffer once.

**Not the bloom:** the §10.10 Glow/Accent bloom was *not* the cause here — the preset's Glow/Accent
colours were `#000000`, so `col += blur · vec3(0) · strength` contributes nothing. The gray was purely
the decay gate.

`npm run build` passes. **Done =** adding a shape on *any* background (solid or a warp variation) yields
a crisp shape with no permanent gray smear; Trail still raises it on demand.

### 9.14 🔴 Permanent trails EVERYWHERE — global decay default fix + deep audit (2026-05-31)

§9.13 fixed only the shape-add path; the user (rightly) pushed back: *"permanent trails are STILL there…
deep deep audit, it's everywhere!!!"* — they were on the **Bloom variation**, no shape involved. Full
audit of every feedback lever:

- **`decay` was the one active culprit — and it shipped hot in every starting point.** BLANK = **0.98**;
  the 9 variations = **0.96–0.99**. At 0.98 a frame is still ~30% visible after a second, and warp
  regenerates content every frame, so the buffer never empties → a steady-state gray haze that reads as
  "permanent." Present by default *everywhere*.
- **`echo_zoom` ruled OUT:** the variations set `echo_zoom` 1.1–3.5 but `echo_alpha` is **0** in BLANK
  and every variation → echo is inert. Not a factor. (The 3 *motion presets* DO set `echo_alpha`
  0.1–0.35 — a separate echo-trail only hit by applying Vortex/Calm Drift/Earthquake; left as-is, their
  intended tunnel look. Flagged for the user.)

**FIX — lower `decay` across BLANK + all 9 variations into a clean band (0.88–0.92):** BLANK 0.98→**0.90**;
Solid/Shift 0.98→0.90 (solid mode, cosmetic); Drift 0.985→0.92; Pulse 0.97→0.90; Storm 0.975→0.89;
Ripple 0.99→0.92; Radiate 0.978→0.90; Scatter 0.96→**0.88**; Bloom 0.988→0.92. Warp still flows and reads
as motion but clears in ~1s instead of piling into haze. The **Trail slider (→0.999) stays** for anyone
who wants heavy smear — trail is now opt-IN, not the default. (Verified: no default `decay` > 0.92
remains.) Also trimmed the over-long tooltips added during the Color Studio work (Harmony rule / Tone /
Random colours / Trail length) per `[[feedback_slider_discovery_ux]]` — tooltips name the control, they
don't narrate.

**Standing rule captured:** the from-scratch + variation `decay` default must stay in the clean band;
high decay (>~0.93) reads as broken/permanent to the user. See memory [[project_shape_trail_decay_gate]].
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
- ✅ **Harmony rule picker** — chips to choose the rule (mono/analogous/…) instead of pure-random; reuses
  `buildHarmonyPalette` directly. **SHIPPED 2026-05-31 (§10.8).**
- ✅ **Base-hue control** — a hue wheel/slider to drive the scheme from a chosen colour. **SHIPPED (§10.8).**
- **HSL sliders** on the colour rows (today they're RGB swatches).
- **Gradient ramp** — two-colour ramp mapped across wave→glow→accent.
- ✅ **Mood presets** — tone (Vivid / Neon / Pastel / Deep) S/L profiles applied to a rolled hue.
  **SHIPPED 2026-05-31 (§10.9).** (Warm/cool temperature biases dropped — they'd fight the Base Hue
  control; tone profiles compose cleanly instead.)
- Possibly factor the colour helpers into their own module if this grows.

### 10.6 Build-out — execution plan (active) + colour-coverage scope

**What the Color Studio covers — and what "multiple colours in existing presets" means (audit 2026-05-31).**
A 100-preset sample of the bundled library shows where their colour actually comes from:

| Colour source | % of bundled presets | Authored by our Palette / Color Studio? |
|---|---|---|
| **Custom warp/comp GLSL shader** (per-pixel colour) | **85%** | ❌ No — that's shader code (was Phase 4, now removed §11) |
| **Custom shapes** (own `r/g/b` → `r2/g2/b2` gradient) | 52% | ⚠️ Partial — we author *new* shape Fill (Phase 2), but can't repaint a bundled preset's shapes |
| **Custom waves** (own colours) | 32% | ❌ Not exposed |
| **Animated colour in `frame_eqs`** (cycles/pulses over time) | ~18% wave, 13% border | ❌ No no-code authoring |

The Palette tab (and Color Studio) authors **three static baseVal channels** — Wave (`wave_r/g/b`),
Glow (`ob_r/g/b`), Accent (`ib_r/g/b`) — plus `solidColorB` ([inspector.js:1187](src/editor/inspector.js#L1187)).
A 4th baseVal colour, motion-vector `mv_r/g/b` ([inspector.js:404](src/editor/inspector.js#L404)), exists
but is unexposed.

**So, scoping the question honestly:**
- **From-scratch presets — the Color Studio's actual job — the 3-channel model IS the whole colour
  surface.** The build-out makes it *richer* (steerable, HSL, gradients, moods), not *broader*. This is
  the correct, low-risk scope.
- **Remixed bundled presets:** the palette repaints only the 3 baseVal channels; the dominant colour
  (shader-computed in 85%, animated in ~18%) is untouched — the same "doesn't stick / gets stomped"
  caveat already in the Remix taxonomy. **The only dev that would close that gap is the removed Phase 4
  shader work** (§11) — which is precisely why "cover the bundled multi-colour" and "the dev that can
  break the app" are the same thing.

**Execution order (smallest → largest, each its own stop-and-evaluate):**

| Step | What | Touch-points | Risk |
|---|---|---|---|
| **6.1** | **Harmony rule picker** — chips (Mono/Analogous/Complementary/Split/Triadic) so the roll is *steerable*, not blind. `_rollRandomPalette` reads the chosen rule (or "Surprise me" = random). | `inspector.js` (chip handler, store last rule) + `editor.html` (chip row) + `style.css` | very low |
| **6.2** | **Base-hue control** — a hue slider/wheel to seed the scheme from a chosen colour; "Roll" then varies only S/L + harmony. | `inspector.js` + `editor.html` | low |
| **6.3** | **Mood presets** — Warm / Cool / Neon / Pastel as S/L profiles over the rolled hue (small chip row). | `inspector.js` + `editor.html` | low |
| **6.4** | **HSL sliders** on the colour rows (today RGB swatches) — needs `rgbToHsl` + row-UI change. | `inspector.js` + `editor.html` + `style.css` | medium (UI change) |
| **6.5** | **Gradient ramp** — pick 2 colours, map across wave→glow→accent. | `inspector.js` + `editor.html` | low-medium |
| **6.6** | *(optional)* **Living colour** — hue-cycle / beat-pulse the 3 channels over time. The colour analogue of Phase 1's Motion Engine; the *safe, no-code* answer to the ~18% "colour breathes" gap. Needs a shared builder in `customPresets.js` + `visualizer.js` parity (like Phase 1/3). | `customPresets.js` + `inspector.js` + `visualizer.js` + `editor.html` | medium (parity step) |

Steps 6.1–6.5 are pure `_applyPalette` reuse → **no engine/eq/visualizer work, free player parity**
(contrast 6.6, which injects time-driven colour and so needs the same dual-write parity as Phases 1/3).

**First slice (proposed for code approval): 6.1 + 6.2 together** — the rule picker and base-hue share
the `buildHarmonyPalette(rule, hue)` plumbing and together turn the blind roll into a real, steerable
generator. Lowest risk, biggest single jump in usefulness. **Awaiting "go".**

### 10.7 ✅ Shipped — "3 colours visible in feedback" fix + Color Roll (2026-05-31)

User report: *"in Shift, multiple colours + random work great; but building milkdrop presets on the
other tabs, only ONE colour gets applied."* Two safe, single-file (`inspector.js`) changes — **no
`visualizer.js`, no `customPresets.js`, no shader-engine edits.** `npm run build` passes.

**Root cause of the "one colour" bug (verified):** a palette sets **three** colours — Wave (`wave_r/g/b`),
Glow (`ob_r/g/b` = *outer border* ring) and Accent (`ib_r/g/b` = *inner border* ring). But the two
border rings default to **size 0 / alpha 0** ([inspector.js:402-403](src/editor/inspector.js#L402-L403))
and `_applyPalette` deliberately painted *colour only*, never turning them on → in a feedback variation
only the Wave colour rendered. (Shift looked fine because its comp paints Wave + `solidColorB` directly,
both always visible — two colours by design.)

**Feature 1 — all three palette colours render in feedback mode.** `_applyPalette` now seeds Glow +
Accent **strength** when it's still off (Glow `ob_a=0.6`/`ob_size=0.03`, Accent `ib_a=0.45`/`ib_size≈0.0225`;
the same alpha→size 0.05 coupling the Glow/Accent Strength sliders use). **Seed-when-off only** (never
stomps a strength the user dialled), **skips locked channels**, and **skips solid/shift mode** (gated on
`!this._solidColor`) so Shift stays exactly as the user likes it. Pure `baseVals` → free player parity.

**Feature 2 — Color Roll (rolling colours).** New **Color Roll** slider in the Palette appearance
sliders (`#ps-color-roll`, `studio_hue_roll` baseVal, range 0–1.5 rad/s, default 0 = off). When > 0 the
hue-rotation angle in the Studio post-FX becomes `base + time * speed`, driven by the comp shader's
existing `time` uniform — so the **whole frame's colours cycle continuously in BOTH solid/shift and
feedback modes**, covering every colour (wave, borders, `solidColorB`, images' background). Implemented
by extending the two existing post-FX GLSL builders (`buildStudioPostFxGlsl` on `ret`,
`buildSatHueOnColGlsl` on `col` for the images path) to emit a time-driven Rodrigues rotation when
`roll>0`; `roll` threaded through `injectStudioPostFx` + all comp-build call sites (`_rebuildPostFx`,
main build [inspector.js:7794](src/editor/inspector.js#L7794), bundled-remix load [inspector.js:9238](src/editor/inspector.js#L9238)).

**Why Feature 2 needs no parity work:** the roll is **baked into `state.comp`**, which saves via the
`...currentState` spread and is consumed by the player/engine directly (same mechanism the existing
Saturation / Hue Rotate controls already use) → free player + timeline parity, and `roll=0` is
byte-identical to the old output. With images, the roll is applied inline to the background `col`
*before* image layers composite, so photos don't hue-shift.

| File | What landed |
|---|---|
| [src/editor/inspector.js](src/editor/inspector.js) | `BLANK.baseVals.studio_hue_roll=0`; time-driven roll in `buildStudioPostFxGlsl` + `buildSatHueOnColGlsl`; `roll` opt threaded through `injectStudioPostFx`, `_rebuildPostFx`, `_buildCompShader` (images + no-images), bundled-remix load; "Color Roll" slider in `_buildPaletteSliders` + sync in `_syncPaletteSliders`; Glow/Accent strength seed-when-off in `_applyPalette`. |

**✅ Color Roll reviewed & approved 2026-05-31 ("works great")** — alongside the §10.5 🎲 Random roll
("both work great"). Color Roll cycles the whole scheme over time in *both* Shift and feedback, saves/
reloads, and plays identically in the player (baked into `state.comp`).

**⚠️ Feature 1 (auto-seed borders) was a DEAD END — reverted 2026-05-31.** Glow/Accent *are* border
rings, so seeding them on just drew outlines, not a multi-colour fill ("random colors just adds borders").
Removed; `_applyPalette` paints colour only, as before. **Lesson:** a from-scratch *feedback* preset has
structurally ONE fill colour (the Wave, smeared through the warp buffer) — there is no native second
*fill* colour, only border rings. The real answers to simultaneous multi-colour are (a) **Color Roll**
(temporal — shipped) and (b) a **colour tint baked into our from-scratch comp shader** — ✅ **SHIPPED as
the Glow/Accent bloom (§10.10):** the Glow + Accent colours now bloom (blurred-feedback halo) into the
image, so all three palette colours show at once. The safe, no-code slice of what the 85% shader-driven
bundled presets do; edits only *our* comp, never the shared warp.

### 10.8 ✅ Shipped — steerable generator: rule picker + Base Hue (2026-05-31)

Turned the blind 🎲 roll into a real, steerable Color Studio. Two new controls under the 🎲 Colors
button, both driving the **same `buildHarmonyPalette(rule, hue)` primitives** the roll already used —
so zero new colour math, pure UI + wiring. Single feature area, `inspector.js` + `editor.html` +
`style.css`. `npm run build` passes.

- **Harmony rule picker** (`#cs-rule-chips`) — chips: **🎲 Surprise** (random rule each roll, default)
  + Monochrome / Analogous / Complementary / Split-complement / Triadic. Picking a named rule **pins**
  it (every roll + hue-drag uses it); Surprise restores random-per-roll. Clicking a chip applies a
  scheme immediately for instant feedback.
- **Base Hue slider** (`#cs-hue`, 0–360°) — drag to drive the whole scheme from a chosen hue, live;
  the active rule decides how glow/accent derive from it. Under Surprise, hue-drag uses the last
  concrete rule (`_csLastRule`, default Analogous) so dragging always shows a coherent scheme.
- **🎲 Colors button** — now rolls a random hue + the *active* rule (random rule only under Surprise),
  and syncs the hue slider + chip highlight to what it rolled.

**Mechanics:** generator state (`_csRule` / `_csHue` / `_csLastRule`) is **transient tool state, not
persisted** with the preset (it's a UI control, like a generator dial — the resulting colours save via
`baseVals` as always). `_applyPalette(p, key, snap=true)` gained a `snap` flag so the live Base-Hue
drag brackets the whole gesture in **one undo step** (pointerdown/up `_preSnap`/`_postSnap`) instead of
snapping every frame. Still honours per-channel 🔒 locks (lock a colour, steer/reroll the rest) and has
free player parity (colours are `baseVals`). New symbols: `_buildColorStudioControls`, `_pickColorRule`,
`_syncColorStudioControls`; CSS `.cs-rule-chip(.active)` (neutral white-outline, no accent hues).

| File | What landed |
|---|---|
| [src/editor/inspector.js](src/editor/inspector.js) | `_bindColorStudio` inits generator state + builds controls; `_buildColorStudioControls` (rule chips + Base Hue slider); `_pickColorRule`; `_rollRandomPalette` honours active rule; `_syncColorStudioControls`; `_applyPalette` gained `snap` flag. |
| [editor.html](editor.html) | `.color-studio-controls` block (`#cs-rule-chips` + `#cs-hue-row`) under the 🎲 Colors button. |
| [src/editor/style.css](src/editor/style.css) | `.cs-rule-chip` neutral chip + white-outline active state. |

**⚠️ Interaction model reworked 2026-05-31 (§10.9.1) — the original "pin constrains the dice + Surprise
chip" design confused the user** ("allows you to choose but not unchoose, and random doesn't affect
these choices"). Superseded by the toggle-chips + fully-random-dice model below; the prose in this
section describing the old behaviour is historical.

### 10.9 ✅ Shipped — tone / mood presets (2026-05-31)

Completed the generator's third axis: **hue (Base Hue) × harmony (rule) × tone (mood)**. A second chip
row under the rule picker: **Vivid** (default, identity) / **Neon** / **Pastel** / **Deep**. Each is an
S/L profile applied on top of the rolled hue+rule, so they compose with — never fight — the other two
controls. Single feature area; `inspector.js` + `editor.html`; `npm run build` passes.

- **Why tone, not warm/cool:** the §3.G note said "warm/cool/neon/pastel," but warm/cool are *hue*
  biases that would fight the Base Hue control (set hue 200° + "warm" → contradiction). Tone profiles
  (saturation/lightness only) leave hue/harmony untouched, so all three axes stack predictably.
- **Mechanics:** `MOODS` catalog (`{id,name,sMul,lOff}`) + `_moodHsl(h,s,l,mood)` wraps `hslToRgb`,
  scaling saturation (`sMul`) and shifting lightness (`lOff`), clamped. `buildHarmonyPalette(rule, hue,
  mood)` threads it; `mood` undefined → Vivid (identity) → **byte-identical to the pre-mood output**, so
  nothing else regressed. `_csMood` is transient tool state (not persisted; the resulting colours save
  via `baseVals`). `_pickColorMood` re-applies current rule+hue with the new tone; the chip-builder was
  generalised (`buildChips(wrapId, defs, dataKey, handler)`) and reused for both rows; `_syncColorStudio
  Controls` now highlights the active rule **and** mood chip (scoped per container).

| File | What landed |
|---|---|
| [src/editor/inspector.js](src/editor/inspector.js) | `MOODS` + `_moodHsl`; `buildHarmonyPalette` takes `mood`; `_csMood` state; `_pickColorMood`; `mood` threaded through roll / rule-pick / hue-drag; generalised `buildChips`; mood highlight in `_syncColorStudioControls`. |
| [editor.html](editor.html) | `#cs-mood-chips` row in `.color-studio-controls` (reuses `.cs-rule-chip` styling). |

**Done =** pick a tone → current scheme + every subsequent roll/hue-drag uses that S/L profile; Vivid =
unchanged from before; composes with rule + Base Hue + locks.

### 10.9.1 ✅ Interaction rework — toggle chips + fully-random dice (2026-05-31)

User report on the §10.8/10.9 UI: *"the interface allows you to choose but not unchoose, and random
doesn't affect these choices."* Root cause = a confused model I shipped: chips were **radio pins that
constrained the dice** (always one selected, no way back to neutral), **🎲 respected the pins** (so a
pinned rule never changed on roll → felt disconnected), and a separate **"🎲 Surprise" chip** duplicated
the dice button (two dice). Per the house rule (don't patch a failed interaction — return to the
requirement, rebuild clean), the model was replaced:

- **Chips toggle.** Rule + tone chips are nullable selections; click to choose, **click the active one
  again to clear** (`_csRule`/`_csMood` go `null` → no chip highlighted). Fixes "can't unchoose."
- **🎲 Colors is fully random** — random hue **+ random rule + random tone** — and **reflects all three
  in the chips/slider** (`_rollRandomPalette` sets `_csRule`/`_csMood`/`_csHue`, then
  `_syncColorStudioControls` lights them up). Every roll visibly moves the selections. Fixes "random
  doesn't affect these choices."
- **"🎲 Surprise" chip removed** — the dice button *is* surprise (rule chips are now just the 5 harmony
  rules). Fixes the two-dice redundancy.
- **null fallbacks:** when a dimension is unselected, `_applyColorStudio` builds with Analogous / Vivid
  so the scheme stays coherent; nothing is highlighted. New `_applyColorStudio(snap)` centralises
  build+apply+sync (used by rule/mood toggles, Base-Hue drag, and the dice).
- **Explore within a rule** = pick the rule chip + drag Base Hue; the 🔒 per-channel locks still cover
  "keep this colour, reroll the rest." `_csLastRule` is gone (no longer needed).

| File | What landed |
|---|---|
| [src/editor/inspector.js](src/editor/inspector.js) | `_csRule`/`_csMood` nullable + toggle in `_pickColorRule`/`_pickColorMood`; `_applyColorStudio(snap)` helper; `_rollRandomPalette` fully random + reflects; Surprise removed from rule chips; `_csLastRule` removed. |
| [editor.html](editor.html) | Chip tooltips updated ("click again to clear"; dice rolls a random one). |

**Done =** click a chip then click it again → it clears (no highlight); 🎲 Colors changes hue + rule +
tone and the chips light up to match; no Surprise chip; rule+Base-Hue still explores a single rule;
locks honoured. **Awaiting visual review.**

### 10.10 ✅ Shipped — Glow/Accent Strength → real colored bloom (border fix) (2026-05-31)

User report: *"Glow Strength and Accent Strength both only draw borders."* Correct — they drove `ob_a/
ob_size` and `ib_a/ib_size`, the engine's **outer/inner border rings**, so by design they could only
draw an edge rectangle, and the Glow/Accent *colours* only ever showed as rings. This is the same
"borders are the wrong lever" root cause as the reverted §10.7 Feature 1 — fixed properly this time.

**The fix (best + safest):** both Strength sliders now drive a **colored bloom** baked into our
from-scratch comp shader:
- **Glow Strength** → `col += texture(sampler_blur1, uv_m).rgb * glowColour * (strength·3)` — a tight,
  bright halo around the waveform, tinted with the **Glow** colour (`ob_r/g/b`).
- **Accent Strength** → same with `sampler_blur2` × the **Accent** colour (`ib_r/g/b`) — a wider, softer
  halo.

**Why this is safe & also fixes the original "only one colour" problem:**
- The engine **auto-runs the blur passes** when the comp text references `sampler_blur1/2`
  (`getHighestBlur` scans the shader, [butterchurn.js:2994](src/vendor/butterchurn.js#L2994)) — no engine
  change. Bloom GLSL is **only emitted when a strength is > 0**, so `getHighestBlur` returns 0 and there's
  **zero blur cost when off** + a byte-identical comp.
- Edits **only our comp shader**, never the shared warp → can't regress the 1,144 bundled presets.
- **Free player parity** — baked into `state.comp`, saved via `...currentState`, consumed by the player
  directly (same mechanism as Saturation / Hue / Color Roll). No `visualizer.js` change.
- The Glow + Accent **colours now bloom into the image**, so all three palette colours show at once —
  this is the safe, no-code answer the deferred §10.7 *gradient-tint* idea was reaching for. **That open
  item is now considered addressed by the bloom** (a halo-tint rather than a radius gradient).
- The literal **Outer/Inner Border** rings stay on the Appearance Size/Alpha sliders for anyone who
  actually wants borders; only the two *Strength* sliders were repointed.

**Mechanics:** new `studio_glow` / `studio_accent` baseVals (save free; old presets default 0 = off →
unchanged). Strength sliders rebuild the comp on input (like `paletteOpacity`); the early-out that
returns `BLANK_COMP` for a plain feedback preset now also checks glow/accent are 0 (so bloom forces a
real comp build). Border sliders' stale `mirror` to the strength sliders removed (they're decoupled now).

| File | What landed |
|---|---|
| [src/editor/inspector.js](src/editor/inspector.js) | `studio_glow`/`studio_accent` baseVals; bloom GLSL in `_buildCompShader` (gated on >0, `!imagesOnly`); `_buildCompShader` early-out checks glow/accent; `_buildPaletteStrengthSliders` repointed border→bloom (rebuilds comp); border sliders' `mirror` removed; `_syncPaletteSliders` reads `studio_glow/accent`. |

**Done =** raise Glow Strength on a feedback preset → a soft halo in the Glow colour blooms around the
waveform (not an edge ring); Accent Strength adds a wider halo in the Accent colour; all three colours
visible; 0 = no bloom + no blur cost; saves/reloads + plays in the player; bundled presets unaffected.
**Awaiting visual review** — tune the ×3 bloom scale and blur1-vs-blur2 split after first look. Remaining
build-out: HSL sliders, gradient ramp (§10.6).

---

## 11. Removed devs — why (2026-05-31)

Per the house rule *"prefer deleting competing code over patching around it"* and *"don't over-build,"*
two planned directions were cut from this plan. Recording the reasons so they aren't silently
re-proposed later.

### 11.1 Phase 4 — Warp Shader Variants picker — ❌ REMOVED: **can break the app**
- **The break risk is structural.** The warp shader is a **shared webpacked submodule** that every one
  of the 1,144 bundled presets runs through. A picker that swaps `warpShader.updateShader()` per variant
  edits that shared path — a mistake there doesn't degrade gracefully, it **regresses the entire
  shipping library** at once (the exact class of multi-file/shared-state change CLAUDE.md flags as
  high-risk).
- **It's genuine shader engineering, not a slider.** Writing 4–6 correct, performant GLSL warps +
  cross-preset regression testing across the whole library is a project in itself — not the "pick a
  vibe, turn two dials" surface the rest of this plan is.
- **What we lose:** the single biggest *visual* ceiling jump, and the only path to authoring the
  shader-driven colour that 85% of bundled presets rely on (§10.6). Accepted — the risk/effort isn't
  worth it for a from-scratch creation tool.
- **If ever revisited:** it must be its own session + its own `warp-variants-dev.md` with a
  vendor/override strategy and a written cross-preset regression plan **first**. Not folded into this
  plan. Seed material: milkdrop-dev.md §"GLSL future work" (Option B: `WARP_VARIANTS` dict).

### 11.2 Phase 5 — Expert eqn / shader drawer — ❌ REMOVED: **off-brand, not recommended**
- A drawer of raw EEL/GLSL textareas is **exactly the grid-of-knobs / code-box aesthetic the project
  deliberately moves away from** (`[[feedback_slider_discovery_ux]]`). Every GitHub editor surveyed
  (§2) already does code-only; our differentiation is the no-code discovery surface. Shipping a code
  escape hatch undercuts that and invites the "wall of code and knobs" this doc opens by rejecting.
- **It doesn't fix the root cause for the target user** — the from-scratch builder who doesn't write
  EEL/GLSL gets nothing from a textarea.
- **The one scenario that resurrects it:** if `.milk` import ever ships, imported presets carry raw
  `frame_eqs_str` that needs *somewhere* editable — at that point an expert surface earns its place,
  driven by import, not by this plan. Until then it stays cut.

### 11.3 Phase 3b — Modulator / LFO bank — already deferred (not newly removed)
Kept on the tracker as ⏸ deferred (not cut): it's **inert from scratch** — spare q-vars only matter if
something reads them, and from a blank base nothing does (§9.0). Revisit only with a concrete
source→destination matrix. Phase 3 delivered the *concrete* version of this idea (animate the shapes
directly) instead.
