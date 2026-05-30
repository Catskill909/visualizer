# DiscoCast Visualizer 🎨

A modern browser-based MilkDrop music visualizer powered by [Butterchurn](https://github.com/jberg/butterchurn) (WebGL). Built with vanilla HTML/CSS/JS and bundled via Vite. Previously known as MilkScreen.

## Features

### Visualizer & Presets

- **1,144 bundled MilkDrop presets** — official Butterchurn packs (Base, Extra, Extra2, MD1) + the community-curated Baron pack, all statically bundled (no network calls)
- **Preset browser** — searchable drawer over the full library with favorites/tabs, heart + hide icons per row, and instant left-anchored tooltips
- **Favorites-only cycling** — restrict auto-cycle to your hearted presets for curated sets
- **Hide unwanted presets** — eye-slash icon or `X` shortcut removes a preset from the All tab, random, and auto-cycle; the hidden list persists in localStorage and survives reloads. A *Show hidden* toggle exposes them for unhiding (individually or via a modal-confirmed "Unhide all"). Hide beats favorite in cycle — a hidden preset never auto-plays, but the Favorites tab still shows it so nothing is lost

### Audio Engine

- **Advanced Audio Performance Suite** — real-time control over visual intensity via a glassmorphic popover
- **Auto-Gain Control (AGC)** — dynamic normalization for consistent visual "hype" regardless of input volume (ON by default)
- **Kick-Lock Mode** — isolated frequency analysis (low-pass 150 Hz) locks visuals exclusively to the kick drum and bassline
- **Spectral Flux onset detection** — a 5th analysis signal alongside Bass / Mid / Treble / Volume that measures how fast the spectrum *changes* rather than its loudness, so it fires once on transients (snares, claps, stabs) and drops instantly; available in every reactivity Source dropdown for clean one-shot beat snaps
- **Live Performance "Hype" Keys** — instant keyboard triggers for strobe, blackout, and color inversion
- **Dual audio input** — live audio capture or local file playback (MP3, WAV, FLAC)
- **Live device selection** — on every launch, a custom picker modal enumerates all audio inputs and forces an explicit choice (bypassing the browser's tendency to silently reuse the last-granted device); native support for USB DJ controllers, external sound cards, and specific microphones; single-device setups skip the picker automatically

### Display & Output

- **Auto-hiding controls** — the glassmorphic control bar fades after 3 seconds of inactivity, but stays visible while hovered or while a popover is open; click outside a popover to dismiss it
- **Material-style switches** — all cycle and tuning toggles use clean sliding switch components
- **Fullscreen & Zen Mode** — native browser fullscreen plus a zero-UI "Zen Mode" (`H` key) for clean projection
- **Projector Optimized** — automatic Screen Wake Lock prevents sleep (macOS app uses a `caffeinate` fallback since WKWebView drops Wake Lock); the mouse cursor auto-hides with the UI
- **Output Settings** (`O` key or monitor icon) — lock render resolution (HD / Full HD / QHD / 4K / Custom), constrain aspect ratio (16:9, 4:3, 21:9, 1:1, 9:16 portrait), and choose fill mode (Letterbox / Stretch / Crop); settings persist across reloads
- **Virtual Camera** — stream the canvas as a system webcam source; pick it in OBS, Zoom, or any capture app with no extra driver install
- **Multi-display output** *(in active development)* — push the live visualizer to a second monitor or projector as a **pixel-perfect mirror**. In the player & editor, `O` → **Send to display** opens a synced output window; in the Timeline, the `⊟ Outputs` modal routes each zone to a display, and **multiple zones routed to one display stack as overlaid layers** (per-layer blend + opacity) that follow the timeline — when a clip ends, its layer reveals the one beneath. Built as a copy-the-pixels mirror (`canvas.captureStream()` → `<video>` layers), so output is frame-identical to what you see — no drift, no second engine, no audio path. The desktop app (macOS/Windows) is the shipping target, with a native output pipe (**NDI**, then Syphon/Spout) as the next track. See [`output-dev.md`](output-dev.md) and [`native-output-dev.md`](native-output-dev.md)
- **Responsive design** — works on desktop and mobile viewports

### Preset Studio (`E` or `/editor.html`)

A standalone visual preset builder. Four tabbed sections (Palette / Motion / Wave / Images), undo/redo (50-deep), A/B comparison, double-click any slider label to reset it, and an icon footer (**New** / **Random** / **Remix** / **Save** / **Reset**) — where **Random** loads any of the 1,144 bundled presets as an editing base, turning the Studio into 1,144 starting points. Saves to localStorage; dev performance HUD on the `` ` `` key.

- **Palette & Color** — 12 one-click triad palettes (Wave / Glow / Accent) with hover-to-preview, per-channel lock, and a "+ Save current mix" button that pins the active triplet as a 13th "My Mix" chip; 3 independently overridable color swatches; **Opacity** (fades the MilkDrop background to black while layers render on top at full brightness); a **Show layers only + Transparent background** pair that makes the whole canvas truly transparent so layers float on nothing (the foundation for stacking presets in the Timeline); Glow/Accent Strength, Brightness, Trail, Saturation, Hue Rotate, Fade Wave in Silence, Outer/Inner Border sliders, and Brighten / Solarize / Darken / Darken Center / Invert toggles
- **Motion & Wave** — six one-click Motion Presets (Vortex / Calm Drift / Earthquake / Tunnel In / Spin Lock / Hyperspace); a forked wave engine with a variable **Thickness slider (0–8)** and **Rotation slider (±180°)** that affect all 8 shape modes; a Shape Reset that hides the wave until you actively pick a shape
- **Deep audio reactivity** — the heart of the app. Every layer has an **AUDIO REACTIVITY** block where you pick a **Source** (Bass / Mid / Treble / Volume / **Flux**) and a response **Curve** (Linear / Squared / Cubed / Gate), then drive a stack of beat effects from it: **Pulse** (size), **Bounce** (beat hop), **Beat Shake** (impulse jitter), **Opacity Pulse**, **Strobe** (hard binary cut), **Popcorn** (per-cell audio pulse so individual tiles dance on different beat phases), plus the beat-driven **Tilt / Hop / Hue Pulse / Blur Pulse / Squash** sliders. Two parallel reactivity systems sit alongside the layers: **Motion Reactivity** (audio drives the whole scene's warp/motion) and **Wave Reactivity** (audio drives wave Size / Opacity / Shape / Orbit) — and each Wave control carries **its own per-slider Source pill**, so e.g. bass can drive wave size while treble morphs the shape
- **Layer Animation** — open the Animate modal (`✦` on any layer card) to give a layer an **Entrance**, **Exit**, and **Idle** animation. Nine entrance/exit poses (fade, scale up/down, slide L/R/U/D, pop, blur), GSAP easing with a **live SVG bezier preview** that draws the real ease curve (elastic/bounce overshoots and all), a visual duration scrubber, and per-pose tunable params (Distance / Start size / Pop from / Start blur). **Idle** loops (Sway / Spin / Drift / Float / Pulse / Breathe) keep the layer alive while it's shown. Per-layer **Enter at / Exit at** times (0:00–3:00) schedule *when* each layer appears and leaves — a mini-timeline inside a single preset. Animations **play live in the player and Timeline**, not just the editor
- **Image / Video / GIF / Text layers** — up to 5 layers in a collapsible accordion stack with drag-to-reorder and per-layer solo / mute / rename / thumbnail:
  - *Video* — drag MP4/WebM (auto-transcodes 1080p/4K to 720p on upload), full playback controls (play/pause, loop, 0.25×–4× speed, scrub), independent Width/Height scaling, and a feathered Border ring
  - *GIF* — perceptual speed control (0.25×–8× log curve), Alpha Mode (Fade / Preserve silhouette), timing Stability, plus a **GIF Optimizer** modal with intent presets and live cadence preview
  - *Text* — live text with fonts, sizing, shadows, outlines, and full transforms
  - *Shape Overlay* — per-layer full-screen colored shape (rectangle/circle/rounded) for masking, vignettes, or compositing
- **Transform & motion** (per layer) — Size, Angle, **Skew X/Y** (2D shear), **Perspective X/Y** (projective warp), independent Tile Width/Height, and **Aspect mode (Lock / Fluid)**; motion paths include **Spin**, **Orbit** (Circle or **Lissajous** figure-8/clover), **Sway**, **Wander**, **Pan** (Drift / Bounce), and **Tunnel + Depth** (seamless zoom-through with per-layer parallax)
- **Tiling & Grids** — aspect-correct density tiling for any image shape; an explicit **Grid mode** (Cols×Rows with Fit/Fill + Scale); **recursive grids** (Subdivide + Outer Gap); a **per-cell suite** — Offset (brick/half-drop), Cell Rotate (Truchet mosaics), Size/Jitter/Opacity Var with scatter sampling (jittered tiles break free of the grid and overlap), and Seed + Lock. Works on videos too
- **VJ effects, color grading & mirrors** — per-layer Chromatic Aberration, Hue Spin, **Saturation** + **Hue Rotate**, Luma Key, Wave Distort, Invert, Solarize, Threshold, Posterize, Edge/Sobel, Pixelate, Scan Lines, and Film Grain; a full **color-grading suite** on every layer type (Brightness, Contrast, Gamma, Fade, Temperature, Sepia, Shadows, Highlights, Lift, Gain, Tint M/G); and **Mirror** modes (H / V / Quad / Kaleidoscope with a spin-speed control), scoped Per-Tile or Whole-Image, plus a scene-level Canvas Mirror

### Timeline Editor (`L` or `/timeline.html`)

A self-contained full-screen show sequencer: the canvas fills the screen with always-visible glassmorphic controls, and a fullscreen button (top-right or `F`) enters true fullscreen — `F`, the button again, or `Escape` restores the controls.

- **Arrange & edit live** — lay presets on a proportional-width multi-track strip and set block lengths by dragging their edges (the strip auto-scrolls so a block stretches to any length in one motion); drag, resize, edit settings, duplicate, or delete **while playing** with no flash or stutter; supports drag-to-reorder, snap-to-grid, waveform overlay, and BPM grid
- **Transport & cueing** — a standard 3-button transport (go-to-start, play/stop, skip-to-next-block) with `Home` and `→` shortcuts; double-click any block to crossfade into it and seek the playhead to its start
- **Transitions & block menu** — a hamburger icon on each block opens a compact action menu: a Transition picker (Fade / Black / White / Cut — how the block enters), a 16-colour picker, plus Duplicate and Delete
- **Multi-track stacking** — go beyond the fixed zone layouts: **+ Add Track** stacks layers (up to 4) that composite top-row-as-front, where an empty upper track stays transparent and reveals the track beneath. In multi-region layouts (Left/Right, quadrants, etc.) each region gets its own inline **+ Track** button and stacks independently
- **Zone Compositor** — assign each entry to a named screen region (quadrant, banner, center square, custom rectangle) so multiple presets render simultaneously, each with independent opacity, blend mode (screen/overlay/multiply/add), and gap behavior; **a transparent-background preset placed on a zone composites over the zone beneath it** (true per-pixel alpha reveal — stack a rotoscoped subject or logo over a full-screen MilkDrop zone)
- **Markers & loop regions** — markers live in a dedicated lane below the ruler; press `M` or click the lane to drop one, then click a flag to edit it (label, colour, action). Set a marker's action to **Loop** and it becomes a draggable loop region with handles; playback wraps the region with a 1-second crossfade
- **Export / Import** — **Export** saves a `.dcshow.json` bundle embedding every referenced custom preset (image layers as base64) for full portability; **Import** restores the timeline and all custom presets, remapping IDs automatically and showing a detailed per-preset result modal

## Tech Stack

| Layer       | Technology                        |
|-------------|-----------------------------------|
| Visualizer  | Butterchurn (MilkDrop WebGL port) |
| Build       | Vite 8                            |
| Language    | Vanilla JS (ES Modules)           |
| Styling     | Vanilla CSS (custom properties)   |
| Audio       | Web Audio API                     |
| Rendering   | WebGL 2 via `<canvas>`            |

## Project Structure

```
discocast-visualizer/
├── index.html              # Main app — canvas, start screen, control bar, preset drawer
│                           #   ↳ help-modal (line ~1315) = User Guide from the start screen "User Guide" button
├── editor.html             # Preset Studio — standalone visual builder (/editor.html)
│                           #   ↳ help-modal (line ~62) = Preset Studio in-app User Guide
├── help.html               # Full standalone help page (/help.html) — searchable deep-dive
├── timeline.html           # Timeline Editor — full-screen show sequencer (/timeline.html)
├── vite.config.js          # Vite MPA config — 5 Rollup entries (main, editor, timeline, promo, help)
├── package.json
├── build-and-sign.sh       # One-command macOS build script
├── macos-app-generate.md   # macOS app packaging guide
├── public/
│   ├── favicon.svg         # Brand favicon (gradient concentric circles)
│   └── logo.png            # App icon source (used for macOS app icons)
├── src-tauri/              # macOS app packaging (Tauri)
│   ├── Cargo.toml          # Rust app config
│   ├── tauri.conf.json     # Tauri build config (signing, entitlements)
│   ├── entitlements.plist  # macOS permissions (audio input)
│   └── icons/              # Generated app icons (from logo.png)
└── src/
    ├── main.js             # Main app entry — wires VisualizerEngine + ControlPanel
    ├── visualizer.js       # VisualizerEngine class — butterchurn wrapper, audio routing
    ├── controls.js         # ControlPanel class — UI bindings, keyboard, auto-hide
    ├── style.css           # Main app design system — dark theme, glassmorphism
    ├── auth-gate.js        # Password gate overlay — soft auth via VITE_APP_PASSWORD env var
    ├── customPresets.js    # Custom preset CRUD — localStorage + IndexedDB image storage
    ├── fileUtils.js        # downloadFile helper — browser <a download> or Tauri native Save As
    ├── importResultModal.js # Import result modal — shows per-preset success/failure after import
    ├── presetRegistry.js   # Merge layer — bundled + custom presets under one API
    ├── timelineStorage.js  # Timeline CRUD — localStorage (no blobs; stores preset name refs)
    ├── timeline/
    │   ├── main.js         # Timeline Editor entry point — audio source boot
    │   ├── timelineEditor.js # Core editor class — strip rendering, drag, playback wiring
    │   └── style.css       # Timeline editor design system
    ├── videoTranscoder.js # Video auto-transcoding — FFmpeg.wasm 720p downscale for oversized uploads
    └── editor/
        ├── main.js         # Preset Studio entry point — audio source boot
        ├── inspector.js    # EditorInspector class — tabs, palettes, controls, undo/redo
        ├── presetLibrary.js # PresetLibrary class — Library panel, CRUD, import/export UI
        ├── gifOptimizer.js # GIF Optimizer — upload-time frame reduction + resize tool
        └── style.css       # Preset Studio design system — museum dark, tab layout
```

## Architecture

### Audio Signal Flow

```
                    ┌──────────────────┐
  Mic / File ──────►│  Audio Source     │
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │                  │
              ┌─────▼─────┐    ┌──────▼──────┐
              │ Volume     │    │ Visualizer  │
              │ Gain Node  │    │ Gain Node   │
              │ (speaker)  │    │ (5× boost)  │
              └─────┬──────┘    └──────┬──────┘
                    │                  │
              ┌─────▼──────┐    ┌──────▼──────┐
              │ Speakers   │    │ Butterchurn │
              │ (destination)│   │ (WebGL)     │
              └────────────┘    └─────────────┘
```

- **Mic mode**: Audio goes only to the visualizer (no speaker output to avoid feedback)
- **File mode**: Audio is split — one path to speakers (with volume control), one path to the visualizer (with 5× sensitivity gain)

### Key Classes

#### `VisualizerEngine` (`src/visualizer.js`)

Core engine wrapping Butterchurn. Manages audio context, source connections, preset loading, render loop, and auto-cycling.

| Method | Description |
|--------|-------------|
| `init(canvas)` | Initialize WebGL visualizer on a canvas element |
| `connectMicrophone(deviceId)` | Connect browser mic or specific USB/audio device as source |
| `connectAudioFile(file)` | Connect a File object as audio source |
| `disconnectSource()` | Stop and clean up current audio source |
| `loadPreset(name, blendTime)` | Load a preset by name with blend transition |
| `nextPreset()` / `prevPreset()` | Navigate presets sequentially (always over the full library) |
| `randomPreset()` | Jump to a random preset (always over the full library) |
| `cycleNext()` / `cycleRandom()` | Advance within the current cycle pool — respects favorites-only |
| `setFavoritePool(names)` | Provide the list of favorite preset names used by favorites-only cycling |
| `setFavoritesOnly(enabled)` | Restrict auto-cycle to favorites when true (falls back to full library if empty) |
| `getPresetNames()` | Returns sorted array of all preset names |
| `getCurrentPresetName()` | Returns the active preset name |
| `setSize(w, h)` | Resize the visualizer canvas |
| `setVolume(value)` | Set speaker volume (0–1) |
| `setEnergy(value)` | Set manual energy multiplier (0.2–5.0) |
| `toggleAGC()` | Toggle dynamic Auto-Gain Control |
| `toggleKickLock()` | Toggle bass-frequency isolation filter |
| `setBoost(active)` | Momentary 2× intensity override (bound to `Shift`) |
| `destroy()` | Full cleanup — stops render, audio, timers |
| `startTimeline(id, startIndex?)` | Play a saved timeline; optionally start from a given entry index |
| `stopTimeline()` | Stop active timeline and resume auto-cycle |
| `timelineNext()` | Skip to next entry in the active timeline |
| `timelinePrev()` | Go back to previous entry in the active timeline |
| `getTimelineState()` | Returns active timeline playback state, or `null` if no timeline is playing |

#### `ControlPanel` (`src/controls.js`)

UI controller binding all DOM events, keyboard shortcuts, auto-hide behavior, preset drawer, and audio player controls.

#### `EditorInspector` (`src/editor/inspector.js`)

Full panel controller for Preset Studio. Manages 4 tabbed sections (Palette / Motion / Wave / Images), palette chips, color swatches, undo/redo stack, A/B comparison, and save-to-localStorage.

| Method | Description |
|--------|-------------|
| `undo()` / `redo()` | Step through 50-deep history stack (called from keyboard handler in `editor/main.js`) |

Palette system maps 12 named moods (Mono, Neon, Electric, Fire, Violet, Ocean, Sunset, Ice, Gold, Rose, Acid, Plasma) to Wave + Glow + Accent `baseVals` triads. Three swatches (Wave → `wave_r/g/b`, Glow → `ob_r/g/b`, Accent → `ib_r/g/b`) are independently overridable after applying a palette. Saturation (`studio_saturation`) and Hue Rotate (`studio_hue_rotate`) are baked as GLSL literals into the comp shader post-FX block at compile time — zero cost at default values.

#### `customPresets.js` (`src/customPresets.js`)

Single source of truth for custom preset CRUD.

| Export | Description |
|--------|-------------|
| `createCustomPreset(name, state)` | Save a new custom preset to localStorage |
| `saveCustomPreset(id, state)` | Update an existing preset |
| `getCustomPreset(id)` | Load one preset by id |
| `deleteCustomPreset(id)` | Remove from storage |
| `loadAllCustomPresets()` | Return all saved custom presets |
| `storeImage(blob)` | Persist image blob to IndexedDB, return imageId |
| `getImage(imageId)` | Retrieve image blob by id |
| `exportPreset(id)` | Serialize preset + inlined images as base64 data-URLs to JSON |
| `exportAllPresets()` | Bulk export all custom presets as a single JSON bundle |
| `importPreset(json)` | Validate, re-hydrate images to IndexedDB, write metadata to localStorage |
| `importFromFile(json)` | Batch import (single preset, array, or bulk bundle); returns `{ imported, names, failed }` |

Storage schema: `{ id, name, schemaVersion: 1, baseVals, shapes, waves, warp, comp, init_eqs, frame_eqs, pixel_eqs, images, parentPresetName?, createdAt, updatedAt }`. Registry key format: `custom:<id>:<name>` prevents collision with bundled names.

#### `presetRegistry.js` (`src/presetRegistry.js`)

Merge layer exposing bundled + custom presets under one API.

| Method | Description |
|--------|-------------|
| `getAllNames()` | All preset names — bundled + custom |
| `getByName(name)` | Resolve preset object (custom or bundled) by name |
| `getBundledNames()` | Bundled-only names |
| `getCustomPresets()` | Custom-only preset map |
| `isCustom(name)` | Whether a name is a custom preset |
| `displayName(name)` | Strip `custom:<id>:` prefix for display |
| `refresh()` | Re-read localStorage after an external write |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause (file) or Next Preset (mic) |
| `V` | **Strobe** (White Flash) |
| `B` | **Blackout** (Cut to Black) |
| `I` | **Invert Colors** |
| `H` | **Hide UI** instantly |
| `O` | **Output Settings** (resolution lock, aspect ratio, virtual camera) |
| `Shift` | **Hold for MAX Boost** |
| `A` | Toggle Auto-Gain (AGC) |
| `K` | Toggle Kick-Lock |
| `T` | Open Audio Tuning Panel |
| `L` | Open Timeline Editor (`/timeline.html`) |
| `→` | Next preset |
| `←` | Previous preset |
| `R` | Random preset toggle |
| `P` | Toggle preset drawer |
| `E` | Open Preset Studio |
| `S` | Toggle favorite on current preset |
| `X` | Hide current preset (auto-advances to next visible) |
| `F` | Toggle fullscreen |
| `Esc` | Close drawers / popovers / modals |

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (safe — kills zombie processes + clears stale cache first)
npm run dev:safe
# → http://localhost:5173/

# Start dev server (fast — only use when you know Vite was cleanly stopped last time)
npm run dev

# Production build
npm run build
# → Output in dist/
```

> **Always use `npm run dev:safe` to start a session.** It kills any lingering Vite processes
> and wipes the dep-optimization cache before starting. If you only use `npm run dev` and a
> previous session wasn't closed cleanly (terminal window closed instead of Ctrl+C), the next
> start will appear to hang or fail with a port conflict. `npm run dev:safe` always recovers.
>
> **Stop Vite cleanly:** always use **Ctrl+C** in the terminal before closing the window.

## macOS App

A standalone, signed, and notarized macOS app — fully working including mic and USB audio input.

### Install
1. Download `DiscoCast-Visualizer.dmg` from the [promo page](promo/index.html)
2. Drag **DiscoCast Visualizer** → **Applications**
3. Launch from Applications — no right-click needed (notarized)
4. First time using mic/USB: macOS will prompt for microphone permission — click **Allow**

### Build from Source

> ⚠️ **Always use `./build-and-sign.sh` — never run `npm run tauri-build` directly.**
> The script is the true build process. Running Tauri directly produces an unsigned, unnotarized DMG with no Applications folder shortcut that will be blocked by Gatekeeper.
>
> **Claude Code guardrail:** Run `./build-and-sign.sh` with no flags and NOT in background mode. Output must stream live. Never add `2>&1`. Never use `run_in_background`. If it appears to hang during notarization — it isn't; just wait.

```bash
./build-and-sign.sh
```

The script does everything in one pass:
1. Builds the Vite web app
2. Builds unsigned `.app` with Tauri (target: `app` only)
3. Injects `NSMicrophoneUsageDescription` into `Info.plist`
4. Signs with `Developer ID Application: Paul Henshaw (3UT7698LZ6)` + hardened runtime
5. Notarizes with Apple (`xcrun notarytool`) and staples the ticket
6. Verifies: `source=Notarized Developer ID`
7. Creates HFS+ drag-to-install DMG with branded dark background image and Applications folder shortcut
8. Signs and clears quarantine from the DMG
9. Copies versioned DMG to `promo/DiscoCast Visualizer-1.0.YYYYMMDD.HHMM.dmg`
10. Updates `promo/DiscoCast-Visualizer.dmg` (the canonical download link)

Requires: Apple Developer account (`3UT7698LZ6`), credentials in `.build-credentials` (gitignored), Rust/Cargo, Xcode tools.

### Releasing a Build

After `./build-and-sign.sh` completes, commit and push `promo/` to deploy:

```bash
git add promo/
git commit -m "build: release 1.0.YYYYMMDD.HHMM"
git push
```

Coolify picks up the push automatically — the promo page immediately serves the new DMG. Older versioned builds are retained in `promo/` for rollback: copy any older DMG over `promo/DiscoCast-Visualizer.dmg`, commit, and push.

See `macos-app-generate.md` for full packaging details and `app-output-dev.md` § 7 for the complete distribution workflow.

## Windows App

A standalone Windows app built via GitHub Actions on demand — produces a single NSIS `.exe` installer.

### Install
1. Download `DiscoCast-Visualizer-Windows-Setup.exe` from the [promo page](promo/index.html)
2. Double-click the `.exe` to install
3. Launch **DiscoCast Visualizer** from the Start menu
4. First time using mic/USB: Windows will prompt for microphone permission — click **Allow**

> Windows may show a SmartScreen warning ("Unknown publisher") on first launch. Click **More info → Run anyway**. This is expected for unsigned builds — the app is safe.

### Build from GitHub Actions

The Windows build runs on a GitHub-hosted Windows machine triggered manually — no Windows PC required.

1. Go to your repo on **GitHub.com → Actions → Build Windows Installer**
2. Click **Run workflow** → select branch `main` → **Run workflow**
3. Wait ~10–15 min (first run); ~5 min after Rust cache warms up
4. When complete, click the run → scroll to **Artifacts** → download `DiscoCast-Visualizer-Windows-Setup`
5. Unzip → run the `.exe`

Nothing runs automatically — the build only starts when you click the button.

> The workflow file lives at `.github/workflows/build-windows.yml`. It is manual-trigger only (`workflow_dispatch`) and touches no existing macOS or web build infrastructure. See [`windows-dev.md`](windows-dev.md) for full build details and bugs fixed during Windows bringup.

## Deployment (Coolify)

This app is optimized for ultra-lightweight deployment via **Coolify**. Two methods are supported:

### 1. Dockerfile + Nginx (Recommended)
The repository includes a multi-stage `Dockerfile` that builds the Vite app and serves it using `nginx:alpine` (along with a custom `nginx.conf`).
- **Resource Footprint:** Extremely small (< 5MB RAM idle, ~0% CPU).
- **Setup in Coolify:** Select **Docker** as your Build Pack. Coolify will automatically detect the Dockerfile.

### 2. Nixpacks + sirv-cli
If you prefer a Node.js-based static server, the project includes `sirv-cli` as a dependency and a configured `start` script.
- **Setup in Coolify:** Leave Build Pack as **Nixpacks**. Coolify will run `npm install`, `npm run build`, and `npm run start`.

### Password Gate

The app is protected by a single-password overlay shown on first visit. After the user enters the correct password, a `localStorage` marker unlocks them automatically on future visits.

**Configure in Coolify:**
1. Go to your app → **Environment Variables**.
2. Add `VITE_APP_PASSWORD` with your chosen password.
3. **Check the "Build Variable" / "Is Build Time" box** — Vite inlines the value at build time, so it must be available when `npm run build` runs, not just at runtime.
4. Redeploy.

**Local dev:** copy `.env.example` → `.env` and set `VITE_APP_PASSWORD=something`. Leaving it blank disables the gate.

**Security note:** Because this is a static SPA, the password is present in the built JS bundle and visible to anyone who inspects DevTools. Treat it as a soft gate to keep casual visitors out, not as real auth — there is no private content behind it to protect. For stronger protection, switch to nginx HTTP Basic Auth in [nginx.conf](nginx.conf) or put a real auth service (Authelia, Cloudflare Access) in front.

### Security Posture

The app ships with a hardened HTTP response baseline (see [nginx.conf](nginx.conf)):

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'` + allowlist for Google Fonts, `data:`/`blob:` for images/media | Blocks unexpected script execution and cross-origin loads |
| `X-Frame-Options` | `DENY` | Prevents clickjacking (the page can't be iframed) |
| `X-Content-Type-Options` | `nosniff` | Blocks MIME-sniffing on JS/CSS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak full URLs to outbound links |
| `Permissions-Policy` | `microphone=(self), camera=(), geolocation=()` | Scopes microphone to first-party only; blocks the rest |

**CSP allowlist** (if you add new origins, update `nginx.conf`):
- `script-src 'self'` — all JS is bundled; no inline scripts, no CDNs
- `style-src 'self' 'unsafe-inline' fonts.googleapis.com` — inline `style=""` attrs + Google Fonts CSS
- `font-src 'self' fonts.gstatic.com` — Google Fonts woff2
- `img-src 'self' data: blob:` — custom preset images (data URLs) and blob URLs
- `media-src 'self' blob:` — user-loaded audio files via `URL.createObjectURL`
- `frame-ancestors 'none'` — not embeddable

After changing `nginx.conf`, redeploy and check the browser Console for CSP violation messages. A single violation breaks whatever it touches silently.

**Out of scope / known soft spots:**
- **Password-in-bundle** — covered above. Not real auth by design.
- **HTTPS / HSTS** — terminated at the Coolify reverse proxy, not in this Dockerfile. Verify HTTPS redirect is enabled on the Coolify app.
- **Image layer injection (editor)** — `file.name` from user uploads is set via `textContent`/`title` (not `innerHTML`) so it can't XSS. Preset names in the import result modal are HTML-escaped by `importResultModal.js`.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `butterchurn` | ^2.6.7 | MilkDrop WebGL visualizer engine |
| `butterchurn-presets` | ^2.4.7 | 395 unique presets across Base/Extra/Extra2/MD1 sub-packs (bundled) |
| `butterchurn-presets-baron` | ^1.5.1 | 762 community-curated presets (bundled via `import.meta.glob`) |
| `@ffmpeg/ffmpeg` | ^0.12.10 | Video transcoding — auto-downscale 1080p/4K to 720p on upload (lazy-loaded ~25MB) |
| `@ffmpeg/util` | ^0.12.1 | FFmpeg helper utilities for file I/O |
| `gifuct-js` | ^2.1.2 | GIF frame parsing for animated GIF layers |
| `vite` | ^8.0.4 | Dev server and build tool |

> **Notes**:
> - `butterchurn-presets-weekly` is installed but **unused** — it only contains remote S3 URLs, not preset data.
> - The Baron pack ships each preset as a separate JSON file loaded via top-level `await import()`. We bypass that runtime loop with Vite's `import.meta.glob({ eager: true })` and collapse all 762 files into a single build-time chunk (see [vite.config.js](vite.config.js) `manualChunks` rule). Without this, startup would issue 762 sequential network requests.
> - Final merge yields **1,144 unique presets** (13 name overlaps between the official packs and Baron; later packs override).
> - FFmpeg.wasm is **lazy-loaded** — the ~25MB binary only downloads when a user uploads an oversized video (1080p/4K). Standard 720p uploads don't trigger the download.

## Integration Notes (DiscoCast Silent Disco)

The `VisualizerEngine` is designed for easy integration:

```js
import { VisualizerEngine } from './src/visualizer.js';

const engine = new VisualizerEngine();
engine.init(canvasElement);

// Connect any Web Audio API source node directly:
// yourSourceNode.connect(engine.visualizerGainNode);

// Or use the built-in helpers:
await engine.connectMicrophone();
// or
const audioEl = await engine.connectAudioFile(fileObject);
```

**Key integration points:**
- The `visualizerGainNode` is a standard Web Audio `GainNode` — any audio source can be connected to it
- The engine does not manage its own `<canvas>` element — pass any canvas from your app
- `setSize(w, h)` can be called on window resize or container resize
- `destroy()` performs full cleanup of audio context, render loop, and timers
- The `ControlPanel` is optional — you can use `VisualizerEngine` standalone and build your own UI

## Browser Requirements

- **WebGL 2** — required for Butterchurn rendering
- **Web Audio API** — required for audio analysis
- **getUserMedia** — required for microphone input
- Best experience in **Chrome** or **Firefox**

## Developer Workflow

### Editing Help / User Guide Content

There are **two help systems** — edit the right one:

| Button / entry point | File to edit | Location in file |
|---|---|---|
| "User Guide" on main app start screen | `index.html` | `id="help-modal"` ~line 1315 |
| Standalone `/help.html` page | `help.html` | Full page, nav-linked sections |

**There is no help modal in `editor.html`.** The Preset Studio has no in-app user guide.

### Dev Server Troubleshooting

If `npm run dev` fails, hangs, or gives a port conflict:

```bash
npm run dev:safe
```

This kills any zombie Vite processes, wipes the `.vite` dep cache, and starts fresh. Use it as
your default start command. `node_modules/.vite-temp/` left over from a crashed prior session
is the most common cause of startup failures — `dev:safe` removes it automatically.

---

## Developer Documentation Index

All planning, research, and implementation notes live as `.md` files in the repo. This index is the starting point.

### Hub Docs

These are the entry points. Each one references its focused subdocs in `docs/`.

| Doc | What it covers |
|-----|---------------|
| [`custom-preset-editor.md`](custom-preset-editor.md) | **Preset Studio hub.** Tabs, controls, image layers, undo/redo, save/load, GLSL shader builder, tunnel, canvas mirror, solid color base, import/export. MilkDrop settings audit, One Truth Goal, creative vision, performance research. Subdoc index at top. |
| [`timeline-editor.md`](timeline-editor.md) | Timeline Editor design and planning — zone compositor, export/import bundle format. |
| [`macos-app-generate.md`](macos-app-generate.md) | macOS app packaging guide — Tauri build, code signing, notarization, DMG creation. |
| [`windows-dev.md`](windows-dev.md) | Windows build & compatibility reference — GitHub Actions workflow, bringup bugs. |
| [`output-dev.md`](output-dev.md) | **Output & multi-monitor hub (truth doc) — START HERE.** The **§0 status block is the single source of truth** for where the output feature is and what's next. Pixel-mirror architecture (never a re-render, §13); Source/Output/Route model; one swappable per-platform pixel pipe. **Status: web A1–A3 + composed program ✅, N0 NDI proof ✅; next = Phase B (desktop local display). Shipping product = the desktop app.** |
| [`native-output-dev.md`](native-output-dev.md) | **Native output pipe — NDI / Syphon / Spout. REFERENCE DETAIL ONLY (no status — that lives in `output-dev.md` §0).** Open only when coding the native pipe: the NDI binding recipe, the frame compositor, JS→native transport options + throughput math, video-taint + A/V-sync resolutions. |
| [`app-output-dev.md`](app-output-dev.md) | Shipped single-canvas output settings — resolution lock, aspect ratio, virtual camera. (Multi-monitor planning now lives in `output-dev.md`.) |

### Preset Studio Subdocs ([`docs/preset-editor/`](docs/preset-editor/))

| Doc | Status | What it covers |
|-----|--------|---------------|
| [`docs/preset-editor/image-layer-effects.md`](docs/preset-editor/image-layer-effects.md) | ✅ Shipped | Per-layer transform / motion / visual effects / audio reactivity reference. GLSL pipeline order. Up-next backlog. |
| [`docs/preset-editor/library-panel.md`](docs/preset-editor/library-panel.md) | ✅ Shipped (§10 known bug) | Library panel design, dual-mode sidebar, thumbnails, save/load flow. §10 export-only-saves-images bug. §11 Solid FX audio reactivity. |
| [`docs/preset-editor/gif-playback.md`](docs/preset-editor/gif-playback.md) | ✅ Phase 4 shipped | GIF playback, optimizer, perceptual speed (0.25×–8× log curve), Alpha Mode (Fade / Preserve silhouette), timing Stability, GIF Optimizer intent presets + cadence preview. |
| [`docs/preset-editor/radius-slider.md`](docs/preset-editor/radius-slider.md) | ✅ Shipped May 3, 2026 | SDF rounded-corner radius slider for image layer tiles. |
| [`docs/preset-editor/future-effects.md`](docs/preset-editor/future-effects.md) | 📋 Future | Pipeline of new image-layer effects — Chromatic Aberration sets the quality bar. |
| [`docs/preset-editor/layer-header-redesign.md`](docs/preset-editor/layer-header-redesign.md) | 📋 Planning | Layer card header redesign options. |

### Other Feature Dev Docs

| Doc | Status | What it covers |
|-----|--------|---------------|
| [`tile-custom.md`](tile-custom.md) | ✅ Phases 1–4 shipped 2026-05-17 | Tiling enhancement plan — per-cell variance suite (Size/Jitter/Opacity Var + Seed), scatter sampling (neighbour-accumulation renderer — jittered tiles move freely + overlap), explicit Grid mode (Density/Grid toggle, Cols×Rows, Fit/Fill, Grid Scale), and recursive grids (Subdivide + Outer Gap). Tile feature set complete for v1. Phases 3.2/3.3 (tunnel↔scatter convergence) backlog; 3.5 cut. |
| [`video-tiling-dev.md`](video-tiling-dev.md) | ✅ Shipped 2026-05-24 | Video tiling — un-gates the full image-tile stack for video layers. Phase A: opaque + native-alpha transparent video (browser/web). Phase B: stacked-alpha transparent video (macOS encode) via a `sampleGrad` top/bottom recombine at every tiled sample site. Density + Grid + per-cell variance + tunnel + grouping all work; tile count is free (pure shader). |
| [`shape-overlay-dev.md`](shape-overlay-dev.md) | ✅ Built May 10, 2026 | Per-layer full-screen colored shape overlay — rectangle/circle/rounded, position, width/height, corner, color, opacity, feather. |
| [`storage-audit-dev.md`](storage-audit-dev.md) | ✅ All fixes shipped & deployed May 11, 2026 | Storage hardening — QuotaExceededError guard, export size warning, blob cleanup bugs fixed, Tauri native FS (eviction-proof blob storage for macOS + Windows). Deployed to web + macOS DMG. Cross-platform import/export verified (video presets web ↔ macOS). |
| [`noise-gate-dev.md`](noise-gate-dev.md) | ✅ Built | Noise gate for live/mic — silence threshold, AGC interaction, VU meter states. |
| [`live-input-dev.md`](live-input-dev.md) | ✅ Built | Live audio input dev notes. |
| [`docs/spectral-flux-dev.md`](docs/spectral-flux-dev.md) | ✅ Shipped 2026-05-15 | Spectral Flux audio source — DIY onset detection from existing AnalyserNode, q31 bridge to GLSL, all three source dropdowns. |
| [`midi-dev.md`](midi-dev.md) | 📋 Planning | MIDI controller integration — action registry, MIDI learn UX, phased plan. |
| [`add-track-dev.md`](add-track-dev.md) | ✅ Phase A + B shipped 2026-05-26 | Timeline multi-track. Phase A: Full Screen add/remove/stack with transparent gaps + top-row=front z-order. Phase B: multi-region stacking — per-region `+ Track` (inline, no extra rows), per-region output routing in the Output Manager, output chip anchored to each region's foundational zone. Phase C (per-track rename/colour/solo-mute, drag-to-reorder) is next. |
| [`transparent-dev.md`](transparent-dev.md) | ✅ Shipped & cross-platform verified 2026-05-24 | Transparent preset background — the whole canvas goes transparent (alpha comp shader) so layers (images, transparent video, GIF, text) float on nothing. **Show layers only + Transparent background** toggles in the Studio. Enables Timeline stacking (a transparent preset on a zone reveals the zone beneath). Verified in editor + Timeline on browser, macOS (WKWebView), and Windows (WebView2). |
| [`docs/user-guide-redesign.md`](docs/user-guide-redesign.md) | 📋 Planning | In-app user guide redesign — searchable help centre, contextual `?` deep links. |

### Handoff Docs ([`docs/`](docs/))

Session handoffs — pick up exactly where the last conversation ended.

| Doc | What it covers |
|-----|---------------|
| [`docs/handoff-milkdrop-research-may2026.md`](docs/handoff-milkdrop-research-may2026.md) | May 2026 — MilkDrop external editor research, full gap analysis, Phase 7-12 plan. Start here for next control additions. |
| [`docs/handoff-animation-may2026.md`](docs/handoff-animation-may2026.md) | May 26–27, 2026 — Animation system (P0 + A1 Gate 1+2 + A2 + A3 shipped). Architecture you must not forget (q-pipe, GSAP `_gsapProxy` trap), file map, quick mental model, recommended next session (Gate 3 or A4). |

### Bug Docs ([`docs/bugs/`](docs/bugs/))

All fixed — kept for reference.

| Doc | What it covers |
|-----|---------------|
| [`docs/bugs/preset-load-contamination.md`](docs/bugs/preset-load-contamination.md) | Preset load not clearing previous state — `_clearForLoad()` + `clearFeedbackBuffer()` fix. Root cause: `sampler_main * 2.0` amplification loop. |
| [`docs/bugs/strobe.md`](docs/bugs/strobe.md) | Strobe slider bug — handoff document, root cause analysis. |
| [`docs/bugs/image-mirror.md`](docs/bugs/image-mirror.md) | Canvas Mirror not rebuilding shader on click — one-line fix. |
| [`docs/bugs/export-tauri.md`](docs/bugs/export-tauri.md) | Tauri WKWebView swallowing `<a download>` — Rust `save_file` command + `downloadFile` JS helper. Requires `./build-and-sign.sh` rebuild to ship in macOS app. |
| [`docs/bugs/white-flash.md`](docs/bugs/white-flash.md) | White flash on startup — inline critical CSS + Tauri `visible:false`. |
| [`docs/bugs/fullscreen-macos.md`](docs/bugs/fullscreen-macos.md) | Fullscreen button no-op in Tauri macOS — Rust-side window toggle. |

### Legacy / Archive Docs (`docs/`)

Older research kept for context. Not actively maintained.

| Doc | What it covers |
|-----|---------------|
| [`docs/audio-triggering.md`](docs/audio-triggering.md) | Winamp vs modern DJ audio triggering research. Informed AGC + hype key implementation. |
| [`docs/user-live.md`](docs/user-live.md) | Live audio device selection — device picker modal implementation. |
| [`docs/favorites.md`](docs/favorites.md) | Favorites feature brainstorm — shipped. |
| [`docs/more-presets.md`](docs/more-presets.md) | Baron pack + multi-pack preset loading research. Phase 1 shipped (1,144 presets). |
| [`docs/controls-styling.md`](docs/controls-styling.md) | Museum dark aesthetic specification for control bar. |

---

## Licensing & Commercial Use

DiscoCast Visualizer is built entirely on free, open-source technologies that permit commercial distribution and monetization. You are legally cleared to distribute, sell, or monetize this application.

### Core Engine
- **MilkDrop**: Open source under the BSD License.
- **Butterchurn**: MIT Licensed.
- **Vite**: MIT Licensed.
- **FFmpeg.wasm**: MIT Licensed.

### Advanced 3D & Animation (Planned)
- **Three.js**: MIT Licensed. Free for commercial use. Planned for 3D object layers.
- **GSAP (GreenSock)**: As of 2025, GSAP is 100% free for commercial use in paid applications. The "Business Green" paywall has been removed. The only restriction is that it cannot be used to build a competing visual website builder.

*Note: Meyda was evaluated for audio reactivity but not adopted — the useful capability (spectral-flux transient detection) ships as the DIY **Flux** audio source instead, with no added dependency.*
