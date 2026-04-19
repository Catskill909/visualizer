/**
 * MilkScreen — Entry Point
 * Wires up the VisualizerEngine and ControlPanel
 */
import { VisualizerEngine } from './visualizer.js';
import { ControlPanel } from './controls.js';

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('visualizer-canvas');

  try {
    // Initialize the visualizer engine
    const engine = new VisualizerEngine();
    engine.init(canvas);

    // Initialize the control panel (binds all UI events)
    const controls = new ControlPanel(engine);

    // Initial canvas sizing
    engine.setSize(window.innerWidth, window.innerHeight);

    // Expose to console for debugging
    window.__milkscreen = { engine, controls };

    console.log(
      '%c🎨 MilkScreen Ready %c— ' + engine.getPresetNames().length + ' presets loaded',
      'color: #00e5ff; font-weight: bold; font-size: 14px;',
      'color: #8888a0; font-size: 12px;'
    );
  } catch (err) {
    console.error('[MilkScreen] Failed to initialize:', err);

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
