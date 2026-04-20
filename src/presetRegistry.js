/**
 * presetRegistry.js — Merges bundled + custom presets into a single namespace.
 *
 * Custom preset keys: `custom:<id>:<name>`
 * Bundled preset keys: plain name string (unchanged)
 *
 * This is the single source of truth queried by the engine (via getPresetNames())
 * and the drawer. Keeps the engine itself unaware of custom-vs-bundled.
 */

import { loadAllCustomPresets, CUSTOM_PREFIX, registryKey } from './customPresets.js';

export class PresetRegistry {
    /**
     * @param {Object} bundledPresets  Plain object { presetName: presetObj }
     */
    constructor(bundledPresets) {
        this._bundled = bundledPresets;
        this._custom = {};
        this.refresh();
    }

    /** Re-read custom presets from localStorage (call after save/delete). */
    refresh() {
        const stored = loadAllCustomPresets();
        this._custom = {};
        for (const [, preset] of Object.entries(stored)) {
            const key = registryKey(preset);
            this._custom[key] = preset;
        }
    }

    /** All names: bundled (sorted) then custom (sorted). */
    getAllNames() {
        const bundled = Object.keys(this._bundled).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        const custom = Object.keys(this._custom).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        return [...bundled, ...custom];
    }

    /** Look up a preset object by registry key. Returns null if not found. */
    getByName(name) {
        if (name.startsWith(CUSTOM_PREFIX)) return this._custom[name] || null;
        return this._bundled[name] || null;
    }

    /** All bundled preset names (sorted). */
    getBundledNames() {
        return Object.keys(this._bundled).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
    }

    /** All custom preset records with their registry key. */
    getCustomPresets() {
        return Object.entries(this._custom).map(([key, preset]) => ({ key, ...preset }));
    }

    isCustom(name) {
        return name.startsWith(CUSTOM_PREFIX);
    }

    /**
     * Return the display-friendly name (strips the `custom:<id>:` prefix).
     */
    displayName(name) {
        if (name.startsWith(CUSTOM_PREFIX)) {
            // custom:<id>:<name> — name itself may contain colons, so slice after 2nd ':'
            const parts = name.split(':');
            return parts.slice(2).join(':');
        }
        return name;
    }
}
