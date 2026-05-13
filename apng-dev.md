# Transparent WebM on macOS — Dev Document

> **Status:** ✅ **SOLVED (research validated May 13)** — Stacked-alpha format works in WKWebView. All three validation tests passed in Safari with full transparency. Ready to build the Tauri sidecar implementation.
> **Last updated:** May 13, 2026
> **Scope:** macOS Tauri ONLY. Web + Windows work natively — do not touch.

---

## 🚀 HANDOFF — Read This First (Continuing Next Session)

### ✅ Validation outcome (May 13)

All three Safari tests passed empirically:

- **Test A — ffmpeg encoding:** ✅ Produced `bunny_stacked.webm` (3.3MB, 1280×1440 regular VP9, no alpha track)
- **Test B — Safari plays it:** ✅ Loads as a normal tall video. Status: `✓ loaded — 1280×1440`
- **Test C — WebGL alpha composite:** ✅ **Bunny renders with full transparency over candy-stripe background.** Stripes clearly visible THROUGH the transparent areas around the bunny's silhouette. Status: `✓ rendering`

**Confirmed on:** Safari 26.4 (WebKit 605.1.15), M1 Mac, macOS 26.4.1.

Screenshots are in the conversation history if needed. Test pages preserved at `~/Desktop/hevc-alpha-test/test-stacked.html` for re-running.

### What this means
The stacked-alpha approach is the solution. We can now build it with confidence — the format works end-to-end through the same pipeline our app uses (`<video>` → WebGL texture → composite shader → display).

### Current state of the repo
- Branch: `main`, HEAD: `eaf5a5c` (last good build, May 12)
- Working tree: clean (`git restore .` ran after the APNG rollback)
- DMG in `promo/DiscoCast-Visualizer.dmg` is the May 12 build — use it if you need to test the existing app

### Files created during research (preserved for the next session)
All in `~/Desktop/hevc-alpha-test/`:
- `bunny_stacked.webm` (3.3MB) — the stacked-alpha format under test
- `yes_hevc.mov` (989KB) — HEVC alpha via `hevc_videotoolbox` — Safari refused to load it
- `bunny_v2.mov`, `bunny_sw.mov`, `bunny_prores.mov` — other failed attempts
- `test.html` — original HEVC alpha Safari test page
- `test-stacked.html` — stacked-alpha Safari test page (the current test)
- `*_frame.png` — diagnostic frame extracts

**Source files (do not delete) on `~/Desktop/`:** `bunny.webm`, `yes.webm`, `not.webm` — user's test transparent WebM files.

### Where things stand in plain English

The user is building an app that lets people import transparent video (rotoscoped cutouts from Sammie Roto). It works on web and Windows. On macOS, Apple's WebKit refuses to decode VP9 alpha in the `<video>` element — that's the bug we're fighting.

We've ruled out three approaches empirically:
1. APNG via FFmpeg.wasm — wrong (alpha bug + huge files)
2. WASM VP9 decoder (ogv.js) — wrong (source code has no alpha support)
3. HEVC alpha via ffmpeg `hevc_videotoolbox` — wrong (Safari `<video>` won't load the file even though it's valid HEVC alpha per macOS Spotlight)

The current candidate is **stacked-alpha** — encode the WebM as a 2× tall regular VP9 video, with RGB in the top half and alpha as luma in the bottom half. WKWebView plays it natively as plain VP9, our shader composites it back to RGBA. Test A (encoding) passed. Tests B (Safari plays it) and C (WebGL composite works) are running in Safari now.

### Implementation plan (Outcome 1 confirmed — proceed)

