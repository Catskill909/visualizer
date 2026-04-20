# Custom Preset Editor — Brainstorm

> **Status:** 💭 Brainstorm. Not a plan yet. Goal is to map the design space, pick a
> shape we like, then cut scope aggressively before any code gets written.

## The ask

Let users author their own presets **inside DiscoCast**, with images as a first-class
input. Clean, modern, intuitive — no Winamp-era 1998 pixel salad.

Two things make this non-trivial:

1. Butterchurn presets are a dense JSON of ~80+ baseVals + 4 shapes + 4 waves + two
   fragment shaders + equation strings. Exposing all of it = overwhelming. Exposing
   too little = the editor makes boring presets.
2. Images aren't bolted on — they flow through the shader's `sampler_*` bindings. UX
   needs to make that pipeline feel like "drop image → see it move," not "learn GLSL."

## What lives in a preset (so we know what we're editing)

From `node_modules/butterchurn-presets/presets/converted/*.json`:

- **`baseVals`** — the big flat bag. ~80 knobs: `decay`, `gammaadj`, `zoom`, `rot`,
  `warp`, `warpscale`, `warpanimspeed`, `echo_zoom`, `echo_orient`, `wave_mode`,
  `wave_r/g/b/a`, `wave_thick`, `ob_/ib_` border colors, `mv_x/y/l/r/g/b/a` motion
  vectors, `b1ed`.
- **`shapes[0..3]`** — up to 4 custom shape primitives (each has own baseVals).
- **`waves[0..3]`** — up to 4 custom waveforms.
- **`init_eqs` / `frame_eqs` / `pixel_eqs`** — MilkDrop expression strings (per-frame
  / per-pixel math). This is the "programming" surface.
- **`warp` / `comp` shaders** — fragment GLSL. Where `sampler_<name>` textures get
  sampled for image-driven effects.

Not every preset uses every field. Most user-created ones won't touch shaders at all.

## Editor shape — three tiers

Rather than "one editor to rule them all," tier by ambition so the first-time user
isn't staring at a shader IDE.

### Tier 1 — **Remix** (90% of users will stop here)

Start from an existing preset. Tweak. Save as new.

- Pick any preset from the drawer → **"Remix this"** button.
- Opens a right-side **Inspector** panel over the live canvas (audio keeps playing).
- Inspector shows ~15 curated controls grouped by visual effect, not by JSON key:
  - **Motion** — zoom, rotation, warp amount, warp speed
  - **Color** — gamma, decay (trail length), invert, tint
  - **Waveform** — mode (dropdown: dot, line, spiral, radial…), thickness, color
  - **Echo** — zoom, orientation
  - **Audio reactivity** — bass/mid/treble response strength (these map to a few
    `b1ed`-ish / motion vector fields; we hide the naming)
- Every slider is **live** — visualizer updates on drag, no apply button.
- **A/B button** in header — hold to preview original, release to see your edits.
  Non-destructive comparison.
- **Randomize** icon on each group — locks the others, rerolls that group only.
  (The "surprise me" button done right.)
- **Save as…** → name + optional tag, stored in localStorage as a custom preset.

This tier alone is probably 70% of the perceived value and 20% of the code.

### Tier 2 — **Image Mode** (the differentiator)

The thing no other Butterchurn fork does well. Make image-driven presets feel like
Instagram filters reacting to music, not a GLSL lecture.

**Flow:**

1. User drops an image (or picks from a built-in gallery — nebula, geometric, noise).
2. Image becomes a **layer** in the preset with 3 treatment presets:
   - **Bloom** — image blurred/glowing, reacts to bass (scale pulses on kick)
   - **Warp target** — image used as the warp field, waveform drawn on top
   - **Echo source** — image feeds the feedback buffer, audio deforms it
3. A strength slider and audio-band dropdown (bass/mid/treble) per layer.
4. Layers compose via a simple blend-mode dropdown (screen / add / multiply).

