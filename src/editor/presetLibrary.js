/**
 * PresetLibrary — manages the "Library" panel in the Preset Studio sidebar.
 * Reads/writes through customPresets.js; never touches the main app's state.
 */

import {
    loadAllCustomPresets,
    deleteCustomPreset,
    exportPreset,
    exportAllPresets,
    importFromFile,
} from '../customPresets.js';
import { showToast } from './inspector.js';
import { showImportResult } from '../importResultModal.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    const hr  = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    const wk  = Math.floor(diff / 604800000);
    if (min < 1)  return 'just now';
    if (min < 60) return `${min}m ago`;
    if (hr  < 24) return `${hr}h ago`;
    if (day < 7)  return `${day}d ago`;
    return `${wk}w ago`;
}

function accentColor(preset) {
    const bv = preset.baseVals || {};
    const r = Math.round((bv.wave_r ?? 1) * 255);
    const g = Math.round((bv.wave_g ?? 0.5) * 255);
    const b = Math.round((bv.wave_b ?? 1) * 255);
    return `rgb(${r},${g},${b})`;
}

// ─── Card button tooltip (fixed-position, escapes scroll containers) ─────────

let _ttEl = null;

function _ttShow(btn) {
    const label = btn.dataset.tooltip;
    if (!label) return;
    if (!_ttEl) {
        _ttEl = document.createElement('div');
        _ttEl.className = 'card-tt';
        _ttEl.hidden = true;
        document.body.appendChild(_ttEl);
    }
    _ttEl.textContent = label;
    _ttEl.hidden = false;
    const r = btn.getBoundingClientRect();
    // Position above the button, centered
    _ttEl.style.left = `${r.left + r.width / 2}px`;
    _ttEl.style.top  = `${r.top - 6}px`;
    _ttEl.style.transform = 'translate(-50%, -100%)';
}

function _ttHide() {
    if (_ttEl) _ttEl.hidden = true;
}

// ─── PresetLibrary class ──────────────────────────────────────────────────────

