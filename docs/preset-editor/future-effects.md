# Future Image Effects — Development Spec

> **Reference:** Chromatic Aberration sets the bar — organic, wavy, alive. Every effect should feel like it's breathing with the music.

---

## Core Principles

- **Audio-reactive by default** — effects should pulse, breathe, or react to bass/mid/treble
- **Per-layer control** — each of the 5 image layers gets independent effect parameters
- **Composable** — effects stack: Chromatic + Ripple + Glitch = unique looks
- **Performance first** — single-pass shaders where possible, no FBO ping-pong
- **Meaningful ranges** — sliders should feel responsive (like Chromatic's squared curve)

---

## Phase 1 — Distortion & Displacement Effects

### 1.1 Ripple / Wave Displacement
**Visual:** Concentric waves emanating from center (or custom origin), distorting the image like water.

**Parameters:**
- **Amplitude** (0-0.5) — wave height in UV units
- **Frequency** (0-20) — ripples per screen width
- **Speed** (0-4) — animation rate
- **Decay** (0-1) — radial falloff (center = strong, edges = weak)
- **Origin** (XY pad) — wave center point, default screen center
- **Audio Reactivity** — bass drives amplitude spikes

**GLSL approach:** `uv += sin(length(uv - origin) * freq - time * speed) * amp * decay`

---

### 1.2 Barrel / Pinch Distortion
**Visual:** Fish-eye barrel or pinch squeeze, like looking through a lens.

**Parameters:**
- **Strength** (-1 to 1) — negative = barrel/bulge, positive = pinch
- **Radius** (0-1) — effect radius from center
- **Center** (XY pad)

**GLSL approach:** Radial displacement with `pow(length(uv - center), strength)`

---

### 1.3 Swirl / Vortex
**Visual:** Spiral twist around a center point, like a whirlpool.

**Parameters:**
- **Strength** (-2 to 2) — rotation amount, negative = counter-clockwise
- **Radius** (0-1) — falloff distance
- **Speed** (0-3) — auto-rotation of the swirl itself
- **Center** (XY pad)

**GLSL approach:** `angle += strength * (1.0 - length(uv - center) / radius)`

---

### 1.4 Heat Haze / Turbulence
**Visual:** Organic, chaotic displacement like hot air or underwater distortion.

**Parameters:**
- **Intensity** (0-0.3) — max displacement amount
- **Scale** (0.1-5) — noise frequency
- **Speed** (0-2) — flow animation rate
- **Complexity** (1-4 octaves) — layered noise detail

**GLSL approach:** Simplex/Value noise with time offset, multiple octaves

---

## Phase 2 — Glitch & Digital Effects

### 2.1 Digital Glitch / Scanline Shift
**Visual:** RGB channel split on scanlines, random block shifts, datamoshing aesthetic.

**Parameters:**
- **Intensity** (0-1) — overall glitch strength
- **Speed** (0-4) — glitch change rate (higher = more chaotic)
- **Block Size** (1-50 pixels) — size of shifted regions
- **Vertical Shift** toggle — enable Y-axis displacement
- **Color Split** toggle — enable per-scanline RGB offset

**GLSL approach:** `floor(uv.y * blockCount)` hash → offset UVs per block

---

### 2.2 Pixelate / Mosaic
**Visual:** Retro pixelation or blocky mosaic effect.

**Parameters:**
- **Block Size** (1-100 pixels) — pixelation amount
- **Mode** — Pixelate (nearest) / Mosaic (average color)
- **Animate** toggle — blocks shift/pulse with beat

---

### 2.3 Scanlines / CRT
**Visual:** Vintage CRT scanlines with optional flicker and chromatic offset.

**Parameters:**
- **Opacity** (0-1) — scanline visibility
- **Thickness** (1-4 pixels)
- **Flicker** (0-1) — random brightness variation per frame
- **Chromatic Offset** (0-0.01) — R/G/B shift per scanline
- **Curve** (0-0.1) — barrel distortion for CRT screen shape

---

### 2.4 Datamosh / Frame Ghosting
**Visual:** Smearing pixels based on motion, leaving color trails.

**Parameters:**
- **Trail Length** (0-10 frames)
- **Decay** (0.5-0.99) — how fast trails fade
- **Threshold** (0-0.5) — only mosh pixels above this brightness delta

**Note:** Requires feedback buffer (previous frame). May be expensive.

---

### 2.5 Bad TV / VHS Glitch
**Visual:** Analog TV signal corruption — rolling bars, horizontal jitter, color bleeding, tracking errors. Classic 90s VHS aesthetic.

**Parameters:**
- **Noise Intensity** (0-1) — static/snow amount
- **Jitter** (0-0.1) — horizontal line displacement
- **Rolling Bars** toggle — slowly moving horizontal dark bands
- **Color Bleed** (0-0.5) — horizontal chroma smear (like bad coax)
- **Tracking** (0-1) — random vertical displacement glitches

**GLSL approach:** `hash(uv.y + time) * jitter` for per-line displacement

**Reference:** Inspired by Shadertoy "VHS Glitch" shaders and analog video degradation

---

### 2.6 Film Grain
**Visual:** Natural 35mm film grain — organic noise that moves every frame, not locked to screen pixels.

**Parameters:**
- **Intensity** (0-1) — grain opacity when blended
- **Size** (0.5-3) — grain particle size
- **Color vs Luma** toggle — chroma grain or luminance-only
- **Response** (-1 to 1) — negative = grain more visible in shadows, positive = highlights

**GLSL approach:** 3D simplex noise with `time` as third dimension for animated grain

**Reference:** [mattdesl/glsl-film-grain](https://github.com/mattdesl/glsl-film-grain), Martins Upitis film grain post

---

## Phase 3 — Color & Stylization Effects

### 3.1 Posterize / Bit Crush
**Visual:** Reduce color depth to N levels per channel, creating banding poster art look.

**Parameters:**
- **Levels** (2-32) — color steps per channel
- **Dither** toggle — Bayer dithering to smooth bands
- **Hue Shift** (0-1) — rotate color palette

---

### 3.2 Threshold / Edge Detect
**Visual:** Sobel edge detection — image becomes white lines on black (or colored lines).

**Parameters:**
- **Threshold** (0-1) — edge sensitivity
- **Invert** toggle — black lines on white vs white on black
- **Color Mode** — White / Tinted / Rainbow (hue based on edge angle)
- **Thickness** (1-3 pixels) — edge dilation

**GLSL approach:** Sobel kernel convolution on luminance

---

### 3.3 Halftone / Dots
**Visual:** Comic book / newspaper halftone dots, size based on brightness.

**Parameters:**
- **Dot Size** (2-20 pixels)
- **Angle** (0-90°) — halftone screen angle
- **Style** — Round / Diamond / Line
- **Color Mode** — Monochrome / CMYK / Custom

---

### 3.4 Bloom / Glow
**Visual:** Soft glow around bright areas, like overexposed film.

**Parameters:**
- **Threshold** (0-1) — brightness needed to bloom
- **Intensity** (0-2) — glow strength
- **Radius** (1-50 pixels) — blur spread
- **Iterations** (1-4) — quality vs performance tradeoff

**Note:** Requires separable blur pass. May need optimization.

---

### 3.5 Pixel Sorting
**Visual:** Algorithmic sorting of pixels by brightness along scanlines, creating melting/rain-like streaks. Think "oddly satisfying" glitch art aesthetic.

**Parameters:**
- **Threshold** (0-1) — only sort pixels above this brightness
- **Direction** — Horizontal / Vertical / Diagonal
- **Length** (10-500 pixels) — max streak length
- **Randomize** toggle — stochastic sorting for more organic feel
- **Audio Reactivity** — bass triggers longer sorting streaks

**GLSL approach:** Iterate along line until brightness < threshold, accumulate average color

**Reference:** [Pixel Sorting on Shader - Ciphrd](https://ciphrd.com/articles/pixel-sorting-on-shader-using-well-crafted-sorting-filters/)

---

### 3.6 Oil Paint / Watercolor
**Visual:** Simulated brush strokes — either oil paint impasto or bleeding watercolor edges.

**Parameters:**
- **Style** — Oil Paint / Watercolor / Sketch
- **Brush Size** (1-20 pixels) — convolution kernel size
- **Edge Preserve** (0-1) — how much to preserve edges vs smooth
- **Color Count** (3-32) — posterize levels (oil paint effect)

**Note:** Performance-heavy (requires large kernel convolution). Consider downsampling.

---

## Phase 4 — Advanced / Experimental

### 4.1 Displacement Map (Layer-to-Layer)
**Visual:** Use Layer 2 as a displacement source for Layer 1. Layer 2's brightness = offset amount.

**Parameters:**
- **Source Layer** (dropdown — other layers)
- **Strength X/Y** (-0.5 to 0.5) — displacement multiplier per axis
- **Smooth** toggle — blur the displacement map for smoother warping
- **Audio Reactive** — bass drives displacement strength

**Use cases:**
- Layer 2 = noise texture → organic warping of Layer 1
- Layer 2 = logo with alpha → displacement only where logo exists
- Layer 2 = video/GIF → animated distortion of Layer 1

---

### 4.2 Kaleidoscope Expansion
**Visual:** Current mirror has 6-slice kaleido. Expand to N-slice with rotation.

**Parameters:**
- **Slices** (2-16) — number of mirror segments
- **Rotation Speed** (-2 to 2) — kaleido rotation independent of image spin
- **Offset** (0-1) — radial offset from center
- **Mode** — Mirror / Repeat / Blend

---

### 4.3 Z-Depth / Parallax Stack
**Visual:** In tunnel mode, each layer at different "depth" phase for true 3D parallax.

**Parameters:**
- **Depth Offset** (-1 to 1) — layer's position in tunnel phase
- **Parallax Scale** (0-2) — how much depth affects scale
- **Blur by Depth** toggle — distant layers get blurrier

---

### 4.4 Radial / Zoom Blur
**Visual:** Motion blur radiating from center point, like warp speed or zooming camera. Organic streaking from a focal point.

**Parameters:**
- **Amount** (0-1) — blur strength
- **Center** (XY pad) — focal point
- **Quality** (4-32 samples) — sample count for smoothness
- **Audio Reactivity** — bass spikes = brief intense zoom

**GLSL approach:** `for(i=0; i<samples; i++) sample along ray from center`

---

### 4.5 Motion Blur / Directional Smear
**Visual:** Streaking in a specific direction — simulates fast pan or shaking.

**Parameters:**
- **Angle** (0-360°) — blur direction
- **Length** (0-50 pixels) — smear distance
- **Audio Reactive** — bass pulses extend the blur

---

### 4.6 Liquid / Oil-on-Water
**Visual:** Organic flowing patterns like oil floating on water, or marbled ink. Slow, hypnotic, constantly evolving.

**Parameters:**
- **Flow Speed** (0-1) — overall animation rate
- **Scale** (0.1-5) — pattern size
- **Complexity** (1-8) — number of layered noise octaves
- **Chaos** (0-1) — how "swirly" vs "flowy" the motion is
- **Color Mode** — Monochrome / Tinted / Full Spectrum

**GLSL approach:** Curl noise for divergence-free flow, multi-octave simplex

---

## Phase 5 — Reactive & Generative

### 5.1 Audio Waveform Overlay
**Visual:** Live audio waveform drawn ON TOP of or BEHIND the image layer.

**Parameters:**
- **Position** — Top / Bottom / Center / Behind image
- **Color** — waveform tint
- **Thickness** (1-10 pixels)
- **Smoothing** (0-1) — waveform interpolation
- **Scale** (0.1-2) — waveform amplitude

---

### 5.2 Beat Detection Flash
**Visual:** Whole layer flashes white (or custom color) on kick/snare detection.

**Parameters:**
- **Color** — flash tint
- **Decay** (0.01-0.5) — flash fade speed
- **Threshold** — beat detection sensitivity
- **Blend Mode** — Add / Screen / Replace

---

### 5.3 Spectrogram / EQ Bars
**Visual:** Classic frequency bars as overlay or mask for the image.

**Parameters:**
- **Bar Count** (4-64)
- **Orientation** — Horizontal / Vertical / Circular
- **Mask Mode** — Bars reveal image vs bars are drawn on top
- **Color Gradient** — customizable frequency→color mapping

---

## Implementation Priority Matrix

| Effect | Visual Impact | Performance Cost | Implementation Complexity | Priority |
|--------|---------------|------------------|---------------------------|----------|
| Ripple / Wave | High | Low | Low | **P1** |
| Barrel / Pinch | Medium | Low | Low | **P1** |
| Swirl / Vortex | High | Low | Low | **P1** |
| Digital Glitch | High | Low | Low | **P2** |
| Posterize | Medium | Very Low | Very Low | **P2** |
| Edge Detect | High | Low | Medium | **P2** |
| Film Grain | Medium | Low | Low | **P2** |
| Bad TV / VHS | High | Low | Low | **P3** |
| Pixelate | Low | Very Low | Very Low | **P3** |
| Scanlines / CRT | Medium | Low | Low | **P3** |
| Heat Haze | High | Medium | Medium | **P3** |
| Pixel Sorting | High | Medium | Medium | **P3** |
| Halftone | Medium | Medium | Medium | **P4** |
| Bloom ⚠️ | High | High | High | **P4** |
| Oil Paint / Watercolor ⚠️ | Medium | High | High | **P4** |
| Radial / Zoom Blur ⚠️ | High | Medium | Medium | **P4** |
| Motion Blur | Medium | Medium | Low | **P4** |
| Liquid / Oil-on-Water ⚠️ | Very High | Medium | High | **P5** |
| Displacement Map ⚠️ | Very High | Medium | High | **P5** |
| Kaleidoscope N-slice | Medium | Low | Medium | **P5** |
| Z-Depth Parallax | High | Low | Medium | **P6** |
| Audio Waveform | Medium | Low | Medium | **P6** |
| Beat Flash | Medium | Very Low | Low | **P6** |
| **Float Field / Depth Scatter** ⚠️ | **Very High** | Medium | Medium | **P6** |
| **Radial / Ring Clone** | **High** | Low | Low | **P6** |
| ✅ Continuous Spin (already shipped as `spinSpeed`) | High | Very Low | Very Low | ✅ Built |
| ❌ Warp-Follow UV | Low (in practice) | Low | Low | ❌ Tried & reverted 2026-05-05 — real ask was Float Field, see 6.1 |
| ✅ Pulse Opacity (already shipped as `opacityPulse`) | Medium | Very Low | Very Low | ✅ Built |

---

## Technical Notes

### Shader Architecture
Most effects fit this pattern in `_buildImageBlock()`:

```glsl
// Before texture sampling
vec2 _effectUV = _u;
_effectUV += /* distortion calculation */;
_effectUV = clamp(_effectUV, 0.0, 1.0); // prevent edge bleeding

vec4 _t = textureGrad(tex, _effectUV, dFdx(_u), dFdy(_u));

// After sampling (color effects)
_t.rgb = posterize(_t.rgb, levels);
```

### Audio Reactivity Integration
All effects should optionally accept `_r` (reactivity signal) from audio:

```glsl
float _effectAmp = baseAmp + _r * audioAmount;
```

### Performance Budget
- **Tier 1** (P1-P2): Must run at 60fps on 5 layers on mid-tier GPU
- **Tier 2** (P3-P4): Acceptable at 30fps on 3 layers, or 60fps on 1-2 layers
- **Tier 3** (P5+): Feature-flagged "experimental" or auto-disable if frame time > 16ms

### GPU Warnings & User Experience
**High GPU effects will show inline warnings** in the UI next to the effect controls. When a user enables a Tier 3 effect (Bloom, Oil Paint, Displacement Map, etc.), a subtle indicator appears: ⚠️ Heavy GPU use

**Tomorrow's plan:** Start with low/mid GPU effects (P1-P3) — Ripple, Swirl, Edge Detect, Film Grain, Digital Glitch. These run smoothly without warnings.

**Future heavy hitters** (P4-P5 with warnings):
- Bloom (multi-pass blur)
- Oil Paint / Watercolor (large convolution kernels)
- Displacement Map (extra texture sampling)
- Radial/Zoom Blur (many samples per pixel)
- Liquid/Oil-on-Water (multi-octave curl noise)

---

## Phase 6 — New Render Modes (Beyond Single / Tile / Tunnel)

Current image layer render modes are **Single** (one centered image), **Tile** (regular UV grid), and **Tunnel** (infinite zoom path). These are a new top-level mode dropdown — alternative ways the image is *instanced* across the canvas, not effects applied to a single instance.

---

### 6.1 Float Field (Depth Scatter)

**Visual:** N copies of the same image scattered across the canvas at randomised positions and sizes. Size implies depth — big instances feel close, small ones feel far away. The field slowly drifts and breathes. On a bass hit, closer (bigger) instances pulse or jolt harder than distant ones, giving a genuine depth-of-field reaction. Feels like floating through a cloud of the image — logos, faces, icons all at different distances.

**Why it's different from Tile:** Tile is a regular UV grid — every cell is the same size. Float Field is randomised position + scale per instance, creating an organic, non-uniform distribution that reads as 3D depth.

**Parameters:**
- **Count** (4–64) — number of instances (baked at shader-build time so no runtime loop overhead)
- **Size Min / Max** (0.03–0.5) — scale range; min = farthest instances, max = closest
- **Spread** (0–1) — how far instances can stray from center (0 = clustered, 1 = full canvas)
- **Drift Speed** (0–1) — how fast positions drift over time (organic float)
- **Depth Reactivity** — bass makes large instances pulse opacity/scale, small ones stay calm
- **Opacity by Depth** (0–1) — distant (small) instances can fade out, simulating atmosphere

**GLSL approach:** At shader build time, unroll N UV sample blocks with per-instance center/scale values. Positions update via `sin(time × driftSpeed × seedN)` per instance (co-prime frequencies for non-repeating motion — same trick as Wander). No loop needed — unrolled at JS build time, same as how the Scatter/Radial Clone idea handles multiple instances.

**Audio reactivity layer:** Each instance has a depth value (derived from its scale). Deep instances (large) get `_r × audioStrength × depthWeight`, shallow instances (small) get less — so a bass hit makes the close-up copies jump while background copies stay calm.

**Performance:** Medium. 20 instances adds 20 texture samples per pixel to the shader. Recommend a soft cap at 32 instances with a "⚠ High GPU" warning above 20. Same tradeoff as adding image layers.

**Connection to existing features:** Works naturally with Tunnel (each instance at a different tunnel depth = true 3D parallax), Wander (each instance gets an independent wander phase), Mirror (mirrored instances look like a kaleidoscope field). The Depth Stack entry in the brainstorm section is a simpler version of this for 2-layer setups.

---

### 6.2 Radial / Ring Clone

**Visual:** N copies arranged in a ring around the anchor point, like flower petals or a clock face. All copies are the same size, equidistant from the center. With audio reactivity the ring can expand/contract (ring radius pulses to beat) or rotate (all copies orbit together). With the Spin animation, each copy also spins in place.

**Parameters:**
- **Count** (2–16) — number of copies (baked at shader build time)
- **Ring Radius** (0–0.45) — distance from anchor
- **Mirror Alternating** toggle — flip every other copy for a kaleidoscope feel
- **Orbit Speed** (0–2) — the ring itself rotates over time (distinct from per-copy Spin)
- **Radius Reactivity** — bass pulses the ring radius outward

**GLSL approach:** Unroll N UV sample blocks. Per-instance center = `anchor + vec2(sin(2π×i/N + orbitAngle), cos(2π×i/N + orbitAngle)) × ringRadius`.

**Note:** Already sketched in `custom-preset-editor.md` Brainstorm as "Scatter / Radial Clone". Promoting here for full spec.

---

*Document initiated April 2026. Phase 6 added May 2026.*

---

## Research Sources & References

### GLSL Effect Collections
- [Shadertoy distortion effects](https://www.shadertoy.com/results?query=distortion) — The best source for working shader code
- [Shadertoy ripple/water effects](https://www.shadertoy.com/results?query=ripple+water)
- [Godot Shaders](https://godotshaders.com/) — Curated shader library with live demos
- [The Book of Shaders — Noise](https://thebookofshaders.com/11/) — Educational reference on noise functions
- [Harry Alisavakis — Glitch Shader](https://halisavakis.com/my-take-on-shaders-glitch-image-effect/) — Comprehensive glitch effect breakdown
- [GLSL noise functions](https://github.com/stegu/webgl-noise) — Production-ready noise implementations

### Technical References
- [MilkDrop shader reference](https://github.com/projectM-visualizer/projectm/wiki/Shader-Reference) — Our visualizer's lineage
- [Retro CRT shaders](https://github.com/libretro/slang-shaders/tree/master/crt) — Scanlines, curvature, phosphor glow
- [mattdesl/glsl-film-grain](https://github.com/mattdesl/glsl-film-grain) — Natural 3D grain implementation
- [Pixel Sorting on Shader - Ciphrd](https://ciphrd.com/articles/pixel-sorting-on-shader-using-well-crafted-sorting-filters/) — Advanced pixel sorting algorithm
- [Barrel Distortion](https://prideout.net/barrel-distortion) — Lens distortion math explained

### Audio-Reactive Inspiration
- [Butterchurn DeepWiki](https://deepwiki.com/jberg/butterchurn) — Our WebGL engine docs
- [MilkDrop preset equations](https://forums.winamp.com/forum/developer-center/visualizations-development/183827) — Classic audio-reactive patterns

---

## Developer Quick Start

### Adding a New Effect (Template)

1. **Add UI controls** in `_mountLayerCard()` around line ~1700 in `inspector.js`
   - Slider with appropriate range (use squared/cubic curves for better feel)
   - Toggle or dropdown for effect variants
   - Conditional show/hide (like Tunnel hides when Tile is off)

2. **Declare variables** in `_buildImageBlock()` around line ~2535
   ```javascript
   const effectAmt = (img.effectAmount || 0).toFixed(4);
   const hasEffect = parseFloat(effectAmt) !== 0;
   ```

3. **Generate GLSL** in the pipeline construction (around line ~2730)
   - UV distortion effects go BEFORE texture sampling
   - Color effects go AFTER sampling
   - Always clamp UVs: `clamp(_effectUV, 0.0, 1.0)`

4. **Add to priority matrix** in this doc with P1-P6 ranking
   - Add ⚠️ to effects with high GPU cost (Tier 3 / P4+)
   - These will show inline warnings in the UI

5. **Update docs:** `custom-preset-editor.md`, `README.md`, in-app guide

### Effect Categories (for code organization)

| Category | When Applied | Examples |
|----------|--------------|----------|
| UV Distortion | Pre-sampling | Ripple, Swirl, Heat Haze, Barrel |
| Color Manipulation | Post-sampling | Posterize, Tint, Hue Spin, Edge Detect |
| Blur/Glow | Post-sampling | Bloom, Radial Blur, Motion Blur |
| Overlay | Composite | Film Grain, Scanlines, VHS Noise |
| Layer-to-Layer | Pre-sampling | Displacement Map |

---

*Document initiated April 2026. Next step: Select P1 effects for implementation.*

### Suggested P1 Implementation Order
1. **Ripple/Wave** — Classic, highly visual, low complexity
2. **Swirl/Vortex** — Organic feel like Chromatic Aberration
3. **Edge Detect** — Instant "neon" look for any image
4. **Film Grain** — Subtle texture, rounds out the toolkit
