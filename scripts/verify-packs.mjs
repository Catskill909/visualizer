// Headless verification of the community-pack engine (Phase 1).
// Requires the dev server running (npm run dev). Run: node scripts/verify-packs.mjs
// Reusable for Phase 2/3 — drives the real app in headless Chromium (WebGL via SwiftShader).
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.DC_URL || 'http://localhost:5173/index.html';
// First pack in the manifest drives the modal test (id + expected count).
const manifest = JSON.parse(fs.readFileSync('public/pack-manifest.json', 'utf8'));
const PACK = manifest.packs[0];
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  — ' + extra}`); };

const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (/DiscoCast|\[dev\]|\[smoke\]|Community|presetStore|error/i.test(t)) console.log('    ▸', t); });
page.on('pageerror', (e) => console.log('    ‼ pageerror:', e.message));

console.log(`\nPhase 1 headless smoke test — ${URL}\n`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

try {
    await page.waitForFunction(() => !!(window.__dcPacks && window.__dcPacks.engine), null, { timeout: 20000 });
    ok('engine booted (WebGL ok) + __dcPacks hook present', true);
} catch {
    ok('engine booted + __dcPacks hook present', false, '__dcPacks never appeared (engine/WebGL boot failed)');
    await browser.close();
    console.log(`\n❌ FAILURES — ${pass} passed, ${fail} failed\n`);
    process.exit(1);
}

const r = await page.evaluate(async () => {
    const P = window.__dcPacks, engine = P.engine;
    const keys = await P.smokeFromBundled(engine, 8);
    const reg = engine.presetNames.filter((n) => n.startsWith('community:smoke-test:'));
    let loaded = false;
    try { loaded = await engine.loadPreset(reg[0], 0.1); } catch (e) { loaded = 'throw:' + e.message; }
    const disp = reg[0] ? engine.displayName(reg[0]) : '';
    const displayOk = !!disp && !disp.startsWith('community:');
    await P.uninstallPack('smoke-test', { engine });
    const left = engine.presetNames.filter((n) => n.startsWith('community:smoke-test:')).length;
    return { stored: keys.length, registered: reg.length, loaded, disp, displayOk, left };
});

ok('8 community presets registered in engine', r.registered === 8, `got ${r.registered}`);
ok('a community preset loads via engine.loadPreset()', r.loaded === true, `loaded=${JSON.stringify(r.loaded)}`);
ok(`displayName strips prefix ("${r.disp}")`, r.displayOk === true);
ok('uninstall removes all (→ 0)', r.left === 0, `left ${r.left}`);

// --- Modal UI test: open Browse-Packs → install ALL manifest packs → verify total → remove all ---
const packs = manifest.packs;
const expectedTotal = packs.reduce((s, p) => s + p.presetCount, 0);
console.log(`\n  — modal (Browse Packs) · ${packs.length} pack(s), expect ${expectedTotal} total —`);
const countCommunity = () => page.evaluate(() => window.__dcPacks.engine.getPresetNames().filter((n) => n.startsWith('community:')).length);
try {
    await page.evaluate(() => window.__dcPacks.openBrowser());
    await page.waitForSelector('.dc-pack-row', { timeout: 10000 });
    const rowCount = await page.locator('.dc-pack-row').count();
    ok(`modal shows all ${packs.length} packs`, rowCount === packs.length, `got ${rowCount}`);

    for (let i = 0; i < rowCount; i++) {
        const row = page.locator('.dc-pack-row').nth(i);
        await row.locator('.dc-pack-btn.primary').click();
        await row.locator('.dc-pack-badge').waitFor({ timeout: 30000 });
    }
    const total = await countCommunity();
    ok(`all packs installed → ${expectedTotal} unique presets (no collisions)`, total === expectedTotal, `got ${total}`);

    const removeBtns = page.locator('.dc-pack-row .dc-pack-btn', { hasText: 'Remove' });
    while (await removeBtns.count()) { await removeBtns.first().click(); await page.waitForTimeout(150); }
    const left = await countCommunity();
    ok('remove all → 0 left', left === 0, `left ${left}`);
} catch (e) {
    ok('modal install/remove flow', false, e.message);
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
