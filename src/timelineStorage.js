/**
 * timelineStorage.js — Timeline CRUD
 *
 * localStorage key: discocast_timelines  { [id]: Timeline }
 * No IndexedDB — timelines only reference preset names, no blobs.
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
    const record = { ...timeline, updatedAt: Date.now() };
    all[record.id] = record;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
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

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

export function exportTimeline(timeline) {
    return JSON.stringify(timeline, null, 2);
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
        schemaVersion: 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    });
}
