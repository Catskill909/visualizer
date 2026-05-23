# Output & Multi-Monitor — Design & Dev Doc

**Status:** Architecture corrected 2026-05-22 — re-render path replaced by a pixel mirror (see the §13 post-mortem; do **not** rebuild re-render). **Web shipped & committed:** A1 (player/editor mirror) + A2.1 (multi-output foundation) + A2.2 (timeline per-zone→display routing) + A2.3 (route persistence + offline re-resolve). **Next: A3** (stacking — many zones → one display). Native Mac/Windows (Phase B/C) not started. Truth doc; supersedes all prior recommendations. New here? Read §0.
**Created:** 2026-05-21 · **Corrected:** 2026-05-22
**Scope:** Routing visualizer output to one or more physical displays/projectors, across the player (`index.html`), Preset Studio (`editor.html`), and Timeline (`timeline.html`), all on one shared engine.

## The decision that changed (read this first)

The original plan picked **Option A — re-render in the output window** (the second window runs its own Butterchurn engine, fed broadcast audio). It was chosen for "true parity" (one codebase, web + desktop).

**It does not work.** Two engines = two independent clocks → the output **drifts** out of sync with the operator screen. Confirmed at runtime 2026-05-22. For a VJ tool, "the projector matches what I see" is non-negotiable, so this is a hard fail. It would also drift on the desktop app for the identical reason — so the "parity" it promised was never real.

**The correct model: the output window is a dumb display of copied pixels.** It never re-renders, never runs an engine, never needs audio. It shows a live **mirror** of the operator's canvas. Same pixels in two places = cannot drift, by construction.

**Decisions locked (2026-05-22):**
1. **Output = mirror, not re-render.** The output window displays a copy of the source canvas pixels. No second engine. No audio in the output path. (Replaces the old "Option A / true-parity" decision.)
2. **One shared architecture, one swappable "pixel pipe."** ~90% of this feature — UI, routing, the Source/Output/Route model, the layer compositing — is one codebase for web + Mac + Windows. The **only** platform-specific part is the small low-level pipe that physically moves pixels to the second window (§5). We are **not** building 2–3 separate apps.
3. **Ship order: web → Mac → Windows.** The web pixel pipe (`captureStream`) is free and works today. The native (Mac/Windows) pipe is the one genuinely hard, unsolved piece and is built **after** the web feature is complete (§9).
4. **Pro protocols are the native pipe, not a "someday."** Syphon (Mac) / Spout (Windows) / NDI move from "deferred forever" (§11) into the scheduled native phases as candidate mechanisms for the native pixel pipe.

**Relationship to existing docs (this doc is the hub):**
- [`app-output-dev.md`](app-output-dev.md) — the **shipped** single-canvas output settings (resolution lock, aspect/fill, wake-lock, virtual camera). Still accurate as history; this doc supersedes its multi-monitor sections.
- [`visualizer-output-dev.md`](visualizer-output-dev.md) — earlier research + an `OutputManager` mock; kept for platform-API detail and the Syphon/Spout/NDI reference tables.
- [`timeline-editor.md`](timeline-editor.md) Phase 5 — the timeline-side consumer. **Note the change:** Phase 4.9 Zone Stack is **no longer a prerequisite** for stacking-to-output (the mirror reuses the existing CSS layer compositing instead of re-hosting a compositor — see §1 and §5).

---

## 0. Handoff orientation — read this if you're new (AI or human)

**One-paragraph state.** Output = a **pixel mirror**: the output window is a dumb `<video>` showing a live `canvas.captureStream()` copy of a source canvas — never a second engine, never audio (the re-render approach drifts; §13). Web is shipped and committed: player/editor mirror (A1), multi-output foundation (A2.1), timeline per-zone→display routing (A2.2), route persistence + offline re-resolve (A2.3). Remaining: stacking (A3 — many zones → one display) and the native Mac/Windows pixel pipe (Phase B/C). Ship order web → Mac → Windows; only the low-level `outputPipe.js` is platform-specific.

**Code map (as built — verify line numbers before relying on them):**

