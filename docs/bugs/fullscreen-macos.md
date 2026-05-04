# Fullscreen macOS Tauri Bug

> **Status:** ✅ Fixed. Kept for reference.

## Bug Summary
The fullscreen button (`btn-fullscreen`, `F` key) in the **macOS Tauri app** does nothing.
- ✅ Works in web browser (Chrome/Firefox) — `document.fullscreenElement` / `requestFullscreen()` 
- ✅ macOS green traffic light button works — native OS window control, bypasses JS entirely
- ❌ In-app fullscreen icon/F key does nothing in the Tauri build

---

## App Context

| | Detail |
|---|---|
| **Framework** | Tauri v1.5 |
| **Frontend** | Vanilla JS (ES Modules), Vite 8 |
| **macOS runtime** | WKWebView |
| **Entry** | `src/controls.js` → `toggleFullscreen()` |
| **Rust** | `src-tauri/src/main.rs` |

---

## Attempts & Failures

### Attempt 1 — Browser Fullscreen API (original code)
```js
toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}
```
**Result: ❌ Silent no-op in WKWebView.**
WKWebView does not implement the Fullscreen API. The call is swallowed with no error.

---

### Attempt 2 — `window.__TAURI__.window.appWindow`
```js
async toggleFullscreen() {
  if (typeof window.__TAURI__ !== 'undefined') {
    const { appWindow } = window.__TAURI__.window;
    const isFullscreen = await appWindow.isFullscreen();
    await appWindow.setFullscreen(!isFullscreen);
    return;
  }
  ...
}
```
**Result: ❌ `window.__TAURI__.window.appWindow` is undefined.**
`appWindow` is only available via ES module import (`import { appWindow } from '@tauri-apps/api/window'`). It is **not** exposed on the `window.__TAURI__` global object.

---

### Attempt 3 — Custom Rust `toggle_fullscreen` command via `invoke()`
Added to `src-tauri/src/main.rs`:
```rust
#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) {
    let current = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!current);
}
```
Registered in `generate_handler![]`. JS calls:
```js
await window.__TAURI__.invoke('toggle_fullscreen');
```
**Result: ❌ Still no visible effect.**
The invoke call likely succeeds (no error thrown), but `window.set_fullscreen(true)` on Tauri v1 macOS enters a **new macOS Space** (native fullscreen), which may:
- Animate into a new desktop space (slow, jarring for a visualizer)
- Or silently fail if the window configuration blocks it

We haven't yet confirmed whether the invoke is actually reaching Rust or failing silently in JS.

---

## Unknowns / Unconfirmed

1. **Is `invoke('toggle_fullscreen')` actually being called?**  
   We have no logging in the app to confirm the Tauri branch is being reached. The `catch` block logs to console but we can't see console output in a signed release build.

2. **Does `window.set_fullscreen()` work at all in Tauri v1.5 on macOS?**  
   Known issue: Tauri v1 macOS fullscreen enters a new Space. This is different from what the green traffic light does in a non-fullscreen-capable window. Our `tauri.conf.json` window config has no `fullscreen: true` set, which may be required.

3. **Is `@tauri-apps/api` bundled in the build?**  
   It is not in `package.json` dependencies — only `@tauri-apps/cli` (devDependency). The JS API package (`@tauri-apps/api`) would be needed for ES module import approach.

---

## What the Official Tauri v1 Docs Say

From https://v1.tauri.app/v1/api/js/window/:
- `appWindow` is a `WebviewWindow` instance exposed as a **module variable**, not a global
- Correct usage: `import { appWindow } from '@tauri-apps/api/window'`
- `appWindow.setFullscreen(bool)` and `appWindow.isFullscreen()` are the correct JS-side methods
- The `window` allowlist in `tauri.conf.json` controls which window methods are accessible

---

## Candidate Fixes (not yet tried)

