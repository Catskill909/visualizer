# Native Output Pipe — NDI / Syphon / Spout (Design & Dev Doc)

**Status:** Planning (no native output code yet). Deep audit + plan done 2026-05-23, *before* implementation. The web output feature (mirror + per-zone routing + A3 stacking) is shipped; this doc covers getting that same composited output OUT of the **desktop app** (macOS + Windows) onto NDI, projectors, and monitors.
**Created:** 2026-05-23
**Hub:** this is the native half of [`output-dev.md`](output-dev.md) (the output truth doc — read it first for the Source/Output/Route model, the pixel-mirror architecture, and the web phases A1–A4). This doc is referenced from `output-dev.md` §5/§9/§11 and the README doc index.
**Goal (north star):** one timeline/layer brain → a *menu* of outputs the performer picks per show — projector, monitor, **NDI** (→ OBS / streaming / other machines / hardware). One shared architecture, one swappable "last-inch pixel pipe."

---

## 0. TL;DR for whoever picks this up

- **The web output path is dead on desktop.** It uses `window.open` + `canvas.captureStream()` → a popup `<video>` ([outputManager.js](src/output/outputManager.js), [outputPipe.js](src/output/outputPipe.js)). A second Tauri WebviewWindow can't take a `MediaStream`, and `captureStream` only feeds in-browser consumers. So multi-output currently produces **nothing** in the Mac/Win app — native is the whole feature there, **beta-critical**, not polish.
- **NDI leads** (decision in output-dev.md §intro #4): cross-platform (one build → Mac + Windows), native-only (browsers can't emit NDI), widest reach (OBS / streaming / Resolume / other machines / hardware in one shot). Syphon (Mac) / Spout (Win) follow for directly-attached displays.
- **Three real sub-problems:** (A) a frame **compositor** (N layers → 1 frame — web today composites in the popup via CSS, which NDI can't use), (B) frame **transport** JS→native (the throughput unknown), (C) the native **NDI sender** (SDK/licensing/bundling). See §3.
- **Video is NOT a blocker** (§5) — the WKWebView taint issue is already solved by the H.264 import pipeline; NDI readback inherits an already-clean canvas.
- **Build order:** **Step 0 web compositor ✅ built & verified 2026-05-23** (`src/output/composer.js` + a "Composed program" output in the timeline; zero native risk, reused everywhere) → **N0 NDI spike ⬅ next** (measure transport; needs NDI SDK + OBS/DistroAV) → N1 model/UI → N2 production. Then Phase B/C local pipes. See §7.

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

---

## 7. Phased plan (spike-gated, lowest-risk first)

### Step 0 — Compositor on web (no native, zero risk) ✅ BUILT & BROWSER-VERIFIED 2026-05-23
- [x] **`src/output/composer.js`** — `Composer` class: an offscreen 2D canvas + a rAF loop that draws each source layer full-frame, ordered by `zIndex`, with per-layer `globalAlpha` + `globalCompositeOperation` (canvas2D blend names == CSS `mix-blend-mode`; `normal`→`source-over`). Composites from each source's `captureStream`→hidden `<video>` (NOT raw `drawImage` of the WebGL canvas) → sidesteps the buffer-clear timing trap, stays untainted. `getOpacity` is read **every frame** → cover-aware live fades.
- [x] **Timeline wiring** ([timelineEditor.js](src/timeline/timelineEditor.js)): `_composerLayers()` builds the full stack from **all** zones (cover-aware `getOpacity` = `zone.opacity × (1 − animated cover opacity)`); `_toggleProgramOutput()` opens a single output window fed by `composer.canvas` (reuses `openOutput` with one full-frame layer — no new window code); `_syncComposer()` keeps it in step on zone/blend changes; auto-stops when the program window closes.
- [x] **UI:** a **"▦ Composed program"** toggle in the `⊟ Outputs` modal (its own section).
- [x] `npm run build` clean; dev-server modules transform OK.
- **NOTE — the "virtual camera" is a dead sink on web** ([visualizer.js:567](src/visualizer.js#L567) just does `captureStream` with no system consumer; a real system cam needs the OBS driver). So Step 0 surfaces the compositor via a **composed-program output window**, not the vestigial virtual camera.
- **Exit:** ✅ a single composited stream of the whole layer stack, verified live in the browser (the composed-program window plays the stacked timeline) — the exact input every native sender will consume.

### Phase N — NDI (cross-platform, first native milestone)
- [ ] **N0 — Spike (throwaway):** NDI sender (crate vs sidecar) + transport **B1 (JPEG)** at 720p30; receive in OBS/Studio Monitor; **measure** latency/fps/CPU at 1080p; settle SDK bundling + licensing; confirm video composite readback in a production build.
- [ ] **N1 — model `target`:** add `output.target` (`display | ndi`); NDI route carries a stream name (no displayId/window); Outputs modal gains an "NDI output" target. Routing/stacking UI reused.
- [ ] **N2 — production:** stable sender behind the pipe contract; per-output NDI streams; alpha; clean start/stop; perf pass.
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
| **Transport throughput** (B) is the real unknown | N0 measures B1 (JPEG) first; B3 (native capture) is the codec-agnostic fallback. |
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
