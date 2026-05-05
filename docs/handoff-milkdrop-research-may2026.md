# Handoff — MilkDrop Research & Control Gap Analysis (May 2026)

> **Conversation ended:** 2026-05-04 (usage limit).
> **Pick up at:** **Float Field / Depth Scatter** (image-effects Phase 6.1 in `docs/preset-editor/future-effects.md`) — multi-instance render mode with size-as-depth. This is the original 2026-05-04 user ask ("multiple floating images at different depths and sizes") that I missed, instead building Warp-Follow UV which was reverted same day. Phases 7 + 8 baseVals work shipped 2026-05-04.
>
> **Phase 9 (blur range controls) dropped** — user direction 2026-05-05. Low impact / shader-dependent; not worth the UI surface.
>
> **Warp-Follow UV reverted 2026-05-05** — the per-layer UV displacement just wiggled images inside their own bounds; visually it had nothing to do with multi-depth scatter. Code and docs cleaned out.

---

## What happened this session

### 1. Preset load contamination — SHIPPED ✅

Symptom: loading any preset (bundled or custom) did not clear the previous preset's state. Both the DOM/state layer and the GPU framebuffer were contaminated.

**Two-layer fix:**
- `_clearForLoad()` shared helper: clears DOM chip states, `_solidColor`, `_imagesOnly`, palette/variation UI, calls `clearFeedbackBuffer()`
- `loadPresetData()` now overlays saved fields onto `deepClone(BLANK)` instead of directly into `currentState`
- `_buildCompShader()` moved to after the image loop (was before — image GLSL was missing)
- New `clearFeedbackBuffer()` on `VisualizerEngine`: zeroes butterchurn's `prevFrameBuffer` and `targetFrameBuffer` via direct GL calls

Root cause: `texture(sampler_main, uv) * 2.0` in the auto-built comp is a 2× amplifier. With `decay ≈ 0.98`, bright pixels never fade — they clamp at 1.0 each frame. The framebuffer had to be explicitly zeroed, not just left to decay.

Full write-up: [docs/bugs/preset-load-contamination.md](bugs/preset-load-contamination.md)

---

### 2. MilkDrop external editor research — completed ✅

Surveyed 6 editors: Winamp MilkDrop 2 (original), butterchurn-editor-electron (jberg), MilkDrop3/BeatDrop (milkdrop2077), projectM, NestDrop, WACUP.

**Primary finding: Preset Studio is ahead of all external editors on baseVal coverage.**

| Editor | BaseVal control method | # Exposed |
|---|---|---|
| Winamp MD2 | Hierarchical keyboard menu + hotkeys | All ~35 (no sliders) |
| butterchurn-electron | Code-only (textarea per section) | 0 sliders |
| MilkDrop3 MilkPanel | 6 named sliders | 6 |
| NestDrop | Playback / VJ controls only | 0 baseVals |
| **Preset Studio** | **Sliders + swatches + toggles** | **All headline (post Phase 8)** |

No external editor exposes image layers, per-layer audio reactivity, GIF support, per-layer effects (chromatic aberration, posterize, mirror, sway, wander, etc.) — those are our original contribution built on top of the MilkDrop engine.

---

## Full parameter standard (canonical MilkDrop spec)

### Global baseVals — motion / warp

| Param | Default | Range | Description |
|---|---|---|---|
| `zoom` | 1.0 | >0 | Inward/outward zoom per frame |
| `zoomexp` | 1.0 | >0 | Zoom curvature (1=uniform, >1=edge-biased) |
| `rot` | 0 | any | Rotation per frame |
| `warp` | 1.0 | >0 | Warp magnitude |
| `warpanimspeed` | 1.0 | any | Warp animation speed |
| `warpscale` | 1.0 | any | Warp UV wavelength |
| `cx`, `cy` | 0.5, 0.5 | 0–1 | Center of rotation/stretch |
| `dx`, `dy` | 0, 0 | any | Constant translation drift per frame |
| `sx`, `sy` | 1.0, 1.0 | >0 | Horizontal / vertical stretch |

### Global baseVals — decay / brightness / echo

| Param | Default | Range | Description |
|---|---|---|---|
| `decay` | 0.98 | 0–1 | Fade to black per frame |
| `gammaadj` | 2.0 | >0 | Display brightness |
| `echo_zoom` | 2.0 | >0 | Size of feedback echo layer |
| `echo_alpha` | 0 | 0–1 | Opacity of feedback echo layer |
| `echo_orient` | 0 | 0–3 | Echo orientation (normal / flip-x / flip-y / both) |

### Global baseVals — wave (baseVals level)

