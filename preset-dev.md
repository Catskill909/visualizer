# Preset Drawer — Hide + Icon Visibility

> **Status:** ✅ Shipped. This doc is kept for context — Future Enhancements at the bottom are still parked.

## Goal

The ~1,144 Butterchurn presets are bundled (immutable). Some are low quality — flat colors, broken shaders, visual noise. Users need a way to remove them from view without pretending we can truly delete them. We also need the heart/hide affordances in the drawer list to actually be visible.

No import. No custom presets. Hide-only.

## Scope

1. Add a **hide** capability mirroring favorites (localStorage Set, icon in row, toggle).
2. Filter hidden presets out of the All tab, random, and auto-cycle.
3. Add a small **Show hidden** switch in the drawer header so users can unhide.
4. Confirm destructive actions (bulk unhide-all) with a clean modal — single-preset hide/unhide is toggle-only, no confirm.
5. Brighten the heart + hide icons so they're actually perceivable in the list.

---

## Data model

New localStorage key:

- `discocast_hidden` — JSON array of preset names, loaded as a `Set` in memory.

Mirrors the existing `discocast_favorites` pattern exactly:
- `loadHidden()` / `saveHidden()` / `toggleHidden(name)` in [src/controls.js](src/controls.js)
- Graceful fallback to empty Set on parse error.

## Filtering rules

