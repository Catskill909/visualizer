# More Presets — Research & Options

> **Status (2026-04-19):** Phase 1 shipped. App now loads **1,144 unique presets** from all four `butterchurn-presets` sub-packs (Base/Extra/Extra2/MD1 = 395 unique) plus the Baron community pack (762 files, 13 name overlaps). See "Implementation notes" at the bottom of this doc.

## Background

This document outlines every verified option for expanding the preset count, with format compatibility confirmed for each. The previous attempt to expand using `butterchurn-presets-weekly` failed because that package only contains **S3 URLs** (strings pointing to remote JSON files), not actual preset data.

---

## What Butterchurn Expects

A valid preset is a **plain JavaScript object** with these keys:

```
baseVals, shapes, waves, init_eqs_str, frame_eqs_str, pixel_eqs_str, warp, comp
```

The visualizer loads them via `visualizer.loadPreset(presetObject, blendTime)`. Any source that provides objects with this structure will work. This is the critical requirement that `butterchurn-presets-weekly` failed to meet (it had URL strings instead).

---

## Option 1: Official Sub-Packs (Already Installed) ⭐ RECOMMENDED

The `butterchurn-presets` npm package we already have includes **hidden sub-packs** beyond the 100 base presets:

| Sub-Pack | File | Count | Format Valid |
|----------|------|-------|-------------|
| Base (current) | `butterchurnPresets.min.js` | 100 | ✅ |
| Extra | `butterchurnPresetsExtra.min.js` | 146 | ✅ |
| Extra 2 | `butterchurnPresetsExtra2.min.js` | 122 | ✅ |
| MilkDrop 1 | `butterchurnPresetsMD1.min.js` | 87 | ✅ |
| **Combined Total** | | **395** | ✅ |

> [!IMPORTANT]
> These are already installed in `node_modules/butterchurn-presets/lib/`. No new dependencies needed. All presets use `getPresets()` and return valid objects with `baseVals`, `shapes`, `waves`, `warp`, `comp`.

**Integration effort**: ~10 lines of code change in `visualizer.js`

```js
// Load all sub-packs from the already-installed package
import butterchurnPresetsBase from 'butterchurn-presets';
import butterchurnPresetsExtra from 'butterchurn-presets/lib/butterchurnPresetsExtra.min.js';
import butterchurnPresetsExtra2 from 'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js';
import butterchurnPresetsMD1 from 'butterchurn-presets/lib/butterchurnPresetsMD1.min.js';

// Merge all packs into one map
const allPresets = {
  ...butterchurnPresetsBase.getPresets(),
  ...butterchurnPresetsExtra.getPresets(),
  ...butterchurnPresetsExtra2.getPresets(),
  ...butterchurnPresetsMD1.getPresets(),
};
```

**Pros:**
- Zero new dependencies — already in `node_modules`
- Same author (jberg), same format, same `getPresets()` API
- All presets are bundled locally — no network requests
- 4× the presets (100 → 395) with zero risk

**Cons:**
- "Only" 395 presets, not thousands

---

## Option 2: Baron Presets Pack (npm)

A community-maintained preset pack recently published (Feb 2026):

| Detail | Value |
|--------|-------|
| Package | `butterchurn-presets-baron` |
| Version | 1.5.1 |
| Count | **762 presets** |
| Size | 4.2 MB |
| Format | ✅ Valid (same keys: `baseVals`, `shapes`, `waves`, `warp`, `comp`) |
| Module | ESM only (`"type": "module"`) |
| API | Named export `getPresets()` |

> [!WARNING]
> This package is **ESM-only** with `top-level await` and imports JSON files without `type: "json"` import attributes. It works fine when bundled by Vite (which handles this automatically), but **cannot be tested with raw Node.js**. Vite will transpile it correctly at build time.

**Integration effort**: ~5 lines + Vite config update

```js
import { getPresets as getBaronPresets } from 'butterchurn-presets-baron';
const baronPresets = getBaronPresets();
// Merge with other presets
Object.assign(allPresets, baronPresets);
```

The `vite.config.js` would need `butterchurn-presets-baron` added to `optimizeDeps.include`.

