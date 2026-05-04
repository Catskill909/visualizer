# Canvas Mirror Bug — Audit & Fix

> **Status:** ✅ Fixed. Kept for reference.

## Symptom

Canvas Mirror (Off / H / V / Both) appeared to do nothing, or only worked intermittently after unrelated actions.

## Root Cause

The GLSL UV-folding logic for canvas mirror is **baked into the compiled shader** inside `_buildCompShader()`. When the user clicked a mirror button, the handler updated `currentState.sceneMirror` and called `_applyToEngine()` — but **never rebuilt the shader**. The engine was receiving the same stale compiled shader (with the old mirror mode) every time.

### Why it "sometimes worked"

A shader rebuild is triggered by other actions: loading a preset, adding/editing an image layer, undo/redo. If the user clicked a mirror button *after* one of those actions, they'd see the correct result — but only because the rebuild had already happened for a different reason.

### Per-image layer mirror (works correctly — for reference)

Layer mirror clicks call `refresh()`, which debounces to `_buildCompShader()` + `_applyToEngine()`. Canvas mirror didn't follow the same pattern.

There is also an empty stub `_applySceneMirror() {}` at line 979 that was never wired up — a leftover placeholder.

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `src/editor/inspector.js` | 956–963 | Added `this._buildCompShader()` before `this._applyToEngine()` in the scene-mirror click handler |

## Fix (one line added)

```js
// Before (broken)
this.currentState.sceneMirror = btn.dataset.smirror;
this._postSnap();
this._applyToEngine();

// After (fixed)
this.currentState.sceneMirror = btn.dataset.smirror;
this._postSnap();
this._buildCompShader();   // ← rebuilds shader with new UV-fold
this._applyToEngine();
```

## Verification

1. Open the editor, load any preset with an active visualizer.
2. Click **H** — left half should mirror to the right half instantly.
3. Click **V** — top half should mirror to the bottom.
4. Click **Both** — quad-mirror across both axes.
5. Click **Off** — returns to normal.
6. All transitions should be immediate with no need to touch an image layer or reload.