In [populatePresetList()](src/controls.js#L606):

| Tab | Shows |
|---|---|
| All | `names` minus `hidden` (unless **Show hidden** is on) |
| Favorites | `favorites` (unaffected by hide — if someone hid a favorite, it still shows here) |
| Hidden-only view | Only when **Show hidden** toggle is on; hidden items render with a dimmed/strikethrough style |

In the engine — [src/visualizer.js](src/visualizer.js) cycle/random logic — hidden presets must also be excluded:
- `cycleNext`, `cycleRandom`, `randomPreset`, and the manual next/prev transport all skip hidden names.
- Cleanest path: add `setHiddenPool(names)` on the engine, mirroring `setFavoritePool`, and wire `syncHiddenPool()` in the control panel.
- Edge case: if user hides *every* preset, cycling falls back to the full unfiltered list rather than locking up.

## UI — drawer row

Each `<li>` gets a **second icon** next to the heart:

```
[ preset name ................................. ♥   ⊘ ]
```

- `♥` heart — favorite (existing)
- `⊘` eye-slash — hide (new)

Icons use the same reveal-on-hover pattern but **brighter** — see CSS section below.

Click on `⊘` → `toggleHidden(name)` → row fades out with a 200ms transition, then `filterPresets()` re-renders. Toast: `🙈 Hidden`.

When **Show hidden** is on, hidden rows appear in the All list with:
- reduced opacity (e.g. `0.45`)
- the hide icon filled / highlighted (indicates current state)
- click on the hide icon while in this state unhides immediately. Toast: `👁 Unhidden`.

## UI — drawer header

Add a single control line between tabs and count:

```
[ All Presets ] [ Favorites ]
[ 1144 presets ]                        👁 Show hidden ⎯○
```

Small switch using the existing `.switch` component (same as auto-cycle in the cycle popover). Off by default.

When turned on:
- Count updates to `1144 presets (23 hidden)` style.
- Hidden rows appear mixed in, styled as above.
- A small `Unhide all` text button appears next to the switch. This one **does** open a modal confirm — it's the only bulk destructive action.

## Modal — Unhide All confirm

Full-screen modal, same visual pattern as [#keyboard-guide](src/style.css#L405). Class: `.modal` on the backdrop, `.modal-dialog` on the card. Reuse existing design tokens (`--bg-glass`, `--radius-xl`, `scaleIn` animation).

```
┌──────────────────────────────────┐
│  Unhide all presets?             │
│                                  │
│  23 presets will return to the   │
│  All list and cycle pool.        │
│                                  │
│           [ Cancel ] [ Unhide ]  │
└──────────────────────────────────┘
```

- Esc / backdrop click → cancel.
- `Unhide` button is the accent/primary style; `Cancel` is transparent.
- After confirm: clear the Set, `saveHidden()`, `syncHiddenPool()`, `filterPresets()`, toast `👁 Unhid 23 presets`.

No other destructive bulk actions in scope.

---

## CSS — make the icons actually visible

Current [preset-heart](src/style.css#L381) only reaches `opacity: 0.5` on row hover with `color: var(--text-muted)` (≈ `#666`). That's why the hearts in the screenshot are nearly invisible on dark bg.

Proposed values:

```css
.preset-heart,
.preset-hide {
  flex-shrink: 0; width: 16px; height: 16px;
  opacity: 0.35;                      /* was 0 — always visible, just subtle */
  color: var(--text-secondary);       /* was text-muted — #ccc instead of #666 */
  transition: all var(--transition-fast);
}
.preset-hide { margin-left: 6px; }
.preset-heart { margin-left: 8px; }

.drawer-list li:hover .preset-heart,
.drawer-list li:hover .preset-hide {
  opacity: 0.85;                      /* was 0.5 — clearly visible on hover */
  transform: scale(1);
}

.drawer-list li:hover .preset-heart:hover {
  color: #ff3b3b; opacity: 1; transform: scale(1.15);
}
.drawer-list li:hover .preset-hide:hover {
  color: #ffb84d; opacity: 1; transform: scale(1.15);   /* amber for hide */
}

.drawer-list li.is-favorite .preset-heart {
  opacity: 1; color: #ff3b3b;
}
.drawer-list li.is-hidden .preset-hide {
  opacity: 1; color: #ffb84d;
}
.drawer-list li.is-hidden {
  opacity: 0.45;                      /* only when Show hidden is on */
}
```

Key changes vs. current:
- **Always-on faint visibility** (`0.35`) instead of `0` so users discover the icons exist.
- **On-hover brighter** (`0.85` vs `0.5`) and use `--text-secondary` not `--text-muted`.
- **Distinct color per action** on icon hover — red for favorite, amber for hide.

## Files touched

| File | Change |
|---|---|
| [src/controls.js](src/controls.js) | Add `hidden` Set + load/save/toggle; hide icon in row render; Show-hidden switch wiring; modal confirm handler; update `populatePresetList` filter logic |
| [src/visualizer.js](src/visualizer.js) | Add `hiddenPool` + `setHiddenPool`; exclude from `cycleNext` / `cycleRandom` / `randomPreset` / `nextPreset` / `prevPreset`; fallback when all hidden |
| [index.html](index.html) | Add Show-hidden switch row inside `.drawer-count` area; add modal markup (hidden by default) |
| [src/style.css](src/style.css) | Brighten `.preset-heart`; add `.preset-hide`; add `.modal` + `.modal-dialog` styles (reuse `#keyboard-guide` tokens) |

## Out of scope (explicit)

- Preset import / paste / upload.
- User-created presets.
- Format validation modal.
- Persisting cycle settings, audio tuning, etc. (separate task).
- Any server / sync — hidden list is browser-local like favorites.

---

## Future enhancements (parked, not in this task)

Ranked rough value-to-effort — revisit after hide ships.

1. **Recently played tab** — rolling last-20 list. Solves "wait, what was that one?". Tiny code, high payoff.
2. **Back / forward history** — browser-style return to the actual last preset, separate from the alphabetical prev arrow. Natural pair with #1.
3. **Crates / named playlists** — favorites is one bucket; let users curate "chill", "party", "demo". Moderate lift (new data model + tab UI).
4. **Export / import favorites + crates as JSON** — just name lists, tiny file, shareable. Different from preset import — no preset data, just references.
5. **Favorites float to top of All tab** — small organizational win; makes a 1,144-item list actually navigable.

Explicitly rejected (for reference, so we don't relitigate):
- Hover-to-preview presets — needs real rendering, clashes with audio sync. Cool, not cheap.
- Ratings beyond binary — redundant with favorite + hide.
- Beat-sync cycling — separate DSP project.
- Preset import / user-created presets — contradicts the bundled-immutable model.

## Decisions

1. **Show hidden toggle resets to off on every load.** It's a maintenance mode, not a daily view — persisting it would leave users reopening the app to a cluttered drawer and wondering why things they hid are back. Off-by-default keeps the cleaned list as the steady state.

2. **`X` toggles hide on the current preset.** `H` was already bound to force-hide-ui — `X` is an equally intuitive choice (close/remove) and symmetric with `S` (save/favorite). Added as a row in the keyboard-guide modal. On hide via `X`, auto-advance to the next (non-hidden) preset so the user isn't left staring at the thing they just hid.

3. **Hide wins over favorite in cycle.** If a preset is both favorited and hidden, it's excluded from random + auto-cycle. Hide is the more specific, more recent intent ("don't show me this now") and trumps favorite ("I like this generally"). The Favorites tab still lists it, so the user can unhide or unfavorite deliberately — nothing is lost, it just won't auto-play. One rule, no exceptions: **hidden = never auto-played.**
