/**
 * timelineStorage.js — Timeline CRUD
 *
 * localStorage key: discocast_timelines  { [id]: Timeline }
 * No IndexedDB — timelines only reference preset names, no blobs.
 *
 * exportTimelineBundle / importTimelineBundle handle timelines that reference
 * custom presets (keys like `custom:<id>:<name>`).  The bundle format is:
 *   { formatVersion: 1, exportedAt: ISO, timeline: {...}, customPresets: [...] }
 * Custom preset image blobs are inlined as base64 data-URLs by customPresets.js.
 */

const STORAGE_KEY = 'discocast_timelines';

export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultZone() {
    return {
        id: 'full',
        name: 'Full',
        color: '#7c6fcd',
        region: { x: 0, y: 0, width: 1, height: 1 },
        opacity: 1,
        blendMode: 'normal',
        zIndex: 0,
        gapBehavior: 'black',
    };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function loadAllTimelines() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

export function getTimeline(id) {
    return loadAllTimelines()[id] || null;
}

export function saveTimeline(timeline) {
    const all = loadAllTimelines();
    // eslint-disable-next-line no-unused-vars
    const { _presetImport: _dropped, ...clean } = timeline; // strip transient side-channel prop
    const record = { ...clean, updatedAt: Date.now() };
    all[record.id] = record;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    // Re-attach the transient summary so the caller can still read it
    if (timeline._presetImport) record._presetImport = timeline._presetImport;
    return record;
}

export function deleteTimeline(id) {
    const all = loadAllTimelines();
    delete all[id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * Create a new blank timeline with a single Full zone.
 * Returns an in-memory record — NOT persisted until saveTimeline() is called.
 */
export function createTimeline(name = 'Untitled Timeline') {
    const id = generateId();
    const now = Date.now();
    return {
        id,
        name,
        schemaVersion: 2,
        zones: [defaultZone()],
        entries: [],
        markers: [],
        loop: false,
        totalDuration: 0,
        defaultDuration: 30,
        defaultBlendTime: 2,
        bpm: null,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * One-time cleanup: remove timelines that look like auto-saved junk —
 * default name AND no entries. Returns the number removed.
 */
export function pruneEmptyUntitled() {
    const all = loadAllTimelines();
    let removed = 0;
    for (const id of Object.keys(all)) {
        const tl = all[id];
        if (tl.name === 'Untitled Timeline' && (!tl.entries || tl.entries.length === 0)) {
            delete all[id];
            removed++;
        }
    }
    if (removed > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    return removed;
}

/**
 * Create a timeline entry object. zoneId defaults to the Full zone.
 */
export function createEntry({ presetName, duration, blendTime = 2, zoneId = 'full', startTime = 0, label = null }) {
    return {
        id: generateId(),
        zoneId,
        presetName,
        startTime,      // absolute position within the zone, in seconds
        duration: Math.max(5, Math.round(duration)),
        blendTime,
        label,
        color: null,    // auto-assigned by editor
    };
}

/**
 * Create a marker object.
 */
export function createMarker({ time, label = 'Marker', color = '#ffffff', action = 'none' }) {
    return {
        id: generateId(),
        time,
        label,
        color,
        action, // 'none', 'stop', 'loop'
    };
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

export function exportTimeline(timeline) {
    return JSON.stringify(timeline, null, 2);
}

// ---------------------------------------------------------------------------
// Bundle export / import (custom presets + images embedded)
// ---------------------------------------------------------------------------

/**
 * Async export that embeds every custom preset referenced by this timeline,
 * with image blobs inlined as base64 data-URLs.
 * Returns a JSON string ready for file download.
 */
export async function exportTimelineBundle(timeline) {
    // Lazy import to avoid circular deps at module init time
    const { exportPreset, CUSTOM_PREFIX } = await import('./customPresets.js');

    // Collect unique custom preset IDs from entries
    const ids = new Set();
    for (const entry of (timeline.entries || [])) {
        if (entry.presetName?.startsWith(CUSTOM_PREFIX)) {
            // key format: custom:<id>:<name>
            const id = entry.presetName.slice(CUSTOM_PREFIX.length).split(':')[0];
            ids.add(id);
        }
    }

    const customPresets = [];
    for (const id of ids) {
        try {
            customPresets.push(await exportPreset(id));
        } catch {
            // Preset missing from library — skip silently (may have been deleted)
        }
    }

    return JSON.stringify({
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        timeline,
        customPresets,
    }, null, 2);
}

/**
 * Import a bundle produced by exportTimelineBundle.
 * Also handles plain timeline JSON (no customPresets key) for backward compat.
 * Returns the saved Timeline record.
 */
export async function importTimelineBundle(jsonStr) {
    let data;
    try {
        data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    } catch {
        throw new Error('Invalid JSON');
    }

    // Plain timeline file (legacy / no custom presets)
    if (!data.formatVersion && (data.name || data.entries)) {
        return importTimeline(jsonStr);
    }

    const { timeline, customPresets = [] } = data;
    if (!timeline) throw new Error('Bundle missing timeline object');

    // Restore custom presets and build old-key → new-key remap
    const { importPreset, registryKey, CUSTOM_PREFIX } = await import('./customPresets.js');
    const keyMap        = new Map(); // "custom:<oldId>:<name>" → "custom:<newId>:<name>"
    const presetNames   = [];        // successfully imported preset display names
    const presetFailed  = [];        // { name, error } for each failure

    for (const presetData of customPresets) {
        try {
            const oldId  = presetData.id;
            const oldKey = `${CUSTOM_PREFIX}${oldId}:${presetData.name}`;
            const saved  = await importPreset(presetData);
            const newKey = registryKey(saved);
            keyMap.set(oldKey, newKey);
            presetNames.push(saved.name);
        } catch (err) {
            presetFailed.push({ name: presetData?.name || '(unnamed)', error: err.message });
        }
    }

    // Rewrite entry presetNames using the remap
    const remappedTimeline = {
        ...timeline,
        entries: (timeline.entries || []).map(entry => {
            if (entry.presetName && keyMap.has(entry.presetName)) {
                return { ...entry, presetName: keyMap.get(entry.presetName) };
            }
            return entry;
        }),
    };

    const savedTimeline = importTimeline(JSON.stringify(remappedTimeline));
    // Attach preset import summary so callers can show a result modal
    savedTimeline._presetImport = { imported: presetNames.length, names: presetNames, failed: presetFailed };
    return savedTimeline;
}

export function importTimeline(jsonStr) {
    let data;
    try {
        data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    } catch {
        throw new Error('Invalid JSON');
    }
    if (!data.name) throw new Error('Missing timeline name');
    if (!Array.isArray(data.entries)) throw new Error('Missing entries array');

    const all = loadAllTimelines();
    const existingNames = new Set(Object.values(all).map(t => t.name));
    let name = data.name;
    if (existingNames.has(name)) {
        let n = 2;
        while (existingNames.has(`${data.name} (imported${n > 2 ? ' ' + n : ''})`)) n++;
        name = `${data.name} (imported${n > 2 ? ' ' + n : ''})`;
    }

    return saveTimeline({
        ...data,
        id: generateId(),
        name,
        zones: data.zones?.length ? data.zones : [defaultZone()],
        markers: data.markers || [],
        schemaVersion: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}
