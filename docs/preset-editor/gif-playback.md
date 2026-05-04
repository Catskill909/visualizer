# Animated GIF — Implementation Reference

**Status:** ✅ Complete — May 2026. All known bugs fixed. Speed slider 0.25×–8×. GIF Optimizer shipped.

**Date:** 2026-04-26 (audit) · 2026-05-01 (Phase 2 fixes) · 2026-05-02 (Phase 3 timing fixes)

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
- **Deadline-based timing** — `nextFrameAt += frameDelay` (not `now + frameDelay`) to prevent accumulated drift. Catch-up guard: if `nextFrameAt < now` (e.g. after tab background), snap to `now + frameDelay`.
- Pixel-store state fully saved and restored around each upload — `UNPACK_FLIP_Y_WEBGL`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, `UNPACK_ALIGNMENT`, `UNPACK_COLORSPACE_CONVERSION_WEBGL` — Butterchurn dirties at least some of these between frames.
- Both the standard decode path and the GIF Optimizer path use `TEXTURE_WRAP_S/T = REPEAT`.

### GIF Optimizer path
- `src/editor/gifOptimizer.js` parses the GIF at upload time and returns pre-composited `frames[]` + `delays[]` directly.
- This data is passed as `optimizedData` to `_loadGifTexture`, which skips re-parsing and uses the pre-processed frames.
- Optimizer triggers at upload if: >10 frames, OR longest side >256px, OR file size >1MB.

### Inspector / UI — [src/editor/inspector.js](src/editor/inspector.js)
- Upload path detects `image/gif` and skips canvas resizing (canvas `drawImage` freezes on frame 1 for animated GIFs).
- Layer entry stores `isGif: true, gifSpeed: 2.0` (default 2× native — most web GIFs are 10fps; this targets ~20fps).
- Speed slider (0.25×–8×) renders only for GIF layers; live-updates via `engine.setGifAnimationSpeed(texName, v)` with no reload.
- Persisted in preset JSON; restored on reload.

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
3. Resize — bilinear-quality nearest-neighbor downscale to 256 / 192 / 128px max
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
