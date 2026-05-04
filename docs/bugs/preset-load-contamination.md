# Preset Load State Contamination — Fix Plan

> **Status:** ✅ Fixed 2026-05-04. Kept for reference — this was a foundational fix on the path to the One Truth Goal.
> **Symptom:** Loading any preset (bundled via Remix, or custom via Library) layered the new preset on top of the previous preset's visuals instead of replacing them. Chip states, panel visibility, and feedback buffer pixels all leaked through.

## TL;DR — what fixed it

Two-layer fix:

1. **State / DOM seam (inspector.js)** — extracted `_clearForLoad()` shared by reset, `loadBundledPreset`, and `loadPresetData`. Resets `currentState = deepClone(BLANK)`, clears `_imageTextures`, image-layer DOM, palette / variation chips, scene-mirror UI, Images Only toggle. `loadPresetData` now overlays onto BLANK (instead of replacing currentState with `stateFields` directly) so older saves missing newer fields fall back to defaults instead of `undefined → NaN`. `_buildCompShader()` moved to **after** the image loop so the rebuilt comp includes layer GLSL.

2. **Feedback buffer (visualizer.js)** — new `clearFeedbackBuffer()` method on `VisualizerEngine`, called at the end of `_clearForLoad`. Reaches into butterchurn's `renderer.prevFrameBuffer` / `targetFrameBuffer`, binds each, and `gl.clear`s to black. **This was the actual visual smoking gun** — see §10 below for why this matters and is non-obvious.

Net change: ~40 lines across 2 files, mostly deletions in inspector.js.

---

## 1. The 4 entry points and where they funnel

There are 4 ways to load a preset into the editor. They all reduce down to **two methods** in `inspector.js`:

