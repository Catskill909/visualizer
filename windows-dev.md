# Windows Build & Compatibility — Dev Reference

Status: ✅ Confirmed working — web (Chrome on Mac + Windows) + Windows `.exe` installer via GitHub Actions

---

## How to Build the Windows App

The Windows build runs on a GitHub-hosted Windows machine. No Windows PC required.

1. Go to **GitHub.com → Actions → Build Windows Installer**
2. Click **Run workflow → main → Run workflow**
3. Wait ~10–15 min (first run); ~5 min after Rust cache warms
4. Download `DiscoCast-Visualizer-Windows-Setup` artifact → unzip → run the `.exe`

Workflow file: `.github/workflows/build-windows.yml` — manual trigger only (`workflow_dispatch`), never runs automatically.

---

## Bugs Fixed During Windows Bringup

### 1. Missing `icon.ico` — Tauri build fail

**Error:** `` `icons/icon.ico` not found; required for generating a Windows Resource file during tauri-build ``

**Cause:** `tauri-build` requires a `.ico` file in the icon array when building on Windows. The existing icon set (`32x32.png`, `128x128.png`, `icon.icns`) had no `.ico`.

**Fix:**
- Added `icons/icon.ico` to the `icon` array in `src-tauri/tauri.conf.json`
- Added a CI step to generate it from `icons/128x128.png` using ImageMagick (pre-installed on `windows-latest` runners):
  ```yaml
  - name: Generate Windows icon (.ico)
    run: magick "src-tauri/icons/128x128.png" -define icon:auto-resize=256,128,64,48,32,16 "src-tauri/icons/icon.ico"
  ```

---

### 2. Presets silently failing — `unsafe-eval` blocked by CSP

**Error:** `EvalError: Evaluating a string as JavaScript violates CSP directive: script-src 'self'`

**Cause:** Butterchurn uses `new Function()` to compile MilkDrop preset equations (mathematical expressions stored as strings) into live JavaScript at runtime. The nginx CSP `script-src 'self'` blocked all dynamic code execution. Every preset load silently failed. Mac Chrome was lenient about this; Windows Chrome enforced it strictly.

**Fix:** Added `'unsafe-eval'` to `script-src` in `nginx.conf`:
```
script-src 'self' 'unsafe-eval';
```
Also added to the Tauri Windows CSP in `src-tauri/tauri.conf.json` under `tauri.security.csp`.

**Note:** `'unsafe-eval'` is required by Butterchurn and cannot be avoided without forking the library. It does not weaken security meaningfully here since all JS is already bundled from `'self'` — there is no user-supplied code path.

---

### 3. Audio file not playing — `crossOrigin = 'anonymous'` on blob URLs

**Error:** `NotSupportedError: Failed to load because no supported source was found`

**Cause:** In `src/visualizer.js`, `connectAudioFile()` set `crossOrigin = 'anonymous'` on the `<audio>` element before assigning the blob URL. For a blob URL created from a local file (`URL.createObjectURL(file)`), this tells the browser to treat the load as a cross-origin CORS request. Blob URLs are same-origin and don't return CORS headers. Mac Chrome ignored this mismatch; Windows Chrome (especially older versions) rejected the load entirely.

**Fix:** Removed the `crossOrigin` attribute from `connectAudioFile()` in `src/visualizer.js`. It is unnecessary for local file blob URLs — `crossOrigin` is only needed for actual cross-origin remote resources.

```js
// Before (broken on Windows Chrome)
this.audioElement = new Audio();
this.audioElement.crossOrigin = 'anonymous';
this.audioElement.src = URL.createObjectURL(file);

// After (fixed)
this.audioElement = new Audio();
this.audioElement.src = URL.createObjectURL(file);
```

---

### 4. Tauri Windows CSP — blob audio + unsafe-eval

**Cause:** Tauri v1 on Windows (WebView2) applies its own CSP. Without an explicit `security.csp` in `tauri.conf.json`, the default CSP blocks both `blob:` media URLs and `unsafe-eval`.

**Fix:** Added `tauri.security.csp` to `src-tauri/tauri.conf.json`:
```json
"security": {
  "csp": "default-src 'self' tauri: asset: https://asset.localhost; connect-src ipc: http://ipc.localhost; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: asset: https://asset.localhost; media-src 'self' blob: asset: https://asset.localhost"
}
```

---

## Files Changed for Windows Support

| File | Change |
|------|--------|
| `.github/workflows/build-windows.yml` | New — GitHub Actions manual build workflow |
| `src-tauri/tauri.conf.json` | Added `icon.ico` to icon array, `bundle.windows` WebView2 config, `security.csp` |
| `nginx.conf` | Added `'unsafe-eval'` to `script-src` |
| `src/visualizer.js` | Removed `crossOrigin = 'anonymous'` from `connectAudioFile()` |
