/**
 * customPresets.js — Custom Preset Storage
 *
 * localStorage: discocast_custom_presets  { [id]: presetMeta }
 * IndexedDB:    discocast_images          blob per imageId
 *
 * Registry key format: `custom:<id>:<name>`
 * Drawer shows just `name`; engine uses the full key.
 */

const STORAGE_KEY = 'discocast_custom_presets';
const DB_NAME = 'discocast_images';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const CUSTOM_PREFIX = 'custom:';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// LocalStorage CRUD — preset metadata (no image blobs here)
// ---------------------------------------------------------------------------

export function loadAllCustomPresets() {
    try {
        let stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            // Migration from old MilkScreen keys
            stored = localStorage.getItem('milkscreen_custom_presets');
            if (stored) {
                localStorage.setItem(STORAGE_KEY, stored);
            }
        }
        return JSON.parse(stored || '{}');
    } catch {
        return {};
    }
}

export function getCustomPreset(id) {
    return loadAllCustomPresets()[id] || null;
}

export function saveCustomPreset(preset) {
    const all = loadAllCustomPresets();
    const record = { ...preset, updatedAt: Date.now() };
    all[preset.id] = record;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            throw new Error('Storage full — export your presets to free space, then delete some.');
        }
        throw e;
    }
    return record;
}

export function deleteCustomPreset(id) {
    const all = loadAllCustomPresets();
    delete all[id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * Create a new custom preset from a source preset object + user-provided name.
 * Returns the saved record.
 */
export function createCustomPreset(data) {
    const id = generateId();
    return saveCustomPreset({
        ...data,
        id,
        schemaVersion: SCHEMA_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}

/**
 * Registry key for a stored preset record.
 */
export function registryKey(preset) {
    return `${CUSTOM_PREFIX}${preset.id}:${preset.name}`;
}

// ---------------------------------------------------------------------------
// IndexedDB — private helpers (web path; also used as lazy-migration fallback)
// ---------------------------------------------------------------------------

function openImageDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('images')) {
                db.createObjectStore('images');
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function _storeImageIDB(imageId, blob) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').put(blob, imageId);
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e.target.error);
    });
}

async function _getImageIDB(imageId) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readonly');
        const req = tx.objectStore('images').get(imageId);
        req.onsuccess = (e) => resolve(e.target.result || null);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function _deleteImageIDB(imageId) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').delete(imageId);
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e.target.error);
    });
}

// ---------------------------------------------------------------------------
// Tauri native FS — private helpers (macOS + Windows app path)
// ---------------------------------------------------------------------------

async function _storeImageTauri(imageId, blob) {
    const arr = await blob.arrayBuffer();
    const bytes = new Uint8Array(arr);
    // Chunked encode — btoa(String.fromCharCode(...bigArray)) overflows stack on large files
    let binary = '';
    const CHUNK = 65536;
    for (let i = 0; i < bytes.byteLength; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)));
    }
    await window.__TAURI__.invoke('store_blob', { imageId, data: btoa(binary), mime: blob.type || '' });
}

async function _getImageTauri(imageId) {
    const result = await window.__TAURI__.invoke('get_blob', { imageId });
    if (!result) return null;
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: result.mime });
}

async function _deleteImageTauri(imageId) {
    await window.__TAURI__.invoke('delete_blob', { imageId });
}

// ---------------------------------------------------------------------------
// Public API — routes to Tauri FS or IndexedDB based on runtime environment
// ---------------------------------------------------------------------------

export async function storeImage(imageId, blob) {
    if (window.__TAURI__) return _storeImageTauri(imageId, blob);
    return _storeImageIDB(imageId, blob);
}

export async function getImage(imageId) {
    if (window.__TAURI__) {
        const blob = await _getImageTauri(imageId);
        if (blob) return blob;
        // Lazy migration: blob not yet in Tauri FS — check IDB (pre-Fix-3B storage).
        // If found, copy to Tauri FS in the background and return it.
        const idbBlob = await _getImageIDB(imageId).catch(() => null);
        if (idbBlob) {
            _storeImageTauri(imageId, idbBlob).catch(() => {});
            return idbBlob;
        }
        return null;
    }
    return _getImageIDB(imageId);
}

