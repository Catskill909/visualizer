# Preset Save Bug — Audit & Fix Plan

**Status:** Fixed 2026-05-12.
**Discovered:** 2026-05-12
**Scope:** First save of a new preset only. Re-saving (overwrite) was unaffected.

### Fixes shipped

**Fix 1 — `src/customPresets.js`**
`createCustomPreset` was using a destructured parameter list that silently dropped
`motionReact`, `sceneMirror`, `solidPulse`, and related top-level fields on first save.
Replaced with `...data` spread so all state fields are preserved.

**Fix 2 — `src/customPresets.js`, `src/editor/inspector.js`, `src/visualizer.js`**
`motionReact` was only injected into `frame_eqs_str` at editor runtime — never at
player load time. Extracted `buildMotionReactFrameEqs` as a shared export and called
it in `visualizer.js:refreshCustomPresets()` so the player injects the equations
every time it registers a custom preset. Covers both the direct player path and the
export → import → player path.

---

## 1. Bug Summary

When a brand-new preset is saved for the first time in the Preset Studio, a subset of
top-level state fields are silently dropped from the saved record. On reload the missing
fields fall back to BLANK defaults, so all custom values set in the **Motion tab
(Audio Reactivity section)**, **Feel tab (Scene Mirror)**, and **Palette tab
(Solid-mode Fx)** appear to reset to zero.

Layer settings, `baseVals` (all main Motion/Wave/Feel sliders), and image layer
reactivity are unaffected — they survive the first save correctly.

---

## 2. Root Cause — Execution Trace

### Save path (new preset)

```
inspector.js: saveCurrent(name, null, thumbDataUrl)
  → builds:  data = { name, ...this.currentState }
             data contains: baseVals, images, motionReact, sceneMirror,
                            solidPulse, solidBreath, solidShift, solidColorB,
                            solidReactSource, solidReactCurve, …
  → id is null, so calls: createCustomPreset(data)          ← BUG IS HERE

customPresets.js: createCustomPreset({ name, baseVals, shapes, waves, warp,
                    comp, init_eqs_str, frame_eqs_str, pixel_eqs_str,
                    images, parentPresetName })
  → JS destructuring silently discards every field not in the list
  → DROPPED:  motionReact, sceneMirror, sceneMirrorKaleidoSpeed,
              solidPulse, solidBreath, solidShift, solidColorB,
              solidReactSource, solidReactCurve
  → calls saveCustomPreset({ id, name, schemaVersion, baseVals, … })
             WITHOUT the dropped fields
  → localStorage gets a record with no motionReact key
```

### Save path (overwrite existing preset)

```
inspector.js: saveCurrent(name, id, thumbDataUrl)
  → id is set, so calls: saveCustomPreset({ ...data, id, updatedAt })
             data still has all fields including motionReact ✅
  → localStorage record is complete
```

### Load path (both cases)

```
editor/main.js: inspector.loadPresetData(preset)
  → currentState = { ...deepClone(BLANK), ...deepClone(stateFields), … }
  → if motionReact is absent from stateFields, BLANK.motionReact wins (all zeros)
  → UI syncs: all Audio Reactivity sliders show 0.00, source = bass, curve = linear
```

---

## 3. Full Field Impact by Tab

### Motion tab — Audio Reactivity section

| Field | currentState key | Dropped on new-save? |
|---|---|---|
| Source dropdown | `motionReact.source` | ❌ yes |
| Curve buttons | `motionReact.curve` | ❌ yes |
| Zoom Amt | `motionReact.zoomAmt` | ❌ yes |
| Spin Amt | `motionReact.rotAmt` | ❌ yes |
| Warp Amt | `motionReact.warpAmt` | ❌ yes |
| Warp Speed Amt | `motionReact.warpSpeedAmt` | ❌ yes |
| Drift H Amt | `motionReact.driftXAmt` | ❌ yes |
| Drift V Amt | `motionReact.driftYAmt` | ❌ yes |
| Pulse | `motionReact.pulseAmp` | ❌ yes |
| Bounce | `motionReact.bounceAmp` | ❌ yes |
| Shake | `motionReact.shakeAmp` | ❌ yes |
| Beat Fade | `motionReact.beatFadeAmp` | ❌ yes |
| Strobe | `motionReact.strobeAmp` | ❌ yes |
| Shrink toggle | `motionReact.shrink` | ❌ yes |

### Motion tab — standard motion sliders

All stored in `baseVals` (zoom, rot, warp, warpanimspeed, dx, dy, sx, sy, echo_zoom,
echo_alpha, cx, cy, zoomexp, b1ed). `baseVals` **is** in the destructuring list.
**Not affected. ✅**

### Palette tab — variation and shader

`warp`, `comp`, `init_eqs_str`, `frame_eqs_str`, `pixel_eqs_str`, `shapes`, `waves`
are all in the destructuring list. **Not affected. ✅**

### Palette tab — Solid variation Fx panel only

| Field | currentState key | Dropped on new-save? |
|---|---|---|
| Pulse slider | `solidPulse` | ❌ yes |
| Breath slider | `solidBreath` | ❌ yes |
| Shift slider | `solidShift` | ❌ yes |
| Color B swatch | `solidColorB` | ❌ yes |
| React Source | `solidReactSource` | ❌ yes |
| React Curve | `solidReactCurve` | ❌ yes |

Only visible when a Solid-base variation is active. Non-solid presets unaffected.

### Wave tab

All wave controls stored in `baseVals`. **Not affected. ✅**

### Feel tab (not requested but affected)

| Field | currentState key | Dropped on new-save? |
|---|---|---|
| Scene Mirror buttons | `sceneMirror` | ❌ yes |
| Kaleido Speed | `sceneMirrorKaleidoSpeed` | ❌ yes |

