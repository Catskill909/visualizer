/**
 * outputUI — the shared "Send to display" section in the player's Output popover
 * and the editor's Output panel (output-dev.md §7.1). One source ('main' = the
 * live engine) sent to one chosen display: a projector / second screen.
 *
 * Markup contract: `root` contains an empty `[data-output-ui]` element; this
 * module renders the whole section into it (identical in player + editor):
 *   - one button per connected display (selected one highlighted) + ↻ refresh
 *   - a Fullscreen switch
 *   - one main button: "▶ Send to <display>" / "■ Stop output" (live dot)
 *   - a one-line hint + a collapsible Tips block (platform-specific)
 * The last chosen display and the Fullscreen choice are remembered.
 */
import { outputManager } from './outputManager.js';
import { IS_DESKTOP } from '../platform.js';
import './output-ui.css';

const PREF_KEY = 'dc_output_prefs';

function loadPrefs() {
  try { return { fullscreen: true, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
  catch { return { fullscreen: true }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// "This screen" for the one the app is on; otherwise the OS label or "Display N".
function displayName(d) {
  if (d.id === 'current' || d.isPrimary) return 'This screen';
  return d.label || `Display ${Number(d.id) + 1}`;
}
const sameDisplay = (a, b) => a && b && a.w === b.w && a.h === b.h && a.x === b.x && a.y === b.y;

export function initOutputUI({ engine, root }) {
  const host = root?.querySelector('[data-output-ui]');
  if (!host) return;

  host.classList.add('out-ui');
  host.innerHTML = `
    <div class="out-ui-head">
      <span class="out-ui-title">Send to display</span>
      <button type="button" class="out-ui-refresh" data-act="refresh" title="Look for connected screens">↻ Refresh</button>
    </div>
    <div class="out-ui-displays" data-el="list"></div>
    <p class="out-ui-note" data-el="note" hidden></p>
    <label class="out-ui-fs">
      <span>Fullscreen</span>
      <input type="checkbox" data-el="fs" class="out-ui-switch" />
    </label>
    <button type="button" class="out-ui-send" data-act="send">
      <span class="out-ui-live"></span><span data-el="sendLabel">▶ Send</span>
    </button>
    <p class="out-ui-error" data-el="error" hidden></p>
    <p class="out-ui-hint">Visuals only, on the chosen screen. Your controls stay here.</p>
    <details class="out-ui-tips">
      <summary>Tips</summary>
      ${IS_DESKTOP ? `
      <p>In the output window: <kbd>F</kbd> fullscreen · <kbd>D</kbd> stats (fps / delay).</p>
      <p>Projector not listed? Connect it with a cable (not AirPlay) and set it to <em>Extend</em>, then ↻ Refresh.</p>
      <p>Fallback: drag this window onto the projector, press <kbd>F</kbd>, then <kbd>H</kbd> to hide the controls.</p>` : `
      <p>Keep this window visible; if it's hidden the output stops updating.</p>
      <p>↻ Refresh asks the browser for permission to see your other screens.</p>
      <p>In the output window: ⛶ or <kbd>F</kbd> = fullscreen.</p>`}
    </details>`;

  const el = (k) => host.querySelector(`[data-el="${k}"]`);
  const listEl = el('list');
  const noteEl = el('note');
  const fsChk = el('fs');
  const sendBtn = host.querySelector('[data-act="send"]');
  const sendLabel = el('sendLabel');
  const errEl = el('error');

  const prefs = loadPrefs();
  fsChk.checked = !!prefs.fullscreen;
  fsChk.addEventListener('change', () => { prefs.fullscreen = fsChk.checked; savePrefs(prefs); });

  let displays = [];
  let selected = null;

  const setError = (msg) => { errEl.textContent = msg || ''; errEl.hidden = !msg; };

  const chooseDefault = () => {
    // Keep the current choice if it still exists; else the remembered one; else
    // the first screen that isn't this one (usually the projector); else this one.
    if (selected && displays.some((d) => sameDisplay(d, selected))) {
      selected = displays.find((d) => sameDisplay(d, selected));
      return;
    }
    selected = displays.find((d) => sameDisplay(d, prefs.display))
      || displays.find((d) => !(d.id === 'current' || d.isPrimary))
      || displays[0] || null;
  };

  const sync = () => {
    const active = outputManager.isActive();
    sendBtn.classList.toggle('is-active', active);
    if (active) sendLabel.textContent = '■ Stop output';
    else if (!selected) sendLabel.textContent = '▶ Send';
    else if (displayName(selected) === 'This screen') sendLabel.textContent = '▶ Open output window here';
    else sendLabel.textContent = `▶ Send to ${displayName(selected)}`;
  };

  const render = () => {
    listEl.innerHTML = '';
    for (const d of displays) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'out-ui-display' + (sameDisplay(d, selected) ? ' is-selected' : '');
      const here = displayName(d) === 'This screen';
      b.innerHTML = `
        <span class="out-ui-display-icon">${here ? '🖥' : '📽'}</span>
        <span class="out-ui-display-text">
          <span class="out-ui-display-name"></span>
          <span class="out-ui-display-sub">${d.w}×${d.h}${here ? ' · where the app is' : ''}</span>
        </span>
        <span class="out-ui-display-check">✓</span>`;
      b.querySelector('.out-ui-display-name').textContent = displayName(d);
      b.addEventListener('click', () => {
        selected = d;
        prefs.display = { x: d.x, y: d.y, w: d.w, h: d.h };
        savePrefs(prefs);
        render();
      });
      listEl.appendChild(b);
    }
    const onlyHere = displays.length <= 1;
    noteEl.hidden = !onlyHere;
    noteEl.textContent = IS_DESKTOP
      ? 'Only this screen is connected. Plug in a projector with a cable, set it to Extend, then ↻ Refresh.'
      : 'Only this screen is known. Press ↻ Refresh to look for other screens.';
    sync();
  };

  // prompt=false on init (no permission popup on web); prompt=true on ↻ (a user gesture).
  const refresh = async (prompt = false) => {
    displays = await outputManager.listDisplays({ prompt });
    chooseDefault();
    render();
  };

  host.querySelector('[data-act="refresh"]').addEventListener('click', () => refresh(true));

  sendBtn.addEventListener('click', async () => {
    if (outputManager.isActive()) { outputManager.closeOutput(); sync(); return; }
    setError('');
    if (displays.length <= 1) await refresh(true);   // user gesture: allowed to ask on web
    if (!selected) return;
    const canvas = engine.canvas;
    if (!canvas) { setError('The visualizer is not ready yet.'); return; }
    // tap = copy frames right after each render (desktop pipe needs it for WebGL).
    const tap = typeof engine.addFrameTap === 'function' ? (fn) => engine.addFrameTap(fn) : undefined;
    try {
      await outputManager.openOutput({ display: selected, fullscreen: fsChk.checked, canvas, tap });
    } catch (e) {
      if (e.message === 'popup-blocked') setError('Allow pop-ups for this site, then try again.');
      else { console.warn('[output] open failed', e); setError('Could not open the output: ' + (e?.message || e)); }
    }
    sync();
  });

  outputManager.onChange(sync);
  refresh(false);
}
