# Timeline Editor — Design & Planning Doc

**Architecture:** Standalone page (`/timeline.html`) — self-contained MPA entry in Vite.
**Completed-phase detail:** lives in **[timeline-editor-archive.md](timeline-editor-archive.md)** — this doc keeps only a one-line index of shipped work.
**Last updated:** 2026-05-19 — Phase 4.6 (Overlap Crossfade) shipped. Crossfade into a block = `hardCut ? 0 : min(duration, max(blendTime, overlapWidth))`: adjacent blocks keep the 2s default, dragging an overlap extends the blend, and a per-block **Hard Cut** toggle in the block menu forces an instant switch. Follow-up fix: scrubbing into an overlap now activates the incoming block (the immediate-entry lookup picks the latest-starting match). Block colour picker shipped (Phase 4.4-D). Block menu is a pure action menu (Phase 4.4-C) plus the Hard Cut toggle. See the Status Dashboard.

---

## 📊 Status Dashboard

*Read this section and nothing else to know where the project stands.*

### Legend

| Mark | Meaning |
|------|---------|
| ✅ | Shipped — full detail in the archive |
| ⬜ | Planned — not started |
| 🔬 | Research |

### Recently Shipped

| Phase | What | Date |
|-------|------|------|
| 4.14-A | Transition Styles — per-block transition picker in the block menu: **Fade** (crossfade) · **Black** · **White** · **Cut**. `entry.hardCut` boolean generalised to `entry.transition` enum; `_playZone` routes on it; `fade-black`/`fade-white` dip through colour centred on the block start. Wipes (4.14-B) still pending. | 2026-05-19 |
| — | Drag runway + edge auto-scroll — resizing or moving a block past the visible strip now works in one continuous gesture: the strip auto-scrolls when the pointer nears either edge and the inner width grows ahead of the drag. No more drag-release-scroll-regrab to stretch a 30s block to 3:00. | 2026-05-19 |
| 4.6 | Overlap Crossfade — overlap width drives the crossfade duration (floored at the 2s `blendTime` default); per-block **Hard Cut** toggle for instant switches | 2026-05-19 |
| 1 | Loop — Marker Region Looping **complete** — draggable loop regions (band + end handle + track tint), region-aware playback, 1s crossfade on the loop wrap | 2026-05-18 |
| 1 Stage 2 | Loop regions — set a marker to Loop → draggable loop region (band + end handle + track tint); playback wraps the region (no longer restarts from 0:00) | 2026-05-18 |
| 1 Stage 1 | Marker hygiene — `M`-key placement (ruler is playhead-only), dedicated marker lane, playhead-scrub bug fixed, `stop`-action crash fixed, duplicate hot-cue handler removed | 2026-05-18 |
| 4.4-D | Block colour picker — 16-colour palette, 4×4 popover off the menu swatch | 2026-05-18 |
| 4.4-C | Block Menu Redesign — pure action menu (Duration/Blend/Label all removed; header + Duplicate/Delete) | 2026-05-17 |
| 4.10-A | Real-time Live Editing (mutation reschedule) | 2026-05-12 |
| 4.5 | Double-click to Cue | 2026-05-12 |
| 4.4-B | Block Menu Icon | 2026-05-12 |
| 4.4-A | Block Action Modal | 2026-05-12 |
| 4.8 | Preset Palette Opacity | 2026-05-12 |

### 🎯 Up Next — Priority Order

> **To re-prioritize, reorder the rows in this table.** The top unbuilt row is what gets built next. Full spec for each is in the Roadmap section below (same numbers).

| # | Phase | What it adds |
|---|-------|--------------|
| 3 | 4.14-B — Transition Wipes | Directional `wipe-left/right/up/down` transitions *(4.14-A — colour fades — shipped 2026-05-19)* |
| 4 | 4.9 — Zone Stack | Layered compositing — zone opacity + blend-mode popover, overlay layout |
| 5 | 4.11 — Staging Mode | Safe overlay editing; changes commit on the next block boundary |
| 6 | 4.12 — Timeline Sets Switching | Queued set switching + My Sets panel (replaces the topbar dropdown) |
| 7 | 4.13 — Set Export / Import | Portable `.dcset.json` bundles — full show + presets + images |
| 8 | 4.4-D — Block menu utilities | Full Edit → deep-link into Preset Studio *(4.4-C menu redesign + the block colour picker both shipped)* |
| 9 | Phase 5 — Multi-monitor output 🔬 | Route each zone to a separate physical display (research phase) |
| 10 | 4.7 — Undo/Redo | `Ctrl+Z` for drag/delete/resize — **deferred** to the end: build it once the feature set is stable, not mid-stream |

