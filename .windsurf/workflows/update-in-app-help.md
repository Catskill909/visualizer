---
description: Update the in-app User Guide modal content
---

## Where the help content lives

**One file, one place:**
`/Users/paulhenshaw/Desktop/winamp-screen/index.html`

Search for this exact comment to jump to the content:
```
IN-APP HELP CONTENT
```

It is around line 678. Every section below that comment is a `<section data-section="X">` block.

## New Navigation Structure (2026-05-28)

The help modal has been redesigned with:
- **Search bar** at the top of the rail
- **Grouped sections** with visual dividers
- **Icons** on all navigation items
- **Expandable subsections** for Preset Studio and Timeline Editor
- **Subsection navigation** via child buttons

### Top-level Groups

| Group | Sections |
|-------|----------|
| **Quick Start** | Welcome, Tips & FAQ |
| **Core Features** | Audio Sources, Live Performance, Audio Reactivity |
| **Presets** | Browse & Favorites, Auto-Cycling |
| **Creative Tools** | Preset Studio (expandable), Timeline Editor (expandable) |
| **Output** | Display Settings, Keyboard Shortcuts |

## Section map

| Nav button label | `data-section` value | Subsections available |
|---|---|---|
| Welcome | `welcome` | — |
| Tips & FAQ | `tips` | — |
| Audio Sources | `sources` | — |
| Live Performance | `performance` | — |
| Audio Reactivity | `reactivity` | — |
| Browse & Favorites | `presets` | — |
| Auto-Cycling | `cycling` | — |
| Preset Studio | `studio` | `overview`, `palette`, `motion`, `layers`, `effects`, `text` |
| Timeline Editor | `timeline` | `overview`, `blocks`, `vjmode`, `multitrack`, `markers` |
| Display Settings | `output` | — |
| Keyboard Shortcuts | `shortcuts` | — |

## How to add a feature with subsections

1. Add `data-subsection` attributes to feature blocks:
```html
<div class="welcome-feature" data-subsection="effects">
  <div class="welcome-feature-title">Effect Name</div>
  ...
</div>
```

2. Add child buttons in the rail:
```html
<button class="welcome-rail-child" type="button" data-section="studio" data-subsection="effects">Effects</button>
```

## How to make features collapsible

Add the `collapsible` class and wrap content in `feature-content`:

```html
<div class="welcome-feature collapsible" data-subsection="myfeature">
  <div class="welcome-feature-title">Feature Name</div>
  <div class="feature-content">
    <p>Description...</p>
    <ul class="welcome-list">...</ul>
  </div>
</div>
```

## Feature badges

Add badges to feature titles for visual hierarchy:

```html
<div class="welcome-feature-title">
  Feature Name
  <span class="feature-badge feature-badge--new">New</span>
</div>
```

| Badge class | Use for |
|-------------|---------|
| `feature-badge--new` | Recently added features |
| `feature-badge--pro` | Advanced/power user features |

## Quick links grid (Welcome section)

Use the quick grid for main entry points:

```html
<div class="welcome-quick-grid">
  <div class="welcome-quick-card" data-section="studio">
    <span class="welcome-quick-card-icon">🎨</span>
    <div>
      <div class="welcome-quick-card-title">Preset Studio</div>
      <div class="welcome-quick-card-desc">Build custom presets</div>
    </div>
  </div>
  ...
</div>
```

## Also update these when adding a feature

- `promo/index.html` — add a feature card in the features grid
- Relevant `*-dev.md` files — dev notes and status
