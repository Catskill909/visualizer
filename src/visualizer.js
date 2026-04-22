/**
 * VisualizerEngine — Wraps Butterchurn for audio visualization
 * Loads ~1,100 presets from official packs + Baron community pack
 */
import butterchurnImport from 'butterchurn';
import butterchurnPresetsImport from 'butterchurn-presets';
import butterchurnPresetsExtra from 'butterchurn-presets/lib/butterchurnPresetsExtra.min.js';
import butterchurnPresetsExtra2 from 'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js';
import butterchurnPresetsMD1 from 'butterchurn-presets/lib/butterchurnPresetsMD1.min.js';
import { loadAllCustomPresets, CUSTOM_PREFIX, registryKey, getImage } from './customPresets.js';

// Baron pack: bypass the package's runtime `await import()` loop (which would cause
// 762 sequential network requests). Vite inlines every JSON into a single static chunk.
const baronModules = import.meta.glob(
  '/node_modules/butterchurn-presets-baron/dist/presets/*.json',
  { eager: true }
);


/**
 * Resolve a CJS/UMD module wrapped by Vite's ESM interop.
 */
function resolveModule(mod, globalName, testProp) {
  if (mod && typeof mod[testProp] !== 'undefined') return mod;
  if (mod && mod.default && typeof mod.default[testProp] !== 'undefined') return mod.default;
  if (mod && mod.default && mod.default.default && typeof mod.default.default[testProp] !== 'undefined') return mod.default.default;
  if (typeof window !== 'undefined' && window[globalName] && typeof window[globalName][testProp] !== 'undefined') return window[globalName];
  return null;
}

/**
 * Safely extract presets from a module that may be CJS or ESM.
 */
function extractPresets(mod, globalName) {
  const resolved = resolveModule(mod, globalName, 'getPresets');
  if (resolved && typeof resolved.getPresets === 'function') {
    return resolved.getPresets();
  }
  return null;
}

export class VisualizerEngine {
  constructor() {
    this.visualizer = null;
    this.audioContext = null;
    this.canvas = null;
    this.currentSource = null;
    this.currentSourceType = null;
    this.presetNames = [];
    this.presets = {};
    this.currentPresetIndex = -1;
    this.isRunning = false;
    this.audioElement = null;
    this.volumeGainNode = null;
    this.visualizerGainNode = null;
    this.animFrameId = null;
    this.autoCycleTimer = null;
    this.autoCycleEnabled = true;
    this.autoCycleInterval = 30000;
    this.randomCycleOrder = true;
    this.favoritePool = [];
    this.favoritesOnly = false;
    this.hiddenPool = new Set();

    // Performance controls
    this.energyMultiplier = 1.0;
    this.baseSensitivity = 1.0;
    this.agcEnabled = true;
    this.kickLockEnabled = false;
    this.boostActive = false;

    // Audio nodes
    this.analyser = null;
    this.kickFilter = null;
    this.agcDataArray = null;
    this.lastPeak = 0.5;
    this.hypeLevel = 0; // 0-1 value for UI feedback
    this._audioConfirmed = false;
  }