Build the Tauri sidecar:
1. Phase 1 — bundle a stripped-down macOS universal ffmpeg binary (~15-25MB per arch) at `src-tauri/binaries/ffmpeg-{aarch64,x86_64}-apple-darwin`
2. Phase 2 — Rust command in `src-tauri/src/main.rs` that pipes WebM in, stacked WebM out
3. Phase 3 — JS `_handleWebmAlphaUpload()` in `inspector.js`, macOS-gated, calls sidecar
4. Phase 4 — new WebGL composite shader for stacked-alpha texture sampling (top half RGB, bottom half luma → RGBA output). This goes in a new `_loadStackedAlphaVideo()` method in `visualizer.js`, parallel to `_loadVideoTexture()`
5. Phase 5 — preset import/export: store WebM source, regenerate stacked cache on demand
6. Phase 6 — conversion modal (reuse the pattern documented earlier; pauses music; shows progress)

The shader code is in `test-stacked.html` — copy from there.

### The ffmpeg conversion command (working, tested)
```bash
ffmpeg -c:v libvpx-vp9 -i input.webm \
  -filter_complex "[0:v]format=yuva420p,split=2[a][b];[a]alphaextract,format=gray[alpha];[b]format=yuv420p[rgb];[rgb][alpha]vstack[stacked]" \
  -map "[stacked]" \
  -c:v libvpx-vp9 -pix_fmt yuv420p \
  -b:v 2M \
  -an \
  output_stacked.webm
```

### The WebGL shader pattern (working, in test-stacked.html)
```glsl
// Fragment shader — sample top half for RGB, bottom half for alpha
vec2 rgbUV = vec2(v_uv.x, v_uv.y * 0.5);
vec2 aUV   = vec2(v_uv.x, v_uv.y * 0.5 + 0.5);
vec3 rgb = texture2D(u_tex, rgbUV).rgb;
float a  = texture2D(u_tex, aUV).r;
gl_FragColor = vec4(rgb, a);
```

### Critical: macOS-only gate
Every change must be gated by:
```javascript
const isMacTauri = !!window.__TAURI__ && navigator.userAgent.includes('Mac');
```
**Web + Windows must continue to use the existing `_addVideoLayer()` path unchanged.** That path already works for transparent WebM on those platforms (shipped May 12 at `eaf5a5c`).

### Memory entries to consult
- `project-webm-alpha-dead-ends` — what NOT to try (FFmpeg.wasm, ogv.js, HEVC alpha .mov)
- `project-transparent-webm-macos-plan` — overall plan
- `feedback-verify-before-coding` — require empirical evidence before touching code

### Conversation context (token cost)
A heavy session was spent on this. Three failed approaches, two failed code paths rolled back, all documented in this file. The user wants this solved — transparent video is a powerful creator tool — but is reasonably frustrated at the iteration count. Don't propose another approach without empirical evidence it works.

---

---

## The Problem in One Sentence

