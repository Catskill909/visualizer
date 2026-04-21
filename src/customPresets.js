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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
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
export function createCustomPreset({
    name,
    baseVals = {},
    shapes = [],
    waves = [],
    warp = '',
    comp = '',
    init_eqs_str = '',
    frame_eqs_str = '',
    pixel_eqs_str = '',
    images = [],
    parentPresetName = null,
}) {
    const id = generateId();
    return saveCustomPreset({
        id,
        name,
        schemaVersion: SCHEMA_VERSION,
        baseVals,
        shapes,
        waves,
        warp,
        comp,
        init_eqs_str,
        frame_eqs_str,
        pixel_eqs_str,
        images,
        parentPresetName,
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
// IndexedDB — image blobs
// ---------------------------------------------------------------------------

async function migrateDB() {
    const oldName = 'discocast_images';
    const newName = 'discocast_images';
    
    // Check if new DB exists or needs migration
    // Simplified: just check if we have an old one and no new one
    // Note: indexedDB.databases() is not supported everywhere, so we just try to open old one.
    return new Promise((resolve) => {
        const req = indexedDB.open(oldName);
        req.onsuccess = async (e) => {
            const oldDb = e.target.result;
            if (oldDb.objectStoreNames.contains('images')) {
                // Try to copy data? This is complex. 
                // For now, let's just stick to the new name and maybe users will have to re-upload.
                // Actually, let's try to keep it simple.
                oldDb.close();
                resolve();
            } else {
                oldDb.close();
                resolve();
            }
        };
        req.onerror = () => resolve();
    });
}

function openImageDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            e.target.result.createObjectStore('images');
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function storeImage(imageId, blob) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').put(blob, imageId);
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e.target.error);
    });
}

export async function getImage(imageId) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readonly');
        const req = tx.objectStore('images').get(imageId);
        req.onsuccess = (e) => resolve(e.target.result || null);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function deleteImage(imageId) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').delete(imageId);
        tx.oncomplete = resolve;
        tx.onerror = (e) => reject(e.target.error);
    });
}

// ---------------------------------------------------------------------------
// Export / Import (JSON, images inlined as data-URLs)
// ---------------------------------------------------------------------------

export async function exportPreset(id) {
    const preset = getCustomPreset(id);
    if (!preset) throw new Error(`Preset ${id} not found`);

    const exported = { ...preset };

    // Inline image blobs as base64 data URLs
    if (preset.images && preset.images.length > 0) {
        exported.images = await Promise.all(
            preset.images.map(async (img) => {
                if (!img.imageId) return img;
                const blob = await getImage(img.imageId);
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

    // Assign a fresh id to avoid collisions
    const id = generateId();
    const images = [];

    for (const img of data.images || []) {
        if (img._inlinedDataUrl) {
            const res = await fetch(img._inlinedDataUrl);
            const blob = await res.blob();
            const newId = generateId();
            await storeImage(newId, blob);
            images.push({ ...img, imageId: newId, _inlinedDataUrl: undefined });
        } else {
            images.push(img);
        }
    }

    return saveCustomPreset({
        ...data,
        id,
        images,
        schemaVersion: SCHEMA_VERSION,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}
