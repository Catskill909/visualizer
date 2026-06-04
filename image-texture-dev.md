# Meld (Image-as-Texture) — feeding images INTO MilkDrop presets

Status: **🟢 SHIPPED & ACTIVELY BUILDING OUT (updated 2026-06-04).** This is the **Meld** feature:
feedback-melt engine (§12), per-card **Overlay\|Meld** UX (§13), Tier 1/2 reactivity (§13.6),
**Size · Position pad · Luma Key · Mirror/Kaleido** (§14), **perceptual log Speed w/ true slow-motion**
(§17), and **🎲 Remix rolls the melt** (Phase 7). Renamed Drive→Meld; in-app + promo docs updated.
macOS + Coolify web verified; Windows build pending. **Now building Phase 6 melding tools — Blend mode
first (§16).** The Phase Tracker below is the live status. Origin: `milkdrop-pack-import.md` §16.2.

> **📚 Doc map:** Tracker + §§12–17 = current/shipped (read these). **§§3–8, 10–11 are PRE-BUILD scoping
> (2026-06-03) kept as historical record — superseded by what shipped; don't treat as TODO.**
>
> **🏷️ NAME (2026-06-04): the user-facing feature is "MELD"** (renamed from "Drive" — more intuitive: the
> image *melds INTO* the preset). The per-card button says **Meld**. **Internal CODE names are unchanged**
> to avoid churn — `imageWarp`, `drive-mode` class, `.layer-drive`, `_toggleCardDrive`, `#image-warp-*`,
> `buildImageWarp` all keep their names. So in this doc "Drive" = the code/mechanism, "Meld" = the UI label.

> **One-liner:** let a user's image/video/GIF become a **texture the MilkDrop preset itself
> processes** — so it gets melted, tunneled, kaleidoscoped, smeared, and pulsed to the audio by the
> preset's own engine — instead of just sitting on top as an overlay layer.

---

## 📍 PHASE TRACKER — START HERE

_Single source of truth for status. Detail in the numbered sections below._

| Phase | What | State |
|---|---|---|
| **Spike / Audit** | Feasibility — pipeline exists (`setUserTexture`) + **warp shader can sample a user texture** → no engine fork (§9, §11) | ✅ **DONE 2026-06-03** |
| **1 — Feedback-melt engine** | `buildImageWarp(opts)` generator shipped (§12) — blends `sampler_<imgName>` into the feedback loop, reusing the SAME flow math as `buildWarpShader` (shared `_flowParts`). Knobs: `flow` · `reseed` · **audio-reactive blend** (`audioSource`/`audioAmt`). **Minimal live wire-up shipped** (`window.__imgWarp.drive/clear`, dev-only). | ✅ **GENERATOR + LIVE WIRE DONE — tune look by eye next** |
| **2 — UX** | **Per-card `Overlay \| Meld` switch** (§13, §13.5; button renamed Drive→**Meld** 2026-06-04): each image layer card has a Meld button; flipping it melts THAT image into the preset (radio — one at a time), hides its overlay, and swaps the card body to the Drive panel (Flow · Speed · Depth · Presence · Audio+Amount). Overrides Flow Style; round-trips via BLANK; player parity in `refreshCustomPresets`. | ✅ **DONE 2026-06-03 — per-card editor round-trip verified 12/12** |
| **2.5 — Per-card + Tier 1/2** | Per-card mode + chip-grid Flow + dbl-click reset + Speed/Depth (Tier 1) + Spin/Zoom Pulse/Flow Pulse (Tier 2, §13.6) + collapse fixes + Drive-pill in row1. | ✅ **DONE 2026-06-03 — verified 18/18** |
| **4 — Build-out: parallel layer controls** | **SHIPPED 2026-06-04:** Size · Position pad · Luma Key · Mirror/Kaleido (§14.1a) · **4b Colour/Grade** (Brightness/Contrast/Saturation/Hue/Invert, §14.2, verified 36/36). Aspect deferred. See §14. | 🟢 **4a + 4b DONE** |
| **4-speed — Perceptual Speed fader** | Speed mapped **logarithmically** (~0.02 → 4.0) — slow/extreme-slowdown range gets fine resolution, top still reaches fast. ONE fader, smarter mapping (§17). Applied to **Drive panel Speed AND Flow Style Speed**. Model stores real speed (engine/saved presets unchanged); only UI mapping is non-linear. | ✅ **DONE 2026-06-04 — verified 24/24** |
| **6 — Melding tools** ⭐ | The strategic category (§16): controls for HOW an asset *integrates into* the preset's machinery. **Blend mode SHIPPED 2026-06-04 (verified 33/33)** — Mix/Add/Screen/Multiply/Difference/Overlay chip-row; gated (`mix`=no-op); all 6 render bright (min luma 114); Remix rolls it (bias to bright family). Next melding tools: **Displacement** (image luma warps the melt) → **Mask** → image-driven flow. | 🟢 **Blend mode DONE — Displacement next** |
| **3 — More sources** | Video / GIF / webcam as the driving texture. **GIF + video CONFIRMED WORKING in real use 2026-06-03** (user) — same `setUserTexture` sampler the warp reads each frame, so the melt animates for free. Remaining: webcam + per-source polish. | 🟢 **GIF/video work; webcam TODO** |
| **(opt) — Named-texture path** | "Photo-reactive" presets that sample a known user sampler + ship the **22 built-in texture assets** (`milkdrop-pack-import.md` §16.1). | ⬜ optional |
| **7 — Drive 🎲 (Remix)** | **GLOBAL 🎲 Remix rolls the WHOLE Meld (verified 33/33):** the Remix "Flow" axis gambles flow/speed/depth/spin/zoom/flow-pulse/mirror/luma-key/**blend-mode**/presence/audio **AND framing (size/position)** via `_rollImageWarp`; panel re-syncs (sliders + chips + pad follow), every roll renders, **Flow lock** keeps the melt. **Tuned 2026-06-04:** rolls framing too ("move also"; ⅓ full-frame, rest in-bounds); biased gently away from blown white (add/screen rolled less + lower presence); **~45% "present meld" rolls** (`_present` flag → high presence + gentler depth/speed, no obliterating kaleido, image-faithful blend → the source image stays RECOGNIZABLE; the rest keep the abstract/dissolved variety). Only which image drives is left alone. Remaining (optional): a dedicated 🎲 button IN the Meld panel. | 🟢 **Remix→Meld DONE — incl. framing, blend, present-bias** |

