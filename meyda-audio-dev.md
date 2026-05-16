# Audio Feature Expansion — Research (NOT DOING THIS)

> **Status (2026-05-15):** Explored and shelved. This was an idea discussed with another AI.  
> We audited the full implementation path and decided against it. Kept for reference only.

---

## The Problem

The app's current bass/mid/treb/vol audio reactivity works well, but all four signals are raw volume bins. A loud sustained bassline will trigger "Pulse" effects constantly, muddying visuals. What we actually want is **transient detection** — a signal that spikes on sharp hits (snares, claps, hi-hats, synth stabs) and stays quiet during sustained notes.

The solution is **Spectral Flux**: a measure of how quickly the power spectrum changes frame-to-frame. It naturally ignores sustained sounds and fires on sharp attacks.

---

## Meyda: Why We Looked At It, Why We're Not Using It

The original spec proposed installing the [Meyda](https://meyda.js.org) audio analysis library (`npm install meyda`), which provides 30+ acoustic feature extractors including `spectralFlux` and `perceptualSpread`.

### What the audit confirmed is correct about the Meyda plan

- The Q-variable bridge to GLSL is **real and valid**. Butterchurn compiles `q1`–`q32` as GLSL `#define` aliases packed into `vec4` uniforms (`_qa` through `_qh`). The comp shader already declares `#define q31 _qh.z`. You CAN reference `q31` in generated GLSL.
- Restricting Meyda to 2 feature extractors is essential for CPU budget — this is correct discipline.
- `bufferSize: 512` (~11ms latency) is appropriate.
- Phase 4 (Three.js JS-side mapping) doesn't need Q vars at all and would be the easy part.

### What the audit found was wrong or incomplete

1. **The "global variable scope" injection mechanism was glossed over.** Butterchurn compiles `frame_eqs_str` as `new Function('a', ...)`. To get an external value into `mdVSFrame.q31`, you must:
   - Store the Meyda value on `window` each frame in the render loop: `window.__mdaFlux = features?.spectralFlux ?? 0`
   - Inject into `frame_eqs_str`: `a.q31 = (typeof __mdaFlux !== 'undefined' ? __mdaFlux : 0);`
   - There is no public Butterchurn API to set frame variables. Direct mutation of `this.visualizer.mdVSFrame` is possible but fragile.

2. **Source re-initialization is a real problem.** The app creates a fresh `MediaStreamSource` or `MediaElementSource` every time the user switches between mic and file input (`connectMicrophone` / `connectFileSource`). Meyda binds to a specific source node. It must be **destroyed and recreated** on every source change — this adds lifecycle complexity to `disconnectSource()` / `connectMicrophone()` / `connectFileSource()`, all of which currently work well.

3. **Three places in inspector.js need updating**, not one. The spec only mentioned `_buildImageBlock`. The solid-color reactivity path (line ~5513) and `buildMotionReactFrameEqs` in `customPresets.js` also map audio source → variable and would both need `flux` / `spread` cases.

4. **`meydaAnalyzer.get()` can return null** before the first buffer is processed. Needs: `this.audioFeatures = meydaAnalyzer.get() ?? this.audioFeatures` (keep last valid reading).

### The core problem: wrong tool for the job

Meyda's value is access to 30+ acoustic features without writing the math. We need exactly one feature. The added complexity (new dependency, re-init on source change, window-global injection bridge, potential render loop instability if Meyda throws) is not worth it when we can compute spectral flux ourselves in ~15 lines using the `AnalyserNode` we already have.

---

## The Recommended Approach: DIY Spectral Flux

We already have `this.analyser` (an `AnalyserNode` with `fftSize = 1024`) running in the render loop. Spectral flux is the L1 norm of the difference between the current FFT frame and the previous one — clamped to positive changes only (onset detection, not offset).

### Why this is better than Meyda

| | Meyda | DIY Flux |
|---|---|---|
| New dependency | Yes (`npm install meyda`) | None |
| Re-init on source change | Yes (breaks connectMic/connectFile) | No — uses existing analyser |
| Render loop complexity | `.get()` + null guard + window global | One `getByteFrequencyData()` call |
| Bridge to GLSL | `window.__mdaFlux` + frame_eqs injection | Same window global + frame_eqs injection |
| Risk to existing audio | Medium | Minimal |

### Implementation Plan

#### Step 1: Compute flux in `startRenderLoop()` in `visualizer.js`

Add a Float32Array to store the previous FFT frame (initialized once, reused every frame):

```javascript
// In the constructor or init section, alongside this.analyser setup:
this._fluxPrevFrame = new Float32Array(this.analyser.frequencyBinCount);
this._spectralFlux = 0;
```

In the render loop, before `this.visualizer.render()`:

```javascript
const fftBins = new Float32Array(this.analyser.frequencyBinCount);
this.analyser.getByteFrequencyData(fftBins);  // NOTE: use getByteFrequencyData not TimeDomain
let flux = 0;
for (let i = 0; i < fftBins.length; i++) {
  const diff = fftBins[i] - this._fluxPrevFrame[i];
  if (diff > 0) flux += diff;  // only count increases (onset detection)
}
this._spectralFlux = flux / (fftBins.length * 255); // normalize 0..1
this._fluxPrevFrame.set(fftBins);

// Expose to window for frame_eqs injection
window.__dcFlux = this._spectralFlux;
```

#### Step 2: Bridge to GLSL via frame_eqs injection in `inspector.js`

In `_buildRuntimePreset()`, append to `frame_eqs_str`:

```javascript
const fluxInjection = `a.q31 = (typeof __dcFlux !== 'undefined' ? __dcFlux : 0);`;
runtime.frame_eqs_str = [baseFrame, injected, fluxInjection].filter(Boolean).join('\n').trim();
```

This uses q31 which is already a valid GLSL uniform in Butterchurn's comp shader (`#define q31 _qh.z`). No changes to Butterchurn required.

#### Step 3: Add "Flux" to audio source dropdowns in `inspector.js`

Three places need updating:

1. **Image layer source `<select>`** — add `<option value="flux">Spectral Flux</option>`
2. **`_buildImageBlock` source map** — add `flux: 'q31'`
3. **Solid color reactivity map** (line ~5513) — add `flux: 'q31'`
4. **`buildMotionReactFrameEqs` srcMap** in `customPresets.js` — add `flux: 'a.q31'`

No motion reactivity source `<select>` exists separately; it uses the same options.

#### Step 4 (Future — Three.js / 3D layers)

For the 3D layer, skip Q vars entirely. Read `this._spectralFlux` directly in `_tick3DAnimations` and map to mesh scale/position. Same as the Meyda spec's Phase 4, just using `this._spectralFlux` instead of `this.audioFeatures.spectralFlux`.

---

## What About Perceptual Spread?

Perceptual Spread (how "noisy vs. clean" the sound is) is genuinely hard to compute well without Meyda's spectral centroid and spread math. It's also the less useful of the two features for VJing. 

**Recommendation:** Defer this entirely. Ship Spectral Flux first and see if Spread is actually missed in practice. If it is, revisit Meyda at that point (with the source re-initialization issues properly scoped) or compute a simple approximation from the FFT (high-frequency energy ratio vs. total energy gives a reasonable "brightness/noise" estimate).

---

## Q Variable Allocation

Reserved for this system:

- `q31` = Spectral Flux (0–1, normalized onset energy)  
- `q32` = Reserved for future use (Perceptual Spread or 3D layer custom signal)

Note: `q1`–`q30` are safe to use in preset frame equations and will not be touched by this system.
