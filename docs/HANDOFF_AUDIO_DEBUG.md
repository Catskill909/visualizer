# Handoff: Audio Triggering Debug (DiscoCast Visualizer)

## Project Overview
**DiscoCast Visualizer** is a browser-based music visualizer using **Butterchurn** (a MilkDrop 2 port). The goal is a high-intensity VJ tool for live DJ sets.

## The Problem
Despite a working VU meter and confirmed audio data reaching the final analysis node, the **visualizations are not reacting (triggering)** to the beat as expected. They behave as if the signal is silent or extremely "flat," even when the audio is loud and bass-heavy.

## Current Audio Architecture
We use a complex Web Audio graph to normalize and boost signals for the engine:
1.  **Source**: `MediaStreamAudioSourceNode` (Mic) or `MediaElementAudioSourceNode` (File).
2.  **Input Analyser**: Raw signal used for **Auto-Gain Control (AGC)**.
3.  **VisualizerGainNode**: Applies AGC gain + Energy Slider multiplier (up to 30x).
4.  **BassBoostNode**: Peaking filter @ 60Hz (+15dB) to help the engine "see" the kick drum.
5.  **Output Analyser**: FFT Size 512. This is the node passed to `visualizer.connectAudio()`.
6.  **Silent Force Path**: A secondary connection from Output Analyser to `destination` (volume 0.000001) to keep the graph active in modern browsers.

## Known Working Components
- **VU Meter**: Works perfectly, showing that `Input Analyser` and `VisualizerGainNode` are processing data.
- **Energy Check Log**: The console logs `[DiscoCast Visualizer] Engine Energy Check: ✅ SIGNAL OK` every few seconds, confirming that the `Output Analyser` has non-zero RMS data.
- **Microphone**: Permission flow and device selection are robust.
- **File Loading**: Works and is audible.

## Critical Technical Clues
- **Butterchurn Requirement**: `connectAudio()` strictly requires an `AnalyserNode`. We are providing one.
- **AGC Behavior**: When AGC is ON, it attempts to target a peak of 0.7 intensity.
- **Issue Persistence**: Even with 30x gain and a 15dB bass boost, the visuals stay "chill" and don't pulse to the beat.
- **Unified Context**: We have confirmed only ONE `AudioContext` is being used for both the source and the visualizer.

## Hypotheses for the Next Agent
1.  **Internal Engine Lag**: Check if `butterchurn`'s internal audio state requires manual synchronization or if the `AudioContext` time is drifting.
2.  **FFT Size Sensitivity**: We moved to 512, but some presets might require 1024 or 2048 to trigger their specific math.
3.  **Uniform Population**: Inspect if `visualizer.render()` is correctly populating the `vol`, `bass`, `mid`, and `treb` uniforms.
4.  **Sample Rate Mismatch**: Check if `audioContext.sampleRate` (e.g., 48kHz) is causing issues with the internal FFT windows of the MilkDrop math.
5.  **Browser Context**: Investigate if `MediaElementAudioSourceNode` is being "sanitized" for analysis due to hidden CORS/Security policies despite `URL.createObjectURL`.

## Debugging To-Do List
- [ ] Log the actual `bass`, `mid`, `treb` values calculated by Butterchurn (if accessible).
- [ ] Test with a simple `OscillatorNode` to see if a pure sine wave triggers anything.
- [ ] Verify if `visualizer.connectAudio` needs to be called *after* every `audioContext` resume.
- [ ] Check if the `canvas` resolution is so high that the motion is too subtle to notice (unlikely).

---
**Current Source Entry Point**: `src/visualizer.js` -> `updateAGC()` and `connectAudioFile()`.
