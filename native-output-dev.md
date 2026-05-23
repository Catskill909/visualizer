# Native Output Pipe — NDI / Syphon / Spout (Design & Dev Doc)

> ⚠️ **This is a REFERENCE doc — it does NOT track status.** For *where we are* and *what's next*, read the **§0 status block in [`output-dev.md`](output-dev.md)** (the single source of truth). Open this doc only when actually coding the native pipe (NDI / Syphon / Spout) and you need the deep detail: the binding recipe, the frame compositor, transport options + throughput math, the video-taint + A/V-sync resolutions.

**What's built so far** (status authority is output-dev.md §0): Step 0 web compositor ✅, N0 NDI proof ✅ (composed program live in OBS + NDI Monitor via the Rust-relay `ndi-send` sidecar).
**Created:** 2026-05-23 · **Hub:** [`output-dev.md`](output-dev.md) — the output truth doc (Source/Output/Route model, pixel-mirror architecture).
**Goal (north star):** one timeline/layer brain → a *menu* of outputs the performer picks per show — projector, monitor, **NDI** (→ OBS / streaming / other machines / hardware). One shared architecture, one swappable "last-inch pixel pipe."

---

## 0. TL;DR for whoever picks this up

- **The web output path is dead on desktop.** It uses `window.open` + `canvas.captureStream()` → a popup `<video>` ([outputManager.js](src/output/outputManager.js), [outputPipe.js](src/output/outputPipe.js)). A second Tauri WebviewWindow can't take a `MediaStream`, and `captureStream` only feeds in-browser consumers. So multi-output currently produces **nothing** in the Mac/Win app — native is the whole feature there, **beta-critical**, not polish.
- **NDI leads** (decision in output-dev.md §intro #4): cross-platform (one build → Mac + Windows), native-only (browsers can't emit NDI), widest reach (OBS / streaming / Resolume / other machines / hardware in one shot). Syphon (Mac) / Spout (Win) follow for directly-attached displays.
- **Three real sub-problems:** (A) a frame **compositor** (N layers → 1 frame — web today composites in the popup via CSS, which NDI can't use), (B) frame **transport** JS→native (the throughput unknown), (C) the native **NDI sender** (SDK/licensing/bundling). See §3.
- **Video is NOT a blocker** (§5) — the WKWebView taint issue is already solved by the H.264 import pipeline; NDI readback inherits an already-clean canvas.
- **A/V sync** (§6.1) — the NDI feed has a small *constant* transport delay (not a reactivity bug; operator screen is real-time). For OBS, align with an audio Sync Offset (set once) + NDI Latency:Low; the clean fix is sending audio over NDI (planned, N1/N2). Live rooms use the low-latency local-display path, not NDI.
- **Built:** Step 0 web compositor ✅ (`src/output/composer.js` + "Composed program") and N0 NDI proof ✅ (composed program live in OBS + NDI Monitor). **For the running order / what's next, see [`output-dev.md`](output-dev.md) §0** (next = Phase B). The §7 write-ups below are per-phase detail.

---

## 1. What's reused vs. what's new (the seam)

Everything **above** the pixel pipe is platform-agnostic and reused untouched:
- Timeline routing, the Outputs modal, per-zone blend/opacity, the layer-stack model, `zone.output` data.
- The Tauri bridge is mature: `window.__TAURI__.invoke('cmd', args)` + `window.emit`/event listeners, and a **proven per-arch sidecar pattern** ([src-tauri/src/main.rs:171-245](src-tauri/src/main.rs#L171) bundles `ffmpeg-{aarch64,x86_64}-apple-darwin` and streams progress events back to JS). The NDI sender follows this template.

What's **new / platform-specific** (all below the seam):
- A **frame compositor** (does not exist — see §3A).
- A **frame transport** JS canvas → native (§3B / §4).
- The **native sender** (NDI crate or sidecar; later Syphon/Spout) (§3C).
- An **Output `target` discriminator** (`display | ndi`) — an NDI output has no `displayId`/window (output-dev.md §8).

> **Architecture rule (unchanged):** the only platform branch lives below `outputPipe.js`. If platform logic creeps into routing/stacking/UI, stop — it belongs in the pipe.

---

## 2. Why two output "styles" exist

The web build got compositing **for free** from the browser: the output popup holds N `<video>` layers and the CSS compositor stacks them (zIndex/opacity/blend). Native outputs that emit a **single stream** (NDI, virtual cam, single-texture Syphon/Spout) can't do that — they need **one finished frame**. So:

| Style | Where it composites | Outputs |
|---|---|---|
| **Multi-layer display** | in the output window (CSS), as built | local window / projector / monitor |
| **Single composed stream** | an offscreen canvas/WebGL compositor (NEW, §3A) | NDI, virtual camera, single-texture Syphon/Spout |

The compositor (§3A) is the bridge: build it once, every single-stream output reuses it.

---

## 3. The three sub-problems

| # | Problem | The hard part | Reused by |
|---|---|---|---|
| **A** | **Compositor** — stack N routed source canvases → 1 frame, applying zIndex/opacity/blend | Multiple WebGL canvases each clear their buffer per tick; reading must be timed right ([visualizer.js:643-651](src/visualizer.js#L643) does the same-tick `drawImage` trick for one canvas). Likely composite from each zone's `captureStream` `<video>` (holds the frame) or set `preserveDrawingBuffer` (perf cost) — spike decides. | virtual cam, Syphon, Spout |
| **B** | **Frame transport** JS canvas → native sender | **The make-or-break unknown.** Raw 1080p60 ≈ 500 MB/s — base64 over Tauri v1 JSON IPC is infeasible at that rate. See §4 for options + math. | all native outputs |
| **C** | **Native NDI sender** | NDI SDK/runtime bundling + licensing; per-arch binary like the ffmpeg sidecar; NDI takes raw BGRA/UYVY and does its own SpeedHQ encode. | — |

---

## 4. Transport options (the central spike decision)

| Opt | Mechanism | Throughput @ target | Verdict |
|---|---|---|---|
| **B1** | JS `toBlob('image/jpeg')` → `invoke(bytes)` → native JPEG-decode → NDI | ~100-300 KB/frame → ~6-9 MB/s @ 30fps | **Feasible — lead candidate for v1.** Cost: slight quality hit + a decode hop. |
| **B2** | JS raw RGBA → `invoke(base64)` → NDI | ~3.7 MB/frame @ 720p; base64 inflates 33% | Only viable at **low res/fps**; simplest. |
| **B3** | Native OS window/region capture (ScreenCaptureKit / Windows Graphics Capture) → NDI | GPU-side, no JS→native transfer | **Best performance, biggest build, codec-agnostic.** The endgame / fallback if B1 can't hit quality. |

**Recommendation:** prove the path with **B1 at 720p30** in the spike, measure latency/fps/CPU at 1080p, and only escalate to **B3** if quality demands it. Tauri v1.5 has no raw binary IPC channel (that's a v2 feature — and we are **not** bundling a v2 migration into this work), which is exactly why per-frame JPEG (small payloads) is the pragmatic v1 transport.

---

## 5. Video & the WKWebView taint question — RESOLVED (not a blocker)

Video is a **core feature**, and it is **safe with NDI**. Evidence, from this codebase:

- The macOS WKWebView security quirk fires on `gl.texSubImage2D` — **the same call that displays a video layer**. If a video renders in the production Mac app, the upload didn't throw → **the canvas is not tainted** → readback for NDI won't throw either. Same gate, already passed.
- The app transcodes **all** WebM/VP9 video to **H.264** on import on macOS ([customPresets.js:287-319](src/customPresets.js#L287)); WKWebView treats H.264 as same-origin. **Web + Windows are Chromium — no taint at all** ([customPresets.js:290](src/customPresets.js#L290)).
- A multi-layer composite stays clean too: `drawImage` of an untainted canvas does not taint the result.

**Net:** "if it shows on the Mac screen, it shows over NDI." The only to-verify is a quick production-build check of the composite readback with an H.264 video layer active. And **B3 (native capture) is codec-agnostic**, so even an edge case can't make video a blocker. *(This corrects an earlier alarmist note — the taint "fight" was already won when the H.264 pipeline was built.)*

---

## 6. NDI specifics

- **SDK / runtime:** NDI SDK is free to use; redistribution requires accepting the NDI SDK license (don't rename, show attribution, bundle the redistributable runtime). Settle bundling in N0.
- **Sender impl:** a Rust crate (e.g. an `ndi` binding) inside the Tauri process, **or** a small dedicated sidecar (mirrors the ffmpeg sidecar pattern). Spike compares.
- **Alpha bonus:** NDI carries **RGBA** — so transparent-bg presets ([transparent-dev.md](transparent-dev.md), in-tandem work) → NDI → OBS **with real alpha**, which the web `captureStream`→`<video>` path can't do. Strong synergy.
- **Streams:** each routed display-group (or a composed view) can be its own named NDI source.
- **Test receivers:** OBS + the **DistroAV** plugin (renamed obs-ndi); NDI Tools **Studio Monitor** as an independent cross-check.

### 6.1 A/V sync — audio-reactive visuals + a delayed video feed

**The concern (real, raised 2026-05-23):** our visuals are audio-reactive. The NDI feed has a small **transport delay** (NDI buffering + our JPEG encode→relay→decode hops). If that delayed video is shown next to near-real-time audio that took a *different* path, they drift.

**Crucial framing — this is a transport delay, NOT a reactivity bug.** The visualizer renders perfectly in sync with the audio *inside the app*; the operator screen is real-time. Only the *outgoing* NDI copy is delayed. Nothing about beat-tracking is wrong.

**Where it matters / doesn't:**
- **Operator screen:** real-time. No issue.
- **Live room / projector (the priority for event sync):** the room hears the PA in real time. Use the **directly-attached display path (Phase B Syphon / local window)** — GPU-direct, much lower latency than NDI; or run the app fullscreen *on* the projector display (engine renders directly, ~zero added latency). NDI is **not** the in-room path, so this case is sidestepped by design.
- **OBS streaming/recording:** video (delayed) + audio (OBS's own capture) arrive on different paths → can drift. **This is the one place to align them**, and a small constant delay is acceptable for streaming.

> **Priority call (user, 2026-05-23):** event sync (monitors/projectors) is what matters most, and it rides the low-latency local-display path — not NDI. NDI's latency is fine for its streaming role. *Live-performance-over-NDI* sync is deferred until it actually comes up (the audio-over-NDI fix below covers it when it does).

**Fixes (standard, easy — and they rely on the latency being CONSTANT, which observed it is):**
1. **OBS audio Sync Offset** — right-click the audio source → *Advanced Audio Properties* → *Sync Offset*; delay audio to match the video. Set once, holds (constant latency).
2. **OBS NDI Source → Latency: Low, Bandwidth: Highest** — shrinks the gap so the needed offset is small.
3. **(Planned — the clean fix) send audio over NDI** — NDI carries audio alongside video, so a receiver gets an A/V-locked pair and needs **zero** offset. Logged in §7 (N1/N2). *(If latency ever GROWS instead of staying constant, no fixed offset works — that signals a buffering bug to fix, not an offset to tune.)*

---

## 7. Phased plan (spike-gated, lowest-risk first)

> **Order/status: see [`output-dev.md`](output-dev.md) §0 (single source of truth).** The per-phase write-ups below are the *technical detail* — what each phase entails — not the running order. (As of 2026-05-23: Step 0 + N0 ✅; Phase B next.)

### Step 0 — Compositor on web (no native, zero risk) ✅ BUILT & BROWSER-VERIFIED 2026-05-23
- [x] **`src/output/composer.js`** — `Composer` class: an offscreen 2D canvas + a rAF loop that draws each source layer full-frame, ordered by `zIndex`, with per-layer `globalAlpha` + `globalCompositeOperation` (canvas2D blend names == CSS `mix-blend-mode`; `normal`→`source-over`). Composites from each source's `captureStream`→hidden `<video>` (NOT raw `drawImage` of the WebGL canvas) → sidesteps the buffer-clear timing trap, stays untainted. `getOpacity` is read **every frame** → cover-aware live fades.
- [x] **Timeline wiring** ([timelineEditor.js](src/timeline/timelineEditor.js)): `_composerLayers()` builds the full stack from **all** zones (cover-aware `getOpacity` = `zone.opacity × (1 − animated cover opacity)`); `_toggleProgramOutput()` opens a single output window fed by `composer.canvas` (reuses `openOutput` with one full-frame layer — no new window code); `_syncComposer()` keeps it in step on zone/blend changes; auto-stops when the program window closes.
- [x] **UI:** a **"▦ Composed program"** toggle in the `⊟ Outputs` modal (its own section).
- [x] `npm run build` clean; dev-server modules transform OK.
- **NOTE — the "virtual camera" is a dead sink on web** ([visualizer.js:567](src/visualizer.js#L567) just does `captureStream` with no system consumer; a real system cam needs the OBS driver). So Step 0 surfaces the compositor via a **composed-program output window**, not the vestigial virtual camera.
- **Exit:** ✅ a single composited stream of the whole layer stack, verified live in the browser (the composed-program window plays the stacked timeline) — the exact input every native sender will consume.

### Phase N — NDI (cross-platform, first native milestone)
- [x] **N0a — Sender hop PROVEN 2026-05-23.** Standalone Rust spike (`ndi-spike/`, throwaway, not in the app) broadcasts an animated BGRA test frame; received live in NDI Video Monitor as `PAULS-MAC-MINI.LOCAL (DiscoCast Spike) (720/30p)`, steady 30fps. **Binding recipe (no SDK install needed):** hand-rolled FFI to the 6 `NDIlib_*` symbols in `/usr/local/lib/libndi.dylib` (installed by NDI Tools); `build.rs` = `rustc-link-lib=dylib=ndi` + `rustc-link-search=/usr/local/lib` **and an rpath** (`-Wl,-rpath,/usr/local/lib`) because the dylib's install name is `@rpath/libndi.dylib`. `#[repr(C)]` structs for `NDIlib_send_create_t` + `NDIlib_video_frame_v2_t` match the SDK header; FourCC BGRA = `0x41524742`, format progressive = 1, `clock_video=true` paces 30fps. (`get_no_connections(0)` reads 0 even while Monitor views — a preview-bandwidth quirk, ignore.)
- [~] **N0b — Real-frame transport + measurement (in progress).**
  - [x] **Sidecar built + decode path verified solo 2026-05-23.** `ndi-spike` grew 3 modes: `selftest` (raw BGRA→NDI), `pipe-selftest` (BGRA→JPEG-encode→JPEG-decode→NDI), `stream` (length-prefixed JPEG frames on **stdin** → decode → NDI = the production sidecar). JPEG via the `image` crate (jpeg-only). `pipe-selftest` @720p holds **steady 30fps**, full **JPEG roundtrip (encode+decode) ~12.8 ms/frame** → decode-only (the sidecar's share) ~half that; comfortably under the 33 ms/frame budget. **B1 (JPEG) transport confirmed viable.**
  - [x] **App wiring BUILT (compile-verified) 2026-05-23; runtime test pending in `tauri-dev`.** Rust-relay sidecar (Tauri resolved to 1.8.3; `CommandChild::write` confirmed). `ndi-send` registered like ffmpeg (`tauri.macos.conf.json` scope + `externalBin`); binary at `src-tauri/binaries/ndi-send-aarch64-apple-darwin`. Rust `ndi_start` (spawn `new_sidecar("ndi-send")` args `["stream","DiscoCast Program"]`, drain output → `ndi-log` event), `ndi_send_frame(frame_b64)` (decode → u32-len-prefix → `CommandChild::write` to stdin), `ndi_stop` (`kill`). JS: shared `Composer` (program window + NDI), `_toggleNdi` + `_startNdiPump` (`composer.canvas`→`toBlob('image/jpeg',0.8)`→base64→`invoke('ndi_send_frame')` ~30fps), "📡 Send program to NDI" button in the Outputs modal, **shown only under `window.__TAURI__`**. `cargo check` + `vite build` both clean. **⚠ Do NOT ship a release with NDI yet** — the bundled sidecar links `libndi` via an absolute dev rpath (`/usr/local/lib`); works on dev machines with NDI Tools, broken on clean machines until N2 bundles the runtime.
  - [x] **End-to-end VERIFIED 2026-05-23 (tauri-dev).** The composed program reaches **both NDI Video Monitor and OBS** (via DistroAV) live. Latency: a small, steady delay; **OBS > Monitor** as expected (OBS buffers each NDI source + its own render pipeline). Tuning: OBS NDI Source → **Latency: Low**, **Bandwidth: Highest** tightens the OBS gap. → **N0 (NDI spike) COMPLETE: sender + JPEG transport + real app frames all proven.**
  - [ ] (later) push toward 1080p measurement; confirm video-composite readback in a production build.
  - [ ] **Distribution:** bundle the NDI runtime + fix the sidecar's rpath (spike used `/usr/local/lib`); settle NDI licensing. (Deferred to N2.)
- [ ] **N1 — model `target` + UX:** add `output.target` (`display | ndi`); NDI route carries a stream name (no displayId/window); Outputs modal gains an "NDI output" target. Routing/stacking UI reused. Custom NDI source name; persist the NDI on/off + name with the set.
- [ ] **N2 — production:** stable sender behind the pipe contract; per-output NDI streams; alpha; clean start/stop; perf pass; **bundle libndi + fix rpath + NDI licensing** (the only thing blocking a shippable NDI release); x86_64 sidecar slice for Intel/universal builds.
- [ ] **Audio over NDI (A/V-lock enhancement — §6.1):** send the app's audio alongside the video so receivers get an A/V-locked pair (zero OBS offset needed). NDI carries audio (`NDIlib_send_send_audio_v2`, interleaved/planar float). Tap the engine's audio (Web Audio → the sidecar) and interleave with the video send. Scoped N1/N2; until then, OBS audio Sync Offset is the workaround.
- **Exit:** the desktop app publishes its visuals as NDI; OBS (and any NDI receiver) shows them in sync.

### Phase B — MAC local pipe (Syphon) + native window placement
For a projector/monitor plugged directly into the Mac (NDI needs a receiver; a directly-attached display wants pixels on a real fullscreen window).
- [ ] **B0 — Spike:** Syphon (GPU texture share) vs the readback path proven in N0; pick one.
- [ ] **B1:** chosen pipe behind the same `outputManager`/`outputPipe` interface.
- [ ] **B2:** native window placement + fullscreen-on-monitor (`set_position`→`set_fullscreen`; needs the `window.create`/multi-window allowlist, not yet enabled in [tauri.conf.json](src-tauri/tauri.conf.json)), wake-lock (`caffeinate` already wired in main.rs), teardown.
- **Exit:** the Mac app drives a directly-attached second monitor in sync.

### Phase C — WINDOWS local pipe (Spout) + window placement
- [ ] **C1:** Spout (or the readback path proven earlier) behind the same interface.
- [ ] **C2:** Windows window-placement quirks (Tauri #7139 cross-monitor `set_position`).
- **Exit:** Windows reaches parity with Mac.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Transport throughput** (B) is the real unknown | ✅ N0 measured B1 (JPEG): ~12.8ms roundtrip @720p, holds 30fps. B3 (native capture) is the codec-agnostic fallback. |
| **A/V sync** — audio-reactive visuals + delayed NDI video drift vs. real-time audio (§6.1) | Transport delay, not a reactivity bug; constant offset → OBS audio Sync Offset (set once) + NDI Latency:Low; clean fix = send audio over NDI (N1/N2). Live rooms use the low-latency local-display path, not NDI. |
| Tauri v1.5 has no raw binary IPC | Per-frame JPEG keeps payloads small; do **not** bundle a v2 migration into this work. |
| NDI SDK licensing / runtime bundling | Settle in N0 before any production wiring; mirror the ffmpeg sidecar bundling. |
| ~~Video layers taint the canvas → readback fails~~ | **Resolved (§5)** — H.264 pipeline keeps the canvas clean; B3 is codec-agnostic regardless. |
| Compositor timing with multiple WebGL canvases | Composite from per-zone `captureStream` `<video>`s, or `preserveDrawingBuffer`; spike picks. |
| Multi-window placement (Phase B/C) | Tauri #6394/#7139 documented workarounds; enable the window allowlist; scope v2 separately. |

---

## 9. References
- **Hub:** [`output-dev.md`](output-dev.md) (Source/Output/Route model, web phases, §13 re-render post-mortem). Related: [`visualizer-output-dev.md`](visualizer-output-dev.md) (Syphon/Spout/NDI reference tables), [`app-output-dev.md`](app-output-dev.md), [`transparent-dev.md`](transparent-dev.md) (alpha synergy), [`windows-dev.md`](windows-dev.md).
- **NDI:** [NDI SDK](https://ndi.video/for-developers/ndi-sdk/) · [DistroAV (OBS-NDI)](https://distroav.org/) · NDI Tools (Studio Monitor).
- **Native share:** [Syphon](https://syphon.github.io/) · [Spout](https://spout.zeal.co/).
- **Capture APIs:** ScreenCaptureKit (macOS) · Windows.Graphics.Capture (Windows).
- **Tauri:** sidecar pattern in [src-tauri/src/main.rs](src-tauri/src/main.rs); #6394 fullscreen-on-monitor; #7139 cross-monitor `set_position`.