### Fix A — Import `@tauri-apps/api` and use `appWindow` properly (most correct)
1. Add `@tauri-apps/api` to `package.json` dependencies
2. In `controls.js`, dynamic import on Tauri branch:
   ```js
   async toggleFullscreen() {
     if (typeof window.__TAURI__ !== 'undefined') {
       const { appWindow } = await import('@tauri-apps/api/window');
       const isFs = await appWindow.isFullscreen();
       await appWindow.setFullscreen(!isFs);
       return;
     }
     ...
   }
   ```
3. Add `window.setFullscreen` and `window.isFullscreen` to allowlist in `tauri.conf.json`:
   ```json
   "window": {
     "setFullscreen": true,
     "isFullscreen": true
   }
   ```
**Risk:** Still enters a new macOS Space, which may look wrong for a visualizer.

---

### Fix B — Simple CSS/JS "fake fullscreen" for macOS app (no Space switching)
Rather than using macOS native fullscreen (which creates a new Space), make the Tauri window fill the screen using `window.setSize()` + `window.setPosition()` to cover the full display, and hide the title bar decorations. This mimics fullscreen without the Space animation.

```js
async toggleFullscreen() {
  if (typeof window.__TAURI__ !== 'undefined') {
    const { appWindow } = await import('@tauri-apps/api/window');
    const { LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
    const monitor = await import('@tauri-apps/api/window').then(m => m.currentMonitor());
    // ... set window to monitor size/position
  }
}
```
**Pro:** No Space animation, instant, matches what VJs expect.  
**Con:** Decorations (title bar) remain unless `decorations: false` is set.

---

### Fix C — Add `fullscreen: true` to `tauri.conf.json` window config + Rust command
Setting the window as fullscreen-capable in config may be required before `set_fullscreen()` works:
```json
"windows": [{
  "title": "DiscoCast Visualizer",
  "fullscreen": false,
  ...
}]
```
Then the Rust command from Attempt 3 may actually work. This is the lowest-effort next test.

---

### Fix D — Keyboard simulation via AppleScript (fallback hack)
Shell out via `caffeinate`-style Tauri command to run:
```bash
osascript -e 'tell application "System Events" to keystroke "f" using {control down, command down}'
```
This simulates the macOS fullscreen keyboard shortcut (⌃⌘F). Works regardless of WKWebView. Fragile but guaranteed to work.

---

---

### Attempt 4 — `withGlobalTauri: true` + `getCurrent().setFullscreen()` ← IN PROGRESS

**Root cause confirmed via Tauri v1 docs:**
> *"This package is also accessible with `window.__TAURI__.window` when `build.withGlobalTauri` in `tauri.conf.json` is set to `true`."*

`withGlobalTauri` was **not set** in our config, so `window.__TAURI__.window` was `undefined` in every build. All previous JS-side attempts silently failed at that line.

**Fixes applied:**
1. `tauri.conf.json` — added `"withGlobalTauri": true` to `build` section
2. `tauri.conf.json` — added `window.setFullscreen: true` to allowlist (required by docs)
3. `src/controls.js` — use `window.__TAURI__.window.getCurrent().setFullscreen()` with `invoke('toggle_fullscreen')` as fallback

---

## Recommended Next Steps

1. **First: Add debug logging** — add a visible toast in the Tauri branch of `toggleFullscreen()` so we can confirm the code path is actually being hit in the built app
2. **Try Fix C** — add `"fullscreen": false` to window config (makes window fullscreen-capable) and retest the existing Rust command — lowest effort, no new deps
3. **If Fix C fails: Try Fix A** — install `@tauri-apps/api`, use proper module import
4. **If still entering new Space: Try Fix B** — fake fullscreen via window resize

---

## Files Involved

| File | Role |
|---|---|
| `src/controls.js` | `toggleFullscreen()` method (~line 1339) |
| `src-tauri/src/main.rs` | `toggle_fullscreen` + `get_fullscreen` Rust commands |
| `src-tauri/tauri.conf.json` | Window config + allowlist |
| `package.json` | Missing `@tauri-apps/api` dependency |
