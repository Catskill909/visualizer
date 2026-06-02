# MilkDrop Creation Tools — Dev Plan

Last updated: 2026-06-02

> **The mission:** raise the Preset Studio's *from-scratch* creation ceiling to rival the 1,144 bundled
> presets — **without** a wall of code/knobs. *Simple to use, great for the creative user* is the hard
> constraint. **Phases 1–16 shipped (creator tools beta-ready; the thin-line "string" look is solved and
> waves can now fill into broad shapes).** Colour Field now has **18 styles** (Phases 8/13/17/19); Phase 18
> (Remix Energy dial) was built then reverted (user disliked the static slider). NEXT = backlog (§2). The
> headline edge is **audio reactivity**
> ([[project_audio_reactivity_differentiator]]).
>
> **Doc layout:** the **NEXT** plan is up front (§1–§2); **shipped** history is reference at the back
> (§3–§6). **Companion docs:** [milkdrop-tools-archive.md](milkdrop-tools-archive.md) ·
> [milkdrop-dev.md](milkdrop-dev.md) · [milkdrop-import-dev.md](milkdrop-import-dev.md).

---

## 🚦 Phase tracker — PICK UP HERE

**Single source of truth. Update on every change.** Active plan = §1; shipped essentials = §4.

| Phase | What | State |
|---|---|---|
| 1–3 | **Motion Engine · Custom Shapes · Shape Motion/Reactivity** | ✅ shipped |
| 6 | **Color Studio** (🎲 + rule/tone/Base-Hue + Color Roll + bloom) | ✅ shipped |
| 7 | **Flow Style** — per-preset warp-shader library (7 flows) + Density | ✅ shipped |
| 8 | **The Colour Field** — generated background + fg/bg colour split + Motion-tab reorg | ✅ shipped |
| 9 | **Full-stack 🎲 Remix** + **Roll-and-lock** | ✅ shipped |
| 10 | **Palette declutter + Color adjustments** (Brightness/Contrast/Gamma/Temperature, any preset) | ✅ shipped |
| 11 | **Remix content variety** + the shape/A-B fixes it surfaced | ✅ shipped |
| 12 | **Color Reactivity** — colour adjustments pulse to the beat over any preset | ✅ shipped |
| 13 | **Colour Field v2** — Spin · Conic/Spiral · Sharpness · 3-colour · beat-reactive field | ✅ shipped |
| 14 | **Scene FX rack** — Posterize / Vignette / Scan lines / Film grain (any preset) | ✅ shipped |
| 15 | **Break the thin-line look** — 15.1 Soft/Broad flows · 15.2 Scene Bloom · 15.3 Remix rebalance + pure-reseed fix | ✅ **SHIPPED & approved** (user: "finally solved this"). ⚠️ wave at ~10% *temporarily* — Phase 16 restores it (§1/§2). |
| 16 | **Richer (filled) waves** — `wave_fill` broadens the wave into a disc/wedge + Remix restores broad wave content | ✅ **SHIPPED** — 16.1 fill **approved** ("fill is great!!!"); 16.2 Remix-restore shipped (§1.5) |
| 17 | **More Colour Field styles** — Diamond · Checker · Clouds | ✅ **SHIPPED & approved** ("love the new chips!!") |
| 18 | ~~Remix strength dial~~ — built then **❌ REVERTED** (user: "doesn't add much + hate it static atop crucial controls") | ❌ removed 2026-06-02 |
| 19 | **9 more Colour Field styles** (Stripes·Weave·Vortex·Rays·Ripples·Moiré·Marble·Mandala·Hex) + Field→header layout + Remix rolls all 17 | ✅ **SHIPPED & tested** (user: "great stuff!") |
| — | ~~Templates~~ ❌ dropped · ~~Expert eqn/shader drawer~~ ❌ removed · ~~Modulator/LFO bank~~ ⏸ deferred | — |

**Current state:** A from-scratch preset has all three MilkDrop layers — a living **colour-field background**,
a **motion/flow field**, **foreground content** — each its own colour, all audio-reactive. **🎲 Remix** rolls
a complete preset; **Roll-and-lock** pins what you love. **Color adjustments + Color Reactivity + Scene FX**
re-mood, beat-pulse, and finish *any* loaded preset incl. the 1,144 bundled. The old thin-line "string"
look is solved (Phase 15) and waves can now **fill** into broad discs/wedges (Phase 16). **No committed
next phase — see the backlog (§2).**

