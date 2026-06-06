# Video Cutout Edge Noise — Investigation (dev)

> **Purpose:** capture every finding/attempt on the "white speckle on melded transparent-video cutouts"
> bug so we **stop error-looping**. Read this before touching the meld edge again.
> Created 2026-06-06.

> ## ✅✅ SOLVED & CONFIRMED BY USER (2026-06-06). Edge Feather now visibly cleans web cutout edges.

## 🩺 POST-MORTEM — why none of the fixes landed all day (the one thing that mattered)

**The fixes were correct code on the WRONG code path.** All day, every edge fix (recolour, alpha blur,
RGB blur, resolution-adaptive blur, soft feather) was written inside `buildImageWarp`'s
`if (isStackedAlpha) { … }` branch. But:

- `isStackedAlpha` is **true only for macOS Tauri-converted videos** (`convert_to_stacked_alpha`, gated on
  `window.__TAURI__ && Mac`).
- The user was testing on the **web dev-server**, where transparent videos are **native VP9-alpha →
  `isStackedAlpha = false`**, and that branch was just `vec3 _img = texture(sampler, coord).rgb` — **the
  alpha channel (and therefore every edge fix) was never touched.**

So each "fix" shipped, the user reloaded, and saw **no change — because the code physically did not execute
on their videos.** We then mis-read "no change" as "wrong fix" and tried a different shader tweak… 8 times.

**What finally cracked it:** the user's report that **"Edge Feather does NOTHING."** A strong matte blur
producing *zero* visible change isn't a weak fix — it's a sign the code isn't running. Checking the gating
flag (`isStackedAlpha`) took 2 minutes and revealed the native branch had no alpha handling at all.

