# Timeline Editor — Design & Planning Doc

**Architecture:** Standalone page (`/timeline.html`) — self-contained MPA entry in Vite.
**Completed-phase detail:** lives in **[timeline-editor-archive.md](timeline-editor-archive.md)** — this doc keeps only a one-line index of shipped work.
**Last updated:** 2026-05-15 — Restructured: split shipped-phase implementation detail into the archive file; added the Status Dashboard; separated Roadmap (planned) from the Completed index so reading order matches build order. Roadmap #1 (Loop) refined this session — presets and markers kept distinct: preset Loop / Solo in the block menu loops a single preset; markers do all group / region looping.

---

## 📊 Status Dashboard

*Read this section and nothing else to know where the project stands.*

### Legend

| Mark | Meaning |
|------|---------|
| ✅ | Shipped — full detail in the archive |
| 🚧 | Partially shipped — some sub-phases still open |
| ⬜ | Planned — not started |
| 🔬 | Research |

### Recently Shipped

| Phase | What | Date |
|-------|------|------|
| 4.10-A | Real-time Live Editing (mutation reschedule) | 2026-05-12 |
| 4.5 | Double-click to Cue | 2026-05-12 |
| 4.4-B | Block Menu Icon | 2026-05-12 |
| 4.4-A | Block Action Modal | 2026-05-12 |
| 4.8 | Preset Palette Opacity | 2026-05-12 |

### 🎯 Up Next — Priority Order

> **To re-prioritize, reorder the rows in this table.** The top unbuilt row is what gets built next. Full spec for each is in the Roadmap section below (same numbers).

