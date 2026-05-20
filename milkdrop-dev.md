# MilkDrop Preset Editor — Dev Notes

Status: phases 1, 3, 6, 7, 8, 10 shipped (2026-05-19 → 2026-05-20). Butterchurn fork **Phases A + B + C complete** — vendored copy live + ESM bridge wired + variable wave stroke width + wave rotation. **Remix Family RX-1 + RX-2 shipped** (2026-05-20) — Material-Symbols icon footer + one-click 🎲 Random from 1,144 bundled presets. **Next up: Phase D (wave echoes).** Phase 9 (warp picker) remains deferred.

Last updated: 2026-05-20

---

## 🎯 Pick up here

**If you're opening this doc to resume work, this is the only block you need to read.**

### ✅ Recently shipped
- **Palette** — bug fix (no forced borders), Glow/Accent Strength sliders, hover-preview chips, per-channel 🔓/🔒 locks, "+ Save current mix" slot.
- **Motion** — 6-preset grid (Vortex / Calm Drift / Earthquake / Tunnel In / Spin Lock / Hyperspace) + ↺ Reset.
- **Wave** — Reactivity panel, Shape Reset, conditional active highlight, **Thickness slider 0–8 (fork Phase B)**, **Rotation slider ±180° (fork Phase C)**.
- **Footer** — ✨ Surprise rolls a coherent random combo (will be renamed `Remix` in RX-1).
- **Universal** — double-click any slider label → reset to default.

### 🎯 Next: Phase D — Wave echoes

Remix Family is fully shipped (RX-1 icon footer + RX-2 random bundled preset). Footer is 5 Material-Symbols icon buttons: `add` (New), `casino` (Random), `shuffle` (Remix), `save` (Save), `restart_alt` (Reset). 🎲 picks a random name from the 1,144 bundled presets (excluding the current one), confirms-if-dirty, calls `inspector.loadBundledPreset()`, toasts the rolled preset name. Discovery aesthetic preserved — no gray-out / hint banners.

**Next:** Phase D — wave echoes. Render the wave shape 2/3/4 times per frame in a radial arrangement with optional color cycling. Render-loop wrap; bigger patch (~half day). Full plan in §"Butterchurn fork plan → Phase D" below.

