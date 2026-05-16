# Meyda Global Audio Upgrade — Dev Spec & Handoff

This document outlines the architecture and implementation plan for integrating the **Meyda** audio analysis library into DiscoCast Visualizer. This is a global engine upgrade that will provide advanced audio-reactive capabilities to all layers (2D Images, Shapes, GIFs, and the upcoming 3D Models), moving beyond basic Bass/Mid/Treble volume detection.

> **See also:** This audio upgrade directly supports the advanced 3D reactivity features outlined in [3d-dev.md](file:///Users/paulhenshaw/Desktop/winamp-screen/3d-dev.md).

## The Problem with Basic FFT
Currently, the app relies on the browser's native `AnalyserNode` to split frequencies into **Bass, Mid, and Treble**. 
- **The flaw:** These are just raw volume bins. A loud sustained bassline will trigger a "Pulse" effect constantly, muddying the visuals.
- **The solution:** Meyda provides **Acoustic Feature Extraction**. Instead of just looking at volume, it looks at the *shape* and *energy* of the wave. 

## The Target Features
We will ask Meyda to extract only two specific features to keep CPU usage low:
1. **Spectral Flux**: Measures how quickly the power spectrum changes. This is the holy grail for VJing—it perfectly isolates sharp transients (Snare drums, Claps, Hi-Hats, Synth stabs) and completely ignores sustained basslines.
2. **Perceptual Spread**: Measures how "wide" or noisy the sound is (e.g., a white noise riser vs a clean sine wave).

---

## Technical Implementation Plan

### Phase 1: Engine Setup (`src/visualizer.js`)
1. **Install**: `npm install meyda`
2. **Initialize**: In `visualizer.js`, after the microphone or audio file is connected to `this.audioContext`, initialize the Meyda analyzer:
   ```javascript
   import Meyda from 'meyda';
   
   this.meydaAnalyzer = Meyda.createMeydaAnalyzer({
     audioContext: this.audioContext,
     source: this.currentSource, // Existing mic or file source
     bufferSize: 512, // Small buffer for fast, responsive frames
     featureExtractors: ['spectralFlux', 'perceptualSpread']
   });
   this.meydaAnalyzer.start();
   ```
3. **The Render Loop**: Inside `startRenderLoop()`, grab the frame's features:
   ```javascript
   this.audioFeatures = this.meydaAnalyzer.get();
   // e.g. this.audioFeatures.spectralFlux
   ```

### Phase 2: Bridging JS to GLSL (The Tricky Part)
Our 2D image layers and shapes are rendered entirely on the GPU via Butterchurn's generated GLSL. MilkDrop's shader environment only natively understands `bass`, `mid`, `treb`, and `vol`. How do we get `spectralFlux` into the shader?

**Solution: The Q Variables**
MilkDrop uses 32 global variables (`q1` through `q32`) to pass data from the CPU/Frame Equations down to the Pixel and Compositing shaders. 
We can write the Meyda values directly into Butterchurn's global variable scope before each frame renders.
- `q31` = `spectralFlux`
- `q32` = `perceptualSpread`

In the generated layer GLSL (inside `src/editor/inspector.js`), we can now just reference `q31` whenever the user selects "Spectral Flux" from the audio dropdown!

### Phase 3: Preset Studio UI Update (`src/editor/inspector.js`)
1. Find the HTML generation for the **Audio Reactivity Source** dropdowns (currently `Bass | Mid | Treble | Volume`).
2. Add `Spectral Flux` and `Spread` to the `<select>` options.
3. Update the `_buildImageBlock` shader generator. When mapping the audio reactivity signal (`_r`), add the new cases:
   ```javascript
   // Pseudocode for shader generation
   let audioVar = '0.0';
   if (source === 'bass') audioVar = 'bass';
   else if (source === 'treble') audioVar = 'treb';
   else if (source === 'flux') audioVar = 'q31'; // Maps to Meyda Spectral Flux
   
   const glsl = `float _r = ${audioVar};`;
   ```

### Phase 4: Integration with Three.js (Future)
For the 3D layer, we don't even need the Q variables. Because Three.js runs in JavaScript, we can directly map `this.audioFeatures.spectralFlux` to `mesh.scale.x` in the `_tick3DAnimations` loop using GSAP for smoothing.

---

## Performance Audit & Safeguards
- **CPU Tax**: Running Meyda's FFT math in JavaScript costs CPU cycles. We **must** restrict the `featureExtractors` array to only the 2 or 3 features we actually use. Requesting all 30 features will tank the framerate.
- **Latency**: Meyda processes the same audio stream as the visualizer. By keeping `bufferSize: 512`, the latency is ~11ms, which is perfectly synced to 60fps visuals.
- **Clean Architecture**: `visualizer.js` remains the single source of truth for audio. `MeydaAnalyzer` lives right next to the native `AnalyserNode` and shuts down gracefully in `disconnectSource()`.

## Result
This transforms the app from a simple "volume-reactive" visualizer into an advanced, transient-aware VJ tool. A snare drum will make the 3D object expand, while the bassline pumps the colors of the 2D background layers.