| # | Phase | What it adds |
|---|-------|--------------|
| 1 | Loop — preset & marker looping | Preset Loop (loops a preset's span) / Loop Solo + marker region looping + loop signs (1-B) + relaxed jumps (1-C) |
| 2 | 4.6 — Overlap Crossfade | Overlap width between blocks drives the crossfade duration directly |
| 3 | 4.7 — Undo/Redo | `Ctrl+Z` for the 3 destructive gestures: drag, delete, resize |
| 4 | 4.9 — Zone Stack | Layered compositing — zone opacity + blend-mode popover, overlay layout |
| 5 | 4.11 — Staging Mode | Safe overlay editing; changes commit on the next block boundary |
| 6 | 4.12 — Timeline Sets Switching | Queued set switching + My Sets panel (replaces the topbar dropdown) |
| 7 | 4.13 — Set Export / Import | Portable `.dcset.json` bundles — full show + presets + images |
| 8 | 4.4-C/D/E — Block menu remainder | Full Edit deep-link, block color picker, per-zone preset controls |
| 9 | Phase 5 — Multi-monitor output 🔬 | Route each zone to a separate physical display (research phase) |

### 🚧 Partially Complete — looks done, isn't

| Phase | Shipped portion | Still open |
|-------|-----------------|-----------|
| 3.5 — Active Playhead | Playhead, click-to-seek, automated crossfades | Loop/Loop Solo buttons → **Roadmap #1** |
| 4.4 — Block Settings Menu | A (action modal), B (menu icon) | C/D/E → **Roadmap #8** |
| 4.10 — Live Editing | A (core mutation reschedule) | B (loop state preservation) → ships with **Roadmap #1** |

---

## 📖 How to Use This Doc

- **What's next** is the *Up Next* table above — the single source of priority. Reorder its rows to change priority; nothing else needs editing.
- **Completed phases** are summarized in the *Completed Phases — Index* table. Implementation detail is in **[timeline-editor-archive.md](timeline-editor-archive.md)**.
- **Before touching playback / fade / scrub code**, read *⚠️ CRITICAL: Playback & Cover System* — it exists because of a past regression.
- **When a phase ships:**
  1. Move its detail into the archive file.
  2. Add a row to *Recently Shipped* and to *Completed Phases — Index*.
  3. Remove its row from *Up Next* (and from *Partially Complete* if fully done).
  4. Update *Current State — What's Built*.
- **After every code change**, update this doc (project rule — see CLAUDE.md).

---

## UX Philosophy — The Complexity Ladder

The timeline editor is for setting up presets and playing them in the clearest, smartest way — with room to breathe. The timeline strip is always the clean base. No new UI appears unless the user deliberately asks for it. Each layer of depth opens on a gesture and closes cleanly back to the layer before. The strip itself never gets busier.

| Layer | What you see | How you get there |
|-------|-------------|-------------------|
| 0 | Full-screen canvas + timeline strip | Default |
| 1 | Block menu — controls + Loop/Solo/Mute for one preset | Click the block's menu icon |

**There is no Layer 2.** An all-zones, all-controls Performance Panel was considered and **rejected** — too much UI at once. Multiple Layer-1 block menus can be open simultaneously; that *is* the live orchestration console. You open only the channels you're performing — the rest stay clean. See the Backlog "Block Menu Orchestration Console" entry.

**Evaluation rule:** Does the idea add to the strip, or does it live behind a deliberate gesture? If it adds to the strip, the answer is no.

---

### Timeline Sets — The Core Concept

A **Timeline Set** is a complete, named show arrangement: a full timeline with its zones, blocks, markers, and layout — saved and ready to load. You can have as many as you want. One plays live at any time. Others sit ready to queue.

The name is intentional. "Timeline" grounds it in the editor. "Set" is the DJ/VJ term — a DJ plays sets, switches between them, builds new ones before a show. Every VJ already understands what a set is.

**What a Timeline Set contains:**
- All zones and their layouts
- All blocks (entries) with positions, durations, blend times, labels
- All markers and their actions
- Zone settings (opacity, blend mode, gap behavior)
- The Set name

**What a Timeline Set does NOT contain:**
- The playhead position (always starts from the beginning when loaded)
- Audio source (that's a session-level concern)
- Preset definitions (those live in the preset library — Sets reference preset names only)

**UI naming — used consistently everywhere:**

| Concept | Label in UI |
|---|---|
| Create a new set | **+ New Set** |
| Save current state | **Save Set** |
| The saved name | **[Set Name]** |
| Open the full list | **My Sets** |
| Switch to another | **Queue Set →** |
| Currently queued | **Up next: [name]** |
| Currently playing | **Now: [name]** |

**Data model (`timelineStorage.js`):**
```js
{
  id: string,           // uuid
  name: string,         // user-editable, shown everywhere
  createdAt: number,    // timestamp
  updatedAt: number,
  zones: Zone[],        // full zone definitions
  entries: Entry[],     // all blocks across all zones
  markers: Marker[]     // ruler markers
}
```
No schema change required — this is exactly what `timelineStorage.js` already stores. The rename from "timeline" → "Timeline Set" is purely UI language and naming. The storage key format and CRUD methods are unchanged.

---

### The Boundary Rule

> **Nothing in the timeline switches mid-block. Every transition — staging apply, set change, loop release, cue — waits for the current block to reach its natural end before taking effect.**

The block boundary is the only transition point. This is the default for all operations. Exceptions require a deliberate override gesture (e.g. double-click to cue, which is intentionally immediate).

**Why:** preset loads, crossfades, and cover fades all require a moment to execute cleanly. Forcing any of these mid-block means interrupting something that is already in motion — the GPU is rendering, the cover is fading, the blend is running. Waiting for the boundary gives the engine time to finish cleanly and start the next thing right.

**In practice:**
- Staging changes applied → queued, takes effect after current block ends
- Switch to another set → queued, takes effect after current block ends
- Loop release → current loop cycle finishes, then timeline resumes
- The one deliberate exception: **double-click to cue** overrides immediately because the VJ explicitly chose that moment

---

## 🎯 Roadmap — Planned Phases

Built in the order of the *Up Next* table. Each entry below carries the same number.

---

### 1 · Loop — Preset & Marker Looping ⬜

*(specced under Phase 3.5; ships with Phase 4.10-B — loop state preservation)*

**Decided 2026-05-15:** preset looping lives in the **block menu** (Loop / Solo toggles) — there are **no transport-bar Loop buttons** (the original transport-toggle design is cancelled). A loop always loops a *section*: a preset's Loop loops its own one-preset span, markers bound a larger multi-preset section. This phase has three parts: the control and its rules (**1-A**), its at-a-glance visibility on the strip (**1-B**), and the relaxed jump crossfade that makes loop release — and every timeline jump — feel smooth (**1-C**).

#### 1-A — Loop control & precedence

**Presets and markers — keep them distinct.** Be careful what a "block" is: a block on the timeline is a **preset**. The timeline has two kinds of thing:

| Thing | What it is | Its job |
|---|---|---|
| **Preset** (block) | One preset placed at a start time | Played, jumped to, or used to define a **one-preset-wide** loop section |
| **Marker** | A flag on the ruler | Defines a **larger**, custom, multi-preset loop section |

**A loop always loops a *section* — a time span.** Within the section, all tracks loop together. What changes is the section's width and whether playback is soloed.

**Preset looping (block menu):**
- **Double-click** a preset → jump to it and play from its start (Phase 4.5 Cue gesture), loaded with a relaxed fade-in (1-C).
- **Loop** (block menu toggle) → arms a loop whose **section is that one preset's span**. Double-click the armed preset → the playhead loops over that section and **all tracks loop together** within it.
- **Loop Solo** (Loop + Solo) → jumps to the preset and loops **just that preset** — only the selected preset plays; the other tracks go dark.
- **Remove the loop** (toggle Loop off) → the playhead continues forward; the rest of the timeline plays on.

**Marker looping:**
- Markers bound a **larger section** — a custom, multi-preset region. Same all-tracks looping, just a wider span than one preset.
- Markers are a **live performance instrument** — the VJ adds and removes them as the playhead moves, creating and clearing region loops on the fly. Adding / removing markers IS performance.

The only difference between a preset loop and a marker loop is **what bounds the section** — one preset's span, or a marker region. **Solo** is the modifier that narrows playback to just the selected preset.

> **Simplified 2026-05-15 — what was removed.** Earlier drafts had the block menu do *custom* region looping and "preset-based regions" (contiguous block runs), plus an auto-spend mechanic where a live loop turned markers off as it passed (with spent-marker dimming + re-arming rules). All removed. A preset's Loop only ever loops its own one-preset span; larger regions are markers; conflict is handled by precedence — no auto-spend.

> **Marker looping needs a refinement pass** — Phase 4.1 marker `loop` works but is rough. Tightening it — including live add / remove during playback — is part of 1-A.

**Loop precedence — highest wins:**
1. **Double-click a preset** — runs it immediately with its armed settings (extends the Phase 4.5 Cue gesture). If Loop is armed, that loop takes over and releases any other loop. The deliberate live override.
2. **A preset's armed Loop**, reached by normal playback.
3. **Marker region loop** — lowest priority; overridden by an active preset loop.

**Release a loop:** toggle Loop off in the menu, double-click another preset, scrub the ruler, press Stop, or press a hot-cue key (1–9).

> **Build-time subtlety — a loop wraps the playhead over its section.** Whether the section is one preset's span (preset Loop) or a marker region, the playhead wraps: at the section's out point it returns to the in point. **Loop** keeps all tracks visible and looping; **Loop Solo** wraps the same way but darkens every track except the selected preset. Removing the loop lets the playhead continue past the section.

**No conflict prompts.** When loops could conflict, precedence above decides — silently. Never interrupt a live performance with a "loop conflict" dialog. The answer to "loops are hard" is **making state visible** (see 1-B) — never asking the VJ to resolve anything.

**⚠️ Critical implementation requirement — cancelable loop handle**

Butterchurn `loadPreset` and the CSS cover system both handle rapid switching safely (each new call displaces the last one cleanly). The risk specific to looping is the repeat timer: if the loop cycle uses a recursive `setTimeout` and that handle is not tracked and cleared, rapid clicking can leave orphaned loop callbacks firing after the user has already moved on.

Each zone's loop repeat handle must be:
- Stored in a dedicated per-zone slot (e.g. `_loopTimers = Map<zoneId, handle>`), separate from `_zoneTimers` which tracks scheduled block transitions
- Cancelled at the top of every override path for that zone: toggle off, double-click Cue, hot-cue key, scrub, stop
- Never reused — always assign a fresh handle after clearing the old one

Design the cancel path before writing the repeat logic. Do not patch this after the fact.

**Phase 4.10-B (pairs with this):** refactor `_scrubTo` to accept `{ preserveLoopState }` so a mutation/reschedule during an active loop does not break the loop. See the archived Phase 4.10-A "Interaction with Loop / Loop Solo" section for the full design.

#### 1-B — Loop visibility (clear loop signs)

Loop state must be obvious at a glance — the VJ should never have to guess what is looping. State is shown on the strip, not in text:

- **Active loop** — the looping block glows / slow-pulses; its menu Loop button is lit in the same language. A clear, calm pulse — readable across a room, never a strobe.
- **Armed but overridden** — a loop that is set but currently outranked by a higher-precedence loop shows a distinct *muted* indicator, so the VJ sees it is armed and waiting, not active.
- **Idle** — no indicator; the block reads normally.
- The same visual language is shared with Solo / Mute (Backlog console) so the whole strip becomes one consistent status surface — colors and glow tell the entire story.

**Loop section overlay.** Whenever a loop is running, the looped span gets a translucent color band drawn over the timeline — so the loop reads as a *region*, not just an indicator on one block:
- **Clear start and stop edges** — the band has distinct in / out caps; the VJ sees exactly where the loop begins and ends.
- **Controller chip** — the band carries a small chip naming what owns the loop: a **preset** (solo loop) or a **marker** (global loop). The VJ always knows which system is in control.
- **Scope follows loop type** — a **Loop** band (all tracks) spans every zone row across the section; a **Loop Solo** band covers just the selected preset's block; a marker region band spans every zone row across the region.
- **Active vs inactive** — an active band is bright; an armed-but-overridden loop band is dimmed, matching the armed-but-overridden language above.

Goal: the VJ controls presets and sees exactly what each one is doing, with ease, just by looking at the strip.

#### 1-C — Relaxed jumps & smooth crossfades

Every timeline *jump* — loop release, double-click Cue, hot-cue key, Set switch — should land in a relaxed, unhurried way, never as a hard snap:

- **Preload & align** — before the jump completes, the destination preset for every zone is loaded and given a frame to render; covers and blend state are aligned so nothing flashes.
- **Smooth crossfade** — the outgoing visual crossfades into the incoming preset (or set of presets) rather than cutting. Reuses the existing cover / `requestAnimationFrame` discipline (see ⚠️ CRITICAL: Playback & Cover System, Rule 7).
- **Marker-aware** — the jump respects whatever marker settings apply at the destination (a `stop` / `loop` marker at the landing point is honored).
- **The loop-release case** — when a looping zone rejoins the timeline, the playhead has moved on; the zone crossfades forward to "now" rather than jump-cutting. This is the real implementation risk of looping — design it here, not as an afterthought.
- **Live scrub-drag stays instant** — dragging the playhead is a preview gesture and must stay responsive (current behavior). "Relaxed crossfade" applies to discrete jumps, not continuous scrubbing.

Distinct from Phase 4.6 (overlap crossfade between consecutive blocks) — 1-C is about discontinuous seeks, not adjacent-block blends.

**Relationship to the Block Menu Orchestration Console (Backlog):** 1-A adds just the Loop control to the block menu (`#tl-quick-edit`, shipped in Phase 4.4-B). The broader console — menus staying open, Solo, Mute — remains a Backlog item. 1-B's visual language is shared with that console. Loop can ship independently as an addition to the menu that already exists.

---

### 2 · Phase 4.6 — Overlap-driven Crossfade Timing ⬜

Overlap between blocks is already visual and functional. The gap: the crossfade fires on the stored `blendTime` value regardless of how long the overlap actually is. The fix is to use the overlap duration as the fade duration instead.

**Current behavior:** block B starts at its `startTime`, crossfade duration = `entry.blendTime` (fixed).

**Target behavior:** crossfade duration = actual overlap length (`prevEntry.startTime + prevEntry.duration - nextEntry.startTime`). Drag the overlap wider = longer blend. Drag narrower = snappier cut. Out of the box, intuitive — no numeric field needed for most cases. `blendTime` remains as a fine-tune override.

**Technical path:** in `_playZone`, when scheduling a future entry, detect overlap with the previous entry and substitute overlap duration for `blendTime`. One calculation, no new data model fields.

---

### 3 · Phase 4.7 — Undo/Redo ⬜

Accidentally dragging a block, deleting it, or resizing it has no recovery today. Minimum viable scope: a command stack for the three most destructive gestures.

| Action | What's undone |
|--------|--------------|
| Drag (position change) | Restores `entry.startTime` to pre-drag value |
| Delete block | Re-inserts entry at its original position |
| Resize (duration change) | Restores `entry.duration` to pre-resize value |

**Not in scope (v1):** undo for timeline-level operations (delete whole timeline, change zone layout) — those have confirm dialogs already. Not in scope: multi-level redo. Single-level `Ctrl+Z` / `Cmd+Z` covers the real workflow pain.

**Technical approach:** before each mutation, push a snapshot `{ type, entryId, before }` onto a stack in `TimelineEditor`. `_handleUndo()` pops the top entry and applies the inverse. No external library needed — the data model is simple enough for manual snapshots.

---

### 4 · Phase 4.9 — Zone Stack System ⬜

> **Why this comes after 4.8 (Palette Opacity, shipped):** Palette Opacity = 0 makes the MilkDrop background black inside the comp shader. Image/video/gif layers render on top of that black. When this preset plays in a timeline zone with `blendMode: screen`, the black pixels pass through (screen blend of black = passthrough) and the zone below shows through — so image layers appear to float above another zone's active preset. Phase 4.9 builds the zone-level controls (opacity slider, blend mode selector) that complete this workflow.

Makes the multi-zone compositor a proper layered compositing system. Zones can now be full-screen overlays stacked on top of each other — not just side-by-side screen regions. A preset with `paletteOpacity=0` on a screen-blend zone places its image/video/gif objects floating above whatever zone is beneath it.

**Why this works cross-platform:** CSS `canvas.style.opacity` and `mix-blend-mode` are standard properties that work identically in Chrome, Safari, and WKWebView (Tauri on macOS/Windows). The critical cover system (black divs handling fade-in/out) is completely separate and unaffected. Default `zone.opacity = 1.0` means no visible change unless a user moves the slider.

**The canonical floating-object workflow:**

| Zone | Preset | paletteOpacity | blendMode |
|---|---|---|---|
| A (bottom) | Any MilkDrop preset | 1.0 | normal |
| B (top) | Preset with image/video/gif | 0.0 | screen |

Black palette in B → screen blend → those pixels pass through → Zone A shows. Image pixels in B composite on top.

**Sub-phases:**

**4.9-A — Wire opacity + zone settings popover** *(resolves the known gap: "Zone settings popover not built")*
- `_positionCanvas` adds: `canvas.style.opacity = zone.opacity ?? 1`
- Zone label chip click opens a settings popover anchored to the chip: name, opacity slider (0–1), blend mode selector, gap behavior — these fields already exist in the data model, UI was always noted as missing

**4.9-B — Overlay zone layout**
- New layout tile in the Zone Manager: **"Overlay"** — full-screen Zone A + full-screen Zone B stacked on top (screen blend, zIndex 1)
- Documents the canonical stack workflow above so it's one click to set up

**4.9-C — Z-index reordering**
- Drag zones up/down in Zone Manager to control stacking order
- Updates `zone.zIndex` values and calls `_positionCanvas` for all affected zones

**Files:** `src/timeline/timelineEditor.js` (4.9-A, B, C), `timeline.html` (popover DOM for 4.9-A), `src/timelineStorage.js` (no schema changes — all fields already exist).

---

### 5 · Phase 4.11 — Staging Mode ⬜

A safe editing environment that overlays the live timeline strip. The VJ makes multiple changes — add, remove, reorder blocks — then commits them all at once. The live playback is never interrupted during staging. Changes take effect on the next block boundary after Apply is pressed.

#### The Problem it Solves

Real-time editing (Phase 4.10-A) is powerful but exposes a risk: a misclick or accidental drag while playing changes the live show immediately. For a VJ mid-set, a safe scratch space where you can plan the next few blocks without touching what's playing is essential.

#### What Staging Is — and Is Not

**It is an overlay on the exact same strip interface.** The live canvas keeps playing behind it. The timeline strip looks identical to the live strip — same blocks, same ruler, same zone rows. The only differences are the amber tint, the STAGING pill, and the passive playhead. The VJ is not taken to a new page or a separate view. They are editing the strip they already know, with the live output visible behind them.

#### What Loads into Staging

Two paths — both land in the same overlay:

**Default — copy of the live Set:**
Staging opens with an exact copy of the currently-playing Timeline Set. The VJ tweaks what's already scheduled — move a block, add one, remove one — then applies.

**Load a different Timeline Set into Staging:**
A **Load Set →** option in the Staging overlay lets the VJ pull any saved Timeline Set into staging instead. They can edit it or push it straight to live as-is. This is the full set-switching workflow: pick a set, optionally edit it, apply on the boundary.

Both paths use the same staging overlay. The difference is just what's in `_stagedTl` when the overlay opens.

#### UX Flow

```
[Stage] button in transport bar
  → SAME strip, overlay mode activates
  → amber tint over strip + "STAGING" pill in transport
  → playhead shown as dashed line — passive, not clickable
  → live canvas still visible and playing behind the overlay
  → all block gestures work on the staged copy: add, drag, resize, delete, ☰ menu
  → [Load Set →] button available to swap in a different Timeline Set
  → [Apply] and [Cancel] appear in transport

On Apply — carbon copy of live Set (two options presented):
  → [▶ From Beginning] — staged layout starts from time 0 after current block ends
  → [▶ Match Cue Point] — staged layout starts from the live playhead position
      (the dashed playhead in staging shows exactly where this will be)
  → overlay clears — "Up next ▶ after current block" in transport
  → current block plays to its natural end
  → staged layout fades in from the chosen start point
  → transport returns to normal

On Apply — different Timeline Set loaded into staging:
  → only one option: always starts from beginning of the new Set
  → no cue point matching — it's a different set, a fresh start
  → overlay clears — "Up next: [Set Name] ▶ after current block" in transport
  → current block plays to its natural end
  → cover fades out → new Set fades in from block 0

On Cancel:
  → overlay clears — back to live strip
  → _stagedTl discarded, nothing changed
```

**Why the playhead is shown in staging (but passive):**
The dashed playhead is not just visual context — it is the anchor for "Match Cue Point." The VJ can see exactly where the live set is and make an informed decision: start fresh from 0, or pick up seamlessly from here. Without seeing the live cue position, that choice would be blind.

#### What Changes in Staging Mode

| Interaction | Live mode | Staging mode |
|---|---|---|
| Click ruler | Scrubs playhead | No-op — playhead is passive |
| Playhead | Solid line, moving | Dashed line, read-only |
| Block drag | Immediate, live effect | Writes to staged copy only |
| Block delete | Immediate, live effect | Writes to staged copy only |
| + button / preset picker | Adds to live now | Adds to staged copy |
| Load Set → | — | Replaces staged copy with a saved Set |
| Apply | — | Queues staged copy; commits on next block boundary |
| Cancel | — | Discards staged copy; overlay closes |

#### Architecture

On entering Staging mode:
```js
this._stagedTl = JSON.parse(JSON.stringify(this._tl)); // deep copy
this._stagingMode = true;
```

All mutations in Staging mode write to `this._stagedTl`, not `this._tl`. The live playback engine keeps reading from `this._tl` — untouched.

On Apply — two paths:

```js
// Carbon copy — Match Cue Point
// _pendingStartTime = current live playhead position
this._pendingStagedTl = this._stagedTl;
this._pendingStartTime = (performance.now() - this._playStartWall) / 1000;
this._stagedTl = null;
this._stagingMode = false;
// _onBlockBoundary() → this._tl = this._pendingStagedTl; _playZone from _pendingStartTime

// Carbon copy — From Beginning
// same but _pendingStartTime = 0

// Different Timeline Set loaded into staging
// always _pendingStartTime = 0 — new set, fresh start
this._pendingStagedTl = this._stagedTl;
this._pendingStartTime = 0;
this._stagedTl = null;
this._stagingMode = false;
```

`_onBlockBoundary()` reads `_pendingStartTime` to know where to begin playback in the incoming Set. If `_pendingStartTime > 0` it calls `_scrubTo(_pendingStartTime)` immediately after the swap; if 0 it starts `_playZone` from the top.

`_onBlockBoundary()` is the same callback already used by the loop system. When the current block's timer fires and the next block is about to be scheduled, check `_pendingStagedTl`: if set, swap it in as `this._tl` and clear the pending slot. The next `_playZone()` call reads the new data naturally — no `_rescheduleIfPlaying()` needed.

On Cancel:
```js
this._stagedTl = null;
this._stagingMode = false;
// render strip from this._tl — unchanged
```

#### Preset Picker in Staging Mode

The existing preset picker works unchanged. In Staging mode, the confirm action writes to `this._stagedTl` instead of `this._tl`. No new UI needed — the picker is already a deliberate gesture.

Default to the **Favorites tab** when opening the picker from Staging mode. The VJ's curated list is the right starting point for live add decisions. Full All/Search tabs remain available.

#### Visual Language

Three signals make Staging unmistakable:

1. **Amber tint** on the strip background (traffic light logic — amber = hold, prepare, not live)
2. **"STAGING" pill** in the transport bar where the timecode normally appears
3. **Dashed playhead line** instead of solid — still visible, clearly passive

Getting these three wrong is the worst failure mode. A VJ who thinks they're live when they're in staging (or vice versa) will have a bad night.

#### Files

`src/timeline/timelineEditor.js` — staging state, mutation routing, boundary swap
`src/timeline/style.css` — amber tint, staging pill, dashed playhead
`timeline.html` — Apply / Cancel button additions to transport DOM

---

### 6 · Phase 4.12 — Timeline Sets Switching ⬜

Applies the Boundary Rule to switching between Timeline Sets. The current topbar `<select>` dropdown swaps instantly — this replaces that with a queued switch. The current block plays to its natural end, then the queued Set starts from its beginning with a clean fade.

#### UX Flow

```
My Sets button → opens Sets panel (see 4.12-B)
  → tap any set → it is queued
  → transport shows "Up next: [Set Name] ▶"
  → current block plays to its natural end
  → crossfade / cover fade → queued Set starts from block 0
  → "Up next" indicator clears
  → "Now: [Set Name]" updates in transport

Change your mind before the boundary:
  → tap a different Set to update the queue
  → tap the currently-playing Set to cancel the queue
  → "Up next" clears immediately
```

#### Transition at the Boundary

When the current block's timer fires and the pending Set slot is filled:

```js
// inside _onBlockBoundary(), called at each block end
if (this._pendingSetTl) {
    this._tl = this._pendingSetTl;
    this._pendingSetTl = null;
    this._currentZonePreset.clear();
    // _playZone() fires next and reads from the new _tl — no reschedule needed
}
```

The new Set always starts from time 0. The cover system handles the visual: the outgoing preset fades to black (cover up), the first block of the new Set fades in (cover down). Same path as a normal gap-to-block transition — no new fade code.

#### 4.12-A — Queue Mechanism (Engine)

- `_pendingSetTl` slot on `TimelineEditor` — holds a full timeline data object
- Populated when the VJ selects a Set while playing
- Resolved in `_onBlockBoundary()` — same callback used by Staging (4.11)
- Cleared if VJ cancels or taps the current Set
- "Up next: [name]" transport indicator tied to whether `_pendingSetTl` is set

**Files:** `src/timeline/timelineEditor.js`

#### 4.12-B — My Sets Panel

Replaces the topbar `<select>` dropdown with a proper Sets panel. The dropdown was fine for planning; it is wrong for live performance — too small a tap target, no visual hierarchy, immediate swap.

**Panel design:**
- Opens from a **My Sets** button in the transport bar (or top-right corner)
- Card list: each Set shown as a row — **name**, entry count, zone count, last-edited time
- Currently-playing Set has a **NOW** chip
- Queued Set has an **UP NEXT** chip
- Tap any card → queues that Set (shows "Up next" in transport)
- Tap the NOW card → no-op (already playing)
- **+ New Set** at top of list — creates a blank set and enters it (not queued — you're now editing it stopped)
- **Save Set** button in transport — saves the current state to the current Set (same as existing Save, just renamed)
- **Rename** on long-press or secondary tap on a card
- **Delete** with confirm on secondary tap

**Panel does not auto-dismiss** — same rule as block settings menu. The VJ closes it deliberately.

**Files:** `src/timeline/timelineEditor.js`, `timeline.html`, `src/timeline/style.css`

#### 4.12-C — Save Set Flow

Current save flow: clicking Save writes the current `_tl` to localStorage under the current timeline's id. This is unchanged. The rename is purely UI:

| Old label | New label |
|---|---|
| Save | Save Set |
| + New | + New Set |
| (dropdown) | My Sets |
| [timeline name] | [Set name] |

No storage migration. `timelineStorage.js` key format, CRUD, and schema are unchanged.

#### The One Implementation, Two Features Pattern

Staging (4.11) and Timeline Sets switching (4.12) are the same boundary-swap mechanism:

| Operation | What's in the pending slot | When it resolves |
|---|---|---|
| Staging apply | Edited copy of current Set | Next block boundary |
| Set switch | Different saved Set | Next block boundary |

`_onBlockBoundary()` checks both slots in order. If Staging is pending, it resolves first. Set switch resolves after. Only one can be pending at a time in normal use — if a VJ queues a Set while in Staging mode, the Staging changes are discarded (with a one-tap confirm: "Switch sets? Your staged changes will be lost.").

#### Files

`src/timeline/timelineEditor.js` — `_pendingSetTl`, `_onBlockBoundary()`, Sets panel logic
`timeline.html` — My Sets button, Sets panel DOM, "Up next" indicator
`src/timeline/style.css` — panel card styles, NOW/UP NEXT chips, indicator
`src/timelineStorage.js` — no changes (schema unchanged)

---

### 7 · Phase 4.13 — Timeline Set Export / Import ⬜

Portable Timeline Sets — a `.dcset.json` bundle that contains everything needed to run the set on any machine: the full timeline arrangement, all custom presets referenced by the set, and all embedded images/layers. Hand the file to another VJ and they get an identical show.

Builds directly on the existing `.dcshow.json` export/import architecture. The addition is a metadata envelope and a proper export modal with title, description, and cover image. The import flow reuses the existing `importResultModal.js` pattern.

#### The Bundle Format — `.dcset.json`

A metadata wrapper around the existing show bundle:

```json
{
  "meta": {
    "schemaVersion": 1,
    "title": "string",
    "description": "string",
    "coverImage": "data:image/...;base64,...  (optional)",
    "exportedAt": 1234567890,
    "appVersion": "string",
    "setId": "uuid",
    "setName": "string",
    "stats": {
      "blockCount": 12,
      "zoneCount": 2,
      "customPresetCount": 4,
      "markerCount": 3
    }
  },
  "set": {
    // full Timeline Set data — zones, entries, markers
  },
  "presets": {
    // all custom presets referenced by the set
    // each with images embedded as base64 — same as existing .dcshow.json
  }
}
```

`.dcset.json` is the new extension — more specific than `.dcshow.json` which already exists. Both formats remain supported on import. Old `.dcshow.json` files import as a Timeline Set with no metadata (title defaults to the filename).

#### Export Flow

```
My Sets panel → ⋯ menu on a Set card → Export Set
  → Export modal opens (see below)
  → user fills in metadata
  → [Export] → downloads [Set Name].dcset.json
```

Or from the transport bar when a Set is loaded: **Export Set** button.

**Export modal fields:**

| Field | Notes |
|---|---|
| **Title** | Pre-filled with the Set name. Editable. |
| **Description** | Optional. Multi-line. What is this set for, what style, notes for the recipient. |
| **Cover Image** | Optional. Upload an image or leave blank. Shown in the import preview card and the My Sets panel (future). |
| **What's included** | Read-only summary: "12 blocks · 2 zones · 4 custom presets · 3 markers" — so the VJ knows what they're bundling before confirming. |
| **Export** button | Downloads the file. |
| **Cancel** | Closes modal. |

Cover image is optional in v1 — the field is present but "No image" is a valid state. The infrastructure is there to add auto-screenshot capture later.

#### Import Flow

```
My Sets panel → [Import Set] button
  → file picker → select .dcset.json (or legacy .dcshow.json)
  → preview card shown before confirming:
      - Cover image (if present)
      - Title + description
      - "12 blocks · 2 zones · 4 custom presets · 3 markers"
      - Any name collision warnings ("2 presets already exist — will be kept as-is")
  → [Import] confirms
  → Set added to My Sets
  → All custom presets restored to preset library (same ID remapping as existing import)
  → Import result modal: lists every imported preset, flags any failures
  → New Set available immediately in My Sets panel
```

On name collision for the Set itself (a Set with the same name already exists):
→ imported Set gets " (imported)" suffix automatically. No prompt — clean and fast.

#### Architecture

**Export:**
Reuse `exportPreset(id)` from `customPresets.js` for each custom preset referenced by the set. Collect all results into the `presets` block. Serialize the Set data into `set`. Wrap with `meta`. Use `downloadFile()` from `fileUtils.js` (already handles both web and Tauri native Save As).

**Import:**
Parse the outer `meta` + `set` + `presets` structure. Feed `presets` through the existing `importFromFile()` path in `customPresets.js` — ID remapping, IndexedDB image storage, localStorage writes all handled already. Then call `timelineStorage.saveTimeline(set)` with a new ID to register the Set. Show `importResultModal` for preset results.

No new storage primitives needed. The existing preset export/import and timeline save infrastructure covers everything — this phase is plumbing and UI only.

#### Future Extensions (out of scope for v1)

- **Cover image auto-capture** — screenshot the canvas at export time, embed as cover
- **Set preview in My Sets panel** — show cover image on each Set card
- **Export All Sets** — bulk bundle of every saved Timeline Set
- **Share link** — upload to a hosted service, share a URL (far future)

#### Files

`src/timeline/timelineEditor.js` — export/import trigger, modal wiring
`timeline.html` — export modal DOM, import button in My Sets panel
`src/timeline/style.css` — export modal, import preview card
`src/timelineStorage.js` — no changes
`src/customPresets.js` — no changes (reused as-is)
`src/fileUtils.js` — no changes (reused as-is)
`src/importResultModal.js` — reused as-is

---

### 8 · Phase 4.4-C/D/E — Block Settings Menu (remaining) ⬜

Phases 4.4-A and 4.4-B shipped (see archive). Remaining sub-phases:

| Phase | What's added |
|-------|-------------|
| **C — Full Edit** | "Full Edit →" deep-link into Preset Studio for this preset |
| **D — Utilities** | Block color picker |
| **E — Preset Controls** | Full `controls.js` panel as a new section below the fields, re-targeted to this zone's engine; live during playback |

**Styling (prerequisite for Phase C):** Size and padding are correct — controls must stay easy to see and hit. Fix is visual hierarchy and anchoring:
- "s" unit labels feel orphaned — should be anchored to their input (suffix inside the field, or a pill flush alongside it)
- Field labels and values have similar visual weight — labels should read as secondary so the value is what draws the eye
- Apply/Cancel button bar stays — clear affordance — but should match the app's glassmorphic language rather than reading as a generic HTML form

**Technical note (for Phase E):** `src/controls.js` currently targets the primary engine. For timeline zones, each zone has its own slave `VisualizerEngine` at `_zoneMap.get(zoneId).engine`. The modal re-targets controls to the correct engine on open, then restores the original target on close. No new slider widgets — just a target-swap.

---

### 9 · Phase 5 — Timeline Output to External Displays 🔬

**Status**: Research in progress — see `visualizer-output-dev.md` for detailed findings.

**Goal**: Route each zone to a separate physical display (monitor/projector) for live performance setups.

**Architecture**: This is built on the **Output System** — a modular subsystem shared between the timeline editor and main app player. The core handles display enumeration, window positioning, and streaming; the timeline editor adds per-zone output assignment UI.

**Platform Targets**:

| Platform | Status | Notes |
|----------|--------|-------|
| **Web** | 🔬 Research | `getScreenDetails()` + `window.open()` positioning needs testing |
| **macOS (Tauri)** | 🔬 Research | `set_position()` → `set_fullscreen()` pattern identified |
| **Windows (Tauri)** | 🔬 Research | Same pattern + Spout for VJ integration |

**Key Research Findings** (see `visualizer-output-dev.md` for full details):
- **Web**: `getScreenDetails()` enumerates screens; `window.open(left=2560)` positioning needs validation
- **Tauri**: `availableMonitors()` JS API exists; fullscreen to specific monitor requires `set_position` → `set_fullscreen` workaround (Issue #6394)
- **VJ Protocols**: Syphon (macOS), Spout (Windows), NDI (cross-platform) identified for professional integration

**UI Additions (Planned)**:
- **Output Manager** modal (similar to Zone Manager) — shows available displays as tiles
- Per-zone **output chip** in timeline rows — click to assign/unassign display
- Visual indicator when zone is routed externally

**Next Steps**:
1. Validate web popup positioning on multi-monitor setup
2. Test Tauri `set_position` → `set_fullscreen` on macOS
3. Test same on Windows
4. Architecture decision: IPC vs. Syphon/Spout for native streaming

---

## ✅ Completed Phases — Index

One line each. Full implementation detail, post-ship fixes, and edge-case notes are in **[timeline-editor-archive.md](timeline-editor-archive.md)**.

| Phase | Summary |
|-------|---------|
| 1 | Single-zone editor — CRUD, DOM strip, preset picker, transport, advancing playhead |
| 2 | Multi-zone compositor — slave engines, 6 zone layouts, per-zone strip rows |
| 3 | UX polish — position-based dragging, inline block actions, always-visible controls, fullscreen button |
| 3.5 | Active Playhead — click-to-seek, persistent position, automated gap crossfades *(Loop buttons → Roadmap #1)* |
| 4.1 | VJ Markers — ruler cue points + 1–9 hot-cue keys, `stop`/`loop` marker actions |
| 4.2 | Transport & Seeking — go-to-start, skip-to-next, VJ-mode stop (visuals keep running) |
| 4.3 | Quick Wins — keyboard nudge, drag-scrub on ruler, block navigation arrows |
| 4.4-A | Block Action Modal — Duplicate/Delete consolidated into `#tl-quick-edit`, hover row removed |
| 4.4-B | Block Menu Icon — hamburger toggle, single-click select, double-click cue, no auto-dismiss |
| 4.5 | Double-click to Cue — crossfade into the cued preset + seek timeline to its `startTime` |
| 4.8 | Preset Palette Opacity — MilkDrop background-layer opacity slider (prereq for Zone Stack) |
| 4.10-A | Real-time Live Editing — `_rescheduleIfPlaying()` rebuilds timers after any mutation |

---

## Backlog

Unscheduled ideas. Promote to the Roadmap and the *Up Next* table when ready to commit.

### ⭐ Block Menu Orchestration Console *(captured 2026-05-15)*

Reframe the per-block menu (the `#tl-quick-edit` popover opened by the left hamburger icon — Phase 4.4-B) from an "edit" popover into a **live per-preset control surface**. Small or busy blocks have no room for on-block controls; the menu is where controls belong. Kept deliberately small — there are not many controls per preset, and Solo / Loop / Mute read clearly. This is not a "crazy menu" — room to breathe is the point.

- **Menus stay open** — reverse the Phase 4.4-B single-open rule (one menu currently closes any other). Set up several blocks' menus, then perform.
- **Controls per menu:** Loop, Solo, Mute — alongside the existing Duration / Blend / Label fields. A small, clear set. No separate "Loop Solo" — a per-block Loop is already zone-scoped. Loop itself is specced as Roadmap #1.
- **Color coding** signals state at a glance: muted = dimmed/desaturated block, solo = bright stroke (a *slow* pulse if any — never a strobe).
- An explicit **close-all** affordance returns the strip to its clean base.

**Interaction model — set up, then fire:**
The menu *configures* a block; double-click *executes* it (extends the Phase 4.5 Cue gesture).
- Click the block's menu icon → menu opens → arm Solo / Loop / etc. for that block.
- Double-click the block → plays it **with the armed settings**. Go straight to a preset and solo it; or go straight to a preset and play all zones from there.
- The menu holds the intent; the double-click is the trigger. Setup and execution stay separate gestures.

**Decided — no separate Performance Panel.** An all-zones, all-controls overlay was considered and rejected — too much UI at once. This console *is* the performance surface: open only the block menus you're working, leave the rest clean. (UX Philosophy ladder updated — Layer 2 removed.)

**Decided — Loop is one per-block toggle.** No transport buttons, no separate "Loop Solo." Full loop design and precedence rules: see Roadmap #1.

**Decided — no loop-conflict prompts.** Loop conflicts are resolved silently by precedence (Roadmap #1), never by a mid-performance dialog. The one genuine overlap — a preset loop vs a marker region loop — is settled by precedence (the preset loop wins). The fix for "loops are hard" is **visibility, not prompts** — loop state is shown through the color coding (active loop = pulsing indicator; an armed-but-overridden loop = a distinct muted indicator), so the VJ always sees what won without being asked to decide.

**Open design questions — resolve before building:**
- **Mute/Solo target** — in a real mixer these act on a *channel* (= a zone here), not a clip. Decide whether a block's Mute/Solo acts on its zone or only that block. Lean: zone-level, block menu as the access point.
- **Multi-open layout** — floating popovers will overlap on small/close blocks. Needs a docking/tray strategy (e.g. menus drop below their zone row) rather than free-floating popovers.
- **Persistence** — Loop/Mute/Solo are ephemeral live performance state. They must NOT be saved in the Timeline Set (consistent with "a Set does not contain the playhead position").

*Loop & Regions*
- **Loop region markers** — region looping is bounded by markers (Roadmap 1-A). Possible convenience: drag a range on the ruler to drop an in/out marker pair in one gesture — not a separate system, just a faster way to place the two markers.
- **Advanced Loop logic** — marker action `loop` jumps to previous loop start rather than `0:00`.

*Live Performance*
- **Per-entry crossfade style** — Cut / White Flash / Black Dip — stored as `transitionStyle` on entry.
- **Live queue override** — during playback, click a future block to force it to play *next*, overriding the timeline's strict chronological order.
- **Hold/freeze preset** — while playing, press `H` to freeze the current preset indefinitely, ignoring upcoming block transitions. Press again to release.
- **Speed control** — 0.5×, 1×, 2× playback speed. Affects wall-clock calculation.
- **Entry label canvas overlay** — text overlay during playback (label field already in data model and quick-edit).

*Audio Sync*
- **Timeline ↔ Audio lock** — when using "Load Track" mode, sync the timeline playhead with the audio file's `currentTime`. Scrubbing one scrubs both. Playback of one drives both.
- **BPM grid on ruler** — enter a BPM; ruler shows beat markers. Blocks snap to beat boundaries on drag/resize. Playhead shows current beat count.
- **Beat-triggered transitions** — instead of hard time-based transitions, trigger the next preset on the next beat boundary after the block's duration expires.

*Workflow & UX*
- **Auto-fill from Favorites** — button in transport to quickly fill a zone.
- **Multi-select (Shift-click)** — bulk duration stamping and movement.
- **Setlist text export** — plain-text or HTML table.
- **Auto-save behavior** — debounced "draft" slot rather than spawning a new entry per page load.

> *Removed 2026-05-15 — **Performance Panel.** A full-width overlay showing every zone's full `controls.js` panel at once was on the backlog. Cut: too much UI at once, against "room to breathe." Its role is filled by the Block Menu Orchestration Console (above) — progressive, one block menu at a time.*

---

## What This Is

A **Timeline** is a positional playlist of presets where each entry has a fixed display duration, blend-in transition, and an absolute start time within a zone. Multiple zones (screen regions) run simultaneously — different presets play in different areas of the canvas, composited live via CSS `mix-blend-mode`. The Timeline Editor is where you build and play them.

Same design language as the rest of the app: full-screen canvas, glassmorphic overlays, controls permanently visible unless fullscreen is active.

**No changes to the main app or Preset Studio are required** beyond two one-liners (navigation links, already shipped — see File Map).

---

## Open Bugs / Known Gaps

- **Overlaps are intentional (crossfades)**: blocks can overlap within a zone — this is the crossfade mechanism (Roadmap Phase 4.6), not a bug. The old spec note `startTime + duration <= next.startTime` is superseded. No overlap prevention should be added.
- ~~**Gap behavior not visualized**~~: ✅ Fixed in Phase 3.5 — `_playZone()` now schedules blackout timers when entries end. `gapBehavior: 'black'` re-shows the zone cover; `'hold'` lets the last frame persist. Visual crosshatch/ghost-block strip rendering still not built (cosmetic only).
- ~~**Previous preset bleeds through cover during gap-to-next-entry fade**~~: ✅ Fixed 2026-05-12 — confirmed working on web. Cover fade and `loadPreset` were firing simultaneously; old preset was visible through the fading cover. Fix: `loadPreset(name, 0)` fires first (instant GPU write), then `requestAnimationFrame` delays the cover fade until the new preset has rendered one frame. Presets now fade out cleanly, gaps show nothing, next preset fades in with no bleed. Cross-platform compatible (rAF is standard in WKWebView/WebView2). See Rule 7 in the Critical section.
- **Zone settings popover not built**: clicking the zone label chip does nothing yet. It should open a popover for name, opacity, blend mode, gap behavior. *(Addressed in Roadmap Phase 4.9-A)*
- **Entry label overlay not rendered**: `entry.label` is stored and editable in quick-edit but not rendered on the canvas during playback.
- ~~**`#tl-quick-edit` styling needs visual polish**~~: ✅ Partially addressed in Phase 4.4-A — Duplicate/Delete consolidated into modal with utility row. Full styling pass (Roadmap 4.4-C/D/E) still pending.
- **Undo/Redo not yet implemented** — scheduled for Roadmap Phase 4.7. Until then, delete and drag are irreversible.

---

## Current State — What's Built and Shipped

Phases 1 through 4.3, 4.4-A, 4.4-B, 4.5, 4.8, and 4.10-A are fully working. Here's an accurate picture of the running code:

### Entry point
`timeline.html` → `src/timeline/main.js` → `TimelineEditor` class in `src/timeline/timelineEditor.js`

### On boot
1. Start screen (Live Audio / Load Track) — mirrors editor.html
2. `boot()` creates a full-screen canvas + primary `VisualizerEngine`
3. `engine.refreshCustomPresets()` loads custom presets from localStorage
4. `new TimelineEditor({ engine, canvasContainer })` initializes the editor
5. Controls are permanently visible — auto-hide timer was removed in Phase 3

### Zone system (Phase 2–3, complete)
- Every timeline has a `zones` array (default: single 'full' zone)
- Each zone gets its own `<canvas>` and its own `VisualizerEngine` (slave)
- Slave engines share the primary engine's `AudioContext` + `GainNode` — all canvases react to the same audio
- Zone map: `_zoneMap = Map<zoneId, { canvas: HTMLCanvasElement, engine: VisualizerEngine }>`
- **⊞ Zones** button in transport opens the Zone Manager modal — 6 predefined layouts
- Changing layout clears entries (with confirm) — zone IDs change across layouts

### Playback (position-based, complete)
- `entry.startTime` is stored in seconds — it IS the block's horizontal position (not computed from order)
- `_playZone(zoneId, fromTime = 0)` schedules all entries for that zone using absolute `setTimeout` delays
- Timer storage: `_zoneTimers = Map<zoneId, timerHandle[]>` — an ARRAY of timers per zone (not a single timer)
- Wall-clock synchronization: all zones share `_playStartWall = performance.now()`
- `stop()` clears all timer arrays + master timer + rAF
- Ruler click-to-seek restarts all zone chains from the clicked time

### Strip rendering
- Blocks positioned at `entry.startTime * pxPerSec` px — free placement, gaps allowed
- Blocks are draggable to any time position (drag body moves the block, updates `entry.startTime` on drop)
- Drag resize right edge → updates `entry.duration`
- Zone rows stack vertically; height driven by JS setting `--strip-h` CSS var

### Real-time live editing (Phase 4.10-A, complete)
- Any mutation while playing — drag, resize, quick-edit apply, duplicate, delete, add — immediately rescheduled via `_rescheduleIfPlaying()` → `_scrubTo(tNow)`
- Currently-playing preset never flashes: `_currentZonePreset = Map<zoneId, presetName>` tracks what's showing; `_playZone` skips `loadPreset` if the same preset is already active
- Deleting the currently-playing block: `_playZone` finds no active entry → raises cover to black instantly; next block's timer takes over
- Adding a block while playing: immediately scheduled if it falls after the current playhead
- Covers all zones instantly on `play()` start + clears `_currentZonePreset` for a clean slate

### Block interactions (Phases 4.4-A, 4.4-B, 4.5 — complete)
- **Single-click block body** → visual select only (highlights block)
- **Double-click block body** → `_cueEntry`: crossfades from currently-playing preset into the cued preset and seeks the timeline to that block's `startTime`. Native `dblclick` event — no timing hack.
- **Click `.tl-block-menu-btn` (hamburger icon, left side)** → toggles `#tl-quick-edit` modal for that block. Icon glows in the block's color when open, muted when closed.
- **Drag** only activates after > 4px movement (`_startMoveDrag` threshold); clean click/dblclick routes through normally
- Hover icon row removed. Right-click context menu no longer triggered from blocks. Timing-based double-click detection removed.

### Fullscreen button (Phase 3 UX, complete)
- Controls are **always visible** — auto-hide timer removed entirely
- `#tl-fullscreen-btn` button in top-right corner (replaced the old `#tl-toggle-ui` pin button)
  - Click → hides all overlay controls and enters fullscreen (`_isFullscreen = true`)
  - Web: uses `document.documentElement.requestFullscreen()` — native browser fullscreen
  - macOS app (Tauri): uses `appWindow.setFullscreen(true)` via `@tauri-apps/api/window` (import is `/* @vite-ignore */` so Vite doesn't resolve it outside Tauri builds)
  - Icon swaps from expand arrows (enter) to compress arrows (exit)
  - `fullscreenchange` / `webkitfullscreenchange` events sync `_isFullscreen` and restore overlays when browser Esc exits fullscreen
  - `Escape` key in `handleEscape()` also calls `_exitFullscreen()` (covers Tauri where browser Esc interception differs)
  - `F` key also toggles fullscreen
- `T` key still toggles the strip panel visibility (`toggleStrip()`)

---

## ⚠️ CRITICAL: Playback & Cover System — Do Not Break

> This section exists because of a catastrophic regression on 2026-05-06. Multiple incremental patches made things progressively worse. Read this before touching ANY playback, fade, or scrub code.

### How the Cover System Works

Each zone has a black `<div>` cover (`_zoneCovers` map) that sits on top of its canvas. Opacity `1` = black (hidden). Opacity `0` = transparent (visible). `_fadeZoneCover(zoneId, opacity, durationSec)` transitions it.

**The cover is the ONLY mechanism for showing/hiding zone content.** WebGL canvases do NOT go black when you stop rendering — the last frame stays in the framebuffer permanently. `stopRenderLoop()` alone will never produce a black canvas. The cover is the correct, intentional solution.

### The Correct State Machine (per zone, during playback)

```
Timeline start / gap at fromTime
  → cover = 1 (black)

Active entry found at fromTime (immediate load)
  → cover fades to 0 instantly
  → preset loads with blend 0
  → schedule: cover fades to 1 at (entryEnd - blendTime) IF gap follows

Future entry with gap before it
  → cover starts fading to 0 at (st - blendTime) — fade-in begins before block start
  → preset loads when fade-in starts
  → schedule: cover fades to 1 at (entryEnd - blendTime) IF gap follows

Future entry consecutive (no gap before it)
  → cover stays at 0 — no manipulation
  → preset loads at exact st — Butterchurn crossfade handles visual transition
  → NO cover fade-out scheduled (next block is consecutive)

Gap between blocks
  → cover = 1 (black) from previous block's fade-out timer
  → cover stays black until next block's fade-in timer fires
```

### `shouldBlackout` flag

`const shouldBlackout = !zone || zone.gapBehavior !== 'hold'`

- `gapBehavior: 'black'` (default) → `shouldBlackout = true` → fade-out timers ARE scheduled
- `gapBehavior: 'hold'` → `shouldBlackout = false` → no fade-out, last frame persists in gaps

All fade-out timer scheduling in `_playZone` is gated by `shouldBlackout`.

### The `entries[i-1]` Index Bug — FIXED, Do Not Reintroduce

The original code (commit `707be41`) used `entries[i-1]` to find the previous entry for gap detection:
```js
const prev = entries[i - 1];  // WRONG — index is corrupt after continue statements
const prevEnd = prev ? ((prev.startTime ?? 0) + prev.duration) : -Infinity;
const hasGapBefore = st > prevEnd;
```
**This is wrong.** The loop skips entries via `continue` (for `immediateEntryId` and `st < fromTime`). After a skip, `entries[i-1]` points to a different entry than the one actually processed before. Result: every future entry appeared to have a gap before it → every block got a pre-fade even when consecutive.

**The fix** (currently in code): track `lastEnd` manually, seeded from past entries and the immediate entry, updated at the bottom of each loop iteration:
```js
let lastEnd = -Infinity;
// seed from past entries and immediate entry...
for (...) {
    const hasGapBefore = st > lastEnd + 0.01;
    // ...
    lastEnd = Math.max(lastEnd, st + entry.duration);
}
```

### `_scrubTo` — Gap Blackout Is Required

When scrubbing while stopped, if a zone has no active entry at time `t`, its cover **must** be raised to black. The original "VJ MODE: No blackout in gaps" comment was wrong for this context. The correct behavior:
```js
if (activeEntry) {
    zd.engine.loadPreset(...);
    this._fadeZoneCover(zone.id, 0, 0);  // reveal
} else {
    this._fadeZoneCover(zone.id, 1, 0);  // blackout gap
}
```

### The Working Reference Commit

Commit `900f164` ("implement timeline marker system") has the last fully working `_playZone` and `_scrubTo` before the VJ mode rewrite. If everything breaks, `git show 900f164:src/timeline/timelineEditor.js` is the reference.

The VJ mode rewrite in `707be41` removed gap blackouts ("VJ MODE: No fade-to-black at entry end") which broke the fundamental timeline contract.

### Rules For Future Changes

1. **Never use `entries[i-1]`** in `_playZone`. Use `lastEnd` tracker.
2. **Never remove the cover fade-out** at block end unless `gapBehavior === 'hold'`.
3. **Never remove the `else` blackout** in `_scrubTo` — gaps must show black when scrubbing.
4. **`stopRenderLoop()` alone never shows black** — always pair it with `_fadeZoneCover(zoneId, 1, 0)` if you use it.
5. **Test with: gap after first block, gap before last block, consecutive blocks, start-from-gap position** before committing any playback change.
6. **Do not mix cover AND engine-stop** approaches — pick one. Current approach is **cover only** (engine keeps running in gaps). This is correct and intentional.
7. **Gap-before-entry: always load preset before fading the cover.** Use `loadPreset(name, 0)` + `requestAnimationFrame` to ensure the new preset has rendered at least one frame before the cover becomes transparent. Never start the cover fade and the preset load simultaneously — the old preset will bleed through during the early frames of the fade. Consecutive blocks (no gap) are exempt — Butterchurn's internal blend handles those.

---

## Critical Architectural Facts

> These are the non-obvious facts a developer needs before touching this code.

### `src/visualizer.js` IS modified (Phase 2 required it)
`initSlave(canvas, primaryEngine)` was added. It creates a new Butterchurn visualizer on `canvas` sharing the primary engine's audio graph (no new `AudioContext`). Sets `this._isSlaveEngine = true` which guards the render loop from running `updateAGC()`/gain management (primary handles it — slaves must not fight over the shared `GainNode`).

### `entry.startTime` is the source of truth for position
Old behavior (Phase 1–2): `startTime: 0` on all entries, positions were computed cumulatively from array order.
Current behavior (Phase 3+): `startTime` is stored and is the actual seconds-from-zero position. Blocks can have gaps or overlaps. Overlaps are intentional — they define the crossfade duration (Roadmap Phase 4.6).

**Backward compatibility**: `_migrateEntryStartTimes(tl)` is called on every timeline load. It detects old timelines (all entries have `startTime === 0`) and assigns cumulative start times so they don't stack at t=0.

### Zone 'full' always maps to the primary engine
`ZONE_LAYOUTS` always puts `id: 'full'` as the first zone. The primary engine's canvas is always stored at `_zoneMap.get('full')`. Slave engines are only created for zones with IDs other than 'full'.

### `_zoneTimers` stores arrays, not single handles
`stop()` iterates: `for (const timers of this._zoneTimers.values()) for (const t of timers) clearTimeout(t)`. Don't accidentally store a single handle — it will not be cleared.

### `_isFullscreen` tracks fullscreen state
`_isFullscreen` is set to `true` on enter, `false` on exit. `_hideOverlays()` is called on enter; `_showOverlays()` is called on exit. For web, `_onFullscreenChange()` is the authoritative setter (fired by the browser). For Tauri, `_isFullscreen` is set directly in `_enterFullscreen`/`_exitFullscreen` since WKWebView does not fire standard fullscreen events.

---

## Data Structures

### Zone

```js
{
  id: string,           // 'full' | 'right' | 'bottom' | 'q2' | 'q3' | 'q4' | 'center' | 'banner'
  name: string,         // "Full", "Left", "Top", etc.
  color: string,        // hex — track row dot color and default block tint
  region: {
    x: number,          // 0–1 normalized
    y: number,
    width: number,
    height: number,
  },
  opacity: number,      // 1.0 default
  blendMode: string,    // CSS mix-blend-mode: 'normal' | 'screen' | 'overlay' | 'multiply'
  zIndex: number,       // canvas stacking order
  gapBehavior: 'black' | 'hold',
}
```

### TimelineEntry

```js
{
  id: string,           // uuid
  zoneId: string,       // references Zone.id
  presetName: string,   // "Preset Name" or "custom:<id>:Name"
  startTime: number,    // STORED — absolute seconds from t=0 (block's left position)
  duration: number,     // whole seconds (5–600)
  blendTime: number,    // blend-in seconds (0–10, default 2)
  label: string | null, // optional text overlay — stored but overlay rendering not yet built
  color: string | null, // block color override; auto-assigned from preset name hash if null
}
```

### Timeline

```js
{
  id: string,
  name: string,
  schemaVersion: 2,
  zones: Zone[],
  entries: TimelineEntry[],  // flat, all zones, sorted by startTime for playback
  loop: boolean,
  totalDuration: number,     // derived: max(entry.startTime + entry.duration)
  defaultDuration: number,   // seconds (default 30)
  defaultBlendTime: number,  // seconds (default 2)
  bpm: number | null,        // Phase 4: beat-grid ruler
  createdAt: number,         // Date.now()
  updatedAt: number,
}
```

### ZONE_LAYOUTS constant (in timelineEditor.js)

Six predefined layouts, each with:
- `key` — unique string identifier
- `name` — display name
- `svg` — inline SVG preview (36×24 viewport)
- `zones` — array of zone objects built via `mkZone(id, name, color, region, zIndex, blendMode?)`

| key | name | zones |
|-----|------|-------|
| `full` | Full Screen | `full` at `{0,0,1,1}` |
| `left-right` | Left \| Right | `full` left + `right` right |
| `top-bottom` | Top / Bottom | `full` top + `bottom` bottom |
| `quadrants` | 4 Quadrants | `full` TL + `q2` TR + `q3` BL + `q4` BR |
| `center-frame` | Center + Frame | `full` frame + `center` overlay (screen blend) |
| `top-banner` | Top Banner | `full` main + `banner` strip (screen blend) |

---

## File Map

### New files (all Phase 1–3)

| File | Responsibility |
|------|---------------|
| `timeline.html` | Page entry point — start screen, shell, all modals including Zone Manager |
| `src/timeline/main.js` | Boot: audio source → engines → `TimelineEditor`; mini audio player |
| `src/timeline/timelineEditor.js` | Core class — strip rendering, drag, zone management, playback engine |
| `src/timeline/style.css` | Full design system for timeline — tokens, overlays, strip, blocks, modals |
| `src/timelineStorage.js` | Timeline CRUD (localStorage) — `createTimeline` (in-memory only, no save), `saveTimeline`, `loadAllTimelines`, `pruneEmptyUntitled`, `createEntry`, `exportTimeline`, `importTimeline` |

### Modified files

| File | Change |
|------|--------|
| `vite.config.js` | Added `timeline: resolve(__dirname, 'timeline.html')` to `rollupOptions.input` |
| `src/controls.js` | Added `L`/`l` case: `window.open('/timeline.html')` |
| `src/visualizer.js` | Added `initSlave(canvas, primaryEngine)` method + `_isSlaveEngine` guard in render loop |

`src/main.js`, `index.html`, `src/editor/inspector.js`, `src/editor/presetLibrary.js` are **not touched**.

---

## Key Methods Reference

### TimelineEditor constructor
```js
new TimelineEditor({ engine, canvasContainer })
```
`engine` = primary `VisualizerEngine`. `canvasContainer` = `#tl-canvas-container` div. The initial canvas (already in the container) is grabbed for the 'full' zone.

### Zone management
| Method | What it does |
|--------|-------------|
| `_syncZoneCanvases()` | Diffed update — creates slave canvases for new zones, removes canvases for deleted zones, repositions/resizes existing ones. Called after any layout change. |
| `_positionCanvas(canvas, zone)` | Sets CSS %, pixel dimensions, zIndex, mixBlendMode |
| `_updateStripHeight()` | Computes `--strip-h = 26 + N×68 + 2` px and updates transport `bottom` |
| `resizeAllZones()` | Called from `main.js sizeCanvas()` on window resize |
| `_applyLayout(layout)` | Replaces `_tl.zones` + clears entries (with confirm). Calls `_syncZoneCanvases` + `_renderStrip`. |

### Playback
| Method | What it does |
|--------|-------------|
| `play()` | Sets `_playStartWall`, calls `_playZone(id)` for every zone, sets master stop timer |
| `_playZone(zoneId, fromTime = 0)` | Finds active entry at `fromTime` (load immediately), schedules future entries with `setTimeout`. Stores array of handles at `_zoneTimers.get(zoneId)`. |
| `stop()` | Clears all timer arrays, master timer, rAF. Resets button UI. |
| `_scrubTo(t)` | Cancels all timers, resets `_playStartWall`, calls `_playZone(id, t)` per zone |
| `_rescheduleIfPlaying()` | No-op when stopped. When playing: reads `tNow` from wall clock, calls `_scrubTo(tNow)` to rebuild all timers from the current data model. Called after every mutation. |

### Entry management
| Method | What it does |
|--------|-------------|
| `addEntry(presetName, zoneId)` | Computes `startTime = end of last entry in zone`, calls `createEntry(...)`, pushes to `_tl.entries` |
| `_migrateEntryStartTimes(tl)` | Assigns cumulative start times to old timelines where all entries have `startTime === 0` |
| `_zoneEntriesFor(zoneId)` | Filters entries by zone and **sorts by `startTime`** |
| `_totalDuration()` | `max(entry.startTime + entry.duration)` across all entries |

### Fullscreen
| Method | What it does |
|--------|-------------|
| `toggleFullscreen()` | Enters or exits fullscreen based on `_isFullscreen`. |
| `_enterFullscreen()` | Calls browser or Tauri fullscreen API, calls `_hideOverlays()`. |
| `_exitFullscreen()` | Exits fullscreen, calls `_showOverlays()`. |
| `_onFullscreenChange()` | Fired by `fullscreenchange` / `webkitfullscreenchange` — syncs `_isFullscreen`, restores overlays on exit. |
| `_updateFsIcon(bool)` | Swaps enter/exit SVG icons and toggles `.fs-active` class on the button. |
| `_showOverlays()` | Removes `.tl-hidden` from all overlay elements + restores strip opacity. |
| `_hideOverlays()` | Adds `.tl-hidden` to all overlay elements + fades strip. |

---

## Overlay Auto-hide Rules

| State | Topbar | Transport | Strip | Mini-player |
|-------|--------|-----------|-------|-------------|
| Normal (any) | Visible | Visible | Visible | Visible |
| Fullscreen active | Hidden | Hidden | Hidden | Hidden |
| `T` key | — | — | Toggles panel | — |

The `#tl-fullscreen-btn` is **not** in `_overlays`. It lives outside the overlay system at `z-index: 110` and is always reachable — it is the only element visible in fullscreen mode.

---

## HTML Structure (current)

```
timeline.html
  #tl-start           — start screen (audio picker)
  #tl-shell           — revealed after boot
    #tl-canvas-container  — zone canvases injected here by JS
    #tl-topbar            — overlay: back link, timeline select, name input, save/copy/paste/delete
    #tl-transport         — overlay: play/stop, loop, time display, zoom, snap, ⊞Zones, +AddPreset
    #tl-strip             — timeline strip
      #tl-scroll          — horizontal scrollable
        #tl-inner         — sized by JS (total duration × pxPerSec)
          #tl-ruler       — time ruler (click to seek)
          #tl-tracks      — zone rows appended here by JS
          #tl-playhead    — absolute positioned, driven by rAF
    #tl-picker            — preset picker modal (All / Favorites / My Presets tabs)
    #tl-quick-edit        — block action modal (Duration, Blend, Label, Duplicate, Delete — Phase 4.4-A complete)
    #tl-ctx-menu          — right-click context menu (DOM present but no longer wired to blocks)
    #tl-zone-mgr          — zone layout picker modal (6 tiles)
    #tl-delete-modal      — confirm delete timeline
    #tl-toast             — ephemeral status messages
    #mini-player          — overlay: audio file player
    #tl-fullscreen-btn    — always-visible fullscreen toggle (top-right, z-index 110)
```

---

## CSS Variables

Defined in `src/timeline/style.css` `:root`:

| Variable | Default | Meaning |
|----------|---------|---------|
| `--strip-h` | `calc(26px + 68px + 2px)` | Total strip height — JS overrides dynamically via `_updateStripHeight()` when zone count changes |
| `--topbar-h` | `52px` | Fixed |
| `--transport-h` | `50px` | Fixed |
| `--ruler-h` | `26px` | Fixed |
| `--track-h` | `68px` | Per-zone row height — fixed |
| `--zone-col-w` | `120px` | Width of zone label column |

---

## Save & Naming UX Design

> **Note:** The labels in this section use legacy "timeline" language. The shipped UI uses these labels — the rename to "Timeline Set" language (`Save Set`, `My Sets`, etc.) is part of Roadmap Phase 4.12-C. This section documents the current running code.

### The Problem
Three distinct concerns were visually flattened into one topbar with no state differentiation:
1. **Navigate** between Timeline Sets — the `<select>` dropdown *(to be replaced by My Sets panel in Roadmap Phase 4.12-B)*
2. **Name** the current set — the text input (same text, same size, visually parallel)
3. **Persist** the current state — Save button (fires immediately, no feedback on *what* it's doing)

The `<select>` and `<input>` both showed "Untitled Timeline" with no explanation of why. Save had one label for two very different operations (first-time save vs. overwrite).

### Timeline Set State Machine
Every Timeline Set is in one of three states. The UI makes the current state legible at a glance:

| State | Meaning | `_isNew()` | `_dirty` |
|---|---|---|---|
| **New** | Created this session, not in storage yet | `true` | `false` (until edits) |
| **Saved / Dirty** | In storage, has unsaved edits | `false` | `true` |
| **Saved / Clean** | In storage, matches last save | `false` | `false` |

`_isNew()` checks `!this._timelines[this._tl?.id]` — a set is new if its ID is not in the in-memory map (which mirrors localStorage).

### Save Button — Three Behaviors *(current labels — will become "Save Set" in Roadmap Phase 4.12-C)*
| State | Button Label | Click Behavior |
|---|---|---|
| **New** | `Save…` (ellipsis = step follows) | Opens naming dialog |
| **Saved / Dirty** | `Save` | Immediate overwrite + toast |
| **Saved / Clean** | `Saved` (dimmed, `is-saved` class) | Disabled, no-op |

### Dirty Indicator
`<span id="tl-dirty-dot">` — a 7px circle, soft purple — appears next to the name input whenever the timeline has unsaved changes. Hidden for new timelines (nothing to show drift from) and after a clean save.

### Naming Dialog (`#tl-save-modal`)
Shown only when state = New and user clicks `Save…`:
- Title input pre-filled with current name, fully selected
- Empty name disables the Save button
- Enter → save; Escape → cancel
- On save: persists, closes dialog, button → `Saved` (dimmed), dot disappears

### Rename Flow
The topbar name input remains but is styled as a title field (no visible border at rest, focus border on click). Editing the name marks state Dirty; the user still consciously saves. Rename ≠ save.

### Discard Guard
When switching timelines via the `<select>` while `_dirty`, a `confirm()` prompts before discarding. Cancelling restores the select to the current timeline ID.

### Implementation Methods
| Method | Role |
|---|---|
| `_isNew()` | `!this._timelines[this._tl?.id]` |
| `_setDirty()` | `this._dirty = true` + `_updateSaveBtn()` |
| `_setClean()` | `this._dirty = false` + `_updateSaveBtn()` |
| `_updateSaveBtn()` | Reads `_isNew()` + `_dirty`, sets button text/disabled/`is-saved` class + dot visibility |
| `_openSaveDialog()` | Pre-fills `#tl-save-name`, shows `#tl-save-modal`, focuses input |
| `_closeSaveDialog()` | Hides `#tl-save-modal` |
| `_executeSave()` | Reads name from dialog input, persists, updates `_timelines`, `_setClean()`, refreshes selector |
