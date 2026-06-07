# MilkDrop Control & Remix Convergence (dev plan)

**Status:** PLANNING. Next step = Phase 1 (B-lite). Captured 2026-06-06.

## Goal (one line)
Make the **Remix** button able to vary a loaded **MilkDrop preset** — so the 1,144 built-in presets become
endlessly explorable, instead of frozen.

## The two buttons today
- **Random** — loads a built-in **MilkDrop preset** (one of the 1,144 shipped with the app).
- **Remix** — builds a brand-new **from-scratch** preset out of our sliders/controls.

## The problem
Load a MilkDrop preset with **Random**, press **Remix** → Remix **throws the preset away** and rolls a
from-scratch one. There is no way to keep a MilkDrop preset and explore variations of *it*.

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
- **Approach:** treat it as a spike — live with it for a day; that tells us which Phase 2 motion knobs are
  actually worth adding.
- **Decision to settle:** does "This preset" stay a live tweak, or convert the preset to a custom preset on
  first press? (Lean: live tweak; offer "Save as custom" after.)

### Phase 2 — A few motion knobs
Add **2–3 dramatic** one-knob motion controls that *modulate the preset's own motion* (don't replace it):
**Speed**, **Trail** (feedback/decay), **Warp amount**. Each is also a new thing Remix can roll.
- Gated so neutral = the preset untouched (safe on all 1,144). Audit which `baseVals` are safe to scale.

### Phase 3 — "Remix this preset", full
Remix now varies **look (Phase 1) AND motion (Phase 2)**. Endless variety in both.

### Phase 4 — Meld your image into a preset (bigger, later)
Inject a user image/video into the preset's **own** motion so the preset processes your asset while keeping
its look. (Unblocks the Meld-on-bundled modal we shipped today. Per-preset shader injection — non-trivial.)

## Ground rules
- **No slider-stacking.** Do NOT expose MilkDrop's ~50 internal params (most do nothing on a given preset).
- **Dramatic-or-cut.** A control ships only if it's visibly dramatic on a broad sample of presets.
- **Remix is the main way to explore.** Sliders just nudge/lock after a roll.

## Already works on any loaded preset (incl. all 1,144) — don't rebuild
Via the `STUDIO_POST_FX` comp-tail inject:
- Colour adjustments (Brightness / Contrast / Gamma / Temperature / Saturation / Hue Rotate / Colour Roll)
- Colour Reactivity (pulse those to Bass/Mid/Treble/Volume/Flux)
- Scene FX (Bloom / Posterize / Vignette / Scan lines / Film grain)
- Club / Dark Mode
- Overlay layers (image/video/GIF/text composite over any preset)

These are exactly the axes **Phase 1** re-rolls.

## Maybe: a 5th tab
A dedicated "Tune / Remix this preset" tab to house the Phase-1 workflow (Random picks a base, Remix varies
it) + the lock strip + the few Phase-2 knobs. Decide when we build Phase 1. Naming TBD.

## Open questions (settle when scoping each phase)
- Phase 1: live tweak vs convert-to-custom on first Remix?
- Phase 2: which `baseVals` are safe to scale globally without breaking presets?
- Where do the controls live — a 5th tab, or folded into existing tabs?

## Notes
- "MilkDrop preset is loaded" detection already exists: `this._bundledBase` (inspector.js), set on Random,
  cleared when the editor takes over the warp (Flow style / Remix-from-scratch) or on reset/load.
- Meld-on-bundled is blocked with a modal (shipped 2026-06-06): `_bundledBase` → `_showMeldBundledModal`.
- Phase 4 detail: `image-texture-dev.md` §16.2 (inject texture into a preset's own warp).
- From-scratch creation tools (the other world): `milkdrop-tools-dev.md`.