---

## 📖 How to Use This Doc

- **What's next** is the *Up Next* table above — the single source of priority. Reorder its rows to change priority; nothing else needs editing.
- **Completed phases** are summarized in the *Completed Phases — Index* table. Implementation detail is in **[timeline-editor-archive.md](timeline-editor-archive.md)**.
- **Before touching playback / fade / scrub code**, read *⚠️ CRITICAL: Playback & Cover System* — it exists because of a past regression.
- **When a phase ships:**
  1. Move its detail into the archive file.
  2. Add a row to *Recently Shipped* and to *Completed Phases — Index*.
  3. Remove its row from *Up Next*.
  4. Update *Current State — What's Built*.
- **After every code change**, update this doc (project rule — see CLAUDE.md).

---

## UX Philosophy — Authoring vs Performance

*(Reframed 2026-05-17 — this supersedes the earlier "Complexity Ladder / Orchestration Console" model.)*

The timeline editor splits cleanly into two modes, and every feature belongs to exactly one of them:

- **Authoring** — you *manage* an entry through its **block menu**: a small popover for block actions (Duplicate, Delete; later a color picker and a Full Edit → deep-link). It opens on the block's menu icon and closes cleanly — one open at a time, never during a show. It holds no settings to commit and no live-mixing controls. *(The entry's duration is set by dragging the block; blend by overlapping blocks — Phase 4.6; looping by markers — Roadmap #1. None of that is in the menu.)*
- **Performance** — you *trigger* what you authored, using gestures on the strip itself: **double-click a block** to crossfade into it with its stored settings; **click the timeline** to drive the playhead. No menus, no popovers — just the clean strip and direct clicks.

This separation is the core principle. The menu holds the intent; the strip gesture is the trigger. Setup and execution are never the same gesture, and performing never means hunting through open UI.

**Where the complexity lives.** All the visual artistry is *inside the preset* — built in Preset Studio, with its layers, effects, and shaders. A preset dropped on the timeline is already a finished, complex thing. The timeline's job is the opposite: stay simple and fluid. The VJ brings presets in and out, keeps the flow, stays contained. The interface leans toward simplicity by default — but it does not cap you: the headroom to switch hard and go wild is there if you want it. Every timeline control is judged against this — *does it keep the flow simple, or does it bog the VJ down?* When in doubt, fewer controls, bigger targets, faster gestures.

| Layer | What you see | How you get there | Mode |
|-------|-------------|-------------------|------|
| 0 | Full-screen canvas + timeline strip | Default | **Performance** — double-click blocks, click the ruler |
| 1 | Block menu — one entry's settings + Apply | Click the block's menu icon | **Authoring** — closes on Apply/Cancel |

**Solo / Mute live on the zone-row header — not in a panel, not in the block menu.** Each zone row already renders a label column (color dot + name + "+"); S/M buttons sit there, mixer-style — one click, instant, no menu. This is the universal DAW convention and the *only* live-mixing control that ships near-term.

**A full per-zone controls overlay (the "Performance Panel") stays down the road.** Re-targeting the whole `controls.js` panel to a zone's engine is deep live control — genuinely wanted, but deferred until the core feature set works. The preset already carries the visual complexity, so the timeline does not need it to perform a show. See the Backlog "Performance Panel" entry.

**Evaluation rule:** Is this control *authoring* (set it, Apply, done) or *performance* (trigger it live)? Authoring goes in the block menu. Performance goes on the strip — a direct gesture or a zone-header button. Nothing live-mixing goes in the block menu.

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

### 1 · Loop — Marker Region Looping ✅

*(specced under Phase 3.5; ships with Phase 4.10-B — loop state preservation)*

