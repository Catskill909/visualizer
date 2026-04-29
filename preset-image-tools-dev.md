# Preset Image Tools — Phased Dev Plan

> **Status:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ (delivered early during Phase 1 polish) · Phase 4 ✅ · Phase 5 ✅ · Phase 6 ✅ (Lissajous + Strobe + Pan + Chromatic Aberration shipped)
> Companion to [custom-preset-editor.md](custom-preset-editor.md).
> Each phase below is independently shippable. We pause after each to review before starting the next.

---

## Performance reality check (answers the "server overhead" question)

There is **zero server cost** — nginx/sirv-cli only ship static files. All rendering is WebGL on the user's GPU in their browser.

The real cost is VRAM and shader fill rate. Scaling from 2 → 5 image layers:

| Cost | Today (2) | At 5 | Notes |
|---|---|---|---|
| Texture samples / pixel | ~5 | ~11 | Modern GPUs handle 20+ easily at 1080p |
| Shader instructions | Moderate | ~2.5× | Scales linearly per layer; well under GPU budgets |
| VRAM | ~32MB worst case | ~80MB worst case | 2048² RGBA = 16MB. Fine on desktop, tight on mobile |
| IndexedDB | One-time on save | Same | Not a per-frame cost |

**Bottom line:** 5 layers is very doable on desktop/laptop. Mobile needs care (smaller texture clamp, maybe a lower cap). We'll revisit in Phase 4 once we have a live FPS readout.

---

## Phase 1 — Foundation: up to 5 layers + collapsible cards

**Goal:** lift the 2-layer cap to 5 and make the editor usable when multiple layers are present.

**In scope:**
- Raise the layer cap from 2 to 5; stack starts at 1 with an **Add layer** button (disabled at 5).
- Each layer is a self-contained card in a vertical list.
- **Collapse / expand per card** — collapsed state shows a compact header strip; expanded shows the full control set as it does today.
- **Collapse all / Expand all** buttons above the list.
- **Layer count indicator** ("Layers: 3 / 5").
- Collapsed state persists in `currentState` so it survives save/reload.
- Empty layer slots generate zero shader code — no cost for unused layers.
- **Image resizer on upload** (see below).
- **Dev overhead monitor** (see below) — visible throughout the phase so we gather real cost data as the feature lands.

### Recommended UX: Smart Accordion (with override)

You're right that both pure-expanded and pure-collapsed have problems. Recommend a **smart accordion with manual override**:

- **First layer starts expanded** by default — familiar, nothing hidden.
- **Adding a new layer auto-collapses the others and expands the new one.** This answers your "would everything shrink?" worry — no, the act of adding focuses attention on the new card, and the prior ones tuck away.
- **Manual expand still works any time.** A user can have 2, 3, or all 5 expanded if they want. We don't enforce one-at-a-time like a strict accordion.
- **Affordance that makes collapse obvious:**
  - A **chevron icon** on the right edge of the header strip that rotates on toggle.
  - The **entire header strip** is the click target (not just the chevron).
  - Clear **hover highlight** on the collapsed strip so it reads as interactive.
  - **Visual state cue** for "has content vs. empty": an empty slot shows a dashed outline + "Drop image"; a loaded layer shows a solid background. Even without a thumbnail (Phase 4), users can see which layers are populated.
- **Collapsed header contents (Phase 1):** drag-handle-placeholder · name ("Layer 1", "Layer 2"…) · delete · chevron. Thumbnail + solo/mute come in Phase 4.

Net effect: users never get surprised by a layer suddenly taking up a huge amount of panel height, and the expand affordance is always visible. Predictable but not restrictive.

### Image resizer on upload

Images bigger than the output resolution are wasted memory, so we clamp on upload. Recommendation:

| Mode | Max dimension | VRAM at 5 layers | Good for |
|---|---|---|---|
| **Standard (default)** | **1024px longest side** | ~20MB | 99% of cases |
| **HD (opt-in toggle)** | 2048px longest side | ~80MB | Full-screen non-tiled images with fine detail |
| Original (not offered) | — | Up to gigabytes | Dangerous — OOM on mobile |