**Beyond the creator:** finish Timeline + three.js 3D layers ([[project_v1_beta_scope]]).

---

## 0. Design principles (the hard constraints — still binding)

- **Additive, no tab explosion.** Each tool nests into its dimension (Palette / Motion / Wave / Layers).
- **Discovery aesthetic.** Chips + a couple of dials, not textareas/dense panels. No code surfaces, no
  accent-hue UI. ([[feedback_slider_discovery_ux]], [[feedback_no_accent_color_timeline_ui]])
- **Compose, don't fight.** Any injection (frame_eqs / warp / colour / grade) layers cleanly over a bundled
  base's own equations.
- **One shared builder = editor↔player parity by construction.** Generated GLSL is built by ONE function and
  used in **both** `_buildRuntimePreset` (editor) and the player path. (Most bakes into `state.comp`/
  `state.warp`, which the player renders as-is — parity free.) Forgetting it = the A5 trap.
- **🎲 Remix exercises every axis (standing rule).** Every new creative axis — especially reactive — gets
  wired into `_rollFullStack` under the right lock group. A feature the dice never rolls is half-shipped.
- **Lean HEAVY on audio reactivity** — the differentiator ([[project_audio_reactivity_differentiator]]).
- **No collapsible menus for headline features** (audio reactivity stays visible). Fine controls can collapse.

---

## 1. ✅ SHIPPED — Phase 15: Break the thin-line "string" look (2026-06-02)

**The problem (root cause).** Despite the Colour Field filling the *background*, Remix / from-scratch still
leans on **thin animated "string" patterns** — threads of light. Root: to make a flow *fill* the screen we
seed a high decay (`FLOW_FILL_DECAY 0.96`), and **high decay + a warp = the previous frame smeared along the
warp path** → thin bright content becomes animated threads. Low decay = crisp-but-empty; high decay =
filled-but-thready. **The string look is baked into the warp-feedback fill model itself** — not just the wave.

**The lever (what makes this fixable).** The warp shader can sample the **blurred feedback** textures
(`sampler_blur1-3`), not only the sharp `sampler_main`. Sampling the *blurred* previous frame makes
high-decay accumulation read as **soft, broad glow instead of sharp threads** — turning "fill" from thready
into filled-and-soft. (Available per the Phase 7 warp contract, §4.)

**Goal:** add strong **broad/soft** options and rebalance Remix so strings stop dominating — plus a
scene-level softness that also tunes the 1,144 bundled presets. **Honest caveat:** the oscilloscope wave is
*inherently* a thin line; we add broad alternatives + rebalance the dice, we don't ban thin (it has its place).

