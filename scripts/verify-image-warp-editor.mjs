// Phase 2 (image-texture-dev.md) headless verify — the EDITOR round-trip.
// Requires the dev server running. Run: node scripts/verify-image-warp-editor.mjs
// Boots the real Preset Studio in headless Chromium (SwiftShader), adds an image layer,
// toggles "Drive preset with image", and checks the generated warp + a full
// save→reload round-trip through the inspector's own methods (not the dev hook).
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

console.log(`\nImage-as-texture EDITOR round-trip — ${URL}\n`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// Boot the studio with no audio, then wait for the inspector handle.
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

    // A vivid synthetic image as a File, fed through the REAL upload path.
    const mkFile = async () => {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const x = c.getContext('2d');
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
            x.fillStyle = ((i + j) & 1) ? '#ff2ad6' : '#16e0ff';
            x.fillRect(i * 32, j * 32, 32, 32);
        }
        const blob = await new Promise(res => c.toBlob(res, 'image/png'));
        return new File([blob], 'checker.png', { type: 'image/png' });
    };

    await insp._addImageLayer(await mkFile());
    out.layerAdded = (insp.currentState.images || []).length === 1;
    const entry = insp.currentState.images[0];
    const texName = entry?.texName;

    // Per-card Overlay|Drive switch: toggle Drive on THIS layer via the real handler.
    insp._toggleCardDrive(entry);
    insp.currentState.imageWarp.flow = 'tunnel';
    insp.currentState.imageWarp.reseed = 0.6;
    out.enabled = insp.currentState.imageWarp.enabled === true;
    out.sourceAutoPicked = insp.currentState.imageWarp.texName === texName;

    // The card must enter drive-mode and the shared Drive panel must move INTO it.
    const card = document.querySelector(`#image-layers .image-layer-card[data-tex-name="${texName}"]`)
        || [...document.querySelectorAll('#image-layers .image-layer-card')].find(c => c.dataset.texName === texName);
    out.cardInDriveMode = !!(card && card.classList.contains('drive-mode'));
    out.panelMovedIntoCard = !!(card && card.querySelector('#image-warp-controls'));

    // The built runtime warp must be the image-warp (declares + samples sampler_<texName>),
    // overriding flowStyle.
    const runtime = insp._buildRuntimePreset(insp.currentState);
    out.warpIsImageWarp = !!runtime.warp
        && runtime.warp.includes(`uniform sampler2D sampler_${texName};`)
        && runtime.warp.includes(`texture(sampler_${texName}, uv_orig)`);

    // Radio: driving a SECOND layer must release the first (one warp slot).
    await insp._addImageLayer(await mkFile());
    const entry2 = insp.currentState.images[1];
    insp._toggleCardDrive(entry2);
    const cardOf = (t) => [...document.querySelectorAll('#image-layers .image-layer-card')].find(c => c.dataset.texName === t);
    out.radioReleasedFirst = !cardOf(texName)?.classList.contains('drive-mode')
        && !!cardOf(entry2.texName)?.classList.contains('drive-mode')
        && insp.currentState.imageWarp.texName === entry2.texName;
    // Return to the first layer driving for the rest of the checks.
    insp._toggleCardDrive(entry);
    insp.currentState.images.splice(1, 1);  // drop the 2nd helper layer
    insp._updateLayersBar();
    cardOf(entry2.texName)?.remove();

    // Live preview must actually RENDER the melt (not a black frame). The editor pushes
    // state to the same engine via _applyToEngine; read back canvas luma after a settle.
    const luma = async () => {
        const url = await insp.engine.captureNextFrame();
        if (!url) return 0;
        const im = new Image(); im.src = url; await im.decode();
        const c = document.createElement('canvas'); c.width = 64; c.height = 64;
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0, 64, 64);
        const d = ctx.getImageData(0, 0, 64, 64).data;
        let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return s / (d.length / 4);
    };
    insp._applyToEngine();                       // push the driven state to the engine
    for (let k = 0; k < 50; k++) await luma();    // burn frames so the melt establishes
    out.previewLuma = await luma();

    // Flow is a click-to-explore chip grid (not a dropdown).
    out.flowChips = document.querySelectorAll('#image-warp-flow-grid .lseg').length;

    // Double-click a slider label resets it to default (matches every other fader).
    const reseedSl = document.getElementById('image-warp-reseed-sl');
    reseedSl.value = '0.85';
    reseedSl.dispatchEvent(new Event('input', { bubbles: true }));
    const bumped = insp.currentState.imageWarp.reseed;
    reseedSl.closest('.layer-slider-row').querySelector('.layer-ctrl-label')
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    out.dblclickReset = Math.abs(bumped - 0.85) < 1e-6 && Math.abs(insp.currentState.imageWarp.reseed - 0.2) < 1e-6;
    insp.currentState.imageWarp.reseed = 0.6;     // restore for the round-trip check below

    // Overlay must DROP OUT while driving: the comp shader no longer declares the
    // driving layer's sampler. Toggling Drive off restores it.
    out.overlayHiddenWhileDriving = !insp.currentState.comp.includes(`sampler_${texName}`);
    insp._toggleCardDrive(entry);                 // back to Overlay
    out.overlayRestoredWhenOff = insp.currentState.comp.includes(`sampler_${texName}`);
    out.panelHomedWhenOff = !!document.querySelector(`#image-warp-home #image-warp-controls`);
    insp._toggleCardDrive(entry);                 // re-enable for the round-trip below

    // Persistence round-trip: serialize like a save, then reload via loadPresetData and
    // confirm imageWarp survived and still builds the image-warp.
    const saved = JSON.parse(JSON.stringify(insp.currentState));
    out.savedHasImageWarp = !!(saved.imageWarp && saved.imageWarp.enabled && saved.imageWarp.texName === texName && saved.imageWarp.flow === 'tunnel');

    await insp.loadPresetData(saved);
    const iw2 = insp.currentState.imageWarp;
    out.reloadedEnabled = !!(iw2 && iw2.enabled && iw2.flow === 'tunnel' && Math.abs(iw2.reseed - 0.6) < 1e-6);
    const texName2 = insp.currentState.images[0]?.texName;
    const runtime2 = insp._buildRuntimePreset(insp.currentState);
    out.reloadWarpOk = !!runtime2.warp && runtime2.warp.includes(`texture(sampler_${texName2}, uv_orig)`);

    // Graceful degrade: delete the only layer → image-warp must auto-disable so the
    // build can't reference a missing sampler.
    insp.currentState.images = [];
    insp._syncImageWarpSection();
    out.degradedDisabled = insp.currentState.imageWarp.enabled === false;
    const runtime3 = insp._buildRuntimePreset(insp.currentState);
    out.degradedWarpClean = !runtime3.warp || !runtime3.warp.includes('sampler_userimg');

    return out;
});

