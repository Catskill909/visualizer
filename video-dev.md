# Video Layer Feature — Brainstorm & Audit Document

> **Status:** ✅ **SHIPPED** — Phase 1 Complete  
> **Date:** May 7, 2026  
> **Goal:** Video layer playback with macOS WKWebView support

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

### 5.1 Resolution Enforcement (MVP)

**Phase 1 (MVP): Hard 720p limit — no conversion library**

```javascript
// Upload guard — reject oversized videos
const MAX_VIDEO_WIDTH = 1280;
const MAX_VIDEO_HEIGHT = 720;

if (videoWidth > MAX_VIDEO_WIDTH || videoHeight > MAX_VIDEO_HEIGHT) {
  showToast("Video must be 720p or lower. Please downscale externally.");
  return; // Reject upload
}
```

**Rationale:**
- No heavy dependencies (FFmpeg.wasm = ~25MB)
- Predictable performance — all uploads are GPU-friendly
- Matches GIF pattern: simple first, optimizer later

### 5.2 Conversion / Optimizer (Phase 2)

After MVP validation, add optional FFmpeg.wasm conversion:

```javascript
// Phase 2: Detect oversized → offer conversion
if (videoWidth > 1280 || videoHeight > 720) {
  showOptimizerModal({
    source: file,
    target: { width: 1280, height: 720, fps: 30 },
    library: '@ffmpeg/ffmpeg' // Lazy-loaded ~25MB
  });
}
```

**FFmpeg.wasm workflow:**
1. Lazy-load library on first oversized upload
2. Transcode to 720p H.264 (consistent format)
3. Store result, discard original
4. Progress bar during conversion (~30-60s for 1min 1080p)

**Why delay this:**
- 25MB dependency is heavy if most users follow guidelines
- Complex WebAssembly threading setup
- Only needed if users don't pre-downscale

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

### Phase 1: Core Video Playback (MVP) — No Tiling, Hard 720p
- **Upload guard:** Reject videos > 720p (1280×720)
- **Upload flow:** MP4/WebM → detect → create video layer (defaults: scale=0.6, blend=screen, tile=off)
- **Texture pipeline:** Video element → canvas 2D → `gl.texSubImage2D` each frame
- **Playback controls:** Play/pause/scrub, Loop on/off
- **Transform controls:** Scale, Opacity, Spin, Orbit, Mirror (all reuse existing code)
- **Limit:** 2 video layers max (performance guard)

### Phase 2: Color Grading
- Brightness, Contrast, Gamma in GLSL (applied after texture sample)

### Phase 3: Audio Reactivity
- Pulse, Beat Fade, Bounce, Shake (already work — no new code needed)

### Phase 4: Video Optimizer (Conversion Library)
- **Library:** FFmpeg.wasm (lazy-loaded, ~25MB)
- **Trigger:** Detect oversized upload → offer conversion modal
- **Output:** 720p H.264, 30fps, consistent bitrate
- **Progress:** Show transcoding progress (~30-60s for 1min 1080p)
- **Result:** Store optimized video, discard original

### Phase 5: Polish
- Trim in/out
- Ping-pong loop
- Speed control (0.25x–4x)

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

### 14.3 Loop Workaround

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

### 14.4 Platform Differences Summary

| Aspect | Web (Chrome/Safari/Firefox) | macOS Tauri (WKWebView) |
|--------|------------------------------|-------------------------|
| `playsInline` | Recommended | **Required** |
| `muted` for autoplay | Often required | **Always required** |
| Blob URL revocation | Can revoke after load | **Must keep valid** |
| `loop` property | Works reliably | Needs manual restart |

### 14.5 Testing Checklist for macOS

Before shipping macOS builds with video support:

- [ ] Video imports without error
- [ ] Video plays immediately (no black frame)
- [ ] Video loops continuously without stopping
- [ ] Scale/opacity/transform sliders work without freezing
- [ ] Pulse/bounce audio reactivity works
- [ ] Play/pause button toggles correctly
- [ ] Video stops when layer deleted (no memory leak)

---

*Document created for brainstorming session. Simplified spec reflects May 7, 2026 discussion — no tiling, single-quad video layers with mirror-based duplication.*
