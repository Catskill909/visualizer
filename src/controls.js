/**
 * ControlPanel — UI bindings, auto-hide, keyboard shortcuts, preset drawer
 */
import {
  getCustomPreset,
  deleteCustomPreset,
  deleteImage,
  exportPreset,
  exportAllPresets,
  importFromFile,
  loadAllCustomPresets,
  CUSTOM_PREFIX,
} from './customPresets.js';
import { showImportResult } from './importResultModal.js';

export class ControlPanel {
  constructor(engine) {
    this.engine = engine;
    this.hideTimer = null;
    this.hideDelay = 3000;
    this.drawerOpen = false;
    this.toastTimer = null;
    this.guideOpen = false;
    this.cycleOpen = false;
    this.tuningOpen = false;
    this.hoveringControls = false;
    this.wakeLock = null;
    this.outputOpen = false;
    this.outputSettings = this._loadOutputSettings();
    this.favorites = this.loadFavorites();
    this.hidden = this.loadHidden();
    this.showHidden = false; // maintenance mode — resets to off on every load
    this.currentTab = 'all'; // 'all', 'favorites', or 'custom'
    this.vuAnimId = null;

    // DOM refs
    this.els = {
      startScreen: document.getElementById('start-screen'),
      controlBar: document.getElementById('control-bar'),
      presetName: document.getElementById('preset-name'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnCycle: document.getElementById('btn-cycle'),
      cyclePanel: document.getElementById('cycle-panel'),
      cycleStatusDot: document.getElementById('cycle-status-dot'),
      cycleHint: document.getElementById('cycle-hint'),
      toggleCycle: document.getElementById('toggle-cycle'),
      toggleCycleRandom: document.getElementById('toggle-cycle-random'),
      toggleCycleFavorites: document.getElementById('toggle-cycle-favorites'),
      cycleInterval: document.getElementById('cycle-interval'),
      cycleIntervalLabel: document.getElementById('cycle-interval-label'),
      btnUseMic: document.getElementById('btn-use-mic'),
      btnUseFile: document.getElementById('btn-use-file'),
      btnPresets: document.getElementById('btn-presets'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      btnMic: document.getElementById('btn-mic'),
      deviceSelect: document.getElementById('device-select'),
      btnFile: document.getElementById('btn-file'),
      fileInput: document.getElementById('file-input'),
      presetDrawer: document.getElementById('preset-drawer'),
      presetSearch: document.getElementById('preset-search'),
      presetList: document.getElementById('preset-list'),
      presetCount: document.getElementById('preset-count'),
      btnCloseDrawer: document.getElementById('btn-close-drawer'),
      btnPresetStudio: document.getElementById('btn-preset-studio'),
      btnTimeline: document.getElementById('btn-timeline'),
      btnOpenEditor: document.getElementById('btn-open-editor'),
      tabAll: document.getElementById('tab-all'),
      tabFavorites: document.getElementById('tab-favorites'),
      tabCustom: document.getElementById('tab-custom'),
      toggleShowHidden: document.getElementById('toggle-show-hidden'),
      btnUnhideAll: document.getElementById('btn-unhide-all'),
      hiddenCountLabel: document.getElementById('hidden-count-label'),
      unhideModal: document.getElementById('unhide-modal'),
      unhideModalCount: document.getElementById('unhide-modal-count'),
      btnCancelUnhide: document.getElementById('btn-cancel-unhide'),
      btnConfirmUnhide: document.getElementById('btn-confirm-unhide'),
      deletePresetModal: document.getElementById('delete-preset-modal'),
      deletePresetName: document.getElementById('delete-preset-name'),
      btnCancelDeletePreset: document.getElementById('btn-cancel-delete-preset'),
      btnConfirmDeletePreset: document.getElementById('btn-confirm-delete-preset'),
      backupBar: document.getElementById('backup-bar'),
      btnExportAll: document.getElementById('btn-export-all'),
      btnImportPresets: document.getElementById('btn-import-presets'),
      importFileInput: document.getElementById('import-file-input'),
      backupCount: document.getElementById('backup-count'),
      btnFavorite: document.getElementById('btn-favorite'),
      btnHidePreset: document.getElementById('btn-hide-preset'),
      btnHelp: document.getElementById('btn-help'),
      btnAudioTuning: document.getElementById('btn-audio-tuning'),
      audioTuningPanel: document.getElementById('audio-tuning-panel'),
      tuningEnergy: document.getElementById('tuning-energy'),
      toggleAgc: document.getElementById('toggle-agc'),
      toggleKicklock: document.getElementById('toggle-kicklock'),
      toggleNoisegate: document.getElementById('toggle-noisegate'),
      noiseGateThresholdRow: document.getElementById('noisegate-threshold-row'),
      noiseGateThreshold: document.getElementById('noisegate-threshold'),
      vuMeterBar: document.getElementById('vu-meter-bar'),
      signalStatus: document.getElementById('signal-status'),
      keyboardGuide: document.getElementById('keyboard-guide'),
      btnCloseGuide: document.getElementById('btn-close-guide'),
      welcomeGuide: document.getElementById('welcome-guide'),
      btnWelcomeHelp: document.getElementById('btn-welcome-help'),
      btnCloseWelcome: document.getElementById('btn-close-welcome'),
      flashOverlay: document.getElementById('flash-overlay'),
      canvas: document.getElementById('visualizer-canvas'),
      audioPlayer: document.getElementById('audio-player'),
      audioFilename: document.getElementById('audio-filename'),
      audioTime: document.getElementById('audio-time'),
      audioSeek: document.getElementById('audio-seek'),
      btnPlayPause: document.getElementById('btn-play-pause'),
      iconPlay: document.getElementById('icon-play'),
      iconPause: document.getElementById('icon-pause'),
      audioVolume: document.getElementById('audio-volume'),
      toast: document.getElementById('toast'),
      permissionError: document.getElementById('permission-error'),
      btnRetryPermission: document.getElementById('btn-retry-permission'),
      btnClosePermission: document.getElementById('btn-close-permission'),
      btnOutput: document.getElementById('btn-output'),
      outputPanel: document.getElementById('output-panel'),
      outputStatusDot: document.getElementById('output-status-dot'),
      outputResolution: document.getElementById('output-resolution'),
      outputCustomFields: document.getElementById('output-custom-fields'),
      outputCustomW: document.getElementById('output-custom-w'),
      outputCustomH: document.getElementById('output-custom-h'),
      btnOutputCustomApply: document.getElementById('btn-output-custom-apply'),
      outputAspect: document.getElementById('output-aspect'),
      outputFill: document.getElementById('output-fill'),
      toggleVirtualCamera: document.getElementById('toggle-virtual-camera'),
      virtualCameraHint: document.getElementById('virtual-camera-hint'),
      canvasWrapper: document.getElementById('canvas-wrapper'),
    };

    this.bindEvents();
  }

  bindEvents() {
    const { els, engine } = this;

    this.initPermissionRetry();
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());

    // --- Start screen & Audio loading ---
    els.btnMic.addEventListener('click', () => this.startWithMic());

    const triggerFilePicker = async () => {
      if (window.__TAURI__) {
        const result = await window.__TAURI__.invoke('pick_audio_file');
        if (!result) return;
        const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
        const file = new File([bytes], result.name, { type: 'audio/mpeg' });
        this.handleFileSelection(file);
      } else {
        els.fileInput.click();
      }
    };
    els.btnFile.addEventListener('click', triggerFilePicker);

    els.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.handleFileSelection(e.target.files[0]);
      e.target.value = '';
    });

