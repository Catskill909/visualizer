# Custom Preset Editor — Implementation Status

> **Status:** ✅ Built and working. This doc reflects the actual implementation.

---

## What's been built

A standalone editor at `editor.html` with a live butterchurn canvas on the left
and a tabbed inspector panel on the right. No page reload — every control is live.

### Tabs

| Tab | Controls |
|---|---|
| **Palette** | Base variation picker + color palettes + Wave/Glow/Accent color swatches |
| **Motion** | Zoom, Rotation, Warp amount & speed, Echo zoom & orientation |
| **Wave** | Mode grid (8 modes), Size, Opacity, Thickness toggle, Dots toggle, Additive toggle, Randomize |
| **Feel** | Decay (trail length), Gamma (brightness), Warp scale, Warp speed |
| **Images** | Drop up to 2 images with full per-layer controls (see below) |

### Base Variations

Nine starting-point snapshots in the Palette tab:

| Name | Description |
|---|---|
| **Color** *(default)* | Solid ambient glow — deep purple base that breathes slowly and reacts to bass. First thing users see when the editor opens. |
| **Clear** | Blank canvas — black screen, all defaults |
| **Drift** | Slow & dreamy — deep purple warp |
| **Pulse** | Neon heartbeat — bright blue circle wave |
| **Storm** | Chaotic energy — fast warp, white line waves |
| **Ripple** | Liquid rings — blue concentric ripple mode |
| **Radiate** | Warm spin — orange radial mode, slow rotation |
| **Scatter** | Acid dots — green dot mode, high gamma |
| **Bloom** | Soft center — pink center-line mode |

### Image Layers

Drop up to 2 images. Each layer has:

| Control | Range | Notes |
|---|---|---|
| Blend mode | Screen / Overlay / Additive / Multiply | Overlay is default |
| Tile | Toggle | ON by default — tiles the image across screen |
| Opacity | 0–1 | Base visibility |
| Beat Fade | 0–1 | Bass drives opacity up on kick |
| Size | 0.1–4 | Tile grid density |
| Spacing | 0–0.8 | Gap between tiles (only visible when Tile is ON) |
| Pulse | 0–2 | Bass drives size up (or down if Shrink is on) |
| Shrink | Toggle | Reverses pulse direction — shrinks on beat |
| Spin | -3–3 | Rotation speed (per-tile when Tile ON) |
| Orbit | 0–0.45 | Orbit radius around screen center |
| Bounce | 0–0.4 | Bass pushes image upward on beat |
| Tunnel | -2–2 | Infinite zoom through tiled field (+= toward, -= away) |
| Center (XY Pad) | 0–1 × 0–1 | Draggable anchor point — where the image is pinned. Orbit, bounce, spin all pivot around this. Default is screen center (0.5, 0.5). ↺ button resets to center. |
| **Sway Amount** | 0–0.4 | Sinusoidal left↔right oscillation amplitude |
| **Sway Speed** | 0–4 | Sway frequency (cycles/sec) |
| **Wander Amount** | 0–0.4 | Organic random-drift amplitude (layered sin noise) |
| **Wander Speed** | 0–2 | Wander drift rate |
| **Mirror** | Off / ↔ H / ↕ V / ✦ Quad / ✶ Kaleido | UV fold mode — applied after tiling. Stacks with all other controls. Kaleido = 6-slice polar fold. |
| **Tint Color** | Color swatch | Multiplies sampled image pixels by this color |
| **Hue Spin** | 0–2 | Rotates tint hue through full color wheel per second |
| Images Only | Toggle (header) | Hides base visualizer — black background + images only |
| **Canvas Mirror** | None / ↔ H / ↕ V / ✦ Both | Folds the entire rendered scene (warp buffer + all image layers) along one or both axes |

### Tunnel implementation

`pow(2, fract(t × speed))` seamless zoom — tiles repeat at exactly 2× scale so
the loop snap is invisible. Implemented as a **two-layer crossfade** where:
- Layer A uses `pow(2, phase)` (scale 1→2)
- Layer B uses `pow(2, phase−1)` (scale 0.5→1)
- Blend weight = `phase` — continuously interpolated across the full cycle
- At wrap: blend=1, B at scale 1.0 → A picks up at scale 1.0 → seamless