Why 1024 as default:
- Butterchurn's warp feedback blurs everything anyway — fine detail is imperceptible at play time.
- When tiled (the common case), each tile is 1/16 or 1/64 of screen area. A 1024px source is already oversampled for a 4×4 tile grid on a 1080p screen.
- Both 1024 and 2048 are powers of two — ideal for GPU texture sampling and mipmaps.
- JPEG or PNG is preserved (no forced conversion) — we just resize the pixel grid.

Flow: user drops a 4000×3000px photo → we canvas-downscale to 1024×768 before creating the texture → show a brief toast "Resized 4000×3000 → 1024×768 (8.2MB → 420KB)". Original is never stored. An **HD toggle** in the layer card lets power users bump this specific layer to 2048px.

### Dev overhead monitor

Pull forward the FPS readout from Phase 4 as a dev-only monitor so we observe real cost as layers come in. Minimum:
- **Frame time** (ms, rolling average over 60 frames).
- **Texture VRAM estimate** (sum of layer `width × height × 4` bytes).
- **Active layer count**.
- **Shader rebuild time** on each edit (one-shot readout after each rebuild).

Hidden behind a keybinding (**backtick `` ` ``**) in Phase 1 — becomes a polished user-facing HUD in Phase 4. *(Originally planned as Shift+F12, but macOS F-keys need Fn and browsers eat Shift+F12. Backtick is the classic dev-overlay convention with zero OS conflict, and we skip the handler when focus is in an input so it doesn't steal typing.)*

**Out of scope (deferred):**
- Reordering the stack (Phase 2).
- Per-layer canvas mirror (Phase 3).
- Thumbnails, solo/mute, rename, live preview — full user-facing FPS HUD (Phase 4).

**Decisions (settled before Phase 1 build):**
- **Internal design: N-layer generic; UI cap at 5.** Shader builder, state array, and card renderer all walk the array; raising the cap later is a one-line change.
- **HD toggle: global "HD uploads" switch above the dropzone** (revised from per-layer). Because resize is destructive, the choice has to be made *before* upload — a per-layer switch would be meaningless after the fact. Each uploaded layer shows a small **HD** badge in its header so users can see which layers used HD. Flip the toggle between uploads to mix HD and Standard layers in one preset.
- **Resize: destructive.** The original upload is downscaled before texture creation and never stored. Saves disk and IndexedDB; we have no need for the source.

**Success criteria:**
- User can add/remove up to 5 layers without reload.
- With 5 expanded cards the panel scrolls cleanly (max-height + overflow).
- All existing 2-layer presets load unchanged.
- Uploading a 10MP photo never produces a texture larger than the configured max.
- Dev monitor shows frame time staying under ~16ms (60fps) with 5 Standard-size layers on a typical laptop.

### Phase 1 polish (landed after first user pass)

- **Brighter card background** — bumped from `--bg-3` (#111) to #1d1d1f with a stronger border. Collapsed cards stay slightly dimmer so the stack reads as "active on top, resting below." Full thumbnail-driven visual distinction comes in Phase 4.
- **Delete confirmation modal** — removed the silent-on-click delete. Now a dialog shows the filename with a red Delete button and a Cancel; backdrop click / Escape cancels, Enter confirms.
- **Dev HUD keybinding: backtick (`` ` ``)** — swapped from Shift+F12 after macOS testing (F-keys need Fn, browser eats Shift+F12). Skips the handler when focus is in an input so it doesn't steal typing.
- **Live Mirror status pill** — next to the "Mirror" label in each layer card. Shows the active mode (`Off`, `H`, `V`, `Quad`, `Kaleido`) and, when a mode is active, the scope (`H · Per Tile`, `H · Whole Image`). Makes every click self-evident — users never wonder "did that register?" and gives us a diagnostic breadcrumb if the shader ever misbehaves.
- **Per-image Mirror scope — "Per Tile" vs "Whole Image"** — delivers the core of Phase 3 early. The existing Mirror control folds *inside each tile*; users expect per-image mirror to fold the whole tiled group. Added a second segmented row that appears whenever Mirror is active: **[Per Tile] [Whole Image]**. "Whole Image" applies the fold upstream of the tile pipeline (via a new `_uvf` local in GLSL) so the entire tiled field mirrors as one unit — effectively a per-image canvas mirror, which was Phase 3's goal. Row auto-hides when Mirror is Off.
- **Diagnostic hook** — `window.__editorInspector` exposes the live EditorInspector in DevTools so we can introspect `currentState`, layer entries, and `_imageTextures` during debugging without adding logging. Harmless in production; zero bundle cost beyond one assignment.

