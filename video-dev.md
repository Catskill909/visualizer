# Video Layer Feature — Brainstorm & Audit Document

> **Status:** ✅ **SHIPPED** — Phase 1 Complete + Auto-Transcoding  
> **Date:** May 9, 2026  
> **Goal:** Video layer playback with auto-transcoding (720p), macOS WKWebView support

**Latest:** Auto-transcoding implemented — drag 4K videos, automatically optimized to 720p

---

## Current Status & Phase Roadmap

> **As of May 12, 2026**

### ✅ Shipped — All Complete

| Feature | Shipped |
|---|---|
| Core video playback — MP4/WebM drag-in, 720p limit, play/pause/loop/scrub | May 7 |
| macOS WKWebView fixes — `playsInline`, blob URL lifecycle, manual loop restart | May 7 |
| Playback speed control 0.25×–4× | May 9 |
| Auto-transcoding — drag 4K/1080p → auto-converts to 720p via FFmpeg.wasm | May 9 |
| Color grading — Brightness, Contrast, Gamma (GLSL, video layers only) | May 9 |
| VJ Effects — Luma Key, Wave Distort, Invert, Threshold, Pixelate, Scan Lines, Film Grain | May 8 |
| Width/Height sliders — independent non-uniform scaling 0.25×–4× (video only) | May 11 |
| Video Border — width, color picker, feather (video only) | May 11 |
| **Transparent WebM (web + Windows)** — WebM files bypass 720p transcoder; `clearRect` canvas fix eliminates alpha trail accumulation | May 12 |
| **Transparent WebM on macOS — Stacked-Alpha** (Sammie Roto fix) — ffmpeg sidecar converts VP9-alpha → 2× tall VP9; WebGL composites top half RGB + bottom half luma; live progress toast during conversion | May 13 |

### 🔨 Up Next

| Feature | § | Status |
|---|---|---|
| **Clipper** (`/clipper.html`) — video trim tool, In/Out markers, FFmpeg trim-encode | §19 | 📋 Active planning |

### ⏭️ Skipped / Blocked

| Feature | Reason |
|---|---|
| Frame Buffer / Echo (Phase B) | Butterchurn's built-in `echo_alpha` / `decay` / `echo_zoom` already covers this — skip |
| Seamless Video Loop | Three hard browser walls — do not retry. See §26. |

### 📋 Future (after Clipper is stable)

| Feature | § | Notes |
|---|---|---|
| Layer Processing Panel — Chroma Key, Frame Diff, Blur/Desat background | §22 | Canvas-first, no AI needed |
| Subject Isolation — YOLO/SAM WASM pipeline | §23 | Long-term, not prioritized |

---

## 1. Executive Summary

Video layers would extend the existing image layer system (5 layers, GLSL compositing) to support video files (MP4, WebM, potentially GIFV). The architecture can reuse ~70% of the image layer controls while adding video-specific playback and color-grading features.

**Key insight from audit:** The existing GIF animation system (`_tickGifAnimations`, `texSubImage2D` frame upload) proves video texture streaming is architecturally feasible. Video = higher frame rate + audio sync potential.

---

## 2. Simplified Video Layer Model (No Tiling)

**Core decision:** Video layers are **single-instance only**. No tiling controls — duplication happens via **Mirror** (H/V/Quad/Kaleido) if desired. This dramatically simplifies the GLSL, UI, and mental model.

### Default State (Video vs Image)

| Control | Image Default | Video Default | Rationale |
|---------|---------------|---------------|-----------|
| **Tile** | ✅ ON | ❌ **Removed** | Videos are content, not patterns |
| **Scale** | Size (density) 1.0 | **Scale 0.6** | Coverage %, not tile count |
| **Spacing** | 0 | ❌ **Removed** | No tiles = no spacing |
| **Tile Width/Height** | 1.0 | ❌ **Removed** | No tiles = no aspect control needed |
| **Mirror Scope** | 'tile'/'field' | ❌ **Removed** | Single instance, scope is always 'field' |
| **Blend Mode** | Overlay | **Screen** | Lighter touch for video |
| **Opacity** | 0.8 | **1.0** | Videos carry their own light |
| **Orbit** | 0 | 0 | Centered by default |
| **Mirror** | Off | Off | User opts into duplication |

### What We Reuse

| Control | Reuse | Notes |
|---------|-------|-------|
| **Blend mode** | ✅ Direct | Same compositing math |
| **Opacity** / **Beat Fade** | ✅ Direct | Alpha + audio reactivity |
| **Scale** | ✅ Modified | 0.1–2.0 coverage, not tile density |
| **Pulse** / **Shrink** | ✅ Direct | Bass-driven scale |
| **Spin** | ✅ Direct | Rotation speed (no "group" variant needed) |
| **Angle** | ✅ Direct | Static rotation offset |
| **Skew X/Y** | ✅ Direct | Shear transform |
| **Perspective X/Y** | ✅ Direct | Projective distortion |
| **Orbit** / **Lissajous** | ✅ Direct | Path motion |
| **Bounce** / **Sway** / **Wander** | ✅ Direct | Position modulation |
| **Mirror** (H/V/Quad/Kaleido) | ✅ Direct | UV fold for duplication |
| **Tunnel** | ✅ Direct | Infinite zoom (works on single quad) |
| **Shake** | ✅ Direct | Random jolt |
| **Solo/Mute** | ✅ Direct | Layer visibility |
| **Center XY pad** | ✅ Direct | Anchor point |
| **Chromatic Aberration** | ✅ Direct | RGB split |
| **Posterize** | ✅ Direct | Color banding |

**Estimated UI code reuse:** ~70% — higher than tiled version because we drop entire control rows.

---

## 3. Video-Specific New Controls

### 3.1 Playback Controls

| Control | Range | Purpose |
|---------|-------|---------|
| **Play/Pause** | Toggle | Manual control |
| **Playback Speed** | 0.25x–4x | Rate multiplier (like GIF speed) |
| **Loop Mode** | On/Off/Ping-Pong | End behavior |
| **Scrub/Seek** | 0–100% | Frame-accurate positioning |
| **Trim In** | 0–95% | Start point offset |
| **Trim Out** | 5–100% | End point cutoff |

### 3.2 Audio-Reactive Video (New Category)

| Control | Behavior |
|---------|----------|
| **Beat Sync** | Jump to specific frame on kick (like waveform) |
| **Scrub by Audio** | Playback position driven by bass/mid/treble level |
| **Speed by Energy** | Playback speed modulated by volume |
| **Reverse on Beat** | Brief backward playback on strong kick |

### 3.3 Color Controls (Video Grading)

These are **new** — image layers only have tint/saturation/hue:

