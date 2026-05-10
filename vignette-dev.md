# Room Tab Development Plan

## Overview
New "Room" section in the Palette tab for projection-safe lighting controls. Targets venues where bright whites and center hotspots are problematic (clubs, theaters, close-projection setups).

## Motivation
- Dance floors: bright whites = turning the lights on, hurts eyes
- Big projections: white washes are overpowering
- Need granular control over brightness distribution, not just global dimming

---

## Phase 1: White Cap (Immediate)

### UI
- **Type**: Slider
- **Label**: "White Cap"  
- **Position**: New "Room" subsection in Palette tab
- **Range**: 0.50 - 1.00 (default 1.00 = no cap)
- **Step**: 0.01

### Behavior
Hard ceiling on maximum pixel luminance. Any pixel brighter than the cap gets scaled down proportionally.

```glsl
// In buildStudioPostFxGlsl()
if (whitecap < 1.0) {
    float lum = dot(ret.rgb, vec3(0.299, 0.587, 0.114));
    if (lum > whitecap) {
        ret.rgb *= (whitecap / lum);
    }
}
```

### BaseVals
```javascript
whitecap: 1.0,  // 1.0 = disabled
```

### Implementation Points
- Add to `_buildPaletteSliders()` configs
- Add to BLANK baseVals
- Add GLSL to `buildStudioPostFxGlsl()` after existing effects
- Add `_syncPaletteSliders()` sync logic

---

## Phase 2: Expand Darken Center (Vignette)

Current `darken_center` is a boolean toggle in butterchurn's native path. Move to custom shader for control.

### New Controls (Replace Toggle)

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| Vignette | Toggle | on/off | off | Master enable |
| Center X | Slider | 0-1 | 0.5 | Darkening center point |
| Center Y | Slider | 0-1 | 0.5 | Darkening center point |
| Radius | Slider | 0-1 | 0.5 | Size of darkened area |
| Strength | Slider | 0-1 | 0.5 | How dark the center gets |
| Fade | Slider | 0-1 | 0.3 | Gradient edge: 0 = hard circle, 1 = feathered to edge |

### Why Center is Powerful
- Not just "darken" — it's a creative effect
- Can vignette to corners instead of center (set Center X/Y to 0 or 1)
- Animate Center X/Y for spotlight follow effect

### Fade Behavior Explained

```
Fade = 0 (Hard Circle):          Fade = 0.5 (Gradient):         Fade = 1.0 (Super Soft):

  ████████████                    ▓▓▓▓████▓▓▓▓                   ░░░▓▓██▓▓░░░
  ████████████                    ▓▓████████▓▓                   ░▓▓████▓▓░
  ████████████                    ████████████                   ▓▓██████▓▓
  ████████████                    ████████████                   ▓██████████
  ████████████                    ▓▓████████▓▓                   ▓▓██████▓▓
  ████████████                    ▓▓▓▓████▓▓▓▓                   ░▓▓████▓▓░
  
  Dark | Edge                     Fades gradually                Barely visible edge
```

**At 0%**: Solid circle of darkness. Sharp, defined edge like a spotlight cutoff.  
**At 50%**: Gradient from dark center to normal at edge. Film camera look.  
**At 100%**: Very subtle — darkens most of frame, barely fades at outer edge.

### BaseVals Migration
```javascript
// Remove:
darken_center: 0,

// Add:
vignette: 0,        // 0/1 toggle
vignette_cx: 0.5,   // center X
vignette_cy: 0.5,   // center Y
vignette_radius: 0.5,
vignette_strength: 0.5,
vignette_fade: 0.3,
```

### GLSL Implementation
```glsl
if (vignette != 0) {
    vec2 center = vec2(vignette_cx, vignette_cy);
    float dist = distance(uv, center);
    float edge = vignette_radius;
    float mask = smoothstep(edge, edge * (1.0 - vignette_fade), dist);
    ret.rgb *= (1.0 - mask * vignette_strength);
}
```

---

## Phase 3: Room Section Layout

### Proposed Structure (Palette Tab)

```
Appearance
├── Brightness
├── Trail
├── Saturation
├── Hue Rotate
└── [existing toggles...]

Room                          ← NEW SECTION
├── White Cap         [●───────] 100%
├── Vignette          [ON/OFF]
│   ├── Center X      [──●────] 50%
│   ├── Center Y      [──●────] 50%
│   ├── Radius        [──●────] 50%
│   ├── Strength      [──●────] 50%
│   └── Feather       [─●─────] 30%
```

### UI Behavior
- Vignette toggle OFF → all sub-sliders disabled (grayed)
- Vignette toggle ON → sliders active
- White Cap always active (1.00 = neutral)

