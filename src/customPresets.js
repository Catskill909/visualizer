/**
 * customPresets.js — Custom Preset Storage
 *
 * Metadata:  IndexedDB `discocast_presets` via presetStore.js (boot-hydrated cache).
 *            Migrated off localStorage `discocast_custom_presets` in Phase 0 — see
 *            milkdrop-pack-import.md §0. The public CRUD API below is UNCHANGED in
 *            signature; it now reads/writes the cache instead of localStorage, so the
 *            ~5–10 MB preset wall is gone.
 * Blobs:     IndexedDB `discocast_images` (or Tauri FS) — image/video blob per imageId.
 *
 * Registry key format: `custom:<id>:<name>`
 * Drawer shows just `name`; engine uses the full key.
 */

import * as presetStore from './presetStore.js';

// Re-export so each page's boot can `import { hydratePresets } from './customPresets.js'`
// (or '../customPresets.js') and await it before the first preset read.
export const hydratePresets = presetStore.hydrate;

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
    // Reads the boot-hydrated cache (presetStore). Sync — signature unchanged.
    // The legacy localStorage→IndexedDB migration now lives in presetStore.hydrate().
    return presetStore.getAllSync();
}

export function getCustomPreset(id) {
    return presetStore.getOneSync(id);
}

export function saveCustomPreset(preset) {
    const record = { ...preset, updatedAt: Date.now() };
    // Cache update is synchronous, so the returned record is immediately authoritative
    // for callers (e.g. inspector.saveCurrent). IndexedDB persist is async inside
    // presetStore. IDB quota is effectively unlimited, so the old localStorage
    // QuotaExceededError wall no longer applies (that was the whole point of Phase 0).
    presetStore.putRecord(record);
    return record;
}