### Deferred to Phase 2 (explicit pickup list)

These items came up during Phase 1 testing but belong in the reorder phase:
- **Drag-reorder affordance** — right now you can't grab a card; there's no handle or cursor feedback. Phase 2 adds a visible drag handle on the left edge and full drag-to-reorder behavior.
- **Trash icon** — the current `×` close icon is easy to miss; Phase 2 swaps it for a trash icon (and keeps the confirmation modal).

### What this means for Phase 3

The "per-image canvas mirror" goal is effectively met by the Mirror scope toggle (see above). **Phase 3 as originally scoped is largely delivered**, with one remaining item worth doing in a small Phase 3 pickup (not a full phase):
- **Parity with scene Canvas Mirror's control set** — scene mirror offers `None / ↔ H / ↕ V / ✦ Both`. Per-image Mirror already covers all four and adds Kaleido. No extra work required.
- **Possible future add:** a *second* independent fold inside the same layer (stacking field-scope H with tile-scope V, etc.). Parked for now — no user demand yet and the single-scope control feels sufficient.

---

## Phase 2 — Reordering + Z-order  *(shipped ✅)*

**Goal:** let users control which image renders on top, plus pick up the Phase 1 deferrals (trash icon, missing drag affordance).

**In scope:**
- **Drag handle** on the left edge of each card — 6-dot grip icon, `cursor: grab` → `grabbing` during drag, whole-handle is the drag initiator (cards are not draggable from elsewhere, so controls keep working).
- **Drag-to-reorder** using HTML5 drag-and-drop API. Dragged card gets a dim+scale treatment; a 2px accent line shows the insertion point above/below the hovered card.
- Reordering mutates `currentState.images[]` array order directly — the shader builder already walks that array in order, so **top of UI = drawn last = on top**.
- **Small index badge** (`#1/3` style) on each card so users understand what the order means; updates live on reorder / add / remove.
- **Trash icon** replaces the tiny `×` — the delete confirmation modal from Phase 1 stays wired as-is.
- **Keyboard reorder** for accessibility — `↑` / `↓` when the drag handle is focused swaps with the neighbour above/below.
- **Undo/redo** — wrap reorder in `_preSnap` / `_postSnap` so one drag = one history step.

**Decisions (settled for Phase 2 build):**
- **Handle-only drag initiator.** Setting `draggable` only while the handle is pressed means clicking a slider, colour swatch, or XY pad never accidentally starts a drag. Standard HTML5 DnD pattern.
- **Snap, don't animate.** Feels faster and matches the rest of the editor. No layout-shift animation for the reorder itself; just a CSS transition on the insertion line fade-in/out.
- **DOM move, not rebuild.** On drop we call `layers.insertBefore(sourceCard, target)` + splice the array. Keeps each card's event handlers, XY pad state, and slider positions intact. Rebuilding the card would lose all that.

**Success criteria:**
- Reordering is visible in the live canvas within one frame of drop.
- Undo/redo treats a reorder as a single history step.
- Drag handle is obvious — user immediately knows where to grab.
- Tab order still works; keyboard users can reorder without a mouse.

---

## Phase 3 — Per-image Canvas Mirror  *(delivered early during Phase 1 polish)*

**Goal:** let each image fold its own UV independently of the scene mirror.

**Status:** delivered via the Mirror scope toggle added in Phase 1 polish.
- The existing per-image Mirror control (Off/H/V/Quad/Kaleido) gained a **Per Tile / Whole Image** scope row.
- "Whole Image" folds the entire tiled field as one unit (the Phase 3 intent) — cheaper than scene mirror because it skips the base warp buffer.
- Scene-level Canvas Mirror stays untouched — both compose cleanly.

