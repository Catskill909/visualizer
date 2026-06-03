/**
 * DiscoCast Visualizer — Entry Point
 * Wires up the VisualizerEngine and ControlPanel
 */
import { VisualizerEngine } from './visualizer.js';
import { ControlPanel } from './controls.js';
import { initAuthGate } from './auth-gate.js';
import { hydratePresets } from './customPresets.js';

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
    // cache must be populated first (see milkdrop-pack-import.dev §0 / Phase 0c).
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
