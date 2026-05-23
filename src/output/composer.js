/**
 * Composer — composites N source canvases into ONE offscreen canvas: the
 * "single composed stream" output style (native-output-dev.md §2/§3A).
 *
 * The web output WINDOWS composite for free via the browser's CSS compositor
 * (N <video> layers). Single-stream outputs — the "composed program" preview,
 * the (future) NDI sender, single-texture Syphon/Spout — need ONE finished
 * frame instead. This produces it: layers drawn full-frame (overlay), ordered
 * by zIndex, with per-layer alpha + blend mode — matching the output-window
 * stack exactly.
 *
 * It composites from each source's captureStream → a hidden <video>, NOT a raw
 * drawImage of the (WebGL) source canvas. That sidesteps the WebGL
 * buffer-clear timing trap (a WebGL canvas with preserveDrawingBuffer:false is
 * empty outside its own render tick) and keeps the result untainted.
 *
 * The output `.canvas` is itself captureStream-able (web preview today) and
 * readback-able (the native NDI/Syphon path tomorrow) — same compositor either
 * way.
 */
const FPS = 60;

export class Composer {
  constructor({ width = 1920, height = 1080 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this._layers = [];           // [{ id, video, zIndex, blendMode, getOpacity }]
    this._byCanvas = new Map();  // sourceCanvas → { video, stream }
    this._raf = null;
    // Offscreen host for the source <video>s. NOT display:none — a hidden-by-
    // display video can stop advancing frames in some engines; park it offscreen.
    this._host = document.createElement('div');
    this._host.style.cssText =
      'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;';
    document.body.appendChild(this._host);
  }

  /**
   * @param {Array<{id, canvas, zIndex?, blendMode?, opacity?, getOpacity?}>} layers
   *   getOpacity (optional) is read every frame → live fades (e.g. a clip ending
   *   reveals the layer beneath). Falls back to the static `opacity`.
   */
  setLayers(layers) {
    const keep = new Set();
    const next = [];
    for (const L of layers) {
      if (!L || !L.canvas) continue;
      let entry = this._byCanvas.get(L.canvas);
      if (!entry) {
        const stream = L.canvas.captureStream(FPS);
        const video = document.createElement('video');
        video.autoplay = true; video.muted = true; video.playsInline = true;
        video.srcObject = stream;
        this._host.appendChild(video);
        video.play().catch(() => { /* autoplay-muted allowed */ });
        entry = { video, stream };
        this._byCanvas.set(L.canvas, entry);
      }
      keep.add(L.canvas);
      const stat = L.opacity ?? 1;
      next.push({
        id: L.id,
        video: entry.video,
        zIndex: L.zIndex ?? 0,
        blendMode: L.blendMode || 'normal',
        getOpacity: L.getOpacity || (() => stat),
      });
    }
    // Tear down sources no longer present.
    for (const [canvas, entry] of [...this._byCanvas.entries()]) {
      if (!keep.has(canvas)) {
        try { entry.stream.getTracks().forEach(t => t.stop()); } catch { /* ended */ }
        entry.video.srcObject = null;
        entry.video.remove();
        this._byCanvas.delete(canvas);
      }
    }
    next.sort((a, b) => a.zIndex - b.zIndex);
    this._layers = next;
  }

  start() {
    if (this._raf) return;
    const { ctx, canvas } = this;
    const draw = () => {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const L of this._layers) {
        const a = L.getOpacity();
        if (a <= 0 || L.video.readyState < 2) continue;   // invisible or no frame yet
        ctx.globalAlpha = Math.min(1, a);
        // canvas2D blend names match CSS mix-blend-mode; 'normal' → 'source-over'.
        ctx.globalCompositeOperation = L.blendMode === 'normal' ? 'source-over' : L.blendMode;
        try { ctx.drawImage(L.video, 0, 0, canvas.width, canvas.height); } catch { /* not ready */ }
      }
      this._raf = requestAnimationFrame(draw);
    };
    this._raf = requestAnimationFrame(draw);
  }

  stop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  get running() { return this._raf !== null; }

  destroy() {
    this.stop();
    for (const [, entry] of this._byCanvas) {
      try { entry.stream.getTracks().forEach(t => t.stop()); } catch { /* ended */ }
      entry.video.srcObject = null; entry.video.remove();
    }
    this._byCanvas.clear();
    this._layers = [];
    this._host.remove();
  }
}
