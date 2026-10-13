/**
 * capture-guide-shots.mjs — screenshots for the in-app User Guide (Help window).
 *
 * Drives the real app in a VISIBLE Chromium window (real GPU, so Butterchurn
 * renders properly), styled as the desktop app (html.is-desktop), with a real
 * audio file playing so the visuals are alive. Saves close-ups of each feature
 * as WebP into public/guide/, which index.html's Help sections reference.
 *
 *   node scripts/capture-guide-shots.mjs <audio-file> <layer-image.png>
 *
 * Re-run whenever the UI changes. No password gate (VITE_APP_PASSWORD='').
 */
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch { sharp = require(path.resolve('../discocast/node_modules/sharp')); }

const [AUDIO, LAYER_IMG] = process.argv.slice(2);
if (!AUDIO || !LAYER_IMG) { console.error('usage: node scripts/capture-guide-shots.mjs <audio> <image.png>'); process.exit(1); }
const OUT = path.resolve('public/guide');
mkdirSync(OUT, { recursive: true });
const PORT = 5194;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A bright, colourful bundled preset so the screenshots aren't dark.
const HERO_PRESET = 'Flexi, martin + geiss - dedicated to the sherwin maxawow';
async function showPreset(page) {
  await page.waitForFunction(() => window.__dcPacks?.engine, null, { timeout: 20000 });
  await page.evaluate((name) => {
    const e = window.__dcPacks.engine;
    e.setAutoCycle(false);
    const key = e.presetNames.find((n) => n === name) || e.presetNames.find((n) => n.includes('mindblob'));
    e.loadPreset(key, 0);
    window.dispatchEvent(new CustomEvent('presetChanged', { detail: { name: key } }));
  }, HERO_PRESET);
}

async function save(buf, name, maxW = 900) {
  const file = path.join(OUT, `${name}.webp`);
  await sharp(buf).resize({ width: maxW, withoutEnlargement: true }).webp({ quality: 80 }).toFile(file);
  console.log('saved', path.relative(process.cwd(), file));
}
// Element close-up with a little breathing room around it.
async function shotEl(page, selector, name, { pad = 10, maxW = 700 } = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) { console.warn('not visible:', selector); return; }
  const vp = page.viewportSize();
  const clip = {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(vp.width - Math.max(0, box.x - pad), box.width + pad * 2),
    height: Math.min(vp.height - Math.max(0, box.y - pad), box.height + pad * 2),
  };
  await save(await page.screenshot({ clip }), name, maxW);
}

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(), stdio: 'pipe', env: { ...process.env, VITE_APP_PASSWORD: '' },
});
await new Promise((r, j) => { vite.stdout.on('data', (d) => /Local:/.test(String(d)) && r()); vite.on('exit', j); });

const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// Look like the desktop app (web-only UI hidden), no first-run guide.
await ctx.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('is-desktop'));
});

