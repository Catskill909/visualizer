# Layer Header Redesign — Planning & Options

## Current State

```
[ ⠿ ] [ ▾ ] [ thumb 48×48 ] [ #1 ] [ name input .............. ] [ Solo ] [ Mute ] [ ↺ ] [ 🗑 ]
─────────────────────────────────────────────────────────────────────────────────────────────────
[ Blend ▾ ]  Tile ●   ← one inline row, immediately cramped
[ Opacity ───────────────────────────── ] 0.00
[ Size    ───────────────────────────── ] 0.00
```

**Pain points:**
- Everything is stuffed into a single 64px-tall header row — almost no breathing room.
- Thumbnail is tiny (48×48) and loses detail.
- Name input gets squeezed between the thumbnail and the action buttons.
- Solo / Mute / Reset / Delete are four buttons fighting for the same horizontal strip as the name.
- Adding "Duplicate" would make the header row unworkably wide.
- The `#1` badge and HD badge feel like afterthoughts.

---

## Design Options

### Option A — Two-Row Header

Split the header into **two stacked rows**:

```
Row 1:  [ ⠿ ] [ ▾ ] [ thumb 56×56 ] [ #1 (HD) ]  [ name input .............. ]
Row 2 (right-aligned):               [ Solo ] [ Mute ] [ Dupe ] [ ↺ ] [ 🗑 ]
```

- Thumb grows to ~56–64px.
- Name gets the full mid-column width (no competition with action buttons).
- Action buttons live on their own row — easy to read, easy to add more.
- Row 2 is subtly de-emphasized (smaller font, lower opacity at rest, lifts on hover).
- Header click-to-collapse still works on the whole area.
- **Pro:** Most scannable, cleanest hierarchy.
- **Con:** Header is taller (~80–88px); 5 stacked cards will push further down the panel.

---

### Option B — Large Thumb + Side Panel (Two Columns)

```
┌─────────────────────────────────────────────────────────────┐
│  [ ⠿ ] [ ▾ ]  [ THUMB 72×72 ]    [ name input ........... ] │
│                                   [ Solo ] [ Mute ]          │
│                                   [ Dupe ] [ ↺ ] [ 🗑 ]     │
└─────────────────────────────────────────────────────────────┘
```

- Thumbnail jumps to ~72×72 — actually useful for recognition.
- Right column: name on top row, then action buttons beneath, neatly grouped.
- No separate "row 2" — all packed into right side of a taller single card.
- **Pro:** Very compact height vs. Option A; thumb is properly large.
- **Con:** Action buttons are smaller targets; more css grid work needed.

---

### Option C — Full-Width Header + Pill Action Bar

```
Row 1:  [ ⠿ ] [ ▾ ] [ thumb 72×72 ] [ name input ............. ] [ #1 ] [HD]
Row 2 (inset pill):  [ Solo ] [ Mute ] [ ── Duplicate ── ] [ Reset ] [ Delete ]
```

- Row 2 is a full-width pill/toolbar, bottom of the header, with more generous button sizing.
- Buttons get labels + icons (not just icons).
- This row is always visible (not collapsed) even when card is collapsed — so you can Mute without opening.
- **Pro:** Best button affordance; easy to extend; mute/solo accessible even when collapsed.
- **Con:** Tallest option (~96px+ header); action bar may feel like a separate UI widget.

---

### Option D — Compact Two-Row (Recommended ✓)

A refined version of A — keeps total height controlled while giving everything space:

```
Row 1:  [ ⠿ ]  [ thumb 64×64 ]  [ name input .............. ]  [ ▾ ]
Row 2:          [ #1 ] [HD]      [ Solo ] [ Mute ] [ Dupe ]     [ ↺ ] [ 🗑 ]
```

- Thumbnail: **64×64** — a real preview, not a postage stamp.
- Name input fills the full mid-zone of Row 1 — no competition.
- Row 2 is a compact meta + actions bar: left side has index/HD badges, right side has all action buttons.
- Chevron moves to far-right of Row 1 (natural "expand" affordance).
- Drag handle stays far-left of Row 1.
- Row 2 height: ~28px, tightly styled.
- Collapsed state: Row 2 can still show, or hide — TBD.
- **Pro:** Clean hierarchy, logical grouping, still fits 5 cards on a normal screen.
- **Con:** Slightly more complex HTML layout than current.

---

## Proposed Button Set (all options)

| Button | Trigger | Notes |
|--------|---------|-------|
| **Solo** | Toggle | Warm gold when active |
| **Mute** | Toggle | Grey when active |
| **Duplicate** | Action | Copies entry + resets position; NEW |
| **Reset** | Action | ↺ icon, undoable |
| **Delete** | Action | 🗑 icon, immediate |

Order recommendation: `Solo · Mute · Dupe · ↺ · 🗑` — destructive actions always rightmost.

---

## Thumbnail Size Options

| Size | Notes |
|------|-------|
| 48×48 (current) | Too small — GIFs and detailed images lose all detail |
| 64×64 | **Recommended** — good balance, 4× the pixel area vs current |
| 72×72 | Best for recognition but adds height on all 5 layers |
| 80×56 (wide) | Letterbox ratio — good for landscape images, awkward for portraits |

---

## CSS Strategy

- Change `.layer-header` from `display: flex` (single row) to `display: grid` or nested flex rows.
- `.layer-thumb`: grow to 64×64 (or 72×72).
- New `.layer-header-row1` and `.layer-header-row2` wrappers.
- `.layer-actions` stays flex, moves to Row 2.
- `.layer-meta` simplifies — just the name input in Row 1, badges move to Row 2.
- No JS changes needed beyond the HTML template update in `_mountLayerCard`.

---

## Questions to Decide Before Building

1. **Which option?** Leaning D (Compact Two-Row) — confirm.
2. **Thumbnail size?** 64×64 or 72×72?
3. **Should Row 2 (actions) still show when card is collapsed?** If yes → mute/solo are accessible without expanding. If no → simpler, cleaner collapsed state.
4. **Duplicate button label?** Icon-only (⧉), text "Dupe", or "Copy"?
5. **Should the chevron stay left (current) or move to far-right?** Far-right is more conventional (accordion UX).
