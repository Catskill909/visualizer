# Add Tracks — Timeline Multi-Track (Design & Dev)

**Status:** ✅ **PHASE A SHIPPED & VERIFIED 2026-05-24.** Full Screen multi-track works: add/remove track, transparent gaps (empty upper track reveals beneath), top-row=front z-order — **and the stacked tracks composite correctly to the main/program output** (verified live). Next code work: [Phase B](#phase-b-task-checklist-regions--do-not-start-until-a-is-verified) (per-region output for multi-region layouts). Design rationale is in [Design Decisions](#design-decisions).

---

## 🧭 Read this first (handoff brief)

> **If you are a new chat window / a different AI picking this up cold, read this block, then the [Phase Board](#-phase-board), then jump to the current phase. That's enough to start.**

- **What we're building:** the ability to **add / remove / stack tracks** in the Timeline Editor, beyond the 6 fixed zone layouts. Now that transparent-bg presets ship on all platforms (see [`transparent-dev.md`](transparent-dev.md)), the timeline is a real **layer compositor**.
- **The single most important fact:** *a "track" already **is** a "zone" in the code.* The strip renders one row per object in `this._tl.zones`. "Multi-track" = "more than one zone object in that array." Most plumbing (create/teardown canvases, persistence, export/import, stack compositing) is **already dynamic** and needs no change. See [Audit](#architecture-audit).
- **Where the real work is:** (1) an **add-track button** + unique-id generation, (2) the **transparent-gap primitive** (an empty upper track must reveal the track beneath, not paint black), (3) the **top-row = front-layer** z-order convention (also fixes a reported bug).
- **Start small on purpose:** Phase A is **Full Screen only** — one region, one program output, no per-track output routing. This isolates *track* mechanics from *region/output* mechanics. Regions (Left/Right etc.) come in Phase B.
- **Project rule (CLAUDE.md):** before writing code for a phase, post the plain-English execution trace (current behavior → desired behavior → exact edits) and wait for "go ahead." This doc is that plan at the design level; the per-phase trace is the code-level confirmation.
- **Doc rule (memory):** update this doc's [Phase Board](#-phase-board) immediately after every change — tick tasks, move the "current phase" pointer, log what shipped.

---

## 📋 Phase Board

> **To re-prioritize: reorder phases. The top unchecked phase is what gets built next.**
> **Current phase:** ✅ **Phase A shipped & verified.** Next code work: **Phase B** (top unchecked phase).

| Phase | Scope | Status |
|-------|-------|--------|
| **A** | Full Screen multi-track — add/remove track, transparent gaps, z-order convention | ✅ Shipped & verified 2026-05-24 |
| **B** | Regions — per-region output routing for Left/Right & other multi-region layouts; tracks inherit region output | ⬜ Not started (next) |
| **C** | Polish — per-track rename / color / solo-mute, drag-to-reorder z-order | ⬜ Not started |

### Phase A task checklist (Full Screen only)

- [x] **A1 — Add-track button.** ✅ `_addTrack()`, triggered by **`+ Add Track` in the transport row** (right of the time count — `#tl-btn-add-track`; moved there from a dedicated strip row to save vertical space). Pushes a full-frame zone with a unique `generateId()`, next-highest `zIndex`, `gapBehavior:'transparent'`, `output:null`. `_canAddTrack()` gates it; `_updateAddTrackBtn()` shows the button only in the Full Screen layout and disables it at `ADD_TRACK_MAX` (4). Mid-playback: starts the new slave's render loop before rescheduling.
- [x] **A2 — Remove-track.** ✅ `_removeTrack(zoneId)` + a per-track `×` (`tl-zone-remove-btn`, added tracks only). Drops the zone, filters its `entries`, clears its preset memory; `_syncZoneCanvases` tears down its canvas/cover and now halts the orphaned slave's render loop. Base `'full'` and the last track are never removable.
- [x] **A3 — Transparent-gap primitive.** ✅ Single-point branch in `_fadeZoneCover`: `gapBehavior:'transparent'` fades the **canvas** opacity (reveal beneath) instead of the black cover. `_syncOutputs` + `_composerLayers` read canvas opacity for those zones; `_positionCanvas` no longer clobbers a mid-gap fade. New tracks default `'transparent'`; base stays `'black'`. (`_playZone` already routed all hide/reveal through `_fadeZoneCover`, so playback/scrub/stop are covered for free.)
- [x] **A4 — Z-order convention (top row = front).** ✅ `_renderZoneRows` renders rows sorted by `zIndex` **descending**; base `'full'` (zIndex 0) sits at the bottom; `_addTrack` assigns `maxZ+1`. Fixes the reported Left/Right row-order inversion too.
- [x] **A5 — Suppress output chip on Full Screen.** ✅ `_createZoneRow` hides the output chip when `_allFullFrame()` (every zone full-frame = the Full Screen layout).
- [x] **A6 — Verify (live).** ✅ **Verified 2026-05-24.** Stacking works on the operator screen **and** the stacked tracks composite to the main/program output. Empty upper track reveals beneath (not black); strip row order matches the composite. This unlocks "run multiple tracks to the main out."

### Phase B task checklist (regions — do NOT start until A is verified)

- [ ] **B1 — `regionId` field** on each zone; tracks sharing a `regionId` share rectangle + output.
- [ ] **B2 — Per-region output routing.** Move routing from per-zone to per-region in `_renderOutputRoutes` / `_assignZoneOutput`: assign once, all tracks in the region inherit `zone.output`.
- [ ] **B3 — Add-track within a region.** The `+` inside Left/Right/etc. stacks a new track in that region (same rect, next zIndex within the region).
- [ ] **B4 — Verify** on Left/Right and 4 Quadrants: per-region output, per-region stacking, output mirror correct.

### Phase C task checklist (polish — independent of B)

- [ ] **C1 — Per-track metadata UI:** rename, color, solo/mute (some zone fields already exist).
- [ ] **C2 — Drag-to-reorder** a track's z-position within its region/stack.

### Changelog (newest first)

- **2026-05-24** — **UI:** moved **+ Add Track** out of its own strip row into the **transport row, right of the time count** (`#tl-btn-add-track`) — the dedicated row wasted vertical space. Shown only in Full Screen, disabled at the 4-track cap (`_updateAddTrackBtn`). Removed `_createAddTrackRow`, the strip-height reservation, and the `.tl-add-track-row` CSS. `vite build` clean.
- **2026-05-24** — **Bugfix (Phase A):** removing a track's **last clip while playing** left the preset still painting (over the base, for a transparent track). Cause: `_playZone` early-returned on a zero-entry track and never hid it — and VJ-mode engines never stop rendering. Fix: the zero-entry path now hides the zone (`_fadeZoneCover(zoneId,1,0)` → black cover for base / canvas→transparent for an overlay) + clears preset memory. General correctness fix (the base track shared the latent bug). `vite build` clean.
- **2026-05-24** — **Phase A SHIPPED & VERIFIED** (A1–A6). Live-confirmed: Full Screen multi-track stacking on the operator screen and composited to the main/program output. "Multiple tracks → main out" now works.
- **2026-05-24** — **Phase A built** (A1–A5). Add/remove track, transparent-gap primitive, top-row=front z-order, output-chip suppression on Full Screen. `vite build` clean. Files: `src/timeline/timelineEditor.js`, `src/timeline/style.css`. New symbols: `ADD_TRACK_MAX`, `TRACK_COLORS`, `_isFullFrameZone`, `_allFullFrame`, `_canAddTrack`, `_createAddTrackRow`, `_addTrack`, `_removeTrack`.
- **2026-05-24** — Design approved. Doc rewritten from placeholder to phased plan. No code yet.

### Implementation notes & known follow-ups (from the Phase A build)

- **GL context on remove.** `_removeTrack` halts the orphaned slave's render loop but does **not** `destroy()` the engine (slaves share audio nodes with the primary, so destroy is unsafe without more care). The WebGL context is released by GC when the canvas/engine are dropped. With the 4-track soft cap and infrequent add/remove this is fine; revisit if context exhaustion ever shows up.
- **`_currentLayoutKey()` goes null after add-track** (expected — the zone list no longer matches a fixed layout). Effect: the Zones modal highlights no tile, and re-clicking **Full Screen** re-applies it (resets to a single track, with the usual confirm if entries exist). Acceptable; revisit only if it confuses.
- **Transparent canvas owns its own opacity** now (`_positionCanvas` skips it for `gapBehavior:'transparent'`). Stack-control opacity (Phase B `_buildStackControls`) writes `zone.opacity`; the fade math already scales by `zone.opacity`, so the two compose — but this pairing is untested until Phase B exposes the control on full-frame stacks.

---

## Architecture audit

*Verified against `src/timeline/timelineEditor.js` and `src/timelineStorage.js` on 2026-05-24. Line numbers drift — search by function name.*

**A "track" is a "zone."** There is no separate track concept. `_renderZoneRows` iterates `this._tl.zones` and creates one row per zone. Add an object to that array and the strip grows a row.

**The plumbing is already dynamic** — these need **no change** for add-track:
- **Canvas reconcile.** `_syncZoneCanvases` diffs `this._tl.zones` vs live canvases: it creates a slave `VisualizerEngine` + `<canvas>` + black cover for any new zone and tears down any removed one.
- **Persistence.** `zones` is a plain array on the timeline object; `saveTimeline`/load and `createTimeline` restore it (`timelineStorage.js`, `zones: data.zones?.length ? data.zones : [defaultZone()]`).
- **Export/import.** `exportTimelineBundle` serializes the whole timeline (incl. `zones`); entries reference `entry.zoneId` by string, which survives the round-trip.
- **Stack compositing.** `_syncOutputs` groups zones by display, sorts by `zIndex`, composites with per-layer opacity/blend; `_buildStackControls` is the per-layer blend+opacity UI.

**Three gotchas that shape the build:**

1. **`'full'` is a special, shared id.** Every fixed layout's base zone is `id: 'full'` (`mkZone('full', …)`), which maps to the **primary** engine (`this._zoneMap.set('full', { canvas, engine })` in the constructor). Zone ids are layout-local, not globally unique. **Added tracks need freshly-generated unique ids; `'full'` must stay the bottom/base layer.**
2. **Two different `+` buttons.** Each zone row already has a `+` that opens the *preset picker* (add a clip) — `_createZoneRow` → `_openPicker(zone.id)`. The **add-track** `+` is a **new, separate** control at the region level. Keep them visually distinct.
3. **Covers fade to black today.** `_fadeZoneCover` raises a black cover when a clip ends. For a stacked upper track that's wrong — it would black out the track beneath. Transparent gaps are a **hard dependency** of stacking, not a nice-to-have (A3).

**Zone shape** (`mkZone`): `{ id, name, color, region, opacity, blendMode, zIndex, gapBehavior, output }`.
**Canvas z-layout:** canvas at `zIndex*2`, its black gap-cover at `zIndex*2+1` (interleaved so a lower zone's cover can't black out an overlay above it — see `_positionCanvas` / `_syncZoneCanvases`).

---

## Design Decisions

### 1. Region vs. track (the model)

Two-level model, but represented **flat** to avoid a multi-file rewrite:

- A **region** owns a rectangle on the operator screen **and** an output assignment.
- Within a region, a **stack of tracks** composite together (z-order/blend/opacity) and **share that region's output**.
- **Full Screen = 1 region** (whole frame) → output is just "the program," so **no per-track routing UI**.
- **Left/Right = 2 regions**, each with its own output; tracks added inside a region ride that region's output.

**Representation:** keep `this._tl.zones` **flat**; (Phase B) add a single `regionId` field. Tracks with the same `regionId` share rect + output. **Rejected:** a nested `regions: [{ rect, output, tracks: [] }]` model — cleaner on paper, but rewrites every `this._tl.zones` reader, `_syncOutputs`, `_syncZoneCanvases`, storage, and export/import. The flat+tag approach gets identical behavior with far less blast radius (CLAUDE.md: avoid multi-file refactors for one problem).

**Phase A needs no `regionId` at all** — every track is full-frame, one program output, no chips. That's why Full Screen is the right starting point: it isolates track mechanics from region/output mechanics.

### 2. Z-order convention: top row = front layer

Today array-order = row-order = zIndex, and the result is **inverted**: in Left/Right, `Left` (zIndex 0, bottom layer) renders as the **top** row. Adopt the **Photoshop convention — top row = front layer**:

- Render rows sorted by `zIndex` **descending**.
- Base `'full'` stays `zIndex 0` → bottom row.
- Add-track assigns the **highest** `zIndex` → new track lands on top.

This makes the strip read like the composite **and** fixes the reported Left/Right inversion. (For non-overlapping regions it's cosmetic; for stacked tracks it's the whole point.)

### 3. Transparent gaps (required for stacking)

For `gapBehavior: 'transparent'` zones, "hide" must **animate the canvas opacity to 0** (reveal the track beneath) instead of raising the black cover. Base/bottom track stays `gapBehavior: 'black'`. The output mirror (`_syncOutputs` / `_composerLayers`) must read the matching opacity source so the program feed reveals beneath identically. New upper tracks default to `'transparent'`.

### 4. Output model

- **Full Screen (Phase A):** the whole stack composites to the single program output. No per-track output chip.
- **Multi-region (Phase B):** output is **per-region**, shared by all tracks in that region. Assign once on the region; tracks inherit `zone.output`.

---

## Scope flags

- **Perf cap.** Each track is a full slave `VisualizerEngine` (own WebGL context + render loop). Stacked full-screen Butterchurn engines are the cost ceiling. **Soft-cap Full Screen at ~3–4 tracks; measure before raising.** (Consistent with the v1-beta note that engines are the budget.)
- **`_currentLayoutKey()` goes stale.** Once a track is added, the zone list no longer matches any of the 6 fixed layouts, so the Zones modal highlights nothing. Minor — accept it, or stash the base layout key separately.
- **Migration.** Existing saved timelines load unchanged (they're just 1-zone-per-region arrays). The 6 fixed layouts stay as quick-start presets; add-track grows from whichever you pick.

---

## 💡 Parked — "Overlay" layout as a one-off (superseded by this plan)

Earlier we considered a dedicated full-screen **"Overlay" layout** (two full-screen zones, `Base` + `Overlay`, top gaps transparent). **Parked deliberately** — it's a one-off special case of exactly what add-track generalizes. The transparent-gap mechanism (Design §3) belongs here, not as a bespoke layout. An empty *region* showing black is still correct; transparent gaps apply only to *stacked* tracks.

---

## Related docs
- [`output-dev.md`](output-dev.md) — A3 stacking, `zone.zIndex/opacity/blendMode`, the overlay model, per-display routing. (§0 status block is the output truth source.)
- [`transparent-dev.md`](transparent-dev.md) — per-layer alpha (the reveal that makes stacking shine); shipped & cross-platform verified.
- [`timeline-editor.md`](timeline-editor.md) — zones, the 6 layouts, the strip, `ZONE_COL_W`, the status dashboard.
