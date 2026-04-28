# Strobe Slider Bug — Handoff Document

> **Status:** Unresolved  
> **File:** `src/editor/inspector.js`  
> **Date:** 2026-04-28  
> **Symptom:** Moving the Strobe slider in the Image tab of the Inspector panel produces no visible change on the canvas.

---

## 1. What Works vs. What Doesn't

| Control | Slider → `entry` | `entry` → GLSL | GLSL → Visual | Status |
|---------|-------------------|-----------------|----------------|--------|
| **Pulse** (audioPulse) | ✅ | ✅ baked into `sizeBase` | ✅ image scales with beat | **Working** |
| **Bounce** (bounceAmp) | ✅ | ✅ baked into `centerLines` | ✅ image shifts with beat | **Working** |
| **Strobe** (strobeAmp) | ✅ | ✅ baked into `_op` line | ❌ no visible change | **BROKEN** |

All three controls share the same plumbing:
- Slider `input` event → updates `entry.xxxAmp` → calls `refresh()`
- `refresh()` = `_buildCompShader()` + `_applyToEngine()`
- `_applyToEngine()` = rebuild the `comp` shader string, then `engine.loadPresetObject(currentState, 0)`

The slider handler is confirmed working — console logs `[STROBE]` with correct values (line 1957).

---

## 2. History — How the Strobe Originally "Worked"

### Before commit `f1b5d9e` (April 27)

The Pulse slider handler at line ~1820 used a generic selector:

```js
card.querySelectorAll('.layer-slider-row input[type=range]:not(.layer-bounce-sl):not(.layer-size-sl):not(.layer-liss-sl)')
```

This selector **accidentally captured the Strobe slider** too (because `.layer-strobe-sl` was NOT excluded). The side effect: moving the Strobe slider would fire the Pulse handler's `input` callback, updating `entry.audioPulse`, which drove the **Pulse** visual effect. Users saw the image pulse and thought Strobe was working.

### Commit `f1b5d9e` — The "Break"

This commit added `:not(.layer-strobe-thr-sl)` to the pulse selector and gave Strobe its own dedicated listener (line 1947–1958). This **correctly** separated the two controls, but exposed that the Strobe's actual GLSL implementation had never been visually verified in isolation — it was always riding on Pulse's coattails.

---

## 3. The Strobe GLSL — What It's Supposed To Do

### Original formula (commit `d801ac7`)

```glsl
float _op = _t.w * _gapMask * clamp(opacity + _r * opaPulse, 0.0, 1.0)
          * (1.0 - stbAmp * step(stbThr, _r_raw));
```

**Intent:** When `_r_raw` (bass/mid/treb/vol) exceeds `stbThr`, multiply opacity by `(1.0 - stbAmp)`, making the image flicker off on beats.

**Problem:** `step(threshold, x)` returns 0 or 1 — it's binary. If the audio signal stays below the threshold, the strobe term is always `1.0` (no effect). If the signal is steady above it, the opacity drops to a constant reduced value (no flicker). The strobe only "works" at the exact boundary where the signal oscillates across the threshold — a very narrow operating window.

### Current formula (after debugging attempts)

```glsl
float _strobeFq = stbThr * 6.0 * (1.0 + _r_raw * 2.0);
float _strobeWave = step(0.5, fract(time * _strobeFq));
float _op = _t.w * _gapMask * clamp(opacity + _r * opaPulse, 0.0, 1.0)
          * mix(1.0, _strobeWave, stbAmp);
```

**Intent:** Generate a time-based square wave whose frequency scales with the audio signal. `stbAmp` controls how much the square wave affects opacity. Audio-reactive strobe frequency.

**This formula is structurally sound.** The strobe frequency increases with audio level, and `stbAmp` controls the blend between "no strobe" (1.0) and "full strobe" (_strobeWave). Yet it still produces no visible effect.

---

## 4. Why the Shader Isn't Visually Working — Root Cause Candidates

### Candidate A: `loadPresetObject` recompiles the ENTIRE shader

