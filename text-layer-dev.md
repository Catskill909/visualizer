# Text Layer Feature — Dev Document

> **Status:** ✅ Phase 1 + 2 Complete — tested, 18 bugs found and fixed  
> **Last Updated:** May 8, 2026  
> **Goal:** Text layers as first-class layer type with WYSIWYG editing, bundled fonts, effects, and all image-layer transforms

---

## Current State

**Working as of May 7, 2026:**
- ✅ `✏️ Text` button adds a text layer
- ✅ Textarea updates texture live (150ms debounce)
- ✅ Font family (20 fonts across 5 groups), weight (Normal/Bold), size, letter spacing, line height all update live
- ✅ Font size slider (Typography → Size) works at all sizes 24–200px — no blur, no clipping
- ✅ Layer scale slider (Blend → Size) works independently for overall layer scaling
- ✅ Text alignment (L/C/R), color picker positioned correctly near swatch
- ✅ Effects: Shadow (blur, X/Y offset, color), Outline (width, color) — expandable detail panels. Glow removed.
- ✅ All image-layer transforms work (scale, opacity, spin, orbit, mirror, etc.)
- ✅ All audio reactivity works (pulse, beat fade, etc.)
- ✅ Blend mode defaults to `normal` (plain text compositing via texture alpha)
- ✅ `normal` blend mode added to GLSL shader (`mix(col, _src, _t.w * _op)`)
- ✅ Preset save/load: text layers restore from saved properties (no imageId needed)
- ✅ Fonts await `document.fonts.load()` before Canvas 2D render
- ✅ Roboto and Oswald bold/normal both work (proper weight 400/700 TTF files)
- ✅ Text vertically centered in canvas at all font sizes
- ✅ Canvas stable size (sized to 200px text) so tiling never breaks when font size changes

---

## Implementation Summary

### Files changed
- **`src/assets/fonts/`** — `inter.woff2` (variable), `roboto-400.ttf`, `roboto-700.ttf`, `oswald-400.ttf`, `oswald-700.ttf`, `anton-400.ttf`, `bebas-neue-400.ttf`, `righteous-400.ttf`, `exo2-400.ttf`, `exo2-700.ttf`
- **`src/assets/fonts/fonts.css`** — `@font-face` for Inter (variable woff2), Roboto 400+700, Oswald 400+700 (separate rules per weight)
- **`src/editor/main.js`** — imports `fonts.css`
- **`src/visualizer.js`** — `_renderTextTexture()`, `_loadTextTexture()` (direct GL upload, bypasses `loadExtraImages` cache), `isText` branch in `setUserTexture()`
- **`src/editor/inspector.js`** — `_addTextLayer()`, text UI block in `_mountLayerCard()`, full event wiring, `loadPresetData()` text restore, `_bindAddTextLayer()`, `_resetImageLayer()` guard, thumbnail fix, bulk slider exclusion list fix, `normal` blend in GLSL
- **`editor.html`** — `✏️ Text` button
- **`src/editor/style.css`** — text controls, effect detail panels, color swatch/picker positioning

---

## Architecture: How Font Size Works (The Hard-Won Truth)

This took 3 hours to get right. Read this before touching `_renderTextTexture`.

### The Core Conflict
There are **two size systems**:
1. **Typography → Size** (`entry.fontSize`) — changes how big the glyphs are drawn on the Canvas 2D texture
2. **Blend → Size** (`entry.size`) — controls tile density in the WebGL shader (how many tiles fill the screen)

These are completely independent. The shader's tile spacing is driven by `entry.texW` / `entry.texH`. **If `texW/texH` change when font size changes, tile spacing breaks.**

### The Solution: Stable Canvas Sized to Max Font

`_renderTextTexture` sizes the canvas by measuring the text **at 200px (the max font size)** regardless of the current `entry.fontSize`. This means:
- Canvas dimensions never change as the font size slider moves
- `texW` / `texH` never change → shader tile spacing never changes
- `reRender()` just re-uploads the texture, never rebuilds the shader
- Font size slider changes glyph size drawn within the stable canvas → visually scales
- Text is vertically centered in the canvas so small font sizes don't pin to top

### What NOT To Do
Every approach below was tried and failed:

| Approach | Problem |
|---|---|
| Dynamic canvas (sized to current font) | `texW/texH` change → tile spacing breaks on every font size change |
| Fixed 1024×512 canvas | Huge transparent padding → tiled mode shows massive gaps between tiles |
| Fixed 1024×1024 canvas | Same padding problem + `size:1.0` default made tiles fill full screen |
| Update `texW/texH` + rebuild shader on font change | Shader recomputes aspect ratio, visually cancels out the size change |
| 2× supersampled canvas | `ctx.scale(2,2)` doubled anchor positions (which were already 2× canvas coords) → text overflowed and clipped |

