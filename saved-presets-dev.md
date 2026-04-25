# Saved Presets Panel — Preset Studio
_Planning document · April 2026_

---

## 1. Goal

Give the Preset Studio (editor.html) a first-class way to **browse, load, and manage all custom presets** — the same library that lives in the main app's "My Presets" tab — without leaving the editor and without breaking anything in the main visualizer.

---

## 2. Current State

| Where | What exists |
|---|---|
| Main app (`index.html`) | Right-side drawer with All / Favorites / My Presets tabs, search, list of presets with context menu (rename, delete, hide, favorite) |
| Preset Studio (`editor.html`) | Save button in footer opens a name-input modal and writes to `localStorage['discocast_custom_presets']` + IndexedDB. No way to browse, load, or switch between previously saved presets while inside the editor. |
| Storage contract | Custom presets are read/written by `src/customPresets.js`. Main app reads the same `localStorage` key. Both layers are already compatible. |

**Gap:** Once a user saves a second preset, there is no way inside the editor to go back to the first one, compare them, or load one as a starting point for a new variation.

---

## 3. UI Pattern Decision

### Options considered

| Option | Pro | Con |
|---|---|---|
| 6th inspector tab ("Presets") | Already inside the sidebar; no new containers | Mixes "creative controls" tabs with "library management"; confusing taxonomy |
| Left-side slide-in drawer (mirroring main app's right drawer) | Familiar pattern from main app; full height gives room for cards | Needs new drawer container; could cover canvas |
| Top header "My Presets" popover button | Light-touch; stays out of the way | Too cramped for a real preset grid |
| **Right-side collapsible panel (recommended)** | Replaces inspector when open; full sidebar space; feels like a second "mode" for the sidebar | Slightly more engineering, but clean separation |

### Recommended: Dual-Mode Sidebar

The 340px right sidebar switches between two modes:

- **Edit mode** — current 5-tab inspector (Palette / Image / Motion / Wave / Feel)
- **Library mode** — full-sidebar preset library panel

A **segment control pinned at the top of the sidebar** (not in the header) toggles between them. Two equal segments: `✏ Edit` | `⊞ Library`. Same visual language as the existing segment controls inside the inspector (mirror mode, echo direction). This keeps the header clean and places the toggle exactly where the content change happens — right at the top of the sidebar itself.

---

## 4. UI Specification

### 4.1 Sidebar Mode Toggle — Segment Control

A two-segment pill control is pinned at the very top of `.editor-panel`, spanning full width, above the inspector tabs:

```
┌────────────────────────────────────┐
│  [ ✏  Edit  |  ⊞  Library ]       │  ← segment control (full-width)
├────────────────────────────────────┤
│  … inspector tabs or library …     │
```

- **Styling**: Same pill/segment pattern used by the existing mirror-mode and echo-direction controls in the inspector — `border: 1px solid rgba(255,255,255,0.12)`, dark fill, active segment gets `background: rgba(255,255,255,0.12)` + white text, inactive gets `#666` text.
- **Transition**: `--transition-fast: 200ms` ease on segment highlight and on content swap.
- **Keyboard shortcut**: `P` toggles between the two modes.
- **Tooltip on Library segment**: "My Presets (P)".
- Header stays completely clean — no extra button added there.

### 4.2 Library Panel Layout

```
┌──────────────────────────────────────┐
│  MY PRESETS          [+ New]  [↑↓ ▼] │  ← panel header
├──────────────────────────────────────┤
│  🔍 Search presets…                  │  ← search input
├──────────────────────────────────────┤
│  Sort: [Recent ▾]     3 presets      │  ← sort row
├──────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐           │
│  │ canvas  │  │ canvas  │           │  ← preset cards (2-col grid)
│  │ preview │  │ preview │           │
│  │         │  │         │           │
│  │My Vibe  │  │Neon Drop│           │
│  │ 3d ago  │  │ 1w ago  │           │
│  └─────────┘  └─────────┘           │
│  ┌─────────┐                        │
│  │ canvas  │                        │
│  │ preview │                        │
│  │         │                        │
│  │Bloom001 │                        │
│  │ 2w ago  │                        │
│  └─────────┘                        │
├──────────────────────────────────────┤
│  [Export All]       [Import]         │  ← footer actions
└──────────────────────────────────────┘
```

### 4.3 Preset Card

Each card:
- **Thumbnail**: 320×180 JPEG captured at save time (see §5.3), displayed at 100% card width with `aspect-ratio: 16/9`. Gradient placeholder for presets saved before this feature.
- **Name**: truncated to 1 line with ellipsis, 12px, `#cccccc`, below the thumbnail.
- **Age**: relative timestamp ("3 days ago"), 10px, `#666666`, same row as name or below.
- **Active indicator**: 2px white top-border on the card + `rgba(255,255,255,0.06)` card background when this preset is currently loaded in the editor.
- **Hover state**:
  - Slight card lift (`transform: translateY(-2px)`, `box-shadow: 0 8px 24px rgba(0,0,0,0.6)`).
  - Three icon-only action buttons fade in over the thumbnail (top-right corner cluster): rename pencil · delete trash. Load is the primary action (whole card click), so it doesn't need a button.
- **Hover popover — "Quick Look"**: After hovering a card for 300ms, a 280×158px enlarged thumbnail floats to the **left of the sidebar**, just outside the panel edge, with the preset name in a small caption bar below it. Disappears instantly on mouse-out. No live preview — static JPEG only, zero render cost. Gives a spacious visual read without any disruption to the canvas.

### 4.4 Loading a Preset

- Click card (anywhere except overlay buttons) → load that preset into the live editor canvas immediately.
- If the current preset has **unsaved changes**, show a small inline confirm inside the card footer before loading: _"Unsaved changes — load anyway?"_ `[Yes]` `[Cancel]` (no full modal; keeps flow light).
- After load, sidebar returns to **Edit mode** automatically so the user can begin tweaking.

### 4.5 Save Flow (improved)

Current flow: footer "Save" button → name-input modal → saved.

New flow:

1. **Save (Cmd+S)**: If the current preset already has an ID (was loaded from the library), **overwrite in place** — no modal, instant save, toast: _"Saved · MyPresetName"_.
2. **Save As… (Shift+Cmd+S)**: Always opens the name-input modal for a new copy.
3. **New preset** (`[+ New]` button in library panel header): Sidebar switches to Edit mode first (200ms fade), then the engine resets to a blank state. User lands directly in the editor experience, ready to build — no canvas flicker visible during the mode transition.

This eliminates the "did I just overwrite it?" ambiguity that exists today.

### 4.6 Rename

- Click `[Rename]` in the card hover overlay → card name becomes an inline `<input>` (same font, same width).
- Confirm with Enter or blur; cancel with Escape.
- No modal needed.

### 4.7 Delete

- Click `[Delete]` → card gets a red tint and a 3-second countdown overlay: _"Deleting in 3… [Undo]"_.
- After 3 seconds with no undo: remove from `localStorage` + IndexedDB + re-render list.
- This is the same soft-delete UX pattern used by Google Photos / Notion — hard to do accidentally, no confirmation modal required.

### 4.8 Sort Options

Dropdown (top-right of panel):
- Recent first (default)
- Oldest first
- A–Z
- Z–A

### 4.9 Empty State

When no custom presets exist yet:

```
      ┌──────────────────┐
      │   🎛️            │
      │   No presets yet  │
      │                  │
      │  Build something, │
      │  then save it.   │
      └──────────────────┘
```

---

## 5. Technical Design

### 5.1 Data Flow (no changes to storage contract)

```
editor.html  ──read/write──▶  customPresets.js
                               │
                               ├── localStorage['discocast_custom_presets']
                               │   (metadata: id, name, baseVals, shapes, waves…)
                               │
                               └── IndexedDB['discocast_images']
                                   (image/GIF blobs keyed by imageId)

index.html   ──read──────────▶  presetRegistry.js
                               (merges bundled presets + customPresets.js output)
```

**The main app is read-only relative to this feature.** The editor already writes; the main app already reads. No new storage keys, no schema changes.

### 5.2 Active Preset State in Editor

Currently `editor/main.js` has no concept of "which saved preset is loaded." We need to add:

```js
// editor/main.js
let activeCustomPresetId = null;  // null = unsaved new preset
let isDirty = false;              // true = unsaved changes exist
```

- Set `activeCustomPresetId` when a preset is loaded from the library.
- Set `isDirty = true` whenever any inspector control changes a value.
- Reset `isDirty = false` on successful save.
- The header preset name `<input>` keeps showing the current name (already exists).

### 5.3 Thumbnail Generation

At save time, draw the live canvas into a fixed-size offscreen canvas and export as JPEG:

```js
const offscreen = document.createElement('canvas');
offscreen.width = 320;
offscreen.height = 180;
offscreen.getContext('2d').drawImage(canvas, 0, 0, 320, 180);
const thumb = offscreen.toDataURL('image/jpeg', 0.7);  // ≈ 15–25 KB
```

**Why 320×180**: Cards are ~154px wide in the 2-col grid (340px sidebar minus padding). At 2× retina density that's exactly 308px — 320px covers it cleanly with a tiny margin. The 16:9 ratio matches the widescreen canvas. JPEG q 0.7 is visually indistinguishable from q 1.0 at thumbnail scale.

Store as optional field `thumbnailDataUrl` on the preset object in localStorage — no new storage key. The main app silently ignores this field.

**Fallback** for presets saved before this feature: a CSS `conic-gradient` or `linear-gradient` placeholder generated from `baseVals.r`, `baseVals.g`, `baseVals.b` colour values already present in every preset.

### 5.4 Library Panel Module

New file: `src/editor/presetLibrary.js`

Responsibilities:
- Load all custom presets from `customPresets.js` CRUD functions.
- Render the 2-col card grid.
- Handle card interactions (load, rename, delete, hover overlays).
- Emit events to `main.js`: `library:load(presetId)`, `library:delete(presetId)`.
- Refresh list when `main.js` emits `preset:saved`.

### 5.5 Sidebar Mode Toggle

In `editor/style.css`, the sidebar already has `.editor-panel` container. Add:

```css
.editor-panel[data-mode="library"] .inspector-tabs { display: none; }
.editor-panel[data-mode="library"] .preset-library  { display: flex; }
.editor-panel[data-mode="edit"]    .inspector-tabs  { display: flex; }
.editor-panel[data-mode="edit"]    .preset-library  { display: none; }
```

Toggle via `panel.dataset.mode = 'edit' | 'library'` in JS.

---

## 6. Non-Breaking Contract with Main App

| Risk | Mitigation |
|---|---|
| Editor saves corrupt data | No change to `customPresets.js` schema; only adds optional `thumbnailDataUrl` field which the main app ignores |
| Editor deletes a preset the main app is currently showing | Main app reads from localStorage at startup and on drawer open — no live subscription needed; deletion is immediately reflected on next open |
| New `activeCustomPresetId` state causes a double-save | Save logic explicitly checks `activeCustomPresetId !== null` before doing an overwrite vs. insert |
| Thumbnail bloats localStorage | Fixed 320×180 JPEG at quality 0.7 ≈ 15–25 KB per preset. 50 presets ≈ 1.25 MB, well within the 5 MB localStorage quota. If quota pressure is ever detected, thumbnails migrate to IndexedDB alongside images — the `thumbnailDataUrl` field becomes a pointer to an IndexedDB key instead. |

---

## 7. Keyboard Shortcuts (new/updated)

| Key | Action |
|---|---|
| `P` | Toggle Library panel / Edit panel |
| `Cmd+S` | Save (overwrite if has ID; prompt for name if new) |
| `Shift+Cmd+S` | Save As… (always prompt for new name) |
| `Escape` (in Library) | Return to Edit mode |

---

## 8. Implementation Phases

### Phase 1 — Sidebar Mode Toggle ✅
- Added `✏ Edit | ⊞ Library` full-width segment control at top of sidebar (`editor.html`).
- Added `data-mode` attribute on `#editor-panel`; CSS shows/hides `.panel-edit-content` / `.panel-library-content`.
- `setMode(mode)` in `main.js` drives the toggle; keyboard `P` also toggles; `Escape` returns to Edit.
- Empty state visible in Library mode when no presets exist.

### Phase 2 — Library Panel Reads Presets ✅
- `src/editor/presetLibrary.js` — new `PresetLibrary` class.
- 2-col card grid rendered from `customPresets.js` `loadAllCustomPresets()`.
- Gradient placeholder thumbnails for cards without a saved JPEG (derived from `baseVals` colours).
- Sort dropdown (Recent / Oldest / A–Z / Z–A) and live search filter wired.
- Count label ("3 presets") in topbar.

### Phase 3 — Load, Rename, Delete ✅
- Card click → `handleLibraryLoad(id)` in `main.js` → `inspector.loadPresetData(preset)`.
- `loadPresetData` fully restores: baseVals, waves, motion, palette + image layers (fetches blobs from IndexedDB, rebuilds layer cards via refactored `_mountLayerCard`).
- Dirty-state guard (`isDirty` flag): prompts before loading over unsaved work.
- After load → auto-switch to Edit mode + toast confirmation.
- Active card highlighted (2px white top-border).
- Hover overlay: rename (inline input, Enter/Escape) and delete (3-second countdown + Undo).
- Quick Look popover (300ms hover → 280×158px thumbnail floats left of sidebar).
- Export All / Import wired in library footer (reuses `exportAllPresets` / `importFromFile`).

### Phase 4 — Save Improvements + Thumbnails ✅
- `captureThumb()` in `main.js`: draws canvas to 320×180 offscreen canvas, exports JPEG q 0.7.
- `inspector.saveCurrent(name, id, thumbDataUrl)` public method: overwrites if `id` set, creates new otherwise.
- `Cmd+S` → overwrite silently (toast: _"Saved · Name"_).
- `Shift+Cmd+S` → always opens Save As modal.
- Save modal confirm re-wired via `_rewireSaveModal()` to capture thumbnail and track `activePresetId`.
- `+ New` button: switches to Edit mode (200ms) then triggers existing Reset flow.

### Phase 5 — Polish ✅ (included in above phases)
- Toast messages on all actions (save, load, rename, delete, export, import).
- Keyboard shortcuts: `P` toggle, `Cmd+S` save, `Shift+Cmd+S` save as, `Escape` close library.
- `isInputFocused()` guard so `P` doesn't fire while typing in name fields.
- `card-active` CSS class on the currently loaded preset's card.

---

## 9. Resolved Design Decisions

All four previously open questions are settled:

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Thumbnail canvas size | **320×180 JPEG q 0.7** | 2× retina for the ~154px card width; 16:9 matches the canvas; ≈20 KB each — predictable, fast, crisp |
| 2 | Panel toggle placement | **Full-width segment control at top of sidebar** (`✏ Edit` · `⊞ Library`) | Same visual language as existing inspector segment controls; keeps header clean; toggle is exactly where the content change happens |
| 3 | "New Preset" flow | **Switch sidebar to Edit mode first (200ms), then reset engine** | User's next action is always editing — drop them straight there; no canvas flicker visible during the CSS transition |
| 4 | Preset preview | **Static JPEG + Quick Look hover popover** | No live preview (shader recompile is disruptive); instead a 280×158px enlarged thumbnail floats left of the sidebar on 300ms hover — spacious, instant, zero render cost |

---

_This document is the planning ground-truth. Implementation work should be tracked against Phases 1–5 above._
