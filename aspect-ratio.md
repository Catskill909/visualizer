# Aspect Ratio — Audit & Plan

> **Goal:** Let a layer either keep its true shape no matter the canvas ("Lock"),
> or take today's canvas-adaptive behavior ("Fluid"). **Both** available, per layer.
> **Lock (asset integrity) is the DEFAULT** — a layer shows its true shape unless the
> user opts into Fluid. This is *safe*: Lock == Fluid on every landscape canvas, so the
> only presets that change are ones viewed on a **portrait** canvas, where the old squish
> was an accidental artifact, not a design choice. (See [§3a](#3a-which-mode-is-default).)

---

## Status

| Item | State |
|---|---|
| Audit / root cause | ✅ done (this doc) |
| Math verified | ✅ done |
| Visually verified | ✅ aspect-test.html (2026-05-25): Lock round on every canvas/source; Fluid squashes only in portrait; landscape identical |
| Touch-points mapped | ✅ done (exact file:line below) |
| Default decided | ✅ Lock (asset integrity) is default; Fluid is opt-in |
| Design decided | ⏳ awaiting sign-off (per-layer vs global; v1 scope; Fluid definition) |
| Code | ✅ SHIPPED 2026-05-25 — Phases 0/1/2 in inspector.js (per-layer Lock·Fluid toggle, Lock default) |
| Real-app verified | ✅ 2026-05-25 — single image (circle) + density tiling (godzilla): Fluid distorts, Lock snaps to true shape. Landscape: Lock==Fluid (expected). |
| Focus-mode stretch bug | ✅ FIXED & VERIFIED 2026-05-25 — `sizeCanvas()` now uses full window width when the panel is hidden (editor/main.js:194-201). Was: always subtracted the 340px panel → buffer too narrow → canvas CSS-stretched in full screen. (See [§9](#9-screen-draw-rule).) |
| Phase 3 (grid mode) | ✅ SHIPPED & VERIFIED 2026-05-25 — grid cell-rotation + Fit `_cellAR` now use `aspect.y / max(aspect.x, 0.01)` (portrait-correct); inert Lock/Fluid toggle hidden in grid. Confirmed working in-app. |
| Help + promo | ✅ 2026-05-25 — in-app help modal (index.html), promo beta "What's new" modal + promo features page (promo/index.html). Framed as "screen redraw / reveals more," not slide. |
| Remaining | None — aspect-ratio work complete end-to-end (single, tiled/density, tunnel, scatter, grid). The "fixed-composition viewport" idea I floated is **dropped** — it already exists as **Output Settings** (lock resolution + aspect + Letterbox/Stretch/Crop fill, controls.js). Screen-redraw + Lock is the live default; Output Settings is the locked-frame option. Nothing to build. |

**Decided:** Lock (asset integrity) is the default; Fluid is the opt-in. (User call,
2026-05-24 — "asset integrity should be first; many sliders already distort.")

**Open decisions for the user** (see [§7](#7-open-decisions)):
1. Per-layer toggle, or one global toggle for the whole preset?
2. v1 scope = the single shared choke point only (covers single + tiled + tunnel + scatter)? Grid mode handled later if needed.
3. What should **Fluid** mean as the opt-in: today's behavior (adapts/squishes only on portrait), or a true free-stretch (square → wide on any canvas)? *Pending — see [§3](#3-the-two-modes).*

---

## ▶ Resume here tomorrow

Plan is complete and signed off on the big call (Lock = default). To start coding, just
confirm the 4 open decisions in §7 (my recommendations are noted inline) + grab the §7.4
artifact, then build Phase 0 → 1 → 2 in order. Everything is mapped; no further investigation
needed. If short on time, **Phase 1 alone is the whole fix** — Phases 0/2 just make it
persist and toggleable.

---

## 0. Recommendation (what's best for the app + the user's creativity)

**Default to integrity (Lock); keep Fluid as a deliberate effect.** One reason: it separates
*predictability* from *expression*. Today distortion happens *to* people; this makes distortion
something people *do*.

- **For the app:** Lock-as-default is the safe correctness move — identical on every landscape
  canvas, only fixes the portrait squish (a bug nobody designed for), no migration. "What I
  built is what I see" becomes true across editor, full screen, and any output monitor. That
  reliability is the foundation the timeline / multi-output / NDI work sits on.
- **For creativity:** stretch is a *real* effect, not a default. A square logo deliberately
  smeared into a widescreen bar is a choice; a logo that silently warps because the window got
  narrow is a bug. Fluid sitting beside the other distortion sliders (skew, perspective,
  width/height) makes the whole distortion toolkit feel intentional and discoverable.

**What I'd ship:**
1. Per-layer **Lock / Fluid** toggle, Lock default (per-layer, matches every other control).
2. v1 = the one choke point (`aspectPreScale`) → single + tiled + tunnel + scatter.
3. Fluid = today's behavior verbatim (don't redefine as free-stretch yet — separate later effect).
4. Fold the **grid Fit portrait fix** into the same `aspect.y → aspect.y/aspect.x` substitution
   so Fit and Lock stay consistent (see §3b).

Honest caveat stays: a layer tuned inside a portrait editor window will shift — but *toward*
its true shape, so a correction, not a regression.

---

## 1. The problem (user's words)

> "All our layer objects are kind of fluid — they get wider or taller in different
> circumstances like the size of the canvas. Most obvious going from the small edit
> screen in the preset editor to full-screen canvas. I like the fluid aspect also, so
> ideally we can have both."

So: not a bug to stamp out — a **missing mode**. Today there is exactly one behavior;
the user wants to *choose* per layer.

---

## 2. Root cause — one-sided aspect correction

Every image / video / text layer is drawn by one generated shader. The line that sets
a layer's on-screen shape is the **aspect pre-scale**:

```glsl
_u.x /= imgAsp * aspect.y;        // src/editor/inspector.js:6886
```

- `imgAsp` = the layer's own ratio `texW/texH`, fixed — `inspector.js:6437`.
- `aspect.y` = a **canvas** factor from butterchurn:
  `(canvasW > canvasH) ? canvasH/canvasW : 1` — `src/vendor/butterchurn.js:2314`.
  The uniform is `vec4(aspectx, aspecty, 1/aspectx, 1/aspecty)` — `butterchurn.js:3852`.
- `texsizeX/Y` track the canvas's real width/height (not square) — `butterchurn.js:2311-2312, 2484-2485`.

The correction only ever touches **x** with `aspect.y`; it never uses `aspect.x`.
That asymmetry is the whole issue.

### The math

Work out the layer's displayed pixel ratio:

```
displayed ratio = imgAsp × aspect.y × (canvasW / canvasH)
```

- **Landscape or square canvas** → `aspect.y × (canvasW/canvasH) = 1` → layer shows
  at its true `imgAsp`, and this holds for **any** landscape ratio. Stable. ✅
- **Portrait canvas** → `aspect.y` clamps to `1` → factor becomes `canvasW/canvasH < 1`
  → layer is **squished horizontally**, more so the taller the canvas. ❌

So the shape only drifts when the canvas crosses the **1:1 line into portrait**.

### Why editor → full screen triggers it

Editor preview is sized `(innerWidth − 340) × (innerHeight − topbar)`, min width 120 —
`src/editor/main.js:194-200`. In a narrow/normal window that width can fall **below** the
preview height → the **preview is portrait** while full screen is landscape. Crossing
that boundary is exactly where a layer jumps shape. (Same thing if the output ever lands
on a vertical/portrait monitor.)

> ⚠️ **One data point still worth capturing:** the editor window's actual pixel size when
> the reshape looks worst (or a screenshot of the same layer in editor vs full screen).
> If both contexts are landscape the math says the shape is already stable — so confirm the
> trigger really is the portrait crossover before we lean on it. (Per CLAUDE.md "verify
> before coding".)

---

## 3. The two modes

| Mode | GLSL x-divisor factor | Displayed ratio | Behavior |
|---|---|---|---|
| **Lock** (DEFAULT — asset integrity) | `aspect.y / aspect.x` | `imgAsp` **always** | true shape in every orientation; never reshapes |
| **Fluid** (opt-in) | `aspect.y` (= today) | `imgAsp × aspect.y × canvasW/canvasH` | true shape in landscape, adapts/squishes in portrait |

### Why `aspect.y / aspect.x` is the correct Lock factor

We want `displayed ratio = imgAsp` for all canvases. Solving:

```
need x-divisor factor = canvasH/canvasW = aspect.y / aspect.x   (identity, holds both orientations)
```

Equivalent forms (all use uniform components that already exist — **no new plumbing**):
`aspect.y / aspect.x`  ==  `aspect.y * aspect.z`  (since `aspect.z = 1/aspectx`).

**Backward-compat is automatic:** in landscape `aspect.x = 1`, so `aspect.y / aspect.x == aspect.y`.
Lock mode is therefore a **no-op on landscape canvases** and only adds the missing portrait
correction. Fluid mode emits the *exact current string* — byte-for-byte unchanged.

### 3a. Which mode is default — and why flipping is safe

**Lock is the default.** Rationale (user call): a layer should show its true shape unless the
user deliberately distorts it; with so many distortion sliders already (width/height, skew,
perspective), an *involuntary* canvas-driven squish is confusing. Integrity = baseline, all
distortion = opt-in.

Flipping the default is safe because the two modes are **identical on every landscape canvas**:

- Full-screen on a landscape monitor → **no change** for any existing preset.
- The modes differ **only on portrait canvases** (narrow editor window, vertical monitor),
  where Lock *un-squishes* — i.e. corrects an artifact no preset author designed for.

So this is a "bug fix with an opt-out," not a breaking change.

**Honest caveat 1:** a layer that was sized to look right *in a portrait editor window* will
shift shape in that view. Rare; the new shape is the more defensible one.

**Honest caveat 2 — overflow (found via aspect-test.html, 2026-05-25):** LAYER SIZE is
height-relative (object height = size × canvas height). Lock keeps width = height × trueRatio,
so on a **portrait** canvas a *large* object's width can exceed the canvas width and clip at the
sides. Fluid hid this by squishing the object to fit — the very distortion we're removing. This
is the inherent cost of "keep shape": preserve shape OR guarantee fit, not both. Only bites
large objects on strongly portrait canvases (app default size 0.25 fits even at 9:16; it was
only obvious in the test because the test size default was 0.7). Cannot happen on landscape
(Lock == Fluid there). **Decision: accept it** — keeping true shape and letting the user scale
down is more correct than silently distorting. Revisit only if it bites in practice.

**Mechanics of the flip:** set the default in `_normalizeImageEntry` D to `aspectMode: 'lock'`.
Old presets without the field load as Lock; presets saved after shipping store whatever the
user picked. No migration, no resave.

### 3b. Precedent: grid Fit/Fill is already Lock/Fluid (scoped to cells)

The grid **Fit vs Fill** setting is the same dichotomy, already shipped — proof the model
works and that users accept it.

- **Fill** (`inspector.js:6729-6731`): image mapped straight onto the cell's `0..1` box. A
  cell is `canvasW/cols × canvasH/rows` px, so displayed shape **= cell shape = canvas shape ×
  rows/cols**. Fully canvas-dependent; never preserves the image ratio. = **Fluid**, per cell.
- **Fit** (`inspector.js:6716-6726`): scales UV to preserve `imgAsp` inside the cell, leftover
  axis pushed outside `[0,1]` → transparent letterbox/pillarbox pad. Image shape stays constant
  as the canvas changes; only the *padding* adapts. = **Lock**, per cell.

| Grid (per-cell) | Whole-layer (this plan) | Meaning |
|---|---|---|
| **Fit**  | **Lock** (default)  | keep image's true ratio |
| **Fill** | **Fluid** (opt-in)  | conform to canvas/cell |

**Important:** Fit's `_cellAR = aspect.y * rows/cols` used the **same one-sided `aspect.y`**, so
Fit *also* had the portrait bug — correct in landscape, mis-pads/distorts in portrait. **Fixed in
Phase 3 (2026-05-25):** swapped to `aspect.y / max(aspect.x, 0.01)` at all three grid sites
(`cellAspectExpr`, both Fit `_cellAR`); the inert Lock/Fluid toggle is hidden in grid (Fit/Fill
is grid's shape control).

> Not pixel-verified at edge cases (e.g. 1×1 grid + extreme image ratio) — the conceptual
> behavior above is the code's *intent* and holds in landscape. If certainty is needed, run the
> app against a wide vs tall canvas and observe directly (per CLAUDE.md "verify before coding").

---

## 4. The right way — one choke point

`aspect.y` appears at many sites, but they fall into **two unrelated jobs**:

**(A) Layer footprint** — sets the layer's overall on-screen shape. This is the one we gate.
Single source: the `aspectPreScale` helper at `inspector.js:6885-6891`, consumed by:

| Site | Mode it serves |
|---|---|
| `inspector.js:7146` | single non-tiled image (most visible — logos, text) |
| `inspector.js:7131` | plain tiled |
| `inspector.js:7099, 7104` | tunnel (`_uA`, `_uB`) |
| `inspector.js:7121` | scatter (non-grid) |

Gating **only** `aspectPreScale` covers single + tiled + tunnel + scatter — i.e. the
layers the user actually sees reshape. **This is the whole v1.**

**(B) Internal cell / orbit squareness** — keeps *tiles, grid cells, and orbits* square,
independent of overall layer shape. **Leave these alone in v1** — they are a different axis
of correctness and changing them risks regressions for no user-visible gain:

- `inspector.js:6544` `cellAspectExpr` — per-cell rotation squareness
- `inspector.js:6615, 6621` — orbit radius correction
- `inspector.js:6646-6652` — density orbit sizing
- `inspector.js:6729-6731, 6974-6976` — scatter cell sizing (size division stays square)
- `inspector.js:6718, 7032` — grid "Fit" cell aspect

> **Grid mode** (`useGrid`) deliberately **skips** `aspectPreScale` (`useGrid ? '' : …`).
> Grid cells are already canvas-AR-aware via `cellAspectExpr`. Locking grid is a separate,
> later question — out of v1 scope.

---

## 5. Implementation plan (phased, each phase independently shippable)

### Phase 0 — data field
- Add `aspectMode: 'lock'` to the defaults object `D` in `_normalizeImageEntry`
  (`inspector.js:7604-7639`). `{ ...D, ...entry }` means **old presets without the field load
  as `'lock'`** → unchanged on landscape, un-squished on portrait (see §3a). No migration.
- Add the same default to the new-layer factory paths that build `entry` (image add
  `~2867`, video add `~3234`, text add `~3406`) so freshly added layers carry it explicitly.

### Phase 1 — shader gate (the actual fix)
One change, in `aspectPreScale` (`inspector.js:6885`):

```js
const aspectPreScale = (varName) => {
    // Footprint aspect factor. lock (default) = orientation-independent. fluid = legacy (aspect.y).
    const aspFactor = img.aspectMode === 'fluid' ? 'aspect.y' : '(aspect.y / max(aspect.x, 0.01))';
    let s = `    ${varName}.x /= ${imgAsp} * ${aspFactor}`;
    if (!tscXIsDefault) s += ` * ${tileScaleX}`;
    s += `;\n`;
    if (!tscYIsDefault) s += `    ${varName}.y /= ${tileScaleY};\n`;
    return s;
};
```

- Fluid branch emits the identical pre-feature string → existing presets untouched.
- Lock composes cleanly with the width slider (`tileScaleX`) — independent factors multiply.
- Optional safety: `aspect.x` can approach 0 only for extreme portrait; clamp if paranoid
  (`max(aspect.x, 0.01)`), but it is never literally 0 for a real canvas.

### Phase 2 — UI control
- A small segmented control / toggle on each layer card: **Fluid · Lock**.
  Not a slider, so the **`.layer-slider-row` `:not()` index-shift landmine does NOT apply**
  here — but anyone wiring it near the slider rows must keep that rule in mind
  (see memory `feedback_image_layer_slider_pattern`).
- On toggle: set `entry.aspectMode`, call the same rebuild path the other layer controls
  use (`_buildCompShader()` / re-render), mark dirty.
- Tooltip: "Lock = keep this layer's shape on any canvas. Fluid = let it adapt to the
  canvas (current)." Keep it short (memory `feedback_slider_discovery_ux`).

### Phase 3 — grid mode (audited + ✅ SHIPPED 2026-05-25)

> **Shipped & verified 2026-05-25:** both parts done in `inspector.js` — (1) all three grid sites
> swapped to `aspect.y / max(aspect.x, 0.01)`; (2) Lock/Fluid row hidden in grid via
> `syncGridVisibility` + initial render. `node --check` clean; confirmed working in-app.

**Audit.** Grid mode (`useGrid`) deliberately **skips `aspectPreScale`**, so the shipped
Lock/Fluid toggle is **inert in grid** — it shows on the card but does nothing (minor UX wart
from Phase 2). Grid's aspect handling lives in three `aspect.y`-only sites:

- `inspector.js:6544` `cellAspectExpr = aspect.y * rows/cols` — per-cell rotation squareness
- `inspector.js:6734` grid **Fit** padding: `_cellAR = aspect.y * rows/cols`
- `inspector.js:7032` same Fit math in the scatter+grid branch

A grid cell's true screen aspect is `(canvasW/canvasH) * rows/cols`. The code encodes that via
`aspect.y` (= `canvasH/canvasW` in landscape, **clamps to 1 in portrait**) — so, exactly like
the density bug, grid **Fit preserves image aspect correctly in landscape but mis-pads/distorts
in portrait**. (Confirmed conceptually in §3b.) Grid's "keep image shape" control is **Fit**
(Fit ≈ Lock, Fill ≈ Fluid), so grid doesn't need the Lock/Fluid footprint toggle at all.

**Plan (two parts, both small):**

1. **Functional — portrait-correct the grid aspect.** Replace `aspect.y` with
   `(aspect.y / max(aspect.x, 0.01))` at the three sites above. No-op in landscape (aspect.x=1),
   fixes portrait. Makes grid **Fit** and per-cell rotation portrait-correct, consistent with
   the density Lock fix. This is the same one-term substitution.
2. **UX — hide the inert toggle in grid.** Gate the Lock/Fluid row with the same
   `(entry.tileMode||'density') !== 'grid'` condition the Fit/Fill row already uses, so a grid
   layer shows **Fit/Fill** (its real aspect control) and not the inert Lock/Fluid.
   *Recommended: (A)* — grid is then always portrait-correct, no per-mode aspect branching.
   *(Alternative (B): gate the grid aspect.y on `aspectMode` too, keeping a Fluid-grid legacy
   option. More consistent toggle, more branching, no real creative payoff — skip unless asked.)*

**Verify:** portrait canvas + grid + Fit → image keeps aspect, padding correct (was squished
before); landscape grid → pixel-identical to today; Fill unaffected; toggle no longer shows in grid.

---

## 6. Why this is safe and not a rewrite

- **Identical on every landscape canvas.** Default flips to Lock, but Lock == Fluid in
  landscape, so full-screen on normal monitors is unchanged. Only portrait canvases differ,
  where Lock *corrects* the accidental squish (see §3a).
- **The Fluid opt-in is the exact current string, verbatim.** Anyone who wants today's
  behavior on portrait can select it per layer.
- **One function changes** (`aspectPreScale`) for the entire fix. Everything else is a data
  default + a UI button.
- **No new uniforms / no butterchurn changes** — `aspect.x` is already uploaded.
- **No persistence migration** — absent field ⇒ `'lock'` via the existing normalize merge.
- Each phase is reversible and independently shippable.

---

## 7. Open decisions

1. **Granularity** — per-layer toggle (recommended; matches the per-layer slider model and
   the user's "objects" framing) **or** a single global preset-level toggle (one control,
   one branch, even simpler, but all-or-nothing). *Default recommendation: per-layer.*
2. **v1 scope** — confirm v1 = `aspectPreScale` choke point only (single + tiled + tunnel +
   scatter), with grid deferred to Phase 3. *Default recommendation: yes.*
3. **What "Fluid" means as the opt-in** — (a) today's behavior (adapts/squishes only on
   portrait), or (b) a true free-stretch (square → wide on any canvas, landscape included).
   *Recommendation: (a) to avoid scope creep; (b) is a separate effect we can add later.*
4. **Artifact** — capture the editor window pixel size / a before-after screenshot to
   confirm the portrait-crossover diagnosis before coding.

---

## 8. Verification checklist (when we build)

- [ ] Old preset, **landscape** full screen → **pixel-identical** to before (Lock==Fluid there).
- [ ] Old preset, **portrait** canvas → now shows true shape (un-squished). Confirm this reads
      as a correction, not a regression.
- [ ] Default Lock layer: same shape in a portrait editor window AND landscape full screen.
- [ ] Switch a layer to **Fluid** → reproduces today's portrait squish (the opt-in works).
- [ ] Lock + width/height sliders (`tileScaleX/Y`) compose correctly.
- [ ] Lock on a tiled layer and a tunnel layer (not just single).
- [ ] Save → reload → mode persists; pre-feature preset loads as Lock.
- [ ] Output window / second monitor (incl. a portrait monitor if available).
- [ ] Update this doc's status table + relevant -dev.md after shipping
      (memory `feedback_always_update_docs`).

---

## 9. Screen-draw rule (load-bearing — read before touching canvas sizing)

**The drawing buffer must match the canvas's actual on-screen size, or everything distorts.**

The visualizer renders into the canvas drawing buffer (`canvas.width/height`, set via
`engine.setSize → setRendererSize`). The browser then scales that buffer to the canvas's CSS
display box. If the two disagree in aspect, the whole scene — Milkdrop, every layer, the lot —
is **CSS-stretched**, and the `aspect` uniform is wrong too (it's derived from the buffer). This
is invisible to the shader/Lock logic; it's pure plumbing, and it hits the entire layered stack
at once.

Consequences / rules:
- `editor/main.js sizeCanvas()` is the **sole sizing authority** in Preset Studio (`visualizer.js`
  has no resize listener). Anything that changes the canvas's display size — window resize,
  **panel show/hide (focus mode)**, layout breakpoints — must re-run `sizeCanvas()` with the
  *real* display width, not a computed `innerWidth − panel` guess.
- The focus-mode bug (fixed 2026-05-25) was exactly this: it kept subtracting the 340px panel
  after the panel collapsed to `width:0`, so the buffer stayed 340px narrow and got stretched.
- When in doubt, size the buffer from the canvas's measured box, never from a hardcoded panel
  constant. (Current fix branches on `focusMode`; a measured `clientWidth/Height` is the more
  future-proof form if the layout grows more states.)
- This rule is independent of Lock/Fluid: Lock fixes *per-layer* aspect inside a correctly-sized
  canvas; this rule keeps the *canvas itself* correctly sized. Both must hold for the layered
  interface to draw true across editor ↔ full screen ↔ output.

---

## Appendix — key references

- Footprint correction: `src/editor/inspector.js:6885-6891` (`aspectPreScale`)
- `imgAsp` source: `inspector.js:6437`
- Consumers: `inspector.js:7099, 7104, 7121, 7131, 7146`
- Cell/orbit squareness (leave alone v1): `inspector.js:6544, 6615, 6621, 6646-6652, 6729-6731, 6974-6976, 6718, 7032`
- Layer defaults / normalize: `inspector.js:7604-7639`
- New-layer factories: `inspector.js:~2867 (image), ~3234 (video), ~3406 (text)`
- Aspect uniform: `src/vendor/butterchurn.js:2311-2314 (compute), 3852 (upload)`
- Editor preview sizing: `src/editor/main.js:194-200`
