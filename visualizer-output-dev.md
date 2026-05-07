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

## Phased Development Plan with Audits (Main Player First)

### Phase 0 — Architecture & Interface Design (Planning)

**Goal**: Define the complete interface and data model before touching code.

**Deliverables**:
- [ ] Finalize `OutputTarget` TypeScript definitions
- [ ] Design `OutputManager` class interface (platform-agnostic core)
- [ ] Design tile grid UI mockups (all states: Available, Assigned, Conflict, Offline)
- [ ] Define output settings persistence (save/load with presets)

**Audit Checkpoint 0**:
```
□ Interface review: Can OutputManager be used by both main player AND timeline?
□ Platform abstraction: Are platform-specific types (syphon/spout) cleanly separated?
□ UI consistency: Does tile grid match Zone Manager patterns exactly?
□ Data model: Can output assignments persist across app restarts?
```

**Exit Criteria**: All interfaces documented, no code written yet.

---

### Phase 1 — Main Player Single Output (Foundation)

**Goal**: Build output system foundation in stable context (main player).

**Week 1: UI/UX Foundation — Output Manager Modal**
- Extend existing `#btn-output` / `#output-panel` popover → full modal
- Display enumeration (platform detection)
- Tile grid UI (available displays as tiles)
- Single output assignment (main canvas → one display)

**Audit Checkpoint 1a (UI)**:
```
□ Button placement: Output button (O) easily discoverable next to existing controls?
□ Modal flow: Click Output button → tile grid → select display → assign feels natural?
□ Visual feedback: Status dot on button shows active output state?
□ Consistency: Tile grid matches Zone Manager visual language?
```

**Week 2: Output Implementation — Native Window**
- Platform detection: Web vs. Tauri (macOS/Windows)
- Window creation: `set_position()` → `set_fullscreen()` pattern
- Canvas capture: Read pixels from WebGL → stream to output window
- Output lifecycle: Assign → stream → disconnect

**Audit Checkpoint 1b (Technical)**:
```
□ macOS: Window positions correctly on Display 2 and goes fullscreen
□ Windows: Same (watch for Issue #7139 cross-monitor positioning)
□ Canvas capture: 60fps streaming without main UI stutter?
□ Cleanup: Disconnect removes window cleanly, no orphaned processes?
□ Recovery: App restart clears stale outputs gracefully?
```

**Week 3: NDI Prototype (Single Stream)**
- NDI SDK + Rust bindings evaluation
- Single NDI sender: "WinampViz/Main" appears in OBS
- Compare: Native window vs. NDI latency and quality

**Audit Checkpoint 1c (NDI)**:
```
□ Build: NDI SDK compiles with Rust bindings successfully?
□ Discovery: OBS NDI Source list shows "WinampViz/Main" immediately?
□ Stream: Video appears in OBS, smooth playback?
□ Latency: End-to-end <50ms (1-2 frames @ 60fps)?
□ Quality: 1080p60 no artifacts, color accurate?
```

**Phase 1 Exit Criteria**: Main player can output single stream via native window OR NDI with <50ms latency.

---

### Phase 2 — Major Gate (Foundation Validation)

**Goal**: Validate Phase 1 before scaling to timeline.

**Audit Checkpoint 2 (Major Gate)**:
```
□ UI: Output Manager modal feels production-ready?
□ Performance: Single stream has acceptable latency and no frame drops?
□ Stability: 30+ minutes continuous streaming without crash or leak?
□ NDI vs Native: Which is primary output method? (NDI recommended)
□ Decision: GO to timeline scaling OR fix issues first?
```

**Possible Outcomes**:
- **GO**: Foundation solid, proceed to Phase 3 (timeline integration)
- **FIX**: Address issues before scaling (better than debugging N× later)
- **PIVOT**: If NDI bindings fail, fallback to native window-only output

---

### Phase 3 — Timeline Integration (2 Zones)