**What's left (minor, can roll into any future small pass):**
- Naming audit — "Mirror" per-image vs "Canvas Mirror" scene-level. Could rename the per-image control to "Fold" to avoid confusion with the scene mirror, if user feedback warrants it.
- No new functionality to build here.

---

## Phase 4 — Workflow quality-of-life  *(shipped ✅)*

**Goal:** make tuning 3+ layers pleasant instead of overwhelming. Make the collapsed header informative so users can identify each layer at a glance.

**In scope:**
- **Taller header** — grows enough to fit a thumbnail + name field + action buttons without squeezing.
- **Static thumbnail** (source-image preview, 48×48) in each card header. Informative whether the card is expanded or collapsed. Live-updating per-frame thumbnails are deferred — they need offscreen layer rendering, which is a bigger lift.
- **Inline name field** — editable text input (defaults to filename-without-extension, e.g. `sunset.jpg` → `sunset`). Click to edit, Enter/blur to commit, Escape to cancel.
- **Solo / Mute per layer** — as **toggle switches** (not radios). Multiple layers can be soloed together; if any layer is soloed, only soloed layers render. Mute hides a layer independently.
- **Reset this layer** — per-card ↻ button. Instant reset (no modal) since the action is undoable — `Cmd+Z` reverts.
- **Trash + HD badge** stay where they are from Phase 1/2.

**Out of scope:**
- **FPS readout polish** (red-under-30fps) — the dev HUD exists already; promoting it to a user-facing pill is a small follow-up.
- **Live per-frame thumbnails** — requires offscreen rendering of each layer, too expensive for a Phase 4 landing. Deferred as a Phase 9 "render quality" item if demand appears.
- **Thumbnail scrubbing** (hover to solo temporarily) — deferred until solo-via-button is proven. Can add as `Alt + hover` later.
- Copy-between-layers and layer "Looks" (Phase 7).

**Decisions (settled for Phase 4 build):**
- **Solo model: multi-select switches, not radio.** Confirmed with user. If any layer has `solo=true`, only soloed layers render; otherwise all non-muted layers render.
- **Solo/Mute/name persist** with the preset. They're part of the entry, so they round-trip through save/load. Feels right — a user who soloed a layer would expect that state on reload.
- **Reset scope: layer only, not images array.** Resetting a layer keeps `texName`, `imageId`, `fileName`, `hdMode`, and `name`, but restores every animation/style field to default. One click, one undoable step.

**Success criteria:**
- Can isolate any one layer in <1 second by clicking Solo.
- Collapsed cards are identifiable at a glance (thumb + name).
- Inline rename works with keyboard only (Tab → type → Enter).
- All Phase 4 actions are undoable.

### Phase 4 polish (landed after first user pass)

- **Fast tooltips** — native `title=` tooltips had the browser's default 500–1500ms delay, which felt sluggish after Phase 4's new header buttons landed. Ported the main app's `data-tooltip` + CSS `::after` pattern to the editor with an 80ms transition. Converted every button / label / segmented control / drag handle / HD badge / thumbnail across the editor panel (toolbar Undo/Redo/A/B, Images Only, HD uploads, Collapse-all, Base Variations, Palette chips, Wave modes, Mirror scope, Shrink/Group labels, XY pad, XY reset, Solo/Mute/Reset/Trash, drag handle, thumbnail filename, mini-player Play). Card overflow changed from `hidden` to `visible` so tooltips can escape the card; header got its own top border-radius so hover backgrounds still respect the rounded corners. Two leftovers remain on native `title=` because pseudo-elements don't render on `<input>` replaced elements: the name field's "Filename: …" hint and the mini-player volume slider. Both are secondary and not worth a wrapper-span refactor.

---

## Phase 5 — Per-layer audio reactivity  *(shipped ✅)*

**Goal:** unlock variety without new animation code. Right now almost everything reacts to `bass`; butterchurn exposes `mid`, `treb`, plus attenuated variants.

**In scope:**
- **Reactivity source dropdown** attached to each reactive control (Pulse, Bounce, Beat Fade, future Shake/Strobe): **Bass / Mid / Treble / Volume / Off**.
- **Beat divider** per layer: trigger every 1st / 2nd / 4th / 8th beat (detected via `bass_att` threshold crossings).
- **Reactivity curve picker** — linear / squared / cubed / thresholded. Squared matches what our main sliders already use.

