# Solarize Slider — Per-Layer Color FX

Status: **IMPLEMENTED 2026-05-15** — all 5 edits applied to `src/editor/inspector.js`,
README VJ Effects suite updated. Pending in-app verification (§7).
Date: 2026-05-15

---

## 1. What exists today

There are **two unrelated solarize concepts** in the app. They must not be confused.

### A. Scene-level Solarize toggle (Palette tab) — already shipped
- UI: `editor.html:303` — `#toggle-solarize` checkbox in the preset editor **Palette** tab.
- Wiring: `inspector.js:1245` maps `toggle-solarize → solarize` (a 0/1 baseVal).
- Effect: injected into the **MilkDrop comp shader** post-FX block, `inspector.js:129`:
  ```glsl
  if (solarize != 0) ret = ret * (1.0 - ret) * 4.0;
  ```
- Scope: affects the **whole MilkDrop background**. It is a binary on/off. It does
  **not** touch image/video/text/gif layers at all.

### B. Per-layer Color FX (the layer card) — where the new slider goes
- Each layer card has a **"Color FX"** subsection (`inspector.js:3556`) containing two
  sliders today:
  - **Invert** → `entry.invertMix` (0–1), class `.layer-invert-sl`
  - **Thresh** → `entry.thresholdCutoff` (0–1), class `.layer-thresh-sl`
- These are applied per-layer in `_buildImageBlock()`, operating on `_src` (the layer's
  sampled RGB) — `inspector.js:6226-6230`:
  ```glsl
  // posterize
  { float _pn = N.0; _src = floor(_src * _pn + 0.5) / _pn; }
  // invert
  _src = mix(_src, 1.0 - _src, INVERTMIX);
  // threshold
  { float _tLum = dot(_src, vec3(0.299,0.587,0.114)); _src = vec3(step(CUT - _r*0.2, _tLum)); }
  ```

**The new Solarize slider belongs in system B** — a per-layer continuous control,
fully isolated to the layer it lives on. It is independent of the Palette toggle (A).

---

## 2. What should happen

Add a **Solarize** slider to every layer card's **Color FX** section, sitting between
the existing **Invert** and **Thresh** sliders.

- Range `0.00 → 1.00`, step `0.01`, default `0.00` (off).
- `0.00` = no change. `1.00` = full solarize fold.
- Effect math (continuous mix, same fold curve as the scene toggle so the look is
  consistent across the app):
  ```glsl
  _src = mix(_src, _src * (1.0 - _src) * 4.0, solarizeMix);
  ```
  The `4x(1-x)` fold: darks stay dark, midtones blow toward white, brights crush back
  toward dark — the classic Sabattier/solarize look. At `solarizeMix = 1.0` a layer
  matches what the scene-level Solarize toggle does to the background.
- Per-layer and per-effect isolated:
  - Only injected when `solarizeMix > 0.001` (`hasSolarize` gate) — zero cost when off.
  - Each layer compiles its own `_buildImageBlock`, so one layer's value never leaks
    to another.
  - It is a single discrete `mix()` step — it does not alter posterize, invert,
    threshold, or any downstream color-grading stage.

### Pipeline order (deliberate)
Inject **after Invert, before Threshold**:

```
posterize → invert → SOLARIZE → threshold → scanlines → grain → color grading
```

Rationale: solarize is a tone curve, so it should run on the (possibly inverted)
continuous color and *before* threshold, which binarizes. Putting it before threshold
means Thresh still produces a clean B&W cut of the solarized result rather than
solarizing an already-binary image (which would be a no-op on pure black/white).

---

## 3. Exact changes (5 edits, all in `src/editor/inspector.js`)

All changes parallel the existing `invertMix` implementation 1:1. New property name:
**`solarizeMix`**. New classes: **`.layer-solarize-sl`** / **`.layer-solarize-val`**.

### Edit 1 — Defaults (4 locations)
Add `solarizeMix: 0.00` next to `invertMix: 0.00` in:
1. The three layer-creation default templates (search `invertMix: 0.00` — currently
   ~lines 2370, 2682, 2848).
2. `_normalizeImageEntry()`'s `D` object (~line 6464) — this is the **migration path**:
   it backfills `solarizeMix: 0` onto presets saved before this feature, so old presets
   load cleanly.

