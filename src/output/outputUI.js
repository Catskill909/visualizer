/**
 * outputUI — wires the shared "Send to display" section that lives inside the
 * Output panel of the player and the editor. Phase 1 of output-dev.md (§7.1):
 * a single source ('main' = the one live engine) sent to one chosen display
 * for preview / secondary-screen performance.
 *
 * Markup contract (must exist inside `root`):
 *   #output-display          <select>  display picker
 *   #btn-output-detect       <button>  re-enumerate displays (user gesture)
 *   #output-fullscreen-toggle <input type=checkbox>
 *   #btn-output-open         <button>  open / close the output window
 */
import { outputManager } from './outputManager.js';

export function initOutputUI({ engine, root }) {
  if (!root) return;
  const sel     = root.querySelector('#output-display');
  const detect  = root.querySelector('#btn-output-detect');
  const openBtn = root.querySelector('#btn-output-open');
  const fsChk   = root.querySelector('#output-fullscreen-toggle');
  if (!sel || !openBtn) return;

  let displays = [];

  const syncBtn = () => {
    openBtn.textContent = outputManager.isActive() ? 'Close output window' : 'Open output window';
    openBtn.classList.toggle('is-active', outputManager.isActive());
  };

  const renderOptions = () => {
    const prev = sel.value;
    sel.innerHTML = '';
    for (const d of displays) {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = `${d.label} — ${d.w}×${d.h}${d.isPrimary ? ' (primary)' : ''}`;
      sel.appendChild(o);
    }
    if (prev && displays.some(d => d.id === prev)) sel.value = prev;
  };

  // prompt=false on init (no permission popup); prompt=true on the ↻ gesture.
  const refresh = async (prompt = false) => {
    displays = await outputManager.listDisplays({ prompt });
    renderOptions();
  };

  detect?.addEventListener('click', () => refresh(true));

  openBtn.addEventListener('click', async () => {
    if (outputManager.isActive()) { outputManager.closeOutput(); syncBtn(); return; }
    // The click is a user gesture → safe to prompt for the full display list.
    if (displays.length <= 1) await refresh(true);
    const display = displays.find(d => d.id === sel.value) || displays[0];
    if (!display) return;
    try {
      const canvas = engine.canvas; // the live source we mirror
      if (!canvas) { console.warn('[output] engine has no canvas'); return; }
      await outputManager.openOutput({ display, fullscreen: !!fsChk?.checked, canvas });
      syncBtn();
    } catch (e) {
      if (e.message === 'popup-blocked') {
        alert('Allow pop-ups for this site, then click "Open output window" again.');
      } else {
        console.warn('[output] open failed', e);
      }
    }
  });

  outputManager.onChange(syncBtn);

  refresh(false);  // permission-free initial list
  syncBtn();
}
