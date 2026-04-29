# Preset Image Tools — Dev Reference

> **Companion doc:** [custom-preset-editor.md](custom-preset-editor.md) · [preset-image-pan-dev.md](preset-image-pan-dev.md)
> All phases 1–6 shipped ✅. Document restructured to Shipped / Up Next format.

---

## ✅ Shipped — Full Feature List

### Infrastructure & UX

| Feature | Notes |
|---|---|
| **Up to 5 layers** | Generic N-layer array; UI cap at 5. Empty layers emit zero shader code. |
| **Collapsible cards** | Smart accordion — new layer auto-collapses others. Collapsed state persists in preset. |
| **Drag-to-reorder** | HTML5 DnD, handle-only drag initiator. DOM move (not rebuild) preserves event handlers. |
| **Inline layer rename** | Click to edit, Enter/blur commits, Escape cancels. Defaults to filename-without-ext. |
| **Solo / Mute** | Multi-select toggles. Solo any layer(s); mute hides independently. Both persist in preset. |
| **Reset this layer** | ↻ button. Restores all animation/style fields to default; preserves image identity. Undoable. |
| **Image resize on upload** | Standard: 1024px longest side. HD toggle: 2048px. Destructive — original never stored. |
| **File-type guard** | `accept` MIME+ext on all file inputs. JS guard rejects non-image drops with red toast. |
| **Delete confirmation** | Modal with filename, red Delete / Cancel. Backdrop/Escape cancels, Enter confirms. |
| **Dev HUD** | Backtick `` ` `` — frame time, VRAM estimate, layer count, last shader rebuild ms. |
| **Fast tooltips** | `data-tooltip` + CSS `::after`, 80ms delay. Applied across all controls. |
| **Onboarding modal** | Shows each session until "Never show again". Key: `discocast_onboarding_never`. Reset: `localStorage.removeItem('discocast_onboarding_never')`. |
| **Preview / Focus mode** | Expand icon in topbar (or `\` key) hides panel; canvas fills screen. Click canvas to restore. |
| **Undo / Redo** | 50-deep stack. `⌘Z` / `⌘⇧Z`. All controls wrapped in `_preSnap` / `_postSnap`. |
| **A/B compare** | Hold button to preview saved state; release restores. |
| **Save** | localStorage + IndexedDB for images. Round-trips through My Presets in main app. |

---

### Per-layer Controls — Transform

| Control | Range | Notes |
|---|---|---|
| **Size** | 0–1 (cubic curve) | Scales the tile/image. Pulse drives audio-reactive size. |
| **Angle** | −180° to +180° | Static rotation offset, composes with Spin. |
| **Skew X / Y** | −1 to +1 | 2D shear. Applied after rotation, before sizing. All pipeline paths. |
| **Persp X / Y** | −1 to +1 | Projective warp — lines converge to vanishing point. Applied after skew. Singularity clamped to 0.1. |
| **Tile Width / Height** | 0.25–4.0 (squared curve) | Independent tile cell shape. 1.0 = native aspect. Tile-mode only. |

### Per-layer Controls — Motion

| Control | Range | Notes |
|---|---|---|
| **Spin** | −2 to +2 | In-place rotation speed (rad/s). Per-tile when Tile ON. |
| **Orbit** | 0–0.45 | Circular path radius. Path: Circle or Lissajous. |
| **Lissajous** | Freq X/Y 0.25–4, Phase 0–1 | Figure-8 / clover paths. Ratio of Freq X:Y determines shape. |
| **Bounce** | 0–0.4 | Bass-driven upward Y displacement on every beat. |
| **Beat Shake** | 0–0.15 (cubic curve) | Random-direction UV impulse 24×/sec, scales with `_r`. |
| **Sway** | Amt 0–0.4, Speed 0–4 | Sinusoidal horizontal pendulum. |
| **Wander** | Amt 0–0.4, Speed 0–2 | Dual-sine drift in X and Y. |
| **Pan** | Speed ±2, Range 0–1 | Modes: Off / Drift (linear scroll) / Bounce (ping-pong). |
| **Tunnel** | −2 to +2 | Seamless zoom-through (pow2 crossfade). Tile-mode only. |
| **Depth** | 0–1 | Z-phase offset inside tunnel. 0.5 = 180° = max parallax between layers. Tile-mode only. |

### Per-layer Controls — Visual Effects

| Control | Values | Notes |
|---|---|---|
| **Tint** | RGB color picker | Multiplies sampled color. |
| **Hue Spin** | 0–2 rad/s | Animated RGB rotation matrix — cycles through full spectrum. |
| **Chromatic** | 0–1 (squared curve) | RGB channel split with animated offset. Speed sub-slider. |
| **Posterize** | Off / 2 / 4 / 8 / 16 | `floor(_src * n + 0.5) / n` per channel, after tint. |
| **Edge / Sobel** | Off / On | 3×3 Sobel kernel → luminance gradient magnitude replaces `_src`. Best with Tint + Hue Spin. |
| **Mirror** | Off / H / V / Quad / Kaleido | Scope: Per Tile or Whole Image. |
| **Blend** | Overlay / Additive / Multiply | How the layer composites over `col`. |
| **Opacity** | 0–1 | Base opacity. Opacity Pulse drives audio-reactive fade. |
| **Strobe** | 0–1 + Threshold | Hard binary cut via `step(thr, _r_raw)`. |

### Per-layer Controls — Audio Reactivity

| Control | Options | Notes |
|---|---|---|
| **Source** | Bass / Mid / Treble / Volume | Selects butterchurn audio band for this layer. |
| **Curve** | Linear / Squared / Cubed / Threshold | Shapes `_r_raw` → `_r`. Applied uniformly to Pulse, Bounce, Shake, Strobe, Opacity Pulse. |

---

### GLSL Pipeline Order (per layer block)

```
_r_raw / _r       audio signal + curve
_orbAng           orbit angle
_spinAng          spin + static angle
_c / _u           anchor + orbit + bounce + sway + wander + pan
beat shake        random UV impulse
group spin        whole-field rotation (groupSpin ON)
applySkew         2D shear
applyPersp        projective warp
aspectPreScale    image aspect correction
applyTileUV       fract wrap + per-tile spin + gap mask
applyMirrorUV     per-tile or whole-image fold
tunnel            pow2 crossfade zoom (fract phase + depthOffset)
textureGrad       sample (or texture for non-tiled)
chromatic         R/B channel offset resample
_src              base color
Sobel kernel      edge detection (edgeSobel ON)
tint / hue spin   color transform
posterize         color quantize
opacity           _op = opacity × opacityPulse × gapMask
blend             composite into col
```

---

## 🟡 Up Next — Candidates

Difficulty: 🟢 < 1 hr · 🟡 2–4 hrs · 🔴 4+ hrs (structural)

### High priority

| Feature | Effort | Notes |
|---|---|---|
| **Per-layer Blur** | 🟡 | 3×5 gaussian tap after `_src`. Pairs with additive blend for glow layers. |
| **Beat Fade** | 🟢 | Opacity envelope — peaks on beat, decays to baseline. Follow `shakeAmp` pattern. Fields: `beatFadeAmt` + `beatFadeDecay`. |
| **Scatter / Radial Clone** | 🔴 | N copies in a ring (count 2–12 × radius). Each clone can spin. Requires unrolled GLSL loop — structural pipeline change. |
| **Displacement mapping** | 🔴 | Layer B warps Layer A UVs. Heat-haze, ripple, glitch. Requires cross-layer sampling + defined evaluation order. |

### Medium priority

| Feature | Effort | Notes |
|---|---|---|
| **Text layer** | 🟡 | Offscreen canvas → texture. Font/size/color. Foundation for lyric reveals. |
| **Procedural generator** | 🟡 | Gradient / checkerboard / noise / stripes / circle as a texture source — no upload needed. |
| **Layer "Looks" / templates** | 🟡 | Save a named layer snapshot; apply via dropdown. Global vs. per-preset TBD. |
| **Copy settings to layer N** | 🟢 | Kebab menu action — copy all fields, keep image identity. |
| **Link slider across layers** | 🟡 | Chain icon on slider; syncs value across all layers. Useful for Spin, Sway Speed, etc. |
| **Randomize this layer** | 🟢 | Dice button per card — randomize animation/style, keep image. |

### Lower / future

| Feature | Effort | Notes |
|---|---|---|
| **Canvas snapshot layer** | 🟡 | Freeze current frame → texture. Still first; live feedback is Phase 9+. |
| **SVG import** | 🟢 | Render SVG → canvas → texture. Scales cleanly. |
| **Path recording** | 🔴 | Record 4-sec anchor drag → looping path. Needs path data in preset JSON + GLSL interpolator. |
| **Per-layer color grade** | 🟡 | Brightness / contrast / saturation after tint stage. |
| **Per-layer vignette** | 🟢 | Darken edges, focus attention on center layers. |
| **Webcam layer** | 🔴 | `getUserMedia` as live texture. Product/privacy decision more than engineering. Needs nginx policy change. |
| **Beat divider** | 🟡 | Trigger every 2nd/4th/8th beat. Needs CPU-side beat counter uniform — audio engine refactor. |
| **Layer cap > 5** | — | Revisit once FPS telemetry shows real-world headroom. |

---

## Implementation Notes — Key Traps & Decisions

### Portrait image tiling
Pre-divide `_u.x` by `imgAsp * aspect.y` **before** `applyTileUV` — sets tile cell shape to match image aspect ratio. Fixing distortion after `fract()` does not work (cell shape is already wrong). `imgAsp` baked at shader build time; `aspect.y` is a runtime uniform.

### butterchurn field name traps
| Correct | Wrong |
|---|---|
| `additivewave` | `wave_additive` |
| `wave_thick` | binary 0/1, not float |

### Backward compatibility rules
- All new entry fields need defaults in **both** the `_addImageLayer` entry object **and** `_normalizeImageEntry`.
- `reactSource` absent → `'bass'`; `reactCurve` absent → `'linear'` — matches pre-Phase-5 GLSL exactly.
- New GLSL helpers (`applySkew`, `applyPersp`) emit nothing at zero — no cost, no shader change for existing presets.

### Slider exclusion pattern
Sliders wired individually (not via generic `sliderKeys[]`) must be added to the `:not()` selector on `card.querySelectorAll(...)`. Current exclusions:
```
layer-bounce-sl, layer-size-sl, layer-liss-sl, layer-strobe-thr-sl,
layer-pan-x-sl, layer-pan-y-sl, layer-pan-range-sl, layer-beat-fade-sl,
layer-tile-sx-sl, layer-tile-sy-sl, layer-shake-sl,
layer-persp-x-sl, layer-persp-y-sl
```

### Dev reset helpers
```js
localStorage.removeItem('discocast_onboarding_never')  // re-show onboarding
window.__editorInspector   // live inspector object in DevTools
```

