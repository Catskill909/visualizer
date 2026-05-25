# Video Tiling — Audit & Phased Dev Plan

**Last updated:** 2026-05-24 — Phase A + Phase B both VERIFIED and shipping. Feature complete.
**Scope:** `type === 'video'` layers tile (density + grid), for opaque and transparent (native-alpha + stacked-alpha) video, in Preset Studio.
**Status:** ✅ **SHIPPED.** Phase A verified in-browser (opaque + native-alpha). Phase B verified in a packaged macOS build (stacked-alpha transparent video tiles with all sliders + grouping working). Sibling doc to [tile-custom.md](tile-custom.md) (image/GIF/text tiling, Phases 1–4 shipped).
**Audience:** anyone implementing this cold. The audit (§3) is the load-bearing reference — every `!isVideo` gate is listed with a line number.

---

## 🎯 Status Dashboard

**Works now (verified 2026-05-24 — web + macOS):** opaque video, **native-alpha transparent video** (web), AND **stacked-alpha transparent video** (macOS) all tile — Density + Grid, full per-cell stack (offset/rotate/popcorn/variance/scatter/tunnel/spacing/per-tile mirror). The "Scale" slider relabels to "Size" and acts as the density divisor when Tile is on. *Native-alpha works for free because the browser decodes it to an ordinary RGBA texture — `_t.w` carries real alpha, the tiled `textureGrad` sample + blend composites each tile over the background. No special-casing.* Confirmed with a transparent dancer clip tiling cleanly over a MilkDrop background.
**Built, pending macOS verify:** **stacked-alpha** video tiling (the 2×-tall RGB-top/alpha-luma-bottom encode from `_handleWebmAlphaUpload`, macOS/WKWebView only). The `sampleGrad()` helper recombines top/bottom at every tiled sample site (plain/tunnel/scatter); the Tile toggle is now shown for all video. Chromatic/blur/sobel are auto-disabled for stacked-tiled (they'd read the raw 2× texture — documented deferral, §B.2). Only testable in a packaged macOS/Tauri build (stacked-alpha clips don't exist on web).
**Platform boundary:** native-alpha transparency tiles in the **browser/web build** (Phase A, Chrome decodes VP9/VP8 alpha natively). Stacked-alpha (macOS-packaged transparent WebMs) tiles via Phase B. Both verified.
**Verified:** Phase A in browser (opaque + native-alpha transparent). Phase B in a packaged macOS build — transparent video tiles with all tiling sliders and the grouping (Group spin) functions working.

**Next action:** none — feature complete. Docs (in-app help index.html, promo, README) updated 2026-05-24. Optional §7 backlog (shimmer cap, per-tile border) only on demand.

### Phase board

