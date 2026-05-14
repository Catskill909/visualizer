# Preset Image Tools — Dev Reference

> **Hub doc:** [../../custom-preset-editor.md](../../custom-preset-editor.md)
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
| **GIF Optimizer** | ✅ **Shipped May 2026.** Upload-time modal for large GIFs (>10 frames, >256px, >1MB). Frame strip UI with 80×80px thumbnails, "Keep every Nth" slider (1-20), resize to 128/192/256px, Preview.app-style stats (dims, frames, file size, GPU estimate). Live % savings calculation. Three actions: "Apply & Add Layer", "Use As-Is", "Cancel". Delays scaled by `keepEveryN/3` for smooth animation with fewer frames. |
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
| **Saturation** | 0–2 | 0 = full greyscale, 1 = original, 2 = hyper-vivid. Luminance-mix on `_src`, after tint + hue spin, before posterize. |
| **Hue** | 0–360° | Rodrigues RGB rotation — shifts image hue independently of the Palette tab. After tint + hue spin + saturation. |
| **Blur** | 0–1 | 5-tap cross re-sample at baked `1/texW` pixel step. Applied first — before edge/tint/grading. Pairs with Additive blend for glow layers. |
| **Brightness** | 0–2 | Multiplies RGB. 0=black, 1=original, 2=double. Applied post-film-grain in color grading block. |
| **Contrast** | 0–2 | `(col − 0.5) × contrast + 0.5`. 0=flat grey, 1=original, 2=high contrast. |
| **Gamma** | 0.5–2.5 | `pow(col, gamma)`. Below 1 lifts midtones, above 1 darkens them. |
| **Fade** | 0–0.5 | Lifts black point: `col × (1−fade) + fade`. Faded/vintage film look. |
| **Temp** | −1 to +1 | Color temperature: positive=warm/orange (`+R −B`), negative=cool/blue (`−R +B`). ±15% shift at ±1. |
| **Shadows** | −1 to +1 | Luma-weighted add to dark areas. Negative=crush darks, positive=lift. |
| **Highlights** | −1 to +1 | Luma-weighted add to bright areas. Negative=pull down, positive=boost. |
| **Lift** | −0.5 to +0.5 | Additive shadow bias: `col + lift×(1−luma)`. More effect on darks than lights. |
| **Gain** | −0.5 to +0.5 | Multiplicative highlight boost: `col×(1+gain×luma)`. More effect on lights than darks. |
| **Tint M/G** | −1 to +1 | Magenta/green axis: negative=magenta (+R +B), positive=green (+G). ±15% shift at ±1. |
| **Posterize** | Off / 2 / 4 / 8 / 16 | `floor(_src * n + 0.5) / n` per channel, after tint. |
| **Edge / Sobel** | Off / On | 3×3 Sobel kernel → luminance gradient magnitude replaces `_src`. Best with Tint + Hue Spin. |
| **Luma Key Lo** | 0–1 | Pixels darker than this → transparent. Cuts dark backgrounds. Under "Luma Key" header. |
| **Luma Key Hi** | 0–1 | Pixels brighter than this → transparent. Cuts white backgrounds. |
| **Wave Distort** | 0–1 | Sinusoidal UV warp. Audio-reactive amplitude boost. Under "Wave Distort" header. |
| **Wave Freq** | 1–20 | Number of sine cycles. Appears when Wave > 0. |
| **Invert** | 0–1 | Blend between normal and color-negative. Under "Color FX" header. |
| **Threshold** | 0–1 | Binary B&W at luminance cutoff. Audio-reactive: bass shifts cutoff. |
| **Pixelate** | 0–1 | Mosaic blocks (4–128). Under "Texture" header. UV-space effect (before sample). |
| **Scan Lines** | 0–1 | CRT horizontal dark bands. Post-sample color effect. |
| **Film Grain** | 0–1 | Animated hash noise overlay. Changes every frame. |
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
wave distort      sinusoidal UV warp (audio-reactive amplitude)
pixelate          UV quantize into blocks (before sample)
textureGrad       sample (or texture for non-tiled)
chromatic         R/B channel offset resample
_src              base color
Sobel kernel      edge detection (edgeSobel ON)
tint / hue spin   color transform
saturation        luminance mix (imageSaturation)
hue rotate        Rodrigues RGB rotation (imageHue)
posterize         color quantize
invert            blend normal ↔ 1−color
threshold         binary B&W at luminance cutoff (audio-reactive)
scan lines        CRT horizontal dark bands
blur              5-tap cross sample (texture-space pixel step)
film grain        animated hash noise overlay
brightness        multiply RGB (0–2)
contrast          (col−0.5)×c+0.5 (0–2)
gamma             pow(col,g) (0.5–2.5)
fade              lift black point (0–0.5)
colorTemp         warm/cool RGB shift (−1 to +1)
sepia             mix toward sepia matrix (0–1)
shadows           luma-weighted dark-area adjust (−1 to +1)
highlights        luma-weighted bright-area adjust (−1 to +1)
lift              shadow bias additive (−0.5 to +0.5)
gain              highlight boost multiplicative (−0.5 to +0.5)
tintMG            magenta/green balance (−1 to +1)
luma key          alpha modulation by luminance
opacity           _op = opacity × opacityPulse × gapMask
blend             composite into col
```

---

## ✅ Session — Apr 30 2026: Import / Export Overhaul

### What shipped

| Item | Detail |
|---|---|
| **Timeline export → `.dcshow.json` bundle** | `exportTimelineBundle()` in `timelineStorage.js` — walks all entries, finds `custom:` preset keys, calls `exportPreset(id)` for each (images inlined as base64), wraps as `{ formatVersion:1, exportedAt, timeline, customPresets[] }` |
| **Timeline import → bundle restore** | `importTimelineBundle()` — restores custom presets to IndexedDB + localStorage, builds old→new key remap, rewrites entry `presetName` fields, falls back to plain `importTimeline()` for legacy `.json` files |
| **`_presetImport` side-channel** | Bundle importer attaches `{ imported, names, failed }` to the returned timeline record; `saveTimeline()` strips it before writing to localStorage (prevents data leak), re-attaches after so callers can read it |
| **Shared import result modal** | `src/importResultModal.js` — lazy DOM injection, works on all 3 pages; shows ✓ green list of imported names + ✗ red list of failures with error reasons; Escape / OK / backdrop close; one-shot listeners (no leak) |
| **Modal CSS** | `.dc-import-modal-*` block added to all 3 stylesheets using each page's own CSS variables |
| **Engine refresh after import** | All 3 import handlers now call `engine.refreshCustomPresets()` — presets playable immediately without page reload |
| **`PresetLibrary` engine wiring** | `PresetLibrary` constructor now accepts `engine` option; `editor/main.js` passes it; `_importFrom()` calls `engine.refreshCustomPresets()` |
| **`importFromFile` returns names** | `customPresets.js` now returns `{ imported, names, failed }` — `names` = display names of successfully imported presets |
| **Dead import cleanup** | `exportTimeline` + `importTimeline` removed from `timelineEditor.js` imports (both handled inside `timelineStorage.js` now) |
| **File input accept** | `timeline.html` import input now accepts `.json,.dcshow.json` |

### Key file map

| File | Change |
|---|---|
| `src/timelineStorage.js` | `exportTimelineBundle`, `importTimelineBundle`, `saveTimeline` strips `_presetImport` |
| `src/importResultModal.js` | **new** — shared modal utility |
| `src/customPresets.js` | `importFromFile` returns `names[]` |
| `src/controls.js` | `importCustomPresetsFromFile` → `showImportResult` |
| `src/editor/presetLibrary.js` | `_importFrom` → `showImportResult`; accepts `engine` option |
| `src/timeline/timelineEditor.js` | `_exportTimeline` async + bundle; `_importFromFile` → `showImportResult` |
| `src/style.css` / `src/editor/style.css` / `src/timeline/style.css` | `.dc-import-modal-*` CSS block |
| `timeline.html` | Import input accepts `.dcshow.json` |

---

## 🟡 Up Next — Candidates

Difficulty: 🟢 < 1 hr · 🟡 2–4 hrs · 🔴 4+ hrs (structural)

### High priority

| Feature | Effort | Notes |
|---|---|---|
| ~~**Per-layer Blur**~~ | ✅ Shipped May 14 | 5-tap cross blur via texture re-sample. `img.blur` 0–1. Applied before edge/tint/grading. |
| ~~**Beat Fade**~~ | ✅ Already shipped | Opacity envelope in Layers tab Audio Reactivity section. |
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
| ~~**Per-layer color grade**~~ | ✅ Shipped May 14 | Brightness, Contrast, Gamma, Fade, Color Temperature — all layer types. |
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
layer-tile-sx-sl, layer-tile-sy-sl, layer-vid-sx-sl, layer-vid-sy-sl,
layer-vid-border-w-sl, layer-vid-border-feather-sl,
layer-shake-sl, layer-persp-x-sl, layer-persp-y-sl, layer-radius-sl,
layer-gif-speed-sl, layer-gif-stability-sl, layer-video-speed-sl, layer-video-scrub-sl,
layer-font-size-sl, layer-letter-spacing-sl, layer-line-height-sl,
layer-shadow-blur-sl, layer-shadow-x-sl, layer-shadow-y-sl,
layer-outline-width-sl, layer-kaleido-speed-sl,
layer-brightness-sl, layer-contrast-sl, layer-gamma-sl,
layer-fade-sl, layer-colortemp-sl, layer-sepia-sl, layer-blur-sl,
layer-shadows-sl, layer-highlights-sl, layer-lift-sl, layer-gain-sl, layer-tintmg-sl
```

### Dev reset helpers
```js
localStorage.removeItem('discocast_onboarding_never')  // re-show onboarding
window.__editorInspector   // live inspector object in DevTools
```

