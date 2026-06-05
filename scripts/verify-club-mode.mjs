// 🌙 Club / Dark Mode (image-texture-dev.md §18) headless verify — comp-grade output op.
// Requires the dev server running. Run: node scripts/verify-club-mode.mjs
// Boots the real Preset Studio (SwiftShader), blows a preset toward white, then asserts
// Club CRUSHES the white (luminance drops) while COLOUR HOLDS (saturation doesn't collapse),
// club=0 is byte-identical (no club block in the comp), and clubMode round-trips save→reload.
import { chromium } from 'playwright';

const URL = (process.env.DC_URL || 'http://localhost:5173/index.html').replace(/index\.html.*$/, 'editor.html');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  — ' + extra}`); };

const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('    ‼ pageerror:', e.message));
page.on('console', (m) => { const t = m.text(); if (/error|fail|undefined is not/i.test(t)) console.log('    ▸', t); });

console.log(`\n🌙 Club / Dark Mode — ${URL}\n`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

try {
    await page.click('#start-no-audio', { timeout: 15000 });
    await page.waitForFunction(() => !!window.__editorInspector, null, { timeout: 20000 });
    ok('editor booted + __editorInspector present', true);
} catch (e) {
    ok('editor booted + __editorInspector present', false, e.message);
    await browser.close();
    console.log(`\n❌ FAILURES — ${pass} passed, ${fail} failed\n`);
    process.exit(1);
}

const r = await page.evaluate(async () => {
    const insp = window.__editorInspector;
    const out = {};

    // Average luma + saturation of the rendered frame (64×64 sample). Saturation = mean of
    // per-pixel (max-min)/(max+eps) — "colour kept" stays high, "greyed/whited out" → low.
    const sample = async () => {
        const url = await insp.engine.captureNextFrame();
        if (!url) return { luma: 0, sat: 0 };
        const im = new Image(); im.src = url; await im.decode();
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0, 64, 64);
        const d = ctx.getImageData(0, 0, 64, 64).data;
        let sl = 0, ss = 0; const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
            sl += (r + g + b) / 3;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            ss += (mx - mn) / (mx + 1e-4);
        }
        return { luma: (sl / n) * 255, sat: ss / n };
    };
    const settle = async () => { for (let k = 0; k < 40; k++) await sample(); };

    // Build a deliberately BLOWN-WHITE scene: solid-mode base pushed bright + a strong bloom
    // (the room-lighting white the club knob targets). Keep some colour via a vivid Shift pair.
    insp.currentState.clubMode = 0;
    insp.currentState.baseVals.studio_brightness = 1.8;   // push toward white
    insp.currentState.baseVals.studio_bloom = 0.6;        // blown highlights
    insp._buildCompShader();
    insp._applyToEngine();
    await settle();
    const base = await sample();
    out.baseLuma = +base.luma.toFixed(1);
    out.baseSat = +base.sat.toFixed(3);

    // club=0 baked into the comp must add NO club block (byte-identical no-op).
    out.clubZeroNoop = !insp.currentState.comp.includes('_cw =');

    // Crank Club → the comp gains the club block, the frame DARKENS, colour is NOT killed.
    insp.currentState.clubMode = 0.8;
    insp._buildCompShader();
    insp._applyToEngine();
    out.clubBaked = insp.currentState.comp.includes('_cw =')
        && insp.currentState.comp.includes('mix(vec3(_cl)');   // white-detect + deepen ops present
    await settle();
    const clubbed = await sample();
    out.clubLuma = +clubbed.luma.toFixed(1);
    out.clubSat = +clubbed.sat.toFixed(3);
    out.lumaDropped = clubbed.luma < base.luma - 5;             // white crushed → meaningfully darker
    out.notDeadBlack = clubbed.luma > 3;                        // colour survives, not a black frame
    out.colourHeld = clubbed.sat >= base.sat - 0.02;            // saturation holds (or rises) — colour kept

    // The live slider + one-tap snap drive clubMode.
    const sl = document.getElementById('ps-club');
    sl.value = '0.5'; sl.dispatchEvent(new Event('input', { bubbles: true }));
    out.sliderDrives = Math.abs(insp.currentState.clubMode - 0.5) < 1e-6;
    document.getElementById('ps-club-snap').click();           // snaps to 0.6 (off→on)
    out.snapWorks = insp.currentState.clubMode >= 0.6;

    // Round-trip: clubMode survives save→reload + rebuilds the club block.
    insp.currentState.clubMode = 0.7;
    const saved = JSON.parse(JSON.stringify(insp.currentState));
    out.savedHasClub = Math.abs(saved.clubMode - 0.7) < 1e-6;
    await insp.loadPresetData(saved);
    out.reloadedClub = Math.abs((insp.currentState.clubMode ?? 0) - 0.7) < 1e-6;
    out.reloadSliderSynced = Math.abs(parseFloat(document.getElementById('ps-club').value) - 0.7) < 1e-6;

    // Reset for cleanliness.
    insp.currentState.clubMode = 0;
    insp.currentState.baseVals.studio_brightness = 1.0;
    insp.currentState.baseVals.studio_bloom = 0;
    insp._buildCompShader();
    insp._applyToEngine();
    return out;
});

ok('blown-white base preset renders bright (luma > 60)', r.baseLuma > 60, `luma ${r.baseLuma}`);
ok('club=0 = no-op (no club block in the comp)', r.clubZeroNoop);
ok('Club bakes the white-detect + deepen ops into the comp', r.clubBaked);
ok('Club CRUSHES the white — frame darkens', r.lumaDropped, `base ${r.baseLuma} → club ${r.clubLuma}`);
ok('Club output is not dead black (colour survives)', r.notDeadBlack, `club luma ${r.clubLuma}`);
ok('Club KEEPS colour — saturation holds, not greyed out', r.colourHeld, `base sat ${r.baseSat} → club sat ${r.clubSat}`);
ok('Club slider drives clubMode', r.sliderDrives);
ok('one-tap "Club it" snaps clubMode on', r.snapWorks);
ok('clubMode serializes into the saved preset', r.savedHasClub);
ok('save → reload restores clubMode + re-syncs the slider', r.reloadedClub && r.reloadSliderSynced);

await browser.close();
const verdict = fail === 0 ? '✅ ALL PASS' : '❌ FAILURES';
console.log(`\n${verdict} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
