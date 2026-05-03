# Radius Slider — Development Plan

## What We're Building

A Radius slider on the Image tab that rounds the corners of each image layer — from square (0.00) to circle (0.50) — using a signed-distance-field (SDF) clip in the GLSL shader. Works in non-tiled, tiled, and tunnel modes.

---

## Root Cause of Last Failure

### The crash was an index-shift in the generic slider handler.

At line 2395, a generic handler wires up ALL `.layer-slider-row input[type=range]` sliders that are NOT in a hard-coded exclusion list. It maps them **by index** to a `sliderKeys` array:

```
index 0 → 'opacity'
index 1 → 'spacing'
index 2 → 'orbitRadius'
index 3 → 'tunnelSpeed'
...
```

My Radius slider was placed in a `.layer-slider-row` div but was **NOT added to the exclusion list**. So it was picked up by the generic handler. Because it was inserted between Size and Spacing:

```
index 0 → Opacity    → 'opacity'   ✓ correct
index 1 → RADIUS     → 'spacing'   ✗ WRONG — radius slider now also sets spacing
index 2 → Spacing    → 'orbitRadius' ✗ WRONG — shifted
index 3 → Orbit      → 'tunnelSpeed' ✗ WRONG — shifted
... everything after it shifted by one
```

This is exactly why the Radius slider also "changed the tile size" — it was setting `entry.spacing` (gap between tiles) at the same time as the dedicated radius handler. More spacing = smaller-looking tiles.

This was **not a GLSL bug**. The SDF math was correct.

---

## Exact Exclusion List Location

**File:** `src/editor/inspector.js`  
**~Line 2395** — the `querySelectorAll` call that must include our new exclusion:

```javascript
card.querySelectorAll(
  '.layer-slider-row input[type=range]' +
  ':not(.layer-bounce-sl)' +
  ':not(.layer-size-sl)' +
  ':not(.layer-liss-sl)' +
  ':not(.layer-strobe-thr-sl)' +
  ':not(.layer-pan-x-sl)' +
  ':not(.layer-pan-y-sl)' +
  ':not(.layer-pan-range-sl)' +
  ':not(.layer-beat-fade-sl)' +
  ':not(.layer-tile-sx-sl)' +
  ':not(.layer-tile-sy-sl)' +
  ':not(.layer-shake-sl)' +
  ':not(.layer-persp-x-sl)' +
  ':not(.layer-persp-y-sl)'   // ← must add :not(.layer-radius-sl) here
).forEach((sl, i) => { ... })
```

**Fix:** add `:not(.layer-radius-sl)` to this chain. This is the single highest-priority step — nothing else works without it.

---

## Implementation Plan — 4 Changes Only

### Change 1: Exclusion list (prevent index-shift)

In the generic handler's `querySelectorAll`, append:
```
:not(.layer-radius-sl)
```
This prevents the generic handler from picking up our new slider at all.

---

### Change 2: HTML template — add the Radius slider row

**Location:** After the Size slider row (~line 1949), before the Spacing row.

```html
<div class="layer-slider-row">
  <span class="layer-ctrl-label" data-tooltip="0 = square · 0.5 = circle">Radius</span>
  <input type="range" class="slider layer-radius-sl" min="0" max="0.5" step="0.01"
    value="${(entry.radius || 0).toFixed(2)}" style="--pct:${pct(entry.radius || 0, 0, 0.5)}">
  <span class="lsv layer-radius-val">${(entry.radius || 0).toFixed(2)}</span>
</div>
```

Key: class is `layer-radius-sl` (matches the exclusion we add in Change 1).

---

### Change 3: Dedicated event handler

**Location:** After the perspY handler block (~line 2556), before the Posterize block.  
Model: identical pattern to the Size slider dedicated handler.

```javascript
const radiusSl  = card.querySelector('.layer-radius-sl');
const radiusVal = card.querySelector('.layer-radius-val');
radiusSl.addEventListener('input', () => {
    entry.radius = parseFloat(radiusSl.value);
    radiusVal.textContent = entry.radius.toFixed(2);
    radiusSl.style.setProperty('--pct', `${pct(entry.radius, 0, 0.5)}`);
    refresh();
});
```

Linear scale — no curve needed (0.00 to 0.50 is already an intuitive range).

---

### Change 4: GLSL — three pipeline branches

**Location:** `_buildImageBlock()` (~line 3168)

#### 4a. GLSL constants (add after `hasPersp` declaration)