| Entry point | Caller | Inspector method |
|---|---|---|
| `?preset=NAME` URL param | [src/editor/main.js:531-545](src/editor/main.js#L531-L545) | `loadBundledPreset(name)` |
| In-editor "Remix…" picker | [src/editor/main.js:341-360](src/editor/main.js#L341-L360) `_rpSelect` | `loadBundledPreset(name)` |
| `?custom=KEY` URL param | [src/editor/main.js:549-556](src/editor/main.js#L549-L556) | `handleLibraryLoad(id)` → `loadPresetData(preset)` |
| Library panel card click | [src/editor/presetLibrary.js](src/editor/presetLibrary.js) → `onLoad(id)` | `handleLibraryLoad(id)` → `loadPresetData(preset)` |

So **fixing the two inspector methods fixes all 4 entry points**. No per-caller patches needed.

The reset button (`btn-reset` at [inspector.js:1092](src/editor/inspector.js#L1092)) is the reference implementation — it clears everything correctly. Both load methods diverge from that pattern in different ways.

---

## 2. What's currently happening — concrete bugs

I compared `_bindReset()` (the working clean-slate path) against `loadBundledPreset` and `loadPresetData`. Here is the divergence, line by line.

### 2.1 `loadBundledPreset` ([inspector.js:3781](src/editor/inspector.js#L3781))

This method is **mostly correct**. One known leak:

| # | What | Severity | Evidence |
|---|---|---|---|
| B1 | **Palette chip active state never cleared** | Visible | Reset calls `_clearPaletteActive()` ([line 1124](src/editor/inspector.js#L1124)). loadBundledPreset doesn't. If the user clicked "Neon" on the previous preset, the Neon chip stays highlighted on the newly-loaded library preset. |

Everything else in `loadBundledPreset` is sound: `currentState = deepClone(BLANK)` then overlay bundled fields, `images=[]`, `sceneMirror='none'`, all `solid*` cleared, `_solidColor=null`, variation chips cleared, scene mirror UI reset, Images Only toggle reset, solid FX panel hidden.

### 2.2 `loadPresetData` ([inspector.js:3870](src/editor/inspector.js#L3870))

This method has **multiple leaks**:

| # | What | Severity | Evidence |
|---|---|---|---|
| C1 | **Doesn't start from BLANK** | Critical | Line 3882: `this.currentState = deepClone({ ...stateFields, images: [] });`. Saved presets that pre-date a field (e.g. `solidReactSource`, `sceneMirror`, `b1ed`) will load with that field as `undefined`. Then `_syncSlider(id, undefined, …)` does `input.value = undefined` and `Number(undefined).toFixed(2) = "NaN"`, leaving the slider at its previous DOM position with a "NaN" value label. **This is the primary contamination vector.** |
| C2 | **Variation chip active state not cleared** | Visible | If the user picked "Pulse" on the previous preset, the Pulse chip stays highlighted on the newly-loaded custom preset. Reset / loadBundledPreset both clear this; loadPresetData doesn't. |
| C3 | **Palette chip active state not cleared** | Visible | Same as B1, but for custom-preset loads. |
| C4 | **`_solidColor` internal flag not reset** | Subtle | Reset sets `this._solidColor = v0.solid \|\| null`. loadBundledPreset sets `this._solidColor = null`. loadPresetData never touches it — so the previous preset's solid colour leaks into the new edit's shader-build path until the user picks a variation. |
| C5 | **`_updateSolidFxVisibility` never called** | Visible | The Solid FX panel (Pulse / Breath / Shift sliders) can stay visible after loading a non-solid preset, or stay hidden after loading a Solid/Shift preset. Reset and loadBundledPreset both call this; loadPresetData doesn't. |
| C6 | **`_buildCompShader()` runs before images are loaded** | Critical | Line 3886 calls `_buildCompShader()` immediately after setting `currentState.images = []` (line 3882). The saved preset's comp shader — which already includes the image-layer GLSL from when it was saved — gets **overwritten** with a comp built from zero images. The image loop on lines 3891-3918 then pushes images into `currentState.images` and mounts DOM cards via `_mountLayerCard`, but **never rebuilds the comp shader**. Result: image textures are bound to the engine, but the comp shader has no GLSL to sample them. Saved presets with images appear to load with image cards visible in the panel but no images rendered on canvas — until the user touches any image-layer slider, which triggers a rebuild and reveals them. |

---

## 3. What should happen instead

**Both load methods should leave the editor in the same kind of clean state the reset button produces, then overlay the loaded preset's fields on top.** The shape of "clean state" is already encoded in `_bindReset()` — the fix is to extract that pattern and reuse it.

### 3.1 Canonical clean-slate procedure (extracted from `_bindReset`)

```text
1. Clear DOM image layer cards
2. Remove GIF animations + clear _imageTextures
3. currentState = deepClone(BLANK)
4. Reset internal flags: _solidColor = null, _imagesOnly = false
5. Clear UI active states: variation chips, palette chips
6. Reset top-level toggles: Images Only, Scene Mirror UI
```

After this, both load methods overlay the loaded preset's data on top of the clean state.

### 3.2 Order of operations (fixed)

**`loadBundledPreset(name)`:**
1. Clean-slate (steps 1-6 above)
2. Overlay bundled `baseVals`, `shapes`, `waves`, `warp`, `comp`, `*_eqs_str`
3. Set `parentPresetName = name`
4. `_applyToEngine()` (do NOT call `_buildCompShader` — preserve bundled comp)
5. `_syncAllControls()`
6. `_updateSolidFxVisibility({ solid: null })`
7. `_updateLayersBar`, `_updateLayerIndices`
8. `originalState = deepClone(currentState)`

**`loadPresetData(presetData)`:**
1. Clean-slate (steps 1-6 above)
2. Strip metadata (`id`, `name`, `schemaVersion`, `createdAt`, `updatedAt`, `thumbnailDataUrl`)
3. **Overlay onto BLANK, not replace:** `currentState = { ...deepClone(BLANK), ...stateFields, images: [] }`. Missing fields fall through to BLANK defaults.
4. Restore `_imagesOnly` flag and `_solidColor` from currentState (or null)
5. Loop saved images: fetch blob → push into `currentState.images` → `_mountLayerCard`
6. **`_buildCompShader()` AFTER the image loop**, not before — so the rebuilt comp includes the image-layer GLSL
   - **Exception:** if `parentPresetName` is set (preset was saved from a remixed library preset), preserve the saved comp instead, since it may contain bundled MilkDrop GLSL we don't want to regenerate. Decision needed — see §5.
7. `_applyToEngine()`
8. `_syncAllControls()`
9. `_updateSolidFxVisibility({ solid: this._solidColor })`
10. Sync scene mirror UI, Images Only toggle, layer bar, indices
11. `originalState = deepClone(currentState)`

---

## 4. Exact changes I will make

**File: `src/editor/inspector.js`**

### Change 1 — Extract clean-slate into a private helper

New private method around [line 1131](src/editor/inspector.js#L1131) (just after `_bindReset`):

```js
/** Reset the editor to a known-clean state. Used by reset, loadBundledPreset,
 *  and loadPresetData so all three start from the same baseline. */
_clearForLoad() {
    // DOM
    const layersEl = document.getElementById('image-layers');
    if (layersEl) layersEl.innerHTML = '';
    for (const texName of Object.keys(this._imageTextures)) {
        this.engine.removeGifAnimation?.(texName);
    }
    this._imageTextures = {};

    // currentState
    this.currentState = deepClone(BLANK);

    // Internal flags
    this._solidColor = null;
    this._imagesOnly = false;

    // UI active states
    this._clearPaletteActive();
    document.querySelectorAll('.base-var-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#scene-mirror-seg .seg').forEach(s => {
        s.classList.toggle('active', s.dataset.smirror === 'none');
    });
    const ioToggle = document.getElementById('toggle-images-only');
    if (ioToggle) ioToggle.checked = false;
}
```

### Change 2 — `_bindReset` calls the helper

Replace the manual clearing in `_bindReset` (lines 1094-1100, 1101, 1116-1118, plus `_clearPaletteActive` at 1124) with a single `this._clearForLoad()` call. Then keep the variation-specific overlay (Solid as default) below it. **No behaviour change for the reset button.**

### Change 3 — `loadBundledPreset` calls the helper

Replace lines 3786-3791 (DOM clear + textures) and the manual clears at lines 3818-3826, 3833-3834, 3841-3851 with `this._clearForLoad()` at the top, then keep the bundled-overlay logic. Adds **B1 fix** (palette chip clear) for free.

### Change 4 — `loadPresetData` rewrite

Replace the body (lines 3870-3933) with:

```js
async loadPresetData(presetData) {
    this._clearForLoad();

    // Strip library-only metadata
    const { id: _id, name: _name, schemaVersion: _sv, createdAt: _ca,
            updatedAt: _ua, thumbnailDataUrl: _th, ...stateFields } = presetData;

    // Overlay onto BLANK so fields missing from older saves fall back to defaults
    this.currentState = {
        ...deepClone(BLANK),
        ...deepClone(stateFields),
        images: [],
    };

    // Restore internal flags from the loaded state
    this._imagesOnly = !!this.currentState.imagesOnly;

    // Restore image layers (async — fetch blobs from IndexedDB)
    const savedImages = stateFields.images || [];
    for (const savedEntry of savedImages) {
        try {
            const blob = await getImage(savedEntry.imageId);
            if (!blob) continue;
            const dataUrl = await blobToDataUrl(blob);
            const { width, height } = await loadImageDims(dataUrl);
            const entry = this._normalizeImageEntry(deepClone(savedEntry));
            const texObj = { data: dataUrl, width, height, isGif: !!entry.isGif };
            this.currentState.images.push(entry);
            this._mountLayerCard(entry, texObj);
        } catch (err) {
            console.warn('[Studio] Could not restore image layer:', savedEntry.imageId, err.message);
        }
    }

    // Build comp AFTER images are loaded, so the GLSL includes their layer code
    this._buildCompShader();
    this._applyToEngine();

    // Sync DOM controls + chrome
    this._syncAllControls();
    this._updateSolidFxVisibility({ solid: this._solidColor });
    this._updateLayersBar();
    this._updateLayerIndices();

    // Sync scene mirror + Images Only from currentState (was overwritten by _clearForLoad)
    const sm = this.currentState.sceneMirror || 'none';
    document.querySelectorAll('#scene-mirror-seg .seg').forEach(s =>
        s.classList.toggle('active', s.dataset.smirror === sm));
    const ioToggle = document.getElementById('toggle-images-only');
    if (ioToggle) ioToggle.checked = !!this.currentState.imagesOnly;

    this.originalState = deepClone(this.currentState);
}
```

(`blobToDataUrl` and `loadImageDims` are tiny helpers that wrap the existing inline `FileReader` and `Image` Promises — they already appear inline at lines 3896-3908. Optional: extract for clarity, or keep inline.)

### Decision needed before I write code — see §5

---

## 5. Open question for you

**For custom presets that were saved from a remixed library preset (i.e. have `parentPresetName` set), should `loadPresetData` rebuild the comp shader or preserve the saved one?**

- **Option A — always rebuild (simplest, what the plan above proposes):** `_buildCompShader()` always runs after images load. Custom presets always render with the editor's auto-generated comp. Image layers always work. Loses any preserved bundled MilkDrop GLSL for remixed presets.
- **Option B — preserve saved comp when `parentPresetName` is set:** Skip `_buildCompShader()` for remixed presets, run it for non-remixed. More logic, but keeps the original library preset's GLSL intact for remixes.

My recommendation: **Option A**. The editor's comp builder already produces correct output for all cases the editor itself can produce, and `loadBundledPreset` is the path for editing a fresh library preset (where the bundled comp is preserved). Custom presets are by definition the editor's own output, so rebuilding from currentState is safe.

---

## 6. Verification — manual test plan

After the fix, run these in order from a single editor session (no reload):

1. **Bundled → bundled:** Open `editor.html?preset=Geiss` → wait → switch via Remix picker to `Flexi - alien fish`. Verify:
   - All sliders snap to the new preset's values (no NaN, no leftover slider positions)
   - No palette chip active
   - No variation chip active
   - Scene Mirror = Off
   - Images Only = unchecked
   - Solid FX panel hidden
2. **Bundled → custom:** From the bundled preset above, click a custom preset card in Library mode that has 2+ image layers and a non-default palette. Verify:
   - All image layers appear in the panel AND render on canvas (the C6 fix)
   - Solid FX panel state matches the saved preset's variation
   - All sliders match the saved values, no NaN
3. **Custom → bundled:** From the custom preset above, open Remix picker → pick a library preset. Verify:
   - Image layers cleared from panel
   - Image textures released (canvas shows the bundled preset only)
   - Solid FX panel hidden
4. **Custom → custom (old schema):** Save a preset, then manually delete `solidReactSource` and `solidReactCurve` from the saved JSON in localStorage. Reload it. Verify:
   - Solid FX source/curve fall back to BLANK defaults (`bass` / `linear`), not undefined / NaN
5. **Custom with parent:** Open a library preset with `?preset=`, save it as a custom preset, reload via `?custom=KEY`. Verify:
   - Visual matches what the user saved (same look)
   - Editing image layers works
6. **Reset button:** Verify reset still works exactly as before (no regression — Change 2 preserves behaviour).

---

## 7. Out of scope

- The export-only-saves-images bug ([docs/preset-editor/library-panel.md](../preset-editor/library-panel.md) §10) is the **save-side** sibling of this load bug. The One Truth Goal in `custom-preset-editor.md` covers fixing both together via schema unification. This plan **only fixes the load side** — it does not change what's serialised on save. Save-side fix is a separate task once load is solid.
- Renaming or restructuring `currentState` fields — not in this fix.
- Undo/redo stack handling on preset load — current behaviour (load is undoable) is preserved.

---

## 8. Files touched

| File | Change |
|---|---|
| `src/editor/inspector.js` | Add `_clearForLoad`; refactor `_bindReset`, `loadBundledPreset`, `loadPresetData` to call it. Pure deletions / consolidation, no schema changes. |
| `src/visualizer.js` | Add `clearFeedbackBuffer()` method on `VisualizerEngine`. Reaches into butterchurn's `renderer.prevFrameBuffer` / `targetFrameBuffer`, binds each, `gl.clear`s to black, restores prior bindings. |

No new imports. No schema changes. No call-site changes (the seam is inside the inspector).

---

## 9. Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| `_buildCompShader` after image-load changes the visual of existing saved presets | Medium | The editor's auto-generated comp **is** what saved presets store today (`saveCurrent` writes `...this.currentState` which includes the auto-generated comp). Rebuilding from the same `currentState.images` should produce the identical comp. Verify with §6 step 5. |
| Old saved presets with custom `comp` overrides (none should exist) lose them | Low | `customPresets.js` has no path for users to author custom GLSL. The only `comp` strings in saved presets are editor-generated. |
| `_clearForLoad` resets state that one of the three callers wanted to keep | Low | Each caller now overlays its own data after the reset. Verified by reading reset, loadBundledPreset, loadPresetData paths against the §3.1 baseline. |
| Behaviour change in reset button | Low | Change 2 is a pure refactor — same operations, in the same order, just extracted. Verify with §6 step 6. |

---

## 10. Root cause discovered during testing — `sampler_main` feedback amplification

The state-clearing fix in §1–§4 was correct and necessary, but on its own did **not** make the bug go away. After shipping it, the user reproduced the symptom: load Geiss via Remix, switch to Library, click a custom preset with image layers — the new preset's images rendered on top of Geiss's zebra warp pattern. The screenshot showed Geiss fully visible behind Godzilla heads, **not faded**, after several seconds.

### Why state-clearing wasn't enough

butterchurn keeps two framebuffer textures across `loadPreset` calls:
- `prevTexture` — last frame's output (input to next warp pass via `sampler_main`)
- `targetTexture` — current frame's render target

These textures are never explicitly cleared by `loadPreset`. They retain pixels from the previous preset.

That alone isn't usually a problem — butterchurn's default warp shader (when `preset.warp === ''`) is `ret = texture(sampler_main, uv).rgb * decay`, so old pixels naturally fade by the decay coefficient (typically 0.97–0.99) every frame.

### The amplification loop

The editor's auto-generated comp shader (in [`_buildCompShader`](../../src/editor/inspector.js)) uses this as its base color:

```glsl
vec3 col = texture(sampler_main, uv_m).xyz * 2.0;
```

The `* 2.0` is a brightness boost from butterchurn's standard rendering pipeline (see butterchurn's own default fallback comp, which also doubles). For a preset coming from a clean state it's fine — `sampler_main` is mostly black, doubled black is still black. But when there's residual content from a previous preset:

| Frame | Warp output (decay 0.98) | Comp output (× 2.0) |
|---|---|---|
| 0 | Geiss saturated (1.0) | 2.0 → clamped to 1.0 |
| 1 | 1.0 × 0.98 = 0.98 | 0.98 × 2.0 = 1.96 → clamped to 1.0 |
| 2 | 1.0 × 0.98 = 0.98 | 0.98 × 2.0 = 1.96 → clamped to 1.0 |
| ∞ | stays at ~0.98 | stays clamped at 1.0 |

The comp shader writes to the framebuffer that becomes the next frame's `sampler_main`. The `* 2.0` multiplier exceeds the `decay` multiplier (0.98 < 0.5 to compensate would be needed), so any non-zero pixel gets amplified back up faster than decay reduces it. Bright pixels saturate at 1.0 and never fade.

This is not a butterchurn bug — it's a side-effect of how the editor builds its base color. butterchurn presets normally have their own `warp` shader that doesn't pass through previous content unchanged, so the loop never establishes.

### The fix — explicit framebuffer clear

`clearFeedbackBuffer()` on `VisualizerEngine` reaches into butterchurn's renderer and zeroes both feedback framebuffers:

```js
clearFeedbackBuffer() {
    const renderer = this.visualizer?.renderer;
    const gl = renderer?.image?.gl;
    if (!renderer || !gl) return;

    const prevClear = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    const prevBinding = gl.getParameter(gl.FRAMEBUFFER_BINDING);

    gl.clearColor(0, 0, 0, 0);
    if (renderer.prevFrameBuffer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.prevFrameBuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (renderer.targetFrameBuffer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.targetFrameBuffer);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, prevBinding);
    gl.clearColor(prevClear[0], prevClear[1], prevClear[2], prevClear[3]);
}
```

Called at the end of `_clearForLoad`, this guarantees `sampler_main` starts black on the very next frame regardless of what the previous preset rendered. The amplification loop has nothing to amplify.

### Why this matters going forward

This finding shapes how we should think about **any** future change to the editor's base-color comp shader:

- The `* 2.0` is load-bearing for brightness parity with butterchurn's own pipeline. Removing it would dim every editor preset by half. Don't.
- Any new comp-shader path that samples `sampler_main` and writes back to it inherits the same risk. New base-color modes (e.g., a "samples from prev frame" effect) should either explicitly include attenuation or trigger `clearFeedbackBuffer()` at appropriate boundaries.
- Reaching into `visualizer.renderer.prevFrameBuffer` is a private-API hack. It works on butterchurn 2.6.7 but could break on a future butterchurn upgrade. If butterchurn ever exposes a public `clearFeedback()` or similar, switch to that. The accessor is wrapped in `?.` chains so a missing field fails silently rather than throwing.
- "Clean preset load" now means **both** state-side cleanup AND framebuffer cleanup. Both must happen for a true reset.