### Canvas Mirror

A scene-level UV fold applied **before** any sampling in the comp shader — so both the butterchurn warp feedback buffer (`sampler_main`) and all image layer positions are mirrored in lockstep.

**GLSL technique:** butterchurn's comp shader body is injected into a `main()` that already declares `vec2 uv = vUv;` as a local variable. Redeclaring `uv` in the same scope would cause a compile error; likewise `uv` is also declared as `in vec2 uv` in the fragment shader header (a read-only varying in GLSL ES 3.00). The fix is to declare a new local `uv_m` and use it everywhere:

```glsl
// Mirror H example — baked into shader_body GLSL
vec2 uv_m = vec2(1.0 - abs(uv.x * 2.0 - 1.0), uv.y);
vec3 col = texture(sampler_main, uv_m).xyz * 2.0;
// ...image layers use _u = uv_m - center, not uv - center
```

When mirror is `none`, `uv_m = uv` (no-op). All three branches (normal, solid-color, images-only) emit `uv_m` first, so it is always in scope for `_buildImageBlock()`.

---

### Solid color base (Color variation)

When the "Color" variation is active, the comp shader uses a constant base color
instead of the warp feedback buffer (`sampler_main`):

```glsl
float _breath = 0.55 + 0.45 * sin(time * 0.6);  // ~10-second breathe cycle
float _bass_b = 1.0 + bass * 0.5;               // beat pulse
vec3 col = vec3(r, g, b) * _breath * _bass_b;
```

Looks alive without audio (slow breathe). Reacts when audio plays (bass pulse).
Other variations restore the normal feedback-buffer base.

### Wave Thickness

`wave_thick` in butterchurn is binary (0/1) — 4 draw passes at ±2px offset.
Rendered as a toggle switch (not a slider). Most visible with: Size > 1.0 + Additive blend ON.

---

## Architecture

```
editor.html
└── src/editor/main.js        Entry: creates VisualizerEngine + EditorInspector
    └── src/editor/inspector.js   All UI logic — tabs, controls, GLSL generation
    └── src/editor/style.css      Editor-specific styles
```

**Key data flow:**
1. Every control writes into `this.currentState` (a butterchurn preset object)
2. `_buildCompShader()` regenerates the comp shader from image layer state
3. `_applyToEngine()` calls `engine.loadPresetObject(this.currentState, 0)` + re-binds textures

**Undo/redo:** `_preSnap()` / `_postSnap()` wrap every interaction. 50-deep stack.
Keyboard: Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z.

**Save:** Writes to `discocast_custom_presets` in localStorage via `createCustomPreset`.
Images are stored as raw pixel data in `this._imageTextures` (texName → `{data, width, height}`).

---

## Known butterchurn field names (traps)

| Correct | Wrong (historical typo) |
|---|---|
| `additivewave` | `wave_additive` |
| `wave_thick` | (binary 0/1, not float) |
| `wave_usedots` | — |

---

## Future ideas

- Audio-reactive orbit radius (orbit grows on bass)
- More blend modes
- Export / import preset as `.json`
- "Mine" tab in main app preset drawer (custom presets already write to the right localStorage key)
- Remix button in main app: open editor from existing preset
- Beat Shake / Jitter
- Strobe / Blink
- Scatter / Radial Clone
- Lissajous Path
- Depth Stack (Z-order offset for 2-image tunnel)

---

## Brainstorm — Image Layer Animation Controls

### ✅ Center / Anchor Point (XY Pad) — BUILT
Instead of always centering at (0.5, 0.5), a small 96×96 `<canvas>` pad with a draggable white dot sets where the image is anchored. The dot position maps directly to UV space so users can pin an image to any quadrant. Orbit, bounce, and spin all pivot around this anchor. A ↺ reset button returns to center.

---

### ✅ Sway — BUILT
Sinusoidal X oscillation baked into the center expression: `cx + sin(time × swaySpeed) × swayAmt`. Controls: **Sway Amount** (0–0.4) and **Sway Speed** (0–4). Stacks with Bounce for diagonal figure-8 motion. Sway + Wander together gives dreamy floating drift.