export async function deleteImage(imageId) {
    if (window.__TAURI__) {
        // Delete from both locations — handles blobs in either Tauri FS or IDB
        await _deleteImageTauri(imageId).catch(() => {});
        await _deleteImageIDB(imageId).catch(() => {});
        return;
    }
    return _deleteImageIDB(imageId);
}

function dataUrlToBlob(dataUrl) {
    if (typeof dataUrl !== 'string') {
        throw new Error('Invalid inlined image data');
    }

    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) {
        throw new Error('Invalid inlined image data');
    }

    const mime = match[1] || 'application/octet-stream';
    const isBase64 = !!match[2];
    const payload = match[3] || '';

    if (isBase64) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
    }

    return new Blob([decodeURIComponent(payload)], { type: mime });
}

// ---------------------------------------------------------------------------
// Export / Import (JSON, images inlined as data-URLs)
// ---------------------------------------------------------------------------

export async function exportPreset(id) {
    const preset = getCustomPreset(id);
    if (!preset) throw new Error(`Preset ${id} not found`);

    const exported = { ...preset };

    // Inline image/video blobs as base64 data URLs
    if (preset.images && preset.images.length > 0) {
        exported.images = await Promise.all(
            preset.images.map(async (img) => {
                // Video layers store under videoId
                const blobKey = img.videoId || img.imageId;
                if (!blobKey) return img;
                const blob = await getImage(blobKey);
                if (!blob) return img;
                const url = await new Promise((res) => {
                    const reader = new FileReader();
                    reader.onload = (e) => res(e.target.result);
                    reader.readAsDataURL(blob);
                });
                return { ...img, _inlinedDataUrl: url };
            })
        );
    }

    return exported;
}

