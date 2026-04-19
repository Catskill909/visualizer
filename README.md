# MilkScreen 🎨

A modern browser-based MilkDrop music visualizer powered by [Butterchurn](https://github.com/jberg/butterchurn) (WebGL). Built with vanilla HTML/CSS/JS and bundled via Vite.

## Features

- **100 curated MilkDrop presets** — the best-of collection from the Butterchurn library
- **Dual audio input** — live audio capture or local audio file playback (MP3, WAV, FLAC)
- **Live device selection** — native support for selecting USB DJ controllers, external sound cards, and specific microphones via the control bar
- **Split audio routing** — volume control and visualizer sensitivity are independent; the visualizer receives a 5× gain-boosted signal for maximum beat reactivity without affecting speaker volume
- **Auto-cycling presets** — random preset rotation every 30 seconds
- **Preset browser** — searchable drawer with over 1,100 presets (including community packs), accessible via UI or keyboard
- **Auto-hiding controls** — glassmorphic control bar fades after 3 seconds of inactivity
- **Fullscreen mode** — native browser fullscreen support
- **Responsive design** — works on desktop and mobile viewports

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
winamp-screen/
├── index.html              # Main HTML — canvas, start screen, control bar, preset drawer
├── vite.config.js           # Vite config for CJS/ESM interop with butterchurn
├── package.json
├── public/
│   └── favicon.svg          # Brand favicon (gradient concentric circles)
└── src/
    ├── main.js              # Entry point — wires VisualizerEngine + ControlPanel
    ├── visualizer.js        # VisualizerEngine class — butterchurn wrapper, audio routing
    ├── controls.js          # ControlPanel class — UI bindings, keyboard, auto-hide
    └── style.css            # Design system — dark theme, glassmorphism, animations
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
| `nextPreset()` / `prevPreset()` | Navigate presets sequentially |
| `randomPreset()` | Jump to a random preset |
| `getPresetNames()` | Returns sorted array of all preset names |
| `getCurrentPresetName()` | Returns the active preset name |
| `setSize(w, h)` | Resize the visualizer canvas |
| `setVolume(value)` | Set speaker volume (0–1) |
| `setSensitivity(value)` | Set visualizer input gain multiplier |
| `destroy()` | Full cleanup — stops render, audio, timers |

#### `ControlPanel` (`src/controls.js`)

UI controller binding all DOM events, keyboard shortcuts, auto-hide behavior, preset drawer, and audio player controls.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause (file mode) or Next Preset (mic mode) |
| `→` | Next preset |
| `←` | Previous preset |
| `R` | Random preset |
| `P` | Toggle preset drawer |
| `F` | Toggle fullscreen |
| `Esc` | Close preset drawer |

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

## Deployment (Coolify)

This app is optimized for ultra-lightweight deployment via **Coolify**. Two methods are supported:

### 1. Dockerfile + Nginx (Recommended)
The repository includes a multi-stage `Dockerfile` that builds the Vite app and serves it using `nginx:alpine` (along with a custom `nginx.conf`).
- **Resource Footprint:** Extremely small (< 5MB RAM idle, ~0% CPU).
- **Setup in Coolify:** Select **Docker** as your Build Pack. Coolify will automatically detect the Dockerfile.

### 2. Nixpacks + sirv-cli
If you prefer a Node.js-based static server, the project includes `sirv-cli` as a dependency and a configured `start` script.
- **Setup in Coolify:** Leave Build Pack as **Nixpacks**. Coolify will run `npm install`, `npm run build`, and `npm run start`.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `butterchurn` | ^2.6.7 | MilkDrop WebGL visualizer engine |
| `butterchurn-presets` | ^2.4.7 | 100 curated MilkDrop presets (bundled) |
| `vite` | ^8.0.4 | Dev server and build tool |

> **Note**: `butterchurn-presets-weekly` is installed but unused — it only contains remote S3 URLs, not bundled preset data. The app uses `butterchurn-presets` which embeds all 100 presets locally.

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