| Param | Default | Range | Description |
|---|---|---|---|
| `wave_mode` | 0 | 0–7 | Waveform type |
| `wave_scale` | 1.0 | any | Amplitude scale |
| `wave_smoothing` | 0.75 | 0–1 | Curve smoothness (0=jagged, 1=glass) |
| `wave_mystery` | 0 | −1–1 | Mode-dependent parameter |
| `wave_r/g/b` | 1,1,1 | 0–1 | Wave color |
| `wave_a` | 0.8 | 0–1 | Wave opacity |
| `wave_x/y` | 0.5, 0.5 | 0–1 | Wave position on screen |
| `wave_thick` | 0 | 0/1 | Double line thickness |
| `wave_usedots` | 0 | 0/1 | Draw as dots |
| `additivewave` | 0 | 0/1 | Additive blending |
| `wave_brighten` | 1 | 0/1 | Max-brightness normalization |
| `modwavealphabyvolume` | 0 | 0/1 | Fade wave when quiet |

### Global baseVals — borders

| Param | Description |
|---|---|
| `ob_size/r/g/b/a` | Outer border thickness, color, alpha |
| `ib_size/r/g/b/a` | Inner border thickness, color, alpha |

### Global baseVals — blur texture clamps

| Param | Default | Description |
|---|---|---|
| `blur1_min/max` | 0, 1 | Pass 1 clamp range for `sampler_blur1` |
| `blur2_min/max` | 0, 1 | Pass 2 clamp range for `sampler_blur2` |
| `blur3_min/max` | 0, 1 | Pass 3 clamp range for `sampler_blur3` |
| `b1ed` | 0.25 | Pass 1 edge darkening |

### Global baseVals — motion vectors

`mv_x`, `mv_y`, `mv_l`, `mv_r/g/b/a` — diagnostic arrow overlay. `mv_a=0` by default; disabled in virtually all library presets. Not planned for exposure.

### Global toggles

`darken_center`, `btexwrap`, `binvert`, `bbrighten`, `bdarken`, `bsolarize`, `bredbluestereo`

### Custom shapes (0–3)

25 fields each: `enabled`, `sides`, `x/y`, `rad`, `ang`, `r/g/b/a`, `r2/g2/b2/a2`, `border_r/g/b/a`, `textured`, `tex_zoom/ang`, `additive`, `thickoutline`, `num_inst`

### Custom waves (0–3)

13 fields each: `enabled`, `r/g/b/a`, `spectrum`, `thick`, `usedots`, `additive`, `scaling`, `smoothing`, `sep`, `samples`

### Code sections

`per_frame_init`, `per_frame`, `per_pixel` equations (EEL2 language); `warp` and `comp` GLSL shaders; per-shape and per-wave init/per-frame/per-point equation strings.

---

## Our coverage status

### What we expose (all headline baseVal fields — post-Phase 8)

✅ `zoom`, `rot`, `warp`, `warpanimspeed`, `warpscale`, `zoomexp` — Motion tab
✅ `dx`, `dy`, `sx`, `sy`, `cx`, `cy` — Motion tab (Drift & Stretch + Warp Center sections)
✅ `decay`, `gammaadj` — Palette tab
✅ `echo_zoom`, `echo_orient`, `echo_alpha` — Motion tab
✅ `wave_mode`, `wave_scale`, `wave_a`, `wave_mystery`, `wave_smoothing`, `wave_x`, `wave_y`, `wave_thick`, `wave_usedots`, `additivewave`, `wave_brighten` — Wave tab
✅ `wave_r/g/b` — Wave color swatch in Palette tab
✅ `ob_r/g/b`, `ob_size`, `ob_a` — Glow swatch + sliders in Palette tab
✅ `ib_r/g/b`, `ib_size`, `ib_a` — Accent swatch + sliders in Palette tab
✅ `darken`, `invert` — Palette tab toggles
✅ `b1ed` — Reactivity section (Motion tab)
📋 `blur1/2/3 min/max`, `modwavealphabyvolume` — Phase 9 (shader-dependent, power-user)

### Gaps to close in Phase 9

> Phase 7 (`wave_smoothing`, `wave_x`, `wave_y`) shipped 2026-05-04.
> Phase 8 (`echo_alpha`, `dx`, `dy`, `zoomexp`, `sx`, `sy`, `cx`, `cy`) shipped 2026-05-04.

| Param(s) | Phase | Priority |
|---|---|---|
| `blur1–3 min/max` | 9 | Low (shader users only) |
| `modwavealphabyvolume` | 9 | Low |

All gap params are already in butterchurn's BLANK defaults — no schema changes required to add them.

---

## Editor-by-editor notes

### Winamp MilkDrop 2 (original)
- M-key opens hierarchical in-canvas menu; arrow keys navigate; changes live-apply
- Keyboard hotkeys: i/I zoom, </> rotate, [ / ] push H/V, o/O warp, W cycle wave mode
- In-canvas code editors for equations + shaders; Ctrl+Enter recompiles
- No sliders, no color picker, no GUI — menu scroll only
- Freeze with Scroll Lock before saving edits

