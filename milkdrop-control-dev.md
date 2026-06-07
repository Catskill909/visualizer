# MilkDrop Control & Remix Convergence (dev plan)

**Status:** PLANNING. Next step = Phase 1. Captured 2026-06-06.

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

### Phase 1 — LOCK a MilkDrop preset, then Random remixes IT (look only). ← START HERE
The mechanism lives on the **Random** button, driven by a **lock on the current MilkDrop preset** — NOT on the
Remix button, and NOT inside the Remix Locks menu.

- **Default (unlocked):** Random = today — each press loads a brand-new MilkDrop preset. Untouched.
- **Locked:** lock the loaded MilkDrop preset → the Random button stops loading new presets and instead
  **remixes (varies) the locked one** — re-rolls only its **LOOK**: colour scheme, colour reactivity, Scene
  FX, Club. Same preset, same motion; new colours/finish each press; pulsing to the music.

**The exit:** the lock IS the on/off. Locked = Random varies this preset; unlock = Random browses fresh
presets again (also resets via New / loading a custom preset).

- **Why first:** ZERO new sliders — locked-Random just re-rolls tools that already work on any preset.
- **Where the lock lives:** with the **Random button** (a lock state on / next to it) so it's obvious. The
  **Remix Locks menu stays untouched** — it's for from-scratch app parts; a MilkDrop-preset lock there is
  awkward. (Remix and its locks don't change at all in this phase.)
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

### Phase 2 — A few curated motion knobs
Add **2–3 dramatic** one-knob controls that *modulate the preset's own motion* (don't replace it). Candidates:
- **Speed / Motion amount** — scale the preset's `frame_eqs` time-evolution + `zoom`/`rot`/`warp` `baseVals`
  by a global factor.
- **Trail / Feedback** — nudge `decay`.
- **Warp amount** — scale the preset's `warp` / `warpscale`.
Each is gated so neutral = the preset untouched (safe on all 1,144), AND each is a new axis Remix can roll.
Open work: audit which `baseVals` / eq patterns are safe to scale per the MilkDrop spec; verify across packs.

### Phase 3 — locked-Random varies the preset, full
With a MilkDrop preset locked, Random now varies **look (Phase 1) AND motion (Phase 2)**. Endless variety in
both, still keeping the preset's identity.

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

## Already works on any loaded preset (incl. all 1,144) — don't rebuild
Via the `STUDIO_POST_FX` comp-tail inject — these are exactly the axes **Phase 1** re-rolls:
- Colour adjustments (Brightness / Contrast / Gamma / Temperature / Saturation / Hue Rotate / Colour Roll)
- Colour Reactivity (pulse those to Bass / Mid / Treble / Volume / Flux)
- Scene FX (Bloom / Posterize / Vignette / Scan lines / Film grain)
- Club / Dark Mode (final-output dark-room tune)
- Overlay layers (image / video / GIF / text composite over any preset)

## The gaps (what does NOT reach a bundled preset today)
- **Motion / warp / feedback** is not editor-controllable — the preset's `warp` shader, `frame_eqs`/
  `pixel_eqs`, and zoom/rot/decay/warp `baseVals` are raw and untouched. (Phase 2 modulates these.)
- **No way to vary a loaded MilkDrop preset** — Random only loads a new one; Remix only builds from-scratch.
  (Phase 1 fixes this: lock the preset, and Random remixes IT.)
- **Meld can't meld INTO a bundled preset** — it would override the warp and clobber the look. Now blocked
  with a friendly modal (shipped 2026-06-06; offers Remix to convert to a custom preset). (Phase 4 is the real
  fix — inject the texture into the preset's own warp.)

## Maybe: a 5th tab
A dedicated "Tune this preset" tab could be the home for the *loaded-preset* world, distinct from the
from-scratch CREATION tabs (Palette / Layers / Motion / Wave) — holding the preset lock + the few Phase-2
knobs. But the lock itself lives on the Random button regardless; a tab is only worth it if there are enough
loaded-preset controls to justify a distinct workflow. Decide when we build Phase 2+. Naming TBD.

## Open questions (settle when scoping each phase)
- Phase 1: live tweak vs convert-to-custom on first Remix?
- Phase 2: which `baseVals` / eq patterns are safe to scale globally without breaking presets?
- UX: where do the controls live — a 5th tab, or folded into existing tabs?
- How to reliably detect "bundled base" beyond the `_bundledBase` flag if state paths grow.

## Notes
- "MilkDrop preset is loaded" detection already exists: `this._bundledBase` (inspector.js) — set on Random,
  cleared when the editor takes over the warp (Flow style / Remix-from-scratch) or on reset/load.
- Meld-on-bundled is blocked with a modal (shipped 2026-06-06): `_bundledBase` → `_showMeldBundledModal`.
- From-scratch creation tools (the other world): `milkdrop-tools-dev.md`.