**Revised 2026-05-17 — markers are the only looper.** Earlier plans had *two* loop mechanisms: a per-block Loop toggle in the block menu plus marker region looping. Cut to one. **Markers are the loopers** — they already carry a `loop` action (Phase 4.1), they can be dropped and removed live on the ruler, and they bound a loop region of any width. A per-block Loop toggle would be the same capability built twice, and would put a setting back in the block menu we deliberately emptied. So: **no Loop toggle, no transport-bar Loop buttons.** Looping is a marker region, full stop — the block menu stays a pure action menu (Duplicate / Delete).

This phase has three parts: tightening marker looping with live add/remove (**1-A**), its at-a-glance visibility on the strip (**1-B**), and the relaxed jump crossfade that makes loop release — and every timeline jump — feel smooth (**1-C**).

> **Stage 1 shipped 2026-05-18 — marker hygiene + placement.** Markers now drop at the playhead with the **`M` key** — instant, no popover. The ruler is playhead-only; it never places markers (the universal DAW convention — placement is a command, not a spatial click). Editing stays a click-the-flag gesture, so placement / positioning / editing are three distinct actions. Flags now live in a **dedicated marker lane** (`#tl-marker-lane`) — a thin row below the ruler, off the time ticks. **Click anywhere in the lane to drop a marker there**; click an existing flag to edit it, drag to move. Two strips, two jobs: the ruler places the playhead, the marker lane places markers. Also fixed: the **playhead-scrub bug** (drags got stuck "on" via a swallowed `pointercancel` → playhead followed the mouse — see Open Bugs), the `stop` marker action crash (undefined `_clearAllTimers`), and a duplicate `1`–`9` hot-cue handler.
>
> **Stage 2 shipped 2026-05-18 — region looping.** Set a marker's action to **Loop** and it becomes a loop region: the marker `time` is the loop start, a new `loopEnd` field (defaults to `time + 16s`) is the end. In the marker lane it draws a **loop band** with the flag as the start handle and a separate **end handle**; a translucent **tint** spans the looped region across the tracks. Drag the end handle to resize, the flag to move the start, the band body to slide the whole region — all snap-aware, no number entry. Playback (`_tickPlayhead`) wraps: crossing `loopEnd` seeks back to `time` via `_scrubTo` and continues. The old "restart from 0:00" placeholder is gone.
>
> **1-C shipped 2026-05-18 — relaxed loop wrap.** The loop wrap crossfades instead of hard-cutting: `_scrubTo` / `_playZone` take an optional `blend`, and the loop branch passes `1.0` so Butterchurn crossfades the loop-end visual into the loop-start visual over 1 second. All other seeks (ruler, cue, hot-cues) still pass `blend = 0` — instant. **Roadmap #1 is now complete.**

> 📜 **Historical — design exploration only.** The `#### 1-A / 1-B / 1-C` detail below is the original planning, kept for reference. It predates the final design and describes ideas that were **cut** — a per-block Loop toggle, Loop Solo, and loop-precedence rules; none of those shipped. What actually shipped is the three Stage notes above: markers are the only looper, looping is a draggable marker region, and the wrap crossfades. Treat the Stage notes as authoritative.

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

**Relationship to the block menu:** none. Looping is a marker mechanism (revision note above) — it adds nothing to the block menu, which stays a pure action menu (Duplicate / Delete). Marker looping is edited on the ruler / in the marker popover (`#tl-marker-edit`), live. Solo / Mute are also not block-menu controls — they are live mixing on the zone-row header (see Backlog).

---

### 2 · Phase 4.6 — Overlap-driven Crossfade Timing ✅ (shipped 2026-05-19)

**The crossfade into a block is now one rule:** `crossfade = hardCut ? 0 : min(duration, max(blendTime, overlapWidth))`.

| Placement | Crossfade into the block |
|---|---|
| **Hard Cut** toggled on | `0` — instant switch |
| **Overlaps** the previous block | overlap width — floored at `blendTime` (overlap only ever *extends* the blend, never shortens it) |
| **Adjacent** / dropped normally | `blendTime` default (2s) — no editing needed |
| **Gap before** the block | unchanged — fade-from-black over `blendTime` (hard cut makes it an instant snap-on) |

**Why a floor and not raw overlap:** dropping a preset on the fly should "just blend" without editing — the 2s default covers that. Dragging an overlap is the gesture to make a blend *longer*; to make it *shorter than 2s* (a cut), use the Hard Cut toggle, not a thin overlap.

