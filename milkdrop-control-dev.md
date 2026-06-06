# MilkDrop Control & Remix Convergence — planning/hub (dev)

> **Status: 📋 PLANNING.** Strategic thread captured 2026-06-06. Goal: make the **1,144 bundled MilkDrop
> presets first-class** — not just static starting points — by (1) bringing **Remix tools into sync with the
> MilkDrop Random** experience, and (2) **exposing more real control** over a loaded bundled preset
> (including, eventually, **Meld-into-any-preset**). Planned as **a couple of focused sessions** (below).
> This is the home for that work; keep status here. **📋 Handoff-ready — see ▶️ NEXT SESSION below.**

## ▶️ NEXT SESSION — START HERE (handoff)
**Start with B-lite, and treat it as a SPIKE.** Recommended way in (agreed 2026-06-06):
1. **Wire 🎲 to re-roll the EXISTING final-output axes on a loaded bundled preset** — colour scheme,
   colour reactivity, Scene FX, Club. No new sliders. Reuse the `_rollFullStack` machinery + the Remix-locks
   strip, but in a mode that does NOT replace the preset's warp/comp (so the MilkDrop preset keeps its
   identity, just gets re-mooded + reactive variants).
   - Detection of "a bundled preset is active" already exists: `this._bundledBase` (inspector.js).
   - The roll must respect `_rolling` (one engine reload per click — [[project_remix_batch_perf]]).
2. **Live with it for a day of doom-scrolling.** The point of the spike: *that experience tells us which
   Session-A motion knobs are actually worth adding* — build the controls the dice makes you WISH you had,
   rather than guessing the slider set up front. (This is "A serves B" in practice.)
3. Then scope **Session A** (the 2–3 dramatic motion knobs the spike revealed) → **B-full** → **C**.