| Phase | What | Status | Effort |
|---|---|---|---|
| [A](#5-phase-a--opaque-video-tiling) | Opaque **+ native-alpha transparent** video tiling — un-gate density + grid, size→density semantics, UI | ✅ Verified in-browser | ~1 day |
| [B](#6-phase-b--transparent-stacked-alpha-video-tiling) | **Stacked-alpha** video tiling (macOS WKWebView encode) — thread the top/bottom composite into the tiled sample sites | ✅ Verified on macOS | ~1–1.5 days |
| [C](#7-optional-polish-pass) | Polish — mipmap-free shimmer mitigation, per-tile border | ⬇ Backlog | — |

Legend: 📋 Planned · 🔨 In progress · ✅ Shipped · ⬇ Backlog · ❌ Cut · 🛑 Blocked · 🐛 Bug

### Most recent change

`2026-05-24` — **Phase B VERIFIED on macOS — feature SHIPPED.** User confirmed in a packaged macOS build: transparent (stacked-alpha) video tiles cleanly with all tiling sliders and the grouping (Group spin) functions working. Both phases done. User-facing docs updated: in-app help (index.html — the "No tiling" video bullet replaced; transparent-video section notes tiling), promo page (Video Layers bullet + Video capability grid), README (feature paragraph + doc table). Shipping web + macOS.

`2026-05-24` — **Phase B code in (stacked-alpha tiling) — pending macOS verify.** Added `sampleGrad(uv,dx,dy)` string-helper: plain `textureGrad` for normal layers, top/bottom recombine (RGB from `uv.y*0.5`, alpha from `uv.y*0.5+0.5`, y-derivative halved) for stacked-alpha. Routed the 3 tiled sample sites through it — plain tile, tunnel A/B, scatter `_sc`. Non-tiled branch left untouched (it already composites inline) → zero regression for single-instance transparent video. New `stackedTiled` flag disables the texture-resample FX (`hasChromatic`/`hasBlur`/`hasEdge`) which would read the raw 2× texture (wave/pixelate are fine — they pre-modify `_u`). Tile toggle un-hidden for all video (was opaque-only in Phase A). `node --check` clean. Stacked-alpha clips only exist in the packaged macOS/Tauri build, so verify there.

`2026-05-24` — **Phase A VERIFIED in-browser — incl. native-alpha transparent video.** User tiled a transparent dancer clip cleanly over a MilkDrop background (Density mode, Size 0.27). Key realisation: "transparent video" is two distinct mechanisms — **native-alpha** (browser decodes a real alpha channel → ordinary RGBA texture → tiles for free, Phase A) vs **stacked-alpha** (the 2×-tall encode from `_handleWebmAlphaUpload`, macOS/WKWebView only → still Phase B). The earlier doc framing ("transparent = Phase B") was too broad and is corrected throughout. Phase B now scoped precisely to stacked-alpha, and it's the path that matters for *packaged macOS* transparent video.

`2026-05-24` — **Phase A code in (verifying).** Un-gated opaque video tiling in `inspector.js`: removed `!isVideo` from all tile flags + the path selector (`} else if (img.tile)`), made `spacing`/`mirrorScope` honour `img.tile` for video, gated the video border off when tiling (it uses `_rd`, which only exists in the non-tiled branch → would be a GLSL compile error). Size semantics: `scale` doubles as the density divisor (no new field); the slider label flips Scale↔Size on tile toggle. UI: Tile toggle now renders for **opaque** video only (`entry.type !== 'video' || !entry.isStackedAlpha`) — stacked-alpha keeps it hidden so it can't enter the tiled path before Phase B; Mode/Grid/Per-Cell/Tunnel/Spacing/Group-Spin/Mirror-scope rows un-hidden for video; video Width/Height (`.layer-vid-scale-row`) hides in Grid mode (Cols:Rows owns shape there); the Border group (`.layer-vid-border-group`) hides when tiling. Video template gained the per-cell/grid fields. `node --check` clean. **Pending in-browser GLSL + save/load verify.**

`2026-05-24` — Doc created. Full audit of every `!isVideo` gate + the size-vs-scale semantics + the two real blockers (stacked-alpha sample site; video-border `_rd` dependency). Phased into A (opaque) / B (transparent). Cost section locked: **tile count does not drive cost** — see §2.

### Bugs / blockers

| Phase | Symptom | Status |
|---|---|---|
| — | — | none yet |

When bugs appear, log them here: phase, one-line symptom, status, fix date.

### Related files

- [src/editor/inspector.js](src/editor/inspector.js) — shader generation (`_buildImageBlock`), the layer card UI, the entry templates, `_normalizeImageEntry`. Primary surface.
- [src/visualizer.js](src/visualizer.js) — video texture allocation + per-frame upload (`_loadVideoTexture`, `_tickVideoAnimations`). REPEAT wrap already set.
- [tile-custom.md](tile-custom.md) — image/GIF/text tiling (the system we are extending to video).
- [transparent-dev.md](transparent-dev.md) / [apng-dev.md](apng-dev.md) — the stacked-alpha pipeline that Phase B rides on.

---

## 1. The ask (verbatim intent)

> "right now our app has tiling for images, text and gifs. are we able to tile videos and transparent videos also? what's the cpu cost on this? … If the weight is too much what about grid with limited repeat?"

Three questions, answered up front so we don't drift:

1. **Can we tile video?** Yes — it's a deliberate `!isVideo` gate, not a technical wall.
2. **CPU cost?** Essentially the same as showing *one* video (§2). Tile count is free.
3. **Grid-with-limited-repeat?** Already exists (Grid mode) and is worth exposing — but **not as a cost guard** (there's no cost to guard against), only as a layout/quality control (§8).

---

## 2. Cost analysis — why tile count is free

Tiling is **pure fragment-shader math**. `applyTileUV()` ([inspector.js:6636](src/editor/inspector.js#L6636)) maps the screen UV into a cell and samples the *one* texture. A fragment shader runs **once per output pixel** regardless of tile count — 1 tile and 100 tiles process the identical number of fragments. The GPU just reads the same texture from wrapped coordinates.

A video layer's real per-frame cost is **decode + upload, both of which happen once per video element no matter how many tiles draw:**

| Cost | Where | Scales with tile count? |
|---|---|---|
| Video decode | browser, one `<video>` element | No |
| Frame → GPU upload | `_tickVideoAnimations` [visualizer.js:1429](src/visualizer.js#L1429) | No |
| Tiling math + texture sample | fragment shader | No (same pixel count) |

**Conclusion:** tiling one video into a 10×10 grid costs the same as showing it once. What's expensive is *many different* video layers (each its own decode+upload) — but that is not tiling.

**Existing per-frame cost to be aware of (not made worse by tiling):** the standard upload path does `drawImage → getImageData → texSubImage2D` ([visualizer.js:1458-1461](src/visualizer.js#L1458-L1461)). The `getImageData` is a CPU readback every frame; it's already today's cost for a single video. Stacked-alpha video already uses the *faster* direct `texSubImage2D(videoElement)` path ([visualizer.js:1455](src/visualizer.js#L1455)).

**The only real downside is visual, not perf:** video textures are allocated `LINEAR`, no mipmaps ([visualizer.js:1312](src/visualizer.js#L1312)). The tiled paths use `textureGrad`, which with no mip chain just samples the base level — so a video tiled *very small* (many density cells) will **shimmer/alias**, not cost CPU. Grid mode with a sane cap sidesteps it (§7, §8).

---

## 3. Audit — every gate that excludes video today

All in `_buildImageBlock` in [inspector.js](src/editor/inspector.js) unless noted. Line numbers drift — grep the symbol if they've moved. `isVideo = img.type === 'video'` is set at [inspector.js:6326](src/editor/inspector.js#L6326).

### 3.1 Shader feature gates (all `!isVideo && img.tile && …`)

| Line | Symbol | What it gates |
|---|---|---|
| 6436 | `hasOffset` | brick/half-drop offset |
| 6440 | `hasRotVar` | per-cell rotation |
| 6443 | `hasPopcorn` | per-cell popcorn |
| 6446 | `hasSizeVar` | size variance |
| 6448/6450 | `hasJitterX/Y` | jitter |
| 6452 | `hasOpacityVar` | opacity variance |
| 6454 | `hasDepthVar` | depth/phase variance |
| 6466 | `hasTunnel` | tunnel |
| 6478/6480 | `groupSpin` / `perTileSpin` | spin scope |
| 6489 | `useScatter` | scatter (3×3 overlap renderer) |
| 6501 | `useGrid` | **Grid mode** |
| 6508 | `useRecursion` | recursive grids |

### 3.2 The path selector — the one that matters most

[inspector.js:7079](src/editor/inspector.js#L7079): `} else if (!isVideo && img.tile) {` — the **plain tiled render path**. Video falls through to the `else` (non-tiled single-instance) branch at [inspector.js:7091](src/editor/inspector.js#L7091). **Un-gating tiling = letting video reach the tiled paths.** The selector order is: `hasTunnel` → `useScatter` → `!isVideo && img.tile` → `else (single)`.

### 3.3 Forced single-instance overrides

| Line | Symbol | Current | Needed for tiling |
|---|---|---|---|
| 6336 | `spc` (spacing) | `isVideo ? '0.0' : …` | use `img.spacing` when `isVideo && img.tile` |
| 6349 | `mirrorScope` | `isVideo ? 'field' : …` | allow `'tile'` scope when `isVideo && img.tile` |

### 3.4 The two real blockers (read carefully)

**Blocker 1 — stacked-alpha sample site (Phase B).** Transparent video is stored *stacked*: the texture is 2× tall, RGB in the top half, alpha-as-luminance in the bottom half ([visualizer.js:1295](src/visualizer.js#L1295)). The shader recombines them — but **only in the non-tiled branch**, at [inspector.js:7116-7118](src/editor/inspector.js#L7116-L7118):

```glsl
// img.isStackedAlpha — non-tiled branch only:
vec4 _t = vec4(texture(tex, vec2(_u.x, _u.y*0.5)).rgb,
               texture(tex, vec2(_u.x, _u.y*0.5+0.5)).r);
```

The tiled paths sample with a plain `textureGrad(tex, _u, _dx, _dy)` ([inspector.js:7090](src/editor/inspector.js#L7090)) and the tunnel/scatter paths likewise. If a stacked-alpha video tiles through those, it samples the full 2× texture as if it were ordinary RGBA → **you'd see the alpha-luma map tiled in as a ghost image, no transparency.** Phase B must thread the top/bottom composite into every tiled sample site (plain, scatter, tunnel).

**Blocker 2 — video border `_rd` dependency (Phase A).** The video border ring at [inspector.js:7401-7413](src/editor/inspector.js#L7401-L7413) uses `_rd` (signed distance) and `_gapMask`. `_rd` is computed **only in the non-tiled branch** ([inspector.js:7107-7110](src/editor/inspector.js#L7107-L7110)). If a video has `vidBorderWidth > 0` AND `tile` on, the tiled branch never defines `_rd` → **GLSL compile error**. Phase A must gate the border off when tiling (simplest) — per-tile borders are §7 backlog.

### 3.5 UI gates (`entry.type !== 'video'`)

Render side (all hide the control for video):

| Line | Control |
|---|---|
| 3652 | the **Tile** checkbox itself (`layer-tile`) |
| 3670 | Mode (Density/Grid) row |
| 3727 | Spacing row |
| 3733/3739 | Tile Width/Height rows (video has its own at 4080) |
| 3750 | Group Spin |
| 3819–3837 | Tunnel + Per-Cell section rows (`layer-percell-row`, `layer-tunnel-row`) |
| 3969 | Mirror scope |

Binding side (the handlers that mirror those gates):

| Line | What |
|---|---|
| 4353 | `const tileOn = entry.tile && entry.type !== 'video'` (per-cell row visibility) |
| 4370 | same guard for the tile-mode row |
| 4379 | `entry.tile = tileCb.checked` (the checkbox handler — only exists if the checkbox renders) |

### 3.6 Schema / templates

- **Video template** ([inspector.js:3140-3221](src/editor/inspector.js#L3140-L3221)) has `tile:false`, `spacing`, `tileScaleX/Y`, `groupSpin`, `radius` — but **none of the per-cell / grid fields** (`tileMode`, `tileCols`, `tileOffsetAxis`, …). It uses **`scale`** (single-instance coverage 0.1–2.0), *not* `size`.
- **`_normalizeImageEntry`** ([inspector.js:7557](src/editor/inspector.js#L7557)) DOES define all tile fields with defaults and is run on every loaded entry — including video ([inspector.js:7716](src/editor/inspector.js#L7716)). So *loaded* video entries already carry the fields. The shader reads everything with `?? default` / `|| default`, so **missing template fields are not fatal** — but add them to the template for cleanliness.

### 3.7 What already works in our favour

- **REPEAT wrap is already set on video textures** ([visualizer.js:1310-1311](src/visualizer.js#L1310-L1311)) — tiling needs REPEAT; no change.
- **Video has `texW`/`texH`** ([inspector.js:3217-3218](src/editor/inspector.js#L3217)) → `imgAsp` ([inspector.js:6409](src/editor/inspector.js#L6409)) and `aspectPreScale` work unchanged → aspect-correct tiles and Fit mode for free.
- The shader helpers (`applyTileUV`, `aspectPreScale`, `buildScatterSample`) are **type-agnostic** — nothing in them special-cases image vs video.

---

## 4. The size-vs-scale decision (resolved)

Images tile by **`size`** (density — smaller = more repeats: `_u /= sizeBase`). Video stores **`scale`** (coverage 0.1–2.0). The shader already picks `sz = isVideo ? scale : size` ([inspector.js:6328](src/editor/inspector.js#L6328)), and `sizeBase` is the density divisor ([inspector.js:6865](src/editor/inspector.js#L6865)).

**Decision: reuse `scale` as the density divisor when tiling — no new field.** When `tile` is on, `_u /= scale` makes `scale < 1` produce repeats (0.5 → 2×, 0.25 → 4×) exactly like image `size`. The "Scale" slider relabels to **"Size"** when tile is on (it already shares the `.layer-size-row` element and the value readout). Turning tile off restores the coverage meaning of the same stored value.

- ✅ No schema churn, no migration.
- ✅ Identical math path to images (one less special case).
- ⚠️ At `scale ≈ 2.0` with tile on you get <1 repeat (one zoomed-out cell). Acceptable edge — tiling users live below 1.0. Optional polish: nudge `scale` to ~0.4 the first time `tile` is switched on for a video (a sensible default density). Keep it optional; don't over-engineer.

Grid mode ignores the divisor entirely (Cols×Rows is explicit), so this only affects Density mode.

---

## 5. Phase A — opaque video tiling

**Goal:** an opaque video tiles via Density and Grid, with the full per-cell stack (offset/rotate/popcorn/variance/scatter/tunnel) available — same as an image. **~1 day.**

### A.1 Shader — un-gate

- Drop `!isVideo` from the feature flags in §3.1. The cleanest move: define `const tileable = img.tile && (!isVideo || A-is-shipped)` … in practice just **delete the `!isVideo &&` prefix** from each flag, since they already `&& img.tile` and video's `tile` defaults false. Verify each still reads `img.tile`.
- Change the path selector at [inspector.js:7079](src/editor/inspector.js#L7079) from `!isVideo && img.tile` to **`img.tile`** (covers video). Tunnel/scatter selectors already key off the now-un-gated flags.
- §3.3 overrides: `spc` and `mirrorScope` become `img.tile`-aware for video.
- **Blocker 2:** gate the video border off when tiling — wrap the border block ([inspector.js:7401](src/editor/inspector.js#L7401)) with `!img.tile` (or `&& !(isVideo && img.tile)`), so `_rd` is never referenced from a tiled branch.

### A.2 Size semantics

Implement §4 — `scale` doubles as density; relabel slider "Scale"→"Size" when `tile` on.

### A.3 UI — un-hide for video

Flip the §3.5 render gates so video shows: the **Tile checkbox** (3652), **Mode** row (3670), **Spacing** (3727), **Group Spin** (3750), **Tunnel + Per-Cell** rows (3819–3837), **Mirror scope** (3969). Keep video's own Width/Height block (4080) — or unify with the shared tile-scale rows; pick one to avoid two Width/Height controls showing at once.

Binding side: change the `&& entry.type !== 'video'` guards at 4353 / 4370 to allow video (`entry.tile` alone). The `entry.tile = tileCb.checked` handler (4379) now runs for video because the checkbox renders.

### A.4 Template

Add the missing per-cell/grid fields (§3.6) to the video template ([inspector.js:3140](src/editor/inspector.js#L3140)) for cleanliness — mirror the text template's block ([inspector.js:3371-3393](src/editor/inspector.js#L3371-L3393)). Functionally optional (normalizer + `?? default` cover loads) but keeps NEW video entries consistent.

### A.5 Verify

Density tile, Grid mode, per-cell variance, scatter, tunnel — all on an opaque MP4. Confirm aspect-correct cells, no GLSL errors with border at 0 and >0, save/load round-trip, DMG build.

---

## 6. Phase B — transparent (stacked-alpha) video tiling

**Goal:** a stacked-alpha (transparent) video tiles with correct per-cell transparency. **~1–1.5 days.** Depends on Phase A landed.

### B.1 The core change — composite-aware sampling in tiled paths

Today the stacked-alpha recombine is inline only in the non-tiled branch ([inspector.js:7116-7118](src/editor/inspector.js#L7116-L7118)). Phase B must produce a **sampler helper** used by *every* path, e.g.:

```glsl
// pseudo: replaces textureGrad(tex, uv, dx, dy) at each tiled sample site
vec4 _sampleLayer(vec2 uv, vec2 dx, vec2 dy) {
  // stacked-alpha: top half = RGB, bottom half R = alpha
  return vec4(textureGrad(tex, vec2(uv.x, uv.y*0.5),     dx*vec2(1,0.5), dy*vec2(1,0.5)).rgb,
              textureGrad(tex, vec2(uv.x, uv.y*0.5+0.5),  dx*vec2(1,0.5), dy*vec2(1,0.5)).r);
}
// non-stacked: vec4(textureGrad(tex, uv, dx, dy));
```

Thread it through:
- plain tile sample ([inspector.js:7090](src/editor/inspector.js#L7090))
- tunnel A/B samples ([inspector.js:7064-7065](src/editor/inspector.js#L7064-L7065))
- the scatter loop's sample inside `buildScatterSample` ([inspector.js:6919](src/editor/inspector.js#L6919))

The derivative halving on `.y` keeps mip selection correct on the half-height RGB region. Verify against the seam logic — the tile derivatives are captured pre-`fract` (§ `applyTileUV`), so they're smooth before the composite split.

### B.2 Watch-outs

- **Don't double-apply.** The non-tiled branch keeps its inline composite; the tiled paths get the helper. Gate on `img.isStackedAlpha` so opaque video keeps the single plain sample (zero regression to Phase A).
- **Chromatic/blur/sobel/wave/pixelate** resample the texture with their own `texture()` calls (e.g. [inspector.js:7124+](src/editor/inspector.js#L7124)). Those are already `&& !useScatter`; for stacked-alpha + tiling they'd sample the raw 2× texture. Either route them through `_sampleLayer` too, or document them as deferred for stacked-alpha tiling (matches how scatter defers them in tile-custom.md §5.9.3). Recommend: **defer, document** — don't expand scope.
- **alphaMode** (`'preserve'` for stacked-alpha, `'fade'` otherwise — [inspector.js:3157](src/editor/inspector.js#L3157)) is unaffected; the blend uses `_t.w`.

### B.3 Verify

Tile a known-good stacked-alpha HEVC/WebM transparent clip in Density + Grid; confirm transparency holds per cell, gaps show the MilkDrop background through (not the alpha-luma map), no ghost band. Cross-check the existing single-instance transparent video still renders identically (regression).

---

## 7. Optional polish pass (backlog)

- **Mipmap shimmer (§2).** Video tiled small shimmers because the texture has no mip chain. Options: (a) cap density/grid count in UI (cheapest, ship-now); (b) generate mipmaps after each `texSubImage2D` (real per-frame GPU cost — only if shimmer is a real complaint); (c) switch min filter to `LINEAR` + accept it. Default: **(a)** — a sane Cols/Rows cap and a soft density ceiling.
- **Per-tile video border.** The border (§3.4 Blocker 2) is field-scoped via `_rd`. A per-cell border would compute `_rd` from the cell SDF (like `applyRadius`). Genuine feature, but scope creep — backlog only on request.

---

## 8. "Grid with limited repeat" — what the user asked about

The user proposed this as a *cost mitigation*. **It isn't needed for cost** (§2 — tile count is free). But **Grid mode already is** the limited-repeat control: explicit `Cols × Rows`, finite, fills the canvas once (tile-custom.md §5.1). Phase A un-gates it for video for free.

The one real reason to *prefer* a capped grid over infinite density on video is **shimmer** (§2/§7), not CPU. So: expose Grid mode for video (Phase A includes it), keep the Cols/Rows cap (existing 1–16), and Density stays available and equally cheap. Don't frame Grid as a "lite" mode — both are full-cost-equivalent.

---

## 9. Schema additions

**None required.** Phase A reuses `scale` (§4) and the existing tile fields, all already in `_normalizeImageEntry` ([inspector.js:7587](src/editor/inspector.js#L7587)). Phase B adds no fields (it keys off existing `isStackedAlpha`). Adding the per-cell fields to the video *template* (§A.4) is cleanliness, not schema change. `schemaVersion` does **not** bump. Old presets load byte-identical (video `tile` defaults false → non-tiled path unchanged).

---

## 10. Build checklist

**Phase A** — code complete 2026-05-24, verify outstanding
- [x] Remove `!isVideo &&` from the §3.1 flags (keep `img.tile`).
- [x] Path selector → `} else if (img.tile)`.
- [x] `spc` + `mirrorScope` honour `img.tile` for video (`isVideo && !img.tile ? single : stored`).
- [x] Border block gated `!img.tile` → no `_rd` reference when tiling.
- [x] `scale` acts as density when `tile` on; slider relabels "Scale"→"Size" (live, in tileCb handler).
- [x] Un-hide UI gates (Tile toggle for opaque video only) + relax binding guards (`tileOn = entry.tile`).
- [x] Extra UI: video W/H (`.layer-vid-scale-row`) hides in Grid; Border group (`.layer-vid-border-group`) hides when tiling.
- [x] Add tile fields to video template.
- [x] `node --check` clean.
- [x] In-browser verify (Density + Grid; per-cell stack; transparent native-alpha clip) — confirmed by user.
- [x] tile-custom.md cross-link + in-app help (index.html) + promo + README updated 2026-05-24.

**Phase B** — code complete 2026-05-24, macOS verify outstanding
- [x] `sampleGrad` helper (stacked-alpha top/bottom composite + y-derivative halving).
- [x] Threaded through plain tile, tunnel A/B, scatter (`buildScatterSample`).
- [x] Gated on `img.isStackedAlpha` so opaque/native-alpha path is untouched (plain `textureGrad`).
- [x] FX deferral: `stackedTiled` flag disables chromatic/blur/sobel (documented §B.2); wave/pixelate kept (pre-modify `_u`).
- [x] Tile toggle un-hidden for stacked-alpha video.
- [x] `node --check` clean.
- [x] **Verified in a packaged macOS build** — transparent video tiles, all sliders + grouping working.
- [x] Docs/help/promo updated 2026-05-24 (index.html in-app help, promo/index.html, README.md, tile-custom.md).

---

## 11. Out of scope

- Decoding new transparent formats (VP9 alpha is dead — see the project memory + apng-dev.md). Phase B only *tiles* video that already plays transparent.
- Reworking the `getImageData` upload path (§2) — a separate perf task, not tiling.
- Per-tile / per-cell distinct videos (a "video deck") — that's N decodes; explicitly not what tiling is.
