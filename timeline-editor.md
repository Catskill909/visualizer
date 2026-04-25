# Timeline Editor — Design & Planning Doc

**Status:** Ready for development  
**Date:** 2026-04-25  
**Architecture:** Standalone page (`/timeline.html`) — self-contained, no changes to main app or Preset Studio

---

## What This Is

A **Timeline** is an ordered playlist of presets where each entry has a fixed display duration and blend-in transition. Timelines can loop or play once. The Timeline Editor is where you both build and play them — it is fully self-contained.

Same model as the rest of the app: full-screen canvas, glassmorphic UI controls float on top as overlays, auto-hide during playback. The timeline strip, transport bar, and topbar are all overlays — not fixed panels.

**No changes to the main app or Preset Studio are required.** The only external connections are two one-liner navigation links (see Navigation Links).

---

## Resolved Design Decisions

All open questions are closed. This section is the authoritative record — don't re-derive these.

### 1. Self-contained — no main app integration
Timelines are built and played entirely within `timeline.html`. The main app and Preset Studio do not gain timeline playback features. The only connection is a navigation link that opens `timeline.html`.

### 2. Rendering — reuse VisualizerEngine, one instance per zone canvas
The MilkDrop presets are Butterchurn GLSL shaders — there is no alternative renderer. `VisualizerEngine` (`src/visualizer.js`) accepts any `<canvas>` element with no modification. Each zone gets its own `<canvas>`, absolutely positioned and sized to its region. CSS `mix-blend-mode` handles compositing between zones for free. The browser WebGL context limit (~8–16) is not a concern for realistic zone counts (2–4).

### 3. Timeline strip UI — DOM blocks, not canvas
Each timeline block is a `<div>` absolutely positioned within a scrollable container: `left: startTime × pxPerSec`, `width: duration × pxPerSec`. Pointer events on the divs handle drag/resize. This is far simpler to build and maintain than a canvas-rendered strip, and it gets browser accessibility features for free.

### 4. Schema version — build v2 from day 1
Even in Phase 1 (single zone), the data is stored as `schemaVersion: 2` with a hardcoded single Full zone. Phase 3 adds zone management UI — the data model is already there, no migration needed. `schemaVersion: 1` (the old single-track format from early design sketches) is never written to disk, so no migration code is needed either.

### 5. Live references, not snapshots
Timelines store preset registry-key strings, not preset data. Editing a custom preset updates every timeline that references it automatically. Lighter, simpler, intuitive.

### 6. All presets allowed
Both bundled presets ("Preset Name") and custom presets ("custom:\<id\>:Name") can be added. Users mix freely.

### 7. Duration in whole seconds
Range 5–600 seconds. No sub-second input in v1.

### 8. Export / Import in v1
Plain JSON — "Copy JSON" (clipboard, "Copied!" tooltip), "Paste JSON" (clipboard read, inline validation error on schema failure).

### 9. No pause in v1
Play or Stop. Keeps the mental model clean.

