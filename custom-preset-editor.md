# Custom Preset Editor — Implementation Status

> **Status:** ✅ Built and working. This doc reflects the actual implementation.
> **Role:** Hub doc for everything Preset Studio. Focused subdocs live in [`docs/preset-editor/`](docs/preset-editor/) and [`docs/bugs/`](docs/bugs/).

---

## Subdoc Index

| Doc | Status | What it covers |
|---|---|---|
| [docs/preset-editor/image-layer-effects.md](docs/preset-editor/image-layer-effects.md) | ✅ Shipped | Per-layer transform / motion / visual effect / audio reactivity reference. GLSL pipeline order. Up-next backlog. |
| [docs/preset-editor/library-panel.md](docs/preset-editor/library-panel.md) | ✅ Shipped (§10 known bug) | Library panel design, dual-mode sidebar, thumbnails, save/load flow. §10 documents the export-only-saves-images bug — fix is the One Truth work below. §11 Solid FX audio reactivity. |
| [docs/preset-editor/gif-playback.md](docs/preset-editor/gif-playback.md) | ✅ Shipped | Animated GIF playback + GIF Optimizer (frame reduction, resize, GPU memory preview). |
| [docs/preset-editor/radius-slider.md](docs/preset-editor/radius-slider.md) | ✅ Shipped May 3, 2026 | SDF rounded-corner radius slider for image layer tiles. |
| [docs/preset-editor/future-effects.md](docs/preset-editor/future-effects.md) | 📋 Future | Pipeline of new image-layer effects. Chromatic Aberration sets the quality bar. |
| [docs/preset-editor/layer-header-redesign.md](docs/preset-editor/layer-header-redesign.md) | 📋 Planning | Layer card header redesign options. |
| [docs/bugs/strobe.md](docs/bugs/strobe.md) | ✅ Fixed | Strobe slider not visible — handoff and root cause. |
| [docs/bugs/image-mirror.md](docs/bugs/image-mirror.md) | ✅ Fixed | Canvas Mirror not rebuilding shader on click. |
| [docs/bugs/export-tauri.md](docs/bugs/export-tauri.md) | ✅ Fixed (needs rebuild to ship) | Tauri WKWebView swallowing `<a download>`. |
| [docs/bugs/white-flash.md](docs/bugs/white-flash.md) | ✅ Fixed | White flash on startup. |
| [docs/bugs/fullscreen-macos.md](docs/bugs/fullscreen-macos.md) | ✅ Fixed | Fullscreen button no-op in Tauri macOS. |

---

## What's been built

A standalone editor at `editor.html` with a live butterchurn canvas on the left
and a tabbed inspector panel on the right. No page reload — every control is live.

### Tabs

| Tab | Controls |
|---|---|
| **Palette** | Base variation picker · Quick palettes · Wave/Glow/Accent color swatches · Brightness (gammaadj) · Trail (decay) · Outer/Inner border size & alpha · Invert toggle · Darken toggle |
| **Motion** | Zoom · Spin (rot) · Warp · Warp Speed · Warp Scale · Echo Zoom · Echo Direction · Randomize · **Reactivity** section (Energy/Bass Sensitivity session-only, Beat Sensitivity/b1ed saved, AGC toggle) |
| **Wave** | Mode grid (8 shapes) · Size · Opacity · Mystery · Thickness toggle · Dots toggle · Additive blend toggle · Brighten wave toggle · Randomize |
| **Images** | Canvas Mirror · Up to 5 image layers with full per-layer controls (see below) |

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

Up to **5 image layers** in a collapsible smart-accordion stack. Adding a new layer auto-collapses prior cards and expands the new one; any card can be manually expanded at any time.

**Global controls above the layer stack:**

| Control | Notes |
|---|---|
| HD uploads toggle | ON = resize to 2048px longest side on upload; OFF (default) = 1024px. Set before uploading — resize is destructive. Layers uploaded in HD show an **HD** badge in their card header. |
| Add layer button | Disabled when 5 layers are present |
| Layer count indicator | "Layers: N / 5" |
| Collapse all / Expand all | |

**Dev performance HUD:** press `` ` `` (backtick) to toggle an overlay showing frame time (ms, 60-frame rolling average), estimated texture VRAM, active layer count, and last shader rebuild time. Skips the key when focus is in an input.

**Layer card header (always visible, collapsed or expanded):**

| Control | Notes |
|---|---|
| Drag handle ⠿ | `grab` cursor — drag to reorder; `↑` / `↓` keys when handle is focused swaps with neighbour |
| Index badge | `#1/3` style — updates live on add / remove / reorder |
| Thumbnail (48×48) | Static source-image preview |
| Inline name field | Defaults to filename without extension; click to edit, Enter/blur to commit, Esc to cancel |
| Solo toggle | If any layer is soloed, only soloed layers render; multiple layers can be soloed together |
| Mute toggle | Hides this layer independently of solo |
| Reset ↻ | Resets all animation/style fields to default; keeps image binding; undoable via Cmd+Z |
| Trash 🗑 | Delete with confirmation modal (Enter confirms, Esc / backdrop cancels) |
| Chevron | Expand / collapse the card body |

**Per-layer controls (expanded card body):**

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
| **Mirror scope** | Per Tile / Whole Image | Visible when Mirror ≠ Off. "Whole Image" folds the entire tiled field upstream of the tile pipeline (via `_uvf` local in GLSL); "Per Tile" folds inside each individual tile. |
| **Tint Color** | Color swatch | Multiplies sampled image pixels by this color |
| **Hue Spin** | 0–2 | Rotates tint hue through full color wheel per second |
| **Chromatic Aberration** | 0–1 | RGB channel split — animates red and blue in opposite directions for a glitchy color-fringe effect. Speed slider appears when Chromatic > 0. |
| **Chromatic Speed** | 0–4 | Animation speed for the chromatic offset (cycles/sec). Hidden when Chromatic = 0. |
| **Posterize** | Off / 2 / 4 / 8 / 16 | Buckets RGB channels into N discrete levels. Segmented button row — Off = no-op (zero shader cost), 2 = hard 2-tone, 4 = pop-art look, 8/16 = subtle banding. Applied after tint. Combines well with Hue Spin for animated retro palettes. |
| **Shake** | 0–0.15 | Random 2D UV jolt on each beat. Omnidirectional — a different feel from the directional Bounce. Scales with the shaped audio signal (`_r`). Cubic UI curve for fine low-end control. |
| **Angle** | −180 to +180° | Static rotation offset — tilts the image at a fixed angle. When Spin is also non-zero, Angle acts as the starting/offset angle of the spin. Inline row directly below Spin. |
| **Skew X** | −1 to +1 | Horizontal shear — slides the top edge left/right relative to the bottom, making tiles parallelogram-shaped. Applied after rotation, before tiling. |
| **Skew Y** | −1 to +1 | Vertical shear — slides the right edge up/down relative to the left. Combine with Skew X for diamond / rhombus tile grids. |
| **Tile Width** | 0.25–4.0 | Tile cell width multiplier. 1.0 = native image aspect (default). Values <1 narrow the cells; >1 widen them. Hidden when Tile is OFF. |
| **Tile Height** | 0.25–4.0 | Tile cell height multiplier. 1.0 = native image aspect (default). Values <1 shorten the cells; >1 stretch them. Hidden when Tile is OFF. |
| **Reactivity Source** | Bass / Mid / Treble / Volume | Which audio band drives all reactive controls (Pulse, Bounce, Beat Fade) on this layer. Default: Bass. A subtitle in the UI reads “Drives Pulse · Bounce · Beat Fade” as a reminder. |
| **Reactivity Curve** | Linear / Squared / Cubed / Gate | Transform applied to the raw signal before driving reactive controls. Gate = hard on/off at 30% threshold. Default: Linear. |
| **Aspect-correct tiling** | Automatic | Portrait, square, and landscape images tile without distortion. The GLSL pre-scales `_u.x` by `imgAsp × aspect.y` before the tile UV pipeline, so tile cells match the image’s native aspect ratio in screen pixels. No cropping, no letterboxing. |
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

