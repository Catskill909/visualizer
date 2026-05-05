# Animated GIF — Implementation Reference

**Status:** ✅ Phase 1-4 shipped

**Date:** 2026-04-26 (audit) · 2026-05-01 (Phase 2 fixes) · 2026-05-02 (Phase 3 timing fixes) · 2026-05-04 (Phase 4 plan) · 2026-05-05 (Phase 4 shipped)

---

## Phase 4 shipped — 2026-05-05

All four Phase 4 items are complete. No further planned work in this cycle.

| Phase | Feature | Status |
|-------|---------|--------|
| 4A | Perceptual speed mapping | ✅ Shipped |
| 4C | Alpha Mode (Fade / Preserve) | ✅ Shipped |
| 4B | Stability control | ✅ Shipped |
| 4D | Optimizer guidance (cadence + intent presets) | ✅ Shipped |

---

## Architecture

The GIF feature is wired through three files:

### Decode & upload — [src/visualizer.js](src/visualizer.js) `_loadGifTexture`
- `gifuct-js` parses the bytes; `decompressFrames(gif, true)` returns per-frame patches.
- Frames are composited in pure JS into `Uint8ClampedArray` snapshots. **No canvas 2D anywhere** — deliberate choice to bypass premultiplied-alpha roundtripping. Canvas 2D stores pixels premultiplied internally and `getImageData()` unpremultiplies on read — that roundtrip loses precision and causes colour shift.
- A WebGL texture is created and registered directly on `visualizer.renderer.image.samplers[name]`, bypassing Butterchurn's `loadExtraImages` (which guards against re-creation and only accepts URL strings).
- Native GIF delays are stored in `delays[]` with a 20ms floor:
  ```js
  delays.push(Math.max((f.delay || 10) * 10, 20));
  ```
  Minimum 20ms (50 fps cap), default 100ms (10 fps) when `f.delay` is missing or zero.
- `nextFrameAt` is initialized to `performance.now() + delays[0]` so frame 0 displays for its full duration before the tick advances.

