# DiscoCast Visualizer — Output / Projection Brainstorm

> Audit, ideation, and implementation reference.
> Stack: Butterchurn / WebGL 2 canvas · Vite / Vanilla JS · Tauri v1.5 (macOS app) · served via Nginx/Coolify

---

## Recommended Path Forward

### Phase 1 — ✅ SHIPPED
1. **Resolution / aspect ratio lock** — `engine.lockResolution()` + `#canvas-wrapper` fill-mode CSS. Output popover (`O` key). Settings persist to `localStorage`.
2. **Wake Lock fix for macOS app** — `caffeinate -d` spawned via Tauri command; `requestWakeLock()` branches on `window.__TAURI__`. `tauri.conf.json` allowlist updated.
3. **`captureStream()` virtual camera toggle** — `engine.startVirtualCamera(60)` / `stopVirtualCamera()`. Toggle in Output popover; status dot turns green when live.

### Phase 2 — High-Value, Moderate Work
4. **Output window (second display)** — Start with `window.open()` + `screen.availLeft` on web (works today), then gate behind `window.__TAURI__` to use `WebviewWindow::builder()` for the macOS app. Biggest real-world VJ win.
5. **`MediaRecorder` record button** — ~50 lines, no deps. WebM on web, MP4 on Tauri (codec branch via `window.__TAURI__`). Natural companion to the output window.

### Phase 3 — Only if there's demand
- **WHIP streaming** — only worth it if users want to broadcast live.
- **Syphon** — high effort, macOS-only, niche audience (VJs using Resolume etc.). Evaluate based on user feedback.
- **NDI** — same as Syphon; defer.
- **Multi-Screen Window Placement API** — nice upgrade over `window.open()` hack but Chrome-only; the hack is fine for now.

### Skip for now
**ffmpeg.wasm** — heavy (~30MB), slow on GPU machines, `MediaRecorder` gives good-enough quality at a fraction of the complexity.

---

## Phase 1 — Implementation Plan

> Concrete, file-level spec. No new dependencies for items 1 and 3. Item 2 (Wake Lock fix) requires one small Rust change.

---

### Item 1 — Resolution / Aspect Ratio Lock

**Goal:** Let the user pin the canvas render size independently of the browser window, with a fill mode (letterbox, stretch, crop). Essential for projection at 1080p/4K or portrait LED columns.

**How the engine works today:**
- `engine.setSize(w, h)` in `visualizer.js:457` sets `canvas.width/height` and calls `visualizer.setRendererSize(w, h)`.
- `controls.js:371` calls `engine.setSize(window.innerWidth, window.innerHeight)` on every `resize` event. This is the only caller.
- The `<canvas id="visualizer-canvas">` is full-viewport via CSS.

**What to add:**

*`src/visualizer.js`*
- Add `this.lockedResolution = null` to the constructor (`{ w, h }` or `null` for free).
- Add `lockResolution(w, h)` / `unlockResolution()` methods. When locked, `setSize()` ignores the incoming dimensions and uses the locked values instead.

*`src/controls.js`*
- Add `this.outputSettings = { resolution: 'free', aspectRatio: 'free', fillMode: 'letterbox' }` to the constructor.
- Add a method `applyOutputSettings()` that:
  - If `resolution` is not `'free'`, calls `engine.lockResolution(w, h)` with the chosen pixel dimensions.
  - If `aspectRatio` is not `'free'`, derives dimensions from the window size constrained to the ratio.
  - Sets CSS on a new `#canvas-wrapper` div: `object-fit: contain | fill | cover` to letterbox / stretch / crop.
- The `resize` listener calls `applyOutputSettings()` instead of `engine.setSize()` directly.

*`index.html`*
- Wrap `<canvas id="visualizer-canvas">` in `<div id="canvas-wrapper">`. Canvas gets `width: 100%; height: 100%; display: block;` inside it.

*UI — new "Output" popover in the control bar (new button `btn-output`):*
- **Render Resolution** — `<select>`: "Match window" / 1280×720 / 1920×1080 / 2560×1440 / 3840×2160 / Custom (W×H text inputs).
- **Aspect Ratio** — `<select>`: Free / 16:9 / 4:3 / 21:9 / 1:1 / 9:16.
- **Fill Mode** — radio or `<select>`: Letterbox / Stretch / Crop.
- These settings persist to `localStorage` under key `discocast_output`.

