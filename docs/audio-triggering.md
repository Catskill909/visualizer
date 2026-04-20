# Audio Triggering Research: Winamp Legacy vs. Modern DJ Performance

This document explores how audio triggering works in classic visualizers like MilkDrop (Winamp) and modern VJ setups, providing a roadmap for implementing professional-grade intensity controls in the current app.

## 1. The Winamp/MilkDrop Legacy
In the original Winamp MilkDrop, audio responsiveness was handled with a mix of "set and forget" global settings and highly specific per-preset code.

### Dynamic Thresholds
MilkDrop doesn't use a static "beat" volume. It uses **decaying thresholds**:
- **Mechanism**: The engine maintains variables like `bass_thresh`. If the incoming `bass` signal > `bass_thresh`, a beat is triggered.
- **Auto-Learning**: Immediately after a beat, `bass_thresh` jumps up to the peak level and then slowly decays over time until it hits the next peak. 
- **The Result**: This allows the visualizer to "learn" the volume of the music. If the track gets quieter, the threshold decays until it starts catching the smaller beats again.

### Per-Preset Logic
Standard MilkDrop presets hardcode their sensitivity in the `.milk` file:
- Creators write equations like `zoom = zoom + bass*0.1`.
- There was **no master sensitivity slider** in Winamp. If a preset was too jumpy, you had to edit its code manually.

---

## 2. Modern VJ Triggering Techniques
Professional VJ software (Resolume, VDMX, Synesthesia) treats audio as a control signal (like MIDI) that can be massaged before reaching the visual.

### The "Gain" Fader
The most critical tool for a live DJ is a **Master Sensitivity (Gain) Knob**. 
- **Problem**: DJs constantly adjust their mixer gains. A visualizer that looks perfect at 10 PM might be completely "blown out" by midnight.
- **Solution**: A global multiplier (0.0 to 2.0x) applied to all audio data before it reaches the visualizer engine.

### Frequency Band Isolation
Instead of reacting to the whole song, effects are split by band:
- **Low (20Hz - 150Hz)**: Driving "Heavy" events (Flash, Strobe, Camera Shake, Scale).
- **Mid (150Hz - 2kHz)**: Driving "Fluid" events (Texture movement, rotation, color hue shifts).
- **High (2kHz - 20kHz)**: Driving "Detailed" events (Particle bursts, sharpness, high-frequency jitters).

### Smoothing & Falloff
Raw audio is "jagged." To make visuals look professional, VJs apply:
- **Attack/Decay**: How fast the visual reacts to a hit and how slowly it fades out.
- **Damping**: Using a low-pass filter on the audio data to remove "noise" from the signal.

---

## 3. Creative Implementation Ideas
For our visualizer, we can move beyond the "passive" Winamp style into an "active" performance tool.

### A. The "Energy" Slider (Intensity)
Instead of a technical "Gain" knob, give the DJ an **Energy** slider.
- **0%**: Slow, ambient movement (ignores beats).
- **50%**: Standard reactivity.
- **100%**: Extreme sensitivity (every hi-hat and snare causes a visual reaction).

### B. Auto-Gain Control (AGC)
Implement a "Listen & Adjust" mode:
- The app monitors the average peak volume over the last 10 seconds.
- It automatically scales the internal sensitivity to ensure the visuals never stop moving, even during a quiet breakdown.

### C. The "Kick-Lock" Toggle
A button that forces the visualizer to **only** react to frequencies below 100Hz.
- **Use Case**: This allows the DJ to make the visuals "pulse" perfectly with the kick drum while ignoring the "clutter" of vocals or synths.

### D. Manual Sensitivity Override
A "Tap Tempo" for sensitivity. If the DJ taps a button 4 times to the beat, the app calculates the average amplitude at those moments and sets that as the "Beat Threshold" for the next 60 seconds.
---

## 4. Final Implementation in DiscoCast

We have successfully implemented a performance-grade audio processing chain that combines legacy "leaky peak" logic with modern VJ controls.

### The Signal Chain
1. **Source**: Audio from Mic or File.
2. **Frequency Routing (Kick-Lock)**: If enabled, signal passes through a `BiquadFilterNode` (Low-pass, 150Hz, Q=1.0).
3. **Analysis**: `AnalyserNode` captures frequency data for internal AGC calculations.
4. **Dynamic Scaling (AGC)**: 
   - Monitors peaks with a fast-attack/slow-decay peak follower.
   - Calculates a `targetGain` to normalize intensity (target ~70% amplitude).
   - **Default: ON** to ensure "hype" remains consistent across tracks.
5. **Master Energy**: User-controlled multiplier (0.2x to 5.0x) applied on top of AGC.
6. **Momentary Boost**: Optional 2x multiplier for drops (triggered via `Shift`).
7. **Destination**: `Butterchurn` engine for WebGL rendering.

### Keyboard Shortcuts for DJs
| Key | Feature | Impact |
|-----|---------|--------|
| `A` | Toggle AGC | Switches between automatic normalization and manual gain. |
| `K` | Kick-Lock | Routes visuals to only pulse with the bass/kick. |
| `Shift` | Boost | Instant 2x energy for massive drops. |
| `T` | Tuning | Opens the glassmorphic tuning popover for fine adjustment. |
| `V/B/I` | Hype Keys | Strobe, Blackout, and Invert for beat-synced accents. |
