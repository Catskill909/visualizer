# Tile Custom — Tiling Enhancement Audit & Phased Dev Plan

**Last updated:** 2026-05-17 — doc audited handoff-ready; Phase 4 (recursive grids) full buildable spec written at §13
**Scope:** Image and GIF layers in Preset Studio. Videos stay single-instance.
**Audience:** Anyone implementing this — including a future developer joining cold. §12 is the handoff reference.

---

## 🎯 Status Dashboard

**Current state:** Phases 1 / 2 / 2.5 / 3 / 4 ✅ all shipped — 1–3 on 2026-05-16, Phase 4 on 2026-05-17. Variance Suite: Size Var / Jitter X/Y / Opacity Var / Phase Var / Seed + Lock. Scatter sampling: jitter moves tiles freely with overlap. **Grid mode: Density/Grid toggle, explicit Cols×Rows, Fill/Fit, Grid Scale (0.1–3×); Pulse/Strobe react in Grid mode. Recursive grids: Subdivide (1–6) + Outer Gap (0–0.5). All verified in browser, export + DMG build confirmed.** Speed Var + Direction Var deferred (tunnel architecture work — Phase 3.2).
**Next action:** Phase 5 (2.5D parallax camera) was built and **reverted the same day** — the editor is back at the verified Phase 4 state. The §10.5 spec as built failed on UX (see §10.5 status + the most-recent-change note); it needs a redesign before any retry. Awaiting a fresh direction from the user. Phase 3.2 / 3.3 ⬇ backlog (§5.9); Phase 3.5 ❌ cut (§5.8). Tile feature set shippable at Phase 4.

### Phase status

