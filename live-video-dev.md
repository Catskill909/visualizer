# Live Video Input Layer — Architecture & Implementation Plan

> **Date:** May 18, 2026
> **Status:** 🚀 Approved for Production Phase

---

## 1. Existing Architecture & Reusability

Your codebase already has **every building block** needed for live video layers. The integration relies entirely on native browser APIs, ensuring maximum performance without the bloat of external dependencies or AI processing engines.

### Reusable Components

| Capability | Where it lives | Reuse for live video? |
|---|---|---|
| **getUserMedia (audio)** | `src/visualizer.js`, `src/devicePicker.js` | ✅ Same API — just add `{ video: true }` |
| **Video → Canvas → GL texture upload** | `_tickVideoAnimations` | ✅ **Direct reuse** — a `<video>` fed by a MediaStream uploads identically to a blob URL |
| **_loadVideoTexture()** | `_loadVideoTexture` | ✅ Works with any `<video>` element |
| **Device enumeration & picker UI** | `devicePicker.js` | ✅ Already enumerates `audioinput` — extend to `videoinput` |
| **Full VJ effects pipeline (GLSL)** | `inspector.js` (color grading, luma key, etc.) | ✅ All effects work on any texture — webcam frames included |
| **Layer card system** | `_addVideoLayer()`, `_mountLayerCard()` | ✅ Same card layout, just different source |
| **Audio reactivity** | Bass/Mid/Treble/Flux sources | ✅ All reactive controls work on any layer type |

> [!IMPORTANT]
> **The Core Insight:** Your `_tickVideoAnimations()` loop doesn't care where the `<video>` element's frames come from. A webcam stream attached via `video.srcObject = stream` uploads to WebGL exactly the same way as a file-based video.

---

## 2. Live Input Sources

A live video layer supports **two sources**, both utilizing the same `<video>` → GL pipeline. 

### 2.1 Webcam (`getUserMedia`)

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 } }
});
const video = document.createElement('video');
video.srcObject = stream;
video.playsInline = true;
video.muted = true;
await video.play();
// → Pass video element to _loadVideoTexture(name, video, 1280, 720)
// → _tickVideoAnimations() uploads frames to GL automatically
```

### 2.2 Screen Capture (`getDisplayMedia`)

```javascript
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
> **Tauri/macOS constraint:** `getDisplayMedia` may require additional entitlements in the macOS app (Screen Recording permission). Webcam (`getUserMedia` with video) should work out of the box in Tauri since you already have mic permission — just add `NSCameraUsageDescription` to `entitlements.plist`.

---

## 3. Architecture & Data Flow

### Data Flow Pipeline

```text
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

## 4. Layer System Integration

### Differences From File Video Layers

| Aspect | File Video Layer | Live Video Layer |
|---|---|---|
| **Source** | Blob URL from IndexedDB | MediaStream |
| **Duration** | Finite (scrub bar, trim) | Infinite (no scrub, no trim) |
| **Playback controls** | Play/pause, speed, loop, scrub | Pause/resume stream only |
| **Storage** | Saved to IndexedDB | **Not persisted**. Preset saves the config (source, device, effects). |
| **Layer card** | Scrub bar, speed dropdown, trim | Source picker, resolution badge, "● LIVE" indicator |
| **Texture upload** | `ctx.drawImage` → `texSubImage2D` | **Same path** |

### Live-Specific Controls

*   **Source dropdown:** `Webcam` / `Screen Capture` toggle.
*   **Device picker:** For webcam: list available cameras.
*   **● LIVE badge:** Pulsing green dot in the card header.
*   **Freeze:** Pause the stream (holds last frame as a static texture).
*   **Flip H:** Mirror the webcam horizontally (selfie correction).

*(All other VJ effects like Scale, Opacity, Luma Key, Color Grading, and Audio Reactivity work identically.)*

---

## 5. Phased Implementation Plan

### Phase 1: Webcam Layer (MVP)
- [ ] Add `📹 Live` button to Layers tab.
- [ ] Implement `_addLiveLayer()` method in `inspector.js`:
  - Call `getUserMedia`.
  - Create `<video>` element, set `srcObject`.
  - Call `_loadVideoTexture()`.
  - Create layer entry with `type: 'live'`.
- [ ] Implement MVP layer card: source badge, freeze button.
- [ ] Cleanup: stop MediaStream tracks on layer delete.

### Phase 2: Device Selection
- [ ] Extend `devicePicker.js` to enumerate `videoinput` devices.
- [ ] Add camera picker dropdown to live layer card.
- [ ] Support switching cameras seamlessly.

### Phase 3: Screen Capture
- [ ] Add Source dropdown: `Webcam` / `Screen Capture`.
- [ ] Implement `getDisplayMedia()` path for screen capture.
- [ ] Handle user-cancelled-picker exceptions.

### Phase 4: Preset Persistence
- [ ] Save live layer config (source type, device preference, all effects) to preset.
- [ ] On preset load, attempt to reconnect to the saved device.

### Phase 5: Tauri Integration
- [ ] Add `NSCameraUsageDescription` to `entitlements.plist`.
- [ ] Verify `getDisplayMedia` in Tauri; add Screen Recording entitlement if needed.

---

## 6. Native GLSL Features (No AI Required)

By leveraging the native pipeline, you instantly unlock creative capabilities without adding heavy AI models. 

| Effect | Implementation Strategy | Impact |
|---|---|---|
| **Chroma/Luma Key** | Existing GLSL shader sets background color threshold alpha to `0.0` | Instantly float webcam subject over visualizer |
| **Kaleido Mirror** | Standard geometry transformation | Psychedelic multi-camera effect |
| **Audio Reactivity** | Wave distort / Beat pulse tied to audio analysis | Performer's face reacts to the music |
| **CRT Monitor** | Scan lines + Film grain GLSL pass | Retro broadcast look |
| **Glitch Art** | Chromatic aberration split on live feed | Raw industrial aesthetic |
