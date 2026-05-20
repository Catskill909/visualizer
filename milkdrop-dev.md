# MilkDrop Preset Editor — Dev Notes

Status: phases 1, 3, 6, 7, 8, 10 shipped; phases 2, 4, 5, 9 deferred pending butterchurn-fork decision.

Last updated: 2026-05-20

---

## Phase status

| Phase | What | State |
|---|---|---|
| 1 | Palette bug fix + Glow/Accent Strength sliders | **Shipped** |
| 2 | Wave stroke width + Rotation | **Deferred** — requires butterchurn fork |
| 3 | Wave audio reactivity (Source + Curve + FX) | **Shipped** |
| 4 | Wave Echoes (count + color mode) | **Deferred** — requires butterchurn fork |
| 5 | More wave shape modes | **Deferred** — requires butterchurn fork |
| 6 | Palette QoL (hover preview, lock channels, My Mix) | **Shipped** |
| 7 | Motion presets grid (+ Reset) | **Shipped** |
| 8 | Per-slider source override (wave-tab variant) | **Shipped** |
| 9 | Motion warp shape picker | **Deferred** — requires shader work |
| 10 | Surprise button (variation mix slider deferred) | **Partially shipped** |
| polish | Dbl-click-label reset, Wave Shape Reset, Save→Save, no redundant tooltips | **Shipped** |

---

## Shipped notes

### Phase 1 — Palette bug fix + Strength sliders
Two surfaces were silently forcing border state on every color change: `_applyPalette()` and the individual Glow/Accent color-swatch handlers in `_bindColorSwatches()`. Both wrote `ob_a = 0.75` (and conditionally `ib_a = 0.5`) plus default sizes whenever the user picked a color, producing the "palettes add several borders" symptom. Both fixed — color writes now do colors only.

Added `_buildPaletteStrengthSliders()` ([src/editor/inspector.js](src/editor/inspector.js)) rendering "Glow Strength" + "Accent Strength" under the chip grid. **Coupled axis**: each Strength slider drives BOTH alpha AND size simultaneously (alpha 0→1 maps to size 0→0.05). Without this coupling, dragging Strength on a virgin preset (`ob_size = 0`) would change alpha but render nothing. The Appearance tab still exposes separate size + alpha sliders, kept in sync via `mirror` config entries.

### Phase 3 — Wave audio reactivity
New state: `waveReact: { source, curve, scaleAmt, opacityAmt, mysteryAmt, orbitAmt, perSrc: { ... } }` in BLANK. New eq builder `buildWaveReactFrameEqs(wr)` in [src/customPresets.js](src/customPresets.js) — modulates `a.wave_a`, `a.wave_scale`, `a.wave_mystery`, and orbits `a.wave_x/y` in a slow circle whose radius scales with audio. Injected into the runtime preset alongside motionReact in both `_buildRuntimePreset` and the player's preset registration in [src/visualizer.js](src/visualizer.js). UI: Source dropdown + Curve segmented + 4 sliders (Size / Opacity / Shape / Orbit) in the Wave tab above Randomize. Older presets that lack `waveReact` get BLANK defaults via the standard load-merge.

### Phase 6 — Palette QoL
1. **Hover preview** — `mouseenter` on a chip pushes its colors live to the engine via `_previewPaletteEnter()`; `mouseleave` restores via `_previewPaletteLeave()`. No undo snapshot. Swatches stay frozen on committed state so the user can compare "what I have" vs "what this chip would do." Skips locked channels.
2. **Per-channel locks** — 🔓/🔒 toggle button beside each Wave / Glow / Accent row. Locked channels are skipped by `_applyPalette()` AND `_previewPaletteEnter()`. State persists in localStorage (`dc.palette.locks`), survives across sessions, not per-preset.
3. **My Mix** — "+ Save current mix" button under the chip grid. Snapshots the current Wave/Glow/Accent triplet to localStorage (`dc.palette.myMix`) and re-renders the grid with a 13th chip that recalls it. Single slot; overwrites on save.

### Phase 7 — Motion presets grid + Reset
Six one-click motion looks at the top of the Motion tab: **Vortex / Calm Drift / Earthquake / Tunnel In / Spin Lock / Hyperspace**. Constant `MOTION_PRESETS` in [src/editor/inspector.js](src/editor/inspector.js); apply uses `Object.assign(currentState.baseVals, mp.bv)` so it only touches motion fields — wave / palette / colors / echo orient / reactivity stay untouched.

The "↺ Reset" button beside the section header calls `_resetMotion()` which snaps every motion field back to its BLANK default. Same field set as the presets write to; symmetric "undo" path that doesn't depend on keyboard undo.

### Phase 8 — Per-slider source override (wave-tab)
The original brainstorm ("pick which motion param audio modulates") turned out to be already covered by per-amount sliders on `motionReact`. Shipped the meaningful next step on the **wave-tab** instead: each of the 4 wave-react sliders gets a small "src" pill in its header. Click cycles `· → B → M → T → V → F → ·`. Override (`·` = "use global source") shown as inverted (white background). Eq builder rewritten to emit per-amount `_raw` lines so each slider can pull from a different source on the same frame. Unlocks combos like "bass pumps wave size while treble morphs shape." Motion-tab pattern unchanged — extending to motion is mechanical follow-up.

### Phase 10 — Surprise button (partial)
**Shipped:** `✨` icon-only button in the editor footer. Rolls random variation → random palette → random motion preset → wave-randomize, all using existing apply methods. Each step uses its own snap, so the surprise can be step-undone back to the starting state. Wired in `_bindSurpriseButton()`.

