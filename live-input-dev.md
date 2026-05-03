# Live Audio Device Switcher — Implementation Log

## Current State (as of 2026-05-03) ✅ SHIPPED

All three pages have working live audio input. Device switching UI differs per page by design.

---

## Page-by-Page Status

### Main Visualizer (`index.html` / `controls.js`) ✅
- **"Live Audio" button:** Connects immediately to the default mic via `engine.connectMicrophone()`.
- **Device switching:** Native `<select id="device-select">` appears in the control bar after connecting. Populated by `populateDeviceList()`. Changing it calls `engine.connectMicrophone(deviceId)`.
- **No device picker modal** — see constraint below.

### Preset Editor (`editor.html` / `src/editor/main.js`) ✅
- **"Live Audio" button:** Shows the `devicePicker.js` modal (Choose Audio Input). User picks device, clicks Connect.
- **Device switching after connect:** Custom pill dropdown (`.tmw` widget) in the topbar shows active device and lists all inputs.

### Timeline Editor (`timeline.html` / `src/timeline/main.js`) ✅
- Identical to Preset Editor above.

---

## Key Architecture: `devicePicker.js`

Shared module used by editor and timeline. Two exports:

- `pickAudioDevice()` — enumerates devices, shows modal if ≥2, returns `deviceId | null`.
  - Tries `enumerateDevices()` first (no temp stream). Falls back to a temp `getUserMedia` stream only if labels are empty (browser without prior permission).
- `pickAndConnect(engine)` — wraps `pickAudioDevice()` + `engine.connectMicrophone(deviceId)`, returns `{ connected, deviceId, label }`.

---

## Critical Tauri/WKWebView Constraint

**The device picker modal cannot be used for the initial connection on the main page in the macOS app.**

### Why
The main page creates its `AudioContext` at startup (no user gesture), placing it in `suspended` state. Tauri's WKWebView (Safari engine) will not resolve `AudioContext.resume()` — the Promise hangs forever — when the context was created outside a user gesture. Since `pickAndConnect()` → `pickAudioDevice()` → `getUserMedia()` depends on the audio subsystem being active, it silently does nothing.

The editor and timeline work because `boot()` creates a **fresh `AudioContext` synchronously inside the click handler** before any `await`. WKWebView treats this as user-activated.

### What was tried (all failed on main page in macOS):
1. `pickAndConnect()` directly — silent hang, nothing visible
2. `await this.engine.audioContext.resume()` before `pickAndConnect()` — resume Promise itself hangs forever
3. `enumerateDevices()` first (skip temp stream) then `pickAndConnect()` — same hang

### What works
`engine.connectMicrophone()` called directly. This method internally handles `audioContext.resume()` in a way WKWebView accepts (it was always the working path before the device picker was added).

### Future path to add device picker on main page
Would require one of:
- Delay `engine.init()` (AudioContext creation) until the user's first click — significant refactor of `src/main.js` and `controls.js`
- Use a Tauri Rust command to enumerate audio devices natively, bypassing WKWebView's restriction
- After `connectMicrophone()` succeeds (audio now active), call `pickAudioDevice()` to let the user switch — two-step UX

---

## Files Changed

| File | Change |
|------|--------|
| `src/devicePicker.js` | Added `pickAudioDevice()` + `pickAndConnect()`. Removed dead `populateDeviceSelect()`. Enumerate-first logic to avoid unnecessary temp stream. |
| `src/controls.js` | `startWithMic()` / `switchToMic()` use `engine.connectMicrophone()` directly (safe for macOS). Imports `pickAndConnect` but does not use it for initial connection. |
| `src/editor/main.js` | Uses `pickAndConnect()` for initial connection. Custom `.tmw` topbar widget for device switching. |
| `src/timeline/main.js` | Same as editor. |
| `editor.html` / `timeline.html` | Added `.tmw` mic widget markup to topbar. Removed native `<select>` from mini-player. |
| `src/editor/style.css` / `src/timeline/style.css` | Added `.tmw-*` CSS for the pill dropdown widget. |
