# Spectral Flux Audio Source — Dev Doc

> **Status: Shipped 2026-05-15**

## What it is

Spectral Flux is a fifth audio source option (alongside Bass / Mid / Treble / Volume) available in every audio reactivity Source dropdown in the Preset Studio. It measures how quickly the frequency spectrum changes frame-to-frame — firing sharply on transients (snare hits, claps, hi-hats, synth stabs) and staying quiet during sustained notes, regardless of volume.

**Why it's better for snap effects:** Bass/Mid/Treb are volume bins — a loud sustained bassline keeps Pulse firing constantly. Flux measures *change*, not loudness, so it fires once on the attack and drops immediately. Wiring Pulse, Bounce, or Strobe to Flux gives clean one-shot beat snaps.

**Why Bass/Mid/Treb still exist:** Flux is not universally better. For sustained reactions (a color that stays shifted while a note holds, brightness tracking overall mix energy) the volume-based signals are correct. Each panel's Source dropdown remains a user choice.

---

## Architecture

### Signal computation (`src/visualizer.js`)

Computed every frame in the primary engine's render loop, before `this.visualizer.render()`, inside the `!this._isSlaveEngine` guard (same as AGC).

Two pre-allocated `Uint8Array` buffers (512 elements each, allocated once in `init()`) avoid GC pressure in the render loop:
- `this._fluxFftBuf` — current frame's FFT data
- `this._fluxPrevFrame` — previous frame's FFT data

Algorithm: sum only positive frame-to-frame differences (onset detection — counts frequency increases, ignores decays). Normalize by `bufferLength × 255` to produce a 0–1 float.

Result stored as `this._spectralFlux` and written to `window.__dcFlux` for cross-engine access.

### Bridge to GLSL (`src/editor/inspector.js` → `_buildRuntimePreset()`)

Butterchurn compiles `frame_eqs_str` as `new Function('a', ...)` which runs in global scope and can read `window` properties. A single line is always appended to every preset's frame equations:

```js
a.q31 = (typeof __dcFlux !== 'undefined' ? __dcFlux : 0);
```

This writes the flux value into Butterchurn's `mdVSFrame.q31`, which Butterchurn already maps to the GLSL uniform `q31` (`#define q31 _qh.z`) — confirmed in Butterchurn source. No Butterchurn internals are mutated directly.

The slave engine (editor preview) shares the primary engine's `this.analyser` reference and reads `window.__dcFlux` via frame_eqs — no separate computation needed.

### Source map additions

Three source maps gained a `flux: 'q31'` / `flux: 'a.q31'` entry:

| Location | Map key added |
|---|---|
| `_buildImageBlock()` line ~5664 | `flux: 'q31'` → GLSL `float _r_raw = q31;` |
| `_buildCompShader()` line ~5513 | `flux: 'q31'` → GLSL `float _sr_raw = q31;` |
| `buildMotionReactFrameEqs()` line ~431 | `flux: 'a.q31'` → JS `_mr_raw = a.q31;` |

All maps retain `|| 'bass'` fallback — unrecognised values (including any future corruption) silently default to bass.

### UI additions

`<option value="flux">Flux</option>` added to three selects:
- `.layer-react-source` in the layer card template (inspector.js ~line 3661)
- `#solid-react-source` in editor.html (~line 210)
- `#motion-react-source` in editor.html (~line 359)

---

## Safety guarantees

**Existing presets are unaffected.** All saved presets have `reactSource: 'bass'` (or mid/treb/vol). These keys resolve identically through the unchanged fallback path. No saved preset will have `reactSource: 'flux'` until the user explicitly selects it.

**q31 injection is a silent no-op when unused.** The flux line always writes q31, but nothing reads it in the shader unless the user has selected Flux as a source. Existing layer and motion reactivity reads `bass`, `mid`, `treb`, or `vol` — q31 is ignored.

**No changes to the audio graph.** `this.analyser` already receives the full audio signal. `getByteFrequencyData()` is a read-only tap. The AGC, gain nodes, Butterchurn connection, and source connect/disconnect flow are untouched.

**One known edge case:** A hand-edited MilkDrop preset that already uses `q31` in its own `frame_eqs_str` would have that value overwritten by the flux injection. Extremely unlikely in practice — no bundled preset uses q31/q32 and the editor UI never writes them.

---

## Q variable allocation

- `q31` = Spectral Flux (0–1 normalised onset energy) — **in use**
- `q32` = Reserved for future use

`q1`–`q30` are untouched and safe for MilkDrop preset frame equations.

---

## Files changed

| File | Change |
|---|---|
| `src/visualizer.js` | Allocate `_fluxFftBuf`, `_fluxPrevFrame`, `_spectralFlux` in `init()`; compute flux and write `window.__dcFlux` in render loop |
| `src/editor/inspector.js` | Append q31 injection in `_buildRuntimePreset()`; add `flux: 'q31'` to image and solid source maps; add Flux option to layer card template |
| `src/customPresets.js` | Add `flux: 'a.q31'` to `buildMotionReactFrameEqs()` srcMap |
| `editor.html` | Add Flux option to `#solid-react-source` and `#motion-react-source` selects |

---

## Research background

See `meyda-audio-dev.md` for the full research trail — we evaluated Meyda as an alternative and decided against it (source re-init complexity, unnecessary dependency). DIY flux from the existing `AnalyserNode` delivers the same result with zero new dependencies.
