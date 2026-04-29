/**
 * DiscoCast Visualizer — Entry Point
 * Wires up the VisualizerEngine and ControlPanel
 */
import { VisualizerEngine } from './visualizer.js';
import { ControlPanel } from './controls.js';
import { initAuthGate } from './auth-gate.js';

// Wait for DOM
document.addEventListener('DOMContentLoaded', async () => {
  await initAuthGate();
  const canvas = document.getElementById('visualizer-canvas');

  // ── Help modal wiring ──────────────────────────────────────────────
  const helpModal    = document.getElementById('help-modal');
  const helpClose    = document.getElementById('help-modal-close');
  const helpSearch   = document.getElementById('hm-search');
  const helpResults  = document.getElementById('hm-search-results');
  const helpNavTree  = document.getElementById('hm-nav-tree');
  const helpNavLinks = document.querySelectorAll('.help-nav-link');

  function closeHelp() { if (helpModal) helpModal.hidden = true; }

  helpClose?.addEventListener('click', closeHelp);
  helpModal?.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && helpModal && !helpModal.hidden) closeHelp();
  });

  function scrollToHmSection(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    helpNavLinks.forEach(l => l.classList.remove('active'));
    document.querySelector(`.help-nav-link[href="#${id}"]`)?.classList.add('active');
  }

  helpNavLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      scrollToHmSection(link.getAttribute('href').slice(1));
    });
  });

  const searchIndex = [];
  document.querySelectorAll('.hm-section').forEach(sec => {
    const h = sec.querySelector('h2');
    if (h) searchIndex.push({ id: sec.id, title: h.textContent.trim(), text: sec.innerText.toLowerCase() });
  });

  helpSearch?.addEventListener('input', () => {
    const q = helpSearch.value.trim().toLowerCase();
    if (!q) { helpResults.style.display = 'none'; helpNavTree.style.display = ''; return; }
    const hits = searchIndex.filter(s => s.text.includes(q) || s.title.toLowerCase().includes(q));
    helpNavTree.style.display = 'none';
    helpResults.style.display = '';
    if (!hits.length) { helpResults.innerHTML = `<div class="hm-no-results">No results for "${q}"</div>`; return; }
    helpResults.innerHTML = hits.map(h => {
      const hl = h.title.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>');
      return `<a class="hm-search-result" data-id="${h.id}">${hl}</a>`;
    }).join('');
    helpResults.querySelectorAll('.hm-search-result').forEach(r => {
      r.addEventListener('click', () => {
        scrollToHmSection(r.dataset.id);
        helpSearch.value = '';
        helpResults.style.display = 'none';
        helpNavTree.style.display = '';
      });
    });
  });
  // ──────────────────────────────────────────────────────────────────

  try {
    // Initialize the visualizer engine
    const engine = new VisualizerEngine();
    engine.init(canvas);

    // Initialize the control panel (binds all UI events)
    const controls = new ControlPanel(engine);

    // Load custom presets into engine.presets immediately so favorites cycling
    // works from startup without requiring the drawer to be opened first.
    // Re-sync the favorite pool after so custom-preset favorites pass the
    // this.presets[n] check in _cyclePool (ControlPanel syncs before refresh).
    engine.refreshCustomPresets();
    controls.syncFavoritePool();

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
