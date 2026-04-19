/**
 * ControlPanel — UI bindings, auto-hide, keyboard shortcuts, preset drawer
 */
export class ControlPanel {
  constructor(engine) {
    this.engine = engine;
    this.hideTimer = null;
    this.hideDelay = 3000;
    this.drawerOpen = false;
    this.toastTimer = null;
    this.guideOpen = false;
    this.cycleOpen = false;
    this.favorites = this.loadFavorites();
    this.currentTab = 'all'; // 'all' or 'favorites'
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
      cycleInterval: document.getElementById('cycle-interval'),
      cycleIntervalLabel: document.getElementById('cycle-interval-label'),
      btnCycleNext: document.getElementById('btn-cycle-next'),
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
      tabAll: document.getElementById('tab-all'),
      tabFavorites: document.getElementById('tab-favorites'),
      btnFavorite: document.getElementById('btn-favorite'),
      btnHelp: document.getElementById('btn-help'),
      btnAudioTuning: document.getElementById('btn-audio-tuning'),
      audioTuningPanel: document.getElementById('audio-tuning-panel'),
      tuningEnergy: document.getElementById('tuning-energy'),
      toggleAgc: document.getElementById('toggle-agc'),
      toggleKicklock: document.getElementById('toggle-kicklock'),
      btnBoost: document.getElementById('btn-boost'),
      vuMeterBar: document.getElementById('vu-meter-bar'),
      signalStatus: document.getElementById('signal-status'),
      keyboardGuide: document.getElementById('keyboard-guide'),
      btnCloseGuide: document.getElementById('btn-close-guide'),
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
    };

