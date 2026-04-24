# DiscoCast Visualizer 🎨

A modern browser-based MilkDrop music visualizer powered by [Butterchurn](https://github.com/jberg/butterchurn) (WebGL). Built with vanilla HTML/CSS/JS and bundled via Vite. Previously known as MilkScreen.

## Features

- **1,144 bundled MilkDrop presets** — official Butterchurn packs (Base, Extra, Extra2, MD1) + the community-curated Baron pack, all statically bundled (no network calls)
- **Advanced Audio Performance Suite** — real-time control over visual intensity via a glassmorphic popover
- **Auto-Gain Control (AGC)** — dynamic normalization ensuring consistent visual "hype" regardless of input volume (ON by default)
- **Kick-Lock Mode** — isolated frequency analysis (low-pass 150Hz) to lock visuals exclusively to the kick drum and bassline
- **Live Performance "Hype" Keys** — instant keyboard triggers for strobe, blackout, and color inversion
- **Dual audio input** — live audio capture or local audio file playback (MP3, WAV, FLAC)
- **Live device selection** — native support for selecting USB DJ controllers, external sound cards, and specific microphones
- **Preset browser** — searchable drawer over the full 1,144-preset library with favorites/tabs, heart + hide icons per row, and instant left-anchored tooltips
- **Favorites-only cycling** — restrict auto-cycle to your hearted presets for curated sets
- **Hide unwanted presets** — eye-slash icon or `X` keyboard shortcut removes a preset from the All tab, random, and auto-cycle; hidden list persists in localStorage and survives reloads. A *Show hidden* toggle in the drawer exposes them for unhiding (individually or via a clean modal-confirmed "Unhide all"). Hide beats favorite in cycle — a hidden preset never auto-plays, but the Favorites tab still shows it so nothing is ever lost.
- **Auto-hiding controls** — glassmorphic control bar fades after 3 seconds of inactivity, but stays visible while hovered or while a popover is open; click outside a popover to dismiss it
- **Material-style switches** — all toggles in the cycle and tuning popovers use clean sliding switch components
- **Fullscreen mode** — native browser fullscreen support
- **Projector Optimized** — automatic Screen Wake Lock prevents sleep, mouse cursor auto-hides with UI, and "Zen Mode" (H key) for zero-UI projection
- **Responsive design** — works on desktop and mobile viewports
- **Preset Studio** (`/editor.html` or press **E**) — standalone visual preset builder: 12 one-click palettes, 3 independent color swatches (Wave / Glow / Accent), 5 tabbed control sections (Palette / Motion / Wave / Feel / Images), undo/redo (50-deep), A/B comparison; **up to 5 image layers** in a collapsible smart-accordion stack with drag-to-reorder, per-layer solo / mute / rename / static thumbnail, image resize on upload (1024px standard / 2048px HD toggle), per-layer UV mirror with Per Tile · Whole Image scope, scene-level Canvas Mirror, dev performance HUD (`` ` `` key); saves to localStorage

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
├── editor.html             # Preset Studio — standalone visual builder (/editor.html)
├── vite.config.js          # Vite MPA config — dual Rollup entries (main + editor)
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
    ├── customPresets.js    # Custom preset CRUD — localStorage + IndexedDB image storage
    ├── presetRegistry.js   # Merge layer — bundled + custom presets under one API
    └── editor/
        ├── main.js         # Preset Studio entry point — audio source boot
        ├── inspector.js    # EditorInspector class — tabs, palettes, controls, undo/redo
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

#### `ControlPanel` (`src/controls.js`)

UI controller binding all DOM events, keyboard shortcuts, auto-hide behavior, preset drawer, and audio player controls.

#### `EditorInspector` (`src/editor/inspector.js`)

Full panel controller for Preset Studio. Manages 5 tabbed sections, palette chips, color swatches, undo/redo stack, A/B comparison, and save-to-localStorage.

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
| `exportPreset(id)` | Serialize preset + inlined images to JSON |
| `importPreset(json)` | Validate, re-hydrate images, write to storage |

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
| `Shift` | **Hold for MAX Boost** |
| `A` | Toggle Auto-Gain (AGC) |
| `K` | Toggle Kick-Lock |
| `T` | Open Audio Tuning Panel |
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

# Start dev server
npm run dev
# → http://localhost:5173/

# Production build
npm run build
# → Output in dist/
```

## macOS App

A standalone, signed, and notarized macOS app — fully working including mic and USB audio input.

### Install
1. Open `DiscoCast Visualizer-1.0.YYYYMMDD.HHMM.dmg` from the project root
2. Drag **DiscoCast Visualizer** → **Applications**
3. Launch from Applications — no right-click needed (notarized)
4. First time using mic/USB: macOS will prompt for microphone permission — click **Allow**

### Build from Source

```bash
./build-and-sign.sh
```

Outputs `DiscoCast Visualizer-1.0.YYYYMMDD.HHMM.dmg` to the project root. Each build gets a unique date-stamped name.

Requires: Apple Developer account (`3UT7698LZ6`), Rust/Cargo, Xcode tools.

See `macos-app-generate.md` for full details.

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
- **Image layer injection (editor)** — `file.name` from user uploads is set via `textContent`/`title` (not `innerHTML`) so it can't XSS. If preset import/export is ever wired to UI, re-audit image layer card rendering.

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

## License

MilkDrop is open source under the BSD license. Butterchurn is MIT licensed.
