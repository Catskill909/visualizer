# Video Width/Height Sliders — Implementation Plan

> **Status:** ✅ COMPLETE (May 11, 2026)  
> **Scope:** Add independent Width/Height sliders to video layers (non-uniform scaling)  
> **Pattern:** Reuse existing `tileScaleX`/`tileScaleY` properties already on video entries

## Bug Log Reference
See `width-height-video-bug.md` for full failure history and root cause analysis.

**Root cause of drift bug:** `layer-vid-sx-sl` / `layer-vid-sy-sl` were not excluded from the generic slider handler (line 3611). The handler maps sliders by DOM index — Height was landing on `orbitRadius`. Fixed by adding both to the `:not()` exclusion list.

---

## Next Feature: Video Border (Width / Color / Feather)
See §22 in `video-dev.md` for full spec.

---

## 1. Current State Audit

| Layer Type | Has Width/Height Sliders? | How It Works |
|---|---|---|
| **Image (tiled)** | ✅ Yes, when `tile=true` | `tileScaleX`/`tileScaleY` control tile aspect ratio |
| **Video** | ❌ No — only single "Scale" | `tileScaleX`/`tileScaleY` exist in entry but hardcoded to `1.0` and ignored in shader |
| **Text** | ❌ No — font size only | N/A |

**Key Finding:** Video entries already have `tileScaleX: 1.0, tileScaleY: 1.0` in the defaults (inspector.js:2524-2525) — they're just not exposed in UI or passed to shader.

---

## 2. Implementation Plan

### 2.1 Add UI Controls (inspector.js)

Add Width/Height sliders in the video layer controls section, right after the "Scale" slider.

**Location:** After line ~2985 (after the Scale slider `layer-size-sl`)

```javascript
// Video width/height sliders — independent aspect ratio control
<div class="layer-slider-row${entry.type === 'video' ? '' : ' style="display:none"'}>
  <span class="layer-ctrl-label" data-tooltip="Horizontal scale multiplier">Width</span>
  <input type="range" class="slider layer-vid-sx-sl" min="0" max="1" step="0.01"
    value="${Math.sqrt((entry.tileScaleX - 0.25) / 3.75).toFixed(3)}" style="--pct:${(Math.sqrt((entry.tileScaleX - 0.25) / 3.75) * 100).toFixed(1)}%">
  <span class="lsv layer-vid-sx-val">${entry.tileScaleX.toFixed(2)}</span>
</div>
<div class="layer-slider-row${entry.type === 'video' ? '' : ' style="display:none"'}>
  <span class="layer-ctrl-label" data-tooltip="Vertical scale multiplier">Height</span>
  <input type="range" class="slider layer-vid-sy-sl" min="0" max="1" step="0.01"
    value="${Math.sqrt((entry.tileScaleY - 0.25) / 3.75).toFixed(3)}" style="--pct:${(Math.sqrt((entry.tileScaleY - 0.25) / 3.75) * 100).toFixed(1)}%">
  <span class="lsv layer-vid-sy-val">${entry.tileScaleY.toFixed(2)}</span>
</div>
```

**Design Notes:**
- Same log-scale mapping as tiled image sliders: slider 0→1 maps to scale 0.25→4.0
- Same CSS classes pattern: `layer-vid-sx-sl`, `layer-vid-sy-sl`, `layer-vid-sx-val`, `layer-vid-sy-val`
- Visible only for video layers (`entry.type === 'video'`)

---

### 2.2 Add Event Handlers (inspector.js)

**Location:** In `_bindLayerCard()` — after the Size/Scale slider handler (~line 3540)

```javascript
// Video Width/Height sliders — independent aspect ratio
const vidSxSl = card.querySelector('.layer-vid-sx-sl');
const vidSxVal = card.querySelector('.layer-vid-sx-val');
const vidSySl = card.querySelector('.layer-vid-sy-sl');
const vidSyVal = card.querySelector('.layer-vid-sy-val');

if (vidSxSl && vidSxVal) {
    vidSxSl.addEventListener('input', () => {
        const pos = parseFloat(vidSxSl.value);
        const stored = 0.25 + 3.75 * pos * pos; // 0.25–4.0 range
        entry.tileScaleX = stored;
        vidSxVal.textContent = stored.toFixed(2);
        vidSxSl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
        refresh();
    });
}

if (vidSySl && vidSyVal) {
    vidSySl.addEventListener('input', () => {
        const pos = parseFloat(vidSySl.value);
        const stored = 0.25 + 3.75 * pos * pos; // 0.25–4.0 range
        entry.tileScaleY = stored;
        vidSyVal.textContent = stored.toFixed(2);
        vidSySl.style.setProperty('--pct', `${(pos * 100).toFixed(1)}%`);
        refresh();
    });
}
```

---

### 2.3 Update Shader Uniforms (inspector.js)

**Location:** `_buildImageBlock()` lines 5076-5077

**Current:**
```javascript
const tileScaleX = isVideo ? '1.0' : (img.tileScaleX !== undefined ? img.tileScaleX : 1.0).toFixed(4);
const tileScaleY = isVideo ? '1.0' : (img.tileScaleY !== undefined ? img.tileScaleY : 1.0).toFixed(4);
```

**Change to:**
```javascript
// Videos now use tileScaleX/tileScaleY for independent width/height control
const tileScaleX = (img.tileScaleX !== undefined ? img.tileScaleX : 1.0).toFixed(4);
const tileScaleY = (img.tileScaleY !== undefined ? img.tileScaleY : 1.0).toFixed(4);
```

**Impact:** This also affects images, but they already set these values — no behavior change for images. Videos now actually use their stored values.

---

### 2.4 Shader Compatibility Check

The existing shader code in `_buildImageBlock` already uses `tileScaleX`/`tileScaleY` for UV scaling:

```glsl
vec2 tiledUV = baseUV * vec2(${tileScaleX}, ${tileScaleY});
```

This applies to both images and videos. For videos, this will now stretch/squash the video frame.

---

## 3. Files to Modify

| File | Lines | Change |
|---|---|---|
| `src/editor/inspector.js` | ~2985-2986 | Add Width/Height slider HTML after Scale slider |
| `src/editor/inspector.js` | ~3540-3550 | Add event handlers for Width/Height sliders |
| `src/editor/inspector.js` | 5076-5077 | Remove video hardcoding — use `img.tileScaleX/Y` for all types |

---

## 4. Migration / Backwards Compatibility

- Existing video presets have `tileScaleX: 1.0, tileScaleY: 1.0` — they render identically (no stretch)
- New videos get defaults `1.0` — uniform scale until user adjusts
- Old videos without these properties (if any exist) fall back to `1.0` via the `|| 1.0` in the shader uniform code

---

## 5. Testing Checklist

- [ ] Add video layer — Width/Height sliders appear
- [ ] Width slider 0.25–4.0 range works (log scale)
- [ ] Height slider 0.25–4.0 range works (log scale)
- [ ] Video stretches horizontally when Width > 1.0
- [ ] Video squashes vertically when Height < 1.0
- [ ] Values persist in preset save/load
- [ ] Image layers with tiling still work correctly
- [ ] Uniform Scale slider still works independently

---

## 6. Future Enhancements (Not in this plan)

- **Lock aspect ratio button** — link Width/Height so adjusting one updates the other proportionally
- **Preset aspect ratios** — 16:9, 4:3, 1:1, 9:16 buttons
- **Fit/Fill modes** — auto-calculate Width/Height based on video vs canvas aspect ratio
