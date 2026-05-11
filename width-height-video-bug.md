# Width/Height Video Sliders — Bug Log

> **Feature:** Add independent Width and Height sliders to video layers only.  
> **Videos have NO tiling. Images already have Width/Height via tiling. This is video-only.**

---

## Root Cause (Confirmed)

Line 3611 in `inspector.js` has a generic slider handler that maps ALL `.layer-slider-row input[type=range]` elements **by DOM index** to a `sliderKeys` array:

```javascript
const sliderKeys = ['opacity', 'spacing', 'orbitRadius', 'tunnelSpeed', 'depthOffset', ...]
```

Our new `layer-vid-sx-sl` and `layer-vid-sy-sl` sliders were **not added to the `:not()` exclusion list** on that selector. So:

- **Width slider** → DOM index 1 → maps to `'spacing'`
- **Height slider** → DOM index 2 → maps to `'orbitRadius'` → **causes circling**

The slider was setting `entry.orbitRadius` instead of `entry.tileScaleX`. Nothing wrong with the shader.

---

## What Was Tried (All Wrong — Documented to Prevent Repeat)

### Attempt 1
Changed `_buildImageBlock` to remove `isVideo ? '1.0'` hardcoding for `tileScaleX/Y`.  
**Result:** Drift still there. Root cause not addressed.

### Attempt 2
Changed the non-tiled `else` branch to skip `aspectPreScale` for videos, added separate X/Y size lines.  
**Result:** Still drifting. Still hadn't found the generic handler bug.

### Attempt 3
Added `_uvSample` — a second UV variable to separate sampling from positioning.  
**Result:** Made it worse. Texture and mask decoupled from rotation. Circling appeared.  
**Error:** Rotation was applied to `_u` but not `_uvSample` — visible area and texture sample became misaligned.

### Why We Kept Getting It Wrong
- Assumed drift = shader UV math problem
- Never checked whether the new slider classes were excluded from the generic handler
- Kept patching the shader instead of tracing the slider event flow

---

## The Correct Fix (Two changes only)

### Fix 1: Add exclusions to generic slider handler (line 3611)
Add `:not(.layer-vid-sx-sl):not(.layer-vid-sy-sl)` to the selector.  
This stops the generic handler from picking up the new sliders.

### Fix 2: Revert shader to clean version
- Remove the `_uvSample` complexity entirely
- For videos in the non-tiled path: use `aspectPreScale('_u')` (which now uses real `tileScaleX/Y` values) + `_u /= sizeBase`
- This is identical to the image path — clean, consistent, and correct

### Why the simple shader approach works
For centered UVs (`_u = _uvf - center`):
- At center: `_u = (0,0)` → dividing by anything still gives `(0,0)` → `_uInstanced = (0.5, 0.5)` → **no drift**
- `tileScaleX = 2` → `_u.x /= 2` → smaller UV range → video fills more screen → video appears WIDER
- Center never moves regardless of width/height values ✓

---

## Files Changed

| File | Change |
|---|---|
| `src/editor/inspector.js` line 3611 | Add `:not(.layer-vid-sx-sl):not(.layer-vid-sy-sl)` to `:not()` exclusion list |
| `src/editor/inspector.js` ~5456 | Revert `_uvSample` complexity — use `aspectPreScale` + `_u /= sizeBase` for videos |

---

## Rules Going Forward

1. When a new slider class is added, **immediately add it to the `:not()` exclusion list** at line 3611
2. Never patch shader UV math without first tracing the slider event listener chain
3. Videos have no tiling — `tileScaleX/Y` are reused only as a convenient float property, not for any tile behavior
