# Output & Multi-Monitor — Design & Dev Doc

**Status:** pixel mirror, not re-render (§13). Web A1–A3 + composed program + **N0 NDI proof** all done; **next = Phase B (desktop local display).** Truth doc; supersedes all prior recommendations. **👉 Scan the 📋 Phase Board just below — it's the single status + step tracker.**
**Created:** 2026-05-21 · **Corrected:** 2026-05-22
**Scope:** Routing visualizer output to one or more physical displays/projectors, across the player (`index.html`), Preset Studio (`editor.html`), and Timeline (`timeline.html`), all on one shared engine.

---

## 📋 Phase Board — START HERE (the single status + order tracker)

Legend: ✅ done · ⬅ **next** · 📋 planned. Shipping product = the **desktop app** (web is the dev/proving ground). Per-step *detail* is in §9; this board is the authority for *status & order*.

**WEB — ✅ complete** (whole feature works in-browser)
- ✅ **A1** — player/editor mirror → a display
- ✅ **A2** — timeline per-zone → display routing (+ persistence / offline re-resolve)
- ✅ **A3** — stacking/layering: overlaid layers that follow the timeline (per-layer blend/opacity)
- ✅ **A4 · composed program** — one feed of the whole timeline *(rest of A4 — venue presets, mirror — = 📋)*

**NATIVE — in progress** (the shipping path)
- ✅ **N0** — NDI proof: composed program live in OBS + NDI Video Monitor
- ⬅ **Phase B — desktop local display (projector/monitor)  ◀ WE ARE HERE**  · 🔌 **first real projector (Vankyo X3) field-tested 2026-06-09 — see the "Projector field setup" section below: wireless RULED OUT (lag + AirPlay instability); ✅ root cause found — the projector's hub was wired to the **MacBook Air**, not the Mac mini (where the app/dev/terminal run); Universal Control hid that. RULE: **one machine hosts app + operator monitor + projector** (wired EXTENDED, its WiFi OFF — wired+wireless conflict = blackouts). Canvas-only output already works via A1 once the rig is one-machine + wired. See "Projector field setup" → RESOLUTION.**
  - ✅ **B1** — fullscreen the app on a chosen monitor · **Approach A** (one projector, whole show, ~zero latency) · **verified in tauri-dev 2026-05-23** (app went fullscreen on the chosen display)
  - 📋 **B2** — separate operator + output · **Approach B** spike (Syphon vs pixel-readback) · *needs the 2nd display — projector arriving ~end of week (2026-05); will test monitor + projector as 2 outputs*
  - 📋 **B3** — placement polish: wake-lock on output, clean teardown, multi-output
- ✅ **N1** — NDI named source + persists (on/off + name) · **verified in tauri-dev 2026-05-23** (custom name shows in OBS; survives relaunch) *(the `output.target` model refactor is deferred — not needed while NDI = the single composed-program output)*
- 📋 **N2** — ship-enable NDI (bundle `libndi` + licensing; x86_64 slice) · ⚠ **blocks any NDI release**
- 📋 **Phase C** — Windows local display (Spout)
- 📋 **Enhancements** — audio-over-NDI A/V-lock, A4 venue presets, transparent-bg → NDI alpha

**Locked rules:** event sync rides the **local-display path, not NDI**; ⚠ don't ship NDI until **N2**; never re-render at the destination (§13).

---

## 🔌 Projector field setup — Vankyo X3 (HARD-WON, 2026-06-09)

A real on-device test that cost ~2 hours of pain. **Read this before connecting any projector** — it saves the entire ordeal.

> **✅ END RESULT: WORKING (web build, MacBook Air, 2026-06-09 night).** The app's Outputs modal detected **both** Built-in Retina + **S2-TEK TV (1920×1080)** as separate displays once the projector was set to **Extended** in System Settings → Displays. Winning recipe: projector wired to the MacBook Air (its own keyboard → no Universal Control needed) → in System Settings → Displays set **S2-TEK TV to Extended** (NOT mirror; setting the built-in's mode was the path that failed — set the *projector* to Extended) → app on the MacBook Air → Outputs → route **Full → S2-TEK TV** (or Open Composed Program) → fullscreen → projector shows pure canvas, controls stay on the built-in. The BetterDisplay EDID fix below is only needed if the macOS "mirror/extend" TV-prompt keeps nagging; the rig works without it once Extended is set.

**The device:** Vankyo X3 (shows up as **"S2-TEK TV"**) — native 1080p, 300 ANSI lumens, dual-band WiFi (AirPlay/Miracast receiver), HDMI / USB / AV inputs. Test rig: Mac mini M2 (`Mac14,3`) driving an LG FHD operator monitor; controlled from a MacBook Air over **Universal Control**.

### What actually happened (accurate hardware + symptom log — corrected after I got it wrong twice)
**Hardware (confirmed 2026-06-09):**
- **LG FHD** operator monitor → Mac mini's **native HDMI port** · Main display · 1920×1080 @ 100 Hz.
- **Vankyo X3 projector** → **HDMI cable → a USB‑C HUB → Mac mini USB‑C port.** (It is a *hub*, NOT a bare "adapter" — earlier notes here calling it an adapter were wrong.)
- **The projector HAS appeared in System Settings → Displays in a prior session** — so a wired path to it is *capable* of working. Today it did not.