**Deferred:** the variation mix slider. The brainstorm imagined a 0→100% lerp between two variations, but solid-mode variations (`Solid`, `Shift`) use a different comp shader pipeline than feedback-mode variations — there's no clean midpoint between the two. A mix slider would only work for same-mode pairs, which is fragile UX.

### Polish (2026-05-20)
- **Dbl-click slider label → default.** Extended `makeSlider()` so every slider built by the helper now wires a `dblclick` on its label to reset to its initial `value`. Dispatches a synthetic pointerdown/input/pointerup sequence so the reset is undoable through the existing snap pipeline. CSS rule `.slider-label.is-resettable` adds the dashed-underline cursor hint. Doesn't affect the hardcoded palette-opacity slider in markup (its existing handler is unchanged and still works).
- **Wave Shape Reset.** Mirror of the Motion Presets reset. Sets `wave_a = 0` so no wave is drawn. The active highlight on the wave-mode grid is now conditional on `wave_a > 0.001` — so when the wave is hidden, no shape button looks "selected." Clicking a shape on a hidden wave bumps `wave_a` back to 0.8 so the click isn't a no-op.
- **"Save preset" → "Save"** in the editor footer to make room for `✨` Surprise without crushing the label.
- **Removed redundant `data-tooltip`** from wave-mode buttons and motion-preset buttons — both already render their label/desc inside the button.
- **Glow/Accent Strength couple alpha + size.** Earlier ship wrote only alpha, which appeared dead on virgin presets (`ob_size = 0`). Now writes both.

---

## Engine-fork decision (Phases 2 / 4 / 5 / 9)

Each of these needs functionality that butterchurn (the upstream package we depend on) doesn't expose:

- **Variable stroke width**: engine fakes thickness via 4 instances at fixed 2 px offset ([node_modules/butterchurn/lib/butterchurn.js:5898](node_modules/butterchurn/lib/butterchurn.js#L5898)). No native width param.
- **Wave rotation**: each shape mode computes its own angle inline; no global `wave_rot` param.
- **Wave echoes**: no path to render the wave shape N times per frame from a single preset.
- **Warp shape picker**: would need to swap warp shader variants per preset; warp shader is fixed today.

**Path forward when we decide to invest:** vendor `butterchurn.js` into `src/vendor/`, swap the import in `src/visualizer.js` and `src/editor/inspector.js`, patch in `wave_thickness` / `wave_rot` / `wave_echoes` / `warp_variant` as preset-readable params. Maintenance cost = whatever upstream bug-fix cherry-picks we want over time.

---

## Where the editor stands today

Four tabs:

| Tab | Contents |
|---|---|
| **Palette** | Palette Opacity, Start-from variations (8), Pulse & Breath, 12 Quick Palettes + optional "My Mix" 13th chip + "+ Save current mix" button, Glow Strength + Accent Strength sliders, 3 color rows with per-channel 🔓/🔒 locks, Appearance sliders (Trail / Border Size & Alpha × outer + inner / Wave-fade / Saturation / Hue Rotate), Invert / Darken / Brighten / Solarize toggles |
| **Motion** | **Motion Presets grid (6) + ↺ Reset**, Movement sliders, Echo Direction segmented, Drift & Stretch, Warp Center, Reactivity panel (Source + Curve + 6 amount sliders + Shrink + 5 FX amounts + Beat Sensitivity) |
| **Wave** | 8 Shape modes + **↺ Reset** (highlight conditional on `wave_a > 0`), Style sliders (Size/Opacity/Smoothing/Mystery/PosX/PosY + Thickness toggle), Options toggles (Dots/Additive/Brighten), **Reactivity panel (Source + Curve + 4 sliders with per-slider source pills)**, Randomize |
| **Layers** | Canvas Mirror (incl. Kaleido), up to 5 layers (image / video / GIF / text), full per-layer effect pipeline |

**Footer:** Remix · + New · ✨ Surprise · Save · Reset.

Every slider built via `makeSlider()` supports **double-click on the label to reset to default**.

---

## Backlog / future ideas

Reasonable next moves grouped by required investment.

### No-engine-work additions
- **Extend per-slider source override to the Motion-react panel.** Same pattern shipped on wave-react; mechanical to extend once the wave-tab UX is validated.
- **Per-wave trail length.** A separate decay on the wave channel so wave trails can be long without the whole frame smearing. Doable via post-render shader or by injecting a wave-specific alpha cap.
- **Pinned multiple My Mixes.** Today's single slot is intentional. If users want a row of saved chips, generalize the storage key to an array and render N saved chips.
- **Motion-tab equivalent of Wave-tab Reset.** Already shipped, but the Palette tab has nothing analogous. Could ship "Reset palette" if requested.

### Requires butterchurn fork (see decision section)
- Phases 2, 4, 5, 9. All described above.

### Bigger structural moves
- **Multi-shape sub-tab.** Wave becomes a stack of 1–4 shape entries, each with its own mode/color/reactivity, mirroring how real MilkDrop presets author multiple `shapecode_N_` blocks. Parked — the single-wave improvements in Phases 3/8 cover most of the creative payoff for less surface area.
- **Variation mix slider.** Cross-mode lerp is fragile (solid vs. feedback comp shaders). Possible revisit: restrict mixing to same-mode pairs, or rebuild as a "blend toward target variation" slider only available on compatible pairs.