The `_applyToEngine()` path:
```js
_applyToEngine() {
    this._buildCompShader();                              // rebuilds this.currentState.comp (string)
    this.engine.loadPresetObject(this.currentState, 0);   // deep-clones & reloads
    // ... re-binds textures
}
```

`loadPresetObject` calls Butterchurn's `loadPreset(JSON.parse(JSON.stringify(presetObj)), blendTime)`. This triggers a **full preset reload** with `blendTime = 0`. Butterchurn may:
1. Recompile the GLSL shader from the `comp` string ✅ (this part works — the shader compiles)
2. **But the new shader may not take effect until the blend completes**, or the internal `compTexture` pipeline may cache the old program for one or more frames

The **Pulse** and **Bounce** effects survive this reload because they're baked into **UV math** (size, position) — these affect the texture lookup coordinates, which are always fresh. The **Strobe** effect modifies **opacity** (`_op`), which is applied as a blend multiplier on the final `col`. If Butterchurn's comp pipeline resets or re-blends incorrectly, the opacity modification could be lost.

### Candidate B: The `_op` multiplication is overwritten by the blend mode

The opacity `_op` is used in the blend line:
```glsl
// additive:
col += _src * _op;
// overlay:
col = mix(col, _src, _op);
// screen (default):
col = mix(col, 1.0 - (1.0 - col) * (1.0 - _src), _op);
// multiply:
col = mix(col, col * _src, _op);
```

If `_op` oscillates between (say) 0.8 and 1.0 due to strobe, the visual difference for additive/screen blending on a dark background is negligible. The strobe might actually be working but the visual delta is too small to notice.

### Candidate C: `_r_raw` is near-zero when there's no strong audio

Both Pulse and Bounce use `_r` (which is `_r_raw` after curve shaping) to drive their effects. The strobe frequency formula `stbThr * 6.0 * (1.0 + _r_raw * 2.0)` means:
- If `_r_raw ≈ 0` (no audio), frequency = `stbThr * 6.0` (e.g., 2.4 Hz at threshold 0.4)
- The `step(0.5, fract(time * freq))` square wave will still oscillate, but at a low rate

This should still be visible. **This is likely not the sole cause**, but low audio makes all reactive effects harder to see.

### Candidate D (Most Likely): Butterchurn's comp shader pipeline caching

Butterchurn's renderer stores the compiled comp shader program. When `loadPreset` is called, it parses the `comp` field and compiles a new shader. However, the renderer may:
1. Keep the old program active during blend transition
2. Only swap programs after blend completes (which at `blendTime = 0` might be instant or might be 1 frame)
3. Have an internal cached state that doesn't get invalidated by the deep-clone round-trip

**This is the strongest hypothesis** because:
- Hardcoding a constant reduction (`* 0.5`) in the `_op` line also showed no visible change (per earlier debugging)
- If even a hardcoded constant doesn't change the visual, the **shader string is being rebuilt but the compiled program isn't being swapped in**, or the comp output is being overridden downstream

---

## 5. Key Code Locations

| What | File | Line(s) |
|------|------|---------|
| Strobe slider handler | `inspector.js` | 1947–1958 |
| `refresh()` definition | `inspector.js` | 1789 |
| `_applyToEngine()` | `inspector.js` | 2346–2353 |
| `_buildCompShader()` | `inspector.js` | 2362–2434 |
| `_buildImageBlock()` | `inspector.js` | 2451–2763 |
| Strobe GLSL formula | `inspector.js` | 2755–2758 |
| `stbAmp` / `stbThr` extraction | `inspector.js` | 2481–2483 |
| Pulse GLSL (size) — **working reference** | `inspector.js` | 2644 |
| Bounce GLSL (center) — **working reference** | `inspector.js` | 2574–2586 |
| `loadPresetObject()` in engine | `visualizer.js` | 679–688 |
| Butterchurn `loadPreset` call | `visualizer.js` | 682 |
| Pulse slider handler (fixed selector) | `inspector.js` | ~1820 |

---

## 6. Attempts Made So Far

### Attempt 1: Remove squared power curve
- **What:** Changed `strobeAmp = v * v` to `strobeAmp = v` (linear mapping)
- **Result:** No visible change. Confirmed slider value reaches `entry.strobeAmp` correctly.