    // --- Transport ---
    els.btnPrev.addEventListener('click', () => {
      const name = engine.prevPreset();
      this.updatePresetName(name);
      this.showToast('⏮ ' + this.truncate(name, 50));
    });

    els.btnNext.addEventListener('click', () => {
      const name = engine.nextPreset();
      this.updatePresetName(name);
      this.showToast('⏭ ' + this.truncate(name, 50));
    });

    // --- Cycle popover ---
    els.btnCycle.addEventListener('click', () => this.toggleCyclePanel());

    els.toggleCycle.addEventListener('change', (e) => {
      engine.setAutoCycle(e.target.checked);
      this.updateCycleUI();
      this.showToast(e.target.checked ? '🔁 Auto-cycle ON' : '⏸ Auto-cycle OFF');
    });

    els.toggleCycleRandom.addEventListener('change', (e) => {
      engine.setRandomCycleOrder(e.target.checked);
      this.showToast(e.target.checked ? '🎲 Random order' : '➡ Sequential order');
    });

    els.toggleCycleFavorites.addEventListener('change', (e) => {
      const on = e.target.checked;
      engine.setFavoritesOnly(on);
      if (on && this.favorites.size === 0) {
        this.showToast('❤️ Add favorites first (S)');
      } else {
        this.showToast(on ? '❤️ Cycling favorites only' : '🎨 Cycling all presets');
      }
      this.updateCycleUI();
    });

    els.cycleInterval.addEventListener('input', (e) => {
      const secs = parseInt(e.target.value, 10);
      els.cycleIntervalLabel.textContent = secs + 's';
      engine.setAutoCycleInterval(secs * 1000);
      this.updateCycleUI();
    });

    // --- Source switch (always-visible explicit buttons) ---
    els.btnUseMic.addEventListener('click', () => {
      if (engine.currentSourceType !== 'mic') this.switchToMic();
    });
    els.btnUseFile.addEventListener('click', triggerFilePicker);

    els.deviceSelect.addEventListener('change', async (e) => {
      try {
        await engine.connectMicrophone(e.target.value);
        this.showToast('🎤 Switched input device');
      } catch (err) {
        this.showToast('❌ Error switching device');
      }
    });

    // --- Preset drawer ---
    els.btnPresets.addEventListener('click', () => this.toggleDrawer());

    // --- Preset Studio (editor) --- start screen button
    if (els.btnPresetStudio) {
      els.btnPresetStudio.addEventListener('click', () => {
        window.location.href = '/editor.html';
      });
    }
    if (els.btnTimeline) {
      els.btnTimeline.addEventListener('click', () => {
        window.location.href = '/timeline.html';
      });
    }
    // --- Preset Studio (editor) --- control bar button
    if (els.btnOpenEditor) {
      els.btnOpenEditor.addEventListener('click', () => {
        window.location.href = '/editor.html';
      });
    }
    els.btnCloseDrawer.addEventListener('click', () => this.closeDrawer());
    els.presetSearch.addEventListener('input', () => this.filterPresets());

    els.tabAll.addEventListener('click', () => {
      this.currentTab = 'all';
      els.tabAll.classList.add('active');
      els.tabFavorites.classList.remove('active');
      els.tabCustom.classList.remove('active');

      this.syncBackupBar();
      this.filterPresets();
    });

    els.tabFavorites.addEventListener('click', () => {
      this.currentTab = 'favorites';
      els.tabFavorites.classList.add('active');
      els.tabAll.classList.remove('active');
      els.tabCustom.classList.remove('active');

      this.syncBackupBar();
      this.filterPresets();
    });

    els.tabCustom.addEventListener('click', () => {
      this.currentTab = 'custom';
      els.tabCustom.classList.add('active');
      els.tabAll.classList.remove('active');
      els.tabFavorites.classList.remove('active');

      this.syncBackupBar();
      this.filterPresets();
    });

