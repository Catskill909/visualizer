// Build a real community pack from the unbundled, full-fidelity butterchurn-presets JSON
// (Option D, §13.9). Picks distinct (not-bundled, with-shader) presets NOT already in an existing
// public/packs/*.zip (so volumes never overlap), spread for variety. Zips into public/packs/.
// Usage: node scripts/make-pack.mjs <id> <count>
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const PACK_ID = process.argv[2] || 'extras-vol1';
const COUNT = +(process.argv[3] || 250);
const SRC = 'node_modules/butterchurn-presets/presets/converted';
const PACKS_DIR = 'public/packs';

// 1. converted presets that have custom shaders
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.json'));
const shaderFiles = files.filter(f => {
  try { const j = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')); return ((j.warp||'').length>0)||((j.comp||'').length>0); }
  catch { return false; }
});

// 2. bundled names (exclude — packs add NEW content)
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await b.newPage();
await page.goto('http://localhost:5173/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__dcPacks && window.__dcPacks.engine, null, { timeout: 20000 });
const bundled = new Set(await page.evaluate(() => window.__dcPacks.engine.getPresetNames().filter(n => !n.startsWith('custom:') && !n.startsWith('community:'))));
await b.close();

// 3. already-packed names (exclude — volumes must not overlap)
const used = new Set();
fs.mkdirSync(PACKS_DIR, { recursive: true });
for (const z of fs.readdirSync(PACKS_DIR).filter(f => f.endsWith('.zip') && f !== `${PACK_ID}.zip`)) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(PACKS_DIR, z)));
  Object.keys(zip.files).forEach(n => { if (n.endsWith('.json')) used.add(n); });
}

const avail = shaderFiles.filter(f => !bundled.has(f.replace(/\.json$/, '')) && !used.has(f)).sort();
const step = Math.max(1, Math.floor(avail.length / COUNT));
const picks = [];
for (let i = 0; i < avail.length && picks.length < COUNT; i += step) picks.push(avail[i]);

const zip = new JSZip();
for (const f of picks) zip.file(f, fs.readFileSync(path.join(SRC, f), 'utf8'));
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(path.join(PACKS_DIR, `${PACK_ID}.zip`), buf);
console.log(`Wrote ${PACK_ID}.zip — ${picks.length} presets, ${(buf.length/1024/1024).toFixed(2)} MB (avail after exclusions: ${avail.length})`);