**Out of scope:**
- Any new animation primitives themselves — those come in Phase 6.
- Beat divider — deferred to Phase 5b (requires CPU-side beat tracking; not achievable with baked GLSL literals).

**Decisions (settled for Phase 5 build):**
- **UI model: per-layer Reactivity panel** (not per-control dropdowns). A single collapsible "Reactivity" section at the bottom of each card groups Source + Curve. Adding a dropdown to every reactive slider would create too much noise. Per-control source can revisit in Phase 7 if demand appears.
- **Beat divider: deferred to Phase 5b.** Dividing by 2/4/8 requires a CPU-side beat counter passed as a uniform — incompatible with the current baked-literals architecture. Removing it from this phase keeps Phase 5 shippable without an audio-engine refactor.
- **reactCurve default: linear.** Existing sliders already apply a squared curve at the UI level (pos² mapping). Defaulting to linear in GLSL preserves exact backward compatibility with saved presets.
- **GLSL variable `_r`** is declared at the top of each `{}` image block (before angle/center/pipeline) so all expressions (sizeBase, bounce, opacity) can reference it uniformly.

**Success criteria:**
- A layer can be driven exclusively by treble with no bass coupling.
- All existing saved presets render identically (reactSource defaults to bass, reactCurve defaults to linear).

### Phase 5 implementation notes

- **`_r_raw`** = raw audio signal from chosen source; **`_r`** = curve-transformed signal. Both are declared at the very top of each `{}` image block, before angle/center/pipeline code, so all reactive expressions reference `_r` uniformly.
- **Backward compatibility**: `reactSource` absent → defaults to `'bass'`; `reactCurve` absent → defaults to `'linear'` (matching the pre-Phase-5 GLSL which used raw `bass` linearly). All existing saved presets render identically.
- **Curve segmented control** initialises from `entry.reactCurve` in the wiring step (not from the hardcoded `active` class in HTML), so loading a saved preset restores the correct button state.
- **Beat divider** deferred to Phase 5b — noted in Decisions above.

### Phase 5 polish — portrait image tiling (DO NOT RE-ATTEMPT failed approaches)

**Problem:** uploading a portrait image (taller than wide) produces squashed or gapped tiles because the tile cells are sized by the screen's own aspect ratio (landscape on a 16:9 monitor), not the image's aspect ratio.

**Attempt 1 — "contain" letterbox inside each tile (FAILED / REVERTED)**
- After `fract()`, remapped UV inside each tile to maintain image aspect with transparent bars on the sides.
- Result: purple/visualizer bars visible between Godzilla tiles. User rejected.

**Attempt 2 — "cover" centre-crop inside each tile (FAILED / REVERTED)**
- After `fract()`, scaled UV so the image filled the tile completely by cropping top/bottom.
- Result: image still appeared squashed because the tile cells themselves were landscape-shaped. Godzilla head visibly truncated.

**Working solution — `aspectPreScale` before `applyTileUV`**
- Pre-divide `_u.x` by `imgAsp * aspect.y` BEFORE calling `applyTileUV`.
- This makes the tiling grid cells themselves match the image's aspect ratio in screen pixels.
- Portrait image → portrait-shaped tile cells. Square image → square cells. 16:9 image on 16:9 screen → no change (formula is a no-op).
- No masking, no cropping, no letterboxing — the texture UV [0,1]×[0,1] maps exactly to the portrait cell with zero distortion.
- `imgAsp` is baked as a literal at shader build time; `aspect.y` is a runtime uniform so it adapts to window resize.

**Key insight:** you cannot fix the distortion AFTER `fract()` — that only changes what portion of the image is shown inside an already-wrong cell shape. The cell shape itself must be set correctly BEFORE tiling.

---

## Phase 6 — New animation primitives  *(shipped ✅)*

**Goal:** expand what a single layer can *do*. Ship these individually in priority order.

