# Transparent WebM on macOS — Dev Document

---

## ⚠️ Black-background-on-reload fix (May 14 2026, afternoon)

**Bug surfaced after the macOS session, root cause was unrelated:** every preset saved while in a "solid-color" base variation (Solid, Shift — the default — etc.) reloaded with a black background on every platform (web, Windows, macOS), and the same happened on export/import. Clicking any palette swatch restored the rendering until the next reload.

**Why it happened:** `_solidColor` is an instance variable on `EditorInspector` (not in `currentState`), and it drives whether `_buildCompShader` emits the **solid-color base** (`vec3 col = mix(_colA, _colB, ...)`) or the **sampler_main base** (`vec3 col = texture(sampler_main, uv_m).xyz * 2.0`). It was never persisted in saved presets. On reload, `_clearForLoad` sets it to `null`; `_buildCompShader` then emits the sampler_main path; and for solid-color presets Butterchurn renders nothing into `sampler_main` (e.g. `wave_a = 0` on the Shift variation) → black canvas.

This bug had existed since `_solidColor` was introduced — it only became visible after a session of testing where every new preset used the default Shift variation.

**Fix (two small edits in [src/editor/inspector.js](src/editor/inspector.js)):**

1. `saveCurrent` now writes `solidColor: this._solidColor` alongside the `currentState` spread, so the saved preset record carries the instance var.
2. `loadPresetData` now restores `this._solidColor = Array.isArray(stateFields.solidColor) ? stateFields.solidColor.slice() : null;` right after the BLANK/stateFields spread.

`exportPreset` and `importPreset` need no change — they spread all fields, so the new `solidColor` field rides along through the JSON.

**Backward compat:** presets saved before the fix do not have the `solidColor` field. They will still load black on first open. Resave (after touching any palette swatch to restore the rendering) writes the field, after which save/reload + export/import behave correctly.

---

> **Status (May 14 2026, ~9:35am):** ✅ **SHIPPED — DMG #11 confirmed working by user.**
> Transparent WebM (from Sammie Roto or any VP9-alpha source) now imports correctly in the production macOS DMG. The bunny renders with full transparency over the MilkDrop visualizer; sliders + palette + all controls stay responsive; presets save and reload correctly with the stacked-alpha layer.
> **Scope:** macOS Tauri ONLY. Web + Windows transparent WebM already worked natively (shipped May 12, untouched).

## ✅ The actual fix (one-line root cause)

**Production WKWebView treats VP9-decoded video as cross-origin for pixel-extraction operations, but treats H.264 as same-origin.** The fix: have the ffmpeg sidecar encode the stacked-alpha output as **H.264 MP4** instead of VP9 WebM. The stacked-alpha trick (RGB top half + alpha-as-luma bottom half in a 2× tall frame) is codec-agnostic — alpha is just visible pixels — so it works identically through H.264.

### The minimal change set that actually mattered

```rust
// src-tauri/src/main.rs — convert_to_stacked_alpha
// OLD:
"-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "2M", "-an",
let output_path = ... join(format!("stacked_{}.webm", timestamp));

// NEW:
"-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
let output_path = ... join(format!("stacked_{}.mp4", timestamp));
```

```js
// src/editor/inspector.js — _handleWebmAlphaUpload
const mp4Name = file.name.replace(/\.webm$/i, '.mp4');
const stackedFile = new File([outBytes], mp4Name, { type: 'video/mp4' });
```

Three lines. After 10 failed builds.

---

## 🔍 Post-mortem — why did this take 2 days?

### Failure modes I made, in order