export async function importPreset(json) {
    let data;
    try {
        data = typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
        throw new Error('Invalid JSON');
    }

    if (!data.name) throw new Error('Preset must have a name');

    // Rename on name collision so we never clobber an existing preset
    const existingNames = new Set(Object.values(loadAllCustomPresets()).map(p => p.name));
    let name = data.name;
    if (existingNames.has(name)) {
        let n = 2;
        while (existingNames.has(`${data.name} (imported${n > 2 ? ' ' + n : ''})`)) n++;
        name = `${data.name} (imported${n > 2 ? ' ' + n : ''})`;
    }

    // Assign a fresh id to avoid collisions
    const id = generateId();
    const images = [];

    // Detect macOS Tauri — transparent (or any) WebM imports MUST be transcoded
    // to H.264 stacked-alpha MP4 via the ffmpeg sidecar, otherwise production
    // WKWebView throws SecurityError on gl.texSubImage2D for VP9 video. Web and
    // Windows decode VP9 alpha natively, so they skip this entirely.
    // See apng-dev.md DMG #11 and video-dev.md §14.10.
    const isMacTauri = !!(typeof window !== 'undefined' && window.__TAURI__ && navigator.userAgent.includes('Mac'));

    for (const img of data.images || []) {
        if (img._inlinedDataUrl) {
            let blob = dataUrlToBlob(img._inlinedDataUrl);
            const { _inlinedDataUrl: _discarded, ...rest } = img;
            let imgClean = rest;

            // Mirror of _handleWebmAlphaUpload at the import boundary. Any video
            // layer arriving as video/webm on macOS Tauri gets transcoded to
            // stacked-alpha H.264 MP4 the same way fresh uploads do. Non-alpha
            // WebMs still convert correctly — ffmpeg adds an opaque alpha and
            // the resulting all-white luma bottom half renders as fully opaque.
            if (isMacTauri && img.type === 'video' && blob.type === 'video/webm') {
                try {
                    const buf = await blob.arrayBuffer();
                    const u8 = new Uint8Array(buf);
                    let binary = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < u8.length; i += chunk) {
                        binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
                    }
                    const inputB64 = btoa(binary);
                    const outputB64 = await window.__TAURI__.invoke('convert_to_stacked_alpha_b64', { inputB64 });
                    const outBin = atob(outputB64);
                    const outBytes = new Uint8Array(outBin.length);
                    for (let i = 0; i < outBin.length; i++) outBytes[i] = outBin.charCodeAt(i);
                    blob = new Blob([outBytes], { type: 'video/mp4' });
                    imgClean = {
                        ...imgClean,
                        fileName: (imgClean.fileName || 'video').replace(/\.webm$/i, '.mp4'),
                        isStackedAlpha: true,
                        alphaMode: 'preserve',
                    };
                } catch (err) {
                    // Conversion failed — fall back to the original WebM. On
                    // macOS this means alpha will be lost and the user will
                    // see the TICK ERROR banner, but at least the import
                    // doesn't fail outright and other layers still come in.
                    console.error('[Import] Transparent WebM transcode failed; keeping original WebM:', err);
                }
            }

            // Strip audio from any video that didn't already pass through the
            // macOS stacked-alpha transcoder above (which strips audio as a
            // side effect of re-encoding). Mirrors the invariant in
            // _addVideoLayer — no stored video may carry an audio track.
            if (img.type === 'video' && (blob.type === 'video/mp4' || blob.type === 'video/quicktime' || blob.type === 'video/webm')) {
                try {
                    // Dynamic import keeps FFmpeg.wasm out of the main app bundle.
                    const { stripAudio } = await import('./videoTranscoder.js');
                    const tmpFile = new File([blob], imgClean.fileName || 'video', { type: blob.type });
                    const stripped = await stripAudio(tmpFile);
                    blob = stripped;
                } catch (stripErr) {
                    console.warn('[Import] Audio strip failed; storing original blob:', stripErr);
                }
            }

            const newId = generateId();
            await storeImage(newId, blob);
            // Video layers use videoId, image layers use imageId
            if (img.type === 'video') {
                images.push({ ...imgClean, videoId: newId });
            } else {
                images.push({ ...imgClean, imageId: newId });
            }
        } else {
            images.push(img);
        }
    }

    return saveCustomPreset({
        ...data,
        id,
        name,
        images,
        schemaVersion: SCHEMA_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}

// ---------------------------------------------------------------------------
// Bulk export / import — one JSON file for the whole library
// ---------------------------------------------------------------------------

/**
 * Export every custom preset as an array with image blobs inlined.
 * Returned shape: { version: 1, exportedAt: ISO, presets: [...] }
 */
export async function exportAllPresets() {
    const all = loadAllCustomPresets();
    const ids = Object.keys(all);
    const presets = await Promise.all(ids.map(id => exportPreset(id)));
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        presets,
    };
}

/**
 * Import from a JSON payload that is either:
 *   - a bulk backup:  { version, presets: [...] }
 *   - an array:       [...]  (legacy / hand-rolled)
 *   - a single preset: { id, name, ... }
 * Returns { imported: N, failed: [{ name, error }] }.
 */
export async function importFromFile(json) {
    let data;
    try {
        data = typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
        throw new Error('Invalid JSON file');
    }

    let list;
    if (Array.isArray(data)) {
        list = data;
    } else if (data && Array.isArray(data.presets)) {
        list = data.presets;
    } else if (data && data.name) {
        list = [data];
    } else {
        throw new Error('Unrecognized preset file format');
    }

    const failed = [];
    const names = [];
    let imported = 0;
    for (const preset of list) {
        try {
            const saved = await importPreset(preset);
            imported++;
            names.push(saved.name);
        } catch (err) {
            failed.push({ name: preset?.name || '(unnamed)', error: err.message });
        }
    }
    return { imported, names, failed };
}

// ---------------------------------------------------------------------------
// Motion reactivity — frame equation injection
// Shared by the editor (runtime preview) and the player (preset registration).
// ---------------------------------------------------------------------------

