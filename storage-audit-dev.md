# Storage Audit & Hardening — Dev Doc

**Status:** ✅ All fixes shipped May 11, 2026. Requires `./build-and-sign.sh` to deploy Fix 3B to macOS app.

---

## 1. Storage Architecture Overview

Two mechanisms, strictly separated:

| Mechanism | What lives there | Keys |
|-----------|-----------------|------|
| **localStorage** | Preset metadata, timeline metadata, favorites, hidden list, output settings, auth flag, UI flags | See §2 |
| **IndexedDB** | All image / GIF / video blobs (raw `Blob` objects) | `discocast_images` DB, `images` object store |

The split is intentional: localStorage never holds blobs. The `images[]` array inside each preset record stores only `imageId` / `videoId` strings that point into IndexedDB. Blobs are stored and retrieved via `storeImage(imageId, blob)` / `getImage(imageId)` in `src/customPresets.js`.

---

## 2. Full localStorage Key Registry

| Key | File that owns it | Contents | Size risk |
|-----|------------------|----------|-----------|
| `discocast_custom_presets` | `src/customPresets.js` | JSON map `{ [id]: presetMeta }` — baseVals, GLSL strings, image layer configs (no blobs) | Medium — grows with preset count |
| `discocast_timelines` | `src/timelineStorage.js` | JSON map `{ [id]: timeline }` — entries, zones, markers; only preset name refs, no blobs | Low |
| `discocast_favorites` | `src/controls.js` | JSON array of preset name strings | Low |
| `discocast_hidden` | `src/controls.js` | JSON array of preset name strings | Low |
| `discocast_output` | `src/controls.js` | JSON object — resolution, aspect ratio, fill mode | Negligible |
| `discocast_auth_v1` | `src/auth-gate.js` | Single token string | Negligible |
| `discocast_onboarding_never` | `src/editor/inspector.js` | `'1'` flag | Negligible |
| `discocast_hint_slider_reset_seen` | `src/editor/inspector.js` | `'1'` flag | Negligible |
| `milkscreen_custom_presets` | `src/customPresets.js` | Legacy migration source — read once on first load, then written to new key | Negligible after migration |
| `milkscreen_favorites` | `src/controls.js` | Legacy migration source | Negligible after migration |
| `milkscreen_hidden` | `src/controls.js` | Legacy migration source | Negligible after migration |

**Hard ceiling: ~5MB total across all keys, per origin, on every platform.**

Typical preset metadata (5 image layers, full GLSL, all sliders) ≈ 2–5KB. You'd need ~1,000 such presets to approach the limit. Realistic pressure comes from: long text layer content, large GLSL shader strings, or many timeline entries.

---

## 3. IndexedDB Limits by Platform

| Platform | Runtime | Practical quota | Eviction risk |
|----------|---------|-----------------|---------------|
| Web (Chrome) | Chromium | ~60% of free disk; can grow with user grant | Low — only evicted under extreme storage pressure |
| Web (Firefox) | Gecko | ~50% of free disk | Low |
| Web (Safari) | WebKit | ~1GB default; grows with user grant via `navigator.storage.persist()` | Medium |
| **macOS app** | **WKWebView (WebKit)** | **~1GB** | **HIGH — silent eviction; `navigator.storage.persist()` unreliable in WKWebView** |
| **Windows app** | **WebView2 (Chromium)** | **~60% of free disk** | **Low — writes to app data folder; not evicted** |

### The macOS eviction problem

WKWebView treats IndexedDB as best-effort storage. The OS can silently clear it when the disk is under pressure. Unlike browser Safari, WKWebView doesn't reliably honor `navigator.storage.persist()`. Result: a user with a full SSD can lose all image/video blobs while preset metadata in localStorage remains intact — presets load but image layers show nothing, with no error message.

Windows (WebView2) does not have this problem.

---

## 4. Export / Import Size Reality

All blob data is base64-inlined into JSON on export. Base64 adds ~33% overhead.

| Asset type | Typical raw size | In exported JSON |
|------------|-----------------|-----------------|
| Single image layer (1024px) | ~300–800KB | ~400KB–1MB |
| Single image layer (2048px HD) | ~1–3MB | ~1.3–4MB |
| 5 image layers (1024px) | ~2–5MB | ~3–7MB |
| One 720p video (short loop) | ~5–30MB | ~7–40MB |
| Full preset library (many presets with images) | additive | can reach hundreds of MB |

Timeline `.dcshow.json` bundles embed all referenced custom presets with their images. A timeline referencing 10 presets each with one video layer could easily produce a 200–500MB file.

---

## 5. Risk Register

### Risk A — localStorage QuotaExceededError ✅ FIXED May 11, 2026

`saveCustomPreset()`, `saveTimeline()`, and `_startRename()` all call `localStorage.setItem()`. When the 5MB ceiling is hit, the browser throws `QuotaExceededError` synchronously. Before the fix, this propagated uncaught — the save silently failed with no user feedback.

**Fix shipped:** Three sites guarded (see §6 Fix 1). All surface a readable error toast to the user.

**Severity before fix:** Medium. **Now:** Handled.

---