| Control | Range | Use Case |
|---------|-------|----------|
| **Brightness** | 0–2 | Exposure adjustment |
| **Contrast** | 0–2 | Punch/flat look |
| **Saturation** | 0–2 | Vibrancy (extends image layer's per-layer sat) |
| **Hue Rotate** | 0–360° | Color shift |
| **Gamma** | 0.5–2.5 | Midtone curve |
| **Lift** (Shadows RGB) | -1 to +1 | Shadow tint |
| **Gain** (Highlights RGB) | -1 to +1 | Highlight tint |
| **Vignette** | 0–1 | Edge darkening |
| **Vignette Radius** | 0–1 | Falloff control |
| **Color Temperature** | -1 to +1 | Warm/cool shift |
| **Tint (Magenta/Green)** | -1 to +1 | Color balance |
| **Fade** | 0–1 | Lift black point (film look) |
| **Highlights** | -1 to +1 | Recover/blown highlights |
| **Shadows** | -1 to +1 | Shadow detail |

**GLSL Implementation:** These would be a color grading matrix/stack applied after texture sampling, before blend. Could be a reusable `_buildColorGradingBlock()` function.

---

## 4. Technical Architecture Audit

### 4.1 Current GIF/Texture System (Proven Pattern)

From `@/src/visualizer.js`:

```javascript
// GIF texture creation
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, frames[0]);

// Per-frame update (render loop)
gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, anim.frames[anim.frameIndex]);
```

### 4.2 Video → WebGL Path Options

**Option A: Video Element → Canvas → Texture** (Safest, most control)
```javascript
video.addEventListener('play', () => {
  const draw = () => {
    ctx.drawImage(video, 0, 0, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ctx.getImageData(0,0,w,h).data);
    if (!video.paused) requestAnimationFrame(draw);
  };
  draw();
});
```
- **Pros:** Can apply color grading in Canvas 2D before upload, frame-exact control
- **Cons:** Extra copy, CPU overhead

**Option B: Video Element → Direct WebGL Upload** (Fastest)
```javascript
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
```
- **Pros:** Zero-copy, hardware-accelerated
- **Cons:** Limited color preprocessing, browser support varies

**Recommendation:** Start with Option A for color grading flexibility; optimize to Option B if profiling shows bottleneck.

### 4.3 Frame Synchronization

Current GIF uses deadline scheduling (`nextFrameAt += frameDelay`). Video has constant frame rate:

```javascript
// Video sync in render loop
const videoTime = video.currentTime;
const frameIndex = Math.floor(videoTime * fps);
// Upload if frame changed
```

**Key difference:** GIF frames are pre-decoded in memory; video streams from disk/network. Need buffering strategy for scrubbing.

---

## 5. File Format Support

| Format | Decode | Audio | Transparency | Priority |
|--------|--------|-------|--------------|----------|
| **MP4 (H.264)** | Native | Yes | No | P0 — baseline |
| **WebM (VP9)** | Native | Yes | Yes (if coded) | P0 — modern alternative |
| **WebM (AV1)** | Native | Yes | Partial | P1 — emerging |
| **MOV (ProRes)** | No | — | — | Out of scope |
| **GIF** | Already supported | No | Binary | Keep existing path |

**Accept attribute:** `accept="video/mp4,video/webm,video/quicktime"`

### 5.1 Resolution Enforcement with Auto-Transcoding ✅ SHIPPED

**Status:** Auto-transcoding implemented via FFmpeg.wasm — oversized videos are automatically converted to 720p on upload.

**Behavior:**
```javascript
// Upload guard — auto-transcode oversized videos
const MAX_VIDEO_WIDTH = 1280;
const MAX_VIDEO_HEIGHT = 720;

// WebM files bypass transcoding — VP9 streams don't consume frame RAM like GIFs,
// and libvpx-vp9 encoding is not available in the FFmpeg.wasm CDN build.
// A 1080p WebM alpha from Sammie Roto loads directly; macOS converts to stacked-alpha separately (§27).
const isWebM = file.name.toLowerCase().endsWith('.webm') || file.type === 'video/webm';

if (!isWebM && (videoWidth > MAX_VIDEO_WIDTH || videoHeight > MAX_VIDEO_HEIGHT)) {
  // Auto-transcode instead of rejecting (MP4/MOV only)
  showToast(`Video is ${videoWidth}×${videoHeight}. Optimizing to 720p...`);
  file = await transcodeTo720p(file, onProgress);
  showToast(`Optimized: ${originalSize} → ${newSize}`);
}
```

**User Experience:**
- Drag 4K video → "Optimizing to 720p... 45%" → "Optimized: 45MB → 8MB"
- Zero friction — no external tools needed
- Progress updates during ~30-60s conversion (1min 1080p → 720p)

### 5.2 FFmpeg.wasm Implementation Details

**Dependencies:** `@ffmpeg/ffmpeg` + `@ffmpeg/util` (~25MB lazy-loaded)

**Module:** `@/src/videoTranscoder.js`

```javascript
// Lazy-load on first use
const ffmpeg = await getFFmpeg(); // ~25MB fetch once

// Transcode with progress
const transcodedFile = await transcodeTo720p(file, (progress) => {
  showToast(`Optimizing... ${Math.round(progress.percent)}%`);
});
```

**Encoding settings:**
- Scale: `scale=-2:720:flags=lanczos` (maintains aspect, lanczos quality)
- Codec: H.264 `libx264`
- Preset: `fast` (speed/quality balance)
- CRF: `23` (visually lossless)
- Audio: stripped (`-an`) — not needed for VJ visuals

**Storage:**
- Original discarded after transcode
- Only 720p version stored in IndexedDB
- Exports include optimized version (smaller bundle size)

---

## 6. UI/UX Considerations

### 6.1 Layer Card Layout (Simplified — No Tiling)

Cleaner UI with tiling removed:

```
┌─────────────────────────────────────┐
│ ⠿  #1  🎬  myclip.mp4        HD │ ⏸ │ 🔇 │ ⤵ │ ▼ │
├─────────────────────────────────────┤
│ ━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │ ← Scrub bar
│ 0:00                    0:23        │
├─────────────────────────────────────┤
│ [Play] [Speed: 1.0x▼] [Loop: 🔁]   │
│ Trim: [━━━━━●━━━━━●━━━━━━]          │
├─────────────────────────────────────┤
│ Scale      [━━━━━●━━━━━] 0.60      │ ← Simple coverage %
│ Opacity    [━━━━━━━●━━━] 0.85      │
│ Spin       [━━●━━━━━━━━━] 0.2       │
│ Orbit      [●━━━━━━━━━━] 0.0        │
│ Mirror     [None  ↔H  ↕V  ✦Q  ✶K]  │ ← Duplication via mirror
├─────────────────────────────────────┤
│ [Color grading section...]          │
│ Brightness [━━━━●━━━━━━━] 1.0      │
│ Contrast   [━━━━●━━━━━━━] 1.0      │
└─────────────────────────────────────┘
```

**Removed controls:** Tile toggle, Spacing, Tile Width/Height, Mirror Scope

**Simplified:** Size → Scale (clearer mental model)

### 6.2 HD Badge Extension

Video layers show resolution + duration:
- **1080p** • 0:23 (instead of just "HD")

### 6.3 Thumbnail

Video thumbnail = first frame canvas draw (same as GIF)

---

## 7. Shader Integration

### 7.1 Video Block — Single Quad Model

**Simplified GLSL** — no tiling logic, just a single sampled quad:

```glsl
// Video layer (no tiling)
vec2 _uvBase = uv_m - vec2(cx, cy);     // Center offset
_uvBase *= 1.0 / scale;                  // Scale coverage
_uvBase = rotate(_uvBase, spin);         // Rotation

// Apply mirror fold if enabled (creates duplication)
if (mirror != 'none') {
    _uvBase = applyMirror(_uvBase, mirror);
}

// Sample video texture
vec4 _src = texture(sampler_video1, _uvBase + 0.5);

// Color grading stack (new for video)
_src.rgb = applyBrightness(_src.rgb, brightness);
_src.rgb = applyContrast(_src.rgb, contrast);
// ... existing tint, chromatic, posterize...
```

**Key difference from images:**
- No `fract()` wrapping (no tiles)
- No `spacing` offset
- No tile aspect correction
- Mirror fold applies to single quad, creating reflected copies

### 7.2 Uniforms per Video Layer

```glsl
uniform sampler2D sampler_video1;
uniform float video1_scale;              // 0.1–2.0 (replaces size/spacing)
uniform float video1_brightness;         // New: color grading
uniform float video1_contrast;           // New: color grading
uniform float video1_gamma;              // New: color grading
// ... all transform uniforms (spin, orbit, cx, cy, etc.)
// ... existing effect uniforms (chromatic, posterize, tint...)
```

---

## 8. Performance Budget

| Resource | Image (static) | GIF | Video (1080p30) |
|----------|---------------|-----|-----------------|
| Upload bandwidth | 0 | 10-30MB/s decoded | 30-100MB/s raw |
| GPU texture | 4MB (2048²) | Same | Same |
| CPU overhead | Minimal | Frame decode | Video decode + color grading |
| Memory | ~4MB | ~4MB + frame cache | ~4MB + video element buffer |

**Mitigations:**
1. Auto-downscale videos > 1080p (like HD image toggle)
2. Limit to 2 video layers max (vs 5 images)
3. Pause off-screen videos
4. Color grading in shader (not canvas) when using Option B upload

---

## 9. Persistence & Export

### 9.1 Preset Storage (Simplified)

Video layer storage — no tiling fields:
```javascript
{
  type: 'video',           // Distinguishes from 'image'
  src: 'video-blob-id',    // IndexedDB reference (like images)
  // Playback
  trimIn: 0.0,
  trimOut: 23.5,
  speed: 1.0,
  loop: true,
  // Transform (simplified — no tiling)
  scale: 0.6,              // Replaces size/spacing/tileWidth/tileHeight
  centerX: 0.5,
  centerY: 0.5,
  spin: 0,
  orbitRadius: 0,
  mirror: 'none',          // No mirrorScope — always single instance
  // Color grading (new)
  brightness: 1.0,
  contrast: 1.0,
  gamma: 1.0,
  // Effects (reused from images)
  tintR: 1.0, tintG: 1.0, tintB: 1.0,
  chromatic: 0,
  posterize: 'off',
  // Audio reactivity (reused)
  pulse: 0,
  beatFade: 0,
  bounce: 0,
}
```

**Storage strategy:** IndexedDB Blob (like GIFs/images). Warn if >50MB per video.

### 9.2 Export/Import

Same JSON bundle format as presets, but video BLOBs make files large. May need:
- Export with/without video data option
- "Relink video files" flow for portability

---

## 10. Open Questions

1. **Audio extraction?** Should video audio mix with visualizer audio or stay muted?
2. **Live input?** Could we support webcam as a "video layer" source?
3. **YouTube/Vimeo URLs?** Stream from external sources (CORS issues likely)
4. **Hardware acceleration?** How to ensure `video.playbackRate` changes don't disable hardware decode
5. **Sync multiple videos?** Frame-accurate sync for 2+ video layers to same beat

---

## 11. Phased Implementation Sketch (Simplified Model)

### Phase 1: Core Video Playback (MVP) — ✅ COMPLETE (May 7, 2026)
- Upload guard, MP4/WebM drag-in, play/pause/scrub, loop, scale/opacity/transform controls

### Phase 2: Color Grading — ✅ COMPLETE (May 9, 2026)
- Brightness, Contrast, Gamma in GLSL (applied after texture sample)

### Phase 3: Audio Reactivity — ✅ COMPLETE (May 9, 2026)
- Pulse, Beat Fade, Bounce, Shake — all reuse existing code, worked immediately

### Phase 4: Video Optimizer (Auto-Transcoding) — ✅ COMPLETE (May 9, 2026)
- FFmpeg.wasm lazy-loaded ~25MB, auto-converts 4K/1080p to 720p on upload with progress toasts

### Phase 5: Polish — ✅ COMPLETE (May 9–11, 2026)
- Speed control 0.25×–4×, Width/Height sliders (May 11), Video Border (May 11)

---

## 12. Related Files for Implementation

| File | Role for Video |
|------|----------------|
| `@/src/editor/inspector.js` | Layer UI, `_buildLayerControls()` extension — simplified for no-tiling |
| `@/src/editor/main.js` | Video upload handler, file type guard |
| `@/src/visualizer.js` | Texture upload, `_tickVideoTextures()` — similar to GIF tick |
| `@/src/editor/gifOptimizer.js` | Model for video optimizer (optional) |
| `@/customPresets.js` | Video persistence in IndexedDB |

---

## 13. Simplification Summary

**What we removed vs. original brainstorm:**
| Feature | Original | Simplified |
|---------|----------|------------|
| **Tiling** | Full tile controls (size, spacing, width, height) | ❌ Removed entirely |
| **Duplication** | Via tiling | Via **Mirror only** (H/V/Quad/Kaleido) |
| **Mirror Scope** | 'tile' vs 'field' options | ❌ Removed — always single quad |
| **Size semantic** | Tile density | Simple **Scale** (coverage %) |
| **UI complexity** | ~24 controls | ~16 controls (66% of image layer) |
| **Resolution handling** | Runtime conversion library (FFmpeg.wasm) | **Hard 720p limit** + optional optimizer Phase 2 |

**Why this matters:**
- Less GLSL branching (no tile vs non-tile shader paths)
- Clearer user mental model (video = single element)
- Faster implementation (reuse existing `_buildImageBlock()` with minor modifications)
- Audio reactivity "just works" — no special per-frame logic needed
- No heavy dependencies for MVP (FFmpeg.wasm = ~25MB, added only in Phase 2)

---

## 14. macOS WKWebView Implementation Notes

**Critical:** The macOS Tauri app uses WKWebView, which has stricter video playback requirements than standard browsers. These fixes were applied May 7, 2026.

### 14.1 Required Video Element Attributes

WKWebView requires explicit attributes for inline playback:

```javascript
const video = document.createElement('video');
video.playsInline = true;   // REQUIRED — prevents full-screen takeover
video.muted = true;         // REQUIRED — WKWebView blocks unmuted autoplay
video.preload = 'metadata'; // Standard, but critical for WKWebView
```

**Location:** `@/src/editor/inspector.js` in `_addVideoLayer()`

### 14.2 Blob URL Lifecycle Management

**Problem:** The 5-second `setTimeout(() => URL.revokeObjectURL(), 5000)` pattern that works in browsers breaks WKWebView — the video stops playing when the blob URL is revoked, even if the video element already has the data buffered.

**Fix:** Keep the blob URL valid for the entire video lifecycle. Only revoke when the layer is deleted:

```javascript
// Create texture object with persistent URL reference
const texObj = {
    data: videoUrl,
    _videoUrl: videoUrl,   // Keep reference for cleanup
    // ... other props
};

// Cleanup on delete only
_performDeleteLayer(entry, card, texName) {
    if (texObj?._videoUrl) {
        URL.revokeObjectURL(texObj._videoUrl);
    }
}
```

**Location:** `@/src/editor/inspector.js` in `_addVideoLayer()` and `_performDeleteLayer()`

### 14.3 Critical Bug Fix: Revoked Blob URL in Non-Transcoded Path (May 9, 2026)

**Bug:** Videos under 720p (non-transcoded) didn't display in macOS build despite toast showing success.

**Root Cause:** The non-transcoded path in `_addVideoLayer()` revoked the blob URL while the video element still referenced it:

```javascript
// BROKEN (inspector.js:2361)
} else {
    URL.revokeObjectURL(videoUrl);  // BUG: video.src still points to this!
}
// finalVideo = video  ← Uses element with revoked URL
```

**Fix Applied:**
- **inspector.js:2310** - Added `video.loop = true` (was missing on original element)
- **inspector.js:2361-2364** - Removed `URL.revokeObjectURL()` from non-transcoded path

**Lesson:** Never revoke blob URLs while any element still references them. WKWebView strictly enforces this; desktop browsers are more forgiving.

### 14.4 Loop Workaround

The `video.loop = true` property doesn't always work in WKWebView. Manual loop handling is required:

```javascript
videoElement.addEventListener('ended', () => {
    if (videoElement.loop) {
        videoElement.currentTime = 0;
        videoElement.play().catch(...);
    }
});
```

**Location:** `@/src/visualizer.js` in `_loadVideoTexture()`

### 14.5 Platform Differences Summary

| Aspect | Web (Chrome/Safari/Firefox) | macOS Tauri (WKWebView) |
|--------|------------------------------|-------------------------|
| `playsInline` | Recommended | **Required** |
| `muted` for autoplay | Often required | **Always required** |
| Blob URL revocation | Can revoke after load | **Must keep valid** |
| `loop` property | Works reliably | Needs manual restart |

### 14.6 Testing Checklist for macOS

Before shipping macOS builds with video support:

- [ ] Video imports without error
- [ ] Video plays immediately (no black frame)
- [ ] Video loops continuously without stopping
- [ ] Scale/opacity/transform sliders work without freezing
- [ ] Pulse/bounce audio reactivity works
- [ ] Play/pause button toggles correctly
- [ ] Video stops when layer deleted (no memory leak)

### 14.7 Critical Bug Fix: Stale Video Cleanup in _clearForLoad (May 9, 2026)

**Bug:** Adding a video that was previously saved in a preset would inherit old processing settings (blend mode, effects, etc.) instead of getting fresh defaults. Only reproducible in production, not locally.

**Root Cause:** `_clearForLoad()` (called when loading presets via `loadPresetData`, `loadBundledPreset`, or reset) only called `removeGifAnimation()` but NOT `removeVideoAnimation()`:

```javascript
// BROKEN (inspector.js:1431-1434)
for (const texName of Object.keys(this._imageTextures)) {
    this.engine.removeGifAnimation?.(texName);  // Missing removeVideoAnimation!
}
this._imageTextures = {};
```

This left video elements in DOM, blob URLs unrevoked, GL textures active, and `_videoAnimations` map with stale entries. When the same video file was uploaded again, ghost state from the previous instance interfered.

**Fix Applied:**
- **inspector.js:1433** - Added `this.engine.removeVideoAnimation?.(texName);` to the cleanup loop

**Lesson:** When implementing a new layer type (video), ensure all cleanup paths call the corresponding removal function. The pattern was established for GIFs but video was missed in `_clearForLoad`.

---

### 14.8 Transparent Video — Canvas Trail Fix (May 12, 2026)

**Bug:** Transparent WebM (VP9 alpha) showed a ghosting trail — previous frames accumulated through transparent areas of the current frame.

**Root Cause:** `_tickVideoAnimations()` in `visualizer.js` called `ctx.drawImage(video, ...)` without clearing the canvas first. Canvas 2D default compositing is `source-over`: transparent pixels in the new frame let the previous frame bleed through.

**Fix:** One line before `drawImage`:
```javascript
uploadCtx.clearRect(0, 0, width, height);  // ← added
uploadCtx.drawImage(videoElement, 0, 0, width, height);
```

**Location:** `src/visualizer.js` `_tickVideoAnimations()`.

**Applies to:** All platforms (web, Windows, macOS). GIF frames go through the separate `_tickGifAnimations` path which never had this issue — GIF frames are pre-composited RGBA arrays, not drawn via canvas 2D.

---

### 14.9 Performance Monitoring & Machine Auditing — Future Dev

> **Status:** Research complete — implementation not started  
> **Goal:** Real-time performance graphs and video layer impact auditing

**Why this matters:** Video layers are the most resource-intensive feature (720p texture uploads every frame). Users need visibility into performance impact, especially on lower-end hardware.

#### 14.8.1 Available Browser Telemetry APIs

| Metric | API | Reliability | Use Case |
|--------|-----|-------------|----------|
| **FPS / Frame Time** | `requestAnimationFrame` delta | ✅ High | Detect jank, dropped frames |
| **JS Heap Memory** | `performance.memory` | ⚠️ Chrome only | Detect memory leaks from preset switching |
| **Device Memory Tier** | `navigator.deviceMemory` | ⚠️ Chrome only | Warn on 2GB/4GB devices |
| **CPU Cores** | `navigator.hardwareConcurrency` | ✅ High | Set conservative defaults on low-core machines |
| **GPU Info** | `WEBGL_debug_renderer_info` | ⚠️ Extension needed | Detect Intel iGPU vs discrete for tiered defaults |
| **WebGL Limits** | `gl.getParameter(MAX_TEXTURE_SIZE)` | ✅ High | Validate 2048/4096 support |
| **Battery / Power** | `navigator.getBattery()` | ⚠️ Limited | Reduce video count on battery power |

**Not available:** GPU utilization %, VRAM usage, thermal state. These require native app instrumentation (Tauri Rust layer) if needed.

#### 14.7.2 Video-Specific Metrics to Track

| Metric | Threshold | Warning Trigger |
|--------|-----------|-----------------|
| **Active video layers** | 2 max recommended | ≥2 videos: show amber indicator |
| **Texture upload time** | ~2-5ms per 720p frame | >5ms: "Video may cause stutter" |
| **Dropped frames** | 0 at 60fps | >2 drops/sec: reduce video count |
| **GPU memory estimate** | 4MB per 720p video | >20MB total: "Consider image layers" |
| **Decode bandwidth** | ~15-30MB/s per 720p | CPU-bound if >2 videos + complex preset |

#### 14.7.3 Implementation Options

**Option A: Minimal HUD Overlay (recommended for MVP)**
- Canvas 2D overlay in corner (toggle with `Ctrl+Shift+P` or similar)
- Show: FPS, active video count, GPU tier icon
- Amber/red indicators when thresholds exceeded
- Zero overhead when hidden

**Option B: Full Performance Panel**
- Real-time sparkline graphs (FPS, memory, upload time)
- Video layer breakdown with per-layer GPU cost
- Export performance snapshot for bug reports
- More UI work, but powerful for power users

**Option C: Native Tauri Integration (future)**
- Rust sidecar to read system GPU/CPU stats
- OS-level thermal throttling detection
- Only if browser APIs prove insufficient

#### 14.7.4 Code Sketch — FPS Monitor

```javascript
class VideoPerformanceMonitor {
  constructor() {
    this.frames = [];
    this.lastTime = performance.now();
    this.jankCount = 0; // frames > 16.7ms
    this.videoLayerCount = 0;
  }
  
  tick() {
    const now = performance.now();
    const delta = now - this.lastTime;
    this.lastTime = now;
    
    // Track last 60 frames for rolling average
    this.frames.push(delta);
    if (this.frames.length > 60) this.frames.shift();
    
    const avgDelta = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const fps = Math.round(1000 / avgDelta);
    
    // Detect jank (>16.7ms = missed 60fps deadline)
    if (delta > 16.7) this.jankCount++;
    
    // Video-specific: warn on severe drops
    if (this.videoLayerCount > 0 && delta > 33) {
      console.warn('[Perf] Frame drop with active videos:', delta.toFixed(1) + 'ms');
    }
    
    return { fps, jankRate: this.jankCount / this.frames.length };
  }
  
  setVideoCount(n) {
    this.videoLayerCount = n;
    // Warn at 2+ videos on Intel iGPU (detected separately)
  }
}
```

#### 14.7.5 GPU Tier Detection

```javascript
function detectGPUTier(gl) {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const vendor = debugInfo 
    ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR);
  const renderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  
  const isIntelIGP = renderer.includes('Intel') && !renderer.includes('Arc');
  const isDiscrete = renderer.includes('NVIDIA') || renderer.includes('AMD') || renderer.includes('Radeon');
  
  // Set conservative defaults for Intel integrated
  return {
    tier: isDiscrete ? 'high' : isIntelIGP ? 'low' : 'medium',
    maxVideos: isDiscrete ? 3 : isIntelIGP ? 1 : 2,
    renderer,
    vendor
  };
}
```

#### 14.7.6 Recommended Limits for UI Warnings

| User Hardware | Max Videos | Preset Complexity | UI Guidance |
|---------------|------------|-------------------|-------------|
| Intel iGPU (UHD/HD) | 1 | Avoid heavy feedback presets | "One video max for smooth playback" |
| Apple Silicon M1/M2 | 2 | All presets OK | Standard experience |
| Discrete GPU (RTX/Radeon) | 3 | All presets OK | "High-end hardware — full performance" |
| Unknown / Low-end | 1 | Conservative | "Consider GIFs instead of videos" |

---

## 15. Future VJ Effects — Brainstorm & Difficulty Ratings

> **Date:** May 8, 2026 brainstorm session  
> **Goal:** Catalog all potential video processing effects, rate difficulty, identify easy wins

### 15.0 Existing Per-Layer Audio Reactivity (Already Shipped)

These controls **already work** on image, video, and text layers in the Preset Studio Layers tab. Any brainstorm idea that duplicates these is marked ✅ DONE.

#### Audio Source & Curve (per-layer)
| Control | Values | What it does |
|---------|--------|--------------|
| **React Source** | `bass` / `mid` / `treb` / `vol` | Which frequency band drives all audio-reactive controls on this layer |
| **React Curve** | `linear` / `squared` / `cubed` / `gate` | Response shape — gate = hard on/off threshold |

#### Beat-Driven Effects (per-layer)
| Control | Range | What it does | Status |
|---------|-------|--------------|--------|
| **Pulse** | 0–2 (cubic curve) | Bass drives scale — image grows on beat | ✅ DONE |
| **Shrink** | Toggle | Invert pulse direction — shrink on beat instead of grow | ✅ DONE |
| **Bounce** | 0–0.4 (cubic curve) | Bass pushes image upward on each beat | ✅ DONE |
| **Shake** | 0–0.15 (cubic curve) | Random 2D UV jolt on beat — omnidirectional impulse | ✅ DONE |
| **Beat Fade** | 0–1 (cubic curve) | Opacity pulses in on every beat, fades out between | ✅ DONE |
| **Strobe** | 0–1 (cubic curve) + Threshold slider | Hard opacity cut when audio crosses threshold — instant flash | ✅ DONE |

#### Motion / Position (per-layer, always active — not beat-triggered)
| Control | Range | What it does | Status |
|---------|-------|--------------|--------|
| **Spin** | −3 to +3 | Continuous rotation speed | ✅ DONE |
| **Orbit** | 0–0.45 | Circle path radius around center point | ✅ DONE |
| **Orbit Mode** | `circle` / `lissajous` | Path shape — Lissajous = figure-8 / clover patterns | ✅ DONE |
| **Lissajous Freq X/Y** | 0.25–4 Hz | Independent axis frequencies for Lissajous figures | ✅ DONE |
| **Lissajous Phase** | 0–1 | X-axis phase offset — rotates the figure | ✅ DONE |
| **Sway Amount/Speed** | 0–0.4 / 0–4 Hz | Sinusoidal horizontal oscillation | ✅ DONE |
| **Wander Amount/Speed** | 0–0.4 / 0–2 | Organic random drift (Perlin-like) | ✅ DONE |
| **Pan Mode** | `off` / `drift` / `bounce` | Whole-layer translation with speed X/Y | ✅ DONE |
| **Tunnel** | −2 to +2 | Infinite zoom through tiled layer | ✅ DONE |

#### Visual Effects (per-layer, always active)
| Control | Range | What it does | Status |
|---------|-------|--------------|--------|
| **Chromatic Aberration** | 0–1 + Speed | RGB channel split | ✅ DONE |
| **Posterize** | 0 / 2–16 | Color banding / reduced color count | ✅ DONE |
| **Edge (Sobel)** | Off / On | Neon wireframe / line art mode | ✅ DONE |
| **Mirror** | None / H / V / Quad / Kaleido | UV fold for duplication | ✅ DONE |
| **Hue Spin** | 0–2 | Continuous hue rotation speed | ✅ DONE |
| **Saturation** | 0–2 | Per-layer vibrancy | ✅ DONE |
| **Tint (RGB)** | 3 color channels | Per-layer color tinting | ✅ DONE |
| **Angle** | −180° to +180° | Static rotation offset | ✅ DONE |
| **Skew X/Y** | −1 to +1 | Horizontal/vertical shear | ✅ DONE |
| **Perspective X/Y** | −1 to +1 | Projective tilt distortion | ✅ DONE |

---

**Key takeaway for brainstorm:** The app already has a rich per-layer audio reactivity system with source selection, curve shaping, and 6 beat-driven effects. New VJ effects should **plug into this existing system** (same `reactSource`/`reactCurve` routing) rather than inventing new audio hooks. The brainstorm items below are rated with this in mind — anything that's already done is excluded or noted.

---

### Difficulty Key

| Rating | Meaning | Typical effort |
|--------|---------|----------------|
| 🟢 **Easy** | Single GLSL pass or simple JS, reuses existing infrastructure | 1–3 hours |
| 🟡 **Medium** | New shader pass or moderate JS logic, may need new uniforms/UI | 4–12 hours |
| 🔴 **Hard** | Multi-pass rendering, new texture pipelines, or significant architecture changes | 1–3 days |

---

### 15.1 Time Manipulation

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Freeze Frame** | Hold current frame on beat, release to resume | 🟢 Easy | Just stop calling `texSubImage2D` on trigger |
| **Stutter / Glitch Repeat** | Lock to 2–8 frame micro-loop on beat | 🟡 Medium | Needs small frame ring-buffer (~8 frames) |
| **Reverse Burst** | Momentary backward playback on trigger | 🟡 Medium | Requires frame buffer or `video.playbackRate = -1` (limited support) |
| **Frame Buffer / Echo** ⭐ | Blend N previous frames with decay — ghostly motion trails | 🟡 Medium | Ping-pong FBO, blend with previous frame texture. **TOP 5** |
| **Time Displacement Map (Slit-Scan)** | Different image regions play at different time offsets | 🔴 Hard | Needs N-frame history buffer + per-pixel time lookup |

### 15.2 Feedback & Recursion

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Feedback Loop** ⭐ | Re-inject previous output frame with scale/rotation offset | 🟡 Medium | Render-to-texture + feedback FBO. Defines analog VJ look. **TOP 5** |
| **Pixel Persistence / Phosphor Decay** | Pixels fade slowly instead of being replaced | 🟢 Easy | `mix(prevFrame, currentFrame, decayRate)` — subset of feedback |
| **Accumulation Buffer** | Add frames together, no decay — long exposure look | 🟢 Easy | Additive blend with previous FBO, clamp to 1.0 |

### 15.3 Distortion & Displacement

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Wave Distort** | Sinusoidal UV warp, audio-reactive amplitude | ✅ DONE | Shipped May 8 — Wave + Freq sliders, audio-reactive amplitude |
| **Pixelate / Mosaic** | Controllable block size, audio-reactive | ✅ DONE | Shipped May 8 — Pixelate slider under Texture header |
| **Barrel / Fisheye** | Lens distortion | 🟢 Easy | Standard radial distortion formula, ~5 lines GLSL |
| **Displacement Map** | Use one layer/waveform to warp another layer's UVs | 🟡 Medium | Cross-layer texture read, needs uniform hookup |
| **Glitch Blocks** ⭐ | Random rect chunks offset, beat-synced | 🟡 Medium | Random block offsets seeded by beat count. **TOP 5** |
| **RGB Channel Shift (independent)** | Per-channel X/Y UV offsets at different speeds | 🟢 Easy | Extension of existing chromatic aberration — add direction vectors |
| **Edge Warp / Melt** | Displace pixels outward from edge-detected boundaries | 🟡 Medium | Edge detect pass → displacement pass (2-pass) |
| **Slice & Reassemble** | Cut frame into strips, offset each differently | 🟢 Easy | Modular UV offset per strip row/column |
| **Polar Coordinates** | Cartesian ↔ polar conversion | 🟢 Easy | `vec2(atan(uv.y,uv.x), length(uv))` — standard transform |
| **Recursive Zoom (Droste)** | Image contains itself shrinking toward a point | 🔴 Hard | Log-polar mapping + feedback, complex math |

### 15.4 Color Processing

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Invert** | Full or partial color inversion (0–1 mix) | ✅ DONE | Shipped May 8 — Invert slider under Color FX |
| **Threshold / Binary** | Hard B&W cutoff, audio-reactive level | ✅ DONE | Shipped May 8 — Thresh slider, audio-reactive cutoff shift |
| **Color Channel Swap** | R↔G, G↔B, R↔B with crossfade | 🟢 Easy | Swizzle: `color.grb`, `color.bgr`, etc. |
| **Duotone / Tritone** | Map luminance to 2–3 user-chosen colors | 🟢 Easy | `mix(colorA, colorB, luminance)` — simple remap |
| **Thermal / Heat Map** | Luminance → thermal palette (blue→red→white) | 🟢 Easy | 1D gradient LUT texture or step function |
| **Halftone** | CMYK dot pattern, dot size = luminance | 🟡 Medium | Needs distance-from-grid-center math per channel |
| **Color Palette Quantize** | Reduce to N specific colors | 🟡 Medium | Nearest-color search in GLSL, user picks palette |
| **LUT (Look-Up Table)** | Load .cube/.png LUT for cinematic grades | 🟡 Medium | 3D texture lookup, needs LUT file loader |

### 15.5 Edge & Outline Effects

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Edge Detection (Sobel)** | Show only edges — neon wireframe look | ✅ DONE | Already shipped as per-layer "Edge" toggle |
| **Edge Glow / Bloom on Edges** | Detect edges, apply bloom only to them | 🟡 Medium | Edge detect + blur pass (2-pass minimum) |
| **Emboss** | Raised/stamped 3D texture feel | 🟢 Easy | Convolution kernel, similar to Sobel |
| **Outline + Fill (Cel Shade)** | Edge detect + quantized fill colors | 🟡 Medium | Edge pass + posterize combination |

### 15.6 Blend & Compositing

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Luma Key** ⭐ | Cut out darks or lights, composite over other layers | ✅ DONE | Shipped May 8 — Key Lo + Key Hi sliders in Visual Effects |
| **Chroma Key** | Cut specific color range (greenscreen) | 🟡 Medium | Color-distance in YCbCr space, feathering |
| **Difference Blend** | Show only motion (current vs previous frame) | 🟢 Easy | `abs(current - previous)` — needs prev frame texture |
| **Auto-Mask (Luminance Cutout)** | Keep only bright parts as overlay | 🟢 Easy | Variant of luma key with high threshold |

### 15.7 Pattern Generation & Overlay

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Scan Lines** | CRT scanline overlay, controllable density | ✅ DONE | Shipped May 8 — Scan slider under Texture header |
| **Film Grain / Noise** | Animated noise overlay, opacity-controlled | ✅ DONE | Shipped May 8 — Grain slider under Texture header |
| **Grid Overlay** | Configurable grid lines, beat-pulsing | 🟢 Easy | Step function on UV coordinates |
| **Strobe** | White flash / hard-cut to black, beat-synced | ✅ DONE | Already shipped as per-layer Strobe + Threshold |

### 15.8 Spatial Transforms (beyond current)

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Zoom Pulse** | Punchy zoom-in-and-snap-back on beat (not continuous) | 🟢 Easy | Note: existing **Pulse** control is similar but continuous. This would be a sharper one-shot envelope |
| **Tile with Offset (Brick)** | Repeat N×M with alternating row offset | 🟡 Medium | Re-introduces simplified tiling — deliberate opt-in |
| **Polar Coordinates** | Cartesian ↔ polar — turns any video into radial tunnel | 🟢 Easy | Standard transform, listed above in distortion too |

### 15.9 Audio-Reactive Mapping (extending existing)

| Effect | Description | Difficulty | Notes |
|--------|-------------|------------|-------|
| **Audio Spectrum → UV Displacement** | Frequency spectrum displaces pixel rows | 🟡 Medium | Needs spectrum texture uniform |
| **Beat Counter → Parameter Cycle** | Cycle effect values every N beats | 🟢 Easy | Modular counter, already have beat detection. Extends existing `reactSource`/`reactCurve` system |
| **Envelope Follower** | Smooth amplitude with attack/release, map to any param | 🟡 Medium | JS-side smoothing filter. Note: existing `reactCurve` (squared/cubed) partially covers this |
| **Frequency Band → Layer Select** | Different bands trigger different layers | 🟡 Medium | Routing logic in JS, per-layer alpha modulation |

### 15.10 Pro VJ Quality-of-Life

| Feature | Description | Difficulty | Notes |
|---------|-------------|------------|-------|
| **Effect Dry/Wet** | 0–1 mix knob on every effect | 🟢 Easy | `mix(original, effected, dryWet)` per effect |
| **Tap Tempo / BPM Sync** | All time-based effects lock to global BPM | 🟡 Medium | BPM detector or manual tap, sync all oscillators |
| **Effect Chains / FX Bus** | Stack + reorder multiple effects per layer | 🔴 Hard | Multi-pass render pipeline, drag-drop UI |
| **Effect Presets** | Save/recall effect chain configs | 🟡 Medium | Serialization of effect state to IndexedDB |
| **Crossfader (A/B Deck)** | Crossfade between two layer groups | 🔴 Hard | Layer grouping system + global mix control |

---

## 16. Easy Wins Summary — Ship First

These can each be added with minimal GLSL and a single slider in the layer controls:

| # | Effect | GLSL Complexity | UI Needed |
|---|--------|-----------------|-----------|
| 1 | **Invert** | ✅ DONE | Shipped May 8 |
| 2 | **Threshold / Binary** | ✅ DONE | Shipped May 8 |
| 3 | **Wave Distort** | ✅ DONE | Shipped May 8 |
| 4 | **Pixelate / Mosaic** | ✅ DONE | Shipped May 8 |
| 5 | **Scan Lines** | ✅ DONE | Shipped May 8 |
| 6 | **Film Grain** | ✅ DONE | Shipped May 8 |
| 7 | **Color Channel Swap** | 1 line | Dropdown (RGB/GBR/BRG/etc.) |
| 8 | **Duotone** | 2 lines | 2 color pickers |
| 9 | **Slice & Reassemble** | 3 lines | Slices + Offset sliders |
| 10 | **Barrel / Fisheye** | 5 lines | Strength slider |
| 11 | **Polar Coordinates** | 2 lines | Toggle + blend slider |
| 12 | **Zoom Pulse** | 3 lines (JS envelope) | Existing Pulse is similar — this is sharper one-shot |
| 13 | **Edge Detection (Sobel)** | ✅ DONE | Already shipped as per-layer Edge toggle |
| 14 | **Luma Key** | ✅ DONE | Shipped May 8 |
| 15 | **Freeze Frame** | 0 GLSL (JS only) | Toggle/beat-trigger |

---

## 17. Top 5 Priority Effects — Phased Plan

> These five effects maximize visual impact vs. implementation cost and would bridge the gap between "visualizer with video" and "actual VJ tool."

### Phase A: Immediate (reuse existing pipeline)

#### A1. Luma Key 🟢 — ✅ SHIPPED (May 8, 2026)
- **Why:** Unlocks layered composition — makes every other effect more powerful
- **GLSL:** `_t.w *= smoothstep(0.0, lumaKeyLo, _luma)` + `_t.w *= 1.0 - smoothstep(hiThresh, 1.0, _luma)`
- **UI:** "Key Lo" slider (0–1) + "Key Hi" slider (0–1) under "Luma Key" sub-header in Visual Effects section
- **Works on:** All layer types (image, video, text)
- **Pipeline position:** After all color processing (tint, saturation, posterize, video grading), before `_op` opacity calc
- **Audio-reactive:** Uses existing `_r` signal — threshold shift on beat = pulsing reveal (future enhancement)
- **Implementation:** 4 touch points in `inspector.js`:
  1. Layer defaults (image L2261, video L2391, text L2527, migration L5175)
  2. Card HTML template (L3051–3062) — sliders in Visual Effects section
  3. Control wiring (L3788–3806) — input events → entry prop → refresh()
  4. GLSL generation in `_buildImageBlock()` (L5048–5060)

#### A2. Wave Distort 🟢 — ✅ SHIPPED (May 8, 2026)
- **Why:** Instant crowd-pleaser. Sinusoidal UV warp creates liquid/underwater/heat-haze look.
- **GLSL:** `_u.x += sin(_u.y * freq + time * 2.0) * amp` + Y-axis with different freq/phase for organic feel
- **UI:** "Wave" slider (amplitude 0–1) + "Freq" slider (1–20, hidden when amp=0) under "Wave Distort" sub-header
- **Works on:** All layer types (image, video, text). Tunnel mode warps `_uA`/`_uB` independently.
- **Pipeline position:** Between `pipeline` (UV transforms) and `sampleLine` (texture fetch) — modifies final UV before sampling
- **Audio-reactive:** Amplitude auto-modulated by `_r`: `amp * 0.1 * (1.0 + _r * 0.5)` — bass hits make waves bigger
- **Implementation:** 4 touch points in `inspector.js`:
  1. Layer defaults (image L2263, video L2395, text L2533, migration L5182)
  2. Card HTML template (L3070–3082) — sliders in Visual Effects section
  3. Control wiring (L3828–3849) — input events → entry prop → refresh()
  4. GLSL generation as `waveLines` variable (L5000–5025), inserted at L5033

#### A3. Invert + Threshold (2-for-1) 🟢 — ✅ SHIPPED (May 8, 2026)
- **Why:** Two essential VJ color tools, both one-liners, share a "Color FX" subsection in UI
- **GLSL:** Invert: `mix(_src, 1.0 - _src, amount)` / Threshold: `step(thresh - _r * 0.2, luminance)`
- **UI:** "Invert" slider (0–1 mix) + "Thresh" slider (0–1 cutoff) under "Color FX" sub-header
- **Works on:** All layer types (image, video, text)
- **Pipeline position:** After posterize, before video color grading — sees fully color-processed pixels
- **Audio-reactive:** Threshold cutoff auto-modulated by `_r * 0.2` — bass hits shift the black/white boundary for pulsing silhouettes
- **Implementation:** 4 touch points in `inspector.js`:
  1. Layer defaults (image L2265–2266, video L2399–2400, text L2539–2540, migration L5255)
  2. Card HTML template (L3089–3101) — sliders in Visual Effects section
  3. Control wiring (L3870–3888) — input events → entry prop → refresh()
  4. GLSL generation in `_buildImageBlock()` (L5147–5150)

### Phase B: Frame Buffer Required — ⏭️ SKIPPED (May 8, 2026)

> **Audit finding:** Butterchurn already provides native frame echo/feedback via `echo_alpha`, `echo_zoom`, `echo_orient` (Motion tab) and `decay` (Trail slider in Palette tab). These are MilkDrop 2 built-in parameters exposed in our UI. Custom FBO infrastructure would only add per-layer independent trails — marginal improvement vs. significant complexity/risk.

#### B1. Frame Buffer / Echo (Motion Trails) 🟡 — ALREADY COVERED
- **Existing controls:** Trail slider (`ps-decay` 0.85–0.999), Echo Opacity (`ms-ealpha`), Echo Zoom (`ms-ezoom`), Echo Orient
- **Why skipped:** Building a separate FBO ping-pong outside Butterchurn would be 6–8 hours with fragile WebGL context sharing and no guarantee of compatibility across preset switches

#### B2. Feedback Loop 🟡
- **Why:** #1 effect in analog VJ rigs. Creates infinite tunnels, fractal smears.
- **Architecture:** Same FBO as B1, but re-inject with **scale + rotation offset**
  1. Read previous FBO
  2. Sample with `uv * feedbackScale` and `rotate(uv, feedbackAngle)`
  3. Blend with current frame
  4. Write to FBO
- **UI:** Feedback Amount (0–0.99), Zoom (0.9–1.1), Rotation (0–10°)
- **Audio-reactive:** Zoom amount on bass, rotation speed on mids
- **Prereq:** Same FBO infrastructure as B1 — marginal cost if B1 is done
- **Estimate:** 3–4 hours (after B1 FBO exists)

### Phase C: Beat-Synced Logic

#### C1. Glitch Blocks 🟡
- **Why:** Pure VJ energy. Random rectangular chunks displaced, beat-synced.
- **Architecture:**
  1. Divide frame into grid (e.g., 8×6)
  2. On beat trigger, randomly select N blocks
  3. Offset their UV coordinates by random amount
  4. Hold for N frames, then release
- **UI:** Block Size slider, Intensity (how many blocks), Hold Duration
- **Audio-reactive:** Trigger on kick, intensity scales with energy
- **Prereq:** Beat detection (already exists), random seed per beat
- **Estimate:** 4–6 hours

### Implementation Order

```
Phase A (no new infra needed):
  A1. Luma Key ──────────── 1-2 hrs ──┐
  A2. Wave Distort ─────── 1-2 hrs ──┤── Ship together
  A3. Invert + Threshold ── 1-2 hrs ─┘
                                      
Phase B (FBO infrastructure):         
  B0. Build FBO ping-pong ── 3 hrs ──┐
  B1. Frame Echo ──────── 3-4 hrs ───┤── Ship together
  B2. Feedback Loop ───── 3-4 hrs ───┘
                                      
Phase C (beat logic):                 
  C1. Glitch Blocks ──── 4-6 hrs ──── Ship standalone
```

**Total estimated effort:** ~14–20 hours across all phases

**NOTE:** Edge Detection (Sobel) was originally in the Top 5 but is already shipped as the per-layer "Edge" toggle. Replaced with Wave Distort + Invert/Threshold as easy wins that fill different visual territory.

### Shared FBO Infrastructure (Phases B+C)

The ping-pong FBO built for Phase B is reusable for many future effects:
- Frame Echo (B1)
- Feedback Loop (B2)
- Difference Blend (future)
- Time Displacement / Slit-Scan (future)
- Accumulation Buffer (future)

Building it once unlocks an entire category of temporal effects.

---

## 18. Video Clip Editor / Sampler — Background Brainstorm

> **Status:** 📋 **Superseded by §19** — Architectural decisions made May 10, 2026  
> **See:** §19 (Clipper refined spec), §21 (Export formats), §23 (AI future), §27 (Transparent WebM on macOS)

### 16.1 Vision: Video Sampler Mode

A modal menu that opens when adding videos (or via right-click on existing video layers) that provides:

| Feature | Description | Use Case |
|---------|-------------|----------|
| **Clip Trimming** | Set in/out points on a video timeline | Use only the best 10 seconds of a 2-minute clip |
| **Video Preview** | Scrub-able preview with frame-accurate seeking | See exactly what you're cutting |
| **Chunk Selection** | Extract multiple segments from one video | Build a "best of" reel from longer footage |
| **Transcode Settings** | Override default 720p — choose quality/size | 480p for lightweight loops, 1080p for quality |
| **Format Options** | WebM/VP9 vs MP4/H.264 selection | VP9 for transparency support, H.264 for compatibility |
| **Audio Strip/Keep** | Option to preserve audio tracks | Rare VJ use case, but possible |

### 16.2 UI Concept

```
┌─────────────────────────────────────────────────────────┐
│  🎬 Video Sampler — myclip.mp4                    [×]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │                                             │       │
│  │           VIDEO PREVIEW                     │       │
│  │           (scrub with waveform)             │       │
│  │                                             │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  ○━━━━━━●━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━○        │
│  0:00   ▲                   ▲                 2:34     │
│       [IN]               [OUT]                        │
│                                                         │
│  Quality: [720p ▼]  Format: [H.264 ▼]  Audio: [✓]    │
│                                                         │
│  Estimated: 45MB → 8MB (18s selected)                 │
│                                                         │
│  [Cancel]                    [Add to Preset]           │
└─────────────────────────────────────────────────────────┘
```

### 16.3 Technical Considerations

| Aspect | Challenge | Solution Path |
|--------|-----------|---------------|
| **Seek precision** | Video seeking not frame-accurate in browsers | Use `currentTime` + `seeked` event with throttling |
| **Waveform display** | Generate audio waveform for visual scrub | Decode audio track with Web Audio API, draw to canvas |
| **Multiple chunks** | Non-contiguous segments from one source | Transcode each segment separately, concat with FFmpeg |
| **Live preview** | Seeking on large files is slow | Proxy preview at lower resolution, final transcode at full |
| **Storage** | Original + multiple clips = bloat | Discard original after sampling, store only selected chunks |

### 16.4 Implementation Phases (Very Rough)

| Phase | Scope | Effort |
|-------|-------|--------|
| **Phase 1** | Basic trim (single in/out) + quality selector | 8–12 hrs |
| **Phase 2** | Visual waveform scrubber | 4–6 hrs |
| **Phase 3** | Multiple chunk selection | 6–10 hrs |
| **Phase 4** | Proxy preview for fast scrubbing | 4–8 hrs |

**Dependencies:** All built on top of existing FFmpeg.wasm infrastructure — the hard work (loading, transcoding) is already done.

### 16.5 Streaming Mode — Handle Any Size Without Storage

> **Key insight:** The video sampler can operate in a "streaming mode" where the original file is **never stored** — only the final sample is saved.

**Workflow:**
```
1. User drops 4GB ProRes file (or any size/format)
2. App streams it for preview only — no IndexedDB storage
3. User marks 15-second sample with in/out points
4. FFmpeg transcodes just that 15s chunk to 720p
5. Original 4GB file is discarded, only 15s sample stored (~5MB)
```

**Benefits:**
| Aspect | Traditional | Streaming Sampler |
|--------|-------------|-------------------|
| **File size limit** | 50-100MB (IndexedDB practical limit) | Unlimited — streams from disk |
| **Storage** | Original + sample stored | Only sample stored |
| **Import time** | Upload + full transcode | Immediate preview, sample-only transcode |
| **Use case** | Small clips, phone videos | Professional footage, long DJ sets, 4K sources |

**Technical approach:**
- Use `createObjectURL()` for streaming preview — no copy made
- Only transcode the selected segment with FFmpeg (`-ss start -t duration`)
- Discard original blob URL after sample extraction
- Result: 4GB → 15s sample in 30 seconds, no persistent storage of the 4GB

### 16.6 Differentiation

Most VJ tools require pre-edited clips. This would let DJs:
- Drop a 10-minute music video in
- Instantly sample the best 30-second loop
- Trim, transcode, and layer in one flow

**"Video sampler" as a creative tool, not just a technical necessity.**

### 16.7 Clip Editing Features Only

Pure video editing — NO processing/beat detection (already in app). Just clip extraction, stitching, and assembly:

| Feature | Description | Clip Editing Use Case |
|---------|-------------|----------------------|
| **Multi-Segment Selection** | Pick 2-5 separate regions from one video | "Take intro (0:05-0:10) + drop (1:30-1:35) + outro (2:45-2:50)" |
| **Stitch Segments** | Concatenate multiple selected regions into one output clip | Build one seamless clip from scattered highlights |
| **Filmstrip Thumbnail Grid** | Visual frame grid for precise in/out point selection | Find exact frame for cut |
| **Trim Fine-Tuning** | Frame-accurate nudge (±1 frame, ±1 second) | Perfect cut points |
| **Split at Playhead** | One-click split video into two clips at current position | Divide long footage |
| **Reorder Segments** | Drag to reorder which segment plays first/second | Re-sequence clips before stitch |
| **Crossfade Between Segments** | Add 0.1-1.0s dissolve between stitched parts | Smooth transitions between distant clips |
| **Aspect Ratio Crop** | Crop to 9:16, 1:1, 16:9 during extraction | Output correct size directly |
| **Undo/Redo Stack** | Undo trim, split, reorder, delete actions | Non-destructive editing |
| **A/B Compare Two Edits** | Side-by-side compare different cut versions | Pick best edit |
| **Batch Extract** | Same in/out points applied to 5+ videos | Process multiple files identically |
| **Export Preview** | Low-res preview of final stitched clip before saving | Verify edit before transcode |

**NOT included (already in preset editor):** Beat detection, speed change, reverse, color grading, effects, opacity, blending — all handled after clip is added to video layer.

### 16.8 Workflow Integration Ideas

**"Sampler as Layer Source"**
- Sampler doesn't just add to preset — it becomes a "clip library"
- Sampled clips appear in a "My Clips" panel
- Drag from My Clips → any preset layer slot
- Clips are reusable across presets

**"Live Sampler Mode"**
- During timeline playback, hit `S` to sample current 4 bars
- Auto-extracts, names with timestamp, adds to My Clips
- Build a clip library from live performance in real-time

**"Smart Sampler AI" (Future)**
- AI suggests best 15-second segment based on:
  - Motion intensity peaks
  - Beat drops in audio
  - Face/figure visibility
  - Color palette matching current preset
- "Extract best drop" one-click button

---

*Document created for brainstorming session. Simplified spec reflects May 7, 2026 discussion — no tiling, single-quad video layers with mirror-based duplication. VJ effects brainstorm added May 8, 2026. Performance monitoring section added May 9, 2026. Video clip editor brainstorm added May 9, 2026. Clipper refined spec + GIF→WebM added May 10, 2026. Section renumber + status audit May 12, 2026.*

---

## 19. Clipper — `/clipper.html` — Refined Spec

> **Status:** 📋 **Active Planning**  
> **Decision:** Integrated directly into the DiscoCast project — not a separate app.

### 17.1 Architectural Decision

The clipper lives inside `winamp-screen/` as a new page. It shares the same Vite build, FFmpeg.wasm instance, COOP/COEP headers, and IndexedDB infrastructure. No new repo, no separate toolchain.

```
winamp-screen/
├── clipper.html             ← NEW: the trimmer page
├── src/
│   ├── clipper/
│   │   ├── clipper.js       ← NEW: clipper UI logic
│   │   └── clipper.css      ← NEW: clipper styles
│   └── videoTranscoder.js   ← MODIFY: add trimSegment()
```

**Existing files NOT modified for Phase 1:**
- `vite.config.js` — COOP/COEP headers already configured ✅
- `src/customPresets.js` — IndexedDB storage used as-is ✅
- `src/editor/inspector.js` — only adds one "Import from Clipper" button ✅

### 17.2 How It's Invoked

Two entry points from the Preset Studio:

1. **"✂️ Import from Clipper"** — added to the existing "📎 Add video" button on video layers
2. **Direct URL** — `/clipper.html` can also be opened standalone

Opened as a new tab (`window.open('/clipper.html?layerId=X')`) — avoids iframe COEP complexity. On completion the clip returns via `postMessage`:

```javascript
// clipper.html → editor.html
window.opener?.postMessage({ type: 'clip-ready', layerId, clipBlob }, '*');
```

Blob URL is revoked only after `postMessage` is confirmed received.

### 17.3 UX Philosophy — Big Buttons, Single Purpose

One job: drop video, mark In/Out, add to layer. Nothing else.

- **Massive drop zone** — full-width on open, collapses once file loads
- **One big play button** — centered, unmistakable
- **Two big marker buttons** — `[ SET IN ]` and `[ SET OUT ]` — keyboard + click
- **One big action button** — `[ ✅ ADD TO PRESET LAYER ]`

### 17.4 UI Layout

```
╔══════════════════════════════════════════════════════════════╗
║                    🎬 CLIP IMPORTER                          ║
╠══════════════════════════════════════════════════════════════╣
║           ╔══════════════════════════════╗                   ║
║           ║      VIDEO PREVIEW           ║                   ║
║           ║      (HTML5 <video>)         ║                   ║
║           ╚══════════════════════════════╝                   ║
║                                                              ║
║   ─────────────────────[▶]─────────────────────────────     ║  ← scrubber
║   0:00                                              5:23     ║
║                                                              ║
║   ╔══════════════╗   0:04 ──────── 0:18   ╔══════════════╗  ║
║   ║   SET IN  I  ║       14 sec           ║   SET OUT O  ║  ║
║   ╚══════════════╝                        ╚══════════════╝  ║
║                                                              ║
║   ──────[IN]══════════════════════════[OUT]──────────────   ║  ← timeline
║                                                              ║
║   ╔══════════════════════════════════════════════════════╗  ║
║   ║              ✅  ADD TO PRESET LAYER                 ║  ║
║   ╚══════════════════════════════════════════════════════╝  ║
╚══════════════════════════════════════════════════════════════╝
```

### 17.5 Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `J` | Rewind |
| `L` | Fast forward |
| `I` | Set In point |
| `O` | Set Out point |
| `←` / `→` | Nudge playhead ±1 frame |
| `Enter` | Add to Preset Layer |

### 17.6 Tech Stack

| Tech | Purpose | Note |
|---|---|---|
| HTML5 `<video>` | Playback | `playsInline` + `muted` required — see §14 |
| Canvas API | Timeline thumbnail strip, scrubber | No audio waveform — visuals only |
| FFmpeg.wasm | Trim, encode | Already in DiscoCast — same lazy-load |
| MediaInfo.js | Fast metadata on drop | Duration, resolution, codec before FFmpeg loads (~1.5MB WASM) |

> **No WaveSurfer.js.** The clipper is for finding visual cut points, not audio cues. A canvas thumbnail strip is sufficient and consistent with the visual-first use case.

### 17.7 Design Tokens (Matches DiscoCast)

```
Background:  #0A0A0F   (same as DiscoCast)
Surface:     #141420
Accent:      #7C5CFC   (DiscoCast violet — continuity)
Accent2:     #00E5FF   (cyan — playhead + info)
In Marker:   #00FF88   (green)
Out Marker:  #FF4466   (red)
Text:        #E8E8F0
Muted:       #5A5A7A
```

### 17.8 Phase 1 Checklist

- [ ] `clipper.html` in project root
- [ ] `src/clipper/clipper.js` — video element, play/pause, scrubber
- [ ] Canvas thumbnail strip on timeline
- [ ] MediaInfo.js — metadata display on file drop
- [ ] In/Out marker controls (`I`/`O` keyboard + click buttons)
- [ ] `videoTranscoder.js` — add `trimSegment(start, duration)` function
- [ ] `postMessage` from clipper → `inspector.js` listener
- [ ] "✂️ Import from Clipper" button on video layer in Preset Studio
- [ ] 720p guard on output (reuse existing `transcodeTo720p`)
- [ ] Progress toast during FFmpeg processing (reuse existing toast system)
- [ ] Blob URL revoked only after `postMessage` confirmed received

---

## 20. GIF Optimization — Status

> **Status:** Existing GIF Optimizer ships in `gifOptimizer.js` (frame reduction + resize). No conversion to other formats planned.

Earlier drafts proposed GIF→WebM and then GIF→APNG conversion. Both abandoned May 13, 2026:
- **GIF→WebM** abandoned because VP9 alpha doesn't decode in WKWebView (macOS)
- **GIF→APNG** abandoned because FFmpeg.wasm cannot decode VP9 alpha (bug #621) and APNG file sizes are 20× the source

The existing GIF Optimizer (smart frame skipping + resolution capping) addresses the practical problem (file size / GPU RAM) without a format change. GIFs play correctly on all platforms via the existing `_gifAnimations` pipeline. No action needed.

For transparent VIDEO (not GIF) on macOS, see §27 and [`apng-dev.md`](apng-dev.md).

---

## 21. Export Format Decision (Cross-Platform Safe)

> Cross-platform video quirks (WKWebView `playsInline`, blob URL lifecycle, SharedArrayBuffer) are already solved in DiscoCast — §14 covers the established patterns. The clipper inherits those fixes directly.

| Format | Web Chrome | Mac Tauri | Win Tauri | Transparent | Strategy |
|---|---|---|---|---|---|
| **MP4 H.264** | ✅ | ✅ | ✅ | ❌ | Default for opaque video |
| **WebM VP9** | ✅ | ✅ (no-alpha) ❌ (alpha) | ✅ | ✅ Web/Win only | Source of truth — Sammie Roto exports land here |
| **Stacked-Alpha WebM** (VP9, 2× height) | ✅ | ✅ | ✅ | ✅ via WebGL shader | **macOS-only derived/cached** transparent path |
| Animated GIF | ✅ | ✅ | ✅ | Binary only | Legacy — kept as-is (GIF Optimizer handles size/RAM) |

**Transparent video strategy (validated May 13, 2026):**
- **WebM VP9 alpha = the source format.** Small files, real codec, portable. Stored in IndexedDB on all platforms.
- **Web (Chrome) & Windows (WebView2):** plays WebM alpha natively. Zero conversion.
- **macOS:** WKWebView refuses VP9 alpha streams. At upload time we convert to a **stacked-alpha WebM** (regular VP9, 2× height: RGB top half + alpha as luma bottom half) via native ffmpeg in a Tauri sidecar. WKWebView plays this as plain VP9. A WebGL composite shader re-assembles RGBA from the two halves at render time.
- **Preset portability:** exports carry the original WebM blob (small, portable). macOS regenerates the stacked cache on import.
- **The stacked format is internal macOS plumbing only.** Users still drop normal WebM files — they never see or touch the stacked variant.

See [`apng-dev.md`](apng-dev.md) for full architecture, validated tests, and implementation plan.

---

## 22. Layer Processing Panel — New Sliders in Preset Studio

> **Status:** 📋 **Planned — Phase 2** (after clipper ships)  
> **Where:** New collapsible section in `src/editor/inspector.js`, video layer controls only  
> **Pattern:** Same 4-step pattern as Luma Key, Wave Distort, Shape Overlay — no new architecture

### 21.1 What It Is

A new **"Subject Isolation"** accordion section added directly to the existing video layer controls — not a separate tool. Slots in identically to how Audio Reactivity, Shape Overlay, and Visual Effects already slot in.

### 21.2 The 4-Step Pattern (Existing — Reuse Exactly)

Every new control follows the exact same pattern already proven by Luma Key, Wave Distort, and Shape Overlay:

```javascript
// 1. Add default to layer state
entry.isolationMode = 'none';  // 'none' | 'chroma' | 'diff' | 'grabcut' | 'yolo' | 'sam'
entry.isolationStrength = 1.0;

// 2. Add UI in _buildLayerControls() — reuse existing slider/select builders
html += this._buildSlider('Strength', 'isolationStrength', 0, 1, entry);
html += this._buildSelect('Mode', 'isolationMode', ['none','chroma','diff','grabcut','yolo','sam'], entry);

// 3. Wire event → refresh() — same as every other control
card.querySelector('[data-prop="isolationStrength"]').addEventListener('input', e => {
  entry.isolationStrength = parseFloat(e.target.value);
  this._refresh();
});

// 4. Add GLSL or canvas processing in _buildImageBlock() or a canvas pass
```

### 21.3 Canvas-First Effects (No AI, Phase 2)

These require no external libraries — just canvas `getImageData()` or GLSL:

| Effect | How | Notes |
|---|---|---|
| **Chroma Key** | GLSL hue/sat range cut | Planned in DiscoCast backlog — color greenscreen/bluescreen |
| **Frame Differencing** | `canvas.getImageData()` diff vs background frame | Motion isolation — moving subject vs static background |
| **Blur Background** | Canvas convolution outside mask | Simulated bokeh — depth separation |
| **Desaturate Background** | Canvas color math outside mask | B&W background, vivid subject |
| **Background Replace** | Solid color/gradient fill outside mask | Match DiscoCast preset palette |

### 21.4 Subject Processing Effects (Once Any Mask Is Established)

These apply *after* any isolation method — canvas tools, YOLO, or SAM:

| Effect | Description | DiscoCast Use |
|---|---|---|
| **Spotlight / Vignette** | Darken everything outside the subject | Dramatic focus — pairs with Shape Overlay |
| **Blur Background** | Simulated bokeh | Depth separation on the layer |
| **Desaturate Background** | Color only on subject | High contrast — B&W bg, vivid subject |
| **Crop to Subject** | Re-frame around subject, trim black space | Tight loop for small layer slot |
| **Subject Extract** | Export subject only with transparency | Layer blending in Preset Studio |
| **Background Replace** | Swap bg with solid color or gradient | Match DiscoCast preset palette |
| **Motion Trail** | Ghosting behind fast-moving subject | Psychedelic VJ layer |

### 21.5 Phase 2 Checklist

- [ ] New "Subject Isolation" collapsible section in `inspector.js` video layer controls
- [ ] Chroma Key — hue/sat range picker, GLSL cut
- [ ] Frame Differencing — motion mask from `canvas.getImageData()`
- [ ] Blur Background — canvas convolution outside mask
- [ ] Desaturate Background — canvas color math outside mask
- [ ] Export with baked-in effect — FFmpeg assembles processed frames into output clip

---

## 23. Subject Isolation — Future Phase (Brief)

> **Status:** 📋 **Not prioritized** — concept only until Phase 1 clipper is stable

A tiered AI pipeline for extracting subjects from video (e.g., a bird from sky footage). Each tier falls back gracefully:

| Tier | Tech | What it does | Effort |
|---|---|---|---|
| **0** | Canvas | Luma Key + Chroma Key + Frame Differencing | Already in DiscoCast |
| **1** | OpenCV.js WASM (~8MB) | GrabCut (draw rect → mask), optical flow | Medium |
| **2** | ONNX + YOLOv8-nano-seg (~14MB) | Auto pixel mask for known classes (bird, person...) | Medium |
| **3** | ONNX + EfficientSAM (~25MB) | Click any point → pixel-perfect mask | Medium-Large |
| **4** | SAM2 (50–100MB, WebGPU only) | Click once → mask propagated across all frames | Large |

**Division of labor:** Video Tool isolates and extracts → DiscoCast composites, animates, reacts to audio.

New files when this is built: `src/processing/segmentEngine.js`, `onnxEngine.js`, `yoloSeg.js`, `efficientSam.js`.

---

## 24. Width/Height Sliders — ✅ COMPLETE (May 11, 2026)

Independent Width and Height sliders for video layers. Uses existing `tileScaleX`/`tileScaleY` properties (already in video entry defaults). Shader non-tiled path uses `aspectPreScale()` which bakes both values into UV scaling. Center never drifts — dividing centered `_u` by any scalar leaves `_u=0` at center.

**Key bug fixed:** New slider classes must always be added to the `:not()` exclusion list at `inspector.js` line 3611. See `width-height-video-bug.md`.

---

## 25. Video Border — Width / Color / Feather

> **Status:** ✅ COMPLETE — video only, no tiling involved

A colored border ring drawn just outside the video quad edge. For video layers only.

### Controls (video layer panel, after Width/Height sliders)

| Control | Class | Property | Default | Range |
|---|---|---|---|---|
| Border Width | `layer-vid-border-w-sl` | `vidBorderWidth` | `0` | `0–0.1` UV units |
| Border Color | `layer-vid-border-color` | `vidBorderR/G/B` | `1,1,1` (white) | color picker |
| Border Feather | `layer-vid-border-feather-sl` | `vidBorderFeather` | `0` | `0–1` |

### Entry Defaults (add to video entry init)
```javascript
vidBorderWidth: 0.00,
vidBorderR: 1.00,
vidBorderG: 1.00,
vidBorderB: 1.00,
vidBorderFeather: 0.00,
```

### How It Works — Shader
The non-tiled pipeline already computes `_rd` (signed distance from video edge, negative inside, positive outside) for the `_gapMask` calculation. Promote `_rd` out of its `{}` block so it stays in scope. Then after the blend line:

```glsl
// Border ring — video-only, drawn after main blend
{ float _bw = vidBorderWidth;
  float _bf = max(vidBorderFeather * 0.02, 0.002);
  float _borderOuter = 1.0 - smoothstep(_bw - _bf, _bw + _bf, _rd);
  float _borderMask = _borderOuter * (1.0 - _gapMask);   // ring = outside video, within borderWidth
  col = mix(col, vec3(vidBorderR, vidBorderG, vidBorderB), _borderMask); }
```

### Implementation Steps
1. Add 3 controls to video layer HTML (after Height slider)
2. Add event handlers — Width and Feather: standard `layer-vid-*-sl` pattern; Color: color picker like existing vignette color picker
3. Add both new slider classes to the `:not()` exclusion list at line 3611
4. Promote `_rd` to outer scope in the non-tiled shader path (remove wrapping `{}`)
5. Emit border blend code after `blendLine` for video layers only

### Reference: Similar Existing Features
- Vignette overlay (`img.vignette`) — color picker + shape, appended after blendLine (~line 5686)
- Radius slider (`layer-radius-sl`) — also uses `_rd` for corner rounding
- Generic slider exclusion pattern — always add new video slider classes to `:not()` list at line 3611

---

## 26. Seamless Video Loop — ❌ BLOCKED (May 2026)

> **Status:** ❌ Attempted and reverted — blocked by three fundamental browser limitations
> **Decision:** Do not retry the canvas crossfade approach. Document blockers here for future reference.

### 23.1 What Was Attempted

A dual `<video>` element crossfade: a secondary element sits paused at frame 0, starts playing 400ms before the primary ends, and both are blended on the 2D canvas using `globalAlpha` before `texSubImage2D` upload. Implemented, tested, fully reverted.

### 23.2 Why It Failed — Three Separate Walls

#### Wall 1: Premultiplied Alpha Color Corruption

Canvas 2D stores pixels internally in premultiplied format (`R×A, G×A, B×A, A`). When `getImageData()` reads them back it un-multiplies — but using integers, so precision is lost:

```
Draw: RGB(200, 100, 50) at globalAlpha=0.5
Canvas stores: RGB(100, 50, 25) at A=128   ← premultiplied integers
getImageData: RGB(200, 98, 50) at A=128    ← 100/128*255 rounds wrong
```

During the crossfade window, any pixel drawn at `globalAlpha < 1.0` has corrupted RGB values when read back. Worse, partial-alpha pixels uploaded to WebGL let the Butterchurn background bleed through the video texture — which reads visually as the background palette shifting on every loop cycle.

**This is not fixable** by reordering draw calls. It is structural: `canvas 2D → getImageData → WebGL texSubImage2D` cannot carry partial-alpha pixels without color loss.

#### Wall 2: Source-Over Compositing Darkens the Midpoint

Even with the correct draw order, `source-over` is not a linear crossfade. At `t=0.5` the composited result is visibly darker than either source frame. The only mathematically correct DOM crossfade requires `mix-blend-mode: plus-lighter` — a CSS-only property with no equivalent in the canvas 2D / WebGL pipeline.

#### Wall 3: Dual Decoder Jank

Spawning a second `<video>` element forces the browser to run two simultaneous hardware decode pipelines for the same file. When the secondary starts playing 400ms before the primary ends, both decoders compete — causing visible stutter in the primary. WKWebView is especially sensitive to this.

### 23.3 The Only Real Solution: Media Source Extensions

The technically correct approach is MSE (`MediaSource` + `SourceBuffer`). Append the same video segment repeatedly with an adjusted `timestampOffset` — the `<video>` element sees one continuous, gapless stream with no seek gap, ever.

**Why it is still off the table:**
- Requires video encoded as **fragmented MP4** — not standard MP4/WebM
- `MediaSource` is not available in **WKWebView** on macOS (our primary shipped target)
- Would require FFmpeg.wasm to re-encode every imported video at add-time

### 23.4 Actual Best Practice for VJ Loops

The correct fix is in the **content**, not the player. A video trimmed so frame 0 visually matches the last frame produces an invisible hard cut — no code needed. The Clipper (§19) gives users exactly this tool.

The existing 1–4 frame hard cut is less distracting to a VJ audience than a 400ms dissolve firing on every loop cycle.

### 23.5 Future Path (If Revisited)

If MSE becomes available in WKWebView or the macOS requirement is dropped:
1. Use FFmpeg.wasm (already in project) to re-encode imported video as fragmented MP4 at upload time
2. Fetch the ArrayBuffer, manage a `SourceBuffer` append loop with `timestampOffset` advancement
3. Feed the MSE-backed `<video>` element into the existing `_tickVideoAnimations` texture upload — no canvas changes needed

---

## 27. Transparent WebM on macOS — Stacked-Alpha

> **Status:** ✅ **SHIPPED May 13, 2026.** Confirmed working in `npm run tauri-dev` — transparent layer renders over MilkDrop visualizer. Full build history and architecture in [`apng-dev.md`](apng-dev.md).
> **DMG:** needs a fresh `./build-and-sign.sh` run to distribute this version.

**The problem:** WKWebView (macOS Tauri's browser engine) plays VP9 video but silently drops the alpha channel. Sammie Roto exports import as opaque on macOS. Web (Chrome) and Windows (WebView2) work natively — shipped May 12.

**The solution (validated empirically in Safari, May 13):** convert the WebM to a *stacked-alpha* format — a regular VP9 video at 2× the source height, with RGB pixels in the top half and the alpha channel encoded as plain grayscale luma in the bottom half. WKWebView plays it as ordinary VP9 (no alpha decoding needed — there's no alpha stream). A WebGL shader samples the top half for RGB and the bottom half for alpha, outputting a transparent texture.

**Why this works where APNG, ogv.js, and HEVC alpha all failed:** none of those approaches got WKWebView to actually decode alpha. Stacked-alpha avoids the problem entirely by hiding the alpha as plain luma in a regular VP9 video.

**Pipeline:**
```
WebM with VP9 alpha (Sammie Roto)
   ↓  macOS Tauri only
   ↓  Tauri sidecar invokes bundled ffmpeg binary
   ↓
Stacked-alpha WebM (2× height, regular VP9, no alpha track)
   ↓
WKWebView <video> element (native VP9 playback)
   ↓
WebGL composite shader (samples top half RGB, bottom half luma → RGBA)
   ↓
Existing layer pipeline — VJ effects, audio reactivity, all unchanged
```

**File sizes (measured):** source `bunny.webm` 5.4 MB → stacked `bunny_stacked.webm` 3.3 MB. Smaller than the source. Hardware-accelerated VP9 encode on M1 runs at ~0.9× real-time.

**Test files preserved at `~/Desktop/hevc-alpha-test/`** including a working Safari validation page (`test-stacked.html`).

**Files to be modified to ship this:**
- `src-tauri/tauri.conf.json` — enable sidecar
- `src-tauri/src/main.rs` — Rust command wrapping the ffmpeg sidecar
- `src-tauri/binaries/ffmpeg-{aarch64,x86_64}-apple-darwin` — bundled ffmpeg binary (new)
- `src/editor/inspector.js` — `_handleWebmAlphaUpload()` method, macOS-gated
- `src/visualizer.js` — `_loadStackedAlphaVideo()` and stacked-alpha shader

**Files that must NOT be touched** (web + Windows transparent WebM path):
- `_addVideoLayer()` — existing video upload, unchanged on web/Windows
- `_tickVideoAnimations()` — existing tick loop (the May 12 `clearRect` fix is load-bearing)

The Sammie Roto workflow this finally unlocks:
```
AI cutout tool → WebM with alpha → DiscoCast (any platform) → transparent layer → VJ effects
```

No other VJ tool supports this end-to-end. See `apng-dev.md` for the validated research, phased implementation checklist, and handoff details.
