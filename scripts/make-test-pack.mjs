// Dev fixture: build a small LOCAL community-pack ZIP from real butterchurn-presets JSON,
// so the Browse-Packs modal can do genuine installs during Phase 2 dev (no remote/CORS,
// no converter). NOT a shipped pack — real packs arrive via the Phase 3 converter (Cream).
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const SRC = 'node_modules/butterchurn-presets/presets/converted';
const OUT_DIR = 'public/packs';
const OUT = path.join(OUT_DIR, 'starter-essentials.zip');
const N = 24;

const all = fs.readdirSync(SRC).filter(f => f.endsWith('.json')).sort();
const step = Math.max(1, Math.floor(all.length / N));
const picks = [];
for (let i = 0; i < all.length && picks.length < N; i += step) picks.push(all[i]);

const zip = new JSZip();
let added = 0;
for (const f of picks) {
  const text = fs.readFileSync(path.join(SRC, f), 'utf8');
  try { JSON.parse(text); } catch { continue; }
  zip.file(f, text);
  added++;
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(OUT, buf);
console.log(`Wrote ${OUT} — ${added} presets, ${(buf.length / 1024).toFixed(0)} KB`);
