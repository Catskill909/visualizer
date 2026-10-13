/**
 * nativeOutputWindow — the DESKTOP output window (output-dev.md Phase B2).
 * Runs inside output.html when it's a Rust-created Tauri window.
 *
 * Renders NOTHING (no engine — §13). It pulls the newest copied frame from Rust
 * over `dcframe://` (sent by nativeFeed in the main window) and draws it,
 * letterboxed, full-window.
 *
 * Keys: F / ⛶ = fullscreen toggle · Esc = leave fullscreen · D = test readout
 * (delay / fps / dropped frames + live feed settings).
 */

const BASE = navigator.userAgent.includes('Windows') ? 'https://dcframe.localhost/' : 'dcframe://localhost/';
const SETTINGS_KEY = 'dc_output_feed';
const HUD_KEY = 'dc_output_hud';

export function run() {
  const tauri = window.__TAURI__;
  const stage = document.getElementById('out-stage');
  const fsBtn = document.getElementById('out-fs');
  const statusEl = document.getElementById('out-status');
  if (stage) stage.style.display = 'none';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;background:#000;';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  let seq = 0;
  let inflight = false;
  let lastBitmap = null;
  let lastFrameWall = 0;
  let errorMsg = '';

  // Stats over a rolling 2 s window.
  const st = { drawn: [], ages: [], encs: [], dropped: 0, bytes: 0, w: 0, h: 0 };

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; draw(); }
  }

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!lastBitmap) return;
    const s = Math.min(canvas.width / lastBitmap.width, canvas.height / lastBitmap.height);
    const w = lastBitmap.width * s, h = lastBitmap.height * s;
    ctx.drawImage(lastBitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  async function pull() {
    inflight = true;
    try {
      const r = await fetch(`${BASE}latest?since=${seq}`, { cache: 'no-store' });
      if (r.status === 200) {
        const nseq = Number(r.headers.get('x-seq')) || seq + 1;
        const ts = Number(r.headers.get('x-ts')) || Date.now();
        const enc = Number(r.headers.get('x-enc')) || 0;
        const blob = await r.blob();
        const bmp = await createImageBitmap(blob);
        if (seq && nseq > seq + 1) st.dropped += nseq - seq - 1;
        seq = nseq;
        if (lastBitmap) lastBitmap.close?.();
        lastBitmap = bmp;
        draw();
        const now = Date.now();
        lastFrameWall = now;
        st.drawn.push(now); st.ages.push(now - ts); st.encs.push(enc);
        st.bytes = blob.size; st.w = bmp.width; st.h = bmp.height;
      }
    } catch (e) {
      errorMsg = 'Frame fetch failed: ' + (e?.message || e);
    } finally {
      inflight = false;
    }
  }

  function tick() {
    if (!inflight) pull();
    requestAnimationFrame(tick);
  }

  // ── Status / no-signal ────────────────────────────────────────────────────
  setInterval(() => {
    if (!statusEl) return;
    if (errorMsg) statusEl.textContent = '⚠ ' + errorMsg;
    else if (!lastFrameWall || Date.now() - lastFrameWall > 1500) {
      statusEl.textContent = '⚠ No signal: keep the main DiscoCast window open and visible';
    } else statusEl.textContent = '';
  }, 500);
  tauri.event?.listen('dc-output-error', (ev) => { errorMsg = String(ev.payload || 'error'); }).catch(() => {});

  // ── Fullscreen (Rust command acts on THIS window) ─────────────────────────
  const toggleFs = () => tauri.invoke('toggle_fullscreen').catch(() => {});
  fsBtn?.addEventListener('click', toggleFs);
  window.addEventListener('keydown', async (e) => {
    if (e.key === 'f' || e.key === 'F') toggleFs();
    else if (e.key === 'Escape') {
      try { if (await tauri.invoke('get_fullscreen')) toggleFs(); } catch { /* ignore */ }
    } else if (e.key === 'd' || e.key === 'D') {
      hud.hidden = !hud.hidden;
      try { localStorage.setItem(HUD_KEY, hud.hidden ? '0' : '1'); } catch { /* ignore */ }
    }
  });

  // Auto-hide chrome + cursor after idle.
  let hideT;
  const showChrome = () => {
    document.body.classList.remove('idle');
    clearTimeout(hideT);
    hideT = setTimeout(() => document.body.classList.add('idle'), 2500);
  };
  window.addEventListener('mousemove', showChrome);
  showChrome();

  // ── Test readout (D) ──────────────────────────────────────────────────────
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:3;background:rgba(10,10,14,.82);color:#e8e8ec;' +
    'font:12px/1.5 ui-monospace,Menlo,monospace;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);min-width:250px;';
  let hudPref = null;
  try { hudPref = localStorage.getItem(HUD_KEY); } catch { /* ignore */ }
  hud.hidden = hudPref !== '1';   // hidden by default; D toggles (and is remembered)
  const stats = document.createElement('div');
  hud.appendChild(stats);
  const opts = document.createElement('div');
  opts.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:4px;';
  hud.appendChild(opts);
  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:6px;opacity:.55;';
  hint.textContent = 'D hides this · F fullscreen';
  hud.appendChild(hint);
  document.body.appendChild(hud);

  const readSettings = () => {
    try { return { fps: 30, maxW: 1920, quality: 0.85, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { fps: 30, maxW: 1920, quality: 0.85 }; }
  };
  function buildOpts() {
    const cur = readSettings();
    opts.innerHTML = '';
    const row = (label, key, values, fmt) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:4px;align-items:center;';
      const l = document.createElement('span'); l.textContent = label; l.style.minWidth = '62px'; r.appendChild(l);
      for (const v of values) {
        const b = document.createElement('button');
        b.textContent = fmt(v);
        const on = cur[key] === v;
        b.style.cssText = `font:11px ui-monospace,Menlo,monospace;padding:2px 6px;border-radius:4px;cursor:pointer;` +
          `border:1px solid rgba(255,255,255,${on ? '.7' : '.2'});background:${on ? 'rgba(255,255,255,.18)' : 'transparent'};color:#e8e8ec;`;
        b.onclick = () => {
          const next = { ...readSettings(), [key]: v };
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
          tauri.event?.emit('dc-output-settings', { [key]: v });
          buildOpts();
        };
        r.appendChild(b);
      }
      opts.appendChild(r);
    };
    row('size', 'maxW', [960, 1280, 1920], (v) => ({ 960: '540p', 1280: '720p', 1920: '1080p' }[v]));
    row('fps', 'fps', [30, 60], (v) => String(v));
    row('quality', 'quality', [0.7, 0.85, 0.95], (v) => String(v));
  }
  buildOpts();

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  setInterval(() => {
    const cut = Date.now() - 2000;
    while (st.drawn.length && st.drawn[0] < cut) { st.drawn.shift(); st.ages.shift(); st.encs.shift(); }
    const fps = st.drawn.length / 2;
    const ageAvg = avg(st.ages), ageMax = st.ages.length ? Math.max(...st.ages) : 0;
    stats.innerHTML =
      `<b>Output feed</b><br>` +
      `fps        ${fps.toFixed(1)}<br>` +
      `delay      ${ageAvg.toFixed(0)} ms avg · ${ageMax.toFixed(0)} max<br>` +
      `encode     ${avg(st.encs).toFixed(1)} ms<br>` +
      `dropped    ${st.dropped}<br>` +
      `frame      ${st.w}×${st.h} · ${(st.bytes / 1024).toFixed(0)} KB`;
    // Shared for diagnostics (main window / test harness can listen).
    tauri.event?.emit('dc-output-stats', { fps, ageAvg, ageMax, enc: avg(st.encs), dropped: st.dropped, w: st.w, h: st.h, kb: st.bytes / 1024 });
  }, 1000);

  window.addEventListener('resize', fit);
  fit();
  requestAnimationFrame(tick);
}
