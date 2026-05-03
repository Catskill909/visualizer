# Live Audio Device Selection

Adding support for external audio inputs (like a USB DJ Controller, audio interface, or line-in) requires interfacing with the browser's audio hardware access.

## Implementation (Shipped)

Built from scratch using the native `navigator.mediaDevices` API (Option 1 from the original brainstorm below). No external packages.

### Device Picker Modal

Every time the user clicks **Live Audio** (or switches back to mic via the control bar), a custom device picker modal appears — the user must explicitly choose a device each session. This bypasses the browser's default behavior of silently reusing the last-granted device, which caused confusion when multiple audio devices were connected (e.g. a USB DJ controller + built-in mic).

**Flow:**

```
User clicks "Live Audio"
    │
    ▼
getUserMedia({ audio: true })  ← triggers browser permission prompt (first visit only)
    │
    ▼
Temp stream stopped immediately (we only needed permission to enumerate labeled devices)
    │
    ▼
enumerateDevices() → filter audioinput
    │
    ├── 0 devices → connect with default (fallback)
    ├── 1 device  → connect directly (skip picker)
    └── 2+ devices → show device picker modal
                        │
                        ▼
                   User picks device, clicks "Connect"
                        │
                        ▼
                   connectMicrophone(deviceId)  ← uses { deviceId: { exact: id } }
                        │
                        ▼
                   Control bar dropdown synced from actual stream track settings
```

**Key design decisions:**

- **Always show the picker** (when ≥ 2 devices exist) — never auto-select from localStorage or browser memory. This is intentional for live DJ setups where the correct input changes between gigs.
- **Sync from actual stream** — after connection, the control bar `<select>` dropdown reads the connected device ID from `stream.getAudioTracks()[0].getSettings().deviceId`, not from the originally-requested ID. Chrome can remap device IDs between `enumerateDevices()` calls, so the stream's own report is the source of truth.
- **Toast shows actual device name** — e.g. "🎤 Connected: Direct Mix USB 3" — so the user gets immediate confirmation of what's actually connected.
- **Single-device shortcut** — if only one audio input exists, the picker is skipped and it connects directly (no unnecessary modal for simple setups).
- **Escape dismisses** — the modal respects the app-wide Escape key handler.
- **Switch mode** — clicking the "Live" button in the control bar (when already using a file source) also shows the picker, not just the initial launch.

### Files Changed

| File | What changed |
|------|-------------|
| `index.html` | Added `#device-picker-modal` with radio-button list UI |
| `src/style.css` | `.device-picker-*` styles (radio indicators, selected/hover states, glassmorphic dark theme) |
| `src/controls.js` | `startWithMic()` rewritten to enumerate→pick→connect; new methods: `_showDevicePicker()`, `_closeDevicePicker()`, `_confirmDevicePicker()`, `_connectMicAndEnter()`, `_getActualDeviceId()`; `switchToMic()` also shows picker; `populateDeviceList(selectedDeviceId)` now accepts optional param |
| `src/visualizer.js` | `connectMicrophone()` logs actual connected device label + ID to console for debugging |

### Control Bar Dropdown

After the device picker connects, the existing `#device-select` dropdown in the control bar still works for switching devices mid-session without reopening the modal. The picker is only forced on initial connection (clicking "Live Audio" from start screen or switching from file mode).

---

## Original Research (Archived)

The original brainstorm evaluated three approaches:

### Option 1: Native Web Audio API (Vanilla JS) ✅ CHOSEN
The modern browser provides `navigator.mediaDevices.enumerateDevices()`. ~15 lines of JS to fetch device lists and push into a UI.

- **Zero dependencies** — adds 0 bytes to bundle size
- **Perfect UI integration** — full control over glassmorphic styling
- **Direct control** — no middleman code to debug

### Option 2: WebRTC / Audio Abstraction Packages
Libraries like `recordrtc` or `Tone.js` abstract `getUserMedia` boilerplate.

- **Overkill** — designed for recording/streaming, not device selection
- **No UI included** — still need to build the dropdown ourselves
- **Bundle bloat** — 100kb+ for a device list

### Option 3: Pre-built UI Components
Web components like `<audio-device-select>`.

- **Styling clashes** — shadow DOM CSS conflicts with our glassmorphism
- **Framework lock-in** — most are React/Vue only; we're vanilla JS

### Conclusion
Built from scratch using Option 1. The native API is modern, simple, and standard. Zero dependencies, perfect aesthetic match, no recording/streaming bloat.