**Symptom today (every single check):** `system_profiler SPDisplaysDataType` showed **only the LG**. The projector never registered as a wired display. Instead it connected over **WiFi AirPlay** — it showed in the macOS *Screen Mirroring* menu as "Connected," and the projector itself displayed the macOS **"Choose to Mirror or Extend Display from the menu"** AirPlay placeholder. Diagnostic rule: a *wired* HDMI display appears in Displays/`system_profiler` and **never** in the Screen Mirroring menu; an *AirPlay* connection is the reverse. Today = AirPlay, not the hub.

**The blackout:** when "Extend" was chosen (over that wireless session), the **LG went black** — because the projector had been set as macOS **"Main display,"** so the whole desktop jumped to the projector and left the LG empty.

**UNRESOLVED — the real open question:** *why the wired HDMI‑via‑hub signal wasn't reaching (or wasn't preferred) today, when it has worked before.* Two live hypotheses, **neither confirmed — do not state as fact:**
- (a) the **USB‑C hub's video passthrough dropped** (loose/flaky USB‑C, needs reseating, or only works in a specific port);
- (b) the **projector prioritised its own built‑in WiFi input** over its HDMI input and auto-connected over AirPlay before the wired signal could take.

### Wireless (AirPlay) = RULED OUT for this app
Two hard reasons, both confirmed live:
- **Latency** — AirPlay buffers ~100–300 ms; it visibly lags the beat and **wrecks audio-reactivity sync** (the thing we care most about).
- **Instability** — "Extend Display" over AirPlay **blanked the Mac mini's main monitor**; the Screen Mirroring session then **wedged into a phantom "Connected" state** the UI could not dismiss (cleared only by physically unplugging / powering off the projector). Budget-projector AirPlay receiver + macOS = unreliable. **Do not revisit wireless for this projector.**

### Terminal diagnosis truths (for the next time something "won't disconnect")
- **`system_profiler SPDisplaysDataType` is the authority.** It lists only *real, attached* displays. All day it showed **one** display (LG FHD); the projector never appeared because it was never a stable wired display. An AirPlay "connection" that does **not** show here = no actual mirror, just a UI ghost.
- A live AirPlay mirror is held by **`replicatord` + `AirPlayUIAgent`** (plus `sharingd` / `mediaremoted`). `killall`-ing them drops a *real* mirror, but will **not** clear a phantom Control Center menu entry while the projector keeps advertising itself on Bonjour. The phantom only dies when the **projector** stops broadcasting (turn it off / switch its input).
- ⚠️ **NEVER turn off WiFi on a machine you drive via Universal Control.** Universal Control rides on WiFi — killing WiFi on the Mac mini **severs the keyboard/mouse link and locks you out of the machine.** This burned ~30 min. Stick to read-only checks; let the human drive any network/AirPlay/system-settings change.