### butterchurn-editor-electron (jberg)
- Electron app with live butterchurn preview
- Dropdown: Preset Equations / Shapes / Waves / Shaders → large textarea per section
- Pure code editing only — zero baseVal sliders
- No GUI for any individual parameter

### MilkDrop3 / BeatDrop (milkdrop2077, mvsoft74)
- F1 opens MilkPanel GUI (added Dec 2024)
- 6 sliders: WAVE_SIZE, ZOOM_AMOUNT, ZOOM_EXPONENT, WARP_AMOUNT, WARP_SCALE, WARP_SPEED
- Shader editor with syntax highlight, undo/redo, Ctrl+Space autocomplete, Ctrl+Enter recompile
- Extensions: 16 shapes/waves (vs 4), q1–q64 (vs q1–q32), 500-sided shapes, mouse variables in shaders, `get_fft(pos)` in shaders (v3.33+), 28+ transition patterns
- 5 sprite image layers with 6 blend modes — closest to our image layer system, but simpler

### projectM
- Renderer/library only — no editing UI of any kind
- GitHub issue #113 explicitly requests the M-key menu port (not done)

### NestDrop
- VJ playback tool — preset blending, strobe, LFO, audio reactivity
- No baseVal editing at all

---

## What we have that no external editor has

| Feature | Notes |
|---|---|
| Image layers (up to 5) | Full per-layer transform + motion + effects pipeline |
| GIF animation | Playback + GIF Optimizer (frame reduction, resize, GPU estimate) |
| Per-layer audio reactivity | Source (bass/mid/treb/vol) + curve shape (linear/squared/cubed/gate) |
| Chromatic Aberration | RGB channel split with animated offset |
| Posterize | 5 levels (off/2/4/8/16) applied post-tint |
| Per-layer Mirror | Off / H / V / Quad / Kaleido — with scope (per-tile vs whole-image) |
| Sway / Wander | Sinusoidal and organic random drift |
| Orbit | Circular path around anchor point |
| Bounce | Bass-reactive vertical push |
| Tunnel | Seamless infinite zoom (two-layer crossfade) |
| Shake | Omnidirectional beat jolt |
| Skew X/Y | Parallelogram/rhombus tile shear |
| Tile Width/Height | Independent cell aspect control |
| Canvas Mirror | Scene-level UV fold (all layers + warp buffer together) |
| Base variation picker | 9 starting-point snapshots |
| Quick palettes | One-click color schemes |
| Undo/redo | 50-deep stack, Cmd+Z / Shift+Cmd+Z |
| Solo/Mute per layer | Independent or combined |

---

## Phase 7-14 plan (full detail)

See [custom-preset-editor.md](../custom-preset-editor.md) — Phase 7 onward in the Remix from Library tracker.

Quick reference:

| Phase | What | Status |
|---|---|---|
| 7 | Wave smoothing + wave XY position | ✅ Shipped 2026-05-04 |
| 8 | Echo alpha, dx/dy drift, zoomexp, sx/sy stretch, **cx/cy warp center** | ✅ Shipped 2026-05-04 |
| 9 | Blur range sliders, modwavealphabyvolume | ❌ Dropped 2026-05-05 (low impact, shader-dependent) |
| Image P2 | Warp-Follow UV | ❌ Tried & reverted 2026-05-05 — only wiggled images inside their bounds; not the multi-depth scatter the user actually asked for |
| Image P6.1 | **Float Field / Depth Scatter** — N copies of an image at randomised positions/sizes (size = depth). The original 2026-05-04 ask. | 📋 **Next image-track task** |
| 10 | EEL2 equation editor — unlocks **multi-vortex / off-center** via `per_pixel_eqs` | 📋 Future |
| 11 | Raw shader editor | 📋 Future |
| 12 | .milk import / export | 📋 Future |
| 13 | **Shape Composer** — placement-first replacement for the removed Phase 6 Objects tab; multi-center via 4 independent shape positions | 📋 Future |
| 14 | In-app tooltip pass — leverage existing `[data-tooltip]` CSS to add hover help to every editor control. Includes promoting cx/cy from sliders to a draggable XY pad. | 📋 Future |

**Off-center composition track (the "everything radiates from center" problem):** Phase 8e (`cx`/`cy` single warp pivot) → Phase 13 (multiple shape positions) → Phase 10 (per-pixel arbitrary transforms). All three are different escape hatches from the single-pivot default; each unlocks a higher tier of compositional freedom.

---

## Files changed this session