  init(canvas) {
    this.canvas = canvas;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // 1. Analyser for AGC
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024; // Better resolution for peak detection
    this.agcDataArray = new Uint8Array(this.analyser.fftSize);

    // 2. Kick Lock Filter (Lowpass)
    this.kickFilter = this.audioContext.createBiquadFilter();
    this.kickFilter.type = 'lowpass';
    this.kickFilter.frequency.value = 150; // Focus on bass
    this.kickFilter.Q.value = 1.0;

    // 3. Main Gain Node (AGC + Energy)
    this.visualizerGainNode = this.audioContext.createGain();
    this.visualizerGainNode.gain.value = this.baseSensitivity;

    // Default routing: Analyser (Input) -> visualizerGainNode -> Butterchurn
    this.analyser.connect(this.visualizerGainNode);

    // Silent tap to keep the graph active across browsers
    this.silentForce = this.audioContext.createGain();
    this.silentForce.gain.value = 0.000001;
    this.visualizerGainNode.connect(this.silentForce);
    this.silentForce.connect(this.audioContext.destination);

    // Load presets from all available packs
    this.presets = {};
    const packs = [
      { mod: butterchurnPresetsImport, name: 'butterchurnPresets', label: 'Base' },
      { mod: butterchurnPresetsExtra, name: 'butterchurnPresetsExtra', label: 'Extra' },
      { mod: butterchurnPresetsExtra2, name: 'butterchurnPresetsExtra2', label: 'Extra2' },
      { mod: butterchurnPresetsMD1, name: 'butterchurnPresetsMD1', label: 'MD1' },
    ];

    for (const pack of packs) {
      try {
        const presets = extractPresets(pack.mod, pack.name);
        if (presets) {
          const count = Object.keys(presets).length;
          Object.assign(this.presets, presets);
          console.log(`[DiscoCast Visualizer] ${pack.label}: +${count} presets`);
        }
      } catch (e) {
        console.warn(`[DiscoCast Visualizer] Failed to load ${pack.label}:`, e.message);
      }
    }

    // Baron pack — derive preset name from the JSON filename, unwrap ESM default export.
    try {
      let baronCount = 0;
      for (const [path, mod] of Object.entries(baronModules)) {
        const name = decodeURIComponent(path.split('/').pop().replace(/\.json$/, ''));
        const preset = mod && mod.default ? mod.default : mod;
        if (preset && typeof preset === 'object' && (preset.shapes || preset.waves || preset.baseVals)) {
          this.presets[name] = preset;
          baronCount++;
        }
      }
      console.log(`[DiscoCast Visualizer] Baron: +${baronCount} presets`);
    } catch (e) {
      console.warn('[DiscoCast Visualizer] Failed to load Baron pack:', e.message);
    }


    this.presetNames = Object.keys(this.presets).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    console.log(`[DiscoCast Visualizer] Loaded ${this.presetNames.length} presets`);

    // Create visualizer
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const butterchurnLib = resolveModule(butterchurnImport, 'butterchurn', 'createVisualizer');
    if (!butterchurnLib || typeof butterchurnLib.createVisualizer !== 'function') {
      console.error('[DiscoCast Visualizer] butterchurn.createVisualizer not found:', butterchurnImport);
      throw new Error('butterchurn.createVisualizer is not available');
    }

    this.visualizer = butterchurnLib.createVisualizer(this.audioContext, canvas, {
      width, height, pixelRatio: window.devicePixelRatio || 1,
    });

    this.visualizer.connectAudio(this.visualizerGainNode);
    this.randomPreset();
    this.startRenderLoop(); // Force start the loop immediately
    return this;
  }

  async connectMicrophone(deviceId = null) {
    try {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      this.disconnectSource();

      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = this.audioContext.createMediaStreamSource(stream);
      this._micStream = stream;
      this.currentSource = source;
      this.currentSourceType = 'mic';

      // Connect to the head of our internal chain
      source.connect(this.analyser);

      this.startRenderLoop();
      this.startAutoCycle();

      // Force engine re-sync
      if (this.visualizer) this.visualizer.connectAudio(this.visualizerGainNode);

      return true;
    } catch (err) {
      console.error('Microphone access denied:', err);
      throw err;
    }
  }

  async connectAudioFile(file) {
    try {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
      this.disconnectSource();
      this.audioElement = new Audio();
      this.audioElement.crossOrigin = 'anonymous';
      this.audioElement.src = URL.createObjectURL(file);
      const source = this.audioContext.createMediaElementSource(this.audioElement);
      // Path for Hearing: Source -> VolumeGain -> Destination
      this.volumeGainNode = this.audioContext.createGain();
      source.connect(this.volumeGainNode);
      this.volumeGainNode.connect(this.audioContext.destination);

      source.connect(this.analyser);

      this.currentSource = source;
      this.currentSourceType = 'file';
      this.startRenderLoop();
      this.startAutoCycle();

      // Force engine re-sync
      if (this.visualizer) {
        this.visualizer.connectAudio(this.visualizerGainNode);
      }

      console.log('[DiscoCast Visualizer] File source connected to engine and destination');
      return this.audioElement;
    } catch (err) {
      console.error('Error loading audio file:', err);
      throw err;
    }
  }

  disconnectSource() {
    if (this._micStream) {
      this._micStream.getTracks().forEach(t => t.stop());
      this._micStream = null;
    }
    if (this.audioElement) {
      this.audioElement.pause();
      if (this.audioElement.src.startsWith('blob:')) URL.revokeObjectURL(this.audioElement.src);
      this.audioElement = null;
    }
    if (this.currentSource) {
      try { this.currentSource.disconnect(); } catch (e) { /* ignore */ }
      this.currentSource = null;
    }
    if (this.volumeGainNode) {
      try { this.volumeGainNode.disconnect(); } catch (e) { /* ignore */ }
      this.volumeGainNode = null;
    }
    this.currentSourceType = null;
  }

