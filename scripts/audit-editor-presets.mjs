// Differential audit: render every bundled preset BOTH ways — the editor path
// (loadBundledPreset reconstruction) and the player path (raw object) — under
// identical pulsed-audio conditions, and flag presets that are black/dim in the
// EDITOR but fine in the PLAYER (the "renders in player, BLACK in editor" class).
//
// Optimization: render editor first; only render the player path (the expensive
// confirm) when the editor looks black/dim. Most presets render fine → one render each.
//
// Requires the dev server running (npm run dev). Run: npm run audit:editor-presets
// (or: node scripts/audit-editor-presets.mjs). LIMIT=N env var audits a small slice
// (plus the two historical regression cases) for a quick smoke check.
//
// CAVEATS when reading results (see milkdrop-control-dev.md "Library-wide audit"):
//  - Animation-timing false positives: a single snapshot can catch a sine-animated
//    preset at a dark instant. High-confidence bugs = editor≈0% while player 50–100%.
//  - The "both-dark" bucket is INCONCLUSIVE (synthetic audio may be too weak), not "fine".
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'scripts/audit-editor-presets-results.json';
const EDITOR_PASS = 3;    // editor nonblack% >= this → PASS, skip player render
const PLAYER_OK   = 8;    // player nonblack% >= this → player clearly renders
const GAP         = 6;    // player - editor >= this → real divergence (editor broken)

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('  ‼ pageerror:', e.message));

await page.goto('http://localhost:5173/editor.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start-no-audio', { timeout: 15000 });
await page.click('#start-no-audio');
await page.waitForFunction(() => !!(window.__editorInspector && window.__editorInspector.engine), null, { timeout: 20000 });

// Expose the audit primitives in-page, set up pulsed audio once.
await page.evaluate(async () => {
  const insp = window.__editorInspector, engine = insp.engine;
  const ac = engine.audioContext; if (ac.state === 'suspended') await ac.resume();
  const o = ac.createOscillator(); o.frequency.value = 70; const g = ac.createGain(); g.gain.value = 0;
  o.connect(g); g.connect(engine.visualizerGainNode); o.start();
  setInterval(() => { g.gain.setValueAtTime(0.9, ac.currentTime); g.gain.setTargetAtTime(0, ac.currentTime + 0.05, 0.08); }, 400);
  const o2 = ac.createOscillator(); o2.frequency.value = 1500; const g2 = ac.createGain(); g2.gain.value = 0.3;
  o2.connect(g2); g2.connect(engine.visualizerGainNode); o2.start();
  const o3 = ac.createOscillator(); o3.frequency.value = 7000; const g3 = ac.createGain(); g3.gain.value = 0.2;
  o3.connect(g3); g3.connect(engine.visualizerGainNode); o3.start();
  engine.visualizerGainNode.gain.value = 1.0;

  window.__audit = {
    names: () => Object.keys(engine.presets).filter(n => !n.startsWith('custom:') && !n.startsWith('community:')),
    nonblack: async (ms) => {
      engine.clearFeedbackBuffer && engine.clearFeedbackBuffer();
      await new Promise(r => setTimeout(r, ms));
      const u = await engine.captureNextFrame();
      if (!u) return -1;
      const img = new Image(); await new Promise(res => { img.onload = res; img.src = u; });
      const c = document.createElement('canvas'); c.width = 48; c.height = 48;
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, 48, 48);
      const d = cx.getImageData(0, 0, 48, 48).data; let nb = 0;
      for (let i = 0; i < d.length; i += 4) { if ((d[i]+d[i+1]+d[i+2])/3 > 8) nb++; }
      return +(nb / (d.length/4) * 100).toFixed(1);
    },
    renderEditor: async (name, ms) => { window.__editorInspector.loadBundledPreset(name); return window.__audit.nonblack(ms); },
    renderPlayer: async (name, ms) => { engine.loadPresetObject(JSON.parse(JSON.stringify(engine.presets[name])), 0); return window.__audit.nonblack(ms); },
  };
});

// warm the audio analysers
await page.evaluate(() => new Promise(r => setTimeout(r, 1500)));

let names = await page.evaluate(() => window.__audit.names());
const LIMIT = parseInt(process.env.LIMIT || '0', 10);
if (LIMIT > 0) {
  // keep our two known cases in the slice for validation
  const must = ['Rovastar - Space _Twisted Dimension Mix_', 'phat_Phenethylamine'].filter(n => names.includes(n));
  names = [...must, ...names.filter(n => !must.includes(n)).slice(0, LIMIT)];
}
console.log(`\nDifferential audit — ${names.length} bundled presets\n`);

const results = { generatedAt: new Date().toISOString(), total: names.length, bug: [], bothDark: [], borderline: [], error: [], pass: 0 };
let i = 0;
for (const name of names) {
  i++;
  let edNb = -2, plNb = null, verdict = 'pass';
  try {
    edNb = await page.evaluate(([n, ms]) => window.__audit.renderEditor(n, ms), [name, 1300]);
    if (edNb >= EDITOR_PASS) {
      verdict = 'pass'; results.pass++;
    } else {
      plNb = await page.evaluate(([n, ms]) => window.__audit.renderPlayer(n, ms), [name, 1600]);
      if (plNb >= PLAYER_OK && (plNb - Math.max(edNb,0)) >= GAP) {
        verdict = 'BUG'; results.bug.push({ name, editor: edNb, player: plNb });
      } else if (plNb < EDITOR_PASS && edNb < EDITOR_PASS) {
        verdict = 'both-dark'; results.bothDark.push({ name, editor: edNb, player: plNb });
      } else {
        verdict = 'borderline'; results.borderline.push({ name, editor: edNb, player: plNb });
      }
    }
  } catch (e) {
    verdict = 'error'; results.error.push({ name, err: String(e).slice(0,120) });
  }
  if (verdict !== 'pass') console.log(`  [${i}/${names.length}] ${verdict.padEnd(10)} ed=${edNb}% pl=${plNb===null?'-':plNb+'%'}  ${name}`);
  if (i % 100 === 0) { console.log(`  …${i}/${names.length} (BUG:${results.bug.length} bothDark:${results.bothDark.length} border:${results.borderline.length} pass:${results.pass})`); fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); }
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\n──────── SUMMARY ────────`);
console.log(`  PASS:        ${results.pass}`);
console.log(`  BUG (editor-black, player-fine): ${results.bug.length}`);
console.log(`  both-dark (needs audio / genuinely dark): ${results.bothDark.length}`);
console.log(`  borderline:  ${results.borderline.length}`);
console.log(`  error:       ${results.error.length}`);
console.log(`\nFull results → ${OUT}\n`);
if (results.bug.length) { console.log('REAL BUGS:'); for (const b of results.bug) console.log(`  ed=${b.editor}% pl=${b.player}%  ${b.name}`); }
await browser.close();