---

## Technical Notes

### Shader Injection Point
Both effects go in `buildStudioPostFxGlsl()` at the end of post-processing:

```glsl
/* STUDIO_POST_FX */
if (brighten != 0) ret = sqrt(ret);
if (darken != 0) ret = ret * ret;
if (solarize != 0) ret = ret * (1.0 - ret) * 4.0;
if (invert != 0) ret = 1.0 - ret;

// NEW: Room controls
if (whitecap < 1.0) {
    // ... white cap logic
}

if (vignette != 0) {
    // ... vignette logic  
}
```

### Toggle Migration Strategy
`darken_center` is currently a native butterchurn toggle. Migration path:

1. Add new `vignette` controls (slider-based)
2. When loading old presets with `darken_center: 1`, auto-convert:
   - `vignette = 1`
   - `vignette_strength = 0.5`
   - `vignette_radius = 0.5`
3. Remove native `darken_center` from UI (keep in baseVals for backward compat)

---

## Preset Compatibility

| Scenario | Behavior |
|----------|----------|
| New preset | Room controls in baseVals, custom shader injection |
| Old preset with `darken_center` | Auto-migrate to new vignette system on load |
| Bundled MilkDrop presets | Room controls default to neutral (no change) |

---

## Future Ideas (Out of Scope)

- **Edge Darkening** (inverse vignette — darken corners instead of center)
- **Color Temperature** (warm/cool shift for venue lighting)
- **Projection Mode Presets** (Club = 85% cap + vignette, Theater = 70% cap + heavy vignette)
- **Animated Vignette** (pulse vignette size/strength to bass)

---

## Dev Log

### 2026-05-06
- Brainstormed white cap feature for projection safety
- Expanded scope to include vignette controls
- Decided on "Room" as section name
- Created this planning doc
- Performed code audit for surgical implementation

---

## Surgical Implementation Audit (Phase 1: Desaturate Whites) ✓ IMPLEMENTED

### Target: Single Slider in Appearance Section

**Rationale**: Desaturate Whites targets ONLY near-white colors (high brightness + low saturation), leaving vivid colors untouched. Perfect for projection venues where white washes hurt eyes but you want to keep the neon colors popping.

### Implementation Summary

**1. Slider Registration (`_buildPaletteSliders`, line 719)**
```javascript
{ id: 'ps-desaturate-whites', label: 'Desaturate Whites', min: 0, max: 1.0, step: 0.01, value: BLANK.baseVals.desaturate_whites, decimals: 2, key: 'desaturate_whites', reInject: true }
```

**2. BaseVals Defaults (line 166)**
```javascript
desaturate_whites: 0.0,       // 0 = off, 1 = full desaturation of whites
desaturate_threshold: 0.85,   // Brightness where effect starts
desaturate_range: 0.15,       // Fade zone for smooth transition
```

**3. Sync Registration (`_syncPaletteSliders`, line 4255)**
```javascript
this._syncSlider('ps-desaturate-whites', bv.desaturate_whites ?? 0.0, 0, 1.0, 2);
```

**4. Shader Injection - Four Places:**

**A. `buildStudioPostFxGlsl()` - Added desaturate params:**
```javascript
function buildStudioPostFxGlsl(sat, hue, desaturateWhites = 0.0, desaturateThreshold = 0.85, desaturateRange = 0.15) {
    // ...
    const desatWhiteLine = (dw <= 0.001) ? '' :
        `\n    { float _dw_lum = dot(ret.rgb, vec3(0.299, 0.587, 0.114));\n      float _dw_sat = max(ret.r, max(ret.g, ret.b)) - min(ret.r, min(ret.g, ret.b));\n      float _dw_whites = smoothstep(${Math.max(0, dt-dr).toFixed(4)}, ${dt.toFixed(4)}, _dw_lum) * (1.0 - smoothstep(0.0, 0.2, _dw_sat));\n      ret.rgb = mix(ret.rgb, vec3(_dw_lum), _dw_whites * ${dw.toFixed(4)}); }`;
    return `    /* STUDIO_POST_FX */\n    ...${desatWhiteLine}${satLine}${hueLine}\n`;
}
```

**B. `injectStudioPostFx()` - Passes desaturate params:**
```javascript
const dw = (opts && opts.dw != null) ? opts.dw : 0.0;
const dt = (opts && opts.dt != null) ? opts.dt : 0.85;
const dr = (opts && opts.dr != null) ? opts.dr : 0.15;
const glsl = buildStudioPostFxGlsl(sat, hue, dw, dt, dr);
```

