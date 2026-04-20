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
| Pulse | 0–2 | Bass drives size up (or down if Shrink is on) |
| Shrink | Toggle | Reverses pulse direction — shrinks on beat |
| Spin | -3–3 | Rotation speed (per-tile when Tile ON) |
| Orbit | 0–0.45 | Orbit radius around screen center |
| Bounce | 0–0.4 | Bass pushes image upward on beat |
| Tunnel | -2–2 | Infinite zoom through tiled field (+= toward, -= away) |
| Images Only | Toggle (header) | Hides base visualizer — black background + images only |

### Tunnel implementation

`pow(2, fract(t × speed))` seamless zoom — tiles repeat at exactly 2× scale so
the loop snap is invisible. Implemented as a **two-layer crossfade** where:
- Layer A uses `pow(2, phase)` (scale 1→2)
- Layer B uses `pow(2, phase−1)` (scale 0.5→1)
- Blend weight = `phase` — continuously interpolated across the full cycle
- At wrap: blend=1, B at scale 1.0 → A picks up at scale 1.0 → seamless

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

**Save:** Writes to `milkscreen_custom_presets` in localStorage via `createCustomPreset`.
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

- Color tint per image layer
- Audio-reactive orbit radius (orbit grows on bass)
- More blend modes
- Export / import preset as `.json`
- "Mine" tab in main app preset drawer (custom presets already write to the right localStorage key)
- Remix button in main app: open editor from existing preset