---

### ✅ Wander — BUILT
Two layered `sin()` terms at co-prime frequencies (0.7×, 0.9×, 1.3×, 1.7× of wanderSpeed) give organic non-repeating drift. Baked as GLSL center offset: `(sin(t×f1+p1)×0.6 + sin(t×f2+p2)×0.4) × wanderAmt`. Controls: **Wander Amount** (0–0.4) and **Wander Speed** (0–2). No GPU texture needed — pure arithmetic.

---

### ✦ Scatter / Radial Clone
Draw *N* copies of the image arranged in a ring around the center anchor. Controls: **Count** (2–12) and **Ring Radius** (0–0.45). Pairs beautifully with Spin (each clone rotates in place) and Pulse (ring expands on beat). A `Mirror` toggle flips alternating copies for a kaleidoscope feel.

---

### ✅ Mirror / Kaleidoscope — BUILT
Segmented control: **Off / ↔ H / ↕ V / ✦ Quad / ✶ Kaleido**. Applied as a UV fold *after* tiling (in [0,1] tile space) so it stacks with spin, tunnel, spacing, etc. Mirror H/V: `1 - abs(u × 2 - 1)` per axis (correct formula for [0,1] UV space — NOT `fract(u×0.5)×2−1` which was an earlier bug). Kaleido: 6-slice polar fold — `atan2` → mod into `π/3` sector → mirror → polar back to cartesian.

### ✅ Canvas Mirror — BUILT
Scene-level segmented control: **None / ↔ H / ↕ V / ✦ Both** in the Image tab header. Folds the entire comp-shader output — warp buffer AND all image layers move together. Uses `uv_m` local variable technique (see Canvas Mirror section above) to avoid GLSL redeclaration errors.

---

### 💥 Beat Shake / Jitter
On a strong kick, randomly displace the image by a small amount then spring back over ~4 frames. Controls: **Shake Amount** (0–0.08) and a **Decay** knob for how quickly it settles. Different feel to Bounce (which is directional up); Shake is omnidirectional panic energy.

---

### 🔦 Strobe / Blink
Image opacity pulses to a hard binary — fully visible on beat, black between beats. Controls: **Strobe Threshold** (the bass level that triggers it) and **Hold** (how long each flash lasts in frames). Distinct from Beat Fade which is a smooth ramp; Strobe is an instant cut.

---

### 🌀 Lissajous Path
The image center traces a Lissajous curve (figure-8 or more complex knotted paths) instead of a plain circle. Controls: **X Freq**, **Y Freq**, **Phase Offset**, and **Radius**. Freq ratios like 1:2 give figure-8, 3:2 gives a bow-tie, 3:4 gives a four-leaf clover. Could replace Orbit as a more general path type.

---

### ✅ Tint / Hue Shift — BUILT
Color swatch sets `tintR/G/B` which is multiplied onto `_src` before blending. When **Hue Spin > 0**, a full 3×3 hue rotation matrix is baked into GLSL using `cos(time × speed × 2π)` — rotates through the full wheel smoothly. Tint color and hue spin are independent: a blue tint + hue spin gives a color-wheel sweep biased toward blue.

---

### 🔭 Depth Stack (Z-order offset)
When 2 images are loaded, a **Z Offset** slider nudges the second image's tunnel phase so the two layers appear to be at different distances in 3D space during tunnel mode — they zoom at slightly different rates giving true depth separation.

---

### 🎯 Implementation notes
- **XY Pad for center**: render a `<canvas>` element (e.g. 120×120px) inside the layer card; `mousedown`/`mousemove` update `entry.cx` / `entry.cy`; dot drawn via `requestAnimationFrame`. No external deps needed.
- **Wander**: two `sin(time*f1 + phase1)` terms summed at different frequencies — cheap GLSL, no texture needed.
- **Scatter/Radial Clone**: unroll into N separate UV samples in the GLSL block; count is baked at shader-build time so no loop limit issues.
- **Mirror**: a single `abs(fract(uv) - 0.5) * 2.0` fold per axis before the existing tile pipeline.