**C. `loadBundledPreset()` - Injects for bundled presets:**
```javascript
this.currentState.comp = injectStudioPostFx(_bundledRaw, { 
    sat: _bbv.studio_saturation ?? 1.0, 
    hue: _bbv.studio_hue_rotate ?? 0, 
    dw: _bbv.desaturate_whites ?? 0.0,
    dt: _bbv.desaturate_threshold ?? 0.85,
    dr: _bbv.desaturate_range ?? 0.15
});
```

**D. `_buildCompShader()` - Injects for dynamic shaders:**
```javascript
const _dw = _bv.desaturate_whites ?? 0.0;
const _dt = _bv.desaturate_threshold ?? 0.85;
const _dr = _bv.desaturate_range ?? 0.15;
this.currentState.comp = injectStudioPostFx(_rawComp, ..., { dw: _dw, dt: _dt, dr: _dr });
```

**E. `_rebuildPostFx()` - Rebuilds on slider change:**
```javascript
const opts = { sat: bv.studio_saturation ?? 1.0, hue: bv.studio_hue_rotate ?? 0, dw: bv.desaturate_whites ?? 0.0, dt: bv.desaturate_threshold ?? 0.85, dr: bv.desaturate_range ?? 0.15 };
```

### Files Modified
- `/src/editor/inspector.js` — All changes (slider, baseVals, sync, 4 shader injection points)

### How It Works
- **Value = 0.00**: No effect — all colors vivid
- **Value = 0.50**: Whites partially muted, vivid colors unchanged
- **Value = 1.00**: Whites become pure gray, vivid colors still pop

### GLSL Logic
```glsl
// Calculate luminance (brightness)
float _dw_lum = dot(ret.rgb, vec3(0.299, 0.587, 0.114));

// Calculate saturation (colorfulness)
float _dw_sat = max(ret.r, max(ret.g, ret.b)) - min(ret.r, min(ret.g, ret.b));

// "Whiteness" = bright AND desaturated
float _dw_whites = smoothstep(threshold - range, threshold, _dw_lum) 
                 * (1.0 - smoothstep(0.0, 0.2, _dw_sat));

// Mix toward gray based on whiteness * desatAmount
ret.rgb = mix(ret.rgb, vec3(_dw_lum), _dw_whites * desaturateWhites);
```

**Why this works**: 
- Targets only pixels that are BOTH bright (high luminance) AND near-gray (low saturation)
- Vivid yellows, pinks, cyans have high saturation → unaffected
- White/gray pixels have low saturation → desaturated toward luminance value

---

## Notes

### URL Preset Loading (?preset=NAME)

The editor loading a preset from URL (e.g., `?preset=cope%2C%20martin...`) is **expected behavior**, not a bug. This happens when clicking **"Remix in Studio"** from the main visualizer. The `?preset=` or `?custom=` parameter tells the editor to load that specific preset for remixing instead of starting with the default Shift variation.

To start fresh with Shift, navigate to `/editor.html` without any URL parameters.

---

## Status: **IN PROGRESS** — Layer-Based Vignette Implementation

### What We Learned (2026-05-06 Session)

**Attempt 1: White Cap (Hard Ceiling)**
- Capped all pixels above threshold → made everything bland
- Vivid yellows, cyans, magentas all got crushed
- User hated it: "no one would want it"
- **Reverted**

**Attempt 2: Desaturate Whites (Smart Detection)**
- Targeted only bright + desaturated pixels
- GLSL logic: `if (lum > 0.75 && sat < 0.25) desaturate`
- Problems:
  - Performance hit from shader recompilation on every slider move
  - Effect barely visible in practice
  - MilkDrop's varying output levels made threshold unreliable
- **Reverted**

**Root Cause Discovery:**
MilkDrop `baseVals` (like `gammaadj`, `decay`) are **opt-in per preset**. The preset author decides whether to use them:
```glsl
// Preset that respects Brightness slider:
ret *= gammaadj;

// Preset that ignores it:
ret *= 2.0;  // hardcoded, slider does nothing
```
This explains why **Trail** works on some presets but not others.

### Decision: PARK White/Desaturation

**Why:** No reliable way to override preset brightness without:
- Recompiling shaders constantly (performance hit)
- Breaking preset author's intent
- Making everything look bland

**Alternative path:** Post-process at canvas level (future research)

---

## Next Focus: **Vignette / Focused Dark Ring** ✓ ACTIVE

### Implementation Plan (Layer-Based)

**Position in UI:** Bottom of Visual Effects section, just above Audio Reactivity

---

### Why This Works Better

