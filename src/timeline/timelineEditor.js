/**
 * TimelineEditor — Phase 3: Zone Compositor
 *
 * Multi-zone: each zone has its own <canvas> + VisualizerEngine slave.
 * All zones share the primary engine's AudioContext / GainNode.
 * Playback is wall-clock-based: all zones advance in parallel.
 */

import {
    loadAllTimelines,
    createTimeline,
    saveTimeline,
    deleteTimeline,
    pruneEmptyUntitled,
    createEntry,
    createMarker,
    exportTimelineBundle,
    importTimelineBundle,
    generateId,
} from '../timelineStorage.js';
import { VisualizerEngine } from '../visualizer.js';
import { showImportResult } from '../importResultModal.js';
import { downloadFile } from '../fileUtils.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayName(name) {
    if (name?.startsWith('custom:')) return name.split(':').slice(2).join(':');
    return name || '';
}

// 16-colour block palette — wide hue + lightness spread so every swatch reads
// distinctly. Drives both auto-assignment (colorFor) and the block colour picker.
const BLOCK_COLORS = [
    '#ef4444','#f97316','#d97706','#facc15',  // red · orange · gold · yellow
    '#a3e635','#16a34a','#0d9488','#22d3ee',  // lime · green · teal · cyan
    '#0284c7','#2563eb','#4338ca','#7c3aed',  // sky · blue · indigo · violet
    '#a855f7','#d946ef','#f472b6','#e11d48',  // purple · magenta · pink · rose
];
function colorFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return BLOCK_COLORS[Math.abs(h) % BLOCK_COLORS.length];
}

// Width of the fixed zone-label column at the left of the strip (px).
const ZONE_COL_W = 120;

