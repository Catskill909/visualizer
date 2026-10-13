# Player freeze on custom presets with 1–3 shapes

> **Status:** ✅ Fixed 2026-10-12. Kept for reference.

## Symptom
During a show (player, favorites auto-cycle, projector output), the visuals froze **for good**
while the music kept playing. Next/Prev changed the preset *name* but nothing drew. Only quitting
the app recovered it.

## Root cause (two bugs stacked)
1. **Custom presets saved with 1–3 Custom Shapes crashed every frame in the player.** The engine
   always draws 4 shape slots and reads `preset.shapes[i]`. The editor pads to 4 with disabled
   stubs at runtime (`inspector._buildRuntimePreset`), but the player's `refreshCustomPresets`
   didn't, so `drawCustomShape(undefined)` threw `shapeEqs.baseVals` on slots 2–4 (also while
   blending out of such a preset). Found presets: `springyFace1`, `turntablesTurning` (1 shape each).
   Present since Custom Shapes shipped (June 2026).
2. **One frame error killed the render loop.** `startRenderLoop` only scheduled the next
   `requestAnimationFrame` at the *end* of a frame, so any throw stopped rendering permanently.

## Fix
- `visualizer.js refreshCustomPresets`: pad shapes to 4 with disabled stubs (same as the editor).
- `src/vendor/butterchurn.js drawCustomShape`: skip a missing slot (safety net for any preset
  source; `drawCustomWaveform` already guarded).
- `visualizer.js startRenderLoop`: body moved to `_renderFrame()`; `try / catch / finally` always
  schedules the next frame. Each distinct error is logged once and shown once in the red
  "RENDER ERROR (loop will continue)" banner (no devtools in the DMG).

## How it was found
A temporary `tauri dev` harness (favorites auto-cycle every 4 s + output window, logging frame
errors via a dev-only Rust `dev_log` command) reproduced it on the first pass. After the fix, a
4-minute run (~6 laps of the favorites) had **0 frame errors**.
