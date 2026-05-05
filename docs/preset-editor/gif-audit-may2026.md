# Animated GIF Feature Audit and Brainstorm (May 2026)

Date: 2026-05-04
Scope: Audit and product brainstorming only (no code changes)

## 1. App Orientation Snapshot

DiscoCast Visualizer is a Butterchurn-based WebGL visual system with a Preset Studio that composes image layers (including animated GIF textures) into the comp shader. GIF playback is implemented in the visualizer engine, while authoring controls and persistence are handled in the editor inspector.

Primary references:
- [README.md](../../README.md)
- [docs/preset-editor/gif-playback.md](gif-playback.md)
- [src/visualizer.js](../../src/visualizer.js)
- [src/editor/inspector.js](../../src/editor/inspector.js)
- [src/editor/gifOptimizer.js](../../src/editor/gifOptimizer.js)

## 2. Current GIF Execution Path (Observed)

### 2.1 Decode and registration
- GIF uploads are detected in [src/editor/inspector.js](../../src/editor/inspector.js).
- Optimizer path (optional) parses and pre-processes frames in [src/editor/gifOptimizer.js](../../src/editor/gifOptimizer.js).
- Engine binds GIF textures via _loadGifTexture in [src/visualizer.js](../../src/visualizer.js), stores animation state in _gifAnimations, and sets per-layer speed.

### 2.2 Playback timing
- Each render frame calls _tickGifAnimations in [src/visualizer.js](../../src/visualizer.js).
- Frame advance uses deadline scheduling: nextFrameAt += frameDelay (with late-frame catch-up guard).
- Effective delay equation:

$$
\text{effectiveDelayMs} = \frac{\text{gifFrameDelayMs}}{\text{speedMultiplier}}
$$

- Speed slider writes directly to running animation state through setGifAnimationSpeed.

### 2.3 Why this already works well
- Deadline-based timing avoids cumulative drift.
- texSubImage2D avoids per-frame texture realloc.
- Pixel store state is preserved/restored, reducing color corruption artifacts.
- Optimizer can reduce frame count and dimensions before runtime.

## 3. Why GIF Speed Feels Hard to Control

The system is technically solid, but control feel can still be difficult because:

1. Source GIFs have inconsistent native delays.
- Many web GIFs have uneven per-frame timing and nonuniform motion cadence.
- A single global speed multiplier scales delays but does not normalize jitter.

2. Human perception is nonlinear.
- A linear 0.25x to 8x slider feels too coarse in slow ranges and too sensitive in fast ranges.
- Small changes at high speed can feel dramatic.

3. Frame-reduction + speed interaction is nonlinear.
- Optimizer keepEveryN and speed multiplier compound each other.
- Users can unintentionally over-accelerate choppy material.

4. rAF and browser scheduling limits still apply.
- Deadline logic is robust, but visual smoothness remains bound to render cadence and CPU to GPU transfer load.

## 4. What “More Tame/Controllable” Could Mean

A better target is not just faster or slower. It is:

1. Predictable response across different GIFs.
2. Similar slider feel in low, medium, and high ranges.
3. Fewer surprise interactions with optimizer settings.
4. Better defaults so users do less manual tuning.

## 5. Enhancement Ideas (No-Code Brainstorm)

## 5.1 Control-model upgrades (highest value)

1. Replace linear speed mapping with perceptual mapping.
- Keep UI range 0.25x to 8x, but map knob position with a log curve.
- Benefit: finer control around 0.8x to 2x where people tune most.

2. Add Tempo Mode choices.
- Modes: Native, Smooth, Punchy.
- Native: current behavior.
- Smooth: delay variance compression (reduces jitter).
- Punchy: preserve big timing accents but cap extreme delay spikes.

3. Add target FPS mode as an alternative to multiplier.
- Let users choose 8, 12, 15, 20, 24, 30 FPS equivalence.
- Engine computes effective frame stepping from source delays.
- Easier mental model for VJ use.

4. Add “stability” control separate from speed.
- Speed controls average rate.
- Stability controls delay variance normalization.
- This decouples pace from jitter.

## 5.2 Optimizer UX upgrades

1. Show predicted playback outcome before apply.
- Display: estimated FPS range, average delay, jitter score.

2. Offer intent presets in optimizer.
- “Smooth Loop”, “Keep Detail”, “Lightweight”.
- Under the hood these set keepEveryN and resize targets.

3. Detect problematic timing and warn.
- If source delay histogram is highly uneven, suggest normalization mode.

