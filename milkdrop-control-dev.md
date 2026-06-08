# MilkDrop Control & Remix Convergence (dev plan)

**Status:** PLANNING. Next step = Phase 1. Captured 2026-06-06.
**Foundation DONE (2026-06-07):** the editor now renders the full 1,144-preset bundled library faithfully —
three reconstruction bugs fixed (dropped shapes / wrong baseVals defaults / q-register clobber), audited
library-wide (`npm run audit:editor-presets`). See the **🗝️ KEYSTONE MAP** below for what's safe to touch when
dice-rolling / studio-controlling a bundled preset — that's the groundwork Phase 1 builds on.

**OVERLAY LAYERS now first-class on bundled presets (2026-06-08).** Two layer bugs fixed (see "Bugs fixed") that
together make image/video/GIF/text **overlays** a fully proven third surface on the 1,144 (alongside the comp-tail
and baseVals lanes): (1) layers now sit STILL by default on a bundled preset instead of jittering to its motion
(the q-register read-back — the *mirror* of the 06-07 clobber), and Blend modes work cleanly on bundled presets as
a result; (2) layers **persist across the Random button** the way they already did across Remix. Strategic upshot
for the phases: **Random + layers is now a discovery combo** — you can drop in a logo/clip and doom-scroll the 1,144
underneath it (reinforces Phase 1's "Random is the discovery instrument"), and the static-default + per-layer audio
sliders give the one-knob "make it react" control without touching the preset. This is also groundwork for **Phase 4
(Meld into a preset)**: overlays-over-a-preset are now solid, so the remaining Phase-4 work is the genuinely hard
part (injecting the asset INTO the preset's own warp), not the compositing around it.

## Goal (one line)
Let you **lock the current MilkDrop preset** so the **Random** button varies (remixes) THAT preset instead of
loading a new one — so the 1,144 built-in presets become endlessly explorable, instead of frozen.

## The two buttons today
- **Random** — loads a built-in **MilkDrop preset** (one of the 1,144 shipped with the app).
- **Remix** — builds a brand-new **from-scratch** preset out of our sliders/controls.

## The problem
Load a MilkDrop preset with **Random**, press **Remix** → Remix **throws the preset away** and rolls a
from-scratch one. There is no way to keep a MilkDrop preset and explore variations of *it*.

## The two worlds (why this is a real divide)
The editor today has two separate worlds, and the goal is to make them **converge**:
- **From-scratch / custom** — the editor fully owns the warp/comp/motion. Remix, Flow style, Motion engine,
  Custom shapes, and Meld all live here.
- **Bundled MilkDrop presets** — loaded as an editing *base* (the **Random** button). The editor **preserves
  their raw warp/comp/equations** (that's their look). Only the **final-output** tools reach them.

The user's call: **Random and Remix should feel like one discovery instrument**, and a loaded MilkDrop preset
should be **tweakable / remixable / meldable**, not frozen.

## The plan — 4 phases, built ONE AT A TIME (each gets its own discussion first)

### Phase 1 — LOCK a MilkDrop preset, then Random remixes IT (look only). ✅ BUILT 2026-06-08 (web-verified; not yet pushed)
**Built:** `_lockedPreset` flag + `isPresetLocked()` + `rollLockedPresetLook()` (inspector.js), Random branch in
`_loadRandomBundled` (editor/main.js), and the lock toggle in the locks panel. Locked → Random re-moods the
preset's look (static grade + grade reactivity + Scene FX + Club) via the comp-tail inject; warp/eqs/shapes/motion
baseVals stay frozen and `_bundledBase` stays set (headless-verified, 15/15). **UI realized as a two-section locks
panel** (summary "🔒 Locks"): a *Random · this MilkDrop preset* section (the lock toggle) above a divider, then the
*Remix · pin what to keep* section (the five keep-chips, unchanged). Footer stays the clean 5-button row.
The mechanism drives the **Random** button (locked = Random varies the current preset's look instead of loading a
new one). The lock **toggle lives inside the retractable `#remix-locks` `<details>` panel** — as its OWN labeled
row, visually separated from the "pin what to keep" chips — NOT as a control in the footer button row.

**Lock placement — DECIDED 2026-06-08 (supersedes the earlier "on the Random button" framing below).** The footer is
a clean, balanced 5-button row (New / Random / Remix / Save / Reset); adding a 6th control or a corner badge there
unbalances it (user's call). The retractable locks panel is the natural home for an advanced toggle. BUT the panel's
five chips (`data-lock=colours/field/motion/flow/reactivity`) control the **Remix** button (pin a group → Remix
re-rolls the rest, via `_remixLock`), whereas the preset lock controls the **Random** button (vary this preset).
Different buttons, different axis — so the preset-lock toggle goes at the TOP of the panel as its own row with a
divider, clearly NOT a sixth Remix-keep chip. It's `disabled`/greyed when `!_bundledBase` (a from-scratch preset has
nothing to lock). The five Remix-keep chips and the `_remixLock` logic stay untouched.

- **Default (unlocked):** Random = today — each press loads a brand-new MilkDrop preset. Untouched.
- **Locked:** lock the loaded MilkDrop preset → the Random button stops loading new presets and instead
  **remixes (varies) the locked one** — re-rolls only its **LOOK**: colour scheme, colour reactivity, Scene
  FX, Club. Same preset, same motion; new colours/finish each press; pulsing to the music.

**The exit:** the lock IS the on/off. Locked = Random varies this preset; unlock = Random browses fresh
presets again (also resets via New / loading a custom preset).

- **Why first:** ZERO new sliders — locked-Random just re-rolls tools that already work on any preset.
- **Where the lock lives:** a toggle row at the TOP of the retractable `#remix-locks` panel (see "Lock placement —
  DECIDED 2026-06-08" above), separated by a divider from the five Remix-keep chips so it doesn't read as a sixth
  one. The footer 5-button row stays clean/balanced. The **Remix-keep chips and `_remixLock` logic don't change** —
  the new toggle drives the Random button only.
- **Build:** add a "lock current preset" state. When locked AND a MilkDrop preset is active (`_bundledBase`),
  the Random handler rolls ONLY the final-output "look" axes on the current preset; do NOT touch warp/comp,
  do NOT load a new preset. Unlocked → `_loadRandomBundled` runs exactly as today. Respect `_rolling`.
- **Audit (2026-06-07) — exactly what to roll, and the mechanism:**
  - **ROLL (final-output, re-moods ANY preset via `STUDIO_POST_FX`):** (1) Colour adjustments —
    Brightness / Contrast / Gamma / Temperature / Saturation / Hue Rotate / Colour Roll. (2) Colour-grade
    reactivity (which adjustment pulses, band, curve). (3) Scene FX (one of Bloom/Posterize/Vignette/
    Scanlines/Grain). (4) Club / Dark Mode.
  - **DO NOT TOUCH (would clobber the preset):** `_applyVariation` (swaps in solid/shift engine),
    `_applyFlowStyle` (replaces the warp), the content roll (wave/shapes slab), the Motion engine (that's
    Phase 2 motion), and palette/Colour-Field/Shift (from-scratch solid-mode only → no-op or conflict here).
  - **Mechanism (clean, no warp touch):** `loadBundledPreset` already keeps the bundled comp in `this._baseComp`
    and does `currentState.comp = injectStudioPostFx(_baseComp, gradeOpts(state))`. So the roll = mutate the
    look axes into `currentState`, then re-run `injectStudioPostFx(this._baseComp, gradeOpts(currentState))` +
    apply. Re-moods the preset; never touches its warp or base comp.
  - **The ONE new bit of roll logic:** the current `_rollFullStack` does NOT roll the *static* colour
    adjustments (only their reactivity + Scene FX + Club). Phase 1 must ADD rolling those static grade values
    (brightness/contrast/gamma/temp/sat/hue/colour-roll) — that's the main re-mood variety. Everything else
    (Scene FX, Club, grade reactivity) is lift-and-reuse from `_rollFullStack`'s colour/reactivity blocks.
- **From here:** more Random-button actions can build on the locked-preset state.
- **Approach — treat it as a SPIKE:** live with it for a day. That tells us which Phase 2 motion knobs are
  worth adding ("A serves B" — see Design principles).
- **DECIDED: variations stay LIVE** — keep doom-scrolling; no auto-convert. The **Save** button (same footer
  row) is the save path if the user wants to keep one.

### Phase 2 — A few curated motion knobs · ✅ Speed BUILT 2026-06-08 (web-verified, 8/8)
**Built:** the **Speed** knob (Motion tab, shown only when `_bundledBase`). Top-level `currentState.motionSpeed`
(default 1, in `BLANK` → auto-resets via `_clearForLoad`, auto-persists via `saveCurrent`'s `...currentState`).
The scale is applied in `_buildRuntimePreset` on the `deepClone(state)` runtime ONLY (non-destructive):
`zoom = 1+(zoom-1)*f`, `rot = rot*f`, `warp = warp*f` — f=1 byte-identical, f=0 freezes, f=2 doubles. Slider built
by `_buildPresetSpeed` (range 0–2, dbl-click resets to 1); `_syncPresetSpeed` shows/syncs it (in `_syncAllControls`).
Headless-verified: gating, identity at 1, doubles at 2, freezes at 0, `currentState.baseVals` unmutated. **Phase 3
hook ready:** because the scale lives in `_buildRuntimePreset`, adding Speed to the locked-Random roll is a one-liner
(`currentState.motionSpeed = rnd(...)` in `rollLockedPresetLook`). Trail/Warp-amount knobs: not built (spike Speed first).

Add **2–3 dramatic** one-knob controls that *modulate the preset's own motion* (don't replace it). Candidates:
- **Speed / Motion amount** — scale the preset's `zoom`/`rot`/`warp` `baseVals` (motion AMOUNT, reads as speed).
- **Trail / Feedback** — nudge `decay`.
- **Warp amount** — scale the preset's `warp` / `warpscale`.
Each is gated so neutral = the preset untouched (safe on all 1,144), AND each is a new axis Remix can roll.
**Build Speed FIRST and alone** (dramatic-or-cut + A-serves-B); add Trail/Warp only if Speed reveals the need.
Placement: fold into the **Motion** tab, gated to show only when `_bundledBase` (no 5th tab — see DECIDED note).

**Mechanism audit — DONE 2026-06-08 (resolves the open question). Scale `baseVals` (Mechanism A) is the lever.**
Static analysis over all 1,144 (bundled eqs ship pre-compiled to JS, vars `a.zoom`/`a.rot`/…; butterchurn reseeds
these per-frame vars from `baseVals` each frame, so a `baseVals` multiply propagates UNLESS `frame_eqs` reassigns
the var *absolutely* — RHS without the var itself):
- **zoom:** 81.1% none (baseVals used) + 1.4% relative = **82.5% scalable**, 17.5% absolute-overridden (dead).
- **rot:** 89.1% scalable, 10.8% dead. **warp:** 87% scalable, 13% dead. **warpscale:** **100% scalable** (never reassigned).
- **Fully dead (ALL of zoom+rot+warp absolute):** only **3.8% (43 presets)** — the hand-coded `flexi`/`martin`
  family that computes its own motion. Speed is a graceful no-op there (boring-not-broken; acceptable).
- **Ruled out:** **Mechanism B (engine time-scale via `render({elapsedTime})`)** — engine does `this.time += 1/fps`
  and `elapsedTime` only feeds the FPS smoother, so it speeds *time-oscillations* not the per-frame feedback motion;
  weak/laggy. **Mechanism C (render engine N× per displayed frame)** — universal (catches the 43) but N× GPU + needs
  frame-skip for slow-mo; keep as a possible future "Turbo," not the default knob.
- **Speed math:** scale each var's deviation from its neutral (zoom: `1+(zoom-1)*f`; rot/warp/dx/dy: `v*f`), so f=1
  is untouched, f→0 freezes, f→2 doubles the energy. Per-frame scalar = ≈free (no recompile), safe lane #2.
- Re-run the audit method (`a.<var>=` absolute-vs-relative classification) for any other `baseVals` knob (Trail=decay,
  Warp amount=warp/warpscale) before shipping it.

### Phase 3 — locked-Random varies the preset, full · ✅ BUILT 2026-06-08 (web-verified)
With a MilkDrop preset locked, Random now varies **look (Phase 1) AND motion (Phase 2)** in one press — endless
variety in both, still keeping the preset's identity. **Built:** `rollLockedPresetLook` now also rolls
`currentState.motionSpeed` — ~75% in a tasteful band `rnd(0.6,1.6)`, ~25% bolder `rnd(0.35,1.9)`, snapped to the
slider's 0.05 step; never 0 (no dead freeze), capped ~1.9 (no nausea). The existing `_buildRuntimePreset` scale +
`_syncPresetSpeed` re-sync mean the engine and the Speed slider both follow the roll automatically. Toast now reads
"🎲 Remixed" (look + motion). Headless-verified: varies, stays in band, slider matches, baseVals non-destructive,
`_bundledBase` stays set. **NOTE (perceptual):** even before this, the look roll alone *felt* like it changed motion
— rolling grade-reactivity (which fader pulses, to which band/curve) + Club + contrast/gamma re-moods the beat-pulse
and visible energy. Phase 3 adds the *true* motion-rate change (real slow-mo / fast zoom-rot) on top.

### Phase 4 — Meld your image into a preset (bigger, later)
Inject a user image/video into the preset's **own** warp/motion so the preset processes your asset while
keeping its signature look (the "image-driven flow into any of the 1,144" idea). Unblocks the Meld-on-bundled
modal we shipped today. Non-trivial: per-preset shader injection + the sampler-header gotcha + blend tuning.
Scope after Phases 1–3 land. Detail: `image-texture-dev.md` §16.2.

## Design principles (the brainstorm — non-negotiable)
1. **NO slider-stacking.** We do NOT expose MilkDrop's ~50 internal params. Most do nothing dramatic on a
   given preset, and more faders = the pro-tool wall we beat ([[project_one_click_vs_pro_tools]]).
2. **Dramatic-or-cut.** A control ships only if it's **visibly dramatic on a BROAD sample** of presets. Test
   across packs; if it's a dud on most, cut it.
3. **Remix is the discovery instrument, not the faders.** Pressing Remix to discover is addictive — "like
   social-media doom-scrolling, the variety seems endless." Lean into that. Sliders exist to *nudge/lock*
   after a roll; Remix does the exploring. **Every new control should primarily be a new AXIS Remix can roll.**
4. **A serves B.** The curated motion knobs (Phase 2) exist so Remix (Phases 1/3) has meaningful things to roll
   on a loaded preset — not as a control panel for its own sake. That's why Phase 1 ships first and we let it
   *reveal* which knobs Phase 2 needs.
5. **Push control & dice-roll to the MAX — within two HARD ceilings: don't break the app, don't tax the machine.**
   The ambition is to tune/bend/randomize the 1,144 as far as possible. Two non-negotiable limits define "as far
   as possible":
   - **Don't break the app (FIDELITY).** Stay inside the two safe lanes (see 🗝️ KEYSTONE MAP): the output-stage
     comp tail + `baseVals` scaling. Out-of-lane = black screens / clobbered presets (every bug we just fixed).
     A control that genuinely needs to leave the lanes must first convert the preset to custom (clears
     `_bundledBase`) — i.e. it leaves the bundled world rather than corrupting it in place.
   - **Don't tax the machine (PERFORMANCE).** Respect the cost hierarchy and pick the cheapest lever that
     achieves the effect:
     - **`baseVals` / shader uniforms ≈ free** (per-frame scalars, NO recompile) → use for anything LIVE or
       continuous (sliders, smooth motion knobs, per-frame audio reactivity).
     - **comp-tail re-inject (`STUDIO_POST_FX`) = a shader recompile** → fine on a DISCRETE action (slider
       commit, dice press); NEVER per-frame.
     - **warp replace / full engine reload = expensive** → discrete only.
     - A dice roll must collapse to **ONE** engine reload via the `_rolling` batch flag
       ([[project_remix_batch_perf]]); every new roll axis respects it. Boring rolls (lemons) are fine — jank,
       recompile storms, and meltdowns are not.

## Already works on any loaded preset (incl. all 1,144) — don't rebuild
Via the `STUDIO_POST_FX` comp-tail inject — these are exactly the axes **Phase 1** re-rolls:
- Colour adjustments (Brightness / Contrast / Gamma / Temperature / Saturation / Hue Rotate / Colour Roll)
- Colour Reactivity (pulse those to Bass / Mid / Treble / Volume / Flux)
- Scene FX (Bloom / Posterize / Vignette / Scan lines / Film grain)
- Club / Dark Mode (final-output dark-room tune)
- Overlay layers (image / video / GIF / text composite over any preset) — **static by default + Blend modes + per-layer
  audio reactivity, and they persist across the Random button** (2026-06-08). A proven third surface on the 1,144.

## The gaps (what does NOT reach a bundled preset today)
- **Motion / warp / feedback** is not editor-controllable — the preset's `warp` shader, `frame_eqs`/
  `pixel_eqs`, and zoom/rot/decay/warp `baseVals` are raw and untouched. (Phase 2 modulates these.)
- **No way to vary a loaded MilkDrop preset** — Random only loads a new one; Remix only builds from-scratch.
  (Phase 1 fixes this: lock the preset, and Random remixes IT.)
- **Meld can't meld INTO a bundled preset** — it would override the warp and clobber the look. Now blocked
  with a friendly modal (shipped 2026-06-06; offers Remix to convert to a custom preset). (Phase 4 is the real
  fix — inject the texture into the preset's own warp.)

## DECIDED (2026-06-08): NO 5th tab — expose loaded-preset controls in the EXISTING tabs
The "Tune this preset" 5th-tab idea is **dropped.** Decision: keep the current tabbed interface (Palette / Motion /
Wave / Layers) as-is, and when a loaded-preset control needs a home, **expose it in the relevant existing tab**
(e.g. the Phase-2 motion knob folds into the **Motion** tab, gated to show only when `_bundledBase`). The 5th tab
was only ever floated as a place to surface settings that aren't exposed yet — but the better answer is to surface
those in the tabs we already have, not add a workflow. Revisit only if a future phase genuinely accumulates a
distinct loaded-preset workflow that the existing tabs can't hold (not anticipated).

## Open questions (settle when scoping each phase)
- Phase 1: live tweak vs convert-to-custom on first Remix?
- ~~Phase 2: which `baseVals` / eq patterns are safe to scale globally without breaking presets?~~ **RESOLVED
  2026-06-08 by the mechanism audit (see Phase 2): scale `baseVals` zoom/rot/warp/warpscale — works on ~96% of the
  1,144 (only 43 hand-coded presets are immune). time-scale and render-multiply ruled out as the primary lever.**
- ~~UX: where do the controls live — a 5th tab, or folded into existing tabs?~~ **RESOLVED 2026-06-08: folded into
  the existing tabs (no 5th tab).** See "DECIDED: NO 5th tab" above.
- How to reliably detect "bundled base" beyond the `_bundledBase` flag if state paths grow.

## Bringing bundled MilkDrop presets faithfully into the editor (the "renders in player, BLACK in editor" class)

**The root divide (read this first).** The **player** renders a bundled preset by handing butterchurn the *raw
preset object* (`visualizer.loadPreset(name)` → `visualizer.loadPreset(JSON.parse(JSON.stringify(preset)))`).
The **editor** does NOT — `loadBundledPreset` *reconstructs* the preset field-by-field into `currentState`
(baseVals / shapes / waves / warp / comp / eqs), then rebuilds a runtime preset in `_buildRuntimePreset` and
calls `loadPresetObject`. That reconstruction is the convergence seam — **anything it drops, defaults
differently, reorders, or appends silently changes the look**, and the failure mode is usually a BLACK editor
canvas while the player is fine. **Three** confirmed instances (all fixed 2026-06-07), same root cause:

1. **Dropped shapes** — `currentState.shapes = []` discarded the preset's own shapes; fatal for presets whose
   look IS their shapes.
2. **Wrong baseVals defaults** — sparse presets (most fields omitted) inherited the editor's *from-scratch*
   `BLANK` defaults instead of *butterchurn's* preset defaults; fatal for any field where BLANK ≠ butterchurn.
3. **q-register clobber (~50 presets, the big one)** — the editor APPENDED its anim/flux writes to the preset's
   `frame_eqs`, overwriting the `q1`–`q32` registers the preset feeds its own shaders through.

(1) drops, (2) defaults differently, (3) appends — all three flavours of the same seam. Full details in
"Bugs fixed" below; the forward-looking synthesis is in the keystone map.

**META-RULE for future bundled-preset work:** when a bundled preset looks wrong/black in the editor but fine in
the player, the bug is almost always in the editor's reconstruction diverging from "what butterchurn would do
with the raw object." Diagnose by diffing the reconstructed runtime preset against the raw object
(`engine.presets[name]`), not by reading shaders. **Headless caveat:** many presets are audio-driven AND
feedback-based (decay), so a no-audio harness shows them black in BOTH paths and `loadPresetObject` leaks the
prior preset's feedback buffer between samples — both confound pixel sampling. Inject **pulsed** oscillators
(transients, for `bass_att`) into `engine.visualizerGainNode` and sample via `engine.captureNextFrame()` for a
reliable read. (See the two fixes below for the exact diagnostic path used.)

## Library-wide audit (2026-06-07) — the editor now faithfully renders the bundled library
Ran a **differential render audit** over all **1,144** bundled presets: render each BOTH ways (editor
`loadBundledPreset` reconstruction vs player raw-object) under identical pulsed-audio, flag editor-black-but-
player-fine. Reusable tool: **`scripts/audit-editor-presets.mjs`** (`npm run audit:editor-presets`; needs the
dev server). It renders the editor path first and only does the costly player-confirm render when the editor
looks dark, writing `scripts/audit-editor-presets-results.json`.

- **Before the q-fix:** 59 flagged editor-black (≈5%), dominated by `martin -`/`shifter -`/`ORB -`/`Geiss`/
  `Dark One`/`stahlregen` families. **After:** all 59 render (58 confirmed ≥3%; the last, `martin - basal
  ganglion`, renders at ~29% under longer sampling — its flag was an animation-timing dark frame).
- **Audit caveats (so the numbers aren't over-read):** (1) **Animation-timing false positives** — a single
  snapshot can catch a sine-animated preset at a dark instant (e.g. `phat_Phenethylamine`, `glassball`, `Geiss`
  flagged but actually fine). Sample a few frames and take the max. (2) The **"both-dark" bucket (~63)** is
  *inconclusive*, not "fine" — the synthetic pulsed audio may be too weak to light a preset in either path;
  real music or higher gain would re-classify some. The high-confidence signal is **editor≈0% while player is
  consistently 50–100%**.

## ⚠️ The q-register namespace collision — load-bearing for Phase 1–3 randomizing
The deepest lesson from the audit, and it directly shapes how we randomize/remix bundled presets:

**MilkDrop's per-frame registers `q1`–`q32` are a SHARED namespace.** A custom MilkDrop preset stores values in
them (in its `frame_eqs`/`pixel_eqs`) to pass into its OWN warp/comp/shape shaders. The editor *also* writes
them — `q1`–`q25` for image/text **layer animation** (`buildAnimFrameEqs`), `q31` for **flux** — by appending to
`frame_eqs` in `_buildRuntimePreset`. On a raw bundled preset those writes **overwrite the preset's shader
inputs → black** (this was the ~50-preset cluster). Fixed by gating that injection on `_bundledBase`.

**The collision is BIDIRECTIONAL — and the gate must be applied on BOTH sides (2026-06-08 lesson).** The 06-07 fix
handled the WRITE side (editor writes q → clobbers the preset). But the editor also READS those same registers: the
per-layer comp GLSL in `_buildImageBlock` animates each overlay by reading `q1`–`q25` (`opacity*q1`, `size*q2`,
`cx+q3`, `cy+q4`, `blur+q5`), expecting the neutral values `buildAnimFrameEqs` would have written. With the write
gated off on a bundled base, those reads picked up the PRESET's live q-values instead → layers jittered to the
preset's motion. **Fix:** gate the READ too — emit neutral literals (`1.0`/`0.0`) for those q-slots when
`_bundledBase`. **General rule:** any editor feature that touches a `q` register must be `_bundledBase`-gated on
*both* the write and the read; gating only one leaves the other half reading/writing the preset's namespace.

**Implication for Phase 1 (locked-Random remix) and Phase 2 (motion knobs) — do NOT inject q-register logic into
a bundled preset's `frame_eqs`.** Any "vary the preset" feature must stay in lanes proven safe on a raw bundled
base:
- **Output stage (`STUDIO_POST_FX` comp tail)** — colour/reactivity/Scene-FX/Club. Already safe on all 1,144;
  this is the Phase-1 re-roll surface. It reads `bass`/`mid`/`treb`/`vol` (and `q31` only if the user picks
  "flux" — note flux is unavailable on a raw bundled base now, by design).
- **Scaling the preset's OWN `baseVals`** (zoom/rot/decay/warp/warpscale) — the Phase-2 motion-knob lane.
  Multiplicative nudges to values the preset already owns, NOT new q-driven equations.
- **NEVER** append q-register assignments or new `frame_eqs` physics to a bundled preset — that's the clobber.
- **Keep `_bundledBase` semantics through locked-Random.** Phase 1's "Random varies THIS preset" must NOT clear
  `_bundledBase` (clearing it re-enables the q-injection and re-breaks the preset). The lock stays a raw bundled
  base; only the output-stage look axes roll.

This is the same "only the final-output tools reach a bundled preset" boundary from "The two worlds" above —
now with a concrete mechanism (the q-namespace) explaining *why* crossing it breaks presets.

## 🗝️ KEYSTONE MAP — preset anatomy, who renders each part, and what's safe to touch
This is the load-bearing reference for BOTH goals (dice-roll MilkDrop + studio controls on MilkDrop presets).
A butterchurn/MilkDrop preset (`engine.presets[name]`) has these parts. For each: what it is, whether it draws
the look, how `loadBundledPreset` reconstructs it, and whether a control/roll may touch it on a RAW bundled base.

| Part | What it is | Draws the look? | Editor reconstruction | SAFE to modulate on a raw bundled preset? |
|------|-----------|------|----------------------|-------------------------------------------|
| **`baseVals`** (~70) | per-frame scalars: `zoom`/`rot`/`warp`/`warpscale`/`decay`/`cx`/`cy`/`echo_*`/`wave_*`/`mv_*`/`ib_*`/`ob_*`/`gammaadj`… | **Yes** — base motion, feedback, wave/motion-vector/border draw | `{ ...BLANK, ...butterchurn baseValsDefaults, ...preset }` (faithful to player) | ✅ **YES — the Phase-2 motion lane.** Multiplicative nudges to values the preset already owns (`zoom`/`rot`/`decay`/`warp`/`warpscale`). Gate so neutral = untouched. |
| **`warp` shader** | per-pixel motion-field shader (HLSL→GLSL) | Yes (when non-empty) | preserved verbatim (`currentState.warp = bundled.warp`); only replaced when the editor TAKES OVER (Flow style / image-warp / Remix) | ⚠️ Not directly. Phase 4 = inject the user image INTO it. Replacing it = leaving the bundled world. |
| **`comp` shader** | per-pixel final-composite shader (HLSL→GLSL) | Yes (when non-empty) | preserved as `this._baseComp`; the editor APPENDS its `STUDIO_POST_FX` block at the **tail** via `injectStudioPostFx(_baseComp, gradeOpts)` | ✅ **The TAIL is the safe lane.** Colour/grade/Scene-FX/Club/glow/accent append here and re-mood ANY preset. The shader BODY stays untouched. |
| **`shapes[0..3]`** | up to 4 custom shapes (own `baseVals` + eqs) | Sometimes (the WHOLE look for some) | kept (`deepClone`); `_buildRuntimePreset` packs **editor shapes first, then bundled** into the 4 engine slots | ⚠️ Leave bundled shapes alone; the editor adds its OWN (never starves them). |
| **`waves[0..3]`** | custom waveforms (own `baseVals` + point eqs) | Sometimes | kept (`deepClone`) | ⚠️ Leave alone. |
| **`init/frame/pixel_eqs`** | the preset's physics + **the code that loads `q1`–`q32`** for its shaders | **Yes** — drives motion AND feeds the shaders | preserved; editor normally APPENDS motion-engine/react/wave/flux/anim lines — **now GATED OFF when `_bundledBase`** | 🚫 **NEVER append to a bundled preset's eqs.** That's the q-clobber. |
| **`q1`–`q32`** | shared per-frame scratch registers the preset uses to pass values into its warp/comp/shape shaders | indirectly (shader inputs) | editor WRITES `q1`–`q25` (layer anim) + `q31` (flux) in `frame_eqs` AND READS `q1`–`q25` in the layer comp GLSL (`_buildImageBlock`) — **both gated on `!_bundledBase`** | 🚫 **OFF-LIMITS on a bundled base — write AND read.** The namespace collision is bidirectional: don't write any `q` the preset reads, and don't read any `q` the preset writes (emit neutral literals instead). |

### The TWO safe lanes (everything a bundled-preset control or dice-roll may use)
1. **Output stage — the comp TAIL (`STUDIO_POST_FX`).** Re-moods ANY of the 1,144 without touching their shader:
   Brightness/Contrast/Gamma/Temperature/Saturation/Hue-Rotate/Colour-Roll + their audio reactivity + Scene FX
   (Bloom/Posterize/Vignette/Scanlines/Grain) + Club/Dark-Mode + Glow/Accent. **This is the Phase-1 dice-roll
   surface and the studio "look" controls — same lane.**
2. **`baseVals` scaling — motion/feedback.** Multiplicative nudges to `zoom`/`rot`/`decay`/`warp`/`warpscale`
   the preset already owns. **This is the Phase-2 motion-knob lane** (also a dice-roll axis). Audit per-pattern
   safety across packs before shipping (some presets drive these in `frame_eqs`, which wins over `baseVals`).

**Anything outside these two lanes (warp/comp body, shapes/waves, eqs, q-registers) is OFF-LIMITS on a raw
bundled preset** — touching it is what produced every black-screen bug. Crossing the line is "leaving the
bundled world" (Remix-to-custom / Flow style / Meld) and must clear `_bundledBase` first.

### Gotchas that bite both goals
- **`flux` reactivity source is unavailable on a raw bundled preset** (q31 is no longer populated, by design —
  populating it clobbers presets that use q31). Studio grade/solid/image reactivity "flux" → silently reads 0
  on a bundled base. Use bass/mid/treb/vol there. (Full flux returns once the preset is converted to custom.)
- **`_bundledBase` is the master switch.** Set in `loadBundledPreset`; cleared when the editor takes over the
  warp (Flow/Remix) or on reset/load. It gates: Meld-block modal, the eq/q injection (WRITE), AND the layer comp
  q-reads (`_buildImageBlock` → neutral literals). **Locked-Random (Phase 1) MUST keep it set** — clearing it
  re-enables the q-injection and re-breaks the preset.
- **Any new `q`-touching layer/anim feature must be `_bundledBase`-gated on BOTH write and read** (2026-06-08). The
  collision is bidirectional (see "⚠️ The q-register namespace collision"): gating only the write leaves the comp
  reading the preset's `q` values → erratic layers; gating only the read leaves `frame_eqs` clobbering the preset →
  black. New per-layer GLSL that reads a `q` slot must fall back to its neutral literal when `_bundledBase`.
- **Overlay-layer re-hydration is shared, not duplicated.** `_rehydrateImageLayers(savedImages)` is the single
  per-entry re-mount path (fetch blob from IndexedDB → build texObj → `_mountLayerCard`), used by BOTH `loadPresetData`
  (library load) and `restoreImageLayers` (Random-button persistence). Layer-load changes go there once.
- **Saved baseVals are authoritative; old saves aren't auto-migrated.** A bundled-derived preset saved BEFORE
  these fixes baked the wrong `mv_a`/etc into its JSON — it stays broken until re-saved. New loads are correct.
- **Verifying changes:** `npm run audit:editor-presets` is the regression net. Re-run after ANY change to the
  bundled-load path. Mind the two audit caveats (animation-timing false positives; "both-dark" is inconclusive).

## Bugs fixed
- **Image/video/text LAYERS jittered to the preset's motion on bundled presets — q-register read-back (fixed 2026-06-08).**
  The mirror image of the q-clobber above. Each layer's comp GLSL (`_buildImageBlock`) animates itself by READING
  per-layer registers `q1`–`q25` (opacity`*q1`, size`*q2`, cx`+q3`, cy`+q4`, blur`+q5`). Those are meant to hold the
  editor's neutral anim values from `buildAnimFrameEqs`, but that injection is gated OFF on a bundled base (the
  2026-06-07 fix). So on a bundled preset `q1`–`q25` held the PRESET's own per-frame register values, which pulse with
  the music — every layer's opacity/size/position rode the preset's motion ("layers acting erratic… picks up slider
  motions instead of just sitting there"). **Fix:** in `_buildImageBlock`, when `_bundledBase` is true, bake the
  neutral identity literals (`1.0` mult / `0.0` add) in place of the `q1`–`q25` tokens, so a layer sits STILL by default
  — byte-identical to a from-scratch layer with no animation. From-scratch presets (`_bundledBase` false) keep the
  q-refs so the GSAP animation pipe is unaffected. Per-layer audio sliders (`audioPulse`/`opacityPulse`/`bounceAmp`…)
  read the `_r` envelope directly, NOT through q, so controllable reactivity is the intended "make it react" choice and
  is untouched. Verified headlessly: bundled comp has no `q1`–`q5` in the layer block, from-scratch comp keeps them.
- **Layers vanished when pressing Random (but persisted on Remix) — `_clearForLoad` wipe (fixed 2026-06-08).**
  `Random` (`_loadRandomBundled`) → `loadBundledPreset` → `_clearForLoad` resets `currentState` to BLANK + empties
  `#image-layers` + drops `_imageTextures`, so every overlay layer was destroyed on each Random press; the Remix button
  (`_rollFullStack`) re-rolls in place and kept them. **Fix:** the Random handler snapshots `currentState.images` BEFORE
  the load (each entry carries its `imageId`/`videoId` → persisted blob in IndexedDB), then `await
  inspector.restoreImageLayers(snapshot)` re-mounts them over the new preset. Re-hydration reuses the SAME trusted path
  as a library load: extracted `loadPresetData`'s per-entry re-mount loop into `_rehydrateImageLayers(savedImages)`
  (shared by both); `restoreImageLayers` calls it then rebuilds comp + applies once. Scoped to the Random button — the
  Remix-picker dirty-confirm flow is untouched.
- **~50 bundled presets rendered BLACK in the editor — q-register injection clobber (fixed 2026-06-07).**
  Custom MilkDrop presets (`martin -`, `shifter -`, `ORB -`, `Geiss`, `Dark One`, `stahlregen`…) pass values
  into their own warp/comp/shape shaders via the `q1`–`q32` registers. `_buildRuntimePreset` appended the
  editor's layer-anim lines (`q1`–`q25`, `buildAnimFrameEqs`) and flux line (`q31`) to EVERY preset's
  `frame_eqs`, overwriting those shader inputs → black. The player never does this for bundled presets (they
  load raw, never through `refreshCustomPresets`'s injection, which is gated on `CUSTOM_PREFIX`). **Fix:** gate
  both injections on `!this._bundledBase` in `_buildRuntimePreset` — a raw bundled preset's `frame_eqs` pass
  through verbatim (player parity); injection resumes once the user takes over the warp (Flow/Remix clears
  `_bundledBase`, editor owns the shaders → its own anim/flux features apply). Bisected by reverting one
  reconstruction transform at a time with the feedback buffer cleared: reverting q-injection restored every
  truly-broken preset (tunnel race 0→87%, lattice 0→98%, Kalidescope 0→95%, Dark One 0→72%); comp/baseVals/
  shapes reverts did nothing. Verified: 58/59 flagged presets now render (59th renders at 29%). No regression
  risk — passing bundled presets already render in the player *without* the injection; custom/from-scratch
  presets (`_bundledBase` false) are unaffected.
- **Sparse bundled presets rendered BLACK in the editor — wrong baseVals defaults (fixed 2026-06-07).**
  `Rovastar - Space _Twisted Dimension Mix_` (and other *sparse* presets) omit most `baseVals` fields,
  including `mv_a` (motion-vector alpha). Its visible "space" content is the **motion-vector point grid**
  warped through the feedback loop. The player works because butterchurn fills omitted fields from its own
  table — `preset.baseVals = Object.assign({}, this.baseValsDefaults, preset.baseVals)` (vendor butterchurn.js
  ~line 6740), where `mv_a` defaults to **1**. The editor built `baseVals = { ...BLANK.baseVals,
  ...bundled.baseVals }`, and `BLANK` is the from-scratch creation base that intentionally sets `mv_a: 0`
  (no motion vectors) — so `mv_a` was explicitly `0`, the grid was invisible, nothing seeded the feedback →
  **BLACK**. (BLANK also diverges on `wave_mode` 3-vs-0, `wave_brighten` 0-vs-1, `b1ed` 0.5-vs-0.25 — latent
  same-class breakage for other sparse presets.) **Fix:** interpose butterchurn's OWN defaults between BLANK
  and the preset in `loadBundledPreset`: `{ ...BLANK.baseVals, ...engine.visualizer.baseValsDefaults,
  ...bundled.baseVals }`. Keeps the editor-only fields (`studio_*`, `darken_center`…), makes every MilkDrop
  field faithful to the player, and the preset's own values still win. Read from the same pinned vendor at
  runtime → zero drift. **Did NOT** change `BLANK` (changing `mv_a` there would give every new from-scratch
  preset motion vectors). Verified with pulsed-audio harness: Rovastar 0% → 100% non-black, `mv_a` now 1;
  phat_Phenethylamine unaffected (its own `mv_a:0`/`wave_mode:6` win). No player/save-path change needed —
  saved baseVals stay authoritative.
- **Shape-driven bundled presets rendered BLACK in the editor (fixed 2026-06-07).** `loadBundledPreset`
  did `this.currentState.shapes = []`, dropping the bundled preset's own shapes. For presets whose entire
  look IS their shapes — empty warp + empty comp + near-zero `wave_a` (e.g. `phat_Phenethylamine`) — that
  left nothing to draw → black, even though the player rendered it fine (player loads the raw object via
  `visualizer.loadPreset`, keeping all shapes). Fix: keep the bundled shapes (`deepClone(bundled.shapes||[])`);
  they have no `.motion`/`.react`, so `_isEditorShape()` is false → still no cards, still don't count against
  the add-limit. `_buildRuntimePreset` now orders **editor shapes first, then bundled shapes** into the engine's
  4 slots so user-added shapes are never starved (the original reason shapes were dropped). Mirrored in the
  player's `refreshCustomPresets` (visualizer.js) for save parity. Verified headlessly: dropping shapes = 0%
  non-black, keeping = renders + editor shape survives into slots.

## Notes
- "MilkDrop preset is loaded" detection already exists: `this._bundledBase` (inspector.js) — set on Random,
  cleared when the editor takes over the warp (Flow style / Remix-from-scratch) or on reset/load.
- Meld-on-bundled is blocked with a modal (shipped 2026-06-06): `_bundledBase` → `_showMeldBundledModal`.
- From-scratch creation tools (the other world): `milkdrop-tools-dev.md`.