### ✅ RESOLUTION (end of 2026-06-09) — the projector was on the WRONG MACHINE
The whole day's failure had one cause: **the projector's hub was wired to the MacBook Air, while the app, the dev server, the repo, and the Claude/terminal session were all on the Mac mini.** Universal Control made the two machines *feel* like one (one cursor/keyboard), so it wasn't obvious the projector wasn't physically on the Mac mini. Proof: the Mac mini's `system_profiler` + Thunderbolt check showed **"No device connected"** on both USB-C ports — nothing was plugged into the mini — while plugging the projector into the **MacBook Air** made it appear instantly as a real wired display (`Paul's MacBook Air → S2-TEK TV`, MacBook resolution auto-changed). Universal Control's unified Displays view listing screens from *both* machines added to the confusion.

A **second** conflict then appeared: on the MacBook Air the projector was connected **both** by cable (HDMI hub) **and** over WiFi AirPlay at once → choosing "Extend" blacked all screens and mirroring kept re-popping. This is the exact wired+wireless conflict Vankyo's manual warns against.

**THE RULE (decided by the user, the right call):** **one machine hosts the app + the operator monitor + the projector.** Don't split them across machines. Projector = a **wired EXTENDED** display on that one machine, with its **WiFi/AirPlay OFF** so wired and wireless never fight. Universal Control is fine *only* as a remote keyboard/trackpad — never as a way to span the display rig across machines.

**Two valid rigs (pick the host = the machine that runs the app):**
- **Mac mini host (recommended — repo + dev server + LG already there):** LG FHD = operator (native HDMI); projector = 2nd display via a **video-capable USB‑C→HDMI adapter plugged DIRECTLY into the mini's USB‑C** (not the hub that turned out to be on the Air). Mac mini M2 drives 2 displays (HDMI + 1 USB‑C).
- **MacBook Air host (fewest cables — projector already works there):** built-in = operator; projector = the Air's single external display (Apple-Silicon Air supports exactly one external).

Once the rig is one-machine + wired-extended + wireless-off, canvas-only output is the already-shipped A1 flow (open the canvas-only output window → drag onto the projector → fullscreen).

### ✅✅ THE WORKING FIX (confirmed 2026-06-09 night) — "Stop Mirroring" = set built-in to Main display
After the projector was wired to the MacBook Air, the built-in screen kept defaulting to **"Use as: Mirror for S2-TEK TV"** (System Settings → Displays → select the built-in). Two symptoms came from that one setting: (1) the built-in shrank to the projector's 1080p ("everything smaller"); (2) choosing "Extend" blacked the operator screen (desktop jumped to the projector, which was set as Main).
**The fix that worked:** in Displays, select the **Built-in Display** → **"Use as"** dropdown → change **"Mirror for S2-TEK TV" → "Main display"** (this is the "Stop Mirroring" action). That single change **un-mirrors** (built-in returns to native resolution) **and** makes the built-in the Main display (desktop stays put) **and** turns the projector into a clean separate **extended** screen. No blackout, no shrinking.
**Then:** run the app on the MacBook Air → open the canvas-only output window (player `O` → Open output window, or timeline Open Composed Program) → drag it onto the S2-TEK TV extended screen → fullscreen (⛶). Projector = pure canvas; built-in = controls. Keep projector input on **HDMI**; stay out of the Screen Mirroring menu.

### 🎯 THE DEFINITIVE ROOT CAUSE — macOS Sequoia mis-IDs the projector as a "TV" (known bug)
Why the **"Choose to Mirror or Extend Display from the menu"** prompt kept appearing *every single time* the projector connected, no matter what — it's a **known macOS Sequoia (15.x) bug**, not a user error and not the projector's WiFi. There's a GitHub thread with that exact title and a MacRumors thread "macOS 15.2 Screen Mirroring is always active." It hits **Apple-Silicon Macs with a display connected through a USB-C dock/hub** — exactly this rig. Two factors gang up: (1) the projector rides a **USB-C hub** (the Sequoia trigger), and (2) it names itself **"S2-TEK TV."** macOS treats *TVs* differently from *monitors* — for a TV it pops the mirror/extend prompt on every connect/wake instead of just extending. OS-level misidentification → no built-in setting fully suppresses it.
**Fixes:**
- **Level 1 (try first):** System Settings → Displays → select **S2-TEK TV** → change the **"When connected to TV"** dropdown (away from "Ask What to Show"). Helps but per the thread may not fully stop it.
- **Level 2 (the sure fix):** install **[BetterDisplay](https://github.com/waydabber/BetterDisplay)** (free, open-source) → **override the projector's EDID to mark it as a DisplayPort (DP) monitor, not a TV.** Maintainer: *"change the display's EDID to explicitly mark it as a DP device, macOS seems to honor that."* Then macOS treats it as a normal monitor → the mirror prompt stops, it just extends.
- Sources: [BetterDisplay discussion #4654](https://github.com/waydabber/BetterDisplay/discussions/4654) · [MacRumors — Sequoia screen mirroring always active](https://forums.macrumors.com/threads/macos-15-2-screen-mirroring-is-always-active.2445366/) · [Apple — Use your TV as a display](https://support.apple.com/guide/mac-help/use-your-tv-as-a-display-mchlp1206/mac).

### Earlier next-test note (superseded by the resolution above)
Goal: force the projector onto the **wired** path and see whether it registers — to settle hypothesis (a) vs (b) above.
1. On the **projector** (its own remote/menu): **turn the PROJECTOR's WiFi OFF** — this is the *projector's* WiFi, **NOT the Mac mini's** (never touch the Mac's WiFi → it locks the user out via Universal Control, see [[feedback_mac_mini_no_disruptive_terminal]]). With its WiFi off the projector physically *cannot* fall back to AirPlay. Set input **Source → HDMI**.
2. **Reseat the USB‑C hub** firmly in the Mac mini (and/or try the other USB‑C port).
3. Run `system_profiler SPDisplaysDataType` (read-only):
   - **Projector now appears as a 2nd display** → the hub path is alive; the cause was the projector preempting with WiFi (hypothesis b). Then: set **LG as Main display**, choose **Extend**, drag the canvas-only output window onto the projector, fullscreen → done.
   - **Still only the LG** → the **USB‑C hub's video passthrough is the failure** (hypothesis a): it isn't carrying the projector's HDMI to the Mac. Next: try a different hub / a video‑capable USB‑C→HDMI adapter, or temporarily move the projector to the **native HDMI port** to prove the projector + cable themselves are fine.

### Canvas-only output is ALREADY shipped (A1) — no new code for the first win
Once the projector is a real **wired** display:
1. Player → press **`O`** → **↻ Detect** → pick the projector.
2. **Open output window** — this window is *already* **canvas-only, no controls** (a dumb `<video>`).
3. Drag it onto the projector, fullscreen it (⛶).
4. Operator controls stay on the LG; the projector shows pure canvas.

That is the entire "app outputs only the canvas, not the overlay controls" goal — it works the moment the projector is a stable wired display instead of a WiFi ghost. The *native* (Tauri) clean-output equivalent is Phase B2 (still the real build gap); web A1 covers the test rig today.

---

## The decision that changed (read this first)

The original plan picked **Option A — re-render in the output window** (the second window runs its own Butterchurn engine, fed broadcast audio). It was chosen for "true parity" (one codebase, web + desktop).

**It does not work.** Two engines = two independent clocks → the output **drifts** out of sync with the operator screen. Confirmed at runtime 2026-05-22. For a VJ tool, "the projector matches what I see" is non-negotiable, so this is a hard fail. It would also drift on the desktop app for the identical reason — so the "parity" it promised was never real.

**The correct model: the output window is a dumb display of copied pixels.** It never re-renders, never runs an engine, never needs audio. It shows a live **mirror** of the operator's canvas. Same pixels in two places = cannot drift, by construction.

**Decisions locked (2026-05-22, release strategy updated 2026-05-23):**
1. **Output = mirror, not re-render.** The output window displays a copy of the source canvas pixels. No second engine. No audio in the output path. (Replaces the old "Option A / true-parity" decision.)
2. **One shared architecture, one swappable "pixel pipe."** ~90% of this feature — UI, routing, the Source/Output/Route model, the layer compositing — is one codebase for web + Mac + Windows. The **only** platform-specific part is the small low-level pipe that physically moves pixels to the destination (§5). We are **not** building 2–3 separate apps. The user's mental model, confirmed: *"one brain, swappable last-inch pipe."*
3. **Web is the DEV/proving ground; the SHIPPING product is the desktop app (macOS + Windows).** *(Release strategy clarified 2026-05-23.)* The web build is **not** being released for beta — piracy risk (browser source is trivially copyable; a compiled Tauri binary is not). May change later. **Consequence:** the native pixel pipe is **beta-critical, not eventual polish** — without it, multi-output never reaches end users. We still BUILD features on web first (the `captureStream` pipe is free and iteration is fast), then they ride into the desktop app behind the native pipe. So "web first" = development order, **not** release order.
4. **NDI is a first-class, central output — likely the FIRST native pipe.** *(Elevated 2026-05-23.)* Goal = fill every output gap: projectors, screens, OBS, streaming, other apps/machines. NDI is "one cable to everything on the LAN" — a single NDI sender feeds OBS / streaming / Resolume / other machines / hardware at once, covering the most targets in one build. It's inherently **native** (browsers can't emit NDI) and **cross-platform** (one implementation covers Mac *and* Windows, vs. Syphon=Mac-only / Spout=Win-only). So the native order is **NDI first**, then Syphon/Spout as local low-latency upgrades. (NDI also needs a model tweak — see §8: an NDI output has no `displayId`/window, so the Output model needs a `target` discriminator: `display` | `ndi` | `syphon`/`spout`.)

**Relationship to existing docs (this doc is the hub):**
- [`native-output-dev.md`](native-output-dev.md) — **the native half of this doc**: the deep design + plan for the NDI / Syphon / Spout pixel pipe (Phases N/B/C), the frame compositor, JS→native transport options, and the video/taint resolution. Read it before building anything native. (Phases here in §9 are the summary; that doc is the detail.)
- [`app-output-dev.md`](app-output-dev.md) — the **shipped** single-canvas output settings (resolution lock, aspect/fill, wake-lock, virtual camera). Still accurate as history; this doc supersedes its multi-monitor sections.
- [`visualizer-output-dev.md`](visualizer-output-dev.md) — earlier research + an `OutputManager` mock; kept for platform-API detail and the Syphon/Spout/NDI reference tables.
- [`timeline-editor.md`](timeline-editor.md) Phase 5 — the timeline-side consumer. **Note the change:** Phase 4.9 Zone Stack is **no longer a prerequisite** for stacking-to-output (the mirror reuses the existing CSS layer compositing instead of re-hosting a compositor — see §1 and §5).

---

## 0. Handoff orientation — read this if you're new (AI or human)

### Orientation

> **Status & order = the 📋 Phase Board at the very top of this doc.** That's the single tracker — scan it first.
> **Which doc is which:** `output-dev.md` (THIS doc) = where we are, what's next, the model — always start here. [`native-output-dev.md`](native-output-dev.md) = native-pipe *reference detail only* (NDI binding recipe, transport math). Open it only when coding native internals; no status lives there.

**One-paragraph state.** Output = a **pixel mirror**: an output window is a dumb stage of `<video>` layers, each a live `canvas.captureStream()` copy of a source canvas — never a second engine, never audio (the re-render approach drifts; §13). Committed: player/editor mirror (A1), multi-output foundation (A2.1), timeline per-zone→display routing (A2.2), route persistence + offline re-resolve (A2.3). **Built & browser-verified 2026-05-23 (commit pending):** stacking (A3 — many zones → one display as **full-frame overlaid layers**, composited by zIndex/opacity/blendMode, with per-layer blend+opacity controls). **Output layers overlay, they do NOT tile by region** — region is an operator-screen layout concern only (the layer-stack / transparent-bg orchestration model; see §1). **Layers follow the timeline:** a layer's output opacity = `zone.opacity × (1 − operatorCoverOpacity)`, so when a clip ends the layer fades out and reveals the one beneath. Remaining: A4 web polish + the native Mac/Windows pixel pipe (Phase B/C). Ship order web → Mac → Windows; only the low-level `outputPipe.js` is platform-specific.

**A3 key change (read before touching output code):** output windows are now keyed by **display**, not zone. `outputManager` outId = `'main'` (player/editor) or `'disp:'+displayId` (timeline). One window per display hosts one `<video>` per routed zone. The pixel pipe carries a **layer list** (`setLayers`/`getLayers`), not a single stream. `zone.output` data model is unchanged — stacking is emergent (zones sharing a `displayId` stack). `timelineEditor._syncOutputs()` reconciles all display windows from the routes.

**Code map (as built — verify line numbers before relying on them):**

| File | Role | Key symbols |
|---|---|---|
| `src/output/outputPipe.js` | THE platform seam. Web: per-source `captureStream` → same-origin popup, as a **layer list** per output. | `setLayers(outId, layers, fps=60)`, `clearLayers(outId)`, `getLayers(outId)`; layer = `{id, canvas, opacity, blendMode, zIndex, region}`; stash = `window.__dcOutputLayers[outId]` |
| `src/output/outputManager.js` | Singleton `outputManager`. Detect displays; open/close/track output windows, multi-output keyed by `outId`. | `listDisplays({prompt})`, `openOutput({outId='main', display, fullscreen, layers \| canvas})`, `setLayers(outId, layers)` (live, no reopen), `closeOutput(outId)`, `closeAll()`, `isActive(outId)`, `getOutputs()`, `onChange(fn)` |
| `src/output/outputWindow.js` | Runs INSIDE `output.html`. No engine. Reads `?out=<id>`, builds one full-frame `<video>` per `getLayers(outId)` entry into `#out-stage`, **overlaid** & composited by zIndex/opacity/blend (no region — layers fill the frame), fullscreen button. | — |
| `src/output/outputUI.js` | Shared "Send to display" section for player + editor. | `initOutputUI({engine, root})`; mirrors `engine.canvas` as `outId='main'` (one full-region layer) |
| `src/output/composer.js` | Composites N source canvases → ONE offscreen canvas (the single-frame "composed program"; Step 0 of the native pipe, reused by NDI/Syphon). | `Composer({width,height})`, `setLayers([{id,canvas,zIndex,blendMode,getOpacity}])`, `start()`, `stop()`, `.canvas` |
| `output.html` | The output window: `#out-stage` (`isolation:isolate`) holding N `.out-layer` `<video>`s, fullscreen button, status. | Vite MPA entry |
| `index.html` / `src/controls.js` | Player Output popover (`O`) hosts the shared section. | `#output-panel` + `initOutputUI` |
| `editor.html` / `src/editor/main.js` | Editor topbar Output panel hosts the same section. | `#editor-output-panel` + `initOutputUI` |
| `timeline.html` / `src/timeline/timelineEditor.js` | Timeline `⊟ Outputs` modal + per-zone routing + stacking. Outputs keyed by display (`'disp:'+id`). | `#tl-btn-outputs`, `#tl-output-mgr`; `_openOutputMgr`/`_assignZoneOutput`/`_syncOutputs`/`_displayKey`/`_zoneOutputLive`/`_buildStackControls`/`_applyZoneStyle`/`_renderOutputRoutes`/`_updateOutputChips`/`_zoneOutTag`; `mkZone().output`; chip `.tl-zone-out-chip` |
| `src/timeline/style.css` | Timeline output modal + chip styles; `--zone-col-w` **must equal** JS `ZONE_COL_W` in `timelineEditor.js`. | — |

