# MilkDrop Import — Dev Notes (Research & Spec)

Status: **📋 Research complete — feasibility VERIFIED. Awaiting sign-off before any code.**
Last updated: 2026-05-28

> Goal under discussion: let users drop a raw MilkDrop `.milk` preset file (or a folder/zip of them)
> into DiscoCast and have it appear as a playable preset, alongside the 1,144 bundled ones.
> Today we only ship pre-converted JSON; we cannot ingest the native `.milk` text format.

---

## 🚦 Phase tracker — PICK UP HERE

**This block is the single source of truth for where we are. Update it on every change.**
Detail for each phase is in §6.

| Phase | What | State | Next action |
|---|---|---|---|
| 0 | Research & feasibility | ✅ **DONE** (2026-05-28) | — |
| 1 | Single-file `.milk` import (the spike) | ⬜ **NOT STARTED** | `npm i milkdrop-preset-converter`; build `src/milkdropImport.js`; wire one "Import .milk" button in the Library panel |
| 2 | Batch + drag-and-drop | ⬜ Not started | Multi-file loop + reuse `importResultModal` |
| 3 | `.zip` pack import | ⬜ Not started (optional v1) | Lazy JSZip → filter `*.milk` → Phase-2 path |
| 4 | Polish (thumbnails, de-dupe, User Guide) | ⬜ Not started | — |

**Current state in one line:** Research done, feasibility verified, nothing built. Awaiting
sign-off on §7 open questions (entry point, `.zip` in/out for v1) before starting Phase 1.

**The 3 facts a fresh reader needs:**
1. A converted `.milk` becomes an ordinary **custom preset** — `createCustomPreset()` then
   `refreshCustomPresets()`. No engine changes.
2. Conversion is **client-side, pure JS, MIT** — `milkdrop-preset-converter`'s `convertPreset(text)`.
   Lazy-load it (776 KB) like FFmpeg.wasm.
3. **No CSP change** — `'unsafe-eval'` is already in `nginx.conf:16`.

---

## 🎯 TL;DR (read this block only)

