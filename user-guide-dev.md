# User Guide — Dev Plan

> **Goal:** Replace the current in-app welcome modal guide with a standalone, searchable, beautifully designed help centre. Then add contextual `?` entry points throughout the app that deep-link into exact sections.

---

## Phase 1 — Standalone Searchable Help Centre

### What we're building

A dedicated `/help` page (or `/help.html`) — separate from the promo site and the app — that serves as the authoritative user guide. Modern, fast, no framework needed.

### Content structure (sections)

```
Getting Started
  Quick start (load a song, pick a preset, go)
  Interface overview (annotated screenshot)
  Keyboard shortcuts master list

Preset Studio — Editor
  Opening the editor
  Image layers
    Adding / removing / reordering
    Solo & Mute
    Collapse / expand cards
    Reset a layer
  Transform controls
    Size, Angle, Skew X/Y, Persp X/Y
    Tile Width & Height
  Motion controls
    Spin, Orbit (Circle / Lissajous)
    Tunnel + Depth Stack
    Bounce, Beat Shake, Sway, Wander, Pan
  Visual Effects
    Tint & Hue Spin
    Chromatic Aberration
    Posterize
    Edge / Sobel
    Mirror (per-tile vs whole-image)
    Blend modes
  Audio Reactivity
    Reactivity source (Bass / Mid / Treble / Volume)
    Reactivity curve
    Opacity Pulse, Strobe
  Workflow
    Undo / Redo
    A/B compare
    Save & load presets
    Focus / Preview mode
    HD uploads

Output Settings
  Render resolution
  Aspect ratio
  Fill mode
  Virtual camera (OBS)

Performance
  Dev HUD (backtick)
  VRAM & layer count guidance
  Mobile tips

Tips & Combos (curated examples)
  Neon line-art (Edge + Tint + Hue Spin)
  3D parallax tunnel (Tunnel + Depth Stack)
  Floor grid (Tile + Persp Y)
  Animated GIF tricks
```

### UI/UX design spec

**Layout**
- Two-column desktop: fixed left sidebar (section tree, collapsible groups) + scrolling right content area
- Mobile: sidebar collapses to a hamburger drawer
- Sticky topbar: logo, search input, "Back to app" button

**Search**
- Client-side full-text search — no server needed
- Library: [Fuse.js](https://fusejs.io/) (tiny, zero deps, fuzzy matching)
- Search highlights matches inline with `<mark>` tags
- Results appear as a floating list; clicking jumps to that heading and highlights the section briefly
- Keyboard: `⌘K` or `/` focuses search from anywhere

**Typography & visual style**
- Dark theme matching the app (`#111` background, `#1d1d1f` cards)
- Purple accent (`#a78bfa`) for active states, links, highlights — matches editor
- System font stack — no web font load
- `h2` = section title, `h3` = subsection, feature cards same `.welcome-feature` pattern from existing guide but bigger and breathable
- Keyboard shortcut pills: `<kbd>` styled as dark rounded chips
- Screenshots / GIFs: lazy-loaded, captioned

**Deep-link anchors**
- Every `h2` and `h3` gets a stable `id` (e.g. `#edge-sobel`, `#depth-stack`, `#persp-x-y`)
- Sidebar highlights the current section on scroll (Intersection Observer)
- URL updates to `#anchor` on scroll so users can copy/share a direct link

**Content format**
- Pure HTML + CSS — no build step, no framework
- Same pattern as `promo/index.html` — easy to deploy on Coolify alongside the promo page
- Illustrated with annotated screenshots where useful (can add progressively)

---

## Phase 2 — In-app `?` Contextual Help

### How it works

Each `?` icon in the app opens a **lightweight help modal** (not a new tab) that shows the relevant section content inline. The modal:

- Pulls its content from the help page by `fetch()`-ing the relevant `#anchor` section
- OR (simpler first pass): embeds a short summary directly in the JS/HTML and links "Read more →" to the full help page anchor

### Placement map — where `?` icons go

| Location in app | Help anchor |
|---|---|
| Editor topbar | `#editor-overview` |
| Image layer card header | `#image-layers` |
| Transform section (Skew / Persp labels) | `#transform-controls` |
| Tunnel slider | `#tunnel-depth-stack` |
| Depth slider | `#depth-stack` |
| Edge toggle | `#edge-sobel` |
| Audio Reactivity section header | `#audio-reactivity` |
| Mirror section header | `#mirror` |
| Output settings panel | `#output-settings` |
| Preset Studio save button area | `#save-load` |
| Focus mode button | `#focus-mode` |

### Modal design
- Small, dismissible with Escape or backdrop click
- Max width ~480px, centered or anchored near the `?` icon
- Shows: **title**, **2–3 sentence summary**, **key bullet points**, **"Full guide →" link**
- Same dark card style as onboarding modal (reuse `.onboarding-modal` CSS pattern)
- `?` buttons: 16px circle, `rgba(255,255,255,0.15)` background, purple on hover — subtle, never in the way

---

## Implementation order

1. **Write all help content** (can be done in parallel with app work) — Markdown first, then convert to HTML
2. **Build `/help.html`** — sidebar layout, section content, anchor IDs
3. **Add Fuse.js search** — index all section text at page load, wire to search input
4. **Style pass** — dark theme, kbd pills, code blocks, screenshots
5. **Deploy to Coolify** — alongside promo page
6. **Add `?` icons to app** — editor topbar first, then per-section as we go
7. **Wire modal** — fetch/embed content, link to full guide

---

## Open questions

- **Same domain as promo?** (`discocast.app/help`) or separate? Same is cleaner — one Coolify deployment.
- **Screenshots:** static PNG or short looping video (`.webm`)? Start with PNG, upgrade to video for complex controls.
- **Versioning:** does the help page need to track app version? Probably not — keep it evergreen, update content as features ship.
- **Search index format:** build it from the DOM at runtime (Fuse.js walks headings + paragraphs) or pre-build a JSON index? Runtime is fine at this content volume.

---

## What the current in-app guide becomes

The existing welcome modal (`index.html` welcome sections) stays as-is for now — it's a good first-run orientation. Long term it becomes a "Quick Start" summary that points to the full help page for depth. We don't touch it until Phase 1 of the help centre is live.