**Implementation:**
- `_playZone` — the consecutive/overlap branch computes `crossfade` from `overlap = lastEnd - st` (read off the skip-safe `lastEnd` tracker, never `entries[i-1]`) and passes it to `loadPreset`. The gap branch zeroes `fadeDurIn` when `hardCut` is set.
- `TimelineEntry` gained a `hardCut: boolean` field (default `false`). Absent on pre-4.6 entries → falsy → treated as `false`; no migration needed.
- Block menu — a **Hard Cut** toggle (instant, no Apply; reschedules playback live). The menu stays a no-form action menu.
- Strip render — the `.tl-block-blend` wedge is sized to the *effective* crossfade and gets an `.is-overlap` style when overlap-driven; a hard-cut block draws a red `.tl-block-cut` tick instead.

**Scrubbing into an overlap (fixed 2026-05-19).** Both immediate-entry lookups (`_playZone` and the stopped-state branch of `_scrubTo`) now pick the **last** (latest-starting) entry containing the playhead, not the first. Previously the earlier block won, so the incoming block was never scheduled and the outgoing block played on forever. Now parking the playhead inside an overlap snaps to — and plays forward from — the incoming block. The crossfade itself does not *animate* from a mid-overlap park (scrub is an instant preview gesture); to watch the blend, start just before the incoming block's `startTime`.

---

### 3 · Phase 4.14 — Transition Styles ⬜

> **4.14-A shipped 2026-05-19 — colour fades.** The block menu's Hard Cut toggle is now a four-way **Transition** segmented control: Fade (crossfade) · Black · White · Cut. `entry.hardCut` (boolean) was generalised to `entry.transition` (enum); `transitionOf(entry)` falls back to the old boolean for legacy entries so unsaved old sets still play right. `_playZone` routes on the transition: `cut` snaps, `crossfade` uses Butterchurn's internal blend, `fade-black`/`fade-white` dip the zone cover through that colour centred on the block start (`_fadeZoneCover` gained a white cover variant). The strip draws a per-transition glyph (`.tl-block-cut` tick / `.tl-block-fade` wedge / `.tl-block-blend` hatch). The selected segment uses a neutral dark grey (`#4a4a4f`) — *not* an accent colour; purple clashed with the visualizer canvas behind the popover. **4.14-B (wipes) is the remaining work** — see the Up Next table.

**The ask:** every block enters with the same transition today. The only choice is the binary **Hard Cut** toggle (cut vs. crossfade). A VJ wants to pick the *style* of each transition — crossfade, fade through black, fade through white, or a hard cut.

#### Audit — what exists today

| Piece | Current state |
|---|---|
| Data | `entry.hardCut: boolean` — the only transition control |
| Engine | `_fadeZoneCover(zoneId, opacity, durationSec, style)` — the `style` param already exists; only `'fade-black'` and `'cut'` are implemented. The JSDoc already lists `'fade-white'`, `'flash'`, `'dip-to-black'` as "future." |
| Scheduling | `_playZone` branches on `hardCut` + gap/overlap — gap → fade-from-black, adjacent/overlap → Butterchurn internal crossfade |
| UI | One **Hard Cut** toggle in the block menu (`#qe-hardcut`, a `role="switch"`) |
| Strip | `.tl-block-cut` red tick (hard cut) or `.tl-block-blend` wedge (crossfade) |

The cover is a single black `<div>` per zone, opacity-animated. Everything needed for colour fades is already in place — this phase mostly *exposes* it.

#### Design — replace the boolean, don't add a setting

`entry.hardCut` (boolean) becomes `entry.transition` (string enum). This keeps the block menu's control **count unchanged** — no setting-creep. Cut survives as one option in the enum, so nothing is lost.

**4.14-A — Colour transitions (this phase):**

| `transition` | Behaviour |
|---|---|
| `crossfade` *(default)* | Butterchurn internal blend over `blendTime` — today's adjacent-block behaviour |
| `cut` | Instant switch — exactly today's Hard Cut |
| `fade-black` | Outgoing fades to black, incoming fades up from black, over `blendTime` |
| `fade-white` | Same, through white — needs a white cover variant |

**4.14-B — Wipes (follow-up, NOT this phase):** `wipe-left/right/up/down` — a directional `clip-path` reveal on the cover. Deferred because wipes need geometry plus a direction sub-control; bundling them would risk the contained colour-fade work.