    this.bindEvents();
  }

  bindEvents() {
    const { els, engine } = this;

    this.initPermissionRetry();

    // --- Start screen & Audio loading ---
    els.btnMic.addEventListener('click', () => this.startWithMic());

    const triggerFilePicker = () => els.fileInput.click();
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

    els.cycleInterval.addEventListener('input', (e) => {
      const secs = parseInt(e.target.value, 10);
      els.cycleIntervalLabel.textContent = secs + 's';
      engine.setAutoCycleInterval(secs * 1000);
      this.updateCycleUI();
    });

    els.btnCycleNext.addEventListener('click', () => {
      const name = engine.randomCycleOrder ? engine.randomPreset() : engine.nextPreset();
      this.updatePresetName(name);
      this.showToast('⏭ ' + this.truncate(name, 50));
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
    els.btnCloseDrawer.addEventListener('click', () => this.closeDrawer());
    els.presetSearch.addEventListener('input', () => this.filterPresets());

    els.tabAll.addEventListener('click', () => {
      this.currentTab = 'all';
      els.tabAll.classList.add('active');
      els.tabFavorites.classList.remove('active');
      this.filterPresets();
    });

    els.tabFavorites.addEventListener('click', () => {
      this.currentTab = 'favorites';
      els.tabFavorites.classList.add('active');
      els.tabAll.classList.remove('active');
      this.filterPresets();
    });

    // --- Favorite toggle (control bar) ---
    els.btnFavorite.addEventListener('click', () => {
      const currentPreset = engine.getCurrentPresetName();
      if (currentPreset) this.toggleFavorite(currentPreset);
    });

    // --- Fullscreen ---
    els.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

    // --- Guide Modal ---
    els.btnHelp.addEventListener('click', () => this.toggleGuide());
    els.btnCloseGuide.addEventListener('click', () => this.closeGuide());

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

    els.btnBoost.addEventListener('mousedown', () => {
      engine.setBoost(true);
      els.btnBoost.classList.add('active');
    });

    window.addEventListener('mouseup', () => {
      engine.setBoost(false);
      els.btnBoost.classList.remove('active');
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

    // Sync cycle UI to engine defaults
    this.syncCyclePanel();
  }

  // ===================== FAVORITES =====================

  loadFavorites() {
    try {
      const stored = localStorage.getItem('milkscreen_favorites');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch (e) {
      return new Set();
    }
  }

  saveFavorites() {
    localStorage.setItem('milkscreen_favorites', JSON.stringify(Array.from(this.favorites)));
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

    // Update active UI state if the toggled preset is the currently playing one
    if (name === this.engine.getCurrentPresetName()) {
      this.els.btnFavorite.classList.toggle('is-favorite', this.favorites.has(name));
    }

    // Refresh drawer if it's open so hearts update
    if (this.drawerOpen) {
      this.filterPresets();
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
  }

  syncCyclePanel() {
    const { engine, els } = this;
    els.toggleCycle.checked = engine.autoCycleEnabled;
    els.toggleCycleRandom.checked = engine.randomCycleOrder;
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
    els.cycleHint.textContent = engine.autoCycleEnabled
      ? `Auto-cycling every ${secs}s`
      : 'Paused — click a toggle or key to resume';
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
    this.els.presetDrawer.classList.remove('hidden');
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

  // ===================== TUNING PANEL =====================

  toggleTuningPanel() {
    const isHidden = this.els.audioTuningPanel.classList.toggle('hidden');
    if (!isHidden) {
      if (this.drawerOpen) this.closeDrawer();
      if (this.guideOpen) this.closeGuide();
      if (this.cycleOpen) this.closeCyclePanel();
      this.startVULoop();
    } else {
      this.stopVULoop();
    }
  }

  closeTuningPanel() {
    this.els.audioTuningPanel.classList.add('hidden');
    this.stopVULoop();
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
    const width = Math.min(level * 100, 100);
    this.els.vuMeterBar.style.width = width + '%';

    // Update status text
    if (level > 0.01) {
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

    // 1. Filter by Tab (All vs Favorites)
    let filtered = this.currentTab === 'favorites'
      ? names.filter(n => this.favorites.has(n))
      : names;

    // 2. Filter by Search Text
    filtered = filter
      ? filtered.filter(n => n.toLowerCase().includes(lowerFilter))
      : filtered;

    els.presetCount.textContent = filtered.length;
    els.presetList.innerHTML = '';

    // Virtual-ish rendering — render up to 500 at a time for performance
    const fragment = document.createDocumentFragment();
    const limit = Math.min(filtered.length, 500);

    for (let i = 0; i < limit; i++) {
      const name = filtered[i];
      const li = document.createElement('li');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'preset-name-text';
      nameSpan.textContent = name;
      li.appendChild(nameSpan);

      const heartSpan = document.createElement('span');
      heartSpan.className = 'preset-heart';
      heartSpan.setAttribute('data-tooltip', 'Toggle Favorite');
      heartSpan.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

      heartSpan.addEventListener('click', (e) => {
        e.stopPropagation(); // Don't trigger the preset load click
        this.toggleFavorite(name);
      });

      li.appendChild(heartSpan);

      if (this.favorites.has(name)) {
        li.classList.add('is-favorite');
      }

      if (name === currentName) {
        li.classList.add('active');
      }

      li.addEventListener('click', () => {
        engine.loadPreset(name, 2.0);
        this.updatePresetName(name);
        this.showToast('🎨 ' + this.truncate(name, 50));

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
    this.els.presetName.textContent = name || 'No preset loaded';

    const isFav = this.favorites.has(name);
    this.els.btnFavorite.classList.toggle('is-favorite', isFav);
    this.els.btnFavorite.setAttribute('data-tooltip', isFav ? 'Remove from Favorites (S)' : 'Add to Favorites (S)');
  }

  showControls() {
    this.els.controlBar.classList.remove('auto-hidden');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.drawerOpen) {
        this.els.controlBar.classList.add('auto-hidden');
      }
    }, this.hideDelay);
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

  toggleFullscreen() {
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
    const SILENT_KEYS = new Set(['v', 'V', 'b', 'B', 'i', 'I', 'h', 'H', 'Shift']);
    const silent = SILENT_KEYS.has(e.key);

    switch (e.key) {
      case 'Shift':
        this.engine.setBoost(true);
        this.els.btnBoost.classList.add('active');
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
        {
          const name = this.engine.nextPreset();
          this.updatePresetName(name);
          this.showToast('⏭ ' + this.truncate(name, 50));
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        {
          const name = this.engine.prevPreset();
          this.updatePresetName(name);
          this.showToast('⏮ ' + this.truncate(name, 50));
        }
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
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'p':
      case 'P':
        this.toggleDrawer();
        break;
      case 'Escape':
        if (this.drawerOpen) this.closeDrawer();
        if (this.guideOpen) this.closeGuide();
        if (this.cycleOpen) this.closeCyclePanel();
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
        this.els.btnBoost.classList.remove('active');
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