### Onboarding modal

Shown automatically on every editor session until dismissed permanently. Implemented as a 2-column tip grid with 6 tips (double-click reset, anchor dot, undo/redo, collapse cards, save flow, A/B compare).

- localStorage key: `discocast_onboarding_never` — set to `'1'` by "Never show again"
- `showOnboarding()` exported from `inspector.js`, called at end of `boot()` in `main.js`
- Backdrop click / Escape = temporary dismiss; "Never show again" = permanent
- **Dev reset:** `localStorage.removeItem('discocast_onboarding_never')` in console

### Preview / Focus mode

A small icon button in the topbar (right side) hides the editor panel for a full-width canvas view.

- CSS: `.editor-shell.focus-mode` sets `editor-panel` width to 0 with a 0.3s ease transition; mini-player fades out
- Click anywhere on the canvas, click the button again, or press `\` to restore
- `sizeCanvas()` fires after 320ms so the WebGL canvas fills the full width correctly

### File-type guard

Image and audio file pickers now have explicit `accept` attributes (MIME types + extensions) so macOS Finder filters the dialog. A JS guard in `_bindImageDropzone` also rejects non-image files at both the file picker and drag-and-drop level, showing a red error toast instead of freezing.

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

## Import / Export — Fully Implemented ✅

### Preset Editor (Library panel)
- **Export All** — `exportAllPresets()` → `{ version:1, exportedAt, presets:[] }` JSON download. Images inlined as base64 data-URLs per preset.
- **Export single** — card download icon → `exportPreset(id)` → `<name>.json`. Images inlined.
- **Import** — file input → `importFromFile()` → `importPreset()` for each entry. Restores image blobs to IndexedDB, assigns new IDs. Calls `engine.refreshCustomPresets()` immediately. Shows **import result modal** listing every imported preset name and any failures.
- `PresetLibrary` constructor accepts `engine` option (passed from `editor/main.js`).

### Main Visualizer Drawer (`controls.js`)
- Same `exportAllPresets` / `exportPreset` / `importFromFile` calls.
- Import calls `refreshCustomPresets()` + `filterPresets()` + shows result modal.

### Timeline Export (`.dcshow.json` bundle)
- `exportTimelineBundle()` embeds all `custom:` presets referenced by the timeline (with images).
- `importTimelineBundle()` restores presets, remaps entry `presetName` keys to new IDs, shows result modal.
- Backward compatible — plain `.json` timeline files still work.
- Renaming the file on disk is safe — file contents only are read on import.

### Shared result modal — `src/importResultModal.js`
- Lazy DOM injection — no HTML changes needed per page.
- Shows ✓ green list (imported names) + ✗ red list (failures + error reason).
- Escape / OK / backdrop close. One-shot listeners — no event leak.

---

## Timeline Editor (Separate Tool)

The Timeline Editor lives at `/timeline.html` — fully self-contained, no changes needed here. A "Send to Timeline →" option on library cards opens `timeline.html?preset=<name>` (one line in `presetLibrary.js`). See `timeline-editor.md` for the full design.

---

## Future ideas

- Audio-reactive orbit radius (orbit grows on bass)
- More blend modes
- ~~Export / import preset as `.json`~~ ✅ **Done — includes images + result modal**
- "Mine" tab in main app preset drawer (custom presets already write to the right localStorage key)
- ~~Remix button in main app: open editor from existing preset~~ ✅ **Done — Phases 1–3**
- Beat Shake / Jitter
- Strobe / Blink
- Scatter / Radial Clone
- Lissajous Path
- Depth Stack (Z-order offset for 2-image tunnel)
- Equation string editor (editable `<textarea>` per field) — after Phase 5 read-only display
- Raw GLSL editor for `warp` / `comp` shaders (Monaco or textarea)
- Shapes editor (card per shape, like image layers)
- Custom waves editor

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

### 🔄 Continuous Spin
The image rotates continuously around its anchor at a settable speed, independent of Orbit or Sway. Controls: **Spin Speed** (−3 to 3 — negative = counter-clockwise) and optionally an **Audio Reactive** amount that adds a momentary kick-driven speed burst. This is different from the static `angle` we already have — Spin accumulates over time. Pairs with Wander for a free-floating spinning orb.

---

### 🌊 Warp-Follow / UV Distortion
Image texture UVs are displaced by the butterchurn warp field — the same field that drives the base MilkDrop pattern. The image writhes and melts with the music, feeling organically connected to the base visualizer rather than floating on top of it. Controls: **Warp Strength** (0–0.5) and a **Blend** mode (add distortion on top of existing UV pipeline vs replace). Technically: sample the warp buffer at the image's current UV position, use the resulting delta as an offset to the texture sample. Performance: one extra texture lookup per layer — very cheap.

---

### 💓 Pulse Opacity
Image alpha breathes to the beat — soft fade in and out driven by bass/mid/treble. Different from Bounce (which moves position) and Beat Shake (which jolts position). Controls: **Depth** (0–1 — how much alpha swings), **Floor** (minimum opacity so image never fully disappears), **Source** (bass / mid / treble). Creates a heartbeat feel — the image swells toward you on every kick.

---

### 🔭 Depth Stack (Z-order offset)
When 2 images are loaded, a **Z Offset** slider nudges the second image's tunnel phase so the two layers appear to be at different distances in 3D space during tunnel mode — they zoom at slightly different rates giving true depth separation.

---

### 🎯 Implementation notes
- **XY Pad for center**: render a `<canvas>` element (e.g. 120×120px) inside the layer card; `mousedown`/`mousemove` update `entry.cx` / `entry.cy`; dot drawn via `requestAnimationFrame`. No external deps needed.
- **Wander**: two `sin(time*f1 + phase1)` terms summed at different frequencies — cheap GLSL, no texture needed.
- **Scatter/Radial Clone**: unroll into N separate UV samples in the GLSL block; count is baked at shader-build time so no loop limit issues.
- **Mirror**: a single `abs(fract(uv) - 0.5) * 2.0` fold per axis before the existing tile pipeline.

---

## MilkDrop Settings Coverage

> Updated May 2026. All `baseVals` fully audited. See Phase 4 audit table for field-by-field detail.

A full MilkDrop preset has four tiers of settings:

### Tier 1 — `baseVals` ✅ All headline fields exposed *(post-Phase 8)*

The only unexposed fields are the 7 **motion vectors** (`mv_x`, `mv_y`, `mv_l`, `mv_r/g/b`, `mv_a`). Motion vectors draw small directional arrows on the canvas showing pixel-flow direction. **They are disabled in virtually every one of the 1,000+ library presets** — `mv_a = 0` is the default and almost no preset sets it otherwise. They were a debugging/diagnostic overlay from MilkDrop's early days and are rarely used even in complex community presets. Low priority to expose; not worth the UI clutter.

### Tier 2 — `shapes[]` and `waves[]` ⏸ Removed (was Phase 6)

Up to 4 custom shapes and 4 custom waves per preset. Shipped briefly as an Objects tab but removed — controls had minimal visible effect on most presets (equations override geometry each frame), making the tab confusing rather than useful. Future direction: a **shape creation tool** that lets users build new shapes from scratch rather than editing existing opaque ones. Shapes/waves are still preserved in preset state and passed through to butterchurn correctly.

### Tier 3 — Equation strings ❌ Preserved, display coming in Phase 5

`init_eqs_str`, `frame_eqs_str`, `pixel_eqs_str` (plus per-shape/wave variants). Preserved and executed correctly. Phase 5 will add read-only display; editable textarea comes after that.

### Tier 4 — GLSL shaders (`warp`, `comp`) ❌ Preserved, not user-editable

`comp` is auto-generated by the editor from image layer state. `warp` is passed through unchanged from the source preset. Raw GLSL editing is a future phase.

### External editor comparison — May 2026

> Full research in [docs/handoff-milkdrop-research-may2026.md](docs/handoff-milkdrop-research-may2026.md).

Surveyed 6 editors (Winamp MD2, butterchurn-electron, MilkDrop3/BeatDrop, projectM, NestDrop, WACUP).

**Key finding: Preset Studio is ahead of every external editor on baseVal coverage.**

| Editor | BaseVal control method | Exposed |
|---|---|---|
| butterchurn-electron | Code-only (textarea) | 0 sliders |
| MilkDrop3 MilkPanel | 6 named sliders | 6 |
| **Preset Studio** | **Sliders + swatches + toggles** | **All headline fields (Phases 1–8)** |

No external editor has image layers, per-layer audio reactivity, GIF support, or per-layer effects (chromatic aberration, posterize, mirror, sway, wander, etc.) — those are our original contribution.

#### Remaining baseVal gaps (Phase 9 — power-user / shader-aware)

| Param | Tab | What it does | Priority |
|---|---|---|---|
| `blur1–3 min/max` | Motion | Clamp range for blur texture samplers | Low (only meaningful when shader uses `sampler_blur`) |
| `modwavealphabyvolume` | Wave | Fade wave when volume is low | Low |

All headline baseVals shipped through Phase 8 (2026-05-04). Remaining fields are either shader-dependent (only useful when the loaded preset's `warp`/`comp` references `sampler_blur1/2/3`) or vestigial (motion vectors `mv_x/y/l/r/g/b/a` — disabled in virtually every library preset).

---

## Remix from Library — Implementation Tracker

> Started May 2026. See [The One Truth Goal](#the-one-truth-goal--primary-architecture-objective) for the full rationale.

### Phase 1 — Core wiring (no new UI) ✅ Shipped May 2026

| Step | What | File(s) | Status |
|------|------|---------|--------|
| 1a | `loadBundledPreset(name)` method in inspector | `src/editor/inspector.js` | ✅ Done |
| 1b | `?preset=NAME` URL param handler in editor boot | `src/editor/main.js` | ✅ Done |
| 1c | "Remix in Studio" icon button in main app preset drawer | `src/controls.js`, `src/style.css` | ✅ Done |
| 1d | Pencil "Remix" button in floating control bar (next to ♥ / hide) | `index.html`, `src/controls.js`, `src/style.css` | ✅ Done |

**How it works:**
- Hover any bundled preset row in the main app drawer → blue ⇌ icon appears → click → navigates same-window to `editor.html?preset=<name>`
- Floating control bar: pencil icon always visible next to ♥ and hide → click → same-window nav with current preset
- Editor reads `?preset=` on boot, calls `inspector.loadBundledPreset(name)` after engine + inspector init
- `loadBundledPreset` merges BLANK + bundled data into `currentState`, preserves bundled `comp`/`warp` shaders without calling `_buildCompShader()`, syncs all controls, sets `parentPresetName`
- First user action that needs the comp regenerated (add image layer, pick variation) triggers `_buildCompShader()` naturally — no special handling needed

**Key design decision — comp shader preservation:**
`_buildCompShader()` is only called when the user actively changes image layers, the variation, solid FX, or scene mirror. On initial library load we call `_applyToEngine()` directly. This means a remixed preset starts looking exactly like the original, and only diverges when the user intentionally does something that changes it. The bundled `warp` shader is always preserved — `_buildCompShader()` only ever touches `comp`.

---

### Phase 2 — In-editor preset picker ✅ Shipped May 2026

| Step | What | File(s) | Status |
|------|------|---------|--------|
| 2a | `Remix…` button added to panel footer | `editor.html`, `src/editor/style.css` | ✅ Done |
| 2b | Searchable picker modal — 1,144 preset names, live filter, keyboard nav | `editor.html`, `src/editor/style.css` | ✅ Done |
| 2c | Picker wired to `loadBundledPreset` + dirty check + name input update | `src/editor/main.js` | ✅ Done |

**How it works:**
- `Remix…` button in the panel footer opens a 520×620px modal with a search input and a scrollable list of all 1,144 bundled preset names (custom presets excluded)
- Typing in the search box live-filters the list; list is capped at 800 rendered rows for DOM performance
- Clicking a name: runs the dirty-state guard → `inspector.loadBundledPreset(name)` → sets name input to preset name → `markDirty()` → closes modal
- Escape closes the picker (priority: picker first, then library mode, then help modal)
- Backdrop click also closes
- Preset name list built lazily on first open from `engine.getPresetNames()` filtered to bundled-only
- `_rp*` private functions in `main.js` — no inspector changes needed

---

### Phase 3 — "Continue editing" for custom presets ✅ Shipped May 2026

| Step | What | File(s) | Status |
|------|------|---------|--------|
| 3a | Pencil "Edit in Studio" icon added to custom preset rows in main drawer | `src/controls.js`, `src/style.css` | ✅ Done |
| 3b | Same-window nav: `editor.html?custom=REGISTRY_KEY` | `src/controls.js` | ✅ Done |
| 3c | Editor reads `?custom=`, parses id, calls `handleLibraryLoad(id)` | `src/editor/main.js` | ✅ Done |

**How it works:**
- Custom preset rows in the main app drawer now show a pencil icon on hover (alongside export + delete)
- Clicking navigates same-window to `editor.html?custom=custom:<id>:<name>`
- Editor boot reads `?custom=`, extracts the UUID from the registry key (`key.slice(CUSTOM_PREFIX.length).split(':')[0]`), calls `handleLibraryLoad(id)` — the existing function that restores all image layers from IndexedDB, sets `activePresetId`, and puts the editor in edit mode
- Subsequent Cmd+S overwrites the same preset in-place (no Save As dialog needed)

---

### Phase 4 — Missing `baseVals` sliders ✅ Shipped May 2026

| Step | What | Tab | Status |
|------|------|-----|--------|
| 4a | `warpscale` slider | Motion | ✅ |
| 4b | `ob_size` + `ob_a` sliders | Palette | ✅ |
| 4c | `b1ed` beat sensitivity slider | Feel | ✅ |
| 4d | `wave_mystery` + `wave_brighten` | Wave | ✅ |
| 4e | `ib_size` + `ib_a` sliders | Palette | ✅ |
| 4f | Randomize buttons updated to include new fields | Motion + Wave | ✅ |
| 4g | Glow/Accent swatches sync `ob_a`/`ob_size`/`ib_a`/`ib_size` sliders when auto-set | Palette | ✅ |

**Slider effect notes (why some look "invisible" at first):**
- **Borders (ob/ib):** require three things simultaneously — non-zero `ob_size`/`ib_size`, non-zero `ob_a`/`ib_a`, AND a non-black Glow/Accent swatch color. Picking a Glow color will auto-set `ob_a=0.75` and `ob_size=0.02` if they were 0 — sliders now reflect that immediately.
- **Beat Sensitivity (`b1ed`):** controls bass-reactive edge sharpening. Requires audio playback to notice.
- **Wave Mystery:** position/phase parameter for the waveform. Effect varies by wave mode — most visible in modes 1–3.
- **Warp Scale:** scales the warp distortion UV space — noticeable at extremes (try 0.2 or 3.5).

---

### MilkDrop `baseVals` coverage — full audit (May 2026)

All fields from `BLANK.baseVals` and their UI controls:

| Field | UI Control | Tab | Status |
|-------|-----------|-----|--------|
| `zoom` | Zoom slider | Motion | ✅ |
| `rot` | Spin slider | Motion | ✅ |
| `warp` | Warp slider | Motion | ✅ |
| `warpanimspeed` | Warp Speed slider | Motion | ✅ |
| `warpscale` | Warp Scale slider | Motion | ✅ |
| `decay` | Trail slider | Palette | ✅ |
| `gammaadj` | Brightness slider | Palette | ✅ |
| `echo_zoom` | Echo Zoom slider | Motion | ✅ |
| `echo_orient` | Echo Direction segment | Motion | ✅ |
| `wave_mode` | Wave shape grid | Wave | ✅ |
| `wave_r/g/b` | Wave color swatch | Palette | ✅ |
| `wave_a` | Opacity slider | Wave | ✅ |
| `wave_scale` | Size slider | Wave | ✅ |
| `wave_mystery` | Mystery slider | Wave | ✅ |
| `wave_thick` | Thickness toggle | Wave | ✅ |
| `wave_usedots` | Draw as dots toggle | Wave | ✅ |
| `additivewave` | Additive blend toggle | Wave | ✅ |
| `wave_brighten` | Brighten wave toggle | Wave | ✅ |
| `ob_r/g/b` | Glow color swatch | Palette | ✅ |
| `ob_size` | Outer Border Size slider | Palette | ✅ |
| `ob_a` | Outer Border Alpha slider | Palette | ✅ |
| `ib_r/g/b` | Accent color swatch | Palette | ✅ |
| `ib_size` | Inner Border Size slider | Palette | ✅ |
| `ib_a` | Inner Border Alpha slider | Palette | ✅ |
| `darken` | Darken toggle | Palette | ✅ |
| `invert` | Invert colors toggle | Palette | ✅ |
| `b1ed` | Beat Sensitivity slider | Feel | ✅ |
| `mv_x` | — | — | ❌ Motion vectors not exposed |
| `mv_y` | — | — | ❌ Motion vectors not exposed |
| `mv_l` | — | — | ❌ Motion vectors not exposed |
| `mv_r/g/b` | — | — | ❌ Motion vectors not exposed |
| `mv_a` | — | — | ❌ Motion vectors not exposed |

**28 of 35 baseVal fields exposed via UI. Only motion vectors (7 fields) remain.**

Motion vectors draw small arrows on screen showing pixel-flow direction. `mv_a = 0` by default and virtually no library preset sets it otherwise — they're a rarely-used diagnostic overlay from MilkDrop's early days. Not worth UI clutter to expose; motion vector state is preserved and passes through correctly when remixing.

---

### Phase 5 — Equation editor 📋 Future (low priority)

**Where it lives:** `< >` button in the editor topbar → fullscreen overlay. Inspector panel slides away. Three labeled textareas (Init / Frame / Pixel equations) with the live canvas still running behind. Close button returns to normal editing mode. No new tab — completely hidden from casual users, full width for power users.

**Why not a tab:** the tab bar is already full (5 tabs), and equations are a power-user tool for a small minority. They require knowing the MilkDrop scripting language and have no business being in the main flow.

**Scope when built:** editable `<textarea>` per field, live apply on blur/Cmd+S, basic syntax error display. No Monaco or syntax highlighting needed for v1.

---

### Phase 6 — Shapes & Custom Waves editor ✅ Shipped May 2026

> Deep audit completed May 2026. Data from butterchurn-presets (100 presets) + butterchurn source.

#### The data reality

From 100 library presets audited:

| Metric | Count |
|--------|-------|
| Presets with enabled shapes | 52 (52%) |
| Presets with enabled custom waves | 32 (32%) |
| Enabled shapes that have `frame_eqs_str` | ~93% |
| Enabled shapes that are purely static (no equations) | ~7% |

**The key finding:** Almost every complex shape is animated by `frame_eqs_str`. The equations override `x`, `y`, `ang`, `rad` every frame — so sliders for those fields only set *starting values*. The visual result of editing them depends entirely on what the equations do with those values. This is fine and important to communicate clearly in the UI.

Custom waves are simpler — their `frame_eqs_str` controls per-point color/position, but the core controls (color, smoothing, scaling, mode) always have direct visual effect regardless of equations.

#### Full field schemas (from real presets)

**Shape `baseVals`** — 25 fields:
```
enabled, sides, x, y, rad, ang
r, g, b, a                    ← fill color + alpha
r2, g2, b2, a2                ← fill color 2 (gradient inner)
border_r, border_g, border_b, border_a  ← border color + alpha
textured, tex_zoom, tex_ang   ← texture mapping (uses warp buffer as texture)
additive, thickoutline        ← blend mode / border style
num_inst                      ← multi-instance count (rare)
```

**Wave `baseVals`** — 13 fields:
```
enabled, r, g, b, a           ← enable + color
spectrum                      ← 0=time domain, 1=frequency domain
thick, usedots, additive      ← render style
scaling, smoothing, sep       ← signal processing
samples                       ← point count (default 512, rarely changed)
```

#### Where it lives — rename Image → Layers

The Image tab becomes a unified **Layers** tab. Same card-pattern, three sections stacked vertically:

```
LAYERS TAB
├── Canvas Mirror          (existing — stays at top)
├── ─── Custom Shapes ─── (new, collapsible section header)
│   ├── Shape 1 card       [collapsed if disabled]
│   ├── Shape 2 card       [collapsed if disabled]
│   ├── Shape 3 card       [collapsed if disabled]
│   └── Shape 4 card       [collapsed if disabled]
├── ─── Custom Waves ───  (new, collapsible section header)
│   ├── Wave 1 card        [collapsed if disabled]
│   ├── Wave 2 card        [collapsed if disabled]
│   ├── Wave 3 card        [collapsed if disabled]
│   └── Wave 4 card        [collapsed if disabled]
└── ─── Image Layers ───  (existing — stays at bottom, unchanged)
    └── [accordion cards]
