# User Guide Bug - Investigation Document

**Date:** May 6, 2026  
**Status:** ✅ RESOLVED - Ghost File Deleted + Bug Fixed

---

## The Three Help Files (Problem!)

| File | What It Is | How It's Accessed |
|------|------------|-----------------|
| `index.html` `#welcome-guide` | Welcome Guide modal on entry page | **User Guide button** (BROKEN - wrong ID) |
| `editor.html` `#help-modal` | Preset Studio help modal | Help icon (?) in Preset Studio |
| `help.html` | **GHOST FILE** - Standalone searchable help center | **NOTHING LINKS TO IT** - type URL manually only |

**You have 3 help systems but only 2 entry points work!**

---

## What the User Guide Button SHOULD Bring Up

**Location:** Entry page (`index.html`) - the page with the DiscoCast logo and "User Guide" button at bottom.

**What it SHOULD open:** The **Welcome Guide modal** (`#welcome-guide`) - a tabbed modal embedded directly in `index.html` with sections: Welcome, Audio Sources, Browsing Presets, Auto-Cycling, Live Performance, Output Settings, Preset Studio, Timeline Editor, Reactivity, Shortcuts, and Tips.

**File:** `index.html` lines 566-900+

---

## THE BUG - Element ID Mismatch

**File:** `src/controls.js` lines 976-979

```javascript
openWelcomeGuide() {
  const modal = document.getElementById('help-modal');  // WRONG ID! Should be 'welcome-guide'
  if (modal) modal.hidden = false;
}
```

**File:** `src/controls.js` lines 981-984

```javascript
closeWelcomeGuide() {
  const modal = document.getElementById('help-modal');  // WRONG ID! Should be 'welcome-guide'
  if (modal) modal.hidden = true;
}
```

**Actual modal ID in `index.html` (line 566):**
```html
<div id="welcome-guide" class="modal welcome-modal hidden">
```

**The Problem:** The JavaScript looks for `help-modal` but the HTML element is `welcome-guide`. These functions do NOTHING because `document.getElementById('help-modal')` returns `null`.

---

## The Ghost File: `help.html`

**What it is:** A standalone full help page that was planned as a "searchable help center" (see `docs/user-guide-redesign.md`)

**Why it's a ghost:** NOTHING in your app links to it. You can only access it by typing `http://localhost:5174/help.html` directly in the address bar.

**Evidence from `docs/user-guide-redesign.md`:>** "The existing welcome modal (`index.html` welcome sections) stays as-is for now... We don't touch it until Phase 1 of the help centre is live."

**But you built it (it's in vite.config.js line 25) and it's deployed, just orphaned.**

---

## The "Open full Help guide" Lie

In `editor.html` line 1218, there's a button: `Open full Help guide →`

But in `src/editor/inspector.js` lines 4486-4491, clicking it just opens the editor's own `help-modal` again - NOT `help.html`!

```javascript
document.getElementById('onboarding-help-btn')
    ?.addEventListener('click', () => {
        close(false);
        const modal = document.getElementById('help-modal');  // Same modal, not help.html!
        if (modal) modal.hidden = false;
    });
```

---

## Why Content Updates Don't Appear

The `welcome-guide` modal IS being shown somehow (probably via CSS class manipulation somewhere else), but these broken functions are dead code. When you edit `index.html`, the content changes but you may be seeing cached/stale content or there's another mechanism showing the modal.

---

## The ONE User Guide Solution

**Option 1: Fix the bug, keep modal (Minimal)**
- Fix `controls.js` lines 976, 982: Change `'help-modal'` to `'welcome-guide'`
- Delete `help.html` (it's confusing and orphaned)
- Keep editor's help modal as-is (it's contextual)

**Option 2: Consolidate everything to `help.html` (Cleaner long-term)**
- Make User Guide button open `help.html` in new tab: `window.open('/help.html', '_blank')`
- Delete the `welcome-guide` modal from `index.html` 
- Keep editor's contextual help modal
- `help.html` becomes the single source of truth

---

## Correct Fix (Option 1 - Minimal)

**File:** `src/controls.js`

Line 977: Change to:
```javascript
const modal = document.getElementById('welcome-guide');
```

Line 982: Change to:
```javascript
const modal = document.getElementById('welcome-guide');
```

**Verification:**
1. DevTools Console: `document.getElementById('help-modal')` → `null`
2. DevTools Console: `document.getElementById('welcome-guide')` → returns the div
3. Click User Guide button → modal opens with current content

---

## Files Involved

| File | Line(s) | Issue |
|------|---------|-------|
| `index.html` | 566-900+ | Welcome Guide modal HTML (ID: `welcome-guide`) - works but not wired correctly |
| `src/controls.js` | 976-979 | `openWelcomeGuide()` - WRONG ID |
| `src/controls.js` | 981-984 | `closeWelcomeGuide()` - WRONG ID |
| `help.html` | All | **GHOST FILE** - orphaned, nothing links to it |
| `editor.html` | 1218 | Button lies about opening "full Help guide" |
| `src/editor/inspector.js` | 4486-4491 | Opens wrong thing |

---

## Complete Analysis of All Help Sources

### Welcome Guide Modal (`index.html` `#welcome-guide`)

* A tabbed modal embedded directly in `index.html`
* Sections: Welcome, Audio Sources, Browsing Presets, Auto-Cycling, Live Performance, Output Settings, Preset Studio, Timeline Editor, Reactivity, Shortcuts, and Tips
* Currently not working due to wrong ID in `controls.js`

### Preset Studio Help Modal (`editor.html` `#help-modal`)

* A contextual help modal for the Preset Studio
* Accessed via a help icon in the Preset Studio
* Currently working correctly

### Standalone Searchable Help Center (`help.html`)

* A standalone full help page planned as a "searchable help center"
* Currently orphaned and not linked to from anywhere in the app
* Can only be accessed by typing `http://localhost:5174/help.html` directly in the address bar

---

## Verification Steps After Fix

1. Open DevTools Console
2. Run: `document.getElementById('welcome-guide')` - should return the modal div
3. Run: `document.getElementById('help-modal')` - should return `null` (proves the bug)
4. Click User Guide button - modal should open
5. Check that content in `index.html` lines 566+ matches what's displayed

---

## ✅ RESOLUTION - Actions Taken

### 1. Deleted Ghost File
- **File:** `help.html` - DELETED
- **Reason:** Orphaned, nothing linked to it, causing confusion

### 2. Fixed Element ID Bug
- **File:** `src/controls.js` lines 976-984
- **Change 1:** `'help-modal'` → `'welcome-guide'` (corrected element ID)
- **Change 2:** `modal.hidden = false` → `modal.classList.remove('hidden')` (CSS class, not HTML attribute)
- **Result:** User Guide button now correctly opens the `#welcome-guide` modal

### 3. Removed from Build
- **File:** `vite.config.js` line 25
- **Change:** Removed `help: resolve(__dirname, 'help.html')` entry
- **Result:** No longer built/deployed

---

## Current State - ONE USER GUIDE ONLY

| Entry Point | What It Opens |
|-------------|---------------|
| **User Guide button** (start screen) | `#welcome-guide` modal in `index.html` ✅ |
| Help icon (?) in Preset Studio | `#help-modal` in `editor.html` (contextual) |
| **NO OTHER ENTRY POINTS** | **NO GHOST FILES** |

The working modal in `index.html` already contains all the essential content from the deleted `help.html` — it was always the source of truth, just had broken wiring.
