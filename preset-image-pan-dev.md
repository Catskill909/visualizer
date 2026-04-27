---
status: ground plan / design only — no code changes yet
date: 2026-04-26
scope: Image Inspector layer controls in the Preset Studio
related: [preset-image-tools-dev.md](preset-image-tools-dev.md)
---

# Image Pan — Ground Plan (Left/Right & Up/Down)

## TL;DR

Add a dedicated **Pan** control group to each image layer that handles deliberate **left↔right** and **up↔down** translation, alongside the existing motion modules (Spin, Sway, Orbit, Wander). The controls plug into the existing `cxExpr` / `cyExpr` center-offset path in [inspector.js:2397-2447](src/editor/inspector.js#L2397-L2447), so for tiled layers the translation **always moves the whole group as a unit** (the pattern scrolls in/out at the edges) — never individual tiles. No per-tile pan mode is offered.

---

## 1. What we already have, and the gap

| Module | Axis | Path shape | Returns to origin? | Per-tile? |
|---|---|---|---|---|
| **Spin** | rotation | circular | n/a | optional (`groupSpin`) |
| **Sway** | X only | sinusoidal | yes (always centered) | whole-group only |
| **Orbit** | XY | circle / Lissajous | yes | whole-group only |
| **Wander** | XY | quasi-random drift | drifts around origin | whole-group only |

**Gaps the new Pan module fills:**
1. No Y-axis equivalent of Sway — vertical bobbing requires Wander or Orbit, both of which add unwanted X movement.
2. No **continuous travel** anywhere — every existing module oscillates around the anchor. There is no "pan steadily right at 0.3 units/sec" primitive. This is the headline feature: a parade of tiles drifting left, a logo crawling up, ticker-style horizontal scroll.
3. No way to drive X and Y independently with separate speeds and shapes.

---

## 2. Design — the Pan module

### 2.1 UI surface (Inspector card)

A new section sits between **Wander** and **Mirror**, inside the existing layer card ([inspector.js:1691-1705](src/editor/inspector.js#L1691-L1705) is the immediate neighbor).

```
─── Pan ──────────────────────────────────────────
  Mode:   [ Off ] [ Drift ] [ Bounce ]      ← segmented control
  X axis  ──●────────────  -1.00 … +1.00    speed (signed)
  Y axis  ────●──────────  -1.00 … +1.00    speed (signed)
  Range   ────●──────────   0.00 …  1.00    bounce extent (Bounce mode only)
  ─ Sync to beat  □                          (Phase 2, see §6)
```

**Three modes** (mutually exclusive, segmented like the existing orbit-mode toggle at [inspector.js:1635-1638](src/editor/inspector.js#L1635-L1638)):

- **Off** — module inert, no GLSL emitted.
- **Drift** — continuous linear travel. `cx += time * panSpeedX`, ditto Y. Combined with `tile=ON`, the pattern scrolls forever — the bread-and-butter use case.
- **Bounce** — ping-pong between extremes. `cx += sin(time * panSpeedX) * panRange`. Effectively a 2D Sway with independent axis control.

**Why one module with a mode toggle rather than two siblings (PanX / PanY) or a separate "Drift" panel:**
- Users think in terms of "I want this to move left-right and up-down" — one mental object.
- Mode toggle keeps the card compact (current cards are already dense).
- Drift vs. Bounce share the same X/Y speed sliders; only "Range" is mode-conditional.

### 2.2 Tile interaction (the key constraint)

For tiled layers, Pan operates **only at the field/group level** — per-tile pan is explicitly out of scope.

This falls out of the architecture for free. Both `cxExpr` and `cyExpr` are applied to the group anchor *before* `applyTileUV()` does its `fract()` wrap ([inspector.js:2446-2447](src/editor/inspector.js#L2446-L2447)). Translating the anchor shifts the sampling origin of the whole tile field — the entire grid scrolls coherently and wraps at the seam. There is no path by which a center offset could affect individual tiles independently, so we don't need a `groupPan` opt-in flag (unlike `groupSpin`).

This means:
- Tile=OFF + Drift X = single image slides off the canvas in finite time (intentional — pair with low opacity or scaling for a "passing through" effect).
- Tile=ON + Drift X = endless horizontal scroll, no seam pop (the wrap is invisible because `fract` is continuous and the texture is sampled with `REPEAT`).
- Tile=ON + Bounce = the whole grid sways as one rigid pattern.

### 2.3 Composition with other motion

Pan is **additive** with Sway, Wander, Orbit — they all write into the same `cxExpr` / `cyExpr` chain at [inspector.js:2398-2404](src/editor/inspector.js#L2398-L2404). Stacking order should remain: anchor → orbit → bounce → sway → wander → **pan** (added last so it can override the oscillators visually if speeds are high).

---

## 3. State model

Add to the layer entry defaults block at [inspector.js:1432-1470](src/editor/inspector.js#L1432-L1470):

```js
panMode: 'off',     // 'off' | 'drift' | 'bounce'
panSpeedX: 0.00,    // drift: units/sec along X (signed). bounce: cycles/sec.
panSpeedY: 0.00,    // ditto for Y
panRange: 0.20,     // bounce only: half-amplitude in UV units (0..1)
```

And mirror them in the second defaults block at [inspector.js:2697-2705](src/editor/inspector.js#L2697-L2705) (the load-time hydration path).

**Unit convention:** speeds are in **UV units / second** (the canvas is 0..1 in both dimensions, with aspect correction applied downstream). A `panSpeedX = 0.5` means the image traverses one full canvas width every 2 seconds. This matches `swaySpeed`'s semantic register (cycles/sec) and keeps the slider math simple.

### Persistence

Add `panMode`, `panSpeedX`, `panSpeedY`, `panRange` to:
- The `sliderKeys` array at [inspector.js:1827-1828](src/editor/inspector.js#L1827-L1828) (numeric ones only — `panMode` is a string, handle via the existing string-prop save path).
- The preset JSON serializer / loader path used by [customPresets.js](src/customPresets.js).

Old presets without these keys must default cleanly to `'off' / 0 / 0 / 0.20` — verify by loading a pre-Pan preset after the change.

---

## 4. GLSL contract

Insert new lines into the center-offset assembly at [inspector.js:2397-2404](src/editor/inspector.js#L2397-L2404):

```glsl
// Drift mode
cxExpr = `(${cxExpr}) + time * ${panSpeedX}`;
cyExpr = `(${cyExpr}) + time * ${panSpeedY}`;

// Bounce mode
cxExpr = `(${cxExpr}) + sin(time * ${panSpeedX} * 6.28318) * ${panRange}`;
cyExpr = `(${cyExpr}) + sin(time * ${panSpeedY} * 6.28318) * ${panRange}`;
```

**Aspect correction**: the existing orbit code divides the Y term by `aspect.y` ([inspector.js:2441](src/editor/inspector.js#L2441)) so a circular orbit reads as visually circular. Drift/Bounce should match: divide the Y contribution by `aspect.y` so a `panSpeedY = 0.5` traverses the visible canvas height in 2s regardless of window aspect.

**Branching**: gate the lines behind `hasPan && panMode !== 'off'` so layers with Pan disabled emit zero extra shader cost — preserves the same dead-code-elimination discipline the rest of the file follows.

**Shader recompile trigger**: changing `panMode` (the segment toggle) must trigger a shader rebuild because it changes which branch is emitted; changing the speed/range sliders must NOT — they're inlined as float literals that recompile anyway via the existing slider→rebuild pipeline. Confirm this against how `orbitMode` is wired at [inspector.js:1944-1950](src/editor/inspector.js#L1944-L1950) and replicate.

---

## 5. Edge cases & gotchas

1. **Drift + Tile=OFF** — image leaves the canvas and never returns. Acceptable behavior, but worth a one-line tooltip on the Drift segment: *"Pairs best with Tile ON for endless scroll."*
2. **Drift + animated GIF** — pan and GIF animation are independent; should compose without interaction. Verify by panning a GIF horizontally at speed 0.3 — frames must continue to advance at the GIF's own delay-driven cadence.
3. **Drift + groupSpin** — pan happens before tile wrap, groupSpin happens after the center offset and before tile wrap ([inspector.js:2451-2460](src/editor/inspector.js#L2451-L2460)). Order: pan moves the anchor, then groupSpin rotates around the anchor. This produces a "spiraling drift" effect when both are active. Document but don't try to disentangle.
4. **Drift speed numerical drift over long sessions** — `time` is `gl.uniform1f` and as it grows past ~10⁵ seconds the float precision degrades, causing visible jitter. Existing modules have this same problem and we haven't hit it in practice (longest sets are ~6h ≈ 21,600s, well within fp32 precision). Defer.
5. **Negative speeds** — `panSpeedX < 0` should pan **left** for Drift, and (because `sin` is symmetric) be visually equivalent to `+panSpeedX` for Bounce. Document this so users aren't confused that the slider seems "dead" in negative territory under Bounce. Alternative: clamp the Bounce-mode slider to 0..max via the segment toggle's UI-update handler.
6. **Mirror interaction** — `fieldMirror` is applied to `_uvf` *before* the center subtraction ([inspector.js:2410-2428](src/editor/inspector.js#L2410-L2428)), so panning a mirrored field will visibly slide the mirror seam. This is correct (the seam is part of the field), but worth a manual visual check on Quad/Kaleido modes.

---

## 6. Phasing

**Phase 1 — Core Pan (this spec):**
- Off / Drift / Bounce modes
- Independent X and Y speed sliders
- Bounce range slider
- Persistence in preset JSON
- Default values backward-compatible with old presets

**Phase 2 — Beat sync (separate ticket):**
- Checkbox: "Sync to beat"
- When on, `time` in the pan expression is replaced by an accumulated beat-phase value driven by the existing audio reactivity pipeline (see Audio Reactivity section at [inspector.js:1734+](src/editor/inspector.js#L1734)).
- Drift speed becomes "units per beat"; Bounce speed becomes "cycles per beat" (e.g., 0.25 = one bounce every 4 beats).

**Phase 3 — Path presets (nice-to-have):**
- Dropdown of canned movements: Slow Crawl Right, Ticker Scroll, Vertical Rise, Diagonal Drift, etc. — each just preloads the X/Y speed pair and switches mode. Pure UX sugar over Phase 1.

---

## 7. Open questions

1. **Slider range for Drift speed** — `swaySpeed` caps at 4 cycles/sec (very fast), but `4 UV/sec` for Drift is "off-screen in 250ms," basically a strobe. Recommend Drift speed range **−2 to +2 UV/sec** with a fine step (0.01) and the slider's center-detent at 0. Bounce can borrow the existing 0–4 range since its semantic is identical to `swaySpeed`.
2. **Should Drift use audio reactivity (volume/bass) to modulate speed by default?** Probably no — keeping it deterministic makes it predictable for video output and the Timeline Editor. Reactivity becomes a separate Phase 2 toggle.
3. **Card real estate** — the layer card is already long. Worth considering whether Sway should be folded into the new Pan module as "Bounce mode, Y speed = 0" rather than living as its own section. Migration cost: rewrite preset loader to map `swayAmt`/`swaySpeed` → `panMode='bounce' / panSpeedX=swaySpeed / panRange=swayAmt`. Defer the merge decision until after Phase 1 is in users' hands.

---

## 8. Definition of done (Phase 1)

- [ ] New Pan section renders in every image layer card
- [ ] Mode segment toggle switches between Off / Drift / Bounce, hides irrelevant sliders
- [ ] X and Y sliders move the layer in the expected direction at the expected speed (visual verification on a labeled test image)
- [ ] Tile=ON layers scroll seamlessly under Drift, with no visible seam pop at the wrap
- [ ] Tile=OFF + Drift slides off canvas as expected
- [ ] Bounce mode oscillates and returns to anchor
- [ ] Pan composes additively with Sway, Wander, Orbit, and groupSpin without visual glitches
- [ ] Old preset (saved before this feature) loads with `panMode='off'` and behaves identically to before
- [ ] New preset with Pan enabled saves and reloads with values intact
- [ ] No shader compile errors at the extreme corners of all sliders