**▶️ CURRENT (2026-06-04):** Shipped + verified — Size · Position pad · Luma Key · Mirror/Kaleido (§14, 27/27),
perceptual log Speed + true slow-motion (§17, 24/24), **🎲 Remix→Meld** (Phase 7, 31/31), renamed Drive→**Meld**,
in-app help (Layers got its own menu) + promo docs updated. **Building now: Phase 6 Blend mode** (§16 — the first
melding tool). **Next after:** 4b Colour/Grade → more melding tools (Displacement/Mask) → Phase 7 Meld 🎲 button →
Phase 3 webcam source. All committed + pushed (user); macOS + Coolify web verified, Windows pending.

**Key facts (so you don't re-derive):** NO engine fork — reuses `setUserTexture` (upload, exists) +
warp-shader injection (exists, = Flow Style). Cross-platform (pure WebGL2). Machine limits a
non-issue. See §11 for the spike numbers, §9 for the audit, §10 for UX placement.

---

## 1. Why this is powerful (the pitch)

A MilkDrop/Butterchurn preset is a **per-frame feedback loop**: every frame it samples the *previous*
frame (`sampler_main`) and warps / zooms / rotates / color-processes it, then draws waves/shapes on
top. That feedback loop is *why presets flow and evolve*.

**If we seed that loop with a user image**, the preset's entire motion engine runs **on the image**:
- warp shader → the image tunnels / spirals / ripples / kaleidoscopes
- zoom / rot / decay → it drifts, smears, trails
- comp shader + color FX → it re-moods, glows, posterizes
- and because the preset is **audio-reactive**, the image-transformation **pulses to the music**

→ The image becomes *alive inside the visualizer*. A logo dissolves into a plasma; a face melts
through a tunnel on the beat; a photo becomes liquid. This is **fundamentally different** from the
current image/video/GIF layers, which composite *on top* and never interact with the preset.

**Strategic fit:** on-brand with "audio reactivity is the differentiator" — this is *image*
reactivity. A genuinely novel, demo-able, headline creator feature.

---

## 2. How it relates to what we already have

| Today (overlay layers) | This feature (image-as-texture) |
|---|---|
| Image/video/GIF/text composite **over** the preset (own transform, blend, opacity) | Image becomes **input to the preset's own shaders** |
| Preset and image are independent | Preset *processes/destroys/animates* the image |
| Great for logos, lower-thirds, masking | Great for "my photo, hallucinated by the music" |

Both can coexist — overlay layers stay; this is a new, deeper mode.

---

## 3–8, 10–11. PRE-BUILD SCOPING (2026-06-03) — historical record

> ⚠️ **These sections are the original scoping/spike notes, kept for the record. Everything here was
> answered or superseded by what shipped (§§12–17). The spike's conclusion held: Approach A
> (feedback-melt via warp injection) with NO engine fork. Skip to §12+ for current reality.**

## 3. Technical approaches (to evaluate in a spike)

Butterchurn renders WebGL2; presets sample textures by name. Two ways to get an image in:

**Approach A — Seed the feedback buffer (`sampler_main`).** Write the image into the feedback
texture the preset samples each frame.
- ✅ **Works with EVERY preset for free** (they all sample `sampler_main`) — huge reach.
- ✅ Most "trippy" — the image immediately enters the warp/decay loop.
- ⚠️ Needs access to Butterchurn's internal feedback FBO (may require a small engine patch / fork
  hook). **Unknown: does Butterchurn expose this?** ← spike.
- ⚠️ Persistence: a one-shot seed melts away over frames (decay). To keep the image present, re-inject
  each frame (or every N) — needs a "reseed rate" control.

