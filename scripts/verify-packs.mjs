// Headless verification of the community-pack engine (Phase 1).
// Requires the dev server running (npm run dev). Run: node scripts/verify-packs.mjs
// Reusable for Phase 2/3 — drives the real app in headless Chromium (WebGL via SwiftShader).
import { chromium } from 'playwright';

const URL = process.env.DC_URL || 'http://localhost:5173/index.html';
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

// --- Modal UI test: open Browse-Packs → install the starter pack → remove ---
console.log('\n  — modal (Browse Packs) —');
try {
    await page.evaluate(() => window.__dcPacks.openBrowser());
    await page.waitForSelector('.dc-pack-row', { timeout: 10000 });
    ok('modal opens with a pack card', (await page.locator('.dc-pack-row').count()) >= 1);

    await page.locator('.dc-pack-row .dc-pack-btn.primary').first().click();
    await page.waitForSelector('.dc-pack-badge', { timeout: 20000 }); // install of the 46 KB local zip
    const reg = await page.evaluate(() => window.__dcPacks.engine.getPresetNames().filter((n) => n.startsWith('community:starter-essentials:')).length);
    ok('modal Install → 24 community presets registered', reg === 24, `got ${reg}`);

    await page.locator('.dc-pack-row .dc-pack-btn', { hasText: 'Remove' }).first().click();
    await page.waitForSelector('.dc-pack-row .dc-pack-btn.primary', { timeout: 10000 });
    const left = await page.evaluate(() => window.__dcPacks.engine.getPresetNames().filter((n) => n.startsWith('community:starter-essentials:')).length);
    ok('modal Remove → 0 left', left === 0, `left ${left}`);
} catch (e) {
    ok('modal install/remove flow', false, e.message);
}

await browser.close();
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
