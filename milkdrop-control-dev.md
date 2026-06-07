# MilkDrop Control & Remix Convergence (dev plan)

**Status:** PLANNING. Next step = Phase 1. Captured 2026-06-06.

## Goal (one line)
Make the **Remix** button able to vary a loaded **MilkDrop preset** — so the 1,144 built-in presets become
endlessly explorable, instead of frozen.

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

### Phase 1 — "Remix this preset" (look only). ← START HERE
A two-state Remix MODE — Remix's default behavior is NEVER changed; the new behavior is opt-in and reversible:
- **"From scratch" (default)** — Remix = exactly today (builds a brand-new from-scratch preset). Untouched.
- **"This preset"** — Remix keeps the loaded MilkDrop preset and re-rolls only its **LOOK**: colour scheme,
  colour reactivity, Scene FX, Club. Same motion; new colours/finish each press; pulsing to the music.

**The exit (critical — no hijack):** the mode toggle IS the way out. "This preset" is only available while a
MilkDrop preset is loaded (`_bundledBase`); pressing **New** or loading a custom preset auto-reverts to
"From scratch". Default is "From scratch", so Remix's original behavior always works unless you opt in.

- **Why first:** ZERO new sliders — "This preset" mode just re-rolls tools that already work on any preset.
- **Build:** add the mode toggle near Remix (enabled only when `_bundledBase`). In `_rollFullStack`, when mode
  = "This preset", roll ONLY the final-output axes; do NOT touch the preset's warp/comp (preset keeps its
  identity). Otherwise `_rollFullStack` runs unchanged.
  - Reuse the existing Remix-locks strip (pin what you like, re-roll the rest).
  - Respect `_rolling` (one engine reload per press — [[project_remix_batch_perf]]).
- **Approach — treat it as a SPIKE:** live with it for a day. That experience tells us which Phase 2 motion
  knobs are actually worth adding — build the controls Remix makes you *wish* you had, rather than guessing
  the slider set up front. (This is "A serves B" — see Design principles.)
- **Decision to settle:** does "This preset" stay a live tweak, or convert the preset to a custom preset on
  first press? (Lean: live tweak; offer "Save as custom" after — mirrors the current Random → edit → Save flow.)

### Phase 2 — A few curated motion knobs
Add **2–3 dramatic** one-knob controls that *modulate the preset's own motion* (don't replace it). Candidates:
- **Speed / Motion amount** — scale the preset's `frame_eqs` time-evolution + `zoom`/`rot`/`warp` `baseVals`
  by a global factor.
- **Trail / Feedback** — nudge `decay`.
- **Warp amount** — scale the preset's `warp` / `warpscale`.
Each is gated so neutral = the preset untouched (safe on all 1,144), AND each is a new axis Remix can roll.
Open work: audit which `baseVals` / eq patterns are safe to scale per the MilkDrop spec; verify across packs.

### Phase 3 — "Remix this preset", full
Remix now varies **look (Phase 1) AND motion (Phase 2)**. Endless variety in both, still keeping the preset's
identity.

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
- **Remix is from-scratch only** — pressing Remix builds a new preset; it does not vary a loaded bundled
  preset. (Phase 1 fixes this.)
- **Meld can't meld INTO a bundled preset** — it would override the warp and clobber the look. Now blocked
  with a friendly modal (shipped 2026-06-06; offers Remix to convert to a custom preset). (Phase 4 is the real
  fix — inject the texture into the preset's own warp.)

## Maybe: a 5th tab
A dedicated "Tune / Remix this preset" tab — the home for the *loaded-preset* world, distinct from the
from-scratch CREATION tabs (Palette / Layers / Motion / Wave). It would hold the Remix mode toggle + the lock
strip + the few Phase-2 knobs, making it the unified discovery surface (Random picks a base, Remix varies it).
Justified because it's a distinct *workflow*, not just a place to park sliders. Decide when we build Phase 1.
Naming TBD ("Tune" / "Remix" / "Mix").

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
