# Color Palette Tab - Working Spec

Research and execution doc for Palette controls in Preset Studio.
Last updated: May 5, 2026 (debug removed, triads complete, saturation + hue rotate added).

---

## Current truth

### Palette controls currently exposed

- Swatches:
  - Wave -> `wave_r`, `wave_g`, `wave_b`
  - Glow -> `ob_r`, `ob_g`, `ob_b`
  - Accent -> `ib_r`, `ib_g`, `ib_b`
- Sliders:
  - `gammaadj` (Brightness)
  - `decay` (Trail)
  - `ob_size`, `ob_a`
  - `ib_size`, `ib_a`
  - `modwavealphabyvolume` (Fade Wave in Silence)
  - `studio_saturation` (Saturation, 0–2, default 1)
  - `studio_hue_rotate` (Hue Rotate, 0–360°, default 0)
- Toggles:
  - `invert`
  - `darken`
  - `brighten`
  - `solarize`
  - `darken_center`
- Wave tab also has `wave_brighten` (separate from `brighten`).

### Important behavior notes

- `brighten`/`darken`/`solarize`/`invert` are now injected into studio comp shader output, so they affect both studio-generated and bundled comp paths.
- `darken_center` is handled in a separate rendering path and remains independent.
- `studio_saturation` and `studio_hue_rotate` are baked as numeric literals into the comp shader at compile time (not butterchurn uniforms). At defaults (sat=1, hue=0) no GLSL lines are emitted — zero cost on existing presets.
- `red_blue` should remain out of scope for now (not reliably renderer-active in our path).

---

## Completed work (Tier 1 so far)

### Completed

- [x] Added baseVals keys:
  - [x] `brighten`
  - [x] `solarize`
  - [x] `darken_center`
  - [x] `modwavealphabyvolume`
- [x] Added Palette toggles:
  - [x] Brighten
  - [x] Solarize
  - [x] Darken Center
- [x] Added Palette slider:
  - [x] Fade Wave in Silence (`modwavealphabyvolume`, range 0..2.0)
- [x] Added sync wiring for all new toggles/slider in `_syncAllControls()` and `_syncPaletteSliders()`.
- [x] Changed startup/reset default variation to Shift for better first-run UX.
- [x] Added (then removed) Control Debug panel — shipped as internal tool, removed before release for clean UI.
- [x] Added studio post-FX injection marker and logic for comp shader (`STUDIO_POST_FX`).
- [x] Added Saturation slider (`studio_saturation`, 0–2, baked GLSL literal).
- [x] Added Hue Rotate slider (`studio_hue_rotate`, 0–360°, Rodrigues rotation baked as GLSL literal).
- [x] Fixed `_rebuildPostFx` to re-inject from current comp (not bare `BLANK_COMP_RAW`), preventing solid-mode visual reset on slider move.

### Still pending in Tier 1

- [x] Make Quick Palettes true triads (Wave + Glow + Accent).
- [x] Add third chip dot for Accent.
- [x] Update `_applyPalette(i)` to set `ib_r/g/b` from chip data.
- [x] Apply accent visibility defaults on chip apply when needed (`ib_a`, `ib_size`).
- [x] Verified chip layout — no CSS change needed, existing dot styles handle 3 dots cleanly.

---

## Why some controls can still feel inactive

This is expected in some presets and does not automatically mean broken wiring.

- A control can update state but have weak visible impact depending on current preset content.
- Visibility masks can hide effects (for example, wave-related controls when `wave_a` is 0).
- Imported frame equations may continuously write values, reducing perceived impact of manual controls.

The Control Debug panel was removed before release. To diagnose these cases, inspect `currentState.baseVals` in the browser console (`window.__editorInspector.currentState`).

---

## Butterchurn key map (corrected)

Use these canonical names in code and docs:

- `brighten`
- `solarize`
- `darken_center`
- `modwavealphabyvolume`
- `invert`
- `darken`

Do not use stale names:

- `bsolarize` (wrong)
- `bredbluestereo` (wrong)

---

## Tier 1 checklist (active)

### Setup and safety

- [ ] Confirm current branch and keep scope limited to Tier 1.
- [x] Verify no accidental inclusion of `red_blue` in Tier 1.

### Inspector: state and wiring

- [x] Add `brighten: 0` to BLANK baseVals.
- [x] Add `solarize: 0` to BLANK baseVals.
- [x] Add `darken_center: 0` to BLANK baseVals.
- [x] Add `modwavealphabyvolume: 0` to BLANK baseVals.
- [x] Add toggle map entry for `toggle-brighten-fx -> brighten`.
- [x] Add toggle map entry for `toggle-solarize -> solarize`.
- [x] Add toggle map entry for `toggle-darken-center -> darken_center`.
- [x] Add sync calls for those toggles.
- [x] Add slider config `ps-wavefade` for `modwavealphabyvolume`.
- [x] Add slider sync for `ps-wavefade`.

### HTML controls

- [x] Add Palette toggle row for Brighten.
- [x] Add Palette toggle row for Solarize.
- [x] Add Palette toggle row for Darken Center.

### Shader path reliability

- [x] Inject post-FX block into studio comp output.
- [x] Ensure bundled comp path also gets post-FX injection.
- [x] Keep injection idempotent (marker-based, no duplicate block insertion).

### Debug visibility

- [x] ~~Add Control Debug dropdown and output area~~ — removed before release.

### Quick palettes triad upgrade

- [x] Add `accent` to all existing palette entries.
- [x] Render third dot in chips.
- [x] Apply Accent on chip click.
- [x] Sync swatches after chip apply.

### Validation

- [x] Confirm no syntax errors in edited files.
- [x] Verify new controls render in local server.
- [x] Verify startup and New reset to Shift.
- [x] Verify quick palette click updates Wave + Glow + Accent.
- [x] Verify save/reload preserves full Tier 1 values including triad chips.

---

## Tier 1 status: COMPLETE

All checklist items done. Saturation and Hue Rotate sliders added and validated. Debug panel removed before release. Triad chips validated. Ready to build and ship.

## Color model notes (for Tier 2 planning)

MilkDrop exposes 4 named color objects at the `baseVals` level:

| Object | Keys | What it controls |
|---|---|---|
| Wave | `wave_r/g/b/a` | Waveform color |
| Outer Border (Glow) | `ob_r/g/b/a` | Outer glow ring |
| Inner Border (Accent) | `ib_r/g/b/a` | Inner ring |
| Motion Vectors | `mv_r/g/b/a` | Motion vector arrows (rare) |

Current 3-swatch UI covers Wave + Glow + Accent — the only missing object is Motion Vectors (`mv_r/g/b`), which is only relevant when `mv_a > 0`. Tier 2 candidate if motion vectors are surfaced.

Background color is not a named object — it is driven by `decay`, warp equations, and the comp shader. No hex picker is appropriate here.

## Post-FX shader architecture

`buildStudioPostFxGlsl(sat, hue)` generates the injected GLSL block. All values are baked as numeric literals, not uniforms, so they work on any comp shader regardless of which butterchurn uniforms are exposed.

- `injectStudioPostFx(comp, opts)` — strips any existing block, then injects fresh with current values
- `stripStudioPostFx(comp)` — removes old block cleanly before re-injection
- `_rebuildPostFx()` — re-strips and re-injects from `this.currentState.comp` (not `_baseComp`)
- `_baseComp` is only used by `_buildCompShader` for image-layer builds where we control the source GLSL directly

