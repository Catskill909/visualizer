/**
 * presetStore.js — Unified IndexedDB preset-metadata store + boot-hydrated cache.
 *
 * WHY THIS EXISTS (milkdrop-pack-import.dev §0, Phase 0):
 * Custom preset *metadata* used to live in localStorage (`discocast_custom_presets`),
 * which has a hard ~5–10 MB wall — a power user hits "Storage full" at a few hundred
 * presets. This store moves metadata into IndexedDB (browser-managed, gigabytes) while
 * keeping the existing synchronous read API working, via an in-memory cache hydrated
 * once at boot.
 *
 * THE CONTRACT (the reason this is safe — do not break it):
 *   • hydrate()      — async, called ONCE in each page's boot BEFORE any preset read.
 *                      Loads all records from IndexedDB into `_cache`. One-time migrates
 *                      pre-existing localStorage records into IDB (idempotent, flag-guarded),
 *                      and LEAVES the old localStorage data intact as a recovery backstop.
 *   • getAllSync()   — SYNC read from cache. Backs loadAllCustomPresets() unchanged.
 *   • getOneSync(id) — SYNC read from cache. Backs getCustomPreset(id) unchanged.
 *   • putRecord(r)   — SYNC cache update + async IDB persist. Backs save/createCustomPreset.
 *   • deleteRecord() — SYNC cache delete + async IDB delete. Backs deleteCustomPreset.
 *
 * Metadata ONLY. Image/video blobs already live in IndexedDB/Tauri FS via
 * customPresets.js storeImage()/getImage() — this module never touches them.
 *
 * IndexedDB is the source of truth once populated. New writes go to IDB (+ cache) only —
 * NOT back to localStorage — which is exactly what lets the library exceed the old wall.
 * The migrated-from localStorage copy becomes inert (hydrate ignores it once IDB is
 * non-empty); a later cleanup phase can delete it once IDB is trusted in production.
 */

const DB_NAME       = 'discocast_presets';
const DB_VERSION    = 1;
const STORE         = 'presets';
const LS_KEY        = 'discocast_custom_presets';
const LS_LEGACY     = 'milkscreen_custom_presets';   // pre-DiscoCast MilkScreen key
const MIGRATED_FLAG = 'dc_presets_migrated_v1';

let _cache = null;      // Map<id, record> — null until first touch
let _hydrated = false;  // true once hydrate() has read IndexedDB
let _dbPromise = null;

// ---------------------------------------------------------------------------
// IndexedDB primitives
// ---------------------------------------------------------------------------

function _openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
    return _dbPromise;
}

function _idbGetAll() {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = (e) => reject(e.target.error);
    }));
}

function _idbPut(record) {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    }));
}

function _idbDelete(id) {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    }));
}

function _idbBulkPut(records) {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const os = tx.objectStore(STORE);
        for (const r of records) os.put(r);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    }));
}

// ---------------------------------------------------------------------------
// localStorage (legacy / migration source only)
// ---------------------------------------------------------------------------

