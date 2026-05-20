# MilkDrop Preset Editor — Dev Notes

Status: phases 1, 3, 6, 7, 8, 10 shipped (2026-05-19 → 2026-05-20). Phases 2, 4, 5 next via butterchurn fork. Phase 9 deferred (GLSL territory).

Last updated: 2026-05-20

---

## 🎯 Pick up here

**If you're opening this doc to resume work, this is the only block you need to read.**

### ✅ Shipped
- **Palette** — bug fix (no forced borders), Glow/Accent Strength sliders (couple alpha+size), hover-preview chips, per-channel 🔓/🔒 locks, "+ Save current mix" (single My Mix slot).
- **Motion** — 6-preset grid (Vortex/Calm Drift/Earthquake/Tunnel In/Spin Lock/Hyperspace) + ↺ Reset.
- **Wave** — Reactivity panel (Source/Curve + Size/Opacity/Shape/Orbit sliders, per-slider source pills), Shape Reset, conditional active highlight.
- **Footer** — ✨ Surprise rolls coherent random combo. "Save preset" → "Save" so it fits.
- **Universal** — double-click any slider label → reset to default (via `makeSlider`).

### 🎯 Next: Butterchurn fork — start with Phase A
**Why now:** the four highest-impact deferred features (variable stroke width, wave rotation, wave echoes, more shape modes) all need engine ownership. The fork itself is mechanical; the patches per feature range from 2 hours (stroke width) to a day (echoes).

**Recommended starting sequence:**
1. **Phase A** — set up the fork (no new feature, just prove the swap works). ~1 hour.
2. **Phase B** — variable stroke width slider. Easiest patch, biggest visible win. ~2 hours.
3. **Phase C** — wave rotation. Clean uniform transform, applies to all shape modes. ~3 hours.
4. **Phase D** — wave echoes. Bigger patch, render-loop change. ~half day.
5. **Phase E** — more shape modes (polygon / lissajous / spiral). Pure additive, low risk. Each ~half day.

**Stop / re-evaluate point:** after Phase B. Once stroke width ships, decide whether the maintenance cost feels acceptable before continuing.

Full per-phase audit and patch plan in §"Butterchurn fork plan" below.

