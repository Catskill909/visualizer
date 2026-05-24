# Transparent Preset Background — Dev Doc

## ✅ STATUS — 2026-05-24 (Phase 1 + 2 BUILT & VERIFIED, committed)

**Phase 1 (engine) + Phase 2 (toggle UI) are done and committed.** Transparency verified in `editor.html` (browser): with *Show layers only* + *Transparent background* on, the canvas goes truly transparent (a Photoshop-style checkerboard shows through; the logo layer floats on it) — confirming **~3602 IS the display comp shader** (the audit's correction was right).

Shipped:
- Engine: `alpha:true` + `clearColor 0` + comp shader `vec4(ret, vColor.a * ret_a)`; `_buildCompShader` gate `_bgT = _imagesOnly && bgTransparent`, guard `&& !_bgT`, `col_a` tracking, `_buildImageBlock(trackAlpha)` reusing `_t.w*_op`.
- UI: **Transparent background** toggle beside *Show layers only* (Layers section, now stacked — was cramped); **editor-only checkerboard** indicator on the canvas (canvas CSS bg through alpha; timeline/output zones don't get it → they reveal real content).
- Persistence: `bgTransparent` round-trips (stored on `currentState`, spread by save/load; `customPresets` stores wholesale). **Bonus fix:** `imagesOnly` never actually persisted (latent bug) — now it does (required, since the gate needs it on load). Backward-compatible (old presets → defaults false).

**Remaining:**
- **Phase 3 — timeline validation:** save a transparent preset → drop it in a timeline zone stacked over another zone → confirm the lower zone shows through (the real payoff). The editor checkerboard proves the alpha; the timeline proves the stacking.
- **§G cross-platform gate:** verify in macOS `tauri-dev` (WKWebView) then Windows — NOT signed off on the browser alone. (De-risked by §H: stacked-alpha video already does per-pixel alpha in WKWebView.)
- Optional: a transparency checkerboard isn't shown in the timeline editor's zone preview (only the studio canvas) — fine for now.

---

## 🔍 Audit & re-plan — 2026-05-23 (read this FIRST; supersedes older details below)

Re-audited against the **current code** + everything learned building the output/NDI pipeline today (see [`output-dev.md`](output-dev.md) / [`native-output-dev.md`](native-output-dev.md)). The older sections (spec, phases, **post-mortem, guardrails**) are still valuable — the post-mortem + guardrails especially. **Where this audit and the older text disagree, this audit wins** (line numbers + which shader to edit have been corrected).

### A. Clean slate confirmed
`bgTransparent` appears **nowhere** in `src/` or `editor.html` — the wiped attempt left no residue. `butterchurn.js` is **6,819 lines** (committed-clean; the "12,379 lines" in Mistake 1 was the reformatting damage, since reverted). Start fresh.

### B. Verified anchors (the doc's old line numbers, re-checked today)
| What | Where (verified 2026-05-23) | Note |
|---|---|---|
| WebGL context `alpha` | `butterchurn.js:6570` — `alpha: false` (inside `getContext('webgl2',{…})` @6569; `premultipliedAlpha:false` @6574) | ✅ doc was right |
| Display clear colour | `butterchurn.js:2391` — `clearColor(0,0,0,1)` | nearly cosmetic — see C |
| **Display COMP shader output** | `butterchurn.js:~3602` — `fragColor = vec4(ret, vColor.a)` | ⚠️ **the old doc pointed at line 4356 — that's the WARP/feedback shader (`vec4(ret,1.0)*vColor`, an internal buffer, NOT the display). Display alpha = the COMP shader (~3602).** Confirm it's the screen pass at impl time. |
| `_buildCompShader()` | `inspector.js:6162` | ✅ |
| `_buildImageBlock(img)` | `inspector.js:6293` | ✅ |
| `_buildRuntimePreset(state)` | `inspector.js:6135` | the safe choke point (Mistake 4) |
| **early-return guard** | `inspector.js:6173` — `if (visibleImages.length===0 && !_solidColor && sm==='none' && _po>=1.0) { comp=BLANK_COMP; return; }` | ⚠️ **must add `&& !this.currentState.bgTransparent`** or transparent-with-no-layers falls back to opaque. (Exactly Mistake 6 — but now *verified*, not blind.) |
| comp `col` type | `inspector.js:6215/6251` (`vec3 col …`), `ret = col;` @6269 | needs a parallel `float col_a` |

### C. The real mechanism (sharper than the old spec)
The comp shader draws a **full-screen quad every frame**, so `clearColor` is almost irrelevant — **the canvas alpha is whatever the comp shader writes**, today `vColor.a` (=1.0) → opaque everywhere. The load-bearing change is **making the comp shader output a computed alpha.** Minimal, surgical (verify at impl time):
- `butterchurn.js` comp shader (~3602): declare `float ret_a = 1.0;` before `fragShaderText`; output `fragColor = vec4(ret, vColor.a * ret_a);`. Opaque presets: `ret_a` stays 1.0 → byte-identical to today.
- `butterchurn.js:6570`: `alpha:false → true`.
- `inspector.js _buildCompShader` (**only when `bgTransparent`**): track `float col_a` beside `col` (start `0.0` in `_imagesOnly`), accumulate per layer with "over" (`col_a = col_a + a*(1.0-col_a)`), append `ret_a = col_a;` after `ret = col;`. Add `&& !bgTransparent` to the 6173 guard.
- `clearColor` (2391) → 0 is harmless to add but **not** load-bearing (the quad covers every pixel).

### D. Where transparent alpha ACTUALLY reaches (reconciliation with today's output work)
Stacking already **shipped today** (A3) — via **blend modes**, because canvases are opaque. Transparent-bg upgrades that to **true alpha reveal**, but only on paths that carry alpha:

| Output path | Carries alpha? | Result with transparent-bg |
|---|---|---|
| **Operator screen** (CSS-stacked canvases) | ✅ yes (`alpha:true` canvas) | **true alpha reveal** |
| **Approach A — fullscreen app on the projector** (the EVENT priority) | ✅ yes (it *is* the operator render) | **true alpha reveal — the headline win** |
| Web mirror **output window** (`<video>` of `captureStream`) | ❌ no — `<video>` shows alpha as **black** | falls back to blend-mode (= today) |
| **NDI** (current `ndi-send` = **JPEG**) | ❌ no — JPEG has no alpha; composer's `<video>` path drops it too | falls back to blend-mode |

**So the headline payoff is the operator screen + Approach-A projector — exactly the event path prioritized today.** It adds no alpha to the web window / JPEG-NDI (those already blend-mode stack; no regression, just no bonus). **This answers the old "does captureStream preserve alpha?" question: effectively NO** for the `<video>` path. True alpha over NDI/Syphon would need an RGBA transport (PNG/raw) — a later enhancement.

### E. Re-scoped plan (ready for tomorrow)
1. **Engine** — the surgical changes in C. **Console-test in `editor.html`** with a layers-only preset before any UI.
2. **One toggle** — `bgTransparent` chip in the Palette tab + `bgTransparent:false` schema default (old UI section still valid).
3. **Verify on the paths that matter** — operator-screen reveal; **Approach-A fullscreen-on-projector reveal** (the real test, once the projector's here). Confirm web-window/NDI degrade to blend-mode (no black-box regression). **Then run the §G cross-platform gate** (browser → macOS `tauri-dev` → Windows) — this is the shipping platform; don't sign off on browser alone.

### G. Cross-platform (Tauri webview) compatibility — VERIFY on the desktop builds, not just the browser
The feature is *built* in the browser (dev), but the *shipping* product is the **desktop app** — and today proved desktop webviews differ from Chrome (WKWebView video taint; `captureStream` popups dead in Tauri). **Do not assume browser parity.** Gate Phase 3 as ✅ browser → ✅ macOS `tauri-dev` → ✅ Windows:
- **macOS (WKWebView):** confirm `getContext('webgl2',{alpha:true})` + `clearColor(0,0,0,0)` + the comp-shader alpha actually render transparent *in `tauri-dev`*. WKWebView has historical straight-vs-premultiplied-alpha quirks — `premultipliedAlpha:false` is already set (`butterchurn.js:6574`), which is the right setting, but it MUST be eyeballed on the real build. Re-test the operator-screen + **Approach-A projector** reveal here specifically.
- **Keep the Tauri window OPAQUE.** `tauri.conf.json` windows have **no** `transparent:true` (verified) — keep it. Transparency must composite *inside* the webview (canvas-over-canvas, or canvas-over-app-background), never bleed to the OS desktop. On the projector (Approach A), empty areas must read **black** (the app bg), not the macOS wallpaper. If they show the desktop, the window got transparent — revert.
- **Global engine change:** `alpha:false → true` is on **every** butterchurn canvas on **every** platform (player, editor, timeline zones). Regression-check that existing **MilkDrop presets look unchanged** in `tauri-dev` on macOS (and Windows), not only in the browser — the "zero impact" claim relies on the comp shader still outputting `alpha = 1.0` there too.
- **Windows (WebView2 / Chromium):** behaves like Chrome → likely parity; verify after macOS (the Windows build is less mature — [`windows-dev.md`](windows-dev.md)).

### H. REUSE the existing alpha-layer plumbing (transparent video / GIF / luma key) — the big de-risk
You already ship **per-layer alpha end-to-end.** `_buildImageBlock` samples each layer as `vec4 _t` and **already** composites with the layer's alpha — the normal blend is literally `col = mix(col, _src, _t.w * _op)` (per-blend-mode variants for additive/multiply/overlay/screen). Where `_t.w` comes from is already solved per layer type:
- **PNG/still alpha + GIF** (`alphaMode` preserve/fade).
- **Transparent video = the stacked-alpha pipeline:** WebM/VP9-alpha → H.264 (RGB top half + alpha-as-luma bottom half) via the ffmpeg sidecar (`convert_to_stacked_alpha`, `main.rs`; macOS import path). The texture is uploaded **2× tall** and the **comp shader reconstructs `_t.w` from the bottom-half R channel** (`visualizer.js:1450-1455` + the stacked-alpha branch in `_buildImageBlock`). See [[project_transparent_webm_macos_plan]] / [[project_webm_alpha_dead_ends]].
- **Luma key** (`lumaKeyLo/Hi`) derives alpha by keying.

**So transparent-bg invents NO new alpha — it accumulates the alpha the comp shader already computes** into a canvas-alpha output. After each existing blend line, add:
```glsl
col_a = col_a + (effective_a) * (1.0 - col_a);   // "over"
```
where **`effective_a` is the SAME per-blend-mode coverage the RGB blend just used** (`_t.w * _op` for normal, etc.). ⚠️ **This corrects the old spec's crude `col_a = col_a + _op*(1.0-col_a)`** — that ignores `_t.w`, so a fully-transparent texel (`_t.w=0`) would wrongly become opaque. **Reuse `_t.w * _op`, not `_op`.**

**Unifies the features:** a stacked-alpha **video silhouette** reveals the layer beneath using the *same* alpha it already uses to composite — transparent video + transparent background become one coherent thing.

**Cross-platform de-risk (feeds §G):** the stacked-alpha shader compositing **already runs in macOS WKWebView** — that's *why* stacked-alpha exists (WKWebView drops VP9 alpha, so alpha is reconstructed in-shader). **So per-pixel alpha math is already proven in WKWebView's comp shader.** The only unverified macOS bit is the canvas *output* (`alpha:true` context + writing the computed alpha to `fragColor`) — a much smaller surface than "does alpha work on macOS at all" (it does).

### Guardrails still in force (all mandatory)
All of "Strict guardrails" below is mandatory — especially: read this doc first; **no code without an approved written plan**; never paraphrase `old_string` when editing `butterchurn.js` (read exact bytes; the reformat disaster is Mistake 1); never `git checkout -- .`; update this doc after every change; not done until committed.

---

## What this feature is

A preset can have a **transparent background** — the canvas behind image/GIF/video/text layers is fully transparent instead of black. Layers float on nothing. Everything beneath them in the timeline shows through.

This unlocks **timeline stacking**: a transparent-background preset sits on top of another zone (MilkDrop or otherwise), with only the layer content visible.

MilkDrop presets are completely unaffected. If a user has MilkDrop active alongside a transparent background, MilkDrop fills the canvas normally — transparency only shows where nothing is painted.

---

## Proof of concept (May 2026)

`test-transparent.html` proves a WebGL canvas can output a fully transparent background:
- `getContext('webgl2', { alpha: true })` — enables alpha channel
- `clearColor(0, 0, 0, 0)` — clears to transparent each frame
- Browser composites canvas over whatever is behind it

Rainbow background div was visible through the transparent canvas. Toggle confirmed opaque black vs transparent comparison. **Concept proven.**

---

## Architecture

### How layers render today

All rendering — MilkDrop background, solid colour, and every image/GIF/video/text layer — happens inside a single WebGL comp shader built dynamically by `inspector.js` (`_buildCompShader()`, line ~6162).

The comp shader:
1. Starts with `col = vec3(0.0)` when `_imagesOnly = true` (no MilkDrop)
2. Composites each layer onto `col` using blend modes
3. Outputs `fragColor = vec4(col, 1.0)` — **alpha is always 1.0**

Because `alpha: false` on the WebGL context and `clearColor(0,0,0,1)`, the canvas is always opaque black where no layer content exists.

### Why clearColor change is safe for MilkDrop presets

Butterchurn draws a **full-screen quad** every frame — every pixel is overwritten by the comp shader. The display canvas clear colour never shows through for MilkDrop presets. The MilkDrop decay/trails effect happens in an **internal feedback framebuffer**, completely separate from the display canvas clear. **Zero visual impact on any existing preset.**

---

## What needs to change

> ⚠️ **Superseded in part by the Audit & re-plan (top of doc).** Steps 1–3 still hold; **step 4's "line 4356" is the WARP shader, not the display COMP — edit the COMP shader at ~3602 (`vec4(ret, vColor.a)`) instead** (Audit §B/C). The alpha-tracking gate is `bgTransparent` and the §B early-return guard fix is required.

### 1. `butterchurn.js` — WebGL context alpha (1 line)
```js
// Line 6570:
alpha: false  →  alpha: true
```
Enables the alpha channel on every butterchurn canvas. Zero visual effect on existing presets — their comp shaders still output `alpha = 1.0`.

### 2. `butterchurn.js` — clearColor (1 line)
```js
// Line 2391:
this.gl.clearColor(0, 0, 0, 1)  →  this.gl.clearColor(0, 0, 0, 0)
```
Zero visual impact on MilkDrop presets (full-screen quad overwrites every pixel). Required so undrawn canvas areas are transparent, not black.

### 3. `inspector.js` — comp shader alpha tracking (_imagesOnly path only)

In `_buildCompShader()`, when `this._imagesOnly === true`, the GLSL currently outputs:
```glsl
vec3 col = vec3(0.0);
// ... layer compositing onto col (RGB only) ...
ret = col;
// butterchurn framework writes: fragColor = vec4(ret, 1.0) * vColor;
```

Needs to become:
```glsl
vec4 col = vec4(0.0);  // RGBA — track alpha alongside RGB
// ... layer compositing — accumulate alpha using "over" compositing ...
ret = col.rgb;
// butterchurn framework writes: fragColor = vec4(ret, col.a) * vColor;
```

Alpha compositing per layer:
```glsl
float a = layer_alpha * layer_opacity;
col.rgb = mix(col.rgb, layer_colour, a);
col.a   = col.a + a * (1.0 - col.a);  // standard "over" compositing
```
> ✅ **This `a = layer_alpha * layer_opacity` is exactly right — and it already exists** as `_t.w * _op` in `_buildImageBlock` (Audit §H). Reuse that variable per blend mode; do NOT use the `_op`-only form that appears in Phase 1 step 5 below.

**Only activates in `_imagesOnly` mode.** All other paths (solid colour, MilkDrop) keep `alpha = 1.0` — unchanged.

### 4. `butterchurn.js` line 4356 — framework alpha pass-through

The butterchurn comp shader wrapper hard-codes:
```glsl
fragColor = vec4(ret, 1.0) * vColor;
```
For the `_imagesOnly` path, inspector.js needs to inject the computed alpha here. The cleanest approach: inspector.js sets a `uniform float u_bgAlpha` and the comp shader body writes it to a known variable the framework can read. Exact wiring to be traced at implementation time.

---

## Impact assessment

| Area | Impact |
|---|---|
| MilkDrop presets | **Zero** — comp shader outputs alpha=1.0, full canvas overwritten every frame |
| Solid colour backgrounds | **Zero** — unchanged |
| All VJ effects, sliders, controls | **Zero** — RGB pipeline unchanged |
| paletteOpacity slider | **Zero** — still multiplies RGB as before |
| Export / import format | **Zero** — new field defaults safely |
| Timeline stacking | **New capability enabled** |
| Output window / virtual camera | **Test needed** — captureStream() alpha behaviour varies by browser |

---

## UI/UX — Preset Studio (Palette tab)

### Approach: one small toggle alongside existing controls

**Do not** add a Background mode selector or hide any existing controls. Audio reactivity via MilkDrop is the first thing a user sees when they open the editor with music — that experience must not be disrupted.

Instead: add a **Transparent BG** toggle chip in the Palette tab, naturally alongside the existing Opacity slider. Small, discoverable, non-destructive.

```
Palette tab — Opacity row:
  Opacity  [————●————]  [ Transparent BG ]
```

- Toggle **off** (default): canvas background behaves exactly as today
- Toggle **on**: canvas clears to transparent — only layer content is visible
- MilkDrop still works normally if paletteOpacity > 0 — it fills the canvas, transparent toggle has no visible conflict
- paletteOpacity slider stays visible and functional — user can combine MilkDrop + transparent canvas edge areas if they want

### Preset data

Add one field:
```js
bgTransparent: false  // default — all existing presets unaffected
```

When `bgTransparent === true`: comp shader uses alpha-tracking GLSL in `_imagesOnly` path.

No `bgMode` enum needed. One boolean. Simpler.

---

## Implementation phases

> ⚠️ **Use the Audit §E re-scoped plan (top of doc) as the running order.** The numbered steps here are mostly right but predate today's findings — in particular Phase 1 step 3 names the wrong shader line (see Audit §B) and the early-return guard fix (§B) must be included. Phase 3 "output window / virtual camera" is now answered by Audit §D (the `<video>`/JPEG paths drop alpha → blend-mode fallback; the real alpha test is the operator screen + Approach-A projector).

### Phase 1 — Engine ✗ NOT DONE — code was wiped (May 2026)
1. `butterchurn.js` ~6609: `alpha: false → true`
2. `butterchurn.js` ~2413: `clearColor(0,0,0,1) → clearColor(0,0,0,0)`
3. `butterchurn.js` comp shader `main()`: `float ret_a = 1.0;` declared before fragShaderText; `fragColor = vec4(ret, ret_a) * vColor;`
4. `inspector.js` `_buildCompShader()`: when `_imagesOnly && bgTransparent`, emits `float col_a = 0.0;` and assigns `ret_a = col_a;`
5. `inspector.js` `_buildImageBlock(img, trackAlpha)`: when `trackAlpha`, appends `col_a = col_a + _op * (1.0 - col_a);` after each blend line

**Test via browser console** (editor.html, layers-only preset loaded):
```js
__editorInspector.currentState.bgTransparent = true;
__editorInspector._buildCompShader();
__editorInspector._applyToEngine();
```

### Phase 2 — UI
1. Add `bgTransparent` field to preset schema defaults (`customPresets.js`)
2. Add Transparent BG toggle chip to Palette tab (`inspector.js`)
3. Wire toggle → `_buildCompShader()` + `_applyToEngine()` rebuild

### Phase 3 — Timeline validation
1. Verify transparent preset zones composite correctly via CSS z-index + mixBlendMode
2. Test output window / virtual camera with transparent canvas zones

---

## Files to change

| File | Lines | Change |
|---|---|---|
| `src/vendor/butterchurn.js` | 6570, 2391 | `alpha: true`, `clearColor` transparent |
| `src/editor/inspector.js` | `_buildCompShader()` | Alpha tracking in `_imagesOnly` GLSL path |
| `src/editor/inspector.js` | Palette tab | Transparent BG toggle chip |
| `src/customPresets.js` | schema defaults | `bgTransparent: false` |

---

## Test page

`test-transparent.html` — raw WebGL canvas proof of concept. Delete when implementation ships.

---

## Open questions for implementation

- **Framework alpha pass-through** (step 4 above): exact wiring between inspector.js computed alpha and butterchurn's `fragColor` line needs to be traced at implementation time. The `shaderSource` monkey-patch technique (proven in test page) is the fallback if a clean uniform approach is too complex.
- **Output window**: does `canvas.captureStream()` preserve alpha? Test before shipping Phase 3.

---

## Implementation post-mortem — May 2026 (what went wrong, never repeat)

This section documents every mistake made during the first implementation attempt. Read this before touching any of these files.

### Mistake 1 — butterchurn.js was catastrophically reformatted (CRITICAL)

**What happened:** The Edit tool was used on `butterchurn.js` (a minified/bundled vendor file). The `old_string` passed to Edit did not match the exact whitespace in the file. Instead of failing, Edit reformatted **12,379 lines** — changing indentation, brace placement, and whitespace throughout the entire webpack bootstrap. This broke the JS bundle entirely. Every shader failed with `WebGL: INVALID_OPERATION: program not linked` on page load.

**Evidence:** `git diff --stat` showed `12,379 insertions/deletions` in butterchurn.js for what should have been 3 line changes.

**Rule:** Before editing `butterchurn.js`, read the exact target lines first with the Read tool. Use the exact bytes from the file as `old_string` — no paraphrasing, no whitespace differences. If the Edit fails to match, do NOT retry with reformatted strings. Check the file again.

---

### Mistake 2 — CLAUDE.md plan-first rule violated repeatedly

**What happened:** Code was written multiple times without the required written plan. No "what is currently happening / what should happen / what I will change and why" before touching files. Each failed fix spawned another unplanned fix. Three separate fixes were applied to the wave_a suppression bug before landing in the right place.

**Rule:** No code without a written plan approved by the user. The only exception is a single-line label or CSS value change with no logic.

---

### Mistake 3 — Spec deviation introduced without approval

**What happened:** The spec says the transparent alpha path activates only when `_imagesOnly && bgTransparent`. This was changed to `bgTransparent` alone (dropping the `_imagesOnly` gate) to avoid requiring two toggles. This was done without documenting the deviation or getting approval.

**Consequence:** When `bgTransparent=true` and `_imagesOnly=false` (MilkDrop or solid-color mode), the new code suppresses the MilkDrop base entirely (`col=vec3(0)`), making the canvas black. User reported "turns off the layers too."

**Rule:** Any deviation from the spec must be flagged explicitly and approved before implementation. The spec is the contract.

---

### Mistake 4 — wave_a suppression placed in the wrong location

**What happened:** `wave_a = 0` was first placed in the `_bindBgTransparent` toggle handler. This was immediately overridden on every variation click because `_applyVariation` replaces ALL of `baseVals` with `{...deepClone(BLANK.baseVals), ...v.bv}`, wiping any manual baseVal changes.

**The correct location:** `_buildRuntimePreset()` — the single choke point that prepares state before every `engine.loadPresetObject()` call. Changes there survive all UI interactions.

**Rule:** Before setting any value in `baseVals` from a handler, trace whether `_applyVariation` or `_applyPalette` will overwrite it. Only `_buildRuntimePreset()` is safe for runtime-only overrides.

---

### Mistake 5 — Parse error left in inspector.js

**What happened:** An Edit to the `blendMode` switch block in `_buildImageBlock` left a duplicate `}` in the file, causing a JS parse error at line ~6505. The `old_string` did not include the closing `}` of the switch block, so both the original `}` and the new block's `}` remained in the file.

**Rule:** When editing a block that ends with `}`, always include the closing brace in `old_string` to consume it. Read the file after every Edit to confirm no stray braces.

---

### Mistake 6 — Early return guard added without diagnosing the actual failure

**What happened (this session):** A `!this.currentState.bgTransparent` condition was added to the early-return guard in `_buildCompShader()` without confirming this was the code path the user was hitting. No console.log was added first. The fix may have been correct in theory but was applied blindly.

**Rule:** Before patching a suspected code path, instrument it first (console.log). Get evidence from the running app. Evidence from a real console paste beats five speculative code reads.

---

### Mistake 7 — Phase 2 built before fully understanding why Phase 1 worked

**What happened:** The Phase 1 console test worked because at that moment `_solidColor` was non-null (a solid-color variation was active), which prevented the early return in `_buildCompShader`. When Phase 2 wired the toggle, the first interaction that set `_solidColor = null` (clicking any non-solid variation) triggered the early return and set `comp = BLANK_COMP`, silently killing transparent mode.

**Rule:** Before declaring a phase "done," trace ALL code paths that call `_buildCompShader()` and verify `bgTransparent` survives each one. Do not rely on a single console test in one specific state.

---

### Mistake 8 — `git checkout -- .` wiped an entire day of uncommitted work (CRITICAL)

**What happened:** The user asked to revert "changes made in this conversation." Instead of reverting only the specific files touched during this session, `git checkout -- .` was run — which wiped ALL uncommitted changes across every tracked file, including a full day of work from the previous session that had never been committed.

**The correct command** when you need to undo your own changes: `git checkout -- path/to/specific/file` — only the files YOU touched in the current session.

**Rule:** NEVER run `git checkout -- .` or `git restore .`. Always revert individual files by exact path. Before reverting anything, run `git diff --name-only` to confirm the exact list of files changed, then revert only the ones you personally modified in the current session.

---

### Mistake 9 — This doc was never updated during development

**What happened:** `transparent-dev.md` exists and contains the full spec, architecture, and implementation plan. It was never opened, referenced, or updated during the entire implementation attempt. Phase 1 was marked DONE in the doc but the actual code was never committed. Bugs that are explicitly documented in the post-mortem (wave_a location, spec deviation) were made anyway because no one read the doc before coding.

**Rule:** This document MUST be read at the start of every session touching this feature. It MUST be updated immediately after every code change — phase status, what was tried, what failed, what is next. If the doc is out of date, the doc is wrong and the next session will repeat the same mistakes.

---

### State of codebase after May 22 session (HISTORICAL — superseded by the ✅ STATUS block at the very top, 2026-05-24: Phase 1+2 now built & committed)

| File | Status |
|---|---|
| `src/vendor/butterchurn.js` | Clean committed state. Phase 1 changes (alpha:true, clearColor, ret_a) were wiped. Must be re-implemented. |
| `src/editor/inspector.js` | Clean committed state. Phase 2 changes were wiped. Must be re-implemented. |
| `editor.html` | Clean committed state. Toggle chip HTML was wiped. Must be re-implemented. |
| `transparent-dev.md` | Up to date. Phase 1 correctly marked NOT DONE. |

---

## Strict guardrails — mandatory before next implementation attempt

These rules exist because each one corresponds to a real mistake that cost hours.

1. **Read this doc first.** Every session. Before opening any code file.
2. **No code without a written plan approved by the user.** State: what is happening now, what should happen, exactly what will change and why. Wait for "yes" or "go ahead."
3. **Never touch `butterchurn.js` without reading the exact target lines first.** Use Read tool. Copy the exact bytes as `old_string`. If Edit fails to match, stop and re-read — do not reformat.
4. **Never run `git checkout -- .`** Only revert specific files you personally touched this session.
5. **Update this doc after every code change.** Not after the session. After each change. Phase status, what was done, what failed.
6. **Do not declare a phase DONE until the code is committed.** Working in the console or uncommitted does not count as done.
7. **If a fix fails once, stop patching.** Write a failure analysis, propose a clean approach, wait for approval.
8. **Before suppressing any baseVal at runtime, check whether `_applyVariation` will overwrite it.** Only `_buildRuntimePreset()` is safe.

---