**No new npm packages required.**

---

### Item 2 — Wake Lock Fix for macOS App

**Goal:** Prevent display sleep mid-set in the Tauri macOS build. `navigator.wakeLock` is already called in `requestWakeLock()` (`controls.js:1111`) but WKWebView silently ignores it.

**Detection:** `typeof window.__TAURI__ !== 'undefined'` — already used in `showPermissionError()` at `controls.js:749`.

**Approach — `caffeinate` sidecar (simplest path):**

*`src-tauri/src/main.rs`*
- Add a `#[tauri::command]` `caffeinate_start()` that spawns `caffeinate -d -w <PID>` as a child process and stores the `Child` handle in a `Mutex<Option<Child>>` in Tauri state.
- Add `caffeinate_stop()` command that kills the stored child.
- Register both commands with `.invoke_handler(tauri::generate_handler![...])`.

*`src-tauri/tauri.conf.json`*
- Add `"shell": { "execute": true, "sidecar": false }` to the allowlist so Tauri permits the `Command::new("caffeinate")` call.

*`src/controls.js`*
- In `requestWakeLock()`: if `window.__TAURI__` is present, call `window.__TAURI__.invoke('caffeinate_start')` instead of `navigator.wakeLock.request()`.
- In `handleVisibilityChange()`: same branch — re-invoke on tab visibility restore.
- On `engine.destroy()` / page unload: call `caffeinate_stop`.

**Files touched:** `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `src/controls.js`. No JS dependencies added.

---

### Item 3 — `captureStream()` Virtual Camera Toggle

**Goal:** Expose the visualizer canvas as a virtual camera source so OBS, Zoom, Teams, etc. can pick it up as a webcam input.

**How it works:** `HTMLCanvasElement.captureStream(fps)` returns a `MediaStream`. The user then selects "DiscoCast Virtual Camera" (or whatever the system names the tab/window) inside their capture software. No driver install needed — the browser/WKWebView exposes the stream automatically as a selectable source in other apps when the stream is active.

**What to add:**

*`src/visualizer.js`*
- Add `this.captureStream = null` to the constructor.
- Add `startVirtualCamera(fps = 60)` — calls `this.canvas.captureStream(fps)`, stores the result, returns it.
- Add `stopVirtualCamera()` — stops all tracks on the stored stream, nulls it.
- Add `isVirtualCameraActive()` getter.

*`src/controls.js`*
- Add `this.virtualCameraActive = false`.
- In the Output popover (same one from Item 1), add a **Virtual Camera** toggle row with a status note: "Stream is live — select this window/tab as a camera source in OBS or Zoom."
- On toggle ON: call `engine.startVirtualCamera(60)`, show toast "📷 Virtual Camera ON — pick this window in OBS/Zoom", update toggle state.
- On toggle OFF: call `engine.stopVirtualCamera()`, show toast "📷 Virtual Camera OFF".
- Tauri caveat: add a note in the UI tooltip that on the macOS app, routing to a system virtual camera requires an additional driver (e.g. OBS Virtual Camera); the stream is still available for OBS Browser Source.

**No new npm packages required.**

---

### Shared UI — Output Popover

Items 1 and 3 both live in the same new **Output popover**, keeping the control bar footprint small. Suggested control bar placement: between the Preset Studio button and the Help button.

Button: `btn-output` with a monitor/display icon SVG.

Popover sections:
```
[ Output Settings ]
  Resolution:   [ Match window ▾ ]
  Aspect Ratio: [ Free ▾ ]
  Fill Mode:    [ Letterbox ▾ ]

[ Virtual Camera ]
  [ toggle ] Stream canvas as camera
  Status: "OFF" / "LIVE — select in OBS"