function _readLegacyLocalStorage() {
    try {
        let raw = localStorage.getItem(LS_KEY);
        if (!raw) raw = localStorage.getItem(LS_LEGACY);
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
}

// Safety net: if any code reads/writes before hydrate() ran (shouldn't happen — every
// page hydrates in boot), lazily seed the cache from localStorage so behavior is
// identical to the old code path rather than crashing. hydrate() later overwrites this
// with the IndexedDB source of truth.
function _ensureCache() {
    if (_cache === null) {
        _cache = new Map();
        const ls = _readLegacyLocalStorage();
        for (const [id, rec] of Object.entries(ls)) {
            if (rec && rec.id) _cache.set(rec.id, rec);
            else if (id) _cache.set(id, rec);
        }
        if (Object.keys(ls).length) {
            console.warn('[presetStore] cache used before hydrate(); lazy-seeded from localStorage');
        }
    }
    return _cache;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all preset records from IndexedDB into the in-memory cache. Idempotent.
 * MUST be awaited in each page's boot before the first preset read.
 */
export async function hydrate() {
    if (_hydrated) return;

    let records = [];
    try {
        records = await _idbGetAll();
    } catch (e) {
        console.warn('[presetStore] IndexedDB read failed; will fall back to localStorage:', e);
    }

    // One-time migration: IDB empty AND we haven't migrated yet → pull from localStorage.
    if (records.length === 0 && !localStorage.getItem(MIGRATED_FLAG)) {
        const list = Object.values(_readLegacyLocalStorage()).filter(r => r && r.id);
        if (list.length) {
            try {
                await _idbBulkPut(list);
                records = list;
                console.log(`[presetStore] Migrated ${list.length} custom preset(s) localStorage→IndexedDB`);
            } catch (e) {
                // IDB write failed — keep serving from the localStorage copy so the user
                // loses nothing; don't set the flag, so we retry the migration next boot.
                console.error('[presetStore] Migration write failed; serving from localStorage:', e);
                records = list;
            }
        }
        // Mark migrated only if the write path didn't throw (or there was nothing to migrate).
        if (records.length === list.length) {
            try { localStorage.setItem(MIGRATED_FLAG, String(Date.now())); } catch { /* non-fatal */ }
        }
    }

    _cache = new Map();
    for (const r of records) {
        if (r && r.id) _cache.set(r.id, r);
    }
    _hydrated = true;
}

/** Whether hydrate() has completed (IndexedDB read done). */
export function isHydrated() {
    return _hydrated;
}

// Return a fresh deep copy so callers can mutate freely without polluting the cache.
// This restores the EXACT pre-Phase-0 semantics: loadAllCustomPresets() used to do
// JSON.parse(localStorage…), handing out a fresh object every call. Critically,
// visualizer.refreshCustomPresets() MUTATES the record in place (appends reactBlock /
// anim eqs to frame_eqs_str, overwrites warp) — with reference-sharing that accumulated
// on every refresh and corrupted the compiled equations. Cloning on read also strips any
// stray function field, mirroring the old JSON round-trip.
function _clone(rec) {
    try { return JSON.parse(JSON.stringify(rec)); }
    catch { return rec; }
}

/** All records as a plain `{ [id]: record }` object (sync, fresh deep clones). */
export function getAllSync() {
    const cache = _ensureCache();
    const out = {};
    for (const [id, rec] of cache) out[id] = _clone(rec);
    return out;
}

/** One record by id (sync, fresh deep clone) or null. */
export function getOneSync(id) {
    const rec = _ensureCache().get(id);
    return rec ? _clone(rec) : null;
}

/**
 * Upsert a record: cache update is synchronous (so callers can use it immediately);
 * IndexedDB persist is async. IDB quota is effectively unlimited, so a quota failure
 * here is unexpected — logged loudly rather than thrown (the caller already returned).
 */
export function putRecord(record) {
    // IndexedDB persists via the structured-clone algorithm, which throws DataCloneError
    // on functions (some preset entries carry derived animation closures). The old
    // localStorage path used JSON.stringify, which silently dropped them — so we mirror
    // that EXACTLY: store a JSON-clean copy in both the cache and IDB. This keeps the
    // persisted + cached shape byte-identical to the pre-Phase-0 behaviour.
    let clean;
    try {
        clean = JSON.parse(JSON.stringify(record));
    } catch (e) {
        console.error('[presetStore] preset not JSON-serializable; storing raw (may fail to persist):', e);
        clean = record;
    }
    _ensureCache().set(clean.id, clean);
    _idbPut(clean).catch((e) => {
        if (e && e.name === 'QuotaExceededError') {
            console.error('[presetStore] IndexedDB quota exceeded on put — preset is in memory but may not persist:', e);
        } else {
            console.error('[presetStore] IndexedDB put failed:', e);
        }
    });
}

/** Delete a record: sync cache delete + async IndexedDB delete. */
export function deleteRecord(id) {
    _ensureCache().delete(id);
    _idbDelete(id).catch((e) => console.error('[presetStore] IndexedDB delete failed:', e));
}