### The One Rule
**Canvas size must be determined at max font size and never change.** Font size only controls what gets drawn inside.

---

## Checklist

### ✅ Done
- [x] Bundled fonts downloaded + declared
- [x] `_renderTextTexture()` — Canvas 2D → texture (multi-line, shadow, outline, letter spacing, line height)
- [x] `_loadTextTexture()` — direct GL upload so re-renders always take effect
- [x] Text UI card — Content, Typography, Effects sections
- [x] Letter spacing + line height sliders
- [x] Shadow / Outline with full detail controls (Glow removed — no visible effect in WebGL)
- [x] Color pickers positioned correctly
- [x] `loadPresetData()` text restore branch
- [x] Bulk slider exclusion list (BUG 6 — critical)
- [x] `normal` blend mode (plain alpha composite)
- [x] Font `document.fonts.load()` await before render

### 🔲 Phase 3 — Future
- [x] More bundled fonts — now 20 across 5 groups (May 8, 2026)
  - Standard: Inter, Roboto, Poppins, Montserrat, Raleway
  - Display: Oswald, Anton, Bebas Neue, Bangers, Black Ops One, Russo One, Righteous, Cinzel
  - Tech/Sci-Fi: Orbitron, Exo 2, Chakra Petch
  - Retro/Pixel: Press Start 2P, VT323
  - Handwritten: Pacifico, Permanent Marker
- [x] Background box (color + padding + opacity) — implemented, toggle in UI
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
**Status:** ✅ Fixed then removed

**Root cause:** Glow toggle was not added to the HTML template or the event wiring in the first implementation, despite being in the spec.

**Fix:** Added Glow toggle. Later **removed entirely** — glow had no visible effect in WebGL compositing and added confusion. Shadow covers the use case.

### BUG 3 — Letter spacing + line height sliders missing (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** These were in the spec's data model and UI wireframe but not added in the first implementation.

**Fix:** Added `layer-letter-spacing-sl` and `layer-line-height-sl` sliders to the HTML template and wired them in the event block.

### BUG 4 — Font family and weight changes have no visible effect (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** Canvas 2D `_renderTextTexture` runs synchronously. With `font-display: swap`, the `@font-face` fonts are not yet loaded at first render, so Canvas falls back to system sans-serif. Roboto was also declared `font-weight: 400` only, so Bold requested `700` but no variant existed.

**Fix 1:** `_loadTextTexture` now awaits `document.fonts.load(\`${weight} ${size}px "${family}"\`)` before calling `_renderTextTexture`.  
**Fix 2:** `fonts.css` — Roboto now declares `font-weight: 100 900` (variable range) same as Inter and Oswald. *(Later superseded by BUG 11 — separate 400/700 TTF files replace the variable range declaration.)*

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
**Status:** Removed — glow feature deleted

**Root cause:** The glow pass was fighting with the shadow state on the same canvas context.

**Decision:** Glow removed entirely rather than fixed — no visible impact in WebGL compositing. `applyShadow()` / `clearShadow()` helpers kept (used by shadow and outline).

### BUG 9 — Outline "border" visible even when all effects off; white text + white outline invisible (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** `ctx.strokeText` was being called with leftover `ctx.lineWidth` from previous render. Also: outline color defaulted to `#000000` but if the user had set it to white and text was white, the outline was invisible.

**Fix:** Outline `strokeText` is now fully guarded by `if (textLayer.textOutline?.enabled)`. Shadow state is never active during `strokeText`. Default outline defaults remain black.

### BUG 10 — Font size slider stalls / jumps back when dragged rapidly (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** `_loadTextTexture` is `async`. On every slider tick it called `await document.fonts.load()` even when the font was already loaded. Rapid drag queued up dozens of async calls resolving out of order — stale renders overwrote fresh ones, making the font appear to stop growing or snap back.

**Fix 1:** `_loadTextTexture` now calls `document.fonts.check()` (synchronous) first — if the font is already loaded the `await` is skipped entirely, making subsequent renders synchronous and instant.  
**Fix 2:** Font size slider wired with 80ms debounce so rapid drag fires a single render on release rather than one per pixel. (Debounce later removed — `fonts.check()` fix alone was sufficient.)

### BUG 11 — Roboto and Oswald bold/normal have no effect (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** The `roboto.woff2` (9.6KB) and `oswald.woff2` (9.6KB) files originally downloaded were single static weight cuts, not variable fonts. Declaring `font-weight: 100 900` on a single-weight file is invalid — the browser only has one weight and ignores all other requests. Inter worked because its `inter.woff2` (21KB) is a genuine variable font.