| File | Role | Key symbols |
|---|---|---|
| `src/output/outputPipe.js` | THE platform seam. Web: `captureStream` → same-origin popup. | `attachSource(canvas, outId='main', fps=60)`, `detachSource(outId)`, `receiveStream(outId)`; stash = `window.__dcOutputStreams[outId]` |
| `src/output/outputManager.js` | Singleton `outputManager`. Detect displays; open/close/track output windows, multi-output keyed by `outId`. | `listDisplays({prompt})`, `openOutput({outId='main', display, fullscreen, canvas})`, `closeOutput(outId)`, `closeAll()`, `isActive(outId)`, `getOutputs()`, `onChange(fn)` |
| `src/output/outputWindow.js` | Runs INSIDE `output.html`. No engine. Reads `?out=<id>`, shows `receiveStream(outId)` in the `<video>`, fullscreen button. | — |
| `src/output/outputUI.js` | Shared "Send to display" section for player + editor. | `initOutputUI({engine, root})`; mirrors `engine.canvas` as `outId='main'` |
| `output.html` | The output window: one full-window `<video id="out-video">` (`object-fit:fill`), fullscreen button, status. | Vite MPA entry |
| `index.html` / `src/controls.js` | Player Output popover (`O`) hosts the shared section. | `#output-panel` + `initOutputUI` |
| `editor.html` / `src/editor/main.js` | Editor topbar Output panel hosts the same section. | `#editor-output-panel` + `initOutputUI` |
| `timeline.html` / `src/timeline/timelineEditor.js` | Timeline `⊟ Outputs` modal + per-zone routing. | `#tl-btn-outputs`, `#tl-output-mgr`; `_openOutputMgr`/`_assignZoneOutput`/`_renderOutputRoutes`/`_updateOutputChips`/`_zoneOutTag`; `mkZone().output`; chip `.tl-zone-out-chip` |
| `src/timeline/style.css` | Timeline output modal + chip styles; `--zone-col-w` **must equal** JS `ZONE_COL_W` in `timelineEditor.js`. | — |

**How to run & verify (web — a single screen is enough to prove sync):** `npm run dev:safe` → open the player → press `O` → **↻ Detect** (grant the window-management prompt) → pick a display → **Open output window**. A popup mirrors the canvas in perfect sync. Timeline: open `/timeline.html` → **`⊟ Outputs`** → route a zone to a display. *Keep the operator window visible — a hidden/occluded window throttles its rAF and the mirror freezes (known limit, §5).* Output windows spawn at half-display size, centred + cascaded; fullscreen each with the ⛶ button.

**Where to start next:** Phase **A3** (§9) — timeline stacking. Route two or more zones to the same display. The output window gets one `<video>` per routed zone, layered with each zone's existing `zIndex`/`opacity`/`blendMode`. No new data fields — reuses `mkZone()`. The operator screen already composites this way; the output window is a second copy of that stack.

**Two house rules that bit us (also in `CLAUDE.md`):** (1) plan before coding — trace the real path first; (2) in the timeline, the JS `ZONE_COL_W` constant and the CSS `--zone-col-w` var must change **together** or the playhead/blocks misalign.

---

## 1. The core model — *composition is not output*

Every major VJ tool draws a hard line between **what you render** and **where it goes**. We adopt the same line.

> **VDMX, verbatim:** output modes "do not affect your layers or rendering engine — once you've rendered the canvas, these output modes just determine how the resulting video is displayed on the various output devices."

Three nouns, used consistently from here on:

| Noun | What it is | In our app today |
|---|---|---|
| **Source** | A rendering surface producing pixels — one Butterchurn engine on one canvas. | The single canvas in player/editor; **each zone's canvas+engine** in the timeline (`_zoneMap`). |
| **Output** | A physical or virtual destination — a monitor, projector, app window, (later) NDI/Syphon/Spout. **An output displays one or more mirrored sources, composited.** | Does not exist yet. The browser window itself is the only implicit output. |
| **Route** | A Source→Output assignment. Many-to-one (**stack**) and one-to-many (**mirror**) are both allowed. | Does not exist yet. |

Two consequences fall straight out, and they are the two things you asked for:

- **"Zones translate into output routing."** A zone is a *Source*. Routing a zone to a display = one Route. The zone's existing `region`/`opacity`/`blendMode`/`zIndex` fields are the compositing recipe — they already exist in `mkZone()`.
- **"Send multiple presets to one output so they stack."** That is many Sources → one Output. The output **mirrors each source as its own video layer** and composites them with each source's opacity + blend mode + z-order — **the exact same CSS layering the timeline already does on the operator screen** (`_positionCanvas()`). The output is a second copy of that layered stack, not a rebuilt compositor.

```
   SOURCES                         ROUTES                    OUTPUTS (mirror each source as a layer, composited)
 ┌──────────┐
 │ Zone A   │───────────────┐
 │ (preset) │               ├─────────────────────────►  ┌─────────────────────┐
 └──────────┘               │   (A + B stacked)           │  Display 2 / Beamer │
 ┌──────────┐               │                             │  <video A> over     │
 │ Zone B   │───────────────┘                             │  <video B>          │
 │ (preset) │                                             │  zIndex·opacity·blend│
 └──────────┘                                             └─────────────────────┘
 ┌──────────┐                                             ┌─────────────────────┐
 │ Zone C   │─────────────────────────────────────────►  │  Display 3 (C alone)│
 │ (preset) │                                             └─────────────────────┘
 └──────────┘
                                                          ┌─────────────────────┐
 (any source can ALSO mirror to)  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►   │  Virtual Camera     │
                                                          └─────────────────────┘
```

