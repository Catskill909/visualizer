/**
 * OutputManager — discovers displays and opens/closes output windows. Holds
 * several outputs at once, keyed by `outId`: 'main' for the player/editor single
 * mirror, a zone id in the timeline (output-dev.md §4). Each output mirrors one
 * source canvas to one display via the pixel pipe (§5).
 *
 * Web path = window.open positioned via the Window Management API. The Tauri
 * native window (set_position → set_fullscreen) + native pixel pipe are Phase B/C.
 */
import { attachSource, detachSource } from './outputPipe.js';

class OutputManager {
  constructor() {
    this.platform = (typeof window !== 'undefined' && window.__TAURI__) ? 'tauri' : 'web';
    this._outputs = new Map();   // outId → { win, displayId, poll }
    this._onChange = null;
  }

  /**
   * @param {{prompt?:boolean}} opts  prompt=true calls getScreenDetails (needs a
   *   user gesture + grants the window-management permission). prompt=false
   *   returns a single best-effort entry without prompting — safe on init.
   * @returns {Promise<Array<{id,label,x,y,w,h,isPrimary,_screen?}>>}
   */
  async listDisplays({ prompt = false } = {}) {
    if (this.platform === 'tauri') {
      try {
        const { availableMonitors } = window.__TAURI__.window;
        const mons = await availableMonitors();
        return mons.map((m, i) => ({
          id: String(i), label: m.name || `Monitor ${i + 1}`,
          x: m.position.x, y: m.position.y, w: m.size.width, h: m.size.height,
          isPrimary: i === 0,
        }));
      } catch {
        return [this._thisScreen()];
      }
    }
    if (prompt && 'getScreenDetails' in window) {
      try {
        const sd = await window.getScreenDetails();
        return sd.screens.map((s, i) => ({
          id: String(i),
          label: s.label || `Display ${i + 1}`,
          x: s.left, y: s.top, w: s.width, h: s.height,
          isPrimary: !!s.isPrimary, _screen: s,
        }));
      } catch { /* denied / no gesture → fall through */ }
    }
    return [this._thisScreen()];
  }

  _thisScreen() {
    return {
      id: 'current', label: 'This screen',
      x: window.screen?.availLeft || 0, y: window.screen?.availTop || 0,
      w: window.screen?.width || 1920, h: window.screen?.height || 1080,
      isPrimary: true,
    };
  }

  isActive(outId = 'main') {
    const o = this._outputs.get(outId);
    return !!(o && o.win && !o.win.closed);
  }

  /** Live outputs: [{ id, displayId, active }]. */
  getOutputs() {
    return [...this._outputs.entries()].map(([id, o]) => ({
      id, displayId: o.displayId, active: !!(o.win && !o.win.closed),
    }));
  }

  /** opts: { outId='main', display, fullscreen, canvas } — canvas is the source we mirror */
  async openOutput({ outId = 'main', display, fullscreen, canvas }) {
    this.closeOutput(outId);
    if (!canvas) throw new Error('no-source-canvas');
    // Mirror model (output-dev.md §5): start the pixel pipe BEFORE opening the
    // window so the popup can read its stream from its opener on first load.
    attachSource(canvas, outId);
    const fs = fullscreen ? 1 : 0;
    // Spawn a comfortable, moveable preview window — NOT full-monitor, which
    // buries the window edges on a big display. The user fullscreens it when
    // ready (⛶ button), or auto-FS rides the open when fullscreen:true.
    const aspect = (display.w / display.h) || (16 / 9);
    const w = Math.min(960, Math.round(display.w * 0.5));
    const h = Math.round(w / aspect);
    const idx = this._outputs.size;                  // cascade so stacked outputs don't overlap
    const left = Math.round(display.x + (display.w - w) / 2 + idx * 40);
    const top  = Math.round(display.y + (display.h - h) / 2 + idx * 40);
    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top}`;
    // Unique window name per outId so each output is its own popup, never reused.
    const win = window.open(
      `/output.html?out=${encodeURIComponent(outId)}&fs=${fs}`,
      `dc-output-${outId}`,
      features,
    );
    if (!win) { detachSource(outId); throw new Error('popup-blocked'); }
    // Detect the user closing the popout manually.
    const poll = setInterval(() => {
      if (win.closed) this.closeOutput(outId);
    }, 1000);
    this._outputs.set(outId, { win, displayId: display.id, poll });
    this._emitChange();
    return { close: () => this.closeOutput(outId) };
  }

  closeOutput(outId = 'main') {
    const o = this._outputs.get(outId);
    if (!o) return;
    if (o.poll) clearInterval(o.poll);
    detachSource(outId);
    if (o.win && !o.win.closed) { try { o.win.close(); } catch { /* ignore */ } }
    this._outputs.delete(outId);
    this._emitChange();
  }

  closeAll() {
    for (const id of [...this._outputs.keys()]) this.closeOutput(id);
  }

  /** Single callback fired whenever any output opens or closes. */
  onChange(fn) { this._onChange = fn; }
  _emitChange() { if (this._onChange) { try { this._onChange(); } catch { /* ignore */ } } }
}

export const outputManager = new OutputManager();