**How to run & verify (web — a single screen is enough to prove sync):** `npm run dev:safe` → open the player → press `O` → **↻ Detect** (grant the window-management prompt) → pick a display → **Open output window**. A popup mirrors the canvas in perfect sync. Timeline: open `/timeline.html` → **`⊟ Outputs`** → route a zone to a display. *Keep the operator window visible — a hidden/occluded window throttles its rAF and the mirror freezes (known limit, §5).* Output windows spawn at half-display size, centred + cascaded; fullscreen each with the ⛶ button.

**Where to start next:** the **📋 Phase Board at the top of the doc** is the tracker. (Short version: Phase B → B1, fullscreen-on-monitor.)

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

**What's missing — see the §0 status block for the ordered roadmap.** In brief: the **native pixel pipe** is the big gap (desktop can't mirror — `captureStream` is web-only), with **Phase B (local display)** next; plus player/editor persistence (`lastDisplayId`/`openFullscreen`, §8), A4 web polish (venue presets, mirror), and N1/N2 to finish + ship-enable NDI.

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

> **As built (through A3) vs. the shape above.** `setRoutes` landed as **`setLayers(outId, layers)`** (A3): one output window composites several sources as layered `<video>`s. Real signatures today: `openOutput({ outId='main', display, fullscreen, layers | canvas })`, `setLayers(outId, layers)` (live update, no reopen), `closeOutput(outId)`, `closeAll()`, `isActive(outId)`, `getOutputs() → [{id, displayId, active}]`, `onChange(fn)`, `listDisplays({ prompt })`. The pixel handoff lives in `outputPipe.js` (`setLayers`/`clearLayers`/`getLayers`, keyed by `outId`); a layer = `{id, canvas, opacity, blendMode, zIndex, region}`. **`outId` keying changed in A3:** `'main'` for player/editor (one full-region layer); **`'disp:'+displayId`** in the timeline (one window per physical display, NOT per zone — that's what lets many zones stack into one window).

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

> **Native pipe (Mac/Win) full design lives in [`native-output-dev.md`](native-output-dev.md)** — NDI-first, the frame compositor, JS→native transport options, and why video is *not* a taint blocker.

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

> **As built (through A3) vs. the mock above.** The modal is a **Displays** list (cards) + a **Routing** list with **one dropdown per zone** (Off / each display). When 2+ zones target the **same** display (a stack), each of those zone rows grows a second line with a **blend-mode dropdown + opacity slider** (`_buildStackControls`) — these write `zone.blendMode`/`zone.opacity`, the same fields `_positionCanvas` reads, so the operator screen and the mirrored output update together (one source of truth). No drag-onto-display yet; the zone-row chip (`▸`/`▸N`) still **opens the modal** (inline picker is a later refinement). On assign, the display's output window opens/updates immediately; "Off" removes that layer (and closes the window when its last zone leaves).

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
- **As built (A2.2 + A2.3):** the shape above is exactly what `_assignZoneOutput` writes. A `target` field is **not** implemented — only a display destination exists today. On load, `_resolveOutputRoutes()` re-resolves each saved `zone.output` by `displayLabel` (IDs aren't stable), updates `displayId`, and sets `_offline: true` if the display isn't found. Chip shows `▸!` + dashed border for offline; `↺ Restore N routes` button appears in the modal when restorable routes exist.
- **`target` discriminator arrives with NDI (Phase N1).** An NDI output has **no** `displayId`/window — it's a network stream name. So the model grows `output.target: 'display' | 'ndi'` (later `'syphon'`/`'spout'`); `display` routes keep `displayId`/`displayLabel`, `ndi` routes carry a `streamName`. The keying generalizes from `'disp:'+displayId` to a per-target output key. Everything above the pixel pipe (routing/stacking/compositing) is unaffected.
- **Stacking is emergent (A3):** two zones whose `output.displayId` match are stacked on that display, ordered by `zIndex`, composited by their existing `opacity`/`blendMode`. No new field — reuses `mkZone()`.
- **Display ID stability:** OS display IDs aren't stable across reboots/replug. Persist `displayLabel` too and re-resolve by label on load; if gone, show "output offline — reassign", never silently drop.
- **Migration:** absent `output` → `null` → today's behaviour. No migration pass.

---

## 9. Phased development plan — web → Mac → Windows

Web first (the pipe is free and you VJ there now); native after (the pipe is the hard part). Each phase ships standalone value.

> **Status & order = the 📋 Phase Board at the top of this doc** (the single tracker). The phase write-ups below are the *detail* per phase, not the running order. (As of 2026-05-23: web A1–A3 + composed program ✅, N0 NDI ✅, **Phase B → B1 next**.)

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

**A3 — Timeline stacking (many zones → one display)  ✅ BUILT & VERIFIED 2026-05-23 (commit pending)**
- [x] Output windows re-keyed **per display** (`'disp:'+id`), not per zone. Pixel pipe carries a **layer list** (`setLayers`/`getLayers`); the output window builds one **full-frame, overlaid** `<video>` per layer into `#out-stage` (`isolation:isolate`), composited by `zIndex`/`opacity`/`blendMode`. **Layers overlay, they do NOT tile by region** (corrected 2026-05-23 after a Left/Right test tiled side-by-side instead of stacking) — region stays on the zone for the operator screen only. `timelineEditor._syncOutputs()` groups routed zones by display and opens/live-updates/closes one window each.
- [x] Per-stacked-zone **blend-mode dropdown + opacity slider** in the Outputs modal (`_buildStackControls`), writing `zone.blendMode`/`zone.opacity` — one source of truth with the operator screen (`_positionCanvas` now also applies `opacity`).
- [x] **Layers follow the timeline (2026-05-23).** Window lifecycle = routing; layer *visibility* = playback. Each output layer's opacity = `zone.opacity × (1 − operatorCoverOpacity)`, so when a track's clip ends and the operator covers it with black, the output layer fades out instead — **revealing the layer beneath** (the layer-stack model). The cover's fade duration rides along as `transitionMs` (pipe → `<video>` CSS transition) so the reveal crossfades. Hooked in `_fadeZoneCover` (the single chokepoint for every play/gap/scrub/stop cover change) → debounced `_scheduleOutputSync` → `_syncOutputs`. **Root cause of the original "frozen ended preset" bug:** the operator's black gap is a DOM `<div>` cover over the canvas; `captureStream` only grabs canvas pixels, so the output never saw the gap. Now visibility is mirrored from the cover. (Consequence: when stopped/at a gap the output is black, matching the operator.)
- **No new data fields** — stacking is emergent (zones sharing `output.displayId`), reuses `mkZone()`. **No dependency on Phase 4.9 Zone Stack** — reuses CSS layer compositing, not a re-hosted compositor.
- [x] **Verified 2026-05-23** — two presets stacked on one window: top shows over bottom; top clip ends → top fades out and exposes the bottom layer; no drift. ✅ A3 complete (commit pending).
- **Exit:** two/three presets stacked on one projector, layered & following the timeline, no drift. ✅

**A4 — Web polish & venue presets**
- [x] **Composed program** (2026-05-23): all zones composited into one layered feed (`src/output/composer.js`) shown in a single output window — the "▦ Composed program" toggle in the timeline `⊟ Outputs` modal. This is also Step 0 of the native pipe (the single-frame compositor NDI/Syphon reuse — see [`native-output-dev.md`](native-output-dev.md) §7). *(The old "→ virtual camera" idea is dropped: the web virtual camera is a dead sink — no system consumer without the OBS driver.)*
- [ ] **Output presets** (Resolume-style): save/name a whole display→route map per venue; one-click switch.
- [ ] Mirror (one source → multiple displays).
- [ ] Hot-unplug recovery; perf pass (several 1080p60 mirrors with main UI still 60fps); clean teardown.
- **Exit:** production-ready multi-screen on web.

> **Order = the 📋 Phase Board at the top.** The Phase N/B/C write-ups below + [`native-output-dev.md`](native-output-dev.md) are the *technical detail* (compositor / transport / sender, transport math, video-taint + A/V-sync resolutions) — not the running order.

### Phase N — NDI (cross-platform)  ·  N0 ✅ DONE (proof) · N1/N2 remain (see §0 order)
NDI = "one cable to everything on the LAN": a single sender feeds OBS, streaming software, Resolume, other machines, and NDI hardware at once. Native-only (browsers/webviews can't emit NDI) and one implementation covers both desktops. *(N0 proof is complete; the live build detail is in [`native-output-dev.md`](native-output-dev.md). Per the §0 order, Phase B comes before N1/N2.)*

> **Architectural finding (2026-05-23) — NDI needs a real frame compositor.** This is the one place NDI is *not* a drop-in behind the existing pipe, so don't underestimate it. Today layer compositing happens **in the output window**, free, via the browser's CSS compositor (N `<video>`s with zIndex/opacity/blend). **NDI sends ONE video stream**, so the N source canvases must be composited into a **single frame first** — an offscreen canvas/WebGL compositor applying the same zIndex/opacity/blend recipe — then read back and handed to the NDI sender. The good news: this same composited-single-frame is exactly what the **"composed view → virtual camera"** (A4) and a **single-texture Syphon/Spout** output also need, so build the compositor once and it serves all "single composed stream" outputs. Net: there are two output *styles* — (1) multi-layer **display** (local window: CSS-composite, as built); (2) single composed **stream** (NDI / virtual-cam / Syphon-single: canvas-composite then send). The pipe abstraction must cover both.

- [ ] **N0 — Spike:** (a) build the offscreen frame compositor (stack the routed source canvases into one canvas with opacity/blend); (b) stand up an NDI sender from Rust (Tauri sidecar/command), push that composited frame (readback → NDI frames), receive it in OBS / NDI Studio Monitor; measure latency/fps/CPU at 1080p; settle NDI SDK/runtime bundling + licensing. No production wiring yet.
- [x] **N1 — named NDI source + persistence** — ✅ **VERIFIED in tauri-dev 2026-05-23** (custom name shows in OBS; name + on/off survive relaunch). `ndi_start(name)` (Rust) names the NDI source; an NDI **name input** sits by the 📡 button in the Outputs modal (Tauri-only, in `#tl-output-ndi-row`); changing it while live re-announces under the new name. Persisted to `localStorage` `discocast_ndi = {name, enabled}` (app-level — deliberately NOT the timeline export schema, which is the high-risk save path); on timeline load, the name restores and NDI **auto-starts if it was enabled**. JS refactored to `_startNdi`/`_stopNdi`/`_toggleNdi` + `_ndiName`/`_loadNdiPrefs`/`_saveNdiPrefs`. **Deferred:** the `output.target` (`display|ndi`) model refactor — not needed while NDI = the single composed-program output (revisit if NDI ever becomes a per-zone route).
- [ ] **N2:** stable NDI sender behind the pipe contract; per-output NDI streams (each routed group / a composed view as its own NDI source); clean start/stop; perf pass.
- **Exit:** the desktop app publishes its visuals as NDI; OBS (and any NDI receiver) shows them in sync.

### Phase B — Mac desktop local display (projector/monitor)  ◀ next
Two approaches (decided 2026-05-23: do **A first**; B when the projector arrives ~end of week and we can test monitor + projector as 2 outputs):

**Approach A — one projector shows the whole show** (no separate control screen). Lowest latency — the app renders directly on the projector; **no pixel pipe needed.**
- [x] **B1 — fullscreen the app on a chosen monitor** — ✅ **VERIFIED in tauri-dev 2026-05-23** (app went fullscreen on the chosen display). Rust commands `list_monitors()` + `fullscreen_on_monitor(x,y)` (Rust uses `available_monitors()`/`set_position`→`set_fullscreen`, #6394 — done in Rust so no JS `window` allowlist change needed). Timeline `⊟ Outputs` modal gets a **"Desktop — fullscreen this app on a display"** section (`#tl-output-desktop-fs`, shown only under `window.__TAURI__`): one card per monitor with a **⛶ Fullscreen here** button. **macOS reports a numeric monitor id, not a marketing name** → cards are labelled `Display N · WxH · this one` so the projector is pickable. Operator uses auto-hiding controls on the projector; Esc/F exits. *(macOS native fullscreen + reposition can race when switching while ALREADY fullscreen — add a delay in `fullscreen_on_monitor` if it bites; not seen with one display.)*

**Approach B — laptop control + a separate clean output** (the 2-output / pro setup). Needs the pixel pipe (the sealed-webview wall, §5).
- [ ] **B2 — spike Syphon (GPU texture share) vs pixel-readback→IPC→second window;** measure latency; pick one. Then build it behind the **same** `outputManager`/`outputPipe` interface, reusing all shared UI/routing/compositing + the composer. *(Needs the 2nd display.)*
- [ ] **B3 — placement polish:** wake-lock on the output (`caffeinate`), clean teardown, multi-output.

> **📅 Projector-day checklist (B2 — when the 2nd display/projector is connected, ~end of week 2026-05):**
> 1. Plug in the projector; in `tauri-dev` open `⊟ Outputs` → confirm **two** monitor cards appear (Display 1 · *this one* + Display 2). Verify **⛶ Fullscreen here** lands on each correctly (this also confirms B1 multi-display). Watch for the macOS fullscreen-reposition race when switching *while already fullscreen* → add the delay in `fullscreen_on_monitor` if it bites.
> 2. **Decide the B2 mechanism with a quick measurement, not a guess:** the readback path is already proven (it's how NDI works) — fastest to stand up: composer canvas → readback → Tauri event → a second `WebviewWindow` (output.html) draws it; place that window fullscreen on the projector. Measure its latency on the projector. If it's tight enough for the room, ship it; if not, escalate to **Syphon** (GPU-direct, lower latency, bigger build).
> 3. Reuse everything above the pipe: the **composer** is the single source; the second window just displays it (no re-render — §13).
> 4. Test the real gig flow: operator drives the timeline on the laptop while the projector shows the composed program in sync.

- **Exit:** the Mac app drives a directly-attached projector/monitor in sync — Approach A now, Approach B when the projector lands.

### Phase C — WINDOWS local pipe (Spout) + window placement
- [ ] **C1:** Spout (or the readback path proven in B0) behind the same interface.
- [ ] **C2:** Windows window-placement quirks (#7139 cross-monitor `set_position`); Win32 fallback only if it bites.
- **Exit:** the Windows app reaches parity with Mac.

### Future (not scheduled) — §11
Projection warp / edge-blend; slices/sub-regions; per-output colour calibration.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| ~~Butterchurn can't take injected audio~~ — *moot; we don't inject audio anymore* | The mirror needs no audio. |
| Web mirror upscale softness (display > canvas) | Acceptable for organic visuals; raise source canvas resolution if a venue needs it. |
| Occluded operator window freezes the mirror | Documented limit (§5); operator screen is always visible during a show. |
| **Native pixel pipe is unsolved** AND beta-critical (shipping product is desktop) | Spike-first per phase (N0/B0) before any production native code; NDI leads (cross-platform, widest reach). Candidates: NDI, Syphon/Spout, pixel-readback. |
| Web build not released → no end-user multi-output until native lands | Accepted: web is the dev/proving ground (decision #3, piracy). Keep the pipe seam clean so native swaps in fast; don't let web-only assumptions leak above `outputPipe.js`. |
| Cross-window perf (many mirrors at 60fps) | `captureStream` layers are GPU-cheap (no codec); FPS budget in A4; HUD exists (`` ` `` key). |
| Display IDs unstable across sessions | Persist + re-resolve by label; "offline — reassign", never silent drop. |
| Tauri v1.5 multi-window rough edges (#6394/#7139) | Documented workaround; scope a v2 migration **separately**. |
| Scope creep into Resolume territory (warp/slices) | Explicitly out (§7.3); modal stays a router, not a mapper. |

---

## 11. Native pipe candidates & far-future protocols

These ARE the native pixel pipe (the shipping product is desktop — decision #3), not "deferred forever." NDI leads (cross-platform, widest reach). **Full design + plan: [`native-output-dev.md`](native-output-dev.md).** Older API reference tables in [`visualizer-output-dev.md`](visualizer-output-dev.md).

| Tech | Platform | Role | Phase |
|---|---|---|---|
| **NDI** | macOS + Windows (one impl) | Network output → OBS / streaming / Resolume / other machines / hardware. Widest gap-coverage; native-only. **Lead native pipe.** | **N0 spike → N1/N2** |
| **Syphon** | macOS | GPU texture share → native output surface for a directly-attached display. | B0 spike |
| **Spout** | Windows | Syphon's Windows twin. | C |
| **Pixel readback over IPC/shared-mem** | all native | Simple, web-ish; heavy at high res/fps. Fallback for both NDI feed and local window. | N0 / B0 spike |
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

*Last updated: 2026-06-09 — added the **🔌 Projector field setup (Vankyo X3)** section (wireless ruled out; wired-via-USB‑C-adapter is the path; canvas-only = shipped A1). Prior: 2026-05-23 — Web A1–A3 + composed program + **N0 NDI proof** all committed (composed program live in OBS + NDI Monitor via the Rust-relay ndi-send sidecar). Pixel mirror, not re-render (§13). **Single source of truth for status & steps = the 📋 Phase Board at the top** (next = Phase B → B1, fullscreen-on-monitor). [`native-output-dev.md`](native-output-dev.md) is native reference detail only.*