```

Sections with all 4 cards disabled collapse to a single muted row ("4 shapes — all off"). Only sections that have at least one enabled object expand automatically when a preset is loaded.

#### Shape card controls

**Header (always visible):**
- Index badge (#1), shape name (auto: "Shape 1"), enabled toggle, chevron expand

**Card body:**

| Section | Controls |
|---------|----------|
| **Geometry** | Sides (3–100, integer), Radius (0–2.0), Position XY pad (same component as image layer center), Angle (−π to +π) |
| **Fill** | Color swatch (r,g,b), Opacity (a 0–1), Color 2 swatch (r2,g2,b2), Opacity 2 (a2 0–1) |
| **Border** | Color swatch (border_r,g,b), Opacity (border_a 0–1), Thick outline toggle |
| **Options** | Textured toggle · Tex zoom slider (0.1–4) · Additive toggle |
| **Equations badge** | If `frame_eqs_str` present: amber pill "Animated by equations — Geometry fields set initial values" |

#### Wave card controls

**Header (always visible):**
- Index badge (#1), wave name (auto: "Wave 1"), enabled toggle, chevron expand

**Card body:**

| Section | Controls |
|---------|----------|
| **Color** | Color swatch (r,g,b) + Opacity (a 0–1) |
| **Source** | Spectrum toggle (Time / Frequency) |
| **Style** | Thick toggle · Dots toggle · Additive toggle |
| **Shape** | Scaling slider (0–2) · Smoothing slider (0–1) · Sep slider (−1–1) |
| **Equations badge** | If `frame_eqs_str` present: amber pill "Per-point equations active" |

#### Key design decisions

1. **Always show all 4 slots** — collapsed/dimmed when disabled, expanded when enabled. User can enable a blank slot to add a new shape/wave from scratch.

2. **Equations badge, not lockout** — don't disable sliders when equations are present. Color and style fields always work; geometry fields are "initial values" that equations may override. The badge explains this without blocking editing.

3. **No drag reorder** — unlike image layers, shapes and waves have fixed indices (0–3) because `frame_eqs_str` often references `q1`–`q8` shared variables between shapes. Reordering would break presets.

4. **Equation display (Phase 5.5)** — clicking the equations badge in a card body could expand a read-only `<pre>` showing that object's `frame_eqs_str`. Pairs naturally with Phase 5.

5. **Tab button label** — rename `Image` button to `Layers` in `editor.html`. One-line change, no architectural impact.

#### Build estimate

| Sub-phase | What | Status |
|-----------|------|--------|
| 6a | Custom Wave cards (Color/Source/Style/Shape controls) | ✅ Shipped |
| 6b | Custom Shape cards (Geometry/Fill/Border/Options controls) | ✅ Shipped |
| 6c | Feel tab controls merged into Motion tab (Reactivity section) | ✅ Shipped |
| 6d | Feel tab → Objects tab (4 shape cards + 4 wave cards) | ✅ Shipped, then removed |

#### Note on Phase 6 removal

Objects tab was shipped then pulled. Most preset shapes are equation-driven — geometry values are overridden every frame, so sliders had little visible effect. The tab created confusion for users who expected more control. Shapes/waves are still loaded and rendered correctly from preset files; the editor just no longer exposes controls for them.

#### Why this still matters — the off-center composition gap

The MilkDrop engine's warp pipeline (`zoom`, `rot`, `warp`, `sx`/`sy`) all pivot around a **single point** — `cx`/`cy`, defaulting to canvas center. This is why a blank-canvas preset built only from baseVals slider tweaks always feels like everything radiates from screen center. There are exactly three escapes:

1. **Move the single warp pivot** — set `cx`/`cy` to anywhere on canvas. Phase 8 step 8e exposes this as the "Rotation Center" XY pad. Highest-leverage upcoming control: lets you put the warp pivot in a corner so motion sweeps diagonally across the screen.
2. **Custom shapes** — up to 4 shapes per preset, each with its own `x`/`y`. Independent objects positioned anywhere — 4 shapes = up to 4 visual centers. This is how the most non-radial library presets are built.
3. **Per-pixel equations** — Phase 10 (EEL2 textarea). `per_pixel_eqs` runs per-pixel with access to `x`, `y`, `rad`, `ang` and lets you compose totally arbitrary spatial transforms (zoom out from one corner while rotating around another, multi-vortex flows, etc.). Real MilkDrop "wizard" presets live here.

The next time we revisit shapes, the framing should be **"Shape Composer — drop primitives anywhere on canvas"** rather than the failed "expose all 25 fields per shape" approach. See Phase 13 below.

---

### Phase 7 — Wave depth ✅ Shipped May 4, 2026

> Pure baseVals writes — no shader impact. Three new sliders in the Wave tab "Style" section.

| Step | Control | Tab | Range | Default | What it looks like on screen |
|------|---------|-----|-------|---------|------------------------------|
| 7a ✅ | `wave_smoothing` — "Smoothing" slider | Wave | 0–1 | 0.75 | At **0** the waveform is a jagged scribble that hard-tracks every audio sample — sharp, electric, busy. At **1** it becomes a flowing glass-smooth ribbon that lazily traces the energy envelope. Mid-range gives a "calligraphic" feel. Effect is visible in all 8 wave modes; most dramatic on modes 0/1 (the line/spiral types) where the contrast between scribble and ribbon is biggest. |
| 7b ✅ | `wave_x` / `wave_y` — "Position X" / "Position Y" sliders | Wave | 0–1 | 0.5, 0.5 | Slides the wave anchor point across the canvas. **Position X 0** = wave docked to the left edge, **1** = right edge. Same for Y (0=top, 1=bottom). On modes 2–4 (centered blobs / radial / xy-osc) the entire pattern translates — you can park the orb in any corner. On modes 0/1 (line waves) the line slides along its perpendicular axis. Two separate sliders rather than an XY pad to match the rest of the Wave-tab slider stack. |

**Implementation (single file: [`src/editor/inspector.js`](src/editor/inspector.js)):**
- `BLANK.baseVals` extended with `wave_smoothing: 0.75, wave_x: 0.5, wave_y: 0.5` (Tuning checklist #3 — older saves overlay onto BLANK and pick up these defaults).
- `_buildWaveSliders()` configs gained 3 entries (`ws-smoothing`, `ws-pos-x`, `ws-pos-y`) — the existing forEach already handles `_preSnap` / `_postSnap` undo, value-label, and `_applyToEngine(true)`.
- `_syncWaveControls()` map gained 3 entries so Library reloads populate the new sliders from `currentState.baseVals`.
- `btn-randomize-wave` randomizes `wave_smoothing` (0–1) and `wave_x`/`wave_y` (0.3–0.7 to keep the wave on-screen).
- **No `:not()` exclusion update needed** — Wave-tab sliders live in `#wave-sliders` as `.slider-row`, not `.layer-slider-row`, so they don't pass through the generic image-layer dispatcher.

