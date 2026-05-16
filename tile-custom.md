# Tile Custom — Tiling Enhancement Audit & Phased Dev Plan

**Last updated:** 2026-05-16 — Phase 3 ✅ shipped & verified — explicit Grid mode (Cols×Rows, Fit/Fill, Grid Scale)
**Scope:** Image and GIF layers in Preset Studio. Videos stay single-instance.
**Audience:** Anyone implementing this — including a future developer joining cold. §12 is the handoff reference.

---

## 🎯 Status Dashboard

**Current state:** Phases 1 / 2 / 2.5 / 3 ✅ all shipped 2026-05-16. Variance Suite: Size Var / Jitter X/Y / Opacity Var / Phase Var / Seed + Lock. Scatter sampling: jitter moves tiles freely with overlap. **Grid mode: Density/Grid toggle, explicit Cols×Rows, Fill/Fit, Grid Scale (0.1–3×); Pulse/Strobe react in Grid mode. All verified in browser.** Speed Var + Direction Var deferred (tunnel architecture work — Phase 3.2).
**Next action:** Phase 3.2 — Tunnel ↔ Scatter convergence (free-jitter in tunnel + Speed/Direction Var) and Phase 3.3 — Scatter-mode FX parity — both §5.9. Phase 3.5 (per-cell override editor) optional, build on demand only.

### Phase status