### Risk B — WKWebView silent blob eviction on macOS ⚠️ PENDING

Described in §3. Image/video blobs in IndexedDB can vanish silently on macOS. The user opens the app, their custom presets are listed (localStorage intact), but all image layers are blank because `getImage()` returns `null` for every imageId. No error is shown anywhere.

**Fix pending:** Fix 3A (startup health check banner) and Fix 3B (Tauri native FS) — see §6.

**Severity:** High for macOS app users with large image libraries.

---

### Risk C — Export file size ✅ FIXED May 11, 2026

Large exports (video-heavy preset libraries, large timeline bundles) previously silently produced files that were hundreds of MB with no warning.

**Fix shipped:** Size check in `downloadFile()` — see §6 Fix 2.

**Severity before fix:** Low-medium. **Now:** Handled.

---

## 6. Fix Implementations

### Fix 1 — localStorage QuotaExceededError guard ✅ Shipped May 11, 2026

**Files changed:** `src/customPresets.js`, `src/timelineStorage.js`, `src/editor/presetLibrary.js`

**Three write sites guarded:**

**`saveCustomPreset()` — `src/customPresets.js:53`**
```js
try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
} catch (e) {
    if (e.name === 'QuotaExceededError') {
        throw new Error('Storage full — export your presets to free space, then delete some.');
    }
    throw e;
}
```
Error surfaces via existing `catch(err) { showToast('Save failed: ' + err.message, true) }` in `editor/main.js` `doSave()` and `saveOverwrite()` — no additional wiring needed.

**`saveTimeline()` — `src/timelineStorage.js:54`**
Same pattern, message reads: `'Storage full — export your timelines to free space, then delete some.'`

**`_startRename()` commit — `src/editor/presetLibrary.js:313`**
This was a direct `localStorage.setItem` call that bypassed `saveCustomPreset` entirely. Wrapped with try/catch that calls `showToast` directly and returns early (skips the re-render, which is correct — the rename was never written).

**Intentionally left unguarded:** `deleteCustomPreset()`, `deleteTimeline()`, `pruneEmptyUntitled()` — all write smaller JSON than what they read; cannot trigger quota.

---

### Fix 2 — Export size warning ✅ Shipped May 11, 2026

**File changed:** `src/fileUtils.js` only

The check lives in `downloadFile()` — one location that all three export paths flow through (single preset, all presets, timeline bundle):

```js
const mb = content.length / 1_048_576;
if (mb > 50 && !confirm(`This export is ~${mb.toFixed(0)} MB — continue?`)) {
    return false;
}
```

**Why `fileUtils.js` not the callers:** All exports route through `downloadFile()`. A single guard here covers every present and future export without needing to add checks to each caller.

**Why `content.length` as proxy for MB:** JSON is ASCII-dominant; `charCodeAt` values are almost always < 128 so string length ≈ byte count. Slightly conservative for any multi-byte characters in preset names, which is fine — better to occasionally warn 1–2MB early than never warn.

**Threshold 50MB:** Large enough that normal use (a few image-layer presets) never triggers it. Small enough to catch video-heavy exports before they silently write a 300MB file.

**Returns `false` on cancel** — same as Tauri user-cancelled, all callers already treat this as a silent no-op.

---

### Fix 3A — macOS blob eviction: startup health check 📋 Pending

**Effort:** 2–4 hrs | **Files:** `src/customPresets.js`, `src/editor/main.js`

On Preset Studio boot (when `window.__TAURI__`), after library initializes, run an async health check with a 2s delay:

1. Scan all custom presets for `imageId`/`videoId` values
2. Call `getImage()` on the first 3 found
3. If any return `null` — blobs have been evicted
4. Show a persistent dismissable banner (dynamically injected `<div>`, not a disappearing toast — user needs time to act)
5. Use localStorage flag `discocast_idb_health_warned` to suppress repeat warnings until the next eviction event (reset the flag when new blobs are successfully stored)

**New export needed in `src/customPresets.js`:** `checkBlobHealth()` — returns `{ healthy: boolean, missing: number }`.

---

### Fix 3B — Tauri native FS for blob storage ✅ Shipped May 11, 2026 (requires `./build-and-sign.sh` to deploy)

**Files changed:** `src-tauri/src/main.rs`, `src/customPresets.js`

**Rust — 3 new commands added to `main.rs`:**

- `store_blob(app, image_id, data, mime)` — decodes base64 `data`, writes raw bytes to `{app_data_dir}/images/{imageId}`, writes mime string to `{app_data_dir}/images/{imageId}.mime`. Creates `images/` dir if needed.
- `get_blob(app, image_id)` → `Option<BlobResult { data: base64, mime }>` — returns `None` if file doesn't exist; reads raw bytes, base64-encodes, reads mime sidecar.
- `delete_blob(app, image_id)` — deletes both `{imageId}` and `{imageId}.mime` if they exist; silent success if already gone.

All three registered in `tauri::generate_handler![]`. `BlobResult` struct added with `#[derive(serde::Serialize)]`. No `Cargo.toml` changes — `base64 = "0.21"` and `serde` with derive were already present.

**JS — `src/customPresets.js` refactored:**

