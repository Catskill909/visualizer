# Text Layer Feature — Dev Document

> **Status:** ✅ Phase 1 + 2 Complete — tested, 9 bugs found and fixed  
> **Last Updated:** May 7, 2026  
> **Goal:** Text layers as first-class layer type with WYSIWYG editing, bundled fonts, effects, and all image-layer transforms

---

## Current State

**Working as of May 7, 2026:**
- ✅ `✏️ Text` button adds a text layer
- ✅ Textarea updates texture live (150ms debounce)
- ✅ Font family (Inter / Roboto / Oswald), weight, size, letter spacing, line height all update live
- ✅ Text alignment (L/C/R), color picker positioned correctly near swatch
- ✅ Effects: Shadow (blur, X/Y offset, color), Glow (blur, color), Outline (width, color) — all with expandable detail panels
- ✅ All image-layer transforms work (scale, opacity, spin, orbit, mirror, etc.)
- ✅ All audio reactivity works (pulse, beat fade, etc.)
- ✅ Blend mode defaults to `normal` (plain text compositing via texture alpha)
- ✅ `normal` blend mode added to GLSL shader (`mix(col, _src, _t.w * _op)`)
- ✅ Preset save/load: text layers restore from saved properties (no imageId needed)
- ✅ Fonts await `document.fonts.load()` before Canvas 2D render

---

## Implementation Summary

### Files changed
- **`src/assets/fonts/`** — `inter.woff2`, `roboto.woff2`, `oswald.woff2` (offline-safe, bundled)
- **`src/assets/fonts/fonts.css`** — `@font-face` for all 3 fonts, `font-weight: 100 900`
- **`src/editor/main.js`** — imports `fonts.css`
- **`src/visualizer.js`** — `_renderTextTexture()`, `_loadTextTexture()` (direct GL upload, bypasses `loadExtraImages` cache), `isText` branch in `setUserTexture()`
- **`src/editor/inspector.js`** — `_addTextLayer()`, text UI block in `_mountLayerCard()`, full event wiring, `loadPresetData()` text restore, `_bindAddTextLayer()`, `_resetImageLayer()` guard, thumbnail fix, bulk slider exclusion list fix, `normal` blend in GLSL
- **`editor.html`** — `✏️ Text` button
- **`src/editor/style.css`** — text controls, effect detail panels, color swatch/picker positioning

---

## Checklist

### ✅ Done
- [x] Bundled fonts downloaded + declared
- [x] `_renderTextTexture()` — Canvas 2D → texture (multi-line, shadow, glow, outline, letter spacing, line height)
- [x] `_loadTextTexture()` — direct GL upload so re-renders always take effect
- [x] Text UI card — Content, Typography, Effects sections
- [x] Letter spacing + line height sliders
- [x] Shadow / Glow / Outline with full detail controls
- [x] Color pickers positioned correctly
- [x] `loadPresetData()` text restore branch
- [x] Bulk slider exclusion list (BUG 6 — critical)
- [x] `normal` blend mode (plain alpha composite)
- [x] Font `document.fonts.load()` await before render

### 🔲 Phase 3 — Future
- [ ] More bundled fonts (currently 3: Inter, Roboto, Oswald)
- [ ] Background box (color + padding + opacity)
- [ ] Typing / reveal animation
- [ ] Scrolling / marquee
- [ ] Recently used fonts

---

## Bugs & Issues Log

### BUG 1 — Texture does not update when text/font/controls change (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** `loadExtraImages` in Butterchurn silently skips re-upload when a sampler with the same name already exists. The first call uploads the texture; every subsequent call is a no-op.

**Fix:** Added `_loadTextTexture(name, textLayer)` in `visualizer.js` that writes directly to `imgTextures.samplers[name]` via raw GL calls — same pattern as the GIF path. Reuses the existing GL texture object (`texImage2D` re-uploads pixel data in-place). The `reRender()` closure in the text wiring now calls `this.engine._loadTextTexture()` directly instead of `setUserTexture()`.

### BUG 2 — Glow effect missing from UI and renderer (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** Glow toggle was not added to the HTML template or the event wiring in the first implementation, despite being in the spec.

