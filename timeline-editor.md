# Timeline Editor — Design & Planning Doc

**Status:** Phases 1–4.3 complete ✅ — Phase 4.4 next (Loop & Regions).  
**Last updated:** 2026-05-06  
**Architecture:** Standalone page (`/timeline.html`) — self-contained MPA entry in Vite.

## Phased Rollout

### Phase 1 — Single-zone editor ✅ COMPLETE

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

### Phase 2 — Multi-zone compositor ✅ COMPLETE

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

### Phase 3 — UX polish ✅ COMPLETE

- **Position-based dragging** — blocks drag freely to any time position. `entry.startTime` is now stored (not computed). Dragging the block body updates `entry.startTime` directly on drop. `_migrateEntryStartTimes()` auto-converts old sequential timelines on load.
- **Inline block actions** — hover a block to reveal Edit / Duplicate / Delete icon buttons. Clicking them does not trigger drag. Right-click context menu preserved as secondary path.
- **Controls always visible** — auto-hide timer removed. Controls are permanently visible unless fullscreen is active.
- **`#tl-fullscreen-btn`** — always-visible fullscreen icon in top-right corner (replaced the old `≡` pin toggle). Click or press `F` to enter fullscreen and hide all controls. Click again, press `F`, or press `Escape` to exit fullscreen and restore controls. Web uses native browser fullscreen API; macOS app uses Tauri `appWindow.setFullscreen()`.

### Phase 3.5 — Active Playhead ✅ COMPLETE

A classic NLE playhead: click-to-seek, persistent position, play-from-here. This is the foundation for all future transport features (loop ranges, markers, live queue override).

- **Active Playhead State**: Introduced `_currentTime` to `TimelineEditor` to persist timeline position, allowing "play-from-here" functionality and persistent parking when stopped.
- **Play/Pause Toggle Semantics**: Stop button now merely pauses the playhead. Clicking ruler at 0:00 rewinds. Reaching the end of the timeline auto-rewinds to 0:00 naturally.
- **Visuals on Stop**: Stopped timelines show a clean black canvas (covers shown), with the playhead remaining persistently visible to indicate position.
- **Transition / Fade System**: Replaced `display: none/block` cover toggling with an extensible opacity-based `_fadeZoneCover` helper.
- **Automated Crossfades**: Zones automatically fade in from black after gaps, and fade out to black before gaps (based on `blendTime`). Scrubbing instantly snaps without visual lag.

---

### Phase 4 — Advanced show features 🔧 IN PROGRESS

**Phase 4.1 — VJ Marker System** ✅ COMPLETE
- **Data Model**: `Timeline` object now stores an array of `markers` (`time`, `label`, `color`, `action`).
- **Interactive Ruler**: Double-click ruler to drop a marker. Click and drag to reposition with snapping support.
- **Edit Popover**: Click a marker to open an editor to change its Label, Color, and Action. Smart positioning prevents it from dropping off-screen.
- **Playback Execution**: Playhead engine scans for markers. 
  - `stop` action: halts playback and parks exactly on the marker.
  - `loop` action: halts playback, wraps back to `0:00`, and resumes seamlessly.
- **Live Scrubbing**: Clicking the ruler while stopped immediately loads the corresponding presets into the visualizer engines and lifts covers for a live preview.

**Phase 4.2 — Transport & Seeking (VJ Mode)** ✅ COMPLETE

- **Go-to-start button** — `⏮` in transport bar jumps playhead to 0:00 (pauses timeline, keeps visuals)
- **Skip-to-next-block button** — `⏵` jumps to next block start (wraps to 0:00 at end)
- **Play/Stop button** — Stop pauses timeline progression but **keeps preset animations running** (no black screen)
- **Keyboard shortcuts** — `Home` for start
- **Ruler hint** — hover ruler shows "Double-click to add marker" cue

*VJ Mode Philosophy:* The show never stops. Timeline controls (playhead, scheduling) pause, but visuals continue playing. Press Play to resume timeline progression.

**Phase 4.3 — Quick Wins** ✅ COMPLETE

- **Keyboard nudge** — `↑`/`↓` nudge playhead ±1s, `Shift+↑`/`Shift+↓` nudge ±5s
- **Drag-scrub on ruler** — click-hold-drag on ruler for smooth playhead control
- **Keyboard shortcuts for markers** — `1`-`9` jump to markers 1-9 by index
- **Block navigation** — `←`/`→` jump to prev/next preset block start

*Rationale:* Horizontal arrows for timeline navigation (block-to-block), vertical arrows for fine-tuning (time nudge). More intuitive for VJ workflow.

*Rationale:* Standard DAW/NLE transport uses 3 buttons: Go-to-Start, Play/Stop, Skip-Next. Skip-Prev is rarely used and was confusing when both left buttons went to 0:00. Simplified to match industry standard.

**Upcoming Phase 4.x Tasks**:

