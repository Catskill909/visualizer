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

---

## MilkDrop Settings Audit — What Exists vs What the Editor Exposes

> Last audited: Apr 2026. Source: `src/editor/inspector.js` BLANK state + butterchurn preset schema.

A full MilkDrop preset has three tiers of settings: **baseVals** (numeric parameters), **custom shapes/waves** (per-object blocks), and **equation strings** (scripting language). The editor currently covers tier 1 partially and tier 3 not at all.

---

### Tier 1 — `baseVals` (numeric parameters)

~40 fields total. Editor exposes ~20.

#### ✅ Currently exposed

| Field | Editor location |
|-------|----------------|
| `zoom` | Motion → Zoom |
| `rot` | Motion → Spin |
| `warp` | Motion → Warp |
| `warpanimspeed` | Motion → Warp Speed |
| `echo_zoom` | Motion → Echo Zoom |
| `echo_orient` | Motion → orientation buttons |
| `decay` | Palette → Trail |
| `gammaadj` | Palette → Brightness |
| `wave_mode` | Wave → 8-mode grid |
| `wave_r/g/b` | Palette → Wave color swatch |
| `wave_a` | Wave → Opacity |
| `wave_scale` | Wave → Size |
| `wave_thick` | Wave → Thickness toggle |
| `additivewave` | Wave → Additive toggle |
| `wave_usedots` | Wave → Dots toggle |
| `ob_r/g/b` | Palette → Glow color swatch |
| `ib_r/g/b` | Palette → Accent color swatch |
| `darken` | Feel → toggle |
| `invert` | Feel → toggle |

#### ❌ Not yet exposed

| Field | Meaning | Priority | Effort |
|-------|---------|----------|--------|
| `warpscale` | Spatial scale of the warp pattern — "zoomed in" vs "tiled" warp | Medium | One slider on Motion tab |
| `wave_mystery` | Waveform position offset along its path | Low | One slider on Wave tab |
| `wave_brighten` | Brighten the waveform vs. the background | Low | Toggle on Wave tab |
| `ob_size` | Outer border / glow ring thickness | Medium | Slider — currently only auto-set by color picker |
| `ob_a` | Outer border opacity | Medium | Slider — same |
| `ib_size` | Inner border thickness | Low | Slider |
| `ib_a` | Inner border opacity | Low | Slider |
| `mv_x` | Motion vector grid columns | Low | Slider |
| `mv_y` | Motion vector grid rows | Low | Slider |
| `mv_l` | Motion vector line length | Low | Slider |
| `mv_r/g/b` | Motion vector color | Low | Color swatch |
| `mv_a` | Motion vector opacity | Low | Slider — 0 hides them entirely |
| `b1ed` | Beat sensitivity curve (0=sharp, 1=smooth) | Medium | One slider on Feel tab |

**Quick wins** (one session): `warpscale`, `ob_size`, `ob_a`, `b1ed` — four sliders that unlock a lot of variation in real MilkDrop presets and are trivial to add.

---

### Tier 2 — `shapes[]` and `waves[]` (custom object arrays)

Each preset can have up to **4 custom shapes** and **4 custom waveforms**. These are what make complex presets complex — spinning geometry, hand-drawn waveforms, per-object color animation.

#### Shapes (up to 4 per preset)

Each shape object has:

| Field group | Fields |
|-------------|--------|
| Basic | `enabled`, `sides` (3–100), `additive`, `textured` |
| Size / position | `x`, `y`, `radius`, `ang` (rotation), `angvel` (spin speed) |
| Color | `r`, `g`, `b`, `a` (fill), `border_r/g/b/a/size` |
| Audio reactivity | `rad_freq`, `rad_ang`, `rad_amp` (radial audio warp), `tex_zoom`, `tex_ang` |
| Inner border | `inner_r/g/b/a/size` |
| Per-shape equations | `init_eqs_str`, `frame_eqs_str` |

**Status: ❌ Not exposed.** Building a shapes editor is a medium build — card-based UI per shape (like image layers), ~15 sliders + color pickers per card.