#### UI — the block menu

The Hard Cut toggle row becomes a **Transition** segmented control: four small buttons — Crossfade · Black · White · Cut — one tap each, instant, no Apply (the same live-reschedule behaviour the toggle has now). A segmented row reads at a glance and fits the "pure action menu" philosophy better than a dropdown. Net controls in the menu: one row out, one row in — unchanged.

#### Migration

`hardCut:true` → `transition:'cut'`; `hardCut:false`/absent → `transition:'crossfade'`. Done in `timelineStorage.js` load-normalize; `createEntry` defaults `transition:'crossfade'`. The `hardCut` field is dropped.

#### Touch points

- `timelineStorage.js` — `createEntry` field + load-normalize migration; remove `hardCut`
- `_playZone` — route on `entry.transition` instead of `hardCut`; `fade-black`/`fade-white` select the cover colour
- `_fadeZoneCover` — implement `fade-white` (white cover variant — a CSS background swap on the cover div)
- `timeline.html` + `style.css` — Hard Cut toggle → Transition segmented control
- `_syncHardCutToggle` → `_syncTransitionPicker`; strip indicator gets a per-transition glyph

#### Resolved — transition is placement-independent

`fade-black` / `fade-white` only happen automatically across *gaps* today. **4.14 makes the transition a pure creative choice, independent of block placement** — an adjacent `fade-black` block deliberately dips to black between two touching blocks. That dip is a tool, not a glitch: it's a breath, a punctuation beat in a set. A VJ picking "Black" means "I want black here" regardless of whether a gap happens to exist.

This means `_playZone` routes on `entry.transition` *first*; gap vs. adjacent only affects the default when `transition` is unset on a legacy entry. The adjacent-block branch gets wired for `fade-black`/`fade-white`, not just gaps.

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

### 8 · Phase 4.4-D — Block Menu Utilities ⬜

Phases 4.4-A, 4.4-B, 4.4-C, and the colour picker shipped (see archive). The block menu (`#tl-quick-edit`) is a **pure action menu** — a glassmorphic header (`qe-swatch` + preset name) and a Duplicate/Delete utility row. It has no settings and no Apply/Cancel, opens one at a time, and never stays open during a show.

**Remaining — Phase D:**
- **"Full Edit →"** deep-link into Preset Studio for this preset.

**Block colour picker — shipped 2026-05-18.** The header dot is now a clickable **`qe-swatch`**; clicking it opens `#tl-color-picker`, a 4×4 popover of 16 vibrant palette colours (`BLOCK_COLORS`, also used by `colorFor` auto-assignment). Picking applies instantly — `_pickColor` → `_updateEntry({ color })`, re-renders the strip, updates the swatch, closes the popover. No Apply (consistent with the action menu). Closes on Escape / outside click; the current colour shows a selection ring.