    // --- Backup / Restore custom presets ---
    els.btnExportAll.addEventListener('click', () => this.exportAllCustomPresets());
    els.btnImportPresets.addEventListener('click', () => els.importFileInput.click());
    els.importFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) this.importCustomPresetsFromFile(file);
      e.target.value = ''; // allow re-selecting the same file
    });

    // --- Hidden mgmt (Show Hidden toggle + Unhide All modal) ---
    els.toggleShowHidden.addEventListener('change', (e) => {
      this.showHidden = e.target.checked;
      this.filterPresets();
    });

    els.btnUnhideAll.addEventListener('click', () => {
      if (this.hidden.size === 0) return;
      els.unhideModalCount.textContent = this.hidden.size;
      els.unhideModal.classList.remove('hidden');
    });

    els.btnCancelUnhide.addEventListener('click', () => this.closeUnhideModal());
    els.btnConfirmUnhide.addEventListener('click', () => this.unhideAll());
    els.unhideModal.addEventListener('click', (e) => {
      if (e.target === els.unhideModal) this.closeUnhideModal();
    });

    // --- Delete custom preset confirm modal ---
    this._pendingDeleteName = null;
    els.btnCancelDeletePreset.addEventListener('click', () => this.closeDeletePresetModal());
    els.btnConfirmDeletePreset.addEventListener('click', () => this.confirmDeletePreset());
    els.deletePresetModal.addEventListener('click', (e) => {
      if (e.target === els.deletePresetModal) this.closeDeletePresetModal();
    });

    // --- Favorite toggle (control bar) ---
    els.btnFavorite.addEventListener('click', () => {
      const currentPreset = engine.getCurrentPresetName();
      if (currentPreset) this.toggleFavorite(currentPreset);
    });

    // --- Hide preset (control bar) ---
    els.btnHidePreset.addEventListener('click', () => {
      const currentPreset = engine.getCurrentPresetName();
      if (currentPreset) this.toggleHidden(currentPreset, { advanceIfCurrent: true });
    });

    // --- Fullscreen ---
    els.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

    // --- Guide Modal ---
    els.btnHelp.addEventListener('click', () => this.toggleGuide());
    els.btnCloseGuide.addEventListener('click', () => this.closeGuide());

    // --- Welcome / Feature Guide Modal (start screen) ---
    els.btnWelcomeHelp.addEventListener('click', () => this.openWelcomeGuide());
    els.btnCloseWelcome.addEventListener('click', () => this.closeWelcomeGuide());
    els.welcomeGuide.addEventListener('click', (e) => {
      if (e.target === els.welcomeGuide) this.closeWelcomeGuide();
    });
    els.welcomeGuide.querySelectorAll('.welcome-rail-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.selectWelcomeSection(btn.dataset.section));
    });

    // --- Audio Tuning ---
    els.btnAudioTuning.addEventListener('click', () => this.toggleTuningPanel());

    els.tuningEnergy.addEventListener('input', (e) => {
      engine.setEnergy(parseFloat(e.target.value));
    });

    els.toggleAgc.addEventListener('change', (e) => {
      const active = engine.toggleAGC();
      this.showToast(active ? '🔄 Auto-Gain ON' : '🔄 Auto-Gain OFF');
    });

    els.toggleKicklock.addEventListener('change', (e) => {
      const active = engine.toggleKickLock();
      this.showToast(active ? '🥁 Kick Lock ON' : '🥁 Kick Lock OFF');
    });

    els.toggleNoisegate.addEventListener('change', () => {
      const active = engine.toggleNoiseGate();
      els.noiseGateThresholdRow.style.display = active ? '' : 'none';
      this.showToast(active ? '🔇 Noise Gate ON' : '🔇 Noise Gate OFF');
    });

    els.noiseGateThreshold.addEventListener('input', (e) => {
      engine.setNoiseGateThreshold(parseFloat(e.target.value));
    });

    // --- Audio player controls ---
    els.btnPlayPause.addEventListener('click', () => this.togglePlayPause());

    els.audioVolume.addEventListener('input', (e) => {
      engine.setVolume(parseFloat(e.target.value));
    });

    els.audioSeek.addEventListener('input', (e) => {
      if (engine.audioElement) {
        const time = (parseFloat(e.target.value) / 100) * engine.audioElement.duration;
        engine.audioElement.currentTime = time;
      }
    });

    // --- Auto-hide controls ---
    document.addEventListener('mousemove', () => this.showControls());
    document.addEventListener('touchstart', () => this.showControls(), { passive: true });

    // Keep controls visible while hovered or while a popover is open
    els.controlBar.addEventListener('mouseenter', () => {
      this.hoveringControls = true;
      clearTimeout(this.hideTimer);
      els.controlBar.classList.remove('auto-hidden');
    });
    els.controlBar.addEventListener('mouseleave', () => {
      this.hoveringControls = false;
      this.showControls();
    });

    // Click outside popovers closes them
    document.addEventListener('pointerdown', (e) => {
      if (this.cycleOpen
        && !els.cyclePanel.contains(e.target)
        && !els.btnCycle.contains(e.target)) {
        this.closeCyclePanel();
      }
      if (this.tuningOpen
        && !els.audioTuningPanel.contains(e.target)
        && !els.btnAudioTuning.contains(e.target)) {
        this.closeTuningPanel();
      }
      if (this.outputOpen
        && els.outputPanel && !els.outputPanel.contains(e.target)
        && els.btnOutput && !els.btnOutput.contains(e.target)) {
        this.closeOutputPanel();
      }
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    document.addEventListener('keyup', (e) => this.handleKeyUp(e));

    // --- Window resize ---
    window.addEventListener('resize', () => {
      engine.setSize(window.innerWidth, window.innerHeight);
    });

    // --- Preset auto-change event ---
    window.addEventListener('presetChanged', (e) => {
      this.updatePresetName(e.detail.name);
    });

    // --- Output panel ---
    if (els.btnOutput) {
      els.btnOutput.addEventListener('click', () => this.toggleOutputPanel());
    }

    if (els.outputResolution) {
      els.outputResolution.addEventListener('change', () => {
        const val = els.outputResolution.value;
        els.outputCustomFields.classList.toggle('hidden', val !== 'custom');
        if (val !== 'custom') this.applyOutputSettings();
      });
    }

    if (els.btnOutputCustomApply) {
      els.btnOutputCustomApply.addEventListener('click', () => this.applyOutputSettings());
    }

    if (els.outputAspect) {
      els.outputAspect.addEventListener('change', () => this.applyOutputSettings());
    }

    if (els.outputFill) {
      els.outputFill.addEventListener('change', () => this.applyOutputSettings());
    }

    if (els.toggleVirtualCamera) {
      els.toggleVirtualCamera.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.engine.startVirtualCamera(60);
          els.virtualCameraHint.textContent = 'LIVE — select this window in OBS / Zoom';
          els.outputStatusDot.classList.add('active');
          this.showToast('📷 Virtual Camera ON — pick this window in OBS/Zoom');
        } else {
          this.engine.stopVirtualCamera();
          els.virtualCameraHint.textContent = 'Stream canvas to OBS / Zoom';
          this._updateOutputDot();
          this.showToast('📷 Virtual Camera OFF');
        }
      });
    }

    // Apply saved output settings on boot
    this._restoreOutputSettings();

    // Sync cycle UI to engine defaults
    this.syncCyclePanel();
    this.syncFavoritePool();
    this.syncHiddenPool();
  }

  syncFavoritePool() {
    this.engine.setFavoritePool(Array.from(this.favorites));
  }

  syncHiddenPool() {
    this.engine.setHiddenPool(Array.from(this.hidden));
  }

  // ===================== FAVORITES =====================

  loadFavorites() {
    try {
      let stored = localStorage.getItem('discocast_favorites');
      if (!stored) {
        // Migration from old MilkScreen keys
        stored = localStorage.getItem('milkscreen_favorites');
        if (stored) {
          localStorage.setItem('discocast_favorites', stored);
        }
      }
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  saveFavorites() {
    localStorage.setItem('discocast_favorites', JSON.stringify(Array.from(this.favorites)));
  }

  toggleFavorite(name) {
    if (this.favorites.has(name)) {
      this.favorites.delete(name);
      this.showToast('💔 Removed from Favorites');
    } else {
      this.favorites.add(name);
      this.showToast('❤️ Added to Favorites');
    }
    this.saveFavorites();
    this.syncFavoritePool();
    this.updateCycleUI();

    // Update active UI state if the toggled preset is the currently playing one
    if (name === this.engine.getCurrentPresetName()) {
      this.els.btnFavorite.classList.toggle('is-favorite', this.favorites.has(name));
    }

    // Sync hide button state
    if (name === this.engine.getCurrentPresetName()) {
      const isHidden = this.hidden.has(name);
      this.els.btnHidePreset.classList.toggle('is-hidden-preset', isHidden);
      this.els.btnHidePreset.setAttribute('data-tooltip', isHidden ? 'Unhide Preset (X)' : 'Hide Preset (X)');
    }

    // Refresh drawer if it's open so hearts update
    if (this.drawerOpen) {
      this.filterPresets();
    }
  }

  // ===================== HIDDEN =====================

  loadHidden() {
    try {
      let stored = localStorage.getItem('discocast_hidden');
      if (!stored) {
        // Migration from old MilkScreen keys
        stored = localStorage.getItem('milkscreen_hidden');
        if (stored) {
          localStorage.setItem('discocast_hidden', stored);
        }
      }
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  saveHidden() {
    localStorage.setItem('discocast_hidden', JSON.stringify(Array.from(this.hidden)));
  }

  toggleHidden(name, opts = {}) {
    const wasHidden = this.hidden.has(name);
    if (wasHidden) {
      this.hidden.delete(name);
      this.showToast('👁 Unhidden');
    } else {
      this.hidden.add(name);
      this.showToast('🙈 Hidden');
    }
    this.saveHidden();
    this.syncHiddenPool();

    // If the user hid the currently-playing preset, advance to the next visible one.
    if (!wasHidden && opts.advanceIfCurrent && name === this.engine.getCurrentPresetName()) {
      const next = this.engine.nextPreset();
      this.updatePresetName(next);
    }

    if (this.drawerOpen) this.filterPresets();
  }

  closeUnhideModal() {
    this.els.unhideModal.classList.add('hidden');
  }

  unhideAll() {
    const count = this.hidden.size;
    this.hidden.clear();
    this.saveHidden();
    this.syncHiddenPool();
    this.closeUnhideModal();
    this.showToast(`👁 Unhid ${count} preset${count === 1 ? '' : 's'}`);
    if (this.drawerOpen) this.filterPresets();
  }

  openDeletePresetModal(name) {
    this._pendingDeleteName = name;
    this.els.deletePresetName.textContent = this.engine.displayName(name);
    this.els.deletePresetModal.classList.remove('hidden');
  }

  closeDeletePresetModal() {
    this._pendingDeleteName = null;
    this.els.deletePresetModal.classList.add('hidden');
  }

  async confirmDeletePreset() {
    const name = this._pendingDeleteName;
    if (!name) return;
    // registryKey format: custom:<id>:<displayName>
    const id = name.slice(CUSTOM_PREFIX.length).split(':')[0];
    const record = getCustomPreset(id);
    const display = this.engine.displayName(name);

    // Remove image blobs first so we don't orphan them if the preset delete throws
    if (record?.images?.length) {
      await Promise.all(record.images.map(img =>
        img.imageId ? deleteImage(img.imageId).catch(() => { /* best-effort */ }) : null
      ));
    }
    deleteCustomPreset(id);

    // Drop from favorites/hidden if present
    if (this.favorites.delete(name)) this.saveFavorites();
    if (this.hidden.delete(name)) this.saveHidden();

    this.engine.refreshCustomPresets();
    this.syncFavoritePool();
    this.syncHiddenPool();
    this.closeDeletePresetModal();
    this.showToast(`🗑 Deleted "${this.truncate(display, 40)}"`);
    if (this.drawerOpen) this.filterPresets();
  }

  // ===================== BACKUP / RESTORE =====================

  syncBackupBar() {
    const { backupBar, backupCount, btnExportAll } = this.els;
    if (!backupBar) return;
    const count = Object.keys(loadAllCustomPresets()).length;
    backupCount.textContent = count;
    btnExportAll.disabled = count === 0;
    backupBar.classList.toggle('hidden', this.currentTab !== 'custom');
  }

  downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async exportAllCustomPresets() {
    const count = Object.keys(loadAllCustomPresets()).length;
    if (count === 0) {
      this.showToast('No custom presets to back up');
      return;
    }
    this.showToast('⏳ Preparing backup…');
    try {
      const backup = await exportAllPresets();
      const date = new Date().toISOString().slice(0, 10);
      this.downloadJson(`discocast-presets-${date}.json`, backup);
      this.showToast(`💾 Backed up ${count} preset${count === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('Export failed:', err);
      this.showToast('❌ Export failed — see console');
    }
  }

  async exportSingleCustomPreset(name) {
    const id = name.slice(CUSTOM_PREFIX.length).split(':')[0];
    const record = getCustomPreset(id);
    if (!record) return;
    try {
      const data = await exportPreset(id);
      const safe = (record.name || 'preset').replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 60);
      this.downloadJson(`${safe}.preset.json`, data);
      this.showToast(`💾 Exported "${this.truncate(record.name, 40)}"`);
    } catch (err) {
      console.error('Export failed:', err);
      this.showToast('❌ Export failed — see console');
    }
  }

  async importCustomPresetsFromFile(file) {
    this.showToast('⏳ Importing…');
    try {
      const text = await file.text();
      const { imported, names, failed } = await importFromFile(text);
      this.engine.refreshCustomPresets();
      this.syncBackupBar();
      if (this.drawerOpen) this.filterPresets();
      showImportResult({ imported, names, failed });
    } catch (err) {
      console.error('Import failed:', err);
      this.showToast(`❌ Import failed: ${err.message}`);
    }
  }

  // ===================== START FLOWS =====================

  async startWithMic() {
    try {
      await this.engine.connectMicrophone();
      this.els.startScreen.classList.add('hidden');
      this.els.controlBar.classList.remove('hidden');
      this.els.audioPlayer.classList.add('hidden');
      this.updateSourceButtons();
      this.updatePresetName(this.engine.getCurrentPresetName());
      this.showControls();
      this.requestWakeLock();
      this.showToast('🎤 Microphone connected');
      await this.populateDeviceList();
    } catch (err) {
      console.error('Mic error:', err);
      this.showPermissionError();
    }
  }

  async handleFileSelection(file) {
    try {
      const audioEl = await this.engine.connectAudioFile(file);
      this.els.startScreen.classList.add('hidden');
      this.els.controlBar.classList.remove('hidden');
      this.els.deviceSelect.classList.add('hidden');
      this.setupAudioPlayer(audioEl, file.name);
      this.updateSourceButtons();
      this.updatePresetName(this.engine.getCurrentPresetName());
      this.showControls();
      this.requestWakeLock();

      audioEl.play();
      this.updatePlayPauseIcon(true);
      this.showToast('🎵 Playing: ' + this.truncate(file.name, 40));
    } catch (err) {
      this.showToast('❌ Error loading audio file');
    }
  }

  async switchToMic() {
    try {
      await this.engine.connectMicrophone();
      this.els.audioPlayer.classList.add('hidden');
      this.updateSourceButtons();
      this.showToast('🎤 Switched to microphone');
      await this.populateDeviceList();
    } catch (err) {
      this.showPermissionError();
    }
  }

  toggleCyclePanel() {
    const isHidden = this.els.cyclePanel.classList.toggle('hidden');
    this.cycleOpen = !isHidden;
    if (this.cycleOpen) {
      if (this.drawerOpen) this.closeDrawer();
      if (this.guideOpen) this.closeGuide();
      this.els.audioTuningPanel.classList.add('hidden');
      this.syncCyclePanel();
    }
  }

  closeCyclePanel() {
    this.els.cyclePanel.classList.add('hidden');
    this.cycleOpen = false;
    this.showControls();
  }

  syncCyclePanel() {
    const { engine, els } = this;
    els.toggleCycle.checked = engine.autoCycleEnabled;
    els.toggleCycleRandom.checked = engine.randomCycleOrder;
    els.toggleCycleFavorites.checked = engine.favoritesOnly;
    const secs = Math.round(engine.autoCycleInterval / 1000);
    els.cycleInterval.value = secs;
    els.cycleIntervalLabel.textContent = secs + 's';
    this.updateCycleUI();
  }

  updateCycleUI() {
    const { engine, els } = this;
    els.btnCycle.classList.toggle('accent', engine.autoCycleEnabled);
    els.cycleStatusDot.classList.toggle('active', engine.autoCycleEnabled);
    const secs = Math.round(engine.autoCycleInterval / 1000);
    const favOnly = engine.favoritesOnly && this.favorites.size > 0;
    const scope = favOnly ? `${this.favorites.size} favorite${this.favorites.size === 1 ? '' : 's'}` : 'all presets';
    if (!engine.autoCycleEnabled) {
      els.cycleHint.textContent = 'Paused — click a toggle or key to resume';
    } else if (engine.favoritesOnly && this.favorites.size === 0) {
      els.cycleHint.textContent = 'Favorites only, but none saved yet — press S to add';
    } else {
      els.cycleHint.textContent = `Cycling ${scope} every ${secs}s`;
    }
  }

  quickToggleCycle() {
    const now = !this.engine.autoCycleEnabled;
    this.engine.setAutoCycle(now);
    this.els.toggleCycle.checked = now;
    this.updateCycleUI();
    this.showToast(now ? `🔁 Auto-cycle ON (${Math.round(this.engine.autoCycleInterval / 1000)}s)` : '⏸ Auto-cycle OFF');
  }

  updateSourceButtons() {
    const type = this.engine.currentSourceType;
    this.els.btnUseMic.classList.toggle('accent', type === 'mic');
    this.els.btnUseFile.classList.toggle('accent', type === 'file');
    if (type !== 'mic') this.els.deviceSelect.classList.add('hidden');
  }

  async populateDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      this.els.deviceSelect.innerHTML = '';
      if (audioInputs.length > 0) {
        audioInputs.forEach(device => {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.text = device.label || `Microphone ${this.els.deviceSelect.length + 1}`;
          this.els.deviceSelect.appendChild(option);
        });
        this.els.deviceSelect.classList.remove('hidden');
      } else {
        this.els.deviceSelect.classList.add('hidden');
      }
    } catch (err) {
      console.error('Error enumerating devices:', err);
      this.els.deviceSelect.classList.add('hidden');
    }
  }

  showPermissionError() {
    const isTauri = typeof window.__TAURI__ !== 'undefined';
    const nativeSteps = document.getElementById('permission-steps-native');
    const browserSteps = document.getElementById('permission-steps-browser');
    if (nativeSteps && browserSteps) {
      nativeSteps.style.display = isTauri ? 'block' : 'none';
      browserSteps.style.display = isTauri ? 'none' : 'block';
    }
    this.els.permissionError.classList.remove('hidden');
  }

  hidePermissionError() {
    this.els.permissionError.classList.add('hidden');
  }

  initPermissionRetry() {
    this.els.btnRetryPermission.addEventListener('click', () => {
      this.hidePermissionError();
      if (this.engine.currentSourceType === 'mic' || this.els.startScreen.classList.contains('hidden')) {
        this.switchToMic();
      } else {
        this.startWithMic();
      }
    });

    this.els.btnClosePermission.addEventListener('click', () => {
      this.hidePermissionError();
    });
  }

  // ===================== AUDIO PLAYER =====================

  setupAudioPlayer(audioEl, filename) {
    const { els } = this;

    els.audioPlayer.classList.remove('hidden');
    els.audioFilename.textContent = filename;
    els.audioTime.textContent = '0:00 / 0:00';
    els.audioSeek.value = 0;

    audioEl.addEventListener('timeupdate', () => {
      if (!audioEl.duration) return;
      const pct = (audioEl.currentTime / audioEl.duration) * 100;
      els.audioSeek.value = pct;
      els.audioTime.textContent =
        this.formatTime(audioEl.currentTime) + ' / ' + this.formatTime(audioEl.duration);
    });

    audioEl.addEventListener('ended', () => {
      this.updatePlayPauseIcon(false);
    });

    audioEl.addEventListener('play', () => this.updatePlayPauseIcon(true));
    audioEl.addEventListener('pause', () => this.updatePlayPauseIcon(false));
  }

  togglePlayPause() {
    const audioEl = this.engine.audioElement;
    if (!audioEl) return;
    if (audioEl.paused) {
      audioEl.play();
    } else {
      audioEl.pause();
    }
  }

  updatePlayPauseIcon(playing) {
    this.els.iconPlay.classList.toggle('hidden', playing);
    this.els.iconPause.classList.toggle('hidden', !playing);
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ===================== PRESET DRAWER =====================

  toggleDrawer() {
    if (this.drawerOpen) {
      this.closeDrawer();
    } else {
      this.openDrawer();
    }
  }

  openDrawer() {
    this.drawerOpen = true;
    this.engine.refreshCustomPresets();
    this.els.presetDrawer.classList.remove('hidden');
    this.syncBackupBar();
    this.populatePresetList();
    this.els.presetSearch.value = '';
    this.els.presetSearch.focus();
  }

  closeDrawer() {
    this.drawerOpen = false;
    this.els.presetDrawer.classList.add('hidden');
  }

  // ===================== GUIDE MODAL =====================

  toggleGuide() {
    this.guideOpen ? this.closeGuide() : this.openGuide();
  }

  openGuide() {
    this.guideOpen = true;
    this.els.keyboardGuide.classList.remove('hidden');
    if (this.drawerOpen) this.closeDrawer();
  }

  closeGuide() {
    this.guideOpen = false;
    this.els.keyboardGuide.classList.add('hidden');
  }

  // ===================== WELCOME GUIDE (start screen) =====================

  openWelcomeGuide() {
    const modal = document.getElementById('help-modal');
    if (modal) modal.hidden = false;
  }

  closeWelcomeGuide() {
    const modal = document.getElementById('help-modal');
    if (modal) modal.hidden = true;
  }

  selectWelcomeSection(name) {
    if (!name) return;
    const root = this.els.welcomeGuide;
    root.querySelectorAll('.welcome-rail-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === name);
    });
    root.querySelectorAll('.welcome-section').forEach((sec) => {
      sec.classList.toggle('active', sec.dataset.section === name);
    });
    const content = root.querySelector('.welcome-content');
    if (content) content.scrollTop = 0;
  }

  // ===================== TUNING PANEL =====================

  toggleTuningPanel() {
    const isHidden = this.els.audioTuningPanel.classList.toggle('hidden');
    this.tuningOpen = !isHidden;
    if (!isHidden) {
      if (this.drawerOpen) this.closeDrawer();
      if (this.guideOpen) this.closeGuide();
      if (this.cycleOpen) this.closeCyclePanel();
      this.startVULoop();
    } else {
      this.stopVULoop();
      this.showControls();
    }
  }

  closeTuningPanel() {
    this.els.audioTuningPanel.classList.add('hidden');
    this.tuningOpen = false;
    this.stopVULoop();
    this.showControls();
  }

  startVULoop() {
    if (this.vuAnimId) return;
    const loop = () => {
      this.updateVUMeter();
      this.vuAnimId = requestAnimationFrame(loop);
    };
    this.vuAnimId = requestAnimationFrame(loop);
  }

  stopVULoop() {
    if (this.vuAnimId) {
      cancelAnimationFrame(this.vuAnimId);
      this.vuAnimId = null;
    }
  }

  updateVUMeter() {
    const level = this.engine.hypeLevel || 0;
    const peak = this.engine._lastRawPeak || 0;
    const gated = this.engine.noiseGateEnabled && this.engine._gateClosed;
    const clipping = peak >= 0.98;
    const width = Math.min(level * 100, 100);
    this.els.vuMeterBar.style.width = width + '%';
    this.els.vuMeterBar.classList.toggle('clipping', clipping);

    if (clipping) {
      this.els.signalStatus.textContent = 'CLIPPING — move mic';
      this.els.signalStatus.classList.add('active');
    } else if (gated) {
      this.els.signalStatus.textContent = 'GATED';
      this.els.signalStatus.classList.remove('active');
    } else if (level > 0.01) {
      this.els.signalStatus.textContent = 'SIGNAL DETECTED';
      this.els.signalStatus.classList.add('active');
    } else {
      this.els.signalStatus.textContent = 'NO SIGNAL';
      this.els.signalStatus.classList.remove('active');
    }
  }

  populatePresetList(filter = '') {
    const { els, engine } = this;
    const names = engine.getPresetNames();
    const currentName = engine.getCurrentPresetName();
    const lowerFilter = filter.toLowerCase();

    // 1. Filter by Tab
    let filtered;
    if (this.currentTab === 'favorites') {
      filtered = names.filter(n => this.favorites.has(n));
    } else if (this.currentTab === 'custom') {
      filtered = names.filter(n => n.startsWith('custom:'));
    } else {
      // 'all' tab — exclude custom presets (they live in My Presets tab)
      filtered = names.filter(n => !n.startsWith('custom:'));
    }

    // 2. Exclude hidden from the All tab unless Show Hidden is on.
    //    Favorites and Custom tabs are unaffected.
    if (this.currentTab === 'all' && !this.showHidden) {
      filtered = filtered.filter(n => !this.hidden.has(n));
    }

    // 3. Filter by Search Text (match against display name so custom presets
    //    are searchable by their user-given name, not the full registry key)
    filtered = filter
      ? filtered.filter(n => engine.displayName(n).toLowerCase().includes(lowerFilter))
      : filtered;

    // Count display — show "(N hidden)" when Show Hidden is on
    if (this.showHidden && this.hidden.size > 0) {
      els.presetCount.textContent = `${filtered.length} (${this.hidden.size} hidden)`;
    } else {
      els.presetCount.textContent = filtered.length;
    }

    // Unhide All button visibility
    els.btnUnhideAll.classList.toggle('hidden', this.hidden.size === 0);
    els.hiddenCountLabel.textContent = this.hidden.size;

    els.presetList.innerHTML = '';

    // Virtual-ish rendering — render up to 500 at a time for performance
    const fragment = document.createDocumentFragment();
    const limit = Math.min(filtered.length, 500);

    for (let i = 0; i < limit; i++) {
      const name = filtered[i];
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'preset-name-text';
      nameSpan.textContent = engine.displayName(name);
      li.appendChild(nameSpan);

      const heartSpan = document.createElement('span');
      heartSpan.className = 'preset-heart';
      heartSpan.setAttribute('data-tooltip', this.favorites.has(name) ? 'Remove Favorite' : 'Add Favorite');
      heartSpan.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

      heartSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFavorite(name);
      });

      li.appendChild(heartSpan);

      const hideSpan = document.createElement('span');
      hideSpan.className = 'preset-hide';
      const isHidden = this.hidden.has(name);
      hideSpan.setAttribute('data-tooltip', isHidden ? 'Unhide' : 'Hide');
      // Eye-slash for hidden state, open-eye for visible state
      hideSpan.innerHTML = isHidden
        ? '<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';

      hideSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleHidden(name);
      });

      li.appendChild(hideSpan);

      // Download + Trash icons — custom presets only
      if (name.startsWith(CUSTOM_PREFIX)) {
        const exportSpan = document.createElement('span');
        exportSpan.className = 'preset-export';
        exportSpan.setAttribute('data-tooltip', 'Export');
        exportSpan.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42L11 13.6V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z"/></svg>';
        exportSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          this.exportSingleCustomPreset(name);
        });
        li.appendChild(exportSpan);

        const deleteSpan = document.createElement('span');
        deleteSpan.className = 'preset-delete';
        deleteSpan.setAttribute('data-tooltip', 'Delete');
        deleteSpan.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        deleteSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openDeletePresetModal(name);
        });
        li.appendChild(deleteSpan);
      }

      if (this.favorites.has(name)) li.classList.add('is-favorite');
      if (isHidden) li.classList.add('is-hidden');
      if (name === currentName) li.classList.add('active');

      li.addEventListener('click', async () => {
        await engine.loadPreset(name, 2.0);
        this.updatePresetName(name);
        this.showToast('🎨 ' + this.truncate(engine.displayName(name), 50));

        // Update active state
        els.presetList.querySelectorAll('li.active').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
      });

      fragment.appendChild(li);
    }

    if (filtered.length > limit) {
      const more = document.createElement('li');
      more.textContent = `... and ${filtered.length - limit} more (refine your search)`;
      more.style.color = 'var(--text-muted)';
      more.style.fontStyle = 'italic';
      more.style.cursor = 'default';
      fragment.appendChild(more);
    }

    els.presetList.appendChild(fragment);
  }

  filterPresets() {
    this.populatePresetList(this.els.presetSearch.value);
  }

  // ===================== UI HELPERS =====================

  updatePresetName(name) {
    this.els.presetName.textContent = this.engine.displayName(name) || 'No preset loaded';

    const isFav = this.favorites.has(name);
    this.els.btnFavorite.classList.toggle('is-favorite', isFav);
    this.els.btnFavorite.setAttribute('data-tooltip', isFav ? 'Remove from Favorites (S)' : 'Add to Favorites (S)');

    const isHidden = this.hidden.has(name);
    this.els.btnHidePreset.classList.toggle('is-hidden-preset', isHidden);
    this.els.btnHidePreset.setAttribute('data-tooltip', isHidden ? 'Unhide Preset (X)' : 'Hide Preset (X)');
  }

  showControls() {
    this.els.controlBar.classList.remove('auto-hidden');
    document.body.classList.remove('controls-hidden');
    clearTimeout(this.hideTimer);
    if (this.isEngaged()) return;
    this.hideTimer = setTimeout(() => {
      if (!this.isEngaged()) {
        this.els.controlBar.classList.add('auto-hidden');
        document.body.classList.add('controls-hidden');
      }
    }, this.hideDelay);
  }

  async requestWakeLock() {
    if (typeof window.__TAURI__ !== 'undefined') {
      try {
        await window.__TAURI__.invoke('caffeinate_start');
        console.log('Wake Lock active (caffeinate)');
      } catch (err) {
        console.warn('caffeinate_start failed:', err);
      }
      return;
    }
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      console.log('Wake Lock active');
    } catch (err) {
      console.error(`Wake Lock error: ${err.name}, ${err.message}`);
    }
  }

  async releaseWakeLock() {
    if (typeof window.__TAURI__ !== 'undefined') {
      try { await window.__TAURI__.invoke('caffeinate_stop'); } catch (e) { /* ignore */ }
      return;
    }
    if (this.wakeLock) { try { await this.wakeLock.release(); } catch (e) { /* ignore */ } this.wakeLock = null; }
  }

  async handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      await this.requestWakeLock();
    } else if (typeof window.__TAURI__ === 'undefined' && this.wakeLock === null) {
      // Browser wake lock is already released by the browser on hide
    }
  }

  isEngaged() {
    return this.hoveringControls
      || this.drawerOpen
      || this.guideOpen
      || this.cycleOpen
      || this.tuningOpen
      || this.outputOpen;
  }

  // ===================== OUTPUT PANEL =====================

  _loadOutputSettings() {
    try {
      const s = localStorage.getItem('discocast_output');
      return s ? JSON.parse(s) : { resolution: 'free', aspect: 'free', fill: 'letterbox', customW: 1920, customH: 1080 };
    } catch { return { resolution: 'free', aspect: 'free', fill: 'letterbox', customW: 1920, customH: 1080 }; }
  }

  _saveOutputSettings() {
    localStorage.setItem('discocast_output', JSON.stringify(this.outputSettings));
  }

  _restoreOutputSettings() {
    const s = this.outputSettings;
    const { els } = this;
    if (els.outputResolution) els.outputResolution.value = s.resolution;
    if (els.outputAspect) els.outputAspect.value = s.aspect;
    if (els.outputFill) els.outputFill.value = s.fill;
    if (els.outputCustomW) els.outputCustomW.value = s.customW || 1920;
    if (els.outputCustomH) els.outputCustomH.value = s.customH || 1080;
    if (s.resolution === 'custom' && els.outputCustomFields) els.outputCustomFields.classList.remove('hidden');
    this.applyOutputSettings();
  }

  applyOutputSettings() {
    const { els, engine } = this;
    const resolution = els.outputResolution ? els.outputResolution.value : 'free';
    const aspect = els.outputAspect ? els.outputAspect.value : 'free';
    const fill = els.outputFill ? els.outputFill.value : 'letterbox';

    // Persist
    this.outputSettings.resolution = resolution;
    this.outputSettings.aspect = aspect;
    this.outputSettings.fill = fill;
    if (resolution === 'custom') {
      this.outputSettings.customW = parseInt(els.outputCustomW.value, 10) || 1920;
      this.outputSettings.customH = parseInt(els.outputCustomH.value, 10) || 1080;
    }
    this._saveOutputSettings();

    // Fill mode — apply CSS class to wrapper
    const wrapper = els.canvasWrapper;
    if (wrapper) {
      wrapper.classList.remove('fill-letterbox', 'fill-stretch', 'fill-crop');
      wrapper.classList.add('fill-' + fill);
    }

    // Resolve target render dimensions
    let w, h;
    if (resolution === 'free') {
      // Aspect ratio constraint on window size
      if (aspect !== 'free') {
        const [aw, ah] = aspect.split(':').map(Number);
        const ratio = aw / ah;
        if (window.innerWidth / window.innerHeight > ratio) {
          h = window.innerHeight;
          w = Math.round(h * ratio);
        } else {
          w = window.innerWidth;
          h = Math.round(w / ratio);
        }
        engine.lockResolution(w, h);
      } else {
        engine.unlockResolution();
      }
    } else {
      // Fixed resolution preset or custom
      if (resolution === 'custom') {
        w = this.outputSettings.customW;
        h = this.outputSettings.customH;
      } else {
        [w, h] = resolution.split('x').map(Number);
      }
      engine.lockResolution(w, h);
    }

    this._updateOutputDot();
  }

  _updateOutputDot() {
    const { els, engine } = this;
    const active = engine.lockedResolution !== null || engine.isVirtualCameraActive();
    if (els.outputStatusDot) els.outputStatusDot.classList.toggle('active', active);
    if (els.btnOutput) els.btnOutput.classList.toggle('accent', active);
  }

  toggleOutputPanel() {
    const isHidden = this.els.outputPanel.classList.toggle('hidden');
    this.outputOpen = !isHidden;
    if (this.outputOpen) {
      if (this.drawerOpen) this.closeDrawer();
      if (this.guideOpen) this.closeGuide();
      if (this.cycleOpen) this.closeCyclePanel();
      if (this.tuningOpen) this.closeTuningPanel();
    } else {
      this.showControls();
    }
  }

  closeOutputPanel() {
    this.els.outputPanel.classList.add('hidden');
    this.outputOpen = false;
    this.showControls();
  }

  showToast(msg) {
    const { toast } = this.els;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2000);
  }

  async toggleFullscreen() {
    if (typeof window.__TAURI__ !== 'undefined') {
      try {
        const win = window.__TAURI__.window.getCurrent();
        const isFs = await win.isFullscreen();
        await win.setFullscreen(!isFs);
      } catch (err) {
        console.warn('Tauri setFullscreen failed:', err);
        try { await window.__TAURI__.invoke('toggle_fullscreen'); } catch (e) { /* ignore */ }
      }
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '…' : str;
  }

  // ===================== KEYBOARD =====================

  handleKeyboard(e) {
    // Don't handle if typing in search
    if (e.target.tagName === 'INPUT') return;

    // Ignore repeating keys for Hype controls to avoid jank
    if (e.repeat && ['v', 'V', 'b', 'B', 'a', 'A', 'k', 'K'].includes(e.key)) return;

    // Performance/hype keys that should fire silently without revealing the UI
    const SILENT_KEYS = new Set(['v', 'V', 'b', 'B', 'i', 'I', 'h', 'H', 'Shift', 'ArrowLeft', 'ArrowRight']);
    const silent = SILENT_KEYS.has(e.key);

    switch (e.key) {
      case 'Shift':
        this.engine.setBoost(true);
        break;
      case 'a':
      case 'A':
        this.els.toggleAgc.click();
        break;
      case 'k':
      case 'K':
        this.els.toggleKicklock.click();
        break;
      case 't':
      case 'T':
        this.toggleTuningPanel();
        break;
      case ' ':
        e.preventDefault();
        if (this.engine.currentSourceType === 'file') {
          this.togglePlayPause();
        } else {
          const name = this.engine.nextPreset();
          this.updatePresetName(name);
          this.showToast('⏭ ' + this.truncate(name, 50));
        }
        break;
      case 'v':
      case 'V':
        e.preventDefault();
        this.els.flashOverlay.classList.add('flash-white');
        break;
      case 'b':
      case 'B':
        e.preventDefault();
        this.els.flashOverlay.classList.add('flash-black');
        break;
      case 'i':
      case 'I':
        e.preventDefault();
        this.els.canvas.classList.toggle('invert-colors');
        break;
      case 'h':
      case 'H':
        e.preventDefault();
        document.body.classList.toggle('force-hide-ui');
        break;
      case '?':
      case '/':
        e.preventDefault();
        this.toggleGuide();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.engine.nextPreset();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.engine.prevPreset();
        break;
      case 'r':
      case 'R':
        this.quickToggleCycle();
        break;
      case 'c':
      case 'C':
        this.toggleCyclePanel();
        break;
      case 's':
      case 'S':
        {
          const currentPreset = this.engine.getCurrentPresetName();
          if (currentPreset) this.toggleFavorite(currentPreset);
        }
        break;
      case 'x':
      case 'X':
        {
          const currentPreset = this.engine.getCurrentPresetName();
          if (currentPreset) this.toggleHidden(currentPreset, { advanceIfCurrent: true });
        }
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'p':
      case 'P':
        this.toggleDrawer();
        break;
      case 'o':
      case 'O':
        this.toggleOutputPanel();
        break;
      case 'e':
      case 'E':
        window.location.href = '/editor.html';
        break;
      case 'l':
      case 'L':
        window.open('/timeline.html');
        break;
      case 'Escape':
        if (!this.els.welcomeGuide.classList.contains('hidden')) this.closeWelcomeGuide();
        if (!this.els.unhideModal.classList.contains('hidden')) this.closeUnhideModal();
        if (!this.els.deletePresetModal.classList.contains('hidden')) this.closeDeletePresetModal();
        if (this.drawerOpen) this.closeDrawer();
        if (this.guideOpen) this.closeGuide();
        if (this.cycleOpen) this.closeCyclePanel();
        if (this.outputOpen) this.closeOutputPanel();
        break;
    }

    // Only reveal the UI for navigation/control keys, not silent performance keys
    if (!silent) this.showControls();
  }

  handleKeyUp(e) {
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
      case 'Shift':
        this.engine.setBoost(false);
        break;
      case 'v':
      case 'V':
        this.els.flashOverlay.classList.remove('flash-white');
        break;
      case 'b':
      case 'B':
        this.els.flashOverlay.classList.remove('flash-black');
        break;
    }
  }
}