### 15.1 — Soft/Broad Flow styles ✅ SHIPPED (code, 2026-06-02)
Three new flows in `WARP_STYLES` + `buildWarpShader`, via a `wrapSoft` helper that samples mostly the
**blurred** feedback (`mix(texture(sampler_main,…), texture(sampler_blur1,…), 0.8)`), so high-decay fill reads
as soft glow not threads: **Bloom** (outward spread), **Smoke** (turbulent low-freq domain warp), **Melt**
(slow downward drift + wobble). Audit-confirmed: warp shader header declares `sampler_blur1-3`
([butterchurn.js:4356](src/vendor/butterchurn.js#L4356)) and `getHighestBlur(warpText)` auto-runs the blur
pass. Data-only — chips auto-appear (data-driven from `WARP_STYLES`), Remix rolls them (its flow pick
iterates `WARP_STYLES`), player parity + save free. `npm run build` passes. Coefficients (0.8 blur-mix,
displacement amounts) are the live-tuning dials.

### 15.2 — Scene Bloom ✅ SHIPPED (code, 2026-06-02)  *(the "more control over MilkDrop presets" bridge)*
A **Bloom** fader in the Scene FX rack (`studio_bloom`): `ret.rgb += amt * texture(sampler_blur1, uv).rgb`
in the `STUDIO_POST_FX` block → a soft glow on the final pixel that works on **any** loaded preset including
the **1,144 bundled** (softens harsh thin presets + universal finish control). No-op at 0 (byte-identical);
`gradeOpts`-fed; save/parity free. **Audit unknown RESOLVED:** `getHighestBlur(compText)` scans the comp
(incl. our inject) → referencing `sampler_blur1` auto-runs the blur pass even on a bundled comp. `npm run
build` passes.

### 15.3 — Remix rebalance + the pure-reseed bug ✅ SHIPPED (code, 2026-06-02)
**Root cause found (why the *majority* of rolls were stringy, not the intended ~20%):**
1. **Bug — "pure" rolls got a wave re-seeded.** The content roll ran *before* the Motion/Flow applies, and
   `_applyMotionEngine`/`_applyFlowStyle` call `_ensureFeedbackContent`, which re-seeds `wave_a = 0.8` when
   there's no shape + hidden wave. So every "pure" roll (~25%) got a thin wave injected back → ~45% of rolls
   carried a wave. **Fix:** the content roll now runs **LAST** (after Motion/Flow), so it's authoritative —
   `wave_a` is set by the content type and nothing re-seeds it.
2. **Sharp flows thread.** Remix picked uniformly from 10 flows (7 sharp). Sharp flow + high decay smears
   bright content into threads. **Fix:** the flow pick is now ~35% none / else **~65% soft (bloom/smoke/melt)
   / ~35% sharp**.
3. **Wave dropped (temporarily):** content roll was cut to **wave ~10% / shapes ~55% / pure ~35%** to break
   the string majority.

Net at the time: most rolls were broad/soft fields & blobs; thin strings a rare accent.

> **✅ RESOLVED by Phase 16.2 (the 10% cap was retired).** Once filled waves shipped (16.1), the content
> roll was raised back to **wave ~30% / shapes ~45% / pure ~25%**, with a wave roll being ~75% **filled**
> (broad disc/wedge) + ~25% **thin** (deliberate accent string). Thin strings are a valid look, just not the
> majority — exactly as intended. See §1.5 (Phase 16.2). *(This block is kept for history; the live numbers
> live in the code + §1.5.)*

**Sequencing done:** 15.1 ✅ → 15.2 ✅ → 15.3 ✅. **APPROVED** — user confirmed the string fix ("great!! this
finally solved the issue. i see was a bug of reinjecting"). The temporary wave cap was later retired by 16.2.

---

## 1.5 ✅ SHIPPED — Phase 16: Richer (filled) waves (2026-06-02)

The named future phase. Goal: **break the wave out of the thin oscilloscope line** so a wave is a *broad
shape*, not a thread — and then restore wave content to Remix now that it can look good.

### Audit — how the wave actually renders (so the plan is honest)
Read of `BasicWaveform` in `src/vendor/butterchurn.js` (class ~L5408, `drawBasicWaveform` ~L5470+):
- **The wave is a `LINE_STRIP`** (or `gl.POINTS` when `wave_dots`). Per `wave_mode` it fills a clip-space
  `positions` Float32Array — linear modes = a horizontal run of samples; radial/ring modes (5/6) =
  `positions = (rad·cos(ang), rad·sin(ang))` around a center. Then it draws that polyline.
- **Thickness is faked**, not filled: the line is re-drawn N times at tiny `thickOffset`s
  (the `instances` loop + `thickOffsetLoc`). Our existing **`wave_thickness` fork (0.5–8)** just widens that
  band. A thick line is still a *line* — it never fills an area. **This is the ceiling of the current path:
  thickness alone cannot stop the string look.**
- **A true filled wave needs a renderer fork.** For each curve vertex, emit a paired **baseline** vertex
  and draw a **`TRIANGLE_STRIP`** (standard filled-area-chart technique):
  - linear modes → baseline = the `wave_y` line ⇒ a filled *band/area* under the curve;
  - radial/ring modes → baseline = the center point ⇒ a filled *blob* (very broad — the strongest
    anti-string of all).
  The per-sample `positions` already exist; we add the interleaved baseline verts + a `TRIANGLE_STRIP`
  draw path. **Contained to one class** (`basicWaveform.js`), consistent with the existing `wave_thickness`
  fork, and **player parity is free** (player and editor share this one engine — no second code path).

### Plan (sequenced)
- **16.1 — Filled wave (headline). ✅ SHIPPED & APPROVED (2026-06-02, user "fill is great!!!").** Forked
  `BasicWaveform` with a `wave_fill` baseVal (0–1, doubles as fill opacity; 0 = byte-identical line path).
  When >0, `drawBasicWaveform` draws a **`TRIANGLE_FAN`** (apex = the y-flipped wave center stored in
  `generateWaveform`; rim = the smoothed curve) UNDER the existing crisp line → circular modes (0/1) =
  pulsing filled **disc**, line modes (4/6/7) = broad filled **wedge**. One universal center-baseline, no
  per-mode branching; composes with thickness (line passes unchanged) + `wave_rot` (shared center). New
  `this.fillPositions` buffer + `this.waveCenterX/Y` (constructor); frame-blend hard-switches `wave_fill`
  (mirrors `wave_thickness`, ~L3045). Editor: `wave_fill` in BLANK baseVals + **"Fill"** slider (`ws-fill`)
  in `_buildWaveSliders`/`_syncWaveControls` + rolled in randomize-wave; save/load + player parity free.
  `npm run build` passes. **Tuning dial:** fill alpha = `color.a * wave_fill`.
- **16.2 — Restore wave content in Remix. ✅ SHIPPED (code, 2026-06-02).** `_rollFullStack` content roll
  rebalanced **wave ~30% / shapes ~45% / pure ~25%** (was 10/55/35). Within a wave roll: **~75% FILLED**
  (`wave_fill` 0.45–1.0 + optional thickness = broad disc/wedge) + **~25% thin** (`wave_fill=0` = a
  deliberate occasional accent string). The flow rolled above smears a filled wave into broad blooming
  motion, not a thread. `wave_fill` reset to 0 alongside `wave_a=0` so no stale fill leaks onto shape/pure
  rolls. The ~10% anti-string cap is **retired** — thin strings are now a valid occasional look, not the
  majority. `npm run build` passes.
- **Deferred (only if 16.1/16.2 fall short):** dual / second wave instance, extra modes. The existing 8
  modes + fill + thickness already cover a lot — don't pile on.

### Risk / care points (16.1 is an engine-renderer fork — higher-touch than the data-only flow/grade work)
- Keep `wave_fill = 0` **byte-identical** to today's line path (gate the whole new branch).
- Per-mode baseline differs (linear `wave_y` vs radial center) — handle both, skip fill on modes where it's
  meaningless (e.g. dots).
- Mind the existing interactions in this method: the **thickness `instances` redraw**, the **y-flip /
  rotation pass**, and blend `its=2`. Fill should compose with thickness, not fight it.
- This is the one phase that touches the vendored engine fork — plan the execution trace before code
  (high-risk per CLAUDE.md), then verify in both editor preview **and** player.

---

## 2. ▶ NEXT — Phases 17–18 (planned 2026-06-02)

### Phase 17 — More Colour Field styles ✅ SHIPPED & approved (2026-06-02, "love the new chips!!")
Shipped exactly as planned: **Diamond / Checker / Clouds** cases added to the `fieldExpr` switch
(~L8464); 3 chips added to `#bgfield-style` (`editor.html` ~L311); added to the Remix style pick (~L1888).
Generic chip handler + `_syncBgField` needed no change; all three auto-inherit Spin/Sharpness/3-colour/
beat-react. `flat` unchanged → byte-identical. `npm run build` passes.
Add three new `bgField` styles. **Audit:** each style is ONE GLSL expression (0..1 scalar over `_fuv`) in the
`switch` at `_buildCompShader` (~L8459); it auto-inherits Spin/Sharpness/3-colour/beat-react. Chips are
static `.lseg` buttons (`editor.html` ~L304, `#bgfield-style`); the click handler + `_syncBgField` are generic
(`data-field`), so **no handler change** — just add chips + cases + the Remix style pick (~L1888). `flat`
stays default/byte-identical; a bad expr only affects that one non-flat style (near-zero risk).
- **Diamond** — Manhattan-distance rings: `sin((|x-.5|+|y-.5|)*scale*14 - time*spd*2)`. Square-radial.
- **Checker** — scrolling hard tiles: `mod(floor(x*scale*8 + time*spd*.5)+floor(y*scale*8), 2.0)`. Geometric.
- **Clouds** — domain-warped pseudo-organic plasma (no helper fn — see constraint). Billowing.
- **⚠️ Constraint:** the field is an INLINE expression in the comp body → can't declare a global `noise()`
  there. True-fbm Clouds would need a shader-prelude change (deferred); Phase 17 ships the domain-warped
  one-liner version. **Skip Rings** (redundant with Radial + Sharpness). **Deferred:** Hue-cycle (changes the
  A→B colour mapping, not just the scalar) · Drift direction + Mirror/Symmetry (field MODIFIERS, not styles).

### Phase 18 — Remix "subtle ↔ wild" strength dial ❌ BUILT THEN REVERTED (2026-06-02)
Shipped in code, then **removed at the user's request** same day: *"doesn't add much and I hate that it's
static on top of the crucial controls."* Fully reverted — `_rollFullStack` is byte-for-byte back to its
pre-18 literals; the slider markup (`#remix-strength`), CSS (`.remix-strength-row`), persistence
(`loadRemixStrength`/`dc.remix.strength`), and `_bindRemixStrength` are all deleted; `npm run build` passes
with zero leftover refs. **Lesson:** a master "energy" dial added complexity without enough payoff, and a
permanently-visible control above the Remix locks was unwanted UI clutter. **If revisited:** make it a roll
*output* people feel, not a static knob — e.g. fold intensity into existing controls, not a new always-on
slider. Don't rebuild it as a top-level slider.

### 🎨 Colour Field styles (user loves these — "more anytime!")
Each is ONE `fieldExpr` (0..1 over `_fuv`+time) → free chip + auto Spin/Sharpness/3-colour/beat-react.
A reliable, cheap, high-delight vein. **✅ SHIPPED (18 total, Phases 8/13/17/19):** Flat · Linear · Stripes ·
Weave · Radial · Diamond · Moiré · Conic · Spiral · Rays · Vortex · Mandala · Plasma · Clouds · Marble ·
Ripples · Checker · Hex. All 17 non-flat rolled by 🎲 Remix; "Field" is now a full-width **header** above the
wrapped chip grid (`#bgfield-style` flex-wrap CSS) — the inline label was too cramped at this chip count.

**Still inline-ready if we want even more (no helper):** stacked-frequency bands · spiral-arms count ·
log-polar grid · diagonal weave · target/bullseye. **Needs a shader PRELUDE (deferred — can't declare a
global `noise()`/loop in the inline field expr):**
real-fbm **Clouds HD / Smoke / Fire** · **Voronoi/Worley cells** · **Caustics**. → if we want these, first add
a one-time GLSL helper-prelude to the generated comp, then they're all cheap.

### Field MODIFIERS (apply to ANY style, not new styles)
**Drift direction** (scroll vector on `_fuv` + angle/speed dial) · **Mirror/Symmetry** (fold `_fuv` for kaleido) ·
**Hue-cycle** (map `_field`→hue rotation instead of the A→B blend — changes colour mapping, mid effort).

### Remaining backlog (uncommitted)
**Remix minors:** feedback-mode variety · a "Content" Remix-lock (pin shapes/wave).
**Beyond the creator:** finish Timeline + three.js 3D layers ([[project_v1_beta_scope]]).

---
---

# Shipped history (reference)

## 3. Why from-scratch was limited (orientation)

A blank canvas varied only *surface* dimensions (palette, motion sliders, one wave, layers). A MilkDrop
preset's richness is **three engine layers** a blank build never authored: (1) a **generated colour field**
(comp shader paints the whole frame), (2) a **motion/warp field** (~85% of bundled presets get their look
here), (3) **foreground content** (wave/shapes — accents, not the variety). Plus: **the way to tune a
*bundled* preset is the comp post-FX inject** (`STUDIO_POST_FX`) — it bolts onto any preset's final pixel
without touching its internals (the reliable bridge to the 1,144; motion sliders only partly reach them,
as a bundled preset's own `frame_eqs` overwrite them each frame).

## 4. Shipped — the essentials (Phases 1–14)

Tight per-phase facts (the regression-preventing "why/how"). Full Phases 1–3 + Color Studio writeups are in
the archive; the deep narrative for 7–14 is in git history + memory.

**1 — Motion Engine.** `MOTION_ENGINES` + `buildMotionEngineFrameEqs`; living per-frame motion; auto-wake;
player parity via the shared builder.

**2/3 — Custom Shapes + Motion/Reactivity.** `MAX_SHAPES=4`, placement-first cards; `buildShapeMotionEqs`.
**Trail/decay root-cause fix:** default `decay` lowered across BLANK + variations — see
[[project_shape_trail_decay_gate]].

**6 — Color Studio.** 🎲 + steerable harmony rule/tone/Base-Hue generator + Color Roll + Glow/Accent **bloom**.

**7 — Flow Style.** Per-preset `warp` string (isolated — bad GLSL fails only that preset). `WARP_STYLES` +
`buildWarpShader(flow)` → 7 flows + Speed/Depth/**Density** (per-frame zoom-out-of-centre that fills).
`FLOW_FILL_DECAY=0.96` seeded on flow-select (fill is opt-in). *(Note: this high-decay fill is the source of
the thin-line look Phase 15 addresses.)*

**8 — The Colour Field.** Shift's A→B beat-blend spread across *space* (`bgField`): Flat (byte-identical) /
Linear / Radial / Plasma in `_buildCompShader`'s solid branch. **fg/bg split:** `bgColorA` gives the field
its own Colour A (≠ the foreground wave). **Motion-tab reorg:** Motion / Flow / Quick Looks + collapsible
"Adjust". **Root fix — palette colour is the background everywhere:** `_wakeFeedbackIfSolid` →
`_ensureFeedbackContent` (never clears solid); comp composites the feedback over the flat colour whenever
there's content (`_hasFeedbackContent`).

**9 — Full-stack 🎲 Remix + Roll-and-lock.** `_rollFullStack` lands on Shift then rolls colours + field +
Shift pulse + Motion + Flow + content. Roll-and-lock: "🎲 Remix locks" strip (Colours/Field/Motion/Flow/
Reactivity), persists in localStorage.

**10 — Palette declutter + Color adjustments.** Removed 7 canned variations (kept Solid + Shift). Brightness/
Contrast/Gamma/Temperature baked into `STUDIO_POST_FX` via `injectStudioPostFx`/`gradeOpts` — tune any
preset's final pixel; no-op at default → byte-identical.

**11 — Remix content variety (+ fixes).** Remix rolls a content TYPE — wave ~20% / shapes ~55% / pure ~25%.
Fixes: **A/B "A" re-baselined** to the live entry (re-set `originalState` on init/Reset/New); **`currentState.
shapes` is EDITOR-ONLY** (bundled shapes no longer pollute the array / starve the 4 render slots) — see
[[project_bundled_no_shape_cards]].

**12 — Color Reactivity.** Colour adjustments **pulse to the beat** on any preset: `buildStudioPostFxGlsl`
bakes `base + curve(source)·amount` (live `bass/mid/treb/vol/q31`) when amount > 0 (else byte-identical).
State `studio_*_react` (baseVals) + `studio_grade_react_source/_curve` (top-level). Always-visible **Color
Reactivity** panel (Source + Curve + 4 sliders). User-facing name is **Color** (not "Grade"). Rolled by 🎲
Remix (Reactivity lock).

**13 — Colour Field v2.** On `bgField`: **Spin** · **Conic/Spiral** styles · **Sharpness** (2→8 bands) ·
**3-colour** (`tri`, C = palette wave) · **beat-reactive field** (`react`, via `_sr`). Rolled by 🎲 Remix
(shape → Field lock; beat → Reactivity lock).

**14 — Scene FX rack.** Posterize / Vignette / Scan lines / Film grain in `STUDIO_POST_FX` (on `ret.rgb`,
uv/time in scope; no-op at 0 → byte-identical). State `studio_{posterize,vignette,scanlines,grain}`. "Scene
FX" panel; rolled by 🎲 Remix (~25%, Colours lock). Posterize tuned punchy (amount→8..2 bands); Vignette is a
centre-weighted bowl (`smoothstep(0.05,0.6,length(uv-0.5))`). *Vignette/Posterize are content-dependent (need
bright/full content).* **Audit notes:** Mirror dropped (Canvas Mirror exists); RGB-split/Pixelate deferred
(need a 2nd pass, exist per-layer); per-FX beat-pulse deferred (post-FX can't rely on `_sr` for non-solid).

## 5. Parked & removed

- **Templates / Templates tab — ❌ dropped.** Redundant: Remix + Library + Random already cover starting
  points.
- **Expert eqn/shader drawer — ❌ removed.** Off-brand code surface. Revisit only if `.milk` import ships.
- **Modulator / LFO bank — ⏸ deferred.** Phase 3 shipped the concrete version (animate shapes directly).

## 6. Archive pointer

Full early-phase writeups: [milkdrop-tools-archive.md](milkdrop-tools-archive.md) — §7 Motion Engine · §8
Custom Shapes · §9 Shape Motion/Reactivity (incl. §9.13–9.14 trail/decay fix) · §10 Color Studio · §2–§6
original brainstorm/survey.