| Phase | What | Status | Shipped | Effort |
|---|---|---|---|---|
| [1](#3-phase-1--structural-per-cell-wins) | Brick offset · cell rotate · popcorn | ✅ Shipped | 2026-05-15 | 1 day |
| [2](#4-phase-2--procedural-variance-suite) | Variance suite + per-layer seed (Speed/Dir Var deferred) | ✅ Shipped | 2026-05-16 | 1 day |
| 2.5 | Scatter sampling — free jitter + tile overlap (3×3 neighbour accumulation) | ✅ Shipped | 2026-05-16 | 1 day |
| [3](#5-phase-3--explicit-grid-mode) | Explicit Grid mode — Density/Grid toggle, Cols×Rows, Fit/Fill, Grid Scale | ✅ Shipped | 2026-05-16 | 1 day |
| [3.2](#59-phase-25-scatter--composition-with-phase-3-and-the-deferred-differentials) | Tunnel ↔ Scatter convergence — free-jitter in tunnel + Speed/Direction Var (per-cell `_tz`) | 📋 Planned | — | ~3 days |
| [3.3](#59-phase-25-scatter--composition-with-phase-3-and-the-deferred-differentials) | Scatter-mode FX parity — chromatic / blur / sobel / wave / pixelate compose inside the scatter loop | 📋 Planned | — | ~2 days |
| [3.5](#58-phase-35--per-cell-override-editor-deferred-optional) | Per-cell override editor — picker widget + override map + Cascade (includes drag-multi-select) | 📋 Optional | — | ~4–5 days |
| [4](#103-recursive--nested-grids--phase-4-placeholder) | Recursive / nested grids (pure 2D) | 📋 Deferred | — | TBD |
| [5](#105-phase-5--25d-parallax-camera-pure-2d) | 2.5D parallax camera (pure 2D) | 📋 Deferred | — | ~5 days |

Legend: 📋 Planned · 🔨 In progress · ✅ Shipped · 🛑 Blocked · 🐛 Bug

### Most recent change

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

**Tier C — Explicit per-cell control (the replicator)**
User declares an explicit grid (e.g. 2×4 = 8 cells). Each cell becomes individually addressable: click in the picker, override size / depth / rotation / opacity / offset. The replicator pattern from After Effects, TouchDesigner, Cavalry. "Compose this image 8 times in a layout I designed" rather than "tile this image."

Tiers stack: Tier C's "Randomize all" seeds the override array using Tier B variance values.

**Design principle locked at the top:** every depth-related feature uses a **constrained camera** model — small pan/tilt only, never full rotation. See §10.

---

## 2. Audit of current state

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

### 5.8 Phase 3.5 — Per-cell override editor (deferred, optional)

**Status:** 📋 optional. Build only on real beta-user demand for hand-authored cell control — see the §5.0 rationale. Spec preserved here so it is ready if scheduled. Requires Grid mode (Phase 3) as a prerequisite.

**5.8.1 Cell-picker widget** — an inline canvas widget (the `.xy-pad` pattern at [inspector.js:5160](src/editor/inspector.js#L5160) is the direct template: `<canvas>`, a `drawPad()` redraw, click → mutate → `refresh()`). Single-click selects a cell; drag-multi-select is a sub-follow-up within this phase. Cells with overrides show a dot. Selected-cell is editor-local UI state — **not** part of `currentState`, never saved.

```
┌───┬───┬───┐     Selected cell: 5
│ 1 │ 2 │ 3 │       Size · Depth · Rotation · Opacity · Offset X/Y   [Reset]
├───┼───┼───┤       [ Randomize all ]   [ Reset all ]
│ 4 │ ● │ 6 │
├───┼───┼───┤     Picker sliders use a class OUTSIDE the sliderExclude
│ 7 │ 8 │ 9 │     positional chain (§5.9.1 / §12.4 footgun).
└───┴───┴───┘
```

**5.8.2 Storage** — sparse override map, comma-keyed (locked for 3D / recursive forward-compat, §7.2):

```
tileOverrides: { "0,0": { size: 0.85, depth: 0.3 }, "1,2": { rotation: 45 } }
```

Only edited cells stored. "Reset cell" deletes a key. Orphans (after a grid resize) dropped at render time. Audit-confirmed: a plain object deep-clones safely through undo / save / export (`deepClone` is a JSON round-trip).

**5.8.3 Shader path** — override values bake at compile time into a `vec4` array, indexed by the clamped `_cellId`:

```
const vec4 _cellOverrides[9] = vec4[9]( vec4(1.0,0.0,0.0,1.0), … );
int _cellIdx = clamp(int(_cellId.y)*COLS + int(_cellId.x), 0, N-1);
vec4 _ovr = _cellOverrides[_cellIdx];
```

**Hard cap: 8 × 8 = 64 cells.**

**5.8.4 "Randomize all"** — the bridge from procedural to explicit: populates `tileOverrides` from the current Phase 2 variance-slider values, giving an editable starting point rather than a blank grid.

**Composition** — overrides are additive on top of the procedural baseline; e.g. a cell's final rotation = Spin + Angle + Group Spin + Cell Rotate hash + `override.rotation` (if set).

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
Phase 1 ─► 2 ─► 2.5 ─► 3 ─► 3.2 ─► 3.3 ─► [3.5] ─► 4 ─► 5
(struct)  (var)(scatter)(grid)(tun↔scat)(scatFX)(editor) (recurse)(2.5D)
 1d       1d   1d       ~2-3d ~3d       ~2d    optional deferred deferred
```

Phase 3.2 / 3.3 are the deferred differentials from Phases 2 / 2.5 — see §5.9. Phase 3.5 (the per-cell override editor) is **optional** — build on demand only; §5.0 has the rationale. Each phase ships value standalone. `_cellId` from Phase 1 carries forward through every later phase — no throwaway work.

**Likely release split:** Phase 1 + 2 + 2.5 in first release. Phase 3 (Grid mode) in first release or shortly after. Phase 3.2 / 3.3 / 4 / 5 post-first-release. Phase 3.5 only if requested.

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
| 3.2 | `tileTunnelSpeedVariance` | `0` *(deferred differential — needs tunnel crossfade restructure; §5.9.2)* |
| 3.2 | `tileTunnelDirectionVariance` | `0` *(deferred differential — needs tunnel crossfade restructure; §5.9.2)* |
| 3 | `tileMode` | `'density'` |
| 3 | `tileCols` | `3` |
| 3 | `tileRows` | `3` |
| 3 | `tileFit` | `'fill'` |
| 3 | `tileGridScale` | `1.0` |
| 3.5 | `tileOverrides` | `{}` *(optional per-cell editor — §5.8)* |
| 3.5 | `tileCascadeMode` | `'off'` *(optional — ships with the editor)* |
| 3.5 | `tileCascadeCentre` | `null` *(optional — ships with the editor)* |
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

**Q3. Override map vs per-cell layers?** → **Sparse override map**, comma-keyed. Now part of the optional Phase 3.5 editor — §5.8, §7.2.

**Q4. Drag-across multi-select in picker?** → folded into **Phase 3.5** (the optional per-cell editor); single-click first, drag-multi-select as a sub-follow-up. §5.8.1.

**Q5. Seed scope?** → **Per-layer.** Each layer has independent randomness. §4.3.

---

## 10. Future awareness — constrained camera, 3D layers, recursive grids, 2.5D parallax

**Nothing in §10 is being built now.** This section captures forward-planning so Phases 1–3 don't paint us into a corner.

### 10.1 Constrained camera — the design principle for any future depth work

When depth-related features ship (3D layers OR 2.5D parallax OR anything in between), they use a **constrained camera** model: small pan/tilt only, never full rotation. The user moves a virtual camera left/right and up/down a little — they never fly behind objects.

Why this is the right call, both creatively and technically:

| Reason | What it means |
|---|---|
| **VJs aren't camera operators during shows** | Full orbit controls = 6 sliders nobody touches |
| **Composition is sacred** | You set up a frame; you don't want it spun around mid-set |
| **Parallax sells depth** | A 50px camera shift on a bassline feels more 3D than a 360° orbit, because human perception reads parallax as depth long before rotation |
| **Performance shortcuts** | No backface concerns, no complex depth sort, no occlusion edge cases |

This principle constrains both the eventual 3D layer system *and* the near-term 2.5D parallax phase (§10.5). Both expose XY pan only.

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
- Lighting, depth buffer, camera transforms (still XY-pan-only)
- Mesh loading + asset storage

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

**Status:** Phase 4 placeholder. The key-convention lock in §7.2 keeps it possible. Might land before 3D layers if 3D takes longer.

### 10.4 Things to NOT do now

- Don't design the 3D rendering pipeline. Separate doc.
- Don't add 3D-specific fields to the schema before 3D layers exist.
- Don't try to make `_cellId` work for both 2D and 3D simultaneously — clean 2D version now, mirror the pattern for 3D when it ships.

### 10.5 Phase 5 — 2.5D parallax camera (pure 2D)

A near-term depth phase that pairs with recursive grids and ships *before* any real 3D layer system.

**Concept:** each image layer gets `parallaxDepth` (0 = front, 1 = far back) and `parallaxAmount` (how much it responds to camera). The comp shader offsets each layer's UV by `cameraPos * depth * parallax`. Result: layers shift at different rates as the camera pans → felt depth without rotation.

**Controls (per layer):**
- `parallaxDepth: 0..1` (slider, default 0)
- `parallaxAmount: 0..1` (slider, default 0)

**Camera controls (per preset — new global section):**
- Camera XY pad (manual pan, similar to existing Centre pad)
- Audio-reactive camera bob amplitude (bass-driven small parallax)
- Auto-pan drift speed (slow Ken Burns)

Combined with recursive grids: small camera pans reveal the nested-grid structure as depth. The full creative payoff of "3D" without the 3D pipeline cost.

**Build estimate:** ~3 days for layer-side fields + ~2 days for the camera controls. Could be split across two PRs.

---

## 11. Build order summary

1. **Phase 1** — `_cellId` + brick offset + rotation variance + popcorn (1 day) ✅
2. **Phase 2** — Variance suite + per-layer seed (Speed/Dir Var deferred → 3.2) (1 day) ✅
3. **Phase 2.5** — Scatter sampling — free jitter + tile overlap (1 day) ✅
4. **Phase 3** — Explicit Grid mode: Density/Grid toggle + Cols×Rows + Fit/Fill (~2–3 days; §5.1–5.6)
5. **Phase 3.2** — Tunnel ↔ Scatter convergence: free-jitter in tunnel + Speed/Direction Var, the deferred Phase 2/2.5 differentials (~3 days; §5.9.2)
6. **Phase 3.3** — Scatter-mode FX parity: chromatic / blur / sobel / wave / pixelate compose inside the scatter loop (~2 days; §5.9.3)
7. **Phase 3.5** — Per-cell override editor: picker widget + override map + Cascade + drag-multi-select. **Optional** — build on real user demand only (~4–5 days; §5.8)
8. **Phase 4** — Recursive grids (deferred; possibly before or after 3D layers ship)
9. **Phase 5** — 2.5D parallax camera (deferred; pairs with Phase 4)
10. **Out-of-thread future** — 3D layers, hex / polar topology, multi-image deck, beat shuffle

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

For each field added to `currentState.images[i]`:

1. ☐ Default value added to the new-image template (~line 2331–2358)
2. ☐ Default value added to `_normalizeImageEntry` (line 6263) — **omitting this breaks old presets with `.toFixed() of undefined`**
3. ☐ HTML control row added to `_layerCardHtml`
4. ☐ Event listener wired in `_bindLayerCard`
5. ☐ If it's a `.layer-slider-row` slider, class added to `sliderExclude` (line 3882) — **omitting this index-shifts every other slider on the card** (logged incident; see memory `feedback_image_layer_slider_pattern`)
6. ☐ Handler calls `_pushUndoBefore()` before mutation, `_postSnap()` after
7. ☐ Handler calls `this._buildCompShader()` after mutation if it affects rendering
8. ☐ Save/load round-trip verified (open preset, edit field, save, reload, value persists)
9. ☐ Old-preset compatibility verified (load a pre-feature preset, no console errors)
10. ☐ Export/import round-trip verified (export to JSON, re-import on a fresh browser, field intact)

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
