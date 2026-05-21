/**
 * OutputManager — discovers displays and opens/closes a single output window.
 * Phase 1 of output-dev.md (§4): single source → one display, for preview /
 * secondary-screen performance in the player and editor.
 *
 * Web path is implemented fully (window.open positioned via the Window
 * Management API). The Tauri native window (set_position → set_fullscreen,
 * output-dev.md §6) is a fast-follow; Phase 1 uses window.open on both.
 */
import { OutputTransport } from './outputTransport.js';

class OutputManager {
  constructor() {
    this.platform = (typeof window !== 'undefined' && window.__TAURI__) ? 'tauri' : 'web';
    this._win = null;
    this._transport = null;
    this._poll = null;
    this._onClose = null;
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

  isActive() { return !!(this._win && !this._win.closed); }

  /** opts: { display, fullscreen, source } */
  async openOutput({ display, fullscreen, source }) {
    this.closeOutput();
    // Phase 1: window.open for both platforms. Native Tauri WebviewWindow is a
    // fast-follow (output-dev.md §6).
    const fs = fullscreen ? 1 : 0;
    const features = `popup=yes,width=${display.w},height=${display.h},left=${display.x},top=${display.y}`;
    const win = window.open(`/output.html?fs=${fs}`, 'dc-output', features);
    if (!win) throw new Error('popup-blocked');
    this._win = win;
    this._transport = new OutputTransport();
    this._transport.start(source);
    // Detect the user closing the popout manually.
    this._poll = setInterval(() => {
      if (this._win && this._win.closed) this.closeOutput();
    }, 1000);
    return { close: () => this.closeOutput() };
  }

  closeOutput() {
    if (this._poll) { clearInterval(this._poll); this._poll = null; }
    if (this._transport) { this._transport.dispose(); this._transport = null; }
    if (this._win && !this._win.closed) { try { this._win.close(); } catch { /* ignore */ } }
    const had = !!this._win;
    this._win = null;
    if (had && this._onClose) this._onClose();
  }

  /** Single callback fired whenever the output closes (manual or programmatic). */
  onClose(fn) { this._onClose = fn; }
}

export const outputManager = new OutputManager();
