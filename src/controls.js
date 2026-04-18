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
    this.randomMode = false;

    // DOM refs
    this.els = {
      startScreen: document.getElementById('start-screen'),
      controlBar: document.getElementById('control-bar'),
      presetName: document.getElementById('preset-name'),
      btnPrev: document.getElementById('btn-prev'),
      btnNext: document.getElementById('btn-next'),
      btnRandom: document.getElementById('btn-random'),
      btnSwitchSource: document.getElementById('btn-switch-source'),
      sourceLabel: document.getElementById('source-label'),
      btnPresets: document.getElementById('btn-presets'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      btnMic: document.getElementById('btn-mic'),
      btnFile: document.getElementById('btn-file'),
      btnLoadFile: document.getElementById('btn-load-file'),
      fileInput: document.getElementById('file-input'),
      presetDrawer: document.getElementById('preset-drawer'),
      presetSearch: document.getElementById('preset-search'),
      presetList: document.getElementById('preset-list'),
      presetCount: document.getElementById('preset-count'),
      btnCloseDrawer: document.getElementById('btn-close-drawer'),
      audioPlayer: document.getElementById('audio-player'),
      audioFilename: document.getElementById('audio-filename'),
      audioTime: document.getElementById('audio-time'),
      audioSeek: document.getElementById('audio-seek'),
      btnPlayPause: document.getElementById('btn-play-pause'),
      iconPlay: document.getElementById('icon-play'),
      iconPause: document.getElementById('icon-pause'),
      audioVolume: document.getElementById('audio-volume'),
      toast: document.getElementById('toast'),
    };

    this.bindEvents();
  }

  bindEvents() {
    const { els, engine } = this;

    // --- Start screen & Audio loading ---
    els.btnMic.addEventListener('click', () => this.startWithMic());
    
    const triggerFilePicker = () => els.fileInput.click();
    els.btnFile.addEventListener('click', triggerFilePicker);
    els.btnLoadFile.addEventListener('click', triggerFilePicker);

    els.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.handleFileSelection(e.target.files[0]);
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

    els.btnRandom.addEventListener('click', () => {
      this.randomMode = !this.randomMode;
      els.btnRandom.classList.toggle('accent', this.randomMode);
      if (this.randomMode) {
        const name = engine.randomPreset();
        this.updatePresetName(name);
        this.showToast('🔀 Random: ON - ' + this.truncate(name, 50));
      } else {
        this.showToast('🔀 Random: OFF');
      }
    });

    // --- Source switch ---
    els.btnSwitchSource.addEventListener('click', () => {
      if (engine.currentSourceType === 'mic') {
        triggerFilePicker();
      } else {
        this.switchToMic();
      }
    });

    // --- Preset drawer ---
    els.btnPresets.addEventListener('click', () => this.toggleDrawer());
    els.btnCloseDrawer.addEventListener('click', () => this.closeDrawer());

    els.presetSearch.addEventListener('input', () => this.filterPresets());

    // --- Fullscreen ---
    els.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

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

    // --- Window resize ---
    window.addEventListener('resize', () => {
      engine.setSize(window.innerWidth, window.innerHeight);
    });

    // --- Preset auto-change event ---
    window.addEventListener('presetChanged', (e) => {
      this.updatePresetName(e.detail.name);
    });
  }

  // ===================== START FLOWS =====================

  async startWithMic() {
    try {
      await this.engine.connectMicrophone();
      this.els.startScreen.classList.add('hidden');
      this.els.controlBar.classList.remove('hidden');
      this.els.sourceLabel.textContent = 'Mic';
      this.els.audioPlayer.classList.add('hidden');
      this.updatePresetName(this.engine.getCurrentPresetName());
      this.showControls();
      this.showToast('🎤 Microphone connected');
    } catch (err) {
      this.showToast('❌ Microphone access denied');
    }
  }

  async handleFileSelection(file) {
    try {
      const audioEl = await this.engine.connectAudioFile(file);
      this.els.startScreen.classList.add('hidden');
      this.els.controlBar.classList.remove('hidden');
      this.els.sourceLabel.textContent = 'File';
      this.setupAudioPlayer(audioEl, file.name);
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
      this.els.sourceLabel.textContent = 'Mic';
      this.els.audioPlayer.classList.add('hidden');
      this.showToast('🎤 Switched to microphone');
    } catch (err) {
      this.showToast('❌ Microphone access denied');
    }
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

  populatePresetList(filter = '') {
    const { els, engine } = this;
    const names = engine.getPresetNames();
    const currentName = engine.getCurrentPresetName();
    const lowerFilter = filter.toLowerCase();

    const filtered = filter
      ? names.filter(n => n.toLowerCase().includes(lowerFilter))
      : names;

    els.presetCount.textContent = filtered.length;
    els.presetList.innerHTML = '';

    // Virtual-ish rendering — render up to 500 at a time for performance
    const fragment = document.createDocumentFragment();
    const limit = Math.min(filtered.length, 500);

    for (let i = 0; i < limit; i++) {
      const name = filtered[i];
      const li = document.createElement('li');
      li.textContent = name;
      li.title = name;

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

    switch (e.key) {
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
        {
          this.randomMode = !this.randomMode;
          this.els.btnRandom.classList.toggle('accent', this.randomMode);
          if (this.randomMode) {
            const name = this.engine.randomPreset();
            this.updatePresetName(name);
            this.showToast('🔀 Random: ON - ' + this.truncate(name, 50));
          } else {
            this.showToast('🔀 Random: OFF');
          }
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
        break;
    }

    this.showControls();
  }
}
