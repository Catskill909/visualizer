# Visualizer Output System — Dev & Research Doc

**Status**: Phase 1 Research 🔬  
**Scope**: Multi-monitor, projector, and VJ device output for timeline zones and main app player  
**Created**: 2026-05-06  
**Related**: `timeline-editor.md` Phase 5 (timeline-specific implementation)

---

## Overview

The Output System is a **modular subsystem** designed to route visualizer canvas content to external displays. It starts in the timeline editor (per-zone output) but is architected for reuse across the main app player and other output targets.

**Core Design Principles:**
1. **Modular core** — Platform abstraction layer usable by both timeline zones and main player
2. **Progressive enhancement** — Works on web (limited) → Tauri macOS/Windows (full)
3. **VJ-ready** — Supports professional workflows (projectors, NDI, Spout/Syphon)
4. **Zero-copy where possible** — GPU texture sharing > IPC > streaming

---

## Platform Matrix

| Platform | Display Enumeration | Window Positioning | Fullscreen Target | Streaming Method | Status |
|----------|--------------------|--------------------|--------------------|------------------|--------|
| **Web** | `getScreenDetails()` (Window Management API) | `window.open(left,top)` | Limited — popup to coords | `canvas.captureStream()` → `RTCPeerConnection` | Research |
| **macOS (Tauri)** | `availableMonitors()` JS / `Monitor` Rust | `set_position(x,y)` then `set_fullscreen(true)` | ✅ Supported | IPC or Syphon (native) | Research |
| **Windows (Tauri)** | `availableMonitors()` JS / `Monitor` Rust | `set_position(x,y)` then `set_fullscreen(true)` | ✅ Supported | IPC or Spout (native) | Research |

---

## Research Findings

### Web Version — Window Management API

**Key API**: `window.getScreenDetails()` (Chrome/Edge 100+, requires permission)

```js
// Enumerate displays
const screenDetails = await window.getScreenDetails();
for (const screen of screenDetails.screens) {
  console.log(screen.label);      // "Dell U2720Q"
  console.log(screen.left);       // 2560 (position in virtual desktop)
  console.log(screen.top);        // 0
  console.log(screen.width);      // 2560
  console.log(screen.height);     // 1440
}
```

**Popup Positioning**:
```js
// Open window on secondary monitor at (2560, 0)
const popup = window.open(
  '/output.html?zone=full',
  'zone-full-output',
  `popup,width=1920,height=1080,left=2560,top=0`
);
```

**Known Issues**:
- Chrome clamped `left/top` to ≥0 in the past — **test required** on modern Chrome
- Firefox doesn't support `getScreenDetails()` — graceful degradation needed
- User gesture required for `window.open()` with positioning

**Streaming Strategy**:
```js
// Parent window
canvas.captureStream(30); // 30fps
// → RTCPeerConnection (loopback) 
// → MediaStream sent to popup via BroadcastChannel + WebRTC
// Popup receives: videoElement.srcObject = stream
```

**Reference**: [MDN Multi-screen origin](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API/Multi-screen_origin)

---

### macOS (Tauri) — Native App

**Display Enumeration**:
```js
import { availableMonitors, currentMonitor } from '@tauri-apps/api/window';

const monitors = await availableMonitors();
// Monitor: { name, size, position, scaleFactor }
```

**Window Positioning → Fullscreen**:
```rust
// Get target monitor
let monitor = app.available_monitors()
    .find(|m| m.name() == "Projector 1");

// Create window at monitor position, then fullscreen
let window = WindowBuilder::new(app, "output-1", tauri::WindowUrl::App("output.html".into()))
    .position(monitor.position.x as f64, monitor.position.y as f64)
    .build()?;

window.set_fullscreen(true)?;
```

**Issue**: Tauri Issue #6394 confirms there's no direct "fullscreen on specific monitor" API. The `set_position` → `set_fullscreen` workaround is the current pattern.

**Native Streaming Options**:

| Method | Latency | Quality | Complexity | VJ Compatibility |
|--------|---------|---------|------------|------------------|
| IPC (Tauri events) | Medium | Good | Low | Poor |
| Syphon | Near-zero | Best | Medium | Excellent (Resolume, MadMapper) |
| NDI | Low | Best | High | Excellent |

**Syphon (macOS GPU texture sharing)**:
- Rust crate: `syphon`
- Shares OpenGL/Vulkan textures directly between apps
- Resolume, MadMapper, TouchDesigner native support

---

### Windows (Tauri) — Native App

**Display Enumeration**: Same JS API as macOS (`availableMonitors()`)

**Window Positioning**: Same pattern — `set_position` → `set_fullscreen`

**Known Bug**: Tauri Issue #7139 — `set_position` doesn't work correctly between monitors in some cases. Requires testing.

**Native Streaming Options**:

| Method | Latency | Quality | VJ Compatibility |
|--------|---------|---------|------------------|
| IPC | Medium | Good | Poor |
| Spout | Near-zero | Best | Excellent (Resolume, Arena) |
| NDI | Low | Best | Excellent |

**Spout (Windows GPU texture sharing)**:
- C++ SDK + Rust bindings available
- GPU texture sharing (DirectX/OpenGL)
- SpoutCam = virtual webcam receiver
- [spout.zeal.co](https://spout.zeal.co/)

---

## Output Targets Deep Dive

### 1. Monitors (Primary Target)

**Use Case**: VJ with 2-4 displays, timeline zone → dedicated monitor

**Implementation**:
- Web: `window.open()` popup positioned on secondary monitor
- Tauri: `set_position(monitor.x, monitor.y)` + `set_fullscreen(true)`

**Data Flow**:
```
Timeline Zone Canvas
    ↓ captureStream() / native hook
MediaStream / GPU Texture
    ↓ RTCPeerConnection / IPC / Syphon/Spout
Output Window (on target monitor)
    ↓ <video> element or native render
Display
```

---

### 2. Projectors

**Use Case**: Live venue projection mapping, large-scale visuals

**Technical Considerations**:
- Resolution: Often 1024×768, 1920×1080, or 4K
- Connection: HDMI, DisplayPort, SDI (professional)
- No different from monitor output at software level — same APIs apply
- **Edge blending**: Software-level may need shader for multi-projector overlap

**VJ Software Integration**:
- Output to projector via our app → Syphon/Spout → Resolume Arena for edge blending
- Or direct HDMI if single projector

---

### 3. VJ Software (Syphon/Spout/NDI)

**Use Case**: Integrate with professional VJ pipeline (Resolume, TouchDesigner, MadMapper)

#### Syphon (macOS)
```rust
// Publish canvas texture as Syphon server
use syphon::Server;

let server = Server::new("Winamp Visualizer - Zone 1");
server.publish_frame(texture_handle);
```

**Receiver**: Resolume Arena, MadMapper, TouchDesigner, OBS (via plugin)

#### Spout (Windows)
```rust
// Spout SDK bindings
use spout_rust::Sender;

let sender = Sender::new("WinampViz_Zone1");
sender.send_texture(dx_texture_handle, width, height);
```

**Receiver**: Resolume Arena, OBS, Unreal Engine, TouchDesigner

#### NDI (Cross-platform, Network)

**The Professional VJ Solution** — works on **macOS, Windows, and Linux** (web via WASM/native bridge limitations apply).

**SDK Details**:
- **License**: Free for end-users (runtime), free for development (SDK), commercial license available for hardware integration
- **Download**: [ndi.video/for-developers/ndi-sdk](https://ndi.video/for-developers/ndi-sdk/)
- **Language**: C++ SDK with Rust bindings available (`ndi` crate)
- **Platform Support**: ✅ macOS (x64/ARM64), ✅ Windows (x64), ✅ Linux (x64)

**Integration Options**:

| Platform | Method | Viability | Notes |
|----------|--------|-----------|-------|
| **Tauri macOS** | Rust NDI crate via Tauri command | ✅ Full | Best native method |
| **Tauri Windows** | Rust NDI crate via Tauri command | ✅ Full | Same as macOS |
| **Web (Browser)** | ❌ Not possible | ❌ N/A | Browsers cannot access NDI SDK (native code) |
| **Web + Tauri Bridge** | Tauri plugin wrapping NDI | ⚠️ Possible | Web UI → Tauri backend → NDI out |

**Data Flow (Tauri)**:
```
Visualizer Canvas (WebGL)
    ↓ Read pixels or shared texture
Rust Tauri Backend (via tauri::command)
    ↓ ndi::SendInstance
NDI Stream on Network
    ↓ OBS/Resolume receives
"WinampViz/Zone1", "WinampViz/Zone2", etc.
```

**Performance**: ~1-2 frame latency (16-33ms @ 60fps), imperceptible for live VJ use.

**Advantages over Syphon/Spout**:
- Cross-platform (one code path for macOS + Windows)
- Network distributed (OBS on different machine from visualizer)
- No window capture hacks needed
- Automatic discovery (OBS sees sources immediately)

**Trade-offs**:
- Slightly higher latency than GPU texture sharing (Syphon/Spout)
- Requires NDI runtime installed by user (free download)
- CPU/memory overhead for encoding (minimal at 1080p)

**Recommended as primary VJ output method** for multi-zone setups.

---

## Platform Feature Audit

| Feature | Web | macOS Tauri | Windows Tauri | Notes |
|---------|-----|-------------|---------------|-------|
| **Display Enumeration** | ✅ `getScreenDetails()` | ✅ `availableMonitors()` | ✅ `availableMonitors()` | Web limited to browser API |
| **Window Positioning** | ⚠️ `window.open()` | ✅ `set_position()` | ✅ `set_position()` | Web needs validation testing |
| **Fullscreen on Specific Display** | ❌ Limited | ✅ `set_fullscreen(true)` after move | ✅ Same | Web can only position popup |
| **Virtual Camera** | ❌ Not possible | ✅ macOS virtual cam | ✅ Windows virtual cam | Single output only |
| **NDI Output** | ❌ Not possible | ✅ Full SDK | ✅ Full SDK | **Recommended for VJ** |
| **Syphon** | ❌ Not possible | ✅ Native | ❌ N/A | macOS GPU sharing |
| **Spout** | ❌ Not possible | ❌ N/A | ✅ Native | Windows GPU sharing |
| **Canvas to Popup (WebRTC)** | ✅ `captureStream()` | ⚠️ Overkill | ⚠️ Overkill | Web's only option |
| **Multiple Zone Outputs** | ⚠️ 1 per popup | ✅ Unlimited | ✅ Unlimited | Web limited by browser |
| **Projector Direct** | ❌ No | ✅ HDMI/DP auto-detect | ✅ HDMI/DP auto-detect | Native only |

**Platform-Specific Recommendations**:

- **Web Build**: Basic output via `window.open()` popups. Max 1-2 zones practically. No NDI/Syphon/Spout.
- **macOS Build**: NDI primary, Syphon for zero-latency local workflows, avoid WebRTC bridge if possible.
- **Windows Build**: NDI primary, Spout for zero-latency local workflows, same architecture as macOS.

**Feature Removal Decisions**:
- Web: No NDI, no Syphon/Spout, no native fullscreen to specific display. Document as "preview only" output.
- Native (macOS/Windows): Full feature parity, NDI as hero feature for VJs.

---

## Cross-Platform Consistency Audit

### Features Requiring Platform-Specific Treatment

| Feature | Web | macOS | Windows | Special Treatment Required |
|---------|-----|-------|---------|---------------------------|
| **Display Enumeration** | `getScreenDetails()` permission | `availableMonitors()` | `availableMonitors()` | Web: must handle permission denial gracefully; Native: different struct fields |
| **Window Positioning** | Limited (popup coords) | `set_position()` → `set_fullscreen()` | Same | Web: may be clamped to ≥0; Native: Issue #6394 workaround |
| **Fullscreen Target** | ❌ Not possible | ✅ Direct | ✅ Direct | Web: only position popup; Native: seamless exclusive fullscreen |
| **NDI Output** | ❌ Not possible | ✅ Rust crate | ✅ Rust crate | Web: completely absent; Native: unified code path |
| **GPU Texture Sharing** | ❌ Not possible | ✅ Syphon only | ✅ Spout only | macOS: `syphon` crate; Windows: `spout` crate; Different APIs |
| **Virtual Camera** | ❌ Not possible | ✅ macOS APIs | ✅ Windows APIs | Completely different OS APIs; single output only |
| **Canvas Capture** | `captureStream()` → WebRTC | Rust readback → NDI | Same | Web: WebRTC loopback; Native: direct GPU/CPU read |
| **Multiple Outputs** | ⚠️ 1 per popup | ✅ Unlimited | ✅ Unlimited | Web: browser popup limits; Native: native window limits only |

### Known Platform Issues & Workarounds

#### macOS Specific

| Issue | Location | Workaround | Status |
|-------|----------|------------|--------|
| No direct "fullscreen on monitor X" API | Tauri Issue #6394 | `set_position()` → `set_fullscreen(true)` | Documented |
| Simple fullscreen mode (no space) | `set_simple_fullscreen()` | Use for preview, not VJ output | Available |
| Syphon only on macOS | GPU sharing | Spout not available; use NDI for cross-platform | By design |

#### Windows Specific

| Issue | Location | Workaround | Status |
|-------|----------|------------|--------|
| `set_position` fails between monitors | Tauri Issue #7139 | Test thoroughly; may need Win32 fallback | Research needed |
| Spout only on Windows | GPU sharing | Syphon not available; use NDI for cross-platform | By design |
| Virtual Camera support | Windows APIs | Separate from macOS implementation | To research |

#### Web Specific

| Issue | Location | Workaround | Status |
|-------|----------|------------|--------|
| `getScreenDetails()` not in Firefox | Window Management API | Graceful degradation to single display | Handle in UI |
| `window.open()` positioning clamped | Chrome historical bug | Test on modern Chrome; may need user education | Test required |
| NDI/Syphon/Spout impossible | Browser security | Use WebRTC loopback to popup (limited) | By design |
| Fullscreen to specific display | Not possible | Can only position popup; user must manually fullscreen | Document limitation |
| User gesture required | `window.open()` | Ensure output button triggers from user click | Handle in UX |

### Code Path Divergence Points

```
OutputManager
├── detectOutputs()
│   ├── Web: getScreenDetails() or fallback
│   ├── macOS: availableMonitors() (Tauri JS API)
│   └── Windows: availableMonitors() (Tauri JS API) ← Same as macOS
│
├── createOutput(type, target)
│   ├── type: 'monitor'
│   │   ├── Web: window.open() with coords
│   │   ├── macOS: Tauri WindowBuilder + set_position + set_fullscreen
│   │   └── Windows: Same as macOS
│   │
│   ├── type: 'ndi' ← CROSS-PLATFORM (unified!)
│   │   ├── Web: ❌ Not supported
│   │   └── macOS/Windows: Rust ndi crate via Tauri command
│   │
│   ├── type: 'syphon' ← macOS ONLY
│   │   └── macOS: syphon crate
│   │
│   ├── type: 'spout' ← Windows ONLY
│   │   └── Windows: spout crate
│   │
│   └── type: 'virtual-cam' ← Platform-specific APIs
│       ├── macOS: macOS virtual camera APIs
│       └── Windows: Windows virtual camera APIs
│
└── streamCanvas(canvas, output)
    ├── Web: canvas.captureStream() → RTCPeerConnection → popup
    └── Native: Read pixels → NDI/Syphon/Spout encoder
```

### UI Consistency Rules

**Must be identical across platforms:**
- Output Manager modal tile grid layout
- Zone row output indicator icons (🖥️ 📡 🔗 🪟)
- Assignment flow (click tile → select zone → confirm)
- Settings panel structure (Resolution, FPS, Mode)

**Platform-adaptive:**
- Available output types (hide Syphon on Windows, hide Spout on macOS)
- Display naming (web uses `screen.label`, native uses `monitor.name`)
- Warning messages (web shows "Limited output support" banner)
- Feature availability badges ("macOS only", "Windows only", "Not available in browser")

### Testing Matrix

| Test | Web | macOS | Windows | Priority |
|------|-----|-------|---------|----------|
| Enumerate 2+ displays | ✅ | ✅ | ✅ | High |
| Position output on Display 2 | ⚠️ | ✅ | ✅ (test #7139) | High |
| Fullscreen to Display 2 | ❌ | ✅ | ✅ | High |
| NDI: Zone 1 → OBS | ❌ | ✅ | ✅ | **Critical** |
| NDI: 4 zones simultaneously | ❌ | ✅ | ✅ | **Critical** |
| Syphon: Zone → Resolume | ❌ | ✅ | N/A | Medium |
| Spout: Zone → Resolume | ❌ | N/A | ✅ | Medium |
| Virtual Camera → Zoom | ❌ | TBD | TBD | Low |
| WebRTC loopback latency | ✅ | N/A | N/A | Medium |

### Documentation Requirements

**User-facing docs must clarify:**
1. **Web version**: "Output features are limited in browser. For professional VJ use, download the macOS or Windows app."
2. **macOS/Windows parity**: "Both native apps support the same professional features: NDI output, multi-display support, and direct projector connection."
3. **Feature icons**: Tooltip explains "🔗 Syphon (macOS only)" or "🔗 Spout (Windows only)"
4. **Fallback behavior**: What happens when a feature is unavailable (graceful degradation vs. error message)

---

## Core Architecture (Proposed)

### OutputManager (Singleton)

```js
class OutputManager {
  // Platform detection
  platform = 'web' | 'tauri-macos' | 'tauri-windows';
  
  // Display enumeration
  async getAvailableOutputs(): Promise<Output[]>
  
  // Output lifecycle
  async createOutput(target: OutputTarget, source: CanvasSource): Promise<OutputHandle>
  async destroyOutput(handle: OutputHandle)
  
  // Per-platform implementations
  webOutputManager: WebOutputManager;
  tauriOutputManager: TauriOutputManager;
}
```

### OutputTarget Types

```ts
type OutputTarget = 
  | { type: 'monitor', monitorId: string, fullscreen: boolean }
  | { type: 'window', monitorId: string, bounds: { x, y, width, height } }
  | { type: 'syphon', serverName: string }      // macOS only
  | { type: 'spout', senderName: string }         // Windows only
  | { type: 'ndi', sourceName: string };          // cross-platform
```

### CanvasSource

```ts
interface CanvasSource {
  canvas: HTMLCanvasElement;
  zoneId?: string;  // null = main player canvas
  frameRate: number;
}
```

---

## Data Model Integration

### Timeline Extension

```js
// Stored per timeline
{
  zoneId: 'full',
  outputTarget: {
    type: 'monitor',
    monitorId: 'screen-2',  // from getScreenDetails() or availableMonitors()
    fullscreen: true,
    mode: 'window' | 'fullscreen' | 'syphon' | 'spout' | 'ndi'
  }
}
```

### Output Manager Modal UI

A dedicated modal for discovering, configuring, and managing output targets. Similar interaction patterns to the Zone Manager (`#tl-zone-mgr`) but focused on physical/virtual outputs rather than canvas layouts.

### Layout

```
┌─ Output Manager ────────────────────────────────┐
│                                                 │
│  Detected Outputs                    [Refresh]  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │ 🖥️      │ │ 🖥️      │ │ 📡 NDI  │            │
│  │ Display │ │ Display │ │ Network │            │
│  │ 1       │ │ 2       │ │         │            │
│  │         │ │ 🟢 Zone │ │         │            │
│  │[Assign]│ │  "Full" │ │[Assign]│            │
│  └─────────┘ └─────────┘ └─────────┘            │
│                                                 │
│  ─────────────────────────────────────────────  │
│  Active Outputs                      [Disconnect All]│
│  ┌─────────────────────────────────────────────┐│
│  │ 🖥️ Display 2 → Zone "Full"  [⚙️] [✕]        ││
│  │    1920×1080 @ 60fps  │  Fullscreen         ││
│  └─────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────┐│
│  │ 📡 NDI "WinampViz" → Zone "Left"  [⚙️] [✕] ││
│  │    1280×720  │  Network: 192.168.1.45       ││
│  └─────────────────────────────────────────────┘│
│                                                 │
└─────────────────────────────────────────────────┘
```

### Display Tile States

| State | Visual | Action |
|-------|--------|--------|
| **Available** | Gray outline, dim icon | Click → "Assign to Zone" dropdown |
| **Assigned** | Colored border (zone color), green dot | Click → "⚙️ Settings" or "✕ Disconnect" |
| **In Use (other zone)** | Orange border, "In Use" badge | Click → "Take Over" or "View" |
| **Offline** | Disabled opacity, strikethrough | No action, shows "Reconnecting..." |

### Output Types & Icons

| Type | Icon | Badge |
|------|------|-------|
| Monitor | 🖥️ | Resolution (e.g., "2560×1440") |
| Projector | 🎥 | "HDMI" or connection type |
| Window (floating) | 🪟 | "Windowed" |
| Syphon (macOS) | 🔗 | "GPU" |
| Spout (Windows) | 🔗 | "GPU" |
| NDI | 📡 | IP address or "Network" |

### Interaction Flow

1. **Open Modal**: Click **⊘ Outputs** button in transport bar (next to **⊞ Zones**)
2. **Detect**: Auto-enumerates on open; **Refresh** button for manual re-scan
3. **Assign**: Click available display tile → dropdown of zone names → "Assign"
4. **Settings** (gear icon): Configure resolution, frame rate, fullscreen vs window, latency/quality tradeoff
5. **Disconnect**: ✕ removes assignment, output goes dark or returns to standby

### Quick-Assign from Timeline

Alternative entry point — faster for VJ workflow:

```
Zone Row in Timeline Strip:
┌────────────────────────────────────────┐
│ 🎨 Full  [Output: 🖥️ Display 2 ▼]  [+]  │
└────────────────────────────────────────┘
              ↑
        Click dropdown → quick list of outputs
        (shows same tiles as modal, but inline)
```

### Data Model (UI State)

```ts
interface OutputManagerState {
  // Available but unassigned
  availableOutputs: OutputDevice[];
  
  // Currently active assignments
  activeOutputs: {
    outputId: string;
    zoneId: string;
    config: OutputConfig;
    status: 'connecting' | 'streaming' | 'error';
    stats: { fps: number; latencyMs: number };
  }[];
  
  // Modal UI state
  selectedOutputId: string | null;
  showSettingsFor: string | null;
  isScanning: boolean;
}
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close modal |
| `R` | Refresh output list |
| `1-9` | Quick-assign to zone 1-9 (if single output selected) |
| `Delete` / `Backspace` | Disconnect selected output |

### Accessibility

- **Screen reader**: "Display 2, 1920 by 1080, assigned to Full zone, button"
- **Keyboard nav**: Tab between tiles, Enter to select, arrow keys to navigate grid
- **High contrast**: Zone colors have text labels, not just color coding

---

## Per-Zone Output Indicators

When modal is closed, zone rows show current output at a glance:

```
Zone Row (compact):
┌─────────────────────────────────────────────────────┐
│ 🎨 Full                          🖥️2  📡 [●●●]  [+]  │
│     ─────[Preset A]──────[Preset B]───────           │
└─────────────────────────────────────────────────────┘
          ↑                  ↑
    🖥️2 = Display 2    [●●●] = NDI streaming (pulsing)
```

| Indicator | Meaning |
|-----------|---------|
| 🖥️2 | Monitor output, number matches Display 2 |
| 📡 | Network output (NDI) |
| 🔗 | GPU sharing (Syphon/Spout) |
| 🪟 | Windowed output (floating) |
| [●●●] | Live pulse animation when streaming |
| ⚠️ | Error state (red) |

Clicking any indicator opens Output Manager with that zone pre-filtered.

---

## Tile Grid Design (Zone Manager Pattern)

The Output Manager uses the same 3:2 aspect ratio tile grid as the Zone Manager for visual consistency:

### Grid Layout

```
┌─ Output Manager ──────────────────────────────── ✕ ┐
│                                                     │
│  Detected Displays                          [↻]     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  🖥️    │ │  🖥️    │ │  🎥    │ │  📡    │  │
│  │         │ │         │ │         │ │   NDI   │  │
│  │Display 1│ │Display 2│ │Projector│ │ Network │  │
│  │         │ │ 🟢 Zone │ │  HDMI-2 │ │   192.  │  │
│  │[Assign] │ │ "Full"  │ │[Assign] │ │ 168.1.45│  │
│  │1920×1080│ │[Manage] │ │1280×720 │ │[Assign] │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│                                                     │
│  ─────────────────────────────────────────────      │
│  Virtual Outputs                                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│  │  🔗    │ │  🔗    │ │  📡    │              │
│  │  Syphon │ │  Spout  │ │   NDI   │              │
│  │  (macOS)│ │(Windows)│ │  Server │              │
│  │[Create] │ │[Create] │ │[Create] │              │
│  └─────────┘ └─────────┘ └─────────┘              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Tile States (Matching Zone Manager)

| State | Border | Badge/Indicator | Action Button |
|-------|--------|-----------------|---------------|
| **Available** | Gray `#333` | Resolution (e.g., "1920×1080") | `[Assign]` |
| **Assigned** | Zone color (purple/green/etc) | 🟢 + Zone name | `[Manage]` |
| **In Use (conflict)** | Orange warning | "In Use" badge | `[Take Over]` |
| **Offline** | Dim 50% + strikethrough | "Reconnecting..." spinner | Disabled |

### Expanded Tile View (Click to Configure)

```
┌─ Configure: Display 2 ────────────────────────── ✕ ┐
│                                                     │
│  🖥️ Display 2 — 2560×1440 @ 60Hz                    │
│                                                     │
│  Source:  [🎨 Zone: Full        ▼]                 │
│           [○ All Zones (Composed)]                 │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  🖥️2  ┌─────────┐                          │   │
│  │       │  Zone   │  Preview of what will    │   │
│  │       │ "Full"  │  output to this display  │   │
│  │       │(fullscreen)                        │   │
│  │       └─────────┘                           │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Mode:    [● Fullscreen  ○ Windowed]                │
│  Resolution: [Match Display ▼] or [1920×1080 ▼]    │
│  Frame Rate: [60fps ▼]                             │
│                                                     │
│  [Disconnect Output]           [Save & Close]        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Virtual Outputs & OBS Integration

**OBS can receive multiple inputs**, but not through the traditional "Virtual Camera" (which is single). Instead use:

| Method | OBS Source Type | Multiple Inputs? | Latency |
|--------|-----------------|------------------|---------|
| **Virtual Camera** | Video Capture Device | ❌ Single only | Low |
| **NDI** | NDI Source | ✅ Multiple sources | Low |
| **Syphon** (macOS) | Syphon Client | ✅ Multiple | Near-zero |
| **Spout** (Windows) | Spout2 Receiver | ✅ Multiple | Near-zero |
| **Browser Source** | Browser | ✅ Multiple URLs | Medium |
| **Window Capture** | Window Capture | ✅ Multiple windows | Medium |

**Recommendation for OBS users:**
- **Single composed view** → Virtual Camera (existing, simple)
- **Multiple zones to OBS** → NDI or Syphon/Spout (one source per zone)

### Virtual Output Types

```
Virtual Outputs
├─ NDI Server (cross-platform, network discoverable)
│  └─ Each zone appears as separate NDI source: "WinampViz/Zone1"
├─ Syphon Server (macOS only)
│  └─ Named servers: "WinampViz-Zone1", "WinampViz-Zone2"
├─ Spout Sender (Windows only)
│  └─ Named senders: "WinampViz-Zone1", "WinampViz-Zone2"
└─ Virtual Camera (single output only)
   └─ Use for quick "main view to OBS/Zoom" workflow
```

---

## Implementation Phases

### Phase 1 — Core Research (Current)
- ✅ Web: `getScreenDetails()` + `window.open()` positioning
- ✅ Tauri: `availableMonitors()` + `set_position()` + `set_fullscreen()`
- ✅ VJ protocols: Syphon, Spout, NDI identified
- ⏳ Test: Does `window.open(left=2560)` work on multi-monitor Chrome?
- ⏳ Test: Does Tauri `set_position` → `set_fullscreen` work reliably?

### Phase 2 — Web MVP
- `OutputManagerWeb` implementation
- `canvas.captureStream()` → `RTCPeerConnection` → popup
- Output manager UI (monitor tiles)
- Per-zone output assignment

### Phase 3 — Tauri macOS / Windows (Unified)
- `OutputManagerTauri` implementation (shared core)
- Window creation + positioning + fullscreen on both platforms
- **NDI SDK integration** — primary VJ output method
- Rust NDI crate research + Tauri plugin architecture

### Phase 4 — Advanced Native Outputs
- **macOS**: Syphon for zero-latency local workflows
- **Windows**: Spout for zero-latency local workflows
- Fallback IPC streaming for edge cases
- Edge blending shaders (if needed for projector overlap)

---

## Open Questions

### Technical
1. **Web popup positioning**: Does modern Chrome still clamp `left/top` to ≥0?
2. **Tauri monitor targeting**: Is `set_position` → `set_fullscreen` reliable for secondary monitors?
3. **NDI Rust bindings**: Which crate? (`ndi`, `ndirs`, custom FFI?) — **Answered**: Research `ndi` crate
4. **Canvas readback**: WebGL → CPU memory for NDI encoding — performance cost?
5. **GPU memory**: Can we share WebGL textures directly with NDI SDK (GPU acceleration)?

### Product (Answered)
1. ✅ **Main app player outputs?** → Yes, shared OutputManager core
2. ✅ **NDI vs. Syphon/Spout priority?** → NDI primary (cross-platform), Syphon/Spout secondary
3. Should we support output mirroring (same zone to multiple displays)?

---

## Research Deliverables

| # | Task | Platform | Priority |
|---|------|----------|----------|
| 1 | Test `window.open()` positioning on secondary monitor | Web | High |
| 2 | Test `getScreenDetails()` permission flow | Web | High |
| 3 | Test Tauri `set_position` → `set_fullscreen` on macOS | macOS | High |
| 4 | Test Tauri `set_position` → `set_fullscreen` on Windows | Windows | High |
| 5 | Measure WebRTC loopback latency | Web | Medium |
| 6 | Research Syphon Rust bindings | macOS | Medium |
| 7 | Research Spout Rust bindings | Windows | Medium |
| 8 | Evaluate NDI SDK + Rust bindings | macOS/Windows | **High** |

---

## References

### Web APIs
- [MDN: Window Management API](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API)
- [MDN: Multi-screen origin](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API/Multi-screen_origin)
- [MDN: HTMLCanvasElement.captureStream()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)
- [WebRTC samples: Canvas to peer connection](https://webrtc.github.io/samples/src/content/capture/canvas-pc/)

### Tauri
- [Tauri Window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
- [Tauri Issue #6394: Assign window to specific monitor](https://github.com/tauri-apps/tauri/issues/6394)
- [Tauri Issue #7139: set_position between monitors](https://github.com/tauri-apps/tauri/issues/7139)
- [Tauri Positioner Plugin](https://v2.tauri.app/plugin/positioner/)

### VJ Protocols
- [NDI SDK Download](https://ndi.video/for-developers/ndi-sdk/) — NewTek official SDK (free dev license)
- [Awesome NDI](https://github.com/florisporro/awesome-ndi) — NDI tools & SDKs
- [Spout](https://spout.zeal.co/) — Windows GPU texture sharing
- [Resolume Syphon/Spout support](https://resolume.com/support/en/syphonspout)
- [NDI Rust crate](https://crates.io/crates/ndi) — Potential Rust binding (research needed)

---

## Related Docs
- `timeline-editor.md` — Phase 5: Timeline Output to External Displays
- `custom-preset-editor.md` — Visualizer engine internals