```

Popover follows the same `.popover` CSS pattern already used by Cycle and Audio Tuning panels. No new CSS classes needed beyond a `popover--output` modifier for sizing.

---

### Build / Test Checklist

| Test | Web (Chrome) | macOS App |
|---|---|---|
| Canvas renders at locked 1920×1080 on a 1280×800 window | Letterboxed ✓ | Letterboxed ✓ |
| Canvas re-locks after window resize | ✓ | ✓ |
| Display does not sleep after 5 min with audio playing | Wake Lock ✓ | caffeinate ✓ |
| Virtual Camera toggle ON → OBS sees the stream | ✓ | Needs OBS Virtual Camera driver |
| Virtual Camera toggle OFF → stream stops | ✓ | ✓ |
| Output settings survive page reload | localStorage ✓ | localStorage ✓ |

---

## 1. Current Output State (Audit)

### What exists today
- **Single fullscreen `<canvas>`** — one WebGL render target, no multi-output concept.
- **Fullscreen API** — `F` key or button toggles native browser fullscreen on the primary display.
- **Zen Mode** (`H` key) — hides all UI chrome; intended as a projector-clean feed.
- **Screen Wake Lock** — keeps the projector/monitor awake automatically.
- **Auto-hiding cursor** — hides with UI after inactivity; clean for projection.
- **Tauri window config** — single window, fixed size (1200×800 min), no multi-window, no always-on-top, no display targeting.
- **Timeline Zone Compositor** — assigns presets to named screen regions (quadrant, banner, center square, custom rect), but these zones are *composited inside the single canvas*, not sent to separate physical outputs.

### What's missing / not yet addressed
- No way to target a specific monitor or projector (browser window goes to whatever display it's on).
- No secondary window or spanned output.
- No resolution / aspect ratio overrides (e.g. force 4K, 21:9, or portrait for a LED strip).
- No NDI / Syphon / Spout output (send frames to external video software).
- No HDMI capture card awareness.
- No record-to-file / render-to-video output.
- No multi-instance sync (two machines driven in lockstep).

---

## 2. Output Categories to Consider

### 2a. Monitor / Display Targeting
Getting the visualizer window onto the *right* physical display.

| Approach | Notes |
|---|---|
| **Browser: Window.open() on a second screen** | `window.open()` with `screen.availLeft`/`screen.availTop` offsets can place a pop-out canvas on a second monitor. Works in current web build. |
| **Browser: Multi-Screen Window Placement API** | W3C spec (`getScreenDetails()`), Chrome 100+. Returns full list of connected displays with their sizes and positions; lets you explicitly place a window on monitor N. Very clean for VJ use. Experimental but shippable. |
| **Tauri: `create_window()` with monitor targeting** | Tauri v1 can open additional `WebviewWindow` instances and position them at a specific `x,y` coordinate. Could open a second *output-only* window on the projector display. Needs Rust-side changes to `main.rs` and `tauri.conf.json`. |
| **OS-level span** | User extends desktop and moves the browser window manually. Zero code, works now, but not scripted. |

### 2b. Resolution / Aspect Ratio Control
Letting the user specify the canvas render dimensions independently of the window size.

| Setting | Use Case |
|---|---|
| Lock to 16:9 / 4:3 / 21:9 | Projector native ratios |
| Portrait mode (9:16) | LED columns, portrait monitors |
| Custom pixel override (e.g. 3840×2160) | 4K render even on 1080p display |
| Pixel density (DPR) override | Render at 1× on slow GPU, 2× on fast |
| Letterbox / pillarbox / stretch / crop | Fill modes for mismatched outputs |

### 2c. Frame Output to External Video Software
Sending the visualizer's pixel output out of the browser/app into a video pipeline.

| Approach | Notes |
|---|---|
| **NDI (Network Device Interface)** | Industry standard for sending video over LAN to VJ tools (Resolume, Arena, vMix, OBS). No browser-native NDI; requires an Electron/Tauri native layer or a helper process. |
| **Syphon (macOS)** | Zero-copy GPU texture sharing between macOS apps. Used heavily by VJs. Requires a native macOS layer — not possible in pure browser; could be added via a Tauri plugin. |
| **Spout (Windows)** | Windows equivalent of Syphon. Same constraints — needs a native layer. |
| **Virtual Camera** | Expose the canvas as a webcam via `canvas.captureStream()` → `MediaRecorder` or a virtual camera driver (OBS Virtual Camera, CamTwist). Works in browser today with `captureStream()`. |
| **OBS Browser Source** | Already works — point OBS at the app URL. Zen Mode + fullscreen = clean capture. |

### 2d. Record / Export Video
Capturing a render session as a file.

| Approach | Notes |
|---|---|
| **`canvas.captureStream()` + `MediaRecorder`** | Browser-native. Records canvas frames to a WebM/MP4 blob in-browser. Can trigger a download. No server needed. |
| **FFmpeg.wasm** | Run FFmpeg in WebAssembly to encode high-quality output (H.264, ProRes) directly in the browser. Heavy (~30MB wasm), but self-contained. |
| **Server-side headless render** | Puppeteer/Playwright drives the page in headless Chrome, captures frames, pipes to FFmpeg. Useful for pre-rendered show segments. |
| **Tauri: native ffmpeg child process** | Could shell out to a system FFmpeg binary from the macOS app for lossless recording. |

### 2e. Streaming Output
Broadcasting the visualizer live.

| Approach | Notes |
|---|---|
| **WebRTC peer-to-peer** | `canvas.captureStream()` → RTCPeerConnection. Low latency, no server required for 1:1. |
| **WHIP / RTMP via mediamtx** | `canvas.captureStream()` → WHIP push to a relay server (mediamtx, Restream). Feeds Twitch/YouTube. |
| **OBS → RTMP** | Use the OBS Browser Source path — let OBS handle streaming. Zero app code needed. |

---

## 3. Open-Source Packages to Investigate

### Multi-Screen / Display APIs
| Package | URL | Notes |
|---|---|---|
| **Window Management API (browser)** | MDN `getScreenDetails()` | No npm pkg; native browser API, Chrome 100+. Needs `window-management` permission policy. |
| **electron-display-manager** | npm | Electron equivalent; not applicable here but useful if we ever switch from Tauri to Electron. |
| **tauri-plugin-window** | github.com/tauri-apps/tauri-plugin-window | Tauri v2 plugin for multi-window creation. Could target specific monitor positions. |

### Virtual Camera / Frame Sharing
| Package | URL | Notes |
|---|---|---|
| **canvas-capture** | npmjs.com/package/canvas-capture | Wraps `captureStream` + `MediaRecorder` with quality controls. Lightweight. |
| **ccapture.js** | github.com/spite/ccapture.js | Frame-by-frame canvas capture; outputs GIF, WebM, PNG sequence. Good for short loops. |
| **whammy** | npm | Simple WebM encoder from canvas frames. Old but minimal. |
| **ffmpeg.wasm** | ffmpegwasm.netlify.app | Full FFmpeg in the browser. Encode to H.264 MP4 in-browser. Heavy but powerful. |
| **RecordRTC** | github.com/muaz-khan/RecordRTC | Feature-rich `MediaRecorder` wrapper. Supports video + audio mux from canvas + AudioContext. Relevant because we already have a Web Audio graph. |

### NDI / Syphon / Spout (native layer required)
| Package | URL | Notes |
|---|---|---|
| **grandiose** | github.com/Streampunk/grandiose | Node.js NDI bindings (libndi). Could be used in a helper Electron/Node process that consumes a `captureStream`. |
| **node-syphon** | github.com/ixd-akm/node-syphon | Experimental Syphon bindings for Electron. macOS only. |
| **obs-websocket-js** | github.com/obs-websocket-community-projects/obs-websocket-js | Control OBS from JS — could automate recording/streaming trigger from within the app. |

### WebRTC Streaming
| Package | URL | Notes |
|---|---|---|
| **simple-peer** | github.com/feross/simple-peer | Thin WebRTC wrapper; easy P2P canvas stream sharing. |
| **mediasoup-client** | mediasoup.org | SFU client for scalable broadcast (1-to-many). Overkill for single-venue VJ use. |

---

## 4. Possible Settings to Design (UI Brainstorm)

### Output Panel (new control bar section or dedicated settings page)

#### Display Targeting
- **Output Monitor** — dropdown of detected displays (via Multi-Screen Window Placement API); "Primary", "Secondary 1", "Secondary 2", etc.
- **Open Output Window** — pops a borderless/fullscreen window on the chosen monitor; this is the projector feed.
- **Mirror / Extend** — whether the output window clones the main UI or shows only the canvas.

#### Resolution & Aspect Ratio
- **Render Resolution** — dropdown: "Match window", 1280×720, 1920×1080, 2560×1440, 3840×2160, Custom.
- **Aspect Ratio Lock** — 16:9, 4:3, 21:9, 1:1 (square), 9:16 (portrait), Free.
- **Fill Mode** — Letterbox, Pillarbox, Stretch, Crop to Fill.
- **Pixel Density** — Auto (match DPR), 1×, 2×.

#### Frame Output
- **Virtual Camera** — toggle: stream canvas to system as webcam via `captureStream()`. Shows device name for use in Zoom/Teams/OBS.
- **Record Session** — start/stop recording with codec choice (WebM VP9, or H.264 via ffmpeg.wasm). Shows file size estimate.
- **OBS Integration** — copy sharable URL for OBS Browser Source; optionally trigger OBS recording via obs-websocket.

#### Streaming
- **WHIP Push URL** — text field for a mediamtx/Restream/custom WHIP endpoint.
- **Audio in Stream** — toggle: include the current audio source in the stream.
- **Stream Bitrate** — slider or dropdown (1 Mbps – 20 Mbps).

#### Advanced / Niche
- **Headless Export** — "Render clip" dialog: pick preset, duration, output resolution; uses an offscreen canvas + MediaRecorder to produce a downloaded video file.
- **Syphon / Spout** — only shown in Tauri macOS build; toggle to enable GPU texture sharing with VJ software.
- **NDI Output** — only shown in Tauri build with grandiose loaded.
- **Sync Token** — passcode/URL for multi-machine sync (preset changes broadcast to all connected instances via BroadcastChannel or a tiny WebSocket relay).

---

## 5. Priority / Feasibility Tiers

| Feature | Effort | Value for VJ/DJ | Works in Web Build | Works in Tauri |
|---|---|---|---|---|
| Multi-Screen Window Placement API (output window) | Low–Med | ⭐⭐⭐⭐⭐ | Yes (Chrome) | Yes |
| Resolution / aspect ratio override | Low | ⭐⭐⭐⭐ | Yes | Yes |
| `captureStream()` virtual camera | Low | ⭐⭐⭐⭐ | Yes | Yes |
| `MediaRecorder` session recording | Low–Med | ⭐⭐⭐ | Yes | Yes |
| OBS obs-websocket integration | Med | ⭐⭐⭐ | Yes | Yes |
| WHIP streaming | Med | ⭐⭐⭐ | Yes | Yes |
| ffmpeg.wasm high-quality export | Med | ⭐⭐ | Yes (slow) | Yes |
| Tauri multi-window output | Med–High | ⭐⭐⭐⭐⭐ | No | Yes only |
| Syphon / Spout | High | ⭐⭐⭐⭐ | No | macOS only |
| NDI output | High | ⭐⭐⭐ | No | Yes (with plugin) |
| Headless server-side render | High | ⭐⭐ | No | No |

---

## 6. Quick Wins to Prototype First

1. **Output window button** — `window.open()` with `screen.availLeft` offset targets the second display. Zero dependencies, works in current web build today.
2. **Multi-Screen Window Placement API** — replaces the hack above with a proper display selector. Chrome 100+ only, but that's most VJ laptops.
3. **Resolution lock dropdown** — override `engine.setSize()` to render at a fixed resolution regardless of window size; letterbox with CSS `object-fit: contain` on a wrapper.
4. **`captureStream()` + toggle** — one button that calls `canvas.captureStream(60)` and logs the stream as a virtual camera source (users then pick it in OBS).
5. **`MediaRecorder` record button** — record + download session as WebM. Could be done in ~50 lines.

---

## 7. Build Distribution Workflow

### Overview
After every build, the DMG is copied into `promo/` with a versioned filename. This folder is tracked by git, pushed to the repo, and Coolify serves it live — so users always download the latest build from the promo page, and older builds are retained for rollback.

### Steps

1. **Run the build script** — do not run `npm run tauri-build` directly:
   ```bash
   ./build-and-sign.sh
   ```
   The script handles everything automatically:
   - Builds Vite + Tauri (target: `app` only, not `dmg`)
   - Injects `NSMicrophoneUsageDescription` into `Info.plist`
   - Signs with Developer ID + hardened runtime
   - Notarizes + staples (app, then DMG)
   - Creates HFS+ drag-to-install DMG with Applications folder shortcut
   - Signs and clears quarantine from DMG
   - Copies versioned DMG to `promo/DiscoCast Visualizer-1.0.YYYYMMDD.HHMM.dmg`
   - Updates `promo/DiscoCast-Visualizer.dmg` (the canonical promo page link)

2. **Commit and push:**
   ```bash
   git add promo/
   git commit -m "build: release 1.0.YYYYMMDD.HHMM"
   git push
   ```
   Coolify picks up the push and redeploys automatically. Users downloading from the promo page immediately get the new build.

### Rollback
To roll back: copy an older versioned DMG over `DiscoCast-Visualizer.dmg`, commit, and push. The older builds are preserved in `promo/` for exactly this purpose.

### Current builds in `promo/`
| File | Notes |
|---|---|
| `DiscoCast-Visualizer.dmg` | Always the latest — what the promo page links to |
| `DiscoCast Visualizer-1.0.YYYYMMDD.HHMM.dmg` | Versioned archive — retained for rollback |

---

## 8. macOS App Build — Context & Constraints

### What it is
The macOS app is a **Tauri v1.5** wrapper — a Rust shell (`src-tauri/src/main.rs`) that opens a `WebviewWindow` pointing at the same Vite-built front-end. The app bundles as a signed/notarized `.app` / `.dmg` via `build-and-sign.sh`.

### Key differences from the web build

| Dimension | Web (browser) | macOS App (Tauri) |
|---|---|---|
| **Runtime** | Chrome / Firefox | WebKit (WKWebView) on macOS |
| **WebGL** | WebGL 2 via browser | WebGL 2 via WKWebView (same GLSL) |
| **Audio** | Web Audio API | Web Audio API (same JS) |
| **Mic permission** | Browser prompt | macOS System Settings → Microphone; entitlement `com.apple.security.device.audio-input` already set in `entitlements.plist` |
| **Fullscreen** | Browser fullscreen API (`requestFullscreen()`) | Tauri window `set_fullscreen()` *or* native macOS green button; both work |
| **Multiple windows** | `window.open()` / Window Placement API | Tauri `WebviewWindow::builder()` in Rust — can target specific monitor with `position(x, y)` |
| **File system access** | `<input type="file">` only | Tauri `dialog::open` + `fs` allowlist — could open files without a picker, save recordings natively |
| **Screen Wake Lock** | `navigator.wakeLock` (browser API) | WKWebView does **not** support Wake Lock API — needs a Tauri Rust command (`IOPMAssertionCreateWithName`) |
| **Window chrome** | Browser chrome present unless kiosk | Can set `decorations: false` in `tauri.conf.json` for a fully borderless output window |
| **Syphon / NDI** | Not possible | Possible via Tauri plugin / Rust FFI |
| **App signing** | N/A | Apple Developer ID (`3UT7698LZ6`), notarized |
| **Password gate** | `VITE_APP_PASSWORD` build env var | Same — value baked in at `npm run build` |

### Current Tauri window config (from `tauri.conf.json`)
```json
{
  "title": "DiscoCast Visualizer",
  "width": 1200,
  "height": 800,
  "minWidth": 800,
  "minHeight": 600,
  "center": true
}
```
No `decorations`, no `always_on_top`, no `fullscreen`, no second window. Single window, centered.

### Wake Lock gap in macOS app
`navigator.wakeLock` is a browser API; WKWebView silently ignores it. The macOS display *will* sleep mid-set. Fix options:
- **Tauri Rust command** — call `IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleDisplaySleep)` from Rust, expose as a `#[tauri::command]`, call it from JS on audio start.
- **`caffeinate` child process** — shell out to macOS `caffeinate -d` as a Tauri sidecar; simplest path.

