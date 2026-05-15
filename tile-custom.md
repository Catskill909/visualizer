# Tile Custom — Tiling Enhancement Audit & Phased Dev Plan

**Last updated:** 2026-05-15 — Phase 1 ✅ shipped + verified in browser
**Scope:** Image and GIF layers in Preset Studio. Videos stay single-instance.
**Audience:** Anyone implementing this — including a future developer joining cold. §12 is the handoff reference.

---

## 🎯 Status Dashboard

**Current state:** Phase 1 ✅ Shipped 2026-05-15. Per-Cell section live in the layer card (Offset / Cell Rotate / Popcorn). Two same-day bugfixes (Group Spin composition, corner-wrap mask) and a tooltip-length pass also landed.
**Next action:** Phase 2 green-light when ready — Variance Suite (Size / Jitter X / Jitter Y / Opacity), Tunnel-Var trio (Speed Var / Direction Var / Phase Var), per-layer Seed + Lock. Spec at §4.

### Phase status

| Phase | What | Status | Shipped | Effort |
|---|---|---|---|---|
| [1](#3-phase-1--structural-per-cell-wins) | Brick offset · cell rotate · popcorn | ✅ Shipped | 2026-05-15 | 1 day |
| [2](#4-phase-2--procedural-variance-suite) | Variance suite + tunnel-var trio + per-layer seed | 📋 Planned | — | 2 days |
| [3](#5-phase-3--explicit-grid--per-cell-editor-the-replicator) | Density/Grid mode + cell picker + override map + Cascade | 📋 Planned | — | ~1 week |
| [3.1](#11-build-order-summary) | Drag-multi-select in picker | 📋 Future | — | ~3 days |
| [4](#103-recursive--nested-grids--phase-4-placeholder) | Recursive / nested grids (pure 2D) | 📋 Deferred | — | TBD |
| [5](#105-phase-5--25d-parallax-camera-pure-2d) | 2.5D parallax camera (pure 2D) | 📋 Deferred | — | ~5 days |

Legend: 📋 Planned · 🔨 In progress · ✅ Shipped · 🛑 Blocked · 🐛 Bug

### Most recent change

`2026-05-15` — **Phase 1 polish: tooltip length pass.** User flagged that the original `Cell Rotate` tooltip ("Hashed rotation per tile — composes with Spin, Angle, and Group. 0=aligned, 1=full random per cell.") was JARRING and created more confusion than it solved. Cut all four Phase 1 tooltips to 2–5 words: Offset = "Stagger alternating rows or columns", Amount = "Stagger amount", Cell Rotate = "Random rotation per cell", Snap = "Snap to 90° increments", Popcorn = "Per-cell audio pulse". Saved a `feedback_slider_discovery_ux` memory: tooltips answer "what does this do", not "what happens with X" — slider play IS the experience.

`2026-05-15` — **Phase 1 fix #2: Cell Rotate corner-wrap artifact masked.** Bug: rotating each cell pushed sampled UV outside the cell's `[0,1]` bounds; WebGL's REPEAT wrap mode then sampled the *opposite side* of the texture at those corners, creating a faint "duplicate" sliver in every cell. Fix: when `hasRotVar` is on, multiply `_gapMask` by an in-bounds step mask after rotation and clamp `_u` to `[0,1]`, so rotated-out corners go fully transparent (MilkDrop background shows through) instead of wrap-sampling the texture. Uniform Spin alone (no variance) is unchanged so existing presets don't regress.

`2026-05-15` — **Phase 1 fix #1: Group Spin vs Cell Rotate compose now.** Bug: per-cell rotation lived inside the `perTileSpin` block, which gates on `!groupSpin`. Result: enabling Group Spin silently disabled Cell Rotate. Fix: the rotation block now emits when `perTileSpin OR hasRotVar`; `_localAng` defaults to `0.0` when only variance is active, so Group Spin (whole-grid layout rotation) and Cell Rotate (per-cell content rotation) compose cleanly. Also renamed UI label `Rotate` → `Cell Rotate` to disambiguate from Spin/Angle.

`2026-05-15` — **Phase 1 code in.** Five new state fields wired through templates + normalizer + sliderExclude. New `Per-Cell` section added to layer card (gated by Tile=on). Shader extended: `_cellId` captured before fract, brick offset emitted before cell-id capture (so staggered cells get unique hashes), per-cell rotation injected into `perTileSpin` block, popcorn modulates `_src` after texture sample. Vite starts clean.

`2026-05-15` — Doc created and locked. All 5 open questions resolved (§9). Constrained-camera principle locked as design rule for all future depth work (§10.1). Code audit + handoff checklist added (§12).

### Bugs / blockers

_None tracked — surface area is doc-only at this stage._

When bugs appear during/after implementation, log them here with: phase number, one-line symptom, status (open/fixed), and a link to the fix commit or PR if shipped.

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

Tiling lives in the comp shader generated by `_buildImageBlock()` per layer. The relevant helper is `applyTileUV()` at [inspector.js:5684](src/editor/inspector.js#L5684):

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

## 5. Phase 3 — Explicit grid + per-cell editor (the replicator)

**Goal:** every cell individually addressable.
**Build estimate:** ~1 week.

### 5.0 Composition with Phase 1 / 2

**All Phase 1 + 2 Per-Cell controls remain active in Grid mode.** Phase 3 doesn't replace the procedural foundation; it adds an explicit override layer on top.

The cell index (`_cellId`) shipped in Phase 1 is what every per-cell effect hashes from. In Grid mode, `_cellId` is still derived — just from explicit `(col, row)` instead of density-driven `floor()`. So in a 2×4 grid:

- **Offset / Cell Rotate / Popcorn** (Phase 1) — each of the 8 cells still picks up its own hashed offset, rotation, and beat phase.
- **Size / Jitter / Opacity / Tunnel variances** (Phase 2) — same; each cell deviates per-axis as before.
- **Per-cell overrides** (Phase 3, new) — click any specific cell in the picker and pin its size / depth / rotation / opacity / offset. The override wins where set; the Phase 1/2 hash drives every other cell.

**Composition stack for any given cell's rotation:**

```
final_angle = Spin (animated)
            + Angle (static)
            + Group Spin (whole-grid layout, if on)
            + Cell Rotate hash      (Phase 1)
            + this cell's override.rotation, if set  (Phase 3)
```

Each stage is additive. Procedural sets the baseline; explicit pins specifics. "Randomize all" (§5.6) is the bridge — it seeds the override map from the current Phase 2 variance values, giving you an editable starting point.

### 5.1 Tile mode toggle

```
Mode   [ Density · Grid ]
```

- **Density** (current): Size slider drives count. Default for new layers.
- **Grid** (new): `Cols` × `Rows` integer steppers. Cells exactly fill the canvas.

In Grid mode, an additional toggle:

```
Fit    [ Fit · Fill ]
```

- **Fit**: image aspect preserved, transparent padding if cell mismatches
- **Fill**: image stretches to cell shape (default — matches existing `tileScaleX/Y` behaviour)

### 5.2 Default grid count (resolved Q2)

**3 × 3 = 9 cells.** Reads instantly as "a real grid"; 2×2 reads as "I broke the tile."

### 5.3 Mini cell-picker widget (inline, not modal)

Canvas widget similar to existing XY pad at [inspector.js:3258](src/editor/inspector.js#L3258). Single-click to select for editing. Drag-multi-select is a Phase 3.1 follow-up.

```
┌───┬───┬───┐
│ 1 │ 2 │ 3 │
├───┼───┼───┤
│ 4 │ ● │ 6 │     ← cell 5 selected
├───┼───┼───┤
│ 7 │ 8 │ 9 │
└───┴───┴───┘

Selected cell: 5
  Size       ──◯──   0.85   [Reset]
  Depth      ──◯──   0.30   [Reset]
  Rotation   ──◯──   45°    [Reset]
  Opacity    ──◯──   0.60   [Reset]
  Offset X   ──◯──   0.10   [Reset]
  Offset Y   ──◯──   0.00   [Reset]

  [ Randomize all ]  [ Reset all ]
```

Cells with non-default overrides show a small dot or coloured border.

### 5.4 Storage model (resolved Q3)

**Sparse override map**, comma-separated keys (locked for 3D / recursive forward-compat — §10).

```
tileOverrides: {
  "0,0": { size: 0.85, depth: 0.3 },
  "1,2": { rotation: 45, opacity: 0.6 }
}
```

Only edited cells stored. "Reset cell" deletes a key. Orphans (after grid resize) dropped at render time.

### 5.5 Shader path

Override values bake into the shader at compile time as a `vec4` array (matches existing pattern in [inspector.js:5411](src/editor/inspector.js#L5411)):

```
const vec4 _cellOverrides[9] = vec4[9](
  vec4(1.0, 0.0, 0.0, 1.0),    // size, depth, rot, opacity for cell 0
  vec4(0.85, 0.3, 0.0, 1.0),   // cell 1
  ...
);
int _cellIdx = int(_cellId.y) * COLS + int(_cellId.x);
vec4 _ovr = _cellOverrides[_cellIdx];
```

**Hard cap: 8 × 8 = 64 cells.**

### 5.6 "Randomize all" — bridging Phase 2 and Phase 3

Populates `tileOverrides` using Phase 2 variance values as seeds.

Workflow:
1. User sets variance amounts in Phase 2 sliders
2. Clicks "Randomize all"
3. Override map populates with hash-derived values matching those variance amounts
4. User edits specific cells manually from there
5. Saves — preset stores procedural-style overrides + manual tweaks together

### 5.7 Tile Tunnel extensions

The existing Tunnel system was designed for Tier A. For Tier B/C it's insufficient — Tunnel is the most-loved visual axis, and per-cell control unlocks parallax depth fields and shockwaves.

**Extensions** (gated by `Tile=on` AND `tunnelSpeed != 0`):

| Control | What it does | Phase |
|---|---|---|
| **Speed Var** (0–1) | Each cell zooms at `tunnelSpeed * (1 + hash * variance)` | 2 |
| **Direction Var** (0–1) | Probability each cell flips zoom direction | 2 |
| **Tunnel Phase Var** (0–1) | Per-cell phase in cycle (the dual-behaviour from §4.2) | 2 |
| **Cascade Mode** [Off · Radial · Linear] | Tunnel wave radiates from a centre cell on beat | 3 |
| **Cascade Centre** (cell picker) | Origin cell for radial wave | 3 |

Cascade is Phase 3 because it needs the picker to pick the centre.

**Tunnel section UI when `Tile=on`:**

```
─── Tunnel ──────────────────────
  Speed          ──◯──   1.20
  Depth (layer)  ──◯──   0.30        ← existing per-layer phase offset

  (Tile-gated)
  Speed Var      ──◯──   0.00        ← Phase 2
  Direction Var  ──◯──   0.00        ← Phase 2
  Phase Var      ──◯──   0.00        ← Phase 2
  Cascade        [Off · Radial · Linear]                ← Phase 3
   ↳ Centre: cell ●        ← Phase 3 (visible when Cascade ≠ Off)
```

### 5.8 Phase 3 UI

```
─── Tiling ───────────────────────
  Tile   [✓]
  Mode   [ Density · Grid ]

   (Grid mode only)
   Cols  [  3  ]
   Rows  [  3  ]              ┌──────────────┐
   Fit   [ Fit · Fill ]       │ ┌──┬──┬──┐  │
                              │ ├──┼──┼──┤  │      ← live picker widget
                              │ │  │● │  │  │
                              │ └──┴──┴──┘  │
                              └──────────────┘

  Selected cell: 5
   Size  Depth  Rotation  Opacity  Offset X  Offset Y    [Reset]

  [ Randomize all ]  [ Reset all ]

  Spacing, Width, Height, etc. (existing controls)
  Per-Cell variance section (Phase 1 / 2)
  Tunnel section (with §5.7 extensions)
```

---

## 6. Phase ordering & dependencies

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 3.1 ──► Phase 4 ──► Phase 5
(struct)   (procedural) (replicator) (multi-sel)  (recursive) (2.5D pan)
 1 day      2 days       ~1 week     ~3 days      deferred    deferred
```

Each phase ships value standalone. `_cellId` from Phase 1 carries forward through every later phase — no throwaway work.

**Likely release split:** Phase 1 + 2 in first release. Phase 3 in first release or shortly after. Phase 3.1, 4, 5 post-first-release.

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
| 2 | `tileDepthVariance` | `0` *(UI: "Tunnel Phase Var")* |
| 2 | `tileJitterX` | `0` |
| 2 | `tileJitterY` | `0` |
| 2 | `tileOpacityVariance` | `0` |
| 2 | `tileTunnelSpeedVariance` | `0` |
| 2 | `tileTunnelDirectionVariance` | `0` |
| 2 | `tileVarianceSeed` | `0` |
| 2 | `tileVarianceSeedLocked` | `true` |
| 3 | `tileMode` | `'density'` |
| 3 | `tileCols` | `3` |
| 3 | `tileRows` | `3` |
| 3 | `tileFit` | `'fill'` |
| 3 | `tileOverrides` | `{}` |
| 3 | `tileCascadeMode` | `'off'` |
| 3 | `tileCascadeCentre` | `null` |
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

**Q2. Phase 3 default grid count?** → **3 × 3.** Better first-impression than 2×2. §5.2.

**Q3. Override map vs per-cell layers?** → **Sparse override map**, comma-keyed. §5.4, §7.2.

**Q4. Drag-across multi-select in picker?** → **Phase 3.1 follow-up.** Single-click in v1.

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

1. **Phase 1** — `_cellId` + brick offset + rotation variance + popcorn (1 day)
2. **Phase 2** — Variance suite + per-layer seed + tunnel-variance trio (2 days)
3. **Phase 3** — Density/Grid mode + picker + override map + Cascade (~1 week)
4. **Phase 3.1** — Drag-multi-select in picker (~3 days, post-Phase-3 validation)
5. **Phase 4** — Recursive grids (deferred; possibly before or after 3D layers ship)
6. **Phase 5** — 2.5D parallax camera (deferred; pairs with Phase 4)
7. **Out-of-thread future** — 3D layers, hex / polar topology, multi-image deck, beat shuffle

---

## 12. Code Audit — handoff reference

This section is for the developer implementing any phase, including a future contributor joining cold.

### 12.1 Files & primary call sites

| Concern | File | Line | Notes |
|---|---|---|---|
| Comp shader builder (per-layer) | [src/editor/inspector.js](src/editor/inspector.js) | `_buildCompShader` 5319 | Rebuilds shader from `currentState`. Called on every change to images/sat/hue/solidColor/sceneMirror/paletteOpacity |
| Image block builder | [src/editor/inspector.js](src/editor/inspector.js) | `_buildImageBlock` 5450 | The big function — generates GLSL per layer. All new Phase 1–3 shader code goes here |
| Tile UV helper | [src/editor/inspector.js](src/editor/inspector.js) | `applyTileUV` 5684 | Where `_cellId = floor(_u)` foundation lands in Phase 1 |
| Image layer defaults (new layer) | [src/editor/inspector.js](src/editor/inspector.js) | image template ~2331–2358 | Add every new tile field here |
| Default normalizer (old preset compat) | [src/editor/inspector.js](src/editor/inspector.js) | `_normalizeImageEntry` 6263 | **CRITICAL**: add every new field to default dict here |
| Generic slider handler | [src/editor/inspector.js](src/editor/inspector.js) | `sliderExclude` 3882 | **CRITICAL**: every new `.layer-slider-row` slider class MUST be added to this `:not()` chain |
| Layer card HTML render | [src/editor/inspector.js](src/editor/inspector.js) | `_layerCardHtml` ~3070–3500 | The HTML template for each card. New control rows go here |
| Layer card event bindings | [src/editor/inspector.js](src/editor/inspector.js) | `_bindLayerCard` ~3650–4000 | Wire up new sliders / toggles here |
| Save (custom preset) | [src/editor/inspector.js](src/editor/inspector.js) | `saveCurrent` 6234 | Auto-serializes `currentState` — new fields work automatically as long as they live in `currentState` |
| Load (custom preset) | [src/editor/inspector.js](src/editor/inspector.js) | `loadPresetData` 6345 | Restores `currentState`. Calls `_normalizeImageEntry` per image; relies on it for backwards compat |
| Undo / redo | [src/editor/inspector.js](src/editor/inspector.js) | `_pushUndoBefore`/`_postSnap` 1380 | Every state-mutating handler must call `_pushUndoBefore()` *and then* `_postSnap()`. 50-deep |
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