## 5.3 Runtime quality options

1. Frame interpolation mode (future/experimental).
- Optical interpolation is likely overkill, but simple blend/interleave mode for adjacent frames could soften low-FPS GIFs.
- Tradeoff: possible ghosting.

2. Adaptive speed clamping under load.
- If upload bandwidth contention appears (many GIFs), cap effective speed to preserve smoothness.

## 6. Conversion Paths to Improve Control

If you want stronger control than GIF inherently allows, conversion can help.

### 6.1 GIF to APNG/WebP sequence model (best balance for still-image pipeline)

Pros:
- Better compression and cleaner alpha in many cases.
- Similar frame-sequence mental model as current engine.
- Retains image-layer workflow.

Cons:
- Requires adding decode path(s) and format handling complexity.
- Browser support/testing matrix widens.

### 6.2 GIF to sprite atlas (shader-indexed frames)

Pros:
- Very deterministic frame stepping.
- Potentially less CPU to GPU upload churn at runtime (if prepacked once).

Cons:
- Large texture constraints.
- More invasive shader plumbing.
- Harder with long or large animations.

### 6.3 GIF to video texture (MP4/WebM)

Pros:
- Native playback controls (rate, pause, seek) are mature.
- Good for long clips.

Cons:
- Different alpha behavior and color tradeoffs.
- Autoplay and platform restrictions.
- Departure from current image-layer pipeline.

### 6.4 Practical recommendation

Near-term: keep GIF architecture, add timing normalization and perceptual controls.
Mid-term: prototype APNG/WebP sequence ingestion for better source quality.
Long-term: evaluate sprite atlas only if you need deterministic high-density motion graphics.

## 7. Opacity Slider Bug Audit (GIF appears to shrink)

Observed report:
- In Preset Studio Image tab, lowering opacity on animated GIF makes image look smaller.
- Plain (fully opaque) images do not show same behavior.

### 7.1 Current execution path

- Opacity slider updates entry.opacity in [src/editor/inspector.js](../../src/editor/inspector.js).
- Shader rebuild is triggered and per-layer block computes:

$$
\_op = \_t.w \cdot \_gapMask \cdot clamp(opacity + react, 0, 1)
$$

where _t.w is sampled texture alpha.

### 7.2 Root-cause hypothesis (high confidence)

This likely is not geometric scaling. It is alpha-weighted coverage loss.

Reason:
- GIFs often contain semi-transparent anti-aliased edges and variable per-frame alpha coverage.
- Because global opacity is multiplied by texture alpha (_t.w), edge pixels fade first.
- Human perception reads that as silhouette contraction (“smaller”).
- Opaque images (_t.w near 1 across shape) do not exhibit this effect strongly.

### 7.3 Why it is GIF-specific in practice

- Animated stickers/GIFs commonly have soft alpha boundaries.
- Static test images are often rectangular JPGs/PNGs with less soft edge alpha variation.

### 7.4 Potential fix directions (for future implementation)

1. Separate coverage from opacity.
- Keep a stable alpha coverage mask, apply user opacity after mask shaping.

2. Add alpha mode toggle per layer.
- “Preserve silhouette” vs “True alpha fade”.

3. Add optional edge compensation.
- Mild gamma/curve on alpha before global opacity multiply.

4. Add debug overlay.
- Visualize alpha channel to confirm whether perceived shrink is edge coverage loss vs transform bug.

## 8. Prioritized Plan for Next Iteration

1. Control feel first.
- Add perceptual speed mapping and optional target-FPS mode.

2. Timing consistency second.
- Add delay normalization/stability control and optimizer guidance.

3. Opacity behavior third.
- Implement alpha-mode separation for GIF layers to prevent silhouette shrink perception.

4. Format expansion after above.
- Prototype APNG/WebP path if you still need deeper control than normalized GIF timing can provide.

## 9. Suggested Validation Scenarios

Use one short looping sticker GIF, one medium cinematic GIF, and one large high-frame-count GIF.

Track:
1. User time-to-target-speed (seconds to dial desired motion).
2. Number of slider adjustments needed.
3. Reported smoothness and predictability.
4. Whether opacity changes preserve perceived size.

---

Conclusion:
The current GIF subsystem is technically strong. The biggest opportunity is control ergonomics (mapping, normalization, intent presets), not low-level decode correctness. The opacity issue is likely alpha-compositing perception rather than true transform scaling, and can be addressed with alpha-mode design.