**Approach B — Provide a named texture the preset samples.** Butterchurn supports presets that
reference custom textures (the §16.1 texture presets). Feed the user image under a known sampler name.
- ✅ Cleaner / officially-supported texture path (probably `butterchurn`'s texture loading).
- ❌ Only presets that *sample that texture name* show it → need **purpose-built presets**, not the
  existing library. Less magic, more authoring.

**Likely answer:** A is the headline (works everywhere); B is a complement (author a few
"photo-reactive" presets). Spike both against the Butterchurn API.

---

## 4. Design / UX questions (to settle when scoping)

- **Source:** user image · video frame (live) · GIF · webcam? Start with a still image.
- **Reseed rate / persistence:** one-shot · continuous · slider. Per-preset some obliterate fast.
- **Blend amount:** how much image vs. preset's own content; audio-reactive blend?
- **Which presets:** all (via feedback seed) vs. a curated "works great with images" set.
- **Where it lives:** a new Preset Studio control? a player quick-action ("drop an image in")?
- **Performance:** uploading a texture each frame — keep it cheap (upload once, reseed cheaply).

---

## 5. Cross-platform

**No risk.** Pure WebGL2 + JS — textures are images uploaded to the GPU, same render path as all
1,144 presets. No native code, no `.milk` conversion, no CSP/Tauri issues. Builds and behaves
identically on web, macOS (WKWebView), Windows (WebView2). The effort is **engine wiring + UX**, not
platform compatibility.

---

## 6. Phased plan

➡️ **Moved to the [Phase Tracker](#-phase-tracker--start-here) at the top** (single source of truth,
post-spike). The spike (§11) is ✅ done; the build path is Phases 1→4 there. This rough sketch was
superseded once the spike confirmed the no-fork path.

---

## 7. Open unknowns (the spike answers these)

1. Does Butterchurn expose its feedback FBO / a way to seed `sampler_main`? (Determines if A needs a fork.)
2. What's the exact texture-provision API for named textures (B)?
3. Performance of per-frame (or per-N-frame) texture re-upload at render resolution.
4. How gracefully presets behave when their feedback is overwritten (some may flash/strobe).

---

## 8. Verdict

Genuinely powerful and **fully cross-platform** — and **less work than feared** (§9): the
image→texture pipeline already exists. The only real unknown is Approach A's feedback-buffer seed
(one spike). Not part of pack-import; its own feature. **Build when ready — start with the spike.**

---

## 9. CODE AUDIT FINDINGS (2026-06-03) — the pipeline already exists

Audited the vendored engine (`src/vendor/butterchurn.js`) + app (`src/visualizer.js`).

**✅ Getting a user image INTO the engine as a GL texture is ALREADY SOLVED.**
- `visualizer.setUserTexture(name, texObj)` ([visualizer.js:997](src/visualizer.js#L997)) already
  uploads **images, GIFs (animated), videos (live), and text** as named GL textures `sampler_<name>`
  — it's the existing image-LAYER system. Static images go through Butterchurn's
  `loadExtraImages({name:{data,width,height}})` ([butterchurn.js:1270](src/vendor/butterchurn.js#L1270));
  GIF/video/text do direct GL upload.
- `getTexture(sampler)` returns `samplers[name]` or falls back to `clouds2`. So a preset sampling a
  texture name we *haven't* provided just gets a default (why the §16.1 texture presets look flat —
  **the app never calls loadExtraImages for preset textures today**).

**So the two approaches, re-scoped:**
- **Approach B (named texture) ≈ 80% built.** `setUserTexture('userimg', …)` puts the image in as
  `sampler_userimg`. Missing piece = a **preset whose warp/comp shader samples `sampler_userimg`**
  (existing presets don't) → author "photo-reactive" presets, or inject the sampler into a shader.
- **Approach A (feedback seed = works with EVERY preset)** = render the user texture into the
  **feedback buffer** `prevTexture`/`prevFrameBuffer` (the ping-pong is at
  [butterchurn.js:2804](src/vendor/butterchurn.js#L2804); `sampler_main` reads `prevTexture`). The
  upload is solved; the new bit is a small **renderer hook** to blit the user texture into that FBO
  (+ a reseed-rate control). The vendored copy is editable, so this is a contained patch — **this is
  the spike.**

**Machine limits — not a concern.**
- The app **already runs up to 5 user textures at once** (image layers) **+ live video textures** +
  Butterchurn's ~10 built-in samplers, on web/macOS/Windows. A texture or two more is trivial.
- WebGL2 guarantees ≥16 texture units and `MAX_TEXTURE_SIZE` ≥2048 (real GPUs 8192–16384). A 1024²
  RGBA texture ≈ 4 MB; a handful = tens of MB. Fine.
- **Per-frame reseed (Approach A) is proven-feasible** — live *video* layers already upload a new
  texture every frame through the same path, so the perf pattern is established.

## 10. UX placement — thoughts (grounded in the audit)

The image-upload UX **already exists** (Images tab: pick image/GIF/video → it becomes a texture). So
this feature can **reuse that**, not reinvent it.

- **Not a new top-level tab (at first).** It's a *mode* on a source: "use this image to **drive the
  preset**" (feedback seed) vs the current "overlay layer." Could be a toggle/section in the **Images
  tab**, or a compact panel.
- **New controls are small:** mode (feedback-seed vs named-texture) · **reseed rate / persistence**
  (one-shot melt ↔ keep present) · **blend amount** (image vs preset content, optionally
  audio-reactive). That's ~3 controls — doesn't justify its own tab yet.
- **Loading:** same file path as image layers (proven). **Multiple textures:** supported by the
  samplers map; start with ONE "preset source image" for the headline feedback-seed effect, allow
  more later for named-texture presets.
- **Earns its own tab later** only if it grows (multi-texture mixing, per-texture controls, a library
  of photo-reactive presets).

---

## 11. SPIKE RESULTS (2026-06-03) — ✅ feasible, NO engine fork

Ran headless (Playwright + SwiftShader) against the real engine. Findings:

| Test | Result | Means |
|---|---|---|
| Upload a user image via `setUserTexture('dctest', …)` → check engine sampler map | `samplers` = `['clouds2','dctest']` | ✅ texture **uploads + binds** (existing path, no new code) |
| Headless renders at all? (bundled preset frame luminance) | avgLuma **106** (bright) | ✅ headless renders visible output — so black frames would be real, not an artifact |
| **COMP** shader samples `sampler_dctest` | avgLuma **160** | ✅ comp can sample user textures (known — image layers) |
| **WARP** shader samples `sampler_dctest` | avgLuma **75** | ✅ **WARP can sample user textures too** ← the key unknown, now answered |

**Conclusion: Approach A (image melts through the feedback loop) is feasible WITH NO ENGINE FORK.**
Because the **warp shader can sample a user texture** and the warp pass *writes the feedback buffer*,
a warp that blends `sampler_userimg` into `sampler_main` seeds the image into the feedback loop — the
preset's motion then melts/tunnels/kaleidoscopes it. This is achievable by **reusing two existing
systems**: `setUserTexture` (upload) + warp-shader injection (the same mechanism as **Flow Style**,
`customPresets.js buildWarpShader`).

**Honest caveat:** the spike proved the *mechanism* (warp samples user tex → visible output) + that
binding/upload work. It did **not** tune the *aesthetic* (a first naive `mix(fb, img, 0.25)` with a
dark test image looked near-black until the blend/decay were right) — dialing the melt/persistence
look is Phase-1 implementation + visual tuning (best done with eyes in a real browser).

**Build path (revised, no fork):**
1. **Phase 1:** a generated warp-injection (à la `buildWarpShader`) that blends a user texture into
   the feedback, with **reseed/persistence + blend** knobs; image provided via `setUserTexture`.
   Tune the look live. (Optional later: an additive engine FBO-seed for an even cleaner one-shot.)
2. **Phase 2:** UX in the Images tab ("drive the preset" mode + the ~3 knobs).
3. **Phase 3:** extend to video/GIF/webcam (all already supported by `setUserTexture`).

→ Risk dropped from "engine fork + unknown" to "reuse two proven systems + visual tuning."

---

## 12. PHASE 1 — `buildImageWarp` generator (2026-06-03)

Shipped the feedback-melt warp generator in [customPresets.js](src/customPresets.js).

**What changed (one file, no engine fork):**
- Extracted the per-flow GLSL into a shared **`_flowParts(flow)`** helper returning `{ pre, fbExpr }`
  (the warp setup block + the warped/decayed feedback-sample expression). Covers all 11 flow
  styles incl. kaleido. ONE source of truth for the motion math.
- **`buildWarpShader(flow)`** refactored to compose around `_flowParts` — **verified byte-identical**
  output across all 11 flows × 3 param sets (the Flow Style path is load-bearing; zero regression).
- **`buildImageWarp(opts)`** added. It emits a warp `shader_body` that:
  1. runs the chosen flow displacement on the feedback (`vec3 _fb = <fbExpr>;` — the melt/tunnel/…),
  2. samples the user texture `vec3 _img = texture(sampler_<imgName>, uv_orig).rgb;`,
  3. re-injects each frame: `ret = mix(_fb, _img, <reseed>);`.

**Params:** `imgName` (→ `sampler_<imgName>`, sanitized to a bare GLSL identifier) · `flow` (motion,
default `'liquid'`) · `reseed` 0..1 (image presence — high = stays sharp/present, low = faint seed
that melts into the feedback over frames; default 0.2) · `speed`/`depth`/`density` passed to the flow.

**Note on knobs:** the original scope said "reseed/persistence **+ blend**", but post-build those
collapse to ONE meaningful knob at the injection point (`reseed` IS the image-vs-feedback mix).
Persistence of the *melt* is already governed by the preset's own `decay`. Didn't invent a second
knob that would do the same thing. A distinct audio-reactive blend can come in Phase 2 if wanted.

**Verified:** generator output is valid GLSL for standard + kaleido flows; sampler-name sanitization
works (`my-pic!` → `mypic`). The *mechanism* (warp samples user tex → visible render) was proven in
the spike (§11).

### 12.1 Audio-reactive blend (Phase 2 enhancement, 2026-06-03)
`buildImageWarp` now takes optional `audioSource` + `audioAmt`. When a source is set, the injection
mix becomes `clamp(reseed + audioAmt * (<src> - 1.0), 0.0, 1.0)` so the image **pulses in on the
beat**. Sources are whitelisted to the engine's audio uniforms (`bass`/`mid`/`treb`/`vol` + `_att`
variants — confirmed present in the butterchurn warp/comp shader header; normalized ~1.0 at average,
so `(src-1.0)` is the beat deviation). The whitelist is also an **injection guard** — any non-listed
string falls back to a static literal (unit-tested: `'bass); evil('` → rejected).

### 12.2 Minimal live wire-up (2026-06-03) — `window.__imgWarp` (dev-only)
Added a dev-only console hook in [main.js](src/main.js) (gated by `import.meta.env.DEV`, tree-shaken
from prod — same pattern as `__dcPacks`) so the melt can be **tuned by eye** before any real UI:
- `await __imgWarp.drive(src, opts)` — `src` = image URL/dataURL or a File/Blob. Clones the **current**
  preset, sets `.warp = buildImageWarp({ imgName:'imgwarp', ...opts })`, calls `loadPresetObject`,
  **then** `setUserTexture('imgwarp', …)`. Ordering is load-THEN-bind because butterchurn wipes
  samplers on `loadPreset` ([visualizer.js:350-352](src/visualizer.js#L350)). A still image uploads
  once and persists (no per-frame reupload needed).
- `__imgWarp.clear()` — reloads the current preset by name to restore it.
- `opts`: `flow` · `reseed` · `audioSource` · `audioAmt` · `blend` (load blendTime).

### 12.3 GOTCHA — the user sampler MUST be declared in the shader header
Headless verify caught a black-frame/`WebGL: too many errors` bug on the first run: butterchurn's
`getShaderParts` splits the warp on `shader_body`, and `getUserSamplers` scans only the **header**
(`/uniform sampler2D sampler_(.+?);/`) — using that list BOTH to declare the GLSL uniform AND to bind
our uploaded texture each frame. Referencing `sampler_imgwarp` only inside the body = undeclared
identifier → warp won't compile → black. **Fix:** `buildImageWarp` now prepends
`uniform sampler2D sampler_<imgName>;\n` before `shader_body`. (Same rule will apply to any future
named-texture preset path, §16.1.)

### 12.4 Headless verification — [scripts/verify-image-warp.mjs](scripts/verify-image-warp.mjs)
Run: `node scripts/verify-image-warp.mjs` (dev server up). Drives the real app in headless Chromium
(SwiftShader), pushes a synthetic vivid checker image through `__imgWarp.drive()`, and reads back
canvas luma via the engine's post-render capture hook. **Asserts real brightness** (driven luma > 20),
not just nonzero — the first thresholds (`luma > 0`) falsely green-lit the black frame above; don't
weaken them. Latest run: baseline luma 37 → **driven 158** (image clearly in the loop), audio-reactive
variant 155, 5/5 pass.

**Phase 2 superseded the dev hook as the real UX** — see §13. The `__imgWarp` dev hook stays for
quick console tuning but is no longer the only path.

---

## 13. PHASE 2 — "Drive preset with image" UX (2026-06-03) ✅

The user-facing feature: an image LAYER can drive the preset's feedback loop. Lives as a self-contained
section in the **Images tab** ([editor.html](editor.html), `#image-warp-section`).

**Data model:** `currentState.imageWarp = { enabled, texName, flow, reseed, audioSource, audioAmt }`
added to `BLANK` ([inspector.js](src/editor/inspector.js)) → round-trips with the saved preset for free
(like `flowStyle`/`motionEngine`, no save/load surgery).

**Source = an existing image layer.** The picker lists `currentState.images[]`; `texName` references one.
**Zero new upload/store/bind plumbing** — that layer's texture is already uploaded + bound by the overlay
system, and the warp just samples the same `sampler_<texName>`.

**Driving layer drops out of the overlay** (user feedback 2026-06-03): when Drive is on, the source layer
must NOT also composite flat on top — it's being melted into the feedback loop instead. `_buildCompShader`
filters the driving `texName` out of `visibleImages` (its texture stays bound for the warp; toggling Drive
off restores the overlay). Comp is rebuilt on Drive-toggle AND on Source-change. Parity is automatic — the
editor bakes the overlay-excluded `comp` into the saved preset, so the player just uses it.

**Two independent audio stages (NOT redundant).** A layer's own AUDIO REACTIVITY section drives *overlay*
effects (pulse/bounce/shake/opacity) — inert while driving, since the overlay is hidden. The Drive
section's **Audio/Amount** drives a *different* stage: the image's re-injection (presence) INTO the
feedback loop on the beat — the melt breathing with the music. It's the only audio control that matters
while driving, and the on-brand "image reactivity" headline.

**Warp override (the crux).** `preset.warp` was owned by `flowStyle` (`buildWarpShader`). When
`imageWarp.enabled` AND its `texName` still exists in `images[]`, `buildImageWarp` OVERRIDES it. Wired at
**both parity sites**: editor `_buildRuntimePreset` and player/timeline `refreshCustomPresets`
([visualizer.js](src/visualizer.js)) — identical playback.

**Feedback wake.** `_buildCompShader`'s `_flowActive` now also counts `imageWarp.enabled`, so the melt
composites over Solid mode. On enable, seed `decay ≥ FLOW_FILL_DECAY` (mirrors `_applyFlowStyle`). NO wave
seed needed — `buildImageWarp` injects the image itself, so the feedback loop always has content.

**Graceful degrade.** If the source layer is deleted, `_syncImageWarpSection` (called from the shared
`_updateLayersBar` hook on every add/delete/load) auto-disables drive and the build skips it → no dangling
sampler, no black frame.

**Controls:** Enable toggle · Source picker · Flow `<select>` (reuses `WARP_STYLES`) · Presence slider
(= reseed) · Audio source + Amount. The section is a standalone block, NOT a `.image-layer-card`, so the
per-card slider sweep ([inspector.js:6860](src/editor/inspector.js#L6860), [[feedback_image_layer_slider_pattern]])
never touches it.

**Verified — [scripts/verify-image-warp-editor.mjs](scripts/verify-image-warp-editor.mjs)** boots the REAL
Preset Studio headless (SwiftShader), and through the inspector's own methods: adds a layer → toggles
drive → confirms the runtime warp is the image-warp (overriding flowStyle) → **live preview renders bright
(luma > 20, not black)** → save→reload restores `imageWarp` + rebuilds the melt → deleting the layer
auto-disables, AND the driving layer drops out of the overlay (comp no longer declares its sampler) +
returns when Drive is off.

### 13.5 Per-card Overlay|Drive switch (2026-06-03) — UX redesign per user feedback
The standalone bottom section felt disconnected ("which image does this control?"). Replaced with a
**per-card mode switch**: each image-layer card header has a **Drive** action button (next to Solo/Mute).
Flipping it makes THAT image drive the preset — radio (one warp slot), so it releases any other driver.

**Implementation — move the panel, don't duplicate it.** There's ONE Drive panel element
(`#image-warp-controls`, single IDs, single binding — all the verified Phase-2 wiring untouched). It
lives hidden in `#image-warp-home`; on Drive-enable it's **relocated into the active card**
(`activeCard.appendChild(panel)`); on disable/delete it's parked back home. CSS swaps the card body:
`.image-layer-card.drive-mode > .layer-controls { display:none }` hides the overlay controls so only the
Drive panel shows. This avoids per-card panel duplication (no duplicate-ID problem) and the engine model
is unchanged (still one per-preset `imageWarp`).

**New methods:** `_toggleCardDrive(entry)` (radio + decay seed + rebuild), `_homeDrivePanel()`,
rewritten `_syncImageWarpSection` (places panel in the driving card, toggles `drive-mode` + Drive-button
`.active`, syncs control values — called from the shared `_updateLayersBar` hook on every add/delete/load).
Delete edge: `_performDeleteLayer` homes the panel BEFORE `card.remove()` so it isn't removed with the card.

**Drive-panel layout cleanup (2026-06-04):** the panel's labels are longer than a card's ("Kaleido Speed",
"Zoom Pulse", "Luma Key", "Presence") and were overflowing the card's fixed 42px label column onto the
sliders. Panel-scoped CSS widens the slider-row label column to 82px and makes the standalone section
labels (Flow / Position / Mirror) block-level with top margin so they're not flush against the control
above. Verified headless (10 rows, zero label/slider overlaps; Mirror has a 12px gap above the pad).

**Tier 1 melt controls added:** **Speed** + **Depth** sliders (already supported by `buildImageWarp` via
`_flowParts`; now exposed). Model: `imageWarp` gained `speed`/`depth`; passed at both build sites.
The Source dropdown is GONE (the card you flip IS the source).

**Two audio stages (reaffirmed):** the layer's own AUDIO REACTIVITY section drives overlay effects (inert
while driving); the Drive panel's Audio/Amount drives the image's re-injection into the feedback loop on
the beat. All melt controls are exclusive to the Drive panel (the melt samples the RAW texture, so no
layer-card control reaches it — by design).

### 13.6 Tier 2 melt reactivity — Spin / Zoom Pulse / Flow Pulse (2026-06-03) ✅
Three new melt knobs in `buildImageWarp`, each ONE musical slider (per [[project_one_click_vs_pro_tools]]),
**hardwired to `bass` (the kick)** so they react without a per-knob source sub-menu:
- **Spin** — rotates the image-sampling UV: gentle `time` drift + a bass kick. 0 = no rotation.
- **Zoom Pulse** — the image pumps inward on the bass hit (scales the sample coord). 0 = no pump.
- **Flow Pulse** — multiplies the per-frame `_flow` displacement by a bass term (tunnel/ripple lunges).
  Guarded to standard flows (kaleido has no `_flow`, it builds `_kuv` directly — Spin/Zoom still apply).

**Gated = boring-not-broken.** Every knob at 0 → the generated shader is **byte-identical** to pre-Tier-2
(Spin/Zoom collapse `_iuv` back to `uv_orig`; Flow Pulse line omitted). Model: `imageWarp` gained
`spin`/`zoomPulse`/`flowPulse` (default 0); passed at both build sites; 3 sliders + dblclick-reset in the
Drive panel. Verified: all three cranked STILL render bright (luma > 20) — no combo produces a dead frame.

**UX polish (2026-06-03, user feedback):**
- **Flow is a click-to-explore chip grid** (`.lseg` chips, like Palette → Field), not a dropdown —
  built from `WARP_STYLES` into `#image-warp-flow-grid`. Far better for discovering the melt motions.
- **Double-click a slider label to reset** to default — matches every other fader. The panel moves
  between cards/home, so the handler lives on the panel; defaults stamped from `BLANK.imageWarp`.
  (The card's own delegated reset only stamps sliders present at mount, so the moved-in panel needs
  its own — `e.stopPropagation()` avoids a double-fire when the panel is inside a card.)
- Removed the cheesy "🫠 Driving the preset…" header — the violet card border + active Drive button
  already signal the mode.
- **Collapse fix (user bug 2026-06-03):** the Drive panel IS the card body, so the smart-accordion
  squashing the driving card (on adding a new layer) hid the controls. Two fixes: (1) the accordion now
  **skips the driving card** (`imageWarp.texName`) — it stays open when a layer is added; (2) a **sole
  layer is forced open** in `_updateLayerIndices` ("a layer stays open unless there's another one") —
  catches a last survivor left collapsed by a prior accordion (add 2nd → delete 2nd).

**Verified — [scripts/verify-image-warp-editor.mjs](scripts/verify-image-warp-editor.mjs): 14/14** incl.
per-card toggle, panel-moves-into-card, **radio releases the previous driver**, overlay drop-out + restore
+ panel re-home, live-preview luma, **Flow chip grid**, **double-click-reset**, **Tier-2 bake + cranked-luma**,
save/reload, graceful degrade. **16/16.**

**Not yet done:** aesthetic tuning by eye (the *look*); a Drive-panel 🎲 (roll a whole melt look — now that
Tier 2 gives it a rich space to roll into); Phase 3 (video/GIF/webcam as the driving source — all already
`setUserTexture`-supported).

---

## 14. PHASE 4 — BUILD-OUT PLAN: parallel the regular layer controls (planned 2026-06-03)

User's ask: flesh the Drive panel out toward the richness of regular image layers — but it's a
**different mechanism** (a feedback-seed warp that samples the RAW texture, NOT an overlay composite),
so each control has to be weighed, not copy-pasted. The melt only sees `texture(sampler_<img>, <uv>)`,
so everything we add is a transform on that sample (geometry/UV) or on the sampled colour (`_img`), or
a modulation of the flow. Below: what translates, how, and what doesn't.

### 14.1 Phase 4a — Size & Framing (THE PRIORITY — melt currently fills the screen)
Today: `texture(sampler_<img>, uv_orig)` → uv 0..1 stretches the image to fill, no size/position/aspect.
This is the #1 gap the user hit.

**✅ OUT-OF-BOUNDS DECISION — SETTLED 2026-06-04: FADE (and it's NOT a user-facing choice).** When the
image is scaled down, outside its bounds we inject NOTHING → only the feedback (the melt trails) shows, so
the image becomes a **finite thing dissolving into the loop** (the purest expression of the feature's
thesis). A `smoothstep` feather makes the dissolve literal — the image melts away at its own border.
Rationale: clamp = edge-smear artifact (cut entirely, never expose); tile = a deliberate *creative* look
(repeated melting copies), so it becomes its OWN optional toggle later — NOT an "out-of-bounds mode."
This kills the geeky mode-picker: **Size just scales + fades, no question asked** (one-knob ethos,
[[project_one_click_vs_pro_tools]]).

Shader (gated so neutral = today's full-screen no-op):
```glsl
// center default 0.5,0.5; size default 1.0 (=fill). _img sample coord:
vec2 _suv = (uv_orig - vec2(cx, cy)) / size + 0.5;        // scale + position about center
float _inx = smoothstep(0.0, edge, _suv.x) * smoothstep(0.0, edge, 1.0 - _suv.x);
float _iny = smoothstep(0.0, edge, _suv.y) * smoothstep(0.0, edge, 1.0 - _suv.y);
float _inside = _inx * _iny;                               // 1 inside (feathered), 0 outside
vec3 _img = texture(sampler_<img>, clamp(_suv, 0.0, 1.0)).rgb;
ret = mix(_fb, _img, reseed * _inside);                    // outside → pure feedback
```
At size=1, cx=cy=0.5 this must reduce to the current `mix(_fb, _img, reseed)` (full-screen) — verify
byte-stability / luma parity. `clamp` on the sample coord (not the gate) avoids GL wrap garbage in the
fractional border texels; the gate is what actually fades it.

**Controls for 4a:**
- **Size / Scale** ✅ SHIPPED 2026-06-04 — `_iuv=(uv_orig-vec2(cx,cy))/size+0.5`, feathered `_inb` gate,
  `clamp`ed sample, `mix(_fb,_img,reseed*_inb)`. Default 1.0. Composes with Spin/Zoom (one `_iuv`
  pipeline). Gated: size=1,cx=cy=0.5 → byte-identical no-op. `imageWarp.size`.
- **Position** ✅ SHIPPED 2026-06-04 — the **2D Center pad** (drag the dot + reset ↺), the SAME control
  regular layers use, NOT faders (`#image-warp-xy-pad`, `_buildImageWarpPad`, violet dot). Bound to
  `imageWarp.cx`/`cy`; pad redrawn from `_iwPadDraw` in `_syncImageWarpSection`.
- **Tile** — DEFERRED to its own optional toggle (the deliberate repeated-copies look); not part of the
  Size out-of-bounds behavior.

### 14.1a Aspect & Mirror — AUDIT + PLAN (2026-06-04)
Audited the layer equivalents to plan how they map to the melt's different mechanism.

**Mirror / Kaleido — ✅ SHIPPED 2026-06-04 (verified 27/27).** `imageWarp.mirror` (none/h/v/quad/kaleido)
folds `_iuv` in the coordinate pipeline *before* sampling, reusing the scene-mirror/kaleido fold math.
Gated: `none` = byte-identical no-op. Mirror **fills via reflection → overrides the framing fade** (the
`_inb` gate is skipped when mirrored); sample is clamped to kill fold-seam wrap. `imageWarp.kaleidoSpeed`
(0..1) spins the kaleido; its slider shows only in kaleido mode. UI = a chip-row (Off/↔H/↕V/⊞Quad/✦Kaleido)
after the Position pad. `mirrorScope` (tile/field) SKIPPED (tile-specific). Verified: mirrored melt still
renders bright; kaleido row toggles; round-trips.

**Aspect / Fit — PLAN, lower priority (defer or fold into aspect-ratio.md).** The melt samples `uv_orig`
0..1 across the screen → a square image stretches to the screen's shape. To preserve the image's native
ratio we must **bake the image AR (w/h) as a literal** into `buildImageWarp` (the warp's `aspect`/`texsize`
uniforms only know the SCREEN, not the user texture) and correct one UV axis by `screenAR/imgAR` around the
center. Caveats: (1) the build sites must pass the image's dimensions (available from the layer entry /
`_imageTextures`); (2) one-sided aspect correction is exactly the portrait-reshape nuance [[project_aspect_ratio_modes]]
flags — reuse that math, don't reinvent; (3) **for a melt the stretch matters LESS** (the image is being
destroyed/tunneled anyway), and Size already addresses the user's actual complaint (fill-screen). So a
Lock/Fluid toggle is a nice-to-have, not urgent. Recommend: build Mirror now; do Aspect after 4b, or bundle
it with the broader aspect-ratio.md pass.

**Verified — 20/20** (verify-image-warp-editor.mjs): Size/Position bake the framing + fade gate; a framed
melt (size 0.6, off-centre) still renders bright (boring-not-broken); save/reload round-trips.

### 14.1b Luma Key (2026-06-04) ✅ — explaining + controlling the "emergent key"
User noticed a driven image looks luma-keyed (dark areas drop out) even though we never coded a key.
**It's emergent:** mixing the image into a *decaying* feedback loop means bright regions seed + bloom while
dark regions pull the feedback toward black / let the preset show through → looks keyed. Made it an explicit,
adjustable control: **Luma Key** slider (`imageWarp.lumaKey`, default 0). `presence *= mix(1.0,
smoothstep(0.05,0.45, luma(_img)), lumaKey)` — at 0 = byte-identical no-op (today's look); turned up, dark
pixels progressively drop OUT of the injection so the melt shows through them *cleanly* (pass-through, not
darken); at 1 only bright parts seed. Composes with the framing fade (`_inb * _key`). Verified: cranked still
renders bright. One knob, gated, boring-not-broken. (Same family as the layer `lumaKeyLo/Hi` but one-knob.)

### 14.2 Phase 4b — Colour / Grade ✅ SHIPPED 2026-06-04 (verified 36/36)
Grades `_img` *before* it blends into the feedback (after sampling, before the blend/mix). Focused set
(one-knob ethos, not the full 12): **Brightness** (0–2, darken/brighten — also the "club-dark / less white"
lever), **Contrast**, **Saturation** (0=grey→2=vivid), **Hue** (0–360° rotate about the grey axis), and an
**Invert** Off/On seg ("reverse"). Each gated → all-neutral (bright/contrast/sat=1, hue=0, invert off) adds
NO GLSL lines (byte-identical). `clamp` only emitted when something grades. Model: `imageWarp` gained
`bright`/`contrast`/`sat`/`hue`/`invert`; passed both build sites; sliders+seg in the Drive panel under a
**Colour** label (after Blend). **Remix rolls it** — Brightness biased toward ≤1 (often darker → also helps
the blown-white goal), plus occasional vivify / hue-shift / 12%-invert. Ties to [[project_mood_dim_control_idea]].
Deferred (the rest of the 12): Gamma · Temp · Sepia · Fade · Shadows/Highlights · Lift/Gain · Tint — add if wanted.

### 14.3 Phase 4c — Stylize (trippy one-offs on the injected image)
Edge/Sobel (neon line-art melting) · Posterize · Threshold · Pixelate · Invert · Solarize. Each = a small
op on `_img`. Pick the 2–3 that feel best; don't dump all (one-knob ethos, [[project_one_click_vs_pro_tools]]).

### 14.4 Phase 4d — More reactivity routing (optional, weigh against one-knob)
Tier 2 hardwired Spin/Zoom/Flow-Pulse to bass. Could later let each pick a band (bass/mid/treb), but that's
a sub-menu — resist unless it clearly earns it. The Drive 🎲 (Phase 5) is probably the better expressivity
win than per-knob routing.

### 14.5 What does NOT translate (skip — overlay-specific)
- **Opacity / Blend mode** — the melt is mixed into feedback, not composited; **Presence** is the analog (done).
- **Entrance/Exit/Idle animation** (GSAP) — the melt is a continuous loop; N/A.
- **Vignette / Scanlines / Film grain** — overlay framing FX; low value on a feedback-seed (could apply to
  `_img` but weak payoff). Skip for now.
- **Orbit / Sway / Wander / Bounce / Pan** — these are overlay *motion*; the **flow IS the motion engine**
  here, so most overlap/conflict. Maybe a slow **Drift** of the sample center later; skip the rest.

### 14.6 Build order (updated 2026-06-04 — see the Phase Tracker for live status)
Done: 4a Size + Position pad + Luma Key + §17 perceptual Speed fader. Remaining within/after 4:
**Mirror/Kaleido** (§14.1a) → **4b Colour/grade** (big reuse) → **4c Stylize** → **Phase 6 Melding tools**
(Blend mode first, §16) → **Phase 7 Drive 🎲** (rolls across the now-rich space) → **Phase 3 GIF/video
source**. Each sub-phase: add to `buildImageWarp` (gated so 0/neutral = no-op), model fields on `imageWarp`,
control in the Drive panel (dbl-click reset), pass at BOTH build sites, headless-verify (bakes + still
renders bright). Standing rule from [[project_one_click_vs_pro_tools]]: one obvious musical knob each;
every value must render (boring-not-broken, luma>20).

---

## 15. END-OF-DAY AUDIT — 2026-06-03 (clean handoff)

**Shipped today (image-as-texture, 0→a real feature):**
- **Spike/Audit** → feasible, no engine fork (§9–11).
- **Phase 1** — `buildImageWarp` generator + audio-reactive blend + `_flowParts` refactor (buildWarpShader
  byte-identical) + dev hook (§12).
- **Phase 2** — per-card **Overlay|Drive** mode (panel moves into the active card), chip-grid Flow, Speed/
  Depth (Tier 1), overlay drop-out, save/reload, graceful degrade (§13–13.5).
- **Tier 2** — Spin / Zoom Pulse / Flow Pulse, hardwired to bass, gated (§13.6).
- **Polish/bugs** — dbl-click slider reset; removed cringe header; **collapse fixes** (driving card not
  squashed; sole layer stays open); **Drive moved to row1** (Delete was being clipped).

**Verification:** [scripts/verify-image-warp-editor.mjs](scripts/verify-image-warp-editor.mjs) drives the
REAL editor headless — **18/18 pass** (per-card toggle, panel-in-card, radio, no-squash, sole-open, warp
override, live luma, chip grid, dbl-click reset, Tier-2 bake + cranked-luma, overlay drop-out/restore,
save/reload, degrade). Plus [scripts/verify-image-warp.mjs](scripts/verify-image-warp.mjs) (player path).

**Files touched:** `src/customPresets.js` (buildImageWarp, `_flowParts`), `src/editor/inspector.js`
(model + Drive UI + per-card mode + collapse fixes), `src/visualizer.js` (player parity), `editor.html`
(Drive panel + row1 pill), `src/editor/style.css` (drive-mode, pill), 2 verify scripts.

**⚠️ COMMIT STATUS:** user committed after Phase 2 per-card. **Uncommitted since:** Tier 2, dbl-click reset,
chip grid, collapse fixes, Drive row1 relocation. → **commit before starting Phase 4 tomorrow.**

**Tomorrow:** Phase 4a (Size & framing). First decision: out-of-bounds mode (tile/clamp/fade) — see §14.1.

---

## 16. MELDING TOOLS — the strategic category (planned 2026-06-04)

User's strategic call: the controls that make a user asset **integrate INTO the preset's machinery**
(blend into the feedback loop, get warped/keyed/displaced by the engine) — as opposed to *overlaying* on
top — are a **key category** worth building out deliberately. They're what let custom presets, effects,
and assets "meld" together, and they're prime Remix material. Luma Key (§14.1b), the edge-fade (§14.1),
and the base `mix(_fb,_img,presence)` are the first three; this is the roadmap for more.

**Why it matters:** overlay = the asset sits apart (its own transform/opacity, no interaction). Melding =
the asset becomes *part of the living preset* — the engine processes it, the audio drives it, and it
combines with the preset's own content in a chosen way. That's the headline differentiator (ties to
[[project_one_click_vs_pro_tools]] and "audio reactivity is the differentiator"). Each melding tool is a
single opinionated knob/toggle; together they're a deep, rollable space.

**Roadmap (rough value order):**
1. **Blend mode** ⭐ **✅ SHIPPED 2026-06-04 (verified 33/33).** `imageWarp.blendMode` chip-row in the Drive
   panel: **Mix** (default, linear) · **Add** (additive light → glow) · **Screen** (soft lighten) ·
   **Multiply** (stamp/burn, darkens) · **Difference** (psychedelic inversion) · **Overlay** (contrast).
   In `buildImageWarp` the final line became `ret = mix(_fb, <blended>, presence)` where `<blended>` is a
   per-mode GLSL expr (`mix`→`_img` = byte-identical no-op). Switch emits only KNOWN exprs (injection-safe;
   bad mode → falls back to mix). Composes with presence/luma-key/framing. Remix rolls it (70% bright family
   mix/add/screen/overlay, 30% multiply/difference). Verified every mode renders bright (mix 216 · add 248 ·
   screen 248 · multiply 114 · difference 211 · overlay 187 — none dead).
2. **Displacement** — use the image's luma/gradient to **warp the feedback** (the image becomes a
   heightmap that bends the melt), not just contribute colour. "The logo's shape ripples the plasma."
   `_fb` sampled at `uv + grad(_img)*amt`.
3. **Mask** — use the image (or its luma) to gate WHERE the preset's OWN content vs the image shows
   (Luma Key is a primitive 1-image version; a real mask channel is more). Great for logos/shapes.
4. **Image-driven flow** — the image's gradient steers the flow *direction* (edges of the picture carry
   the melt). Deeper, more experimental.
5. **Palette-from-image** — tint the feedback/preset by the image's dominant colours.

**Build rules (same as always):** each = a gated addition to `buildImageWarp` (neutral = no-op,
boring-not-broken/luma>20), model field on `imageWarp`, one control in the Drive panel, both build sites,
headless verify. All axes must be **Remix-rollable** (Phase 7 Drive 🎲 + the global Remix, respecting
`_rolling` per [[project_remix_batch_perf]]). Applies beyond images too — video/GIF sources (Phase 3) and,
longer-term, other layer assets melding into the preset.

---

## 17. PERCEPTUAL (LOG) SPEED FADER (2026-06-04)

User: some flows (Melt, Liquid) need to slow WAY down — extreme slowdown produces amazing effects — and a
single linear fader can't tune that variety. Root cause: speed is perceptually **logarithmic** (0.1→0.2 is
a 2× change; 3.5→4.0 is invisible), but the fader was **linear** 0.1–4.0, so all the gorgeous slow range was
crammed into the bottom ~5%.

**Fix (one fader, smarter mapping):** map the slider position `t∈[0,1]` geometrically to speed:
`speed = SMIN * (SMAX/SMIN)^t` with **SMIN≈0.02, SMAX≈4.0**. Bottom half of travel ≈ 0.02–0.28 (fine slow
control), top half ramps to fast. Inverse `t = log(speed/SMIN)/log(SMAX/SMIN)` for sync. Readout shows the
real speed value. Keeps the one-knob ethos ([[project_one_click_vs_pro_tools]]) — no second control.

**Scope:** the **Drive panel Speed** AND the **Flow Style Speed** (Motion tab) — same flows (`_flowParts`),
same linear-range problem. Needs a dedicated log binder (the generic linear slider binder writes the raw
value through). Verify: slow end has fine resolution + renders; fast end still reachable; round-trips.

**⚠️ FOLLOW-UP FIX 2026-06-04 (two iterations) — Speed = true slow-motion.** Root cause: `_flowParts`
only scaled the sin OSCILLATION FREQUENCY by speed (`time*sp`), NOT the per-frame displacement. `melt`'s
signature drip is a **constant** `dp*0.018`, so Speed was nearly inert for it.
- **v1 (wrong):** scale `_flow *= speed`. This slowed it but ALSO shrank the displacement → the effect
  *weakened/vanished* at low speed ("takes speed down only removes the effects"). A feedback loop's
  visible richness = displacement/(1−decay), so shrinking the step shrinks the look.
- **v2 (correct):** scale `_flow *= speed` AND compensate persistence `_dec = 1 − speed*(1−decay)`,
  replacing `* decay` → `* _dec` in the feedback sample. This keeps the steady-state trail length
  **identical** (richness preserved) while the per-frame step — the RATE of evolution — scales by speed.
  True slow-motion: same rich look, evolving slower/faster. Non-kaleido (kaleido already slows via its
  `time*sp` spin); gated so speed=1 → no lines → byte-identical no-op. Verified (real editor): at speed 0.1
  vs 1.0 the melt **richness/luma is preserved (219≈219)** — no longer "removed" — while it flows slower.
  Scoped to the Drive melt (`buildImageWarp`); Flow Style's `buildWarpShader` untouched.

**✅ SHIPPED 2026-06-04.** Module helpers `_speedToPos`/`_posToSpeed` (SPEED_MIN 0.02, SPEED_MAX 4.0) +
`_bindLogSpeedSlider(id, get, set)` / `_syncLogSpeed(id, speed)` ([inspector.js](src/editor/inspector.js)).
Drive Speed slider → native range 0..1 (position), default position `_speedToPos(1.0)`≈0.738 (so "1.0×"
sits at ~¾ travel, bottom ¾ = 0.02–1.0 slow detail). Flow Style `fl-speed` converted the same way
(Depth/Density stay linear). Both readouts show the real speed. dbl-click reset → position for 1.0×.
Verified 24/24 (pos 0 → 0.02, pos 1 → 4.0, monotonic). Motion-Engine `me-speed` left linear (different
control; revisit if it needs it).
