/**
 * outputWindow.js — runs INSIDE output.html on the second display.
 *
 * Mirror model (output-dev.md §5): this window renders NOTHING. It is a dumb
 * display of the operator canvas's pixels. The opener captured the canvas with
 * captureStream() and stashed the live MediaStream; we read it through the pixel
 * pipe and show it in a <video>. Same pixels → perfect sync, no audio, no engine.
 */
import { receiveStream } from './outputPipe.js';

const outId    = new URLSearchParams(location.search).get('out') || 'main';
const video    = document.getElementById('out-video');
const fsBtn    = document.getElementById('out-fs');
const statusEl = document.getElementById('out-status');

function attach() {
  const stream = receiveStream(outId);
  if (stream && video.srcObject !== stream) {
    video.srcObject = stream;
    video.play().catch(() => { /* autoplay-muted is allowed; ignore transient */ });
  }
  if (statusEl) statusEl.textContent = stream ? '' : '⚠ No signal — keep the main DiscoCast window open';
  return !!stream;
}

// The stream is stashed before window.open, so it's normally ready immediately.
// Retry briefly in case of a race, then keep a slow watch so the status reflects
// the opener closing the stream.
if (!attach()) {
  let tries = 0;
  const t = setInterval(() => { if (attach() || ++tries > 40) clearInterval(t); }, 100);
}
setInterval(attach, 1000);

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
