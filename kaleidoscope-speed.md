# Kaleidoscope Speed Control — Ground Plan

## What exists today

The Kaleido fold is a pure UV transform with no time term. It works the same way in two places:

**Canvas Mirror (preset-level)** — `_buildCompShader()` ~line 4676  
```glsl
float _kang = atan(_kp.y, _kp.x);
float _ka = mod(_kang, _ksect);
if (_ka > _ksect * 0.5) _ka = _ksect - _ka;
```
No `time`. The fold is frozen; the MilkDrop animation behind it moves, not the fold itself.

**Layer Mirror (per-layer)** — two places in `_buildLayerGLSL()`:  
- field-level fold ~line 4937 (when `mirrorScope === 'field'`)  
- tile-level fold ~line 5088 (when `mirrorScope === 'tile'`)  
Same static pattern. No `time`.

---

## What we are adding

A **spin speed** that rotates the kaleido slice grid over time. At 0.00 the pattern is completely still (identical to today). At higher values the grid spins, which reads as a swirling rotation of the whole kaleidoscope.

The GLSL change is one line in each of the three fold blocks:

```glsl
// Before (existing):
float _kang = atan(_kp.y, _kp.x);

// After (new):
float _kang = atan(_kp.y, _kp.x) + time * kaleidoSpeed * 6.28318;
```

`kaleidoSpeed` is baked into the shader as a float literal at build time — same pattern as `spinSpeed`, `swaySpeed`, etc.

---

## Slider curve design

The slider runs from `-1.0` to `+1.0` internally (range input). Zero = dead center = no spin. Negative = counter-clockwise, positive = clockwise. It maps to a **stored speed value** via a **signed cubed curve**:

```
stored = sign(pos) × |pos|³ × MAX_SPEED
```

Where `MAX_SPEED = 2.0` (rotations per second).

**Why cubed (not squared or linear):**  
- At `pos = 0.00` → stored = `0.000` — dead still  
- At `pos = 0.25` → stored = `0.031` — barely perceptible creep  
- At `pos = 0.50` → stored = `0.250` — gentle slow spin  
- At `pos = 0.75` → stored = `0.844` — medium spin  
- At `pos = 1.00` → stored = `2.000` — fast (2 full rotations/sec)  

The bottom half of the slider (±0 to ±0.5) covers the full "subtle motion" zone with fine macro control. Fast and very-fast values are compressed into the top quarter. Negative mirror image applies for CCW.

**Inverse mapping** (for preset load restore):
```
pos = sign(stored) × cbrt(|stored| / MAX_SPEED)
```

**`--pct` track fill** maps -1..+1 → 0%..100%:
```
pct = (pos + 1) / 2 × 100
```
So zero-speed sits at 50% (center of track), left half = CCW, right half = CW.

---

## State fields to add

### Canvas Mirror speed
Location: top-level `currentState`, alongside `sceneMirror`.

```js
// inspector.js ~line 184
sceneMirror: 'none',
sceneMirrorKaleidoSpeed: 0.00,   // ← new
```

### Layer Mirror speed
Location: inside each layer entry default block. Three default blocks exist (~lines 2205, 2453, 2590) — all three must get the field.

```js
mirror: 'none',
mirrorScope: 'tile',
kaleidoSpeed: 0.00,              // ← new
```

---

## GLSL change — 3 locations

All three are a one-line addition to the existing `_kang` line.

| # | Location | Context |
|---|---|---|
| 1 | `_buildCompShader()` ~line 4679 | Canvas Mirror kaleido fold |
| 2 | `_buildLayerGLSL()` ~line 4940 | Layer mirror, field scope fold |
| 3 | `_buildLayerGLSL()` ~line 5090 | Layer mirror, tile scope fold |

In each: replace `float _kang = atan(_kp.y, _kp.x);` with the `+ time * speed` version. The speed value is baked as a literal at shader-build time.

---

## UI — Canvas Mirror speed slider

Location: `editor.html`, directly after the `#scene-mirror-seg` button row (~line 453).

The row is **conditionally shown**: only visible when `sceneMirror === 'kaleido'`. It is hidden for Off / H / V / Quad.

```html
<!-- shown/hidden by JS based on sceneMirror value -->
<div id="scene-kaleido-speed-row" class="layer-slider-row" hidden>
  <span class="layer-ctrl-label">Speed</span>
  <input type="range" id="scene-kaleido-speed-sl"
         class="slider" min="0" max="1" step="0.01" value="0"
         style="--pct:0%">
  <span class="lsv" id="scene-kaleido-speed-val">0.00</span>
</div>
```

The JS listener (in `_bindInspectorEvents()` near the existing `smSeg` listener ~line 1254):
- On input: `pos = parseFloat(sl.value)`, `stored = pos * pos * 2.0`
- Writes `this.currentState.sceneMirrorKaleidoSpeed = stored`
- Updates display value and `--pct`
- Calls `_buildCompShader()` + `_applyToEngine()`

Show/hide rule: also triggered inside the existing `smSeg` click handler — toggle `hidden` on the speed row whenever mirror mode changes.

---

## UI — Layer Mirror speed slider

Location: `inspector.js`, inside `_buildLayerCard()` template string, right after the mirror button group and scope toggle (~line 3103).

```html
<div class="layer-slider-row layer-kaleido-speed-row" style="display:none">
  <span class="layer-ctrl-label">Speed</span>
  <input type="range" class="slider layer-kaleido-speed-sl"
         min="0" max="1" step="0.01"
         value="0" style="--pct:0%">
  <span class="lsv layer-kaleido-speed-val">0.00</span>
</div>
```

The JS listener wires up in `_bindLayerCardEvents()` alongside the existing mirror segment listener (~line 3480). On input: same squared curve, writes `entry.kaleidoSpeed`, calls `refresh()`.

Show/hide rule: extend the existing `updateStatus()` / mirror-segment click handler to also toggle `.layer-kaleido-speed-row` visibility — show only when `entry.mirror === 'kaleido'`.

---

## Generic slider handler exclusion

The long `:not()` chain at ~line 3455 catches all `.layer-slider-row` inputs by DOM index and maps them to `sliderKeys`. The new `.layer-kaleido-speed-sl` has its **own dedicated listener** (same pattern as `.layer-gif-speed-sl`, `.layer-radius-sl`, etc.) so it must be added to the `:not()` chain to prevent index drift.

Add `:not(.layer-kaleido-speed-sl)` alongside the existing exclusions.

---

## Save / load

No special migration needed. New fields default to `0.00`, so existing saved presets load with zero speed (frozen fold, identical to current behavior). The fields are plain numbers — they travel through the same JSON serialization path as all other layer properties.

---

## Files touched

| File | What changes |
|---|---|
| `src/editor/inspector.js` | State defaults (×4), GLSL folds (×3), UI template (×1), event bindings (×2), `:not()` chain (×1) |
| `editor.html` | One speed slider row after the Canvas Mirror buttons |

No new files. No new abstractions. All patterns are direct copies of existing speed-slider precedents in the codebase.

---

## What we are NOT doing (v1 scope)

- No negative speed (counter-clockwise) — slider starts at 0, goes positive only
- No audio reactivity on kaleido speed (that's a separate feature if ever wanted)
- No separate speed for each of the 6 slices — one global rotation rate only