Under the hood each treatment is a pre-baked shader snippet bound to a
`sampler_userimage_0` etc. We ship 3–5 snippets; users pick from a visual grid, not
a code editor. The image goes into IndexedDB (localStorage is too small for base64).

**Critical UX choices:**

- Thumbnails of the image show the actual baked treatment — not the raw upload. So
  "Bloom" preview looks like bloom, not the original photo.
- Max 2 image layers per preset at first. Artificial constraint that keeps the UI
  from becoming Photoshop.
- Show warning if image > 2MP (auto-downscale, don't block).

### Tier 3 — **Shader / Equation editor** (power users, gated)

A `</>` toggle in the Inspector header reveals the raw fields: `warp`, `comp`,
`frame_eqs`, `pixel_eqs`, full `baseVals` JSON. Monaco editor with GLSL + MilkDrop
eq syntax highlighting.

Gated because:

- Broken shaders = black screen = user thinks the app crashed.
- We need a **Safe Mode** — if compile fails, show the error inline and keep rendering
  the last valid version. Never ship a preset that breaks the canvas.
- An inline **"Restore last working"** button appears on compile error.

Don't build this first. But design the data model so it's not a rewrite to add later.

## Control inventory — what maps to what

Avoid inventing custom widgets. Pick a small set, use them consistently.

| Widget | When to use | Notes |
|---|---|---|
| **Labeled slider + numeric input** | Any float/int knob | Dual mode — drag for feel, type for precision. Shift-drag = fine, Alt-drag = coarse. |
| **Color swatch → picker popover** | `wave_r/g/b`, `ob_*`, `ib_*`, tint | Group r/g/b into a single HSL picker. Store as r/g/b under the hood. |
| **Dropdown** | `wave_mode`, blend mode, audio band | With icon preview per option where possible. |
| **Toggle switch** | Booleans (`additivewave`, `wrap`, `modwavealphabyvolume`) | Reuse existing `.switch` component. |
| **Dual-thumb range** | Any `start/end` pair (e.g. `modwavealphastart/end`) | One control, two handles. Half the visual weight. |
| **XY pad** | `mv_x` + `mv_y`, `warp` + `warpscale` when paired | 2D drag feels right for 2D concepts. |
| **Radial dial** | `rot`, `echo_orient` | Angles belong on circles, not lines. |
| **Curve / envelope** | Audio reactivity mapping | Tiny sparkline showing "bass → this param" curve. Only if we add mapping in v1. |
| **Drop zone + thumbnail** | Image layers | Standard drag/drop, paste from clipboard. |
| **Randomize dice** | Per group | Lock other groups, reroll this one. |
| **Reset-to-default** | Per control, subtle | Long-press or right-click. Don't clutter. |

Everything obeys:

- Live update, no Apply button.
- Undo stack (Cmd/Ctrl+Z) with 50-deep history. This is non-negotiable — tweaking
  without undo is miserable.
- All values readable at a glance — no hidden numeric state behind the slider knob.

## Layout sketch

```
┌──────────────────────────────────────────────────────────┬──────────────────┐
│                                                          │  REMIX           │
│                                                          │  Based on:       │
│                                                          │  "Geiss - Thumb" │
│                                                          │  [A/B hold]      │
│                                                          │                  │
│                  LIVE VISUALIZER                         │  ▼ Motion   🎲   │
│                  (full height, audio-reactive)           │  zoom    ●──○──  │
│                                                          │  rotate  ───●──  │
│                                                          │  warp    ──●───  │
│                                                          │                  │
│                                                          │  ▼ Color    🎲   │
│                                                          │  [HSL swatch]    │
│                                                          │  decay   ────●─  │
│                                                          │                  │
│                                                          │  ▶ Waveform      │
│                                                          │  ▶ Echo          │
│                                                          │  ▶ Audio         │
│                                                          │  ▶ Images (0)    │
│                                                          │                  │
│                                                          │  ─────────────   │
│                                                          │  </> Advanced    │
│                                                          │                  │
│                                                          │  [Save as…]      │
└──────────────────────────────────────────────────────────┴──────────────────┘
```

- Inspector is ~340px, slides in from right (mirror of preset drawer, different side
  so both can be open — though typically not at once).
- Collapsible sections. Default-open: the 2–3 most-edited groups. Rest collapsed.
- Header always visible: preset name, A/B, Undo/Redo, Save.
- Bottom: Save as… primary button, `Discard` text link.

## Storage model

- `milkscreen_custom_presets` — map of `id → {name, baseVals, shapes, waves,
  warp, comp, frame_eqs, pixel_eqs, images: [{slot, treatment, audioBand, strength}],
  parentId?: string, createdAt, updatedAt}`.
- `milkscreen_custom_images` — IndexedDB store, blob per imageId. Referenced by
  custom presets.
- Custom presets show in the drawer with a small `★` (or similar) marker and under a
  new **"Mine"** tab next to All / Favorites.
- Export / import as `.json` (images inlined as base64, with a size warning). Sharable
  without a backend.

## Things we should NOT build (yet)

- A full MilkDrop-equation debugger. We're not recreating Winamp's preset editor.
- Collaborative editing, cloud sync, user accounts — no backend, stays local.
- Per-preset audio fingerprinting / beat detection. Use what the visualizer already
  exposes.
- Video as input (just images). Video opens a codec/perf rabbit hole.
- Plugin / extension system for custom widgets.

## Rough build order (if we commit to this)

1. **Scaffolding** — Inspector panel shell, collapse/expand, A/B, undo stack, Save
   as…, Mine tab in drawer. *Nothing editable yet.* Prove the data flow first.
2. **Tier 1 Remix** — the 15 curated controls on baseVals. Randomize per group. Reset.
3. **Image Mode** — IndexedDB, 3 treatments, 2 layers max. The differentiator.
4. **Export / import** JSON.
5. **Tier 3** — advanced shader/eq editor with Safe Mode fallback.

Ship 1–2 together as a usable v1. 3–4 is v2. 5 is v3 (or never).

## Risks / open threads worth thinking about

- **Live updates at 60fps while editing** — recompiling shaders on every keystroke in
  the advanced editor will hitch. Debounce (~300ms) + visible "compiling…" chip.
- **Undo granularity** — per-keystroke on sliders is too noisy. Group by interaction
  (pointerdown → pointerup = one undo entry). Same for numeric inputs (blur commits).
- **Save-as discoverability** — users tweak, navigate away, lose work. Either
  auto-save draft to localStorage every N seconds, or show a "You have unsaved
  changes" warning on close. Leaning auto-save draft.
- **Naming collisions** — 1,144 bundled presets + user customs. Custom presets need a
  distinct namespace so `Mine/My Remix` can't collide with a bundled name of the
  same string.

---

## Open questions (decide before implementing)

1. **Inspector vs. modal vs. full-screen route?**
   Side panel keeps the visualizer visible while editing (good feedback loop), but
   eats horizontal space on laptops. A modal over the canvas is cleaner but hides
   part of the image you're trying to react to. A dedicated `/edit/:id` route gives
   room to breathe but loses the "feels like live DJing" vibe. Leaning **side panel**
   — matches the existing preset drawer pattern and the whole app's feel. Confirm?

2. **Do custom presets participate in auto-cycle / random by default?**
   If yes, a user's first remix immediately lands in rotation — gratifying but could
   surprise people who were "just experimenting." If no, they're opt-in via favorites.
   Leaning **no by default, yes once favorited** — symmetric with how hide works
   (explicit intent required to change cycle pool membership). Confirm?

3. **How advanced is v1 image mode — prebaked treatments only, or free-form slot?**
   Prebaked treatments (Bloom / Warp target / Echo source) are opinionated, fast to
   build, and hard to break. A free-form "bind image to sampler_X, write your own
   shader" is the real power-user story but lands us back in GLSL-editor territory on
   day one. Leaning **prebaked only for v1**, add "custom treatment" as a Tier 3
   follow-on once the shader editor with Safe Mode exists. Confirm?