| Phase | What | Status | Shipped | Effort |
|---|---|---|---|---|
| [1](#3-phase-1--structural-per-cell-wins) | Brick offset · cell rotate · popcorn | ✅ Shipped | 2026-05-15 | 1 day |
| [2](#4-phase-2--procedural-variance-suite) | Variance suite + per-layer seed (Speed/Dir Var deferred) | ✅ Shipped | 2026-05-16 | 1 day |
| 2.5 | Scatter sampling — free jitter + tile overlap (3×3 neighbour accumulation) | ✅ Shipped | 2026-05-16 | 1 day |
| [3](#5-phase-3--explicit-grid-mode) | Explicit Grid mode — Density/Grid toggle, Cols×Rows, Fit/Fill, Grid Scale | ✅ Shipped | 2026-05-16 | 1 day |
| [4](#13-phase-4--recursive-grids-full-spec) | Recursive / nested grids (pure 2D) — Subdivide + Outer Gap | ✅ Shipped | 2026-05-17 | ~1 day |
| 3.2 | Tunnel ↔ Scatter convergence — free-jitter in tunnel + Speed/Direction Var | ⬇ Backlog | — | ~3 days |
| 3.3 | Scatter-mode FX parity — chromatic / blur / sobel / wave / pixelate inside the scatter loop | ⬇ Backlog | — | ~2 days |
| ~~3.5~~ | ~~Per-cell override editor~~ | ❌ Cut 2026-05-16 — see §5.8 | — | — |
| [5](#105-phase-5--25d-parallax-camera-pure-2d) | 2.5D parallax camera (pure 2D) | ⏸ Built 2026-05-17, reverted same day — needs a redesign (§10.5) | — | — |

Legend: 📋 Planned · 🔨 In progress · ✅ Shipped · ⬇ Backlog · ❌ Cut · 🛑 Blocked · 🐛 Bug

### Most recent change

`2026-05-17` — **Phase 5 built, then reverted the same day.** The §10.5 parallax-camera spec was implemented in full (scene `cameraPanX/Y/Drift/Bob`, per-layer `parallaxDepth`, baked `_camPos` in `_buildCompShader`, Camera section in the Layers tab) and **fully reverted on user feedback** — the editor is back at the verified Phase 4 state, `node --check` clean. It was a mess to use: nothing happened without configuring two disconnected places (a per-layer slider AND the global camera) with no feedback, and parallax is pointless on the 1–2-layer presets that are typical. See the §10.5 status block for the full failure analysis. The spec needs a redesigned interaction model before any retry; the schema/shader approach was fine, the UX was not.

`2026-05-17` — **Phase 5 spec fleshed out + §10 camera model reconciled.** §10.1: resolved the pan-vs-tilt inconsistency — **2D layers get pan only** (a flat card has no geometry; a tilt forces billboard/shear math and costs CPU/GPU for no gain), **3D object layers get pan + small tilt** (free on real geometry, a genuine depth cue). §10.2: new resolved decision — the **volumetric X×Y×Z grid is 3D-object-only**; 2D layers stop at recursion (§13) and get depth from Phase 5 pan parallax, never a 3D grid (a flat billboard can't rotate convincingly). §10.5: added the **UI/UX section** — the "Pan" naming collision (the camera must not reuse the per-layer Pan name), the two-scopes/two-homes split (per-layer depth sliders in Motion vs a new global Camera panel), and the dead-slider trap (`parallaxDepth` is invisible until the camera moves → ship auto-drift on by default). Phase 5 promoted to 📋 Planned (next).

`2026-05-17` — **Phase 4 ✅ shipped & verified — Recursive grids.** Verified in browser; a custom-preset export from the local server loaded cleanly in a freshly generated DMG build. Subdivide + Outer Gap confirmed working with the Phase 1–3 per-cell stack. Tile feature set is now complete for v1 beta — propagated to image-layer-effects.md, the in-app help modal (index.html), and the promo page (beta modal + features list).

`2026-05-17` — **Phase 4 code in — Recursive grids (verifying in browser).** Built straight off the §13 spec. Two fields — `tileSubdivide` (integer 1–6) and `tileOuterGap` (0–0.5) — added to the image template, text template, and `_normalizeImageEntry`; defaults (1 / 0) are no-ops → old presets byte-identical. Shader: a new `useRecursion` gate (`useGrid && (subdivide>1 || outerGap>0)`) adds a recursion branch inside `applyTileUV`'s Grid path — `_outerId`/`_outerUV` from `_gu`, the outer gap masks the outer-cell border + rescales the inner region, then `_innerGu = _outerUV·S`, `_cellId = _outerId·S + floor(_innerGu)`, `_u = fract(_innerGu)`. Mip derivatives taken from the smooth `_gu` scaled `S/(1−2·gap)` (no seam at outer boundaries). The plain Grid path is left untouched when recursion is off → zero regression. `buildScatterSample`: scatter + recursion = flat fine grid `Cols·S × Rows·S`, `tileOuterGap` ignored under jitter (§13.5 — the open §13.7 decision, taken as recommended). UI: a `Subdivide` integer stepper (1–6, `type="number"` → exempt from `sliderExclude`) + an `Outer Gap` range slider (`layer-outergap-sl` added to `sliderExclude`), both class `.layer-grid-row`. `node --check` clean; **pending in-browser GLSL verification (test matrix §13.8) before propagating to user-facing docs.** image-layer-effects.md gained a new Grid mode section covering Phases 3 + 4.

`2026-05-17` — **Doc audited handoff-ready + Phase 4 spec written.** Pre-pickup pass: §12.2 new-field checklist refreshed (stale line numbers + the non-existent `_layerCardHtml`/`_bindLayerCard` corrected to `_mountLayerCard`; non-range inputs noted exempt from `sliderExclude`); §1 Tier C updated — the click-a-cell "replicator" it described was cut (§5.8), Tier C now ends at the explicit grid (shipped as Grid mode). **New §13 — full Phase 4 (recursive grids) spec**, buildable cold: the key insight that a *uniform* subdivision is identical to a flat finer grid (so Phase 4 must add a per-level treatment — the `tileOuterGap` that makes inner tiles cluster), schema, shader sketch, scatter handling, UI, one open decision, build checklist. Phase table / build order / §10.3 repointed to §13. README: Meyda dropped from "Planned" (never adopted — Flux source covers it DIY).

`2026-05-16` — **Consolidation + roadmap cleanup.** Phases 1–3 verified by the user in-browser (save, cross-browser export, old-preset + old-tile-preset load — all clean, no console errors). Roadmap decisions locked: **Phase 3.5 (per-cell click-a-cell editor) ❌ cut** — compositional, not live-performance; the procedural variance already covers per-cell variety. **Phase 3.2 / 3.3 → ⬇ backlog** — gap-filling for edge-case combos (tunnel+jitter, FX+scatter), low value-per-risk. **Phase 4 (recursive grids) is the next creative feature** — builds on the Grid foundation, sets up for the future 3D layer work. Doc reconciled: phase table, build order, §6 diagram, §7.1 schema, §9 Q3/Q4, §5.8. See §12.7 for the code-audit findings from this consolidation pass.

`2026-05-16` — **Phase 3 ✅ shipped & verified.** Grid mode confirmed working in-browser across the slider suite — Density/Grid toggle, Cols×Rows steppers, Fill/Fit, Grid Scale (0.1–3× — margin below 1, zoom-in above), Pulse/Strobe reacting, per-cell effects + jitter/scatter composing. Propagated to README, the in-app help modal, and the promo page. Phase 3 closed; next is the deferred-differential phases 3.2 / 3.3.

`2026-05-16` — **Phase 3 fix — Pulse / Strobe now react in Grid mode.** Test feedback: audio-reactive Pulse and Strobe did nothing in Grid mode. Cause: both modulate only `sizeBase`, which is the *density* divisor (`_u /= sizeBase`) — the Grid branch maps by `Cols×Rows` and never touched it. Fix: extracted the audio modulation factor (`pulseFactor` = `sizeBase` without the base `sz`) and folded it into the grid scale divisor, so the grid zooms/strobes on the beat exactly as the density field does. `pulseFactor` = 1.0 when Pulse = 0 and no Strobe → no-op. Divisor clamped `max(…, 0.05)` against inverted-pulse div-by-zero. Beat Fade (`opacityPulse`) was already mode-independent (routes through the final `_op` blend) — unaffected.

`2026-05-16` — **Phase 3 — Grid Scale slider added (0.1–3.0).** First test feedback: hiding Size in Grid mode removed the ability to scale the *whole grid*. Fix: new `tileGridScale` field (default 1.0) + a "Scale" slider shown in Grid mode. Shader divides `_u` by the scale before the `Cols×Rows` map: below 1.0 the grid shrinks toward centre (out-of-grid mask turns the freed border transparent); above 1.0 the grid is larger than the canvas — a zoom-in with edge cells cropped (for pushing into mirror/kaleidoscope patterns). Range raised to 3.0 after a second test note. Default 1.0 → backward compatible. Slider added to `sliderExclude`.

`2026-05-16` — **Phase 3 code in — Grid mode (verifying in browser).** Explicit `Cols×Rows` grid as an alternative to density tiling. 4 fields (`tileMode`/`tileCols`/`tileRows`/`tileFit`) added to image template, text template, `_normalizeImageEntry`. Shader: `applyTileUV` and `buildScatterSample` each gained a `useGrid` branch — grid maps the canvas to `Cols×Rows` cells once (`_gu = (_u+0.5)*vec2(C,R)`), no `fract`-wrap; out-of-grid fragments masked transparent; `_cellId` clamped to grid bounds; the scatter neighbour scan drops cells outside the grid. Fit mode letterboxes the image into each cell (`_cellAR = aspect.y*Rows/Cols`). `useGrid` gated `!hasTunnel` (grid inert under tunnel — §5.6) and skips `aspectPreScale`. UI: Density/Grid segmented toggle + Cols/Rows integer steppers + Fill/Fit toggle in `_mountLayerCard`; Size slider hidden in Grid mode, Width/Height hidden in Grid mode (§5.6 decision — Cols:Rows ratio is the grid's shape control). Steppers are `type="number"` → no `sliderExclude` touch. `node --check` clean; **pending in-browser GLSL verification before propagating to user-facing docs.**

`2026-05-16` — **Phase 3 spec reworked — Grid mode only; per-cell editor → optional Phase 3.5.** Phase 3 originally bundled Grid mode *and* an explicit per-cell override editor (picker widget + `tileOverrides` map). Split: **Phase 3 = Grid mode only** (~2–3 days — `density|grid` toggle, `Cols×Rows`, `Fit/Fill`); the **per-cell override editor is now optional Phase 3.5**, built only on real beta-user demand. Rationale (§5.0): DiscoCast is a live audio-reactive VJ tool — the procedural per-cell variance from Phases 1/2/2.5 already delivers per-cell creativity (infinite, reactive, generative), whereas the override editor is a *compositional* tool producing static authored layouts, doesn't scale past a handful of cells, and is the heaviest footgun surface in the codebase. Grid mode is a cheap layout primitive that makes the procedural system *easier* to use. §5 fully rewritten (5.0 scope decision · 5.1–5.6 Grid mode · 5.7 Tunnel · 5.8 the preserved Phase 3.5 editor spec). Phase table, §6 diagram, §11 build order, §7.1 schema, §9 Q2–Q4 all reconciled; old standalone Phase 3.1 (drag-multi-select) folded into 3.5.

`2026-05-16` — **Phase 3 code audit + differential scheduling.** Audited the §5 spec against live `inspector.js`. Three spec gaps the build must close, recorded in new **§5.9.1**: grid-mode UV path (per-axis Cols/Rows divisor, finite non-repeating mapping, threads through `applyTileUV` *and* `buildScatterSample`), `_cellId` array-index clamping, and the scatter × grid interaction (the §5 spec predates Phase 2.5). Green-lit: override-map persistence (`deepClone` JSON round-trip clones nested objects safely through undo/save/export), the `.xy-pad` widget as the cell-picker template, the baked `vec4` array. The deferred Phase 2/2.5 differentials are now scheduled phases — **3.2** Tunnel ↔ Scatter convergence (free-jitter in tunnel + Speed/Direction Var) and **3.3** Scatter-mode FX parity — see §5.9.2–5.9.3. §12.1 handoff line numbers refreshed (all drifted after Phase 2/2.5; `_layerCardHtml`/`_bindLayerCard` corrected to the single real method `_mountLayerCard`).

`2026-05-16` — **Phase 2.5: scatter sampling — the architectural fix for jitter cropping.** Every prior jitter fix failed because the bug was architectural, not UV math. `applyTileUV` does `_u = fract(_u + 0.5)`, which collapses each pixel into its own cell's `[0,1]` box; the texture is sampled exactly once, from that cell only. A tile physically *cannot* draw into a neighbour's pixels — so jitter could only ever slide a crop around inside the box (the "container" the user kept hitting). **Fix:** a new `buildScatterSample()` renderer. Each fragment scans the 3×3 block of cells around it; for every neighbour it computes that cell's jittered/scaled/rotated placement and composites the tile where the fragment lands inside it. Tiles now move freely past cell edges and **overlap** each other — true replicator behaviour, no cropping container. Gated by `useScatter` = jitter active + tile layer + non-video + non-tunnel; every other preset keeps the untouched `fract()` path (zero regression). All per-cell effects (size/depth/rotation/popcorn/opacity/spacing/radius/mirror) compose inside the loop. **v1 deferrals (documented, not silent):** tunnel + free-jitter, and texture-resample FX (chromatic/blur/sobel/wave/pixelate) are disabled when scatter is active — they assume a single `_u`. Depth Var is zoom-out-only in scatter mode (keeps every footprint ≤ 1 cell so 3×3 always suffices).

`2026-05-16` — **Phase 2 fix: jitter + size var object-space bug.** When Size Var and Jitter X/Y were used together, jitter shifted the already-clamped texture UV rather than repositioning the image object within its cell — producing a scroll/crop of the texture instead of a positional offset. Root cause: sequential UV transforms clamp between steps, so the second transform operates in a different coordinate frame. Fix: merged Size Var and Jitter X/Y into one unified object-transform block. The combined formula is `texUV = (_u - jitterOffset - 0.5) * szF + 0.5` — jitter moves the image center within the cell, size var zooms it, both applied before the single step-mask + clamp. Each active axis still uses a distinct hash constant so the patterns are independent.

`2026-05-16` — **Phase 2 fix: size var cropping.** Size Var formula changed from `1 ± 0.5×var` (zoom in/out = cropping on one side) to `1 + hash×var` (zoom out only = image always shows fully within slot, just at different sizes). No cell ever overflows its boundary. Transparent gap around smaller cells is masked the same way as Phase 1 Cell Rotate corners.

`2026-05-16` — **Phase 2 fix: double image artifact on all scaling ops.** Size Var, Depth Var were pushing UV outside `[0,1]` post-fract; WebGL REPEAT wrap sampled the opposite texture edge → ghost duplicate. Fixed with the same `step()` mask + `clamp()` used by Phase 1 Cell Rotate. Jitter switched from `fract()` to `clamp()` for the same reason (fract was wrapping content at cell edge → seam artifact).

`2026-05-16` — **Phase 2 seed UI cleanup.** Removed editable number input (too cluttered). Seed now shown as a read-only value display (`.lsv` span, same as all other value readouts in the card). `[Rand]` button (styled `.lseg`) picks a random 0–9999 seed and rebuilds the shader. Lock toggle (default: on) freezes the seed so saves don't bump it — unlock to get a new random layout on each save. **How to use:** with variance sliders above zero, click `[Rand]` repeatedly to audition different per-cell layouts; when you find one you like, lock it. The seed number is displayed so you can note it — but it can't be typed manually (use Rand to change it).

`2026-05-16` — **Phase 2 shipped.** Variance suite live: Size Var, Jitter X, Jitter Y, Opacity Var (all in Per-Cell section), Phase Var (Tunnel section). Seed + Lock control. All 7 new state fields added to image template, text template, and `_normalizeImageEntry`. Seed threads through all per-cell hashes via `+ seedVec` offset (seed=0 → output identical to Phase 1 — full backward compat). Size/Jitter/Depth variance emitted inside `applyTileUV` post-fract; Opacity Var emitted post-sample using the popcorn `pcCell` pattern. Speed Var and Direction Var deferred — require per-cell `_tz` computation inside `applyTileUV`, which is a tunnel architecture change.

`2026-05-15` — **Phase 1 polish: tooltip length pass.** User flagged that the original `Cell Rotate` tooltip ("Hashed rotation per tile — composes with Spin, Angle, and Group. 0=aligned, 1=full random per cell.") was JARRING and created more confusion than it solved. Cut all four Phase 1 tooltips to 2–5 words: Offset = "Stagger alternating rows or columns", Amount = "Stagger amount", Cell Rotate = "Random rotation per cell", Snap = "Snap to 90° increments", Popcorn = "Per-cell audio pulse". Saved a `feedback_slider_discovery_ux` memory: tooltips answer "what does this do", not "what happens with X" — slider play IS the experience.

`2026-05-15` — **Phase 1 fix #2: Cell Rotate corner-wrap artifact masked.** Bug: rotating each cell pushed sampled UV outside the cell's `[0,1]` bounds; WebGL's REPEAT wrap mode then sampled the *opposite side* of the texture at those corners, creating a faint "duplicate" sliver in every cell. Fix: when `hasRotVar` is on, multiply `_gapMask` by an in-bounds step mask after rotation and clamp `_u` to `[0,1]`, so rotated-out corners go fully transparent (MilkDrop background shows through) instead of wrap-sampling the texture. Uniform Spin alone (no variance) is unchanged so existing presets don't regress.

`2026-05-15` — **Phase 1 fix #1: Group Spin vs Cell Rotate compose now.** Bug: per-cell rotation lived inside the `perTileSpin` block, which gates on `!groupSpin`. Result: enabling Group Spin silently disabled Cell Rotate. Fix: the rotation block now emits when `perTileSpin OR hasRotVar`; `_localAng` defaults to `0.0` when only variance is active, so Group Spin (whole-grid layout rotation) and Cell Rotate (per-cell content rotation) compose cleanly. Also renamed UI label `Rotate` → `Cell Rotate` to disambiguate from Spin/Angle.

`2026-05-15` — **Phase 1 code in.** Five new state fields wired through templates + normalizer + sliderExclude. New `Per-Cell` section added to layer card (gated by Tile=on). Shader extended: `_cellId` captured before fract, brick offset emitted before cell-id capture (so staggered cells get unique hashes), per-cell rotation injected into `perTileSpin` block, popcorn modulates `_src` after texture sample. Vite starts clean.

`2026-05-15` — Doc created and locked. All 5 open questions resolved (§9). Constrained-camera principle locked as design rule for all future depth work (§10.1). Code audit + handoff checklist added (§12).

### Bugs / blockers

| Phase | Symptom | Status |
|---|---|---|
| 2 | Double image — scaling ops (Size Var, Depth Var) pushed UV outside `[0,1]`; REPEAT wrap sampled opposite texture edge | ✅ Fixed 2026-05-16 — step mask + clamp, same pattern as Phase 1 Cell Rotate |
| 2 | Jitter seam artifact — `fract()` on shifted UV wrapped content at cell boundary | ✅ Fixed 2026-05-16 — changed to `clamp()` |
| 2 | Size Var cropping — formula allowed zoom-in (`_szF < 1`), image overflowed cell and clipped | ✅ Fixed 2026-05-16 — formula changed to zoom-out only |
| 2 | Jitter + Size Var combined — sequential UV transforms caused jitter to scroll the texture crop rather than move the image object; edge-stretching persisted | ✅ Fixed 2026-05-16 — unified into one object-space block: `texUV = (_u - jOffset - 0.5) * szF + 0.5` |
| 2.5 | Jitter STILL cropped at a cell-box "container"; tiles could not overlap — architectural: `fract()` locks each pixel to its own cell, one sample per pixel | ✅ Fixed 2026-05-16 — `buildScatterSample()` 3×3 neighbour-accumulation renderer; tiles move freely + overlap, no container |

When new bugs appear, log them here with: phase number, one-line symptom, status, fix date.

### Related files

- [src/editor/inspector.js](src/editor/inspector.js) — primary code surface
- [docs/preset-editor/image-layer-effects.md](docs/preset-editor/image-layer-effects.md) — current image-layer reference (update at end of each phase)
- [custom-preset-editor.md](custom-preset-editor.md) — Preset Studio hub doc

---

## 1. The creative vision

Three creative tiers, building up:

**Tier A — Uniform grid** *(today)*
Every cell mathematically identical. One density slider; every cell follows the same rules. Cheap but monotonous.

**Tier B — Procedural per-cell variance**
Every cell hashes its grid index `(col, row)` to produce a per-cell deviation. One slider per axis controls deviation magnitude. Defaults to 0 → existing behaviour preserved. Cheap shader-side; huge visual jump.

**Tier C — Explicit grid layout**
User declares an explicit grid (e.g. 2×4 = 8 cells) instead of a density count. ✅ **Shipped as Grid mode (Phase 3)** — `Cols × Rows`, Fit/Fill, Grid Scale.

> **Historical note:** Tier C was originally specced to go further — a click-a-cell *replicator* (hand-author each cell's size/rotation/opacity, the After Effects / TouchDesigner pattern). That per-cell override editor was **evaluated and cut** 2026-05-16 (§5.8): it is a compositional tool, wrong for a live performance app, and the procedural variance of Tier B already delivers per-cell variety the generative way. Tier C therefore ends at the explicit grid.

**Design principle locked at the top:** every depth-related feature uses a **constrained camera** model — small pan/tilt only, never full rotation. See §10.

---

## 2. Audit of current state

> **Note:** §2 is the *pre-Phase-1 baseline* — it captures the tile pipeline as it was before any phase shipped, and explains the `_cellId` foundation everything builds on. For what's shipped now (Phases 1–3), see the Status Dashboard and §3–§5. The `_cellId` design described here is still the live load-bearing primitive.

### 2.1 Shader math (the tile pipeline)

Tiling lives in the comp shader generated by `_buildImageBlock()` per layer. The relevant helper is `applyTileUV()` at [inspector.js:5979](src/editor/inspector.js#L5979) (line numbers current as of the 2026-05-16 audit):

```
_u.x *= aspect.y;            // un-stretch to square space
_u /= size;                   // density: smaller size → more repetitions
_u.x /= aspect.y;             // re-stretch
_u = fract(_u + 0.5);         // wrap into 0..1 per cell, recentre
```

Every effect downstream of `applyTileUV` operates on the post-`fract` UV. **No per-cell identity exists today** — once a fragment is inside `[0,1]` of its cell, the shader cannot tell which cell it came from.

The foundation for everything below is two lines added *before* `fract`:

```
vec2 _cellId = floor(_u);     // integer grid index, unique per cell
_u = fract(_u + 0.5);
```

`_cellId` is reused across Phases 1, 2, and 3. **Keep this calculation isolated** — a 3D analogue must be able to substitute without ripping out call sites (§10.2).

### 2.2 Existing tile-related controls (the dense layer card)

The image-layer card already has ~40 controls. Tile-related ones:

| Control | What it does | Conflicts with new work? |
|---|---|---|
| Tile toggle | On/off | No — all new work gates behind this |
| Size | Tile density | Phase 3 adds Density/Grid mode toggle alongside |
| Width / Height (`tileScaleX/Y`) | Cell aspect stretch | No |
| Spacing | Uniform gap between cells | No — brick offset is orthogonal |
| Tunnel | Z-axis zoom through grid | Yes — extends per-cell (§5.7) |
| Depth (`depthOffset`) | Per-layer tunnel phase | UI-renamed near new Phase Var to avoid clash |
| Pan (Drift/Bounce) | Whole-grid translation | No — Phase 2 jitter is per-cell |
| Group spin | Rotate whole grid vs each tile | No |
| Mirror scope | Per-Tile / Whole-Image fold | No |

**UX constraint:** the card is at the visual ceiling. New controls live inside a collapsible "Per-Cell" subsection, only when `Tile=on`, defaulting to collapsed once we cross 8+ items.

---

## 3. Phase 1 — Structural per-cell wins

**Goal:** three orthogonal structural changes in one PR.
**Build estimate:** 1 day.

### 3.1 Brick / half-drop offset

Every other row (or column) shifts by a fraction of a tile.

**State:**
- `tileOffsetAxis: 'none' | 'row' | 'col'` (default `'none'`)
- `tileOffsetAmount: 0..1` (default 0; 0.5 = classic brick)

**Shader change** (inside `applyTileUV`, before `fract`):
```
float _row = floor(_u.y);
_u.x += _row * tileOffsetAmount;   // row mode (col mode swaps axes)
```

### 3.2 Per-tile rotation variance

Each cell rotates by a hashed amount.

**State:**
- `tileRotateVariance: 0..1` (default 0)
- `tileRotateSnap: bool` (default false; 90° snap → Truchet look)

**Shader change:**
```
float _cellHash = fract(sin(dot(_cellId, vec2(127.1, 311.7))) * 43758.5);
float _perCellAng = _cellHash * 6.28318 * tileRotateVariance;
if (tileRotateSnap) _perCellAng = floor(_cellHash * 4.0) * 1.5708 * tileRotateVariance;
// add to existing _spinAng
```

### 3.3 Per-tile audio popcorn

Each cell pulses with a different phase. Grid still; cells dance.

**State:**
- `tilePopcornAmount: 0..1` (default 0)

**Shader change:**
```
float _cellPhase = _cellHash * 6.28318;
float _cellBeat = step(0.6, _r + sin(time * 4.0 + _cellPhase) * 0.5);
float _popcornGain = mix(1.0, 1.0 + _r * 2.0, _cellBeat * tilePopcornAmount);
_src *= _popcornGain;
```

### 3.4 Phase 1 UI

Inside the existing tile-gated section:

```
─── Per-Cell ─────────────────────
  Offset    [Off · Row · Col]   ──◯──   0.50
  Rotate    [variance]          ──◯──   0.30   ☐ 90° snap
  Popcorn   [variance]          ──◯──   0.40
```

---

## 4. Phase 2 — Procedural variance suite

**Goal:** complete the procedural per-cell story.
**Build estimate:** 2 days.

### 4.1 Variance sliders

All default to 0. All derive from `_cellHash` with per-axis salt constants for independent random patterns.

| Slider | What it does |
|---|---|
| **Size variance** | Each cell scaled 1 ± (variance × 0.5) |
| **Jitter X / Y** | Each cell offset within its slot |
| **Opacity variance** | Each cell at varying opacity |

Tunnel-related variances live with the Tunnel block (§5.7).

### 4.2 Depth variance — dual behaviour (resolved Q1)

`tileDepthVariance` adapts to Tunnel state:
- **Tunnel ON**: per-cell phase offset (cells at different points in the zoom cycle)
- **Tunnel OFF**: static per-cell Z scale (cells appear at different depths in place)

One slider, behaviour adapts. Never "dead."

UI label: **"Tunnel Phase Var"** when displayed next to Tunnel block, to avoid clashing with existing `Depth` (`depthOffset`) slider.

### 4.3 Seed control

Per-layer (resolved Q5):
- `tileVarianceSeed: int` (0–9999, default 0)
- "🎲 Random" button
- "🔒 Lock" toggle (locked = seed frozen; unlocked = each save bumps it)

Default: seed = 0, locked → deterministic playback for Timeline Editor.

### 4.4 Phase 2 UI

```
─── Per-Cell ─────────────────────
  Offset    [Off · Row · Col]   ──◯──   0.50
  Rotate    [variance]          ──◯──   0.30   ☐ 90° snap
  Popcorn   [variance]          ──◯──   0.40

  ▼ Variance (collapsible, collapsed by default)
    Size      ──◯──   0.00
    Jitter X  ──◯──   0.00
    Jitter Y  ──◯──   0.00
    Opacity   ──◯──   0.00

  Seed   [ 42 ]  [🎲 Random]  [🔒 Lock]
```

Tunnel variances appear inside the Tunnel section, not here (§5.7).

---

## 5. Phase 3 — Explicit grid mode

**Goal:** an explicit `Cols × Rows` grid as an alternative to density-driven tiling.
**Build estimate:** ~2–3 days.

### 5.0 Scope decision — Grid mode only (locked 2026-05-16)

Phase 3 as first specced bundled two features: **Grid mode** (an explicit cell count) and a **per-cell override editor** (picker widget + hand-pinned `tileOverrides` map). They are now split:

- **Phase 3 = Grid mode only.** Bounded (~2–3 days), pure upside, no new UX paradigm.
- **Phase 3.5 = per-cell override editor** — *optional and deferred*; build only if real beta users ask for hand-authored cell control. Full spec preserved at §5.8.

**Rationale.** DiscoCast is a live, audio-reactive VJ tool. The procedural per-cell variance shipped in Phases 1 / 2 / 2.5 — Size / Jitter / Rotate / Opacity / Popcorn, scatter overlap, seed control — *already* delivers per-cell creative variety: infinite, reactive, generative. You move a slider, the system surprises you. The override editor is a *compositional* tool (hand-pin cell 5 large, rotate cell 8): it produces a **static authored layout** that does not react, does not scale past a handful of cells, and is the heaviest footgun surface in the codebase (canvas picker, sparse map, `sliderExclude` dodging, baked `vec4` array). It competes with the procedural system rather than complementing a live tool. Grid mode, by contrast, is a cheap layout primitive that makes the procedural variance *easier* to use — a known, explicit cell count to reason about.

### 5.1 What Grid mode is

A new tile-mode toggle on every tiled image / GIF / text layer:

```
Mode   [ Density · Grid ]
```

- **Density** (current behaviour): the Size slider drives cell count. Default for every new layer — and every existing preset stays here, byte-for-byte unchanged.
- **Grid** (new): explicit `Cols` × `Rows` integer steppers. The cells exactly fill the canvas, once — no density math, no partial cells bleeding off the edge.

Grid mode adds a fit toggle:

```
Fit    [ Fill · Fit ]
```

- **Fill** (default): the image stretches to the cell's shape — matches today's `tileScaleX/Y` behaviour, so switching Density→Grid at Fill is visually continuous.
- **Fit**: the image's aspect ratio is preserved; transparent padding fills any mismatch between image aspect and cell aspect.

**Default grid: 3 × 3** (resolved Q2 — reads instantly as "a grid"; 2×2 reads as a broken tile).

### 5.2 Composition with Phases 1 / 2 / 2.5

Grid mode changes only *how the cell index is derived* — never what happens per cell. Today `_cellId = floor(_u + 0.5)` is produced by density tiling; in Grid mode it is produced by the explicit `Cols × Rows`. Everything downstream is untouched:

- **Offset / Cell Rotate / Popcorn** (Phase 1) — each cell still hashes its own id.
- **Size / Jitter / Opacity / Depth variance** (Phase 2) — same per-cell deviation.
- **Scatter** (Phase 2.5) — jittered tiles still move freely + overlap; the finite grid just needs the 3×3 neighbour scan clamped to grid bounds (see §5.9.1).

`_cellId` remains the single isolated foundation (§2.1) — Grid mode is simply a second way to compute it, and a 3D analogue can substitute later (§10.2).

### 5.3 Grid-mode shader path

Density mode divides by one uniform factor (`_u /= sizeBase`) and `fract`-wraps → an infinite repeat. Grid mode needs two changes:

- **Per-axis divisor** — split the field into exactly `Cols × Rows` cells.
- **Finite mapping** — fragments outside the `Cols × Rows` block are not drawn; the grid fills the canvas once, with no wrap.

This threads through **both** render paths: `applyTileUV` (the `fract` path) and `buildScatterSample` (the scatter path). `_cellId` must be clamped to `0 .. Cols-1` × `0 .. Rows-1`. These are the audit gaps recorded in §5.9.1 — close them as part of the Phase 3 build.

### 5.4 Schema additions

| Field | Default | Notes |
|---|---|---|
| `tileMode` | `'density'` | `'density'` \| `'grid'` |
| `tileCols` | `3` | Grid mode only, integer 1–16 |
| `tileRows` | `3` | Grid mode only, integer 1–16 |
| `tileFit` | `'fill'` | `'fill'` \| `'fit'` |
| `tileGridScale` | `1.0` | Grid mode only — 0.1–3.0; overall grid scale (1 = fills canvas, <1 = centred with margin, >1 = zoom in / edge cells cropped) |

All additive and optional — every read site uses `?? default`, so old presets load identically (no `tileMode` → `'density'`). `schemaVersion` does not bump. Added to the image template, the text template, and `_normalizeImageEntry` (§12.2 checklist).

### 5.5 Grid-mode UI

Inside the existing Tiling section, visible only when `Tile = on`:

```
─── Tiling ───────────────────────
  Tile   [✓]
  Mode   [ Density · Grid ]

   (Grid mode only)
   Cols  [  3  ]
   Rows  [  3  ]
   Scale  ──◯──  1.00
   Fit   [ Fill · Fit ]

  Spacing, Width, Height … (existing controls)
  Per-Cell section (Phase 1 / 2 variance)
  Tunnel section (§5.7)
```

`Cols` / `Rows` are integer steppers (1–16). **Scale** (0.1–3.0) zooms the whole grid: below 1.0 it sits smaller, centred, with transparent margin (need not touch the canvas edges); above 1.0 the grid is larger than the canvas — a zoom-in, with edge cells cropped (great for pushing into a mirrored/kaleidoscope pattern). The Density-mode Size slider is hidden in Grid mode (cell count is explicit; Scale replaces its overall-zoom role). Spacing, the Per-Cell variance section, and the Tunnel section all stay live in both modes.

### 5.6 Resolved decisions for the Phase 3 build

- **Grid mode vs Width / Height (`tileScaleX/Y`)** → **hidden in Grid mode** (locked 2026-05-16). The grid UV path ignores `tileScaleX/Y`; the sliders are hidden when `tileMode = 'grid'`. The stored values persist (dormant) so switching back to Density restores them. Rationale: in Grid mode the **Cols:Rows ratio is the cell-shape control** (6×2 = wide cells, 2×6 = tall) — Width/Height only exist because Density mode has no explicit count to derive shape from. Each mode then tells one clear aspect story: Density = Size + Width/Height; Grid = Cols/Rows + Fit/Fill.
- **Grid + Tunnel** → **Grid mode is inert when Tunnel is active** (locked 2026-05-16). Tunnel needs an infinite repeat to zoom through; a finite grid that fills the canvas once cannot tunnel. With `tunnelSpeed ≠ 0` the layer stays density-tiled and the Grid toggle has no effect. Documented limitation — keeps Phase 3 bounded.
- **`_cellId` clamp + scatter bounds** — not optional; the §5.9.1 audit items are mandatory parts of the Phase 3 build.

### 5.7 Tile Tunnel extensions

The existing Tunnel system was designed for Tier A. For Tier B/C it's insufficient — Tunnel is the most-loved visual axis, and per-cell control unlocks parallax depth fields and shockwaves.

**Extensions** (gated by `Tile=on` AND `tunnelSpeed != 0`):

| Control | What it does | Phase |
|---|---|---|
| **Tunnel Phase Var** (0–1) | Per-cell phase in cycle (the dual-behaviour from §4.2) | ✅ 2 (shipped) |
| **Speed Var** (0–1) | Each cell zooms at `tunnelSpeed * (1 + hash * variance)` | 3.2 |
| **Direction Var** (0–1) | Probability each cell flips zoom direction | 3.2 |
| **Cascade Mode** [Off · Radial · Linear] | Tunnel wave radiates from a centre cell on beat | 3.5 |
| **Cascade Centre** (cell picker) | Origin cell for radial wave | 3.5 |

Speed/Direction Var are the deferred Phase 2 differentials — now Phase 3.2 (§5.9.2). Cascade needs the cell picker, so it ships with the optional per-cell editor (Phase 3.5, §5.8).

### 5.8 Phase 3.5 — Per-cell override editor — ❌ CUT (2026-05-16)

**Decision: cut, do not build.** A click-a-cell picker for hand-authoring individual cells (size/rotation/opacity per cell, sparse `tileOverrides` map, vec4 bake, "Randomize all") was specced here. It is **removed from the roadmap**:

- It is a *compositional* tool (hand-place each cell) bolted onto a *live performance* tool — clicking through dozens of cells one at a time is the opposite of how this app is used.
- The procedural variance shipped in Phases 1/2/2.5 (Size/Jitter/Rotate/Opacity Var + Seed) already delivers per-cell variety the fast, generative way it should be delivered.
- It was the single heaviest, most bloat-prone item on the roadmap.

**Do not re-propose** without a concrete, repeated user request for hand-authored cell layouts. The schema fields it would have used (`tileOverrides`, `tileCascadeMode`, `tileCascadeCentre`) are **not implemented** — see §7.1. Cascade (a beat-driven tunnel wave) went with it; if ever revived it belongs in a tunnel phase, not a per-cell editor.

---

## 5.9 Phase 2.5 scatter — composition with Phase 3, and the deferred differentials

Phase 2.5 shipped the **scatter renderer** (`buildScatterSample`) after the original §5 spec was written. This section records the audit findings the Phase 3 build must close, and the deferred items now scheduled as **Phase 3.2 / 3.3**.

### 5.9.1 Audit findings — spec gaps the Phase 3 build must close

Code audit 2026-05-16 against the live `inspector.js`. Three real gaps in the §5 spec:

1. **Grid-mode UV path.** Density mode uses a single uniform divisor `_u /= sizeBase`. Grid mode needs a per-axis `Cols`/`Rows` divisor with a *finite, non-repeating* mapping (cells fill the canvas once — no `fract` wrap). It must thread through **both** `applyTileUV` and `buildScatterSample`.
2. **`_cellId` range clamp.** In a finite grid, `_cellId` must be clamped to `0..Cols-1` × `0..Rows-1` — both to keep per-cell hashing stable at the edges and (for Phase 3.5) so the override-array index `int(_cellId.y)*COLS + int(_cellId.x)` never reads out of range.
3. **Scatter × Grid interaction.** `buildScatterSample` scans an *infinite* 3×3 neighbour block; Grid mode is *finite*. With jitter on in Grid mode the scan references cells outside `[0,COLS)×[0,ROWS)`. The build must clamp the neighbour scan to grid bounds.

One decision to lock before the Phase 3 build: Grid mode vs `tileScaleX/Y` (Width/Height) — coexist or hide (§5.6). And a standing note for *if* Phase 3.5 is built — its per-cell picker sliders must use a class **outside** the `sliderExclude` positional chain (the #1 codebase footgun, §12.4).

### 5.9.2 Phase 3.2 — Tunnel ↔ Scatter convergence

Bundles the two tunnel-coupled differentials, which share one prerequisite — restructuring the tunnel crossfade so per-cell zoom factors can be computed inside `applyTileUV` / the scatter loop:

- **Free-jitter in tunnel mode** — scatter currently gates off when `hasTunnel` (`useScatter` excludes tunnel). Tunnel jitter still uses the old object-space clamp, so it crops. Converging the two renderers lets jittered tiles move freely + overlap inside the tunnel too.
- **Speed Var + Direction Var** (the Phase 2 deferral, §5.7) — per-cell `_tz` (tunnel zoom factor): each cell zooms at its own speed / can flip direction. Currently `_tz1`/`_tz2` are baked as pre-computed GLSL string expressions before the call; per-cell values require the crossfade restructured.

### 5.9.3 Phase 3.3 — Scatter-mode FX parity

In scatter mode the texture-resample effects — **chromatic aberration, blur, Sobel/edge, wave distort, pixelate** — are disabled (`&& !useScatter`), because they assume a single post-`fract` `_u` that scatter doesn't produce. Phase 3.3 moves these inside the scatter loop so they compose per-neighbour. Lower priority — these are exotic effect combinations.

---

## 6. Phase ordering & dependencies

```
Phase 1 ─► 2 ─► 2.5 ─► 3 ─► 4 ─► 5          ⬇ backlog: 3.2, 3.3
(struct)  (var)(scatter)(grid)(recurse)(2.5D)   ❌ cut: 3.5
 ✅       ✅   ✅       ✅   next    deferred
```

Phases 1–3 ✅ shipped. **Phase 4 (recursive grids) is next** — it builds straight on the Grid foundation. Phase 3.2 / 3.3 are ⬇ backlog (edge-case gap-filling; §5.9). Phase 3.5 ❌ cut (§5.8). Each phase ships value standalone. `_cellId` from Phase 1 carries forward through every later phase — including a future 3D analogue (§10.2) — no throwaway work.

**Likely release split:** Phases 1 / 2 / 2.5 / 3 are in the current build. Phase 4 / 5 post-first-release.

---

## 7. Backward compatibility & schema

All new fields default to off / 0 / `'none'`. Existing presets re-hydrate with these absent → reads as defaults → identical visual output.

### 7.1 Schema additions (all additive, all optional)

| Phase | Field | Default |
|---|---|---|
| 1 | `tileOffsetAxis` | `'none'` |
| 1 | `tileOffsetAmount` | `0` |
| 1 | `tileRotateVariance` | `0` |
| 1 | `tileRotateSnap` | `false` |
| 1 | `tilePopcornAmount` | `0` |
| 2 | `tileSizeVariance` | `0` |
| 2 | `tileDepthVariance` | `0` *(UI: "Phase Var" in Tunnel section)* |
| 2 | `tileJitterX` | `0` |
| 2 | `tileJitterY` | `0` |
| 2 | `tileOpacityVariance` | `0` |
| 2 | `tileVarianceSeed` | `0` |
| 2 | `tileVarianceSeedLocked` | `true` |
| 3 | `tileMode` | `'density'` |
| 3 | `tileCols` | `3` |
| 3 | `tileRows` | `3` |
| 3 | `tileFit` | `'fill'` |
| 3 | `tileGridScale` | `1.0` |
| 3.2 ⬇ | `tileTunnelSpeedVariance` | `0` *(backlog — not implemented; needs tunnel crossfade restructure; §5.9.2)* |
| 3.2 ⬇ | `tileTunnelDirectionVariance` | `0` *(backlog — not implemented; §5.9.2)* |
| ~~3.5~~ ❌ | ~~`tileOverrides` / `tileCascadeMode` / `tileCascadeCentre`~~ | **cut — not implemented** (§5.8) |
| 5 | `parallaxDepth` | `0` |
| 5 | `parallaxAmount` | `0` |

`schemaVersion` does **not** need to bump — every read site uses `?? default`.

### 7.2 Locked conventions (for forward-compat with 3D / recursive)

- **Override-map keys**: comma-separated coordinate strings (`"col,row"` today; future `"col,row,depth"` or `"col,row,subCol,subRow"`)
- **Cell-index computation**: isolated in one helper — a 3D analogue can substitute without ripping out call sites
- **Variance slider semantics**: 0 = identical to baseline; 1 = full deviation. Applies to all variance sliders, 2D today and 3D later

---

## 8. Out of scope for this thread

Separate future docs:
- Hexagonal / honeycomb tiling
- Polar / radial tiling
- Multi-image tile deck (single layer holds N images)
- Aperiodic / Wang tiles
- Beat shuffle (cells swap per beat)

---

## 9. Open questions — resolved (locked 2026-05-15)

**Q1. Depth variance — Tunnel-gated or standalone?** → **Both.** Slider behaviour adapts to Tunnel state. Never dead. §4.2.

**Q2. Phase 3 default grid count?** → **3 × 3.** Better first-impression than 2×2. §5.1.

**Q3. Override map vs per-cell layers?** → moot — the per-cell override editor (Phase 3.5) was ❌ cut 2026-05-16 (§5.8). The procedural variance suite covers per-cell variety.

**Q4. Drag-across multi-select in picker?** → moot — picker cut with Phase 3.5 (§5.8).

**Q5. Seed scope?** → **Per-layer.** Each layer has independent randomness. §4.3.

---

## 10. Future awareness — constrained camera, 3D layers, recursive grids, 2.5D parallax

**Nothing in §10 is being built now.** This section captures forward-planning so Phases 1–3 don't paint us into a corner.

### 10.1 Constrained camera — the design principle for any future depth work

When depth-related features ship (3D layers OR 2.5D parallax OR anything in between), they use a **constrained camera** model: never full rotation, never flying behind objects. The user moves a virtual camera left/right and up/down a little. The exact freedom depends on the layer type — see the 2D-vs-3D split below.

Why this is the right call, both creatively and technically:

| Reason | What it means |
|---|---|
| **VJs aren't camera operators during shows** | Full orbit controls = 6 sliders nobody touches |
| **Composition is sacred** | You set up a frame; you don't want it spun around mid-set |
| **Parallax sells depth** | A 50px camera shift on a bassline feels more 3D than a 360° orbit, because human perception reads parallax as depth long before rotation |
| **Performance shortcuts** | No backface concerns, no complex depth sort, no occlusion edge cases |

**2D vs 3D — the camera split (resolved 2026-05-17):**

- **2D layers (Phase 5 parallax) — pan only.** A flat card has no geometry; a camera *tilt* would force per-layer billboard-or-shear math and muddy the look. Pure XY translation is both cheaper (a `vec2` UV offset — no matrix, no new geometry, trivial CPU + GPU) and cleaner. Phase 5 exposes **XY pan only**.
- **3D object layers — pan + small tilt.** A tilt is effectively free on a real mesh (the GPU vertex shader handles it) and the geometry catches light correctly, so a small tilt is a genuine *extra* depth cue rather than a cost. Still never a full orbit.

This principle constrains both the eventual 3D layer system *and* the near-term 2.5D parallax phase (§10.5).

### 10.2 3D layers — what carries forward, what diverges

When 3D model layers ship (loading .glb / .obj, rendered via WebGL with depth + lighting):

**Carries forward (already designed for it):**
- Per-cell variance vocabulary — "Rotate variance" works for 2D rotation today, 3D rotation axes later
- Override map key convention — comma-separated keys extend cleanly
- Picker widget UX — single-click cell-to-edit translates directly
- Variance slider semantics
- Seed + lock concept
- Constrained-camera principle (§10.1)

**Diverges (separate doc when 3D ships):**
- Rendering pipeline (shader-comp for 2D, full WebGL pass for 3D)
- Lighting, depth buffer, camera transforms (pan + small tilt — §10.1)
- Mesh loading + asset storage

**Resolved 2026-05-17 — the volumetric grid is 3D-object-only.** A true X×Y×Z grid of cells (e.g. 6×6×6 = 216) is a natural three.js feature — `InstancedMesh` on a 3D lattice, one draw call — but it belongs to the **3D object layer, not the 2D tile system**. The 2D tile grid (Phases 1–4) stops at recursion (§13); 2D image/GIF/text layers get their sense of depth from Phase 5's pan parallax, **never** from a volumetric grid. Rationale: a flat billboard in a volumetric grid cannot rotate convincingly — it either auto-faces the camera (no rotation cue, looks pasted-on) or goes edge-on to a sliver. Real per-cell rotation needs geometry. So: **pan parallax = the 2D depth story; volumetric grid + rotation = the 3D depth story.** Don't build a 3D grid for 2D layers — it would just be Phase 5 with worse rotation. The per-cell *vocabulary* (variance, seed, recursive subdivide, Cols×Rows×Depth steppers) ports cleanly to the 3D grid; the *code* does not — different pipeline.

### 10.3 Recursive / nested grids — Phase 4 placeholder

Pure 2D feature. Works on any image / GIF layer — no 3D needed.

A 3×3 outer grid where each cell itself contains a 2×2 inner grid = 36 effective cells. Shader sketch:

```
vec2 _outerId = floor(_u);
vec2 _outerUV = fract(_u);
vec2 _innerId = floor(_outerUV * vec2(innerCols, innerRows));
vec2 _innerUV = fract(_outerUV * vec2(innerCols, innerRows));
// override map key becomes "outerCol,outerRow,innerCol,innerRow"
```

Combined with the constrained-camera parallax (§10.5), small camera pans reveal the recursive structure as depth — without ever moving behind anything.

**Status:** Phase 4 — **full buildable spec now at §13** (this §10.3 sketch is superseded). The key-convention lock in §7.2 keeps it possible. Might land before 3D layers if 3D takes longer.

### 10.4 Things to NOT do now

- Don't design the 3D rendering pipeline. Separate doc.
- Don't add 3D-specific fields to the schema before 3D layers exist.
- Don't try to make `_cellId` work for both 2D and 3D simultaneously — clean 2D version now, mirror the pattern for 3D when it ships.

### 10.5 Phase 5 — 2.5D parallax camera (pure 2D)

**Status:** ⏸ **Built 2026-05-17, reverted the same day.** The §10.5 design below was implemented (single per-layer `parallaxDepth` + a global Camera section) and reverted on user feedback — it was a mess to use. **Failure analysis (read before any retry):**

1. **Two-place setup with an invisible dependency.** Nothing happens unless the user sets BOTH a per-layer `parallaxDepth` slider AND moves the global camera. Either alone = no effect, with zero feedback explaining why. The global Camera section sits there looking broken.
2. **Parallax is meaningless with < 2 layers.** It is relative motion between depth-staggered layers; most presets have 1–2 layers, and a single layer just "drifts" — which Wander/Pan already do.
3. **Dead weight otherwise.** The Camera section occupies the Layers tab looking inert for every preset that doesn't opt in (i.e. nearly all).

The §10.5 UI/UX section *predicted* problems 1 and 3 and the build proceeded anyway, betting a default drift would mask them. It didn't. **Do not rebuild from this spec as-is** — it needs a genuinely different interaction model (one place, self-demonstrating) or it should stay cut. The schema/shader approach (baked `_camPos`, no uniform, gated → zero regression) was sound; the *UX* was the failure.

A near-term depth phase that pairs with recursive grids and ships *before* any real 3D layer system.

**Concept:** **every 2D texture layer — image, GIF, video, and text** — gets `parallaxDepth` (0 = front, 1 = far back) and `parallaxAmount` (how much it responds to camera). The parallax is a `vec2` UV offset in the comp shader (`cameraPos * depth * parallax`), so it is layer-type-agnostic — all four types run through the same per-layer pipeline. Result: layers shift at different rates as the camera pans → felt depth without rotation. Wire the two fields to **every** entry in `currentState.images[]`, not just `type === 'image'`.

**The future 3D layer opts out.** A 3D object layer renders with its own real camera; you would not UV-shift its flat output. When 3D ships, the global Camera section drives the 3D layer's *actual* camera in sync — same camera input, different mechanism (3D-doc territory, not Phase 5).

**Controls (per layer):**
- `parallaxDepth: 0..1` (slider, default 0)
- `parallaxAmount: 0..1` (slider, default 0)

**Camera controls (per preset — new global section):**
- Camera XY pad (manual pan, similar to existing Centre pad)
- Audio-reactive camera bob amplitude (bass-driven small parallax)
- Auto-pan drift speed (slow Ken Burns)

Combined with recursive grids: small camera pans reveal the nested-grid structure as depth. The full creative payoff of "3D" without the 3D pipeline cost.

**UI / UX — the parts that bite during the build.** Phase 5 is two features at two scopes, with three traps:

1. **Naming collision — do NOT call it "Pan."** Image layers already have a per-layer **Pan** control (Off / Drift / Bounce — the layer's *content* scrolls). The Phase 5 camera is a different scope entirely (the *viewpoint* moves; layers parallax by depth). Two things called "pan" is a guaranteed support question. Name the camera feature **Camera**, **Viewpoint**, or **Parallax** — leave the existing layer Pan untouched.

2. **Two scopes → two homes.**
   - *Per-layer* — `parallaxDepth` + `parallaxAmount`, 2 sliders. The layer card is already at its visual ceiling (§2.2). They need one tight "Depth" row inside the existing Motion section, not loose extra rows.
   - *Per-preset* — the camera itself (XY pad, bass bob, auto-drift). This is **not** a layer control. It needs a new global section, peer to Palette / Motion / Wave / Images.

3. **The dead-slider trap.** `parallaxDepth` produces *nothing visible* until the camera moves. A user drags it, sees nothing, reports it broken. Mitigation: **ship the camera with a gentle auto-drift on by default** (small non-zero Auto-Drift), so depth is always slightly in motion and the depth sliders show their effect the instant they're touched.

**Composition note (dev docs, not a tooltip — per `feedback_slider_discovery_ux`):** camera parallax is a final per-layer UV offset applied *after* all object motion (Spin / Orbit / Wander / Sway / Tunnel) — so nothing conflicts; a spinning, wandering layer simply parallax-shifts as a unit. But stack parallax on top of five layers all already wandering and the depth cue gets lost in the noise — the feature reads best on calmer compositions.

**Build estimate:** ~3 days for layer-side fields + ~2 days for the camera controls. Could be split across two PRs.

---

## 11. Build order summary

1. **Phase 1** — `_cellId` + brick offset + rotation variance + popcorn (1 day) ✅
2. **Phase 2** — Variance suite + per-layer seed (1 day) ✅
3. **Phase 2.5** — Scatter sampling — free jitter + tile overlap (1 day) ✅
4. **Phase 3** — Explicit Grid mode: Density/Grid toggle + Cols×Rows + Fit/Fill + Grid Scale (1 day) ✅
5. **Phase 4** — Recursive / nested grids — **next**; builds on the Grid foundation. Full spec: §13
6. **Phase 5** — 2.5D parallax camera (deferred; pairs with Phase 4)
7. **⬇ Backlog** — Phase 3.2 (tunnel ↔ scatter convergence; Speed/Direction Var) · Phase 3.3 (scatter-mode FX parity). Gap-filling for edge-case combos — low value-per-risk; §5.9
8. **❌ Cut** — Phase 3.5 (per-cell override editor) — too compositional for a live tool; §5.8
9. **Out-of-thread future** — 3D layers, hex / polar topology, multi-image deck, beat shuffle

---

## 12. Code Audit — handoff reference

This section is for the developer implementing any phase, including a future contributor joining cold.

### 12.1 Files & primary call sites

| Concern | File | Line | Notes |
|---|---|---|---|
| Comp shader builder (per-layer) | [src/editor/inspector.js](src/editor/inspector.js) | `_buildCompShader` 5564 | Rebuilds shader from `currentState`. Called on every change to images/sat/hue/solidColor/sceneMirror/paletteOpacity |
| Image block builder | [src/editor/inspector.js](src/editor/inspector.js) | `_buildImageBlock` 5695 | The big function — generates GLSL per layer. All new Phase 1–3 shader code goes here |
| Tile UV helper (density `fract` path) | [src/editor/inspector.js](src/editor/inspector.js) | `applyTileUV` 5979 | Where `_cellId = floor(_u + 0.5)` lands. Modifies one `_u` in place |
| Scatter renderer (Phase 2.5) | [src/editor/inspector.js](src/editor/inspector.js) | `buildScatterSample` 6191 | 3×3 neighbour-accumulation loop; owns its texture sample. Grid mode (Phase 3) must compose with this — §5.9.1 |
| Image layer defaults (new layer) | [src/editor/inspector.js](src/editor/inspector.js) | image template ~2370–2395 | Add every new tile field here. Text template ~2855–2877 needs the same fields |
| Default normalizer (old preset compat) | [src/editor/inspector.js](src/editor/inspector.js) | `_normalizeImageEntry` 6800 | **CRITICAL**: add every new field to default dict here |
| Generic slider handler | [src/editor/inspector.js](src/editor/inspector.js) | `sliderExclude` 4112 | **CRITICAL**: every new `.layer-slider-row` slider class MUST be added to this `:not()` chain. The Phase 3.5 per-cell picker sliders must instead use a class OUTSIDE this chain |
| Layer card render + event bindings | [src/editor/inspector.js](src/editor/inspector.js) | `_mountLayerCard` 2901 | One method — builds the card HTML template literal AND wires all bindings (~2901–5369). New control rows + listeners go here. (The old `_layerCardHtml`/`_bindLayerCard` split never existed.) |
| Save (custom preset) | [src/editor/inspector.js](src/editor/inspector.js) | `saveCurrent` 6763 | Auto-serializes `currentState` — new fields (incl. plain-object maps like `tileOverrides`) work automatically as long as they live in `currentState` |
| Load (custom preset) | [src/editor/inspector.js](src/editor/inspector.js) | `loadPresetData` 6890 | Restores `currentState`. Calls `_normalizeImageEntry` per image; relies on it for backwards compat |
| Undo / redo | [src/editor/inspector.js](src/editor/inspector.js) | `_snap` 1377 · `_postSnap` 1380 · `_undo` 1402 | Snapshots via `deepClone` (JSON round-trip) — nested objects clone safely. 50-deep |
| Preset export (bundle) | [src/customPresets.js](src/customPresets.js) | `exportPreset` 236 | Serialises + inlines images as base64. Should "just work" for new fields |
| Preset import | [src/customPresets.js](src/customPresets.js) | `importPreset` 264 | Re-hydrates. Normalisation happens at load via `_normalizeImageEntry` |

### 12.2 Mandatory checklist for every new field

For each field added to `currentState.images[i]` (line numbers current as of the 2026-05-16 audit — see §12.1; they drift, re-grep if stale):

1. ☐ Default value added to the new-image template (~line 2370–2400) **and** the text template (~2855–2890) — both, or text layers break
2. ☐ Default value added to `_normalizeImageEntry` (~line 6800) — **omitting this breaks old presets with `.toFixed() of undefined`**
3. ☐ HTML control row added inside `_mountLayerCard` (the card template literal, ~2901–3500)
4. ☐ Event listener wired in `_mountLayerCard` (the bindings half, ~3800–5360)
5. ☐ If it's a `.layer-slider-row` `input[type=range]`, class added to `sliderExclude` (~line 4112) — **omitting this index-shifts every other slider on the card** (logged incident; see memory `feedback_image_layer_slider_pattern`). Non-range inputs (`type="number"`, segmented `.lseg` buttons) are exempt — the positional handler only sees range sliders.
6. ☐ Handler triggers a render rebuild via `refresh()` (the debounced `_buildCompShader`); undo snapshots through the card's `_snap` / `_postSnap` mechanism (most card sliders snapshot on pointerup)
7. ☐ Save/load round-trip verified (open preset, edit field, save, reload, value persists)
8. ☐ Old-preset compatibility verified (load a pre-feature preset, no console errors)
9. ☐ Export/import round-trip verified (export to JSON, re-import on a fresh browser, field intact)

### 12.3 Performance considerations

`_buildCompShader()` is invoked on every state change that affects images. It does a string-concat shader rebuild then a WebGL link. Current cost: ~5–15ms on a mid-range laptop with 3 image layers. Not a bottleneck today.

**Phase 1–2:** add a few `if (hasX)` GLSL emission paths — same shape as existing 30+ `hasX` flags. No new perf concerns.

**Phase 3:** baking the override `vec4` array adds N×16 bytes of shader uniform per grid. At 64 cells = 1KB. Trivial.

**Phase 4 (recursive grids):** could push past 100 effective cells. Watch for shader-uniform size limits (most GPUs cap at 4096 vec4 uniforms — we're nowhere close, but check).

**Per user direction:** performance optimization is a **manage-at-beta concern, not now.** The app already has HD-toggle settings for images, GIFs, and videos to constrain memory; we trust those guardrails for now. Don't bake perf compromises into the Phase 1–3 design.

### 12.4 Risk areas / footguns

1. **`sliderExclude` index-shifting** — the most common bug in this codebase. The generic handler at [inspector.js:3896](src/editor/inspector.js#L3896) iterates `.layer-slider-row input[type=range]` and indexes them positionally into `sliderKeys`. If you add a new slider without excluding it, every slider after it on the card gets the wrong key. Symptom: tweaking one slider mutates a different field. See memory `feedback_image_layer_slider_pattern.md`.

2. **`_normalizeImageEntry` omissions** — old presets saved before the field existed won't have it. `.toFixed()` on undefined throws. Symptom: opening an old preset crashes the editor. Always update the default dict.

3. **Undo missing `_pushUndoBefore`** — handlers that mutate state without snapshotting cause undo to skip past the change. Symptom: user undoes, expects to see prior value, sees something else entirely.

4. **`_buildCompShader` not called** — handlers that mutate render-relevant state without rebuilding the shader cause visual drift. Symptom: change a slider, nothing happens; tweak something else, the missed change suddenly appears.

5. **`solidColor` parallel persistence** — see [inspector.js:6241](src/editor/inspector.js#L6241) and memory `project_solidcolor_persistence.md`. Instance vars not in `currentState` must be manually round-tripped in saveCurrent / loadPresetData. None of the planned tile fields are instance vars — they all live in `currentState.images[i]` — but if you're tempted to use an instance var, don't.

6. **Tunnel + tile interaction** — the existing tunnel shader path at [inspector.js:5797](src/editor/inspector.js#L5797) crossfades two zoom layers (`_uA`, `_uB`). When Phase 2 adds tunnel-speed variance, both `_uA` and `_uB` paths need it. Easy to miss one.

### 12.5 Dev workflow

```bash
npm run dev:safe       # always use this — kills zombie processes + clears stale cache
# → http://localhost:5173/editor.html
```

See [README.md](README.md) §Dev Server Troubleshooting. `npm run dev` alone is unsafe after an unclean shutdown.

For each phase:
1. Branch from `main`
2. Implement against `_buildImageBlock` + UI render + bindings
3. Test against bundled MilkDrop presets + at least one custom preset
4. Test old-preset compat (load pre-feature preset → should be visually unchanged)
5. Test save / load / export / import round-trip
6. Open browser console — should be zero errors at every step
7. Update [docs/preset-editor/image-layer-effects.md](docs/preset-editor/image-layer-effects.md) with the new fields when shipped
8. Update this doc's Phase section status (mark shipped + date)

### 12.6 What this doc deliberately does NOT spec

- **CSS/styling for new controls** — follow the existing `.layer-slider-row` / `.layer-row-inline` / `.lseg` patterns. Same look applies.
- **Tooltip text** — write per-control during implementation, not in this doc.
- **Exact slider min/max/step** — left to implementer; the variance sliders follow the 0–1 convention, but UI feel may suggest tweaks.
- **Phase 4–5 detailed design** — placeholders only. Full design happens when those phases are scheduled.

### 12.7 Consolidation audit — Phases 1–3 (2026-05-16)

Code review of all tile work shipped today, run as the pre-Phase-4 hardening pass. **No bugs found.** `node --check` clean; user verified save / cross-browser export / old-preset + old-tile-preset load with zero console errors.

**Verified clean:**
- **Field completeness** — all 12 Phase 2/3 fields present in the image template, the text template, and `_normalizeImageEntry`. Old presets re-hydrate to defaults (`tileMode → 'density'`) → identical output.
- **`sliderExclude` integrity** — `layer-gridscale-sl` and every Phase 2 variance slider are in the `:not()` chain. Grid `Cols`/`Rows` are `type="number"` (not `input[type=range]`) so the positional slider handler never sees them — no index-shift risk.
- **GLSL scoping** — the Grid branch declares `_gu` / `_dx` / `_dy` / `_cellId` at the helper's emit scope so the caller's `sampleLine` can use them; `useGrid` is false under Tunnel, so the Grid branch never co-exists with the tunnel path's two `applyTileUV` calls — no double-declaration.
- **Backward compatibility** — `useGrid` and `pulseFactor` both no-op at defaults (density mode, Pulse 0 → factor `1.0`).
- **Safety guards** — grid divisor clamped `max(gridScale·pulseFactor, 0.05)` (no div-by-zero from inverted Pulse); `_cellId` clamped to grid bounds; the scatter neighbour scan drops out-of-grid cells.
- **`_cellId` is still the single isolated cell-identity primitive** — computed two ways (density `floor`, grid `floor(_gu)`), both clamped, both feeding the same per-cell hash vocabulary. This is the clean substitution point a future 3D analogue needs (§10.2).

**Fixed during the audit:**
- **Per-cell rotation aspect in Grid mode** — the rotation block aspect-corrected with `aspect.y` (canvas AR), so on a non-square grid (e.g. 6×2) Cell Rotate visibly *sheared* tiles as they turned. Fixed: `cellAspectExpr` = `aspect.y × Rows/Cols` in Grid mode, plain `aspect.y` otherwise — applied in both `applyTileUV` and `buildScatterSample` rotation blocks. Byte-identical output in density/tunnel; correct rigid rotation in Grid.

**Minor / accepted (noted, not worth fixing):**
1. **Fit-mode mip derivatives** — `_dx`/`_dy` captured from `_gu` before the Fit aspect-scale, so mip selection inside fitted cells is slightly off. Genuinely invisible (Fit padding is masked, scale is mild) — left as-is; the fix adds fiddly gradient code for zero visible gain.
2. **Performance** — scatter is 9× `textureGrad` per fragment; grid + scatter + variance stack. Inherent to the neighbour-accumulation design, not a bug. Fine per the manage-at-beta stance (§12.3) — worth a spot-check with multiple grid+scatter layers before 1.0.
3. **Tunnel + Grid** — Grid is inert under Tunnel by design (§5.6); the Mode toggle still shows "Grid" active while Tunnel overrides it — a tiny UX wart, accepted (a live fix needs the toggle wired to the tunnel slider — disproportionate plumbing).

**Verdict:** Phases 1–3 are a solid foundation. Cleared to build Phase 4 (recursive grids) on top.

---

## 13. Phase 4 — Recursive grids (full spec)

**Status:** ✅ Shipped 2026-05-17 — verified in browser + DMG build. Spec below was built as written; the §13.7 open decision was taken as recommended (outer gap ignored in scatter mode for v1).

**Goal:** one level of nesting on a Grid-mode layer — each outer cell holds an inner sub-grid — so a single layer reads as a grid-within-a-grid.
**Build estimate:** ~1–2 days.
**Prerequisite:** Phase 3 Grid mode (✅ shipped). Recursion is **Grid-mode only** — Density mode has no explicit outer count to nest within.
**Reality check before starting:** the tile system is already a complete, shippable feature set at Phase 3. Phase 4 is genuine polish, **not a beta blocker** — if beta timing is tight it can ship post-1.0. Build it because the nested look is wanted, not because the roadmap lists it.

### 13.1 The critical design insight — read this first

A *uniform* S×S subdivision with no per-level treatment is **mathematically identical to a flat `Cols·S × Rows·S` grid**. The combined cell index and final UV both collapse:

```
_cellId = _outerId·S + _innerId   ≡   floor(_gu·S)
_u      = fract(fract(_gu)·S)     ≡   fract(_gu·S)
```

So "subdivide each cell into 2×2" *and nothing else* = exactly what typing `6×6` into Cols/Rows already gives. **That is not a feature.** Phase 4 only earns a phase if it adds something a flat grid cannot do — a **per-level treatment**. The minimum that does: an **outer-level gap**.

### 13.2 What makes it a real feature — the outer gap

`tileOuterGap` puts space *between the outer cells*. The inner sub-grid fills only the non-gap region of each outer cell, so the inner tiles read as **clusters** separated by wide channels — a look a flat grid genuinely cannot produce (its one `spacing` gap is uniform across every cell).

Recursion then gives **two independent gap scales**:
- `spacing` (existing) — gap between inner tiles, *within* a cluster
- `tileOuterGap` (new) — gap *between* clusters

```
flat 6×6          recursive 3×3 of 2×2, outerGap > 0
■■■■■■            ■■  ■■  ■■
■■■■■■            ■■  ■■  ■■
■■■■■■
■■■■■■            ■■  ■■  ■■
■■■■■■            ■■  ■■  ■■
■■■■■■
                  ■■  ■■  ■■
                  ■■  ■■  ■■
```

### 13.3 Schema additions

| Field | Default | Notes |
|---|---|---|
| `tileSubdivide` | `1` | integer 1–6; `1` = off (plain Grid). Each Grid cell → S×S inner cells |
| `tileOuterGap` | `0` | 0–0.5; gap between outer cells. At `0`, recursion collapses to a flat grid (§13.1) |

Both Grid-mode only, additive, default = no-op → old presets unaffected. Add to image template, text template, `_normalizeImageEntry` (§12.2 checklist).

### 13.4 Shader — `applyTileUV` Grid path

Slots into the existing `useGrid` branch, right after `_gu` is computed, replacing the current `_cellId` / `_u` lines:

```glsl
vec2 _outerId = floor(_gu);
vec2 _outerUV = fract(_gu);
// outer gap — mask the outer-cell border, rescale the inner region to fill
{ float _og = tileOuterGap * 0.5;
  _gapMask *= step(_og,_outerUV.x)*step(_og,1.0-_outerUV.x)
            * step(_og,_outerUV.y)*step(_og,1.0-_outerUV.y);
  if (1.0-2.0*_og > 0.001) _outerUV = clamp((_outerUV-_og)/(1.0-2.0*_og),0.0,1.0); }
// subdivide
vec2 _innerGu = _outerUV * S;                        // S = float(tileSubdivide)
_cellId = clamp(_outerId, 0, Cols-1/Rows-1) * S + floor(_innerGu);
_u      = fract(_innerGu);
```

`_cellId` is the **combined fine-grid index** — unique per effective cell. Every per-cell effect (rotation, popcorn, Size/Jitter/Opacity/Depth variance) already hashes `_cellId`, so all of them vary across every effective cell **for free**. Recursion, exactly like Grid mode itself, is just "another way to compute `_cellId`" (§2.1, §10.2 — keeps the future 3D-analogue substitution clean).

When `tileSubdivide = 1`: `S = 1`, `_innerGu = _outerUV`, `_cellId = _outerId` → byte-identical to current Grid mode. Fit mode and the `cellAspectExpr` rotation correction are unaffected — an S×S subdivision preserves the outer cell's aspect, so the inner cell AR equals the outer cell AR.

### 13.5 Scatter interaction (jitter on)

`buildScatterSample` v1: scatter + recursion → treat it as a **flat fine grid** `Cols·S × Rows·S` (multiply the grid-setup `vec2(Cols,Rows)` by `S`). `tileOuterGap` is **ignored when jitter is active** — documented limitation, same spirit as Grid+Tunnel (§5.6). Jitter already moves tiles freely past cell edges, so the cluster channels would be visually swamped anyway; the flat-fine-grid behaviour is correct enough.

### 13.6 UI

Two controls in the Grid section of `_mountLayerCard` (visible only when `Mode = Grid`, class `.layer-grid-row`):

```
   (Grid mode only)
   Cols  [ 3 ]   Rows  [ 3 ]
   Subdivide  [ 1 ]            ← integer stepper, modelled on Cols/Rows
   Outer Gap  ──◯──  0.00      ← slider
   Scale  ──◯──  1.00
   Fit   [ Fill · Fit ]
```

`Subdivide` is a `type="number"` stepper → exempt from `sliderExclude`. **`Outer Gap` is a `.layer-slider-row` range slider → it MUST be added to `sliderExclude`** (the §12.4 #1 footgun — the most common bug in this codebase).

### 13.7 Open decision — lock at build start

Only one: does `tileOuterGap` apply in scatter mode, or is the flat-fine-grid fallback (§13.5) accepted for v1? **Recommendation: fallback for v1** — keeps the build near ~1 day; revisit on demand.

### 13.8 Build checklist

Follow §12.2 for both new fields. Test matrix: Subdivide 1 (= unchanged Grid) → Subdivide 2–4 with Outer Gap 0 (= flat fine grid) → Outer Gap > 0 (clusters appear) → recursion × variance (every effect varies per inner cell) → recursion × scatter (flat fine grid) → recursion × tunnel (grid inert, as Phase 3) → old-preset load → save / export round-trip → console clean at every step.
