# MIDI Controller Integration — Dev Planning

## Core Design Rules

These apply to every control in the system, no exceptions:

1. **Every MIDI binding has a keyboard companion.** Every slider and every button that can be MIDI-assigned must also have a keyboard shortcut. They are defined together in the action registry and are always documented together. You should never need a physical MIDI controller to access any function.

2. **Keyboard and MIDI are two inputs into one action.** They call the same function. No duplicate logic, no separate code paths.

3. **Sliders get two keys: increment and decrement.** Since you can't hold a keyboard key the way you hold a knob, each slider action gets a key pair — one to step the value up, one to step it down. Holding the key repeats. Shift + key = large step (10×).

4. **Buttons get one key: toggle.** On first press = on, second press = off. Same as the MIDI note-on behavior.

5. **No control is MIDI-only or keyboard-only.** If it's assignable, it has both. Always.

---

## Overview

Add first-class MIDI controller support to DiscoCast Visualizer so any USB/Bluetooth MIDI controller (DJ controllers, MIDI pads, faders, knobs) can drive the visualizer in real time — preset switching, audio sensitivity, effects triggers, cycle control, timeline playback, and more.

There are **two distinct platforms** with fundamentally different MIDI paths:

| Platform | Runtime | Web MIDI API | Native MIDI | Path |
|----------|---------|--------------|-------------|------|
| **Web (Chrome/Edge)** | Browser | ✅ Native | — | `navigator.requestMIDIAccess()` |
| **Web (Firefox)** | Browser | ⚠️ Behind flag | — | Jazz-soft polyfill or flag |
| **Web (Safari)** | Browser | ❌ No | — | Not viable |
| **macOS App (Tauri v1.5)** | WKWebView | ❌ No | ✅ CoreMIDI | Rust `midir` crate → Tauri IPC → JS bridge |

The macOS app uses WKWebView which does **not** expose Web MIDI. The only viable path is a native CoreMIDI bridge in Rust, surfaced to the JS frontend via the existing Tauri command/invoke pattern.

---

## Current macOS App Stack (Tauri Audit)

The macOS app is **Tauri v1.5** with an established JS↔Rust IPC pattern already used for:
- `caffeinate_start` / `caffeinate_stop` — prevent display sleep
- `toggle_fullscreen` / `get_fullscreen` — window management
- `pick_audio_file` — native file picker returning base64 audio data

This is exactly the pattern that will be extended for MIDI. No new IPC architecture needed — just new commands.

**Existing state management pattern** (`CaffeinateState` as a `Mutex<Option<Child>>`) is the template for a `MidiState` that holds an active `midir::MidiInput` connection.

**Entitlements already set:** `com.apple.security.device.audio-input`, `com.apple.security.device.microphone`. MIDI needs one addition: `com.apple.security.device.midi`.

**Build pipeline:** The existing `build-and-sign.sh` handles signing, notarization, and DMG creation — no changes needed there. Updating `entitlements.plist` is automatically picked up.

---

## Platform Capability Chart

What each platform can do with MIDI once fully implemented:

| Feature | Web (Chrome/Edge) | macOS App (Tauri) | Notes |
|---------|:-----------------:|:-----------------:|-------|
| **Detect MIDI devices** | ✅ | ✅ | Web: `MIDIAccess.inputs`; App: `midir::MidiInput::ports()` |
| **Receive CC messages** | ✅ | ✅ | Core functionality |
| **Receive Note On/Off** | ✅ | ✅ | Core functionality |
| **Receive Program Change** | ✅ | ✅ | For preset-by-index |
| **Receive Pitch Bend** | ✅ | ✅ | High-res 14-bit fader |
| **Multi-device input** | ✅ | ✅ | Listen to all connected devices |
| **Hot-plug (device connect/disconnect)** | ✅ | ✅ | Web: `onstatechange`; App: polling or CoreMIDI notification |
| **MIDI Out (send to controller)** | ✅ | ✅ | LED feedback, scribble strips |
| **Channel filtering** | ✅ | ✅ | Configurable in both |
| **MIDI Learn (user remapping)** | ✅ | ✅ | Same localStorage binding store used by both |
| **USB controller (class-compliant)** | ✅ | ✅ | Both work with standard USB MIDI |
| **Bluetooth MIDI** | ✅ | ✅ | Web: BLE MIDI supported in Chrome; App: CoreMIDI picks it up natively |
| **Works without browser permission prompt** | ❌ | ✅ | App: entitlement-based, no user prompt; Web: browser asks |
| **Works offline** | ✅ | ✅ | No network needed for either |
| **Runs in Safari** | ❌ | n/a | Safari has no Web MIDI |
| **Runs in Firefox** | ⚠️ | n/a | Requires flag or polyfill |

### Summary

- **Web:** Zero install, works immediately in Chrome/Edge, requires one-time browser permission grant
- **macOS App:** No browser prompt, uses system CoreMIDI (same daemon that Logic/Ableton use), guaranteed to see any device macOS sees

---

## Architecture

### Two Implementations, One Binding Layer

The key design goal: the **binding system** (CC/Note → action mapping, MIDI Learn, localStorage persistence) is **shared** between both platforms. Only the input transport differs.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared JS Layer                               │
│                                                                  │
│  MIDIBindingStore (localStorage)                                 │
│  Action Registry  — stable IDs for every bindable action         │
│  MIDIDispatcher   — receives {type, ch, data1, data2}, fires     │
│                     registered callbacks                         │
└───────────────┬────────────────────────────┬────────────────────┘
                │                            │
   ┌────────────▼──────────┐   ┌─────────────▼──────────────────┐
   │  Web MIDI Transport   │   │   Tauri MIDI Bridge Transport   │
   │  (midiWebTransport.js)│   │   (midiTauriTransport.js)       │
   │                       │   │                                  │
   │  navigator            │   │  tauri.invoke('midi_start')      │
   │  .requestMIDIAccess() │   │  window.addEventListener(        │
   │                       │   │    'tauri://midi-message', ...)  │
   └───────────────────────┘   └──────────────────────────────────┘
         ▲                                ▲
         │ Chrome/Edge/Firefox            │ macOS App (WKWebView)
```

At startup, `src/midi/index.js` detects the runtime:

```js
const isTauri = '__TAURI__' in window;
const transport = isTauri
  ? new TauriMidiTransport()
  : new WebMidiTransport();