In the **player and editor** there is only one Source (the single canvas), so routing collapses to "mirror this canvas to that display" — the simplest case, same module.

**Why this is *better* for layering than the old plan:** stacking is just "more mirrored video layers with the same CSS." No compositor to rebuild in the output window, no Zone Stack dependency, and — because every layer is a live copy — no drift, even with three presets stacked. The old re-render plan would have spun up N independent engines and drifted N times worse.

---

## 2. How the major VJ tools handle it (research)

Brief — the takeaway is uniform: they all separate composition from a saveable output map.

| Tool | Output model | What we borrow |
|---|---|---|
| **Resolume Arena** — *Advanced Output* | A separate window. Connected screens listed down the left; **each screen = one physical output**, assigned by right-click. **Slices** map regions of the composition onto an output. **Screen presets** save whole setups per venue. **Virtual Outputs** = an internal Syphon/Spout so one screen can feed another. | The "list of outputs, assign a source to each" layout; **saveable output/screen presets** (§9, Phase A4). |
| **MadMapper** | **Surfaces** (quads/meshes); top half picks the source region, bottom half places/warps it on the projector. | Surface = a Route with placement. (Warping/edge-blend is far-future.) |
| **VDMX** | Three output modes — **Window / Fullscreen / Advanced**. Advanced creates windows one-by-one, each with a chosen **source** + sizing mode (**Fit / Fill / Copy**). | The three-mode mental model; per-window source selection; Fit/Fill/Copy = our existing letterbox/crop/stretch. |

The unanimous pattern: **a render stage, then an independent output-mapping stage with its own saved presets.** Our `Source / Output / Route` model is that pattern, sized to a Butterchurn app.