ok('image layer added via real upload path', r.layerAdded);
ok('per-card Drive toggle enables drive on that layer', r.enabled && r.sourceAutoPicked);
ok('card enters drive-mode + the Drive panel moves INTO the card', r.cardInDriveMode && r.panelMovedIntoCard);
ok('radio: driving a 2nd layer releases the 1st (one warp slot)', r.radioReleasedFirst);
ok('runtime warp is the image-warp (declares + samples sampler_<tex>), overriding flowStyle', r.warpIsImageWarp);
ok('editor live preview renders the melt BRIGHT, not black (luma > 20)', r.previewLuma > 20, `luma ${r.previewLuma?.toFixed(1)}`);
ok('Flow is a click-to-explore chip grid, not a dropdown', r.flowChips >= 10, `chips ${r.flowChips}`);
ok('double-click slider label resets it to default', r.dblclickReset);
ok('driving layer drops out of the overlay (not stacked on top)', r.overlayHiddenWhileDriving);
ok('toggling back to Overlay restores it + parks the panel home', r.overlayRestoredWhenOff && r.panelHomedWhenOff);
ok('imageWarp serializes into the saved preset JSON', r.savedHasImageWarp);
ok('save → reload restores imageWarp (enabled/flow/reseed) + rebuilds the melt', r.reloadedEnabled && r.reloadWarpOk);
ok('deleting the source layer auto-disables drive (no dangling sampler)', r.degradedDisabled && r.degradedWarpClean);

await browser.close();
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