/**
 * Build the frame_eqs_str snippet that drives MilkDrop motion reactivity.
 * Returns an empty string when all amounts are zero (no-op preset).
 * @param {object} mr - preset.motionReact object (may be null/undefined)
 */
export function buildMotionReactFrameEqs(mr) {
    const conf = mr || {};
    const srcMap = { bass: 'a.bass', mid: 'a.mid', treb: 'a.treb', vol: 'a.vol', flux: 'a.q31' };
    const src = srcMap[conf.source] || 'a.bass';
    const curve = conf.curve || 'linear';

    const zoomAmt      = Number(conf.zoomAmt      || 0).toFixed(4);
    const rotAmt       = Number(conf.rotAmt        || 0).toFixed(4);
    const warpAmt      = Number(conf.warpAmt       || 0).toFixed(4);
    const warpSpeedAmt = Number(conf.warpSpeedAmt  || 0).toFixed(4);
    const driftXAmt    = Number(conf.driftXAmt     || 0).toFixed(4);
    const driftYAmt    = Number(conf.driftYAmt     || 0).toFixed(4);
    const pulseAmp     = Number(conf.pulseAmp      || 0).toFixed(4);
    const bounceAmp    = Number(conf.bounceAmp     || 0).toFixed(4);
    const shakeAmp     = Number(conf.shakeAmp      || 0).toFixed(4);
    const beatFadeAmp  = Number(conf.beatFadeAmp   || 0).toFixed(4);
    const strobeAmp    = Number(conf.strobeAmp     || 0).toFixed(4);
    const shrink       = conf.shrink ? 1 : 0;

    const hasAny = [zoomAmt, rotAmt, warpAmt, warpSpeedAmt, driftXAmt, driftYAmt,
        pulseAmp, bounceAmp, shakeAmp, beatFadeAmp, strobeAmp]
        .some(v => Math.abs(Number(v)) > 0.00001);
    if (!hasAny) return '';

    let curveExpr = '_mr_raw';
    if (curve === 'squared')   curveExpr = '_mr_raw*_mr_raw';
    else if (curve === 'cubed') curveExpr = '_mr_raw*_mr_raw*_mr_raw';
    else if (curve === 'threshold') curveExpr = 'Math.max(0,Math.min(1,(_mr_raw-0.3)*8))';

    return [
        `var _mr_raw=${src};`,
        `var _mr=${curveExpr};`,
        `a.zoom=Math.max(0.30,Math.min(2.50,a.zoom+_mr*${zoomAmt}));`,
        `a.rot=Math.max(-2.00,Math.min(2.00,a.rot+_mr*${rotAmt}));`,
        `a.warp=Math.max(0.00,Math.min(5.00,a.warp+_mr*${warpAmt}));`,
        `a.warpanimspeed=Math.max(0.05,Math.min(5.00,a.warpanimspeed+_mr*${warpSpeedAmt}));`,
        `a.dx=Math.max(-0.25,Math.min(0.25,a.dx+_mr*${driftXAmt}));`,
        `a.dy=Math.max(-0.25,Math.min(0.25,a.dy+_mr*${driftYAmt}));`,
        `var _pulseDir=${shrink ? '-1.0' : '1.0'};`,
        `a.zoom=Math.max(0.30,Math.min(2.50,a.zoom+(_mr*${pulseAmp}*0.0600*_pulseDir)));`,
        `a.dy=Math.max(-0.25,Math.min(0.25,a.dy+(Math.sin(a.time*16.0)*_mr*${bounceAmp}*0.0200)));`,
        `var _shake=(Math.sin(a.time*57.0)+Math.sin(a.time*91.0))*0.5;`,
        `a.dx=Math.max(-0.25,Math.min(0.25,a.dx+(_shake*_mr*${shakeAmp}*0.0150)));`,
        `a.rot=Math.max(-2.00,Math.min(2.00,a.rot+(_shake*_mr*${shakeAmp}*0.0800)));`,
        `a.decay=Math.max(0.85,a.decay*(1.0-(_mr*${beatFadeAmp}*0.0400)));`,
        `var _strobe=(_mr>0.40)?1.0:0.0;`,
        `a.gammaadj=Math.max(0.50,Math.min(4.00,a.gammaadj*(1.0+(_strobe*${strobeAmp}*0.6000))));`,
    ].join('\n');
}

