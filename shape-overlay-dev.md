# Screen Overlay Feature

> **Status:** ✅ **SHIPPED & COMPLETE** — May 10, 2026

## Overview
Full-screen colored shape overlay per layer. Draws a colored rectangle/circle/rounded shape anywhere on screen. Each overlay composites **immediately after its own layer**, so layers higher in the stack always render on top of any overlay below them.

## Use Cases
- **Layer masking**: Layer 1 puts dark overlay in top-left, Layer 2 positions content in that area
- **Vignette effect**: Large circle/ellipse around center with dark color
- **Area highlight**: Light box to draw attention to specific screen region
- **Cover layer**: Mask out horizon/land in video, reveal only sky for overlay

## Controls

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| Enable | Toggle | on/off | off | Master toggle for overlay |
| Center | XY Pad | 0-1 | 0.5, 0.5 | Position of overlay center on full screen |
| Width | Slider | 0-1 | 0.5 | How wide the shape is (0=thin, 1=full screen) |
| Height | Slider | 0-1 | 0.5 | How tall the shape is (0=short, 1=full screen) |
| Corner | Slider | 0-1 | 0.3 | Corner roundness (0=sharp square, 1=fully rounded/circle) |
| Strength | Slider | 0-1 | 0.5 | Opacity of overlay (0=invisible, 1=fully covers) |
| Feather | Slider | 0-1 | 0.3 | Edge softness (0=hard edge, 1=very soft) |
| Color | Color | #RRGGBB | #000000 | Overlay color (black=darken, white=lighten, any color) |

## Examples

### Small square in corner
- Center: top-right corner of XY pad
- Width: ~0.2, Height: ~0.2
- Corner: ~0 (sharp)
- Color: #000000, Strength: ~0.7

### Classic vignette
- Center: middle of XY pad
- Width: ~0.8, Height: ~0.8
- Corner: ~1 (fully rounded)
- Color: #000000, Strength: ~0.5
- Feather: ~0.3

### Bottom bar with soft edges
- Center: bottom of XY pad
- Width: ~0.9, Height: ~0.3
- Corner: ~0.4
- Feather: ~0.2

### Cover video land area
- Center: bottom of XY pad
- Width: ~1.0, Height: ~0.5
- Corner: ~0.1
- Color matching background to mask land

## Technical Implementation

### UI Label vs Internal Names
- **UI Label**: "Overlay" (in layer controls section)
- **Internal Properties**: Still use `vignette` prefix for backwards compatibility (`vignette`, `vignetteCX`, `vignetteCY`, `vignetteW`, `vignetteH`, `vignetteCorner`, `vignetteStrength`, `vignetteFeather`, `vignetteColor`)

### Location
`/src/editor/inspector.js` — Layer controls UI + composite shader generation

### GLSL (in `_buildImageBlock`)
The overlay is baked **inside** `_buildImageBlock`, immediately after the blend line for that layer:

```glsl
// At the end of each layer's block, after blendLine:
col = mix(col, vec3(${vR}, ${vG}, ${vB}), _vsa * ${vStrength});
```

This means the full composite order is:
1. Layer 1 blends into `col` → Layer 1's overlay applies
2. Layer 2 blends into `col` → Layer 2's overlay applies (if set)
3. Layer 3 blends into `col` → sits on top of all overlays below

### Key Points
- Runs **per-layer**, inline within `_buildImageBlock` — NOT in a separate post-loop
- Uses `uv` (screen coordinates 0-1), NOT image UV coordinates
- Rounded rectangle SDF with morphable corners
- Smoothstep for feathered edges
- Mix with strength for opacity control
- GLSL locals prefixed `_vs*` to avoid name collision with other layer locals

### Bug Fixed: Overlay Covered All Layers (May 10, 2026)
**Bug:** The overlay was drawn in a second loop after ALL layers had composited, so any layer added on top of a layer-with-overlay was incorrectly rendered behind the overlay.

**Root cause:** Originally used a separate post-loop in `_buildCompShader`:
```javascript
// WRONG — ran after all layers
for (const img of visibleImages) {
    if (!img.vignette) continue;
    body += `  { ... col = mix(...); }\n`;
}
```

**Fix:** Moved overlay GLSL into `_buildImageBlock`, emitted immediately after `blendLine`. Removed the post-loop entirely.

## Layer Defaults
```javascript
vignette: 0,              // 0 = off, 1 = on
vignetteCX: 0.5,         // center X (0-1)
vignetteCY: 0.5,         // center Y (0-1)
vignetteW: 0.5,          // width (0-1)
vignetteH: 0.5,          // height (0-1)
vignetteCorner: 0.3,     // corner roundness (0-1)
vignetteStrength: 0.5,   // opacity (0-1)
vignetteFeather: 0.3,    // edge softness (0-1)
vignetteColor: '#000000', // overlay color
```

## History
- **May 10, 2026**: Implemented and shipped through multiple iterations
  - Started as "Vignette" (darkening effect) — confusion about scope and behavior
  - Revised to full-screen overlay concept — shape drawn at composite level
  - Bug found: overlay rendered on top of ALL layers regardless of stack position
  - **Fixed**: moved overlay GLSL into `_buildImageBlock` so layer ordering is respected
  - Renamed to "Screen Overlay" in docs to match actual functionality
- UI label: "Overlay" (in layer controls)
- Internal property names kept as `vignette*` for backwards compatibility

**Status**: ✅ COMPLETE — Layer ordering correct, ready for VJ workflows

## Quick Start
1. Add an image/GIF/video layer
2. Scroll to "Overlay" section (below Grain, above Audio Reactivity)
3. Enable toggle
4. Drag XY pad to position the shape on screen
5. Adjust Width/Height for size, Corner for roundness
6. Set Color and Strength for the overlay appearance
7. Add another layer and position it in the overlay area!