export class PresetLibrary {
    /**
     * @param {object} opts
     * @param {(id: string) => void} opts.onLoad  - called when user clicks a card
     * @param {() => void}           opts.onNew   - called when user clicks "+ New"
     * @param {object}               opts.engine  - VisualizerEngine, used to refresh preset registry after import
     */
    constructor({ onLoad, onNew, engine }) {
        this.onLoad  = onLoad;
        this.onNew   = onNew;
        this._engine = engine || null;

        this._search    = '';
        this._sort      = 'recent';
        this._activeId  = null;        // currently loaded preset id
        this._deleteTimers = new Map();

        this._bindChrome();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Re-render the card grid (call after save/delete/import). */
    refresh() {
        this._renderGrid();
    }

    /** Mark a preset id as the currently active one (highlights its card). */
    setActiveId(id) {
        this._activeId = id;
        document.querySelectorAll('.preset-card').forEach(c => {
            c.classList.toggle('card-active', c.dataset.presetId === id);
        });
    }

    // ── Chrome bindings (search, sort, new, export, import) ──────────────────

    _bindChrome() {
        document.getElementById('library-search')?.addEventListener('input', e => {
            this._search = e.target.value.toLowerCase();
            this._renderGrid();
        });

        document.getElementById('library-sort')?.addEventListener('change', e => {
            this._sort = e.target.value;
            this._renderGrid();
        });

        document.getElementById('btn-new-preset')?.addEventListener('click', () => {
            this.onNew?.();
        });

        document.getElementById('btn-export-all')?.addEventListener('click', () => {
            this._exportAll();
        });

        document.getElementById('btn-import')?.addEventListener('click', () => {
            document.getElementById('import-file-input')?.click();
        });

        document.getElementById('import-file-input')?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (file) this._importFrom(file);
            e.target.value = '';
        });
    }

    // ── Grid rendering ────────────────────────────────────────────────────────

    _getPresets() {
        let list = Object.values(loadAllCustomPresets());

        if (this._search) {
            list = list.filter(p => p.name.toLowerCase().includes(this._search));
        }

        switch (this._sort) {
            case 'recent':  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); break;
            case 'oldest':  list.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0)); break;
            case 'az':      list.sort((a, b) => a.name.localeCompare(b.name)); break;
            case 'za':      list.sort((a, b) => b.name.localeCompare(a.name)); break;
        }

        return list;
    }

    _renderGrid() {
        const grid = document.getElementById('library-grid');
        if (!grid) return;

        // Cancel any pending deletes that are no longer in DOM
        this._deleteTimers.forEach((timer, id) => {
            if (!loadAllCustomPresets()[id]) {
                clearInterval(timer);
                this._deleteTimers.delete(id);
            }
        });

        const presets = this._getPresets();
        const countEl = document.getElementById('library-count');
        if (countEl) {
            countEl.textContent = `${presets.length} preset${presets.length !== 1 ? 's' : ''}`;
        }

        if (presets.length === 0) {
            grid.innerHTML = `
                <div class="library-empty">
                    <div class="library-empty-icon">🎛️</div>
                    <div class="library-empty-title">No presets yet</div>
                    <div class="library-empty-sub">Build something,<br>then save it.</div>
                </div>`;
            return;
        }

        grid.innerHTML = presets.map(p => this._cardHTML(p)).join('');
        presets.forEach(p => this._bindCard(p.id));
    }

    _cardHTML(preset) {
        const age         = relativeTime(preset.updatedAt || preset.createdAt);
        const accent      = accentColor(preset);
        const activeClass = preset.id === this._activeId ? ' card-active' : '';

        return `
        <div class="preset-card${activeClass}" data-preset-id="${esc(preset.id)}">
            <div class="card-accent" style="background:${accent}"></div>
            <div class="card-body">
                <div class="card-text">
                    <span class="card-name">${esc(preset.name)}</span>
                    <span class="card-age">${esc(age)}</span>
                </div>
                <div class="card-actions">
                    <button class="card-action-btn card-edit-btn" data-tooltip="Edit" aria-label="Edit">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="card-action-btn card-export-btn" data-tooltip="Export" aria-label="Export">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="card-action-btn card-rename-btn" data-tooltip="Rename" aria-label="Rename">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <path d="M17 12H3"/><path d="M21 6H3"/><path d="M21 18H3"/>
                        </svg>
                    </button>
                    <button class="card-action-btn card-delete-btn" data-tooltip="Delete" aria-label="Delete">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6"/><path d="M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="card-delete-overlay" hidden>
                <span class="card-delete-countdown"></span>
                <button class="card-delete-undo">Undo</button>
            </div>
        </div>`;
    }

    _bindCard(id) {
        const card = document.querySelector(`.preset-card[data-preset-id="${id}"]`);
        if (!card) return;

        const editBtn       = card.querySelector('.card-edit-btn');
        const exportBtn     = card.querySelector('.card-export-btn');
        const renameBtn     = card.querySelector('.card-rename-btn');
        const deleteBtn     = card.querySelector('.card-delete-btn');
        const deleteOverlay = card.querySelector('.card-delete-overlay');
        const countdownEl   = card.querySelector('.card-delete-countdown');
        const undoBtn       = card.querySelector('.card-delete-undo');

        // JS tooltips — fixed position, immune to scroll container clipping
        [editBtn, exportBtn, renameBtn, deleteBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => _ttShow(btn));
            btn.addEventListener('mouseleave', _ttHide);
        });

        // Primary action: load preset (click anywhere on card body)
        card.addEventListener('click', e => {
            if (e.target.closest('.card-actions, .card-delete-overlay')) return;
            if (!deleteOverlay.hidden) return;
            this.onLoad?.(id);
        });

        // Edit button — same as clicking the card
        editBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (!deleteOverlay.hidden) return;
            this.onLoad?.(id);
        });

        // Export single preset
        exportBtn.addEventListener('click', e => {
            e.stopPropagation();
            this._exportSingle(id);
        });

        // Rename
        renameBtn.addEventListener('click', e => {
            e.stopPropagation();
            this._startRename(id, card);
        });

        // Delete (countdown → undo)
        deleteBtn.addEventListener('click', e => {
            e.stopPropagation();
            this._startDelete(id, card, deleteOverlay, countdownEl, undoBtn);
        });
    }

    // ── Rename (inline input) ─────────────────────────────────────────────────

    _startRename(id, card) {
        const nameEl = card.querySelector('.card-name');
        const prev   = nameEl.textContent;

        const input  = document.createElement('input');
        input.className = 'card-rename-input';
        input.value     = prev;
        input.maxLength = 80;
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        const commit = () => {
            const next = input.value.trim() || prev;
            const all  = loadAllCustomPresets();
            if (all[id]) {
                all[id].name      = next;
                all[id].updatedAt = Date.now();
                localStorage.setItem('discocast_custom_presets', JSON.stringify(all));
            }
            this._renderGrid();
            if (next !== prev) showToast(`Renamed to "${next}"`);
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = prev;  input.blur(); }
        });
    }

    // ── Soft delete with countdown ────────────────────────────────────────────

    _startDelete(id, card, overlay, countdownEl, undoBtn) {
        let secondsLeft = 3;
        overlay.hidden = false;
        card.classList.add('card-deleting');

        const tick = () => {
            countdownEl.textContent = `Deleting in ${secondsLeft}…`;
        };
        tick();

        const timer = setInterval(() => {
            secondsLeft--;
            if (secondsLeft <= 0) {
                clearInterval(timer);
                this._deleteTimers.delete(id);
                deleteCustomPreset(id);
                this._renderGrid();
                showToast('Preset deleted');
            } else {
                tick();
            }
        }, 1000);

        this._deleteTimers.set(id, timer);

        undoBtn.addEventListener('click', e => {
            e.stopPropagation();
            clearInterval(timer);
            this._deleteTimers.delete(id);
            overlay.hidden = true;
            card.classList.remove('card-deleting');
        }, { once: true });
    }

    // ── Export / Import ───────────────────────────────────────────────────────

    async _exportSingle(id) {
        try {
            const data     = await exportPreset(id);
            const filename = data.name
                ? `${data.name.replace(/[^a-z0-9_\-]/gi, '_')}.json`
                : `preset-${id}.json`;
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            Object.assign(document.createElement('a'), { href: url, download: filename }).click();
            URL.revokeObjectURL(url);
            showToast(`Exported · ${data.name || id}`);
        } catch (err) {
            showToast('Export failed: ' + err.message, true);
        }
    }

    async _exportAll() {
        try {
            const data = await exportAllPresets();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = Object.assign(document.createElement('a'), {
                href: url,
                download: `discocast-presets-${new Date().toISOString().slice(0, 10)}.json`,
            });
            a.click();
            URL.revokeObjectURL(url);
            const n = data.presets?.length ?? 0;
            showToast(`Exported ${n} preset${n !== 1 ? 's' : ''}`);
        } catch (err) {
            showToast('Export failed: ' + err.message, true);
        }
    }

    async _importFrom(file) {
        try {
            const text   = await file.text();
            const json   = JSON.parse(text);
            const { imported, names, failed } = await importFromFile(json);
            this._engine?.refreshCustomPresets();
            this._renderGrid();
            showImportResult({ imported, names, failed });
        } catch (err) {
            showToast('Import failed: ' + err.message, true);
        }
    }
}