### 📋 Backlog (no fork needed)
- **Layer randomization on Remix** — Remix today only re-rolls palette/motion/wave; could also nudge per-layer effects (hue rotate, saturation, mirror toggle, one random VJ effect with subtle params). Pushed later. Safe-vs-unsafe field list in §"Remix Family plan".
- Per-slider source override on the Motion-react panel (mechanical extension of the wave-tab Phase 8 pattern).
- Pinned multiple My Mixes (today's single slot → array of N).
- Variation mix slider — only practical for same-mode pairs; revisit if there's demand.
- Reset palette section (Motion + Wave tabs have ↺ Reset; Palette doesn't).
- **Per-wave trail length** — a separate decay on the wave channel so wave trails can be long without the whole frame smearing.

### ⏸ Deferred indefinitely
- **Phase 9 — Warp shape picker.** Real GLSL work. The warp shader is a separate webpacked submodule. See §"GLSL future work" for the implementation sketch if we ever revisit.
- **Multi-shape sub-tab.** Single-wave improvements have covered the creative payoff for less surface.
- **Gray-out conflicting sliders / motion-is-preset-driven hint banner.** Filed under discovery-aesthetic — see §"Remix Family plan → Discovery aesthetic" for the reasoning. Revisit only if user feedback signals confusion.

### After Remix Family ships: back to engine fork
1. **Phase D** — wave echoes. Render-loop change. ~half day.
2. **Phase E** — more shape modes (polygon / lissajous / spiral). ~half day each.

Full per-phase audit and patch plan in §"Butterchurn fork plan" below.

---

## Phase status table

| Phase | What | State |
|---|---|---|
| Fork A | Vendor butterchurn + ESM bridge | **Shipped** 2026-05-20 |
| Fork B | Variable wave stroke width slider | **Shipped** 2026-05-20 |
| Fork C | Wave rotation slider | **Shipped** 2026-05-20 |
| 1 | Palette bug fix + Glow/Accent Strength sliders | **Shipped** |
| 2 | Wave stroke width + Rotation | **Shipped** — both fork Phase B + C |
| 3 | Wave audio reactivity (Source + Curve + FX) | **Shipped** |
| 4 | Wave Echoes (count + color mode) | **Queued** — fork Phase D |
| 5 | More wave shape modes | **Queued** — fork Phase E |
| 6 | Palette QoL (hover preview, lock channels, My Mix) | **Shipped** |
| 7 | Motion presets grid (+ Reset) | **Shipped** |
| 8 | Per-slider source override (wave-tab variant) | **Shipped** |
| 9 | Motion warp shape picker | **Deferred** — GLSL future work |
| 10 | Surprise button (renaming to Remix in RX-1) | **Shipped** — variation mix slider deferred |
| polish | Dbl-click-label reset, Wave Shape Reset, Save→Save, no redundant tooltips | **Shipped** |
| RX-1 | Icon footer layout (5 Material Symbols, instant tooltips, drop library picker, rename Surprise→Remix) | **Shipped** 2026-05-20 |
| RX-2 | Wire 🎲 Random to load random bundled preset as Studio base | **Shipped** 2026-05-20 |
| RX-future | Layer randomization on Remix · Gray-out conflicting sliders · Hint banner | **Backlog / Future maybe** — see "Remix Family plan" |

---

## Remix Family plan

### Why this is the next move
The Studio currently always starts from BLANK. Every "theme" the user sees is a permutation of 12 palettes × 6 motion presets × 8 wave modes on top of a single empty base. That feels like ~12 themes because the underlying engine config (warp shader, frame equations, comp pipeline) never changes — only the surface. The 1,144 bundled presets each ship their own warp + frame_eqs + comp shader; remixing on top of those takes the visual taxonomy from ~12 themes to ~1,144 starting points with zero engine work.

### Final design call (2026-05-20)
The conceptual model is **main player = browse/discover, Studio = edit/remix**. The Studio doesn't need its own library browser — the main player's preset drawer (P key) already does that, and the user can keystroke between player and Studio (E key). So we drop the existing `Remix` button (which opens a library picker) and replace it with one-click `Random`.

**Footer becomes 5 big icon buttons with instant tooltips** (no labels under the icons, tooltip on hover with zero delay):

```
 ＋     🎲      🎨       💾     ↺
New   Random  Remix    Save  Reset
```

| Icon | Verb | Behavior |
|---|---|---|
| ＋ | New | Blank baseline. Existing `+ New` behavior, kept verbatim. |
| 🎲 | Random | One-click. Picks a random name from the 1,144 bundled presets, loads it into the Studio as the new base. No picker, no menu — just roulette. |
| 🎨 | Remix | One-click. Re-rolls palette + motion + wave on whatever is currently loaded. **This is the existing Surprise button renamed** — same code path, clearer verb. |
| 💾 | Save | Existing Save behavior. |
| ↺ | Reset | Existing Reset behavior. |

**Why this layout works for the discovery aesthetic:** every button does one thing, one click. No dropdowns, no submenus, no "pick a category." The two leftmost set the *base* (blank or random); the middle mutates the *surface* of what's loaded; the two rightmost commit or clear. Left-to-right narrative: *get something / shake it / save or undo.*

**Dropped from the v1 ship:**
- Library browser inside Studio (the existing Remix button) — main player covers it.
- Starter packs (curated sub-list) — Random gives the same value with less surface area; if users want curation later we can add it back.
- "Motion is preset-driven" hint banner / gray-out conflicting sliders — see "Discovery aesthetic" below.

### Discovery aesthetic — what we are NOT doing

When the user remixes a bundled preset, some Studio controls (zoom / decay / echo_zoom / warp / motion vectors) won't visibly affect the output because the bundled preset's `frame_eqs` recompute those values every frame and stomp the slider. Two ways to "fix" this surfaced in design discussion; both are intentionally **not** being shipped:

1. ❌ **Hint banner** ("Motion is preset-driven on this base — try palette, wave, or layers"). Reasoning: the player already starts with random presets out of the box, so users arrive at the Studio already in a "what does this do?" mindset. A banner pre-empts discovery. Lots of sliders are already subtle in their effect; adding an "you can't tell because of X" explainer is the wrong vibe.
2. ❌ **Gray-out conflicting sliders on load.** Reasoning: same as above, plus the visual complexity of selectively disabling sliders pushes the app toward the "VJ-software-grid-of-knobs" geek aesthetic that this project is deliberately moving away from. The aim is "spin the dial, see what happens," not "carefully read which dials are connected."

**Filed as "possible future plan, low priority":** if user feedback eventually says "I was confused why zoom didn't do anything," revisit. Until then, the discovery aesthetic wins.

### What aligns and what doesn't between Studio controls and bundled presets

Studio controls write to `baseVals` (the engine's starting numeric state at frame 0). Bundled presets have `frame_eqs` (per-frame math) and `pixel_eqs` (per-pixel math) that re-derive many of those same fields every frame. So a Studio slider only "sticks" if no preset eq overwrites that field. Quick taxonomy:

| Studio control | Bundled-preset behavior |
|---|---|
| Palette (wave_r/g/b, ob_r/g/b, ib_r/g/b) | **Sticks reliably** — most bundled presets don't touch color in frame_eqs. Palette swap on any of 1,144 presets is a massive creative win. |
| Wave shape mode / Thickness / Rotation / Size / Pos | **Sticks reliably** — wave geometry is baseVals-driven, rarely scripted in frame_eqs. |
| Glow / Accent borders (ob_*, ib_*) | **Sticks reliably** — border state is almost never re-derived per frame. |
| Saturation / Hue Rotate | **Sticks reliably** — `studio_*`-prefixed, lives in the comp shader, separate path. |
| Invert / Darken / Brighten / Solarize toggles | **Sticks reliably** — boolean comp-shader gates, no frame_eqs override. |
| Zoom / Decay / Echo zoom / Warp / Rot / Motion vectors | **Often dead** — bundled `frame_eqs` recompute these every frame and stomp the slider in 16ms. Most "named" presets get their character from exactly these equations. |
| Wave Reactivity panel, Motion Reactivity panel | **Often dead on bundled** — bundled presets already have their own audio mapping baked into frame_eqs. |
| Image layers / Canvas Mirror / VJ Effects | **Sticks reliably** — separate pipeline, runs after butterchurn renders. |

**User-facing implication:** when remixing a bundled preset, palette + wave + borders + image layers give the most reliable creative leverage. Motion sliders may feel cosmetic. This is acknowledged and accepted per the discovery aesthetic.

### Phase RX-1 — Icon footer layout ✅ Shipped 2026-05-20

**Goal:** convert all five footer buttons to big icon-only buttons with instant tooltips. Drop the existing "Remix" (library picker) button entirely. Rename `btn-surprise` to function as "Remix" (label/tooltip change, same wiring). Add a placeholder `btn-random` icon that is non-functional in this phase — just renders so we can verify spacing/styling before wiring it in RX-2.

Touch points:
- [editor.html:559-569](editor.html#L559-L569) — replace the 5 footer buttons with the new icon set. The `btn-browse-library` element gets deleted. `btn-surprise` keeps its id but its tooltip changes to "Remix — re-roll palette + motion + wave". A new `btn-random` icon button is added.
- [src/editor/main.js:430-431](src/editor/main.js#L430-L431) — delete the `btn-browse-library` listener since the element is gone.
- [src/editor/style.css](src/editor/style.css) — adjust `.reset-btn--icon` (or add a new `.footer-icon` class) so all five footer buttons render at ~44–48px square. Confirm the existing `data-tooltip` system supports zero-delay (may need a CSS tweak).

**Open questions before code:**
- What icon for Remix? Options: 🎨 (paintbrush palette), 🌀 (swirl — implies mutation), 🎭 (mask — implies variation). Lean toward 🎨.
- Save icon: 💾 (floppy — clear) or 📥 (download — modern but ambiguous)?
- Does the existing `data-tooltip` CSS render instantly, or is there a hover delay?

**Estimated effort:** 2 hours including icon selection and tooltip-delay verification.

**Done = footer renders with 5 icons in a clean row, every button shows a tooltip on hover with zero delay, all existing behaviors (+ New / Remix / Save / Reset) work, Random button renders but is inert.**

### Phase RX-2 — Wire 🎲 Random to load random bundled preset ✅ Shipped 2026-05-20

**Goal:** clicking 🎲 picks a random name from `presetRegistry.getBundledNames()` and loads it into the Studio as the new base. One click, no confirmation modal (unless there's a dirty-state).

**Open questions to resolve in the planning step before code:**
- Does `presetRegistry.getByName()` return a preset object the Studio's `loadPresetData()` can consume directly, or is there a shape mismatch between bundled-preset format (`shapes`/`waves`/`warp`/`comp`/`init_eqs`/`frame_eqs`/`pixel_eqs` + `baseVals`) and Studio's saved format (`baseVals` + `images` + a few extras)?
- If there's a mismatch: do we adapt the loader, or write a translator that strips bundled presets to a Studio-compatible subset?
- Dirty-state behavior — reuse the same `confirmDirty()` flow that `+ New` already uses.

**Estimated effort:** 3–4 hours including the shape-mismatch resolution.

**Done = clicking 🎲 loads a random bundled preset into the Studio, the editing surfaces (palette/wave/etc.) wrap around it correctly, dirty-state is respected, no console errors across 20+ random clicks.**

### Stop-and-evaluate gate

After **Phase RX-2 ships**: pause and confirm the random-bundled loader actually delivers the "1,144 starting points" experience without surfacing weird presets (engine errors, completely black outputs, presets with custom shaders that crash the Studio). If yes → call the Remix Family v1 done. If no → fix failure modes before any further work in this area.

### Future maybe — layer randomization on Remix

Today's Remix (post-RX-1) re-rolls palette/motion/wave on the current state but doesn't touch image/video/text layers. A future expansion could nudge per-layer effects too:

**Suggested safe set per layer** (preserves user content, adds visual variety):
- Hue rotate (random 0–360°)
- Saturation (random 0.7–1.5)
- Canvas Mirror / per-tile mirror toggle (30% chance)
- One random VJ effect (chromatic aberration / scan lines / film grain / pixelate / threshold) with subtle params
- Tile mode: if already tiling, nudge cols/rows by ±1

**Explicitly skip** (would destroy the layer):
- Position, scale, opacity, content swap
- Speed/direction (would break video sync)
- Border feather/width changes (visual noise, low payoff)

Effort: ~1–2 hours when scheduled. Pushed back from initial Remix Family v1 to keep RX-1/RX-2 scope tight.

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

### Phase B — Variable wave stroke width ✅ Shipped 2026-05-20

**Goal:** replace the binary Thickness toggle with a real 0–8 slider.

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

### Phase C — Wave rotation ✅ Shipped 2026-05-20

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

### Fork Phase A — Vendor + ESM bridge (2026-05-20)
Copied `node_modules/butterchurn/lib/butterchurn.js` (6,738 lines, v2.6.7) to [src/vendor/butterchurn.js](src/vendor/butterchurn.js). Prepended a header comment block + appended an **ESM bridge** at the bottom. Updated [src/visualizer.js](src/visualizer.js) to import from `./vendor/butterchurn.js` instead of `'butterchurn'`.

**The gotcha (don't repeat):** the upstream file is a UMD bundle (CJS/AMD/global, no ESM exports). Vite handles UMD inside `node_modules` automatically via its CJS interop, but **not for local files** — local files are treated as ESM by default. The first swap attempt failed at runtime with *"The requested module … does not provide an export named 'default'"*. The fix is the ESM bridge appended to the file:

```js
// At the very end of src/vendor/butterchurn.js:
export default window.butterchurn;
```

This works because the UMD wrapper's `else root["butterchurn"] = factory()` branch fires when neither `module.exports`, `define.amd`, nor `exports` is available (true in browser ESM), assigning to `window.butterchurn`. The subsequent `export default` re-exports that. The `// sourceMappingURL` line was also stripped to silence a "missing map file" warning in the dev console (we didn't vendor the `.js.map` file).

**Build warnings to ignore**: `COMMONJS_VARIABLE_IN_ESM` at L21 (`module.exports = factory();`) and L25 (`exports["butterchurn"] = factory();`). These flag CJS-style code inside an ESM file. Both branches are dead code at runtime in a browser ESM context (the `typeof exports === 'object'` guards short-circuit), so the warnings are noise.

**Bundle impact**: zero so far (vendored content is bit-identical to npm). Will grow with each patch we add.

### Fork Phase B — Variable wave stroke width (2026-05-20)
Replaced the binary Thickness toggle (`wave_thick: 0|1`) with a continuous Thickness slider driving new field `wave_thickness` (range 0–8, step 0.5, default 0). Slider sits between Opacity and Smoothing in the Wave-tab Style sliders, so it inherits double-click-label-to-reset for free via `makeSlider()`.

**Engine patch** ([src/vendor/butterchurn.js](src/vendor/butterchurn.js)):
- New `mdVS` default `wave_thickness: 0` at ~L6553.
- New `mixedFrame.wave_thickness = mix < snapPoint ? prev : curr` line in the preset-blend mixer (~L3029) — snap-at-midpoint, matching `wave_thick`'s behavior. Linear-mixing the field would have produced an odd "growing line" effect during 8-second crossfades; snap is cleaner.
- In `drawBasicWaveform` (~L5914) and the mirrored waveMode=7 (Ripple) block (~L5952): replaced `var offset = 2;` with `var offset = thickPass ? thickness : 2;` where `thickness = wave_thickness || (wave_thick ? 2 : 0)`. The 4-instance diagonal pattern is preserved; the offset between passes is what scales now. Dots mode (`wave_dots != 0`) is preserved with offset=2 because it depends on the fixed-diagonal fake-size pattern.

**The compat fallback (the load-bearing piece):** `thickness = wave_thickness || (wave_thick ? 2 : 0)`. Legacy presets in localStorage that still have `wave_thick: 1` render with offset=2 (visually identical to before) without a normalizer pass. Resaving them through the editor naturally migrates to `wave_thickness` going forward.

**Editor patch** ([src/editor/inspector.js](src/editor/inspector.js)):
- Added `wave_thickness: 0` to `BLANK.baseVals` (L170); left `wave_thick: 0` in place for explicit legacy save fidelity.
- Three Motion Presets (Vortex, Storm, Bloom) updated from `wave_thick: 1` → `wave_thickness: 2` so they write the new field directly.
- Slider config inserted into `_buildWaveSliders` configs array between Opacity and Smoothing.
- Deleted the dynamically-injected `<input id="toggle-thick">` block (~21 lines) and its `_syncToggle('toggle-thick', 'wave_thick')` mirror in `_syncWaveControls`.
- Cleaned up the now-misleading comment in the toggles binding map.
- Randomize updated to roll continuous thickness — 50% chance of 0 (hairline), otherwise 0.5–5.0 random.

**Done check passed**: slider drags 0 → 8 smoothly, label reads back in 0.5 steps, double-click resets to 0, all 8 shape modes including Ripple honor the new width, dots mode unaffected, save+reload round-trips the value, legacy preset with `wave_thick: 1` still renders bold without resave.

### Fork Phase C — Wave rotation (2026-05-20)
Added a Rotation slider (-180° to 180°, step 1, default 0) to the Wave-tab Style sliders, below Position Y. Drives new field `wave_rot` (stored in degrees; engine converts to radians at use).

**Engine patch** ([src/vendor/butterchurn.js](src/vendor/butterchurn.js)):
- `wave_rot: 0` added to mdVS defaults (~L6555).
- `mixedFrame.wave_rot = mix * curr + mix2 * prev` linear mix in the preset-blend mixer (~L3030). Unlike `wave_thick`/`wave_thickness` (which snap at midpoint), rotation is continuous and benefits from a smooth ease through preset transitions.
- Rotation pass inserted in `generateWaveform` after the y-flip and before `smoothWave` (~L5896). Reads `wave_rot` (degrees), converts to radians, rotates `this.positions[]` around the pivot `(wavePosX, -wavePosY)` — the y-component is negated because positions are y-flipped immediately above. Mirrored block inserted for `this.positions2[]` in the Ripple-mode (waveMode=7) branch.

**Why pivot after the y-flip, not before:** the y-flip is a coordinate-system fix-up baked into the engine — every shape mode writes positions in a "normal" math-y-up frame, then the flip flips them to screen-y-down for GL. If rotation happened before the flip, the resulting visual direction would feel inverted (positive angles rotate the wrong way). Doing it after the flip means a positive `wave_rot` produces a visually clockwise rotation, which is what every user intuitively expects.

**Editor patch** ([src/editor/inspector.js](src/editor/inspector.js)):
- `wave_rot: 0` added to `BLANK.baseVals` next to `wave_thickness`.
- Rotation slider config appended to `_buildWaveSliders` after Position Y.
- `_syncWaveControls` map gets `['ws-rot', 'wave_rot', -180, 180]`.
- Randomize rolls 50/50 between 0 and a random angle in [-180, 180].

**Backwards compat:** none needed. Old presets load through `BLANK` overlay; missing `wave_rot` defaults to 0 (no rotation), engine reads 0 and skips the rotation pass entirely.

**Done check passed**: slider drags -180 → 180 smoothly, double-click resets to 0, all 8 shape modes rotate including Ripple's second strip, off-center waves (wave_x/y ≠ 0.5) pivot around their anchor rather than canvas center, `wave_thickness > 0` rotates with the wave (no shear), preset cross-fade eases the angle smoothly.

### Remix Family RX-1 — Material-Symbols icon footer (2026-05-20)
Replaced the five-pill footer (Remix / + New / ✨ Surprise / Save / Reset) with five equal-weight icon buttons rendered via Material Symbols Outlined (Google Fonts). Order: `add` (New) · `casino` (Random) · `shuffle` (Remix) · `save` (Save) · `restart_alt` (Reset). Tooltips are single words ("New", "Random", "Remix", "Save", "Reset") positioned above each button via `tooltip-up` and explicitly centered via a `.panel-footer` selector that overrides the global `.editor-panel [data-tooltip]::after` left-align rule.

**Design iterations during the ship:**
1. **First pass used color emojis (＋/🎲/🎨/💾/↺)** — visually inconsistent (mix of monochrome glyphs and color emojis), and Save retained a white-pill primary-CTA treatment that felt unbalanced against four ghost-pill peers. Both rejected.
2. **Second pass** swapped emojis for Material Symbols, killed the Save white-pill (Save now visually equal to the other four — discovery aesthetic prefers equality over CTA emphasis), added `outline: none` on `:focus` with a proper `:focus-visible` ring (keyboard-only focus indicator so mouse clicks don't leave a halo), and shortened tooltips from sentences to single words so they fit centered above each ~57px button without extending past the panel edge.

**Footer height bumped** `--foot-h: 48px` → `58px` to accommodate 42px buttons + 8px vertical padding.

**Dormant code intentionally preserved:** the Remix Picker modal (`_rpOpen` / `_rpRender` / `_rpSelect` etc. in main.js, `.remix-picker-*` CSS, modal markup in editor.html) is still in the file but unreachable — its only entry point (`btn-browse-library`) was deleted. The `_rpSelect` function calls `inspector.loadBundledPreset(name)`, which is the load mechanism RX-2 reused. The dormant picker code can be removed in a later cleanup pass; leaving it now keeps the diff small.

### Remix Family RX-2 — 🎲 Random bundled preset (2026-05-20)
Clicking 🎲 picks a random preset name from the 1,144 bundled presets and loads it into the Studio as a new base. One click; no picker UI; reuses `inspector.loadBundledPreset()` which already overlays bundled `baseVals` + `shapes` + `waves` + `warp` + `comp` + `init_eqs_str` + `frame_eqs_str` + `pixel_eqs_str` onto the Studio state and sets `parentPresetName` for save provenance.

**Implementation:** new `_loadRandomBundled()` helper in [src/editor/main.js](src/editor/main.js), parallel to `_rpSelect`. Builds the bundled-names cache via `_rpBuild()` (idempotent — reuses the same `_rpNames` cache the dormant picker built), checks `isDirty` and prompts via the existing `confirmDirty()` dialog, excludes the currently-loaded preset from the random pool so consecutive 🎲 clicks always reroll, calls `loadBundledPreset(randomName)` inside try/catch, updates the preset-name input field, clears `activePresetId`, marks dirty, toasts `Random: <name>` so the user knows what they rolled.

**Open questions from the plan, resolved during implementation:**
- Shape mismatch — none. `loadBundledPreset` already handles the bundled→Studio format gap.
- Dirty-state — reused `confirmDirty()` 1:1 from `_rpSelect`.
- Where to grab names — reused `_rpNames` cache from the dormant picker via `_rpBuild()`.

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

### Phase 10 — Surprise button
**Shipped:** `✨` icon-only button in the editor footer. Rolls random variation → random palette → random motion preset → wave-randomize, all using existing apply methods. Each step uses its own snap, so the surprise can be step-undone back to the starting state. Wired in `_bindSurpriseButton()`.

**Renamed in RX-1 (2026-05-20):** the button kept its `btn-surprise` id and wiring but its label/tooltip/aria-label all became "Remix" — clearer verb for "re-roll palette + motion + wave on the current state." The `🎨 shuffle` Material Symbol replaced the ✨ emoji.

**Deferred indefinitely:** the variation mix slider. The brainstorm imagined a 0→100% lerp between two variations, but solid-mode variations (`Solid`, `Shift`) use a different comp shader pipeline than feedback-mode variations — there's no clean midpoint between the two. A mix slider would only work for same-mode pairs, which is fragile UX.

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
| **Wave** | 8 Shape modes + **↺ Reset** (highlight conditional on `wave_a > 0`), Style sliders (Size/Opacity/**Thickness 0–8**/Smoothing/Mystery/PosX/PosY/**Rotation ±180°**), Options toggles (Dots/Additive/Brighten), **Reactivity panel (Source + Curve + 4 sliders with per-slider source pills)**, Randomize |
| **Layers** | Canvas Mirror (incl. Kaleido), up to 5 layers (image / video / GIF / text), full per-layer effect pipeline |

**Footer:** 5 Material Symbols icon buttons — `add` (New) · `casino` (🎲 Random) · `shuffle` (Remix) · `save` (Save) · `restart_alt` (Reset). Single-word tooltips above each button, instant on hover.

Every slider built via `makeSlider()` supports **double-click on the label to reset to default**.

---

Backlog and deferred items live in §"Pick up here" at the top of this doc.