**Each phase gets its own discussion before building** (user's call). Don't batch them.

**First open question to settle for B-lite:** does "Remix this preset" stay a *live tweak* on the loaded
bundled preset, or does the first roll *convert it to a custom preset* (so it can be saved/undone cleanly)?
Lean: live tweak first; offer "Save as custom" after (mirrors the current Random→edit→Save flow).

## The vision (user's strategic call)
Today the editor has **two worlds**:
- **From-scratch / custom** — the editor fully owns the warp/comp/motion. Remix, Flow style, Motion engine,
  Custom shapes, Meld all live here.
- **Bundled MilkDrop presets** — loaded as an editing *base* (Random button / Studio "Random"); the editor
  **preserves their raw warp/comp/equations** (that's their look). Only **final-output** tools reach them.

The user wants these to **converge**: Remix and the Random button should feel like one discovery instrument,
and a loaded MilkDrop preset should be **deeply tweakable / remixable / meldable**, not frozen.

## ⛔ Design principles (non-negotiable — brainstorm 2026-06-06)
1. **NO slider-stacking.** We do NOT expose MilkDrop's ~50 internal params. "A lot do nothing dramatically"
   and more faders = the pro-tool wall we beat ([[project_one_click_vs_pro_tools]]).
2. **Dramatic-or-cut.** A control only ships if it's **visibly dramatic on a BROAD sample** of presets.
   Test across packs; if it's a dud on most, cut it. (Many MilkDrop params are no-ops on a given preset.)
3. **The DICE is the discovery instrument, not the faders.** User: rolling the dice is "like social-media
   doom-scrolling — the variety seems endless." Lean into this. Sliders exist to *nudge/lock* after a roll;
   the roll does the exploring. **Every new control should primarily be a new AXIS the dice can roll.**
4. **A serves B.** Curated motion knobs (Session A) exist so the dice (Session B) has meaningful things to
   roll on a loaded preset — not as a control panel for its own sake.

## Phasing & priority (user: all three, phased; EACH step needs its own discussion)
**B is the favourite** ("I know it'll be really good"). Key unlock: **B can ship first with ZERO new sliders.**
Suggested order:
1. **B-lite** ⭐ FIRST — "Remix this preset": roll the EXISTING final-output axes (colour scheme / reactivity /
   Scene FX / Club) on top of a loaded MilkDrop preset. Instant endless variety on all 1,144, no new controls.
2. **A** — a tiny CURATED set of dramatic motion knobs (Speed, Trail, Warp-amount) modulating the preset's own
   motion; each becomes a new dice axis (dramatic-or-cut bar applies).
3. **B-full** — the dice now also rolls A's motion axes (endless × motion).
4. **C** (bigger, later) — Meld-into-any-preset.

## 💡 The 5th tab idea (brainstorm)
A dedicated **"Tune / Remix this preset"** tab — the home for the *loaded-preset* world, distinct from the
from-scratch CREATION tabs (Palette/Layers/Motion/Wave). It would hold the **Remix-this-preset / Surprise**
button + the **lock strip** + the FEW curated nudge knobs — making it the **unified discovery surface** where
**Random picks a base and 🎲 varies it** (answers "Random + Remix should feel like one instrument"). Justified
because it's a distinct *workflow*, not just a place to park sliders. Naming TBD ("Tune" / "Remix" / "Mix").

## Current state — what already works on a bundled preset (don't re-derive)
These operate on the **final output of ANY loaded preset** (incl. all 1,144 bundled), via the
`STUDIO_POST_FX` comp-tail inject — they already work and are good:
- **Colour adjustments** — Brightness / Contrast / Gamma / Temperature / Saturation / Hue Rotate / Colour Roll.
- **Colour Reactivity** — pulse those to Bass/Mid/Treble/Volume/Flux.
- **Scene FX** — Bloom / Posterize / Vignette / Scan lines / Film grain.
- **🌙 Club / Dark Mode** — final-output dark-room tune.
- **Overlay layers** — images/video/GIF/text composite over any preset.

## The gaps (what does NOT reach a bundled preset today)
- **Motion / warp / feedback** of the bundled preset is **not editor-controllable** — its `warp` shader,
  `frame_eqs`/`pixel_eqs`, zoom/rot/decay/warp `baseVals` are raw and untouched. The from-scratch Motion
  engine / Flow style **replace** the warp rather than *modulate* the preset's own.
- **Remix is from-scratch only** — 🎲 builds a new preset; it does **not** "remix" or vary a loaded bundled
  preset's parameters.
- **Meld can't meld INTO a bundled preset** — it overrides the warp (clobbers the look). **Now blocked with a
  friendly modal** (2026-06-06, `_bundledBase` flag → `_showMeldBundledModal`, offers 🎲 Remix to convert to a
  custom preset). The real fix is the "inject texture into the preset's OWN warp" mechanism (image-texture
  spike Approach A; see `image-texture-dev.md` §16.2).

## Session detail (the order/priority is the section above; refine each before building)

### Session A — "Tweak the MilkDrop preset's own motion" (deeper control, no clobber)
Expose a small set of **modulators on the bundled preset's existing warp/feedback** (don't replace it):
- **Speed / Motion amount** — scale the preset's `frame_eqs` time-evolution + `zoom`/`rot`/`warp` `baseVals`
  by a global factor (modulate, not override).
- **Feedback / Trail** — nudge `decay`.
- **Warp amount / scale** — scale the preset's `warp`/`warpscale`.
- One-knob each, gated to neutral = the preset untouched (so it's safe on all 1,144). Audit which `baseVals`
  are safe to scale per the MilkDrop spec. Verify a sample across packs.

### Session B — "Remix a loaded preset" (Remix ↔ Random convergence) ⭐ FAVOURITE
Make 🎲 able to **vary the CURRENT bundled preset** instead of always going from-scratch. Split:
- **B-lite (ship first, ZERO new sliders):** roll the EXISTING final-output axes (colour scheme / reactivity /
  Scene FX / Club) on top of the loaded bundled preset → instant endless variety, keeps the preset's identity.
- **B-full:** also roll Session-A motion modulators → motion variants too.
- Unified discovery flow: Random picks a base, 🎲 varies it; lock axes to taste (reuse the Remix-locks strip).

### Session C (later / bigger) — "Meld into any preset"
The headline: inject a user texture into the **bundled preset's own warp** (Approach A) so any of the 1,144
can process your image, keeping its signature look. Non-trivial (per-preset shader injection + sampler-header
gotcha + blend tuning). Unblocks the Meld modal added today. Scope after A/B land.

## Open questions (settle when scoping)
- Which bundled `baseVals` / eq patterns are safe to scale globally without breaking presets? (spec audit)
- Does "Remix this preset" save as a custom preset (parentPresetName) or stay a live tweak?
- UX: where do the bundled-preset motion modulators live — a new "Preset" tab section, or fold into Motion?
- How to reliably detect "bundled base" beyond the `_bundledBase` flag if state paths grow.

## Links
- Meld + image-into-feedback spike (Approach A = meld into any preset): `image-texture-dev.md` (§16.2, §9–11).
- From-scratch creation tools (the editor-owned world): `milkdrop-tools-dev.md`.
- The Meld-on-bundled modal block (shipped 2026-06-06): `inspector.js` `_bundledBase` / `_showMeldBundledModal`.