1. **Started with the wrong layer of abstraction.** When the production DMG silently locked up the UI after upload, I jumped to "must be the byte path" and rewrote it 3 times (4 MB IPC → asset:// fetch → asset:// + ArrayBuffer → back to IPC). The bug wasn't in the byte path at all — every byte path worked. The bug was at the codec layer, downstream of everything I was changing.

2. **Built the diagnostic infrastructure AFTER 5 silent-failure builds.** The first 5 DMGs failed silently because there was no on-screen error reporting in production (no devtools in the DMG). I should have built the red-error-banner + global error-handler + render-loop try/catches as **DMG #1**, not DMG #5. Once the banner was in place, the actual `SecurityError` revealed itself in one test. Five builds wasted on guessing.

3. **Treated symptoms as causes for 3 more builds.** After the banner showed `SecurityError: The operation is insecure.`, I assumed canvas tainting from blob URL origin. Built fix after fix to "make the blob same-origin" — IPC bytes, ArrayBuffer rebirth, `crossOrigin = 'anonymous'`, shader-based composite to skip canvas entirely. **None of these were the root cause.** The blob *was* same-origin; the codec was the problem. I was four levels removed from the actual bug.

4. **Never asked the differential question.** The single piece of evidence that cracked this was: *does a regular MP4 work in the production DMG?* That test took 30 seconds and immediately collapsed the hypothesis space — if MP4 works, byte path / blob URL / origin / canvas tainting are all eliminated; only codec is left. I should have asked the user this on the *first* DMG failure, not the eleventh. Differential tests are the cheapest evidence we have.

5. **Confused myself (and the user) with terminology.** "Production DMG" vs "the Mac app you installed" vs "the build" — these are all the same thing but I switched between them randomly. User burned an entire test cycle convinced they'd been testing the wrong build because of my unclear language.

6. **Iterated on a 5-10 minute build/notarize/install cycle without checkpointing what I'd ruled out.** Each DMG was a fresh guess. I rebuilt full notarized DMGs to test single hypotheses I could have ruled out with a grep or a curl. The build cost made each iteration feel like progress when it was actually just expensive guessing.

### What I should have done

1. **DMG #1 should ship the diagnostic harness, not a fix.** Red error banner for any uncaught throw + global `unhandledrejection` listener + render-loop try/catch + diagnostic strip showing video state. Then one test → one specific error → one specific fix.

2. **Ask the differential question immediately.** "Does a regular MP4 work in the same DMG?" eliminates entire categories of hypothesis in 30 seconds. Should be the second question after seeing the failure, not the eleventh.

3. **Distinguish "I've reproduced the bug" from "I think I know what's causing it."** I had a confirmed `SecurityError` after DMG #5 but didn't know which operation was throwing or why. Instead of pinning that down with a one-line `console.error('throwing at:', operationName)`, I built three more DMGs trying to "fix" a cause I hadn't actually identified.

4. **Use `npm run tauri-dev` for hypothesis testing, DMG for confirmation only.** Dev mode iterates in seconds. DMG cycle is 5-10 minutes per build. I burned hours rebuilding DMGs to test things that should have been falsified or confirmed in dev — except dev didn't reproduce the bug, which itself was a giant hint that the production-only environment (hardened runtime + WKWebView prod paths) was the differential variable. I should have studied that asymmetry rather than re-trying the same change in different DMG builds.

5. **Stop the build cycle when 3 attempts of the same approach fail.** After DMGs #6 and #7 attacked "canvas tainting" with no improvement, DMG #8's "another shape of the same approach" was structurally guaranteed to fail. The same idea retried doesn't become a better idea on the third build.

### What did go right (worth keeping)

- The defensive infrastructure (red banner, render-loop try/catches, global error listener, metadata timeout, play-rejection toasts) stays in the codebase permanently. It saved diagnosis once and will save the next silent-failure debugging session.
- The shader-based composite for stacked-alpha (skip canvas, GLSL does the top/bottom assembly) is more efficient than the original JS composite even though it wasn't the fix we needed. Keeping it.
- The fresh-eyes-AI critique (mid-session) was the kick that broke the bad pattern of treating `console.warn` rejections as invisible. That redirected me to surface the `play()` rejection and the diagnostic strip, which proved the video was fine and shifted my attention to where the error actually was.
- `loadPresetData` propagating `isStackedAlpha` correctly (the "dual layer" bug found mid-debug) is a real ship-blocking bug that I would have missed entirely without this session — only surfaced because the user was testing save/reload as part of the failure pattern.

### Lessons that should outlast this bug

1. **Production WKWebView ≠ dev mode.** Hardened runtime + custom protocol + signed bundle creates a stricter security context. When dev works and prod doesn't, the difference itself is the most important clue.
2. **VP9 in production WKWebView cannot have its pixels read from JS.** Anything that needs canvas/WebGL access to video pixels must use H.264. Memorize this.
3. **Build the visible-error harness before the fix.** Production-only bugs without diagnostic visibility = wasted cycles.
4. **Differential tests > hypothesis stacking.** "Does the same code path with a different input still fail?" beats "I bet it's because of X."
5. **Three failed builds of the same idea = wrong idea.** Reset, don't iterate.
6. **Speculative "fixes" must be cleaned up before declaring victory.** `video.crossOrigin = 'anonymous'` was added in DMG #10 as a guess against the prod bug. It didn't help; DMG #11's H.264 codec fix was the actual answer. I declared victory and updated the docs without removing the speculative `crossOrigin` line. It silently broke web preset-reload transparency for hours. Add a "speculative changes I made that didn't pan out" checklist before shipping, and revert each one if not load-bearing.

---

---

## 📜 Chronological log of fixes shipped tonight (May 13, 2026)

| DMG | Time | Change | Outcome |
|---|---|---|---|
| #1 | Earlier today | Initial integration: base64-over-IPC, no progress feedback, no render-loop guards | Controls locked up after upload; cause unknown |
| #2 | ~7:30pm | Added live progress toast (`webm-convert-progress` event from Rust) | Same lockup, but progress toast confirmed the conversion runs in prod |
| #3 | ~8:30pm | Switched bytes path: Rust writes file + returns path; JS uses `fetch('asset://…')`. Added `protocol-asset` Cargo feature + `protocol.asset` allowlist + `connect-src asset:` in CSP | Same lockup |
| #4 | ~9:00pm | Added per-step diagnostic toasts in `_handleWebmAlphaUpload` (`Step 1/4: Got output path…` etc) | Reached "Layer added!" toast — confirmed all of inspector.js completes |
| #5 | ~9:45pm | Added render-loop hardening: try/catch around `_tickGifAnimations`, `_tickVideoAnimations`, `this.visualizer.render()` + red on-screen banner showing the actual exception. Also added global `error` + `unhandledrejection` listeners + 10s `onloadedmetadata` timeout. Default `alphaMode` for stacked-alpha entries changed `'fade'` → `'preserve'` | 🎯 **Pinpointed the actual error:** red banner showed `TICK ERROR: SecurityError: The operation is insecure.` Controls now stay responsive (render loop survives) |
| #6 | ~10:05pm | Replaced `response.blob()` with `response.arrayBuffer()` + fresh `new File([buf], …)`, hoping ArrayBuffer would strip the asset:// origin tag | Same `SecurityError` — confirmed the origin tag survives even raw bytes via fetch |
| #7 | ~10:20pm | Reverted bytes path to Tauri IPC: Rust returns base64 → JS `atob` → `Uint8Array` → `new File([uint8Array])`. Bytes never touch any cross-origin URL. Also fixed `loadPresetData` so saved stacked-alpha videos reload as one composited layer (was rendering as RGB-on-top + alpha-luma-on-bottom because `isStackedAlpha` wasn't propagated through reload) | 🟡 `SecurityError` gone, render loop healthy, no errors of any kind — **but transparent layer still doesn't display on the visualizer canvas.** Root cause of non-display unknown at session end. |
| #8 | ~10:35pm | **Fresh-eyes feedback applied:** every `video.play().catch(console.warn)` swallowed a handled promise rejection invisibly — neither devtools nor the global `error` listener can see it because `.catch()` consumes it. All three call sites (`_addVideoLayer`, `_loadVideoTexture` initial play, loop-restart) now surface the rejection as a visible toast/banner with `err.name` + `err.message`. Also added a `[name @ t.s] rs=N ct=N.NN paused=B ended=B` diagnostic strip — if `readyState` never reaches ≥2 or `currentTime` never advances past 0, this confirms the video-decode pipeline is the failure point. | Diagnostic strip showed `rs=4 ct=8.438 paused=false` — video IS decoding fine. But canvas `SecurityError` continued to throw. Eliminated the autoplay/decode-stall hypothesis. |
| #9 | May 14 ~9am | Architectural fix: removed canvas + getImageData entirely for stacked-alpha. Texture allocated at FULL 2× tall video size, video uploaded directly via `gl.texSubImage2D(videoElement)`, fragment shader does the top/bottom composite (sample `(u.x, u.y*0.5)` for RGB, `(u.x, u.y*0.5+0.5)` for alpha). No canvas anywhere in the stacked-alpha path. | Same `SecurityError` from `gl.texSubImage2D` — proved the bug is NOT canvas-tainting; the video itself is being treated as cross-origin even for WebGL pixel-extraction. |
| #10 | May 14 ~9:15am | Added `video.crossOrigin = 'anonymous'` to all 5 video-element creation sites. Theory: explicitly opt into CORS-checked code path. | Same `SecurityError`. WKWebView ignores `crossOrigin` for blob URLs. Conclusion: the bug is at a deeper layer than blob URL CORS attributes. |
| #11 | May 14 ~9:30am | **The actual fix.** Asked user to drop a regular MP4 in the same DMG — it rendered fine. Confirmed: regular MP4 works, stacked-alpha WebM doesn't. Conclusion: **VP9 codec specifically is what production WKWebView refuses pixel-extraction from.** Changed ffmpeg sidecar args from `libvpx-vp9 → .webm` to `libx264 → .mp4`. Stacked-alpha trick is codec-agnostic. | ✅ **WORKS.** User confirmed transparent bunny renders over the visualizer. |
| #12 | May 14 ~9:45am | Cleanup-only: removed the now-unneeded 500 ms diagnostic strip in `_loadVideoTexture`. Removed dead `compositeBuf` variable. Updated stale comments. Kept all defensive infrastructure (red banners, render-loop try/catches, global error handlers, play-rejection toasts, metadata timeout). | Same as #11 — feature still works. Code is clean. |
| #13 | May 14 ~10:05am | **REGRESSION FIX — broke web transparency on preset save/reload.** User reported: web upload of transparent WebM renders fine, but after Save preset → Open preset the transparency was GONE. Root cause: `video.crossOrigin = 'anonymous'` (added speculatively in DMG #10 as a Hail-Mary against the prod WKWebView bug, never reverted after DMG #11's H.264 fix made it unnecessary). For blob URLs in Chrome, setting `crossOrigin = 'anonymous'` is implementation-defined and can flip the canvas to "tainted" mode even though the underlying blob is same-origin — silently kills `getImageData` for alpha. Fresh upload still worked because of some load-order/cache quirk; preset-reload (blob fetched from IndexedDB) consistently tainted. Removed `crossOrigin` from all 5 video-element creation sites. The H.264 codec fix from DMG #11 is what actually solves the prod WKWebView issue; `crossOrigin` was speculative dead code that broke web. | Web save+reload transparency restored. Mac app save+reload still works. |
| #14 | May 14 afternoon | **Cross-platform regression fix + diagnostic polish.** Two changes shipped together: (1) `_solidColor` (instance var on `EditorInspector`, drives whether the comp shader uses solid-color formula or `sampler_main`) was never persisted in saved presets — every solid-color preset (default Shift variation) reloaded with a black background on web, Windows, AND macOS. Fixed by adding `solidColor: this._solidColor` to `saveCurrent` and restoring it in `loadPresetData`. Export/import rides along automatically (both functions just spread all fields). Pre-fix presets need a one-time resave to acquire the field. PERSISTENCE BOUNDARY comments added at both functions to prevent the next instance-var omission. (2) Streak-based video-tick banner: the `TICK ERROR: SecurityError…` red banner now only fires after 3 consecutive failed frames on the same layer; a successful frame resets the counter. Transient one-frame hiccups at video startup stay silent. Memory: `project_solidcolor_persistence.md`, `feedback_ask_for_artifact.md`. | Both fixes confirmed by user on localhost + Coolify production. Transparent video import/save/reload/export/import all clean. Image presets clean. Banner no longer false-fires on import. |
| #15 | May 14 evening | **Closed the import-boundary hole for cross-platform transparent video.** Symptom: a preset exported from web (which stores transparent video as raw VP9-alpha WebM) reimported on macOS gave the `TICK ERROR: SecurityError` banner because WKWebView strips VP9 alpha and refuses pixel-extraction. The upload-time `_handleWebmAlphaUpload` had been doing the right conversion since DMG #11 — but `importPreset` in `src/customPresets.js` was writing the imported WebM blob directly to IndexedDB with no conversion. Fix: at import time, when `isMacTauri && img.type === 'video' && blob.type === 'video/webm'`, invoke the existing `convert_to_stacked_alpha_b64` Tauri command (the same proven sidecar used at upload). Replace the blob with the resulting H.264 MP4. Patch the entry: `fileName` → `.mp4`, `isStackedAlpha: true`, `alphaMode: 'preserve'`. Web and Windows imports skip the block entirely (no `window.__TAURI__` or wrong UA). If the sidecar invoke throws, fall back to the original WebM — no worse than before. Also covers Windows-build CI failure caused by `externalBin: ["binaries/ffmpeg"]` in base `tauri.conf.json`: moved that line plus the matching `shell.scope` entry into a new `src-tauri/tauri.macos.conf.json` so Tauri v1.5 auto-merges it on macOS only. | Confirmed by user: web export → macOS DMG import → transparent layer renders correctly, no banner. Save/reload, export/import, and round-trip in any direction all clean. Windows build green again. |

---

## 🛡️ Defensive infrastructure left in the codebase (do NOT remove — these are load-bearing)

These were added during diagnosis. They've already saved us once (DMG #5 surfaced the SecurityError) and they protect the render loop against any future per-frame throw.

- **Render loop in `src/visualizer.js:610-680`** wraps `_tickGifAnimations()`, `_tickVideoAnimations()`, and `this.visualizer.render()` each in its own try/catch. One bad frame can no longer kill Butterchurn's draw.
- **`_showRenderError(msg)` helper in `src/visualizer.js`** posts a red banner at the top of the screen for 15s naming what threw + the source name.
- **Stacked-alpha branch inside `_tickVideoAnimations`** has its own try/catch — on error, the layer skips frame upload, banner names the error, other layers + Butterchurn keep rendering.
- **`Inspector` constructor** installs global `window.addEventListener('error')` + `'unhandledrejection'` listeners; any uncaught JS becomes a red toast.
- **`_addVideoLayer`** has a 10s timeout around `onloadedmetadata` — silent metadata hangs now show a clear error toast.
- **`_handleWebmAlphaUpload`** retains the "Loading layer (X.XMB)…" toast as a visible signal that we got bytes back from Rust and are about to add the layer.
- **`alphaMode` default for stacked-alpha video entries** is `'preserve'` (not `'fade'`). `'fade'` would silently destroy the alpha channel via the GLSL `_t.w * _gapMask * …` line at `inspector.js:5816`.
- **`loadPresetData`** propagates `isStackedAlpha` from saved entries through to `texObj`, so reloaded stacked-alpha videos take the correct composite path in the visualizer.

### The chain of facts (verified tonight)

| ✓ | What we proved | How |
|---|---|---|
| ✅ | Source code is correct | `grep` confirmed in `src/` and `dist/` and the installed binary |
| ✅ | DMG #4 (22:00 build) IS installed in `/Applications` | `ls -la` confirmed timestamps + 45 MB ffmpeg binary present |
| ✅ | ffmpeg sidecar runs in production | conversion completes, progress toast updates `Converting… Ns` correctly |
| ✅ | `_handleWebmAlphaUpload` completes successfully | user reported the final `Layer added!` toast appears |
| ✅ | `_addVideoLayer` completes — including `onloadedmetadata` | 10s metadata timeout never fired |
| ❌ | After that, the Preset Studio "freezes" | sliders + palette stop having visual effect |

### Why the controls feel broken (the smoking gun)

The render loop at `src/visualizer.js:610-626` is unguarded:

```js
this._tickGifAnimations();
this._tickVideoAnimations();   // ← if THIS throws even once
this.visualizer.render();       // ← never runs
this.animFrameId = requestAnimationFrame(render);  // ← never runs — LOOP DIES PERMANENTLY
```

A single uncaught throw in the per-frame video tick kills Butterchurn's draw loop forever. From the user's perspective: sliders still emit events and state still mutates, but the canvas never repaints again — looks identical to "controls do nothing."

### Most-likely throw site

`_tickVideoAnimations` stacked-alpha branch calls `uploadCtx.getImageData(...)` after drawing a video to canvas. In production WKWebView (under hardened runtime + `tauri://localhost` origin) this can throw `SecurityError` if the canvas becomes tainted by the blob URL — even though the same blob URL works fine in dev mode. The error propagates out, killing the loop on the first frame after the layer is added.

### Fixes shipped in DMG #5 (22:03 build, user about to test)

1. **Render-loop hardening:** wrapped `_tickGifAnimations()`, `_tickVideoAnimations()`, and `this.visualizer.render()` each in its own try/catch in `src/visualizer.js`. One bad frame can no longer kill the loop.
2. **Visible diagnostics:** on first throw from any of those three calls, the visualizer shows a red banner at the top of the screen with the actual error name + message (15 s display). Production now reveals its own errors without devtools.
3. **Global error trap in inspector:** `window.addEventListener('error')` + `unhandledrejection` listeners in the `Inspector` constructor surface any uncaught JS error as a red toast.
4. **Stacked-alpha branch try/catch in `_tickVideoAnimations`:** if `getImageData` (or anything else) throws specifically for the stacked layer, that one layer pauses uploads and a red banner names the error — Butterchurn and other layers keep rendering.
5. **alphaMode default fix:** stacked-alpha entries now default to `alphaMode: 'preserve'` (was `'fade'`, which silently destroys the alpha channel even when the texture is correct). This may turn out to have been the actual rendering bug too — pending test.

---

## 🧱 What is in the code right now (file-by-file inventory, accurate as of DMG #14 / May 14 afternoon)

> ⚠️ The inventory text immediately below describes the **DMG #7 intermediate state**, kept for the post-mortem narrative. **It does NOT describe the current shipping code.** For the current final state, jump to "Final shipping state (post DMG #14)" further down. The DMG #14 row of the chronological log above is the source of truth.

**`src-tauri/binaries/ffmpeg-aarch64-apple-darwin`** (45 MB)
- Static ffmpeg 6.0 arm64 binary, eugeneware/ffmpeg-static b6.1.1. Includes libvpx-vp9.

**`src-tauri/binaries/ffmpeg-x86_64-apple-darwin`** (79 MB)
- Same for Intel Mac support.

**`src-tauri/Cargo.toml`** — tauri features now include `"shell-sidecar"` AND `"protocol-asset"`.

**`src-tauri/tauri.conf.json`**:
- `shell.sidecar: true` with scope `binaries/ffmpeg` (args: true)
- `bundle.externalBin: ["binaries/ffmpeg"]`
- **NEW tonight:** `protocol.asset: true` with `assetScope: ["$TEMP/*", "/var/folders/**", "/tmp/**"]`
- **NEW tonight:** `connect-src` in CSP extended to include `asset:` and `https://asset.localhost`

**`src-tauri/src/main.rs`**:
- `convert_to_stacked_alpha(window, input_path)` — spawns ffmpeg sidecar, runs the stacked-alpha filter graph, emits `webm-convert-progress` Tauri window events (parsed from ffmpeg `-stats` stderr).
- **CHANGED tonight:** Returns the OUTPUT FILE PATH (String) instead of base64-encoded bytes. The file is kept on disk in `$TMPDIR/stacked_<timestamp>.webm` for JS to fetch via asset:// protocol.
- `convert_to_stacked_alpha_b64(window, input_b64)` — wraps the above; accepts base64 input, writes temp file, calls main function, returns the output path string.
- Helper `parse_ffmpeg_time(line)` — parses `time=HH:MM:SS.ms` from ffmpeg stats lines into seconds f64.

**`src/editor/inspector.js`** — `_handleWebmAlphaUpload(file)`:
- Shows live "Converting… Ns" toast, updated every ffmpeg progress event via `window.__TAURI__.event.listen('webm-convert-progress', ...)` — **confirmed working in production**
- **CHANGED tonight:** No more 4 MB base64 over IPC. After `invoke` returns the path, builds `asset://localhost/<encoded-path>` URL, calls `fetch()`, reads `.blob()`, constructs `File`, then passes to `_addVideoLayer(file, { isStackedAlpha: true })`.
- `unlisten` cleanup in `finally` block.
- Three upload gates (Tauri picker, drop, file input): `isMacTauri && isWebM` routes here; all other platforms use `_addVideoLayer` unchanged.

**`src/editor/inspector.js`** — `_addVideoLayer(file, opts)`:
- **CHANGED tonight:** 10-second timeout on the `onloadedmetadata` wait. If metadata never loads, rejects with `'video metadata never loaded (10s timeout)'`. The timer never fired in user testing, confirming metadata loads fine.
- **CHANGED tonight (DMG #5):** stacked-alpha entries now default to `alphaMode: 'preserve'` (was always `'fade'` — fade silently destroys the alpha channel via the GLSL `_t.w * _gapMask * …` line at inspector.js:5816).

**`src/editor/inspector.js`** — `Inspector` constructor:
- **NEW tonight:** installs global `window.addEventListener('error')` and `unhandledrejection` listeners that surface uncaught JS errors as red toasts. Production no longer fails silently.

**`src/visualizer.js`** — `_tickVideoAnimations`:
- `_loadVideoTexture` allocates 2× tall canvas for stacked-alpha videos; pre-allocates `compositeBuf`.
- Stacked-alpha branch: draws full 2× tall frame → reads top half (RGB) + bottom half (alpha luma) → composites into `compositeBuf` → uploads to GL texture.
- **NEW tonight (DMG #5):** the stacked-alpha branch is wrapped in its own try/catch — on error, the offending layer is silently skipped and a red banner shows the error name + message.

**`src/visualizer.js`** — render loop (lines ~610-665):
- **NEW tonight (DMG #5):** `_tickGifAnimations()`, `_tickVideoAnimations()`, and `this.visualizer.render()` are each wrapped in try/catch. If any throws, an error is logged + a red banner shows what threw + the loop continues. Single-frame failures can no longer kill Butterchurn's render loop.
- **NEW tonight (DMG #5):** `_showRenderError(msg)` helper renders the red banner at the top of the screen for 15 seconds.

### ffmpeg command (validated, in production)
```bash
ffmpeg -y -hide_banner -loglevel error -stats \
  -c:v libvpx-vp9 -i input.webm \
  -filter_complex "[0:v]format=yuva420p,split=2[a][b];[a]alphaextract,format=gray[alpha];[b]format=yuv420p[rgb];[rgb][alpha]vstack[stacked]" \
  -map "[stacked]" -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 2M -an output_stacked.webm
```

### Confirmed working
- Input: `bunny.webm` (5.4 MB transparent VP9-alpha source)
- Output: 3.3 MB, 1280×1440, VP9 yuv420p, 24 fps
- Layer renders with full transparency over MilkDrop visualizer — user confirmed "it works!!!!!"

### Gotchas hit during the build
1. **`<a download>` blocked in WKWebView.** Blob downloads silently fail. Workaround: debug copy written to `$TMPDIR/discocast_last_stacked.webm`.
2. **`/tmp/` ≠ `std::env::temp_dir()` on macOS.** Rust resolves to `/var/folders/<hash>/T/`. Trust the log, not assumptions.
3. **ffmpeg `-stats` requires explicit flag.** With `-loglevel error`, stats are suppressed unless you add `-stats`. ffmpeg prints stats via `fprintf(stderr)` directly (not `av_log`), so `-stats` overrides loglevel suppression.
4. **Progress events: parse `time=` not `frame=`.** Stats lines emit `time=HH:MM:SS.ms` reliably; frame count requires knowing total frames up front.

---

## 🧱 Final shipping state (post DMG #14)

> Source of truth for what the codebase contains right now. Verified May 14 2026 afternoon. Pairs with the row for DMG #14 in the chronological log above.

### Files & responsibilities

| File | Final state |
|---|---|
| `src-tauri/Cargo.toml` | Tauri features include `shell-sidecar` and `protocol-asset` |
| `src-tauri/tauri.conf.json` | Cross-platform base. `shell.sidecar: true`, `shell.scope: []` (Mac-specific entries moved out). `protocol.asset: true` with `assetScope: ["$TEMP/*", "/var/folders/**", "/tmp/**"]`. CSP extended with `asset:` and `https://asset.localhost`. **No `externalBin` here** — would break the Windows build. |
| `src-tauri/tauri.macos.conf.json` | macOS-only overrides auto-merged by Tauri v1.5 on macOS builds. Contains `bundle.externalBin: ["binaries/ffmpeg"]` and the `shell.scope` entry pointing at the ffmpeg sidecar. **Do not move these into the base config — Windows will fail to build looking for `ffmpeg-x86_64-pc-windows-msvc.exe`.** |
| `src-tauri/binaries/ffmpeg-aarch64-apple-darwin` | 45 MB static ffmpeg 6.0 arm64 (eugeneware/ffmpeg-static b6.1.1, includes libvpx-vp9 + libx264) |
| `src-tauri/binaries/ffmpeg-x86_64-apple-darwin` | 79 MB static ffmpeg 6.0 x86_64 |
| `src-tauri/src/main.rs` | `convert_to_stacked_alpha(window, input_path)` runs the stacked filter graph and encodes **H.264 libx264 → `.mp4`** at `$TMPDIR/stacked_<timestamp>.mp4`. `convert_to_stacked_alpha_b64(window, input_b64)` wraps it for base64 IPC. `parse_ffmpeg_time(line)` extracts progress from ffmpeg `-stats` stderr; emits `webm-convert-progress` window events. |
| `src/editor/inspector.js` `_handleWebmAlphaUpload(file)` | macOS+WebM upload path. Live `Converting transparent video… Ns` toast. After invoke returns, builds `mp4Name = file.name.replace(/\.webm$/i, '.mp4')` + `File([outBytes], mp4Name, { type: 'video/mp4' })` and calls `_addVideoLayer(stackedFile, { isStackedAlpha: true })`. Three upload gates (Tauri picker, drop, file input) all route here on `isMacTauri && isWebM`; everything else falls through to `_addVideoLayer(file)` unchanged. |
| `src/editor/inspector.js` `_addVideoLayer(file, opts)` | `isStackedAlpha = !!opts.isStackedAlpha` controls texH (`/2` for stacked) and `alphaMode` (`'preserve'` for stacked, `'fade'` otherwise). 10-second metadata timeout. Entry + texObj carry `isStackedAlpha` through. |
| `src/customPresets.js` `importPreset` | **Mirror of `_handleWebmAlphaUpload` at the import boundary.** On macOS Tauri, video layers with `blob.type === 'video/webm'` get transcoded through `convert_to_stacked_alpha_b64` before being stored. The entry is patched (`fileName` → `.mp4`, `isStackedAlpha: true`, `alphaMode: 'preserve'`). Web and Windows skip the block (no `window.__TAURI__` or wrong UA → block falls through). Failure falls back to the original WebM. Closes the web-export-to-macOS-import path. |
| `src/editor/inspector.js` `_buildCompShader` | For non-stacked image/video layers the sampleLine is unchanged (`vec4 _t = texture(${tex}, _u)`). For stacked-alpha layers it samples top half for RGB + bottom-half R for alpha. Uses `this._solidColor` to decide solid-color vs `sampler_main` base — that var is now persisted (see PERSISTENCE BOUNDARY comments). |
| `src/editor/inspector.js` `saveCurrent` / `loadPresetData` | **PERSISTENCE BOUNDARY** comment blocks. `saveCurrent` writes `solidColor: this._solidColor`; `loadPresetData` restores it. Stacked-alpha video entries restore `isStackedAlpha` flag and the halved texH. |
| `src/visualizer.js` `_loadVideoTexture` | Allocates a **2× tall texture** for stacked-alpha (skips the 2D canvas entirely — video uploads direct via `gl.texSubImage2D(videoElement)`). Non-stacked path unchanged (drawImage → getImageData → texSubImage2D). |
| `src/visualizer.js` `_tickVideoAnimations` | Per-layer try/catch with **streak counter**: banner fires only after 3 consecutive failed frames, success resets the streak. Stacked-alpha branch uploads video element directly; non-stacked branch is unchanged from May 12. |
| `src/visualizer.js` render loop | NO outer try/catches — removed May 14. A real exception in `visualizer.render()` now propagates (good — surfaces real bugs). The per-layer try/catch in `_tickVideoAnimations` is the load-bearing safety net. |

### Cargo features clarification

`protocol-asset` was added during DMG #3 to support an `asset://` fetch path that was later abandoned (DMG #7 switched back to base64 IPC). The feature is still enabled in `Cargo.toml` and `tauri.conf.json` — it's not used by the current code but kept available for future features that need `asset://` URLs. No harm in removing it if a future cleanup pass wants to tighten the surface.

### Memory entries (load-bearing, read before re-debugging)

- `project_transparent_webm_macos_plan.md` — overall architecture, do-not-touch list
- `project_webm_alpha_dead_ends.md` — what NOT to try (FFmpeg.wasm bug #621, ogv.js issue #590, HEVC alpha .mov)
- `project_solidcolor_persistence.md` — the May 14 black-bg-on-reload root cause and audit of other at-risk instance vars
- `feedback_verify_before_coding.md` — require empirical evidence before touching code
- `feedback_ask_for_artifact.md` — when the user is in panic, ask for the smallest artifact FIRST (the lesson from this 2-day session)

### Cross-doc references

- macOS-specific lessons live in [`video-dev.md` §14 (macOS WKWebView Notes)](video-dev.md), especially **§14.10 VP9 cross-origin tainting** — the single most important macOS Tauri video gotcha.
- The pipeline diagram + Sammie Roto workflow context is in [`video-dev.md` §27](video-dev.md).

---

## 🗂️ Original handoff doc (May 13 morning — Safari standalone validation)

> This section is the morning-of-May-13 notes from when the stacked-alpha approach was first validated standalone in Safari, BEFORE any in-app integration. Kept as historical context. The current state of the in-app implementation is in the sections ABOVE this one. The phased plan referenced below was largely executed during the 12-hour session — see the chronological DMG log at the top.

### ✅ Validation outcome (May 13 morning, standalone Safari test)

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
- Working tree: **clean** — only the doc files (`apng-dev.md`, `video-dev.md`) modified vs. HEAD
- DMG in `promo/DiscoCast-Visualizer.dmg` is the May 12 build, working
- App is fully functional. Transparent WebM works on Web + Windows. macOS shows the bunny opaque (no alpha) — same starting point as before this session.

### Failed integration attempt — May 13 (rolled back)

I attempted to integrate the validated stacked-alpha solution into the live app in one large pass. It broke the macOS app — Preset Studio controls stopped responding after dropping a WebM. Code reverted via `git restore`. Docs preserved.

**Files I touched (all reverted):**
- `src-tauri/src/main.rs` — added `convert_to_stacked_alpha` Tauri command
- `src/editor/inspector.js` — added `_handleWebmAlphaUpload` method + 3 upload-path gates
- `src/visualizer.js` — added `_loadStackedAlphaVideo` + branched `_tickVideoAnimations`

**What went wrong:** built too much at once (Rust + JS handler + 3 gates + visualizer loader + tick branch) with no incremental validation between pieces. When `_mountLayerCard` rejected the new entry shape (suspected — never confirmed because debugging was blocked by the broken app state), the failure cascaded and locked up the editor UI.

**Lesson for the next attempt:** build in 4 smaller, individually-testable steps:
1. **Step 1 — Rust command alone.** Add `convert_to_stacked_alpha`. Test by invoking it from the JS console with a small WebM, confirm a base64 string comes back, decode it manually, verify it plays in QuickTime. No JS handler yet, no upload routing.
2. **Step 2 — JS handler stores blobs only.** Add `_handleWebmAlphaUpload`. Calls Rust command, stores both source + stacked blobs in IndexedDB. No layer creation yet. Verify via dev tools that the stacked blob exists and is correct.
3. **Step 3 — Visualizer loader in isolation.** Add `_loadStackedAlphaVideo` + tick branch. Test by manually invoking with a pre-made stacked WebM. Confirm transparency renders. No upload flow yet.
4. **Step 4 — Wire them together.** Connect upload → conversion → layer creation. Each prior step has already been validated, so any failure here is isolated to the wiring.

After each step, build a fresh DMG and test before moving to the next. Roll back immediately if anything breaks.

### Critical: incremental builds and tests

Use `npm run tauri-dev` for iteration. It IS macOS Tauri (same WKWebView), just with hot reload — *not* a browser. Build a fresh DMG via `./build-and-sign.sh` only for the final confirmation test. Don't try to validate everything from a single DMG build — the iteration cost is too high.

### Critical: macOS-only gate
Every change must be gated by:
```javascript
const isMacTauri = !!window.__TAURI__ && navigator.userAgent.includes('Mac');
```
**Web + Windows must continue to use the existing `_addVideoLayer()` path unchanged.** That path already works for transparent WebM on those platforms (shipped May 12 at `eaf5a5c`).

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

### Implementation plan — see "Phased Implementation Plan (Incremental, Validated)" further down

After the failed monolithic integration on May 13, the build plan is restructured into 6 small steps with a build-and-test cycle between each. See the section below for details. The validated shader and ffmpeg command are in this doc; the working test harness is at `~/Desktop/hevc-alpha-test/test-stacked.html`.

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

## ✅ Validated Solution — Stacked Alpha

**Concept (Jake Archibald, 2024):** encode the alpha as a regular grayscale image stacked underneath the color frame, producing a single regular VP9 video at 2× the height. No alpha track. No special codec features. Just regular VP9 that WKWebView decodes natively.

**Validated empirically in Safari/WKWebView on May 13, 2026** (Safari 26.4, M1 Mac, macOS 26.4.1):
- ✅ ffmpeg produces a 3.3MB stacked WebM (smaller than the 5.4MB source)
- ✅ Safari `<video>` element loads and plays the 1280×1440 file
- ✅ WebGL canvas composites top half RGB + bottom half luma → transparent output, candy-stripe background visible through transparent areas

Test harness preserved at `~/Desktop/hevc-alpha-test/test-stacked.html`. To re-validate: `open -a Safari ~/Desktop/hevc-alpha-test/test-stacked.html`.

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

### Why this works where the other approaches didn't

| Requirement | Stacked Alpha |
|---|---|
| WKWebView plays the video | ✅ It's regular VP9 with no alpha stream — no special decoder features needed |
| WebKit `<video>` element loads it | ✅ Standard WebM, same as any other VP9 video |
| Canvas / WebGL pipeline gets pixel data | ✅ Standard `drawImage(video)` → `getImageData` works |
| Alpha is recoverable in our pipeline | ✅ Sample top half for RGB, bottom half luma as alpha — composite in WebGL shader |
| File size | ✅ Similar to source WebM (3.3MB vs 5.4MB source — actually smaller) |
| Conversion needs native ffmpeg | ⚠️ Yes — still needs VP9-alpha decode which FFmpeg.wasm can't do. Tauri sidecar required. |

### The encoder command (working, validated)

```bash
ffmpeg -c:v libvpx-vp9 -i input.webm \
  -filter_complex "[0:v]format=yuva420p,split=2[a][b];[a]alphaextract,format=gray[alpha];[b]format=yuv420p[rgb];[rgb][alpha]vstack[stacked]" \
  -map "[stacked]" \
  -c:v libvpx-vp9 -pix_fmt yuv420p \
  -b:v 2M \
  -an \
  output_stacked.webm
```

### The WebGL composite shader (working, validated)

```glsl
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  // Top half: RGB. Bottom half: alpha as luma.
  vec2 rgbUV = vec2(v_uv.x, v_uv.y * 0.5);
  vec2 aUV   = vec2(v_uv.x, v_uv.y * 0.5 + 0.5);
  vec3 rgb = texture2D(u_tex, rgbUV).rgb;
  float a  = texture2D(u_tex, aUV).r;
  gl_FragColor = vec4(rgb, a);
}
```

---

## Implementation Architecture (Next Attempt)

```
WebM dropped on macOS Tauri
  ↓
_handleWebmAlphaUpload(file)   [macOS Tauri only — gated]
  ↓
Show conversion modal (file info, Go/Cancel, music auto-pauses on Go)
  ↓
Tauri invoke → ffmpeg sidecar → stacked-alpha encode (~15s for 720p/5s clip)
  ↓
Receive stacked WebM bytes
  ↓
Store BOTH blobs in IndexedDB:
  - videoId         → original WebM (portable; for export + cache-miss recovery)
  - videoId+_stk    → stacked variant (what plays on macOS)
  ↓
Build layer entry with type='video', isStackedAlpha=true
  ↓
<video> element plays the stacked WebM as regular VP9
  ↓
_tickVideoAnimations() reads full tall frame → composites top+bottom → texSubImage2D
  ↓
Layer renders with transparency ✓
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

## Open Questions / Tradeoffs

### Q1: Universal binary or arm64-only?

Apple Silicon binary (~15MB stripped) vs. universal arm64+x86_64 (~30MB).
- Apple Silicon only: smaller, but breaks Intel Macs
- Universal: doubles binary size but covers all Macs since Catalina

**Recommendation:** universal binary. Intel Macs are still common.

### Q2: Convert all WebM on macOS, or only transparent ones?

We can't reliably probe for alpha from JS in WKWebView (the alpha stream is stripped before JS sees it). So either:
- **Convert all WebM unconditionally on macOS** — wastes time on non-transparent WebM, but simple
- **Heuristic: filename / size / opt-in** — fragile

**Recommendation:** convert all WebM on macOS. VP9 encoding via libvpx is slower than HEVC hardware encoding (~1× real-time vs 5-10×), so this matters. May need to add a "skip conversion" toggle for users who know their WebM is opaque. Defer this decision until the basic flow works.

### Q3: Phase 1A dev approach — system ffmpeg or sidecar from day one?

The failed first attempt shelled out to `/opt/homebrew/bin/ffmpeg` (dev-only). This was fine for dev but creates an extra migration step before shipping. Alternative: bundle the sidecar binary from the start, develop directly against the production code path.

**Recommendation:** start with sidecar from day one. The bundling work is a few lines of Tauri config; doing it early avoids "works on dev, breaks in DMG" surprises later.

---

## Phased Implementation Plan (Incremental, Validated)

Each step is independently testable. Build a fresh DMG after each step. Roll back immediately if anything breaks.

### Step 1 — Rust command works in isolation
- Build/obtain stripped macOS universal ffmpeg binary (~30MB)
- Place at `src-tauri/binaries/ffmpeg-{aarch64,x86_64}-apple-darwin`
- Enable sidecar in `tauri.conf.json` + Cargo.toml feature
- Add `convert_to_stacked_alpha` Rust command invoking the sidecar
- **Test:** call from JS console in the running app with a small WebM (~1MB). Confirm base64 output comes back. Save to disk, open in QuickTime — should play as a tall video.

### Step 2 — JS handler stores blobs only
- Add `_handleWebmAlphaUpload` that calls the Rust command and stores both blobs in IndexedDB
- No layer creation yet, no visualizer hookup
- **Test:** drop a WebM, check IndexedDB for both `videoId` and `videoId+_stk` entries. Extract the stacked one, verify it plays in QuickTime.

### Step 3 — Visualizer loader in isolation
- Add `_loadStackedAlphaVideo` + tick branch in `_tickVideoAnimations`
- **Test:** manually invoke from JS console with a pre-converted stacked WebM (the validated `bunny_stacked.webm` works). Confirm transparency renders over the MilkDrop visualizer.

### Step 4 — Wire upload + visualizer together
- Add the 3 upload-path gates (Tauri picker, drop, file input) — macOS+WebM only
- Connect upload → conversion → blob storage → layer creation → visualizer load
- **Test:** drop a transparent WebM, see it render with transparency end-to-end.

### Step 5 — Conversion modal UI
- Replace the placeholder toast with the modal pattern (Go/Cancel, file info, progress bar, music auto-pause)

### Step 6 — Preset save/load support
- Add stacked-alpha branch in `loadPresetData`
- On macOS cache miss: reconvert from `sourceWebmId` original WebM via sidecar
- On Web/Windows import: load `sourceWebmId` via existing video pipeline (no conversion)

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
| **Native ffmpeg → stacked alpha VP9 WebM** | **✅ Validated in Safari standalone test (May 13)** | Plays as regular VP9 (no special decoder needed). Requires native ffmpeg sidecar for the input alpha decode. First in-app integration failed and was rolled back — next attempt is incremental. |
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
| May 13 | Stacked alpha approach selected | Plays as regular VP9 — no special decoder features needed |
| May 13 | Stacked alpha **validated** in Safari standalone test | All three checks passed: encoding, playback in WKWebView, WebGL composite with transparency |
| May 13 | First in-app integration attempt **failed and rolled back** | Built too much at once (Rust + JS handler + 3 gates + visualizer loader + tick branch) without incremental validation. The change broke the Preset Studio UI when a WebM was dropped. Reverted via `git restore` |
| May 13 | Switched to incremental build plan | 6 small steps, each independently testable, build-and-test cycle between each |
| May 13 | **Full integration shipped** | All steps complete in `npm run tauri-dev`. User confirmed transparent layer renders correctly over MilkDrop. |
| May 13 | Progress feedback added | ffmpeg `-stats` stderr parsed for `time=` lines; Rust emits `webm-convert-progress` Tauri events; JS toast updates with elapsed seconds. 20-30s conversion window now shows live progress. |

---

## User Education — What to Communicate

When a transparent WebM lands on macOS, the conversion modal should say (plainly):

> This video has transparency. macOS requires a one-time conversion so Apple's WebKit can play it correctly with alpha. The result is cached so this only happens once per clip. Music will pause during conversion to free up processing power.

**Don't apologize for it.** It's Apple's decision not to support VP9 alpha in WebKit. State the fact, do the conversion, move on. The internal format is stacked-alpha VP9 (not HEVC — see decision log) but that's plumbing the user never sees.

---

*Document originally created May 12 as `apng-dev.md`. Repurposed May 13 after APNG and ogv.js paths confirmed dead. Companion to `video-dev.md`.*
