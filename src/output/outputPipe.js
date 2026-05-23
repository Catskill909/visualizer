/**
 * outputPipe — the ONE platform-specific seam (output-dev.md §4/§5): how source
 * pixels physically reach an output window. Everything above this (UI, routing,
 * the Source/Output/Route model, layer compositing) is shared across platforms.
 *
 * WEB pipe (this file): each source canvas is mirrored with canvas.captureStream()
 * and the live MediaStream is handed to a same-origin window.open popup. The opener
 * stashes a LAYER LIST per output id — one entry per source, each carrying its
 * stream + the compositing recipe (zIndex/opacity/blendMode). The popup reads its
 * list via window.opener and builds one full-frame <video> per layer. Stacking is
 * overlay (not tiled), composited by that recipe. No re-render, no audio, no
 * per-frame messaging — the popup is a dumb mirror of the canvases.
 *
 * One layer  = the player/editor single-source case ('main').
 * Many layers = the timeline stacking case (A3): several zones → one display.
 *
 * NATIVE pipe (Tauri macOS/Windows — Phase B/C): Syphon / Spout / pixel-readback
 * swaps in behind this same setLayers/clearLayers/getLayers contract.
 */
const STORE = '__dcOutputLayers';

// Opener-side capture registry: outId → Map<canvas, MediaStream>. Lets setLayers
// reuse an existing stream for a canvas and stop streams for dropped canvases.
const _caps = new Map();

function layersStore() {
  if (!window[STORE]) window[STORE] = Object.create(null);
  return window[STORE];
}

function capsFor(outId) {
  let m = _caps.get(outId);
  if (!m) { m = new Map(); _caps.set(outId, m); }
  return m;
}

function stopStream(s) {
  try { s.getTracks().forEach(t => t.stop()); } catch { /* already ended */ }
}

/**
 * Opener side: set the full layer list mirrored for output `outId`. Reuses an
 * existing captureStream for a canvas already being mirrored; stops streams for
 * canvases no longer present. Safe to call repeatedly (live add/remove/reorder).
 * @param {string} outId
 * @param {Array<{id, canvas, opacity?, blendMode?, zIndex?, transitionMs?}>} layers
 */
export function setLayers(outId = 'main', layers = [], fps = 60) {
  const caps = capsFor(outId);
  const keep = new Set();
  const out = [];
  for (const L of layers) {
    if (!L || !L.canvas) continue;
    let stream = caps.get(L.canvas);
    if (!stream) { stream = L.canvas.captureStream(fps); caps.set(L.canvas, stream); }
    keep.add(L.canvas);
    out.push({
      id: L.id,
      stream,
      opacity: L.opacity ?? 1,
      blendMode: L.blendMode || 'normal',
      zIndex: L.zIndex ?? 0,
      transitionMs: L.transitionMs ?? 0,
    });
  }
  for (const [canvas, stream] of [...caps.entries()]) {
    if (!keep.has(canvas)) { stopStream(stream); caps.delete(canvas); }
  }
  layersStore()[outId] = out;
}

/** Opener side: stop mirroring `outId` and release all its capture tracks. */
export function clearLayers(outId = 'main') {
  const caps = _caps.get(outId);
  if (caps) {
    for (const s of caps.values()) stopStream(s);
    caps.clear();
    _caps.delete(outId);
  }
  if (window[STORE]) delete window[STORE][outId];
}

/** Output-window side: the live layer list for `outId` from the opener, or null. */
export function getLayers(outId = 'main') {
  try { return window.opener?.[STORE]?.[outId] || null; } catch { return null; }
}