### Attempt 2: Switch from binary `step()` to continuous `mix()`
- **What:** Replaced `(1.0 - stbAmp * step(stbThr, _r_raw))` with `mix(1.0, _strobeWave, stbAmp)` using a time-based square wave
- **Result:** No visible change. Console confirms shader is rebuilt.

### Attempt 3: Add 2× amplification
- **What:** Added multiplier to strobe term to make the effect more dramatic
- **Result:** No visible change.

### Attempt 4: Hardcode constant opacity reduction
- **What:** Replaced the entire strobe term with `* (1.0 - stbAmp)` — a static darkening that should be immediately obvious
- **Result:** No visible change. **This is the critical clue.** If even a hardcoded constant doesn't change the visual, the issue is in the pipeline, not the formula.

---

## 7. Diagnostic Proof: The Problem Is Not the Formula

The fact that **Attempt 4** (hardcoded constant) produced no visible change proves:

> **The generated GLSL shader string is correct, but the compiled shader program running on the GPU is stale.**

The `_buildCompShader()` method correctly updates `this.currentState.comp` with the new strobe terms. The `_applyToEngine()` method calls `loadPresetObject()` which calls Butterchurn's `loadPreset()`. But the rendered output doesn't change.

Meanwhile, Pulse and Bounce **do** change the visual because they affect **UV coordinates** (texture sampling position), not opacity. This suggests that Butterchurn may be:
1. Using a cached/compiled version of the comp shader for opacity calculations
2. OR the `comp` shader output (`ret = col`) is being post-processed or blended in a way that masks opacity changes
3. OR the `loadPreset` with `blendTime = 0` causes a degenerate blend state

---

## 8. Recommended Next Steps

### Step 1: Verify the compiled shader on the GPU
Add a diagnostic log inside `_buildCompShader()` to print the full `this.currentState.comp` string after rebuild:
```js
console.log('[COMP SHADER]', this.currentState.comp);
```
Then inspect the logged shader to confirm the strobe terms are present.

### Step 2: Verify Butterchurn accepts the new comp
After `loadPresetObject()`, inspect Butterchurn's internal state:
```js
console.log('[BC COMP]', this.engine.visualizer?.renderer?.compShader?.source);
// or wherever Butterchurn stores the compiled comp program source
```
Compare this to the string from Step 1. If they differ, Butterchurn is ignoring or caching the comp.

### Step 3: Test with `blendTime > 0`
Change `_applyToEngine()` to use a non-zero blend:
```js
this.engine.loadPresetObject(this.currentState, 0.5);
```
If the strobe becomes visible after the blend completes, the issue is Butterchurn's instant-blend codepath.

### Step 4: Force Butterchurn shader recompile
Instead of `loadPresetObject`, try directly accessing Butterchurn's renderer to force a shader recompile:
```js
this.engine.visualizer.renderer.setCompShader(this.currentState.comp);
```
(The exact API depends on Butterchurn's internals — may need to inspect `node_modules/butterchurn`.)

### Step 5: Move strobe to a UV-based effect (nuclear option)
Since Pulse (UV-based) works and Strobe (opacity-based) doesn't, consider implementing strobe as a UV-based effect — e.g., shifting the texture sample coordinates off-screen on strobe beats, rather than modifying opacity. This would bypass whatever pipeline issue is eating the `_op` changes.

---

## 9. Quick Reference — How Pulse Works (for comparison)

Pulse works because it modifies the **size** used for UV calculation:

```glsl
// Line 2644 — size incorporates pulse
float sizeBase = sz * (1.0 + _r * pu);  // _r = audio reactivity

// This feeds into the UV scaling:
vec2 _u = _uvf / sizeBase;
```

The UV change happens BEFORE `texture()` is called, so the GPU always samples a different pixel location. There's no caching that can mask this — every frame recalculates UV coordinates from the current uniform values.

Strobe, by contrast, modifies `_op` AFTER the texture sample, applying a multiplier to the blend amount. If the blend/comp pipeline has any caching or double-buffering that preserves the previous frame's blend result, the strobe change gets overwritten.
