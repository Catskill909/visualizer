# Video Cutout Edge Noise — SOLVED (post-mortem)

> **Status: ✅ SOLVED, shipped & confirmed (2026-06-06).** Verified by the user on the dev server + the
> **macOS build**; **Windows build generated, pushed live to `promo/`** (Windows test pending the coming week).
> Transparent-video melding — **especially small/low-res cutouts — is now clean and fully shippable.**
> This doc is closed; kept as the record of the fix and the lesson.

---

## TL;DR
- **Symptom:** melding a transparent-video cutout (e.g. the silly-symphony skeleton) showed a moving **white
  speckle** riding the silhouette edge. Worst on small / low-res / B&W cutouts. Overlay (Meld off) was clean.
- **Root cause:** the **web/native-alpha meld path ignored the alpha channel entirely.** All edge handling
  lived behind `if (isStackedAlpha)` (macOS-only), so on the web (native VP9-alpha) the meld was a bare
  `texture(sampler).rgb` with no matte gate and no edge treatment — the hard matte edge went straight into
  the feedback loop and sparkled.
- **Fix:** unified the alpha handling so **both** paths gate the meld by the matte (`presence *= _imgA`) and
  apply a **soft-feather** matte blur (`edgeFeather`, default 0.5). Opaque content reads `.a = 1` → no-op, so
  solid image/video melds are unchanged. `buildImageWarp` in `src/customPresets.js`.
- **Lesson:** when a control has **literally no visible effect**, first verify it's even on the **active code
  path** — *before* theorizing mechanisms.

---

## 🩺 POST-MORTEM — why none of the fixes landed all day
**The fixes were correct code on the WRONG code path.** Every edge attempt (recolour, alpha blur, RGB blur,
resolution-adaptive blur, soft feather) was written inside `buildImageWarp`'s `if (isStackedAlpha) { … }`
branch. But:

- `isStackedAlpha` is **true only for macOS Tauri-converted videos** (`convert_to_stacked_alpha`, gated on
  `window.__TAURI__ && Mac`).
- The user tested on the **web dev-server**, where transparent videos are **native VP9-alpha →
  `isStackedAlpha = false`**, and that branch was just `vec3 _img = texture(sampler, coord).rgb` — **the alpha
  channel, and therefore every edge fix, was never touched.**

So each "fix" shipped, the user reloaded, saw **no change** (the code didn't execute on their videos), and we
mis-read "no change" as "wrong fix" — then tried another shader tweak, ~8 times.

**What cracked it:** the user's report that **"Edge Feather does NOTHING."** A strong matte blur with *zero*
visible effect isn't a weak fix — it means the code isn't running. Checking the gating flag took two minutes
and revealed the native branch had no alpha handling at all.

**THE LESSON (on the wall):** a control that does *literally nothing* → **verify the active code path /
branch / build first** (a "is this branch even taken for this input?" grep is step 1, not step 8). Hours of
feedback-loop theory were moot because the lines never ran. **Secondary contributor:** build/runtime
ambiguity — the user was sometimes on the macOS build, sometimes the dev-server (uncommitted code); always
pin which build is under test.

---

## The fix (what shipped)
In `buildImageWarp` (`src/customPresets.js`), alpha is now handled on **both** layouts:
- **Stacked-alpha** (macOS): RGB = top half, alpha = bottom-half luma (unchanged recombine).
- **Native-alpha** (web transparent video / transparent PNG/GIF/text): `_imgA = texture(_sc).a`.
- `presence *= _imgA` is now **unconditional** (both branches define `_imgA`). Opaque content → `.a = 1` →
  no-op (opaque melds byte-identical).
- **Edge Feather** (`imageWarp.edgeFeather`, default **0.5**): a **soft-only 9-tap box blur of the matte
  alpha** (radius ∝ feather, no re-sharpen). A soft matte edge stops the hard edge from beating against the
  warped feedback. Blurs ALPHA only (blurring RGB spread the white — a dead end). `feather = 0` → single tap.
- UI: **Edge Feather** slider in the Meld panel; passed at both build sites (editor + `visualizer.js`).

## Why the edge needed softening (the mechanism — reference)
The meld re-injects the cutout at a **fixed** screen coord each frame while the **feedback is warped** (zoom +
flow). At the matte edge there are two silhouette boundaries per frame — the fresh fixed one and last frame's
drifted one — and a **hard** edge makes them interfere → moving white stipple. A **soft** matte edge turns
that beating into a smooth blend → no stipple. (This is a known class of artifact: hard/keyed edges crawl in
feedback loops; the field's fix is to anti-alias the matte edge — which is exactly what Edge Feather does.)
The overlay path is clean because it composites **once** with no feedback memory.

## Dead ends (all were on the wrong code path or fought the wrong thing)
| Attempt | Why it didn't work |
|---|---|
| Edge choke / opacity trim on presence | reduced the wanted animation; also stacked-only path |
| White→feedback recolour | injected the feedback's swirl into the edge (more noise); stacked-only |
| Alpha blur (fixed radius) / resolution-adaptive / RGB blur | wrong scale or spread the white; **all stacked-only → never ran on web** |
| Edge Feather with a `smoothstep` re-sharpen | re-created the hard edge it just blurred (self-defeating) |
| **Soft-only feather + unified alpha handling (native path)** | ✅ **the fix** |

## If edge noise ever resurfaces on some asset
1. Confirm which path runs (`isStackedAlpha`?) and that `_imgA` is actually gating — **check the branch first.**
2. Raise **Edge Feather** (soft matte blur). 
3. Higher-res / less-compressed source cutouts always read cleaner.
4. Last resort (not needed so far): a two-pass design — clean overlay edge + a melted copy fed to feedback.

## References
- Meld shader generator: `src/customPresets.js` → `buildImageWarp`.
- Clean overlay stacked-alpha composite: `src/editor/inspector.js` ~line 9906 (`sampleGrad` / `textureGrad`).
- Stacked-alpha encode: `src-tauri/src/main.rs` `convert_to_stacked_alpha`.
- MilkDrop warp-vs-comp shader: https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html
- Saga memory: `[[project_image_texture_idea]]`.