**Priority order (shipped):**
1. **Lissajous path** ✅ — Path toggle on the Orbit section: `Circle` | `Lissajous`. Lissajous mode reveals Freq X, Freq Y, and Phase sliders. The ratio between Freq X and Freq Y determines the figure shape (2:3 = figure-8, 3:4 = four-leaf clover, etc.). Orbit amplitude slider controls path size. Backward-compatible: `orbitMode` absent → defaults to `'circle'`.
2. **Strobe / Blink** ✅ — Strobe slider in the opacity section (below Beat Fade). Hard binary cut using `step(threshold, _r_raw)` in GLSL — reads the *raw* audio signal (pre-curve) so the trigger is absolute, not shaped. Threshold row auto-shows when Strobe > 0.
3. **Pan** ✅ — Whole-group Left/Right and Up/Down translation. Three modes: Off, Drift (continuous linear travel — endless tile scroll or logo crawl), Bounce (ping-pong around anchor with independent X/Y rates and a Range half-amplitude slider). Applies at the group anchor level, so tiled layers scroll the entire grid as one unit with seamless wrap. Composes additively with Sway, Wander, and Orbit. State: `panMode` (`'off'|'drift'|'bounce'`), `panSpeedX`, `panSpeedY` (±2 UV/sec signed), `panRange` (0–1). See [preset-image-pan-dev.md](preset-image-pan-dev.md) for full architecture notes.
4. **Chromatic Aberration** ✅ — New "Visual Effects" section between Tint and Audio Reactivity. RGB channel split with animated offset. Speed slider appears when Chromatic > 0. GLSL resamples R and B channels with offset UVs (sinusoidally animated) while keeping G from original sample. Works in all modes (tunnel, tiled, non-tiled). Entry fields: `chromaticAberration` (0-1, **squared** UI curve for responsive low-end), `chromaticSpeed` (0-4).
   - **Implementation notes:** Uses `textureGrad()` for clean edge sampling. Offset UVs are clamped to [0,1] to prevent edge streaking. In non-tiled mode, chromatic respects the `_gapMask` so effect only applies within image bounds. GLSL offset multiplier set to 0.08 for visibility at low slider values.

Difficulty key: 🟢 Low (< 1 hr, 1–2 fields + 1 slider) · 🟡 Medium (2–4 hrs, new GLSL pattern) · 🔴 High (4+ hrs, structural shader change or new pipeline stage)

