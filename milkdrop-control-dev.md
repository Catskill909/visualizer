# MilkDrop Control & Remix Convergence (dev plan)

**Status (2026-06-13): CORE ARC COMPLETE + LAYER↔PRESET INTERACTION SHIPPED (#1 Reveal, #2 Layer Remix, #3 blend modes) + REMIX↔LAYER CONVERGENCE SHIPPED (Layers lock — Remix now rolls overlay layers too).**
Lock a bundled MilkDrop preset and the **Random** button stops loading new presets — it **reinvents the locked one's
look + motion** in one press, so the 1,144 are now endlessly explorable instead of frozen. Foundation (06-07): the
editor renders the full 1,144-preset library faithfully. Overlay layers (06-08): first-class on bundled presets. Then
the whole **layer↔preset interaction** lane shipped 06-08 (#1–#3 below): the layer now *fuses* with the preset's live
light (11 blend modes + Preset Reveal), and **Random reinvents the layers too** (blend / colour / size / tiling / FX),
in BOTH locked and unlocked modes. The active thread continues — output-stage layer↔preset interaction, NOT melding in.

The original goal (achieved): *Random and Remix should feel like one discovery instrument, and a loaded MilkDrop
preset should be tweakable / remixable, not frozen.*

### ⚡ Handoff summary — what shipped in the 2026-06-08 layer↔preset session
All in `src/editor/inspector.js` (+ one wire in `src/editor/main.js`); pushed to git. **Web-tested (Vite dev,
localhost:5173 — [[feedback_test_on_web_dev_server]]); no DMG.** Verdict: user "much better… the colour blending really
stands out." See #1–#3 below for full mechanism. The crown jewel is the **blend×preset fusion**; everything else is
seasoning that must serve it (see the regression post-mortem in #2).
1. **Preset Reveal** — preset luma gates where the layer shows (`presetMask`/`presetMaskInvert`).
2. **6 new blend modes** — Lighten/Darken/Difference/Color-Dodge/Color-Burn/Hard-Light (11 total).
3. **Layer Remix** — `_rollLayerLook` / `rollLayerLooks` / `_remountLayerCards`; Random rolls every layer's whole look in
   both Random modes; final weighting favours INTERACTING blends + lower opacity + Reveal so the preset always reads
   through (the post-mortem). **Next:** fast-follows below, or #4 Preset-driven tint.

### 🎛️ Random vs Remix — how each button handles LAYERS (source of truth)
**UPDATE 2026-06-13: the two paradigms now CONVERGE on overlay layers — Remix rolls them too, gated by a Layers lock.**
The earlier "two intentionally-different paradigms, do NOT cross them" rule was reversed at the user's request: Remix
left a placed image/video/gif untouched, which felt broken next to Random. Both buttons now reinvent overlay layers.
- **RANDOM button → rolls the OVERLAY LAYERS.** On a bundled preset (locked `rollLockedPresetLook` OR unlocked
  `_loadRandomBundled`), Random reinvents each overlay layer's *compositing* look via **`_rollLayerLook`** — blend mode /
  Preset-Reveal / opacity+audio-pulse / colour / size / single↔density-tile↔grid / per-cell variance. This is the
  2026-06-08 work. **Random always uses layers.**
- **REMIX button (`_rollFullStack`) → rolls OVERLAY LAYERS *and* uses MELD.**
  - *Overlay layers (2026-06-13):* unless the **Layers** lock is set, Remix calls **`rollLayerLooks`** + `_remountLayerCards`
    on every overlay layer (same `_rollLayerLook` path Random uses). Default = rolls; lock the chip to pin a placed layer.
  - *Meld:* when a Drive image is active it also rolls the whole melt via **`_rollImageWarp`** (flow/depth/spin/mirror/
    luma-key/blend/tint — image fused INTO the warp). The layer **driving** the Meld is **excluded** from `rollLayerLooks`
    so its overlay framing doesn't fight the melt (it's rolled by `_rollImageWarp` only).
  - Remix also rolls palette/field/reactivity/motion/flow/wave/shape content as before.
- **Meld (fuse image INTO the warp) ≠ Overlay (composite image OVER via blend modes)** — still different mechanisms.
  `_rollLayerLook` now runs in BOTH Random and Remix; `_rollImageWarp` (the melt) is still Remix-only.

---

## ▶️ Layer ↔ Preset interaction — dev queue (#1–#3 SHIPPED 2026-06-08; #4 + fast-follows OPEN)

**The insight (user, 2026-06-08):** our layer **Blend modes already make the layer interact with the preset** — they
aren't flat overlays. In `_buildImageBlock` the comp shader takes `col` (the preset's live pixels) and `_src` (the
layer) and combines them every frame ([inspector.js `_buildImageBlock`, the `switch (img.blendMode)` block]):
`multiply` = preset shows *through* the layer, `additive`/`screen` = layer adds light onto the preset's swirls,
`overlay`/`normal` = mix. **This is the SAFE lane** — it happens at the **output stage**, NOT the feedback loop, which
is exactly why it works predictably on all 1,144 (and why Meld-into-bundled doesn't — see Phase 4 dropped). So the
direction is: **deepen layer↔preset interaction here**, all output-stage, all one-knob, all Remix-rollable.

**Dev queue — candidate features (recommended order):**
1. **Preset Mask / Reveal ⭐ — ✅ SHIPPED 2026-06-08.** The preset's brightness (luma) gates where the layer shows, so
   the preset's moving swirls/tunnel **wipe and reveal** your logo — the layer rides the preset's motion *visually*
   without ever touching its warp. Per-layer **Reveal** slider (0–1) + a **Dark** toggle (reveal-where-dark instead of
   bright), in the layer card's Blend row. Mechanism (`_buildImageBlock`, inspector.js): when `hasPresetMask`, emit
   `_pL = dot(col, lumaWeights)` (col = the preset+lower-layers accumulator, *before* this layer composites) → `_op *=
   mix(1.0, smoothstep(0.15, 0.85, _pM), amount)`, just before `blendLine`. Pure output-stage — no q-registers, no
   `_bundledBase` gate, works on bundled AND custom; gated so 0 = byte-identical flat overlay. New per-entry fields
   `presetMask` / `presetMaskInvert` (round-trip through `currentState.images`; own dedicated handler + on the
   slider-sweep `:not()` exclusion list). **Rolled inside `_rollLayerLook`** (#2) — current odds ~60% → 0.35–0.85, ~30%
   Dark (the initial 45% was raised by the regression fix). **Caveat:** in a multi-layer stack `col` includes lower
   layers, so layer N is masked by "preset + layers below," not the bare preset (fine for the headline single-overlay
   case). **To test live:** load a bundled preset, drop an image/logo layer, push Reveal up — the preset's bright
   regions should carve the logo; try the Dark flip and a high-contrast tunnel preset for the most dramatic wipe.
2. **LAYER REMIX ⭐⭐ — ✅ SHIPPED 2026-06-08 (full: look + size + tiling + the regression fix).** Random now reinvents the
   overlay LAYERS' whole look on every Random press (locked AND unlocked), not just the preset. *(The per-axis weights
   evolved across the session — the **CURRENT roll weighting** bullet near the end of this item is the source of truth;
   the dated sub-bullets below narrate how it got there.)* New `_rollLayerLook(img, pick, rnd)` (mutates each layer entry,
   modeled on `_rollImageWarp`), called per layer from `rollLockedPresetLook`; after the single trailing
   `_buildCompShader`+`_applyToEngine`+`_syncAllControls`, **`_remountLayerCards()`** rebuilds the cards (clear
   `#image-layers` + loop `_mountLayerCard(entry, _imageTextures[entry.texName])` — DOM-only, idempotent, doesn't
   interrupt video/GIF playback which lives in texObj) so the sliders/dropdowns show the rolled values. Rolls: blend
   (all 11 modes, present-biased), mirror (+kaleido), Reveal/Dark, opacity + **audio-reactive blend** (`opacityPulse`→
   band/curve = #2 folded in), colour (grade/hue/tint), an FX budget (≤1 present / ≤2 wild from chromatic/edge/
   posterize/pixelate/scanlines/grain/invert/solarize/wave — shuffled so they never stack to mush), beat-react (B1′),
   gentle motion. `_present` (~50%) keeps the logo readable; the rest go wild.
   - **SIZE & FRAMING variety added 2026-06-08** (user: "size is constant… Remix has more size variety… are you
     playing it safe?" — yes I was). The asset-scale lever is **`tileScaleX`/`tileScaleY`** (range **0.25–4.0**, default
     1.0, scales the asset on ALL layer types tiled-or-not; UI shows a sqrt-perceptual mapping, stored value is the real
     scale). Asset scale rolls present 0.7–1.6 / wild 0.45–2.4, ~25% independent stretch (clamped 0.25–4.0); position
     ~30% reframe (cx/cy 0.35–0.65, kept centred). Text skips framing (it sizes via its own fontSize).
   - **TILE MODE + the full fader suite added 2026-06-08** (user: "randomize single, grid and tile… so many great
     faders… push more?"). All taste-BUDGETED (≤1 present / ≤2 wild per budget) so a roll is bold but never noisy mush:
     - **Tiling mode three-way (images)** — single ↔ density-tile ↔ grid, derived from one roll value for a clean
       distribution (present ~55/30/15, wild ~30/35/35). Density rolls `size` (count) + occasional `spacing`. Grid rolls
       `tileCols`/`tileRows` (2–5 present / 1–8 wild), `tileFit`, `tileGridScale`, and occasional recursion
       (`tileSubdivide` 2–3 + `tileOuterGap`).
     - **Per-cell variance suite (tiled only, ≤1–2)** — shuffled budget over brick-offset / rotate-variance(+snap) /
       popcorn / size-variance / jitter X·Y / opacity-variance / depth-variance, + ~25% group-spin.
     - **Motion budget (≤1–2)** — orbit (circle/lissajous) / bounce / tunnel (density-tile only — a finite grid can't
       tunnel) / wander / pan-drift. Plus the standing spin + sway axes.
     - **Geometry/strobe budget (≤1)** — skew / perspective / shake / strobe.
     - Every budget CLEARS its fields first, so no effect carries stale between rolls. **Perf note:** a wild grid roll
       (recursion × variance × motion) is heavier GLSL but still ONE compile via the single rebuild; dial recursion/grid
       odds down if low-end stutters.
   - **BOTH Random modes roll the layers (2026-06-08).** New public **`rollLayerLooks(layers)`** (sets up pick/rnd,
     loops `_rollLayerLook`). Locked path = `rollLockedPresetLook` (re-mood THIS preset + roll layers); **unlocked path =
     `_loadRandomBundled` rolls the `keptLayers` snapshot BEFORE `restoreImageLayers`** (load a NEW preset + roll layers
     — restore deep-clones + mounts the rolled entries, reflected in its single rebuild; no extra remount). Uniform model
     now: **Random ALWAYS reinvents the layers; the lock only decides whether the underlying preset is held or replaced.**
   - **⚠️ REGRESSION + FIX — "blending magic buried under an opaque sprite" (2026-06-08).** After the size/tile/fader
     expansion the user (rightly, emotionally) flagged that the STUNNER — layer blending/fusing with the preset's light
     — was gone: "mostly the image just sitting on top." **Root cause (3 compounding):** (1) the blend roll defaulted to
     `normal`/`overlay`, which in this engine are PLAIN alpha-over (`mix(col,_src,_op)`) — zero fusion with the preset;
     (2) high opacity (0.75–1.0); (3) the brand-new "fill the screen" size fix → a screen-filling + plain + opaque image
     literally COVERS the preset (before, the small 0.25 default left the preset visible around it). The interacting
     modes (Screen/Additive/Color-Dodge/Difference) are the magic and were rare. **Fix (all in `_rollLayerLook`, weights
     only):** blend now favours INTERACTING modes (`normal` 7% / `overlay` 11% / rest interacting; present→soft
     light-mixers, wild→dodge/difference/burn); opacity lowered (0.6–0.95 present / 0.45–0.9 wild; `normal` forced
     0.35–0.6); Preset Reveal odds 45%→60%; a **GUARD** forces any large single image (`!tile && size>0.65`) off
     plain/opaque onto an interacting blend + Reveal so the preset always reads through; and the busy extras (image-FX,
     beat, motion, geometry, mirror) dialled back to seasoning (~half their old odds) so blend×preset×colour LEADS.
     META-LESSON: when you give a layer the power to cover the frame, the "let the preset show through" path (interacting
     blend / lower opacity / Reveal) must be the DEFAULT, or the headline interaction gets plastered over.
   - **OPEN fast-follows (next session):** (a) optional **per-layer "keep" lock** so a placed logo can opt out of the
     Random roll — the deliberate replacement for the old accidental "browse presets with a fixed layer" (now gone, since
     unlocked Random rolls layers in the uniform model). Pure addition; no mechanics change. *(The Remix-side equivalent —
     the **Layers** lock chip — shipped 2026-06-13; see below.)*
     - *(✅ DONE 2026-06-13 — REVERSED the old "don't cross them" rule: `_rollLayerLook` now ALSO runs in the Remix button,
       gated by a **Layers** lock chip. Remix used to leave overlay layers untouched, which felt broken next to Random.
       See "Random vs Remix" at the top + the Layers-lock entry below. Random and Remix now BOTH roll overlay layers.)*
   - **CURRENT roll weighting (post-regression-fix — the source of truth; the old "favour normal/overlay, framing
     gentle" plan was REVERSED, see post-mortem above):** blend `normal` 7% / `overlay` 11% / rest INTERACTING
     (`_softInteract` present, `_wildInteract` wild); opacity 0.6–0.95 present / 0.45–0.9 wild (`normal` forced 0.35–0.6);
     Reveal ~60%; mirror 18/32%; colour always-mild + ~40% recolour + ~30% tint; FX/beat/motion/geometry all dialled to
     seasoning (~10–40%); GUARD re-blends any big single image; tiling three-way + size + per-cell variance per the suite
     above. **`_present` (~50%)** still gates calm-vs-wild. Identity (`texName`/`imageId`, name, solo/mute, HD) untouched.
3. **More blend modes — ✅ SHIPPED 2026-06-08.** Added Lighten(max) / Darken(min) / Difference / Color-Dodge /
   Color-Burn / Hard-Light to the layer-blend dropdown (now 11 modes) — six standard Photoshop formulas as new `case`s
   in the `switch(img.blendMode)` GLSL of `_buildImageBlock`, each `col = mix(col, BLEND(col,_src), _op)` exactly like
   the existing modes (output-stage, cheap, no migration — `blendMode` is a free string with safe fallbacks). Done as a
   warm-up so Layer Remix (#2) launches with a wide blend-pick pool. GLSL note: uses `max(vec3,float)` /
   `step(float,vec3)` / scalar-minus-vec3 overloads (all valid GLSL ES).
4. **Preset-driven tint** — recolour the layer by the preset's colour at each pixel (layer luma × preset colour), so
   the layer is "painted" by the preset's palette as it moves. Cohesive colour, cheap.

**Maybe / needs a spike (could look bad → validate first):**
- **Output-stage displace** — sample the layer at a UV offset driven by the preset's luma gradient: looks like the
  preset distorts the layer, but it's a single output-stage sample (predictable), *distinct* from the dropped
  feedback-loop meld. Risk: can smear; spike before committing.
- **Knockout / hole** — the layer's bright shape punches a window through the preset (inverse mask).
- **Edge/contour blend** (composite only the layer's Sobel edges), **layer-as-light** (layer brightness locally
  boosts the preset's contrast/glow).

**Each candidate must clear the bar:** one obvious knob (no sub-menus, [[project_one_click_vs_pro_tools]]), dramatic
on a BROAD sample, stays output-stage (never the feedback loop / warp body), and is a new axis Remix can roll.

**Next step (next session):** #1 Reveal, #3 blend modes, **#2 LAYER REMIX all shipped & web-verified 2026-06-08**
(incl. size/tile-mode/full-fader expansion + the blend-fusion regression fix). **Remix↔layer convergence: the Layers
lock chip shipped 2026-06-13** — Remix now rolls overlay layers via `rollLayerLooks` unless the chip is locked (the
Meld-driving layer is excluded so the melt isn't double-rolled). **Pick a fast-follow:** (a) per-layer **"keep" lock**;
(b) **#4 Preset-driven tint** (last unstarted queue item); or (c) tune the roll lean from living with it.
(Random AND Remix now both roll overlay layers; `_rollImageWarp`/Meld stays Remix-only — see "Random vs Remix" up top.)
No blocking work; the queue is in a clean, handoff-ready state.

---

## What shipped — the locked-Random instrument (Phases 1–3, 2026-06-08)

**The mechanism:** lock a loaded bundled preset (`_lockedPreset` + `isPresetLocked()`), and `_loadRandomBundled`
(editor/main.js) branches to `rollLockedPresetLook()` instead of loading a new preset. The lock stays a raw bundled
base (`_bundledBase` never cleared), so only the safe lanes are touched.

- **Phase 1 — look roll.** `rollLockedPresetLook()` re-rolls the final-output "look" via the `STUDIO_POST_FX` comp
  tail: static colour grade (brightness/contrast/gamma/temp/sat/hue/colour-roll), grade reactivity (source/curve +
  which fader pulses), Scene FX (one of bloom/posterize/vignette/scanlines/grain), Club. Re-moods on `this._baseComp`
  via `injectStudioPostFx` (or `_buildCompShader` when layers are present) — warp/eqs/shapes/motion untouched.
- **Phase 2 — Speed knob.** A "Speed" slider (Motion tab, shown only when `_bundledBase`) scales the preset's OWN
  motion via top-level `currentState.motionSpeed`, applied in `_buildRuntimePreset` on the `deepClone(state)` runtime
  ONLY (non-destructive): `zoom = 1+(zoom-1)*f`, `rot = rot*f`, `warp = warp*f`. f=1 byte-identical, f=0 freezes,
  f=2 doubles. Range 0–2; dbl-click label → 1. Built by `_buildPresetSpeed`, gated/synced by `_syncPresetSpeed`.
- **Phase 3 — roll motion too.** `rollLockedPresetLook` also rolls `motionSpeed` (~75% `rnd(0.6,1.6)`, ~25% bolder
  `rnd(0.35,1.9)`, snapped to the slider's 0.05 step; never 0, capped ~1.9). One press reinvents look + motion. The
  Speed slider + engine follow each roll automatically (via `_buildRuntimePreset` + `_syncPresetSpeed`).

**Real-use verdict (user):** "magical… subtle on some, dramatic on others, colours so on point, great almost every
time." The subtle/dramatic split is the audit playing out (below): ~96% scale on motion, ~4% only re-colour.

**UI — the `🔒 Locks` panel** (the retractable `#remix-locks` `<details>`, footer untouched): a *Random · this MilkDrop
preset* section (the lock toggle, disabled when `!_bundledBase`) above a divider, then the existing *Remix · pin what
to keep* chips (drive the from-scratch Remix button — unchanged). **DECIDED: NO 5th tab** — loaded-preset controls go
in the existing tabs (the Speed knob folds into Motion). **DECIDED: variations stay LIVE** — keep doom-scrolling, no
auto-convert; Save is the keep path.

### Speed mechanism audit (2026-06-08) — why `baseVals` scaling is the lever
Bundled eqs ship pre-compiled to JS (vars `a.zoom`/`a.rot`/…). Butterchurn reseeds these per-frame vars from
`baseVals` each frame, so a `baseVals` multiply propagates UNLESS `frame_eqs` reassigns the var *absolutely* (RHS
without the var itself). Static analysis over all 1,144:
- **zoom** 82.5% scalable / 17.5% dead · **rot** 89.1% / 10.8% · **warp** 87% / 13% · **warpscale** 100% scalable.
- **Fully dead (all of zoom+rot+warp absolute):** only **3.8% (43 presets)** — the hand-coded `flexi`/`martin` family.
  Speed is a graceful no-op there (boring-not-broken).
- **Ruled out:** engine time-scale via `render({elapsedTime})` (`this.time += 1/fps`; only speeds time-oscillations,
  not per-frame feedback motion — weak/laggy). Render-engine-N×-per-frame (universal but N× GPU + needs frame-skip for
  slow-mo) — keep as a possible future "Turbo," not the default.
- **Reusable method:** the `a.<var>=` absolute-vs-relative classification is the regression/feasibility test for any
  future `baseVals` knob (Trail=decay, Warp-amount=warp/warpscale).

## Phase 4 — Meld into a bundled preset · ❌ DROPPED 2026-06-08 (deliberate)
Meld stays a **custom / Remix-preset feature only.** Meld is great on a custom preset because the editor OWNS the
motion (controllable). Handing a user image to a *random bundled preset's* warp is a grab-bag — a few would look
stunning, most would smear it to mush in a frame or two, or barely show it. That fails the dramatic-or-cut bar. A
clean feedback-buffer-seed mechanism (blend the image into `renderer.prevFrameBuffer` so the preset's own untouched
warp melts it — universal, safe-lane) is *technically feasible*, but *possible ≠ good*: per-preset output quality is
unpredictable — that's the reason to drop it, not the engineering. **Shipping UX is already right:** Meld-on-bundled
stays modal-blocked (`_bundledBase` → `_showMeldBundledModal`); the modal's "🎲 Remix into a custom preset" walks the
user to where Meld shines. (Custom-preset Meld lives in `image-texture-dev.md`, unaffected.)

---

## Design principles (non-negotiable)
1. **NO slider-stacking.** We do NOT expose MilkDrop's ~50 internal params — most do nothing dramatic, and more faders
   = the pro-tool wall we beat ([[project_one_click_vs_pro_tools]]).
2. **Dramatic-or-cut.** A control ships only if it's visibly dramatic on a BROAD sample of presets. Dud on most → cut.
3. **Remix/Random is the discovery instrument, not the faders.** Rolling to discover is addictive ("social-media
   doom-scrolling, endless variety"). Sliders nudge/lock after a roll; the dice does the exploring. **Every new control
   should primarily be a new AXIS the dice can roll.**
4. **A serves B.** Curated knobs exist so the dice has meaningful things to roll on a loaded preset — not as a control
   panel for its own sake. (Ship a knob, then let living with it reveal the next one.)
5. **Push control & dice-roll to the MAX — within two HARD ceilings:**
   - **Don't break the app (FIDELITY).** Stay in the two safe lanes (comp tail + `baseVals` scaling). Out-of-lane =
     black screens / clobbered presets. A control that must leave the lanes converts to custom first (clears
     `_bundledBase`) — it leaves the bundled world rather than corrupting it in place.
   - **Don't tax the machine (PERFORMANCE).** Cheapest lever wins: `baseVals`/uniforms ≈ free (per-frame, no
     recompile) < comp-tail re-inject = a shader recompile (DISCRETE actions only, never per-frame) < warp replace /
     engine reload = expensive (discrete only). A dice roll collapses to ONE engine reload via the `_rolling` batch
     flag ([[project_remix_batch_perf]]); every new roll axis respects it. Lemons fine; jank/recompile-storms not.

---

## 🗝️ KEYSTONE MAP — preset anatomy + what's safe to touch on a RAW bundled preset
The load-bearing reference for any control/roll on the 1,144. A butterchurn preset (`engine.presets[name]`) has these
parts; for each: what it is, whether it draws the look, how `loadBundledPreset` reconstructs it, and whether it's safe
to modulate on a raw bundled base.

| Part | What it is | Draws look? | Editor reconstruction | SAFE to modulate on a raw bundled preset? |
|------|-----------|------|----------------------|-------------------------------------------|
| **`baseVals`** (~70) | per-frame scalars: `zoom`/`rot`/`warp`/`warpscale`/`decay`/`cx`/`cy`/`echo_*`/`wave_*`/`mv_*`/`ib_*`/`ob_*`/`gammaadj`… | **Yes** — base motion, feedback, wave/motion-vector/border draw | `{ ...BLANK, ...butterchurn baseValsDefaults, ...preset }` (faithful to player) | ✅ **YES — the motion lane.** Multiplicative nudges to `zoom`/`rot`/`decay`/`warp`/`warpscale`. Gate so neutral = untouched. (This is the Speed knob.) |
| **`warp` shader** | per-pixel motion-field shader (HLSL→GLSL) | Yes (when non-empty) | preserved verbatim; only replaced when the editor TAKES OVER (Flow style / image-warp / Remix) | ⚠️ Not directly. Replacing it = leaving the bundled world. (Meld would clobber it → dropped.) |
| **`comp` shader** | per-pixel final-composite shader (HLSL→GLSL) | Yes (when non-empty) | preserved as `this._baseComp`; editor APPENDS its `STUDIO_POST_FX` block at the **tail** via `injectStudioPostFx(_baseComp, gradeOpts)` | ✅ **The TAIL is the safe lane.** Colour/grade/Scene-FX/Club/glow/accent + **overlay-layer compositing/blend** append here and re-mood ANY preset. The shader BODY stays untouched. |
| **`shapes[0..3]`** | up to 4 custom shapes (own `baseVals` + eqs) | Sometimes (the WHOLE look for some) | kept (`deepClone`); `_buildRuntimePreset` packs **editor shapes first, then bundled** into the 4 engine slots | ⚠️ Leave bundled shapes alone; the editor adds its OWN (never starves them). |
| **`waves[0..3]`** | custom waveforms (own `baseVals` + point eqs) | Sometimes | kept (`deepClone`) | ⚠️ Leave alone. |
| **`init/frame/pixel_eqs`** | the preset's physics + **the code that loads `q1`–`q32`** for its shaders | **Yes** — drives motion AND feeds the shaders | preserved; editor normally APPENDS motion/react/wave/flux/anim lines — **GATED OFF when `_bundledBase`** | 🚫 **NEVER append to a bundled preset's eqs.** That's the q-clobber. |
| **`q1`–`q32`** | shared per-frame scratch registers the preset uses to pass values into its warp/comp/shape shaders | indirectly (shader inputs) | editor WRITES `q1`–`q25` (layer anim) + `q31` (flux) in `frame_eqs` AND READS `q1`–`q25` in the layer comp GLSL (`_buildImageBlock`) — **both gated on `!_bundledBase`** | 🚫 **OFF-LIMITS on a bundled base — write AND read.** Bidirectional collision: don't write any `q` the preset reads, and don't read any `q` the preset writes (emit neutral literals instead). |

### The TWO safe lanes (everything a bundled-preset control or dice-roll may use)
1. **Output stage — the comp TAIL (`STUDIO_POST_FX`).** Re-moods ANY of the 1,144 without touching their shader:
   Brightness/Contrast/Gamma/Temperature/Saturation/Hue-Rotate/Colour-Roll + their audio reactivity + Scene FX +
   Club/Dark-Mode + Glow/Accent — **and overlay-layer compositing/blend** (the ▶️ NEXT brainstorm lives here).
   *Already reaches any preset; don't rebuild.*
2. **`baseVals` scaling — motion/feedback.** Multiplicative nudges to `zoom`/`rot`/`decay`/`warp`/`warpscale` the
   preset already owns (the Speed knob; also a dice-roll axis). Audit per-pattern safety first (some presets drive
   these in `frame_eqs`, which wins over `baseVals` — see the Speed audit).

**Anything outside these two lanes (warp/comp body, shapes/waves, eqs, q-registers) is OFF-LIMITS on a raw bundled
preset** — touching it produced every black-screen bug. Crossing the line = "leaving the bundled world"
(Remix-to-custom / Flow style / Meld) and must clear `_bundledBase` first.

### Gotchas
- **`_bundledBase` is the master switch.** Set in `loadBundledPreset`; cleared when the editor takes over the warp
  (Flow/Remix) or on reset/load. Gates: Meld-block modal, the eq/q injection (WRITE), the layer comp q-reads
  (`_buildImageBlock` → neutral literals), the Speed slider's visibility, and the preset lock. **Locked-Random keeps
  it set.**
- **Any new `q`-touching layer/anim feature must be `_bundledBase`-gated on BOTH write and read.** Gating only the
  write leaves the comp reading the preset's `q` → erratic layers; gating only the read leaves `frame_eqs` clobbering
  the preset → black.
- **`flux` reactivity is unavailable on a raw bundled preset** (q31 unpopulated by design). Studio "flux" silently
  reads 0 on a bundled base — use bass/mid/treb/vol. (Returns once converted to custom.)
- **Overlay-layer re-hydration is shared, not duplicated.** `_rehydrateImageLayers(savedImages)` is the single
  per-entry re-mount path (fetch blob → build texObj → `_mountLayerCard`), used by BOTH `loadPresetData` (library
  load) and `restoreImageLayers` (Random-button persistence). Layer-load changes go there once.
- **Saved baseVals are authoritative; old saves aren't auto-migrated.** A bundled-derived preset saved before the
  06-07 fixes baked wrong `mv_a`/etc into its JSON — stays broken until re-saved. New loads are correct.
- **Regression net:** `npm run audit:editor-presets` after ANY change to the bundled-load path (mind the two audit
  caveats below).

---

## ⚠️ The q-register namespace collision (load-bearing, bidirectional)
**MilkDrop's per-frame registers `q1`–`q32` are a SHARED namespace.** A custom MilkDrop preset stores values in them
(in its `frame_eqs`/`pixel_eqs`) to pass into its OWN warp/comp/shape shaders. The editor *also* uses them — `q1`–`q25`
for image/text **layer animation** (`buildAnimFrameEqs`), `q31` for **flux**.

- **WRITE side (fixed 2026-06-07):** the editor appended its anim/flux writes to EVERY preset's `frame_eqs`,
  overwriting the preset's shader inputs → ~50 presets black. Fixed by gating the injection on `!_bundledBase`.
- **READ side (fixed 2026-06-08):** the per-layer comp GLSL in `_buildImageBlock` reads `q1`–`q25` (`opacity*q1`,
  `size*q2`, `cx+q3`, `cy+q4`, `blur+q5`) expecting the editor's neutral values — but with the write gated off on a
  bundled base, those reads picked up the PRESET's live q-values → layers jittered to the preset's motion. Fixed by
  emitting neutral literals (`1.0`/`0.0`) for those slots when `_bundledBase`.
- **General rule:** any editor feature touching a `q` register must be `_bundledBase`-gated on **both** sides.

This is the concrete mechanism behind "only the final-output tools reach a bundled preset": vary a bundled preset
ONLY via the output stage (`STUDIO_POST_FX`) + scaling its own `baseVals` — never inject q-register logic or new
`frame_eqs` physics.

---

## Bundled-preset fidelity — the "renders in player, BLACK in editor" class
**The root divide.** The **player** hands butterchurn the *raw preset object* (`visualizer.loadPreset(name)`). The
**editor** does NOT — `loadBundledPreset` *reconstructs* the preset field-by-field into `currentState`, then rebuilds
a runtime preset in `_buildRuntimePreset` and calls `loadPresetObject`. That reconstruction is the convergence seam —
anything it drops, defaults differently, reorders, or appends silently changes the look, usually → BLACK editor canvas
while the player is fine.

**META-RULE:** when a bundled preset looks wrong/black in the editor but fine in the player, the bug is almost always
the editor's reconstruction diverging from "what butterchurn would do with the raw object." Diagnose by diffing the
reconstructed runtime preset against `engine.presets[name]`, not by reading shaders.

**Headless caveat:** many presets are audio-driven AND feedback-based, so a no-audio harness shows them black in BOTH
paths, and `loadPresetObject` leaks the prior preset's feedback buffer between samples. Inject **pulsed** oscillators
(transients, for `bass_att`) into `engine.visualizerGainNode`, clear the buffer between variants, sample multiple
frames via `engine.captureNextFrame()` (take the max — animation-timing false positives).

**Library-wide audit (2026-06-07):** `scripts/audit-editor-presets.mjs` (`npm run audit:editor-presets`, needs the dev
server) renders each of the 1,144 BOTH ways under identical pulsed audio and flags editor-black-but-player-fine. Was
59 flagged (≈5%); after the q-fix, all render. **Caveats:** (1) animation-timing false positives (sample a few frames,
take the max); (2) the "both-dark" bucket (~63) is *inconclusive*, not "fine" — synthetic audio may be too weak. The
high-confidence signal is editor≈0% while player is consistently 50–100%.

---

## Bugs fixed
- **LAYERS jittered to the preset's motion — q-register READ-back (fixed 2026-06-08).** See "q-register collision"
  above (the READ side). Fix: `_buildImageBlock` bakes neutral literals (`1.0`/`0.0`) for the `q1`–`q25` slots when
  `_bundledBase`, so a layer sits STILL by default — byte-identical to a from-scratch un-animated layer. From-scratch
  presets keep the q-refs (GSAP anim pipe unaffected). Per-layer audio sliders read the `_r` envelope directly (not
  via q), so controllable reactivity is untouched. Verified: bundled comp has no `q1`–`q5` in the layer block.
- **Layers vanished on Random (persisted on Remix) — `_clearForLoad` wipe (fixed 2026-06-08).** Random →
  `loadBundledPreset` → `_clearForLoad` reset `currentState`/`#image-layers`/`_imageTextures`, destroying overlays;
  Remix (`_rollFullStack`) re-rolls in place and kept them. Fix: the Random handler snapshots `currentState.images`
  before the load (each entry carries its `imageId`/`videoId` → persisted blob), then `restoreImageLayers(snapshot)`
  re-mounts over the new preset, reusing the shared `_rehydrateImageLayers`. Scoped to the Random button.
- **~50 bundled presets BLACK — q-register injection clobber (fixed 2026-06-07).** See "q-register collision" (WRITE
  side). `_buildRuntimePreset` appended layer-anim (`q1`–`q25`) + flux (`q31`) to every preset's `frame_eqs`,
  overwriting shader inputs. Fix: gate both injections on `!this._bundledBase` (player parity — the player never
  injects for bundled). Bisected by reverting one transform at a time with the feedback buffer cleared (tunnel race
  0→87%, lattice 0→98%, Kalidescope 0→95%, Dark One 0→72%). 58/59 flagged now render (59th at 29%).
- **Sparse bundled presets BLACK — wrong baseVals defaults (fixed 2026-06-07).** `Rovastar - Space …` and other sparse
  presets omit most `baseVals` (incl. `mv_a`); their look IS the motion-vector grid. The player fills omitted fields
  from butterchurn's defaults (`mv_a` → 1); the editor used the from-scratch `BLANK` (`mv_a: 0`) → grid invisible →
  black. Fix: interpose butterchurn's own defaults in `loadBundledPreset`:
  `{ ...BLANK.baseVals, ...engine.visualizer.baseValsDefaults, ...bundled.baseVals }` — preset's own values still win,
  editor-only fields (`studio_*`) preserved, read from the pinned vendor at runtime (zero drift). Did NOT change BLANK.
- **Shape-driven bundled presets BLACK (fixed 2026-06-07).** `loadBundledPreset` did `currentState.shapes = []`,
  dropping the preset's own shapes; fatal for presets whose look IS their shapes (`phat_Phenethylamine`). Fix: keep
  them (`deepClone(bundled.shapes||[])`); they have no `.motion`/`.react` so `_isEditorShape()` is false → no cards,
  no add-limit cost. `_buildRuntimePreset` orders editor shapes FIRST into the 4 engine slots so user shapes aren't
  starved. Mirrored in the player's `refreshCustomPresets` for save parity.

## Notes
- "MilkDrop preset is loaded" detection: `this._bundledBase` (inspector.js) — set on Random/Remix-picker load,
  cleared when the editor takes over the warp (Flow/Remix) or on reset/load.
- From-scratch creation tools (the OTHER world — Motion Engine / Flow / Custom Shapes / Color Studio / Meld):
  `milkdrop-tools-dev.md`. Custom-preset Meld detail: `image-texture-dev.md`.
- One still-open question (minor): how to reliably detect "bundled base" beyond the `_bundledBase` flag if state paths
  grow. Not blocking anything today.