```

Both transports implement the same interface: `.init()`, `.getDevices()`, `.onMessage(cb)`, `.send(deviceId, data)`.

---

### Unified Action Registry (`src/midi/actions.js`)

Every bindable action has a single definition that carries both its keyboard shortcut and its default MIDI binding. Keyboard handlers and the MIDI dispatcher both call the same action function — they are two input channels into one registry.

```js
// actions.js (excerpt)
export const ACTIONS = [

  // ── Main app — Preset Navigation ──────────────────────────────────────
  // Buttons: one key = trigger
  { id: 'preset.next',      label: 'Next Preset',        keyboard: 'ArrowRight', midi: { type: 'note', number: 36  } },
  { id: 'preset.prev',      label: 'Prev Preset',        keyboard: 'ArrowLeft',  midi: { type: 'note', number: 37  } },
  { id: 'preset.random',    label: 'Random Preset',      keyboard: 'r',          midi: { type: 'note', number: 38  } },

  // ── Main app — Sliders ────────────────────────────────────────────────
  // Sliders: two keys (up / down). Holding repeats. Shift = large step (10×).
  { id: 'audio.energy.up',  label: 'Energy +',           keyboard: ']',          midi: null },
  { id: 'audio.energy.dn',  label: 'Energy −',           keyboard: '[',          midi: null },
  { id: 'audio.energy',     label: 'Energy (knob)',       keyboard: null,         midi: { type: 'cc', number: 11 } },
  // ^ CC is the knob assignment; the .up/.down pair are the keyboard companions.
  //   All three call the same underlying setEnergy() function.

  // ── Preset Studio — Layer Toggles (buttons) ───────────────────────────
  { id: 'layer.1.solo',     label: 'Solo Layer 1',       keyboard: 'Shift+1',    midi: { type: 'note', number: 110 } },
  { id: 'layer.2.solo',     label: 'Solo Layer 2',       keyboard: 'Shift+2',    midi: { type: 'note', number: 111 } },
  { id: 'layer.3.solo',     label: 'Solo Layer 3',       keyboard: 'Shift+3',    midi: { type: 'note', number: 112 } },
  { id: 'layer.4.solo',     label: 'Solo Layer 4',       keyboard: 'Shift+4',    midi: { type: 'note', number: 113 } },
  { id: 'layer.5.solo',     label: 'Solo Layer 5',       keyboard: 'Shift+5',    midi: { type: 'note', number: 114 } },
  { id: 'layer.1.mute',     label: 'Mute Layer 1',       keyboard: 'Ctrl+1',     midi: { type: 'note', number: 120 } },
  { id: 'layer.2.mute',     label: 'Mute Layer 2',       keyboard: 'Ctrl+2',     midi: { type: 'note', number: 121 } },
  { id: 'layer.3.mute',     label: 'Mute Layer 3',       keyboard: 'Ctrl+3',     midi: { type: 'note', number: 122 } },
  { id: 'layer.4.mute',     label: 'Mute Layer 4',       keyboard: 'Ctrl+4',     midi: { type: 'note', number: 123 } },
  { id: 'layer.5.mute',     label: 'Mute Layer 5',       keyboard: 'Ctrl+5',     midi: { type: 'note', number: 124 } },

  // ── Preset Studio — Active Layer Sliders ─────────────────────────────
  // Each slider: a CC for the knob + two keys for keyboard control
  { id: 'layer.opacity',    label: 'Opacity (knob)',      keyboard: null,         midi: { type: 'cc', number: 1 } },
  { id: 'layer.opacity.up', label: 'Opacity +',          keyboard: 'Alt+ArrowUp',   midi: null },
  { id: 'layer.opacity.dn', label: 'Opacity −',          keyboard: 'Alt+ArrowDown', midi: null },

  { id: 'layer.size',       label: 'Size (knob)',         keyboard: null,         midi: { type: 'cc', number: 2 } },
  { id: 'layer.size.up',    label: 'Size +',             keyboard: 'Alt+]',      midi: null },
  { id: 'layer.size.dn',    label: 'Size −',             keyboard: 'Alt+[',      midi: null },

  { id: 'layer.spin',       label: 'Spin (knob)',         keyboard: null,         midi: { type: 'cc', number: 3 } },
  { id: 'layer.spin.up',    label: 'Spin +',             keyboard: 'Alt+.',      midi: null },
  { id: 'layer.spin.dn',    label: 'Spin −',             keyboard: 'Alt+,',      midi: null },
  // ... etc — every slider follows this same three-entry pattern
];
```

**Key pattern for sliders:** every slider produces three action entries — one for the CC knob assignment (no keyboard), and two for keyboard up/down (no MIDI CC, since the CC already covers the full range continuously). All three call the same underlying setter function. The management panel groups them visually as one row with two keyboard columns.

**Step sizes:**
- Small step (single key press / single keyrepeat tick): 1 slider notch (`step` value from the HTML)
- Large step (`Shift` + key): 10× the small step, clamped to min/max
- The CC knob always operates continuously (0–127 → full range), unaffected by step size

The MIDI Learn UI reads this registry to render the binding table — keyboard shortcuts in one column, MIDI in the next. User overrides saved to `localStorage`, merged over defaults at startup. Resetting to defaults clears that key.

The management panel is also a complete keyboard shortcut reference — useful to any user, with or without a controller.

---

### Web Path: `src/midi/midiWebTransport.js`

```
navigator.requestMIDIAccess({ sysex: false })
  └─► MIDIAccess.inputs (Map of MIDIInput)
        └─► input.onmidimessage
              └─► MIDIDispatcher._dispatch(status, data1, data2)
```

Hot-plug: `MIDIAccess.onstatechange` fires when devices connect/disconnect.

### Tauri Path: `src-tauri/src/main.rs` + `src/midi/midiTauriTransport.js`

**Rust side (new commands):**

```rust
// Cargo.toml additions:
// midir = "0.9"
// serde = { version = "1", features = ["derive"] }  (already present)

struct MidiState(Mutex<Option<MidiConnection>>);

