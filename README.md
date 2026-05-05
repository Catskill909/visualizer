# DiscoCast Visualizer 🎨

A modern browser-based MilkDrop music visualizer powered by [Butterchurn](https://github.com/jberg/butterchurn) (WebGL). Built with vanilla HTML/CSS/JS and bundled via Vite. Previously known as MilkScreen.

## Features

- **1,144 bundled MilkDrop presets** — official Butterchurn packs (Base, Extra, Extra2, MD1) + the community-curated Baron pack, all statically bundled (no network calls)
- **Advanced Audio Performance Suite** — real-time control over visual intensity via a glassmorphic popover
- **Auto-Gain Control (AGC)** — dynamic normalization ensuring consistent visual "hype" regardless of input volume (ON by default)
- **Kick-Lock Mode** — isolated frequency analysis (low-pass 150Hz) to lock visuals exclusively to the kick drum and bassline
- **Live Performance "Hype" Keys** — instant keyboard triggers for strobe, blackout, and color inversion
- **Dual audio input** — live audio capture or local audio file playback (MP3, WAV, FLAC)
- **Live device selection** — on every launch, a custom device picker modal enumerates all audio inputs and forces the user to choose (bypasses the browser's tendency to silently reuse the last-granted device); native support for USB DJ controllers, external sound cards, and specific microphones; single-device setups skip the picker automatically
- **Preset browser** — searchable drawer over the full 1,144-preset library with favorites/tabs, heart + hide icons per row, and instant left-anchored tooltips
- **Favorites-only cycling** — restrict auto-cycle to your hearted presets for curated sets
- **Hide unwanted presets** — eye-slash icon or `X` keyboard shortcut removes a preset from the All tab, random, and auto-cycle; hidden list persists in localStorage and survives reloads. A *Show hidden* toggle in the drawer exposes them for unhiding (individually or via a clean modal-confirmed "Unhide all"). Hide beats favorite in cycle — a hidden preset never auto-plays, but the Favorites tab still shows it so nothing is ever lost.
- **Auto-hiding controls** — glassmorphic control bar fades after 3 seconds of inactivity on the main visualizer, but stays visible while hovered or while a popover is open; click outside a popover to dismiss it
- **Material-style switches** — all toggles in the cycle and tuning popovers use clean sliding switch components
- **Fullscreen mode** — native browser fullscreen support
- **Projector Optimized** — automatic Screen Wake Lock prevents sleep (macOS app uses `caffeinate` fallback since WKWebView drops Wake Lock), mouse cursor auto-hides with UI, and "Zen Mode" (H key) for zero-UI projection
- **Output Settings** (`O` key or monitor icon) — lock canvas render resolution (HD / Full HD / QHD / 4K / Custom), constrain aspect ratio (16:9, 4:3, 21:9, 1:1, 9:16 portrait), choose fill mode (Letterbox / Stretch / Crop); settings persist across reloads. **Virtual Camera** toggle streams the canvas as a system webcam source — pick it in OBS, Zoom, or any capture app with no additional driver install
- **Responsive design** — works on desktop and mobile viewports
- **Preset Studio** (`/editor.html` or press **E**) — standalone visual preset builder: 12 one-click palettes, 3 independent color swatches (Wave / Glow / Accent), 4 tabbed control sections (Palette / Motion / Wave / Images), undo/redo (50-deep), A/B comparison; **up to 5 image layers** in a collapsible smart-accordion stack with drag-to-reorder, per-layer solo / mute / rename / static thumbnail, image resize on upload (1024px standard / 2048px HD toggle), per-layer UV mirror with Per Tile · Whole Image scope, scene-level Canvas Mirror, per-layer audio reactivity (source: Bass / Mid / Treble / Volume; curve: Linear / Squared / Cubed / Gate), aspect-correct tiling (portrait · square · landscape images tile without distortion), **Pan** (whole-group L/R + U/D translation — Drift for continuous travel/endless tile scroll, Bounce for independent-axis ping-pong), **Chromatic Aberration** (per-layer RGB split with animated offset), **animated GIF layers** — perceptual speed control (0.25×–8× log curve), Alpha Mode (Fade / Preserve silhouette), timing Stability (0–1 variance smoothing); **GIF Optimizer** modal with Smooth Loop / Keep Detail / Lightweight intent presets and live cadence + variance preview; dev performance HUD (`` ` `` key); saves to localStorage
- **Timeline Editor** (`/timeline.html` or press **L**) — self-contained full-screen show sequencer: canvas fills the screen, glassmorphic controls are always visible; a **fullscreen button** (top-right, or press `F`) hides all controls and enters true fullscreen — outside the browser on web, window-fullscreen in the macOS app; pressing `F`, clicking the button again, or pressing `Escape` restores controls; arrange presets on a proportional-width multi-track strip, set per-entry durations and blend times, play/stop/loop live; **Zone Compositor** assigns each entry to a named screen region (quadrant, banner, center square, custom rectangle) so multiple presets render simultaneously in different areas — each zone has independent opacity, blend mode (screen/overlay/multiply/add), and gap behavior; supports drag-to-reorder, snap-to-grid, waveform overlay, BPM grid; **Export** saves a `.dcshow.json` bundle that embeds all referenced custom presets including image layers as base64 — fully portable across devices; **Import** restores the timeline and all custom presets, remapping IDs automatically, and shows a detailed result modal listing every imported preset and any failures

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

Palette system maps 12 named moods (Mono, Neon, Electric, Fire, Violet, Ocean, Sunset, Ice, Gold, Rose, Acid, Plasma) to Wave + Glow `baseVals` pairs. Three swatches (Wave → `wave_r/g/b`, Glow → `ob_r/g/b`, Accent → `ib_r/g/b`) are independently overridable after applying a palette.

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
7. Creates HFS+ drag-to-install DMG with Applications folder shortcut
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
1. Download `DiscoCast-Visualizer-Windows-Setup` from the [GitHub Actions artifacts](#build-from-github-actions)
2. Unzip → double-click the `.exe` to install
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
| `vite` | ^8.0.4 | Dev server and build tool |

> **Notes**:
> - `butterchurn-presets-weekly` is installed but **unused** — it only contains remote S3 URLs, not preset data.
> - The Baron pack ships each preset as a separate JSON file loaded via top-level `await import()`. We bypass that runtime loop with Vite's `import.meta.glob({ eager: true })` and collapse all 762 files into a single build-time chunk (see [vite.config.js](vite.config.js) `manualChunks` rule). Without this, startup would issue 762 sequential network requests.
> - Final merge yields **1,144 unique presets** (13 name overlaps between the official packs and Baron; later packs override).

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

There are **three separate help systems** — edit the right one:

| Button / entry point | File to edit | Location in file |
|---|---|---|
| "User Guide" on main app start screen | `index.html` | `id="help-modal"` ~line 1315 |
| Help icon inside Preset Studio | `editor.html` | `id="help-modal"` ~line 62 |
| Standalone `/help.html` page | `help.html` | Full page, nav-linked sections |

All three are independent — changes to one do not affect the others.

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
| [`app-output-dev.md`](app-output-dev.md) | Output / projection settings — resolution lock, aspect ratio, virtual camera. |

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
| [`noise-gate-dev.md`](noise-gate-dev.md) | ✅ Built | Noise gate for live/mic — silence threshold, AGC interaction, VU meter states. |
| [`live-input-dev.md`](live-input-dev.md) | ✅ Built | Live audio input dev notes. |
| [`midi-dev.md`](midi-dev.md) | 📋 Planning | MIDI controller integration — action registry, MIDI learn UX, phased plan. |
| [`docs/user-guide-redesign.md`](docs/user-guide-redesign.md) | 📋 Planning | In-app user guide redesign — searchable help centre, contextual `?` deep links. |

### Handoff Docs ([`docs/`](docs/))

Session handoffs — pick up exactly where the last conversation ended.

| Doc | What it covers |
|-----|---------------|
| [`docs/handoff-milkdrop-research-may2026.md`](docs/handoff-milkdrop-research-may2026.md) | May 2026 — MilkDrop external editor research, full gap analysis, Phase 7-12 plan. Start here for next control additions. |

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

## License

MilkDrop is open source under the BSD license. Butterchurn is MIT licensed.