export function deleteCustomPreset(id) {
    presetStore.deleteRecord(id);
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

// ---------------------------------------------------------------------------
// Motion Engine — autonomous, time-driven generative motion (frame_eqs).
// Unlike motionReact (audio-driven), these breathe on `a.time` alone, layering
// a *living* baseline of motion on top of otherwise-static baseVals — the first
// from-scratch control that reaches the frame_eqs engine layer. Additive +
// clamped, so an engine composes with any base preset's own frame_eqs instead
// of fighting them. Shared by editor (inspector._buildRuntimePreset) and player
// (visualizer.refreshCustomPresets) — single source of truth, byte-identical in
// every runtime. See milkdrop-tools-dev.md §7.
// ---------------------------------------------------------------------------

const _engZoom = (e) => `a.zoom=Math.max(0.30,Math.min(2.50,${e}));`;
const _engRot  = (e) => `a.rot=Math.max(-2.00,Math.min(2.00,${e}));`;
const _eng01   = (f, e) => `a.${f}=Math.max(0.00,Math.min(1.00,${e}));`;

// Each engine: { id, name, desc, eqs(speed, depth) -> [lines] }. Two universal
// knobs only — Speed (oscillation rate) + Depth (amount). 'none' has no eqs.
export const MOTION_ENGINES = [
    { id: 'none', name: 'None', desc: 'Static base' },
    {
        id: 'breathe', name: 'Breathe', desc: 'Pulsing zoom',
        eqs: (sp, dp) => [
            _engZoom(`a.zoom+Math.sin(a.time*${sp.toFixed(4)})*${(dp * 0.04).toFixed(4)}`),
        ],
    },
    {
        id: 'sway', name: 'Sway', desc: 'Drifting center',
        eqs: (sp, dp) => [
            _eng01('cx', `a.cx+Math.sin(a.time*${sp.toFixed(4)})*${(dp * 0.12).toFixed(4)}`),
            _eng01('cy', `a.cy+Math.cos(a.time*${(sp * 0.8).toFixed(4)})*${(dp * 0.12).toFixed(4)}`),
        ],
    },
    {
        id: 'spin', name: 'Spin', desc: 'Rocking rotation',
        eqs: (sp, dp) => [
            _engRot(`a.rot+Math.sin(a.time*${sp.toFixed(4)})*${(dp * 0.15).toFixed(4)}`),
        ],
    },
];

/**
 * Build the frame_eqs_str snippet for the active Motion Engine. Returns '' when
 * id is 'none'/missing or depth is 0 — so blank presets stay byte-identical.
 * @param {object} me - preset.motionEngine { id, speed, depth } (may be null)
 */
export function buildMotionEngineFrameEqs(me) {
    const conf = me || {};
    if (!conf.id || conf.id === 'none') return '';
    const def = MOTION_ENGINES.find(e => e.id === conf.id);
    if (!def || !def.eqs) return '';
    const speed = Number(conf.speed ?? 1);
    const depth = Number(conf.depth ?? 0.5);
    if (!(depth > 0.00001)) return '';
    return def.eqs(speed, depth).join('\n');
}

// ─── Flow Style — per-preset warp shaders (milkdrop-tools-dev.md Phase 7) ───────
// The warp shader is the per-pixel motion FIELD — the signature tunnel/spiral/
// ripple look 85% of bundled presets get from a custom warp. We author it as the
// preset's OWN `warp` string (isolated, recompiled per preset load), so it can't
// touch any other preset — same proven pattern as our comp shader. The warp
// shader_body gets: `uv` (already mesh-warped by zoom/rot/warp/cx/cy → flows
// compose with the Motion sliders for free), `uv_orig`, `rad`, `ang`, `time`,
// `bass/mid/treb`, `q1..q32`, `decay`, samplers. It writes `vec3 ret`. Each style
// samples the previous frame at uv + a per-style displacement, faded by `decay`
// (matches the engine's no-shader fallback so Trail still controls smear).
export const WARP_STYLES = [
    { id: 'none',    name: 'None',        desc: 'Default warp' },
    { id: 'tunnel',  name: 'Tunnel',      desc: 'Rushing depth' },
    { id: 'spiral',  name: 'Spiral',      desc: 'Twisting in' },
    { id: 'ripple',  name: 'Ripple',      desc: 'Liquid rings' },
    { id: 'swirl',   name: 'Swirl',       desc: 'Whirlpool' },
    { id: 'plasma',  name: 'Plasma',      desc: 'Flowing noise' },
    { id: 'liquid',  name: 'Liquid',      desc: 'Slow drift' },
    { id: 'kaleido', name: 'Kaleido',     desc: 'Mirror fold' },
    // Phase 15 — Soft/Broad flows: sample the BLURRED feedback so high-decay fill
    // reads as soft glow, not thin threads (breaks the "string" look).
    { id: 'bloom',   name: 'Bloom',       desc: 'Soft glow' },
    { id: 'smoke',   name: 'Smoke',       desc: 'Broad drift' },
    { id: 'melt',    name: 'Melt',        desc: 'Slow melt' },
];

/**
 * Build a per-preset warp shader for the active Flow Style. Returns '' when id is
 * 'none'/missing → the preset keeps its own `warp` (from-scratch = engine default;
 * bundled = its own) → byte-identical when unused. Knobs baked as literals.
 * Shared by editor (_buildRuntimePreset) and player (refreshCustomPresets).
 * @param {object} flow - preset.flowStyle { id, speed, depth } (may be null)
 */
/**
 * Shared per-flow GLSL parts for a flow style. Returns `{ pre, fbExpr }` where
 * `pre` is the statement block that sets up the warp (centre vectors, the per-style
 * `_flow` displacement, the density zoom `_zuv` — or, for kaleido, the folded
 * `_kuv`) and `fbExpr` is the vec3 expression that samples the warped/decayed
 * feedback. Both `buildWarpShader` (Flow Style) and `buildImageWarp`
 * (image-as-texture) compose around this so the motion math has ONE source of
 * truth. Returns null for none/unknown ids.
 *
 * `_c`/`_r` = vector/distance from centre; `ang`/`time` provided by the engine.
 * Density bakes a gentle per-frame zoom-out-of-centre (_zuv): content magnifies
 * outward and accumulates through the feedback loop → thin lines bloom into a
 * full field (MilkDrop's real screen-fill mechanic). 0 = no zoom, 1 ≈ 3%/frame.
 */
function _flowParts(flow) {
    const f = flow || {};
    if (!f.id || f.id === 'none') return null;
    const sp = Number(f.speed ?? 1).toFixed(4);
    const dp = Number(f.depth ?? 0.5).toFixed(4);
    const dn = Number(f.density ?? 0.5).toFixed(4);
    const head = '  vec2 _c = uv_orig - 0.5;\n  float _r = length(_c) + 1e-4;\n';
    const zoom = `  float _z = ${dn} * 0.03;\n  vec2 _zuv = (uv - 0.5) * (1.0 - _z) + 0.5;\n`;
    // Hard flows sample the previous frame at the mesh-warped `uv` plus a per-style
    // displacement, faded by `decay` (so the Trail slider still controls smear).
    const hardExpr = 'texture(sampler_main, _zuv + _flow).rgb * decay';
    // Soft flows (Phase 15): sample mostly the BLURRED feedback (sampler_blur1) so the
    // high-decay fill accumulates as soft broad glow instead of sharp threads. Mixing
    // in a little sharp keeps some structure. Referencing sampler_blur1 makes the
    // engine auto-run the blur pass (getHighestBlur scans the warp text).
    const softExpr = 'mix(texture(sampler_main, _zuv + _flow), texture(sampler_blur1, _zuv + _flow), 0.8).rgb * decay';
    const std = (body, soft) => ({ pre: `${head}${body}\n${zoom}`, fbExpr: soft ? softExpr : hardExpr });
    switch (f.id) {
        case 'tunnel':
            // Radial push + a gentle perpendicular swirl, oscillating on time*speed
            // → content rushes through a tunnel.
            return std(
                `  float _pull = ${dp} * 0.05 * (0.6 + 0.4 * sin(time * ${sp} * 0.7));\n` +
                `  vec2 _flow = (_c / _r) * _pull + vec2(-_c.y, _c.x) * ${dp} * 0.03;`,
                false
            );
        case 'spiral':
            // Rotation that grows with radius + slight inward pull → spirals inward.
            return std(
                `  float _t = time * ${sp} * 0.5;\n` +
                `  vec2 _flow = vec2(-_c.y, _c.x) * ${dp} * 0.06 * (0.7 + 0.3 * sin(_t)) + (_c / _r) * ${dp} * 0.02;`,
                false
            );
        case 'ripple':
            // Concentric waves: radial displacement modulated by sin(rad - time).
            return std(
                `  float _w = sin(_r * 22.0 - time * ${sp} * 2.0) * ${dp} * 0.02;\n` +
                `  vec2 _flow = (_c / _r) * _w;`,
                false
            );
        case 'swirl':
            // Whirlpool — rotation stronger near the centre (1/(_r+k)).
            return std(
                `  vec2 _flow = vec2(-_c.y, _c.x) * (${dp} * 0.05 / (_r + 0.18)) * (0.8 + 0.2 * sin(time * ${sp} * 0.4));`,
                false
            );
        case 'plasma':
            // Higher-frequency sin/cos field → flowing plasma displacement.
            return std(
                `  vec2 _flow = vec2(\n` +
                `    sin(uv_orig.y * 11.0 + time * ${sp} * 1.3),\n` +
                `    cos(uv_orig.x * 11.0 + time * ${sp} * 1.1)\n` +
                `  ) * ${dp} * 0.014;`,
                false
            );
        case 'liquid':
            // Low-frequency domain-warped sin → slow, smooth liquid drift.
            return std(
                `  vec2 _flow = vec2(\n` +
                `    sin((uv_orig.y + time * ${sp} * 0.10) * 5.0),\n` +
                `    sin((uv_orig.x + time * ${sp} * 0.13) * 5.0)\n` +
                `  ) * ${dp} * 0.022;`,
                false
            );
        case 'bloom':
            // Gentle outward push, blur-sampled → soft blooming glow that fills.
            return std(`  vec2 _flow = (_c / _r) * ${dp} * 0.02;`, true);
        case 'smoke':
            // Turbulent low-frequency domain warp, blur-sampled → broad drifting smoke.
            return std(
                `  vec2 _flow = vec2(\n` +
                `    sin(uv_orig.y * 3.5 + time * ${sp} * 0.4) + 0.5 * sin(uv_orig.x * 6.0 - time * ${sp} * 0.3),\n` +
                `    cos(uv_orig.x * 3.5 + time * ${sp} * 0.35) + 0.5 * cos(uv_orig.y * 6.0 + time * ${sp} * 0.25)\n` +
                `  ) * ${dp} * 0.016;`,
                true
            );
        case 'melt':
            // Slow downward drift + horizontal wobble, blur-sampled → melting flow.
            return std(
                `  vec2 _flow = vec2(sin(uv_orig.x * 4.0 + time * ${sp} * 0.2) * ${dp} * 0.01, ${dp} * 0.018);`,
                true
            );
        case 'kaleido':
            // Mirror-fold kaleidoscope — the proven scene-mirror fold: recompute the
            // angle/radius from centre, reflect into N sectors, reconstruct the sample
            // UV with cos/sin·radius. Depth → sector count (2→12); Speed → slow spin.
            // Samples the reconstructed coord directly (a kaleido is its own field).
            return {
                pre:
                    `  vec2 _kp = uv_orig - 0.5;\n` +
                    `  float _kang = atan(_kp.y, _kp.x) + time * ${sp} * 0.15;\n` +
                    `  float _krad = length(_kp);\n` +
                    `  float _kseg = 6.2831853 / (2.0 + floor(${dp} * 10.0));\n` +
                    `  float _ka = mod(_kang, _kseg);\n` +
                    `  if (_ka > _kseg * 0.5) _ka = _kseg - _ka;\n` +
                    `  vec2 _kuv = vec2(cos(_ka), sin(_ka)) * _krad * (1.0 - ${dn} * 0.03) + 0.5;\n`,
                fbExpr: 'texture(sampler_main, _kuv).rgb * decay'
            };
        default:
            return null;
    }
}

export function buildWarpShader(flow) {
    const p = _flowParts(flow);
    if (!p) return '';
    return `shader_body {\n${p.pre}  ret = ${p.fbExpr};\n}`;
}

/**
 * Image-as-texture (image-texture-dev.md Phase 1). Build a warp shader that melts a
 * user image INTO the preset's feedback loop: it runs a flow-style displacement on
 * the previous frame (`fbExpr`, the melt/tunnel/etc.) AND re-injects the user texture
 * `sampler_<imgName>` each frame, so the preset's own motion engine then warps/decays
 * the image. Reuses the SAME flow math as buildWarpShader via `_flowParts`.
 *
 * @param {object} opts
 *   imgName  – the user-texture name uploaded via visualizer.setUserTexture (→ sampler_<imgName>)
 *   flow     – flow-style id for the melt motion (tunnel/spiral/ripple/liquid/melt/kaleido/…); default 'liquid'
 *   reseed   – 0..1 per-frame image injection. High = image stays sharp/present;
 *              low = faint seed that melts into the feedback over time. Default 0.2.
 *   audioSource – optional engine audio uniform to drive the injection on the beat
 *              (bass/mid/treb/vol + _att variants). When set, `reseed` becomes the
 *              baseline and the image pulses in around it. Omit/`'none'` = static.
 *   audioAmt – 0..~1 strength of the audio modulation (default 0.5 when a source is set).
 *   speed/depth/density – passed through to the flow math (optional).
 * @returns {string} warp shader_body, or '' for an unknown flow.
 */
// Whitelisted engine audio uniforms (butterchurn warp/comp shader header) — these
// are normalized ~1.0 at average, so `(src - 1.0)` is the beat deviation. Gated to
// prevent arbitrary text reaching the generated GLSL.
const _AUDIO_SOURCES = new Set(['bass', 'mid', 'treb', 'vol', 'bass_att', 'mid_att', 'treb_att', 'vol_att']);

export function buildImageWarp(opts) {
    const o = opts || {};
    // Sampler names are bare identifiers in GLSL — strip anything that isn't one.
    const imgName = String(o.imgName || 'userimg').replace(/[^a-zA-Z0-9_]/g, '') || 'userimg';
    const base = Number(o.reseed ?? 0.2);
    const flowId = (o.flow && o.flow !== 'none') ? o.flow : 'liquid';
    const p = _flowParts({ id: flowId, speed: o.speed, depth: o.depth, density: o.density });
    if (!p) return '';
    // Audio-reactive injection: pulse the image presence around `base` on the beat.
    const src = o.audioSource && o.audioSource !== 'none' ? String(o.audioSource) : null;
    const reseed = (src && _AUDIO_SOURCES.has(src))
        ? `clamp(${base.toFixed(4)} + ${Number(o.audioAmt ?? 0.5).toFixed(4)} * (${src} - 1.0), 0.0, 1.0)`
        : base.toFixed(4);
    // The user sampler MUST be declared in the shader HEADER (before shader_body):
    // butterchurn's getShaderParts splits on `shader_body`, scans the header with
    // /uniform sampler2D sampler_(.+?);/ (getUserSamplers), and uses that list BOTH to
    // declare the GLSL uniform AND to bind our uploaded texture each frame. Omit it and
    // sampler_<name> is an undeclared identifier → warp fails to compile → black frame.
    return `uniform sampler2D sampler_${imgName};\nshader_body {\n${p.pre}` +
        `  vec3 _fb = ${p.fbExpr};\n` +
        `  vec3 _img = texture(sampler_${imgName}, uv_orig).rgb;\n` +
        `  ret = mix(_fb, _img, ${reseed});\n}`;
}

/**
 * Build a custom shape's frame_eqs_str from its motion (time-driven) and react
 * (audio-driven) params (Phase 3 — milkdrop-tools-dev.md §9). Base values are
 * baked in as LITERALS (not `a.rad*…`) because a shape's eq context can persist
 * frame-to-frame — reading the live field would compound into runaway. Each
 * field has exactly one owner (no `a.field=` collisions): ang←Spin, x/y←Orbit,
 * rad←Size-react, a←Opacity-react. Returns '' when nothing is active.
 * Shared by editor (_buildRuntimePreset) and player (refreshCustomPresets).
 * @param {object} baseVals - the shape's baseVals (x, y, rad, ang, a, …)
 * @param {object} motion   - { spin, orbit } time-driven (may be null)
 * @param {object} react    - { source, curve, sizeAmt, opacityAmt, perSrc } audio-driven (may be null)
 */
export function buildShapeMotionEqs(baseVals, motion, react) {
    const m = motion || {};
    const r = react || {};
    const bv = baseVals || {};
    const baseAng = Number(bv.ang ?? 0);
    const baseRad = Number(bv.rad ?? 0.15);
    const baseX = Number(bv.x ?? 0.5);
    const baseY = Number(bv.y ?? 0.5);
    const baseA = Number(bv.a ?? 1);
    const baseSides = Number(bv.sides ?? 4);

    const spin = Number(m.spin || 0);
    const orbit = Number(m.orbit || 0);

    const srcMap = { bass: 'a.bass', mid: 'a.mid', treb: 'a.treb', vol: 'a.vol', flux: 'a.q31' };
    const globalSrc = srcMap[r.source] || 'a.bass';
    const curve = r.curve || 'linear';
    const perSrc = r.perSrc || {};
    // Curved per-target signal: each react slider may override the global source.
    const sig = (key) => {
        const raw = srcMap[perSrc[key]] || globalSrc;
        if (curve === 'squared') return `${raw}*${raw}`;
        if (curve === 'cubed') return `${raw}*${raw}*${raw}`;
        if (curve === 'threshold' || curve === 'gate') return `Math.max(0,Math.min(1,(${raw}-0.3)*8))`;
        return raw;
    };
    const amt = (k) => Number(r[k] || 0);
    const on = (v) => Math.abs(v) > 1e-5;
    const sizeAmt = amt('sizeAmt'), opacityAmt = amt('opacityAmt');
    const spinAmt = amt('spinAmt'), shakeAmt = amt('shakeAmt'), sidesAmt = amt('sidesAmt');

    if (!(on(spin) || orbit > 1e-5 || on(sizeAmt) || on(opacityAmt) || on(spinAmt) || on(shakeAmt) || on(sidesAmt))) {
        return '';
    }

    const lines = [];

    // ── ANGLE: time-Spin (continuous) + beat-Spin (kick), merged into one assign ──
    if (on(spin) || on(spinAmt)) {
        let e = `${baseAng.toFixed(4)}`;
        if (on(spin)) e += `+a.time*${spin.toFixed(4)}`;
        if (on(spinAmt)) e += `+${sig('spinAmt')}*${spinAmt.toFixed(4)}*1.5`;
        lines.push(`a.ang=${e};`);
    }

    // ── POSITION: time-Orbit (circle) + beat-Shake (jitter), merged ──
    if (orbit > 1e-5 || on(shakeAmt)) {
        let ex = `${baseX.toFixed(4)}`, ey = `${baseY.toFixed(4)}`;
        if (orbit > 1e-5) {
            const o = (orbit * 0.30).toFixed(4);
            ex += `+Math.cos(a.time*1.30)*${o}`;
            ey += `+Math.sin(a.time*1.30)*${o}`;
        }
        if (on(shakeAmt)) {
            const s = sig('shakeAmt'), k = (shakeAmt * 0.12).toFixed(4);
            ex += `+(Math.sin(a.time*37.0)+Math.sin(a.time*53.0))*0.5*${s}*${k}`;
            ey += `+(Math.sin(a.time*41.0)+Math.sin(a.time*59.0))*0.5*${s}*${k}`;
        }
        lines.push(`a.x=Math.max(0.00,Math.min(1.00,${ex}));`);
        lines.push(`a.y=Math.max(0.00,Math.min(1.00,${ey}));`);
    }

    // ── SIZE (rad): floored so a negative amount shrinks but never zeroes ──
    if (on(sizeAmt)) {
        lines.push(`a.rad=Math.max(0.001,Math.min(2.50,${baseRad.toFixed(4)}*Math.max(0.05,1.0+${sig('sizeAmt')}*${sizeAmt.toFixed(4)})));`);
    }
    // ── OPACITY (a + matched edge a2) ──
    if (on(opacityAmt)) {
        lines.push(`a.a=Math.max(0.00,Math.min(1.00,${baseA.toFixed(4)}*(1.0+${sig('opacityAmt')}*${opacityAmt.toFixed(4)})));`);
        lines.push(`a.a2=a.a;`);
    }
    // ── SIDES morph (integer, clamped to the slider range) ──
    if (on(sidesAmt)) {
        lines.push(`a.sides=Math.max(3,Math.min(64,Math.round(${baseSides}+${sig('sidesAmt')}*${sidesAmt.toFixed(4)}*16.0)));`);
    }
    return lines.join('\n');
}

// Max number of image/video/text layers a preset can hold. Mirrors MAX_LAYERS
// in the editor (inspector.js); both must stay equal so q-slots line up.
export const MAX_ANIM_LAYERS = 5;

/**
 * Build the frame_eqs_str snippet that copies window.__dcAnim[i] into each
 * layer's q-register tuple (q{i*5+1 .. i*5+5}). This is the bridge that carries
 * GSAP-driven entrance / exit / idle animation values (animation.js) into the
 * comp shader, where the baked literals are wrapped as `(op * q1)`, `(cx + q3)`
 * etc. (see animation-dev.md § P0-B).
 *
 * SINGLE SOURCE OF TRUTH: the editor (inspector._buildRuntimePreset) and the
 * player / timeline (visualizer.refreshCustomPresets) both call this so the
 * injected lines are byte-identical and animations play the same way in every
 * runtime. Missing global or slot → neutral (1.0 multiplier, 0.0 offset), which
 * is byte-equivalent to an un-animated baked preset.
 */
export function buildAnimFrameEqs() {
    const parts = [];
    for (let i = 0; i < MAX_ANIM_LAYERS; i++) {
        const b = i * 5 + 1;
        const has = `(typeof __dcAnim!=="undefined"&&__dcAnim[${i}])`;
        parts.push(
            `a.q${b + 0}=${has}?__dcAnim[${i}].opacity:1;`,
            `a.q${b + 1}=${has}?__dcAnim[${i}].scale:1;`,
            `a.q${b + 2}=${has}?__dcAnim[${i}].cxOffset:0;`,
            `a.q${b + 3}=${has}?__dcAnim[${i}].cyOffset:0;`,
            `a.q${b + 4}=${has}?__dcAnim[${i}].blur:0;`
        );
    }
    return parts.join('');
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