#### Custom Waves (up to 4 per preset)

Each wave object has:

| Field group | Fields |
|-------------|--------|
| Basic | `enabled`, `spectrum` (time vs freq domain), `dots`, `thick`, `additive` |
| Color | `r`, `g`, `b`, `a` |
| Sample / position | `scaling`, `smoothing`, `sep`, `mystery` (offset) |
| Per-wave equations | `init_eqs_str`, `frame_eqs_str` |

**Status: ❌ Not exposed.** Custom waves are what makes the waveform behavior in complex presets — they can animate independently of `wave_mode`, be positioned anywhere, and react to audio in unusual ways.

---

### Tier 3 — Equation strings (MilkDrop scripting)

Three global equation fields that run every frame:

| Field | Runs | Typical use |
|-------|------|-------------|
| `init_eqs_str` | Once at load | Set initial variable values |
| `frame_eqs_str` | Every frame | Animate `zoom`, `rot`, `wave_r`, custom vars — anything |
| `pixel_eqs_str` | Every pixel | Per-pixel UV distortion (most expensive, most powerful) |

Plus per-shape and per-wave `init_eqs_str` / `frame_eqs_str`.

**Status: ❌ Not exposed.** These are the MilkDrop scripting language — a C-like expression syntax that references ~100 built-in variables (`bass`, `mid`, `treb`, `time`, `zoom`, `rot`, etc.). Every complex preset uses them.

**Exposing them**: a `<textarea>` per field is technically simple. Understanding them requires knowing the MilkDrop variable reference. A read-only display when loading a library preset ("this preset uses frame equations") would be a useful first step, making them editable comes after.

---

### Tier 4 — GLSL shaders (`warp`, `comp`)

| Field | Meaning |
|-------|---------|
| `warp` | Per-pixel warp shader — distorts the UV coordinates fed into the feedback buffer |
| `comp` | Composite shader — blends the warp buffer with waveforms and sets final pixel color |

**Status:** `comp` is auto-generated by the editor from image layer state. `warp` is passed through unchanged. Neither is user-editable yet. A raw GLSL code editor would be advanced territory — Monaco editor or a `<textarea>` with syntax highlighting.

---

### Summary: what to build next

| Priority | What | Tab | Effort |
|----------|------|-----|--------|
| 1 | `warpscale` slider | Motion | 30 min |
| 2 | `ob_size` + `ob_a` sliders | Palette | 30 min |
| 3 | `b1ed` beat sensitivity slider | Feel | 20 min |
| 4 | `mv_a` motion vector opacity (hide at 0 = no change) | Motion | 20 min |
| 5 | Load library preset into editor ("Remix" flow) | Architecture | 2–3 hrs |
| 6 | `wave_mystery` + `wave_brighten` | Wave | 30 min |
| 7 | `ib_size` + `ib_a` sliders | Palette | 30 min |
| 8 | Full motion vector controls (`mv_x/y/l/r/g/b/a`) | Motion | 1 hr |
| 9 | Equation string display (read-only) | New "Code" tab | 1 hr |
| 10 | Shapes editor (card per shape, like image layers) | New "Shapes" tab | 1–2 days |
| 11 | Custom waves editor | New "Waves" tab | 1–2 days |
| 12 | Equation string editor (editable textarea per field) | Code tab | 1 hr (after #9) |
| 13 | Raw GLSL editor for `warp` / `comp` | Code tab | 2 hrs |

Items 1–4 are a single clean session and cover all the easy missing `baseVals`. Item 5 (library preset import) is the architecture unlock that makes everything else more useful — editing a blank canvas is very different from remixing a great MilkDrop preset.

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
| GIF animation | Low | `_tickGifAnimations()` — frame swaps only, no GPU cost beyond texture upload |
| Comp shader rebuild | Spike | `_buildCompShader()` fires on every control change. Takes 0.1–2ms. Not a runtime cost — edit-time only. |
| AGC / audio analysis | Negligible | ~0.1ms per frame |

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