  async loadPreset(name, blendTime = 2.0) {
    const preset = this.presets[name];
    if (!preset) return false;

    // Optimistic index update so getCurrentPresetName() is correct immediately
    // even while the async image-bind is in flight.
    this.currentPresetIndex = this.presetNames.indexOf(name);

    // For custom presets: pre-bind images from IndexedDB BEFORE telling
    // butterchurn to load the preset so the first rendered frame already
    // has the correct textures (avoids the clouds2 fallback flash).
    // Use blendTime=0 for instant switch — 2-second cross-fade is too slow
    // and makes the preset appear to do nothing.
    if (name.startsWith(CUSTOM_PREFIX)) {
      await this._bindCustomPresetImages(preset);
      // Near-zero (not 0) — butterchurn's blendProgress = elapsed / blendDuration
      // produces NaN/Infinity at 0, which keeps it stuck in permanent-blend state
      // and the new preset never actually takes over.
      blendTime = 0.001;
    }

    try {
      this.visualizer.loadPreset(JSON.parse(JSON.stringify(preset)), blendTime);
    } catch (e) {
      console.warn('[DiscoCast Visualizer] loadPreset failed:', e.message, e);
      return false;
    }
    return true;
  }

  loadPresetByIndex(index, blendTime = 2.0) {
    if (index < 0 || index >= this.presetNames.length) return false;
    return this.loadPreset(this.presetNames[index], blendTime);
  }

  // Visible pool for manual navigation — all names minus hidden, fallback to full list
  // if everything is hidden (so the app never locks up on a 100%-hidden library).
  _visibleNames() {
    if (this.hiddenPool.size === 0) return this.presetNames;
    const visible = this.presetNames.filter(n => !this.hiddenPool.has(n));
    return visible.length > 0 ? visible : this.presetNames;
  }

  nextPreset(blendTime = 2.0) {
    const pool = this._visibleNames();
    if (pool.length === 0) return '';
    const current = this.getCurrentPresetName();
    const idx = pool.indexOf(current);
    const next = pool[(idx + 1) % pool.length] || pool[0];
    this.loadPreset(next, blendTime);
    this.resetAutoCycle();
    return next;
  }

  prevPreset(blendTime = 2.0) {
    const pool = this._visibleNames();
    if (pool.length === 0) return '';
    const current = this.getCurrentPresetName();
    const idx = pool.indexOf(current);
    const prev = idx <= 0 ? pool[pool.length - 1] : pool[idx - 1];
    this.loadPreset(prev, blendTime);
    this.resetAutoCycle();
    return prev;
  }

  randomPreset(blendTime = 2.0) {
    const pool = this._visibleNames();
    if (pool.length === 0) return '';
    const current = this.getCurrentPresetName();
    let pick;
    do { pick = pool[Math.floor(Math.random() * pool.length)]; }
    while (pick === current && pool.length > 1);
    this.loadPreset(pick, blendTime);
    this.resetAutoCycle();
    return pick;
  }

  getCurrentPresetName() {
    if (this.currentPresetIndex < 0) return '';
    return this.presetNames[this.currentPresetIndex] || '';
  }

  getPresetNames() { return this.presetNames; }

  /** Strip the `custom:<id>:` prefix from a registry key for display. */
  displayName(name) {
    if (name && name.startsWith(CUSTOM_PREFIX)) {
      const parts = name.split(':');
      return parts.slice(2).join(':');
    }
    return name;
  }