### Tauri v1 vs v2 note
The project uses Tauri **v1.5**. Many newer multi-window and plugin APIs (e.g. `tauri-plugin-window`) are v2-only. Upgrading to v2 would unlock cleaner multi-window APIs but requires migrating `tauri.conf.json`, the allowlist model, and `main.rs`.

---

## 8. Cross-Build Compatibility — What Works Where

> For each proposed output feature, which target does it work on out of the box?

| Feature | Web (Chrome) | Web (Firefox) | macOS App (WKWebView) | Notes |
|---|---|---|---|---|
| **Fullscreen toggle (`F` key)** | ✅ | ✅ | ✅ | Already works in all three |
| **Zen Mode / hide UI (`H` key)** | ✅ | ✅ | ✅ | Already works |
| **Screen Wake Lock** | ✅ | ✅ | ❌ | WKWebView drops it silently; needs Tauri Rust command |
| **Output window via `window.open()`** | ✅ | ✅ | ⚠️ | WKWebView may open a new Tauri window; behavior untested |
| **Multi-Screen Window Placement API** | ✅ Chrome 100+ | ❌ | ❌ | WKWebView / Safari does not support `getScreenDetails()` |
| **Resolution lock / `setSize()` override** | ✅ | ✅ | ✅ | Pure JS/canvas — works everywhere |
| **Aspect ratio letterbox (CSS)** | ✅ | ✅ | ✅ | Pure CSS — works everywhere |
| **`canvas.captureStream()` virtual camera** | ✅ | ✅ | ⚠️ | WKWebView supports `captureStream()`; virtual camera routing to system depends on driver |
| **`MediaRecorder` session recording (WebM)** | ✅ | ✅ | ⚠️ | WKWebView supports `MediaRecorder` but only MP4/H.264, not VP8/VP9 WebM |
| **ffmpeg.wasm in-browser encode** | ✅ | ✅ | ⚠️ | Needs SharedArrayBuffer + COOP/COEP headers; Tauri may need extra CSP config |
| **OBS Browser Source** | ✅ | ✅ | N/A | OBS uses its own Chromium; point it at the Coolify URL |
| **obs-websocket-js remote trigger** | ✅ | ✅ | ✅ | Pure WebSocket JS — works everywhere |
| **WHIP streaming push** | ✅ | ✅ | ✅ | Pure fetch/WebRTC — works everywhere |
| **Tauri multi-window output** | ❌ | ❌ | ✅ | macOS app only; requires Rust-side `WebviewWindow::builder()` |
| **Tauri Wake Lock (`caffeinate`)** | ❌ | ❌ | ✅ | macOS app only; replaces `navigator.wakeLock` |
| **Syphon texture sharing** | ❌ | ❌ | ✅ | macOS app only; requires Rust FFI |
| **NDI output** | ❌ | ❌ | ✅ | macOS app only; requires Tauri plugin + libndi |
| **Native file save dialog** | ❌ | ❌ | ✅ | Tauri `dialog::save` — cleaner than anchor download |
| **Decorations-off borderless window** | ❌ | ❌ | ✅ | `tauri.conf.json` `decorations: false` — clean projector window |

### Summary: shared-code sweet spot
Features that work identically in **all three targets** (web Chrome, web Firefox, macOS app) and are worth prioritizing as they need no branching:

- Resolution / aspect ratio lock
- `obs-websocket-js` remote OBS trigger
- WHIP streaming push
- Letterbox / fill mode CSS wrapper
- `captureStream()` virtual camera toggle (with codec caveat on Tauri)

Features that need **build-target detection** (`window.__TAURI__` is defined in the Tauri build):

- Wake Lock → fall back to Tauri `caffeinate` command when `window.__TAURI__` is present
- Output window → use `window.open()` on web, `WebviewWindow` on Tauri
- Recording codec → offer WebM on web, MP4 on Tauri
- File save → anchor download on web, `dialog::save` on Tauri

---

*Last updated: brainstorm phase — no implementation started.*