**Hardening shipped alongside (2026-05-04):** [`loadPresetData`](src/editor/inspector.js#L3870) was doing a shallow top-level spread, so a custom preset saved before today (without `wave_smoothing`/`wave_x`/`wave_y`) would have loaded with `undefined` for those fields → `NaN` slider labels. Fixed by deep-merging `baseVals` against `BLANK.baseVals` to match [`loadBundledPreset`'s pattern at line 3824](src/editor/inspector.js#L3824). The contamination-fix comment ("fields missing from older saves fall back to defaults") is now actually true. Same pattern protects every future baseVal addition (Phases 8/9).

---

### Phase 8 — Motion drift & stretch ✅ Shipped May 4, 2026

> Pure baseVals writes — no shader rebuild. Eight new sliders grouped into three new sections on the Motion tab so the tab stays scannable as it grows from 7 → 15 controls.

| Step | Control | Range | Default | What it looks like on screen |
|------|---------|-------|---------|------------------------------|
| 8a ✅ | `echo_alpha` — "Echo Opacity" slider | 0–1 | 0 | Sits below Echo Direction. At **0** the echo layer is invisible (default — why most presets feel like they have no echo at all). Crank it up and a ghosted, larger copy of the canvas blends over the live frame; combined with non-zero Echo Zoom it becomes a feedback hall-of-mirrors effect. Echo Direction (Flip H/V/Both) controls how the echo is mirrored before compositing. |
| 8b ✅ | `dx` / `dy` — "Drift H" / "Drift V" sliders | −0.1–0.1 | 0, 0 | Constant per-frame translation. Tiny non-zero values (±0.005) create a slow gravitational crawl — the whole canvas drifts toward an edge over seconds. Larger values turn the canvas into a continuous scroll. Combined with `decay` < 1 you get persistent motion-blur trails. |
| 8c ✅ | `zoomexp` — "Zoom Curve" slider | 0.5–2.0 | 1.0 | Bends the zoom into a curve. **<1** = center-biased zoom (the middle zooms harder, edges stay still — fish-eye-out). **>1** = edge-biased zoom (the edges zoom harder, the middle stays — barrel pull). **=1** = uniform. Only visible when `zoom` itself is non-1.0. |
| 8d ✅ | `sx` / `sy` — "Stretch H" / "Stretch V" sliders | 0.8–1.2 | 1.0, 1.0 | Per-frame squish/stretch. **<1** compresses on that axis each frame (canvas shrinks toward Warp Center); **>1** stretches outward. Small values are subtle frame-by-frame compounding — a stretch of 1.02 looks gentle but accumulates over seconds into significant deformation. |
| 8e ✅ | `cx` / `cy` — "Warp Center X / Y" sliders | 0–1 | 0.5, 0.5 | **Highest-leverage off-center control.** Pivot point for `rot`, `sx`/`sy`, and the radial portion of `zoom`/`warp`. Default `0.5, 0.5` is why blank-canvas presets feel like they all radiate from screen center. Slide to a corner and the entire warp pipeline pivots there instead — rotation circles around the corner, zoom radiates from it. Single biggest "feels different" change you can make to a blank preset. **Implemented as two sliders for now** — XY-pad upgrade tracked in Phase 14. |

**Implementation (two files):**
- [`editor.html`](editor.html) — three new DOM blocks added to the Motion tab: `#motion-echo-alpha` (single slider under Echo Direction), `#motion-drift-sliders` ("Drift & Stretch" section header), `#motion-center-sliders` ("Warp Center" section header with explanatory section-note).
- [`src/editor/inspector.js`](src/editor/inspector.js) — `BLANK.baseVals` extended with all 8 fields; `_buildMotionSliders()` refactored to a sections array driving multiple containers from one builder; `_syncMotionSliders()` map extended; `btn-randomize-motion` randomizes the new fields conservatively (most rolls leave them near defaults so randomize doesn't feel chaotic).

**Notes:**
- **dx/dy range** — the .milk spec allows any float but values above ±0.05 scroll the entire visual off-screen within seconds. Clamped to ±0.1 for usability; randomize stays under ±0.02.
- **Equations caveat** — `cx`/`cy`/`dx`/`dy`/`sx`/`sy`/`zoomexp` are all standard MilkDrop baseVals BUT many library presets override them every frame in `frame_eqs_str`. For blank-canvas builds the sliders work directly; for library remixes they're starting values only — same caveat that applied to Phase 6 shapes. Phase 10 (EEL2 editor) is the unblocker for full control.
- **Older saves protected automatically** by the `loadPresetData` shallow-merge fix shipped earlier on 2026-05-04.

---

### Phase 9 — Blur range controls 📋 Future (power users)

> Medium complexity: only meaningful when the loaded preset uses `sampler_blur1/2/3` in its shaders.

| Step | Control | Range | Default | Notes |
|------|---------|-------|---------|-------|
| 9a | `blur1_min` / `blur1_max` sliders | 0–1 | 0, 1 | Clamp range for `sampler_blur1` texture |
| 9b | `blur2_min` / `blur2_max` sliders | 0–1 | 0, 1 | Clamp range for `sampler_blur2` texture |
| 9c | `blur3_min` / `blur3_max` sliders | 0–1 | 0, 1 | Clamp range for `sampler_blur3` texture |
| 9d | `modwavealphabyvolume` toggle | 0/1 | 0 | Fade the base wave when volume is low |

**Show/hide approach:** Collapse this sub-section by default. Consider only expanding it when the loaded preset's `warp` or `comp` shader source contains `sampler_blur` — detectable at load time with a simple string search on `currentState.warp` / `currentState.comp`.

---

### Phase 10 — EEL2 equation editor 📋 Future

Already designed as Phase 5 (see above). `< >` button in topbar → fullscreen overlay, three labeled textareas (Init / Frame / Pixel equations), live canvas still visible behind. No tab change — completely hidden from casual users.

Of the three equation surfaces, `per_pixel_eqs` is the headline unlock for **multi-vortex / off-center** composition: it runs once per output pixel with `x`, `y`, `rad`, `ang` available, so you can express totally arbitrary spatial transforms — zoom out from one corner while rotating around another, swirl one half of the screen clockwise and the other half counter-clockwise, etc. This is how the most original community presets are built. The cx/cy XY pad (Phase 8e) addresses the same problem at a single-pivot level; per-pixel equations give true freedom.

Prerequisite: clean One Truth state (Phases 1–4 complete ✅, Phase 7–9 complete).

---

### Phase 11 — Raw shader editor 📋 Future

Raw `warp` and `comp` GLSL editor. Since `comp` is auto-generated by the editor, manual edits must "detach" from auto-generation — design question: manual edit = detach, with a "Re-attach to editor controls" button to go back. Warp shader is always pass-through so editing it is straightforward.

---

### Phase 12 — .milk interoperability 📋 Future

| Step | What |
|------|------|
| 12a | Import `.milk` file — butterchurn already parses raw preset text via `loadPreset`; wire a file picker, read as text, pass through |
| 12b | Export to `.milk` — strip editor envelope fields (`id`, `name`, `images[]`, `thumbnailDataUrl`, `parentPresetName`), serialize remaining `baseVals` + `shapes` + `waves` + equation strings + shaders to INI format |

This closes the community interoperability loop: presets made in Preset Studio become valid `.milk` files playable in Winamp, WACUP, projectM, or any MilkDrop-compatible renderer. The One Truth work (Phases 1–4) is the prerequisite — `currentState` must be complete before strip-and-export produces a correct `.milk`.

---

### Phase 13 — Shape Composer 📋 Future (the off-center primitive)

> Replaces the removed Phase 6 Objects tab. Different framing — placement, not parameter editing.

The original Phase 6 tried to expose all 25 fields per shape and failed because almost every shape's geometry is overridden every frame by `frame_eqs_str`. The right framing is **placement**, not field-editing — let the user drop a shape at any X/Y on the canvas with a chosen size/color/sides, and treat it as a positioned visual primitive rather than as a thing whose 25 numeric fields to tweak.

**Why it earns a phase:** custom shapes are MilkDrop's primary mechanism for **off-center composition**. Each shape has independent `x`/`y`, so 4 shapes = up to 4 visual centers on screen — the cleanest escape from the "everything radiates from canvas center" default that pure-baseVals presets fall into. cx/cy (Phase 8e) moves the *single* warp pivot; shapes give you *multiple* simultaneous focal points.

| Step | What |
|------|------|
| 13a | "Add Shape" button on the Wave / Layers tab — opens a small shape-card stack mirroring image layers |
| 13b | Per-card controls: position XY pad, size, sides (3–500), color + alpha, border color, additive toggle, textured toggle |
| 13c | Drop equations entirely from the UI — preserved in `currentState.shapes[i].frame_eqs_str` for round-trip with library presets, but the editor only writes/reads `baseVals`-level fields |
| 13d | Drag-on-canvas placement — click-drag a shape directly on the preview to move it. Reuse the image layer "Center" XY pad pattern. |
| 13e | Optional per-shape audio reactivity — bass/mid/treb/vol drives radius or alpha (carries the image-layer reactivity model over to shapes) |

**Critical UX note:** Make it visually obvious that loaded library shapes are equation-driven by showing a small "⚙ animated by equations" badge on the card. The slider values are starting values only — if the user wants direct control, they need to clear the equation string (Phase 10 surface) or start from blank.

---

### Phase 14 — In-app tooltip pass 📋 Future (polish)

Today the docs (and the user guide) describe what each control does, but the editor itself is mostly self-documenting via labels alone. A pass to add `data-tooltip` strings to every slider / segmented control / toggle in the editor — leveraging the existing CSS at `src/editor/style.css` `[data-tooltip]` block, which already renders hover popups for free.

| Step | What |
|------|------|
| 14a | Extend `makeSlider()` to accept an optional `tooltip` field; when set, applies `data-tooltip` to the `.slider-row` |
| 14b | Sweep the Wave tab — Smoothing, Position X/Y, Mystery, additive, brighten, etc. |
| 14c | Sweep the Motion tab — Zoom, Rot, Warp, WarpSpeed, WarpScale, Decay, Echo Zoom, Echo Orient, b1ed |
| 14d | Sweep the Palette tab — Gamma, Glow size/alpha, Accent size/alpha, darken, invert |
| 14e | Sweep the Image / Layers tab — every per-layer control (already has many tooltips; audit for gaps) |

**One-sentence-each-with-a-vivid-mental-image** is the bar — see Phase 7 doc descriptions in this file for the tone.

---

## ✅ Closed bug — Preset load state contamination (May 2026)

> **Status:** Fixed 2026-05-04 → [docs/bugs/preset-load-contamination.md](docs/bugs/preset-load-contamination.md)
>
> First foundational step toward the One Truth Goal below. Preset load is now genuinely clean across all 4 entry points.

**Symptom:** Loading a preset does not clear out settings from the previously-loaded preset. Affects every load entry point:

1. `?preset=NAME` URL handler — main app drawer "Remix in Studio" icon, floating control bar pencil, direct link
2. `?custom=KEY` URL handler — main app drawer "Edit in Studio" pencil on custom rows
3. In-editor Remix picker (`Remix…` button in panel footer)
4. Library panel card click (`handleLibraryLoad(id)`)

**What was wrong (2 layers, both needed):**

1. **State / DOM seam:** The 4 loader paths funnel into 2 inspector methods (`loadBundledPreset`, `loadPresetData`). Both diverged from the working `_bindReset` pattern in different ways — `loadPresetData` overlaid saved fields directly onto `currentState` (no BLANK base, so older saves missing newer fields produced `undefined → NaN` sliders), called `_buildCompShader()` *before* the image loop (so image GLSL was missing from the rebuilt comp), and never cleared variation chips, palette chips, `_solidColor`, or Solid FX panel visibility.
2. **GPU framebuffer:** butterchurn keeps `prevTexture` / `targetTexture` framebuffers across `loadPreset` calls. The editor's auto-built comp uses `texture(sampler_main, uv) * 2.0` as base color — a 2× amplifier. Combined with butterchurn's typical `decay ≈ 0.98`, this creates an amplification loop where bright pixels from the previous preset saturate at 1.0 and never fade. Geiss's zebra warp stayed fully visible behind a fresh custom preset's image layers.

**The fix:**
- Extract `_clearForLoad()` shared by reset / `loadBundledPreset` / `loadPresetData`.
- `loadPresetData` overlays saved fields onto BLANK (not directly into `currentState`).
- `_buildCompShader()` runs after the image loop.
- New `clearFeedbackBuffer()` on `VisualizerEngine` zeroes butterchurn's `prevFrameBuffer` / `targetFrameBuffer` via direct GL calls.

**Architectural insights this exposed (load-bearing for future work):**
- The 2× brightness in `_buildCompShader` is **not** removable — it matches butterchurn's own default comp's brightness boost, and removing it dims every editor preset by half. But it makes any sample-and-write-back path on `sampler_main` an amplification loop unless the framebuffer is explicitly reset at boundaries. New base-color modes that read `sampler_main` need to think about this.
- Reaching into `visualizer.renderer.prevFrameBuffer` is private-API. Works on butterchurn 2.6.7. If butterchurn ever exposes a public `clearFeedback`, switch to it. The accessors are `?.`-chained so missing fields fail silently rather than throwing.
- "Clean preset load" now means BOTH state-side cleanup AND framebuffer cleanup. Both must happen for a true reset.

This bug is the first concrete step toward the One Truth Goal below. Fixing the load path was the prerequisite — the schema-unification work that closes the export bug ([docs/preset-editor/library-panel.md](docs/preset-editor/library-panel.md) §10) is the next step.

---

## The One Truth Goal — Primary Architecture Objective

> Captured Apr 2026. This is the north star for the next major dev phase.

### The problem today

The editor operates with two separate, incompatible worlds:

- **MilkDrop library presets** — complete objects: full `baseVals`, `shapes[]`, `waves[]`, `warp` shader, `comp` shader, equation strings. Everything is there.
- **Custom presets** — partial objects: only what the editor's tabs currently expose (`images[]`, `comp` shader, a subset of `baseVals`). The rest is silently absent.

Because these two worlds never fully merge, three problems exist simultaneously:
1. **You can't edit a library preset** — no entry point to load one into the editor
2. **Export is incomplete** — the exported `.json` only contains what the editor's `currentState` knows about (image layers + partial `baseVals`), not the full preset
3. **Import round-trip is lossy** — importing a file back in doesn't restore everything that was set

### The one truth principle

> **`currentState` must always be the complete, authoritative representation of the entire preset — every `baseVal`, every shape, every wave, both shaders, all equation strings, all image layers. Nothing lives anywhere else.**

When this is true:
- Save = serialise `currentState`. Done.
- Export = serialise `currentState`. Done.
- Import = deserialise into `currentState`, sync all controls. Done.
- Load library preset = deserialise into `currentState`, sync all controls. Done.
- All three bugs above disappear as side effects — no separate fix required for any of them.

### How the Remix / import-for-editing work achieves this

Building the "load any preset into the editor" flow forces the implementation to be correct:

1. Read the full preset object (library or custom) into `currentState` — every field, nothing omitted
2. Sync every editor control (all tabs) to reflect that full object
3. On every user interaction, write back to `currentState` immediately
4. Save / export reads only from `currentState`

Step 1 is the unlock. Once `currentState` is always populated completely, steps 2–4 are already mostly working — the controls already write to `currentState.baseVals` live. The gap is only on the *read* side (loading) and the *schema* side (ensuring all fields are present).

### Dependency chain

```
Remix / import-for-editing flow
        ↓
currentState holds the complete preset object (one truth)
        ↓
Save writes complete object        → export bug fixed
Export serialises complete object  → export bug fixed
Import → currentState → sync       → import round-trip fixed
Load library preset → same path    → remix feature ships
```

**This one piece of work closes four problems.** It is the right place to invest before adding any more editor controls or export features.

### MilkDrop compliance — the standard we target

The custom preset schema must be a **strict superset** of a valid MilkDrop preset — never a subset. The core fields are the MilkDrop standard:

| Field | Standard |
|-------|---------|
| `baseVals` | MilkDrop spec |
| `shapes[]` | MilkDrop spec |
| `waves[]` | MilkDrop spec |
| `warp` | MilkDrop GLSL |
| `comp` | MilkDrop GLSL |
| `*_eqs_str` | MilkDrop spec |

The editor-specific fields (`id`, `name`, `images[]`, `thumbnailDataUrl`, `parentPresetName`) are our envelope around the standard. Strip those off and what remains is a valid MilkDrop preset playable in any compliant renderer — Butterchurn, Winamp, WACUP, any future port.

**This unlocks:**
- Sharing presets with the wider MilkDrop community
- Loading community `.milk` files into the editor (future)
- Exporting back to `.milk` format (future)
- Interoperability with any MilkDrop-compatible software, forever

The moment the editor invents its own field names or silently omits standard ones, we've created a proprietary format that only works inside this app. Compliance with the standard is what keeps the door open.

### What "done" looks like

- Open any of the 1,144 library presets in the editor — all tabs reflect its values
- Make changes, save — the saved preset contains everything, not just the image layer
- Export the saved preset — the `.json` is the complete preset, importable anywhere
- Import that `.json` back — all settings restored perfectly, including palette, motion, wave, feel, and images
- Strip the editor envelope fields → valid `.milk`-compatible object that any MilkDrop renderer can play

### Progress so far

| Step | Status |
|---|---|
| Load any library preset into the editor | ✅ Shipped (`?preset=`, Remix picker, "Remix in Studio" icon) |
| Load any custom preset into the editor | ✅ Shipped (`?custom=`, Library panel) |
| **Load is genuinely clean** — no leakage between presets, both state-side and GPU-side | ✅ Shipped 2026-05-04 — see [docs/bugs/preset-load-contamination.md](docs/bugs/preset-load-contamination.md) |
| `currentState` always holds the complete preset object | 🟡 Partial — `loadPresetData` now overlays onto BLANK, so missing fields fall back to defaults instead of being absent. But the editor still doesn't write to all `baseVals` / shapes / waves the user could touch in a remixed library preset (the One Truth gap). |
| Save serialises the complete preset object | 🔴 Not yet — same gap. Save writes whatever's in `currentState`, which is a strict superset of the editor's controls but a strict subset of a full library preset. |
| Export = save | 🟡 Already true mechanically; will become correct automatically once save is correct. |
| Strip envelope → valid `.milk` | 🔴 Not yet — depends on save being complete. |

The **clean load** step (May 2026) was the unblocker. With load now reliable, the next sensible piece of One Truth work is making sure every control the user can touch in the editor maps deterministically into `currentState` — and conversely, that loading a remixed library preset preserves the parts of `baseVals` / `shapes` / `waves` / `frame_eqs_str` the editor doesn't directly expose. That alone closes the export bug as a side effect.

### Tuning controls — what to keep in mind

Any time we add, remove, or change a control in the editor, run it through this checklist:

1. **Does the new control write to `currentState`?** All user-visible state must live there, not in a side variable. Use `_preSnap` / `_postSnap` to make it undoable.
2. **Does `_clearForLoad` cover it?** Variation chips, palette chips, scene mirror, Images Only — all of these have UI active states that need explicit clearing on preset load. New segmented controls / chips need to follow the same pattern.
3. **Does it have a default in `BLANK`?** If not, older saves that pre-date the field will load with `undefined` and `_syncSlider` will produce `NaN` value labels. Always extend `BLANK` when adding a slider.
4. **Does it survive round-trip?** Save a preset with the new control set, reload via Library, verify the value is restored.
5. **If it touches `_buildCompShader`, does it sample `sampler_main`?** If yes, audit whether the new code path could create a feedback amplification loop (any read-write-read-write cycle on `sampler_main` with a multiplier > decay). If the answer might be yes, ensure boundary clears happen via `clearFeedbackBuffer()`.

---

## Creative Vision — Tool-Agnostic Philosophy

> Captured from design conversation, Apr 2026.

The editor is not an "image tool" or a "pattern tool" — it is a preset tool. All features (image layers, motion controls, wave settings, equations, shaders) are available simultaneously and users use what they want and ignore the rest. There is no "either/or" — the tools are all there.

### Three valid creative paths (all first-class)

**Path A — Pure MilkDrop / Pattern remix**
No images. Load a library preset → tweak `zoom`, `rot`, `warp`, `decay`, colors, wave mode → save as your own. Output is a butterchurn preset that runs on any device at any resolution with zero texture memory. This is how the original MilkDrop community worked for 20 years — thousands of presets, none of them using images.

**Path B — Image composer on top of a pattern**
Pick a base pattern (blank or library remix), layer images/GIFs on top with the full motion control set. The pattern is the animated background, images are the foreground. This is the DiscoCast-specific creative layer on top of MilkDrop.

**Path C — Images only**
The "Images Only" toggle already exists — hides the butterchurn base entirely (black background), pure image composition. Good for logo work, branding overlays, clean visual sets.

### The missing entry point: "Remix from Library"

Right now the editor only starts from a blank canvas. The one missing piece is a **"Remix a Preset" entry point** — browse the 1,144 library presets, pick one, open it in the editor with all its `baseVals`, `shapes`, `waves`, `warp`, `comp`, and `frame_eqs_str` loaded. Then use any or all of the editor's tools from there.

This changes what the tool *is*, not just what it can do. People can:
- Start from a pattern they already love
- Layer their own images on top with no obligation to
- Tweak just the colors or motion
- Save as their own custom preset with `parentPresetName` tracking the origin

**Data model:** fully supported already. `parentPresetName` field exists in the schema. `engine.presets[name]` contains the full preset object. `loadPresetData()` already handles the load. The missing piece is just the picker UI and handoff.

### Proposed start screen entry points (future)

| Entry | What it does |
|-------|-------------|
| **Blank canvas** | Current behaviour — pick a variation, start from scratch |
| **Remix a preset** | Browse 1,144 library presets → opens in editor with all settings loaded |
| **Continue editing** | Load a saved custom preset from your library |

---

## Performance — Realistic CPU/GPU Budget

> Research only — not yet implemented. Apr 2026.

### What the engine actually costs

The render loop runs `visualizer.render()` every `requestAnimationFrame` (~16ms at 60fps). Cost breakdown:

| Component | Cost | Notes |
|-----------|------|-------|
| Butterchurn base render | Medium–High | Varies enormously by preset. Simple patterns: ~2–4ms. Complex pixel_eqs + warp shaders: 8–14ms. |
| Per image layer | Low–Medium | Each layer adds GLSL texture samples + blend math. 1 layer ≈ +0.5–1.5ms. 5 layers ≈ +3–6ms. |
| GIF animation | Low | `_tickGifAnimations()` — frame swaps only. Speed slider 0.25×–8× (raised May 2026). **Colour cycling bug fixed** — pixel-store state (UNPACK_FLIP_Y_WEBGL, UNPACK_PREMULTIPLY_ALPHA_WEBGL, UNPACK_ALIGNMENT) now saved/restored around `texSubImage2D` to prevent Butterchurn state leakage. |
| Comp shader rebuild | Spike | `_buildCompShader()` fires on control changes. Takes 0.1–2ms. **Debounced at 16ms** for image layer slider drags (May 2026) — rapid moves coalesce into one rebuild instead of 30+/sec. |
| AGC / audio analysis | Negligible | ~0.1ms per frame |
| Texture rebind | Spike (avoided) | `setUserTexture()` rebinds all images on `_applyToEngine()`. **Skip flag added** (May 2026) — Motion/Wave/Palette sliders pass `skipTextures=true`, eliminating redundant rebinds when only baseVals change. |

### Budget targets

| Scenario | Target frame time | Notes |
|----------|-----------------|-------|
| Healthy | < 8ms | 60fps headroom on most hardware |
| Warning zone | 8–14ms | May drop frames on integrated GPU / older laptop |
| Critical | > 16ms | Will visibly drop below 60fps |

### What drives cost up fast

1. **Complex base preset with `pixel_eqs_str`** — per-pixel equations run on the GPU for every pixel every frame. Some presets use 20+ variables with trig functions. This alone can cost 6–12ms.
2. **Many image layers at high resolution** — each layer adds texture sampling. HD layers (2048px) cost more than standard (1024px). 5 HD layers on a complex base preset is the worst case.
3. **GIF layers** — texture uploads per frame swap. Low GPU cost but non-zero CPU cost for the frame tick loop.
4. **Canvas size** — full 4K output costs ~4× more than 1080p. The editor preview is constrained by panel size so this is mostly a live-show concern.

### GIF Optimizer — Implementation (May 2026)

Upload-time optimization modal for large animated GIFs. Built as a response to real-world testing showing that even modest 480×360 GIFs with many frames immediately slow down when effects are applied.

**Thresholds (aggressive):**
- Frame count > 10, OR
- Resolution > 256px (longest side), OR  
- File size > 1MB

**Files added/modified:**
- `src/editor/gifOptimizer.js` — New module. `parseGifFile()`, `processGifFrames()`, `shouldOptimize()`, `getRecommendedSettings()`, `generateFrameStrip()`, `formatBytes()`, `estimateGpuMemory()`
- `editor.html` — Modal HTML with stats header, frame strip, "keep every Nth" slider, size buttons (128/192/256/Original), result preview
- `src/editor/inspector.js` — Import optimizer, `_bindGifOptimizer()`, `_handleGifUpload()`, `_showGifOptimizerModal()`, `_updateGifOptimizerPreview()`, `_addOptimizedGifLayer()`
- `src/visualizer.js` — Modified `setUserTexture()` and `_loadGifTexture()` to accept `optimizedGifData` with pre-processed frames/delays

**Flow:**
1. Drop/pick GIF → `_handleGifUpload()` checks thresholds
2. If over threshold → parse with `gifuct-js`, show modal with Preview.app-style stats (filename, dims, frames, file size, GPU estimate)
3. User adjusts "keep every Nth" slider (1–20) → live preview updates with frame strip and % savings
4. User selects resize target (128/192/256/Original) → output dims update
5. Click "Apply & Add Layer" → `processGifFrames()` composites + resizes → frames stored in `_processedGifCache` → passed to visualizer via `file._processedGifKey`
6. Visualizer's `_loadGifTexture()` bypasses re-parsing if `optimizedData` present

**Key implementation details:**
- Frame compositing happens in-memory with pure JS (no canvas) — same approach as visualizer
- **Delay formula:** `adjustedDelay = originalDelay / (keepEveryN / 3)` — scales delays moderately for smooth animation with fewer frames (clamped 10-500ms)
- Resize uses nearest-neighbor for speed (adequate for the typical output sizes)
- Frame strip preview shows up to 20 thumbnails (80×80px) with original frame index numbers
- GPU memory estimate: `width * height * 4 * frameCount * 1.1` (10% texture overhead)
- Modal: 900px wide, 2-column controls layout, live preview of optimization results

### Warning system (to build)

The dev HUD (backtick `` ` ``) already shows:
- FPS (rolling 60-frame average)
- Frame time (ms)
- Layer count
- Estimated texture VRAM (MB)
- Last shader build time (ms)

**What to add — a visible performance budget bar in the editor UI (not just the dev HUD):**

| Indicator | Trigger | Message |
|-----------|---------|---------|
| 🟢 Green | < 8ms avg frame | All good |
| 🟡 Yellow | 8–14ms avg frame | "Getting heavy — consider fewer layers or a simpler base preset" |
| 🔴 Red | > 14ms avg frame | "Frame drops likely on slower hardware" |
| ⚠️ Layer warning | 4+ image layers on a complex base | "High layer count + complex base — test on target hardware" |
| ⚠️ HD warning | HD layer + 3+ other layers | "HD textures increase VRAM pressure" |
| ⚠️ pixel_eqs warning | Base preset has `pixel_eqs_str` | "This preset uses per-pixel equations — GPU intensive" |

**Implementation approach:**
- Read `_hudTimes` rolling average already computed in `_initDevHud()`
- Check `currentState.images.length` and `pixel_eqs_str` presence
- Render a small status indicator in the editor topbar or above the layer stack
- Always visible (not hidden behind backtick) so users see it as they build
- No hard limits — warnings only, user decides. This is creative software, not a safety system.
