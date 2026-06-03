/**
 * packInstaller.js — Community pack install / uninstall pipeline (Phase 1 / milkdrop-pack-import.dev §13).
 *
 * Flow: fetch ZIP → unzip (JSZip, lazy) → validate Butterchurn JSON → storeCommunityBatch →
 * recordPack → engine.loadCommunityPresets(). Community presets register like BUNDLED presets,
 * so they play/cycle exactly like the 1,144 bundled ones (§13.1).
 *
 * Progress: every step emits onProgress({ phase, current, total }) for the §2c UX —
 * phases: 'download' (bytes), 'unzip', 'extract' (count), 'install' (count), 'done'.
 * Cancellable via an AbortController `signal`.
 *
 * NOTE: per §2.5 we ship SMALL curated packs. installAnsorreSlice() exists only to exercise the
 * real download+unzip path on demand; it is NOT a shipped pack.
 */

import {
    storeCommunityBatch, deletePackPresets,
    recordPack, removePack, listInstalledPacks, COMMUNITY_PREFIX,
} from './presetStore.js';
import { CUSTOM_PREFIX } from './customPresets.js';

const noop = () => {};

// Same shape check the bundled loader uses (visualizer.js): a real Butterchurn preset.
function _isValidPreset(p) {
    return p && typeof p === 'object' && (p.shapes || p.waves || p.baseVals);
}

/** Download a URL to a Blob with real byte-level progress. Honors an AbortSignal. */
async function _fetchWithProgress(url, { onProgress = noop, signal } = {}) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const total = +res.headers.get('Content-Length') || 0;
    if (!res.body || !res.body.getReader) {
        const blob = await res.blob();                       // fallback: no granular progress
        onProgress({ phase: 'download', current: blob.size, total: blob.size });
        return blob;
    }
    const reader = res.body.getReader();
    let received = 0;
    const chunks = [];
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress({ phase: 'download', current: received, total });
    }
    return new Blob(chunks);
}

/** Unzip a blob and parse Butterchurn JSON presets → { presets:[{name,preset}], failed:[] }. */
async function _extractPresetsFromZip(blob, { onProgress = noop, limit = Infinity } = {}) {
    const JSZip = (await import('jszip')).default;           // lazy — keeps jszip out of the main bundle
    const zip = await JSZip.loadAsync(blob);
    onProgress({ phase: 'unzip', current: 1, total: 1 });

    const files = Object.values(zip.files).filter(f => !f.dir && /\.json$/i.test(f.name));
    const cap = Math.min(files.length, limit);
    const presets = [];
    const failed = [];
    for (let i = 0; i < cap; i++) {
        const f = files[i];
        try {
            const preset = JSON.parse(await f.async('text'));
            if (!_isValidPreset(preset)) { failed.push({ name: f.name, error: 'not a Butterchurn preset' }); continue; }
            const name = decodeURIComponent(f.name.split('/').pop().replace(/\.json$/i, ''));
            presets.push({ name, preset });
        } catch (e) {
            failed.push({ name: f.name, error: e.message });
        }
        if ((i & 63) === 0) onProgress({ phase: 'extract', current: i + 1, total: cap });
    }
    onProgress({ phase: 'extract', current: cap, total: cap });
    return { presets, failed };
}

/**
 * Install a community pack from a ZIP of Butterchurn JSON.
 * @param {{id:string, name?:string, author?:string, downloadUrl:string, sizeEstimateMB?:number}} pack
 * @param {{engine?:object, onProgress?:Function, signal?:AbortSignal, limit?:number}} opts
 * @returns {Promise<{installed:number, failed:Array}>}
 */