Remaining candidates (pick order based on demand after first two land):
- **Independent tile X / Y scale** ✅ — **Shipped.** Two new tile-only slider rows **Width** and **Height** in each layer card, below Spacing. Range 0.25–4.0 with a squared UI curve (same feel as the Size slider). Entry fields: `tileScaleX` and `tileScaleY` (both default 1.0 → fully backward-compatible). GLSL: `aspectPreScale()` now divides `_u.x` by `imgAsp * aspect.y * tileScaleX` and optionally `_u.y` by `tileScaleY`; the Y line is omitted when `tileScaleY === 1.0` so generated shaders stay minimal. Rows auto-hide when Tile is OFF. Both sliders are excluded from the generic `sliderKeys[]` loop and wired individually (same pattern as Size, Pulse, Bounce).
- **Static Angle / Tilt** ✅ 🟢 — **Shipped.** `angle` field (degrees, −180 to +180). Inline slider row directly below Spin. GLSL: `_spinAng` expression becomes `time * sp + angleRad` when both are set, or just `angleRad` when Spin = 0 (pure tilt). `hasSpin` flag now true whenever `sp ≠ 0 || hasAngle`, so the rotation matrix always emits when either is non-zero. `perTileSpin` retains the original guard so a pure tilt on a tiled layer rotates per-tile as expected. Backward-compatible: `angle` absent → defaults to `0.00` (no-op).
- **Skew X / Y** ✅ 🟢 — **Shipped.** Two inline sliders (Skew X and Skew Y, −1 to +1) directly below Angle. Applied as a 2×2 shear matrix to `_u` in all three pipeline paths (tiled, non-tiled, tunnel) — after group spin / rotation, before `aspectPreScale` and sizing. `applySkew(varName)` helper emits only when non-zero (zero cost at default). `skewX`/`skewY` fields, both default 0.00. Makes tiles parallelogram-shaped — slanted logos, diagonal grids, italic-style strips. Composes with Angle, Width/Height to give a full 2D affine toolkit.
- **Perspective tilt** 🟡 — Simulate a card receding into distance on one axis (floor-tile or billboard lean). Implemented as a projective UV warp: divide by a depth term that varies linearly across the image. Two sliders: Perspective X and Perspective Y (how much the near/far edge scales). Visually distinct from skew — skew keeps parallel lines parallel; perspective makes them converge. Requires careful handling of the depth=0 singularity at extreme values.
- **Beat Shake / Jitter** ✅ 🟢 — **Shipped.** `shakeAmp` field (0–0.15 UV units, cubic UI curve). Slider in the audio reactivity section below Bounce. GLSL: `hash2(floor(time*24))` generates a new random unit direction 24×/sec — fast enough to always catch the beat. Direction is multiplied by `_r * shakeAmp * 2.0` so it scales with the shaped audio signal. Applied to `_u` immediately after `centerLines`, before group spin and tiling. Zero cost at default.
- **Depth Stack (Z-phase offset)** 🟡 — In tunnel mode, offset each layer's zoom phase so they feel at different depths — genuine parallax during zoom. One `depthOffset` field (0–1), added to the tunnel `fract()` phase. Tunnel-only; no-op otherwise.
- **Scatter / Radial Clone** 🔴 — Draw N copies in a ring around the anchor. Count (2–12) × Ring Radius. Each clone can spin in place. Requires looping UV sampling in the shader (unrollable but verbose) — structural change to the sample pipeline.
- **Path recording** 🔴 — Drag the anchor dot for 4 seconds, record it as a looping path the layer follows. Requires a path data structure in the preset JSON and a playback interpolator in GLSL (texture-based LUT or polynomial fit).
- ~~**Chromatic aberration**~~ ✅ **Shipped** — See Phase 6 shipped list above.
- **Edge / Sobel mode** 🟡 — Replace sampled pixel with its edge detection result. Any image → neon line art. Requires a 3×3 Sobel kernel sample (9 texture reads per pixel) — cost is real but acceptable for one layer.
- **Posterize** ✅ 🟢 — **Shipped.** `posterize` int field (0 = off, 2/4/8/16 steps). Segmented button row in Visual Effects below Chromatic — 5 buttons: Off / 2 / 4 / 8 / 16. GLSL: `floor(_src * _pn + 0.5) / _pn` applied per RGB channel after tint. Zero cost at Off. Pairs beautifully with Tint + Hue Spin for retro / pop-art looks.
- **Displacement mapping** 🔴 — Use Layer 2 as a UV displacement source for Layer 1. Rippling, heat-haze, glitch. Requires cross-layer sampling and a defined layer evaluation order — significant shader builder change.

**Open questions:**
- Some of these (Displacement, Scatter) will change the shader builder shape. Schedule those later in the phase.

---

## Onboarding — First-use tips modal

**Goal:** Replace the transient hint toast with a proper modal that gives new users a real orientation to the editor.

**Design decisions (settled):**
- Shows automatically on first editor open (localStorage flag `discocast_onboarding_seen`)
- Shows every session **until** the user clicks **"Never show again"** — so curious users who dismiss it early can still see it on the next visit
- "Never show again" sets the flag permanently; a reset link buried in settings can clear it
- Modal is dismissible via backdrop click / Escape (but does NOT set the permanent flag — only the explicit button does)

**Content (first pass):**
- **Double-click any slider label** to reset it to default
- **Drag the anchor dot** on the canvas to reposition a layer
- **Undo / Redo** — ⌘Z / ⌘⇧Z, 50-step history
- **Collapse layer cards** by clicking the header strip — keeps the panel tidy with multiple layers
- **Save** writes to your browser; open the main app → My Presets to play it back
- Link to open the full in-app Help guide