**Pros:**
- 762 unique presets
- Active maintainer, recently updated
- Confirmed format match
- npm installable, Vite-compatible

**Cons:**
- New dependency
- ESM-only — may need Vite config tweaks
- Node < 22 compatibility concerns (top-level await)

---

## Option 3: Official Converted JSON Files (Already Installed)

The `butterchurn-presets` package also ships a `presets/converted/` directory containing **1,754 individual JSON files** — every preset that was converted from the original MilkDrop format.

| Detail | Value |
|--------|-------|
| Location | `node_modules/butterchurn-presets/presets/converted/` |
| Count | **1,754 presets** |
| Format | ✅ Valid JSON (same keys as bundled presets) |
| Loading | Requires dynamic `import()` or a build-time script |

> [!NOTE]
> These are the raw JSON source files that the sub-packs (base, extra, extra2, md1) were curated from. Many overlap with the 395 from sub-packs, but ~1,359 additional presets exist that aren't in any sub-pack.

**Integration approach**: Build-time bundling script

```js
// Build script to generate a presets bundle from JSON files:
const fs = require('fs');
const dir = 'node_modules/butterchurn-presets/presets/converted/';
const presets = {};
for (const file of fs.readdirSync(dir)) {
  const name = file.replace('.json', '');
  presets[name] = JSON.parse(fs.readFileSync(dir + file, 'utf8'));
}
fs.writeFileSync('src/all-presets.json', JSON.stringify(presets));
```

Then in the app: `import allPresets from './all-presets.json'`

**Pros:**
- 1,754 presets — largest verified collection
- Already installed, no new dependencies
- All presets confirmed format-compatible
- Official source from butterchurn author

**Cons:**
- Requires a build-time bundling step (one-off script)
- Generated JSON bundle will be large (~15-25 MB)
- Some presets may be broken/low-quality (they include presets not in the curated packs)
- Large bundle = longer initial page load

---

## Option 4: ansorre's 15,000+ Preset Collection (GitHub)

A community repo with converted MilkDrop presets in butterchurn JSON format:

| Detail | Value |
|--------|-------|
| Repo | `ansorre/tens-of-thousands-milkdrop-presets-for-butterchurn` |
| Count | **15,056+ presets** |
| Format | JSON (needs verification per-preset) |
| Distribution | Single `.zip` file on GitHub |
| npm | ❌ Not available as npm package |

**Integration approach**: Download zip, extract, build-time script to bundle

**Pros:**
- Massive library — 15,000+ presets
- Growing collection

