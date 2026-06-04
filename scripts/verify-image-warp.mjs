// Headless verification of the image-as-texture feedback-melt (image-texture-dev.md Phase 1).
// Requires the dev server running (npm run dev). Run: node scripts/verify-image-warp.mjs
// Drives the real app in headless Chromium (WebGL via SwiftShader), pushes a synthetic
// image through window.__imgWarp.drive(), and reads back canvas luma to prove the user
// texture actually reaches the warp/feedback loop (not just that the code runs).
import { chromium } from 'playwright';

const URL = process.env.DC_URL || 'http://localhost:5173/index.html';
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => { (cond ? pass++ : fail++); console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  — ' + extra}`); };

const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (/__imgWarp|DiscoCast|error|pageerror/i.test(t)) console.log('    ▸', t); });
page.on('pageerror', (e) => console.log('    ‼ pageerror:', e.message));

console.log(`\nImage-as-texture headless verify — ${URL}\n`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

try {
    await page.waitForFunction(() => !!(window.__imgWarp && window.__imgWarp.engine), null, { timeout: 20000 });
    ok('engine booted + __imgWarp hook present', true);
} catch {
    ok('engine booted + __imgWarp hook present', false, '__imgWarp never appeared');
    await browser.close();
    console.log(`\n❌ FAILURES — ${pass} passed, ${fail} failed\n`);
    process.exit(1);
}

const r = await page.evaluate(async () => {
    const engine = window.__imgWarp.engine;

    // A deterministic, vivid test image (magenta/cyan checker) as a data URL — no network.
    const mk = () => {
        const c = document.createElement('canvas'); c.width = c.height = 256;
        const x = c.getContext('2d');
        for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
            x.fillStyle = ((i + j) & 1) ? '#ff00cc' : '#00e5ff';
            x.fillRect(i * 32, j * 32, 32, 32);
        }
        return c.toDataURL('image/png');
    };

    // Mean luma of the live canvas, via the engine's own post-render capture hook.
    const luma = async () => {
        const url = await engine.captureNextFrame();
        if (!url) return null;
        const im = new Image(); im.src = url; await im.decode();
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0, 64, 64);
        const d = ctx.getImageData(0, 0, 64, 64).data;
        let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return s / (d.length / 4);
    };
    const settle = async (n = 30) => { for (let k = 0; k < n; k++) await luma(); }; // burn frames

    // Pick a known bundled preset so the run is deterministic.
    const name = engine.getPresetNames().find(n => !n.startsWith('custom:') && !n.startsWith('community:'));
    await engine.loadPreset(name, 0.1);
    await settle(40);
    const before = await luma();

    // Drive the synthetic image into the feedback loop (high reseed = clearly present).
    await window.__imgWarp.drive(mk(), { flow: 'liquid', reseed: 0.6 });
    await settle(40);
    const after = await luma();

    // Audio-reactive variant should still compile + render (luma > 0).
    await window.__imgWarp.drive(mk(), { flow: 'tunnel', reseed: 0.3, audioSource: 'bass', audioAmt: 0.6 });
    await settle(40);
    const audio = await luma();

    // Restore.
    window.__imgWarp.clear();
    await settle(10);

    return { name, before, after, audio };
});

console.log(`\n  preset: ${r.name}`);
console.log(`  luma  before=${r.before?.toFixed(1)}  driven=${r.after?.toFixed(1)}  audio=${r.audio?.toFixed(1)}\n`);
// The driven image is a vivid magenta/cyan checker (luma ~128) injected at reseed 0.6,
// so a WORKING warp must yield a clearly non-black frame. A near-black result (luma < ~10)
// means the warp shader failed to compile (e.g. an undeclared user sampler) — exactly the
// false-green the first run hid behind `luma > 0`. Assert real brightness, not just nonzero.
ok('baseline preset renders (luma > 0)', r.before > 0, `luma ${r.before}`);
ok('image-warp renders a BRIGHT frame, not black (luma > 20)', r.after > 20, `luma ${r.after} — warp likely failed to compile`);
ok('driven frame differs from baseline (image reached the loop)', Math.abs(r.after - r.before) > 3.0, `Δ ${(r.after - r.before).toFixed(2)}`);
ok('audio-reactive variant compiles + renders bright (luma > 20)', r.audio > 20, `luma ${r.audio}`);

await browser.close();
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
