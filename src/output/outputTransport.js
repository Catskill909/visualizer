/**
 * OutputTransport — broadcasts the live engine's audio + active preset to an
 * output window. Phase 1 of output-dev.md (Option A, §5): the output window
 * re-renders from these messages, so we only need to ship the time-domain
 * audio bytes every frame and the active preset object whenever it changes.
 *
 * Web path = BroadcastChannel (same-origin opener ↔ popout). A Tauri-events
 * variant is a fast-follow (output-dev.md §6); this class isolates that swap.
 */
const CHANNEL = 'dc-output';

export class OutputTransport {
  constructor() {
    this.bc = new BroadcastChannel(CHANNEL);
    this._source = null;
    this._buf = null;
    this._lastName = null;
    this._raf = 0;
    this._running = false;
    // The output window announces itself when its renderer is ready; resend the
    // current preset so a freshly-opened window isn't stuck on a blank frame.
    this.bc.onmessage = (e) => {
      if (e?.data?.type === 'ready') this._sendPreset(true);
    };
  }

  /** source: { analyser, getName():string, getPreset(name):object } */
  start(source) {
    this._source = source;
    const fft = source.analyser?.fftSize || 1024;
    this._buf = new Uint8Array(fft);
    this._lastName = null;
    this._running = true;
    this._loop();
  }

  _loop() {
    if (!this._running) return;
    const s = this._source;
    const name = s.getName?.() || '';
    if (name && name !== this._lastName) this._sendPreset();
    if (s.analyser) {
      s.analyser.getByteTimeDomainData(this._buf);
      this.bc.postMessage({ type: 'audio', t: this._buf }); // structured-clone copies the bytes
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _sendPreset(force = false) {
    const s = this._source;
    if (!s) return;
    const name = s.getName?.() || '';
    if (!name) return;
    if (!force && name === this._lastName) return;
    const preset = s.getPreset?.(name);
    if (!preset) return;
    let clone;
    try { clone = JSON.parse(JSON.stringify(preset)); } catch { return; } // guaranteed cloneable + matches engine.loadPreset
    this.bc.postMessage({ type: 'preset', name, preset: clone, blend: 1.0 });
    this._lastName = name;
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    try { this.bc.postMessage({ type: 'stop' }); } catch { /* channel may be closed */ }
  }

  dispose() {
    this.stop();
    try { this.bc.close(); } catch { /* already closed */ }
  }
}