| File | Change |
|---|---|
| `src/editor/inspector.js` | `_clearForLoad()` extracted; `loadBundledPreset` + `loadPresetData` refactored to use it; `_buildCompShader()` moved after image loop; BLANK overlay pattern for `loadPresetData`. **Phase 7 (2026-05-04):** `wave_smoothing`, `wave_x`, `wave_y` added to BLANK + Wave tab sliders + randomize + sync map. **`loadPresetData` shallow-merge bug fix (2026-05-04):** explicit `baseVals: { ...BLANK.baseVals, ...stateFields.baseVals }` so older saves missing newer fields actually fall back to defaults. **Phase 8 (2026-05-04):** `echo_alpha`, `dx`, `dy`, `zoomexp`, `sx`, `sy`, `cx`, `cy` added to BLANK; `_buildMotionSliders()` refactored to a sections array driving 4 containers; `_syncMotionSliders()` map extended; randomize handler extended with conservative ranges. |
| `editor.html` | **Phase 8 (2026-05-04):** Motion tab gained three new DOM blocks — `#motion-echo-alpha` (Echo Opacity), `#motion-drift-sliders` (Drift & Stretch section), `#motion-center-sliders` (Warp Center section with explanatory note). |
| `src/editor/inspector.js` | **Warp-Follow UV (2026-05-05) — TRIED & REVERTED same day.** Built and removed: `warpFollow` field, Visual Effects slider, squared-curve handler, GLSL `sampler_main`-displacement injection in three render paths. Visually it just wiggled each image instance inside its own bounds — not the multi-instance depth-scatter the user originally asked for. Code is clean of all references. |
| `docs/preset-editor/image-layer-effects.md` | **2026-05-05:** Warp Follow row briefly added then removed. |
| `docs/preset-editor/future-effects.md` | **2026-05-05:** Priority matrix — Continuous Spin and Pulse Opacity marked already-built (had been incorrectly listed as future ideas the day before); Warp-Follow flipped to ❌ tried & reverted with pointer to Float Field 6.1. |
| `custom-preset-editor.md` | **2026-05-05:** Brainstorm section corrected — Continuous Spin and Pulse Opacity flipped from 🔄/💓 (future) to ✅ BUILT; Warp-Follow flipped to ❌ tried & rejected. |
| `src/visualizer.js` | `clearFeedbackBuffer()` added — zeroes `prevFrameBuffer` + `targetFrameBuffer` via direct GL calls |
| `custom-preset-editor.md` | Bug section added + closed; One Truth progress table; Tuning controls checklist; Phase 7-12 added; research section added |
| `docs/bugs/preset-load-contamination.md` | Created — full bug plan, fix, root cause analysis (§10) |
| `docs/handoff-milkdrop-research-may2026.md` | This file |

---

## Next session: start here

**Phases 7 + 8 ✅ shipped 2026-05-04** — All headline baseVal fields are now exposed in the editor. Wave tab gained Smoothing / Position X / Position Y. Motion tab gained Echo Opacity, Drift H/V, Stretch H/V, Zoom Curve, and Warp Center X/Y (the single biggest "feels different" lever for blank-canvas builds — it was the answer to "why does everything radiate from the center?").

**Hardening shipped alongside (2026-05-04)** — `loadPresetData` was doing a shallow top-level spread, so older custom saves missing newer baseVal fields would have loaded with `undefined` → `NaN` slider labels. Fixed by deep-merging `baseVals` against `BLANK.baseVals` to match `loadBundledPreset`'s pattern. Same pattern now protects every future baseVal addition.

**New phases captured this session (Phase 13 / 14)** — Phase 13 is the placement-first Shape Composer (replaces the removed Phase 6 with a different framing — independent x/y per shape = multi-center composition). Phase 14 is an in-app tooltip pass leveraging the existing `[data-tooltip]` CSS to add hover help to every editor control; also tracks promoting cx/cy from sliders to a draggable XY pad.

1. **Phase 13 — Shape Composer** (next baseVals-track task — the off-center primitive):
   - Replace the failed Phase 6 "edit all 25 shape fields" approach with placement-first design
   - Card-stack mirroring image layers; per-card position XY pad, size, sides, color, border, additive/textured toggles
   - Drag-on-canvas placement using existing image-layer XY pad pattern
   - Up to 4 shapes = up to 4 independent visual centers — the strongest "off-center" tool short of per-pixel equations

2. **Image-track candidates** (smaller / quicker wins on the image-effects side):
   - **Float Field / Depth Scatter** (P6 in `future-effects.md`) — N copies at randomised positions/sizes, size = depth. The conceptual "multi-floating-images" mode the user described 2026-05-05.
   - **Tooltip pass** (Phase 14) — add `data-tooltip` to remaining controls; promote `cx`/`cy` from sliders to a draggable XY pad.