**Vignette is spatial, not color-based:**
- Darkens edges/corners (or center) regardless of what's there
- Doesn't care about preset colors or shader logic
- Works on 100% of presets automatically
- Creative effect, not just "fix it" tool

### UI Placement (Layer Controls)

**Location:** Bottom of Visual Effects section, directly above Audio Reactivity divider

```
┌─ Layer Card ─────────────────────────┐
│  ...                               │
│  Visual Effects                    │
│  ├── Chromatic  [──●────]         │
│  ├── Posterize  [Off 2 4 8...]    │
│  ├── Edge       [Off · On]        │
│  ├── Luma Key   [sliders...]      │
│  ├── Wave       [sliders...]      │
│  ├── Color FX   [sliders...]      │
│  ├── Texture    [sliders...]      │
│  │                                │
│  ├─ **Vignette** ← NEW SECTION    │
│  │  [Toggle] Enable               │
│  │                                │
│  │  Center X    [──●────]  0.50   │
│  │  Center Y    [──●────]  0.50   │
│  │  Radius      [──●────]  0.50   │
│  │  Strength    [──●────]  0.50   │
│  │  Feather     [─●─────]  0.30   │
│  │                                │
├─────── section-divider ────────────┤
│  Audio Reactivity                  │
│  ├── Source     [Bass ▼]          │
│  ...                               │
└─────────────────────────────────────┘
```

### Implementation Audit

Based on code audit of `/src/editor/inspector.js`:

| Area | Line Range | Purpose |
|------|------------|---------|
| Layer defaults (entry) | ~2244 | Add `vignette`, `vignetteCX`, `vignetteCY`, `vignetteRadius`, `vignetteStrength`, `vignetteFeather` |
| Normalization | ~5554 | Add same keys to `_normalizeImageEntry()` D object |
| Layer UI HTML | ~3191-3280 | Insert vignette controls after Texture section, before Audio Reactivity divider |
| Event wiring | ~3350-4000 | Add slider event listeners for vignette controls |
| GLSL builder | ~4847 | Add vignette calculation in `_buildImageBlock()` after texture sampling |

### Layer Default Values

```javascript
// In _addImageLayer() ~line 2244 and _normalizeImageEntry() ~line 5554
vignette: 0,              // 0 = off, 1 = on
vignetteCX: 0.5,          // center X (0-1)
vignetteCY: 0.5,          // center Y (0-1)
vignetteRadius: 0.5,     // radius of darkened area (0-1)
vignetteStrength: 0.5,    // how dark it gets (0-1)
vignetteFeather: 0.3,     // edge softness (0-1)
```

### GLSL Implementation (in _buildImageBlock)

**Location:** After all texture sampling and color effects (~line 5440), before the final `blendLine` execution.

```glsl
// Vignette: darken based on distance from configurable center
if (vignetteEnabled) {
    float _vignetteDist = distance(_suv, vec2(vignetteCX, vignetteCY));
    float _vignetteEdge = vignetteRadius;
    float _vignetteMask = smoothstep(_vignetteEdge, _vignetteEdge * (1.0 - vignetteFeather), _vignetteDist);
    _src.rgb *= (1.0 - _vignetteMask * vignetteStrength);
}
```

Where `_suv` is the sampling UV (either `_u` for tiled, `_uA/_uB` for tunnel, or `_uInstanced` for non-tiled).

### Files to Modify

1. **`/src/editor/inspector.js`** — All changes
   - Line ~2244: Add defaults to `_addImageLayer()` entry object
   - Line ~5554: Add to `_normalizeImageEntry()` D object
   - Line ~3191-3280: Add UI HTML in `_mountLayerCard()`
   - Line ~3350-4000: Wire up event listeners
   - Line ~4847: Add GLSL generation in `_buildImageBlock()`

### UI Controls Detail

| Control | Type | Range | Default | Description |
|---------|------|-------|---------|-------------|
| Vignette | Toggle | on/off | off | Master enable |
| Center X | Slider | 0-1 | 0.5 | Horizontal center point |
| Center Y | Slider | 0-1 | 0.5 | Vertical center point |
| Radius | Slider | 0-1 | 0.5 | Size of darkened area |
| Strength | Slider | 0-1 | 0.5 | How dark it gets |
| Feather | Slider | 0-1 | 0.3 | Edge softness (0=hard edge, 1=very soft) |

**Note:** Per discussion, simplified from the original plan:
- Removed "Target: Center/Edges" toggle (can achieve edge vignette by setting Center X/Y to corners)
- Removed color tint (keep it simple - darken only)
- Kept the core spatial controls

**Status:** Ready for implementation.
