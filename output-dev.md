# Output & Multi-Monitor — Design & Dev Doc

**Status:** Phase 1 built 🛠 (code-complete, builds clean; runtime test on a 2nd display pending) — see §9
**Created:** 2026-05-21
**Scope:** Routing visualizer output to one or more physical displays/projectors, across the player (`index.html`), Preset Studio (`editor.html`), and Timeline (`timeline.html`), all on one shared engine.

**Decisions locked at scoping (2026-05-21):**
1. **Platform: true parity.** Web (browser) and desktop (Tauri macOS/Windows) are co-equal targets. One abstraction drives both; per-platform code only where the OS forces it.
2. **Pro protocols deferred.** v1 = the app drives monitors/projectors itself (windowed + fullscreen-to-display + the existing virtual camera). **NDI / Syphon / Spout are out of near-term scope** — parked in §11.

**Relationship to existing docs (this doc is now the hub):**
- [`app-output-dev.md`](app-output-dev.md) — record of the **shipped** single-canvas output settings (resolution lock, aspect/fill, wake-lock, virtual camera). Still accurate as history; this doc supersedes its *multi-monitor* sections (its Phase 2 item 4).
- [`visualizer-output-dev.md`](visualizer-output-dev.md) — earlier multi-monitor research + an `OutputManager` mock. Folded into this doc; kept for the platform-API detail and the NDI/Syphon/Spout reference tables.
- [`timeline-editor.md`](timeline-editor.md) Phase 5 — the timeline-side consumer of this system. Its Phase 4.9 (Zone Stack) is a hard dependency of stacking-to-output (§7-Phase 3).

---

## 1. The core model — *composition is not output*

Every major VJ tool draws a hard line between **what you render** and **where it goes**. We adopt the same line. It is the single most important idea in this doc.

> **VDMX, verbatim:** output modes "do not affect your layers or rendering engine — once you've rendered the canvas, these output modes just determine how the resulting video is displayed on the various output devices."

Three nouns, used consistently everywhere from here on:

| Noun | What it is | In our app today |
|---|---|---|
| **Source** | A rendering surface producing pixels — one Butterchurn engine on one canvas. | The single canvas in player/editor; **each zone's canvas+engine** in the timeline (`_zoneMap`). |
| **Output** | A physical or virtual destination — a monitor, projector, app window, (later) NDI/Syphon/Spout. **An output is also a compositor: it can stack several sources.** | Does not exist yet. The browser window itself is the only implicit output. |
| **Route** | A Source→Output assignment. Many-to-one (**stack**) and one-to-many (**mirror**) are both allowed. | Does not exist yet. |

Two consequences fall straight out of this model, and they are exactly the two things you asked for:

- **"Zones translate into output routing."** A zone is a *Source*. Routing a zone to a display = one Route. The zone's existing `region`/`opacity`/`blendMode`/`zIndex` fields are the compositing recipe — they already exist in `mkZone()`.
- **"Send multiple presets to one output so they stack."** That is many Sources → one Output. The Output composites them with each source's opacity + blend mode + z-order. This is the *same* compositing math as the in-app Zone Stack (timeline Phase 4.9); the Output system just hosts it on a physical destination instead of the operator screen.

```
   SOURCES                         ROUTES                    OUTPUTS (each composites its sources)
 ┌──────────┐
 │ Zone A   │───────────────┐
 │ (preset) │               ├─────────────────────────►  ┌─────────────────────┐
 └──────────┘               │   (A + B stacked)           │  Display 2 / Beamer │
 ┌──────────┐               │                             │  zIndex·opacity·blend│
 │ Zone B   │───────────────┘                             └─────────────────────┘
 │ (preset) │
 └──────────┘                                             ┌─────────────────────┐
 ┌──────────┐                                             │  Display 3          │
 │ Zone C   │─────────────────────────────────────────►  │  (C alone)          │
 │ (preset) │                                             └─────────────────────┘
 └──────────┘
                                                          ┌─────────────────────┐
 (any source can ALSO mirror to)  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►   │  Virtual Camera     │
                                                          └─────────────────────┘
```

In the **player and editor** there is only one Source (the single canvas), so routing collapses to "send this canvas to that display" — a single output for preview/performance. Same module, simplest case.

---

## 2. How the major VJ tools handle it (research)