WKWebView (macOS Tauri's browser engine) plays VP9 video fine, but silently drops the alpha channel — transparent WebM from Sammie Roto imports as an opaque video with a black background.

**This is an Apple decision, not a bug we can patch.** VP9 is a Google codec; Apple chose not to expose its alpha stream in WebKit.

**Web and Windows are not affected.** WebView2 (Windows Tauri) and Chrome are Chromium-based and decode VP9 alpha natively. The existing `_addVideoLayer()` path works perfectly on both. **This entire document is about macOS Tauri only.**

---

## Platform Matrix — Where Things Stand

| Platform | Engine | Transparent WebM | Status |
|---|---|---|---|
| **macOS Tauri** | WKWebView | ❌ alpha dropped | **This is what we're solving** |
| **Windows Tauri** | WebView2 | ✅ native | Confirmed May 12 — WebM bypass + clearRect fix |
| **Web (Chrome)** | Chromium | ✅ native | Confirmed May 12 |

Two fixes shipped May 12 that make Web + Windows work end-to-end:
- `inspector.js`: WebM files bypass the 720p transcoder (`isWebM` check)
- `visualizer.js`: `clearRect` before each canvas draw eliminates alpha trail accumulation

**These are in `main` at `eaf5a5c`. They must never be touched by the macOS fix.**

---

## Why This Matters — The Sammie Roto Workflow

[Sammie Roto](https://sammieroto.com) is an AI rotoscoping tool — point and click to cut out any subject, export as WebM with alpha.

```
Sammie Roto
  → AI cutout of person/object/creature
  → Export WebM with alpha channel
        ↓
DiscoCast (macOS)
  → Subject floats over MilkDrop visualizer
  → Full VJ effects: Pulse, Orbit, Spin, Mirror, Luma Key...
  → Audio-reactive alpha, scale, position
```

This doesn't exist in any other VJ tool. Getting it to work on macOS is the goal.

---

## ❌ Dead-End #1 — APNG via FFmpeg.wasm (Tried & Rolled Back May 13)

**Two fatal flaws confirmed in testing:**

### Flaw 1: FFmpeg.wasm cannot decode VP9 alpha
[**Bug #621 — ffmpegwasm/ffmpeg.wasm**](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/621) — open, unresolved, no fix in sight (reported Nov 2023, still open May 2026).

When native `ffmpeg` decodes a VP9-alpha WebM, it outputs `yuva420p` (with alpha). FFmpeg.wasm outputs `yuv420p` — the alpha stream is silently dropped. **Any** conversion run in FFmpeg.wasm starts with opaque source data. Transparency is gone before we even start encoding.

**Confirmed empirically:** the APNG we produced had no alpha. Black background.

### Flaw 2: File size explosion
APNG stores raw, lossless RGBA pixels per frame. A 5MB VP9 WebM (which is ~50× compressed) becomes 100MB+ as APNG. Mathematically unavoidable for real video content.

### Rollback
All APNG code reverted at commit `eaf5a5c`. Do not resurrect this approach.

---

## ❌ Dead-End #2 — WASM VP9 Decoder (ogv.js) — Confirmed Unviable May 13

**Initial hypothesis:** Use `ogv.js` (the most mature JS WebM decoder) to decode VP9 alpha frames in JS, skip all file conversion, feed RGBA frames directly into the existing `_gifAnimations` pipeline.

**Three independent confirmations this won't work:**

1. **Source code inspection.** [`ogv-decoder-video-vpx.c`](https://github.com/bvibber/ogv.js/blob/main/src/c/ogv-decoder-video-vpx.c) — the VPX decoder only processes 3 planes (Y, U, V). No alpha plane handling, no separate alpha stream detection, no YUVA output. The callback `ogvjs_callback_frame()` only emits YUV.

2. **GitHub Issue #590** — ["Support for VP8/VP9 alpha transparency"](https://github.com/bvibber/ogv.js/issues/590). Opened May 2021, **still open four years later**. The maintainer has never implemented alpha support.

3. **GitHub Issue #603** — a user tried to add alpha support themselves: "Try to add alpha channel support to the player by myself, but get an alpha buffer array which values are all zero from wasm". Closed without resolution.

**The broader ecosystem gap:** there is no production-quality JavaScript/WASM library that correctly decodes VP9 alpha from WebM. The WebM spec is clear that VP9 alpha is a separate stream needing two decoder instances, but no JS port implements this. FFmpeg.wasm doesn't (#621), ogv.js doesn't (#590), `webm-wasm` is encoder-only, WebCodecs in WKWebView is hardware-dependent (M3+ only) and has its own spec issue ([w3c/webcodecs #377](https://github.com/w3c/webcodecs/issues/377)). 

**Lesson:** the spec being clear ≠ libraries implementing it. Always check source code, not just specs and search snippets.

---

## ❌ Dead-End #3 — HEVC Alpha via ffmpeg `hevc_videotoolbox` (Tested & Failed May 13)

**Initial hypothesis:** Apple's WWDC 2019 introduced HEVC with alpha — it's their official transparent video format. Bundle a native macOS ffmpeg binary, convert WebM → HEVC alpha .mov using `hevc_videotoolbox -alpha_quality 0.75`, play in `<video>` element in WKWebView.

**Phase 0 manual test (May 13, 2026 — macOS 26.4.1, M1 Mac):**

1. ✅ Conversion produced a valid HEVC alpha file:
   - 989 KB (vs 5.4 MB source WebM)
   - macOS Spotlight (`mdls`) reports `kMDItemCodecs = "HEVC with Alpha"`
   - Alpha data is in the file (verified via ffprobe + Spotlight metadata)

2. ❌ **The .mov file does not load in Safari/WKWebView's `<video>` element at all.**
   - Plain HTML page with `<video src="yes_hevc.mov">` in Safari: video element collapsed to zero size, no controls, no error visible, no playback
   - Same WKWebView engine as our Tauri app, so Tauri behavior would be identical

3. ✅ Side test — confirmed Safari's VP9 alpha limitation directly:
   - `<video src="bunny.webm">` in Safari: plays, but renders the full opaque scene (tree, background, etc.) instead of just the masked bunny. Alpha is ignored.

**Conclusion:** Even though the file is a valid Apple-recognized HEVC alpha file, WKWebView's `<video>` element refuses it. Apple's HEVC alpha appears to work in `<img>` tags / picture-in-picture / native AVFoundation views, but **NOT in `<video>` element** — which is what we need for our WebGL frame extraction pipeline.

This may be specific to current macOS WebKit (26.x), to the `hevc_videotoolbox` flag combination, or to MOV-as-video-tag in general. We did not pursue further diagnostic because the rotoscoped use case demands the `<video>` element pathway.

**Files used in this test (preserved for reference):** `~/Desktop/hevc-alpha-test/` — contains the converted .mov files, source frame samples, and a Safari test HTML page.

---

## 🔬 Path Now Under Consideration — Stacked Alpha (Untested)

**Concept (Jake Archibald, 2024):** encode the alpha as a regular grayscale image stacked underneath the color frame, producing a single regular VP9 video at 2× the height. No alpha track. No special codec features. Just regular VP9 that WKWebView decodes natively.

```
Stacked WebM (1280 × 1440)
┌──────────────────┐
│                  │
│   RGB color      │   ← top half — sampled for color
│   data           │
│                  │
├──────────────────┤
│                  │
│   Alpha as       │   ← bottom half — sampled for alpha
│   grayscale      │
│                  │
└──────────────────┘
```

### Why this might actually work where the others didn't

| Requirement | Stacked Alpha |
|---|---|
| WKWebView plays the video | ✅ It's regular VP9 with no alpha stream — no special decoder features needed |
| WebKit `<video>` element loads it | ✅ Standard WebM, same as any other VP9 video |
| Canvas / WebGL pipeline gets pixel data | ✅ Standard `drawImage(video)` → `getImageData` works |
| Alpha is recoverable in our pipeline | ✅ Sample top half for RGB, bottom half luma as alpha — composite in WebGL shader |
| File size | ✅ Similar to source WebM (~1.5×, alpha as luma compresses well) |
| Conversion needs native ffmpeg | ⚠️ Yes — still needs VP9-alpha decode which FFmpeg.wasm can't do. Tauri sidecar required. |

### Production encoder command (to test)

```bash
ffmpeg -c:v libvpx-vp9 -i input.webm \
  -filter_complex "[0:v]format=yuva420p,split=2[a][b];[a]alphaextract,format=gray[alpha];[b]format=yuv420p[rgb];[rgb][alpha]vstack[stacked]" \
  -map "[stacked]" \
  -c:v libvpx-vp9 -pix_fmt yuv420p \
  -b:v 1M \
  -an \
  output_stacked.webm
```

### Open questions to test before committing

1. **Does Safari/WKWebView play the double-height regular VP9 file?** Should be yes (it's just regular VP9), but must verify.
2. **Can we read both halves via `<video>` → canvas → `getImageData` reliably?** Standard pipeline — high confidence.
3. **What's the file size vs source?** Untested but Jake Archibald reports ~1.1MB for similar content (vs 989KB for HEVC alpha — comparable).
4. **WebGL shader compositing:** straightforward — sample texture at `y` for RGB, sample at `y + 0.5` for alpha, output RGBA. ~5 lines of GLSL.

### Risk

The only encoding step requires VP9-alpha decode on the input side — same step FFmpeg.wasm fails on (#621). So we still need a native ffmpeg sidecar. But once we have a sidecar producing stacked-alpha WebM, the output is a regular VP9 that WKWebView definitely plays. The unknown is whether the playback + canvas extraction roundtrip preserves the data we need (which it should — it's just luma values, not an alpha channel).

---

## ~~Path Forward — HEVC Alpha via Tauri Sidecar~~ (Abandoned May 13 after Safari test)

**The only realistic path:** bundle a native macOS `ffmpeg` binary in the Tauri app as a sidecar. At upload time, invoke it to convert WebM VP9 alpha → HEVC alpha MOV using Apple's `hevc_videotoolbox` (hardware-accelerated). The resulting MOV plays in WKWebView's `<video>` element with transparency — natively, with hardware decode.

### Why this is the right answer

- **HEVC with alpha is Apple's official transparent video format** (introduced WWDC 2019, session #506)
- **Hardware-accelerated** encode and decode on every Mac since Catalina (Intel + Apple Silicon)
- **File size: ~1–1.5× the WebM source** — not 20× like APNG
- **Plays in `<video>` element with full alpha** — same pipeline as our existing video layers
- **Well-trodden Tauri pattern** — projects like [66HEX/frame](https://github.com/66HEX/frame) use this exact stack (Tauri + ffmpeg sidecar + hevc_videotoolbox)

### FFmpeg command (runs in the sidecar)

```bash
ffmpeg -i input.webm \
  -c:v hevc_videotoolbox \
  -tag:v hvc1 \
  -alpha_quality 0.75 \
  -q:v 35 \
  -an \
  output.mov
```

- `-c:v hevc_videotoolbox` — Apple's hardware-accelerated HEVC encoder
- `-tag:v hvc1` — fourcc tag Safari requires for HEVC playback
- `-alpha_quality 0.75` — alpha channel quality (0.0–1.0)
- `-q:v 35` — RGB quality (lower = higher quality)
- `-an` — strip audio (we don't use it for VJ visuals)

### Architecture Overview

```
WebM dropped on macOS Tauri
  ↓
_handleWebmAlphaUpload(file)   [macOS Tauri only — gated]
  ↓
Show conversion modal (file info, Go/Cancel, music auto-pauses on Go)
  ↓
Tauri invoke → ffmpeg sidecar → hevc_videotoolbox conversion (hardware accel)
  ↓
Receive HEVC alpha .mov bytes
  ↓
Store BOTH blobs in IndexedDB:
  - videoId      → WebM source (portable; for export + cache-miss recovery)
  - videoId+_hevc → HEVC alpha cache (what plays on macOS)
  ↓
Build layer entry with type='video', play via existing _addVideoLayer()
  ↓
<video> element plays HEVC with native alpha
  ↓
_tickVideoAnimations() draws to canvas → getImageData → texSubImage2D
  ↓
WebGL composite shader renders with transparency ✓
```

### Critical gate: only macOS Tauri enters this path

```javascript
const isMacTauri = !!window.__TAURI__ && navigator.userAgent.includes('Mac');
const isWebM = file.name.toLowerCase().endsWith('.webm') || file.type === 'video/webm';
if (isWebM && isMacTauri) {
    await this._handleWebmAlphaUpload(file);   // new macOS-only path
} else {
    this._addVideoLayer(file);                  // existing path — DO NOT TOUCH
}
```

Web and Windows never enter the new code path. The existing `_addVideoLayer` flow remains byte-identical on those platforms.

---

## Open Questions To Resolve Before Coding

These need answers before we commit to bundling a 15–25MB binary.

### Q1: Does HEVC alpha survive the `<video>` → canvas → `texSubImage2D` roundtrip in WKWebView?

The existing `_tickVideoAnimations()` pipeline does:
```javascript
uploadCtx.drawImage(videoElement, 0, 0, width, height);
const frameData = uploadCtx.getImageData(0, 0, width, height).data;
gl.texSubImage2D(...rgba..., frameData);
```

If WKWebView strips alpha during `drawImage(videoElement)` even though the video has alpha, then HEVC alone is not enough — we'd need WebGL-direct video texture upload via `gl.texImage2D(target, level, format, ..., videoElement)`.

**Test plan before committing:** manually produce one HEVC alpha .mov on developer's local Mac (using brew-installed ffmpeg), drop it into the macOS build via the existing video upload path, confirm transparency renders end-to-end. Half-hour test. Validates the whole architecture or kills it before we bundle anything.

### Q2: Universal binary or arm64-only?

Apple Silicon binary (~15MB stripped) vs. universal arm64+x86_64 (~30MB).
- Apple Silicon only: smaller, but breaks Intel Macs
- Universal: doubles binary size but covers all Macs since Catalina

**Recommendation:** universal binary. Intel Macs are still common.

### Q3: Convert all WebM on macOS, or only transparent ones?

We can't reliably probe for alpha from JS in WKWebView (the alpha stream is stripped before JS sees it — that's the whole problem). So either:
- **Convert all WebM unconditionally on macOS** — wastes time on non-transparent WebM, but simple
- **Heuristic: only convert if user opts in or filename suggests alpha** — fragile

**Recommendation:** convert all WebM on macOS. HEVC encoding is hardware-accelerated and fast (5–10× realtime on Apple Silicon). A 5-second 720p WebM converts in ~1 second. Acceptable.

---

## Phased Implementation Plan

### Phase 0 — Validate Q1 before bundling anything (30 minutes, no commits)
1. On developer Mac, manually convert a Sammie Roto WebM to HEVC alpha using brew-installed ffmpeg
2. Drop the .mov into the existing macOS build via the standard video upload
3. Verify alpha renders correctly in the visualizer (subject floats over MilkDrop with transparency)
4. **GO/NO-GO decision** — if alpha is lost, the entire Path 2 architecture needs rethinking

### Phase 1 — Tauri sidecar plumbing
- Build/obtain stripped macOS universal ffmpeg binary (~30MB)
- Place at `src-tauri/binaries/ffmpeg-x86_64-apple-darwin` and `src-tauri/binaries/ffmpeg-aarch64-apple-darwin`
- Enable sidecar in `tauri.conf.json` (`"sidecar": true`, externalBin entry)
- Rust command wrapper exposes `invoke('convert_webm_to_hevc', { webmBytes })` returning HEVC bytes
- Smoke test: call from JS, get a version string back

### Phase 2 — JS upload routing (macOS Tauri only)
- New `_handleWebmAlphaUpload(file)` method in `inspector.js` 
- Routes only when `isMacTauri && isWebM` — every other path untouched
- Store both blobs (WebM source + HEVC cache)
- Build layer entry as `type='video'`, plug into existing `_addVideoLayer`/`_videoAnimations` pipeline

### Phase 3 — Conversion modal (reuse pattern from earlier session)
- Pre-conversion confirm modal: file info, time estimate, Go/Cancel
- On Go: pause music, switch to progress view
- Progress driven by sidecar stdout parse (ffmpeg's `frame=` lines)
- On complete: dismiss, add layer

### Phase 4 — Preset import/export
- Export: WebM always bundled (portable); HEVC optional (regenerated on macOS import)
- Import on macOS: check HEVC cache → reconvert from WebM source if cache miss
- Import on web/Windows: ignore HEVC entirely, load WebM via existing path

---

## Files That Will Change

| File | Change |
|---|---|
| `src-tauri/tauri.conf.json` | Enable sidecar, add externalBin entry |
| `src-tauri/src/main.rs` | Add Tauri command that wraps ffmpeg sidecar |
| `src-tauri/binaries/ffmpeg-*` | Pre-compiled ffmpeg binary (new file) |
| `src/editor/inspector.js` | `_handleWebmAlphaUpload()`, macOS routing in upload handlers |
| `package.json` | No new npm deps — sidecar is native, not JS |

### Files that MUST NOT change

- `_addVideoLayer()` — web + Windows path
- `_tickVideoAnimations()` — existing video pipeline (already alpha-safe via clearRect fix)
- `_loadGifTexture()` / `_tickGifAnimations()` — GIF pipeline
- `videoTranscoder.js` — existing 720p transcoder for non-alpha video (unrelated)

---

## Research Summary — Why Other Approaches Fail

| Approach | Status | Reason |
|---|---|---|
| FFmpeg.wasm → APNG | ❌ Dead | Bug #621 drops alpha; 20× file size |
| FFmpeg.wasm → stacked-alpha | ❌ Dead | Same bug #621 — needs VP9 alpha decode first |
| ogv.js → frame extraction | ❌ Dead | Source code has no alpha support; issue #590 open 4 years |
| webm-wasm (Google) | ❌ N/A | Encoder-only, not a decoder |
| WebCodecs in WKWebView | ❌ Fragile | Hardware-dependent (M3+ only); w3c issue #377 open |
| Animated AVIF | ❌ Broken | Safari renders alpha incorrectly; single-digit FPS |
| Native ffmpeg → HEVC alpha .mov | ❌ Dead | Tested May 13 — Safari `<video>` element refuses to load even valid "HEVC with Alpha" files |
| **Native ffmpeg → stacked alpha VP9 WebM** | **🔬 Untested** | Plays as regular VP9 (no special decoder needed). Still requires native ffmpeg sidecar for the input alpha decode. |
| Two-`<video>` canvas composite | ⚠️ Backup | Two separate WebMs (color + alpha); JS canvas composite per frame. Performance penalty. |
| Native ffmpeg → ProRes 4444 | ❌ Too large | Alpha works (307MB / 13 sec) — unusable file size |

---

## Decision Log

| Date | Decision | Reason |
|---|---|---|
| May 12 | WebM bypass added in `inspector.js` | Prevent 720p transcode on WebM files |
| May 12 | `clearRect` fix in `_tickVideoAnimations` | Eliminate alpha trail accumulation on Web/Windows |
| May 13 | APNG approach attempted via FFmpeg.wasm | Initial plan based on outdated assumption |
| May 13 | APNG approach abandoned, code rolled back to `eaf5a5c` | Bug #621 strips alpha; 100MB file size confirmed |
| May 13 | Path 1 (WASM VP9 decode via ogv.js) hypothesized | Avoid file conversion entirely |
| May 13 | Path 1 abandoned without coding | Deeper research: ogv.js source has no alpha (issue #590 open 4 yrs) |
| May 13 | Path 2 (HEVC via Tauri sidecar) selected | Only realistic option; Apple's official format |
| May 13 | Path 2 abandoned after Safari test | HEVC alpha .mov produced by `hevc_videotoolbox` fails to load in WKWebView's `<video>` element despite being valid per macOS Spotlight |
| May 13 | Stacked alpha approach selected for next test | Plays as regular VP9 — no special decoder features needed. Confidence: high. |

---

## User Education — What to Communicate

When a transparent WebM lands on macOS, the conversion modal should say (plainly):

> This video has transparency. macOS requires a one-time conversion to a format Apple's WebKit can play with alpha (HEVC). The result is cached so this only happens once per clip. Music will pause during conversion to free up processing power.

**Don't apologize for it.** It's Apple's decision not to support VP9 alpha in WebKit. State the fact, do the conversion, move on.

---

*Document originally created May 12 as `apng-dev.md`. Repurposed May 13 after APNG and ogv.js paths confirmed dead. Companion to `video-dev.md`.*
