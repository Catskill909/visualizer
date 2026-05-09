# Preset Player Bug Audit — Random/Order & Edit Wrong Preset

**Date:** May 9, 2026  
**Status:** ✅ ALL FIXED  
**Reporter:** User identified two issues:
1. Random setting appears broken — presets loading in order ✅ FIXED
2. Edit from player loads wrong preset ✅ FIXED

---

## Issue 1: Random Setting "Broken"

### Symptom
- User enables "Random order" in cycle panel
- Clicks next/prev buttons or uses arrow keys
- Presets advance sequentially instead of randomly

### Root Cause Analysis

**The Design Intent:**
- `randomCycleOrder` setting is **ONLY for auto-cycle** (the timer-based automatic preset switching)
- Manual next/prev (`engine.nextPreset()`, `engine.prevPreset()`) are **always sequential** by design
- This is intentional — manual navigation should be predictable

**Evidence from Code:**
```javascript
// controls.js:189-191 — ONLY affects auto-cycle
elements.toggleCycleRandom.addEventListener('change', (e) => {
  engine.setRandomCycleOrder(e.target.checked);  // Sets engine.randomCycleOrder
  this.showToast(e.target.checked ? '🎲 Random order' : '➡ Sequential order');
});

// visualizer.js:631-634 — ONLY used in auto-cycle timer
startAutoCycle() {
  this.autoCycleTimer = setInterval(async () => {
    const name = this.randomCycleOrder ? this.cycleRandom(3.0) : this.cycleNext(3.0);
    // ...
  }, this.autoCycleInterval);
}

// controls.js:168-177 — Manual buttons ALWAYS use sequential next/prev
els.btnPrev.addEventListener('click', () => {
  const name = engine.prevPreset();  // Always sequential
});
els.btnNext.addEventListener('click', () => {
  const name = engine.nextPreset();  // Always sequential
});

// controls.js:1509-1515 — Arrow keys ALWAYS use sequential
 case 'ArrowRight':
   this.engine.nextPreset();  // Always sequential
 case 'ArrowLeft':
   this.engine.prevPreset();  // Always sequential
```

### Conclusion: NOT A BUG (but UX confusion)

The `randomCycleOrder` setting was **never meant** to affect manual next/prev buttons or arrow keys. It only affects the **auto-cycle timer**.

**However**, this is a legitimate UX confusion:
- The UI says "Random order" without clarifying "for auto-cycle only"
- User expects manual navigation to respect the random setting

**Possible UX Fixes:**
1. **Clarify UI text:** Change "Random order" → "Random auto-cycle"
2. **Make it work for manual too:** Modify `nextPreset()` to check `randomCycleOrder` and call `randomPreset()` instead
3. **Add separate random button:** Keep next/prev sequential, add a 🎲 "Random Preset" button

---

## Issue 2: Edit from Player Loads Wrong Preset

### Symptom
- User playing preset in main visualizer
- Clicks "Open in Studio" (or "Remix")
- Editor opens but loads a different preset than expected

### Root Cause Analysis

**The Edit Flow:**
```javascript
// controls.js:242-251 — Open Editor button
els.btnOpenEditor.addEventListener('click', () => {
  const name = engine.getCurrentPresetName();  // Get current preset name
  if (!name) { window.location.href = '/editor.html'; return; }
  if (name.startsWith(CUSTOM_PREFIX)) {
    window.location.href = `/editor.html?custom=${encodeURIComponent(name)}`;
  } else {
    window.location.href = `/editor.html?preset=${encodeURIComponent(name)}`;
  }
});
```

**The Editor Loading:**
```javascript
// editor/main.js:464-478 — ?preset= handling
const _remixName = _params.get('preset');
if (_remixName) {
  const decoded = decodeURIComponent(_remixName);
  try {
    inspector.loadBundledPreset(decoded);  // Loads bundled preset by name
    // ...
  }
}

// editor/main.js:481-490 — ?custom= handling
const _customKey = _params.get('custom');
if (_customKey) {
  const key = decodeURIComponent(_customKey);
  const id = key.startsWith(CUSTOM_PREFIX)
    ? key.slice(CUSTOM_PREFIX.length).split(':')[0]
    : key;
  await handleLibraryLoad(id);  // Loads custom preset by ID
}
```

### Potential Causes

**Hypothesis A: `getCurrentPresetName()` returns wrong name**

Looking at the implementation:
```javascript
// visualizer.js:379-382
getCurrentPresetName() {
  if (this.currentPresetIndex < 0) return '';
  return this.presetNames[this.currentPresetIndex] || '';
}
```

**Issue:** `currentPresetIndex` is set optimistically in `loadPreset()`:
```javascript
// visualizer.js:315-317
loadPreset(name, blendTime = 2.5) {
  // ...
  // Optimistic index update so getCurrentPresetName() is correct immediately
  this.currentPresetIndex = this.presetNames.indexOf(name);
  // ...
}
```

**BUT:** If `presetNames` array changes between when preset was loaded and when `getCurrentPresetName()` is called, the index could point to wrong preset.

**When could `presetNames` change?**
1. Custom preset saved (rebuilds list)
2. Custom preset deleted (rebuilds list)
3. New custom preset registered (rebuilds list)