**Implementation notes:**
- Reuse the existing modal backdrop + `.save-modal` style — no new CSS infrastructure needed
- One `<div id="onboarding-modal">` in `editor.html`, hidden by default
- `showOnboarding()` exported from `inspector.js` alongside `showToast` / `showHint`
- Remove the current `showHint()` toast once this lands (it's a stopgap)

**Priority:** Medium — ship after the next 1–2 feature additions so the tips list is more complete.

---

## Phase 7 — Layer templates ("Looks")

**Goal:** build a vocabulary of reusable layer configurations.

**In scope:**
- **Copy settings to layer N** — right-click / kebab menu → copy all settings into another layer.
- **Save layer as "Look"** — persist a named layer snapshot. Dropdown in each card applies a saved Look instantly.
- **Randomize this layer** — per-card dice button (in addition to global randomize).
- **Link slider across layers** — small chain icon on a slider; clicked sliders sync their value across all layers (useful for Spin, Sway Speed, etc.).

**Open questions:**
- Are Looks global to the app or per-preset? Global is more reusable; per-preset is more contained.
- How do we handle Looks that reference an image the user doesn't have loaded? Fall through with placeholder? Skip image fields entirely?

**Success criteria:**
- Tuning 5 layers feels like composing from blocks, not dialing each one from zero.

---

## Phase 8 — New image sources (non-camera)

**Goal:** let a layer be something other than an uploaded image file.

**In scope:**
- **Text layer** — type a string; we render it to an offscreen canvas with font/size/color; that canvas becomes the texture. Updates on edit. Opens the door to beat-synced lyric reveals.
- **Procedural generator** — radial gradient, checkerboard, noise, stripes, circle. No upload needed. Great for pure-shape layers that want animation tools but no photo.
- **Canvas snapshot** — "freeze current visualizer output and use it as an image." Enables feedback loops.
- **SVG import** — render SVG to canvas, then texture. Scales cleanly, tiny file size.

**Out of scope:**
- **Webcam** — explicitly deferred (see Future ideas).

**Open questions:**
- Text layer font selection — system fonts only, or bundled web fonts? Bundling adds to the build; system fonts vary per device.
- Canvas snapshot — does it grab the current frame (still) or keep resampling live (video feedback)? Start with still; live is Phase 9+ territory.

---

## Phase 9 — Render-quality controls

**Goal:** polish layer. Not foundation.

Candidates:
- **Per-layer blur** — 3×5 gaussian tap. Pairs beautifully with additive blending for glow layers.
- **Per-layer motion blur** — blend current frame with prior frame's position at reduced alpha. Cheap trail effect independent of butterchurn's decay.
- **Per-layer color grade** — brightness / contrast / saturation after the tint stage.
- **Per-layer vignette mask** — darken edges, focus attention. Nice on center spotlight layers.

**Open questions:**
- Blur is the heaviest of these. Worth a dedicated "quality vs. performance" toggle that drops tap count?

---

## Future ideas — deferred

These are good ideas we're explicitly **not** picking up in the current phase plan:

- **Webcam layer** — `getUserMedia({video:true})` as a live texture. Powerful for live events ("AV selfie" mode), but requires:
  - Permissions-Policy change (`camera=()` → `camera=(self)` in [nginx.conf](nginx.conf)).
  - User-facing privacy prompt and clear UX around a camera indicator.
  - Decision on whether captured frames ever leave the browser (they shouldn't — but we need to say so in the UI).
  - Revisit once Phases 1–8 are solid. Not complex to build; it's a product/privacy decision, not an engineering one.
- **Layer cap beyond 5** — worth reconsidering after Phase 4 FPS telemetry shows real-world headroom.
- **Export format for large presets** — see Cross-phase open questions below.
- **AI-assisted Look suggestions** — "describe a vibe, get a layer stack." Too speculative to scope now.

---

## Cross-phase open questions

These apply across multiple phases; worth deciding once rather than re-litigating each time:

- **Mobile policy** — silently cap mobile at 3 layers, or expose a "Performance mode" switch and let users opt into 5?
- **Schema versioning** — `schemaVersion: 1` today. Moving from "fixed 2 images" to "array of up to N" is technically already supported (the schema stores `images` as an array), so we likely don't need a `v2` bump. Confirm in Phase 1.
- **Export size** — a single preset with 5 × 2048² images can serialize to 100+MB. Options: cap export resolution, strip images and re-prompt on import, or keep full-fat and accept the size. Decide before Phase 9 (new sources make this worse).
- **Undo/redo granularity** — every phase adds new controls. Confirm each lands as a single history step, not per-keystroke.
