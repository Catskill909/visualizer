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
const DB_VERSION    = 2;   // v2: added community + community_packs stores (Phase 1)
const STORE         = 'presets';
// Community packs (milkdrop-pack-import.dev Phase 1 / §13): downloaded preset packs.
// IndexedDB-ONLY on every platform (incl. Tauri) — packs are re-downloadable, so eviction
// just means reinstall, not data loss → no native-FS mirror needed (§13.2).
const COMMUNITY_STORE = 'community';        // key: `community:<packId>:<name>`, value: {key, packId, preset}
const PACKS_STORE     = 'community_packs';  // key: packId, value: pack metadata
export const COMMUNITY_PREFIX = 'community:'; // registry-key namespace for community presets
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
            // v2 — community pack stores (added without touching the existing `presets` store)
            if (!db.objectStoreNames.contains(COMMUNITY_STORE)) {
                const cs = db.createObjectStore(COMMUNITY_STORE, { keyPath: 'key' });
                cs.createIndex('packId', 'packId', { unique: false }); // for fast per-pack delete
            }
            if (!db.objectStoreNames.contains(PACKS_STORE)) {
                db.createObjectStore(PACKS_STORE, { keyPath: 'id' });
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
// Tauri native filesystem (desktop app — eviction-proof metadata; Phase 4)
// ---------------------------------------------------------------------------
// On the macOS/Windows desktop apps, WKWebView/WebView2 can evict IndexedDB under
// storage pressure, so the FILESYSTEM is authoritative for metadata there. Mirrors
// the proven blob pattern in customPresets.js. Web/Windows-web have no window.__TAURI__
// and take the IndexedDB path above, unchanged.

const _isTauri = () => typeof window !== 'undefined' && !!window.__TAURI__;

function _tauriStorePreset(record) {
    return window.__TAURI__.invoke('store_preset', { id: record.id, json: JSON.stringify(record) });
}
function _tauriGetAll() {
    return window.__TAURI__.invoke('get_all_presets'); // → string[] of JSON
}
function _tauriDelete(id) {
    return window.__TAURI__.invoke('delete_preset', { id });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all preset records into the in-memory cache. Idempotent. MUST be awaited in
 * each page's boot before the first preset read. On desktop (Tauri) the native FS is
 * the source of truth; on web it's IndexedDB.
 */
export async function hydrate() {
    if (_hydrated) return;

    if (_isTauri()) {
        await _hydrateTauri();
        return;
    }

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

// Desktop hydrate: FS authoritative. First run with the FS mirror has an empty FS, so
// migrate from the best available source (IndexedDB from the web/Phase-0 path, else the
// raw localStorage snapshot) and write each record to disk. IDB + localStorage are left
// intact as backstops (never deleted here).
async function _hydrateTauri() {
    let records = [];
    try {
        const jsons = await _tauriGetAll();
        records = (jsons || [])
            .map(j => { try { return JSON.parse(j); } catch { return null; } })
            .filter(r => r && r.id);
    } catch (e) {
        console.warn('[presetStore] Tauri get_all_presets failed:', e);
    }

    if (records.length === 0) {
        let source = [];
        try { source = (await _idbGetAll()).filter(r => r && r.id); } catch { /* ignore */ }
        if (source.length === 0) {
            source = Object.values(_readLegacyLocalStorage()).filter(r => r && r.id);
        }
        if (source.length) {
            let written = 0;
            for (const r of source) {
                try { await _tauriStorePreset(r); written++; }
                catch (e) { console.error('[presetStore] Tauri migrate write failed for', r.id, e); }
            }
            records = source;
            console.log(`[presetStore] Migrated ${written}/${source.length} preset(s) → Tauri FS`);
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

    if (_isTauri()) {
        // Desktop: FS is authoritative (eviction-proof). Plain-JSON, no base64.
        _tauriStorePreset(clean).catch((e) => console.error('[presetStore] Tauri store_preset failed:', e));
        return;
    }
    _idbPut(clean).catch((e) => {
        if (e && e.name === 'QuotaExceededError') {
            console.error('[presetStore] IndexedDB quota exceeded on put — preset is in memory but may not persist:', e);
        } else {
            console.error('[presetStore] IndexedDB put failed:', e);
        }
    });
}

/** Delete a record: sync cache delete + async persist (native FS on desktop, else IDB). */
export function deleteRecord(id) {
    _ensureCache().delete(id);
    if (_isTauri()) {
        _tauriDelete(id).catch((e) => console.error('[presetStore] Tauri delete_preset failed:', e));
        return;
    }
    _idbDelete(id).catch((e) => console.error('[presetStore] IndexedDB delete failed:', e));
}

// ---------------------------------------------------------------------------
// Community packs — downloaded preset packs (Phase 1 / §13)
// IndexedDB-only on every platform (re-downloadable → no FS mirror, §13.2). These are raw
// Butterchurn JSON; the engine registers them like BUNDLED presets, so they NEVER go through
// the custom cache / refreshCustomPresets eq-loop (§13.1).
// ---------------------------------------------------------------------------

/**
 * Bulk-store community presets in a single transaction.
 * @param {{key:string, packId:string, preset:object}[]} entries
 */
export function storeCommunityBatch(entries) {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(COMMUNITY_STORE, 'readwrite');
        const os = tx.objectStore(COMMUNITY_STORE);
        for (const e of entries) os.put(e);
        tx.oncomplete = () => resolve();
        tx.onerror = (ev) => reject(ev.target.error);
    }));
}

/** All community records → [{ key, packId, preset }]. Used by engine.loadCommunityPresets(). */
export function loadAllCommunity() {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(COMMUNITY_STORE, 'readonly');
        const req = tx.objectStore(COMMUNITY_STORE).getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = (e) => reject(e.target.error);
    }));
}

/** Delete every community preset belonging to a pack (via the packId index). Resolves to count. */
export function deletePackPresets(packId) {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(COMMUNITY_STORE, 'readwrite');
        const cursorReq = tx.objectStore(COMMUNITY_STORE).index('packId').openCursor(IDBKeyRange.only(packId));
        let n = 0;
        cursorReq.onsuccess = (e) => {
            const cur = e.target.result;
            if (cur) { cur.delete(); n++; cur.continue(); }
        };
        tx.oncomplete = () => resolve(n);
        tx.onerror = (e) => reject(e.target.error);
    }));
}

// --- Installed-pack metadata ---

/** Record/replace a pack's metadata. @param {{id:string, name, presetCount, installedAt, ...}} meta */
export function recordPack(meta) {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(PACKS_STORE, 'readwrite');
        tx.objectStore(PACKS_STORE).put(meta);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    }));
}

/** All installed pack metadata → PackMeta[]. */
export function listInstalledPacks() {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(PACKS_STORE, 'readonly');
        const req = tx.objectStore(PACKS_STORE).getAll();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror = (e) => reject(e.target.error);
    }));
}

/** Remove a pack's metadata row (call deletePackPresets separately for its presets). */
export function removePack(packId) {
    return _openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(PACKS_STORE, 'readwrite');
        tx.objectStore(PACKS_STORE).delete(packId);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
    }));
}