**Fix:** Added Glow toggle to Effects row in `_mountLayerCard`, wired `layer-text-glow-cb` in the text wiring block, added `textGlow` defaults to `_addTextLayer`, and added glow pass to `_renderTextTexture` (drawn first as blurred ghost, `globalAlpha: 0.5`).

### BUG 3 — Letter spacing + line height sliders missing (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** These were in the spec's data model and UI wireframe but not added in the first implementation.

**Fix:** Added `layer-letter-spacing-sl` and `layer-line-height-sl` sliders to the HTML template and wired them in the event block.

### BUG 4 — Font family and weight changes have no visible effect (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** Canvas 2D `_renderTextTexture` runs synchronously. With `font-display: swap`, the `@font-face` fonts are not yet loaded at first render, so Canvas falls back to system sans-serif. Roboto was also declared `font-weight: 400` only, so Bold requested `700` but no variant existed.

**Fix 1:** `_loadTextTexture` now awaits `document.fonts.load(\`${weight} ${size}px "${family}"\`)` before calling `_renderTextTexture`.  
**Fix 2:** `fonts.css` — Roboto now declares `font-weight: 100 900` (variable range) same as Inter and Oswald.

### BUG 5 — Effects (shadow, glow, outline) too subtle, no control sliders (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** First implementation only had on/off toggles. Default values (blur 4, offset 2) were too small to be clearly visible.

**Fix:** Each effect now has an expandable detail panel (shown when toggled on):
- **Shadow:** Blur slider (0–40), X/Y offset sliders (-20–20), color swatch
- **Glow:** Blur slider (0–60), color swatch  
- **Outline:** Width slider (1–16px), color swatch  
Default values bumped to blur=8, offset=3 for shadow.

### BUG 6 — CRITICAL: All sliders corrupted on text layers — font size changes opacity, outline animates font (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** `_mountLayerCard` has a bulk positional slider wiring block (line ~3259) that uses `querySelectorAll('.layer-slider-row input[type=range]:not(...)')` and maps results to `entry` keys by array index (`sliderKeys[i]`). The new text-specific sliders (`layer-font-size-sl`, `layer-letter-spacing-sl`, `layer-line-height-sl`, `layer-shadow-blur-sl`, `layer-shadow-x-sl`, `layer-shadow-y-sl`, `layer-glow-blur-sl`, `layer-outline-width-sl`) all appear **before** the transform sliders in DOM order (text block is inserted before Blend/Opacity row). This shifted every index — so font-size was wiring to `entry.opacity`, letter-spacing to `entry.spacing`, etc.

**Fix:** Added all 8 new text slider classes to the `:not()` exclusion list in the bulk selector. Single-line change. Text sliders have their own dedicated event listeners and do NOT go through the positional index system.

**Lesson:** Any new `.layer-slider-row input[type=range]` added to the card HTML that is NOT meant to be wired by the bulk positional system **must** be added to the `:not()` exclusion list.

### BUG 7 — Color picker opens at top-left corner of browser (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** `input[type=color]` was `display:none` in document flow; clicking the swatch called `.click()` on it, which opens the OS picker at the element's document position (top of page).

**Fix:** Wrapped each swatch+picker pair in a `position:relative` container. Picker is now `position:absolute; top:0; left:0; opacity:0` on top of the swatch. User clicks directly hit the transparent input — OS picker opens at the click position.

### BUG 8 — Glow has no visible effect (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** The glow pass was fighting with the shadow state on the same canvas context. After glow zeroed `ctx.shadowBlur`, the main fill loop had no shadow reapplied. Also `ctx.save/restore` was missing so glow state leaked.

**Fix:** Glow pass now uses `ctx.save()` / `ctx.restore()` so it's fully isolated. Refactored main loop to use `applyShadow()` / `clearShadow()` helpers called explicitly before each draw operation.

### BUG 9 — Outline "border" visible even when all effects off; white text + white outline invisible (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** `ctx.strokeText` was being called with leftover `ctx.lineWidth` from previous render. Also: outline color defaulted to `#000000` but if the user had set it to white and text was white, the outline was invisible.

**Fix:** Outline `strokeText` is now fully guarded by `if (textLayer.textOutline?.enabled)`. Shadow state is never active during `strokeText`. Default outline defaults remain black.

---