```javascript
const rad      = (img.radius || 0).toFixed(4);
const hasRadius = parseFloat(rad) > 0.001;
```

#### 4b. `applyRadius` helper (add after `applyMirrorUV`, before `let pipeline`)

```javascript
const applyRadius = (varName, maskVar) => {
    if (!hasRadius) return '';
    // Rounded-rect SDF in per-tile UV space [0,1].
    // At rad=0 the shape is a rectangle (no-op vs step bounds).
    // At rad=0.5 the shape is a circle.
    // smoothstep gives 1px antialiased edge.
    return (
        `    { vec2 _rq = abs(${varName} - 0.5) - (0.5 - ${rad});\n` +
        `      float _rd = length(max(_rq, 0.0)) + min(max(_rq.x, _rq.y), 0.0) - ${rad};\n` +
        `      ${maskVar} *= 1.0 - smoothstep(-0.004, 0.004, _rd); }\n`
    );
};
```

Why `*=` not `=`: spacing already multiplied `_gapMask` down in the gap zone. We multiply into it rather than replace, so spacing + radius compose correctly.

#### 4c. Non-tiled pipeline

Replace the hard `step()` bounds check:

```javascript
// OLD
`    float _inBounds = step(0.0,_uInstanced.x)*step(_uInstanced.x,1.0)*step(0.0,_uInstanced.y)*step(_uInstanced.y,1.0);\n` +
`    _gapMask = _inBounds;\n` +
```

With the SDF (note: `_uInstanced` is already `_u + 0.5`, in [0,1] for visible area):

```javascript
// NEW
`    { vec2 _rq = abs(_uInstanced - 0.5) - (0.5 - ${rad});\n` +
`      float _rd = length(max(_rq, 0.0)) + min(max(_rq.x, _rq.y), 0.0) - ${rad};\n` +
`      _gapMask = 1.0 - smoothstep(-0.004, 0.004, _rd); }\n` +
```

When `rad = 0.0000`: the SDF degenerates to a step function — identical visual to before, except the boundary has 1px antialiasing instead of a hard clip. Fully backward compatible.

#### 4d. Tiled pipeline — add `applyRadius` after `applyMirrorUV`

```javascript
pipeline = groupSpinLines +
    applySkew('_u') +
    applyPersp('_u') +
    `    float _gapMask = 1.0;\n` +
    aspectPreScale('_u') +
    applyTileUV('_u', sizeBase, '_gapMask', '_dx', '_dy') +
    applyMirrorUV('_u') +
    applyRadius('_u', '_gapMask');   // ← add this line only
```

After `applyTileUV`, `_u` is in [0,1] per tile (spacing already remapped inside `applyTileUV`). The SDF clips the tile corners in that space. `hasRadius` guard means zero-radius presets emit no extra GLSL.

#### 4e. Tunnel pipeline — same addition for both A and B layers

```javascript
applyMirrorUV('_uA') +
applyRadius('_uA', '_gapMaskA') +   // ← add
`    vec2 _uB = _u;\n` +
...
applyMirrorUV('_uB') +
applyRadius('_uB', '_gapMaskB');    // ← add
```

---

## Why the SDF Doesn't Affect Tile Size

The SDF only modifies `_gapMask` (alpha). It does not touch `_u` (the UV used to sample the texture). Tile size is controlled by `sizeBase` inside `applyTileUV`. The two are completely independent.

The "smaller tile" report from before was 100% caused by the generic handler index-shift setting `entry.spacing` while the radius slider moved. Fix Change 1 and the GLSL changes are correct as-is.

---

## What NOT to Change

- `applyTileUV` — do not touch it
- `aspectPreScale` — do not touch it
- The `sliderKeys` array — do not touch it
- The Size slider event handler — do not touch it
- The generic handler logic — only append one `:not()` to the selector string

---

## Implementation Order

1. Add `:not(.layer-radius-sl)` to exclusion list → verify in browser that no existing slider breaks
2. Add HTML slider row → verify it appears in the UI
3. Add dedicated event handler → verify `entry.radius` updates correctly
4. Add GLSL constants + `applyRadius` helper → no visible change yet (hasRadius=false at default)
5. Apply non-tiled pipeline change → test with a non-tiled image
6. Apply tiled pipeline change → test with a tiled image at various Spacing values
7. Apply tunnel pipeline change → test tunnel mode

Each step is independently verifiable before moving to the next.
