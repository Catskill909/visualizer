# Add Tracks — Timeline Multi-Track (Design & Dev)

**Status:** 📋 **PLACEHOLDER / brainstorming — do NOT implement yet.** Created 2026-05-24. Needs a design pass (UI + data model) before any code. This doc exists so the idea + the known issues are captured while fresh.

---

## Why now

With **transparent-bg presets** (shipped 2026-05-24) + **output stacking/layering** (A3, shipped), the timeline is becoming a real **layer compositor**. The current fixed layouts (the 6 zone presets, e.g. the 2-channel **Left / Right**) are too rigid — users want to **add / remove / reorder tracks** freely to stack many (often transparent) presets. This is the timeline-side of the "visual orchestration" north star.

---

## ⚠️ Known issue to fix as part of this (reported 2026-05-24)

**Track stacking order is counter-intuitive.** In the Left/Right layout, the **bottom layer is "Left"** and **"Right" renders on top** — the timeline row order doesn't match the visual z-order. **The bottom track in the timeline should be the bottom layer of the stack** (top track = top layer), so the strip reads like the composite.

This is fundamentally a **`zone.zIndex` ↔ row-order** mapping (the same zIndex that drives A3 output stacking — see [`output-dev.md`](output-dev.md) §1). Whatever the multi-track model becomes, the row order must map intuitively to the layer/z order. Decide the convention explicitly (e.g. top-row = front, like Photoshop's layer list — or bottom-row = front; pick one and make routing + the strip agree).

---

## 💡 Considered & parked 2026-05-24 — "Overlay" layout + transparent gaps

While validating transparent-bg presets in the timeline (see [`transparent-dev.md`](transparent-dev.md)), we explored a dedicated **full-screen "Overlay" layout**: two full-screen zones (`Base` + `Overlay`) where the top zone's **gaps are transparent** — so when the top track has no clip, the base shows through instead of a black square.

**Parked, deliberately.** Reasoning:
- An empty zone showing **black is correct** — that's how every zone already behaves, and the user confirmed it reads right.
- "Transparent gap" is only meaningful for a zone *stacked over another full-screen zone*. That's exactly what add-tracks generalises, so it belongs **here**, not as a one-off fixed layout that we'd have to special-case.
- The mechanism is small when we do build it: a zone flag (`gapBehavior: 'transparent'`) honored in **one place** — [`_fadeZoneCover`](src/timeline/timelineEditor.js) — where "hide" fades the *canvas* to transparent (revealing the base) instead of raising the black cover. Plus an output-mirror tweak (the NDI/program-out stack reads cover opacity; a transparent zone would need it to read canvas opacity instead).

**So when add-tracks lands:** an upper/overlay track should default `gapBehavior: 'transparent'`; base/bottom tracks stay `'black'`. That single flag + the `_fadeZoneCover` branch is the whole feature.

---

## Open questions (the brainstorm — this is the hard part, hence the placeholder)

- **Add / remove / reorder UI.** How does a user add a track — a `+` on the strip? a dedicated track-manager? Reorder by drag? Delete from the row header? (Today: `⊞ Zones` modal picks one of 6 fixed layouts.)
- **Track ↔ zone ↔ zIndex.** Today zones come from fixed layouts. Multi-track = dynamic zones. Reconcile two roles: **region** (operator-screen tiling) vs **overlay layer** (transparent stacking). A3 already decided **output = full-frame overlay, not region-tiled**; region stays an operator-preview concern. So tracks are likely **overlay layers** with z-order, and "region" becomes optional placement.
- **How many tracks?** Each zone = its own engine/canvas (the drift-free mirror model). N stacked transparent presets = N engines. What's the perf budget / soft cap?
- **Operator preview.** If tracks are overlay layers (not tiled), how does the operator *see/arrange* them while building — a stacked preview, a tiled monitor wall, per-track thumbnails?
- **Per-track metadata.** Name, color, solo/mute (some exists on zones today), opacity/blend (exists — `_buildStackControls`), and the z-order handle.
- **Migration.** Fixed 6 layouts → dynamic tracks. Keep the presets as quick-starts? How do existing saved timelines map?
- **Interplay with output (A3) + transparent-bg.** A track = a Source; routing + stacking + transparent reveal is the payoff. The data already mostly exists (`mkZone()`: region/opacity/blendMode/zIndex/output).

---

## Related docs
- [`output-dev.md`](output-dev.md) — A3 stacking, `zone.zIndex/opacity/blendMode`, the overlay model, per-display routing.
- [`transparent-dev.md`](transparent-dev.md) — per-layer alpha (the reveal that makes stacking shine).
- [`timeline-editor.md`](timeline-editor.md) — zones, the 6 layouts, the strip, `ZONE_COL_W`.

## Next step
A design session to settle: (1) the add/remove/reorder UI, (2) the track↔zIndex order convention (fixes the issue above), (3) the fixed-layouts → dynamic-tracks model + migration. Then phase it. **No code until that's agreed.**
