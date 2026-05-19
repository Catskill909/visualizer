# Live Video Input Layer — Package Review & Architecture Analysis

> **Date:** May 18, 2026
> **Status:** 📋 Research Complete — Awaiting Decision

---

## 1. Your Existing Architecture (Why This Is Easy)

Your codebase already has **every building block** needed for live video layers. The gap is smaller than it looks:

### What you already have

| Capability | Where it lives | Reuse for live video? |
|---|---|---|
| **getUserMedia (audio)** | [visualizer.js:246](file:///Users/paulhenshaw/Desktop/winamp-screen/src/visualizer.js#L246), [devicePicker.js:143](file:///Users/paulhenshaw/Desktop/winamp-screen/src/devicePicker.js#L143) | ✅ Same API — just add `{ video: true }` |
| **Video → Canvas → GL texture upload** | [visualizer.js:1411-1473](file:///Users/paulhenshaw/Desktop/winamp-screen/src/visualizer.js#L1411-L1473) (`_tickVideoAnimations`) | ✅ **Direct reuse** — a `<video>` fed by a MediaStream uploads identically to one fed by a blob URL |
| **_loadVideoTexture()** | [visualizer.js:1254-1362](file:///Users/paulhenshaw/Desktop/winamp-screen/src/visualizer.js#L1254-L1362) | ✅ Works with any `<video>` element — webcam or file |
| **Device enumeration & picker UI** | [devicePicker.js](file:///Users/paulhenshaw/Desktop/winamp-screen/src/devicePicker.js) | ✅ Already enumerates `audioinput` — extend to `videoinput` |
| **Full VJ effects pipeline (GLSL)** | [inspector.js](file:///Users/paulhenshaw/Desktop/winamp-screen/src/editor/inspector.js) (color grading, luma key, wave distort, etc.) | ✅ All effects work on any texture — webcam frames included |
| **Layer card system** | `_addVideoLayer()`, `_mountLayerCard()` | ✅ Same card layout, just different source |
| **Audio reactivity** | Bass/Mid/Treble/Flux sources | ✅ All reactive controls work on any layer type |

> [!IMPORTANT]
> **The key insight:** Your `_tickVideoAnimations()` loop doesn't care where the `<video>` element's frames come from. A webcam stream attached via `video.srcObject = stream` uploads to WebGL exactly the same way as a file-based video via `video.src = blobUrl`. This is why **no package is needed**.

---

## 2. NPM Package Evaluation

I reviewed every relevant package. **None of them add meaningful value** over what the browser already gives you for free:

| Package | What it does | Why NOT to use it |
|---|---|---|
| **`webcam-easy`** | Thin wrapper around `getUserMedia` + snapshot | ~3KB but all it does is wrap a 5-line API call. Adds a dependency for zero gain. Your `devicePicker.js` already does more. |
| **`react-webcam`** | React component for webcam | You're vanilla JS, not React. Dead on arrival. |
| **`camera-capture`** | Frame-by-frame raw data from webcam | Designed for Node/CLI pipelines. You don't need raw frame data — you need a `<video>` element for `texSubImage2D`. |
| **`tracking.js`** | Computer vision (face/color tracking) | Stale (last update 2018). If you want tracking later, TensorFlow.js is the modern choice. |
| **`Three.js VideoTexture`** | Auto-updating video texture | You're not using Three.js for compositing (yet — 3D layers will). Your direct GL upload is faster. |
| **`Hydra`** | Live-coding visual synth | Cool inspiration but a complete replacement engine, not a library you plug in. |
| **`PixiJS`** | 2D WebGL renderer | Another engine — you'd be adding a second renderer alongside Butterchurn. Overkill. |

> [!TIP]
> **Verdict: Build from scratch.** The entire "package" is ~50 lines of code wrapping two native browser APIs you already use. Adding an npm dependency would be like importing a library to call `document.getElementById()`.

---

## 3. The Two Live Input Sources

A live video layer supports **two sources**, both using the same `<video>` → GL pipeline:

### 3.1 Webcam (`getUserMedia`)

```javascript
// This is literally the entire webcam capture:
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 } }
});
const video = document.createElement('video');
video.srcObject = stream;
video.playsInline = true;
video.muted = true;
await video.play();
// → Pass this video element to _loadVideoTexture(name, video, 1280, 720)
// → _tickVideoAnimations() uploads frames to GL automatically
// → All VJ effects (luma key, wave distort, color grading) work immediately
```

### 3.2 Screen Capture (`getDisplayMedia`)

```javascript
// Screen/window/tab capture:
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { width: { ideal: 1920 }, height: { ideal: 1080 } }
});
const video = document.createElement('video');
video.srcObject = stream;
video.playsInline = true;
video.muted = true;
await video.play();
// → Same pipeline as webcam
```

> [!WARNING]
> **Tauri/macOS constraint:** `getDisplayMedia` may require additional entitlements in the macOS app (Screen Recording permission). On the web build it works out of the box. Webcam (`getUserMedia` with video) should work in Tauri since you already have mic permission — just add `NSCameraUsageDescription` to `entitlements.plist`.

---

## 4. How It Fits Into Your Layer System

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    Layers Tab                             │
│                                                          │
│  📷 Image  │  🎬 Video  │  ✏️ Text  │  📹 Live  │  🧊 3D │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  📹  Webcam (Front Camera)        ● LIVE  👁 🔇 ⤵  │ │
│  │  ─────────────────────────────────────────────────── │ │
│  │  Source: [Webcam ▼] [🔄 Switch]                     │ │
│  │  Resolution: 1280×720 (auto-detected)               │ │
│  │  ─────────────────────────────────────────────────── │ │
│  │  Scale      [━━━━━●━━━━━] 0.60                      │ │
│  │  Opacity    [━━━━━━━●━━━] 0.85                      │ │
│  │  Mirror     [None  ↔H  ↕V  ✦Q  ✶K]                 │ │
│  │  ─────────────────────────────────────────────────── │ │
│  │  [Color grading, VJ effects — identical to video]   │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

```
                getUserMedia / getDisplayMedia
                         │
                    MediaStream
                         │
                  ┌──────▼──────┐
                  │  <video>    │  ← srcObject = stream
                  │  (hidden)   │
                  └──────┬──────┘
                         │
              _loadVideoTexture(name, video, w, h)
                         │
                  ┌──────▼──────┐
                  │  GL Texture │  ← texSubImage2D each frame
                  │  (sampler)  │
                  └──────┬──────┘
                         │
              _tickVideoAnimations()  ← existing render loop
                         │
                  ┌──────▼──────┐
                  │  GLSL comp  │  ← all VJ effects for free
                  │  shader     │
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │  Butterchurn│  ← composited over MilkDrop
                  │  output     │
                  └─────────────┘
```

---

## 5. What's Different From File Video Layers

| Aspect | File Video Layer | Live Video Layer |
|---|---|---|
| **Source** | Blob URL from IndexedDB | MediaStream from `getUserMedia`/`getDisplayMedia` |
| **Duration** | Finite (scrub bar, trim) | Infinite (no scrub, no trim) |
| **Playback controls** | Play/pause, speed, loop, scrub | Pause/resume stream only (no rewind) |
| **Storage** | Saved to IndexedDB, exported in presets | **Not persisted** — stream is live-only. Preset saves the *config* (source type, device ID, effects) but not the video data. |
| **Layer card** | Scrub bar, speed dropdown, trim | Source picker dropdown, resolution badge, "● LIVE" indicator |
| **Texture upload** | `ctx.drawImage(video) → getImageData → texSubImage2D` | **Same path** — identical `_tickVideoAnimations()` code |
| **Performance** | Decodes from file buffer | Decodes from hardware camera — often lighter |

---

## 6. UI & Controls

### Live-specific controls (replace playback section)

| Control | Purpose |
|---|---|
| **Source dropdown** | `Webcam` / `Screen Capture` toggle |
| **Device picker** | For webcam: list available cameras (extend `devicePicker.js` to enumerate `videoinput` devices) |
| **● LIVE badge** | Pulsing green dot in the card header — indicates active stream |
| **Freeze** | Pause the stream (holds last frame as a static texture) |
| **Flip H** | Mirror the webcam horizontally (selfie correction) — a `transform: scaleX(-1)` before GL upload |

### Reused from video layers (all work identically)

- Scale, Opacity, Blend Mode, Spin, Orbit, Bounce, Sway, Mirror, Tunnel
- Full color grading (Brightness, Contrast, Gamma, Fade, Temp, Sepia, Blur, etc.)
- All VJ effects (Luma Key, Wave Distort, Invert, Solarize, Threshold, Pixelate, Scan Lines, Film Grain)
- Audio reactivity (Bass/Mid/Treble/Flux → Pulse, Bounce, Strobe, Opacity Pulse)
- Chromatic Aberration, Posterize, Edge Sobel

---

## 7. Phased Implementation Plan

### Phase 1: Webcam Layer (MVP) — ~2-3 hours
- [ ] Add `📹 Live` button to Layers tab (next to `✏️ Text`)
- [ ] `_addLiveLayer()` method in `inspector.js`:
  - Calls `getUserMedia({ video: { width: 1280, height: 720 } })`
  - Creates `<video>` element, sets `srcObject = stream`
  - Calls existing `_loadVideoTexture()` — frames flow through `_tickVideoAnimations()` automatically
  - Creates layer entry with `type: 'live'`
- [ ] Layer card: source badge, freeze button, no scrub/trim/speed controls
- [ ] Cleanup: stop MediaStream tracks on layer delete

### Phase 2: Device Selection — ~1 hour
- [ ] Extend `devicePicker.js` to enumerate `videoinput` devices
- [ ] Add camera picker dropdown to live layer card
- [ ] Support switching cameras without deleting the layer (stop old stream, start new)

### Phase 3: Screen Capture — ~1 hour
- [ ] Add Source dropdown: `Webcam` / `Screen Capture`
- [ ] `getDisplayMedia()` path for screen/window/tab capture
- [ ] Handle the user-cancelled-picker case gracefully

### Phase 4: Preset Persistence — ~1 hour
- [ ] Save live layer config (source type, device preference, all effects) to preset
- [ ] On preset load, attempt to reconnect to the saved device (or show picker if unavailable)
- [ ] Export: strip the live source reference (layers survive export as "reconnect on load")

### Phase 5: Tauri Integration — ~1-2 hours
- [ ] Add `NSCameraUsageDescription` to `entitlements.plist`
- [ ] Test webcam in WKWebView (should work like mic — already have `getUserMedia`)
- [ ] Screen capture: test `getDisplayMedia` in Tauri, add Screen Recording entitlement if needed

---

## 8. Estimated Effort

| Component | Lines of code | Time |
|---|---|---|
| `_addLiveLayer()` + stream setup | ~60 lines | 30 min |
| Layer card UI (live-specific controls) | ~80 lines | 45 min |
| Device picker extension | ~30 lines | 20 min |
| Screen capture source | ~20 lines | 15 min |
| Cleanup / stream lifecycle | ~30 lines | 20 min |
| Preset persistence (save/load config) | ~40 lines | 30 min |
| Tauri entitlements | ~5 lines (plist) | 10 min |
| **Total** | **~265 lines** | **~3 hours** |

> [!NOTE]
> This is the smallest layer type you've built. For comparison:
> - Image layers: ~200 lines entry defaults + 400+ lines of tile controls
> - Video layers: ~280 lines for `_addVideoLayer` alone
> - Text layers: ~150 lines entry + ~120 lines for `_renderTextTexture`
>
> Live video is simpler because it has **no persistence** (no IndexedDB blobs), **no transcoding**, and **no playback controls** (no scrub, trim, speed, loop). It's essentially a video layer minus everything that makes video layers complex.

---

## 9. Recommendation

> [!IMPORTANT]
> ### Build from scratch. Zero packages needed.
>
> Your `_tickVideoAnimations()` loop already does the hard work — it uploads `<video>` element frames to a GL texture 60 times per second. A webcam or screen capture stream is just a different source for that same `<video>` element. The entire integration is:
>
> 1. `getUserMedia({ video: true })` → get a `MediaStream`
> 2. `video.srcObject = stream` → attach to a hidden `<video>` element
> 3. `_loadVideoTexture(name, video, w, h)` → register in the existing animation map
> 4. Done. `_tickVideoAnimations()` handles the rest. All VJ effects work immediately.
>
> Adding an npm package for this would be adding a dependency to wrap a 5-line browser API call.

---

## 10. Creative Possibilities (The "Wow" Factor)

Once live video is a layer, your existing effects stack makes these instant:

| Effect | How | Impact |
|---|---|---|
| **Webcam + Luma Key** | Key out dark background → webcam person floats over MilkDrop | VJ classic |
| **Webcam + Kaleido Mirror** | 4-way or kaleidoscope of the performer | Psychedelic |
| **Webcam + Wave Distort** | Audio-reactive ripple on the performer's face | Trippy |
| **Webcam + Scan Lines + Film Grain** | CRT-era broadcast look | Retro VJ |
| **Webcam + Chromatic Aberration** | RGB split on the live feed | Glitch art |
| **Screen Capture + Color Grading** | Capture another app's output and process it as a VJ layer | Meta-VJ |
| **Webcam + Threshold + Beat Pulse** | Binary black/white silhouette that pulses to bass | Industrial |
| **Webcam + Pixelate** | Audio-reactive pixel resolution | 8-bit live |