try {
  // ── Player ────────────────────────────────────────────────────────────────
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.locator('#file-input').setInputFiles(AUDIO);
  await sleep(1500);
  await showPreset(p);
  await sleep(10000);                                  // let the visuals develop
  await p.keyboard.press('Escape');                    // close any first-run guide
  await p.mouse.move(700, 600); await sleep(400);      // reveal the control bar
  await save(await p.screenshot(), 'player-main', 1200);
  await shotEl(p, '#control-bar', 'control-bar', { maxW: 1100 });

  await p.click('#btn-presets'); await sleep(700);
  await p.evaluate(() => document.getElementById('control-bar').style.visibility = 'hidden');
  await p.mouse.move(1300, 120); await sleep(300);     // off the list: no hover highlight
  await shotEl(p, '#preset-drawer', 'preset-drawer', { maxW: 520 });
  await p.evaluate(() => document.getElementById('control-bar').style.visibility = '');
  await p.keyboard.press('Escape'); await sleep(400);
  await p.mouse.move(700, 600); await sleep(300);

  await p.click('#btn-cycle'); await sleep(500);
  const setCycle = (on) => p.evaluate((v) => {   // the switch's checkbox is visually hidden
    const el = document.getElementById('toggle-cycle');
    el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, on);
  await setCycle(true); await sleep(400);
  await shotEl(p, '#cycle-panel', 'cycle-panel', { maxW: 420 });
  await setCycle(false);
  await p.click('#btn-cycle'); await sleep(300);

  await p.click('#btn-audio-tuning'); await sleep(500);
  await shotEl(p, '#audio-tuning-panel', 'audio-tuning', { maxW: 420 });
  await p.click('#btn-audio-tuning'); await sleep(300);

  // Output panel with a projector connected (two displays, as on a real rig).
  await p.evaluate(async () => {
    const { outputManager } = await import('/src/output/outputManager.js');
    outputManager.listDisplays = async () => [
      { id: '0', label: '', x: 0, y: 0, w: 1920, h: 1080, isPrimary: true },
      { id: '1', label: '', x: 1920, y: 0, w: 1920, h: 1080, isPrimary: false },
    ];
  });
  await p.click('#btn-output'); await sleep(500);
  await p.click('#output-panel [data-act="refresh"]'); await sleep(500);
  await shotEl(p, '#output-panel', 'output-panel', { maxW: 420 });
  await p.click('#btn-output'); await sleep(300);
  await p.close();

  // ── Preset Studio ─────────────────────────────────────────────────────────
  const e = await ctx.newPage();
  await e.goto(BASE + '/editor.html?preset=' + encodeURIComponent(HERO_PRESET));   // edit a colourful bundled preset
  await e.locator('#start-file-input').setInputFiles(AUDIO);
  await e.waitForSelector('#editor-shell:not([hidden])', { timeout: 20000 });
  await sleep(2000);
  await sleep(8000);                                   // the hero preset develops
  await save(await e.screenshot(), 'studio-main', 1200);
  for (const tab of ['palette', 'motion', 'wave']) {
    await e.click(`.tab[data-tab="${tab}"]`); await sleep(600);
    await shotEl(e, '#editor-panel', `studio-${tab}`, { pad: 0, maxW: 520 });
  }
  await e.click('.tab[data-tab="layers"]'); await sleep(500);
  await e.locator('#image-file-input').setInputFiles(LAYER_IMG);
  await e.waitForSelector('.image-layer-card', { timeout: 15000 });
  await sleep(8000);                                   // let the upload/tip toasts fade
  await shotEl(e, '#editor-panel', 'studio-layers', { pad: 0, maxW: 520 });
  await save(await e.screenshot(), 'studio-layer-on-canvas', 1200);
  await e.click('.image-layer-card .layer-animate'); await sleep(800);
  await shotEl(e, '#animate-modal .animate-modal-card', 'studio-animate', { maxW: 480 });
  await e.close();

  // ── Timeline ──────────────────────────────────────────────────────────────
  const t = await ctx.newPage();
  await t.goto(BASE + '/timeline.html');
  await t.locator('#start-file-input').setInputFiles(AUDIO);
  await t.waitForFunction(() => window.editor && window.editor._tl, null, { timeout: 20000 });
  await t.evaluate(() => {
    const want = ['sherwin maxawow', 'mindblob mix', 'tokamak witchery', 'Mandala_Chasers', 'Magellan'];
    const names = window.editor._presetNames || [];
    for (const w of want) { const n = names.find((x) => x.includes(w)); if (n) window.editor.addEntry(n); }
  });
  await sleep(800);
  await t.click('#tl-btn-play, button:has-text("Play")').catch(() => {});
  await sleep(9000);
  await t.mouse.move(700, 500); await sleep(400);
  await save(await t.screenshot(), 'timeline-main', 1200);
  await t.close();
} finally {
  await browser.close();
  vite.kill();
}