**THE LESSON (write this on the wall):** when a control has **literally no effect**, first verify it is on
the **active code path** (check the gating flag / branch / build that's actually running) **before**
theorizing about mechanisms. Hours of feedback-loop physics theory were moot because the lines never ran.
A `console.log`/grep of "is this branch even taken for this input?" should be step 1, not step 8.

**Secondary contributor:** the build/runtime split — the user was sometimes on the macOS build (no dev) and
sometimes the dev-server (uncommitted code), so "what's actually running" was ambiguous. Always pin which
build is under test.

---

> ## ✅ ROOT CAUSE FOUND (2026-06-06, round 4) — read this first
> **Every edge fix this whole saga was gated behind `if (isStackedAlpha)`.** That flag is **only true for
> macOS Tauri-converted videos**; on the **web/dev-server, transparent videos are native VP9-alpha →
> `isStackedAlpha = false`**, and the native meld branch was literally `_img = texture(sampler).rgb` —
> **it ignored the alpha channel entirely: no `_imgA`, no presence gate, no feather.** So on the videos the
> user was actually testing, **none of the edge code ever ran** ("Edge Feather does nothing" = proof).
> **FIX:** unified alpha handling — the native branch now reads `_imgA = texture(_sc).a`, gates presence by
> it (opaque content reads `.a = 1` → no-op, so opaque melds are unchanged), and applies the soft-feather
> blur. Edge Feather (default 0.5) now actually softens web transparent-video mattes. `buildImageWarp`,
> `src/customPresets.js`.

## Problem statement
Melding a **transparent-video cutout** (stacked-alpha, e.g. the silly-symphony skeleton clip) shows a
**white speckle / stipple** riding the silhouette edge. The melt **body** looks great; only the **edge**
sparkles. Worst on **small / low-res / heavily-compressed** cutouts.

## Hard evidence (do NOT re-derive — these are settled)
1. **Overlay = clean, Meld = speckle.** The SAME clip, imported as a normal overlay layer (Meld OFF), has
   clean crisp edges — even at small source dimensions. Turning Meld ON introduces the speckle. → the noise
   is introduced by the **Meld/Flow path**, not the source matte.
2. **Higher-res cutout = much less speckle; small/low-res = more.** → edge sharpness/contrast relative to
   the feedback matters.
3. **An OLD build's meld had CLEAN melded edges** (the "yellow-triangle over the skull mandala/kaleido"
   screenshot — panel shows Speed/Depth/Spin/.../Displace but NO Flow Map / Tint / Edge Feather, so it
   predates today's commits). → a **clean meld is achievable**; a change *after* that image may have
   regressed it.

## Architecture — why overlay differs from meld
- **Overlay:** the video is composited **once** in the COMP shader (`mix(presetColor, videoRGB, videoAlpha)`),
  at display resolution, using `textureGrad` (see `src/editor/inspector.js` ~`sampleGrad`, line ~9906). No
  accumulation → clean edge.
- **Meld:** the video is injected into butterchurn's **WARP** shader (`buildImageWarp`, `src/customPresets.js`)
  → `ret = mix(_fb, _img, presence)` is written to the **feedback buffer** → re-sampled (warped + decayed)
  **every frame**. The loop re-processes the edge each frame. This loop is the difference.

## LEADING SUSPECT (found via git, 2026-06-06) — a self-inflicted regression
- **Committed meld (HEAD `a6807c4`)** — the state that produced the clean old screenshot — samples simply:
  ```glsl
  vec3 _img  = texture(sampler_x, vec2(_suv.x, _suv.y*0.5)).rgb;   // top half RGB
  float _imgA = texture(sampler_x, vec2(_suv.x, _suv.y*0.5+0.5)).r; // bottom half alpha
  ...
  presence *= _imgA;
  ```
- **My UNCOMMITTED edge work added an ALWAYS-ON "recolour":**
  ```glsl
  float _wf = min(_img.r, min(_img.g, _img.b)) * (1.0 - _imgA);  // white AND edge
  _img = mix(_img, _fb, clamp(_wf * 2.4, 0.0, 0.9));             // edge → feedback colour
  ```
  **Why this is the suspect:** `_fb` is the **warped, decayed feedback = the swirling melt (high frequency)**.
  At the white edge (`_wf` high) it replaces clean white with up to **90% feedback texture** → the edge shows
  the melt's swirl → **reads as speckle.** It was meant to remove "white"; it actually **injected
  high-frequency noise**. The dev server (localhost) runs uncommitted changes live, so this has been active
  during the recent edge-noise testing while the OLD clean screenshot was the committed/old build.

## Attempts log (chronological — what we tried, outcome, status)
| # | Attempt | Outcome | Status |
|---|---|---|---|
| 1 | Edge choke (`smoothstep` on presence) | cut the edge → reduced wanted animation | reverted |
| 2 | White-fringe opacity trim | same problem | reverted |
| 3 | **White→scene RECOLOUR** (`mix(_img,_fb,…)`) | "much better" (white gone) BUT injects feedback texture at edge → **THE SUSPECT** | **reverting now** |
| 4 | Alpha 5-tap blur (fixed radius) | "still happening" (wrong scale) | reverted |
| 5 | Resolution-adaptive alpha+RGB blur | **WORSE** (RGB blur spread the white) | reverted |
| 6 | **Edge Feather knob** (gated, alpha-only blur+sharpen, default 0) | user-controlled low-res cleanup | **kept (gated off)** |

## NEXT TEST (the experiment that confirms the diagnosis)
1. **Revert the always-on recolour** → back to committed sampling (`presence *= _imgA`).
2. Reload the **dev server** (no rebuild needed — localhost is live) and meld the cutout.
3. **Does the melded edge go clean (like the old yellow-triangle screenshot)?**
   - **YES** → the recolour was the regression. Ship without it; rely on the **Edge Feather** knob for
     low-res cleanup. **Bug solved.**
   - **NO** → the noise is in the feedback loop itself; pursue the open hypotheses below.

## Open hypotheses (only if the revert does NOT fully clean it)
- **8-bit feedback + decay accumulation** → quantization dither at the partial-presence edge (overlay
  composites once → no accumulation → clean). Fix dir: higher-precision feedback (HALF_FLOAT) — butterchurn
  internal, may not be exposed.
- **Sharp edge re-injected at fixed `uv_orig` each frame** beats against the **warped** feedback →
  sub-pixel interference. Fix dir: band-limit the injected edge (Edge Feather alpha blur) to the feedback's
  effective resolution — already available as the opt-in knob.
- **Feedback buffer resolution < display** → sharp edge undersampled (Nyquist) in the buffer → aliasing;
  smooth body unaffected. Check butterchurn `createVisualizer({width,height,pixelRatio})` internal texsize.

## DEEP AUDIT ROUND 2 (2026-06-06) — the unified mechanism + research

**Correction:** reverting the recolour did NOT fix it. So the noise is in the **base/committed Flow**, not
my recolour. (The old clean screenshot was lower-contrast/older content, not a different engine.)

**The decisive new clue from the user:** an **opaque image melds CLEAN; only a transparent CUTOUT melds
noisy.** Plus: overlay (no feedback) is clean; white cutouts worst; small/low-res worse; non-white less
(and Remix colour compensates). One mechanism explains ALL of it:

### THE MECHANISM (high confidence)
The meld re-injects the image at a **FIXED** screen coord (`uv_orig`) every frame, gated by the alpha matte,
while the **feedback is WARPED** (`_fb = texture(sampler_main, _zuv + _flow)` — zoom + flow). So at the matte
**edge** there are two versions of the silhouette boundary each frame: the **fixed, freshly-stamped sharp
edge** (image) and the **warped/drifted edge** (feedback from last frame). They sit at slightly different
positions → they **interfere** → bright where they overlap, dark where they don't → a shimmering stipple
that rides the edge. 
- **Opaque image** → uniform presence, NO edge → no two-edges → no interference → CLEAN. ✓
- **Overlay** → no feedback, single composite → no second edge → CLEAN. ✓
- **White** → max contrast → interference maximally visible. ✓  **Non-white** → less. ✓
- **Small/low-res** → coarser edge → coarser, more visible interference. ✓  **Large/hi-res** → finer → less. ✓

It is therefore an **edge-aliasing / edge-crawl artifact of a hard matte in a warped feedback loop** — a
KNOWN class of problem, not unique to us.

### Research findings (what the field does)
- **Straight (non-premultiplied) alpha → edge fringe** is the classic compositing bug: "colours of
  semi-transparent edges shift toward the background in proportion to transparency"; fix = premultiply /
  "Remove Color Matting" / defringe. Our encode (`src-tauri/src/main.rs:351`) is
  `format=yuva420p,split,alphaextract→gray (bottom), format=yuv420p (top), vstack` = **straight alpha**, and
  the top RGB is **yuv420p (chroma-subsampled)** → the edge RGB is imperfect to begin with.
- **Hard/keyed edges crawl & shimmer in a feedback loop**; the standard fix is to **anti-alias / soften the
  matte edge** so there is no razor edge for the loop to beat against (temporal-AA of the edge).

### KEY REALISATION — our Edge Feather knob was self-defeating
Edge Feather did: blur the alpha (good — softens, fights the interference) **then `smoothstep(0.4,0.7)` to
RE-SHARPEN it** → which **re-creates the hard edge** the blur just removed → re-introduces the interference.
For this mechanism the edge must stay **SOFT**. Fix: make Edge Feather **soft-only** (blur, NO re-sharpen).

### NEXT EXPERIMENT (grounded in the mechanism + research)
Make Edge Feather a **soft-only matte blur** (drop the sharpen, widen the range). A genuinely soft matte edge
turns the fixed-vs-warped interference into a smooth blend → the stipple should go. Crank it on a white
skeleton cutout. If it cleans → mechanism confirmed; consider a gentle default-on for stacked cutouts so
they're usable out of the box. If a soft edge alone isn't enough, layer in **premultiplied compositing**
(premultiply `_img` by `_imgA` and composite premult) to kill the straight-alpha fringe too.

## DEEP AUDIT ROUND 3 (2026-06-06) — soft-feather attempt + the precise code diff

**Failure logged:** soft-only Edge Feather (9-tap matte blur, no re-sharpen) did **not** visibly clear it
in the user's test — "still there on all Flow settings." (Caveat: the slider sits below the fold at default
0; unclear if it was cranked. So next we make it **default-on** to force the test.)

