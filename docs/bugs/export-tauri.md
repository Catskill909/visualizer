# Export Fix — Tauri macOS File Save

> **Status:** ✅ Fixed — Apr 2026. Kept for reference. Requires `./build-and-sign.sh` rebuild to ship in the macOS app.
> **Date:** Apr 2026.

---

## The Bug

In the macOS Tauri app, all JSON export buttons fire a toast ("Exported ✓") but no file appears in Downloads. The file is silently swallowed.

**Root cause:** Tauri's WKWebView intercepts `<a download>` clicks. Without `dialog.save` in the allowlist and a Rust-side file write command, the download never reaches the filesystem. The JS side completes normally (hence the toast), but the actual write never happens.

---

## All Affected Export Call Sites

Four independent code paths all use the same broken `<a download>` pattern:

| # | File | Function | Filename pattern | Triggered from |
|---|------|----------|-----------------|----------------|
| 1 | `src/editor/presetLibrary.js:371` | single preset export | `PresetName.json` | Preset Studio library — single export button |
| 2 | `src/editor/presetLibrary.js:388` | export all presets | `discocast-presets-YYYY-MM-DD.json` | Preset Studio library — Export All button |
| 3 | `src/controls.js:647` (`downloadJson`) | single preset export | `PresetName.preset.json` | Main app preset drawer — download icon per row |
| 4 | `src/controls.js:669` | backup all presets | `discocast-presets-YYYY-MM-DD.json` | Main app preset drawer — Backup button |
| 5 | `src/timeline/timelineEditor.js:1515` | timeline bundle export | `TimelineName.dcshow.json` | Timeline editor — Export button |

All five ultimately do the same thing:
```js
const url = URL.createObjectURL(blob);
Object.assign(document.createElement('a'), { href: url, download: filename }).click();
URL.revokeObjectURL(url);
```
or via the `downloadJson()` helper in `controls.js` which does the same.

---

## The Fix

### Step 1 — Add `dialog.save` to `tauri.conf.json`

```json
"dialog": {
    "open": true,
    "save": true
}
```

### Step 2 — Add a `save_file` Rust command to `src-tauri/src/main.rs`

```rust
#[tauri::command]
async fn save_file(filename: String, content: String) -> Result<Option<String>, String> {
    let (tx, mut rx) = channel::<Option<std::path::PathBuf>>(1);
    FileDialogBuilder::new()
        .set_title("Save File")
        .set_file_name(&filename)
        .save_file(move |path| {
            let _ = tx.blocking_send(path);
        });
    let path = match rx.recv().await.unwrap_or(None) {
        Some(p) => p,
        None => return Ok(None), // user cancelled
    };
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
```

Register it in `invoke_handler`:
```rust
.invoke_handler(tauri::generate_handler![
    caffeinate_start, caffeinate_stop,
    toggle_fullscreen, get_fullscreen,
    pick_audio_file,
    save_file   // ← add this
])
```

### Step 3 — Add a shared `downloadFile` helper in JS

Create or add to a shared util (e.g. inline in `customPresets.js` or a new `src/fileUtils.js`):

```js
/**
 * Save a string as a file. In the Tauri macOS app, uses the native save dialog.
 * In the browser, falls back to <a download>.
 */
export async function downloadFile(filename, content) {
    const isTauri = !!window.__TAURI__;
    if (isTauri) {
        try {
            await window.__TAURI__.invoke('save_file', { filename, content });
        } catch (e) {
            console.error('[downloadFile] Tauri save failed:', e);
        }
    } else {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        Object.assign(document.createElement('a'), { href: url, download: filename }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
```

**Why a string, not a blob?** Tauri's IPC serializes over JSON — passing a pre-built string is simplest. All five export paths already have the data as a JS object; `JSON.stringify(data, null, 2)` produces the string.

### Step 4 — Replace all five call sites

#### Site 1 & 2 — `src/editor/presetLibrary.js`

```js
// Site 1 — single preset
const content = JSON.stringify(data, null, 2);
await downloadFile(filename, content);
showToast(`Exported · ${data.name || id}`);

// Site 2 — export all
const content = JSON.stringify(data, null, 2);
await downloadFile(`discocast-presets-${new Date().toISOString().slice(0, 10)}.json`, content);
```

#### Site 3 & 4 — `src/controls.js`

Replace the `downloadJson(filename, data)` helper body:
```js
async downloadJson(filename, data) {
    await downloadFile(filename, JSON.stringify(data, null, 2));
}
```
Make it `async` and add the import. All callers (`exportAllCustomPresets`, `exportOnePreset`) already `await` or fire-and-forget — both are fine since the toast fires after.

#### Site 5 — `src/timeline/timelineEditor.js`

```js
const content = await exportTimelineBundle(this._tl); // already a string
await downloadFile(filename, content);
```

---

## What the user experience looks like after the fix

In the **macOS app**: clicking any export button opens a native macOS **Save As** sheet (the standard system dialog with folder picker and filename field). User picks location, clicks Save. File lands exactly where they chose.

In the **browser**: behaviour unchanged — `<a download>` fires, file goes to Downloads as before.

---

## Build requirement

After changing `main.rs` and `tauri.conf.json`, the fix requires a **full `./build-and-sign.sh` rebuild** — Tauri's Rust binary must be recompiled. A Vite-only hot reload is not sufficient.

---

## Scope of JS changes — minimal

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.json` | Add `"save": true` to dialog allowlist |
| `src-tauri/src/main.rs` | Add `save_file` command + register it |
| `src/fileUtils.js` (new, ~20 lines) | `downloadFile()` helper |
| `src/editor/presetLibrary.js` | 2 call sites — swap blob pattern for `downloadFile()` |
| `src/controls.js` | Replace `downloadJson()` body — 2 call sites covered automatically |
| `src/timeline/timelineEditor.js` | 1 call site — swap blob pattern for `downloadFile()` |

Total: ~6 files, ~30 lines changed. No architecture changes. No new dependencies.

---

## Open questions before coding

1. **Cancel behaviour** — if the user dismisses the native Save dialog, the toast should not fire. Currently the toast fires before the save completes. The fix: `await downloadFile(...)` and only show the toast if it resolves without returning `null` (user cancelled).
2. **Binary exports** — all current exports are JSON strings. If future exports are binary (e.g. image zip), the `content: String` IPC approach won't work — would need base64 encoding or a different Rust command. Fine to defer.
3. **`timelineEditor.js` content** — `exportTimelineBundle()` already returns a JSON string (not an object), so no `JSON.stringify` needed there. Double-check before coding.
