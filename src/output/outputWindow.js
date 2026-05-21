/**
 * outputWindow.js — runs INSIDE output.html on the second display.
 *
 * It owns its own Butterchurn visualizer but takes NO audio of its own: the
 * brain (player/editor) broadcasts the active preset + per-frame time-domain
 * audio bytes over BroadcastChannel, and we feed those straight into
 * render({ audioLevels }) — the stock injected-audio path confirmed in
 * output-dev.md §5. This keeps both windows in lockstep with one audio source.
 */
import butterchurnImport from '../vendor/butterchurn.js';

// The vendored engine is a UMD bundle re-exported as default; unwrap defensively.
function resolveBC(mod) {
  if (mod && typeof mod.createVisualizer === 'function') return mod;
  if (mod?.default && typeof mod.default.createVisualizer === 'function') return mod.default;
  if (mod?.default?.default && typeof mod.default.default.createVisualizer === 'function') return mod.default.default;
  return mod;
}

const canvas = document.getElementById('out-canvas');
const fsBtn  = document.getElementById('out-fs');
const statusEl = document.getElementById('out-status');
const meterEl   = document.getElementById('out-meter');
const meterFill = meterEl?.querySelector('i');

let _curPreset = '';
let _lastAudioTs = 0;   // when we last received audio from the main window
let _level = 0;         // smoothed audio amplitude 0..1 (for the meter)

const AC = window.AudioContext || window.webkitAudioContext;
const audioContext = new AC();          // needed by createVisualizer; never started
const bcLib = resolveBC(butterchurnImport);

const FFT = 1024;
const audioLevels = {
  timeByteArray:  new Uint8Array(FFT).fill(128),  // 128 = silence (centre of unsigned byte)
  timeByteArrayL: new Uint8Array(FFT).fill(128),
  timeByteArrayR: new Uint8Array(FFT).fill(128),
};

let viz = null;

function fit() {
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w; canvas.height = h;
  if (viz) viz.setRendererSize(w, h);
}

function loop() {
  if (viz) {
    try { viz.render({ audioLevels }); } catch { /* transient mid-load */ }
  }
  // Live audio meter + stale-signal warning (peak deviation from silence=128).
  const a = audioLevels.timeByteArray;
  let peak = 0;
  for (let i = 0; i < a.length; i += 8) { const d = Math.abs(a[i] - 128); if (d > peak) peak = d; }
  _level += (peak / 128 - _level) * 0.3;
  const stale = performance.now() - _lastAudioTs > 1200;
  if (meterFill) meterFill.style.width = `${Math.min(100, Math.round(_level * 160))}%`;
  if (meterEl) meterEl.classList.toggle('stale', stale);
  if (statusEl) {
    statusEl.textContent = stale
      ? '⚠ No audio — keep the main DiscoCast window visible'
      : (_curPreset || 'Receiving…');
  }
  requestAnimationFrame(loop);
}

function init() {
  fit();
  viz = bcLib.createVisualizer(audioContext, canvas, {
    width: canvas.width, height: canvas.height, pixelRatio: window.devicePixelRatio || 1,
  });
  // Intentionally NO connectAudio() — audio arrives via render({ audioLevels }).
  requestAnimationFrame(loop);
}

const bc = new BroadcastChannel('dc-output');
bc.onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  if (m.type === 'preset' && m.preset && viz) {
    try { viz.loadPreset(m.preset, m.blend ?? 1.0); } catch (err) { console.warn('[output] loadPreset', err); }
    _curPreset = m.name || '';
  } else if (m.type === 'audio' && m.t) {
    audioLevels.timeByteArray.set(m.t);
    audioLevels.timeByteArrayL.set(m.t);
    audioLevels.timeByteArrayR.set(m.t);
    _lastAudioTs = performance.now();
  }
  // m.type === 'stop' → brain stopped streaming; hold the last frame.
};

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
window.addEventListener('resize', fit);

init();
bc.postMessage({ type: 'ready' });   // ask the brain to (re)send the current preset

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