#[tauri::command]
async fn midi_list_devices(state: State<'_, MidiState>) -> Result<Vec<String>, String>

#[tauri::command]
async fn midi_connect(
    device_index: usize,
    window: tauri::Window,
    state: State<'_, MidiState>
) -> Result<(), String>
// Emits "midi-message" events to the window with {status, data1, data2}

#[tauri::command]
async fn midi_disconnect(state: State<'_, MidiState>) -> Result<(), String>

#[tauri::command]
async fn midi_send(device_index: usize, data: Vec<u8>, state: State<'_, MidiState>) -> Result<(), String>
```

**JS side (Tauri transport):**

```js
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

class TauriMidiTransport {
  async init() {
    await listen('midi-message', (event) => {
      this._onMessage(event.payload);
    });
  }
  async getDevices() {
    return invoke('midi_list_devices');
  }
  async connect(deviceIndex) {
    return invoke('midi_connect', { deviceIndex });
  }
}
```

**`entitlements.plist` addition needed:**
```xml
<key>com.apple.security.device.midi</key>
<true/>
```

**`main.rs` `invoke_handler` addition:**
```rust
.manage(MidiState(Mutex::new(None)))
.invoke_handler(tauri::generate_handler![
    caffeinate_start, caffeinate_stop,
    toggle_fullscreen, get_fullscreen,
    pick_audio_file,
    midi_list_devices, midi_connect, midi_disconnect, midi_send  // new
])
```

---

## Full Controllable Parameter Map

### Preset Navigation

| Action | CC / Note | Value Behavior | Engine Call |
|--------|-----------|----------------|-------------|
| Next preset | Note 36 | Trigger on note-on | `engine.nextPreset()` |
| Previous preset | Note 37 | Trigger on note-on | `engine.prevPreset()` |
| Random preset | Note 38 | Trigger on note-on | `engine.randomPreset()` |
| Cycle next (pool-aware) | Note 39 | Trigger | `engine.cycleNext()` |
| Cycle random (pool-aware) | Note 40 | Trigger | `engine.cycleRandom()` |
| Load by index | Program Change | program# → preset index | `engine.loadPresetByIndex(n)` |
| Blend time | CC 23 | 0→0s, 127→10s | `engine.blendTime = map(val,0,127,0,10)` |

### Audio Performance Controls

| Action | CC / Note | Value Behavior | Engine Call |
|--------|-----------|----------------|-------------|
| Energy / Sensitivity | CC 11 | 0→0.2, 64→1.0, 127→5.0 (log) | `engine.setEnergy(val)` |
| Volume (audio output) | CC 7 | 0→0.0, 127→1.0 | `engine.setVolume(val/127)` |
| AGC toggle | CC 80 | >63 = on, ≤63 = off | `engine.toggleAGC()` |
| Kick Lock toggle | CC 81 | >63 = on, ≤63 = off | `engine.toggleKickLock()` |
| Boost (hold) | Note 41 | Note-on = boost on, Note-off = off | `engine.setBoost(true/false)` |
| Hype meter readout | — | Read-only for MIDI out | `engine.hypeLevel` (0–1.2) |

### Auto-Cycle Controls

| Action | CC / Note | Value Behavior | Engine Call |
|--------|-----------|----------------|-------------|
| Auto-cycle toggle | CC 82 | >63 = on | `engine.setAutoCycle(bool)` |
| Cycle interval | CC 24 | 0→5s, 127→120s (exp) | `engine.setAutoCycleInterval(ms)` |
| Random order | CC 83 | >63 = random | `engine.setRandomCycleOrder(bool)` |
| Favorites-only | CC 84 | >63 = favorites | `engine.setFavoritesOnly(bool)` |
| Favorite current preset | Note 42 | Trigger | `controls.toggleFavorite(engine.getCurrentPresetName())` |
| Hide current preset | Note 43 | Trigger | `controls.toggleHidden(engine.getCurrentPresetName())` |
| Reset cycle timer | Note 44 | Trigger | `engine.resetAutoCycle()` |

### Visual Effects (Performance Triggers)

| Action | Note | Behavior | Implementation |
|--------|------|----------|----------------|
| Strobe / white flash | Note 48 | Trigger; velocity → duration | `controls.triggerStrobe(durationMs)` *(new)* |
| Blackout (hold) | Note 49 | Note-on = black, Note-off = restore | `controls.triggerBlackout(on)` *(new)* |
| Color invert | Note 50 | Toggle | `controls.triggerInvert()` *(new stateful)* |
| Freeze frame | Note 51 | Toggle pause render | `engine.freezeFrame(on)` *(new)* |
| Speed multiplier | CC 25 | 0→0.25×, 64→1×, 127→4× | `engine.setRenderSpeed(val)` *(new)* |

### UI Controls

| Action | CC / Note | Call |
|--------|-----------|------|
| Preset drawer | CC 85 | `controls.toggleDrawer()` |
| Fullscreen | CC 86 | `controls.toggleFullscreen()` |
| Zen mode (hide UI) | CC 87 | toggle UI visibility |
| Output settings panel | CC 88 | `controls.toggleOutputPanel()` |
| Cycle panel | CC 89 | `controls.toggleCyclePanel()` |
| Tuning panel | CC 90 | `controls.toggleTuningPanel()` |

### Timeline Controls (`timeline.html`)

| Action | CC / Note | Call |
|--------|-----------|------|
| Play | Note 60 | `editor.play()` |
| Stop | Note 61 | `editor.stop()` |
| Toggle play/stop | Note 62 | `editor.togglePlayback()` |
| Skip to next entry | Note 63 | `editor.skipToNext()` *(new)* |
| Skip to previous | Note 64 | `editor.skipToPrev()` *(new)* |
| Scrub position | CC 26 | `editor.scrubTo(val/127)` *(new)* |

### Preset Studio (`editor.html`)

| Action | Note | Call |
|--------|------|------|
| Undo | Note 70 | `inspector.undo()` |
| Redo | Note 71 | `inspector.redo()` |
| Save current | Note 72 | `inspector.saveCurrent(...)` |

---

## Image Tab — Per-Layer MIDI Control (Primary Use Case)

The Image tab in Preset Studio is where MIDI is most immediately useful. Up to 5 independent image layers each have ~30 controllable parameters. The core design problem: MIDI CC space is flat (128 CCs) but layers are stacked. Solution: **Active Layer Focus model** — a bank of fixed CCs always controls whichever layer is currently "focused", and dedicated notes select / solo / mute each layer.

### Layer Addressing Strategy

```
LAYER SELECT (Notes 100–104):
  Note 100 → Focus Layer 1
  Note 101 → Focus Layer 2
  Note 102 → Focus Layer 3
  Note 103 → Focus Layer 4
  Note 104 → Focus Layer 5

SOLO per layer (Notes 110–114):
  Note 110 → Toggle Solo on Layer 1
  Note 111 → Toggle Solo on Layer 2
  Note 112 → Toggle Solo on Layer 3
  Note 113 → Toggle Solo on Layer 4
  Note 114 → Toggle Solo on Layer 5

MUTE per layer (Notes 120–124):
  Note 120 → Toggle Mute on Layer 1
  Note 121 → Toggle Mute on Layer 2
  Note 122 → Toggle Mute on Layer 3
  Note 123 → Toggle Mute on Layer 4
  Note 124 → Toggle Mute on Layer 5
```

Solo and Mute map directly onto `entry.solo` and `entry.muted` on each layer object, then call `_buildCompShader()` + `_applyToEngine()`. The existing solo logic already handles the "any solo active → show only soloed layers" rule at render time.

### Active Layer: Slider CC Map

The following CCs always target the currently focused layer. All values are 0–127 and map linearly to the parameter range unless noted.

#### Transform Group

| CC | Label | Data Range | Internal Property | Notes |
|----|-------|-----------|-------------------|-------|
| CC 1 | Opacity | 0→0.0, 127→1.0 | `entry.opacity` | |
| CC 2 | Size | 0→0.05, 127→1.50 | `entry.size` | UI uses sqrt display transform — MIDI maps raw value |
| CC 3 | Spin | 0→−3.0, 64→0.0, 127→3.0 | `entry.spinSpeed` | Bipolar; center=stopped |
| CC 4 | Angle | 0→−180°, 64→0°, 127→180° | `entry.angle` | Bipolar |
| CC 5 | Skew X | 0→−1.0, 64→0.0, 127→1.0 | `entry.skewX` | Bipolar |
| CC 6 | Skew Y | 0→−1.0, 64→0.0, 127→1.0 | `entry.skewY` | Bipolar |
| CC 7 | Persp X | 0→−1.0, 64→0.0, 127→1.0 | `entry.perspX` | Bipolar |
| CC 8 | Persp Y | 0→−1.0, 64→0.0, 127→1.0 | `entry.perspY` | Bipolar |

#### Tile Group (active when Tile is ON)

| CC | Label | Data Range | Internal Property | Notes |
|----|-------|-----------|-------------------|-------|
| CC 9 | Spacing | 0→0.0, 127→0.8 | `entry.spacing` | |
| CC 10 | Width (tile X scale) | 0→0.25, 127→4.0 | `entry.tileScaleX` | |
| CC 11 | Height (tile Y scale) | 0→0.25, 127→4.0 | `entry.tileScaleY` | |
| CC 12 | Tunnel Speed | 0→−2.0, 64→0.0, 127→2.0 | `entry.tunnelSpeed` | Bipolar; - = zoom out |
| CC 13 | Depth Offset | 0→0.0, 127→1.0 | `entry.depthOffset` | Parallax phase |

#### Motion Group

| CC | Label | Data Range | Internal Property | Notes |
|----|-------|-----------|-------------------|-------|
| CC 14 | Orbit Radius | 0→0.0, 127→0.45 | `entry.orbitRadius` | |
| CC 15 | Sway Amount | 0→0.0, 127→0.4 | `entry.swayAmt` | |
| CC 16 | Sway Speed | 0→0.0, 127→4.0 | `entry.swaySpeed` | |
| CC 17 | Wander Amount | 0→0.0, 127→0.4 | `entry.wanderAmt` | |
| CC 18 | Wander Speed | 0→0.0, 127→2.0 | `entry.wanderSpeed` | |
| CC 19 | Pan Range (bounce mode) | 0→0.0, 127→1.0 | `entry.panRange` | |

#### Tint / FX Group

| CC | Label | Data Range | Internal Property | Notes |
|----|-------|-----------|-------------------|-------|
| CC 20 | Hue Spin Speed | 0→0.0, 127→2.0 | `entry.hueSpinSpeed` | 0 = no spin |
| CC 21 | Chromatic Aberration | 0→0.0, 127→1.0 | `entry.chromaticAberration` | UI uses sqrt display; MIDI maps raw |
| CC 22 | Chromatic Speed | 0→0.0, 127→4.0 | `entry.chromaticSpeed` | |

#### Audio Reactivity Group

| CC | Label | Data Range | Internal Property | Notes |
|----|-------|-----------|-------------------|-------|
| CC 23 | Pulse (size) | 0→0.0, 127→2.0 | `entry.audioPulse` | UI uses cbrt display; MIDI maps raw |
| CC 24 | Bounce (beat Y) | 0→0.0, 127→0.4 | `entry.bounceAmp` | |
| CC 25 | Shake (beat jolt) | 0→0.0, 127→0.15 | `entry.shakeAmp` | |
| CC 26 | Beat Fade (opacity) | 0→0.0, 127→1.0 | `entry.opacityPulse` | |
| CC 27 | Strobe Amp | 0→0.0, 127→1.0 | `entry.strobeAmp` | Hard beat cut |
| CC 28 | Strobe Threshold | 0→0.1, 127→0.9 | `entry.strobeThr` | |
| CC 29 | GIF Speed | 0→0.25, 127→4.0 | `entry.gifSpeed` | GIF layers only |

### Active Layer: Toggle Notes

| Note | Action | Property Toggled |
|------|--------|-----------------|
| Note 80 | Toggle Tile on/off | `entry.tile` |
| Note 81 | Toggle Group Spin | `entry.groupSpin` |
| Note 82 | Toggle Pulse Invert (shrink) | `entry.pulseInvert` |
| Note 83 | Toggle Edge (Sobel) | `entry.edgeSobel` |

### Active Layer: Segmented Controls (CC switches)

These map a CC value to a discrete option set:

| CC | Label | Values | Options |
|----|-------|--------|---------|
| CC 30 | Pan Mode | 0–42=off, 43–84=drift, 85–127=bounce | `entry.panMode` |
| CC 31 | Orbit Path | 0–63=circle, 64–127=lissajous | `entry.orbitMode` |
| CC 32 | Mirror Mode | 0–25=none, 26–50=H, 51–75=V, 76–101=Quad, 102–127=Kaleido | `entry.mirror` |
| CC 33 | Blend Mode | 0–31=overlay, 32–63=screen, 64–95=multiply, 96–127=add | `entry.blendMode` |
| CC 34 | React Source | 0–31=bass, 32–63=mid, 64–95=treble, 96–127=volume | `entry.reactSource` |
| CC 35 | React Curve | 0–31=linear, 32–63=squared, 64–95=cubed, 96–127=gate | `entry.reactCurve` |

### Lissajous Controls (active when Orbit Path = Lissajous)

| CC | Label | Data Range | Property |
|----|-------|-----------|---------|
| CC 36 | Lissajous Freq X | 0→0.25, 127→4.0 | `entry.lissFreqX` |
| CC 37 | Lissajous Freq Y | 0→0.25, 127→4.0 | `entry.lissFreqY` |
| CC 38 | Lissajous Phase | 0→0.0, 127→1.0 | `entry.lissPhase` |

---

### How Layer Parameters Get Applied

When a MIDI CC changes a layer value, the MIDI handler must call into the inspector the same way a slider event does:

```js
// Pattern (inspector.js already does this on every slider 'input' event):
entry[propertyKey] = mappedValue;
inspector._buildCompShader();   // recompiles the GLSL shader
inspector._applyToEngine();     // pushes the new state to the live preview
inspector._pushUndo();          // (optional) records an undo snapshot
```

The MIDI module needs a reference to `inspector` (already exposed as `window.__editorInspector` in `editor/main.js`) and the active layer index (`inspector.currentState.images[focusedLayerIndex]`).

A helper on `EditorInspector` would be cleaner than reaching into internals:

```js
// New method to add to inspector.js:
setLayerParam(layerIndex, key, value) {
  const entry = this.currentState.images[layerIndex];
  if (!entry) return;
  entry[key] = value;
  this._buildCompShader();
  this._applyToEngine();
}

toggleLayerSolo(layerIndex) { /* existing solo logic, extracted */ }
toggleLayerMute(layerIndex) { /* existing mute logic, extracted */ }
```

---

### Controller Layout Recommendation (Image Tab)

A controller with **8 knobs + 16 pads** (e.g., Akai APC mini, Novation Launchpad Mini, Arturia BeatStep) maps cleanly:

```
PADS (top two rows — layer management):
  Row 1:  [Select L1] [Select L2] [Select L3] [Select L4] [Select L5] [ — ] [ — ] [ — ]
  Row 2:  [Solo L1  ] [Solo L2  ] [Solo L3  ] [Solo L4  ] [Solo L5  ] [ — ] [ — ] [ — ]
  Row 3:  [Mute L1  ] [Mute L2  ] [Mute L3  ] [Mute L4  ] [Mute L5  ] [ — ] [ — ] [ — ]
  Row 4:  [Tile     ] [GrpSpin  ] [Pls Inv   ] [Edge      ] [Pan:Drift ] [Pan:Bounce] [Mirror] [Blend]

KNOBS (8 knobs — active layer):
  Knob 1: Opacity    Knob 2: Size     Knob 3: Spin      Knob 4: Orbit
  Knob 5: Pulse      Knob 6: Bounce   Knob 7: Hue Spin  Knob 8: Chromatic

FADER (if available):
  Master: Energy/Sensitivity (global, not per-layer)
```

LEDs on pad controllers light the soloed/muted/focused state in real time — the selected layer pad stays lit, solo pads glow when active, muted pads dim.

---

## Default CC/Note Reference Table

```
NOTES (pads):
  36  Next preset
  37  Previous preset
  38  Random preset
  39  Cycle next (pool-aware)
  40  Cycle random (pool-aware)
  41  Boost (hold)
  42  Favorite toggle (current)
  43  Hide current preset
  44  Reset auto-cycle timer
  48  Strobe / white flash
  49  Blackout (hold)
  50  Color invert toggle
  51  Freeze frame toggle
  60  Timeline: play
  61  Timeline: stop
  62  Timeline: toggle
  63  Timeline: skip next
  64  Timeline: skip prev
  70  Editor: undo
  71  Editor: redo
  72  Editor: save

CONTROL CHANGES (knobs / faders):
   7  Volume
  11  Energy / sensitivity (main fader)
  23  Blend time (0–10s)
  24  Cycle interval (5–120s)
  25  Render speed (0.25×–4×)
  26  Timeline scrub
  80  AGC on/off
  81  Kick Lock on/off
  82  Auto-cycle on/off
  83  Random order on/off
  84  Favorites-only on/off
  85  Preset drawer toggle
  86  Fullscreen toggle
  87  Zen mode toggle
  88  Output settings panel
  89  Cycle panel
  90  Tuning panel

PROGRAM CHANGE:
  0–1143  Load preset by index
```

---

## File Structure

```
src/
└── midi/
    ├── index.js              # Runtime detection — picks Web or Tauri transport
    ├── midiDispatcher.js     # Shared: routes {type,ch,d1,d2} → action callbacks
    ├── midiWebTransport.js   # Web MIDI API transport (Chrome/Edge)
    ├── midiTauriTransport.js # Tauri IPC transport (macOS app)
    ├── defaultBindings.js    # Default CC/Note → action ID map
    └── actions.js            # (Phase 5) Stable action ID registry for MIDI Learn

src-tauri/src/
└── main.rs                   # Add: midi_list_devices, midi_connect,
                              #      midi_disconnect, midi_send commands
                              #      MidiState managed state

src-tauri/
└── entitlements.plist        # Add: com.apple.security.device.midi
```

---

## Methods That Need to Be Added to Existing Classes

Some MIDI use cases need new methods that don't exist yet (all additive):

| File | New Method | Purpose |
|------|-----------|---------|
| `src/visualizer.js` | `freezeFrame(on)` | Pause/resume render loop without destroy |
| `src/visualizer.js` | `setRenderSpeed(multiplier)` | Scale visual time (0.25×–4×) |
| `src/controls.js` | `triggerStrobe(durationMs?)` | Programmatic strobe (currently keyboard fire-and-forget) |
| `src/controls.js` | `triggerBlackout(on)` | Stateful blackout for hold-style note |
| `src/controls.js` | `triggerInvert(on?)` | Stateful invert toggle |
| `src/timeline/timelineEditor.js` | `skipToNext()` | Jump to next entry mid-play |
| `src/timeline/timelineEditor.js` | `skipToPrev()` | Jump back one entry |
| `src/timeline/timelineEditor.js` | `scrubTo(pct)` | Seek to 0–100% of timeline |

---

## MIDI Learn Mode (Phase 5)

Rather than hard-coding bindings, MIDI Learn lets users map any CC/Note to any action:

1. User opens MIDI settings panel and clicks **Learn** next to an action
2. App arms that action slot
3. User moves any knob/pad — first incoming MIDI message is captured and bound
4. Binding saved to `localStorage` as `midi_bindings` JSON

**Requires:**
- `actions.js` — stable string IDs for every action (`'preset.next'`, `'audio.energy'`, etc.)
- `MIDIBindingStore` — localStorage CRUD for `Map<{type, channel, data1}, actionId>`
- Learn-mode UI — a new tab in the tuning popover or standalone panel
- Conflict detection — warn if same CC is assigned to multiple actions

**Both platforms use the same binding store** — only the transport differs, the mapping layer is shared.

---

## MIDI Out / LED Feedback (Phase 7)

Send MIDI back to the controller to drive LEDs and displays:

- Light the AGC pad LED when AGC is on (toggle state sync)
- Light the Kick Lock pad when active
- Drive knob ring LED intensity from `engine.hypeLevel` (real-time VU meter)
- Send preset name to scribble strip on controllers that support it (e.g., Behringer X-Touch Mini)

**Web:** `MIDIAccess.outputs` → `output.send([status, data1, data2])`  
**macOS App:** `midi_send` Tauri command → `midir::MidiOutput`

---

## MIDI Assignment UX

Two tiers. No visual indicators on controls themselves — bindings are silent, like Reaper. The UI stays tight and uncluttered. The management panel is the only place you see what's bound.

---

### Tier 1 — Right-Click Context Menu (assignment)

The primary way to create or remove a binding. Works on any slider, button, or toggle anywhere in the app — main visualizer, Preset Studio image tab, timeline.

**How it works:**
1. Right-click any control
2. Context menu appears with at most two items:
   - **"Assign MIDI"** → arms that control, waiting for input
   - **"Remove MIDI binding"** → only shown if this control is already bound
3. After selecting Assign, move any knob or hit any pad on the connected controller
4. Binding is saved silently — no visual change on the control itself
5. The management panel (if open) updates its list immediately

```
┌─────────────────────┐
│  Assign MIDI        │
│  Remove binding     │  ← only shown if already bound
└─────────────────────┘
```

Dismiss by clicking outside or pressing `Esc`. If no MIDI device is connected when the user right-clicks, the menu shows a single disabled item: "No MIDI device connected."

**Implementation hook — `data-midi-id` attribute:**

Every assignable element gets a stable action ID so the context menu knows what it's arming:

```html
<input type="range" class="slider layer-size-sl"
       data-midi-id="layer.{index}.size" ...>

<button class="layer-solo"
        data-midi-id="layer.{index}.solo" ...>
```

One delegated `contextmenu` listener on `document` handles all of them — no per-element wiring needed. The context menu reads `data-midi-id`, looks up the action in the registry, calls `dispatcher.arm(actionId)`.

---

### Tier 2 — MIDI Management Panel (oversight)

Reachable from the MIDI indicator in the control bar. Shows **only active bindings** — if you've bound 6 things, there are 6 rows. Never a list of every possible parameter.

```
┌──────────────────────────────────────────────────────────────────┐
│  ● Korg nanoKONTROL2                        [Export]  [Import]  │
├──────────────────────────────────────────────────────────────────┤
│  Action                  Keyboard      MIDI           [✕]       │
│  ──────────────────────────────────────────────────────────────  │
│  Next Preset             →             Note 36        [✕]       │
│  Previous Preset         ←             Note 37        [✕]       │
│  Energy                  —             CC 11          [✕]       │
│  Layer 1 · Solo          Shift+1       Note 110       [✕]       │
│  Layer 1 · Opacity       —             CC 1           [✕]       │
│  ──────────────────────────────────────────────────────────────  │
│                                             [Reset to defaults] │
└──────────────────────────────────────────────────────────────────┘
```

**Row interactions:**
- Click the **MIDI cell** of any row → arms that action for learn (same flow as right-click)
- **`✕`** → removes binding
- **Reset to defaults** → modal confirm → restores `defaultBindings.js`
- **Export** → downloads `midi-bindings.json`
- **Import** → loads a saved profile (per-controller presets)

**Device row** (top of panel):
- Dropdown: which MIDI input to listen on ("All devices" or a specific one)
- Channel filter: 0 = all, 1–16 = specific
- Green dot when connected, grey when no device found

The panel is accessible from the control bar MIDI icon. First-time users never encounter it unless they go looking.

---

### How They Connect

```
Right-click → "Assign MIDI"  ──►  dispatcher.arm(actionId)
Management panel → click row ──►  dispatcher.arm(actionId)
                                          │
                                   next MIDI input received
                                          │
                                   MIDIBindingStore.save(actionId, { type, ch, d1 })
                                          │
                              Management panel list refreshes
```

No visual state on controls. The binding store is the source of truth; the panel reads it on open and on every save.

---

## MIDI Device UI

- **MIDI indicator** in the control bar — small plug icon, green dot when a device is connected, click opens the Management Panel
- **Hot-plug toast** — device name shown briefly when a controller connects or disconnects
- No other MIDI chrome anywhere in the UI

---

## MIDI Record & Playback

Ambitious long-term feature — start slow, build in layers. Three distinct modes that share the same underlying storage format.

---

### The Three Modes

#### Mode 1 — Performance Capture (start here)

Hit record, perform live with the controller, stop. Every incoming MIDI event is timestamped and saved as a **take**. Replay the take and the visuals animate exactly as you performed them — hands-free, repeatable.

Use cases: capturing a good live run for an installation, replaying a show segment without re-performing it, A/B comparing two different performances of the same section.

#### Mode 2 — Pre-Show Cue Programming

Build a sequence of MIDI events before the show without needing to perform them in real time. A simple list editor: "at 0:30 → opacity to 0.8, at 1:00 → solo layer 2, at 2:00 → next preset." Editable, exportable, no controller required to author it.

Use cases: scripting a fully automated show, programming visual cues that sync to a set list, handing off a show to run unattended.

#### Mode 3 — BPM-Locked Loop

A take that is quantized to a BPM grid becomes a **clip** — a repeating loop that stays in sync with the music. Record 4 bars of opacity animation, loop it forever. More like an Ableton clip than a one-shot recording.

Use cases: continuous reactive animation without live input, layering motion loops on top of the Timeline Editor's preset structure.

*Mode 3 is the most complex — defer until Modes 1 and 2 are solid.*

---

### Storage Schema

All three modes use the same take format. Stored in `localStorage` (small takes) or IndexedDB (large / BPM-synced clips).

```js
// A single recorded take
{
  id: 'take_<uuid>',
  name: 'Opener segment',         // user-editable
  createdAt: 1714500000000,
  durationMs: 45000,              // total length of the take
  bpm: null,                      // null = freeform, number = BPM-locked
  beatsPerBar: 4,                 // only relevant when bpm is set
  context: 'main' | 'editor',    // which page this take applies to
  events: [
    { t: 0,     type: 0x90, ch: 0, d1: 36, d2: 100 },  // Note On — next preset
    { t: 1240,  type: 0xB0, ch: 0, d1: 1,  d2: 80  },  // CC 1 — opacity 80
    { t: 3500,  type: 0x90, ch: 0, d1: 110, d2: 100 }, // Note On — solo layer 1
    { t: 3501,  type: 0x80, ch: 0, d1: 110, d2: 0   }, // Note Off
    // ...
  ]
}
```

`t` is milliseconds from the start of the recording. Raw MIDI bytes — no interpretation at storage time. The dispatcher plays them back through the normal action pipeline, so any rebinding via MIDI Learn is respected on playback.

Storage key prefix: `midi_take:<id>`. Index in `midi_takes_index` (same pattern as `timelineStorage.js`).

---

### Playback Engine (`src/midi/midiRecorder.js`)

```
Record:
  startRecording()  → arm, capture t0 = performance.now()
  stopRecording()   → save take, return take id
  discardRecording()

Playback:
  play(takeId, opts?: { loop, startAt, speed })
  stop()
  pause() / resume()
  getState() → { playing, paused, currentMs, durationMs, takeId }

Events emitted on window:
  'midi-take-tick'   → { currentMs }   (for a playback position indicator)
  'midi-take-end'    → { takeId }      (for loop trigger or auto-advance)
```

Playback uses a `requestAnimationFrame` loop that checks `performance.now()` against each event's `t` and fires any due events through `MIDIDispatcher`. No `setTimeout` per event — one RAF loop handles all timing to avoid drift at high event density.

For BPM-locked clips: `t` values are stored in **beats** (float) rather than ms. At playback time, `beats × (60000 / bpm)` converts to wall-clock ms. Changing BPM mid-playback automatically stretches the take.

---

### Integration with the Timeline Editor

The Timeline Editor currently sequences presets at a coarse level (30-second blocks). MIDI takes are a finer layer on top:

```
Timeline:   [ Preset A ——————————— ][ Preset B ——————————— ]
MIDI take:  [opacity↑][solo L2][spin+]         [fade out][next]
```

Each timeline entry gains an optional `midiTakeId` field. When the timeline advances to that entry, it starts the associated take from `t=0`. When the entry ends or the take finishes, the take stops.

This is the **full show sequencer** endgame — preset structure from the timeline, granular parameter animation from MIDI takes — but it only requires a small addition to `timelineEditor.js` to wire up.

Defer the actual wiring until the basic record/playback is working reliably (Mode 1 solid first).

---

### Slow Start — What Gets Built When

**First:** Mode 1 only, no UI except a Record button and a Takes list.

| Step | What | Notes |
|------|------|-------|
| 1 | `midiRecorder.js` with `startRecording`, `stopRecording`, `play`, `stop` | No BPM, no loop |
| 2 | Record button in MIDI settings panel; takes list (name, duration, play/delete) | Plain list, no editor |
| 3 | Playback position indicator (scrub bar, time counter) | Read-only |
| 4 | Loop toggle on playback | One checkbox |
| 5 | Export take as JSON / import from file | Backup + sharing |
| 6 | Pre-show cue editor (Mode 2) | Simple event list, no piano roll |
| 7 | BPM-lock quantization on record (Mode 3) | Snap events to nearest beat |
| 8 | Piano-roll view for clip editing | Full editor — long-term |
| 9 | Timeline Editor integration (`midiTakeId` per entry) | Show sequencer endgame |

---

### Phase 1 — MVP: The Two Most Useful Things (start here)

Smallest useful slice. No MIDI Learn UI, no Tauri bridge, no CC knobs yet. Just Web MIDI in Chrome with hard-coded default bindings for the two highest-value contexts.

**1a — Plumbing (shared by everything)**
- [ ] Create `src/midi/actions.js` — unified action registry: each action has `{ id, label, keyboard, midi: { type, number|cc } }`
- [ ] Create `src/midi/midiDispatcher.js` — routes incoming `{type, ch, data1, data2}` to registered action callbacks; keyboard shortcuts feed the same dispatcher
- [ ] Create `src/midi/midiWebTransport.js` — `navigator.requestMIDIAccess()`, forwards messages to dispatcher
- [ ] Create `src/midi/index.js` — runtime detection (`'__TAURI__' in window`), exports active transport

**1b — Main app: Preset navigation**

Wire into `src/main.js`. Three notes, immediately useful for any live set:

| Action | Keyboard | MIDI Note |
|--------|----------|-----------|
| Next preset | `→` *(existing)* | Note 36 |
| Previous preset | `←` *(existing)* | Note 37 |
| Random preset | `R` *(existing)* | Note 38 |

Both the existing `keydown` handler and the new MIDI dispatcher call the same action function — keyboard shortcuts don't move, they just get a second input path.

Also add keyboard companions for the energy slider (new shortcuts, not currently in the app):

| Action | Keyboard (new) | MIDI |
|--------|---------------|------|
| Energy + | `]` | CC 11 (full range) |
| Energy − | `[` | CC 11 (full range) |

Shift+`]` / Shift+`[` = large step (10×). The CC knob covers the full range continuously; `[` `]` give keyboard users the same control in discrete steps.

**1c — Preset Studio: Layer Solo / Mute**

Wire into `src/editor/main.js` (uses `window.__editorInspector`). Add two new methods to `EditorInspector`:
- `toggleLayerSolo(layerIndex)` — extracts the existing inline solo click logic
- `toggleLayerMute(layerIndex)` — extracts the existing inline mute click logic

| Action | Keyboard | MIDI Note |
|--------|----------|-----------|
| Solo Layer 1 | `Shift+1` | Note 110 |
| Solo Layer 2 | `Shift+2` | Note 111 |
| Solo Layer 3 | `Shift+3` | Note 112 |
| Solo Layer 4 | `Shift+4` | Note 113 |
| Solo Layer 5 | `Shift+5` | Note 114 |
| Mute Layer 1 | `Ctrl+1` | Note 120 |
| Mute Layer 2 | `Ctrl+2` | Note 121 |
| Mute Layer 3 | `Ctrl+3` | Note 122 |
| Mute Layer 4 | `Ctrl+4` | Note 123 |
| Mute Layer 5 | `Ctrl+5` | Note 124 |

The keyboard shortcuts are new — they don't exist yet in `editor/main.js`. MIDI and keyboard land together.

**Phase 1 deliverable:** plug in any class-compliant USB MIDI controller in Chrome, hit a pad → next preset. Hit 5 pads → solo/mute image layers in the editor. Nothing else needed.

---

### Phase 2 — Tauri Native Bridge (macOS app parity)
- [ ] Add `midir = "0.9"` to `src-tauri/Cargo.toml`
- [ ] Add `com.apple.security.device.midi` to `src-tauri/entitlements.plist`
- [ ] Add `MidiState` + `midi_list_devices`, `midi_connect`, `midi_disconnect`, `midi_send` commands to `src-tauri/src/main.rs`
- [ ] Create `src/midi/midiTauriTransport.js` — calls Tauri invoke, listens on `tauri://midi-message` events
- [ ] `src/midi/index.js` switches to Tauri transport when `__TAURI__` detected
- [ ] Test on macOS app build with physical controller

---

### Phase 3 — Performance Essentials (main app knobs)
- [ ] Bind energy CC (CC 11, log scale) and volume CC (CC 7)
- [ ] Bind AGC toggle, Kick Lock toggle (CC 80, CC 81)
- [ ] Bind boost note with hold semantics (note-on = on, note-off = off)
- [ ] Add `triggerStrobe`, `triggerBlackout`, `triggerInvert` to `controls.js`
- [ ] Bind strobe / blackout / invert notes

---

### Phase 4 — Editor Layer Sliders
- [ ] Add `setLayerParam(layerIndex, key, value)` to `EditorInspector`
- [ ] Bind active-layer CC map (CC 1–29, per the Image Tab section above)
- [ ] Bind layer select notes (Notes 100–104) to set focused layer index
- [ ] Bind toggle notes (Tile, Group Spin, Edge, Pulse Invert — Notes 80–83)
- [ ] Bind segmented controls (Pan Mode, Mirror, React Source — CC 30–35)

---

### Phase 5 — Cycle + Favorites + UI
- [ ] Bind auto-cycle toggle, interval CC, random order, favorites-only
- [ ] Bind favorite / hide current preset pads
- [ ] Add MIDI indicator icon to control bar
- [ ] Add device picker to Output Settings panel
- [ ] Hot-plug toast (connect/disconnect notification)

---

### Phase 6 — MIDI Learn
- [ ] `MIDIBindingStore` — localStorage CRUD for `Map<{type, ch, data1}, actionId>`
- [ ] Learn-mode UI — a tab in the tuning popover showing the full action list with keyboard + MIDI columns
- [ ] Click any action row → arm it → move controller → binding saved
- [ ] Conflict detection on save; Reset-to-defaults button

---

### Phase 7 — Timeline + Full Editor
- [ ] Add `skipToNext`, `skipToPrev`, `scrubTo` to `TimelineEditor`
- [ ] Bind timeline transport from MIDI
- [ ] Bind editor undo/redo

---

### Phase 8 — MIDI Out / LED Feedback
- [ ] Define LED spec for APC mini, Launchpad, nanoKONTROL
- [ ] Web: send via `MIDIAccess.outputs`; App: via `midi_send` Tauri command
- [ ] Light solo/mute pad LEDs from layer state
- [ ] Drive LED ring intensity from `engine.hypeLevel` at ~30fps

---

## Risks & Edge Cases

| Risk | Mitigation |
|------|-----------|
| Web MIDI requires HTTPS (or localhost) | Already enforced — Coolify is HTTPS, dev is localhost |
| Chrome prompts user for MIDI permission | Show user-friendly pre-prompt modal explaining why, then call `requestMIDIAccess` |
| Tauri macOS app — WKWebView no Web MIDI | Handled by native Rust bridge (Phase 2) |
| `midir` crate + macOS sandbox + hardened runtime | May require additional entitlements; test early |
| High-frequency CC (knob sweep at 60fps) calling `setEnergy` continuously | Throttle CC handlers via `requestAnimationFrame` or 30fps debounce |
| Note On with velocity=0 sent instead of Note Off | Treat velocity=0 Note On as Note Off in `_dispatch` — standard MIDI convention |
| Same CC bound to two actions (MIDI Learn conflict) | Warn user at bind time; highlight conflict in UI |
| Device on channel 1 but DAW also sending on that channel | Add per-channel filter option in MIDI settings |
| Hot-plug: controller disconnects mid-performance | Graceful degradation — keep last state, show reconnect toast |
| Bluetooth MIDI latency | Acceptable for preset control; note it in docs; not suitable for tight timing |

---

## Quick Validation Test (Web)

Before writing any code, confirm Web MIDI works in your dev environment:

```js
// Paste in Chrome DevTools console on localhost:5173
const m = await navigator.requestMIDIAccess();
console.log('Inputs:', [...m.inputs.values()].map(i => i.name));
m.inputs.forEach(i => {
  i.onmidimessage = (msg) => console.log('MIDI:', [...msg.data]);
});
// Move a knob → should log: MIDI: [176, cc#, value]
// Hit a pad → should log: MIDI: [144, note#, velocity]
```

## Quick Validation Test (Tauri App)

In `main.rs`, add a temporary log before wiring the full bridge:

```rust
// In midi_connect callback:
println!("MIDI: {:?}", message);
// Check macOS Console.app or terminal output for incoming messages
```