**Goal**: Extend single-output foundation to per-zone assignment.

**Week 4: Data Model Extension**
- Per-zone output targets in timeline data model
- Zone row output badges (🖥️2, 📡, etc.)
- Quick-assign: Click badge → inline output selector

**Audit Checkpoint 3a (Data)**:
```
□ Schema: Output target embeds cleanly in zone object?
□ Persistence: Timeline JSON saves/loads output assignments?
□ Migration: Old timelines without outputs load gracefully?
```

**Week 5: Multi-Zone Output (2 Zones)**
- Zone A → Display 2 (or NDI "ZoneA")
- Zone B → Display 3 (or NDI "ZoneB")
- Resource management: 2 streams, memory, synchronization

**Audit Checkpoint 3b (Multi)**:
```
□ Assignment: Can assign different zones to different displays?
□ Isolation: Zone A output doesn't affect Zone B output?
□ Performance: 2× 1080p60 streams, no dropped frames on main UI?
□ Conflict: Warning if trying to assign Zone B to Display already showing Zone A?
□ Cleanup: Disconnecting one zone doesn't break the other?
```

**Week 6: Output Manager Timeline Integration**
- Full modal accessible from timeline (same as main player)
- Pre-filtered: Click Zone A badge → Output Manager filtered to Zone A
- Global view: See all assignments at once

**Audit Checkpoint 3c (Integration)**:
```
□ Flow: Timeline badge click → modal → assign → badge updates correctly?
□ Consistency: Same Output Manager component works in both contexts?
□ State sync: Changing output in modal updates timeline badge live?
```

**Phase 3 Exit Criteria**: Timeline supports 2 zones with independent outputs, assignments persist, UI consistent.

---

### Phase 4 — Scale & Advanced Features

**Goal**: 4+ zones, platform optimizations, edge cases.

**Week 7-8: Scale (4+ Zones)**
- Stress test: 4 zones → 4 displays/NDI sources
- Performance monitoring: FPS, memory, CPU
- Error handling: Display unplugged mid-stream

**Audit Checkpoint 4a (Scale)**:
```
□ Performance: 4× 1080p60 NDI streams, main UI still 60fps?
□ Memory: No leaks over 1 hour continuous operation?
□ Unplug: Display removed → zone shows "Offline" → reconnects when available?
□ Resolution change: Changing output resolution recreates stream cleanly?
```

**Week 9-10: Platform-Specific Outputs**
- **macOS**: Syphon for zero-latency local workflows
- **Windows**: Spout for zero-latency local workflows
- UI: Hide/show Syphon/Spout tiles based on platform

**Audit Checkpoint 4b (Platform)**:
```
□ macOS: Syphon sender works in Resolume (alternative to NDI)?
□ Windows: Spout sender works in Resolume?
□ UI: Only relevant output types shown per platform?
□ Latency: Syphon/Spout near-zero as expected?
```

**Week 11-12: Edge Cases & Polish**
- Same zone to multiple outputs (mirroring)
- Composed output (all zones to one display)
- Advanced settings: Resolution override, FPS limit, color space

**Audit Checkpoint 4c (Edge Cases)**:
```
□ Mirror: Can assign Zone A to both Display 2 AND Display 3?
□ Composed: "All Zones" option outputs full canvas with layout?
□ Settings: Per-output resolution/FPS overrides work correctly?
```

**Phase 4 Exit Criteria**: Production-ready with 4+ zones, error handling, platform optimizations.

---

### Phase 5 — Final Audit & Release

**Goal**: Verify complete system before release.

**Final Audit Checkpoint 5**:
```
□ Main Player: Single output stable, UI polished
□ Timeline: 2-4 zone output works, assignments persist
□ NDI: Primary method works cross-platform (macOS + Windows)
□ Syphon/Spout: Secondary method available on respective platforms
□ UI: Consistent between main player and timeline contexts
□ Performance: 4× 1080p60 NDI, no dropped frames, <50ms latency
□ Documentation: User docs explain OBS/Resolume setup
□ Error handling: All failure modes have clear user messaging
```