**Cons:**
- Not npm-distributed — manual download and management
- Format not individually verified (some may crash butterchurn)
- Bundle size would be enormous (~100+ MB JSON)
- No quality curation — likely many broken/duplicate/low-quality presets
- Would need lazy-loading strategy (can't load 15K presets into memory)

---

## Comparison Table

| Option | Presets | New Deps | Risk | Effort | Bundle Size |
|--------|---------|----------|------|--------|-------------|
| 1. Official Sub-Packs | **395** | None | 🟢 None | ~10 min | ~3 MB |
| 2. Baron Pack | **762** | 1 npm | 🟡 Low | ~20 min | ~4 MB |
| 1 + 2 Combined | **~1,100** | 1 npm | 🟡 Low | ~30 min | ~7 MB |
| 3. Official JSON Files | **1,754** | None | 🟡 Medium | ~1 hr | ~20 MB |
| 4. ansorre 15K | **15,056** | Manual | 🔴 High | ~1 day | ~100+ MB |

---

## Recommendation

### Phase 1 (Today): Options 1 + 2 → ~1,100 presets

1. **Load all official sub-packs** (Option 1) — zero risk, already installed, +295 presets
2. **Add baron pack** (Option 2) — Vite handles the ESM, +762 presets
3. Deduplicate by preset name → expect **~1,000–1,100 unique presets**

This gives us 10× what we have now with minimal effort and low risk.

### Phase 2 (Future, Optional): Option 3 → ~1,754 presets

If 1,100 isn't enough, run a build-time script to bundle the 1,754 official JSON files. This requires:
- A one-off Node script in `scripts/bundle-presets.js`
- Possible lazy-loading for bundle size management
- Quality filtering (skip presets that crash butterchurn)

### Not Recommended: Option 4

The 15K collection is too large to bundle, would require lazy-loading infrastructure, and has unknown quality. Better suited for a server-side preset streaming architecture, not a static Vite app.

---

## Integration Plan (Phase 1)

Changes needed to go from 100 → ~1,100 presets:

### 1. `visualizer.js` — Load all packs

```js
import butterchurnPresetsImport from 'butterchurn-presets';
import butterchurnPresetsExtra from 'butterchurn-presets/lib/butterchurnPresetsExtra.min.js';
import butterchurnPresetsExtra2 from 'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js';
import butterchurnPresetsMD1 from 'butterchurn-presets/lib/butterchurnPresetsMD1.min.js';
import { getPresets as getBaronPresets } from 'butterchurn-presets-baron';

// In init():
const packs = [
  resolveModule(butterchurnPresetsImport, 'butterchurnPresets', 'getPresets')?.getPresets(),
  resolveModule(butterchurnPresetsExtra, 'butterchurnPresetsExtra', 'getPresets')?.getPresets(),
  resolveModule(butterchurnPresetsExtra2, 'butterchurnPresetsExtra2', 'getPresets')?.getPresets(),
  resolveModule(butterchurnPresetsMD1, 'butterchurnPresetsMD1', 'getPresets')?.getPresets(),
  getBaronPresets(),
];

this.presets = {};
for (const pack of packs) {
  if (pack && typeof pack === 'object') Object.assign(this.presets, pack);
}
```

### 2. `vite.config.js` — Add baron to optimizeDeps

```js
optimizeDeps: {
  include: [
    'butterchurn',
    'butterchurn-presets',
    'butterchurn-presets-baron',
  ],
},
```

### 3. Verification

- Run `npm run dev` and confirm console shows `[MilkScreen] Loaded ~1100 presets`
- Cycle through several presets to confirm they render
- Run `npm run build` to confirm production bundle compiles

---

## Implementation notes (what actually shipped)

### Final count
**1,144 unique presets.** Breakdown: 395 from the four official `butterchurn-presets` sub-packs + 762 from Baron − 13 overlapping names (later packs win).

### The `import.meta.glob` detour
The naïve integration of Baron (`import { getPresets } from 'butterchurn-presets-baron'`) fails at scale because Baron's `dist/index.js` contains 762 top-level `await import('./presets/<name>.json')` statements. Each dynamic import becomes a separate code-split chunk at build time, and the sequential awaits translate into **762 sequential HTTP round-trips at startup** — roughly 30+ seconds even on a fast connection.

Fix: bypass the package's entry point entirely and use Vite's `import.meta.glob` in `src/visualizer.js`:

```js
const baronModules = import.meta.glob(
  '/node_modules/butterchurn-presets-baron/dist/presets/*.json',
  { eager: true }
);
```

Combined with a `manualChunks` rule in `vite.config.js` that groups everything matching `butterchurn-presets-baron/dist/presets/` into a single `baron-presets` chunk, the net result is one additional JS file (~3.2 MB raw, ~320 KB gzipped) loaded once at app start. The `butterchurn-presets-baron` package is kept as a dependency only for the filesystem access; nothing imports its `index.js`.

### Option 4 revisit (research 2026-04-19)
A second GitHub-wide search found one new candidate not in this doc's original list: [`monochrome-music/butterchurn-presets-converted`](https://github.com/monochrome-music/butterchurn-presets-converted) — 9,670 pre-converted JSON presets. Rejected for Phase 1 because:
- No license declared (legally ambiguous for redistribution)
- Zero stars, single contributor, created 2026-03-26 (no social proof / longevity signal)
- `_conversion_errors.json` in the tree suggests an unknown number of duds
- Not on npm — would need a git submodule or build-time fetch
- 100–400 MB raw footprint forces lazy-loading infrastructure

Revisit if it gains a license and a community — otherwise skip.

No other qualifying packs exist on npm or GitHub as of this date. Every other search hit was a converter tool (`milkdrop-preset-converter`, `milkdrop-eel-parser`, etc.), a consumer app, or a different engine (MilkDrop3/projectm/raw `.milk` source).
