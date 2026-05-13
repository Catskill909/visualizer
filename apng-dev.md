# APNG Support — Dev Document

> **Status:** 🔨 In Progress — Web + Windows ✅ shipped May 12, macOS APNG Phase 1 next
> **Date:** May 12, 2026
> **Goal:** Transparent video that works on all platforms — WebM as source of truth, APNG as macOS-only derived format

---

## Why This Matters — The Sammie Roto Workflow

[Sammie Roto](https://sammieroto.com) is an AI-powered rotoscoping tool. Point and click masking, exports WebM with full alpha channel. The workflow it unlocks for DiscoCast users:

```
Sammie Roto
  → AI cutout of any subject (person, object, creature)
  → Export WebM with alpha
        │
        ▼
DiscoCast — import as transparent video layer
  → Subject floats above MilkDrop visualizer
  → Full VJ effects: Pulse, Orbit, Spin, Mirror, Luma Key, Wave Distort...
  → Audio-reactive transparency, scale, position
  → Multiple cutout layers composited together
```

**This doesn't exist in any other VJ tool.** Most VJ software either has no transparency support, or requires pre-keyed footage. Sammie Roto does the hard work — DiscoCast does the creative work.

**The blocker:** WebM VP9 *with alpha* does not decode in WKWebView (macOS Tauri). Regular VP9 landed in Safari 14 (2020), but the alpha stream — a separate channel in the container — is not exposed. APNG is the fix.

---

## Platform Matrix — Where Things Actually Stand

| Platform | Engine | WebM VP9 alpha | APNG | Notes |
|---|---|---|---|---|
| **macOS Tauri** | WKWebView (Apple) | ❌ alpha only | ✅ | VP9 alpha stream not decoded — APNG Phase 1 needed |
| **Windows Tauri** | WebView2 (Edge Chromium) | ✅ native | ✅ | ✅ **Confirmed working May 12** — WebM bypasses transcoder, clearRect trail fix applied |
| **Web (Chrome)** | Chromium | ✅ native | ✅ | ✅ **Confirmed working May 12** — same fixes; web held back (not hosted) |

**Windows is not a problem.** WebView2 is Chromium-based so VP9 alpha plays natively. Two fixes shipped May 12 make it work end-to-end: WebM files bypass the 720p transcoder (`inspector.js`), and `clearRect` before each canvas draw eliminates alpha trail accumulation (`visualizer.js`). The APNG conversion is a macOS-only remaining task.

## Why APNG Is the Right macOS Conversion Target

| Property | GIF | WebM VP9 | APNG |
|---|---|---|---|
| **Alpha** | Binary (1-bit) | Full 8-bit | Full 8-bit |
| **Color depth** | 256 palette | 24-bit | 24-bit |
| **macOS Tauri (WKWebView)** | ✅ | ❌ | ✅ |
| **Windows Tauri (WebView2)** | ✅ | ✅ | ✅ |
| **FFmpeg encode** | ✅ | ✅ | ✅ (`apng` encoder) |
| **File size** | Large | Small | Medium |
| **Speed control** | Frame-delay math | `playbackRate` | Frame-delay math |
| **Frame-perfect loops** | Messy timing | ✅ | ✅ (proper fps) |

APNG is the right **macOS conversion target** — it decodes in WKWebView with full alpha. It is never the source of truth. WebM is stored on all platforms; APNG is derived on macOS only. Windows plays WebM natively and never converts.

**Why not HEVC with alpha?** Apple's HEVC-with-alpha encoder lives in `VideoToolbox` (macOS native) — FFmpeg.wasm's `libx265` has no alpha support. And even if encoded, `<video>` in WKWebView doesn't expose the alpha stream for WebGL compositing. HEVC alpha is a Final Cut / Metal workflow, not a web rendering pipeline.

**Future path:** AV1 with alpha. Apple joined AOM in 2018, added hardware AV1 decode on M2, and Safari 16 supports AV1. AV1 also supports a separate alpha stream. If WKWebView gains AV1 alpha decode, APNG conversion becomes unnecessary. Watch WebKit release notes for AV1 alpha. Until then, APNG is the bridge.

---

## Storage Strategy — WebM Is the Source of Truth

**WebM is stored in IndexedDB on all platforms.** It is the master — small files, the user's original content.

APNG is a **macOS-only derived format** — converted at upload time and cached. It is never the source. When a preset is exported and shared cross-platform, the WebM blob travels with it. macOS converts on import.

```
User drops WebM alpha
    │
    ├─ Windows → stored as WebM → plays natively (2–5MB)
    │
    └─ macOS → stored as WebM → APNG cached separately → plays via frame pipeline
               on preset import: WebM blob → convert → cache APNG → play

Preset export: always contains WebM blob (small, portable)
Preset import on macOS: WebM found → convert to APNG → cache → done
```

This keeps storage efficient everywhere. Windows users never pay the APNG size penalty. Mac users convert once and the result is cached.

---

## Scope — Three Conversion Paths

### Path A: WebM (alpha) → APNG — macOS Only
**Trigger:** WebM file uploaded OR imported in macOS Tauri build.
**Why:** WKWebView can't decode VP9. APNG plays natively via frame pipeline.
**FFmpeg command:**
```
ffmpeg -i input.webm -pix_fmt rgba -plays 0 -vf scale=-2:480 output.apng
```
- `-plays 0` = infinite loop
- `-pix_fmt rgba` = full alpha preserved
- `-vf scale=-2:480` = cap at 480p (RAM budget — see Performance section)
- Windows: WebM plays natively, zero conversion

**Detection:**
```javascript
const isMacTauri = !!window.__TAURI__ && navigator.userAgent.includes('Mac');
const isWebM = file.type === 'video/webm' || file.name.endsWith('.webm');
if (isMacTauri && isWebM) → convertToApng(file) → cache as `${videoId}_apng`;
// Windows Tauri (WebView2): play WebM natively, no conversion ever
```

### Path B: GIF → APNG — Quality Upgrade
**Trigger:** GIF uploaded on any platform.
**Why:** GIF is 256 colors, messy frame timing, large files. APNG is full-color, precise timing, smaller — and works in WKWebView unlike WebM. GIF→WebM was the earlier plan (video-dev.md §20, now superseded); APNG is better because it works on macOS and Windows with no platform split.
**FFmpeg command:**
```
ffmpeg -i input.gif -pix_fmt rgba -plays 0 -r 30 output.apng
```
- `-r 30` normalizes frame rate (fixes the 0ms/10ms GIF timing chaos)
- Alpha preserved through conversion
- User-visible result: richer colors, smoother playback, smaller file

**UX:** User drops a GIF → silent background conversion → loads as APNG. No friction.

### Path C: MOV (alpha) → APNG — Pro Import
**Trigger:** `.mov` file with alpha codec (ProRes 4444, Apple Animation) dropped on macOS.
**Why:** These are professional export formats from After Effects, Motion, DaVinci Resolve. Common in professional VJ libraries.
**FFmpeg command:**
```
ffmpeg -i input.mov -pix_fmt rgba -plays 0 output.apng
```
**Note:** MOV without alpha (standard H.264 MOV) should route to MP4 transcode instead. Detection: attempt load → if alpha detected in metadata or colorspace, use APNG path.

---

## Technical Architecture

### APNG Decode Pipeline

APNG frames are decoded in JS using `upng-js` (lightweight, no canvas, pure Uint8Array output — same philosophy as our gifuct-js GIF decoder):

```
APNG file
  → upng-js decode → raw RGBA frame array (Uint8ClampedArray[])
  → same _tickGifAnimations() path (texSubImage2D, no premultiply)
  → WebGL texture → shader compositing
```

**Key principle:** reuse the existing GIF frame animation pipeline entirely. APNG frames are just RGBA arrays — identical to what gifuct-js produces. The visualizer doesn't need to know the difference.

### What Changes vs. GIF Path

| Step | GIF (current) | APNG (new) |
|---|---|---|
| **Decode library** | `gifuct-js` | `upng-js` |
| **Frame extraction** | gifuct `decompressFrames()` | upng `decode()` + `toRGBA8()` |
| **Frame compositing** | gifuct handles disposal | upng handles disposal |
| **Upload to GL** | `texSubImage2D` | Same — no change |
| **Speed control** | frame delay multiplier | Same — no change |
| **Storage** | IndexedDB blob | Same — no change |

The GL upload, speed slider, and animation tick are **unchanged**. Only the decode step differs.

### FFmpeg Conversion — In `videoTranscoder.js`

New function alongside `transcodeTo720p()`:

```javascript
export async function convertToApng(file, onProgress = null) {
  // WebM → APNG, GIF → APNG, MOV → APNG
  // Output: File object with type 'image/apng'
}
```

Input extension is preserved via `getExtension(file.name)` — FFmpeg handles all three source formats.

### Detection Logic in `inspector.js`

```
File dropped / picked
  │
  ├─ .gif → convertToApng() → _handleApngUpload()
  │
  ├─ .webm + macOS Tauri → convertToApng() → _handleApngUpload()
  ├─ .webm + Windows Tauri → _addVideoLayer() (WebView2 plays VP9 natively)
  ├─ .webm + web → _addVideoLayer() (existing, no change)
  │
  ├─ .mov + alpha → convertToApng() → _handleApngUpload()
  ├─ .mov + no alpha → _addVideoLayer() (existing, Safari/WKWebView native)
  │
  ├─ .mp4 → _addVideoLayer() (existing, no change)
  └─ image → _addImageLayer() (existing, no change)
```

---

## Files to Touch

| File | Change |
|---|---|
| `src/videoTranscoder.js` | Add `convertToApng(file, onProgress)` function |
| `src/visualizer.js` | Add `_loadApngTexture()` + `_tickApngAnimations()` OR fold into existing GIF path with unified handler |
| `src/editor/inspector.js` | Add APNG detection in upload/drop handler; add `_handleApngUpload()` |
| `package.json` | Add `upng-js` dependency |
| `video-dev.md` | Add §27 reference to this doc |

**Existing files NOT modified:**
- `src/customPresets.js` — IndexedDB blob storage works as-is
- `vite.config.js` — no changes needed
- `src-tauri/src/main.rs` — `pick_image_file` already allows `.webm`, `.gif`, `.mov`

---

## Phased Plan

### Phase 1 — WebM Alpha on macOS (Sammie Roto Fix)
**Goal:** Sammie Roto exports work in the macOS app.
**Scope:** Path A only. WebM → APNG on Tauri + macOS UA detection.
**Checklist:**
- [x] WebM files bypass 720p transcoder in `inspector.js` — `isWebM` check added May 12
- [x] `clearRect` canvas fix in `visualizer.js` `_tickVideoAnimations()` — alpha trails eliminated May 12
- [x] Test: Sammie Roto WebM plays with alpha on web + Windows ✅ May 12
- [ ] `upng-js` added to dependencies
- [ ] `convertToApng()` in `videoTranscoder.js` (WebM input only)
- [ ] APNG upload handler in `inspector.js`
- [ ] Reuse GIF frame pipeline in `visualizer.js` for APNG frames
- [ ] Test: Sammie Roto WebM plays with alpha in macOS build

### Phase 2 — GIF → APNG Quality Upgrade
**Goal:** All GIF imports get full-color, properly-timed APNG treatment.
**Scope:** Path B. Replace existing GIF decode path at upload time.
**Checklist:**
- [ ] Add GIF detection → `convertToApng()` route
- [ ] Remove gifuct-js from upload path (keep in visualizer for legacy stored GIFs)
- [ ] Test: GIF with transparency renders correctly as APNG
- [ ] Test: GIF without transparency still works
- [ ] Test: Speed slider still works on converted APNG

### Phase 3 — MOV Alpha Import
**Goal:** After Effects / DaVinci Resolve exports with alpha work.
**Scope:** Path C. MOV with alpha codec → APNG.
**Checklist:**
- [ ] Alpha detection logic for MOV (codec sniff via MediaInfo.js or FFmpeg probe)
- [ ] Route alpha MOV → `convertToApng()`
- [ ] Route non-alpha MOV → existing video path

---

## Performance Budget — macOS APNG Frame Memory

All frames are decoded into RAM upfront (same as GIF pipeline). The RAM cost per layer:

| Resolution | Per frame | 5 sec @ 30fps | 10 sec @ 30fps |
|---|---|---|---|
| 720p | 3.5MB | ~525MB | ~1050MB |
| **480p (our cap)** | **1.6MB** | **~240MB** | **~480MB** |
| 360p | 0.9MB | ~135MB | ~270MB |

**Rules baked into conversion:**
- Cap output at **480p max** (`-vf scale=-2:480`)
- If clip > 5 seconds: drop to **15fps** (`-r 15`) — halves frame count
- Warn via toast if source is > 10 seconds (suggest trimming in Clipper first)

**Apple Silicon advantage:** Unified memory means `texSubImage2D` upload cost is near-zero — RAM and VRAM are the same pool. M1 with 8GB can comfortably run all 5 layer slots as APNG simultaneously (~1.2GB total at 480p/5sec). Intel Mac: 3–4 seconds max at 360p on 8GB.

---

## Open Questions — Resolved

1. **Unified pipeline vs. parallel:** Fold APNG into existing GIF path. Same `Uint8ClampedArray[]` frame structure, same `texSubImage2D` upload. `_tickGifAnimations` renamed `_tickFrameAnimations` or APNG added as a second map — decision at implementation time.

2. **Max frame count / size:** Resolved — 480p cap, 15fps above 5 seconds, toast warning above 10 seconds.

3. **Progress UX:** Reuse existing transcoder toast system exactly. "Converting for macOS... 45%"

4. **Storage:** WebM stored as source in IndexedDB. APNG cached separately as `${videoId}_apng` on macOS only. On preset reload: check for cached APNG first, re-convert from WebM if cache miss.

---

## User Education — What to Communicate and When

### What's Actually Happening (for docs/help text)

When a user drops a transparent WebM on macOS, the app silently converts it to APNG before loading. This happens because Apple's WebKit engine (used in the macOS app) doesn't support the VP9 video codec — a Google format Apple has chosen not to ship. The conversion is automatic and the result is cached, so it only happens once per clip.

On Windows, transparent WebM plays natively with no conversion. Windows uses Edge's Chromium engine which supports VP9 fully.

### Honest Platform Comparison (for help docs)

| | macOS | Windows |
|---|---|---|
| Transparent video format | WebM → converted to APNG | WebM native |
| Max practical clip length | ~5–8 sec (M1), ~3–4 sec (Intel) | No practical limit |
| Quality ceiling | 480p for transparent layers | 720p+ |
| Speed control | Frame-delay multiplier | Native `playbackRate` |
| Load time | ~20–40s conversion on first use | Instant |
| Cached after first load | ✅ Yes | N/A |

**Bottom line for users:** Windows is the better platform for long or high-resolution transparent video clips. macOS works great for the typical Sammie Roto use case — short 2–5 second loops — which is the natural output of AI rotoscoping tools anyway.

### When to Surface This to Users

- **On conversion start:** toast says "Converting for macOS compatibility... 45%" — honest, not alarming
- **If clip is over 8 seconds:** warn "This clip will be trimmed to 8 seconds for macOS. Use the Clipper to select your best section first."
- **In help/FAQ:** explain the Mac limitation plainly, without apologizing for it — it's Apple's decision, not ours
- **Never:** hide that conversion is happening. Users deserve to know their clip is being processed.

### What NOT to Do

- Don't call it "optimizing" when it's actually working around a platform limitation
- Don't silently fail on long clips — warn and truncate with a clear reason
- Don't pretend macOS and Windows have identical transparent video support — they don't

---

## Why This Is Groundbreaking (Seriously)

Every VJ tool has layers. Almost none have effortless transparent animation layers. The workflow is:

1. Shoot or find any footage
2. Open in Sammie Roto → 2 minutes of point-and-click masking → export WebM
3. Drop into DiscoCast → subject floats over the MilkDrop field
4. Add Orbit + Pulse + Mirror → it's orbiting, breathing with the bass, reflected
5. Stack 3 of these with different subjects → visual chaos with structure

This is the `subject isolation + compositing` workflow that costs thousands of dollars in professional VJ software. APNG support is what makes it work on macOS.

The §23 (Subject Isolation / AI) section of video-dev.md describes building this capability *inside* DiscoCast using YOLO/SAM. That's months of work. Sammie Roto already does it — we just need to accept its output.

---

*Document created May 12, 2026. Companion to video-dev.md §27.*
