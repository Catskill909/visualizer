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

*Document created for brainstorming session. Simplified spec reflects May 7, 2026 discussion — no tiling, single-quad video layers with mirror-based duplication. VJ effects brainstorm added May 8, 2026.*