### Tick — [src/visualizer.js](src/visualizer.js) `_tickGifAnimations`
- Called once per `requestAnimationFrame` from `startRenderLoop()`, **before** `this.visualizer.render()`.
- Advance condition: `if (now < anim.nextFrameAt) continue;` — deadline check, not fixed cadence.
- Uses `texSubImage2D` (in-place GPU write, no realloc).
- Speed multiplier: `frameDelay = delays[frameIndex] / speed`.
- **Stability blending** — `stability` (0–1) lerps each frame delay between its native value and `avgDelay / speed`, smoothing uneven cadence without changing overall pace.
- **Deadline-based timing** — `nextFrameAt += frameDelay` (not `now + frameDelay`) to prevent accumulated drift. Catch-up guard: if `nextFrameAt < now` (e.g. after tab background), snap to `now + frameDelay`.
- Pixel-store state fully saved and restored around each upload — `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, `UNPACK_ALIGNMENT`, `UNPACK_COLORSPACE_CONVERSION_WEBGL` — Butterchurn dirties at least some of these between frames.
- Both the standard decode path and the GIF Optimizer path use `TEXTURE_WRAP_S/T = REPEAT`.

### GIF Optimizer path
- `src/editor/gifOptimizer.js` parses the GIF at upload time and returns pre-composited `frames[]` + `delays[]` directly.
- This data is passed as `optimizedData` to `_loadGifTexture`, which skips re-parsing and uses the pre-processed frames.
- Optimizer triggers at upload if: >10 frames, OR longest side >256px, OR file size >1MB.

### Inspector / UI — [src/editor/inspector.js](src/editor/inspector.js)
- Upload path detects `image/gif` and skips canvas resizing (canvas `drawImage` freezes on frame 1 for animated GIFs).
- Layer entry stores `isGif: true, gifSpeed: 2.0, gifStability: 0.0, alphaMode: 'preserve'` for new GIF layers (static images default `alphaMode: 'fade'`).
- **Speed slider** — perceptual (log-curve) mapping; slider position `pos ∈ [0,1]` maps to `speed = 0.25 × 32^pos`. 1× native lands at ~40% travel; 2× at ~60%; 8× at 100%.
- **Stability slider** (0–1) — 0 = native per-frame delays, 1 = perfectly even cadence. Live-updates via `engine.setGifAnimationStability(texName, v)`, no reload.
- **Alpha Mode** (Fade / Preserve) — segmented button. Preserve uses `step(0.1, _t.w)` silhouette in the comp shader so the whole image fades uniformly instead of soft edges disappearing first. Fade is the original `_t.w` multiplication (default for static images).
- All three controls render only for GIF layers (`entry.isGif === true`).
- Persisted in preset JSON; backward-compatible (old presets without `gifStability`/`alphaMode` normalize to `0.0` / `'fade'`).

---

## Disposal type handling

Compositing in both `_loadGifTexture` and `processGifFrames` handles GIF disposal types:

| Disposal | Handling |
|----------|----------|
| 0 / 1 — Do not dispose | Leave composite unchanged (most common) |
| 2 — Restore to background | Clear previous frame region to transparent before applying current patch |
| 3 — Restore to previous | **Not implemented** — treated as type 0. Rare in practice. |

---

## Performance limits

| Layer count | Expected behaviour |
|-------------|-------------------|
| 1–2 GIF layers | Smooth on any device |
| 3–4 GIF layers | Fine on dedicated GPU; may stutter on integrated graphics |
| 5+ GIFs or GIFs >1024px | Expect slowdown regardless of GPU |

Key costs per rAF frame:
- **GLSL pixel shader** (GPU) — every image layer adds UV transform + texture sample + blend per pixel.
- **`texSubImage2D`** (CPU→GPU bus) — one GIF is fine; 3+ large GIFs at high speed creates bus contention.
- **`_buildCompShader()` + deep clone** (CPU only) — 16ms debounce on `refresh()` collapses rapid slider moves into one recompile per frame.

---

## GIF Optimizer — [src/editor/gifOptimizer.js](src/editor/gifOptimizer.js)

Upload-time modal that intercepts large GIFs before layer creation.

**Triggers when:** >10 frames, OR longest side >256px, OR file size >1MB.

**What it does:**
1. Parses with `gifuct-js` → full frame composite array
2. Frame trim — "Keep every Nth" (slider 1–20); delays scaled by `keepEveryN / 2` factor (e.g. keepEveryN=4 → 2× faster per frame, keepEveryN=6 → 3× faster); floored at 1× so keepEveryN=1–2 preserves native delay
3. Resize — nearest-neighbor downscale to 256 / 192 / 128px max
4. Hands pre-processed `{ frames, delays, width, height }` directly to `_loadGifTexture` — no re-encoding, no file I/O

**UI:** Three action cards — Optimize (recommended), Use As-Is (with warning), Cancel.

**Phase 2 (future):** Layer card "Optimize…" button to re-optimize an existing layer; `gifenc` re-export to `.gif` file.

---

## Bug fix history

### Phase 2 — May 2026
- **Colour cycling at speed >1×** — WebGL pixel-store state (`UNPACK_PREMULTIPLY_ALPHA_WEBGL` and others) set by Butterchurn leaked into our `texSubImage2D` calls. Fixed with full save/restore around every upload.
- **Speed slider** raised from 4× to 8×.
- **16ms debounce** on `_buildCompShader()` via `_shaderRebuildTimer` to prevent 30+ recompiles/sec during rapid slider edits.

### Phase 3 — May 2026
- **Frame 0 always skipped** — `nextFrameAt` initialized to `0` (standard path) or `performance.now()` (optimized path). First tick always fired immediately, advancing straight to frame 1. Fixed: `nextFrameAt = performance.now() + delays[0]`.
- **Timing drift** — `nextFrameAt = now + delay` accumulated render latency each frame. Fixed: deadline-based `nextFrameAt += delay` with catch-up guard for tab backgrounding.
- **Missing `UNPACK_COLORSPACE_CONVERSION_WEBGL`** — pixel-store guard saved/restored Flip/Premul/Align but not colorspace. Added to the save/restore block with `gl.NONE` before upload.
- **Inconsistent texture wrapping** — GIF Optimizer path used `CLAMP_TO_EDGE`; standard path used `REPEAT`. Same GIF behaved differently depending on upload path. Both now use `REPEAT`.

---

## Phase 4 Development Plan (single source of truth)

Goal: keep GIF playback architecture intact, but make motion easier to control and fix the GIF-only opacity behavior that can look like image shrink.

### Phase checklist

#### Phase 4A — Perceptual speed mapping
- [x] Keep slider UI range at 0.25×-8×.
- [x] Implement perceptual mapping for GIF speed.
- [x] Validate control feel on low, medium, and high motion GIFs.
- [x] Confirm no regression in frame-0 hold and deadline drift behavior.

#### Phase 4C — GIF opacity silhouette mode
- [x] Add per-layer alpha mode field for image layers (Fade/Preserve).
- [x] Default newly added GIF layers to Preserve.
- [x] Keep static image default as Fade.
- [x] Validate opacity 1.0 -> 0.3 on soft-edge GIFs without perceived shrink in Preserve mode.

#### Phase 4B — Stability control
- [x] Add per-layer stability control (0..1) for GIF timing.
- [x] Keep speed and stability independent.
- [x] Tune normalization so motion smooths without flattening rhythm.
- [x] Validate on uneven-delay cinematic GIFs.

#### Phase 4D — Optimizer guidance
- [x] Add cadence/variance preview in GIF optimizer modal.
- [x] Add intent presets: Smooth Loop / Keep Detail / Lightweight.
- [x] Ensure recommendations are advisory only (no hidden behavior changes).
- [x] Validate parity between standard and optimized playback paths.

#### Final sign-off
- [ ] Test 1, 3, and 5 GIF layer scenes.
- [ ] Test soft-edge GIF, hard-edge GIF, cinematic uneven-delay GIF, and high-frame-count GIF.
- [ ] Confirm no behavior change for non-GIF image layers.
- [ ] Update this doc status/date when Phase 4 ships.

---

## Bug fix history

### Phase 4 — May 2026
- **Opacity slider appeared to change image size** — `layer-gif-speed-sl` was not excluded from the generic index-based slider loop. On GIF layers it occupied slot 0, pushing every subsequent slider's `sliderKeys` mapping one position off (opacity wrote to `spacing`, etc.). Fixed by adding `.layer-gif-stability-sl` and `.layer-gif-speed-sl` to the `:not()` exclusion list.
- **Speed slider feel (linear → perceptual)** — Slider DOM range changed to `[0, 1]` position; `speed = 0.25 × 32^pos`. Old stored `gifSpeed` values are mapped back to position at render time (`Math.log(v/0.25)/Math.log(32)`).
- **GIF opacity silhouette collapse** — GLSL `_op` line changed for `alphaMode === 'preserve'` layers: `step(0.1, _t.w)` replaces raw `_t.w` so soft alpha edges don't vanish before the interior.
- **Stability field missing from generic slider loop** — `layer-gif-stability-sl` added to `:not()` exclusion list in the same pass.

### What is currently happening

1. GIF speed uses one global multiplier (`frameDelay = nativeDelay / speed`).
2. Timing is technically stable, but user control feel is inconsistent across different source GIF delay patterns.
3. GIF opacity in the image shader multiplies sampled texture alpha and layer opacity together.
4. On soft-edge GIFs this can make edges disappear first, which reads as visual size shrink even when scale is unchanged.

### What should happen instead

1. Speed should feel predictable across low, medium, and high motion GIFs.
2. Users should be able to tame jitter separately from overall pace.
3. Lowering opacity on GIF stickers should not default to silhouette collapse.
4. Existing presets should continue to load with no behavioral breakage.

### Phase 4A — Control feel foundation (recommended first)

Scope:
- Keep existing 0.25×-8× UI range.
- Change internal mapping to a perceptual (log-like) curve.
- No new architecture, no decode path changes.

Why:
- Biggest UX win for lowest risk.
- Makes the slider less twitchy at high speed and less coarse around 1×-2×.

Acceptance:
- Users reach target speed in fewer slider moves vs current baseline.

### Phase 4B — Timing stabilization controls

Scope:
- Add a separate per-layer stability control (0..1) that compresses delay variance.
- Keep speed and stability independent.
- Add optional mode toggle later: Multiplier vs Target FPS (8/12/15/20/24/30).

Why:
- One control handles pace; one handles jitter.
- Prevents "faster but messier" tradeoff.

Acceptance:
- High-jitter GIFs look smoother at higher stability without obvious rhythm flattening.

### Phase 4C — GIF opacity silhouette bug

Bug:
- Opacity slider can make some animated GIFs look smaller.

Root cause hypothesis (high confidence):
- Not geometric scaling.
- Soft alpha edges in GIF frames fade before interior when global opacity is reduced.
- The eye interprets edge-loss as shrink.

Scope:
- Add per-layer Alpha Mode in Image tab:
  - Fade (current behavior)
  - Preserve (silhouette-stable fade)
- Default GIF layers to Preserve.
- Keep static images on Fade by default.

Acceptance:
- On representative soft-edge GIFs, opacity 1.0 -> 0.3 in Preserve mode should not show obvious silhouette contraction.
- Fade mode must remain equivalent to current behavior.

### Phase 4D — Optimizer guidance pass

Scope:
- Show predicted playback outcome in optimizer modal:
  - estimated average cadence/FPS
  - delay variance indicator
- Add one-click intent presets:
  - Smooth Loop
  - Keep Detail
  - Lightweight

Why:
- Reduces guesswork before layer creation.
- Prevents accidental compounding of frame trim + high speed.

### Planned implementation order

1. Phase 4A (perceptual speed mapping)
2. Phase 4C (opacity silhouette mode)
3. Phase 4B (stability control)
4. Phase 4D (optimizer guidance)

Rationale:
- 4A and 4C solve current user pain fastest.
- 4B adds deeper control once baseline feel is improved.
- 4D is UX polish that amplifies the earlier work.

### Validation set for all Phase 4 work

Test with:
1. Soft-edge animated sticker GIF (transparent edges)
2. Hard-edge GIF
3. Medium cinematic GIF with uneven native delays
4. Large high-frame-count GIF

Validate:
1. 1, 3, and 5 GIF layer scenes
2. Standard path and optimizer path
3. No regression in Phase 3 timing fixes (frame-0 hold, drift guard, pixel-store restore)

---

## Alternative architectures — researched, not recommended

### WebCodecs `ImageDecoder`
Modern Chromium / Safari 17+ exposes `new ImageDecoder({ data, type: 'image/gif' })` with native, off-main-thread frame decode. Returns `VideoFrame` objects uploadable directly via `texImage2D`.

- **Pros:** native decode, correct colour space, no per-frame JS compositing.
- **Cons:** Safari <17 / older iPad support is patchy. `VideoFrame` may bring its own colour-space surprises.
- **Verdict:** good future upgrade; does not improve anything that isn't already working.

### GIF → MP4/WebM at upload, render via `<video>` texture
- **Cons:** ffmpeg.wasm is ~25MB. Multi-second upload latency. iOS Safari restricts unmuted video autoplay. Chroma subsampling loses colour fidelity.
- **Verdict:** wrong tradeoff.

### Pre-built sprite atlas
All frames in one texture; advance via UV offset in shader.
- **Cons:** requires modifying Butterchurn's compiled comp shader. Texture size limits cap GIF length × resolution.
- **Verdict:** elegant in isolation, fragile inside Butterchurn's preset format.

### Decode in a Worker
Move `parseGIF` + `decompressFrames` to a Web Worker; transfer `Uint8ClampedArray`s back.
- **Pros:** removes upload-time stall on big GIFs.
- **Cons:** doesn't affect playback at all. UX polish for the upload moment only.
- **Verdict:** orthogonal nice-to-have.
