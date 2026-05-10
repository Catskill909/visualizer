---
description: Update the in-app User Guide modal content
---

## Where the help content lives

**One file, one place:**
`/Users/paulhenshaw/Desktop/winamp-screen/index.html`

Search for this exact comment to jump straight to the content:
```
IN-APP HELP CONTENT
```

It is around line 586. Every section below that comment is a `<section data-section="X">` block.

## Section map

| Nav button label | `data-section` value | What to edit |
|---|---|---|
| Welcome | `welcome` | App overview bullets |
| Audio Sources | `sources` | Input types, live venue tips |
| Browsing Presets | `presets` | Search, favorites, hiding |
| Auto-Cycling | `cycling` | Cycle settings |
| Live Performance | `performance` | Hype keys, AGC, tuning panel |
| Output Settings | `output` | Resolution, aspect, fill, virtual camera |
| Preset Studio | `studio` | All layer types and effects — this is the long one |
| Timeline Editor | `timeline` | Blocks, zones, VJ mode |
| Reactivity | `reactivity` | Audio reactivity controls |
| Shortcuts | `shortcuts` | Keyboard shortcut table |
| Tips | `tips` | Quick tips |

## How to add a new feature to the Preset Studio section

1. Open `index.html`
2. Search for `IN-APP HELP CONTENT` to jump to line ~586
3. Find `data-section="studio"` — the Preset Studio section
4. Add a new `<div class="welcome-feature">` block before the **Workflow** feature (which is always last):

```html
<div class="welcome-feature">
  <div class="welcome-feature-title">Your Feature Name</div>
  <p>Short description of what it does and where to find it in the UI.</p>
  <ul class="welcome-list">
    <li><strong>Control name</strong> — what it does.</li>
    <li><strong>Another control</strong> — what it does.</li>
  </ul>
  <p class="welcome-hint">Optional pro tip or gotcha.</p>
</div>
```

## How to add a new top-level section

1. Add a nav button in the `<nav class="welcome-rail">` (around line 572):
```html
<button class="welcome-rail-btn" type="button" role="tab" data-section="mysection">My Section</button>
```

2. Add the content section inside `<div class="welcome-content">`:
```html
<section class="welcome-section" data-section="mysection" role="tabpanel">
  <h4>My Section Title</h4>
  <p>Intro paragraph.</p>
  <div class="welcome-feature">
    <div class="welcome-feature-title">Feature</div>
    <p>Details.</p>
  </div>
</section>
```

## Also update these when adding a feature

- `promo/index.html` — add a feature card in the features grid and/or a bullet in the layer deep-dive
- `shape-overlay-dev.md` (or relevant `*-dev.md`) — dev notes and status
