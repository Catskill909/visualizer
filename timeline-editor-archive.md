# Timeline Editor — Completed Phase Archive

> Implementation detail for **shipped** phases. The live planning doc is **[timeline-editor.md](timeline-editor.md)**.
>
> This file is append-only history. When a phase ships: move its detail here, add a one-line row to the Completed Phases index in the main doc, tick it off the Up Next table.

---

## Phase 1 — Single-zone editor ✅

- `timeline.html`, `src/timeline/main.js`, `src/timelineStorage.js` — full CRUD, export/import
- Full-screen single canvas (VisualizerEngine on Full zone)
- Timeline strip: DOM blocks, drag-to-reorder, resize right edge
- Preset picker modal with search + All/Favorites/My Presets tabs
- Quick-edit popover (Duration, Blend, Label)
- Right-click context menu (Duplicate, Delete)
- Transport: Play/Stop toggle, Loop, time display, Zoom, Snap
- Playhead advancing during playback
- Save / Load / Delete timelines; timeline switcher dropdown
- JSON Copy / Paste export-import; block auto-color from preset name hash
- `vite.config.js` third entry; `L` key in `src/controls.js`
- Custom presets via `engine.refreshCustomPresets()` on boot
- `?preset=<name>` query param pre-adds to new timeline

**Post-ship bug fixes:**
- Delete modal on boot — CSS `display:flex` beat `[hidden]` — fixed with global `[hidden] { display:none !important }`
- Play/Stop confusion — replaced with single `#tl-btn-playstop` toggle (`is-playing` class)
- Ruler `+` cursor confusion — changed to `cursor: pointer`
- Quick-edit overflow — widened to 260px, `min-width:0` on flex inputs

---

## Phase 2 — Multi-zone compositor ✅

- `initSlave(canvas, primaryEngine)` added to `src/visualizer.js` — shared audio graph, `_isSlaveEngine` guards render loop
- 6 predefined zone layouts with SVG previews (`ZONE_LAYOUTS` constant)
- Zone Manager modal (`#tl-zone-mgr` / `#tl-zone-layouts`) opened by **⊞ Zones** button
- `_syncZoneCanvases()` — diffed canvas/engine lifecycle tied to `_tl.zones`
- Multi-row strip — `_renderZoneRows()` builds one `.tl-zone-row` per zone
- Each zone label row has a `+` button (`tl-zone-add-btn`) to add directly to that zone
- Preset picker tracks `_pickerZoneId` — adds to the correct zone row
- `_updateStripHeight()` — `--strip-h` CSS var + transport `bottom` updated dynamically
- `resizeAllZones()` — public, called on window resize from `main.js`
- Playback: `_playZone(zoneId, fromTime)` schedules per-zone, all zones start in `play()`
- Ruler seek: `_scrubTo(t)` calls `_playZone(id, t)` for all zones

---

## Phase 3 — UX polish ✅

- **Position-based dragging** — blocks drag freely to any time position. `entry.startTime` is now stored (not computed). Dragging the block body updates `entry.startTime` directly on drop. `_migrateEntryStartTimes()` auto-converts old sequential timelines on load.
- **Inline block actions** — hover a block to reveal Edit / Duplicate / Delete icon buttons. Clicking them does not trigger drag. Right-click context menu preserved as secondary path.
- **Controls always visible** — auto-hide timer removed entirely. Controls are permanently visible unless fullscreen is active.
- **`#tl-fullscreen-btn`** — always-visible fullscreen icon in top-right corner (replaced the old `≡` pin toggle). Click or press `F` to enter fullscreen and hide all controls. Click again, press `F`, or press `Escape` to exit fullscreen and restore controls. Web uses native browser fullscreen API; macOS app uses Tauri `appWindow.setFullscreen()`.

---

## Phase 3.5 — Active Playhead ✅