### Edit 2 — UI row (layer card template, ~line 3562)
Insert a new `.layer-slider-row` between the Invert row and the Thresh row:
```html
<div class="layer-slider-row">
  <span class="layer-ctrl-label" data-tooltip="Solarize — folds the tone curve so midtones blow bright while darks and highlights crush down. 0 = off, 1 = full solarize.">Solarize</span>
  <input type="range" class="slider layer-solarize-sl" min="0" max="1" step="0.01"
    value="${(entry.solarizeMix || 0).toFixed(2)}" style="--pct:${((entry.solarizeMix || 0) * 100).toFixed(1)}%">
  <span class="lsv layer-solarize-val">${(entry.solarizeMix || 0).toFixed(2)}</span>
</div>
```

### Edit 3 — Generic-handler exclusion list (~line 4002)
Add `'layer-solarize-sl'` to the `sliderExclude` array.

> Why: the generic slider handler wires every non-excluded `.layer-slider-row` range
> input. The Color FX sliders sit past index 9 so they would not corrupt the indexed
> `sliderKeys` mapping — but an un-excluded slider still gets a **redundant duplicate
> listener** that writes `entry[undefined]`. Excluding it keeps it on its dedicated
> handler only. This also follows the rule documented for `.layer-radius-sl`.

### Edit 4 — Dedicated slider handler (~line 4713, right after the Invert/Thresh block)
Model exactly on the Invert handler:
```js
const solarizeSl = card.querySelector('.layer-solarize-sl');
const solarizeVal = card.querySelector('.layer-solarize-val');
if (solarizeSl) solarizeSl.addEventListener('input', () => {
    const v = parseFloat(solarizeSl.value);
    entry.solarizeMix = v;
    solarizeVal.textContent = v.toFixed(2);
    solarizeSl.style.setProperty('--pct', `${(v * 100).toFixed(1)}%`);
    refresh();
});
```

### Edit 5 — Shader injection in `_buildImageBlock()`
Near line 5624 (the `invertMix` const block), add:
```js
const solarizeMix = (img.solarizeMix || 0).toFixed(4);
const hasSolarize = parseFloat(solarizeMix) > 0.001;
```
Then between the invert line (6228) and the threshold line (6230):
```js
// Solarize: tone-curve fold, blended by amount
(hasSolarize ? `    _src = mix(_src, _src * (1.0 - _src) * 4.0, ${solarizeMix});\n` : '') +
```
(`4x(1-x)` stays within `[0,1]` for `_src ∈ [0,1]`, so no clamp is required.)

---

## 4. Persistence

No save-path change needed. Layer entries serialize as whole objects (same as
`invertMix`), so `solarizeMix` rides along automatically. `_normalizeImageEntry()`
(Edit 1, item 2) covers presets saved before this feature.

> Implementation check: confirm the layer save path serializes the full entry object
> and has no property whitelist before relying on automatic persistence.

---

## 5. Coverage

The Color FX section renders unconditionally for every layer type that uses the layer
card (image / gif / video / text). The solarize step injects at the same pipeline point
as Invert/Thresh, so it inherits identical layer-type coverage — no per-type branching.

---

## 6. Out of scope / explicitly NOT doing

- No change to the Palette-tab `#toggle-solarize` (system A). Untouched.
- No new toggle, no "global solarize all layers" control — single per-layer slider only.
- No audio-reactivity on this slider (Invert/Thresh are also non-reactive; stay consistent).

---

## 7. Verification checklist (post-implementation)

- [ ] New layer: Solarize slider present in Color FX, reads `0.00`, no visible effect.
- [ ] Drag to `1.00` on one layer → that layer solarizes; other layers unchanged.
- [ ] Palette-tab Solarize toggle still works on the background, independent of layers.
- [ ] Invert + Solarize on the same layer compose in order (invert then solarize).
- [ ] Save preset, reload → `solarizeMix` round-trips.
- [ ] Load a pre-2026-05-15 preset → no error, slider shows `0.00`.
- [ ] Slider at `0.00` injects no shader code (`hasSolarize` false).
- [ ] All other layer sliders still map to the correct properties (exclusion list intact).