---

## 4. Import / Export Impact Analysis

### Single preset export (`exportPreset`)

```
customPresets.js: exportPreset(id)
  → const exported = { ...preset }  // full spread of localStorage record
  → inlines image blobs
  → returns exported
```

**Impact:** Export is a faithfull copy of what is in localStorage. If the preset was
created via the bug path (new-save), the exported JSON will also be missing the dropped
fields. Presets that were subsequently re-saved (overwrite) will export correctly.

**After the fix:** New presets will be complete in localStorage, so exports will be
complete from the moment of first save.

### Single preset import (`importPreset`)

```
customPresets.js: importPreset(json)
  → data = parsed JSON
  → saveCustomPreset({ ...data, id, name, images, schemaVersion, … })
```

`importPreset` uses `saveCustomPreset` directly with a full spread — it does NOT go
through `createCustomPreset`. **Import is not affected by the bug and does not need
to change.**

Implication: if a user exports a buggy preset (missing fields) and reimports it, the
missing fields will still be absent. The data is already lost at export time.

### Bulk export / import (`exportAllPresets` / `importFromFile`)

Both call `exportPreset` and `importPreset` in a loop. Same analysis applies —
bulk paths are correct; the corruption happened upstream at save time.

### Timeline bundle export / import (`timelineStorage.js`)

Timeline export calls `exportPreset` per custom preset and bundles them.
Timeline import calls `importPreset` per bundled preset.
Same analysis — faithfully round-trips whatever is in storage. No changes needed.

---

## 5. Platform Build Impact Analysis

### Web (browser)

All preset logic is pure JavaScript / localStorage / IndexedDB. The fix is in one JS
file (`customPresets.js`). No build config changes. **No impact.**

### macOS (Tauri / build-and-sign.sh)

The Tauri backend (`src-tauri/src/main.rs`) has zero references to preset storage,
`createCustomPreset`, `motionReact`, or any related field. All preset logic runs
inside the WKWebView. The fix in `customPresets.js` is compiled into the JS bundle
by Vite; `build-and-sign.sh` picks up the fresh bundle as normal.

**Required after fix:** run `build-and-sign.sh` to produce an updated DMG, commit,
and push so Coolify serves the new container. **No entitlement or signing changes.**

### Windows (Tauri)

Same as macOS — no native code touches presets. Vite bundles the JS. The Windows
build picks up the fix automatically. **No impact beyond a normal rebuild.**

---

## 6. Existing Saved Presets — Migration Analysis

The fix is **not retroactive**. Presets already in a user's localStorage that were
created via the bug path will still be missing `motionReact` etc. On load they
continue to show BLANK defaults.

**No schema migration is needed or appropriate here** because:
- There is no canonical "correct" value to backfill — the user's original intent
  is unknown.
- `loadPresetData` already handles missing fields gracefully via the BLANK spread.
- Users who notice wrong values can re-dial and re-save (overwrite) to fix their
  own presets. The overwrite path has always worked correctly.

`SCHEMA_VERSION` stays at `1` — the fix adds no new fields, renames nothing, and
requires no migration logic.

---

## 7. The Fix

**File:** `src/customPresets.js`, lines 74–105
**Change:** Replace the destructured parameter list with a rest spread.

### Before

```javascript
export function createCustomPreset({
    name,
    baseVals = {},
    shapes = [],
    waves = [],
    warp = '',
    comp = '',
    init_eqs_str = '',
    frame_eqs_str = '',
    pixel_eqs_str = '',
    images = [],
    parentPresetName = null,
}) {
    const id = generateId();
    return saveCustomPreset({
        id,
        name,
        schemaVersion: SCHEMA_VERSION,
        baseVals,
        shapes,
        waves,
        warp,
        comp,
        init_eqs_str,
        frame_eqs_str,
        pixel_eqs_str,
        images,
        parentPresetName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}
```

### After

```javascript
export function createCustomPreset(data) {
    const id = generateId();
    return saveCustomPreset({
        ...data,
        id,
        schemaVersion: SCHEMA_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}
```

`saveCustomPreset` also writes `updatedAt: Date.now()` on every call, so that field
is set twice — the second write wins. No functional difference.

**Only caller:** `inspector.js:5858` — `createCustomPreset(data)` where `data` is
built from `this.currentState`. The currentState object is always a controlled,
fully-structured object. No risk of unexpected fields leaking in.

**No other files need to change.**

---

## 8. Test Checklist (before shipping)

- [ ] Create a new preset from scratch with a bundled visualization
- [ ] Set Motion Reactivity: source = Mid, curve = Squared, Zoom amt > 0, Strobe > 0
- [ ] Set Scene Mirror (Feel tab) to a non-default value
- [ ] Save as new preset (first save)
- [ ] Reload the editor, reopen the preset — verify all values survived
- [ ] Overwrite the preset (re-save) — verify still correct
- [ ] Export the preset as JSON — open JSON, confirm `motionReact` object is present
  and non-zero
- [ ] Import the exported JSON as a new preset — verify values load correctly
- [ ] Repeat with a Solid-base variation — verify solidPulse/Breath/Shift survive
- [ ] Export all presets bulk — verify bundle contains motionReact in affected presets
- [ ] Import bulk bundle — verify values are restored

---

## 9. Open Questions

1. **Retroactive repair tool?** A one-time migration button ("Re-save all presets")
   could re-run `saveCustomPreset` on every stored record to normalize them. Low
   priority; users can fix their own presets by opening and re-saving. Defer.

2. **Audit other `createCustomPreset` callers?** Currently there is exactly one:
   `inspector.js:5858`. Confirm with `grep` before shipping that no new callers
   have been added.
