/**
 * outputPipe — the ONE platform-specific seam (output-dev.md §4/§5): how source
 * pixels physically reach an output window. Everything above this (UI, routing,
 * the Source/Output/Route model, layer compositing) is shared across platforms.
 *
 * WEB pipe (this file): canvas.captureStream() handed to a same-origin
 * window.open popup. The opener stashes the live MediaStream on its own window,
 * keyed by output id; the popup reads its own key via window.opener and shows it
 * in a <video>. No re-render, no audio, no per-frame messaging — the popup is a
 * dumb mirror of the canvas. Keying supports several outputs at once (timeline:
 * Left→Display 2, Right→Display 3); the player/editor use the default 'main'.
 *
 * NATIVE pipe (Tauri macOS/Windows — Phase B/C): Syphon / Spout / pixel-readback
 * swaps in behind this same attach/detach/receive contract.
 */
const STORE = '__dcOutputStreams';

function streams() {
  if (!window[STORE]) window[STORE] = Object.create(null);
  return window[STORE];
}

/**
 * Opener side: begin mirroring `canvas` for output `outId`. Must run BEFORE
 * window.open so the popup can read the stream from its opener on first load.
 * @returns {MediaStream}
 */
export function attachSource(canvas, outId = 'main', fps = 60) {
  detachSource(outId);
  const stream = canvas.captureStream(fps);
  streams()[outId] = stream;
  return stream;
}

/** Opener side: stop mirroring `outId` and release its capture tracks. */
export function detachSource(outId = 'main') {
  const s = window[STORE]?.[outId];
  if (s) {
    try { s.getTracks().forEach(t => t.stop()); } catch { /* already ended */ }
    delete window[STORE][outId];
  }
}

/** Output-window side: the live MediaStream for `outId` from the opener, or null. */
export function receiveStream(outId = 'main') {
  try { return window.opener?.[STORE]?.[outId] || null; } catch { return null; }
}