The three public functions (`storeImage`, `getImage`, `deleteImage`) are now thin routers. The IDB logic was extracted into private `_storeImageIDB`, `_getImageIDB`, `_deleteImageIDB`. Three Tauri helpers were added: `_storeImageTauri`, `_getImageTauri`, `_deleteImageTauri`.

- `storeImage` → Tauri FS if `window.__TAURI__`, else IDB
- `getImage` → try Tauri FS first; if null, fall back to IDB (lazy migration: if found in IDB, copy to Tauri FS fire-and-forget, return blob). Self-extinguishing — once a blob is in Tauri FS the IDB fallback is never reached again.
- `deleteImage` → both Tauri FS and IDB (belt-and-suspenders — handles blobs in either location regardless of migration state)

**Base64 encoding is chunked** — 64KB chunks prevent call stack overflow on 50MB+ video blobs.

**No `tauri.conf.json` changes** — Rust `std::fs` bypasses the JS-side FS allowlist entirely.

**Applies to both macOS and Windows** — `window.__TAURI__` is true in both Tauri apps. Web is unchanged.

**Migration:** Lazy and automatic — no startup block, no migration function. Blobs move from IDB to Tauri FS the first time each preset is loaded after the update.

**To deploy:** Run `./build-and-sign.sh` for macOS. Trigger GitHub Actions for Windows.

---

---

## 8. Pre-existing Blob Cleanup Bugs

Discovered during Fix 3B audit. Both bugs exist before any Fix 3B work and are independent of it. Fix before implementing Fix 3B so the native FS path inherits correct deletion behavior.

### Bug 1 — videoId blobs never deleted on preset delete ✅ FIXED May 11, 2026

**File:** `src/controls.js:642`

Only `img.imageId` was checked. `img.videoId` was never passed to `deleteImage` — every video blob was permanently orphaned when a preset was deleted.

**Fix shipped:** `img.videoId || img.imageId` as the lookup key. A preset image entry has either `imageId` (image/GIF) or `videoId` (video), never both — the `||` handles both types correctly.

---

### Bug 2 — preset delete from Studio Library orphaned all blobs ✅ FIXED May 11, 2026

**File:** `src/editor/presetLibrary.js` — `_startDelete()` countdown handler

The Studio Library countdown delete called `deleteCustomPreset(id)` but never `deleteImage`. All blobs were orphaned. `deleteImage` was not imported.

**Fix shipped:**
1. Added `deleteImage` to the import from `../customPresets.js`
2. In the countdown handler, preset record is read *before* `deleteCustomPreset` (once metadata is gone the imageIds are unreachable), then fire-and-forget `deleteImage` for each `videoId`/`imageId`
3. Timer callback remains synchronous — cleanup is fire-and-forget `.catch(() => {})`

---

### Why blob storage is the right architecture (video)

The question of whether presets should store a file path reference instead of copying the video blob was evaluated. File paths were ruled out:

- **Web app cannot read arbitrary file paths** — browser security model
- **Paths break on file move/rename** — silent breakage, no recovery
- **Paths are useless across devices** — export/import and `.dcshow.json` timeline bundles require self-contained data
- **Blob inlining enables full portability** — export a preset on Mac, import on Windows, all layers work

The only downside to blobs is eviction on macOS (Fix 3B) and export file size (Fix 2, shipped). Both are addressed. Blob storage is the correct choice.

**Transcoding note:** 1080p/4K videos are auto-transcoded to 720p on upload. The stored blob is already 720p; the original file is not preserved. If lossless storage of originals is ever needed, a future "skip transcode" option would be the right mechanism — not a change to the storage architecture.

---

## 9. Fix Ship Status

| Fix | Status | Date | Notes |
|-----|--------|------|-------|
| Fix 1 — localStorage quota guard | ✅ Shipped | May 11, 2026 | 3 sites: `saveCustomPreset`, `saveTimeline`, `_startRename` |
| Fix 2 — Export size warning | ✅ Shipped | May 11, 2026 | Lives in `fileUtils.js:downloadFile()`, 50MB threshold |
| Bug 1 — videoId never deleted | ✅ Shipped | May 11, 2026 | `controls.js:642` — `img.videoId \|\| img.imageId` |
| Bug 2 — Studio Library delete orphans blobs | ✅ Shipped | May 11, 2026 | `presetLibrary.js` — added `deleteImage` import + capture record before delete |
| Fix 3A — Health check banner | ⏭️ Skipped | — | Superseded by Fix 3B; not worth building if 3B ships soon |
| Fix 3B — Tauri native FS | ✅ Shipped | May 11, 2026 | `main.rs` + `customPresets.js`; lazy IDB migration built-in; run `./build-and-sign.sh` to deploy |

---

## 10. What's Not a Risk (confirmed safe)

- **Timeline storage:** no blobs, only preset name strings — localStorage only, small and safe
- **Favorites / hidden lists:** plain arrays of preset name strings — very small
- **Windows app:** WebView2 storage is reliable, no eviction risk
- **Web deployment:** browsers don't silently evict IndexedDB without user action or extreme disk pressure; `navigator.storage.persist()` works normally