Brief, because the takeaway is uniform — they all separate composition from a saveable output map.

| Tool | Output model | What we borrow |
|---|---|---|
| **Resolume Arena** — *Advanced Output* | A separate window. Connected screens listed down the left; **each screen = one physical output**, assigned by right-click. **Slices** map regions of the composition onto an output. **Screen presets** save whole setups per venue. **Virtual Outputs** = an internal Syphon/Spout so one screen can feed another. | The "list of outputs, assign a source to each" layout; **saveable output/screen presets** (§9). |
| **MadMapper** | **Surfaces** (quads/meshes); top half picks the source region, bottom half places/warps it on the projector. Scales to many projectors. | Surface = a Route with placement. (Warping/edge-blend is far-future for us.) |
| **VDMX** | Three output modes — **Window / Fullscreen / Advanced**. Advanced creates windows one-by-one, each with a chosen **source** (not just the main canvas) + sizing mode (**Fit / Fill / Copy**). | The three-mode mental model; per-window source selection; Fit/Fill/Copy = our existing letterbox/crop/stretch. |

The unanimous pattern: **a render stage, then an independent output-mapping stage with its own saved presets.** Our `Source / Output / Route` model is that pattern, sized to a Butterchurn app.

Sources: [Resolume Advanced Output](https://resolume.com/support/en/advanced-output) · [Resolume Screens](https://www.resolume.com/support/en/screens) · [MadMapper Features](https://madmapper.com/madmapper/features) · [VDMX Video Display](https://docs.vidvox.net/vdmx/vdmx_video_display.html) · [VDMX Rendering](https://docs.vidvox.net/vdmx/vdmx_rendering)

---

## 3. Current state audit

**What exists (shipped):**
- `index.html` **Output popover** (`#btn-output` / `#output-panel`, `O` key) — Render Resolution, Aspect Ratio, Fill Mode, Virtual Camera toggle. Status dot `#output-status-dot`. Persists to `localStorage`. *This is the seed we build on.*
- `editor.html` — **no** output UI. (Has the focus/preview toggle only.)
- `timeline.html` — Zone Manager (`#tl-zone-mgr`, `⊞ Zones`) with 6 preset layouts; each zone is a region composited inside one screen.
- Engine: `engine.setSize(w,h)`, `lockResolution()`, `startVirtualCamera()/stopVirtualCamera()` (per `app-output-dev.md`).
- Timeline: per-zone canvas+engine in `_zoneMap`; `_positionCanvas()` already applies `region`, `zIndex`, `mixBlendMode`. `mkZone()` already stores `opacity`, `blendMode`, `zIndex`, `gapBehavior`.

**What's missing:**
- Any concept of a physical Output, display enumeration, or a Route.
- A way to open/drive a second window on a chosen display.
- Shared output code — the popover logic lives only in `controls.js`; editor/timeline can't reuse it.

**The gift in the existing code:** zones already carry the full compositing recipe (`opacity`/`blendMode`/`zIndex`). Stacking-to-output is mostly *plumbing those existing fields to a second window*, not inventing a compositor.

---

## 4. Shared architecture — one `OutputManager`, three hosts

A single module, framework-free, imported by all three pages. This is the "all follow the same engine" requirement.

```
src/output/
  outputManager.js   // singleton: detect displays, open/close outputs, hold routes
  outputWindow.js    // the code that runs INSIDE an output window (renders + composites sources)
  outputTransport.js // how source state reaches an output window (see §5) — platform-branched
  outputUI.js        // shared popover/section builder reused by player + editor
  (timeline adds its own Output Manager modal that drives the same outputManager)
```

```js
// outputManager.js — shape only, not final
class OutputManager {
  platform;                  // 'web' | 'tauri-macos' | 'tauri-windows'
  async listDisplays();      // → [{ id, label, x, y, w, h, scale, isPrimary }]
  async openOutput(target);  // target: { type:'display'|'window'|'virtualcam', displayId?, fullscreen? } → OutputHandle
  closeOutput(handle);
  setRoutes(handle, routes); // routes: [{ sourceId, opacity, blendMode, zIndex }] — many → one = stack
  getOutputs();              // live handles + status
}
```

`sourceId` is `'main'` in player/editor; a `zone.id` in the timeline. The same `setRoutes([...])` call with multiple entries is what stacks presets on one output — no separate "stack" API.

**Design rules (carry these into every phase):**
1. **One brain.** The main page owns playback, audio, preset state. Output windows never decide anything; they render what the brain tells them. This keeps multi-output dead-simple and avoids N audio engines fighting.
2. **Degrade, never block.** No Window Management permission / single display / Firefox → the UI still works, just offers fewer outputs. Show *why*, never a dead button.
3. **Same UI language as Zone Manager.** Tile grid, same card metaphor. In the **timeline**, selected/active states use **neutral dark grey, not accent colours** — controls sit over the live canvas (see project rule "No accent colours in timeline UI").
4. **Persist the map, not the moment.** Output routes save with the timeline set / app settings; the live playhead never does.

---

## 5. The hard part — getting pixels onto a second display (transport)

This is the one genuine unknown and the thing to **spike before committing** (CLAUDE.md: verify the real execution path first). There are two families; we pick one primary and keep one fallback.

### Option A — **Re-render in the output window, driven by broadcast state** ✅ recommended for parity

The output window runs its *own* Butterchurn engine(s). The main window broadcasts, each frame/transition: the active preset(s) per source, the playhead, and the **per-band audio levels** (bass/mid/treb/vol — already computed in the main engine). The output engine renders from those injected levels instead of its own analyser.

- **Transport:** `BroadcastChannel` (web, same-origin) / Tauri `emit`/`listen` events (native). **Identical app code both platforms → true parity.**
- **Stacking:** the output window spins up one engine per routed source and composites them with the routes' `opacity`/`blendMode`/`zIndex` — literally the Zone Stack compositor, re-hosted. This is why **Phase 4.9 Zone Stack is a prerequisite for stacking-to-output**.
- **Quality:** pixel-perfect at the display's native resolution; no video-codec generation loss.
- **✅ Confirmed (2026-05-21, code-read):** the vendored Butterchurn already supports injected audio as a **stock API — no patch needed.** `render({ audioLevels: { timeByteArray, timeByteArrayL, timeByteArrayR } })` calls `AudioProcessor.updateAudio(...)` instead of `sampleAudio()` (`src/vendor/butterchurn.js:2750` + `:432`). The arrays are three `Uint8Array(1024)` (fftSize) time-domain buffers; `processAudio()` derives the FFT/freq internally.
  - **Broadcast payload:** one `Uint8Array(1024)` per frame from our existing analyser (`visualizer.js:109`, already `fftSize:1024`) via `getByteTimeDomainData()`. Duplicate it to L/R for v1 (our analyser is mono); add a channel splitter later if stereo-reactive presets need true L/R. ≈1 KB/frame ≈60 KB/s for *all* outputs (every zone shares one analyser) — trivial for `BroadcastChannel`/Tauri events.

### Option B — **Capture + hand off the stream** (web fallback / simplest)

`canvas.captureStream(60)` on each source canvas → assign `video.srcObject` in the output window.
- **Web:** because a popout opened via `window.open` is **same-origin**, the opener can hand a `MediaStream` straight to the popout's `<video>` — no WebRTC, no re-render, no audio problem. Stacking = several `<video>`/canvas draws with `mix-blend-mode`.
- **Native (Tauri):** a second WebviewWindow is an *isolated* WebView — you **cannot** hand a `MediaStream` across it. So Option B is **web-only**; native would need pixel readback (heavy). This is why Option B can't be the parity answer, only a web fallback.

### Recommendation

**Option A is the path — locked.** Audio injection is confirmed stock (above), so A is the single parity path for web + desktop and it gives stacking for free via the Zone Stack compositor. Option B is no longer needed for the audio problem; keep it on the shelf only as a possible *zero-render* web mirror if a future case wants it. Do **not** build B speculatively.

| | A: re-render + broadcast | B: captureStream handoff |
|---|---|---|
| Web | ✅ | ✅ (same-origin, no WebRTC) |
| Tauri macOS/Win | ✅ | ❌ (isolated WebView) |
| Stacking | ✅ reuses Zone Stack | ⚠️ blend multiple videos |
| Audio | ⚠️ inject levels (spike) | ✅ none needed |
| Fidelity | native-res render | stream copy |
| **Verdict** | **primary** | web-only fallback |

---

## 6. Platform implementation notes (parity)

### Web (Chrome/Edge — Window Management API)
- **Enumerate:** `await window.getScreenDetails()` → `.screens[]` with `label/left/top/width/height`. Triggers a one-time `window-management` permission prompt.
- **Place:** `window.open('/output.html?out=<id>', name, 'popup,left=<x>,top=<y>,width=<w>,height=<h>')`.
- **Fullscreen on the target screen (newer than the old research):** the API now adds a **`screen` option to `requestFullscreen()`** — `el.requestFullscreen({ screen })` puts the output element fullscreen on the chosen display (Chrome 104+). The old "web can't fullscreen a specific display" limitation is **lifted**. *(Verify on the current Chrome before relying on it.)*
- **Firefox / no permission:** no `getScreenDetails()` → fall back to a plain popout the user drags to the second screen and fullscreens manually. Degrade, don't block.
- **CSP:** `output.html` must be a new Vite MPA entry (Rollup input) and inherit the same nginx CSP; broadcast uses same-origin `BroadcastChannel` (no new origins).

### Desktop (Tauri macOS + Windows)
- **Enumerate:** `availableMonitors()` (Tauri JS API) → name/size/position/scaleFactor.
- **Open:** a second borderless `WebviewWindow` pointing at `output.html`.
- **Fullscreen on a chosen monitor:** Tauri has no one-call "fullscreen on monitor X" — use the documented **`set_position(monitor.x, monitor.y)` → `set_fullscreen(true)`** workaround (Tauri #6394). On Windows watch #7139 (cross-monitor `set_position`); add a Win32 fallback only if it bites.
- **Tauri v1.5 caveat:** the project is on v1.5. Multi-window works in v1 via `WindowBuilder`, but the cleaner window plugins are v2-only. **Do not** bundle a v2 migration into this feature — build on v1 `WindowBuilder` and note v2 as a separate future.
- **Wake-lock:** an output window must also hold the macOS `caffeinate` assertion (already solved for the main window).

Build-target detection is the existing `typeof window.__TAURI__ !== 'undefined'` check.

---

## 7. UI / UX design

**Best place to put it** (your question): one shared *entry point*, two depths of UI.

### 7.1 Player + Editor — extend the existing popover (single output, preview)

Build directly on `index.html`'s `#output-panel`. Add the **same popover to `editor.html`** via the shared `outputUI.js` so both match. Append one section under the current controls:

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
│ ☐ Virtual Camera   ● OFF        │   ← existing, moves below
└─────────────────────────────────┘
```

- "Send to display" lists detected displays; "Open output" launches the output window there. Status dot already exists — green when an output is live.
- Single source (`'main'`), so no routing UI — it's preview/secondary-screen mirroring. This is the "single outputs for preview" you specified.
- Editor uses the identical section so a preset author can throw the canvas onto a second screen while building.

### 7.2 Timeline — a dedicated **Output Manager** modal (routing + stacking)

A new transport button **`⊟ Outputs`** sits beside **`⊞ Zones`** (`#tl-btn-zones`). It opens an Output Manager modal that mirrors the Zone Manager's tile grid (consistent muscle memory). Neutral greys only — it floats over the live canvas.

```
┌ Outputs ─────────────────────────────────────────── ✕ ┐
│  Displays                                      [ ↻ ]   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ Display 1│ │ Display 2│ │ Display 3│              │
│  │ 2560×1440│ │ 1920×1080│ │ 1920×1080│              │
│  │ operator │ │ ▸ Full   │ │  — open  │              │
│  └──────────┘ └──────────┘ └──────────┘              │
│  ───────────────────────────────────────────────────  │
│  Routing — drag a zone onto a display, or stack many   │
│   Display 2  ◀  [ Full ]                               │
│   Display 3  ◀  [ Left ] [ Right ]   ← stacked, in z-order │
│                  ⠿ opacity ▏blend: screen ▾            │
│  ───────────────────────────────────────────────────  │
│  Virtual Camera  ◀  [ composed view ]      ● live      │
└─────────────────────────────────────────────────────────┘
```

- **Routing is the headline.** Each display row holds the zone chip(s) routed to it. Drop a second zone on a row → it **stacks** (the user's ask). Stacked chips show in z-order and expose the per-source `opacity`/`blend` (the same fields the Zone Stack popover edits — one source of truth).
- **Quick-assign from the zone row** (faster live path): each timeline zone-row header gets a small output chip (e.g. `▸2`); click → inline display picker. Mirrors the Zone Manager's inline feel; no modal needed mid-show.
- **At-a-glance state:** a zone routed externally shows a small monitor glyph on its row; live = a calm pulse (same calm-pulse language as loop state, never a strobe).

### 7.3 What we deliberately do NOT build (v1)
Edge-blending, projection warping/meshes, slices/sub-regions of one source across outputs, per-output colour calibration. These are MadMapper/Resolume-Arena territory and out of scope — note them as far-future so the modal stays clean.

---

## 8. Data model

**App settings (player/editor)** — `localStorage` `discocast_output`, extend the existing object:
```js
{ resolution, aspectRatio, fillMode, virtualCamera,   // existing
  lastDisplayId: 'screen-2', openFullscreen: true }    // new, best-effort restore
```

**Timeline set** — extend each zone (no new top-level structure; routes live with the set so they're portable):
```js
zone = { id, name, color, region, opacity, blendMode, zIndex, gapBehavior,
         output: null | {                 // NEW — null = composites on operator screen as today
           target: 'display' | 'window' | 'virtualcam',
           displayId: 'screen-2',         // resolved by label match on load (IDs aren't stable across sessions)
           fullscreen: true
         } }
```
- **Stacking is emergent:** two zones whose `output.displayId` match are stacked on that display, ordered by `zIndex`, composited by their existing `opacity`/`blendMode`. No new field needed — this reuses what `mkZone()` already stores.
- **Display ID stability:** OS display IDs are not stable across reboots/replug. Persist `displayLabel` too and re-resolve by label on load; if it's gone, show the zone as "output offline — reassign" rather than silently dropping it.
- **Migration:** absent `output` → `null` → today's behaviour. No migration pass needed.

---

## 9. Phased development plan

Ordered to de-risk first and ship value early. Parity is built into each phase (web + desktop together); pro protocols excluded per the locked decision.

### Phase 0 — Spike (no production code) 🔬
Validate the unknowns *before* committing to the architecture.
- [x] **Butterchurn renders from injected audio levels** — ✅ confirmed by code-read 2026-05-21 (stock `render({audioLevels})`, §5). Transport = Option A, locked.
- [ ] Web: `getScreenDetails()` + `window.open(left/top)` lands a popout on Display 2 on current Chrome; `requestFullscreen({screen})` works. **→ `output-spike.html` (throwaway, web) covers this.**
- [x] Web: `BroadcastChannel` round-trips to the output window **in perfect sync** — ✅ confirmed empirically 2026-05-21 via `output-spike.html` (counters locked in sync continuously). The brain→output transport is proven.
- [ ] Web: physical placement on a *second* display + `requestFullscreen({screen})` — confirm whenever a 2nd screen/projector is plugged in (worst-case fallback: drag the window manually, always works).
- [ ] Tauri: second `WebviewWindow` + `set_position`→`set_fullscreen` lands fullscreen on monitor 2 (macOS + Windows). **→ needs a Tauri dev build; not covered by the web spike.**
**Exit:** a throwaway demo mirrors the main canvas fullscreen on Display 2 on **both** platforms. (Web mechanics: run `output-spike.html`. Native mechanics: separate Tauri test.)

### Phase 1 — Shared module + single output in Player & Editor  ✅ built 2026-05-21 (runtime test pending)
- [x] `src/output/` module (`outputManager`, `outputWindow`, `outputTransport`, `outputUI`).
- [x] `output.html` MPA entry (Vite Rollup input) — builds; same-origin `BroadcastChannel`, no new CSP origins.
- [x] "Send to display" section in the player popover (`index.html`) **and** a topbar Output panel in `editor.html` (shared `outputUI`).
- [x] Open / fullscreen / close an output on a chosen display; button reflects live state; display list enumerates on the ↻ / open gesture.
- [ ] **Runtime verification on a 2nd display** — code-complete and builds clean; not yet exercised on real hardware (do this on a multi-monitor rig, same as the spike).
**Exit:** from player *and* editor, push the canvas to a second display, fullscreen, both platforms. Lowest-risk foundation, immediately useful.

**Build log — Phase 1 (2026-05-21).** Code-complete; `npm run build` clean (only the known vendored-butterchurn `COMMONJS_VARIABLE_IN_ESM` warnings). New `src/output/` module + `output.html`; wiring is additive (no existing handler changed).

| File | Change |
|---|---|
| `src/output/outputTransport.js` | **new** — `BroadcastChannel('dc-output')`; per-frame posts the analyser's `Uint8Array(1024)` time-domain bytes; posts the resolved preset object on name-change; resends on the output window's `ready` ping. |
| `src/output/outputManager.js` | **new** — singleton. `listDisplays({prompt})` (web `getScreenDetails` gated behind a gesture; Tauri `availableMonitors` best-effort; always a "This screen" fallback). `openOutput`/`closeOutput` via `window.open('/output.html?fs=…', positioned)` + manual-close poll. |
| `src/output/outputWindow.js` | **new** — runs in `output.html`. Own Butterchurn viz, **no `connectAudio`**; `render({ audioLevels })` fed from broadcast; `loadPreset` on preset msg; `requestFullscreen({screen})` button + best-effort auto-FS. |
| `src/output/outputUI.js` | **new** — shared section wiring (`initOutputUI({engine, root})`); source = `{ analyser, getName→getCurrentPresetName, getPreset→engine.presets[name] }`. |
| `output.html` | **new** — black full-window canvas + auto-hiding Fullscreen button. |
| `vite.config.js` | +`output` Rollup input. |
| `index.html` | +"Send to display" block inside the existing `#output-panel`. |
| `src/controls.js` | +import + one `initOutputUI({engine, root:outputPanel})` call after `_restoreOutputSettings()`. No existing handler touched. |
| `editor.html` | +topbar Output button + `#editor-output-panel` markup. |
| `src/editor/style.css` | +`.editor-output-panel` / `.eop-*` block (editor tokens, no accent colour). |
| `src/editor/main.js` | +import + panel toggle + `initOutputUI` in `boot()`. |

**Runtime test notes (2026-05-21).** The Window-Management bits (`getScreenDetails`, `requestFullscreen({screen})`) require a **secure context** → work on `localhost` and the live **HTTPS** site, but NOT over plain-`http` LAN (browsing the dev server from another machine by IP). Full multi-display test = live build (or localhost on a 2-display machine). A single-screen **reactivity check** works anywhere: open the output window beside the main window (don't cover the main — a hidden/occluded main window throttles its rAF and stops feeding audio), play audio, watch the new output-window meter (green+moving = audio path good; red "No audio" = main window not feeding). The output window has an inline audio meter + stale-signal warning for exactly this diagnosis.

**Works now (verified by build + bundle check):** all four modules + both pages compile; the `dc-output` transport is bundled into the shared chunk used by player and editor, and into the output-window chunk. **Not yet tested:** live render on a second physical display, fullscreen-on-screen, manual-close detection — needs a hardware run (`npm run dev` → open player → Output (`O`) → ↻ Detect → pick display → Open output window). **Not in this phase:** Tauri *native* window (still uses `window.open`); persistence of last-display choice; per-output resolution.

**Implementation findings (code-traced 2026-05-21 — `visualizer.js`):** the transport can run as an *external observer* of the existing engine, so Phase 1 barely touches current files — a big risk-reducer.
- `engine.analyser` is already public (`fftSize:1024`, `visualizer.js:109`) → the transport reads `getByteTimeDomainData(buf)` each frame and broadcasts it. **No change to `visualizer.js` needed for audio.**
- `engine.getCurrentPresetName()` (`:393`) + `engine.presets[name]` (the name→object map, `:137`) → the transport **polls** the current name each frame and, on change, broadcasts the resolved raw preset object. No new event hooks in existing preset-load call sites (avoids the multi-listener risk the CLAUDE.md flags).
- Output window: a bare Butterchurn visualizer (not the full `VisualizerEngine` — it needs no AudioContext/AGC/flux). On a preset message → `viz.loadPreset(obj, blend)` (mirrors `visualizer.js:338`); each frame → `viz.render({ audioLevels })`. Broadcasting the resolved *object* (not the name) means `output.html` does **not** bundle the 1,144-preset packs — keeps it tiny.
- Net: new code is almost entirely additive in `src/output/`; existing files get at most a one-line export. Confirmed the save/load path before relying on it (per the high-risk-category rule).

### Phase 2 — Timeline routing (1 zone → 1 display)
- [ ] `⊟ Outputs` transport button + Output Manager modal (Zone Manager visual language, neutral greys).
- [ ] Per-zone `output` field; route a zone to a display; quick-assign chip on the zone-row header.
- [ ] Routes save/load with the timeline set; offline-display handling.
**Exit:** each zone can drive its own monitor; assignments persist and survive reload.

### Phase 3 — Stacking (many zones → one output) ⬅ your headline ask
- **Depends on timeline Phase 4.9 (Zone Stack)** — same compositor, re-hosted in the output window.
- [ ] Route multiple zones to one display; composite by `zIndex` with each zone's `opacity`/`blendMode`.
- [ ] Stacked-chip UI in the modal; shared opacity/blend controls (one source of truth with the Zone Stack popover).
**Exit:** two presets stacked on one projector exactly as composited on the operator screen.

### Phase 4 — Polish & venue presets
- [ ] **Output presets** (Resolume-style): save/name a whole display→route map per venue; switch in one click.
- [ ] Mirror (one source → multiple displays); "composed view" → virtual camera.
- [ ] Hot-unplug recovery, multi-output performance pass (4× 1080p60 with main UI still 60fps), clean teardown on close.
**Exit:** production-ready for a real multi-screen gig.

### Future (not scheduled) — §11
NDI / Syphon / Spout; projection warp / edge-blend; slices.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Butterchurn can't take injected audio levels | Phase 0 spike gates this; fall back to Option B on web, re-tap mic on native, file-audio sync flagged |
| Cross-window perf (N engines at 60fps) | Cap output count; FPS budget in Phase 4; HUD already exists (`` ` `` key) |
| Display IDs unstable across sessions | Persist + re-resolve by label; "offline — reassign" state, never silent drop |
| Tauri v1.5 multi-window rough edges (#6394/#7139) | Use documented workaround; scope a v2 migration **separately**, never inside this feature |
| Scope creep into Resolume territory (warp/slices) | Explicitly out (§7.3); modal stays a router, not a mapper |
| Two output codepaths drift | One `OutputManager`; platform branches isolated to `outputTransport.js` |

---

## 11. Deferred — pro VJ protocols (parked by decision)

Out of near-term scope; captured so the decision is explicit and the prior research isn't lost. Full detail in [`visualizer-output-dev.md`](visualizer-output-dev.md).

| Protocol | Platform | Why deferred | When to revisit |
|---|---|---|---|
| **NDI** | macOS + Windows (Rust crate) | Cross-platform network output to OBS/Resolume; needs native bindings + runtime install. Strong v2 hero. | If users ask to feed OBS/Resolume per-zone over LAN |
| **Syphon** | macOS only | Zero-latency GPU texture share; native FFI. | macOS power-VJ demand |
| **Spout** | Windows only | Syphon's Windows twin; native. | Windows power-VJ demand |
| Warp / edge-blend / slices | all | Projection-mapping scope (MadMapper/Arena). | Only if we pivot toward mapping |

---

## 12. References

**Web APIs** — [Window Management API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API) · [Using the Window Management API](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API/Using) · [getScreenDetails()](https://developer.mozilla.org/en-US/docs/Web/API/Window/getScreenDetails) · [Chrome: Manage several displays](https://developer.chrome.com/docs/capabilities/web-apis/window-management) · [captureStream()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
**Tauri** — [Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) · [#6394 fullscreen on monitor](https://github.com/tauri-apps/tauri/issues/6394) · [#7139 set_position cross-monitor](https://github.com/tauri-apps/tauri/issues/7139)
**VJ tools** — [Resolume Advanced Output](https://resolume.com/support/en/advanced-output) · [Resolume Screens](https://www.resolume.com/support/en/screens) · [MadMapper Features](https://madmapper.com/madmapper/features) · [VDMX Video Display](https://docs.vidvox.net/vdmx/vdmx_video_display.html)

---

*Last updated: 2026-05-21 — Phase 1 built. Decisions: true parity + direct-output-only. Phase 0 web spike done. Phase 1 code-complete + builds clean (player + editor + output.html); runtime test on a 2nd display is the next action. Then Phase 2 (timeline routing).*