/**
 * Build the frame_eqs_str snippet that drives wave-only audio reactivity.
 * Mirrors buildMotionReactFrameEqs but modulates wave_a / wave_scale /
 * wave_mystery / wave_x / wave_y instead of motion params. Returns '' when all
 * amounts are zero (no-op preset).
 *
 * Per-target source override: `wr.perSrc` may map an amount key (scaleAmt /
 * opacityAmt / mysteryAmt / orbitAmt) to a source name (bass/mid/treb/vol/flux).
 * Empty string falls back to the global `wr.source`. This is what lets a user
 * pump wave size with bass while morphing shape with treble.
 *
 * @param {object} wr - preset.waveReact object (may be null/undefined)
 */
export function buildWaveReactFrameEqs(wr) {
    const conf = wr || {};
    const srcMap = { bass: 'a.bass', mid: 'a.mid', treb: 'a.treb', vol: 'a.vol', flux: 'a.q31' };
    const globalSrc = srcMap[conf.source] || 'a.bass';
    const curve = conf.curve || 'linear';
    const perSrc = conf.perSrc || {};

    const scaleAmt   = Number(conf.scaleAmt   || 0).toFixed(4);
    const opacityAmt = Number(conf.opacityAmt || 0).toFixed(4);
    const mysteryAmt = Number(conf.mysteryAmt || 0).toFixed(4);
    const orbitAmt   = Number(conf.orbitAmt   || 0).toFixed(4);

    const hasAny = [scaleAmt, opacityAmt, mysteryAmt, orbitAmt]
        .some(v => Math.abs(Number(v)) > 0.00001);
    if (!hasAny) return '';

    // Pick the per-target source expression. Falls back to the global source
    // when no override is set (empty string).
    const srcExpr = (key) => srcMap[perSrc[key]] || globalSrc;

    const curveOf = (rawVar) => {
        if (curve === 'squared')   return `${rawVar}*${rawVar}`;
        if (curve === 'cubed')     return `${rawVar}*${rawVar}*${rawVar}`;
        if (curve === 'threshold') return `Math.max(0,Math.min(1,(${rawVar}-0.3)*8))`;
        return rawVar;
    };

    // Emit one curved value per amount line so a per-target source override
    // takes effect on that line only. Orbit pulls _wrO from its own source.
    return [
        `var _wrS=${curveOf(srcExpr('scaleAmt'))};`,
        `a.wave_scale=Math.max(0.05,Math.min(5.00,a.wave_scale+_wrS*${scaleAmt}));`,
        `var _wrA=${curveOf(srcExpr('opacityAmt'))};`,
        `a.wave_a=Math.max(0.00,Math.min(1.50,a.wave_a+_wrA*${opacityAmt}));`,
        `var _wrM=${curveOf(srcExpr('mysteryAmt'))};`,
        `a.wave_mystery=Math.max(-1.00,Math.min(1.00,a.wave_mystery+_wrM*${mysteryAmt}));`,
        // Orbit traces a small circle around the preset's saved wave_x/wave_y;
        // the radius scales with audio so quiet = sit still, loud = wide circle.
        `var _wrO=${curveOf(srcExpr('orbitAmt'))};`,
        `var _orbR=_wrO*${orbitAmt}*0.15;`,
        `a.wave_x=Math.max(0.00,Math.min(1.00,a.wave_x+Math.cos(a.time*1.7)*_orbR));`,
        `a.wave_y=Math.max(0.00,Math.min(1.00,a.wave_y+Math.sin(a.time*1.7)*_orbR));`,
    ].join('\n');
}