  /** Async: fetch image blobs from IndexedDB and bind them as user textures. */
  async _bindCustomPresetImages(presetRecord) {
    const images = presetRecord.images || [];
    if (images.length === 0) return;
    for (const img of images) {
      if (!img.imageId || !img.texName) continue;
      try {
        const blob = await getImage(img.imageId);
        if (!blob) {
          console.warn('[DiscoCast Visualizer] Image not found in IndexedDB:', img.imageId, '(texName:', img.texName + ')');
          continue;
        }
        // Convert blob → data URL → Image to get natural dimensions
        const dataURL = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = (e) => res(e.target.result);
          reader.onerror = rej;
          reader.readAsDataURL(blob);
        });
        const imgEl = await new Promise((res, rej) => {
          const el = new Image();
          el.onload = () => res(el);
          el.onerror = rej;
          el.src = dataURL;
        });
        this.setUserTexture(img.texName, { data: dataURL, width: imgEl.naturalWidth, height: imgEl.naturalHeight });
        console.log('[DiscoCast Visualizer] Image bound:', img.texName, imgEl.naturalWidth + 'x' + imgEl.naturalHeight);
      } catch (e) {
        console.warn('[DiscoCast Visualizer] Failed to bind image for', img.texName, e.message);
      }
    }
  }

  /**
   * Re-read custom presets from localStorage and merge them into this.presets
   * and this.presetNames. Safe to call any time — bundled presets are untouched.
   * Call this whenever the preset drawer opens so freshly saved editor presets appear.
   */
  refreshCustomPresets() {
    // Remove any previously-registered custom keys
    for (const name of this.presetNames) {
      if (name.startsWith(CUSTOM_PREFIX)) delete this.presets[name];
    }
    // Re-register from localStorage
    const stored = loadAllCustomPresets();
    for (const [, preset] of Object.entries(stored)) {
      const key = registryKey(preset);
      // Migration: old presets used init_eqs/frame_eqs/pixel_eqs; butterchurn
      // requires the _str variants. Patch on load so existing saves still work.
      if (!('init_eqs_str' in preset)) {
        preset.init_eqs_str = preset.init_eqs || '';
        preset.frame_eqs_str = preset.frame_eqs || '';
        preset.pixel_eqs_str = preset.pixel_eqs || '';
      }
      this.presets[key] = preset;
    }
    // Rebuild sorted name list: bundled (no prefix) then custom
    const bundled = this.presetNames.filter(n => !n.startsWith(CUSTOM_PREFIX));
    const custom = Object.keys(this.presets)
      .filter(n => n.startsWith(CUSTOM_PREFIX))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    this.presetNames = [...bundled, ...custom];
  }

  setSize(width, height) {
    if (!this.canvas || !this.visualizer) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.visualizer.setRendererSize(width, height);
  }

  startRenderLoop() {
    if (this.isRunning) return;
    this.isRunning = true;
    const render = () => {
      if (!this.isRunning) return;

      // --- Performance Logic ---
      if (this.agcEnabled) {
        this.updateAGC();
      } else {
        // Reset to manual energy + base
        const targetGain = this.baseSensitivity * this.energyMultiplier * (this.boostActive ? 2.0 : 1.0);
        // Smoothly transition gain
        this.visualizerGainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.1);

        // Update hype level for UI
        this.analyser.getByteTimeDomainData(this.agcDataArray);
        let max = 0;
        for (let i = 0; i < this.agcDataArray.length; i++) {
          const val = Math.abs(this.agcDataArray[i] - 128);
          if (val > max) max = val;
        }
        const peak = max / 128;
        // Map 0-1 to a more visible 0-1 range for the UI meter
        this.hypeLevel = Math.min((peak * targetGain) / 5.0, 1.2);
      }

      this.visualizer.render();
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  stopRenderLoop() {
    this.isRunning = false;
    if (this.animFrameId) { cancelAnimationFrame(this.animFrameId); this.animFrameId = null; }
  }

  startAutoCycle() {
    this.stopAutoCycle();
    if (!this.autoCycleEnabled) return;
    this.autoCycleTimer = setInterval(async () => {
      const name = this.randomCycleOrder ? this.cycleRandom(3.0) : this.cycleNext(3.0);
      if (name) window.dispatchEvent(new CustomEvent('presetChanged', { detail: { name, auto: true } }));
    }, this.autoCycleInterval);
  }

  _cyclePool() {
    // Hide wins over favorite: any pool below excludes hidden names.
    // Fallback to full list only if everything ends up filtered out.
    let pool;
    if (this.favoritesOnly && this.favoritePool.length > 0) {
      pool = this.favoritePool.filter(n => this.presets[n] && !this.hiddenPool.has(n));
      if (pool.length > 0) return pool;
    }
    pool = this.presetNames.filter(n => !this.hiddenPool.has(n));
    return pool.length > 0 ? pool : this.presetNames;
  }

  cycleNext(blendTime = 2.0) {
    const pool = this._cyclePool();
    if (pool.length === 0) return '';
    const current = this.getCurrentPresetName();
    const idx = pool.indexOf(current);
    const next = pool[(idx + 1) % pool.length] || pool[0];
    this.loadPreset(next, blendTime);
    this.resetAutoCycle();
    return next;
  }

  cycleRandom(blendTime = 2.0) {
    const pool = this._cyclePool();
    if (pool.length === 0) return '';
    const current = this.getCurrentPresetName();
    let pick;
    do { pick = pool[Math.floor(Math.random() * pool.length)]; }
    while (pick === current && pool.length > 1);
    this.loadPreset(pick, blendTime);
    this.resetAutoCycle();
    return pick;
  }

  stopAutoCycle() {
    if (this.autoCycleTimer) { clearInterval(this.autoCycleTimer); this.autoCycleTimer = null; }
  }

  resetAutoCycle() { if (this.autoCycleEnabled) this.startAutoCycle(); }

  setAutoCycle(enabled) {
    this.autoCycleEnabled = !!enabled;
    if (this.autoCycleEnabled) this.startAutoCycle();
    else this.stopAutoCycle();
    return this.autoCycleEnabled;
  }

  setAutoCycleInterval(ms) {
    this.autoCycleInterval = Math.max(1000, ms);
    if (this.autoCycleEnabled) this.startAutoCycle();
  }

  setRandomCycleOrder(enabled) {
    this.randomCycleOrder = !!enabled;
  }

  setFavoritePool(names) {
    this.favoritePool = Array.isArray(names) ? [...names] : [];
  }

  setHiddenPool(names) {
    this.hiddenPool = new Set(Array.isArray(names) ? names : []);
  }

  setFavoritesOnly(enabled) {
    this.favoritesOnly = !!enabled;
  }

  setVolume(value) { if (this.volumeGainNode) this.volumeGainNode.gain.value = value; }

  // --- PERFORMANCE CONTROL METHODS ---

  setEnergy(value) {
    this.energyMultiplier = value;
  }

  toggleAGC() {
    this.agcEnabled = !this.agcEnabled;
    return this.agcEnabled;
  }

  updateAGC() {
    // Use TimeDomain data for raw peak volume (better for VU meters)
    this.analyser.getByteTimeDomainData(this.agcDataArray);
    let max = 0;
    for (let i = 0; i < this.agcDataArray.length; i++) {
      // Time domain values are 0-255 centered at 128
      const val = Math.abs(this.agcDataArray[i] - 128);
      if (val > max) max = val;
    }
    const peak = max / 128; // 0 to 1.0

    // Log once to confirm data flow
    if (peak > 0 && !this._audioConfirmed) {
      console.log('[DiscoCast Visualizer] Audio signal confirmed at analyser.');
      this._audioConfirmed = true;
    }

    this.lastPeak = this.lastPeak * 0.95 + peak * 0.05;

    // Normalize to ~0.5 peak, preserving dynamics so Butterchurn can detect beats
    const currentPeak = Math.max(this.lastPeak, 0.05);
    let targetGain = 0.5 / currentPeak;
    targetGain = Math.min(Math.max(targetGain, 0.5), 3.0);

    targetGain *= this.energyMultiplier;
    if (this.boostActive) targetGain *= 2.0;

    this.visualizerGainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.1);

    this.hypeLevel = Math.min(peak * this.energyMultiplier, 1.2);
  }

  toggleKickLock() {
    if (!this.currentSource) return this.kickLockEnabled;
    this.kickLockEnabled = !this.kickLockEnabled;

    if (this.currentSource) {
      try { this.currentSource.disconnect(this.analyser); } catch (e) { /* ignore */ }
      try { this.currentSource.disconnect(this.kickFilter); } catch (e) { /* ignore */ }
      try { this.kickFilter.disconnect(); } catch (e) { /* ignore */ }

      if (this.kickLockEnabled) {
        this.currentSource.connect(this.kickFilter);
        this.kickFilter.connect(this.analyser);
      } else {
        this.currentSource.connect(this.analyser);
      }
    }
    return this.kickLockEnabled;
  }

  setBoost(active) {
    this.boostActive = active;
  }

  /**
   * Load a preset object directly (for editor live-preview).
   * Deep-clones the object so butterchurn can't mutate the caller's state.
   */
  loadPresetObject(presetObj, blendTime = 0.5) {
    if (!this.visualizer || !presetObj) return false;
    try {
      this.visualizer.loadPreset(JSON.parse(JSON.stringify(presetObj)), blendTime);
      return true;
    } catch (e) {
      console.warn('[DiscoCast Visualizer] loadPresetObject failed:', e.message);
      return false;
    }
  }

  /**
   * Bind a named texture for use in a comp shader sampler (sampler_<name>).
   * Butterchurn expects { data: dataURL, width: number, height: number }.
   */
  setUserTexture(name, texObj) {
    if (!this.visualizer) return;
    try {
      if (typeof this.visualizer.loadExtraImages === 'function') {
        this.visualizer.loadExtraImages({ [name]: texObj });
      }
    } catch (e) {
      console.warn('[DiscoCast Visualizer] setUserTexture failed:', e.message);
    }
  }

  destroy() {
    this.stopRenderLoop();
    this.stopAutoCycle();
    this.disconnectSource();
    if (this.audioContext) this.audioContext.close();
  }
}
