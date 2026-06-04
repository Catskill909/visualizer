/**
 * DiscoCast Visualizer — Entry Point
 * Wires up the VisualizerEngine and ControlPanel
 */
import { VisualizerEngine } from './visualizer.js';
import { ControlPanel } from './controls.js';
import { initAuthGate } from './auth-gate.js';
import { hydratePresets, buildImageWarp } from './customPresets.js';

// Wait for DOM
document.addEventListener('DOMContentLoaded', async () => {
  if (window.__TAURI__) window.__TAURI__.window.getCurrent().show();
  await initAuthGate();
  const canvas = document.getElementById('visualizer-canvas');

  // ── Welcome guide wiring (User Guide button on start screen) ────────
  const btnWelcomeHelp = document.getElementById('btn-welcome-help');
  const welcomeGuide = document.getElementById('welcome-guide');
  
  if (btnWelcomeHelp && welcomeGuide) {
    btnWelcomeHelp.addEventListener('click', () => {
      welcomeGuide.classList.remove('hidden');
    });
  }
  // ──────────────────────────────────────────────────────────────────

  try {
    // Initialize the visualizer engine
    const engine = new VisualizerEngine();
    engine.init(canvas);

    // Initialize the control panel (binds all UI events)
    const controls = new ControlPanel(engine);

    // Phase 0: hydrate the preset cache from IndexedDB BEFORE the first read.
    // refreshCustomPresets() below reads loadAllCustomPresets() synchronously, so the
    // cache must be populated first (see milkdrop-pack-import.md §0 / Phase 0c).
    await hydratePresets();

    // Load custom presets into engine.presets immediately so favorites cycling
    // works from startup without requiring the drawer to be opened first.
    // Re-sync the favorite pool after so custom-preset favorites pass the
    // this.presets[n] check in _cyclePool (ControlPanel syncs before refresh).
    engine.refreshCustomPresets();
    // Register installed community-pack presets (Phase 1) — they behave like bundled presets.
    await engine.loadCommunityPresets();
    controls.syncFavoritePool();

    // Dev-only console hook for the pack engine (no UI yet — Phase 2). Tree-shaken out of
    // production builds. Try: await __dcPacks.smokeFromBundled(__dcPacks.engine)
    if (import.meta.env.DEV) {
      Promise.all([import('./packInstaller.js'), import('./packBrowser.js')]).then(([pi, pb]) => {
        window.__dcPacks = { ...pi, ...pb, engine,
          openBrowser: () => pb.showPackBrowser({ engine, onImportFile: (f) => controls.importCustomPresetsFromFile(f) }) };
        console.log('[dev] window.__dcPacks ready · try: __dcPacks.openBrowser() or await __dcPacks.smokeFromBundled(__dcPacks.engine)');
      });

      // image-texture-dev.md Phase 1 — minimal live wire-up. Melt a user image INTO
      // the current preset's feedback loop so you can tune the look by eye.
      //   await __imgWarp.drive('https://…/pic.jpg', { flow:'liquid', reseed:0.25, audioSource:'bass', audioAmt:0.6 })
      //   __imgWarp.clear()   // restore the current preset
      const IMG_WARP_TEX = 'imgwarp';
      const loadImage = (src) => new Promise((resolve, reject) => {
        // src may be a URL/dataURL string or a File/Blob.
        const url = (src instanceof Blob) ? URL.createObjectURL(src) : src;
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => {
          const dataURL = (typeof src === 'string') ? src : url; // pass URL straight through
          resolve({ data: dataURL, width: im.naturalWidth, height: im.naturalHeight, _objUrl: (src instanceof Blob) ? url : null });
        };
        im.onerror = (e) => reject(new Error('image load failed: ' + (e && e.message || src)));
        im.src = url;
      });
      window.__imgWarp = {
        engine,
        async drive(src, opts = {}) {
          const name = engine.getCurrentPresetName();
          const base = engine.presets[name];
          if (!base) { console.warn('[__imgWarp] no current preset'); return false; }
          const img = await loadImage(src);
          const patched = JSON.parse(JSON.stringify(base));
          patched.warp = buildImageWarp({ imgName: IMG_WARP_TEX, ...opts });
          // Order matters: butterchurn wipes samplers on loadPreset, so bind AFTER load
          // (see visualizer.js loadPreset comment). Static image → one upload persists.
          engine.loadPresetObject(patched, opts.blend ?? 0.5);
          engine.setUserTexture(IMG_WARP_TEX, { data: img.data, width: img.width, height: img.height });
          if (img._objUrl) setTimeout(() => URL.revokeObjectURL(img._objUrl), 4000);
          console.log(`[__imgWarp] driving "${name}" with flow=${opts.flow || 'liquid'} reseed=${opts.reseed ?? 0.2}${opts.audioSource ? ' audio=' + opts.audioSource : ''}`);
          return true;
        },
        clear() {
          const name = engine.getCurrentPresetName();
          if (name) engine.loadPreset(name, 0.5);
          console.log('[__imgWarp] cleared → restored', name);
        },
      };
      console.log("[dev] window.__imgWarp ready · try: await __imgWarp.drive('<image-url>', { flow:'liquid', reseed:0.25, audioSource:'bass', audioAmt:0.6 })");
    }

    // Initial canvas sizing
    engine.setSize(window.innerWidth, window.innerHeight);

    console.log(
      '%c🎨 DiscoCast Visualizer Ready %c— ' + engine.getPresetNames().length + ' presets loaded',
      'color: #00e5ff; font-weight: bold; font-size: 14px;',
      'color: #8888a0; font-size: 12px;'
    );
  } catch (err) {
    console.error('[DiscoCast Visualizer] Failed to initialize:', err);

    // Show the error on the start screen so the user knows what happened
    const startScreen = document.getElementById('start-screen');
    if (startScreen) {
      const hint = startScreen.querySelector('.start-hint');
      if (hint) {
        hint.textContent = '⚠️ Error: ' + err.message + ' — Try refreshing or check the console.';
        hint.style.color = '#ff5252';
      }
    }
  }
});