export async function installPackFromZip(pack, { engine, onProgress = noop, signal, limit } = {}) {
    if (!pack || !pack.id || !pack.downloadUrl) throw new Error('Pack needs an id and downloadUrl');

    const blob = await _fetchWithProgress(pack.downloadUrl, { onProgress, signal });
    const { presets, failed } = await _extractPresetsFromZip(blob, { onProgress, limit });
    if (!presets.length) throw new Error('No valid presets found in the pack');

    // Brand each preset name so it's findable via the existing search boxes — e.g. a "Benny"
    // pack names presets "[Benny] <original>", so searching "Benny" surfaces the whole pack.
    const brand = pack.brand || pack.name || pack.id;
    const entries = presets.map(({ name, preset }) => ({
        key: `${COMMUNITY_PREFIX}${pack.id}:[${brand}] ${name}`,
        packId: pack.id,
        preset,
    }));

    onProgress({ phase: 'install', current: 0, total: entries.length });
    await storeCommunityBatch(entries);
    onProgress({ phase: 'install', current: entries.length, total: entries.length });

    await recordPack({
        id: pack.id,
        name: pack.name || pack.id,
        brand,
        author: pack.author || '',
        presetCount: entries.length,
        installedAt: Date.now(),
        sizeEstimateMB: pack.sizeEstimateMB,
    });

    if (engine) await engine.loadCommunityPresets();
    onProgress({ phase: 'done', current: entries.length, total: entries.length });
    return { installed: entries.length, failed };
}

/** Remove a pack: delete its presets + metadata, then refresh the engine. */
export async function uninstallPack(packId, { engine } = {}) {
    const removed = await deletePackPresets(packId);
    await removePack(packId);
    if (engine) await engine.loadCommunityPresets();
    return { removed };
}

export { listInstalledPacks };

// ---------------------------------------------------------------------------
// Dev/test helpers (not used by shipped UI)
// ---------------------------------------------------------------------------

/**
 * SMOKE TEST — zero network. Clones N already-loaded bundled presets into a fake
 * "smoke-test" community pack to prove store → register → play → uninstall instantly.
 * Run from the console: await __dcPacks.smokeFromBundled(__dcPacks.engine)
 */
export async function smokeFromBundled(engine, n = 8) {
    const bundled = engine.presetNames
        .filter(k => !k.startsWith(CUSTOM_PREFIX) && !k.startsWith(COMMUNITY_PREFIX))
        .slice(0, n);
    const entries = bundled.map(name => ({
        key: `${COMMUNITY_PREFIX}smoke-test:[Smoke] ${name}`,
        packId: 'smoke-test',
        preset: JSON.parse(JSON.stringify(engine.presets[name])),
    }));
    await storeCommunityBatch(entries);
    await recordPack({ id: 'smoke-test', name: 'Smoke Test', brand: 'Smoke', presetCount: entries.length, installedAt: Date.now() });
    await engine.loadCommunityPresets();
    const got = engine.presetNames.filter(k => k.startsWith(`${COMMUNITY_PREFIX}smoke-test:`));
    console.log(`[smoke] stored ${entries.length}; engine now lists ${got.length} community presets:`, got);
    console.log(`[smoke] play one:    __dcPacks.engine.loadPreset(${JSON.stringify(got[0] || '')})`);
    console.log(`[smoke] uninstall:   await __dcPacks.uninstallPack('smoke-test', { engine: __dcPacks.engine })`);
    return got;
}

/**
 * REAL-PATH TEST (HEAVY ~180 MB download) — installs only the first `count` presets from the
 * Ansorre ZIP to exercise fetch+unzip+store. Deliberate use only; never a shipped pack (§2.5).
 * Run: await __dcPacks.installAnsorreSlice({ engine: __dcPacks.engine, count: 300, onProgress: console.log })
 */
export async function installAnsorreSlice({ engine, count = 300, onProgress = noop } = {}) {
    return installPackFromZip({
        id: 'ansorre-slice',
        name: `Ansorre slice (${count})`,
        brand: 'Ansorre',
        author: 'ansorre',
        downloadUrl: 'https://cdn.jsdelivr.net/gh/ansorre/tens-of-thousands-milkdrop-presets-for-butterchurn@master/milkdrop-presets-for-butterchurn.zip',
    }, { engine, onProgress, limit: count });
}