> **Note:** Phase 3.5 also specced the **Loop & Loop Solo transport toggle buttons**. Those were *not* built and now live in the main doc Roadmap (entry #1). Phase 3.5 below is the playhead work that did ship.

A classic NLE playhead: click-to-seek, persistent position, play-from-here. This is the foundation for all future transport features (loop ranges, markers, live queue override).

- **Active Playhead State**: Introduced `_currentTime` to `TimelineEditor` to persist timeline position, allowing "play-from-here" functionality and persistent parking when stopped.
- **Play/Pause Toggle Semantics**: Stop button now merely pauses the playhead. Clicking ruler at 0:00 rewinds. Reaching the end of the timeline auto-rewinds to 0:00 naturally.
- **Visuals on Stop**: Stopped timelines show a clean black canvas (covers shown), with the playhead remaining persistently visible to indicate position.
- **Transition / Fade System**: Replaced `display: none/block` cover toggling with an extensible opacity-based `_fadeZoneCover` helper.
- **Automated Crossfades**: Zones automatically fade in from black after gaps, and fade out to black before gaps (based on `blendTime`). Scrubbing instantly snaps without visual lag.

---

## Phase 4.1 — VJ Markers (= Settable Cue Points) ✅

Markers on the ruler ARE the cue point system. The 1–9 keyboard shortcuts are hot cues — press a number to jump immediately to that marker and continue playing from there. This is the DJ/VJ hot-cue model, already fully working.

- **Data Model**: `Timeline` object stores an array of `markers` (`id`, `time`, `label`, `color`, `action`).
- **Interactive Ruler**: Double-click ruler to drop a marker. Click the flag to open the edit popover. Drag to reposition with snap support.
- **Edit Popover**: Label, Color, Action (`none` / `stop` / `loop`). Smart positioning prevents off-screen drop.
- **Playback Execution**: Playhead engine scans markers in the rAF tick loop.
  - `none` action: playhead passes through — marker is a visual label / manual jump target only.
  - `stop` action: halts timeline progression and parks the playhead exactly on the marker. Visuals keep playing (VJ mode — show never stops).
  - `loop` action: halts timeline, wraps playhead back to `0:00`, and resumes seamlessly.
- **Hot Cue Keys (`1`–`9`)**: Press a number to jump to marker N (sorted by time). Calls `jumpToMarker(index)` → `_scrubTo(m.time)`. Works during playback and while stopped.
- **Click marker flag**: Also calls `jumpToMarker(markerId)` → seeks to that time immediately.
- **Live Scrubbing**: Seeking to a marker while stopped immediately loads presets and lifts covers for a live preview.

**Naming note:** The code and UI call these "markers." In VJ/DJ terminology these are "cue points." Both terms are accurate — markers are the data structure, cue points are the performance concept.

---

## Phase 4.2 — Transport & Seeking (VJ Mode) ✅

- **Go-to-start button** — `⏮` in transport bar jumps playhead to 0:00 (pauses timeline, keeps visuals)
- **Skip-to-next-block button** — `⏵` jumps to next block start (wraps to 0:00 at end)
- **Play/Stop button** — Stop pauses timeline progression but **keeps preset animations running** (no black screen)
- **Keyboard shortcuts** — `Home` for start
- **Ruler hint** — hover ruler shows "Double-click to add marker" cue

*VJ Mode Philosophy:* The show never stops. Timeline controls (playhead, scheduling) pause, but visuals continue playing. Press Play to resume timeline progression.

---

## Phase 4.3 — Quick Wins ✅

- **Keyboard nudge** — `↑`/`↓` nudge playhead ±1s, `Shift+↑`/`Shift+↓` nudge ±5s
- **Drag-scrub on ruler** — click-hold-drag on ruler for smooth playhead control
- **Keyboard shortcuts for markers** — `1`-`9` jump to markers 1-9 by index
- **Block navigation** — `←`/`→` jump to prev/next preset block start

*Rationale:* Horizontal arrows for timeline navigation (block-to-block), vertical arrows for fine-tuning (time nudge). More intuitive for VJ workflow.

*Rationale:* Standard DAW/NLE transport uses 3 buttons: Go-to-Start, Play/Stop, Skip-Next. Skip-Prev is rarely used and was confusing when both left buttons went to 0:00. Simplified to match industry standard.

---

## Phase 4.4-A — Block Action Modal (Consolidate) ✅

*(shipped 2026-05-12, interaction model revised in 4.4-B)*

- **Single-click block body** → opened `#tl-quick-edit` modal directly *(this behavior was superseded by Phase 4.4-B — single-click is now select-only)*
- **Duplicate + Delete** moved into the modal as a utility row below the fields, separated by a hairline
- **Hover icon row** (`.tl-block-actions`) removed from block DOM and CSS entirely
- **Right-click context menu** removed from block (`contextmenu` listener deleted)
- **Click vs. drag** distinguished in `_startMoveDrag`: drag only activates after > 4px movement; clean click on `pointerup` routes to `_handleBlockClick`
- **Double-click detection** in `_handleBlockClick`: second click within 300ms on same block → `_cueEntry` (Phase 4.5) *(timing-based detection later replaced by native `dblclick` in 4.4-B)*
- **Files:** `timelineEditor.js`, `timeline.html`, `src/timeline/style.css`

---

## Phase 4.4-B — Block Menu Icon ✅

*(shipped 2026-05-12)*

Single-click on the block body was conflicting with double-click-to-cue and causing accidental modal opens. Root cause: modal and cue shared the same hit surface with a 300ms timing hack to distinguish them.

- **Removed** timing-based double-click detection (`_handleBlockClick`, `_lastClickedId`, `_lastClickTime`)
- **`.tl-block-menu-btn`** hamburger icon added to the LEFT of each block (absolutely positioned, 28px wide)
- **Single-click block body** → visual select only (no modal)
- **Double-click block body** → `_cueEntry` (native browser `dblclick` event — no timing logic)
- **Click menu icon** → opens/closes `#tl-quick-edit` for that block (sole toggle — no other dismiss path)
- **Click-outside-to-dismiss REMOVED** — `#tl-quick-edit` is intentionally NOT auto-dismissed on outside click; only the icon, Apply, Cancel, and Escape close it
- **Icon state**: `rgba(255,255,255,0.5)` at rest; hover lifts slightly; **active = bright white icon + `rgba(255,255,255,0.22)` background pill** — unmistakably open
- **`_openQuickEdit`** sets `.is-active` on the triggering block's menu button (removes from all others first)
- **`_closeQuickEdit`** removes `.is-active` from all menu buttons
- **Files:** `timelineEditor.js`, `src/timeline/style.css`

**Design rule:** Modal popovers in the timeline strip must have an explicit, visible close affordance. Auto-dismiss on outside click is banned — too easy to fire during live performance.

---

## Phase 4.5 — Double-click to Cue ✅

*(shipped 2026-05-12)*

- **Double-click any block** → crossfades from currently-playing preset into the cued preset, seeks the entire timeline to that block's `startTime`, then continues forward
- `_cueEntry(id)`: loads preset with `entry.blendTime`, fades cover, then calls `_scrubTo(entry.startTime)`
- `_cueZoneId` guard prevents `_playZone` and `_scrubTo`'s not-playing path from double-loading the cued zone with blend 0 (which would reset the crossfade)
- All active loops are released on Cue (once Loop/Loop Solo buttons are built, `_cueEntry` will clear `_loopTimer` and `_loopZoneId` here)
- **Files:** `timelineEditor.js`

---

## Phase 4.8 — Preset Palette Opacity ✅

*(shipped 2026-05-12)*

Adds an opacity control for the MilkDrop background layer inside a preset. Image, video, and GIF layers are unaffected — they composite on top at their own opacity. This is the prerequisite for the Zone Stack System (Roadmap Phase 4.9).

- `paletteOpacity` (0–1, default 1.0) added to `currentState` BLANK defaults
- Opacity slider added at the top of the Palette tab in `editor.html` — first control visible on the tab
- `_buildCompShader` multiplies `sampler_main` by `paletteOpacity` when < 1.0; early-exit to BLANK_COMP is guarded so it rebuilds correctly when opacity is reduced
- At 0: palette goes black, image/video/gif layers still render on top. At 1: current behavior unchanged.
- Old presets without `paletteOpacity` fall back to 1.0 via BLANK merge in `loadPresetData` — no migration needed.
- Beat-reactive controls not added here — Motion tab already covers palette reactivity (Zoom Pulse, Warp Pulse, Echo Opacity, etc.)

**Files touched:** `editor.html`, `src/editor/inspector.js`

---

## Phase 4.10-A — Real-time Live Editing (Mutation Reschedule) ✅

*(shipped 2026-05-12)*

> *"This really is what makes the software a step up."*

The timeline should feel like a live mixing desk, not a static playlist. Block positions, durations, and blend times edited during playback must take effect instantly — no stop-and-restart required.

> **Sub-phase 4.10-B (Loop state preservation) was NOT built** — it ships alongside the Loop/Loop Solo buttons (main doc Roadmap #1). Its design is preserved in the "Interaction with Loop / Loop Solo" and "Sub-phases" sections below.

### Root Cause — The Stale Timer Problem

When `play()` is called, `_playZone(zoneId)` schedules every future entry as a `setTimeout` handle. These handles are stored in `_zoneTimers = Map<zoneId, timerHandle[]>`. The scheduler is a snapshot taken once at play time.

Any mutation after that point — drag, resize, quick-edit apply, duplicate, delete — updates the data model (`_tl.entries`) immediately, but the already-queued `setTimeout` handles have already captured their fire-times. They will fire based on the OLD data regardless.

**Observed symptoms:**
- Drag a block left → block appears to snap back; stale timer fires and loads the old preset at the old time
- Drag a block right → block plays before the playhead reaches the new position
- Resize a block shorter → fade-out fires too late; preset plays into the gap
- Delete a block → the timer fires anyway and loads the deleted preset's name
- Add a block while playing → never scheduled (play() already ran; new entry has no timer)
- Change blend time in quick-edit → next transition uses the old value

The engine runs the original plan. It has no knowledge that the score changed.

### The Fix — `_rescheduleIfPlaying()`

```js
_rescheduleIfPlaying() {
    if (!this._playing) return;
    const tNow = (performance.now() - this._playStartWall) / 1000;
    this._scrubTo(tNow);
}
```

`_scrubTo(t)` already does exactly what's needed:
1. Cancels every timer in every `_zoneTimers` array — all stale handles gone
2. Resets `_playStartWall = performance.now() - t * 1000` — wall clock re-anchored to `t`
3. Calls `_playZone(id, t)` for every zone — fresh timers scheduled from the current playhead position against the current data model

After `_rescheduleIfPlaying()`, the scheduler is a perfect snapshot of the data model as of the call moment. The visible playhead does not jump — the rAF tick reads `(performance.now() - _playStartWall) / 1000`, which is unchanged because we re-anchored the wall clock to `tNow`.

### The Currently-Playing Preset Problem (Most Critical Edge Case)

`_playZone` finds the active entry at `fromTime` and calls:
```js
zd.engine.loadPreset(activeEntry.presetName, 0);
this._fadeZoneCover(zoneId, 0, 0);
```

If the zone is ALREADY showing that preset (because it was loaded by the timer that fired 10 seconds ago), this causes a visible flash: the cover briefly returns to 1 (black) and the engine reloads a preset it's already running. In a live performance, this is unacceptable.

**Required solution — preset tracking map:**

Add to constructor:
```js
this._currentZonePreset = new Map(); // Map<zoneId, presetName>
```

Set it whenever `loadPreset` fires in `_playZone` (both the immediate-entry path and the future-entry timer path):
```js
this._currentZonePreset.set(zoneId, entry.presetName);
zd.engine.loadPreset(entry.presetName, blendTime).catch(() => {});
```

In `_playZone`'s immediate-entry path, before the reload:
```js
if (this._currentZonePreset.get(zoneId) !== activeEntry.presetName) {
    zd.engine.loadPreset(activeEntry.presetName, 0).catch(() => {});
    this._fadeZoneCover(zoneId, 0, 0);
    this._currentZonePreset.set(zoneId, activeEntry.presetName);
}
// else: engine already showing this preset — skip the reload; cover is already down
```

This makes reschedule during playback seamless: future timers are rebuilt; the currently-visible content is untouched.

Clear `_currentZonePreset` in `stop()` so a fresh `play()` always loads correctly.

### The 6 Mutation Call Sites

Every place that modifies `_tl.entries` must call `_rescheduleIfPlaying()` after the data model update:

| # | Mutation | Where | Data changed |
|---|----------|-------|-------------|
| 1 | **Drag drop** | `_startMoveDrag → onUp` commit path (where `moved === true`) | `entry.startTime` |
| 2 | **Resize drop** | Resize `pointerup` handler, after duration commit | `entry.duration` |
| 3 | **Quick-edit apply** | `#qe-apply` click handler, after field writes | `entry.blendTime`, `entry.label` |
| 4 | **Duplicate** | `#qe-dupe` click handler, after `_tl.entries.push(newEntry)` | new entry added |
| 5 | **Delete** | `#qe-del` click handler, after entry splice | entry removed |
| 6 | **Add block** | `addEntry()` (`+` button and preset picker confirm) | new entry added |

Call `_rescheduleIfPlaying()` AFTER the model write, BEFORE `_renderStrip()`. Strip render is cosmetic; reschedule is functional.

**Drag note:** fire reschedule only on DROP (pointer-up), not on each pointer-move tick. During the drag, the block's visual position moves in CSS — timer reschedule happens once at commit. This avoids 60 reschedules/second with no benefit.

### Delete While Playing — Zone Blackout Edge Case

If the deleted entry is the currently-playing one in its zone:
- `_rescheduleIfPlaying()` calls `_playZone(zoneId, tNow)`
- `_playZone` finds no active entry at `tNow` (entry was deleted)
- It must raise the cover to black for this zone

Verify `_playZone` actually does this. From the state machine: *"Timeline start / gap at fromTime → cover = 1 (black)"*. Confirm the immediate-entry path has an `else` branch that calls `_fadeZoneCover(zoneId, 1, 0)` when `activeEntry === null`. If it does not, this is a one-liner fix to add there.

Also clear `_currentZonePreset.delete(zoneId)` for the zone when the playing entry is deleted.

### Add Block While Playing — Needs Reschedule Too

The `addEntry()` / preset picker `_addEntry()` path currently does not call `_rescheduleIfPlaying()`. A block added while playing is never scheduled. Add the call to the end of `addEntry()` (called from both the `+` button and the preset picker confirm path). This is mutation call site #6.

### Wall-clock Accuracy

`_scrubTo(tNow)` sets:
```js
this._playStartWall = performance.now() - tNow * 1000;
```

This re-anchors the wall clock so that `(performance.now() - _playStartWall) / 1000 === tNow` at the moment of the call. The playhead rAF tick reads this formula continuously — it sees no discontinuity. Future timers are scheduled as `delay = (entry.startTime - tNow) * 1000`, which resolves correctly.

`performance.now()` resolution: ≥ 0.1ms in site-isolated contexts (standard Chrome/Safari). Even at the reduced 5ms resolution some browsers apply, this is imperceptible for AV scheduling. No platform concern.

### Interaction with Loop / Loop Solo (Future — Phase 4.10-B)

When Loop or Loop Solo is active, a `_loopTimer` is running a recursive cycle. `_rescheduleIfPlaying()` calls `_scrubTo`, which must decide whether to break the loop.

**Design decision for Phase 4.10-A:** `_rescheduleIfPlaying()` calls `_scrubTo` directly. Since Loop/Loop Solo are not yet built, no conflict exists. When the loop buttons are built, add an option:

```js
_rescheduleIfPlaying() {
    if (!this._playing) return;
    const tNow = (performance.now() - this._playStartWall) / 1000;
    this._scrubTo(tNow, { preserveLoopState: true });
}
```

`_scrubTo(t, { preserveLoopState })` skips the loop-clearing block when the flag is set. This way, a VJ can drag a block to a new position WHILE a loop is running and the loop continues after the reschedule. The alternative (breaking the loop on any drag) would be frustrating in a live context.

### Sub-phases

**4.10-A — Core (shipped)**
- Add `_currentZonePreset = new Map()` to constructor and `stop()` clear
- Add preset-match guard to the immediate-entry path in `_playZone`
- Add `_currentZonePreset.set(zoneId, name)` wherever `engine.loadPreset()` is called
- Add `_rescheduleIfPlaying()` method
- Wire to 6 mutation call sites: drag drop, resize drop, qe-apply, qe-dupe, qe-del, addEntry
- Verify delete-while-playing zone blackout works (add `else` cover raise if missing)

**4.10-B — Loop state preservation (NOT built — see Roadmap #1)**
- Refactor `_scrubTo` to accept `{ preserveLoopState }` flag
- Build alongside the Loop/Loop Solo buttons

### Testing Matrix

Run each scenario WHILE the timeline is playing:

| Mutation | Block state at edit time | Expected outcome |
|----------|--------------------------|-----------------|
| Drag block to later time | Block NOT yet playing | Timer fires at new time; no interruption |
| Drag block to later time | Block IS currently playing | Continues playing; future exit timer fires at new (later) end |
| Drag block to earlier time | Block NOT yet playing | Timer fires at new (earlier) time |
| Resize block shorter | Block IS currently playing | Fade-out fires at the new (earlier) end — no wait |
| Resize block longer | Block IS currently playing | Fade-out deferred to new (later) end |
| Resize block longer | Block NOT yet playing | Next timer fires at correct new end |
| Quick-edit: change blend time | Block NOT yet playing | Next transition uses the new blend value |
| Quick-edit: change blend time | Block IS currently playing | No visual effect (already faded in) — correct |
| Duplicate block | Any | New block appears; timer scheduled if it falls after current playhead |
| Delete block (not playing) | Any | Timer cancelled; no visual effect |
| Delete block (currently playing) | Block IS currently playing | Zone goes black immediately; next block's timer takes over |
| Add new block via preset picker | Any | New block scheduled if after current playhead |
| Rapid consecutive mutations | Any | No orphan timers; last reschedule wins |

**Cross-platform checklist:** test on web (Chrome), then macOS app (Tauri/WKWebView). The fix is pure JS + `setTimeout` — no platform-specific behavior expected. Confirm `performance.now()` is monotonic in WKWebView (it is, but verify no offset drift over 10+ minutes of playback).
