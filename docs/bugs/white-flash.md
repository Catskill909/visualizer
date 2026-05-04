# White Flash on Startup — Audit & Fix Plan

> **Status:** ✅ Fixed. Kept for reference.

## Root Causes

### 1. Tauri: Native window has no background color set (macOS + Windows)
`tauri.conf.json` defines the window with no `backgroundColor` and no `visible: false`. The native window frame appears immediately with a white system background before the WebKit/WebView2 webview finishes painting its first frame. This is the primary cause on desktop.

**File:** `src-tauri/tauri.conf.json` — `tauri.windows[0]` block

### 2. `<html>` element has no inline background (all platforms)
`index.html:17` sets `body { background-color: #000 }` as an inline style — correct. But `<html>` has no inline style. The external CSS at `src/style.css:37` sets `html, body { background: var(--bg-primary) }`, but that rule only applies once the external stylesheet is fetched and parsed. In the gap between HTML parse and CSS load, `html` can expose the browser/webview default (white).

**File:** `index.html` — `<head>`

### 3. `#start-screen` fades in from opacity 0 (all platforms)
`src/style.css:235`: `animation: fadeIn 0.6s ease` on `#start-screen`. The element starts at `opacity: 0` and fades in over 600ms, exposing the black background behind it. This is fine once cause 1+2 are fixed (black is fine), but if the native window background is still white for any reason the canvas area will show white through the fading start-screen.

**File:** `src/style.css:232–238`

### 4. Tauri Windows: WebView2 bootstrapper delay (Windows only)
`tauri.conf.json` uses `"type": "embedBootstrapper"` for WebView2. This means WebView2 must bootstrap on first run, adding extra time before the webview paints. Combined with no `visible: false`, the user sees a white window frame.

---

## Fix Plan

### Fix 1 — Inline critical CSS in `<head>` (web + desktop, easiest, most impactful)

Add a `<style>` block directly in `<head>` before any external stylesheet. This fires synchronously during HTML parse with zero network round-trip.

```html
<!-- index.html <head>, before the <link rel="stylesheet"> -->
<style>
  html, body { background: #000; margin: 0; }
</style>
```

**Why this works:** Inline styles are parsed and applied before the browser/webview renders a single pixel. Eliminates the FOUC window entirely for the web app and reduces the flash window on desktop.

---

### Fix 2 — Hide Tauri window until page is ready (macOS + Windows)

**Step A — `tauri.conf.json`:** Add `"visible": false` to the window definition so the native window starts hidden.

```json
"windows": [{
  "title": "DiscoCast Visualizer",
  "width": 1200,
  "height": 800,
  "minWidth": 800,
  "minHeight": 600,
  "center": true,
  "visible": false
}]
```

**Step B — `src/main.js`:** Show the window after `DOMContentLoaded` (the earliest safe moment — inline CSS is already applied by this point).

```js
// Near the top of the DOMContentLoaded handler
if (window.__TAURI__) {
  window.__TAURI__.window.getCurrent().show();
}
```

**Why this works:** The native window frame never appears at all until the webview has already rendered the black background. The user sees the black window appear fully-formed.

---

### Fix 3 — Remove the `fadeIn` animation from `#start-screen` (all platforms)

The start screen should appear instantly — it's covering the canvas anyway. The fade-in only creates a window where the canvas shows through, which is currently black but unnecessary risk.

```css
/* src/style.css — change this: */
#start-screen {
  ...
  animation: fadeIn 0.6s ease;   /* REMOVE */
}
```

If a fade-in feel is desired for the start card content rather than the whole screen, apply `animation: fadeIn 0.6s ease` to `.start-card` instead, keeping the opaque black background always present.

---

### Fix 4 — Add `theme-color` meta (web app, minor)

Helps Chromium-based browsers and PWA installs set the browser chrome color before paint:

```html
<meta name="theme-color" content="#000000" />
```

---

## Implementation Order

| Priority | Fix | Files | Effort |
|----------|-----|-------|--------|
| 1 | Inline critical CSS | `index.html` | 3 lines |
| 2 | Tauri `visible: false` + JS show | `tauri.conf.json`, `src/main.js` | 5 lines |
| 3 | Remove start-screen `fadeIn` | `src/style.css` | 1 line |
| 4 | Add `theme-color` meta | `index.html` | 1 line |

Fixes 1–3 together should eliminate the flash on all three platforms. Fix 4 is a minor polish item for web.

---

## Files to Change

- `index.html` — inline `<style>` + `theme-color` meta
- `src-tauri/tauri.conf.json` — add `"visible": false`
- `src/main.js` — show Tauri window on `DOMContentLoaded`
- `src/style.css:235` — remove `animation: fadeIn 0.6s ease` from `#start-screen`
