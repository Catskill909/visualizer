# Animated GIF — Audit & Research

**Status:** ✅ Phase 2 complete — May 2026. Colour cycling bug fixed; speed slider raised to 8×.

**Date:** 2026-04-26 (audit) · 2026-05-01 (fixes)

---

## TL;DR

1. **A speed slider already exists** (0.25× – 4×) on every GIF layer ([inspector.js:1713](src/editor/inspector.js#L1713), [visualizer.js:719](src/visualizer.js#L719)). It is not new work.
2. **It has a known unresolved bug**: at 2×–4× the colours visibly cycle/shift each frame. This is documented in the prior project memory and points to WebGL pixel-store state contamination in the render-loop tick path.
3. **"Slowness" has at least three independent root causes** — we don't yet know which one(s) the user is actually seeing. Before any code change we should add one diagnostic log and read the numbers from a real GIF.
4. **Recommended path:** *diagnose first, then fix the colour-cycling bug, then (optionally) expand the speed UI.* Do **not** rip out the architecture — it is sound. Avoid speculative rewrites (per the [verify-before-coding](../.claude/projects/-Users-paulhenshaw-Desktop-winamp-screen/memory/feedback_verify_before_coding.md) feedback rule).

---

## 1. Current Architecture (verified against code)

The GIF feature is wired through three files:

### Decode & upload — [src/visualizer.js:734](src/visualizer.js#L734)
- `gifuct-js` parses the bytes, `decompressFrames(gif, true)` returns per-frame patches.
- Frames are composited in pure JS into `Uint8ClampedArray` snapshots. **No canvas 2D anywhere** — this was a deliberate choice to bypass premultiplied-alpha roundtripping in the canvas pipeline.
- A WebGL texture is created and registered directly on `visualizer.renderer.image.samplers[name]`, bypassing Butterchurn's `loadExtraImages` (which guards against re-creation and only accepts URL strings).
- Native GIF delays are stored in `delays[]`, with a floor: [visualizer.js:792](src/visualizer.js#L792)
  ```js
  delays.push(Math.max((f.delay || 10) * 10, 20));
  ```
  → minimum 20ms (50 fps cap), default 100ms (10 fps) when `f.delay` is missing or zero.

### Tick — [src/visualizer.js:823](src/visualizer.js#L823)
- Called once per `requestAnimationFrame` from `startRenderLoop()` at [visualizer.js:506](src/visualizer.js#L506), **before** `this.visualizer.render()`.
- Advance condition: `if (now < anim.nextFrameAt) continue;` — a deadline check, not a fixed cadence.
- Uses `texSubImage2D` (in-place GPU write, no realloc) — already optimised.
- Speed multiplier is applied here: `nextFrameAt = now + delays[frameIndex] / speed` ([visualizer.js:829](src/visualizer.js#L829)).

### Inspector / UI — [src/editor/inspector.js](src/editor/inspector.js)
- Upload path detects `image/gif` and skips canvas resizing ([inspector.js:41](src/editor/inspector.js#L41)).
- Layer entry stores `isGif: true, gifSpeed: 1.0` ([inspector.js:1463](src/editor/inspector.js#L1463)).
- Card conditionally renders the Speed slider only for GIF layers ([inspector.js:1708](src/editor/inspector.js#L1708)).
- Slider live-updates the running animation via `engine.setGifAnimationSpeed(texName, v)` ([inspector.js:1886](src/editor/inspector.js#L1886)) — no reload required.
- Persisted in preset JSON; restored on reload ([inspector.js:413](src/visualizer.js#L413)).

**Verdict: the architecture is correct.** Frames are pre-decoded once, composited in JS, uploaded with the cheapest possible GPU path. The decision tree was right: don't introduce a canvas 2D step, don't re-decode per frame, don't go through `loadExtraImages`.

---

## 2. Why does playback "feel slow"? — Three independent causes

Before doing any work, we need to know which of these the user is actually hitting. They have very different fixes.

### Cause A — The GIF itself encodes long delays
Many GIFs in the wild are saved with `delay = 10` (100ms / 10 fps) or higher, *especially* GIFs from giphy/tenor/older meme files. The GIF is literally that slow at 1×; the engine is honouring the file.

- **Symptom:** Animation looks choppy/sluggish even with no other layers active.
- **Confirm:** add `console.log(name, delays)` once in `_loadGifTexture`. If most entries are ≥ 100, the source is slow.
- **Fix:** the existing 0.25–4× speed multiplier already handles this — but only once the colour bug is fixed.

### Cause B — Browser-floor clamping (irrelevant here, but worth ruling out)
Historically browsers clamped GIF delays of 0–1cs to 100ms. We bypass that by using `gifuct-js` and our own ticker, with a 20ms floor. So this is **not** affecting us — but if the test GIF was authored assuming the browser would clamp, raw playback may now be much faster than the author intended (different perceptual problem). Unlikely to be the user's complaint, but worth knowing.

### Cause C — `requestAnimationFrame` cap
The tick is driven by rAF. On a 60 Hz display the maximum effective GIF frame rate is 60 fps, regardless of native delay. On a 120 Hz panel, 120 fps. This caps speed × native_fps. For a 10 fps GIF at 4×, target = 40 fps, well within rAF — fine. For a 30 fps GIF at 4×, target = 120 fps, which a 60 Hz display cannot deliver — frames will be silently dropped/coalesced.

- **Symptom:** Speed slider stops increasing perceived speed past a certain point.
- **Confirm:** observe whether 2× → 4× looks identical for a fast GIF.
- **Fix:** mostly a non-issue; users rarely notice a 60 fps ceiling. If we ever want to exceed it we have to leave the rAF tick (setTimeout-based ticker, or duplicate frames in a precomputed schedule).

### Cause D — The colour cycling bug forces users to keep speed = 1×
This may be the *real* user complaint. If the slider is broken at high values, the user effectively has no speed control and the GIF feels stuck at native speed. Fixing the bug **is** the speed-control feature, in practical terms.

---

## 3. The Blocking Bug — colour cycling at speed > 1×

Documented in prior memory. Reproducing it concisely:

- **Symptom:** Frame 0 (initial upload outside the render loop) renders correctly. Once the tick advances frames inside the render loop at high speed, colours shift each frame.
- **Already tried & ruled out:**
  - Canvas premultiplied-alpha roundtrip (replaced with pure-JS compositing).
  - `UNPACK_FLIP_Y_WEBGL` reset (added explicit `pixelStorei(false)` before each upload).
- **Leading hypothesis:** WebGL pixel-store / texture-unit state set by Butterchurn's render code leaks into our `texSubImage2D` calls because the tick now runs *inside* the render loop. The initial upload runs *outside* the loop and is not affected — strong asymmetry signal.

### Specific suspects to check (in priority order)
1. `UNPACK_PREMULTIPLY_ALPHA_WEBGL` — Butterchurn may set this true somewhere; would explain colour shift on frames with alpha.
2. `UNPACK_COLORSPACE_CONVERSION_WEBGL` — sRGB conversion can subtly alter RGB channels.
3. `UNPACK_ALIGNMENT` — usually 4; a stale 1 or 8 would corrupt strides, but the symptom would be geometric tearing, not colour shift. Lower priority.
4. `gl.activeTexture` / current texture-unit binding — `bindTexture` might be applying to the wrong unit if Butterchurn left a non-default unit active. Could cause us to upload pixels into a Butterchurn-owned texture (e.g. the comp buffer) — that would *absolutely* manifest as colour cycling.
5. Active framebuffer (`FRAMEBUFFER_BINDING`) — irrelevant for `texSubImage2D` but confirm.

### Concrete next-step diagnostic (before any fix)
Add this once at the top of `_tickGifAnimations`:
```js
if (!this._gifLoggedOnce) {
  this._gifLoggedOnce = true;
  const g = this._gifAnimations.values().next().value?.gl;
  if (g) console.log('[GIF tick state]', {
    flipY: g.getParameter(g.UNPACK_FLIP_Y_WEBGL),
    premul: g.getParameter(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
    colorspace: g.getParameter(g.UNPACK_COLORSPACE_CONVERSION_WEBGL),
    align: g.getParameter(g.UNPACK_ALIGNMENT),
    activeTex: g.getParameter(g.ACTIVE_TEXTURE) - g.TEXTURE0,
    boundTex: g.getParameter(g.TEXTURE_BINDING_2D),
  });
}
```
Compare to the same readout at the end of `_loadGifTexture` (where rendering is correct). The diff is the bug.

### Most likely fix
Save and restore the entire pixel-store cluster around our upload — defensive, cheap, doesn't require knowing exactly which param Butterchurn touches:
```js
const prevAlign     = gl.getParameter(gl.UNPACK_ALIGNMENT);
const prevFlip      = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
const prevPremul    = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
const prevColor     = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
gl.texSubImage2D(...);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, prevAlign);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremul);
gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, prevColor);
```
And explicitly bind to a known texture unit before uploading: `gl.activeTexture(gl.TEXTURE0); gl.bindTexture(...);` then restore. (One small note: changing the active unit could itself perturb Butterchurn — safer to *not* change it and just bind to whatever unit is currently active, since `texSubImage2D` only needs `TEXTURE_BINDING_2D` on the active unit to be our texture.)

---

## 4. Alternative architectures — researched, not recommended (yet)

These are the credible "rip and replace" paths. None of them is worth the cost while the existing path has one isolated bug.

### A. WebCodecs `ImageDecoder`
Modern Chromium / Safari 17+ exposes `new ImageDecoder({ data, type: 'image/gif' })` with native, off-main-thread frame decode. Returns `VideoFrame` objects with native timestamps and direct `texImage2D` upload via `gl.texImage2D(target, level, format, type, videoFrame)`.

- **Pros:** native decode (faster), correct colour space, no per-frame JS compositing, hardware paths on some platforms.
- **Cons:** Safari < 17 / older iPad Safari support is patchy. Per the existing memory, iPad has been a recurring problem area for this app — adding a hard WebCodecs dependency would regress that audience. Frames returned as `VideoFrame` may bring their own colour-space surprises that *also* require pixel-store guards.
- **Verdict:** good *future* upgrade, but does not solve the current bug. Defer.

### B. GIF → MP4/WebM at upload, render via `<video>` texture
Convert the GIF on upload (e.g. via ffmpeg.wasm) to a hardware-decoded video. `<video>.playbackRate` becomes the speed control natively.

- **Pros:** real hardware decode, true variable speed, smaller asset size, scrubbing for free.
- **Cons:** Massive scope. ffmpeg.wasm is a ~25 MB dependency. Adds a multi-second upload latency. iOS Safari restricts unmuted video autoplay. Loses lossless colour fidelity (video codecs are chroma-subsampled).
- **Verdict:** wrong tradeoff for a small per-layer asset.

### C. Pre-built sprite atlas
Lay all frames out into a single large texture; advance via UV offset in the shader.

- **Pros:** zero per-frame CPU/GPU upload cost. Theoretically the fastest possible playback.
- **Cons:** Requires modifying Butterchurn's compiled comp shader to accept a per-layer time uniform, or hijacking an existing one. Fragile. Texture size limits (4096² typical) cap GIF length × resolution. Per-frame disposal logic still has to happen at atlas-build time.
- **Verdict:** elegant in isolation, ugly inside Butterchurn's preset format.

### D. Decode in a Worker
Move `parseGIF` + `decompressFrames` into a Web Worker; ship `Uint8ClampedArray`s back via `postMessage` with `Transferable`.

- **Pros:** removes upload-time stall on big GIFs.
- **Cons:** doesn't address the bug or the playback-speed concern at all. It's a UX polish for the upload moment.
- **Verdict:** orthogonal. Nice-to-have someday.

---

## 5a. Performance findings (May 2026)

After fixing the colour cycling bug and raising the slider to 8×, a new observation: performance degrades when audio reactivity is enabled on GIF layers. Root causes identified:

| Cost | CPU or GPU | Notes |
|------|-----------|-------|
| GLSL pixel shader per layer | GPU | Every image layer adds UV transform + texture sample + blend per pixel. GIFs are no different from static images here — more layers = more GPU work. |
| `texSubImage2D` per GIF per frame | CPU→GPU bus | One GIF = fine. 3+ large GIFs at high speed = multiple CPU→GPU transfers competing per 16ms frame. |
| `_buildCompShader()` + deep clone on every control change | CPU only | Rebuilds the entire GLSL string + `JSON.parse(JSON.stringify(...))` on every slider move. GPU idle during this. A **16ms debounce** on `_buildCompShader()` would prevent 30 recompiles/sec during rapid edits. |

### Does a better GPU help automatically?
- **Yes for GLSL execution** — faster GPU = more pixels/sec, no settings needed.
- **Partially for `texSubImage2D`** — limited by memory bandwidth, not shader cores.
- **No for JS CPU costs** — shader string building and deep cloning are CPU-only. GPU is idle.

### Practical limits
- 1–2 GIF layers: smooth on any device
- 3–4 GIF layers: fine on dedicated GPU, may stutter on integrated graphics
- 5+ GIFs or GIFs > 1024 px: expect slowdown regardless of GPU

### Debounce optimisation ✅ implemented May 2026
The per-layer `refresh()` function in `_mountLayerCard()` now uses a 16ms `setTimeout` debounce via `this._shaderRebuildTimer`. Rapid slider moves coalesce into a single `_buildCompShader()` + `_applyToEngine()` call per frame instead of 30+/sec. Undo/redo, variation switches, and palette changes are unaffected — they call `_applyToEngine()` directly and remain immediate.

---

## 5. Recommended path forward

**Phase 1 — Diagnose (10 min, no production code change)**
1. Add the one-shot `console.log` from §3 to `_tickGifAnimations` and a matching one at the end of `_loadGifTexture`.
2. Load a test GIF and a test preset. Compare the two readouts.
3. Also log `delays[]` once on upload — confirms whether the source GIF is genuinely slow (Cause A) or fast.
4. Decide based on evidence, not theory (per [verify-before-coding](memory/feedback_verify_before_coding.md)).

**Phase 2 — Fix the colour cycling bug**
- Apply the pixel-store save/restore wrapper from §3 around the `texSubImage2D` call in `_tickGifAnimations`.
- Test at 1×, 2×, 4× and confirm colour stability.
- Remove the diagnostic logs.

**Phase 3 — Speed-control polish (only if Phase 2 lands cleanly)**
Optional, in priority order:
- **Range:** keep 0.25× – 4×. It's plenty; users don't need 8×.
- **Preset chips:** add `0.5× / 1× / 2×` quick buttons next to the slider for one-click resets — small UX win.
- **"Pause" button:** treating speed = 0 as a special case so users can freeze a GIF on its current frame for a static look. Already supported by the `Math.max(0.01, speed)` floor — would need a discrete button to toggle.
- **Audio-reactive speed:** new control `gifSpeedReact` (0–1) — modulates `speed` by `bass` (or whatever `reactSource` the layer uses). Plays into the existing audio system. Cool, but only worth it if users ask.

**Do NOT:**
- Replace `gifuct-js` with WebCodecs or video. Big surface area, no payoff for the current pain point.
- Move the tick out of the render loop. The bug is GL state leakage, not the tick location; moving it would mask the real issue and might create new ordering problems with `visualizer.render()`.
- Touch Butterchurn internals.

---

## 6. Open questions for the user

1. **Which GIFs feel slow?** — a specific URL or attached file would let us check `delays[]` directly.
2. **Have you tried the existing speed slider?** If yes, did you see the colour cycling? That tells us whether the bug is the actual blocker, or whether the user simply hasn't found the slider.
3. **iPad in scope?** — if yes, any new approach must avoid WebCodecs-only paths.

---

## 7. GPU/Performance Strategy — Design Decision

> Captured from conversation, Apr 2026. Research only — not yet implemented.

### Observed behaviour

Loading a large animated GIF in the editor caused slowdown but **no crash**. This is expected — WebGL and the browser compositor shed frames gracefully under pressure. Audio continues on a separate thread. The worst case is choppy visuals, not data loss or tab death.

### Why "disable on slow GPU" isn't viable

Detecting GPU capability reliably in the browser is nearly impossible:
- `WEBGL_debug_renderer_info` — deprecated/blocked in most browsers (fingerprinting concerns)
- `navigator.gpu` (WebGPU) — not universally available
- Frame time measurement — the only real signal, but you only know you're over budget *after* you've already loaded the heavy asset

### Decision: warnings only, no hard limits

This is creative software. The degradation is graceful. The right model is:
- **Inform** the user when things are getting heavy
- **Never block** a creative decision based on a heuristic that may be wrong
- **Trust** the user — sluggishness is its own feedback

See `custom-preset-editor.md` § "Performance — Realistic CPU/GPU Budget" for the full warning indicator design (green/amber/red frame time indicator, layer count + pixel_eqs warnings).

### Contextual GIF warning (to implement with GIF optimizer tool)

On first GIF upload (one-time, dismissible):
> *"Large animated GIFs increase GPU load. If playback slows, use the Optimize tool to reduce file size or frame count before adding."*

Not a block. Not a disable. Just information at the moment it's relevant.

---

## 8. GIF Optimization Tool — ✅ SHIPPED May 2026

> **Status:** Live in production. Upload-time modal with frame reduction, resize, and live preview.
>
> **Files:** `src/editor/gifOptimizer.js`, `editor.html` modal, `inspector.js` integration, `visualizer.js` optimized data path.
>
> **Key formula:** Frame delays scaled by `keepEveryN / 3` factor for smooth animation with fewer frames (clamped 10-500ms).

### Motivation

Real-world testing showed a **480×360 GIF with many frames (12MB)** immediately slows down when effects are applied. Even modestly-sized GIFs can overwhelm the GPU if they have excessive frame counts. The optimizer must intercept at upload with **much more aggressive defaults** than originally planned.

### What already exists

- `resizeImageFile()` in `inspector.js` — resizes static images. Skips GIFs (just grabs first frame).
- `gifuct-js` — already imported in `visualizer.js` for playback. Can also parse frames for editing.
- `gifSpeed` slider — per-layer speed control (0.25×–8×). Useful for playback feel but doesn't reduce actual file weight.

### Upload-Time Modal (Revised Thresholds)

**When it triggers (more aggressive):**
- Frame count > **10 frames**, OR
- Resolution > **256px** (longest side), OR
- File size > **1MB**

Small optimized GIFs load silently. Anything larger gets the modal.

**Modal stats display (match Preview.app format):**
```
soultrain2.gif  ·  480 × 360  ·  86 frames  ·  12 MB
```
- File name
- Dimensions (width × height)
- Frame count (with visual frame strip showing indices)
- File size
- Estimated GPU memory impact (frames × width × height × 4 bytes)

**Three action cards:**

| Card | Content |
|------|---------|
| **Optimize** (recommended badge) | Inline tools: <br>• Resize: 480px → **256px / 192px / 128px** (aggressive defaults) <br>• Frame trim: "Keep every Nth" with live preview <br>• Target: **4–6 frames total** for large GIFs <br>• Estimated GPU after: updates live <br>• `[Apply & Add Layer]` button |
| **Use As-Is** | One-click escape hatch. Warning: "Large GIFs with effects may slow down. Optimize later via layer menu." |
| **Cancel** | Dismiss, no layer added |

### Tool feature set

| Feature | What it does | Revised Default |
|---------|-------------|-----------------|
| **Parse + frame strip** | Thumbnail row with frame index numbers (like Preview.app) | Show all, numbered |
| **Keep every Nth frame** | Reduce frame count; delays scaled by `keepEveryN / 3` for smooth playback | Target 8-12 frames for large GIFs |
| **Remove specific frames** | Click to toggle individual frames | Optional refinement |
| **Set uniform frame delay** | Override native delays with single value | Optional |
| **Resize** | Scale all frames to target max dimension | **256px max** (aggressive) |
| **Re-encode to GIF** | Output new `.gif` blob for export | Phase 2 — not required for upload optimization |
| **Hand off to layer pipeline** | Feed optimized blob into `_addImageLayer()` | Immediate, no file saved |

### Why no `gifenc` dependency for Phase 1

Upload-time optimization happens **in-memory** before `_loadGifTexture`:
1. Parse with `gifuct-js` → frame array
2. Resize: draw each frame to OffscreenCanvas at target size
3. Frame trim: filter array, adjust delays
4. Pass reduced frame set directly to `_loadGifTexture` — no re-encoding needed

The `gifenc` dependency only becomes necessary if we add "Export optimized GIF to file" later.

### UI entry points

**Primary: Upload-time modal (threshold-gated)**
Intercept at drag-drop / file picker before layer creation. User makes informed choice with no regret.

**Secondary: Layer card "Optimize…" button**
Re-open optimizer for existing GIF layers. Same UI, works on source file reference.

### Implementation Summary (Shipped)

All steps completed:
1. ✅ Upload detection — `parseGifFile()` on drop, aggressive thresholds (>10 frames, >256px, >1MB)
2. ✅ Modal shell — stats header + Preview.app-style display + three action cards
3. ✅ Frame strip UI — 80×80px thumbnails with original frame index numbers (up to 20 shown)
4. ✅ Resize + frame trim — "Keep every Nth" slider (1-20), size buttons (Original/256/192/128px)
5. ✅ Live preview — instant recalculation of frame count, dimensions, GPU savings %
6. ✅ Pipeline wiring — `optimizedGifData` passed through `_processedGifCache` to visualizer
7. ✅ Delay scaling — `originalDelay × (3/keepEveryN)` for smooth animation (10-500ms clamp)

**Phase 2 (Future):** Layer card "Optimize…" button for re-optimizing existing layers; `gifenc` export to file.

### Relationship to other work

- **Independent of colour cycling bug** — that was fixed in Phase 2 (May 2026)
- **Builds on debounce optimization** — the smoother UI from §5a helps when testing optimized GIFs
- **GPU guidance in User Guide** — see editor.html § "Animated GIFs" for user-facing performance tiers