**Phase 4.4-C — shipped 2026-05-17.** Built first as an authoring redesign (Duration removed, Blend stepper, zoned layout), then revised the same day: Blend removed (overlap drives blend — Phase 4.6) and Label removed (`entry.label` was never rendered). With no settings left, Apply/Cancel and the settings zone were dropped — the menu is now a pure action menu. Looping is not here either: markers are the only looper (Roadmap #1).

**Hard Cut toggle — shipped 2026-05-19 (Phase 4.6).** The block menu gained one control: a **Hard Cut** switch (`#qe-hardcut`). It is an *instant toggle* — flips `entry.hardCut`, reschedules playback, no Apply — so the menu stays a no-form action menu. When on, the block enters with an instant cut instead of a crossfade.

**Moved out — the old Phase 4.4-E.** Re-targeting the full `controls.js` panel to a zone's slave engine is *live mixing*, not authoring. It lives in the deferred **Performance Panel** (see Backlog). The block menu never holds live-mixing controls.

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

### 10 · Phase 4.7 — Undo/Redo ⬜

> **Deprioritized 2026-05-19** — moved to the end of the roadmap. Undo/Redo is most useful once the full feature/settings surface is stable; building it mid-stream means re-touching the command stack every time a new mutating gesture lands. Build it once the feature set is in place.

Accidentally dragging a block, deleting it, or resizing it has no recovery today. Minimum viable scope: a command stack for the three most destructive gestures.

| Action | What's undone |
|--------|--------------|
| Drag (position change) | Restores `entry.startTime` to pre-drag value |
| Delete block | Re-inserts entry at its original position |
| Resize (duration change) | Restores `entry.duration` to pre-resize value |

**Not in scope (v1):** undo for timeline-level operations (delete whole timeline, change zone layout) — those have confirm dialogs already. Not in scope: multi-level redo. Single-level `Ctrl+Z` / `Cmd+Z` covers the real workflow pain.

**Technical approach:** before each mutation, push a snapshot `{ type, entryId, before }` onto a stack in `TimelineEditor`. `_handleUndo()` pops the top entry and applies the inverse. No external library needed — the data model is simple enough for manual snapshots.

---

## ✅ Completed Phases — Index

One line each. Full implementation detail, post-ship fixes, and edge-case notes are in **[timeline-editor-archive.md](timeline-editor-archive.md)**.

| Phase | Summary |
|-------|---------|
| 1 | Single-zone editor — CRUD, DOM strip, preset picker, transport, advancing playhead |
| 2 | Multi-zone compositor — slave engines, 6 zone layouts, per-zone strip rows |
| 3 | UX polish — position-based dragging, inline block actions, always-visible controls, fullscreen button |
| 3.5 | Active Playhead — click-to-seek, persistent position, automated gap crossfades. Loop buttons were cut (markers are the only looper) — phase fully complete |
| 4.1 | VJ Markers — ruler cue points + 1–9 hot-cue keys, `stop`/`loop` marker actions |
| 4.2 | Transport & Seeking — go-to-start, skip-to-next, VJ-mode stop (visuals keep running) |
| 4.3 | Quick Wins — keyboard nudge, drag-scrub on ruler, block navigation arrows |
| 4.4-A | Block Action Modal — Duplicate/Delete consolidated into `#tl-quick-edit`, hover row removed |
| 4.4-B | Block Menu Icon — hamburger toggle, single-click select, double-click cue, no auto-dismiss |
| 4.4-C | Block Menu Redesign — reduced to a pure action menu: glassmorphic header (color dot + preset name) + Duplicate/Delete. Duration removed (drag-only), Blend removed (overlap drives it — Phase 4.6), Label removed (never rendered). No settings, no Apply/Cancel |
| 4.5 | Double-click to Cue — crossfade into the cued preset + seek timeline to its `startTime` |
| 4.6 | Overlap Crossfade — `crossfade = hardCut ? 0 : min(duration, max(blendTime, overlapWidth))`; per-block Hard Cut toggle in the block menu |
| 4.8 | Preset Palette Opacity — MilkDrop background-layer opacity slider (prereq for Zone Stack) |
| 4.10 | Real-time Live Editing — `_rescheduleIfPlaying()` rebuilds timers after any mutation. 4.10-B (loop-state preservation) made obsolete by the marker-loop redesign — phase fully complete |
| 1 (Roadmap) | Loop — Marker Region Looping — `M`-key marker placement, dedicated marker lane, draggable loop regions (band + end handle + tint), region-aware playback with a 1s wrap crossfade. Markers are the only looper. |

---

## Backlog

Unscheduled ideas. Promote to the Roadmap and the *Up Next* table when ready to commit.

### Zone Solo / Mute — zone-header buttons *(near-term, ships independently — 2026-05-17)*

Per-zone Solo and Mute, mixer-style. **Decided home: the zone-row label column** — `_createZoneRow` already renders `tl-zone-label` (color dot + name + "+" button) per zone row. Add S and M buttons there. One click, instant, no menu — the universal DAW/mixer convention every VJ already knows.

- Acts on the **zone** (the channel), never a single block — soloing one block makes no sense as a live gesture.
- Live state is **ephemeral** — never saved in the Timeline Set, consistent with "a Set does not contain the playhead position."
- Ships **independently of the Performance Panel** — it needs no overlay, just two small buttons in a column that already exists. Promotable to the Roadmap whenever core work allows.
- Open: interaction with the Zone Stack (Roadmap #3) compositing — Solo behavior while zones are layered.

### ⭐ Performance Panel — per-zone controls overlay *(reframed 2026-05-17 — supersedes the "Orchestration Console")*

A deferred overlay holding the *full* `controls.js` panel per zone — deep live control of each zone's visualizer. **Down the road, not near-term.** The preset already carries all the visual artistry (built in Preset Studio); the timeline does not need this panel to perform a show. Built only after the core feature set works — Loop, overlap crossfade, zone stack, undo/redo, sets.

**Solo / Mute are NOT in this panel** — they moved to the zone-row header (above). The panel is purely the deep controls surface.

**Why it is NOT the block menu.** An earlier plan — the "Block Menu Orchestration Console" (2026-05-15) — proposed making block menus stay open and serve as the live console. **Reversed 2026-05-17:** block menus are *authoring* surfaces — set settings, Apply, close, one open at a time. Authoring and performance never share a surface; that split is now the core UX principle.

**What the panel would hold:**
- The full `controls.js` panel per zone, re-targeted to that zone's slave `VisualizerEngine` (the old Phase 4.4-E). Technical note: `src/controls.js` currently targets the primary engine; each zone has its own engine at `_zoneMap.get(zoneId).engine`. The panel re-targets controls on open and restores the original target on close — no new slider widgets, just a target-swap.

**Open design question — resolve before building:**
- Overlay layout — full-width strip vs floating panel vs docked tray. It must not bury the timeline strip ("room to breathe").

**Still-valid Loop decisions** (Loop itself ships in the block menu as an armed setting — Roadmap #1, not this panel):
- **Loop is one per-block toggle.** No transport buttons, no separate "Loop Solo." Full design + precedence: Roadmap #1.
- **No loop-conflict prompts.** Conflicts resolve silently by precedence, never by a mid-performance dialog. A preset loop vs a marker region loop is settled by precedence (the preset loop wins). The fix for "loops are hard" is **visibility, not prompts** — loop state shows on the strip (active loop = pulsing indicator; armed-but-overridden = a distinct muted indicator).

*Loop & Regions*
- **Loop region markers** — region looping is bounded by markers (Roadmap 1-A). Possible convenience: drag a range on the ruler to drop an in/out marker pair in one gesture — not a separate system, just a faster way to place the two markers.
- **Advanced Loop logic** — marker action `loop` jumps to previous loop start rather than `0:00`.

*Live Performance*
- **Per-entry crossfade style** — Cut / White Flash / Black Dip — stored as `transitionStyle` on entry.
- **Live queue override** — during playback, click a future block to force it to play *next*, overriding the timeline's strict chronological order.
- **Hold/freeze preset** — while playing, press `H` to freeze the current preset indefinitely, ignoring upcoming block transitions. Press again to release.
- **Speed control** — 0.5×, 1×, 2× playback speed. Affects wall-clock calculation.
- ~~Entry label canvas overlay~~ — *cut 2026-05-17. The Label field was removed from the block menu; burning captions onto the show runs against "the timeline stays simple." The block already shows the preset name.*

*Audio Sync*
- **Timeline ↔ Audio lock** — when using "Load Track" mode, sync the timeline playhead with the audio file's `currentTime`. Scrubbing one scrubs both. Playback of one drives both.
- **BPM grid on ruler** — enter a BPM; ruler shows beat markers. Blocks snap to beat boundaries on drag/resize. Playhead shows current beat count.
- **Beat-triggered transitions** — instead of hard time-based transitions, trigger the next preset on the next beat boundary after the block's duration expires.

*Workflow & UX*
- **Auto-fill from Favorites** — button in transport to quickly fill a zone.
- **Multi-select (Shift-click)** — bulk duration stamping and movement.
- **Setlist text export** — plain-text or HTML table.
- **Auto-save behavior** — debounced "draft" slot rather than spawning a new entry per page load.

> *Note 2026-05-17 — the **Performance Panel** was briefly cut (2026-05-15) in favour of the "Orchestration Console" model. That reversed: see the ⭐ Performance Panel backlog entry above. The panel is the right home for live per-zone mixing controls — deferred until the core feature set works, not cut.*

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
- ~~**Entry label overlay not rendered**~~: ✅ Resolved 2026-05-17 by removal — the Label field is gone from the block menu (it controlled `entry.label`, which nothing ever rendered). The "label canvas overlay" idea is cut: the timeline stays simple, the block already shows the preset name. The `entry.label` data field is left in the model (harmless; avoids touching the Set export/import schema).
- ~~**`#tl-quick-edit` styling needs visual polish**~~: ✅ Partially addressed in Phase 4.4-A — Duplicate/Delete consolidated into modal with utility row. Full styling pass (Roadmap 4.4-C/D) still pending.
- ~~**Added presets force-load onto the canvas regardless of playhead**~~: ✅ Fixed 2026-05-17 — the picker click handler used to call `loadPreset` + `_fadeZoneCover` after `addEntry`, so any block you added (or at any start time) jumped straight onto the canvas. Fix: the picker now only mutates the data model; `addEntry` / `_removeEntry` re-derive the canvas from the playhead — `_rescheduleIfPlaying()` while playing, `_scrubTo(this._currentTime)` while stopped. The playhead is the single source of truth; the canvas only ever shows what is under it, and the playhead never moves on add/remove.
- ~~**Playhead follows the mouse with no button held**~~: ✅ Fixed 2026-05-18 — the ruler scrub set an `isScrubbing` flag cleared only on `pointerup`; when the browser swallowed the release as a `pointercancel` (gesture reinterpreted as a scroll), the flag stuck and every mouse-move scrubbed the playhead. Three-part fix across all four drag handlers (ruler scrub, marker drag, block move, block resize): (1) an `e.buttons === 0` self-heal guard ends the drag the instant no button is held; (2) `pointercancel` now runs the same cleanup as `pointerup`, with a re-entry guard; (3) `touch-action: none` on `#tl-ruler` and `.tl-marker-flag` stops the browser stealing the gesture at the source.
- ~~**Block resize/move runs out of room past the visible strip**~~: ✅ Fixed 2026-05-19 — `_renderStrip` only gave 200px of runway past the *current* content end, and the inner width was recomputed on release, never during the drag. Stretching a 30s block to 3:00 meant drag → release → scroll → re-grab, over and over. Fix: a shared `_makeDragScroller` helper drives both block drag handlers — while the pointer nears either horizontal edge of `#tl-scroll` the strip auto-scrolls (speed scales with closeness), `_ensureRunway` grows `#tl-inner` ahead of the drag, and the drag delta is measured in *content* px (viewport movement + auto-scroll travel) so the block keeps tracking the cursor while the strip scrolls. One continuous gesture now stretches or moves a block any distance. `_renderStrip` reconciles ruler/playhead/width on release.
- **Undo/Redo not yet implemented** — scheduled for Roadmap Phase 4.7. Until then, delete and drag are irreversible.

---

## Current State — What's Built and Shipped

Phases 1 through 4.3, 4.4-A/B/C/D, 4.5, 4.6, 4.8, 4.10-A, and Roadmap #1 (Loop) are fully working. Here's an accurate picture of the running code:

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
- Blocks positioned at `entry.startTime * pxPerSec` px — free placement, gaps and overlaps allowed
- Blocks are draggable to any time position (drag body moves the block, updates `entry.startTime` on drop)
- Drag resize right edge → updates `entry.duration`
- Each block draws a transition-in indicator: a `.tl-block-blend` wedge sized to the effective crossfade (`.is-overlap` style when overlap-driven), or a red `.tl-block-cut` tick when `hardCut` is set
- Zone rows stack vertically; height driven by JS setting `--strip-h` CSS var

### Overlap crossfade (Phase 4.6, complete)
- `_playZone` consecutive/overlap branch: `crossfade = hardCut ? 0 : min(duration, max(blendTime, overlap))`, where `overlap = lastEnd - startTime`
- Passed to `loadPreset` so Butterchurn blends across exactly the overlap region; adjacent blocks fall back to the 2s `blendTime` default
- `hardCut` (per-block boolean) — toggled in the block menu; also zeroes the gap fade-in so a post-gap hard-cut block snaps on from black
- Immediate-entry lookup (`_playZone` + stopped `_scrubTo`) picks the **last** entry containing the playhead, so scrubbing into an overlap activates the incoming block

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
- **Block menu contents** → header (colour swatch + name), a **Hard Cut** toggle (Phase 4.6), and Duplicate / Delete
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
  blendTime: number,    // default/floor crossfade in seconds (0–10, default 2)
  hardCut: boolean,     // true → block enters with an instant cut, no crossfade (Phase 4.6)
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