Sources: [Resolume Advanced Output](https://resolume.com/support/en/advanced-output) · [Resolume Screens](https://www.resolume.com/support/en/screens) · [MadMapper Features](https://madmapper.com/madmapper/features) · [VDMX Video Display](https://docs.vidvox.net/vdmx/vdmx_video_display.html)

---

## 3. Current state audit

**What exists (shipped, good):**
- `index.html` **Output popover** (`#btn-output` / `#output-panel`, `O` key) — Render Resolution, Aspect Ratio, Fill Mode, Virtual Camera toggle. Status dot `#output-status-dot`. Persists to `localStorage`. *The seed we build on.*
- `timeline.html` — Zone Manager (`#tl-zone-mgr`, `⊞ Zones`) with 6 preset layouts; each zone is a region composited inside one screen.
- Engine: `engine.canvas` (`visualizer.js:105`), `engine.setSize(w,h)`, `lockResolution()`, and **`engine.canvas.captureStream(fps)`** already used by the virtual camera (`startVirtualCamera`, `visualizer.js:570`). *The mirror reuses exactly this capture mechanism.*
- Timeline: per-zone canvas+engine in `_zoneMap`; `_positionCanvas()` already applies `region`, `zIndex`, `mixBlendMode`; `mkZone()` already stores `opacity`, `blendMode`, `zIndex`, `gapBehavior`. **This is the compositing the output mirror reuses.**

**What exists (the mirror — Phase A1, built 2026-05-22):**
- `src/output/` (`outputManager`, `outputWindow`, `outputPipe`, `outputUI`) + `output.html` — the **pixel mirror**. `outputTransport.js` deleted; the output window is a dumb `<video>` (0.95 kB chunk, no engine, no audio); web pipe = `engine.canvas.captureStream(60)` handed to the popup via `window.opener.__dcOutputStream`. Builds clean; **runtime-verified 2026-05-22 (same pixels, in sync).**

**What's missing (as of 2026-05-23):**
- **Stacking** — many zones → one display, composited (A3). ⬅ next
- **Player/editor persistence** — `lastDisplayId` / `openFullscreen` restore (§8) not yet wired.
- **The native (Mac/Windows) pixel pipe** — desktop apps can't mirror yet; `captureStream` + the same-origin handoff is web-only (Phase B/C).

**The gift in the existing code:** zones already carry the full compositing recipe (`opacity`/`blendMode`/`zIndex`) and the engine already knows how to `captureStream`. The mirror is mostly *plumbing existing pixels to a second window*, not inventing anything.

---

## 4. Shared architecture — one brain, dumb outputs, one swappable pipe

A single module, framework-free, imported by all three pages.

```
src/output/
  outputManager.js   // singleton: detect displays, open/close outputs, hold routes
  outputWindow.js    // runs INSIDE an output window — DISPLAYS mirrored video layer(s); no engine
  outputPipe.js      // the ONE platform-specific part: how pixels reach the output window
                     //   web  → canvas.captureStream() handed to a same-origin popup
                     //   mac  → native pipe (Syphon / pixel-readback) — Phase B
                     //   win  → native pipe (Spout / pixel-readback)  — Phase C
  outputUI.js        // shared popover/section builder reused by player + editor
  (timeline adds its own Output Manager modal that drives the same outputManager)
```

```js
// outputManager.js — shape (mirror model)
class OutputManager {
  platform;                  // 'web' | 'tauri-macos' | 'tauri-windows'
  async listDisplays();      // → [{ id, label, x, y, w, h, scale, isPrimary }]
  async openOutput(target);  // { displayId?, fullscreen? } → OutputHandle
  closeOutput(handle);
  setRoutes(handle, routes); // routes: [{ sourceCanvas, opacity, blendMode, zIndex, region }]
                             //   the output mirrors each source as a layer in z-order
  getOutputs();              // live handles + status
}
```

A **route** carries the source **canvas** (to mirror) plus the compositing recipe. `sourceCanvas` is the single canvas in player/editor; a zone's canvas in the timeline. Many routes on one handle = a stacked output.

> **As built (A1/A2.1) vs. the shape above.** The shipped `outputManager` is **one mirror window per `outId`** — there is **no `setRoutes` yet** (it arrives with A3 stacking, when one output composites several sources). Real signatures today: `openOutput({ outId='main', display, fullscreen, canvas })`, `closeOutput(outId)`, `closeAll()`, `isActive(outId)`, `getOutputs() → [{id, displayId, active}]`, `onChange(fn)`, `listDisplays({ prompt })`. The pixel handoff lives in `outputPipe.js` (`attachSource`/`detachSource`/`receiveStream`, keyed by `outId`). `outId` = `'main'` for player/editor, the `zone.id` in the timeline.

**Design rules (carry into every phase):**
1. **One brain, dumb outputs.** The main page owns playback, audio, preset state, *and all rendering*. The output window only displays mirrored pixels — it decides nothing and renders nothing. This is what makes multi-output safe and drift-free.
2. **The only platform branch is `outputPipe.js`.** Everything above it (UI, routing, data, compositing) is shared. If you find yourself branching platform logic anywhere else, stop — it belongs in the pipe.
3. **Degrade, never block.** No Window Management permission / single display / Firefox → fewer outputs, never a dead button. Show *why*.
4. **Same UI language as Zone Manager.** Tile grid, same card metaphor. In the **timeline**, selected/active states use **neutral dark grey, not accent colours** — controls float over the live canvas.
5. **Persist the map, not the moment.** Routes save with the timeline set / app settings; the live playhead never does.

---

## 5. The pixel pipe — the one hard part (the truth)

Getting pixels from the operator's canvas onto a second display. This is the single platform-specific piece; everything else is shared.

### Why "re-render in the output window" is dead (do not revive)

The output window running its own engine — even fed the *same* audio — produces a **different** picture, because every Butterchurn preset animates off the engine's internal `time`/`frame` counters. Two engines started at different moments, ticking on two independent `requestAnimationFrame` loops, are never at the same point in the animation and slowly drift further apart. Stacking makes it N× worse (one drifting engine per layer). This is fatal for a VJ tool and is identical on web and native. **Abandoned.** Full post-mortem in §13.

### The model: mirror the pixels

The output window is a `<video>` (one per source layer) whose frames are a live copy of the source canvas. Nothing is recomputed. Same pixels → perfect sync, by construction.

```
 main canvas (the one true render) ──capture pixels──► pixel pipe ──► <video> in output window ──► display
```

Stacking = one `<video>` per routed source, layered with the **same** `zIndex` / `mix-blend-mode` / `opacity` the operator screen already uses. The output is a second instance of the existing layer stack.

### The pipe per platform — one job, three implementations

| Platform | Pipe mechanism | Cost | Status |
|---|---|---|---|
| **Web** (browser + live HTTPS site) | `canvas.captureStream(60)` → hand the `MediaStream` to a same-origin `window.open` popup's `<video>.srcObject`. No WebRTC, no encode, GPU-cheap. | Trivial | **The path. Build now (Phase A).** |
| **Mac** (Tauri desktop) | A second Tauri `WebviewWindow` is a **sealed, isolated** WebView — you cannot hand it a `MediaStream`. Needs a native pipe: **Syphon** (GPU texture share), or pixel-readback pushed over IPC/shared memory, or **NDI**. | Hard — native interop, must spike | **Phase B — pick via spike.** |
| **Windows** (Tauri desktop) | Same isolation problem. Native pipe: **Spout** (Syphon's Windows twin), pixel-readback, or **NDI**. | Hard | **Phase C.** |

The web fidelity trade-off (be honest): the mirror copies the operator canvas at its render resolution, then scales to the display. If the display is larger than the canvas, slight upscale softness. Acceptable for organic Milkdrop visuals and tunable by raising the source canvas resolution. (The native-resolution re-render the old plan promised was never achievable anyway — it drifted.)

### Web pipe handoff (no BroadcastChannel needed)

A `window.open` popup is same-origin, so the opener can share the actual `MediaStream` object directly: the opener stashes `window.__dcOutputStream = canvas.captureStream(60)` **before** opening; the popup reads `window.opener.__dcOutputStream` on load and assigns it to `<video>.srcObject`. For stacking, share one stream per source (e.g. an array/map) and build one `<video>` per route. No per-frame messaging at all.

**Known web limit (won't engineer around):** if the operator window is fully hidden/occluded, the OS throttles its `rAF`, the source canvas stops updating, and the mirror freezes. Fine — the operator screen is always visible during a show. Document it; don't add machinery.

---

## 6. Platform notes

### Web (Chrome/Edge — Window Management API)
- **Enumerate:** `await window.getScreenDetails()` → `.screens[]` (`label/left/top/width/height`). One-time `window-management` permission prompt; gate behind a user gesture.
- **Place:** `window.open('/output.html', name, 'popup,left=<x>,top=<y>,width=<w>,height=<h>')`.
- **Fullscreen on the target screen:** `el.requestFullscreen({ screen })` (Chrome 104+). *(Verify on current Chrome before relying on it.)*
- **Firefox / no permission:** no `getScreenDetails()` → plain popout the user drags to the second screen and fullscreens manually. Degrade, don't block.
- **CSP / build:** `output.html` is a Vite MPA entry (Rollup input), same nginx CSP. No new origins (same-origin stream handoff).

### Desktop (Tauri macOS + Windows) — the native pipe phases
- **Enumerate:** `availableMonitors()` (Tauri JS API) → name/size/position/scaleFactor.
- **Window:** a second borderless `WebviewWindow`, then **`set_position(monitor.x, monitor.y)` → `set_fullscreen(true)`** to land fullscreen on a chosen monitor (Tauri #6394). Windows: watch #7139 (cross-monitor `set_position`).
- **The pixels are the hard part** — the second WebviewWindow can't take a `MediaStream`. Candidate pipes, to be chosen by spike (Phase B0):
  - **Syphon (Mac) / Spout (Win)** — share the source's GPU texture natively to a native output surface. Zero-copy, fast; requires Rust-side interop and a way to publish the webview's WebGL texture.
  - **Pixel readback** — `readPixels`/`toBlob` each frame → push over Tauri IPC or shared memory → draw in the output window. Simple conceptually, heavy at 1080p60; may need lower res/fps or a shared-memory ring buffer.
  - **NDI** — encode to NDI on the LAN; the output window (or any NDI receiver, incl. OBS/Resolume) displays it. Cross-platform, network-flexible, adds latency + a dependency.
- **Tauri v1.5 caveat:** the project is on v1.5. Multi-window works via v1 `WindowBuilder`. **Do not** bundle a v2 migration into this feature.
- **Wake-lock:** an output window must hold the macOS `caffeinate` assertion (already solved for the main window).

Build-target detection: the existing `typeof window.__TAURI__ !== 'undefined'` check.

---

## 7. UI / UX design (unchanged by the correction — still valid)

One shared *entry point*, two depths of UI.

### 7.1 Player + Editor — extend the existing popover (single output, preview)

Build on `index.html`'s `#output-panel`; add the same section to `editor.html` via shared `outputUI.js`.

```
┌ Output Settings ───────────────┐
│ Render Resolution  [ Match ▾ ]  │   ← existing
│ Aspect Ratio       [ Free  ▾ ]  │   ← existing
│ Fill Mode          [ Letterbx▾] │   ← existing
│ ───────────────────────────────│
│ Send to display                 │   ← NEW
│   [ Display 2 — 1920×1080  ▾ ]  │
│   [ ▢ Open output ]  ● live     │
│   ☐ Fullscreen on open          │
│ ───────────────────────────────│
│ ☐ Virtual Camera   ● OFF        │   ← existing
└─────────────────────────────────┘
```

Single source (`'main'`), no routing UI — it's preview / secondary-screen mirroring. Editor uses the identical section so a preset author can throw the canvas onto a second screen while building.

### 7.2 Timeline — a dedicated **Output Manager** modal (routing + stacking)

A new transport button **`⊟ Outputs`** beside **`⊞ Zones`**. Opens a modal mirroring the Zone Manager tile grid. Neutral greys only.

```
┌ Outputs ─────────────────────────────────────────── ✕ ┐
│  Displays                                      [ ↻ ]   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ Display 1│ │ Display 2│ │ Display 3│              │
│  │ operator │ │ ▸ Full   │ │  — open  │              │
│  └──────────┘ └──────────┘ └──────────┘              │
│  ───────────────────────────────────────────────────  │
│  Routing — drag a zone onto a display, or stack many   │
│   Display 2  ◀  [ Full ]                               │
│   Display 3  ◀  [ Left ] [ Right ]   ← stacked, z-order│
│                  ⠿ opacity ▏blend: screen ▾            │
│  ───────────────────────────────────────────────────  │
│  Virtual Camera  ◀  [ composed view ]      ● live      │
└─────────────────────────────────────────────────────────┘
```

- **Routing is the headline.** Each display row holds the zone chip(s) routed to it. Drop a second zone on a row → it stacks. Stacked chips show in z-order and expose the per-source `opacity`/`blend` — the same fields the Zone Stack popover edits (one source of truth).
- **Quick-assign from the zone row:** each zone-row header gets a small output chip (`▸2`); click → inline display picker. No modal mid-show.
- **At-a-glance state:** a routed zone shows a small monitor glyph; live = a calm pulse (never a strobe).

> **As built (A2.2) vs. the mock above.** The shipped modal is simpler: a **Displays** list (cards) + a **Routing** list with **one dropdown per zone** (Off / each display). No drag-onto-display, no stacked chips, no per-source opacity/blend yet — those are **A3** (stacking). The zone-row chip is `▸`/`▸N` and **opens the modal** (the inline picker is a later refinement). On assign, the output window opens immediately mirroring that zone's canvas; "Off" closes it.

### 7.3 What we deliberately do NOT build (v1)
Edge-blending, projection warping/meshes, slices/sub-regions of one source across outputs, per-output colour calibration. MadMapper/Resolume-Arena territory — far-future.

---

## 8. Data model (unchanged by the correction — still valid)

**App settings (player/editor)** — `localStorage` `discocast_output`, extend the existing object:
```js
{ resolution, aspectRatio, fillMode, virtualCamera,   // existing
  lastDisplayId: 'screen-2', openFullscreen: true }    // new, best-effort restore
```

**Timeline set** — extend each zone (routes live with the set, so they're portable):
```js
zone = { id, name, color, region, opacity, blendMode, zIndex, gapBehavior,
         output: null | {                 // null = composites on operator screen as today
           displayId: '1',                // OS index from listDisplays() — NOT stable across sessions
           displayLabel: 'DELL U2719D',   // ← re-resolve by THIS on load (A2.3); IDs aren't stable
           fullscreen: false
         } }
```
- **As built (A2.2 + A2.3):** the shape above is exactly what `_assignZoneOutput` writes. A `target` field (display/window/virtualcam) is **not** implemented — only `'display'` exists today. On load, `_resolveOutputRoutes()` re-resolves each saved `zone.output` by `displayLabel` (IDs aren't stable), updates `displayId`, and sets `_offline: true` if the display isn't found. Chip shows `▸!` + dashed border for offline; `↺ Restore N routes` button appears in the modal when restorable routes exist.
- **Stacking is emergent (A3):** two zones whose `output.displayId` match are stacked on that display, ordered by `zIndex`, composited by their existing `opacity`/`blendMode`. No new field — reuses `mkZone()`.
- **Display ID stability:** OS display IDs aren't stable across reboots/replug. Persist `displayLabel` too and re-resolve by label on load; if gone, show "output offline — reassign", never silently drop.
- **Migration:** absent `output` → `null` → today's behaviour. No migration pass.

---

## 9. Phased development plan — web → Mac → Windows

Web first (the pipe is free and you VJ there now); native after (the pipe is the hard part). Each phase ships standalone value.

### Phase A — WEB (the whole feature on web)

**A1 — Web mirror, single output (Player + Editor)  ✅ built & runtime-verified 2026-05-22**
- [x] Ripped out the re-render path: deleted `outputTransport.js`; gutted `outputWindow.js` (no engine, no audio); `output.html` `<canvas>` → `<video>`.
- [x] `outputPipe.js` (web): `attachSource`/`detachSource`/`receiveStream` — `canvas.captureStream(60)` stashed on `window.__dcOutputStream`, popup reads via `window.opener`.
- [x] `outputManager.openOutput({ display, fullscreen, canvas })` opens/places/fullscreens the popup; `outputUI` passes `engine.canvas`.
- [x] Kept the working bits: display enumeration (`listDisplays`), `requestFullscreen({screen})`, manual-close poll, the player popover + editor panel.
- [x] `npm run build` clean; output-window chunk is 0.95 kB (Butterchurn gone from the popup).
- [x] **Runtime verified 2026-05-22** — same pixels, in perfect sync (confirmed single-screen). ✅ A1 complete.
- **Exit:** from player *and* editor, push the canvas to a second display, fullscreen, **in perfect sync**. ✅

**A2 — Timeline routing (1 zone → 1 display)** — built in 3 increments:
- [x] **A2.1 multi-output foundation** ✅ 2026-05-22 (builds clean; A1 re-verified in sync after refactor). Pipe keyed by `outId` (`window.__dcOutputStreams[outId]`, default `'main'`); `outputManager` holds `Map<outId,{win,displayId,poll}>` + `closeAll`/`getOutputs`/`onChange`; popup reads `?out=<id>`; unique popup name `dc-output-<id>`. Player/editor = the `'main'` case, unchanged.
- [x] **A2.2** ✅ built & runtime-verified 2026-05-22 (working in browser; routes live-only until A2.3). `⊟ Outputs` transport button + `#tl-output-mgr` modal (neutral greys): Detect displays + per-zone display picker. `mkZone` gets `output:null`. Assign → `outputManager.openOutput({outId:zone.id, canvas:_zoneMap.get(id).canvas})` opens a window mirroring that zone; "Off" closes it. Compact `▸`/`▸N` chip on each zone row (brighter when live) opens the modal. `closeAll()` on layout change. *Routes are live-only here — persistence is A2.3.* **Fixes (2026-05-22):** output `<video>` is `object-fit:fill` (fills the display; stretches if source aspect ≠ display — proper letterbox/crop/stretch Fill Mode is a later toggle); zone-label column widened 120→150px (CSS `--zone-col-w` **and** JS `ZONE_COL_W` in lock-step) so the chip doesn't truncate zone names; output windows now spawn at half-display size (cap 960w, aspect-preserved), centred + cascaded 40px (not full-monitor, which buried the window edges) — user fullscreens with ⛶ when ready.
- [x] **A2.3** ✅ committed 2026-05-23 — `_resolveOutputRoutes()` fires on every `_loadTimeline`: detects displays (no prompt), re-resolves each `zone.output` by `displayLabel` (IDs aren't stable), updates `displayId` or sets `_offline:true`. Chip: `▸!` + dashed border = offline, `▸N` dim = saved-not-live, `▸N` bright = live. Modal: `⚠ DisplayName — not detected` option when offline; `↺ Restore N routes` button when restorable routes exist (user gesture opens popups). New methods: `_resolveOutputRoutes`, `_reopenSavedRoutes`.
- **Exit:** each zone drives its own monitor; assignments persist and survive reload.

**A3 — Timeline stacking (many zones → one display)  ⬅ headline ask**
- [ ] Route multiple zones to one display: one `<video>` layer per zone in the output window, composited by `zIndex` with each zone's `opacity`/`blendMode`/`region`.
- [ ] Stacked-chip UI; shared opacity/blend controls (one source of truth with the Zone Stack popover).
- **No longer depends on Phase 4.9 Zone Stack** — we reuse CSS layer compositing, not a re-hosted compositor.
- **Exit:** two/three presets stacked on one projector, pixel-identical to the operator screen, no drift.

**A4 — Web polish & venue presets**
- [ ] **Output presets** (Resolume-style): save/name a whole display→route map per venue; one-click switch.
- [ ] Mirror (one source → multiple displays); "composed view" → virtual camera.
- [ ] Hot-unplug recovery; perf pass (several 1080p60 mirrors with main UI still 60fps); clean teardown.
- **Exit:** production-ready multi-screen on web.

### Phase B — MAC (native pixel pipe, Tauri macOS)
- [ ] **B0 — Spike the native pipe (no production code):** prototype Syphon vs pixel-readback vs NDI; measure latency/fps/effort; pick one. This is the project's one true unknown.
- [ ] **B1:** implement the chosen pipe behind the **same** `outputManager`/`outputPipe` interface; reuse all of Phase A's UI/routing/compositing untouched.
- [ ] **B2:** native window placement + fullscreen-on-monitor (`set_position`→`set_fullscreen`), wake-lock, multi-output teardown.
- **Exit:** the Mac desktop app drives a second monitor in sync, with the identical UI and routing as web.

### Phase C — WINDOWS (native pixel pipe, Tauri Windows)
- [ ] **C1:** Spout (or the readback path proven in B0) behind the same interface.
- [ ] **C2:** Windows window-placement quirks (#7139 cross-monitor `set_position`); Win32 fallback only if it bites.
- **Exit:** the Windows desktop app reaches parity with Mac.

### Future (not scheduled) — §11
NDI as a first-class network output; projection warp / edge-blend; slices.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| ~~Butterchurn can't take injected audio~~ — *moot; we don't inject audio anymore* | The mirror needs no audio. |
| Web mirror upscale softness (display > canvas) | Acceptable for organic visuals; raise source canvas resolution if a venue needs it. |
| Occluded operator window freezes the mirror | Documented limit (§5); operator screen is always visible during a show. |
| **Native pixel pipe is unsolved** (the real risk) | Phase B0 spike gates it before any production native code; three candidate mechanisms (Syphon/Spout, readback, NDI). |
| Cross-window perf (many mirrors at 60fps) | `captureStream` layers are GPU-cheap (no codec); FPS budget in A4; HUD exists (`` ` `` key). |
| Display IDs unstable across sessions | Persist + re-resolve by label; "offline — reassign", never silent drop. |
| Tauri v1.5 multi-window rough edges (#6394/#7139) | Documented workaround; scope a v2 migration **separately**. |
| Scope creep into Resolume territory (warp/slices) | Explicitly out (§7.3); modal stays a router, not a mapper. |

---

## 11. Native pipe candidates & far-future protocols

The first three are now **the native pixel pipe** (Phases B/C), not "deferred forever." Detail in [`visualizer-output-dev.md`](visualizer-output-dev.md).

| Tech | Platform | Role | Phase |
|---|---|---|---|
| **Syphon** | macOS | GPU texture share → native output surface. Strong Mac pipe candidate. | B0 spike |
| **Spout** | Windows | Syphon's Windows twin. | C |
| **Pixel readback over IPC/shared-mem** | all native | Simple, web-ish; heavy at high res/fps. Fallback pipe. | B0 spike |
| **NDI** | macOS + Windows | Network output; also feeds OBS/Resolume. Cross-platform, adds latency. | B0 spike / Future |
| Warp / edge-blend / slices | all | Projection-mapping (MadMapper/Arena). | Far-future only |

---

## 12. References

**Web APIs** — [Window Management API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API) · [getScreenDetails()](https://developer.mozilla.org/en-US/docs/Web/API/Window/getScreenDetails) · [captureStream()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
**Tauri** — [Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) · [#6394 fullscreen on monitor](https://github.com/tauri-apps/tauri/issues/6394) · [#7139 set_position cross-monitor](https://github.com/tauri-apps/tauri/issues/7139)
**Native share** — [Syphon](https://syphon.github.io/) · [Spout](https://spout.zeal.co/) · [NDI](https://ndi.video/)
**VJ tools** — [Resolume Advanced Output](https://resolume.com/support/en/advanced-output) · [MadMapper Features](https://madmapper.com/madmapper/features) · [VDMX Video Display](https://docs.vidvox.net/vdmx/vdmx_video_display.html)

---

## 13. Post-mortem — the abandoned re-render path (so nobody rebuilds it)

**What was built (Phase 1, 2026-05-21):** an Option-A re-render system. The output window ran its own Butterchurn engine and rendered from broadcast audio.

| File | What it did | Fate |
|---|---|---|
| `src/output/outputTransport.js` | `BroadcastChannel`; per-frame posted `Uint8Array(1024)` audio bytes + the preset object on change. | **Delete** (A1). |
| `src/output/outputWindow.js` | Ran a second Butterchurn viz, `render({audioLevels})` from broadcast, `loadPreset` on message. | **Gut** → display a `<video>` from the mirror stream (A1). |
| `output.html` | Black full-window `<canvas>` + audio meter + fullscreen button. | `<canvas>`→`<video>`, drop the meter, keep fullscreen (A1). |
| `src/output/outputManager.js` | Display enumeration, `window.open` placement, manual-close poll. | **Keep** the window/display logic; swap `OutputTransport` for the mirror pipe (A1). |
| `src/output/outputUI.js` | Shared player/editor section wiring. | **Keep**; pass `engine.canvas` instead of the analyser/preset source. |
| `index.html` / `editor.html` / `controls.js` / `editor/main.js` / `vite.config.js` | Popover section, editor panel, init calls, `output` Rollup input. | **Keep** — these are pipe-agnostic. |

**Why it failed:** two Butterchurn engines = two internal `time`/`frame` clocks on two independent rAF loops. Identical audio still yields a different frame, and the two drift apart over time. Stacking would have multiplied the drift per layer. The Phase 0 "perfect sync" result only proved the *transport* (counters) was low-latency — it never tested whether two *engines* render in lockstep. They don't.

**The lesson:** for a VJ mirror, never recompute the picture at the destination. Copy the pixels. One render, shown in many places.

---

*Last updated: 2026-05-23 — A1 + A2.1 + A2.2 + A2.3 all committed to main. Pixel mirror, not re-render (§13). One shared architecture + one swappable pixel pipe. Ship order web → Mac → Windows. Next action: A3 (stacking — many zones → one display), then Phase B/C (native pipe).*
