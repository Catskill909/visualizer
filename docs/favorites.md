# Brainstorm: Favorites Feature UI/UX

Adding a "Favorites" feature allows users to save and easily access their preferred presets from the massive 1,100+ library. Since we are dealing with a visual, immersive application, the UI/UX needs to be intuitive, non-intrusive, and fast.

Here is a proposed approach for the best UI/UX implementation:

## 1. The Interaction (How to Favorite)

**Main Control Bar (Active Preset):**
- Add a small Heart icon (🤍) next to the active preset name in the main control bar (`#preset-name`).
- Clicking the heart toggles it to a filled, brightly colored heart (❤️ or an accent color like bright cyan) to indicate it's saved.

**Preset Drawer (List View):**
- In the side drawer, when hovering over a preset in the list, a faded heart icon appears on the far right of that row.
- Clicking the heart toggles its state. If a preset is already favorited, the filled heart is always visible on that row (no hover required).

**Keyboard Shortcut:**
- Pressing `S` (Star/Save) or `L` (Love/Like) instantly toggles the favorite status of the currently active preset. A small toast notification appears ("Added to Favorites"). *(Note: 'F' is already used for Fullscreen).*

## 2. The Navigation (How to Find Favorites)

Since the side drawer already handles preset browsing, we should integrate favorites directly into it to avoid cluttering the screen with a new menu.

**Tabs in the Drawer:**
- Add a sleek, modern segmented control (pill-shaped toggle) at the top of the preset drawer, right below the search bar.
- **Options:** `All Presets` | `Favorites`
- Clicking `Favorites` filters the list instantly to show only favorited presets. 

**Search Integration:**
- The search bar should respect the active tab. If the user is on the `Favorites` tab, searching will only filter their favorites.

## 3. Data Persistence (How it's Saved)

Since this is a lightweight, frontend-only browser app without a database:
- **`localStorage`:** Save an array of favorited preset names to the browser's `localStorage` (e.g., `['Zylot - Neon Pulse', 'Flexi - Crystal Flow']`).
- **Immediate Retrieval:** When the app loads, read from `localStorage` and initialize the UI states instantly.
- **Privacy/Portability:** All favorites remain safely stored on the user's local machine.

## 4. Visualizing the Changes (Mockup Idea)

**Control Bar:**
```text
[ 🤍 Preset Name Here... ]  [ ← ] [ R ] [ → ]   [ 🎙️ Mic ]   [ P ] [ F ]
```

**Drawer:**
```text
==============================
          PRESETS         [X]
==============================
[ Search presets...          ]
------------------------------
[ All Presets ] [ Favorites  ]
------------------------------
▶ 42 presets

  Zylot - Acid Burn        🤍 
  Flexi - Fractal Flow     ❤️
  Rovastar - Starbirth     🤍
==============================
```

## Next Steps
If this approach sounds good, we can implement it in the following order:
1. Set up the `localStorage` logic in `controls.js`.
2. Add the UI icons to the Control Bar and Drawer List.
3. Build the `All / Favorites` toggle in the drawer.
4. Wire up the click events and keyboard shortcuts.