**Release Criteria**: All audit checkpoints passed, production-ready.

---

## UI/UX Placement in Main Player (index.html)

### Current State
The main player already has an **Output Settings** button (`#btn-output`) with popover (`#output-panel`) at lines 280-346:
- Location: Transport bar, after Preset Drawer, before Preset Studio
- Current controls: Resolution, Aspect Ratio, Fill Mode, Virtual Camera toggle
- Status dot (`#output-status-dot`) shows active state

### Recommended Evolution

**Phase 1 (Immediate)**: Extend existing popover → **Output Manager modal**

```
Current:                            Proposed Phase 1:
┌─ Output Settings ─────────┐       ┌─ Output Manager ────────────────────┐
│ Resolution               │       │ Detected Displays               [↻]  │
│ Aspect Ratio             │       │ ┌─────────┐ ┌─────────┐              │
│ Fill Mode                │   →    │ │ 🖥️      │ │ 🖥️      │              │
│ Virtual Camera [toggle]  │       │ │Display 1│ │Display 2│              │
│                          │       │ │[Assign] │ │[Assign] │              │
└──────────────────────────┘       │ └─────────┘ └─────────┘              │
                                    │                                      │
                                    │ Active Output:                       │
                                    │ 🖥️ Display 2 → Main  [⚙️] [✕]       │
                                    └──────────────────────────────────────┘
```

**Phase 3+ (Timeline)**: Same modal, but with **source selector** (which zone/main player)

### Button Placement Options

| Option | Location | Pros | Cons |
|--------|----------|------|------|
| **A: Current** (keep) | Transport bar after Presets | Already exists, users know it | Small, might be overlooked |
| **B: New dedicated** | Separate "Outputs" button with ⊘ icon | Very discoverable | Adds button to already busy bar |
| **C: Dropdown merge** | Merge with existing Output Settings | Minimal UI change | Harder to discover multi-output |

**Recommendation: Option A (Current) with visual upgrade**
- Keep `#btn-output` location (muscle memory for existing users)
- Upgrade popover → full modal
- Add animated status dot for active outputs
- Tooltip changes: "Output Settings (O)" → "Output Manager (O)" when modal opens

### Status Indicators

**Button Status Dot (`#output-status-dot`)**:
- **Gray/off**: No active outputs
- **Green pulsing**: 1+ outputs active
- **Orange**: Output error (display disconnected, stream failed)

**Transport Bar Mini-Indicator** (optional):
```
[🎵 Audio] [🎨 Shift] [🖥️ 2] [⊞ Zones] [⚙ Output] [✎ Studio]
          ↑              ↑
     Current preset   "2 outputs active" badge
```

---

## Audit Summary Table (Main Player First)

| Phase | Checkpoint | Gate Type | Context | Focus |
|-------|-----------|-----------|---------|-------|
| 0 | Interface Design | Review | Planning | Core architecture |
| 1a | UI Foundation | UX | Main Player | Modal, tile grid, button placement |
| 1b | Single Output | Technical | Main Player | Native window, canvas capture |
| 1c | NDI Prototype | Technical | Main Player | NDI SDK, single stream |
| 2 | Major Gate | Decision | Main Player | Foundation validation before scaling |
| 3a | Data Model | Technical | Timeline | Per-zone output persistence |
| 3b | Multi-Zone (2) | Technical | Timeline | 2 streams, isolation, conflicts |
| 3c | Timeline UI | UX | Timeline | Badge integration, modal filtering |
| 4a | Scale (4+) | Technical | Timeline | Performance, memory, unplug handling |
| 4b | Platform Outputs | Technical | Both | Syphon/Spout integration |
| 4c | Edge Cases | UX | Both | Mirroring, composed, advanced settings |
| 5 | Final Release | Review | Both | Production readiness |

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