**Fix:** Downloaded separate 400 and 700 weight TTF files for both Roboto and Oswald from Google Fonts. Updated `fonts.css` to declare two separate `@font-face` rules per family (one for weight 400, one for 700). Also normalised `'bold'→'700'` and `'normal'→'400'` in `_loadTextTexture` so `fonts.check()` / `fonts.load()` strings match the numeric weight declarations exactly.

**Files added:** `roboto-400.ttf`, `roboto-700.ttf`, `oswald-400.ttf`, `oswald-700.ttf`

### BUG 12 — Oswald bold/normal reversed (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** Wrong TTF URLs used when first downloading Oswald. The URL used for `oswald-700.ttf` (`13FvgUE`) was actually Oswald 200 (Light), not 700 (Bold). Confirmed correct URLs by querying `fonts.googleapis.com/css2?family=Oswald:wght@400;700` which returns the font-weight alongside each URL.

**Fix:** Re-downloaded both files with correct URLs: `1_FvgUE` = 400, `1xZogUE` = 700.

### BUG 13 — Font size 12px blurry; line height below 1.0 overlaps lines (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** At font size 12px the canvas texture is tiny (~64px wide). WebGL upscales it to fill the layer, producing a blurry result. Line height 0.8–0.9 causes lines to overlap (lineHeightPx < fontSize).

**Fix:** Font size slider min raised from 12 to 24px, max raised from 160 to 200px. Line height slider min raised from 0.8 to 1.0.

### BUG 14 — Font size above ~80px renders invisible / black (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** WebGL1 requires `CLAMP_TO_EDGE` wrap mode for non-power-of-two (NPOT) textures. Text canvases are always NPOT (sized to fit the text). `_loadTextTexture` was setting `TEXTURE_WRAP_S/T` to `gl.REPEAT` — WebGL1 silently renders NPOT+REPEAT textures as solid black. At small font sizes the canvas happened to be near a power-of-two dimension and partially worked; at larger sizes the NPOT violation was severe enough to black out completely.

**Fix:** Changed both wrap parameters to `gl.CLAMP_TO_EDGE`. One-line change per axis.

### BUG 15–18 — Font size slider broken for 3 hours (May 7, 2026)
**Status:** ✅ Fixed

These bugs were all part of the same battle. Documented together for clarity.

**BUG 15 — Font size slider has no visual effect**  
*Root cause:* `entry.texW/texH` were hardcoded to `512×256`. Shader computed aspect from those constants, so changing font size (which changed canvas size) was invisible — shader saw no dimension change.  
*Failed fix attempts:* Updating `texW/texH` on each render + rebuilding the shader — shader recomputes aspect ratio, which exactly cancels out the visual size change.

**BUG 16 — Text clipped at large font sizes**  
*Root cause:* Canvas was sized to content at creation (default 48px → ~280×246px). At 200px font size the text overflowed that small canvas and was clipped by WebGL.  
*Failed fix:* Fixed 1024×512 canvas — worked for sizing and clipping but caused massive transparent padding gaps in tiled mode.

**BUG 17 — Tiling gaps when canvas was fixed 1024×512 or 1024×1024**  
*Root cause:* `texW/texH = 1024` told the shader each tile is huge — tiles spread far apart. Also `size: 1.0` default meant one tile filled the entire screen.  
*Failed fix:* 2× supersampled canvas with `ctx.scale(2,2)` — anchor positions were calculated from 2× canvas coords then scaled again — text overflowed half off-screen.

**BUG 18 — Text vertically pinned to top at small font sizes**  
*Root cause:* `startY = padding + shadowPad + fontSize`. With a large stable canvas and small font, text appeared in the top-left with huge empty space below.

**✅ Final unified fix (the one truth):**  
Canvas is sized by measuring text **at 200px (max font)** regardless of current `entry.fontSize`. This:
- Keeps canvas stable across all font sizes → `texW/texH` never change → tiling never breaks
- Allows text at any `fontSize` to be drawn inside without clipping (200px is the max)
- Text is vertically centered: `startY = Math.floor((canvasH - totalHeight) / 2) + fontSize`
- `reRender()` only re-uploads the GL texture, never rebuilds the shader

See **Architecture** section above for full explanation.

### BUG 19 — Mirror scope (Per Tile / Whole Image) hidden for text layers even with tile ON (May 7, 2026)
**Status:** ✅ Fixed

**Root cause:** The scope row had an unconditional `hidden` HTML attribute AND a JS toggle using `scopeRow.hidden = ...`. The `hidden` attribute always won, making the row invisible regardless of tile state. The tile-change handler also hid the scope row whenever tile was toggled, ignoring whether a mirror mode was active.

**Fix:** Removed `hidden` attribute from the scope row HTML — visibility is now style-only. Changed `scopeRow.hidden = ...` to `scopeRow.style.display = ...` throughout. Tile toggle now shows scope row if mirror is active, regardless of tile state.

---