function fmtTime(totalSec) {
    const s = Math.floor(totalSec);
    const m = Math.floor(s / 60);
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function mkZone(id, name, color, region, zIndex, blendMode = 'normal') {
    return { id, name, color, region, opacity: 1, blendMode, zIndex, gapBehavior: 'black' };
}

// ─── Predefined zone layouts ──────────────────────────────────────────────────

const ZONE_LAYOUTS = [
    {
        key: 'full', name: 'Full Screen',
        svg: '<rect x="1" y="1" width="34" height="22" rx="2" fill="rgba(124,111,205,0.3)" stroke="#7c6fcd" stroke-width="1.5"/>',
        zones: [ mkZone('full','Full','#7c6fcd',{x:0,y:0,width:1,height:1},0) ],
    },
    {
        key: 'left-right', name: 'Left | Right',
        svg: '<rect x="1" y="1" width="15" height="22" rx="2" fill="rgba(124,111,205,0.3)" stroke="#7c6fcd" stroke-width="1.5"/><rect x="19" y="1" width="15" height="22" rx="2" fill="rgba(90,138,124,0.3)" stroke="#5a8a7c" stroke-width="1.5"/>',
        zones: [
            mkZone('full', 'Left',  '#7c6fcd', {x:0,  y:0, width:0.5, height:1}, 0),
            mkZone('right','Right', '#5a8a7c', {x:0.5,y:0, width:0.5, height:1}, 1),
        ],
    },
    {
        key: 'top-bottom', name: 'Top / Bottom',
        svg: '<rect x="1" y="1" width="34" height="9" rx="2" fill="rgba(124,111,205,0.3)" stroke="#7c6fcd" stroke-width="1.5"/><rect x="1" y="14" width="34" height="9" rx="2" fill="rgba(90,138,124,0.3)" stroke="#5a8a7c" stroke-width="1.5"/>',
        zones: [
            mkZone('full',  'Top',   '#7c6fcd', {x:0,y:0,  width:1,height:0.5}, 0),
            mkZone('bottom','Bottom','#5a8a7c', {x:0,y:0.5,width:1,height:0.5}, 1),
        ],
    },
    {
        key: 'quadrants', name: '4 Quadrants',
        svg: '<rect x="1" y="1" width="15" height="9" rx="1" fill="rgba(124,111,205,0.3)" stroke="#7c6fcd" stroke-width="1.5"/><rect x="19" y="1" width="15" height="9" rx="1" fill="rgba(90,138,124,0.3)" stroke="#5a8a7c" stroke-width="1.5"/><rect x="1" y="14" width="15" height="9" rx="1" fill="rgba(138,106,90,0.3)" stroke="#8a6a5a" stroke-width="1.5"/><rect x="19" y="14" width="15" height="9" rx="1" fill="rgba(90,122,138,0.3)" stroke="#5a7a8a" stroke-width="1.5"/>',
        zones: [
            mkZone('full','Top Left',    '#7c6fcd', {x:0,  y:0,   width:0.5,height:0.5}, 0),
            mkZone('q2',  'Top Right',   '#5a8a7c', {x:0.5,y:0,   width:0.5,height:0.5}, 1),
            mkZone('q3',  'Bottom Left', '#8a6a5a', {x:0,  y:0.5, width:0.5,height:0.5}, 2),
            mkZone('q4',  'Bottom Right','#5a7a8a', {x:0.5,y:0.5, width:0.5,height:0.5}, 3),
        ],
    },
    {
        key: 'center-frame', name: 'Center + Frame',
        svg: '<rect x="1" y="1" width="34" height="22" rx="2" fill="rgba(124,111,205,0.15)" stroke="#7c6fcd" stroke-width="1.5"/><rect x="7" y="5" width="22" height="14" rx="2" fill="rgba(205,159,90,0.3)" stroke="#cd9f5a" stroke-width="1.5"/>',
        zones: [
            mkZone('full',  'Frame', '#7c6fcd', {x:0,   y:0,   width:1,  height:1  }, 0),
            mkZone('center','Center','#cd9f5a', {x:0.15,y:0.15,width:0.7,height:0.7}, 1, 'screen'),
        ],
    },
    {
        key: 'top-banner', name: 'Top Banner',
        svg: '<rect x="1" y="1" width="34" height="22" rx="2" fill="rgba(124,111,205,0.15)" stroke="#7c6fcd" stroke-width="1.5"/><rect x="1" y="1" width="34" height="6" rx="2" fill="rgba(90,138,205,0.3)" stroke="#5a8acd" stroke-width="1.5"/>',
        zones: [
            mkZone('full',  'Main',  '#7c6fcd', {x:0,y:0,   width:1,height:1   }, 0),
            mkZone('banner','Banner','#5a8acd', {x:0,y:0,   width:1,height:0.22}, 1, 'screen'),
        ],
    },
];

// ─────────────────────────────────────────────────────────────────────────────

export class TimelineEditor {
    constructor({ engine, canvasContainer }) {
        this._primaryEngine   = engine;
        this._canvasContainer = canvasContainer;
        this._presetNames     = engine.getPresetNames();

        // Zone map: zoneId → { canvas, engine }
        this._zoneMap = new Map();
        const initialCanvas = canvasContainer.querySelector('canvas');
        this._zoneMap.set('full', { canvas: initialCanvas, engine });

        // Timeline state
        this._timelines = {};
        this._tl        = null;
        this._dirty     = false;

        // UI state
        this._pxPerSec   = 12;
        this._snapSec    = 0;
        this._selectedId = null;

        // Drag state
        this._drag = null;

        // Playback — wall-clock based, per-zone
        this._playing      = false;
        this._looping      = false;
        this._currentTime  = 0;          // persistent playhead position in seconds
        this._playStartWall = 0;
        this._zoneTimers   = new Map();  // zoneId → timer handle[]
        this._masterTimer  = null;
        this._rafId        = null;
        this._markerHoldTime = null;     // VJ mode: frozen at marker time, animation continues

        // UI state
        this._stripVisible  = true;
        this._isFullscreen  = false;

        // Quick-edit
        this._qeEntryId    = null;

        // Block click / cue state
        this._cueZoneId      = null;   // guard: set during _cueEntry so _playZone skips double-load

        // Live-edit reschedule: tracks which preset is currently showing in each zone.
        // Used to skip reloading a preset that's already playing when _rescheduleIfPlaying fires.
        this._currentZonePreset = new Map(); // Map<zoneId, presetName>

        // Context menu
        this._ctxEntryId   = null;

        // Picker state
        this._pickerTab        = 'all';
        this._pickerZoneId     = null;  // which zone to add to

        // Per-zone black cover divs — each sits on top of its zone's canvas.
        // Slave engines never auto-start (no rendered frame), so their covers
        // are only needed after stop(). Primary engine renders one frame during
        // boot, so its cover hides that stray frame.
        this._zoneCovers = new Map();  // zoneId → HTMLDivElement

        this._bindDOM();
        this._loadAll();
        this._newTimeline();
    }

    // ─── DOM binding ──────────────────────────────────────────────────────────

    _bindDOM() {
        // Topbar
        this._selectEl      = document.getElementById('tl-timeline-select');
        this._nameInput     = document.getElementById('tl-name-input');
        this._btnNew        = document.getElementById('tl-btn-new');
        this._btnSave       = document.getElementById('tl-btn-save');
        this._btnExport     = document.getElementById('tl-btn-export');
        this._btnImport     = document.getElementById('tl-btn-import');
        this._importInput   = document.getElementById('tl-import-input');
        this._btnDelete     = document.getElementById('tl-btn-delete');

        // Transport
        this._btnPlayStop   = document.getElementById('tl-btn-playstop');
        this._psPlayIcon    = document.getElementById('tl-ps-play-icon');
        this._psStopIcon    = document.getElementById('tl-ps-stop-icon');
        this._psLabel       = document.getElementById('tl-ps-label');
        this._btnRewind     = document.getElementById('tl-btn-rewind');
        this._btnSkipNext   = document.getElementById('tl-btn-skip-next');
        this._btnLoop       = document.getElementById('tl-btn-loop');
        this._btnZones      = document.getElementById('tl-btn-zones');
        this._timeDisp      = document.getElementById('tl-time-display');
        this._zoomInput     = document.getElementById('tl-zoom');
        this._snapInput     = document.getElementById('tl-snap');

        // Strip
        this._stripEl       = document.getElementById('tl-strip');
        this._scrollEl      = document.getElementById('tl-scroll');
        this._innerEl       = document.getElementById('tl-inner');
        this._rulerEl       = document.getElementById('tl-ruler');
        this._markerLaneEl  = document.getElementById('tl-marker-lane');
        this._tracksEl      = document.getElementById('tl-tracks');
        this._playheadEl    = document.getElementById('tl-playhead');

        // Zone Manager modal
        this._zoneMgrEl     = document.getElementById('tl-zone-mgr');
        this._zoneMgrClose  = document.getElementById('tl-zone-mgr-close');
        this._zoneLayoutsEl = document.getElementById('tl-zone-layouts');

        // Modals
        this._pickerEl      = document.getElementById('tl-picker');
        this._pickerSearch  = document.getElementById('tl-picker-search');
        this._pickerList    = document.getElementById('tl-picker-list');
        this._pickerCount   = document.getElementById('tl-picker-count');
        this._pickerClose   = document.getElementById('tl-picker-close');
        this._pickerTabs    = document.getElementById('tl-picker-tabs');

        this._quickEditEl   = document.getElementById('tl-quick-edit');
        this._qeTitle       = document.getElementById('qe-title');
        this._qeSwatch      = document.getElementById('qe-swatch');
        this._colorPickerEl = document.getElementById('tl-color-picker');
        this._colorGridEl   = document.getElementById('tl-color-grid');

        this._markerEditEl  = document.getElementById('tl-marker-edit');
        this._meTitle       = document.getElementById('me-title');
        this._meLabel       = document.getElementById('me-label');
        this._meColor       = document.getElementById('me-color');
        this._meAction      = document.getElementById('me-action');
        this._meApply       = document.getElementById('me-apply');
        this._meCancel      = document.getElementById('me-cancel');
        this._meDelete      = document.getElementById('me-delete');

        this._ctxMenu       = document.getElementById('tl-ctx-menu');
        this._saveModal     = document.getElementById('tl-save-modal');
        this._saveNameInput = document.getElementById('tl-save-name');
        this._saveConfirm   = document.getElementById('tl-save-confirm');
        this._saveCancel    = document.getElementById('tl-save-cancel');
        this._dirtyDot      = document.getElementById('tl-dirty-dot');
        this._deleteModal   = document.getElementById('tl-delete-modal');
        this._deleteConfirm = document.getElementById('tl-delete-confirm');
        this._deleteCancel  = document.getElementById('tl-delete-cancel');

        this._entryDeleteModal   = document.getElementById('tl-entry-delete-modal');
        this._entryDeleteConfirm = document.getElementById('tl-entry-delete-confirm');
        this._entryDeleteCancel  = document.getElementById('tl-entry-delete-cancel');
        this._entryDeleteMsg     = document.getElementById('tl-entry-delete-msg');
        this._pendingDeleteId    = null;
        this._toastEl       = document.getElementById('tl-toast');

        this._guideModal    = document.getElementById('tl-keyboard-guide');
        this._btnHelp       = document.getElementById('tl-btn-help');
        
        // Simple listener binding. The button is forced into existence by main.js if missing.
        this._btnHelp?.addEventListener('click', () => this.toggleKeyboardGuide());
        this._guideClose    = document.getElementById('tl-guide-close');

        // Overlays for auto-hide (mini-player included via .filter(Boolean))
        this._overlays = [
            document.getElementById('tl-topbar'),
            document.getElementById('tl-transport'),
            document.getElementById('mini-player'),
        ].filter(Boolean);

        // ── Event bindings ──

        this._btnNew.addEventListener('click',    () => this._confirmNewTimeline());
        this._btnSave.addEventListener('click',   () => this.saveTimeline());
        this._btnExport.addEventListener('click', () => this._exportTimeline());
        this._btnImport.addEventListener('click', () => this._importInput.click());
        this._importInput.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (file) this._importFromFile(file);
            e.target.value = '';
        });
        this._btnDelete.addEventListener('click', () => this._confirmDeleteTimeline());

        this._selectEl.addEventListener('change', e => {
            if (!e.target.value) return;
            if (this._dirty) {
                const name = this._tl?.name || 'Untitled Timeline';
                if (!confirm(`Discard unsaved changes to "${name}"?`)) {
                    this._selectEl.value = this._timelines[this._tl?.id] ? this._tl.id : '';
                    return;
                }
            }
            this._loadTimeline(e.target.value);
        });

        this._nameInput.addEventListener('input', () => {
            if (this._tl) this._tl.name = this._nameInput.value.trim() || 'Untitled Timeline';
            this._setDirty();
        });

        // Save modal
        this._saveConfirm.addEventListener('click', () => this._executeSave());
        this._saveCancel.addEventListener('click',  () => this._closeSaveDialog());
        this._saveModal.addEventListener('click', e => {
            if (e.target === this._saveModal) this._closeSaveDialog();
        });
        this._saveNameInput.addEventListener('input', () => {
            this._saveConfirm.disabled = !this._saveNameInput.value.trim();
        });
        this._saveNameInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && this._saveNameInput.value.trim()) this._executeSave();
            if (e.key === 'Escape') this._closeSaveDialog();
        });

        this._btnPlayStop.addEventListener('click', () => this.togglePlayback());
        this._btnRewind?.addEventListener('click',  () => this._pauseTimelineAt(0));
        this._btnSkipNext?.addEventListener('click', () => this._skipToNextBlock());
        this._btnLoop.addEventListener('click',     () => this._toggleLoop());
        this._btnZones?.addEventListener('click',   () => this._openZoneMgr());

        this._zoomInput.addEventListener('input', () => {
            this._pxPerSec = parseInt(this._zoomInput.value, 10);
            this._renderStrip();
        });
        this._snapInput.addEventListener('change', () => {
            this._snapSec = parseInt(this._snapInput.value, 10);
        });


        // Zone Manager
        this._zoneMgrClose?.addEventListener('click',  () => this._closeZoneMgr());
        this._zoneMgrEl?.addEventListener('click', e => {
            if (e.target === this._zoneMgrEl) this._closeZoneMgr();
        });

        // Picker
        this._pickerClose.addEventListener('click', () => this._closePicker());
        this._pickerSearch.addEventListener('input', () => this._filterPicker(this._pickerSearch.value));
        this._pickerEl.addEventListener('click', e => {
            if (e.target === this._pickerEl) this._closePicker();
        });
        this._pickerTabs?.addEventListener('click', e => {
            const btn = e.target.closest('[data-tab]');
            if (!btn) return;
            this._pickerTab = btn.dataset.tab;
            this._pickerTabs.querySelectorAll('[data-tab]').forEach(b =>
                b.classList.toggle('active', b === btn)
            );
            this._filterPicker(this._pickerSearch.value);
        });

        // Block action menu
        document.getElementById('qe-dupe').addEventListener('click', () => {
            if (!this._qeEntryId) return;
            const id = this._qeEntryId;
            this._closeQuickEdit();
            this._duplicateEntry(id);
        });
        document.getElementById('qe-del').addEventListener('click', () => {
            if (!this._qeEntryId) return;
            const id = this._qeEntryId;
            this._closeQuickEdit();
            this._confirmRemoveEntry(id);
        });
        this._qeSwatch.addEventListener('click', () => this._toggleColorPicker());

        this._meApply.addEventListener('click', () => this._applyMarkerEdit());
        this._meCancel.addEventListener('click', () => this._closeMarkerEdit());
        this._meDelete.addEventListener('click', () => {
            if (this._meMarkerId) {
                this._tl.markers = this._tl.markers.filter(m => m.id !== this._meMarkerId);
                this._setDirty();
                this._renderStrip();
            }
            this._closeMarkerEdit();
        });
        // Context menu
        this._ctxMenu.addEventListener('click', e => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'duplicate') this._duplicateEntry(this._ctxEntryId);
            if (action === 'delete')    this._confirmRemoveEntry(this._ctxEntryId);
            this._closeContextMenu();
        });

        // Delete timeline modal
        this._deleteConfirm.addEventListener('click', () => this._executeDeleteTimeline());
        this._deleteCancel.addEventListener('click',  () => { this._deleteModal.hidden = true; });

        // Delete entry modal
        this._entryDeleteConfirm.addEventListener('click', () => {
            if (this._pendingDeleteId) this._removeEntry(this._pendingDeleteId);
            this._pendingDeleteId = null;
            this._entryDeleteModal.hidden = true;
        });
        this._entryDeleteCancel.addEventListener('click', () => {
            this._pendingDeleteId = null;
            this._entryDeleteModal.hidden = true;
        });

        // Keyboard guide
        this._btnHelp?.addEventListener('click', () => this.toggleKeyboardGuide());
        this._guideClose?.addEventListener('click', () => { if (this._guideModal) this._guideModal.hidden = true; });
        this._guideModal?.addEventListener('click', e => {
            if (e.target === this._guideModal) this._guideModal.hidden = true;
        });

        // ─── DOM Events (Canvas / Ruler / Keys) ───
        // Ruler click → seek
        this._rulerEl.addEventListener('pointerdown', e => {
            if (e.target.closest('.tl-marker-flag')) {
                const markerId = e.target.closest('.tl-marker-flag').dataset.id;
                this.jumpToMarker(markerId);
                return;
            }
            const rect = this._rulerEl.getBoundingClientRect();
            const t = Math.max(0, (e.clientX - rect.left - ZONE_COL_W) / this._pxPerSec);
            this._scrubTo(t);
        });

        // Ruler drag-scrub → continuous scrubbing
        let isScrubbing = false;
        const endScrub = e => {
            if (!isScrubbing) return;
            isScrubbing = false;
            try { this._rulerEl.releasePointerCapture(e.pointerId); } catch (_) {}
        };
        this._rulerEl.addEventListener('pointerdown', e => {
            if (e.target.closest('.tl-marker-flag')) return; // Let marker drag handle it
            isScrubbing = true;
            try { this._rulerEl.setPointerCapture(e.pointerId); } catch (_) {}
            const rect = this._rulerEl.getBoundingClientRect();
            const t = Math.max(0, (e.clientX - rect.left - ZONE_COL_W) / this._pxPerSec);
            this._scrubTo(t);
        });
        this._rulerEl.addEventListener('pointermove', e => {
            if (!isScrubbing) return;
            // Self-heal: if no button is actually held, the release was missed — stop.
            if (e.buttons === 0) { isScrubbing = false; return; }
            const rect = this._rulerEl.getBoundingClientRect();
            const t = Math.max(0, (e.clientX - rect.left - ZONE_COL_W) / this._pxPerSec);
            this._scrubTo(t);
        });
        this._rulerEl.addEventListener('pointerup',     endScrub);
        this._rulerEl.addEventListener('pointercancel', endScrub);

        // Marker lane → click empty space to drop a marker there.
        // (Clicking an existing flag is handled by the flag itself — edit/drag.)
        this._markerLaneEl.addEventListener('pointerdown', e => {
            if (e.target.closest('.tl-marker-flag')) return;
            const rect = this._markerLaneEl.getBoundingClientRect();
            const t = Math.max(0, (e.clientX - rect.left - ZONE_COL_W) / this._pxPerSec);
            this._addMarkerAt(t);
        });

        // Global pointer — close menus
        // NOTE: #tl-quick-edit is intentionally NOT auto-dismissed on outside click.
        // The menu icon button is the sole toggle — deliberate open/close only.
        document.addEventListener('pointerdown', e => {
            if (!this._ctxMenu.hidden && !this._ctxMenu.contains(e.target))
                this._closeContextMenu();
            if (!this._markerEditEl.hidden && !this._markerEditEl.contains(e.target))
                this._closeMarkerEdit();
            if (!this._colorPickerEl.hidden && !this._colorPickerEl.contains(e.target) && !this._qeSwatch.contains(e.target))
                this._closeColorPicker();
        }, { capture: true });

        // Fullscreen button — enter only; exit is via click-on-canvas or Esc
        const fsBtn = document.getElementById('tl-fullscreen-btn');
        fsBtn?.addEventListener('click', () => this._enterFullscreen());

        // Click anywhere on the canvas container to exit fullscreen
        this._canvasContainer.addEventListener('click', () => {
            if (this._isFullscreen) this._exitFullscreen();
        });

        // Update button visibility when browser fullscreen state changes externally (e.g. Esc key)
        document.addEventListener('fullscreenchange', () => this._onFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this._onFullscreenChange());
    }

    // ─── Save state helpers ───────────────────────────────────────────────────

    _isNew() {
        return !this._tl || !this._timelines[this._tl.id];
    }

    _setDirty() {
        this._dirty = true;
        this._updateSaveBtn();
    }

    _setClean() {
        this._dirty = false;
        this._updateSaveBtn();
    }

    _updateSaveBtn() {
        const isNew = this._isNew();
        if (isNew) {
            this._btnSave.textContent = 'Save…';
            this._btnSave.disabled    = false;
            this._btnSave.classList.remove('is-saved');
            if (this._dirtyDot) this._dirtyDot.hidden = true;
        } else if (this._dirty) {
            this._btnSave.textContent = 'Save';
            this._btnSave.disabled    = false;
            this._btnSave.classList.remove('is-saved');
            if (this._dirtyDot) this._dirtyDot.hidden = false;
        } else {
            this._btnSave.textContent = 'Saved';
            this._btnSave.disabled    = true;
            this._btnSave.classList.add('is-saved');
            if (this._dirtyDot) this._dirtyDot.hidden = true;
        }
    }

    _openSaveDialog() {
        const name = this._nameInput.value.trim() || 'Untitled Timeline';
        this._saveNameInput.value    = name;
        this._saveConfirm.disabled   = !name;
        this._saveModal.hidden       = false;
        this._saveNameInput.select();
        this._saveNameInput.focus();
    }

    _closeSaveDialog() {
        this._saveModal.hidden = true;
    }

    _executeSave() {
        const name = this._saveNameInput.value.trim();
        if (!name) return;
        this._tl.name         = name;
        this._nameInput.value = name;
        this._tl = saveTimeline(this._tl);
        this._timelines[this._tl.id] = this._tl;
        this._closeSaveDialog();
        this._setClean();
        this._refreshSelector();
        this._selectEl.value = this._tl.id;
        this._toast(`Saved: ${this._tl.name}`);
    }

    // ─── Timeline CRUD ────────────────────────────────────────────────────────

    _loadAll() {
        const removed = pruneEmptyUntitled();
        this._timelines = loadAllTimelines();
        this._refreshSelector();
        if (removed > 0) {
            setTimeout(() => this._toast(`Cleaned up ${removed} empty timeline${removed !== 1 ? 's' : ''}`), 200);
        }
    }

    _newTimeline() {
        this._tl = createTimeline('Untitled Timeline');
        this._nameInput.value = this._tl.name;
        this._selectEl.value  = '';
        this._syncZoneCanvases();
        this._renderStrip();
        this._setClean();
    }

    _confirmNewTimeline() {
        if (this._dirty) {
            if (!confirm('Discard unsaved changes and start a new timeline?')) return;
        }
        this._newTimeline();
    }

    // Migrate old timelines that stored startTime:0 for all entries.
    // Assigns cumulative start times so sequential entries don't stack at t=0.
    _migrateEntryStartTimes(tl) {
        for (const zone of (tl.zones || [])) {
            const entries = (tl.entries || []).filter(e => e.zoneId === zone.id);
            if (entries.length < 2) continue;
            const allZero = entries.every(e => !e.startTime);
            if (!allZero) continue;
            let cum = 0;
            for (const e of entries) {
                e.startTime = cum;
                cum += e.duration;
            }
        }
    }

    _loadTimeline(id) {
        const tl = this._timelines[id];
        if (!tl) return;
        this._tl = JSON.parse(JSON.stringify(tl));
        this._migrateEntryStartTimes(this._tl);
        this._nameInput.value = this._tl.name;
        this._selectEl.value  = id;
        this.stop();
        this._syncZoneCanvases();
        this._renderStrip();
        this._setClean();
        this._toast(`Loaded: ${tl.name}`);
    }

    saveTimeline() {
        if (!this._tl) return;
        if (this._isNew()) {
            this._openSaveDialog();
            return;
        }
        this._tl.name = this._nameInput.value.trim() || 'Untitled Timeline';
        this._tl = saveTimeline(this._tl);
        this._timelines[this._tl.id] = this._tl;
        this._setClean();
        this._refreshSelector();
        this._selectEl.value = this._tl.id;
        this._toast(`Saved: ${this._tl.name}`);
    }

    openTimeline(id) {
        if (this._timelines[id]) this._loadTimeline(id);
    }

    enterPlayerMode() {
        // Hide topbar permanently — editing actions not needed in player mode
        const topbar = document.getElementById('tl-topbar');
        if (topbar) topbar.style.display = 'none';
        this._overlays = this._overlays.filter(el => el !== topbar);

        // Hide the strip — viewer doesn't need the timeline track view
        this._stripVisible = true;  // toggleStrip flips it, so start true
        this.toggleStrip();

        // Auto-play if the timeline has content
        if (this._tl?.entries?.length > 0 && !this._playing) {
            this.play();
        }
    }

    _confirmDeleteTimeline() {
        if (!this._tl) return;
        document.getElementById('tl-delete-msg').textContent =
            `Delete "${this._tl.name}"? This can't be undone.`;
        this._deleteModal.hidden = false;
    }

    _executeDeleteTimeline() {
        if (!this._tl) return;
        const name = this._tl.name;
        deleteTimeline(this._tl.id);
        delete this._timelines[this._tl.id];
        this._deleteModal.hidden = true;
        this._toast(`Deleted: ${name}`);
        this._newTimeline();
    }

    _refreshSelector() {
        const sel  = this._selectEl;
        const prev = sel.value;
        sel.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— Select timeline —';
        placeholder.disabled = true;
        sel.appendChild(placeholder);
        const all = Object.values(this._timelines).sort((a, b) => b.updatedAt - a.updatedAt);
        for (const tl of all) {
            const opt = document.createElement('option');
            opt.value = tl.id;
            opt.textContent = tl.name;
            sel.appendChild(opt);
        }
        sel.value = prev;
    }

    // ─── Zone canvas management ───────────────────────────────────────────────

    _syncZoneCanvases() {
        const zones   = this._tl?.zones || [];
        const zoneIds = new Set(zones.map(z => z.id));

        // Remove canvases + covers for zones no longer in the layout
        for (const [id, zd] of this._zoneMap) {
            if (!zoneIds.has(id) && id !== 'full') {
                zd.canvas.remove();
                this._zoneMap.delete(id);
                const cover = this._zoneCovers.get(id);
                if (cover) { cover.remove(); this._zoneCovers.delete(id); }
            }
        }

        // Create or update canvases + covers for current zones
        for (const zone of zones) {
            if (this._zoneMap.has(zone.id)) {
                this._positionCanvas(this._zoneMap.get(zone.id).canvas, zone);
                const eng = this._zoneMap.get(zone.id).engine;
                const w = Math.round(zone.region.width  * window.innerWidth);
                const h = Math.round(zone.region.height * window.innerHeight);
                eng.setSize(w, h);
            } else {
                // New slave zone — autoStart:false so no frame is ever rendered
                // until we explicitly start the engine.
                const canvas = document.createElement('canvas');
                this._canvasContainer.appendChild(canvas);
                this._positionCanvas(canvas, zone);

                const slaveEngine = new VisualizerEngine();
                slaveEngine.initSlave(canvas, this._primaryEngine, false);
                slaveEngine.stopAutoCycle();
                slaveEngine.autoCycleEnabled = false;

                this._zoneMap.set(zone.id, { canvas, engine: slaveEngine });
            }

            // Create or reposition the per-zone black cover
            if (!this._zoneCovers.has(zone.id)) {
                const cover = document.createElement('div');
                Object.assign(cover.style, {
                    position: 'absolute', background: '#000',
                    zIndex: '10', pointerEvents: 'none',
                    opacity: '1', transition: 'none',
                });
                this._canvasContainer.appendChild(cover);
                this._zoneCovers.set(zone.id, cover);
            }
            const cover = this._zoneCovers.get(zone.id);
            const r = zone.region;
            // Only update position/size - DO NOT reset opacity to black
            Object.assign(cover.style, {
                left: `${r.x * 100}%`, top: `${r.y * 100}%`,
                width: `${r.width * 100}%`, height: `${r.height * 100}%`,
            });
        }

        this._updateStripHeight();
    }

    /**
     * Fade a zone cover to a target opacity over `durationSec` seconds.
     * @param {string} zoneId   — zone to target
     * @param {number} opacity  — 0 (reveal canvas) or 1 (cover with black)
     * @param {number} durationSec — 0 for instant snap, >0 for animated fade
     * @param {string} style    — transition type (future extensibility hook)
     *   'fade-black'  → default, opacity transition with black cover
     *   'cut'         → instant, ignores durationSec (always 0)
     *   Future: 'fade-white', 'flash', 'dip-to-black', etc.
     */
    _fadeZoneCover(zoneId, opacity, durationSec = 0, style = 'fade-black') {
        const cover = this._zoneCovers.get(zoneId);
        if (!cover) return;

        // Future: switch on `style` for different transition types
        if (style === 'cut') durationSec = 0;

        if (durationSec > 0) {
            // Set transition, force reflow, then animate
            cover.style.transition = `opacity ${durationSec}s ease`;
            cover.offsetHeight;  // force reflow so transition takes effect
            cover.style.opacity = String(opacity);
        } else {
            cover.style.transition = 'none';
            cover.style.opacity = String(opacity);
        }
    }

    _positionCanvas(canvas, zone) {
        const r = zone.region;
        const w = Math.round(r.width  * window.innerWidth);
        const h = Math.round(r.height * window.innerHeight);
        canvas.style.position  = 'absolute';
        canvas.style.left      = `${r.x      * 100}%`;
        canvas.style.top       = `${r.y      * 100}%`;
        canvas.style.width     = `${r.width  * 100}%`;
        canvas.style.height    = `${r.height * 100}%`;
        canvas.style.zIndex    = zone.zIndex ?? 0;
        canvas.style.mixBlendMode = zone.blendMode || 'normal';
        canvas.width  = w;
        canvas.height = h;
    }

    _updateStripHeight() {
        const n = this._tl?.zones?.length || 1;
        const rulerH = 26;
        const markerLaneH = 20;
        const trackH = 68;
        const newH   = rulerH + markerLaneH + n * trackH + 2;
        document.documentElement.style.setProperty('--strip-h', `${newH}px`);
        // Keep transport pinned directly above the strip
        const transport = document.getElementById('tl-transport');
        if (transport) transport.style.bottom = `${newH}px`;
    }

    resizeAllZones() {
        for (const zone of (this._tl?.zones || [])) {
            const zd = this._zoneMap.get(zone.id);
            if (!zd) continue;
            const w = Math.round(zone.region.width  * window.innerWidth);
            const h = Math.round(zone.region.height * window.innerHeight);
            zd.canvas.width  = w;
            zd.canvas.height = h;
            zd.engine.setSize(w, h);
        }
    }

    // ─── Zone layout manager ──────────────────────────────────────────────────

    _openZoneMgr() {
        if (!this._zoneLayoutsEl) return;
        this._buildLayoutTiles();
        this._zoneMgrEl.hidden = false;
    }

    _closeZoneMgr() {
        if (this._zoneMgrEl) this._zoneMgrEl.hidden = true;
    }

    _buildLayoutTiles() {
        this._zoneLayoutsEl.innerHTML = '';
        const currentKey = this._currentLayoutKey();

        for (const layout of ZONE_LAYOUTS) {
            const tile = document.createElement('button');
            tile.className = 'tl-layout-tile' + (layout.key === currentKey ? ' active' : '');
            tile.type = 'button';

            const preview = document.createElement('div');
            preview.className = 'tl-layout-preview';
            preview.innerHTML = `<svg viewBox="0 0 36 24" width="72" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">${layout.svg}</svg>`;

            const label = document.createElement('span');
            label.textContent = layout.name;

            tile.appendChild(preview);
            tile.appendChild(label);

            tile.addEventListener('click', () => {
                this._applyLayout(layout);
                this._closeZoneMgr();
            });

            this._zoneLayoutsEl.appendChild(tile);
        }
    }

    _currentLayoutKey() {
        const zones = this._tl?.zones || [];
        for (const layout of ZONE_LAYOUTS) {
            if (layout.zones.length !== zones.length) continue;
            if (layout.zones.every((lz, i) => lz.id === zones[i]?.id)) return layout.key;
        }
        return null;
    }

    _applyLayout(layout) {
        const hasEntries = this._tl?.entries?.length > 0;
        const isCurrentLayout = this._currentLayoutKey() === layout.key;
        if (isCurrentLayout) return;

        if (hasEntries && !confirm(`Switch to "${layout.name}" layout? This will clear all timeline entries.`)) {
            return;
        }

        // Deep-copy layout zones so each timeline gets independent objects
        this._tl.zones   = JSON.parse(JSON.stringify(layout.zones));
        this._tl.entries = [];
        this._setDirty();

        this.stop();
        this._syncZoneCanvases();
        this._renderStrip();
        this._toast(`Layout: ${layout.name}`);
    }

    // ─── Entry management ─────────────────────────────────────────────────────

    addEntry(presetName, zoneId) {
        if (!this._tl) return;
        const targetZoneId = zoneId || this._tl.zones[0]?.id || 'full';
        const existing = this._zoneEntriesFor(targetZoneId);
        const endOfLast = existing.reduce((max, e) => Math.max(max, (e.startTime ?? 0) + e.duration), 0);
        const entry = createEntry({
            presetName,
            duration:  this._tl.defaultDuration,
            blendTime: this._tl.defaultBlendTime,
            zoneId:    targetZoneId,
            startTime: endOfLast,
        });
        entry.color = colorFor(presetName);
        this._tl.entries.push(entry);
        this._setDirty();
        // Playhead is the single source of truth for the canvas. Playing: the
        // reschedule re-derives from the live playhead. Stopped: re-derive at the
        // parked position so the new block never jumps onto the canvas.
        this._rescheduleIfPlaying();
        if (!this._playing) this._scrubTo(this._currentTime);
        this._renderStrip();
    }

    _confirmRemoveEntry(id) {
        if (!id) return;
        const entry = this._tl?.entries.find(e => e.id === id);
        const label = entry ? (entry.label || entry.presetName || 'this block') : 'this block';
        this._entryDeleteMsg.textContent = `Remove "${label}" from the timeline?`;
        this._pendingDeleteId = id;
        this._entryDeleteModal.hidden = false;
    }

    _removeEntry(id) {
        if (!this._tl || !id) return;

        this._tl.entries = this._tl.entries.filter(e => e.id !== id);
        if (this._selectedId === id) this._selectedId = null;
        this._setDirty();

        // Playhead is the single source of truth for the canvas. Playing: the
        // reschedule re-derives (blacks out a zone if nothing is active there now).
        // Stopped: re-derive at the parked position.
        if (this._playing) {
            this._rescheduleIfPlaying();
        } else {
            this._scrubTo(this._currentTime);
        }

        this._renderStrip();
    }

    _duplicateEntry(id) {
        if (!this._tl || !id) return;
        const idx = this._tl.entries.findIndex(e => e.id === id);
        if (idx === -1) return;
        const orig = this._tl.entries[idx];
        const copy = { ...orig, id: generateId() };
        this._tl.entries.splice(idx + 1, 0, copy);
        this._setDirty();
        this._rescheduleIfPlaying();
        this._renderStrip();
    }

    _updateEntry(id, changes) {
        if (!this._tl) return;
        const entry = this._tl.entries.find(e => e.id === id);
        if (!entry) return;
        Object.assign(entry, changes);
        this._setDirty();
        this._renderStrip();
    }

    deleteSelected() {
        if (this._selectedId) this._removeEntry(this._selectedId);
    }

    // ─── Computed values ──────────────────────────────────────────────────────

    _zoneEntriesFor(zoneId) {
        return (this._tl?.entries || [])
            .filter(e => e.zoneId === zoneId)
            .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    }

    _totalDuration() {
        if (!this._tl?.entries.length) return 0;
        return (this._tl.entries).reduce((max, e) => Math.max(max, (e.startTime ?? 0) + e.duration), 0);
    }

    _startTimeOfEntry(id) {
        const entry = this._tl?.entries.find(e => e.id === id);
        return entry?.startTime ?? 0;
    }

    // ─── Strip rendering ──────────────────────────────────────────────────────

    _renderStrip() {
        const zones   = this._tl?.zones   || [];
        const entries = this._tl?.entries || [];
        const total   = Math.max(this._totalDuration(), 60);
        const innerW  = total * this._pxPerSec + 200;

        this._innerEl.style.minWidth = `${innerW}px`;
        this._renderRuler(total);
        this._renderMarkers(total);
        this._renderZoneRows(zones, entries);
        this._updateTimeDisplay(0);
    }

    _renderRuler(totalSec) {
        this._rulerEl.innerHTML = '';
        const zoneColW = ZONE_COL_W;
        const intervals = [1, 5, 10, 15, 30, 60, 120, 300, 600];
        const interval  = intervals.find(i => i * this._pxPerSec >= 50) || 600;

        for (let t = 0; t <= totalSec + interval; t += interval) {
            const tick = document.createElement('div');
            tick.className = 'tl-tick tl-tick--major';
            tick.style.left = `${zoneColW + t * this._pxPerSec}px`;
            const line  = document.createElement('div');
            line.className = 'tl-tick-line';
            const label = document.createElement('div');
            label.className = 'tl-tick-label';
            label.textContent = fmtTime(t);
            tick.appendChild(line);
            tick.appendChild(label);
            this._rulerEl.appendChild(tick);
        }
    }

    _renderMarkers(totalSec) {
        this._innerEl.querySelectorAll('.tl-marker-line, .tl-loop-tint').forEach(el => el.remove());
        this._markerLaneEl.innerHTML = '';

        const trackTint = `calc(var(--strip-h) - var(--ruler-h) - var(--marker-lane-h))`;
        const markers = this._tl?.markers || [];
        for (const m of markers) {
            const color   = m.color || '#ffffff';
            const isLoop  = m.action === 'loop' && m.loopEnd != null && m.loopEnd > m.time;
            const startPx = ZONE_COL_W + m.time * this._pxPerSec;

            // Flag — sits at the marker time (the loop's start point, when looping)
            const markerEl = document.createElement('div');
            markerEl.className = 'tl-marker tl-marker-flag';
            markerEl.dataset.id = m.id;
            markerEl.style.left = `${startPx}px`;
            markerEl.textContent = m.label || 'Marker';
            markerEl.style.setProperty('--marker-color', color);
            this._markerLaneEl.appendChild(markerEl);
            markerEl.addEventListener('pointerdown', e => {
                e.stopPropagation();
                if (isLoop) this._startLoopDrag(e, m, 'start');
                else        this._startMarkerDrag(e, m);
            });

            if (isLoop) {
                const widthPx = (m.loopEnd - m.time) * this._pxPerSec;

                // Loop band in the marker lane — drag the body to move the whole region
                const band = document.createElement('div');
                band.className = 'tl-loop-band';
                band.dataset.id = m.id;
                band.style.left  = `${startPx}px`;
                band.style.width = `${widthPx}px`;
                band.style.setProperty('--marker-color', color);
                this._markerLaneEl.appendChild(band);
                band.addEventListener('pointerdown', e => {
                    e.stopPropagation();
                    this._startLoopDrag(e, m, 'move');
                });

                // End handle — drag to resize the loop end
                const handle = document.createElement('div');
                handle.className = 'tl-loop-handle';
                handle.dataset.id = m.id;
                handle.style.left = `${ZONE_COL_W + m.loopEnd * this._pxPerSec}px`;
                handle.style.setProperty('--marker-color', color);
                this._markerLaneEl.appendChild(handle);
                handle.addEventListener('pointerdown', e => {
                    e.stopPropagation();
                    this._startLoopDrag(e, m, 'end');
                });

                // Translucent tint over the tracks showing the looped span
                const tint = document.createElement('div');
                tint.className = 'tl-loop-tint';
                tint.dataset.id = m.id;
                tint.style.left   = `${startPx}px`;
                tint.style.width  = `${widthPx}px`;
                tint.style.height = trackTint;
                tint.style.setProperty('--marker-color', color);
                this._innerEl.appendChild(tint);
            } else {
                // Plain marker — drop line down the tracks
                const line = document.createElement('div');
                line.className = 'tl-marker-line';
                line.dataset.id = m.id;
                line.style.left = `${startPx}px`;
                line.style.setProperty('--marker-color', color);
                line.style.height = `var(--strip-h)`;
                this._innerEl.appendChild(line);
            }
        }
    }

    // Live-position a loop marker's elements during a drag (no full re-render).
    _positionLoopMarker(m) {
        const startPx = ZONE_COL_W + m.time * this._pxPerSec;
        const endPx   = ZONE_COL_W + m.loopEnd * this._pxPerSec;
        const widthPx = Math.max(0, endPx - startPx);
        const flag   = this._markerLaneEl.querySelector(`.tl-marker-flag[data-id="${m.id}"]`);
        const band   = this._markerLaneEl.querySelector(`.tl-loop-band[data-id="${m.id}"]`);
        const handle = this._markerLaneEl.querySelector(`.tl-loop-handle[data-id="${m.id}"]`);
        const tint   = this._innerEl.querySelector(`.tl-loop-tint[data-id="${m.id}"]`);
        if (flag)   flag.style.left = `${startPx}px`;
        if (band) { band.style.left = `${startPx}px`; band.style.width = `${widthPx}px`; }
        if (handle) handle.style.left = `${endPx}px`;
        if (tint) { tint.style.left = `${startPx}px`; tint.style.width = `${widthPx}px`; }
    }

    // Create a marker at time t. No popover — placement and editing are separate
    // gestures: drop with the M key, edit by clicking the flag.
    _addMarkerAt(t) {
        if (!this._tl) return null;
        this._tl.markers = this._tl.markers || [];
        if (this._snapSec > 0) t = Math.round(t / this._snapSec) * this._snapSec;
        const m = createMarker({ time: t, label: 'Marker' });
        this._tl.markers.push(m);
        this._tl.markers.sort((a, b) => a.time - b.time);
        this._setDirty();
        this._renderStrip();
        return m;
    }

    // Drop a marker at the current playhead — the M-key gesture. Instant, no popover.
    dropMarkerAtPlayhead() {
        const m = this._addMarkerAt(this._currentTime);
        if (m) this._toast('Marker added');
    }

    _startMarkerDrag(e, m) {
        if (e.button !== 0) return;
        
        const flagEl = this._markerLaneEl.querySelector(`.tl-marker-flag[data-id="${m.id}"]`);
        const lineEl = this._innerEl.querySelector(`.tl-marker-line[data-id="${m.id}"]`);
        if (!flagEl || !lineEl) return;
        
        const startX = e.clientX;
        const startY = e.clientY;
        const origTime = m.time;
        let newTime = origTime;
        let isDrag = false;
        let done   = false;

        const onMove = ev => {
            // Self-heal: pointer no longer held — the release was missed.
            if (ev.buttons === 0) { onUp(); return; }
            if (!isDrag && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
                isDrag = true;
            }
            if (!isDrag) return;

            const dx = ev.clientX - startX;
            newTime = Math.max(0, origTime + dx / this._pxPerSec);
            if (this._snapSec > 0) newTime = Math.round(newTime / this._snapSec) * this._snapSec;
            const leftPx = `${ZONE_COL_W + newTime * this._pxPerSec}px`;
            flagEl.style.left = leftPx;
            lineEl.style.left = leftPx;
        };

        const onUp = () => {
            if (done) return;
            done = true;
            document.removeEventListener('pointermove',   onMove);
            document.removeEventListener('pointerup',     onUp);
            document.removeEventListener('pointercancel', onUp);
            if (!isDrag) {
                // Treat as click
                this._openMarkerEdit(m.id, flagEl);
                return;
            }
            m.time = newTime;
            this._setDirty();
            // Re-sort markers by time just to keep data clean
            this._tl.markers.sort((a, b) => a.time - b.time);
            this._renderStrip();
        };

        document.addEventListener('pointermove',   onMove);
        document.addEventListener('pointerup',     onUp);
        document.addEventListener('pointercancel', onUp);
        e.preventDefault();
    }

    // Drag a loop marker's region. mode: 'start' (flag), 'end' (handle), 'move' (band).
    _startLoopDrag(e, m, mode) {
        if (e.button !== 0) return;
        const MIN      = 1;                       // minimum loop length, seconds
        const startX   = e.clientX;
        const startY   = e.clientY;
        const origTime = m.time;
        const origEnd  = m.loopEnd;
        let isDrag = false;
        let done   = false;

        const snap = v => (this._snapSec > 0 ? Math.round(v / this._snapSec) * this._snapSec : v);

        const onMove = ev => {
            if (ev.buttons === 0) { onUp(); return; }   // self-heal: release missed
            if (!isDrag && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
                isDrag = true;
            }
            if (!isDrag) return;
            const dt = (ev.clientX - startX) / this._pxPerSec;
            if (mode === 'start') {
                m.time = Math.max(0, Math.min(snap(origTime + dt), origEnd - MIN));
            } else if (mode === 'end') {
                m.loopEnd = Math.max(origTime + MIN, snap(origEnd + dt));
            } else { // move — slide the whole region
                const nt = Math.max(0, snap(origTime + dt));
                m.time    = nt;
                m.loopEnd = nt + (origEnd - origTime);
            }
            this._positionLoopMarker(m);
        };

        const onUp = () => {
            if (done) return;
            done = true;
            document.removeEventListener('pointermove',   onMove);
            document.removeEventListener('pointerup',     onUp);
            document.removeEventListener('pointercancel', onUp);
            if (!isDrag) {
                // A click (no drag): on the flag, open the editor; band/handle do nothing.
                if (mode === 'start') {
                    const flag = this._markerLaneEl.querySelector(`.tl-marker-flag[data-id="${m.id}"]`);
                    if (flag) this._openMarkerEdit(m.id, flag);
                }
                return;
            }
            this._setDirty();
            this._tl.markers.sort((a, b) => a.time - b.time);
            this._renderStrip();
            this._rescheduleIfPlaying();
        };

        document.addEventListener('pointermove',   onMove);
        document.addEventListener('pointerup',     onUp);
        document.addEventListener('pointercancel', onUp);
        e.preventDefault();
    }

    // ─── Marker Edit Popover ───

    _openMarkerEdit(id, anchorEl) {
        const m = this._tl?.markers?.find(x => x.id === id);
        if (!m) return;

        this._meMarkerId = id;
        this._meLabel.value  = m.label || '';
        this._meColor.value  = m.color || '#ffffff';
        this._meAction.value = m.action || 'none';

        const rect = anchorEl.getBoundingClientRect();
        const popW = 260, popH = 220;
        let left = rect.left;
        let top  = rect.bottom + 8; // Drop below the ruler
        if (top + popH > window.innerHeight - 10) {
            top = rect.top - popH - 8; // Drop above ruler if clipped
        }
        if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;

        this._markerEditEl.style.left = `${left}px`;
        this._markerEditEl.style.top  = `${top}px`;
        this._markerEditEl.hidden = false;
        this._meLabel.focus();
        this._meLabel.select();
    }

    _applyMarkerEdit() {
        if (!this._meMarkerId) return;
        const m = this._tl?.markers?.find(x => x.id === this._meMarkerId);
        if (m) {
            m.label  = this._meLabel.value.trim() || '';
            m.color  = this._meColor.value;
            m.action = this._meAction.value;
            if (m.action === 'loop' && (m.loopEnd == null || m.loopEnd <= m.time)) {
                m.loopEnd = m.time + 16;   // default 16s loop — drag the handle to resize
            }
            this._setDirty();
            this._tl.markers.sort((a, b) => a.time - b.time);
            this._renderStrip();
        }
        this._closeMarkerEdit();
    }

    _closeMarkerEdit() {
        this._markerEditEl.hidden = true;
        this._meMarkerId = null;
    }

    _renderZoneRows(zones, entries) {
        // Wipe existing rows
        this._tracksEl.querySelectorAll('.tl-zone-row').forEach(el => el.remove());

        const hasEntries = entries.length > 0;

        for (const zone of zones) {
            const zoneEntries = entries.filter(e => e.zoneId === zone.id);
            const row = this._createZoneRow(zone, zoneEntries, !hasEntries && zones.indexOf(zone) === 0);
            this._tracksEl.appendChild(row);
        }
    }

    _createZoneRow(zone, entries, showEmpty) {
        const row = document.createElement('div');
        row.className = 'tl-zone-row';
        row.dataset.zoneId = zone.id;

        // Zone label column
        const labelEl = document.createElement('div');
        labelEl.className = 'tl-zone-label';
        labelEl.innerHTML =
            `<div class="tl-zone-dot" style="background:${zone.color}"></div>` +
            `<span class="tl-zone-name">${zone.name}</span>`;

        // "+" add button within the zone label
        const addBtn = document.createElement('button');
        addBtn.className = 'tl-zone-add-btn';
        addBtn.type = 'button';
        addBtn.title = `Add preset to ${zone.name}`;
        addBtn.textContent = '+';
        addBtn.addEventListener('click', e => {
            e.stopPropagation();
            this._openPicker(zone.id);
        });
        labelEl.appendChild(addBtn);

        // Track content
        const trackEl = document.createElement('div');
        trackEl.className = 'tl-track-content';
        trackEl.dataset.zoneId = zone.id;

        if (showEmpty) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'tl-empty-state';
            emptyEl.textContent = 'Add presets to get started';
            trackEl.appendChild(emptyEl);
        }

        this._renderBlocksIntoTrack(entries, trackEl);

        row.appendChild(labelEl);
        row.appendChild(trackEl);
        return row;
    }

    _renderBlocksIntoTrack(entries, trackEl) {
        const sorted = [...entries].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
        for (const entry of sorted) {
            const block = this._createBlockEl(entry, entry.startTime ?? 0, trackEl);
            trackEl.appendChild(block);
        }
    }

    _createBlockEl(entry, startTime, trackEl) {
        const left  = startTime * this._pxPerSec;
        const width = entry.duration * this._pxPerSec;
        const color = entry.color || colorFor(entry.presetName);

        const block = document.createElement('div');
        block.className = 'tl-block';
        block.dataset.id = entry.id;
        block.style.left            = `${left}px`;
        block.style.width           = `${width}px`;
        block.style.backgroundColor = color + '55';
        block.style.borderColor     = color;
        block.style.setProperty('--block-color', color);

        if (this._selectedId === entry.id) block.classList.add('selected');

        if (entry.blendTime > 0) {
            const blend = document.createElement('div');
            blend.className = 'tl-block-blend';
            blend.style.width = `${Math.min(entry.blendTime * this._pxPerSec, width * 0.4)}px`;
            block.appendChild(blend);
        }

        // Menu icon — left side; opens/closes quick-edit modal
        const menuBtn = document.createElement('button');
        menuBtn.className = 'tl-block-menu-btn';
        menuBtn.type = 'button';
        menuBtn.title = 'Edit block';
        menuBtn.innerHTML = '<svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect y="0" width="14" height="2" rx="1"/><rect y="4.5" width="14" height="2" rx="1"/><rect y="9" width="14" height="2" rx="1"/></svg>';
        block.appendChild(menuBtn);

        const body = document.createElement('div');
        body.className = 'tl-block-body';

        const name = document.createElement('span');
        name.className = 'tl-block-name';
        name.textContent = displayName(entry.presetName);
        name.style.color = color;

        const dur = document.createElement('span');
        dur.className = 'tl-block-dur';
        dur.textContent = `${entry.duration}s`;

        body.appendChild(name);
        body.appendChild(dur);

        const resize = document.createElement('div');
        resize.className = 'tl-block-resize';

        block.appendChild(body);
        block.appendChild(resize);

        // Menu button — toggle quick-edit; stop propagation so drag doesn't start
        menuBtn.addEventListener('pointerdown', e => e.stopPropagation());
        menuBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (!this._quickEditEl.hidden && this._qeEntryId === entry.id) {
                this._closeQuickEdit();
            } else {
                this._openQuickEdit(entry.id, block);
            }
        });

        // Block body — drag to move; double-click to cue
        block.addEventListener('pointerdown', e => {
            if (e.target.closest('.tl-block-resize')) return;
            if (e.target.closest('.tl-block-menu-btn')) return;
            this._select(entry.id);
            this._startMoveDrag(e, entry, trackEl);
        });

        block.addEventListener('dblclick', e => {
            if (e.target.closest('.tl-block-resize')) return;
            if (e.target.closest('.tl-block-menu-btn')) return;
            this._cueEntry(entry.id);
        });

        resize.addEventListener('pointerdown', e => {
            e.stopPropagation();
            this._startResizeDrag(e, entry, trackEl);
        });

        return block;
    }

    _select(id) {
        this._selectedId = id;
        document.querySelectorAll('.tl-block').forEach(el => {
            el.classList.toggle('selected', el.dataset.id === id);
        });
    }

    // ─── Drag — free positional move ─────────────────────────────────────────

    _startMoveDrag(e, entry, trackEl) {
        if (e.button !== 0) return;

        const blockEl = trackEl.querySelector(`[data-id="${entry.id}"]`);
        if (!blockEl) return;

        const origStartTime = entry.startTime ?? 0;
        const startX        = e.clientX;
        const startY        = e.clientY;
        let   newStartTime  = origStartTime;
        let   moved         = false;

        let done = false;
        const onMove = ev => {
            if (ev.buttons === 0) { onUp(); return; }   // self-heal: release missed
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
                moved = true;
                blockEl.style.zIndex     = '20';
                blockEl.style.opacity    = '0.8';
                blockEl.style.transition = 'none';
            }
            if (!moved) return;
            newStartTime = Math.max(0, origStartTime + dx / this._pxPerSec);
            if (this._snapSec > 0) newStartTime = Math.round(newStartTime / this._snapSec) * this._snapSec;
            blockEl.style.left = `${newStartTime * this._pxPerSec}px`;
        };

        const onUp = () => {
            if (done) return;
            done = true;
            document.removeEventListener('pointermove',   onMove);
            document.removeEventListener('pointerup',     onUp);
            document.removeEventListener('pointercancel', onUp);
            blockEl.style.zIndex     = '';
            blockEl.style.opacity    = '';
            blockEl.style.transition = '';

            if (!moved) return;

            entry.startTime = Math.max(0, Math.round(newStartTime));
            if (this._snapSec > 0) entry.startTime = Math.round(entry.startTime / this._snapSec) * this._snapSec;
            this._setDirty();
            this._rescheduleIfPlaying();
            this._renderStrip();
        };

        document.addEventListener('pointermove',   onMove);
        document.addEventListener('pointerup',     onUp);
        document.addEventListener('pointercancel', onUp);
        e.preventDefault();
    }

    // ─── Drag — resize ────────────────────────────────────────────────────────

    _startResizeDrag(e, entry, trackEl) {
        if (e.button !== 0) return;

        const startX  = e.clientX;
        const origDur = entry.duration;
        const blockEl = trackEl.querySelector(`[data-id="${entry.id}"]`);
        const durEl   = blockEl?.querySelector('.tl-block-dur');

        let done   = false;
        let moved  = false;
        const onMove = ev => {
            if (ev.buttons === 0) { onUp(); return; }   // self-heal: release missed
            moved = true;
            const dx = ev.clientX - startX;
            let newDur = Math.max(5, origDur + Math.round(dx / this._pxPerSec));
            if (this._snapSec > 0) newDur = Math.round(newDur / this._snapSec) * this._snapSec;
            entry.duration = newDur;
            blockEl.style.left  = `${(entry.startTime ?? 0) * this._pxPerSec}px`;
            blockEl.style.width = `${newDur * this._pxPerSec}px`;
            if (durEl) durEl.textContent = `${newDur}s`;
        };

        const onUp = () => {
            if (done) return;
            done = true;
            document.removeEventListener('pointermove',   onMove);
            document.removeEventListener('pointerup',     onUp);
            document.removeEventListener('pointercancel', onUp);
            if (!moved) return;
            this._setDirty();
            this._rescheduleIfPlaying();
            this._renderStrip();
        };

        document.addEventListener('pointermove',   onMove);
        document.addEventListener('pointerup',     onUp);
        document.addEventListener('pointercancel', onUp);
        e.preventDefault();
    }

    // ─── Preset picker ────────────────────────────────────────────────────────

    _openPicker(zoneId) {
        this._pickerZoneId = zoneId || this._tl?.zones[0]?.id || 'full';
        this._pickerEl.hidden = false;
        this._pickerSearch.value = '';
        this._pickerTab = 'all';
        this._pickerTabs?.querySelectorAll('[data-tab]').forEach(b =>
            b.classList.toggle('active', b.dataset.tab === 'all')
        );
        this._filterPicker('');
        setTimeout(() => this._pickerSearch.focus(), 30);
    }

    _closePicker() {
        this._pickerEl.hidden = true;
    }

    _filterPicker(query) {
        const q = query.toLowerCase().trim();

        let pool = this._presetNames;
        if (this._pickerTab === 'favorites') {
            const favs = new Set(this._primaryEngine.favoritePool || []);
            pool = pool.filter(n => favs.has(n));
        } else if (this._pickerTab === 'custom') {
            pool = pool.filter(n => n.startsWith('custom:'));
        }

        const matches = q ? pool.filter(n => displayName(n).toLowerCase().includes(q)) : pool;
        const MAX     = 100;
        const shown   = matches.slice(0, MAX);

        const tabLabel = this._pickerTab === 'favorites' ? 'favorites'
                       : this._pickerTab === 'custom'    ? 'my presets'
                       : 'presets';
        this._pickerCount.textContent = q
            ? `${matches.length} match${matches.length !== 1 ? 'es' : ''}`
            : `${pool.length} ${tabLabel}`;

        this._pickerList.innerHTML = '';
        for (const name of shown) {
            const item = document.createElement('div');
            item.className = 'tl-picker-item' + (name.startsWith('custom:') ? ' custom-preset' : '');
            item.textContent = displayName(name);
            item.dataset.name = name;
            item.role = 'option';
            item.addEventListener('click', () => {
                // Add to the data model only. The canvas reflects the playhead —
                // addEntry re-derives it; the new preset never force-loads here.
                this.addEntry(name, this._pickerZoneId);
                this._closePicker();
            });
            this._pickerList.appendChild(item);
        }

        if (matches.length > MAX) {
            const more = document.createElement('div');
            more.className = 'tl-picker-item';
            more.style.color = 'var(--text-4)';
            more.textContent = `… ${matches.length - MAX} more — type to narrow`;
            more.style.pointerEvents = 'none';
            this._pickerList.appendChild(more);
        }
    }

    // ─── Quick edit popover ───────────────────────────────────────────────────

    _openQuickEdit(id, anchorEl) {
        const entry = this._tl?.entries.find(e => e.id === id);
        if (!entry) return;
        this._closeColorPicker();

        // Deactivate any previously active menu button, then activate this one
        document.querySelectorAll('.tl-block-menu-btn.is-active').forEach(el => el.classList.remove('is-active'));
        const menuBtn = anchorEl?.querySelector?.('.tl-block-menu-btn') ?? anchorEl?.closest?.('.tl-block')?.querySelector('.tl-block-menu-btn');
        if (menuBtn) menuBtn.classList.add('is-active');

        this._qeEntryId        = id;
        this._qeTitle.textContent = displayName(entry.presetName);
        this._qeSwatch.style.background = entry.color || colorFor(entry.presetName);

        const rect = anchorEl.getBoundingClientRect();
        const popW = 260, popH = 110;
        let left = rect.left;
        let top  = rect.top - popH - 8;
        if (top < 10) top = rect.bottom + 8;
        if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;

        this._quickEditEl.style.left = `${left}px`;
        this._quickEditEl.style.top  = `${top}px`;
        this._quickEditEl.hidden = false;
    }

    _closeQuickEdit() {
        this._closeColorPicker();
        this._quickEditEl.hidden = true;
        this._qeEntryId = null;
        document.querySelectorAll('.tl-block-menu-btn.is-active').forEach(el => el.classList.remove('is-active'));
    }

    // ─── Block colour picker ──────────────────────────────────────────────────

    _toggleColorPicker() {
        if (!this._colorPickerEl.hidden) { this._closeColorPicker(); return; }
        this._openColorPicker();
    }

    _openColorPicker() {
        const entry = this._tl?.entries.find(e => e.id === this._qeEntryId);
        if (!entry) return;
        const current = (entry.color || colorFor(entry.presetName)).toLowerCase();

        // Build the 4×4 swatch grid
        this._colorGridEl.innerHTML = '';
        for (const hex of BLOCK_COLORS) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'tl-color-sw' + (hex.toLowerCase() === current ? ' selected' : '');
            sw.style.background = hex;
            sw.setAttribute('aria-label', hex);
            sw.addEventListener('click', () => this._pickColor(hex));
            this._colorGridEl.appendChild(sw);
        }

        // Anchor below the swatch, clamp to the viewport
        const rect = this._qeSwatch.getBoundingClientRect();
        const popW = 164, popH = 164;
        let left = rect.left;
        let top  = rect.bottom + 8;
        if (top + popH > window.innerHeight - 10) top = rect.top - popH - 8;
        if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;
        this._colorPickerEl.style.left = `${left}px`;
        this._colorPickerEl.style.top  = `${top}px`;
        this._colorPickerEl.hidden = false;
        this._qeSwatch.classList.add('is-active');
    }

    _closeColorPicker() {
        this._colorPickerEl.hidden = true;
        this._qeSwatch.classList.remove('is-active');
    }

    _pickColor(hex) {
        const id = this._qeEntryId;
        if (id) {
            this._updateEntry(id, { color: hex });        // sets colour, _setDirty, _renderStrip
            this._qeSwatch.style.background = hex;
            // _renderStrip rebuilt the block — re-mark its menu button active
            const btn = this._tracksEl?.querySelector(`.tl-block[data-id="${id}"] .tl-block-menu-btn`);
            if (btn) btn.classList.add('is-active');
        }
        this._closeColorPicker();
    }

    // ─── Cue — double-click a block to crossfade in and continue timeline ─────

    _cueEntry(id) {
        const entry = this._tl?.entries.find(e => e.id === id);
        if (!entry) return;
        const zd = this._zoneMap.get(entry.zoneId);
        if (!zd) return;

        const blend = entry.blendTime ?? 2;

        // Load preset with crossfade immediately — before seeking so _playZone
        // doesn't double-load this zone with blend 0.
        zd.engine.loadPreset(entry.presetName, blend).catch(() => {});
        this._currentZonePreset.set(entry.zoneId, entry.presetName);
        this._fadeZoneCover(entry.zoneId, 0, blend);

        // Guard: _scrubTo → _playZone will skip the immediate-entry load for this zone
        this._cueZoneId = entry.zoneId;
        this._scrubTo(entry.startTime);
        this._cueZoneId = null;
    }

    // ─── Live-edit reschedule ─────────────────────────────────────────────────
    // Called after any data-model mutation (drag, resize, edit, duplicate, delete, add).
    // Cancels all stale setTimeout handles and rebuilds the schedule from the current
    // playhead position against the updated data model. No-op when not playing.
    _rescheduleIfPlaying() {
        if (!this._playing) return;
        const tNow = (performance.now() - this._playStartWall) / 1000;
        this._scrubTo(tNow);
    }

    // ─── Context menu ─────────────────────────────────────────────────────────

    _openContextMenu(e, id) {
        this._ctxEntryId = id;
        const x = Math.min(e.clientX, window.innerWidth  - 160);
        const y = Math.min(e.clientY, window.innerHeight -  80);
        this._ctxMenu.style.left = `${x}px`;
        this._ctxMenu.style.top  = `${y}px`;
        this._ctxMenu.hidden = false;
    }

    _closeContextMenu() {
        this._ctxMenu.hidden = true;
        this._ctxEntryId = null;
    }

    // ─── Playback — wall-clock, per-zone ─────────────────────────────────────

    play() {
        if (!this._tl?.entries.length) {
            this._toast('Add presets to the timeline first', true);
            return;
        }
        if (this._playing) return;
        this._playing      = true;
        this._markerHoldTime = null; // Clear any VJ hold mode

        // Start from the parked playhead position
        const from = this._currentTime;
        this._playStartWall = performance.now() - from * 1000;
        this._lastTickTime  = from;

        // Clear preset tracking — fresh play always reloads (no stale same-preset guards)
        this._currentZonePreset.clear();

        // Re-cover all zones; _playZone() lifts each cover when its first entry fires
        for (const [zId] of this._zoneCovers) this._fadeZoneCover(zId, 1, 0);  // instant cover all
        // Ensure all zone engines are rendering
        for (const [, zd] of this._zoneMap) {
            if (!zd.engine.isRunning) zd.engine.startRenderLoop();
        }

        this._btnPlayStop.classList.add('is-playing');
        this._psPlayIcon.style.display = 'none';
        this._psStopIcon.style.display = '';
        this._psLabel.textContent = 'Stop';

        // Launch per-zone playback chains from the parked position
        for (const zone of (this._tl.zones || [])) {
            this._playZone(zone.id, from);
        }

        // Master stop timer — remaining duration from current position
        const total     = this._totalDuration();
        const remaining = total - from;
        if (remaining <= 0) { this._pauseAtEnd(); return; }

        this._masterTimer = setTimeout(() => {
            if (!this._playing) return;
            if (this._looping) {
                this._currentTime = 0;
                this.stop();
                requestAnimationFrame(() => this.play());
            } else {
                // Natural end — VJ mode: pause timeline but keep visuals running
                this._pauseAtEnd();
                this._currentTime = 0;
                this._playheadEl.style.left = '0px';
                this._updateTimeDisplay(0);
            }
        }, remaining * 1000);

        this._rafId = requestAnimationFrame(() => this._tickPlayhead());
    }

    // Schedule all entries for a zone from `fromTime` seconds.
    // The entry active at fromTime is loaded immediately (instant, no blend).
    // Future entries fade in from black; entries ending before a gap fade out.
    // Transition style is extensible via the `style` param in _fadeZoneCover.
    _playZone(zoneId, fromTime = 0, blend = 0) {
        const entries = this._zoneEntriesFor(zoneId);
        const zd      = this._zoneMap.get(zoneId);
        if (!zd || !entries.length) return;

        const zone = (this._tl.zones || []).find(z => z.id === zoneId);
        const shouldBlackout = !zone || zone.gapBehavior !== 'hold';

        const timers = [];

        // Load the entry active right now (if any) instantly, then skip it in
        // the scheduling loop below so it isn't loaded a second time.
        let immediateEntryId = null;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const st = entry.startTime ?? 0;
            if (st <= fromTime && fromTime < st + entry.duration) {
                immediateEntryId = entry.id;
                if (this._cueZoneId !== zoneId) {
                    // Skip loadPreset if this preset is already showing (live-edit reschedule).
                    // Always lift the cover — play() may have just covered everything to black.
                    if (this._currentZonePreset.get(zoneId) !== entry.presetName) {
                        zd.engine.loadPreset(entry.presetName, blend).catch(() => {});
                    }
                    this._fadeZoneCover(zoneId, 0, 0);  // instant reveal (scrub/seek)
                    this._currentZonePreset.set(zoneId, entry.presetName);
                }

                // Schedule fade-out at end of this entry if there's a gap after it
                const entryEnd  = st + entry.duration;
                const next      = entries[i + 1];
                const nextStart = next ? (next.startTime ?? 0) : Infinity;
                if (shouldBlackout && entryEnd < nextStart) {
                    const fadeDur  = Math.min(entry.blendTime, entry.duration);
                    const fadeStart = entryEnd - fadeDur;
                    const fadeDelay = Math.max(0, (fadeStart - fromTime) * 1000);
                    timers.push(setTimeout(() => {
                        if (!this._playing) return;
                        this._fadeZoneCover(zoneId, 1, fadeDur);  // fade to black
                    }, fadeDelay));
                }
                break;
            }
        }

        // In a gap at fromTime — raise cover to black so next entry's fade-in starts clean.
        // This handles: delete-while-playing, and playback starting in a gap.
        if (immediateEntryId === null) {
            this._fadeZoneCover(zoneId, 1, 0);
            this._currentZonePreset.delete(zoneId);
        }

        // Track true end of last processed entry — entries[i-1] is wrong after skips
        let lastEnd = -Infinity;
        for (const e of entries) {
            const s = e.startTime ?? 0;
            if (s + e.duration <= fromTime) lastEnd = Math.max(lastEnd, s + e.duration);
        }
        if (immediateEntryId) {
            const imm = entries.find(e => e.id === immediateEntryId);
            if (imm) lastEnd = Math.max(lastEnd, (imm.startTime ?? 0) + imm.duration);
        }

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const st    = entry.startTime ?? 0;

            // Skip entries already handled by the immediate-load above
            if (entry.id === immediateEntryId) continue;

            // Only schedule entries that haven't started yet
            if (st < fromTime) continue;

            // Determine if there's a gap before this entry
            const hasGapBefore = st > lastEnd + 0.01;
            const fadeDurIn    = hasGapBefore ? entry.blendTime : 0;
            const fadeInDelay  = Math.max(0, (st - fadeDurIn - fromTime) * 1000);
            const delay        = (st - fromTime) * 1000;

            if (hasGapBefore) {
                // Load preset first with blend=0 (instant GPU write — previous preset
                // is overwritten in the framebuffer on the very next frame). Then wait
                // one rAF tick so that frame renders, then fade the cover. This prevents
                // the previous preset bleeding through the cover during the fade-in.
                timers.push(setTimeout(() => {
                    if (!this._playing) return;
                    zd.engine.loadPreset(entry.presetName, 0).catch(() => {});
                    this._currentZonePreset.set(zoneId, entry.presetName);
                    requestAnimationFrame(() => {
                        if (!this._playing) return;
                        this._fadeZoneCover(zoneId, 0, fadeDurIn);
                    });
                }, fadeInDelay));
            } else {
                // Consecutive block — cover stays transparent, Butterchurn's internal
                // blend handles the visual crossfade.
                timers.push(setTimeout(() => {
                    if (!this._playing) return;
                    this._fadeZoneCover(zoneId, 0, 0);
                    zd.engine.loadPreset(entry.presetName, entry.blendTime).catch(() => {});
                    this._currentZonePreset.set(zoneId, entry.presetName);
                }, delay));
            }

            // Schedule fade-out at end of this entry if there's a gap after it
            const entryEnd  = st + entry.duration;
            const next      = entries[i + 1];
            const nextStart = next ? (next.startTime ?? 0) : Infinity;
            if (shouldBlackout && entryEnd < nextStart) {
                const fadeDurOut = Math.min(entry.blendTime, entry.duration);
                const fadeStart  = entryEnd - fadeDurOut;
                const fadeDelay  = Math.max(0, (fadeStart - fromTime) * 1000);
                timers.push(setTimeout(() => {
                    if (!this._playing) return;
                    this._fadeZoneCover(zoneId, 1, fadeDurOut);  // fade to black
                }, fadeDelay));
            }

            lastEnd = Math.max(lastEnd, st + entry.duration);
        }

        this._zoneTimers.set(zoneId, timers);
    }

    // Pause timeline scheduling at a specific time, but KEEP animation running
    _pauseTimelineAt(t) {
        this._playing = false;
        this._currentTime = t;
        this._markerHoldTime = null;

        clearTimeout(this._masterTimer);
        this._masterTimer = null;

        for (const timers of this._zoneTimers.values()) for (const h of timers) clearTimeout(h);
        this._zoneTimers.clear();

        cancelAnimationFrame(this._rafId);
        this._rafId = null;

        // Update UI to stopped state
        this._btnPlayStop.classList.remove('is-playing');
        this._psPlayIcon.style.display = '';
        this._psStopIcon.style.display = 'none';
        this._psLabel.textContent = 'Play';

        // Keep playhead visible at position
        this._playheadEl.style.left = `${t * this._pxPerSec}px`;
        this._playheadEl.style.display = '';
        this._updateTimeDisplay(t);

        // DO NOT stop engines - animation continues!
    }

    // Cancel the master + per-zone scheduling timers; leaves the rAF render loop
    // running — used by the `stop` marker action (timeline halts, visuals run on).
    _clearAllTimers() {
        clearTimeout(this._masterTimer);
        this._masterTimer = null;
        for (const timers of this._zoneTimers.values()) for (const t of timers) clearTimeout(t);
        this._zoneTimers.clear();
    }

    stop() {
        if (!this._playing && this._markerHoldTime === null) return;
        this._playing = false;
        this._markerHoldTime = null; // Clear VJ hold mode on manual stop

        clearTimeout(this._masterTimer);
        this._masterTimer = null;

        for (const timers of this._zoneTimers.values()) for (const t of timers) clearTimeout(t);
        this._zoneTimers.clear();

        cancelAnimationFrame(this._rafId);
        this._rafId = null;

        this._currentZonePreset.clear();

        // VJ MODE: DO NOT stop engines - keep animations running!
        // DO NOT fade zone covers - show keeps displaying visuals
        // for (const [, zd] of this._zoneMap) zd.engine.stopRenderLoop();
        // for (const [zId] of this._zoneCovers) this._fadeZoneCover(zId, 1, 0);

        this._btnPlayStop.classList.remove('is-playing');
        this._psPlayIcon.style.display = '';
        this._psStopIcon.style.display = 'none';
        this._psLabel.textContent = 'Play';

        // Keep playhead visible at its current position (don't reset)
        this._playheadEl.style.left    = `${this._currentTime * this._pxPerSec}px`;
        this._playheadEl.style.display = '';
        this._updateTimeDisplay(this._currentTime);
        if (!this._isFullscreen) this._showOverlays();
    }

    togglePlayback() {
        this._playing ? this.stop() : this.play();
    }

    _toggleLoop() {
        this._looping = !this._looping;
        this._btnLoop.classList.toggle('active', this._looping);
        if (this._tl) this._tl.loop = this._looping;
    }

    _tickPlayhead() {
        if (!this._playing) return;

        // VJ Marker Hold Mode: Frozen at marker time, animation continues
        if (this._markerHoldTime !== null) {
            // Keep playhead parked at marker, but keep rAF going for animation
            this._rafId = requestAnimationFrame(() => this._tickPlayhead());
            return;
        }

        const tNow = (performance.now() - this._playStartWall) / 1000;

        // Check for markers crossed between last tick and now
        if (this._tl?.markers && this._lastTickTime !== undefined) {
            const lastT = this._lastTickTime;
            for (const m of this._tl.markers) {
                // Loop region — crossing the loop END wraps the playhead to the loop START.
                if (m.action === 'loop' && m.loopEnd != null && m.loopEnd > m.time
                    && m.loopEnd > lastT && m.loopEnd <= tNow) {
                    this._scrubTo(m.time, 1.0);   // 1s crossfade on the loop wrap (relaxed jump)
                    return;
                }
                // Stop marker — park the playhead, keep animation running (show goes on).
                if (m.action === 'stop' && m.time > lastT && m.time <= tNow) {
                    this._markerHoldTime = m.time;
                    this._currentTime    = m.time;
                    this._lastTickTime   = m.time;
                    this._clearAllTimers();
                    this._playheadEl.style.left = `${m.time * this._pxPerSec}px`;
                    this._updateTimeDisplay(m.time);
                    this._rafId = requestAnimationFrame(() => this._tickPlayhead());
                    return;
                }
            }
        }

        this._lastTickTime = tNow;
        this._currentTime = tNow;  // persist position every frame

        const x = tNow * this._pxPerSec;
        this._playheadEl.style.left    = `${x}px`;
        this._playheadEl.style.display = '';

        // Auto-scroll
        const scrollLeft = this._scrollEl.scrollLeft;
        const viewW      = this._scrollEl.clientWidth;
        const absX       = x + ZONE_COL_W;
        if (absX < scrollLeft + 140 || absX > scrollLeft + viewW - 40) {
            this._scrollEl.scrollLeft = Math.max(0, absX - 180);
        }

        this._updateTimeDisplay(tNow);
        this._rafId = requestAnimationFrame(() => this._tickPlayhead());
    }

    _scrubTo(t, blend = 0) {
        this._currentTime  = t;  // always persist the parked position
        this._lastTickTime = t;
        this._playheadEl.style.left    = `${t * this._pxPerSec}px`;
        this._playheadEl.style.display = '';
        this._updateTimeDisplay(t);

        if (!this._playing) {
            // Load presets corresponding to time t into the view
            if (this._tl?.zones && this._tl?.entries) {
                for (const zone of this._tl.zones) {
                    const entries = this._tl.entries.filter(e => e.zoneId === zone.id)
                                                    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
                    
                    let activeEntry = null;
                    for (const e of entries) {
                        const start = e.startTime || 0;
                        if (t >= start && t < start + e.duration) {
                            activeEntry = e;
                            break;
                        }
                    }

                    if (activeEntry) {
                        const zd = this._zoneMap.get(zone.id);
                        if (zd && zd.engine) {
                            if (this._cueZoneId !== zone.id) {
                                zd.engine.loadPreset(activeEntry.presetName, 0).catch(() => {});
                                this._fadeZoneCover(zone.id, 0, 0);
                            }
                            // Try to render a single frame if the engine allows it when stopped
                            if (typeof zd.engine.renderFrame === 'function' && !zd.engine.isRunning) {
                                zd.engine.renderFrame();
                            }
                        }
                    } else {
                        // Playhead is in an empty gap — cover this zone
                        this._fadeZoneCover(zone.id, 1, 0);
                    }
                }
            }
            return;
        }

        // Restart playback from position t using wall-clock offset
        clearTimeout(this._masterTimer);
        for (const timers of this._zoneTimers.values()) for (const h of timers) clearTimeout(h);
        this._zoneTimers.clear();
        cancelAnimationFrame(this._rafId);

        this._playStartWall = performance.now() - t * 1000;

        for (const zone of (this._tl?.zones || [])) {
            this._playZone(zone.id, t, blend);
        }

        const remaining = this._totalDuration() - t;
        if (remaining <= 0) { this._pauseAtEnd(); return; }

        this._masterTimer = setTimeout(() => {
            if (!this._playing) return;
            if (this._looping) {
                this._currentTime = 0;
                this.stop();
                requestAnimationFrame(() => this.play());
            } else {
                this.stop();
                this._currentTime = 0;
                this._playheadEl.style.left = '0px';
                this._updateTimeDisplay(0);
            }
        }, remaining * 1000);

        this._rafId = requestAnimationFrame(() => this._tickPlayhead());
    }

    _updateTimeDisplay(tNow) {
        const total = this._totalDuration();
        this._timeDisp.textContent = `${fmtTime(tNow)} / ${fmtTime(total)}`;
    }

    // VJ Mode: pause timeline at end without stopping engines (no black screen)
    _pauseAtEnd() {
        if (!this._playing) return;
        this._playing = false;
        this._markerHoldTime = null;

        clearTimeout(this._masterTimer);
        this._masterTimer = null;
        for (const timers of this._zoneTimers.values()) for (const t of timers) clearTimeout(t);
        this._zoneTimers.clear();
        cancelAnimationFrame(this._rafId);
        this._rafId = null;

        // VJ: Keep engines running - reload presets at current time so visuals continue
        for (const zone of (this._tl?.zones || [])) {
            this._playZone(zone.id, this._currentTime);
        }

        // VJ: Update UI to stopped state
        this._btnPlayStop.classList.remove('is-playing');
        this._psPlayIcon.style.display = '';
        this._psStopIcon.style.display = 'none';
        this._psLabel.textContent = 'Play';
    }

    _skipToPrevBlock() {
        if (!this._tl?.entries?.length) return;
        // Find all block boundaries (start times) across all zones
        const boundaries = new Set();
        boundaries.add(0); // Always allow jumping to start
        for (const e of this._tl.entries) {
            const st = e.startTime ?? 0;
            if (st < this._currentTime) boundaries.add(st);
        }
        const sorted = Array.from(boundaries).sort((a, b) => a - b);
        // Find the largest boundary strictly less than current time
        const target = sorted.reverse().find(t => t < this._currentTime - 0.5);
        if (target !== undefined) this._scrubTo(target);
    }

    _skipToNextBlock() {
        if (!this._tl?.entries?.length) return;
        const total = this._totalDuration();
        // Find all block start times across all zones
        const boundaries = new Set();
        for (const e of this._tl.entries) {
            boundaries.add(e.startTime ?? 0);
        }
        const sorted = Array.from(boundaries).sort((a, b) => a - b);
        // Find the next boundary strictly after current time
        const next = sorted.find(t => t > this._currentTime + 0.5); // +0.5s to avoid re-triggering same block
        if (next !== undefined) {
            this._scrubTo(next);
        } else if (this._currentTime < total - 1) {
            // At end of content - jump to end
            this._scrubTo(total);
        } else {
            // At absolute end - wrap to start
            this._scrubTo(0);
        }
    }

    // ─── Overlay visibility ───────────────────────────────────────────────

    _showOverlays() {
        this._overlays.forEach(el => el.classList.remove('tl-hidden'));
        if (this._stripVisible) this._stripEl.style.opacity = '';
    }

    _hideOverlays() {
        this._overlays.forEach(el => el.classList.add('tl-hidden'));
        if (this._stripVisible) this._stripEl.style.opacity = '0';
    }

    // ─── Fullscreen ───────────────────────────────────────────────────────

    async toggleFullscreen() {
        if (this._isFullscreen) {
            await this._exitFullscreen();
        } else {
            await this._enterFullscreen();
        }
    }

    async _enterFullscreen() {
        try {
            if (window.__TAURI__) {
                // Tauri / macOS app — use Tauri window API.
                // Dynamic import path kept in a variable so Vite's static resolver
                // doesn't attempt to bundle a package that only exists in Tauri builds.
                const mod = '@tauri-apps/api/window';
                const { appWindow } = await import(/* @vite-ignore */ mod);
                await appWindow.setFullscreen(true);
                this._isFullscreen = true;
            } else {
                // Web browser — request native fullscreen
                const el = document.documentElement;
                if (el.requestFullscreen) await el.requestFullscreen();
                else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
                // _isFullscreen is set in _onFullscreenChange
            }
            this._hideOverlays();
            this._updateFsBtn(true);
        } catch (err) {
            console.warn('Fullscreen enter failed:', err);
        }
    }

    async _exitFullscreen() {
        try {
            if (window.__TAURI__) {
                const mod = '@tauri-apps/api/window';
                const { appWindow } = await import(/* @vite-ignore */ mod);
                await appWindow.setFullscreen(false);
                this._isFullscreen = false;
            } else {
                if (document.exitFullscreen) await document.exitFullscreen();
                else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
                // _isFullscreen is set in _onFullscreenChange
            }
            this._showOverlays();
            this._updateFsBtn(false);
        } catch (err) {
            console.warn('Fullscreen exit failed:', err);
        }
    }

    _onFullscreenChange() {
        const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        this._isFullscreen = inFs;
        this._updateFsBtn(inFs);
        if (!inFs) this._showOverlays();
    }

    _updateFsBtn(isFullscreen) {
        const btn = document.getElementById('tl-fullscreen-btn');
        if (btn) btn.style.display = isFullscreen ? 'none' : '';
        document.body.classList.toggle('tl-fullscreen', isFullscreen);
    }


    // ─── Strip toggle ─────────────────────────────────────────────────────────

    toggleStrip() {
        this._stripVisible = !this._stripVisible;
        this._stripEl.style.opacity      = this._stripVisible ? '' : '0';
        this._stripEl.style.pointerEvents = this._stripVisible ? '' : 'none';
        const transport = document.getElementById('tl-transport');
        if (transport) transport.style.bottom = this._stripVisible
            ? getComputedStyle(document.documentElement).getPropertyValue('--strip-h')
            : '0';
    }

    // ─── Escape handler ───────────────────────────────────────────────────────

    handleEscape() {
        if (this._guideModal && !this._guideModal.hidden) { this._guideModal.hidden = true; return; }
        if (!this._zoneMgrEl?.hidden)  { this._closeZoneMgr();     return; }
        if (!this._pickerEl.hidden)    { this._closePicker();       return; }
        if (!this._colorPickerEl.hidden) { this._closeColorPicker(); return; }
        if (!this._quickEditEl.hidden) { this._closeQuickEdit();    return; }
        if (!this._ctxMenu.hidden)     { this._closeContextMenu();  return; }
        if (!this._entryDeleteModal.hidden) { this._pendingDeleteId = null; this._entryDeleteModal.hidden = true; return; }
        if (!this._deleteModal.hidden) { this._deleteModal.hidden = true; return; }
        if (this._isFullscreen)        { this._exitFullscreen();    return; }
        if (this._playing)             { this.stop();               return; }
    }

    toggleKeyboardGuide() {
        if (!this._guideModal) return;
        this._guideModal.hidden = !this._guideModal.hidden;
    }

    jumpToMarker(indexOrId) {
        if (!this._tl || !this._tl.markers || this._tl.markers.length === 0) return;
        
        let m = null;
        if (typeof indexOrId === 'string') {
            m = this._tl.markers.find(x => x.id === indexOrId);
        } else if (typeof indexOrId === 'number') {
            const sortedMarkers = [...this._tl.markers].sort((a, b) => a.time - b.time);
            if (indexOrId >= 0 && indexOrId < sortedMarkers.length) {
                m = sortedMarkers[indexOrId];
            }
        }
        
        if (m) {
            this._scrubTo(m.time);
        }
    }

    // ─── JSON Export / Import ─────────────────────────────────────────────────

    async _exportTimeline() {
        if (!this._tl) return;
        try {
            this._toast('Preparing export…');
            const json     = await exportTimelineBundle(this._tl);
            const filename = `${(this._tl.name || 'timeline').replace(/[^a-z0-9_\-]/gi, '_')}.dcshow.json`;
            const saved    = await downloadFile(filename, json);
            if (saved) {
                const mb = (json.length / 1024 / 1024).toFixed(1);
                this._toast(`Exported: ${this._tl.name} (${mb} MB)`);
            }
        } catch (err) {
            this._toast('Export failed: ' + err.message, true);
        }
    }

    async _importFromFile(file) {
        try {
            this._toast('Importing…');
            const text     = await file.text();
            const imported = await importTimelineBundle(text);
            this._timelines[imported.id] = imported;
            this._tl    = JSON.parse(JSON.stringify(imported));
            this._migrateEntryStartTimes(this._tl);
            this._nameInput.value = this._tl.name;
            this._refreshSelector();
            this._selectEl.value = this._tl.id;
            this._syncZoneCanvases();
            this._primaryEngine.refreshCustomPresets();
            this._renderStrip();
            this._setClean();
            // Show result modal if the bundle included custom presets
            if (imported._presetImport) {
                showImportResult({ ...imported._presetImport, context: 'preset' });
            } else {
                this._toast(`Imported: ${imported.name}`);
            }
        } catch (err) {
            this._toast('Import failed: ' + err.message, true);
        }
    }

    // ─── Toast ────────────────────────────────────────────────────────────────

    _toast(msg, isError = false) {
        const el = this._toastEl;
        el.textContent = msg;
        el.className   = isError ? 'error' : '';
        el.hidden      = false;
        el.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            el.style.transition = 'opacity 0.4s';
            el.style.opacity    = '0';
            setTimeout(() => { el.hidden = true; el.style.transition = ''; }, 420);
        }, 2400);
    }
}