### 10. Keyboard shortcut: `T` toggles the timeline strip
Within `timeline.html`, `T` shows/hides the timeline strip. (The main app uses `T` for Audio Tuning — that's a different page, no conflict.)

---

## Codebase Context for Developers

> **Read this before writing a line.** The timeline editor is new, but it builds on top of proven primitives. Knowing what already exists prevents re-inventing them.

### Files to reuse / extend

| File | What it gives you |
|------|------------------|
| `src/visualizer.js` | `VisualizerEngine` — call `new VisualizerEngine()`, then `engine.init(canvasEl)`. Accepts any canvas. Pass a shared `AnalyserNode` via `engine.connectAnalyser(node)` for audio reactivity across all zones. |
| `src/customPresets.js` | `loadAllCustomPresets()`, `getImage(imageId)` — for loading custom preset blobs when needed |
| `src/presetRegistry.js` | `getAllNames()`, `getByName(name)`, `displayName(name)` — the single source of truth for all presets (bundled + custom). Use this to populate the preset picker. |
| `src/editor/main.js` | **Follow this as the boot template.** It shows the exact pattern: auth gate → audio source picker → boot function that creates engine + UI. Mirror this structure in `src/timeline/main.js`. |
| `editor.html` | **Follow as the HTML template.** Structure: auth overlay → start screen (audio picker) → main shell (revealed after boot). Mirror in `timeline.html`. |
| `src/editor/style.css` | Design tokens and glassmorphic component classes. Import or copy the relevant custom properties into `src/timeline/style.css` so the tool feels consistent. |

### Files NOT to touch

`src/visualizer.js`, `src/controls.js`, `src/main.js`, `index.html`, `src/editor/inspector.js` — none of these need changes. All timeline code lives in `src/timeline/` and `src/timelineStorage.js`.

### The two one-liner external wires (do these last)

- `src/main.js` — add `L` key handler: `window.open('/timeline.html')` (same as the existing `E` key opens `editor.html`)
- `src/editor/presetLibrary.js` — add "Send to Timeline →" to card context menu: `window.open('/timeline.html?preset=' + encodeURIComponent(name))`

---

## Data Structures

### Zone

Every timeline has at least one zone (Full). Additional zones enable multi-region spatial compositions.

```js
{
  id: string,           // uuid
  name: string,         // "Main", "Top Left", "Accent Strip" — user-editable
  color: string,        // hex — track row label color and default block tint
  region: {
    x: number,          // 0–1 normalized (left edge / canvas width)
    y: number,          // 0–1 normalized (top edge / canvas height)
    width: number,      // 0–1 normalized
    height: number,     // 0–1 normalized
  },
  opacity: number,      // 0–1, CSS opacity on the zone canvas (default 1)
  blendMode: string,    // CSS mix-blend-mode: 'normal'|'screen'|'overlay'|'multiply'|'lighten'
  zIndex: number,       // stacking order — index 0 rendered first (bottom)
  gapBehavior: 'black' | 'hold',
                        // 'black': zone canvas is transparent when no entry is active
                        // 'hold': last loaded preset stays frozen when nothing is scheduled
}
```

**Predefined zone layouts** — one-click setup buttons in the zone manager:

| Layout | Zones created |
|--------|--------------|
| Full (default) | 1 zone: `{0, 0, 1, 1}` |
| Left / Right | `{0,0,0.5,1}` + `{0.5,0,0.5,1}` |
| Top / Bottom | `{0,0,1,0.5}` + `{0,0.5,1,0.5}` |
| 4 Quadrants | TL `{0,0,0.5,0.5}`, TR `{0.5,0,0.5,0.5}`, BL `{0,0.5,0.5,0.5}`, BR `{0.5,0.5,0.5,0.5}` |
| Center + Frame | Full bg `{0,0,1,1}` + center `{0.2,0.15,0.6,0.7}` on top |
| Top Banner | Full bg + strip `{0,0,1,0.22}` on top |
| Side Column | Full bg + column `{0,0,0.28,1}` on top |
| Custom | User draws a rectangle on the canvas minimap |

### TimelineEntry

```js
{
  id: string,           // uuid — stable across drags and reorders
  zoneId: string,       // references a Zone.id
  presetName: string,   // registry key: "Preset Name" or "custom:<id>:Name"
  startTime: number,    // seconds from t=0 — this is the block's horizontal position
  duration: number,     // whole seconds — this is the block's width
  blendTime: number,    // blend-in seconds (default 2, range 0–10)
  label: string | null, // optional on-screen text overlay during playback
  color: string | null, // block color override; inherits zone.color if null
}
```

`startTime` is the source of truth for position. Within a single zone, blocks must not overlap (`startTime + duration <= next.startTime`). The editor enforces this by pushing or snapping colliding blocks. Across zones, overlap is intentional and desired.

### Timeline

```js
{
  id: string,
  name: string,
  schemaVersion: 2,           // always 2 — see Resolved Decision #4
  zones: Zone[],              // ordered array; index 0 is bottom (rendered first)
  entries: TimelineEntry[],   // flat array, all zones, sorted by startTime for playback iteration
  loop: boolean,
  totalDuration: number,      // seconds — derived: max(entry.startTime + entry.duration)
  defaultDuration: number,    // seconds, applied when user adds a new entry (default 30)
  defaultBlendTime: number,   // seconds (default 2)
  bpm: number | null,         // enables beat-grid ruler in Phase 5
  createdAt: string,
  updatedAt: string,
}
```

### Storage

- **localStorage key:** `discocast_timelines` → `{ [id]: Timeline, ... }`
- No IndexedDB needed — timelines reference preset names only, no blobs
- **New module:** `src/timelineStorage.js` — mirrors the API shape of `src/customPresets.js`:
  - `createTimeline(name, data)` → Timeline
  - `saveTimeline(id, data)` → Timeline
  - `getTimeline(id)` → Timeline
  - `deleteTimeline(id)`
  - `loadAllTimelines()` → `{ [id]: Timeline }`
  - `exportTimeline(id)` → JSON string
  - `importTimeline(json)` → Timeline (validates schema, throws on failure)

---

## Page Structure & UI Model

### HTML skeleton (mirror `editor.html`)

```html
<div id="timeline-auth">          <!-- password gate, same as other pages -->
<div id="timeline-start">         <!-- audio source picker (mic / file) -->
<div id="timeline-shell">         <!-- revealed after audio is connected -->
  <!-- zone canvases injected here dynamically, position: absolute -->
  <div id="tl-topbar">            <!-- overlay, auto-hides -->
  <div id="tl-transport">         <!-- overlay, auto-hides -->
  <div id="tl-strip-container">   <!-- slides up from bottom -->
    <div id="tl-ruler">           <!-- time ruler + playhead -->
    <div id="tl-tracks">          <!-- zone rows -->
    <div id="tl-add-zone">        <!-- + Zone button -->
```

### Overlay auto-hide rules

| State | Topbar | Transport | Strip |
|-------|--------|-----------|-------|
| Editing (stopped) | Visible | Visible | Pinned open |
| Playing | Auto-hides 3s | Auto-hides 3s | Auto-hides 3s |
| Mouse active | Visible | Visible | Visible |
| `T` key pressed | — | — | Toggles |

During playback, when all overlays are hidden, the canvas fills the full window (zone canvases resize to fill the viewport edge-to-edge).

### Layout diagram

```
┌─────────────────────────────────────────────────────────────┐
│ ░ TOPBAR overlay ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░ ← Back  DiscoCast Timeline  [▼ Set Name ▾]  [Save] ░░░░░ │
│                                                             │
│                   ZONE CANVASES                             │
│            (stacked, position: absolute)                    │
│           live and audio-reactive always                    │
│                                                             │
│ ░ TRANSPORT overlay ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░ ▶ Play  ■ Stop  ⟳ Loop   Total: 4:30   00:45 / 01:30  ░░ │
│ ░ [+ Zone] [Zones ▾]  Zoom [——●——]  Snap [10s ▾]  ░░░░░░░░ │
├─────────────────────────────────────────────────────────────┤
│  TIMELINE STRIP                                             │
│  time ruler:  0:00      0:30      1:00      1:30      2:00  │
│               ▲ playhead (click ruler to scrub)             │
│  [🔲 Full  ▸] [──────── preset A ────────][── preset B ──] │
│  [◱ TopLeft▸]            [──── preset C ────]              │
│  [◳ BotRght▸] [─ preset D ─]                               │
│  [+ Zone    ]                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Core UI — Timeline Strip

The strip is a horizontally scrollable, multi-track editor. Each zone has its own row. Blocks on different rows can overlap in time — that is simultaneous multi-zone composition.

### Zone canvas sizing

Each zone `<canvas>` is absolutely positioned within a full-screen container:

```js
canvas.style.position = 'absolute';
canvas.style.left   = `${zone.region.x * 100}%`;
canvas.style.top    = `${zone.region.y * 100}%`;
canvas.style.width  = `${zone.region.width * 100}%`;
canvas.style.height = `${zone.region.height * 100}%`;
canvas.style.zIndex = zone.zIndex;
canvas.style.opacity = zone.opacity;
canvas.style.mixBlendMode = zone.blendMode;
canvas.width  = Math.round(zone.region.width  * window.innerWidth);
canvas.height = Math.round(zone.region.height * window.innerHeight);
engine.init(canvas);   // VisualizerEngine fills whatever canvas it's given
```

On `window.resize`, recalculate pixel dimensions for all zone canvases and call `engine.setSize(w, h)` on each.

### Timeline block (DOM)

Each block is a `<div>` inside its zone's track row:

```css
.tl-block {
  position: absolute;
  left:  calc(var(--start-time) * var(--px-per-sec) * 1px);
  width: calc(var(--duration)   * var(--px-per-sec) * 1px);
  /* height fills the track row */
}
```

CSS custom properties `--start-time`, `--duration`, and `--px-per-sec` are set by JS. When `pxPerSec` changes (zoom), updating the single `--px-per-sec` variable on the track container repositions and resizes all blocks at once.

### Block interactions

- **Click** — select block; load its preset on its zone canvas for preview
- **Drag body** — move `startTime` along the row; push/snap colliding blocks
- **Drag right edge** — resize `duration`; right-edge gets a dedicated resize handle (8px wide, `cursor: ew-resize`)
- **Drag to another row** — reassigns `zoneId` (block snaps to the new row)
- **Double-click** — open quick-edit popover: preset name (display only), duration, blend time, label, zone dropdown
- **Right-click** — context menu: Duplicate, Move to Zone ▸, Edit Label, Delete

### Block anatomy

```
┌──────────────────────────────────────────┐
│ [thumb]  Preset Name             00:30   │  ← thumbnail + name + duration badge
│ ░░░ blend                               │  ← hatch region on left = blendTime width
└──────────────────────────────────────────┤▶  ← resize handle
```

### Zone track label (left column)

Each zone row has a fixed-width label chip on the left. Clicking opens zone settings (inline popover: name, region, opacity, blend mode, gap behavior). Dragging the row up/down reorders z-index (updates `zone.zIndex` for all zones, recreates canvas stack order).

### Playhead

A single `position: absolute` vertical line spanning all track rows. During playback it advances in real time. Clicking anywhere on the ruler jumps playback to that `startTime` offset (for the current playing entry on each zone, advance/rewind to whichever entry is active at that time).

### Canvas zone highlight

When a block is selected, dim all zone canvases except the selected zone (CSS `opacity` transition to 0.35 on non-selected canvases) and draw a subtle colored border rect on the selected zone canvas. Deselecting removes highlights.

### Gap behavior visualization

Empty regions in a track row: crosshatch `<div>` fills the gap. If zone `gapBehavior === 'hold'`, render a faint ghost copy of the previous block extending into the gap to signal "preset is frozen here."

---

## Playback Engine

Each zone runs its own independent playback loop — a `setTimeout` chain, not `setInterval`. Zones are synchronized by wall-clock time (`performance.now()`), not by coupling their loops.

### Zone playback state (one per zone)

```js
{
  zoneId,
  currentEntryId: null,
  timer: null,
  startedAt: null,       // performance.now() when current entry started
}
```

### Boot sequence

```
startTimeline(timeline):
  record wallClockStart = performance.now()
  for each zone:
    find the first entry for that zone (startTime >= 0)
    if found: scheduleZoneEntry(zone, entry, delayMs = entry.startTime * 1000)

scheduleZoneEntry(zone, entry, delayMs):
  zone.timer = setTimeout(() => playEntry(zone, entry), delayMs)

playEntry(zone, entry):
  engine[zone.id].loadPreset(entry.presetName, entry.blendTime)
  fire 'timelineStep' event
  find next entry for this zone
  if next exists:
    gap = next.startTime - (entry.startTime + entry.duration)
    scheduleZoneEntry(zone, next, entry.duration * 1000)
    // gap appears as gapBehavior — engine holds or clears automatically
  else:
    scheduleZoneEnd(zone)

scheduleZoneEnd(zone):
  zone.timer = setTimeout(() => {
    if all zones finished and timeline.loop: startTimeline(timeline)
    else if all zones finished: stopTimeline()
    else: this zone is simply done — gapBehavior takes over
  }, lastEntry.duration * 1000)

stopTimeline():
  clearTimeout all zone timers
  fire 'timelineEnd' event
  update UI to stopped state
```

"All zones finished" is checked after each zone completes its last entry. When the last zone finishes, the loop/stop decision is made.

### Events (fired on `window`)

| Event | `detail` | When |
|-------|----------|------|
| `timelineStart` | `{ id, name, totalDuration }` | Playback begins |
| `timelineStep` | `{ zoneId, entryId, presetName, startTime, duration }` | Each entry fires |
| `timelineEnd` | `{ id, reason: 'complete' \| 'stopped' }` | Playback ends |

---

## Feature Brainstorm

Grouped by complexity. Phase assignments noted where relevant.

---

### Tier 1 — Natural Extensions

**Block color coding** *(Phase 1)*
Auto-assign a pastel color per block by hashing the preset name. User can override via the quick-edit popover's color swatch. Makes long timelines scannable.

**Entry labels / overlays** *(Phase 2)*
Each entry has an optional short text label ("Intro", "Drop", "Outro"). During playback, the label fades in as a small glassmorphic chip at the bottom-left of the zone canvas. Fades out before the entry ends.

**Duplicate entry** *(Phase 1)*
Right-click → Duplicate. Copies block with same duration, blend, and label. Placed immediately after the original with no gap.

**Auto-fill from Favorites** *(Phase 2)*
Transport toolbar button. Populates the Full zone with all favorited presets in random order, each at `defaultDuration`. Existing entries are replaced (confirmation prompt).

**Total duration display** *(Phase 1)*
Live-computed `max(entry.startTime + entry.duration)` across all entries. Shown in the transport bar. Updates as blocks are dragged or resized.

**Timeline switcher** *(Phase 1)*
Topbar dropdown lists all saved timelines by name. Switching auto-saves the current timeline then loads the selected one.

---

### Tier 2 — Visual Power

**Thumbnail previews on blocks** *(Phase 2)*
Show the preset's saved JPEG thumbnail (`thumbnailDataUrl` from the preset object) inside each block. For bundled presets without thumbnails, show the first two letters of the preset name as a colored monogram.

**Waveform display** *(Phase 5)*
When audio is loaded from a file, decode the full audio buffer and render the waveform as an SVG or canvas layer behind all track rows. Entry blocks float on top. DJs can visually align preset changes to drops and builds. Unique feature for a browser-based tool.

**Snap to grid** *(Phase 2)*
Snap selector in the transport bar: Off / 5s / 10s / 30s / 1min. Grid lines drawn on the ruler at the selected interval. Dragging blocks or resize handles snaps to the nearest line.

**Zoom** *(Phase 1)*
`--px-per-sec` CSS variable on the track container controls all block positions and widths. A zoom slider in the transport bar adjusts this from ~2px/sec (60-min set fits on screen) to ~30px/sec (5-sec entries are comfortably editable). Pinch-to-zoom on touch devices.

**Multi-select** *(Phase 2)*
Shift-click to select multiple blocks. Drag any selected block moves all together (preserving relative offsets). `Delete` removes all selected. A "Set duration" input in the transport bar stamps all selected to the same value.

---

### Tier 3 — Performance & Show

**BPM grid** *(Phase 5)*
User enters BPM (or taps a "Tap Tempo" button). Ruler shows bar/beat grid lines. Snap locks to bar boundaries. Block width labels show "8 bars", "16 bars" etc.

**Named markers** *(Phase 5)*
Double-click the ruler to drop a named marker (e.g., "Build", "Drop"). Markers appear as a labeled flag on the ruler. Non-blocking — no effect on playback. Good for annotating set structure.

**Crossfade style per entry** *(Phase 5)*
Per-entry transition style: Blend (default smooth cross-fade), Cut (blend = 0), White Flash (cross-fade through white), Black Dip (cross-fade through black). Small icon on the block's left edge. Stored as `transitionStyle` on `TimelineEntry`.

**Loop section** *(Phase 5)*
Select a range on the ruler and mark it as a loop region. Playhead bounces within the range until the user presses "Next" or clicks outside. Useful for holding on a section while reading the room.

**Live queue override** *(Phase 5)*
During playback, clicking a future block in the strip queues it as the next entry on that zone (overrides the scheduled next). The block glows to indicate it's queued. Turns the timeline into a live set-list with manual override capability.

**Setlist export** *(Phase 5)*
Export the timeline as a plain-text or HTML table: entry index, zone name, preset name, start time (MM:SS), duration. Useful for performers who want a printed reference.

---

### Tier 3.5 — Zone Assignment (Spatial Compositor)

This is the highest creativity-multiplier feature. It turns a sequential playlist into a multi-zone spatial compositor — different presets playing simultaneously in assigned screen regions, composited live.

**Core concept:**
Every timeline entry is assigned to a zone. At any moment during playback, all active entries across all zones render simultaneously — each in its own region of the screen.

Example:
- Zone A (Full, z=0): slow ambient preset in the background
- Zone B (Center Square, z=1, `blendMode: screen`): high-energy tunnel preset pulsing to the kick
- Zone C (Top Banner, z=2): color-wave preset fading in for the chorus

**Creative possibilities:**
- Persistent background + rotating foreground — change the center zone without touching the ambient surround
- Same preset assigned to multiple zones simultaneously at different sizes/positions
- "Open up" new zones as the set builds energy — start sparse, add layers
- Use `blendMode: multiply` on a dark overlay zone to tonally unify everything below it
- Narrow side column with a complementary palette as a permanent visual signature

**Rendering:** one `VisualizerEngine` per zone canvas, shared audio `AnalyserNode`. CSS `mix-blend-mode` on each canvas handles compositing. No WebGL compositing needed — the browser does it free. See Resolved Decision #2 for the full rationale.

*(Phase 3 implementation — full details in Data Structures and Standalone Page Architecture sections)*

---

### Tier 4 — Ambitious / Future

**AI-assisted arrangement**
Given favorited presets + a target duration, auto-arrange using energy metadata (`baseVals.zoom`, `decay`, `warp`) to build a low-energy → peak → wind-down arc.

**Cloud sync / share link**
Timelines are plain JSON — a shareable URL that encodes the timeline is trivially feasible. Requires a backend or a URL-safe encoding scheme.

---

## New Files

| File | Responsibility |
|------|---------------|
| `timeline.html` | Page entry point — auth gate, audio picker, shell |
| `src/timeline/main.js` | Boot: auth → audio source → create engines + TimelineEditor |
| `src/timeline/timelineEditor.js` | Core class: strip rendering, drag/resize, zone management, playback engine |
| `src/timeline/style.css` | Design system — import tokens from `editor/style.css`, add strip-specific styles |
| `src/timelineStorage.js` | Timeline CRUD (localStorage) — independent of preset or image storage |

## Modified Files (two one-liners, do last)

| File | Change |
|------|--------|
| `vite.config.js` | Add `timeline.html` as third Rollup input entry |
| `src/main.js` | `L` key → `window.open('/timeline.html')` |
| `src/editor/presetLibrary.js` | "Send to Timeline →" card action → `window.open('/timeline.html?preset='+name)` |

`src/visualizer.js`, `src/controls.js`, and `index.html` are not touched.

---

## Phased Rollout

### Phase 1 — Working single-zone editor

Build the complete editing and playback loop for a single Full zone. Zones architecture is already in the data model (hardcoded single Full zone) — no migration debt.

**Deliverables:**
- `timeline.html` shell (auth gate + audio picker, mirroring `editor.html`)
- `src/timeline/main.js` boot sequence (mirroring `src/editor/main.js`)
- `src/timelineStorage.js` full CRUD + export/import
- Full-screen single canvas (`VisualizerEngine` on the Full zone)
- Timeline strip: DOM blocks, proportional width, drag-to-reorder, drag-right-edge to resize
- Preset picker modal: search + select from `PresetRegistry.getAllNames()`, appends entry
- Double-click block → quick-edit popover (duration, blend, label)
- Right-click → context menu (Duplicate, Delete)
- Playhead: advances during playback, click-to-scrub on ruler
- Transport: Play / Stop / Loop toggle / total duration / elapsed time
- Zoom slider (`--px-per-sec` variable)
- Save / Load / Delete timelines; timeline switcher dropdown in topbar
- JSON Copy / Paste export-import
- Block auto-color by preset name hash
- `vite.config.js` third entry
- `L` key in `src/main.js` (one line)

### Phase 2 — Strip polish

- Thumbnail previews inside blocks (preset `thumbnailDataUrl`, monogram fallback)
- Snap to grid (Off / 5s / 10s / 30s / 1min)
- Entry labels — quick-edit field + on-screen overlay during playback
- Auto-fill from Favorites button
- Multi-select (Shift-click) + bulk duration set
- "Send to Timeline →" in `presetLibrary.js` (one line)
- `timeline.html?preset=<name>` query param handling on boot

### Phase 3 — Zone Compositor

Full multi-zone spatial layering. Everything stays within `timeline.html`.

- `Zone` data model fully active (Phase 1 hardcoded it; now it's user-managed)
- Zone manager UI: layout picker (predefined layouts + custom drag-draw on canvas minimap)
- Multi-track strip: one row per zone, left-column zone label chips, drag-to-reorder z-index
- Multi-canvas rendering: dynamic canvas creation/destruction as zones are added/removed
- Zone settings popover: name, region, opacity, blend mode, gap behavior
- Zone canvas highlight on block select (dim others, border on selected)
- Gap behavior visualization (crosshatch + ghost block)
- Resize all zone canvases on `window.resize`

### Phase 4 — Waveform + BPM

- Audio file decoding → waveform SVG rendered behind track rows
- BPM input / tap-tempo → bar/beat grid on ruler
- Snap to bars mode

### Phase 5 — Advanced show features

- Named markers on the ruler
- Per-entry crossfade style (cut / white flash / black dip)
- Loop section range
- Live queue override during playback
- Setlist text export