- **It's feasible, client-side, in the browser, with no server and no WASM.** A single MIT-licensed
  npm package — [`milkdrop-preset-converter`](https://github.com/jberg/milkdrop-preset-converter)
  (by the Butterchurn author) — takes raw `.milk` text and returns the **exact JSON shape our
  bundled presets already use** (`shapes`, `waves`, `init_eqs_str`, `frame_eqs_str`,
  `pixel_eqs_str`, `baseVals`, `warp`, `comp`).
- **It drops straight into our existing custom-preset pipeline.** A converted preset is just a
  custom preset whose fields came from the converter instead of the editor. It saves via
  `createCustomPreset()`, registers via `refreshCustomPresets()`, and shows up in the drawer with
  zero engine changes. We already have an import-result modal for per-file success/failure.
- **No CSP change needed.** The converter uses `new Function` to compile equations — but so does
  Butterchurn itself, and our deployed `nginx.conf` already ships `script-src 'self' 'unsafe-eval'`.
  Verified, not assumed.
- **We are NOT limited to the old format.** The converter ingests **both** old (1.x, equations +
  default shaders) and new (2.x, custom HLSL pixel shaders) `.milk` files. This is the **same
  converter the official butterchurn.com site uses for in-browser import** — a proven, shipping
  tool. Realistic expectation: **all old-format presets convert cleanly, and the large majority of
  new-format presets too.** A *minority* of very shader-heavy presets may translate imperfectly or
  fail; we catch those per-file and report them in the existing modal, so an import never breaks on
  one bad file. (Native-quality conversion exists as a *future* escape hatch — §5 — but isn't needed
  for v1.)
- **Cost:** ~776 KB minified self-contained bundle. **Lazy-load it** (dynamic `import()`) exactly
  like FFmpeg.wasm, so it never touches the main bundle for users who don't import.

**Recommendation: build it.** Phased plan in §6. Open questions for you in §7.

---

## 1. What "MilkDrop import" means

MilkDrop presets are `.milk` files — plain-text, INI-style. A user who has a folder of `.milk`
files from Winamp/MilkDrop (or downloads a pack) currently has no way to use them here. "Import"
means: **read the `.milk` text → convert to Butterchurn JSON → store as a custom preset → play it.**

This is distinct from our existing `.dcshow.json` / custom-preset JSON import (`importFromFile`),
which round-trips presets *we* created. MilkDrop import is a one-way ingest of a foreign format.

---

## 2. The `.milk` format (just enough)

A `.milk` file is one INI section beginning with `[preset00]`, holding:

- **`baseVals`** — flat `key=value` motion/wave/color params (`fRating`, `fDecay`, `zoom`, `rot`,
  `wave_mode`, `nWaveMode`, etc.).
- **Per-frame init / per-frame / per-pixel equation blocks** — `per_frame_init_1=...`,
  `per_frame_1=...`, `per_pixel_1=...`. These are written in **NS-EEL2** (Nullsoft Expression
  Evaluation Library), a small C-like scripting language.
- **Custom shapes (0–3) and custom waves (0–3)** — each with their own `baseVals` and EEL blocks.
- **`warp_1`…`warp_N` and `comp_1`…`comp_N`** — optional custom **HLSL** (DirectX) pixel shaders,
  present only in MilkDrop 2.x "new shader" presets. Older 1.x presets have none and use the
  engine's default warp/comp.

Conversion therefore has two hard parts: **(a) transpile EEL → JavaScript**, and
**(b) transpile HLSL → GLSL**. Both are solved problems in the Butterchurn ecosystem.

---

## 3. The conversion toolchain (what exists, and the browser-vs-native split)

All by Jordan Berg (`jberg`), the Butterchurn author, all **MIT**:

| Package | Role | Runs in browser? |
|---|---|---|
| [`milkdrop-preset-converter`](https://github.com/jberg/milkdrop-preset-converter) | **Orchestrator.** `convertPreset(text)` → Butterchurn JSON | ✅ **Yes — pure JS** |
| [`milkdrop-eel-parser`](https://github.com/jberg/milkdrop-eel-parser) | EEL2 → JS (ClojureScript-compiled) | ✅ Yes (bundled inside above) |
| `hlslparser-js` | HLSL → GLSL, **pure JS** | ✅ Yes (bundled inside above) |
| `milkdrop-preset-utils` | split `.milk`, base-preset scaffolding | ✅ Yes (bundled inside above) |
| [`milkdrop-shader-converter`](https://github.com/jberg/milkdrop-shader-converter) | HLSL → GLSL via **native mojoshader** (`cmake-js` + `nan`) | ❌ **No — native node addon** |
| `milkdrop-preset-converter-node` / `-aws` | bulk/server conversion using the native shader path | ❌ Node/Lambda only |

**The key insight:** there are *two* HLSL→GLSL paths. The browser package
(`milkdrop-preset-converter`) uses the **pure-JS `hlslparser-js`**. The Node/AWS packages use the
**native mojoshader** addon (higher fidelity, but needs a C++ toolchain — that's *why* the bulk
converter was put on AWS Lambda). The big "15,056 presets" and "tens-of-thousands" archives were
mass-converted with the native path. We don't need native — we accept the JS path's fidelity gap
(§5) in exchange for running entirely in the user's browser with no backend.

### The browser API (verified from source)

```js
import { convertPreset } from 'milkdrop-preset-converter';

const json = await convertPreset(milkFileText);
// json = { shapes, waves, init_eqs_str, frame_eqs_str, pixel_eqs_str,
//          baseVals, warp, comp, presetParts }
```

`convertPreset` splits the text at `[preset00]`, parses EEL via `milkdrop-eel-parser`, runs
`convertShader()` on the warp + comp HLSL in parallel, and returns a preset map. We strip the extra
`presetParts` key and store the rest.

There are also lower-level exports we likely won't need: `convertShader`, `convertPresetEquations`,
`convertWaveEquations`, `convertShapeEquations`.

---

## 4. Verified audit findings

Everything below was confirmed against the live npm registry, the package source, and our own code
— not assumed.

| Claim | Verified? | Evidence |
|---|---|---|
| Latest published version is `0.1.2`, MIT | ✅ | npm registry `dist-tags.latest` |
| `main` is a single self-contained bundle | ✅ | `dist/milkdrop-preset-converter.min.js`, 776 KB, deps webpacked in (cljs EEL parser + hlslparser inlined) |
| Output JSON shape == our bundled preset shape | ✅ | Baron preset keys: `shapes, waves, init_eqs_str, frame_eqs_str, pixel_eqs_str, baseVals, warp, comp` — exact match to `convertPreset` output |
| Converted preset slots into our custom-preset storage | ✅ | `customPresets.js` schema already carries `baseVals/shapes/waves/*_eqs_str`; `refreshCustomPresets()` (`visualizer.js:571`) registers them and even back-fills `_str` variants |
| No CSP change required | ✅ | Converter + Butterchurn both use `new Function`; deployed `nginx.conf:16` already has `script-src 'self' 'unsafe-eval'` |
| Engine needs no changes | ✅ | The engine loads any object with these keys via `loadPreset()`; it can't tell bundled from converted |

### Bundle-size / loading

776 KB min (≈200 KB gzipped) is too big for the main bundle for a feature most users won't touch.
**Lazy-load with dynamic `import()`**, mirroring the FFmpeg.wasm pattern already in
`videoTranscoder.js` (loaded only when an oversized video is uploaded). The converter downloads only
when the user actually imports a `.milk` file.

---

## 5. Format support & shader fidelity (NOT an old-vs-new wall)

**Both formats import.** `convertPreset()` parses old (1.x) and new (2.x custom-shader) `.milk`
files alike. The only nuance is how cleanly the HLSL→GLSL shader translation lands, and it's done by
the **same pure-JS converter butterchurn.com ships for in-browser import** — so the track record is
real, not theoretical.

Realistic expectation:

- **Old-format presets (no custom shaders)** — equations + default shaders only. **Convert cleanly.** ✅
- **New-format presets (custom HLSL warp/comp)** — the **large majority convert and render correctly.** ✅
  A *minority* of very shader-heavy presets may translate imperfectly (compiles but looks off) or
  throw during conversion. ⚠️ This is the edge, not the rule.

Why the edge exists: there are two HLSL→GLSL paths in the ecosystem (§3). The browser path
(`hlslparser-js`, pure JS) is what we use and what the official site uses. The *native* path
(mojoshader) was used to mass-convert the giant offline archives and is marginally more complete on
exotic shaders — but it needs a C++ toolchain, which is why it lived on a server. We don't need it.

**How we handle the minority that fail (honest UX, not a fix):**
1. Wrap each file's `convertPreset` in try/catch — one bad file never breaks the whole import.
2. Catch GLSL compile/load failures at Butterchurn's `loadPreset` and mark that preset failed.
3. Report per-file outcomes in the **existing `importResultModal.js`** (already lists imported names
   + failures with reasons — reused verbatim).
4. User Guide wording: "Imports classic and modern MilkDrop presets. A few advanced shader-heavy
   presets may not convert perfectly." Accurate, not over-promised.

**Future escape hatch (out of scope for v1):** if the rare failures ever matter, run the native
mojoshader converter in a Tauri sidecar (macOS/Windows app only) — same pattern as the
transparent-WebM sidecar. Noted only so we don't paint ourselves into a corner; **not needed to ship.**

---

## 6. Proposed phased plan

### Phase 1 — Single-file import (the spike)
- `npm i milkdrop-preset-converter`.
- New module `src/milkdropImport.js`: `async importMilkFile(file)` → reads text → lazy
  `import('milkdrop-preset-converter')` → `convertPreset()` → strip `presetParts` → derive a name
  from the filename → `createCustomPreset({ name, ...converted })`.
- Entry point: a **"Import .milk"** action. Cleanest home = the Preset Studio Library panel
  (`presetLibrary.js`) next to the existing JSON import, since that's already the
  custom-preset import surface. (Discussion point — see §7.)
- After save: `presetRegistry.refresh()` + `engine.refreshCustomPresets()` so it appears live.
- Verify: import 5–10 classic `.milk` files, confirm they play and match expectation.

### Phase 2 — Batch + drag-and-drop
- Accept multi-file selection and drag-drop of many `.milk` files at once.
- Loop with per-file try/catch; aggregate into one `importResultModal` summary (imported names +
  failed names with reasons) — same UX as our JSON batch import.

### Phase 3 — `.zip` packs (optional, likely worth it)
- MilkDrop packs ship as folders/zips. Add JSZip (or the browser's native decompression) to unpack
  `.zip`, filter `*.milk`, run the Phase-2 batch path.
- JSZip is small; gate it behind the same lazy-load so it doesn't bloat the main bundle.

### Phase 4 — Polish
- De-dupe on name collision (reuse the rename-on-collision logic already in `importPreset`).
- Thumbnail generation for imported presets (we already render static thumbnails for custom presets).
- User Guide entry (index.html help-modal + help.html) — and per house rule, update this doc + the
  Library panel doc.

---

## 7. Open questions for discussion (no decisions made)

1. **Entry point.** I lean toward the **Preset Studio Library panel** (it's already the
   custom-preset import home, and an imported `.milk` becomes editable there). The main player
   drawer is the other candidate if you want import without opening the Studio. Could live in both.
2. **Editability expectation.** A converted preset's motion lives in `frame_eqs_str` (raw EEL→JS),
   *not* in our Studio's structured Motion sliders. So an imported preset will **play** perfectly
   but the Motion/Wave **sliders won't reflect its internals** — they'll act as offsets on top.
   That's the same situation as today's bundled presets when you "Random → edit." Worth a sentence
   in the guide so it isn't surprising.
3. **Scope of v1.** Phase 1+2 (single + batch loose files) is the obvious MVP. Is `.zip` (Phase 3)
   in or out for the first ship?
4. **Vendor or depend?** The converter is unmaintained (last publish 2018, babel-runtime 6 era) but
   self-contained and frozen-stable. Pinning `0.1.2` is fine for v1; vendoring (like we did
   butterchurn) is only worth it if we hit a bug we must patch. Recommend: **pin, don't vendor, yet.**
5. **Naming.** Filename → preset name (strip `.milk`)? Or read a name from inside the file if present?
   `.milk` files don't carry a canonical display name, so filename is the pragmatic choice.

---

## Sources

- [jberg/milkdrop-preset-converter](https://github.com/jberg/milkdrop-preset-converter) — browser converter (MIT)
- [jberg/milkdrop-eel-parser](https://github.com/jberg/milkdrop-eel-parser) — EEL2 → JS (MIT)
- [jberg/milkdrop-shader-converter](https://github.com/jberg/milkdrop-shader-converter) — native HLSL→GLSL (the path we *don't* use)
- [jberg/milkdrop-preset-converter-aws](https://github.com/jberg/milkdrop-preset-converter-aws) — why bulk conversion went server-side
- [ansorre/tens-of-thousands-milkdrop-presets-for-butterchurn](https://github.com/ansorre/tens-of-thousands-milkdrop-presets-for-butterchurn) — pre-converted archive (native path)
- [Speeding Up Webamp's Music Visualizer with WebAssembly](https://jordaneldredge.com/speeding-up-winamps-music-visualizer-with-webassembly/) — background on the EEL/HLSL transpilation approach
- Local: `src/customPresets.js`, `src/presetRegistry.js`, `src/visualizer.js:571` (`refreshCustomPresets`), `nginx.conf:16` (CSP)
