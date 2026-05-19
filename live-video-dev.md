# Live Video Input Layer — Architecture, Audit & Decision

> **Date:** May 18, 2026 (plan) · **Audited:** May 19, 2026
> **Status:** ⏸️ **SHELVED — not approved.** Too many unfixable browser-security caveats for the value. See § 0.

---

## 0. Audit & Decision (May 19, 2026)

A deep audit was done against the actual codebase before committing to this feature. **Conclusion: shelve it.** The core pipeline reuse is real, but the feature is surrounded by caveats that are not bugs to fix — they are browser-security rules that cannot be worked around. The result is a layer type that half-works (webcam) and partly can't work at all (screen capture). Not worth shipping in that state.

This section captures the full audit so the reasoning is not lost. **The original plan (§ 1–6 below) is kept for reference but is NOT accurate as written — read this section first; it corrects it.**

### 0.1 What the audit verified as TRUE ✅

- **[`devicePicker.js`](src/devicePicker.js) exists** — the plan's claim was right (README never listed it). It is audio-only today (`getUserMedia({audio:true})`, filters `audioinput`).
- **[`_loadVideoTexture()`](src/visualizer.js#L1254) accepts any `<video>` element** — a `srcObject`-fed stream uploads identically to a blob-backed video. It force-sets `videoElement.loop = true` and adds an `ended` listener; both are harmless no-ops for a live MediaStream.
- **[`_tickVideoAnimations()`](src/visualizer.js#L1411) works for streams** — the per-frame upload loop doesn't care where frames come from. The "Core Insight" in § 1 is sound.
- **Freeze comes for free** — `_tickVideoAnimations` already does `if (videoElement.paused) continue` ([visualizer.js:1416](src/visualizer.js#L1416)). Pausing the element holds the last uploaded frame as a static texture. Zero new code.

### 0.2 What the audit found WRONG ❌ — the blockers

1. **`nginx.conf` blocks the camera on the deployed web app.** [nginx.conf:15](nginx.conf#L15) sends `Permissions-Policy: microphone=(self), camera=(), geolocation=(), interest-cohort=()`. `camera=()` disables the camera for the whole origin — `getUserMedia({video:true})` rejects on the live Coolify site regardless of any code. Would need `camera=(self)`. The plan never mentions this.

2. **`entitlements.plist` has no camera entitlement.** [entitlements.plist](src-tauri/entitlements.plist) has `com.apple.security.device.audio-input` + `com.apple.security.device.microphone` only. Webcam in the macOS app needs `com.apple.security.device.camera` added.

3. **The plan conflates two different things (§ 2.2 / Phase 5 are wrong).** `NSCameraUsageDescription` is **not** an entitlement and does **not** go in `entitlements.plist`. It is an **Info.plist** usage-description string. [build-and-sign.sh:113-114](build-and-sign.sh#L113) injects `NSMicrophoneUsageDescription` into Info.plist via `PlistBuddy` at build time. So Tauri needs **two** separate changes: (a) the `device.camera` *entitlement* in `entitlements.plist`, and (b) a new `NSCameraUsageDescription` *Info.plist* injection step in `build-and-sign.sh`. The plan's claim that webcam "works out of the box in Tauri since you already have mic permission" is **false** — camera is a separate macOS TCC permission from microphone.

### 0.3 What the audit found UNDERSOLD 🟡

4. **The layer card is not "same card, different source."** [`_mountLayerCard`](src/editor/inspector.js#L2919) branches on `entry.type === 'video'` in ~8 places (scrub bar, speed dropdown, Scale-vs-Size label, etc.). A `type:'live'` entry falls through every branch and renders the **image** controls (Size slider, tiling) — wrong. Each branch needs an explicit `type === 'live'` arm.

5. **`_addVideoLayer()` is not reusable.** [inspector.js:2484](src/editor/inspector.js#L2484) is almost entirely file-specific: 720p transcode guard, `storeImage()` to IndexedDB, `URL.createObjectURL`. A live layer needs a separate `_addLiveLayer()` (the plan's Phase 1 already says this — correct).

6. **Use the fast upload path.** `_tickVideoAnimations` has two paths: the standard one does `drawImage → getImageData → texSubImage2D` — a per-frame CPU readback ([visualizer.js:1440-1443](src/visualizer.js#L1440)); the stacked-alpha one does direct `gl.texSubImage2D(..., videoElement)` (GPU-side, much faster). A live webcam should use the **direct** path, not the readback path the plan implies by "Same path."

### 0.4 The unfixable caveats — why it's shelved

These are not implementation bugs. They are how browsers work, and they cannot be coded around:

- **Camera warmup ≈ 0.3–1.5 s.** `getUserMedia` + sensor warmup is not instant. Any preset/timeline block that acquires a stream on load shows a black/"no signal" frame for up to ~1.5 s, breaking every crossfade — unless a persistent stream is kept alive for the whole session (real extra machinery).
- **Screen capture can NEVER auto-engage.** `getDisplayMedia()` requires a fresh **user gesture every single time** — no exception for "permission already granted." A timeline auto-advance is not a gesture. A screen-capture live layer in a timeline block can never come back on its own; it always needs a manual click. Unfixable.
- **`deviceId` is not portable.** `MediaDeviceInfo.deviceId` is scoped per-origin **and** per-device, and is blank before permission is granted. It is stable on the *same* machine, but a preset exported to another Mac cannot resolve its saved camera — best case it falls back to the default camera via `{deviceId:{ideal:saved}}`.

### 0.5 Timeline behaviour (the question that settled it)

*"Save a preset with a live layer, drop it in the timeline — will it engage the saved camera?"*

- The timeline plays blocks via `engine.loadPreset(presetName, blend)` ([timelineEditor.js:1818](src/timeline/timelineEditor.js#L1818) / [1882](src/timeline/timelineEditor.js#L1882) / [1895](src/timeline/timelineEditor.js#L1895)).
- `loadPreset` rebinds custom-preset layers at [visualizer.js:408-489](src/visualizer.js#L408-L489) with **two arms only**: static images (need `imageId`) and videos (need `videoId`). A `type:'live'` entry has neither, so it is **silently skipped** by both [line 414](src/visualizer.js#L414) and [line 445](src/visualizer.js#L445). **Today, a live layer in a timeline does nothing — the camera never engages.**
- **Webcam *could* be made to work, same machine only:** camera permission persists once granted, and `getUserMedia` does **not** need a user gesture after that — so a timeline auto-advance *could* call `getUserMedia({video:{deviceId:{exact:saved}}})` and re-engage the right camera with no prompt. This requires a new `type === 'live'` arm in the `loadPreset` bind loop **plus** a persistent live-source manager (open the stream once when the show arms, share it across blocks, never tear down — otherwise every block eats the warmup black frame).
- **Screen capture cannot** — see § 0.4. A timeline can never bring a screen share back.

### 0.6 Cross-machine import

A live layer stores **no pixel data** — no blob, no IndexedDB entry. It is a *recipe, not a recording*: `type:'live'`, source type, a `deviceId`, and the effect/transform values. On import to another machine it can only restore the *look* and *intent*; the feed must be re-established live, with a fresh permission prompt, and the saved `deviceId` will almost never match. Correct behaviour would be: load **disconnected** (black texture + "Connect Camera" / "Start Capture" button), needing its own branch in the load path since the existing `savedEntry.type === 'video'` block at [inspector.js:7190](src/editor/inspector.js#L7190) assumes a `videoId` blob a live entry doesn't have.

### 0.7 If this is ever revisited

Do **not** start from § 1–6 as written. The real work, in order:

1. **Unblock (3 files):** `nginx.conf` `camera=()` → `camera=(self)`; add `com.apple.security.device.camera` to `entitlements.plist`; add an `NSCameraUsageDescription` `PlistBuddy` injection to `build-and-sign.sh` (mirror the mic block at line 113).
2. `_addLiveLayer()` + `type:'live'` arms in every `_mountLayerCard` `=== 'video'` branch.
3. Direct `texSubImage2D(videoElement)` upload path for live layers.
4. A **persistent live-source manager** owning streams for the session + a `type === 'live'` arm in the `loadPreset` bind loop — required for timeline use.
5. Disconnected-on-load + reconnect UI for imported presets.
6. Accept that screen capture never auto-engages, and that webcam `deviceId` is best-effort cross-machine.

---

> **Everything below this line is the original May 18 plan. It is preserved for reference only and is corrected by § 0 above — in particular § 2.2 and Phase 5 are factually wrong.**

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
| **Layer card system** | `_addVideoLayer()`, `_mountLayerCard()` | 🟡 See § 0.3 #4 — card has ~8 `type==='video'` branches needing `'live'` arms; `_addVideoLayer` is NOT reusable |
| **Audio reactivity** | Bass/Mid/Treble/Flux sources | ✅ All reactive controls work on any layer type |

> [!IMPORTANT]
> **The Core Insight:** Your `_tickVideoAnimations()` loop doesn't care where the `<video>` element's frames come from. A webcam stream attached via `video.srcObject = stream` uploads to WebGL exactly the same way as a file-based video. *(Audit-confirmed true — see § 0.1.)*

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
> **⚠️ THIS BOX IS WRONG — see § 0.2 #3.** `NSCameraUsageDescription` is an *Info.plist* key, not an entitlement, and does not go in `entitlements.plist`. Webcam does **not** "work out of the box in Tauri" — camera is a separate macOS TCC permission from mic. The macOS app needs the `com.apple.security.device.camera` entitlement in `entitlements.plist` **and** an `NSCameraUsageDescription` injection step in `build-and-sign.sh`. Also: `getDisplayMedia` always requires a fresh user gesture (§ 0.4) and `camera=()` in `nginx.conf` blocks webcam on the deployed web app (§ 0.2 #1).

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
| **Storage** | Saved to IndexedDB | **Not persisted** — recipe, not recording (§ 0.6). Preset saves config only (source, device, effects); loads disconnected on another machine. |
| **Layer card** | Scrub bar, speed dropdown, trim | Source picker, resolution badge, "● LIVE" indicator |
| **Texture upload** | `ctx.drawImage` → `texSubImage2D` | Use the **direct** `texSubImage2D(videoElement)` path (§ 0.3 #6), not the readback path |

### Live-Specific Controls

*   **Source dropdown:** `Webcam` / `Screen Capture` toggle.
*   **Device picker:** For webcam: list available cameras.
*   **● LIVE badge:** Pulsing green dot in the card header.
*   **Freeze:** Pause the stream (holds last frame as a static texture — free, see § 0.1).
*   **Flip H:** Mirror the webcam horizontally (selfie correction).

*(All other VJ effects like Scale, Opacity, Luma Key, Color Grading, and Audio Reactivity work identically.)*

---

## 5. Phased Implementation Plan

> ⚠️ **Phase 5 below is wrong as written — see § 0.2 #3 and § 0.7 for the corrected sequence.**

### Phase 1: Webcam Layer (MVP)
- [ ] Add `📹 Live` button to Layers tab.
- [ ] Implement `_addLiveLayer()` method in `inspector.js`:
  - Call `getUserMedia`.
  - Create `<video>` element, set `srcObject`.
  - Call `_loadVideoTexture()`.
  - Create layer entry with `type: 'live'`.
- [ ] Add `type === 'live'` arms to every `type === 'video'` branch in `_mountLayerCard` (§ 0.3 #4).
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

### Phase 4: Preset Persistence & Timeline
- [ ] Save live layer config (source type, device preference, all effects) to preset.
- [ ] Add a `type === 'live'` arm to the `loadPreset` bind loop ([visualizer.js:408-489](src/visualizer.js#L408-L489)).
- [ ] Build a **persistent live-source manager** (own streams for the session, share across blocks — required for timeline; § 0.5).
- [ ] On preset load on another machine, load **disconnected** with a reconnect button (§ 0.6); webcam may auto-attempt `getUserMedia` with the saved `deviceId` as `ideal`.

### Phase 5: Tauri / Web Unblock — ⚠️ CORRECTED, see § 0.2 / § 0.7
- [ ] `nginx.conf`: change `camera=()` → `camera=(self)` (else webcam is dead on the deployed site).
- [ ] `entitlements.plist`: add `com.apple.security.device.camera`.
- [ ] `build-and-sign.sh`: add an `NSCameraUsageDescription` `PlistBuddy` injection (mirror the `NSMicrophoneUsageDescription` block at line 113).
- [ ] Verify `getDisplayMedia` in Tauri WKWebView.

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