**Precise code-level answer to "what does clicking Meld do?":**
- **Overlay (clean):** the video is composited in the **COMP shader** — sampled once, alpha-blended over the
  finished frame, discarded each frame. **No feedback memory.** Edge composited once → clean.
- **Meld (noisy):** `_toggleCardDrive` replaces `preset.warp` with `buildImageWarp` output, which injects the
  video into the **feedback buffer** (`ret = mix(_fb, _img, presence)`) — re-read, **warped + decayed every
  frame** (and `decay` is forced up to `FLOW_FILL_DECAY`, so the buffer has LONG memory). The hard matte edge
  is **re-stamped at a fixed `uv_orig` while the feedback drifts** → two offset copies of the edge beat →
  moving white stipple. The feedback memory is the ONLY difference, and it explains every observation.

**Confirmed NOT the cause** (ruled out this saga): the recolour (reverted), straight-alpha/premultiply (the
overlay composites the SAME straight-alpha video cleanly, so it's not that), source compression alone (the
overlay survives it). **It is the feedback loop, full stop.**

### DEFINITIVE TEST (round 3): Edge Feather default-ON + stronger
Make a soft matte edge the DEFAULT for cutouts (`edgeFeather` default 0.5, radius `feather*0.05`) so the user
sees it without hunting. Soft edge = no hard edge for the loop to beat against.
- **If clean** → solved; tune the amount, keep default-on for cutouts.
- **If it STILL sparkles even fully softened** → edge-softening is NOT the cure; the feedback loop generates
  the stipple from the alpha-gated presence itself regardless of edge sharpness. Then the honest options are:
  (a) **Overlay for crisp cutouts, Meld for melted** (accept the distinction), or
  (b) a **two-pass** design: composite the clean cutout on top (overlay) AND feed a melted copy into the
      feedback — decoupling "clean edge you see" from "the melt" (bigger change), or
  (c) **edge-gradient presence reduction**: detect the alpha gradient (the edge) and drop re-injection there
      so the smooth warped feedback — not the sharp re-stamp — defines the boundary (untested; next if (a)/(b)
      unwanted).

## References
- MilkDrop preset authoring (warp vs comp shader): https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html
- Meld shader generator: `src/customPresets.js` → `buildImageWarp`.
- Clean overlay stacked-alpha composite: `src/editor/inspector.js` ~line 9906 (`sampleGrad` / `textureGrad`).
- Edge-noise saga memory: `[[project_image_texture_idea]]`.
