# Future Dev Features: Silent Disco & Live DJ Enhancements

Since DiscoCast (MilkScreen) is going to be bundled with a Silent Disco application, we have an awesome opportunity to make the visualizer an actual performance tool for DJs and a more immersive experience for the dancers. 

## ✅ Implemented Features (Performance Suite)
- **⚡ Performance "Hype" Keys**: Instant triggers for Strobe (`V`), Blackout (`B`), and Invert (`I`).
- **🎚️ Audio Reactivity Tuning**: 
  - **Visual Energy Slider**: Master sensitivity control (0.2x to 5.0x).
  - **Auto-Gain (AGC)**: Real-time dynamic normalization (ON by default).
  - **Kick-Lock Mode**: Bass-frequency isolation (150Hz low-pass) for beat-locked visuals.
  - **Momentary Boost**: Hold `Shift` for instant 2x energy (keyboard only — the on-screen MAX BOOST button was removed to keep the bar clean during live use).
- **❤️ Favorites-Only Cycling** *(2026-04-19)*: Third switch in the Preset Cycling popover restricts auto-cycle to hearted presets — a first step toward the "Preset Crates" idea below.
- **🎛️ Material-style Toggle Switches** *(2026-04-19)*: All popover checkboxes replaced with sliding switches for cleaner live-performance UX.
- **👀 Engaged-State Auto-Hide** *(2026-04-19)*: Control bar stays visible while hovered or while a popover is open; click outside a popover dismisses it and restarts the 3-second fade.
- **🎨 Preset Studio — Phase A** *(2026-04-20)*: Standalone visual preset builder at `/editor.html`. Distinct from the main app — canvas-first design, museum dark, frosted-glass start card. Full details below.

---

## 🎨 Preset Studio — Phase A *(complete 2026-04-20)*

Standalone visual preset builder at **`/editor.html`** — a separate identity from the main app, not a remix of its start screen.

### Architecture
- **Vite MPA** — dual Rollup entry (`index.html` + `editor.html`); editor bundle is fully isolated.
- **`src/editor/main.js`** — entry point, boots `VisualizerEngine` on user audio source selection, hands off to `EditorInspector`.
- **`src/editor/inspector.js`** — `EditorInspector` class, ~600 lines. All panel logic.
- **`src/editor/style.css`** — museum dark standalone stylesheet (no dependency on `src/style.css`).
- **`src/customPresets.js`** — CRUD over `milkscreen_custom_presets` (localStorage) + `milkscreen_images` (IndexedDB).
- **`src/presetRegistry.js`** — merge layer: bundled + custom under one `getAllNames()` / `getByName()` API.
- **`src/visualizer.js`** additions: `loadPresetObject(obj, blendTime)` for live preview; `setUserTexture(name, bitmap)` for image shader binding.
- **Canvas Mirror** *(2026-04-21)*: Scene-level UV fold in the comp shader. Uses a local `uv_m` alias instead of reassigning `uv` (which is already declared in butterchurn's `main()` scope and also typed as a read-only `in` varying — both GLSL compile errors). `_buildImageBlock()` references `uv_m` for all center-offset calculations so images fold with the scene.

### Start screen
Frosted-glass card centred over pulsing concentric ring animation (CSS only, no JS). Two buttons: **Use Microphone** / **Load Track**. No preset picker — the Studio always starts from a clean blank slate.

### Panel tabs

| Tab | Controls |
|-----|----------|
| **Palette** | 12 palette chips (Mono → Plasma, each a Wave + Glow pair) · 3 color swatches (Wave / Glow / Accent) with native color picker · Brightness + Trail sliders · Invert / Darken toggles |
| **Motion** | Zoom / Spin / Warp / Warp Speed / Echo Zoom sliders · 4-way Echo Direction segmented control · Randomize button |
| **Wave** | 8 visual shape buttons (icon grid) · Size + Opacity sliders · Thick / Dots / Additive toggles · Randomize button |
| **Feel** | Energy + Bass Sensitivity (engine-level, not saved in preset) · AGC toggle |
| **Image** | Canvas Mirror segmented (None / H / V / Both) · Drag-drop zone · Up to 2 layer cards · per-layer mirror (Off / H / V / Quad / Kaleido) · treatment select per layer |

### Color system
Wave → `wave_r/g/b`, Glow → `ob_r/g/b + ob_a`, Accent → `ib_r/g/b + ib_a`. Palette chips set Wave + Glow as a matched pair; individual swatches override freely afterwards.

### Editing model
- Every change calls `engine.loadPresetObject(currentState, 0)` — instant live preview.
- 50-deep undo stack; one entry per pointer interaction (pointerdown → pointerup).
- **A/B** — hold button previews original state; release restores current.
- **Save** → opens name modal → `createCustomPreset()` writes to localStorage.
- **Reset** → restores `BLANK` defaults.
- `⌘Z` / `⌘⇧Z` keyboard undo/redo wired in `editor/main.js`.

---

## 🚀 Phase B — Main App Integration *(next)*

Preset Studio data is already written to the same storage the main app will read. Phase B wires the two together:

1. **"Mine" tab** in the preset drawer (`src/controls.js`) — reads from `presetRegistry.getCustomPresets()`.
2. Custom presets participate in favorites, hide, and cycle automatically — they are just names in the registry.
3. **"Remix" button** per drawer row opens `EditorInspector` as a side panel inside the main shell.
4. `editor.html` stays live as a dedicated full-workspace; Inspector becomes embeddable in the main app too.

---

## 🚀 Upcoming Artistic & DJ Enhancements

### 1. 🎧 Multi-Channel Vibe Sync
Silent discos are all about the colored channels (Red, Green, Blue). The visuals should reflect the vibe of the channel that's currently crushing it.
- **Color Overrides**: Instantly tint or wash the entire visualizer in Red, Green, or Blue to match the active channel.
- **Channel Hotkeys**: Press `1` (Red), `2` (Green), or `3` (Blue) to switch to presets that heavily feature those colors.

### 2. 🎛️ MIDI Controller Integration
Give the visualizer physical tactility so a VJ or DJ can "play" it live.
- **Plug and Play**: Map standard USB MIDI controllers (Akai APC, Novation Launchpad) to the app.
- **Hardware Knobs**: Map the "Visual Energy" slider and "Volume" to physical knobs on the DJ's controller.

### 3. ⏱️ Live Tempo (BPM) Mapping
- **Beat Sync**: Analyze the audio feed to guess the BPM and lock the visualizer's "decay" rates to the tempo.
- **Groove Control**: Toggles for half-time (trap/dubstep) or double-time (DnB) reaction rates.

### 4. 🗂️ Preset "Crates" (Visual Setlists)
Expand the "Favorites" system into organized collections for different parts of the night. *(Favorites-only cycling is the first step — it already lets a DJ curate a single pool. Crates would add multiple named pools and switchable contexts.)*
- **Genre Crates**: "Warmup Room", "Peak Hour Techno", "Sunrise Chillout".
- **Dynamic Crossfade**: Adjust blend times (1s to 20s) based on the current set energy.

### 5. 🎨 Alpha Mask Silhouettes
- **Branded Overlays**: Upload a transparent PNG logo or silhouette (e.g., a dancer, a skull, a logo) and have the MilkDrop visuals only render *inside* the mask or wrap around its edges for a branded stage look.

### 6. 📽️ Multi-Monitor / VJ Out
- **Clean Feed**: Add a button to open a second, "Clean" window (without UI) that can be dragged to a projector or LED wall while keeping the control bar on the laptop screen.