*Loop & Regions*
- **Loop section range on ruler** — drag a range on the ruler to set loop bounds. Playback bounces between in and out points.
- **Advanced Loop logic** — marker action `loop` jumps to previous loop start rather than `0:00`.
- **Loop single block** — right-click block → "Loop This" — sets loop range to that block's start/end

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
- **Timeline Library modal** — replace the topbar `<select>` dropdown with a "Library" button that opens a card-grid modal (mirrors `presetLibrary.js` patterns). Each card: name, last-edited relative time, entry count, zone-layout chip, per-card Load + Delete actions. Search box, sort by recent/name, multi-select for bulk delete. Save button gains a "Save As…" dialog for new/clone flows. Discard-confirm guard when switching timelines with unsaved changes.
- **Auto-save behavior** — debounced "draft" slot rather than spawning a new entry per page load.

---

## What This Is

A **Timeline** is a positional playlist of presets where each entry has a fixed display duration, blend-in transition, and an absolute start time within a zone. Multiple zones (screen regions) run simultaneously — different presets play in different areas of the canvas, composited live via CSS `mix-blend-mode`. The Timeline Editor is where you build and play them.

Same design language as the rest of the app: full-screen canvas, glassmorphic overlays auto-hide after inactivity, controls fade in on mouse movement.

**No changes to the main app or Preset Studio are required** beyond two one-liners (navigation links, already shipped — see Modified Files).

---

## Open Bugs / Known Gaps

- **No overlap prevention**: blocks can be dragged to overlap each other within a zone. The data model spec says `startTime + duration <= next.startTime` but this is not enforced. Future: push colliding blocks on drop (same as a real NLE).
- ~~**Gap behavior not visualized**~~: ✅ Fixed in Phase 3.5 — `_playZone()` now schedules blackout timers when entries end. `gapBehavior: 'black'` re-shows the zone cover; `'hold'` lets the last frame persist. Visual crosshatch/ghost-block strip rendering still not built (cosmetic only).
- **Zone settings popover not built**: clicking the zone label chip does nothing yet. It should open a popover for name, opacity, blend mode, gap behavior.
- **Entry label overlay not rendered**: `entry.label` is stored and editable in quick-edit but not rendered on the canvas during playback.
- **`presetLibrary.js` "Send to Timeline →"** one-liner not yet added.

## Current State — What's Built and Shipped

All three phases are fully working. Here's an accurate picture of the running code:

### Entry point
`timeline.html` → `src/timeline/main.js` → `TimelineEditor` class in `src/timeline/timelineEditor.js`

### On boot
1. Start screen (Live Audio / Load Track) — mirrors editor.html
2. `boot()` creates a full-screen canvas + primary `VisualizerEngine`
3. `engine.refreshCustomPresets()` loads custom presets from localStorage
4. `new TimelineEditor({ engine, canvasContainer })` initializes the editor
5. Auto-hide timer starts immediately — controls fade after 3.5s of mouse inactivity

### Zone system (Phase 3, complete)
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

### Block inline actions (Phase 3 UX, complete)
Each block shows **Edit / Duplicate / Delete** icon buttons on hover — no hidden double-click or right-click required. Right-click context menu still works as secondary path.

### Fullscreen button (Phase 3 UX, updated)
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

---

## Critical Architectural Facts

> These are the non-obvious facts a developer needs before touching this code.

### `src/visualizer.js` IS modified (Phase 3 required it)
`initSlave(canvas, primaryEngine)` was added. It creates a new Butterchurn visualizer on `canvas` sharing the primary engine's audio graph (no new `AudioContext`). Sets `this._isSlaveEngine = true` which guards the render loop from running `updateAGC()`/gain management (primary handles it — slaves must not fight over the shared `GainNode`).

### `entry.startTime` is the source of truth for position
Old behavior (Phase 1–2): `startTime: 0` on all entries, positions were computed cumulatively from array order.  
Current behavior (Phase 3+): `startTime` is stored and is the actual seconds-from-zero position. Blocks can have gaps between them, overlap detection is the caller's responsibility (not yet enforced by the editor).

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

`src/main.js`, `index.html`, `src/editor/inspector.js`, `src/editor/presetLibrary.js` are **not touched** (the "Send to Timeline →" one-liner in `presetLibrary.js` is still pending — see Phase 4 todo).

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
    #tl-quick-edit        — block settings popover (Duration, Blend, Label)
    #tl-ctx-menu          — right-click context menu (Duplicate, Delete)
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

## Phased Rollout

## Save & Naming UX Design

### The Problem
Three distinct concerns were visually flattened into one topbar with no state differentiation:
1. **Navigate** between timelines — the `<select>` dropdown
2. **Name** the current timeline — the text input (same text, same size, visually parallel)
3. **Persist** the current state — Save button (fires immediately, no feedback on *what* it's doing)

The `<select>` and `<input>` both showed "Untitled Timeline" with no explanation of why. Save had one label for two very different operations (first-time save vs. overwrite).

### Timeline State Machine
Every timeline is in one of three states. The UI makes the current state legible at a glance:

| State | Meaning | `_isNew()` | `_dirty` |
|---|---|---|---|
| **New** | Created this session, not in storage yet | `true` | `false` (until edits) |
| **Saved / Dirty** | In storage, has unsaved edits | `false` | `true` |
| **Saved / Clean** | In storage, matches last save | `false` | `false` |

`_isNew()` checks `!this._timelines[this._tl?.id]` — a timeline is new if its ID is not in the in-memory map (which mirrors localStorage).

### Save Button — Three Behaviors
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

---

