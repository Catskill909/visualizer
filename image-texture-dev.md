# Image-as-Texture — feeding images INTO MilkDrop presets

Status: **💡 Scoped + AUDITED + SPIKED 2026-06-03 — ✅ FEASIBLE, NO ENGINE FORK.** Audit (§9): the
user-image→GL-texture pipeline already exists. Spike (§11): a **warp shader can sample a user
texture** (headless luma 75) → image melts into the feedback loop by reusing `setUserTexture` +
warp-injection (like Flow Style). Remaining = build + visual tuning, not feasibility. Origin:
`milkdrop-pack-import.md` §16.2.

> **One-liner:** let a user's image/video/GIF become a **texture the MilkDrop preset itself
> processes** — so it gets melted, tunneled, kaleidoscoped, smeared, and pulsed to the audio by the
> preset's own engine — instead of just sitting on top as an overlay layer.

---

## 📍 PHASE TRACKER — START HERE

_Single source of truth for status. Detail in the numbered sections below._

| Phase | What | State |
|---|---|---|
| **Spike / Audit** | Feasibility — pipeline exists (`setUserTexture`) + **warp shader can sample a user texture** → no engine fork (§9, §11) | ✅ **DONE 2026-06-03** |
| **1 — Feedback-melt engine** | A generated **warp-injection** (à la `buildWarpShader`) that blends a user texture into the feedback loop, with **reseed/persistence + blend** knobs (optionally audio-reactive). Image supplied via `setUserTexture`. **Tune the melt look in a real browser.** | ⬜ **NEXT** |
| **2 — UX** | "Drive the preset" **mode** + the ~3 knobs, in the **Images tab**; image loads via the existing path | ⬜ not started |
| **3 — More sources** | Video / GIF / webcam frames (all already `setUserTexture`-supported) | ⬜ not started |
| **4 — Named-texture path (optional)** | "Photo-reactive" presets that sample a known user sampler + ship the **22 built-in texture assets** (`milkdrop-pack-import.md` §16.1) so the ~66 texture presets render right | ⬜ optional |

**▶️ PICK UP AT PHASE 1:** write `buildImageWarp(opts)` (mirrors `customPresets.js buildWarpShader`)
that blends `sampler_<userimg>` into `sampler_main` with reseed + blend params; wire an image in via
`setUserTexture`; **iterate the blend/decay live in a browser** (headless proved the *mechanism* —
the *look* needs eyes). Self-verify the mechanism headlessly (luma > 0), tune aesthetics by eye.

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