### 📋 Backlog (no fork needed)
- Per-slider source override on Motion-react panel (mechanical extension of Phase 8 pattern).
- Pinned multiple My Mixes (today's single slot → array of N).
- Variation mix slider — revisit if you want to lerp between same-mode variations only.

### ⏸ Deferred indefinitely
- **Phase 9 — Warp shape picker.** Real GLSL work. The warp shader is a separate module ([node_modules/butterchurn/lib/butterchurn.js:2321](node_modules/butterchurn/lib/butterchurn.js#L2321)), not inline in `butterchurn.js`. See "GLSL future work" section for what this entails if you ever decide to go there.
- Multi-shape sub-tab (Wave → stack of 1–4 shape entries). Parked — single-wave improvements cover most of the creative payoff for less surface.

---

## Phase status table

| Phase | What | State |
|---|---|---|
| 1 | Palette bug fix + Glow/Accent Strength sliders | **Shipped** |
| 2 | Wave stroke width + Rotation | **Next** — fork Phase B + C |
| 3 | Wave audio reactivity (Source + Curve + FX) | **Shipped** |
| 4 | Wave Echoes (count + color mode) | **Queued** — fork Phase D |
| 5 | More wave shape modes | **Queued** — fork Phase E |
| 6 | Palette QoL (hover preview, lock channels, My Mix) | **Shipped** |
| 7 | Motion presets grid (+ Reset) | **Shipped** |
| 8 | Per-slider source override (wave-tab variant) | **Shipped** |
| 9 | Motion warp shape picker | **Deferred** — GLSL future work |
| 10 | Surprise button (variation mix slider deferred) | **Partially shipped** |
| polish | Dbl-click-label reset, Wave Shape Reset, Save→Save, no redundant tooltips | **Shipped** |

---

## Butterchurn fork plan

### What we're doing in plain terms

We `import butterchurn from 'butterchurn'` in [src/visualizer.js:5](src/visualizer.js#L5). That pulls 6,738 lines of someone else's code from `node_modules`. To add features the upstream engine doesn't expose, we copy that file into our repo, change the import path, and edit our copy.

**The maintenance trade-off:** after forking, `npm update butterchurn` no longer affects what runs. If upstream ships a bug fix we want, we manually re-apply it on top of our patches. In practice butterchurn is stable and rarely updates, so this is small — but it is a relationship, not a one-time decision.

**License:** butterchurn is MIT. Forking is explicitly allowed.

### Pre-fork audit (current state)

- **Engine size**: 6,738 lines, single file at `node_modules/butterchurn/lib/butterchurn.js`.
- **Our import sites**: only one — [src/visualizer.js:5](src/visualizer.js#L5). The editor's `inspector.js` doesn't import butterchurn directly; it talks to the engine via the `VisualizerEngine` wrapper.
- **License**: MIT (allows forking and distribution).
- **Upstream version**: `butterchurn@^2.6.7` (from [package.json:20](package.json#L20)). Last meaningful release was years ago — low pressure to re-merge.
- **Warp shader separation**: the warp shader is a webpacked submodule referenced as `_shaders_warp__WEBPACK_IMPORTED_MODULE_9__` at line 2321. It is NOT inline in `butterchurn.js` — making warp picker (Phase F / Phase 9 above) a deeper fork than the other phases. Stroke width / rotation / echoes / new modes all live inside `butterchurn.js` directly.

### Phase A — Fork setup (foundation, no feature)

**Goal:** prove the swap works end-to-end with zero feature change.

**Concrete steps:**
1. `mkdir -p src/vendor`
2. `cp node_modules/butterchurn/lib/butterchurn.js src/vendor/butterchurn.js`
3. Edit [src/visualizer.js:5](src/visualizer.js#L5): change `from 'butterchurn'` → `from './vendor/butterchurn.js'`
4. `npm run build` — confirm bundling works.
5. Manual test: open editor + main app, load 10 random presets across packs (Base, Extra, Baron), verify visuals identical.
6. Keep the npm `butterchurn` package installed so `node_modules/` has the original for diffing future upstream updates.
7. Add a comment at the top of `src/vendor/butterchurn.js` noting: source commit, the upstream package version, "DO NOT regenerate from npm — see milkdrop-dev.md for patch list."

**Risk:** Vite has to bundle a 6,738-line module instead of tree-shaking from `node_modules`. Bundle size will grow noticeably (~200 kB minified). Acceptable.

**Estimated effort:** ~1 hour including manual smoke testing.

**Done = all current functionality works, build size grows, no regressions.**

---

### Phase B — Variable wave stroke width

**Goal:** replace the binary Thickness toggle with a real 0.5–8 px slider.

**Current engine behavior** ([node_modules/butterchurn/lib/butterchurn.js:5895-5925](node_modules/butterchurn/lib/butterchurn.js#L5895-L5925)):
```js
if (mdVSFrame.wave_thick !== 0 || mdVSFrame.wave_dots !== 0) {
    instances = 4;
}
// Then renders 4 instances at hard-coded var offset = 2;
// (offset is in pixels, applied to texsizeX/Y)
```
Thickness is faked by drawing the same line 4 times at a fixed 2-pixel diagonal offset. No native width.

**Engine patch:**
```js
// Read new param with default fallback
var thickness = mdVSFrame.wave_thickness || (mdVSFrame.wave_thick ? 2 : 1);
// Number of passes scales with thickness for smooth thick lines
instances = thickness > 1 ? Math.min(8, Math.ceil(thickness * 2)) : 1;
// Offset between passes scales too
var offset = thickness;
// Spread the existing 4-direction offset pattern across N instances
```

Touch points: ~10 lines around L5898–L5925 in `drawBasicWaveform`.

**App-side changes:**
- Add `wave_thickness: 2` to `BLANK.baseVals` in [src/editor/inspector.js](src/editor/inspector.js#L159).
- Replace the Thickness toggle row in `_buildWaveSliders` with a slider config. Existing toggle binding code in [editor/inspector.js around L1019-L1037](src/editor/inspector.js#L1019-L1037) gets deleted.
- Remove the `<input id="toggle-thick">` markup the toggle inserts.
- Backwards compat: old presets with `wave_thick: 0|1` should map to `wave_thickness: 1|2` on load. Add a one-line normalizer in `loadPresetData`.

**Estimated effort:** 1–2 hours including manual testing.

**Done = slider drags smoothly from hairline to bold, old presets still look right, save/reload preserves value.**

---

### Phase C — Wave rotation

**Goal:** rotate the active wave shape around its own center.

**Current engine behavior:** each shape mode (0–7) computes its own angles inline in [`generateWaveform`](node_modules/butterchurn/lib/butterchurn.js#L5430). E.g. mode 0 (Center): `ang = i * numVertInv * 2 * Math.PI + time * 0.2`. There is no global rotation step.

**Engine patch:** add a single rotation pass at the END of the if/else chain that fills `positions[]`, before the buffer is uploaded to GL:
```js
// After all shape modes have written positions[i*3+0/1]:
var waveRot = mdVSFrame.wave_rot || 0;
if (waveRot !== 0) {
    var cos_r = Math.cos(waveRot), sin_r = Math.sin(waveRot);
    var cx = wavePosX, cy = wavePosY;
    for (var i = 0; i < numVert; i++) {
        var x = positions[i*3+0] - cx;
        var y = positions[i*3+1] - cy;
        positions[i*3+0] = x * cos_r - y * sin_r + cx;
        positions[i*3+1] = x * sin_r + y * cos_r + cy;
    }
}
```
~15 lines, single insertion point.

**App-side changes:**
- Add `wave_rot: 0` to `BLANK.baseVals` (radians, range -π to π, or expose as degrees in UI and convert).
- Add Rotation slider to `_buildWaveSliders` configs (0–360°, default 0). Store in degrees, convert at write.
- Backwards compat: no normalizer needed (missing field defaults to 0).

**Estimated effort:** 2–3 hours.

**Done = rotation slider rotates every shape mode (test all 8) cleanly around its own anchor.**

---

### Phase D — Wave echoes (count + color mode)

**Goal:** render the wave shape 2/3/4 times per frame, each iteration optionally cycling colors.

**Current engine behavior:** `drawBasicWaveform` runs once per frame. The vertex buffer is built by `generateWaveform`, then drawn once (or 4× via the thickness instance hack).

**Engine patch approach:** wrap the `drawBasicWaveform` call in an outer loop. Each iteration adjusts `mdVSFrame.wave_x`, `wave_y`, and `wave_r/g/b` before calling the existing render path. This is the cleanest pattern — touches fewer engine internals than modifying the render loop directly.

**Decisions:**
- **Echo arrangement**: radial (each echo rotated by 360°/N) vs. concentric (each echo at a different scale). Radial gives kaleidoscope feel; concentric gives ripple feel. Suggest **radial as default**, expose a "spread" param later if needed.
- **Color cycling**: 'same' = all echoes use wave_r/g/b (no change). 'cycle' = echo 0 uses wave_r/g/b, echo 1 uses ob_r/g/b (glow), echo 2 uses ib_r/g/b (accent), echo 3 cycles back.

**App-side state:**
- `wave_echoes: 1` baseVal (count, 1–4).
- `wave_echo_color_mode: 'same'` baseVal (`'same' | 'cycle'`).
- Backwards compat OK.

**UI** (Wave tab, near Shape grid):
- Echoes segmented (1 / 2 / 3 / 4).
- Color mode segmented (Same / Cycle) — disabled when echoes = 1.

**Estimated effort:** 4–6 hours including testing across all shape modes.

**Done = picking Echoes=3 renders 3 rotated copies of any shape; Cycle picks color from wave/glow/accent per pass.**

---

### Phase E — More wave shape modes

**Goal:** extend the engine's 8 builtin shapes (Center / Lines / Sides / Pulse / Star / Dots / Radial / Ripple) with new ones.

**Current engine constraint:** `var newWaveMode = Math.floor(mdVSFrame.wave_mode) % 8;` at [butterchurn.js:5437](node_modules/butterchurn/lib/butterchurn.js#L5437). The `% 8` mask must be lifted (e.g. `% 16` if we add 8 more).

**Per new mode**: add an `else if (waveMode === N)` branch with a `positions[]` writer (~30–50 lines each based on existing patterns).

**Candidate modes (start with 2–3):**
- **8 — Polygon** (configurable side count via wave_mystery): N straight sides forming an N-gon.
- **9 — Lissajous** (figure-8 / clover): `x = sin(a*t)`, `y = sin(b*t)` with a,b ratio set by wave_mystery.
- **10 — Spiral** (logarithmic): radius grows with i, angle wraps multiple times.
- **11 — Particle burst**: radial scatter, density audio-reactive.
- **12 — Hexagons**: lattice of hex outlines.

**App-side changes per mode:**
- Extend `WAVE_MODES` array in `inspector.js` with `{ mode, label, icon }`.
- Each icon is an SVG snippet (~3 paths). Re-use the existing pattern.

**Estimated effort:** 2–4 hours per mode, parallelizable. Recommend shipping 2–3 in the first pass, see what users gravitate toward, add more later.

**Done = new shape buttons render new patterns; old modes unaffected; preset save/load round-trips new wave_mode values.**

---

### Stop-and-evaluate gate

After **Phase B ships**: pause and ask the user whether to continue. Reasons to stop:
- Bundle size growth is noticeable (~200 kB) — may matter for web deploy.
- Maintaining a 6,738-line vendor file becomes a real obligation.
- The two-feature win (stroke width) might already feel like enough.

Reasons to keep going:
- Each subsequent phase has a clear, isolated patch; risk doesn't compound.
- Wave rotation + echoes together transform the Wave tab into a real generative-art surface.

---

## GLSL future work (Phase 9 — Warp shape picker)

**Documented here for completeness, NOT scheduled.** Shader work is a different skill — record this so it's not lost if we ever revisit.

### What it would unlock
Currently butterchurn ships ONE warp shader compiled at engine init. Switching warp variants per preset (radial / horizontal stripes / spiral / tunnel / ripple-zoom) would be a massive expressive jump — most "named" MilkDrop looks are defined by their warp character.

### Where the code lives
- [node_modules/butterchurn/lib/butterchurn.js:2321](node_modules/butterchurn/lib/butterchurn.js#L2321): `this.warpShader = new _shaders_warp__WEBPACK_IMPORTED_MODULE_9__["default"](...)` — the warp shader is a SEPARATE webpacked submodule.
- To fork the warp picker we'd need to either:
  - **Option A**: also vendor the warp shader source files (find them in `node_modules/butterchurn/src/shaders/warp/` if present; otherwise reverse-engineer from the bundled output).
  - **Option B**: extend our forked `butterchurn.js` to override `this.warpShader.updateShader(warpText)` with our own GLSL strings per variant.

### Implementation sketch (Option B, lighter touch)
1. Maintain a small dictionary `WARP_VARIANTS = { radial: '...glsl...', stripes: '...', spiral: '...' }` in our vendor copy.
2. Add `warp_variant: 'default'` to baseVals.
3. On preset load, if `warp_variant` is set, call `this.warpShader.updateShader(WARP_VARIANTS[variant])` after engine init.
4. UI: variant picker in Motion tab (4–6 chips like Motion Presets).

### Why it's deferred
- Writing/sourcing 4 working GLSL warp shaders is real shader engineering. Each variant must respect butterchurn's uniform conventions (`uv`, `time`, `bass`, `warp`, etc.).
- The existing shader uses some preset-time variables (`q1`..`q32`) that variants would need to read or ignore consistently.
- Risk: breaking the existing warp behavior would break every shipping preset. Needs extensive cross-preset regression testing.

### Pre-work if you want to scope this further
- Look at MilkDrop classic's `warp_2.frag` source for canonical variants.
- Look at projectM (another MilkDrop port) for shader source.
- Search butterchurn issues/PRs for any prior discussion of warp variants.

---

## Shipped notes (detail per phase)

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

## Backlog (no fork needed)

- **Extend per-slider source override to the Motion-react panel.** Same pattern shipped on wave-react; mechanical to extend once the wave-tab UX is validated.
- **Per-wave trail length.** A separate decay on the wave channel so wave trails can be long without the whole frame smearing. Doable via post-render shader or by injecting a wave-specific alpha cap.
- **Pinned multiple My Mixes.** Today's single slot is intentional. If users want a row of saved chips, generalize the storage key to an array and render N saved chips.
- **Reset palette section.** Motion + Wave tabs have a ↺ Reset button; Palette doesn't. Could ship "Reset palette to defaults" for symmetry.
