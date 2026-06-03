# Image-as-Texture — feeding images INTO MilkDrop presets

Status: **💡 Brainstorm / scoping — not started.** Captured 2026-06-03 while the idea was hot.
Origin: `milkdrop-pack-import.md` §16.2 (the texture-asset discussion led here).

> **One-liner:** let a user's image/video/GIF become a **texture the MilkDrop preset itself
> processes** — so it gets melted, tunneled, kaleidoscoped, smeared, and pulsed to the audio by the
> preset's own engine — instead of just sitting on top as an overlay layer.

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

## 6. Phased sketch (rough — refine when we commit to it)

- **Spike:** can we write into Butterchurn's feedback buffer? (Approach A feasibility.) If not, how
  hard is a minimal engine hook/fork? Confirm the named-texture path (B) too.
- **Phase 1:** seed a still image into the feedback loop with a reseed-rate control; prove the
  "melt/tunnel" effect live + audio-reactive. Self-verify headlessly (Playwright + WebGL, like
  `verify:packs`).
- **Phase 2:** UX — pick source, blend/reseed controls, save into a preset.
- **Phase 3:** extend to video/GIF/webcam frames; maybe a few purpose-built "photo-reactive" presets.

---

## 7. Open unknowns (the spike answers these)

1. Does Butterchurn expose its feedback FBO / a way to seed `sampler_main`? (Determines if A needs a fork.)
2. What's the exact texture-provision API for named textures (B)?
3. Performance of per-frame (or per-N-frame) texture re-upload at render resolution.
4. How gracefully presets behave when their feedback is overwritten (some may flash/strobe).

---

## 8. Verdict

Genuinely powerful and **fully cross-platform** — the only real cost is engine integration + UX
design, gated on one spike (can we seed the feedback buffer?). Not part of the pack-import work;
this is its own feature. **Build when ready** — start with the spike.
