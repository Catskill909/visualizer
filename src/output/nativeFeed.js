/**
 * nativeFeed — the DESKTOP pixel pipe's sending side (output-dev.md Phase B2).
 *
 * Tauri 1 can't hand a MediaStream to another window (and window.open doesn't
 * exist there), so on desktop the output window is a Rust-created window that
 * PULLS frames: this module copies each finished source frame into a small 2D
 * canvas, JPEG-encodes it, and pushes it to Rust (`output_push_frame`). The
 * output window fetches the newest frame over the `dcframe://` protocol.
 *
 * Rules carried from the docs:
 *  - copy pixels, never re-render (§13) — one engine, one render;
 *  - copy a WebGL canvas only right after render() (frame tap), while its
 *    buffer is valid; a 2D source (e.g. the timeline composer) can be copied
 *    any time, so it gets a rAF loop instead;
 *  - JPEG over IPC is the transport proven by NDI N0 (~13 ms @ 720p, 30 fps).
 *
 * Settings (fps / max width / JPEG quality) persist in localStorage and can be
 * changed live from the output window's test readout (Tauri event
 * `dc-output-settings`).
 */

const SETTINGS_KEY = 'dc_output_feed';
// 1080p @ 30 measured best on a Mac mini M2 (2026-10-11): ~25 ms delay, no main-window cost.
// 1080p @ 60 is too heavy for JPEG copy (40 fps, main window drops to 90).
const DEFAULTS = { fps: 30, maxW: 1920, quality: 0.85 };

export function loadFeedSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

function saveFeedSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function toBase64(buf) {
  const u8 = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Start feeding frames from `canvas` to the desktop output window.
 * @param {{ canvas: HTMLCanvasElement, tap?: (fn:(c:HTMLCanvasElement)=>void)=>(()=>void) }} source
 *   `tap` subscribes to "right after render" (engine.addFrameTap). Without it,
 *   frames are taken on a rAF loop (fine for 2D canvases).
 * @returns {() => void} stop
 */
export function startNativeFeed({ canvas, tap }) {
  const tauri = window.__TAURI__;
  if (!tauri || !canvas) return () => {};

  let settings = loadFeedSettings();
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d');
  let busy = false;
  let nextDue = 0;   // pacing: next frame time, advanced by exactly 1/fps
  let stopped = false;
  let errorShown = false;

  function sizeFor(src) {
    const w = Math.max(2, Math.min(settings.maxW, src.width || settings.maxW));
    const h = Math.max(2, Math.round(w * (src.height || 9) / (src.width || 16)));
    if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
  }

  function onFrame(src) {
    if (stopped || busy) return;
    const now = performance.now();
    if (now < nextDue) return;
    // Advance by exactly one interval so the average rate hits the target even
    // when render ticks don't line up (e.g. 100 Hz display, 30 fps feed);
    // after a stall, resync instead of bursting to catch up.
    const interval = 1000 / settings.fps;
    nextDue = Math.max(nextDue + interval, now - interval / 2);
    busy = true;
    const t0 = performance.now();
    try {
      sizeFor(src);
      ctx.drawImage(src, 0, 0, off.width, off.height);   // synchronous copy while the buffer is valid
    } catch (e) {
      busy = false;
      if (!errorShown) { errorShown = true; reportError('copy', e); }
      return;
    }
    const ts = Date.now();
    off.toBlob(async (blob) => {
      try {
        if (!blob || stopped) return;
        const encMs = performance.now() - t0;
        const b64 = toBase64(await blob.arrayBuffer());
        await tauri.invoke('output_push_frame', { frameB64: b64, ts, encMs });
      } catch (e) {
        if (!errorShown) { errorShown = true; reportError('push', e); }
      } finally {
        busy = false;
      }
    }, 'image/jpeg', settings.quality);
  }

  // Errors must be visible: there are no devtools in the signed DMG (apng-dev.md lessons).
  function reportError(stage, e) {
    const msg = `[output] ${stage} failed: ${e?.name || ''} ${e?.message || e}`;
    console.error(msg);
    try { tauri.event?.emit('dc-output-error', msg); } catch { /* ignore */ }
  }

  let untap = null;
  let raf = 0;
  if (tap) {
    untap = tap(onFrame);
  } else {
    const loop = () => { onFrame(canvas); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }

  // Live settings from the output window's readout.
  let unlisten = null;
  tauri.event?.listen('dc-output-settings', (ev) => {
    settings = { ...settings, ...(ev.payload || {}) };
    saveFeedSettings(settings);
  }).then((fn) => { unlisten = fn; }).catch(() => { /* ignore */ });

  return () => {
    stopped = true;
    if (untap) untap();
    if (raf) cancelAnimationFrame(raf);
    if (unlisten) unlisten();
  };
}
