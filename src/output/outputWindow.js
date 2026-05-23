/**
 * outputWindow.js — runs INSIDE output.html on the second display.
 *
 * Mirror model (output-dev.md §5): this window renders NOTHING. It is a dumb
 * display of the operator canvases' pixels. The opener captured each source with
 * captureStream() and stashed a LAYER LIST; we read it through the pixel pipe and
 * show one full-frame <video> per layer, overlaid and composited by the layer's
 * zIndex/opacity/blendMode (region is an operator-screen layout concern, not an
 * output one). Same pixels → perfect sync, no audio, no engine.
 *
 * One layer = player/editor single mirror. Many layers = timeline stacking (A3).
 */
import { getLayers } from './outputPipe.js';

const outId    = new URLSearchParams(location.search).get('out') || 'main';
const stage    = document.getElementById('out-stage');
const fsBtn    = document.getElementById('out-fs');
const statusEl = document.getElementById('out-status');

const videos = new Map();   // layer id → <video>

function makeVideo() {
  const v = document.createElement('video');
  v.className = 'out-layer';
  v.autoplay = true; v.muted = true; v.playsInline = true;
  stage.appendChild(v);
  return v;
}

function applyStyle(v, L, instant) {
  // Position/size come from CSS (full-frame). zIndex/blend are cheap, always set.
  v.style.zIndex = String(L.zIndex ?? 0);
  v.style.mixBlendMode = L.blendMode || 'normal';

  // Opacity is the timeline-driven part. A new layer snaps; an existing one
  // crossfades over transitionMs (the operator cover's fade) so a clip ending
  // reveals the layer below. Skip if unchanged so another track's event (which
  // rebuilds the whole list) can't clobber this layer's in-flight fade.
  const target = L.opacity ?? 1;
  if (!instant && v._op === target) return;
  const ms = instant ? 0 : (L.transitionMs || 0);
  v.style.transition = ms > 0 ? `opacity ${ms}ms linear` : 'none';
  v.style.opacity = String(target);
  v._op = target;
}

function reconcile() {
  const layers = getLayers(outId);
  // null = opener/stream gone (real loss of signal). [] = connected but every
  // routed track is currently in a gap → black stage, not an error.
  if (!layers) {
    for (const v of videos.values()) { v.srcObject = null; v.remove(); }
    videos.clear();
    if (statusEl) statusEl.textContent = '⚠ No signal — keep the main DiscoCast window open';
    return false;
  }

  const seen = new Set();
  for (const L of layers) {
    seen.add(L.id);
    let v = videos.get(L.id);
    const isNew = !v;
    if (isNew) { v = makeVideo(); videos.set(L.id, v); }
    if (v.srcObject !== L.stream) {
      v.srcObject = L.stream;
      v.play().catch(() => { /* autoplay-muted is allowed; ignore transient */ });
    }
    applyStyle(v, L, isNew);
  }
  // Drop videos for layers that are gone (zone unrouted).
  for (const [id, v] of [...videos.entries()]) {
    if (!seen.has(id)) { v.srcObject = null; v.remove(); videos.delete(id); }
  }

  if (statusEl) statusEl.textContent = '';
  return true;
}

// The layer list is stashed before window.open, so it's normally ready
// immediately. Retry briefly in case of a race, then keep a slow watch so the
// stack reflects live routing/opacity/blend changes and the opener closing.
if (!reconcile()) {
  let tries = 0;
  const t = setInterval(() => { if (reconcile() || ++tries > 40) clearInterval(t); }, 100);
}
setInterval(reconcile, 500);

async function goFullscreen() {
  let opts;
  try {
    if ('getScreenDetails' in window) {
      const sd = await window.getScreenDetails();
      opts = { screen: sd.currentScreen };
    }
  } catch { opts = undefined; }
  try { await document.documentElement.requestFullscreen(opts); } catch { /* needs a gesture */ }
}

fsBtn?.addEventListener('click', goFullscreen);

// Best-effort auto-fullscreen if the brain requested it (rides the window.open activation).
if (new URLSearchParams(location.search).get('fs') === '1') {
  setTimeout(goFullscreen, 120);
}

// Auto-hide chrome + cursor after idle, like the main projection view.
let hideT;
function showChrome() {
  document.body.classList.remove('idle');
  clearTimeout(hideT);
  hideT = setTimeout(() => document.body.classList.add('idle'), 2500);
}
window.addEventListener('mousemove', showChrome);
showChrome();
