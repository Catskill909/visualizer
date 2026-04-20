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