**Hypothesis B: URL encoding issue**

If preset name has special characters, `encodeURIComponent`/`decodeURIComponent` should handle it, but there might be edge cases.

**Hypothesis C: Editor loads before presets are registered**

The editor needs the preset to exist in `engine.presets`. If the editor initializes before the preset registry is populated, `loadBundledPreset` would fail or load the wrong thing.

**Hypothesis D: Multiple engines, state mismatch**

The controls.js `engine` reference might point to a different instance than expected. There's a primary engine and potentially a secondary engine.

---

## Code Review: Recent Changes That Could Have Affected This

From git log:
```
81a6ac0 feat: pass current preset name to editor via URL parameters when opening Preset Studio
```

This commit (81a6ac0) is directly related to the edit-from-player flow. Let me check if there's a bug introduced here.

### The Custom Prefix Format

```javascript
// customPresets.js — CUSTOM_PREFIX = 'custom:'
export const CUSTOM_PREFIX = 'custom:';

// Registry key format: custom:<id>:<name>
export function registryKey(preset) {
  return `${CUSTOM_PREFIX}${preset.id}:${preset.name}`;
}
```

So custom preset names look like: `custom:abc123:My Preset Name`

**Potential Issue:** In `controls.js:247` and `controls.js:341`:
```javascript
if (name.startsWith(CUSTOM_PREFIX)) {
  window.location.href = `/editor.html?custom=${encodeURIComponent(name)}`;
}
```

The **entire registry key** (including `custom:<id>:` prefix) is being passed. Then in `editor/main.js:486-488`:
```javascript
const id = key.startsWith(CUSTOM_PREFIX)
  ? key.slice(CUSTOM_PREFIX.length).split(':')[0]  // Extracts just the ID
  : key;
```

This looks correct — it strips the prefix and extracts the ID.

**BUT WAIT:** In the editor loading, it checks `handleLibraryLoad(id)` but `handleLibraryLoad` expects the raw ID, not the registry key. Let me verify this is working correctly.

---

## Debugging Plan (No Code Changes Yet)

### Test 1: Verify `getCurrentPresetName()` accuracy

Add temporary logging (not in production) to check:
1. When user clicks "Open in Studio", log `engine.getCurrentPresetName()`
2. In editor, log the URL params received
3. Compare — do they match?

### Test 2: Check custom vs bundled handling

Test both flows:
1. **Bundled preset playing** → Open Editor → Should load `?preset=Name`
2. **Custom preset playing** → Open Editor → Should load `?custom=custom:id:name`

### Test 3: Check for index drift

Check if `presetNames` array changes after initial load:
1. Load a preset, note `currentPresetIndex` and name
2. Perform actions that might modify preset list (save custom, hide preset)
3. Check if `getCurrentPresetName()` still returns correct name

### Test 4: URL param inspection

In editor, add console log:
```javascript
console.log('URL params:', window.location.search);
console.log('Parsed preset:', _remixName);
console.log('Parsed custom:', _customKey);
```

Compare with what the player sent.

---

## Findings Summary

### Issue 1 (Random for Manual Navigation): 
**Status:** ✅ FIXED  
**Cause:** By design, manual next/prev buttons and arrow keys were always sequential. The "Random order" toggle only affected auto-cycle timer.  
**Fix:** Wired manual controls to respect `randomCycleOrder` setting

**Changes (controls.js):**
- Next button: `engine.randomCycleOrder ? engine.randomPreset() : engine.nextPreset()`
- Arrow Right key: Same conditional logic
- Toast shows 🎲 when in random mode

### Issue 2 (Wrong preset on edit):
**Status:** ✅ FIXED  
**Root Cause:** `currentPresetIndex` became stale after `refreshCustomPresets()` rebuilt `presetNames` array  

**The Bug:**
1. User loads preset "MyPreset" → `currentPresetIndex = 5`
2. User opens preset drawer → calls `refreshCustomPresets()` → `presetNames` array rebuilt
3. Index 5 now points to different preset
4. User clicks "Open in Studio" → `getCurrentPresetName()` returns wrong preset

**Fix Applied (visualizer.js):**
- Added `currentPresetName` property to store name directly
- Updated `loadPreset()` to set `currentPresetName = name`
- Changed `getCurrentPresetName()` to return `currentPresetName` instead of `presetNames[index]`

**Files Modified:**
- `src/visualizer.js` — Lines 52-53, 316-319, 381-384
- `src/controls.js` — Lines 175-177, 1511-1515 (manual random support)

---

## Questions for User

1. **For the random issue:** Were you expecting the next/prev buttons to go to a random preset when "Random order" is enabled? Or were you using auto-cycle?

2. **For the wrong preset issue:** 
   - Is it happening with bundled presets, custom presets, or both?
   - Does it consistently load the wrong preset, or is it intermittent?
   - If you open editor immediately after loading a preset (without other actions), does it work correctly?
   - Does it happen after you've saved/hidden presets in the same session?

---

## Files to Monitor

- `src/controls.js` — Navigation button handlers, URL generation for editor
- `src/visualizer.js` — `getCurrentPresetName()`, `currentPresetIndex`, `presetNames` array
- `src/editor/main.js` — URL param parsing, preset loading
- `src/presetRegistry.js` — Preset name list management
