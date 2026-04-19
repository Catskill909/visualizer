/**
 * VisualizerEngine — Wraps Butterchurn for audio visualization
 * Loads ~1,100 presets from official packs + Baron community pack
 */
import butterchurnImport from 'butterchurn';
import butterchurnPresetsImport from 'butterchurn-presets';
import butterchurnPresetsExtra from 'butterchurn-presets/lib/butterchurnPresetsExtra.min.js';
import butterchurnPresetsExtra2 from 'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js';
import butterchurnPresetsMD1 from 'butterchurn-presets/lib/butterchurnPresetsMD1.min.js';


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
    
    // Performance controls
    this.energyMultiplier = 1.5;
    this.baseSensitivity = 5.0;
    this.agcEnabled = true;
    this.kickLockEnabled = false;
    this.boostActive = false;
    
    // Audio nodes
    this.analyser = null;
    this.kickFilter = null;
    this.agcDataArray = null;
    this.lastPeak = 0.5;
  }

  init(canvas) {
    this.canvas = canvas;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // 1. Analyser for AGC
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.agcDataArray = new Uint8Array(this.analyser.frequencyBinCount);

    // 2. Kick Lock Filter (Lowpass)
    this.kickFilter = this.audioContext.createBiquadFilter();
    this.kickFilter.type = 'lowpass';
    this.kickFilter.frequency.value = 150; // Focus on bass
    this.kickFilter.Q.value = 1.0;

    // 3. Main Gain Node
    this.visualizerGainNode = this.audioContext.createGain();
    this.visualizerGainNode.gain.value = this.baseSensitivity;

    // Default routing: Analyser -> visualizerGainNode
    // We will dynamically insert the kickFilter when enabled.
    this.analyser.connect(this.visualizerGainNode);

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
          console.log(`[MilkScreen] ${pack.label}: +${count} presets`);
        }
      } catch (e) {
        console.warn(`[MilkScreen] Failed to load ${pack.label}:`, e.message);
      }
    }


    this.presetNames = Object.keys(this.presets).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    console.log(`[MilkScreen] Loaded ${this.presetNames.length} presets`);

    // Create visualizer
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const butterchurnLib = resolveModule(butterchurnImport, 'butterchurn', 'createVisualizer');
    if (!butterchurnLib || typeof butterchurnLib.createVisualizer !== 'function') {
      console.error('[MilkScreen] butterchurn.createVisualizer not found:', butterchurnImport);
      throw new Error('butterchurn.createVisualizer is not available');
    }

    this.visualizer = butterchurnLib.createVisualizer(this.audioContext, canvas, {
      width, height, pixelRatio: window.devicePixelRatio || 1,
    });

    this.visualizer.connectAudio(this.visualizerGainNode);
    this.randomPreset();
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
      this.volumeGainNode = this.audioContext.createGain();
      source.connect(this.volumeGainNode);
      this.volumeGainNode.connect(this.audioContext.destination);
      
      // Connect to the head of our internal chain
      source.connect(this.analyser);
      
      this.currentSource = source;
      this.currentSourceType = 'file';
      this.startRenderLoop();
      this.startAutoCycle();
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

  loadPreset(name, blendTime = 2.0) {
    const preset = this.presets[name];
    if (!preset) return false;
    this.visualizer.loadPreset(preset, blendTime);
    this.currentPresetIndex = this.presetNames.indexOf(name);
    return true;
  }

  loadPresetByIndex(index, blendTime = 2.0) {
    if (index < 0 || index >= this.presetNames.length) return false;
    return this.loadPreset(this.presetNames[index], blendTime);
  }

  nextPreset(blendTime = 2.0) {
    const next = (this.currentPresetIndex + 1) % this.presetNames.length;
    this.loadPresetByIndex(next, blendTime);
    this.resetAutoCycle();
    return this.getCurrentPresetName();
  }

  prevPreset(blendTime = 2.0) {
    const prev = this.currentPresetIndex <= 0 ? this.presetNames.length - 1 : this.currentPresetIndex - 1;
    this.loadPresetByIndex(prev, blendTime);
    this.resetAutoCycle();
    return this.getCurrentPresetName();
  }

  randomPreset(blendTime = 2.0) {
    if (this.presetNames.length === 0) return '';
    let idx;
    do { idx = Math.floor(Math.random() * this.presetNames.length); }
    while (idx === this.currentPresetIndex && this.presetNames.length > 1);
    this.loadPresetByIndex(idx, blendTime);
    this.resetAutoCycle();
    return this.getCurrentPresetName();
  }

  getCurrentPresetName() {
    if (this.currentPresetIndex < 0) return '';
    return this.presetNames[this.currentPresetIndex] || '';
  }

  getPresetNames() { return this.presetNames; }

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
    this.autoCycleTimer = setInterval(() => {
      this.randomPreset(3.0);
      window.dispatchEvent(new CustomEvent('presetChanged', { detail: { name: this.getCurrentPresetName() } }));
    }, this.autoCycleInterval);
  }

  stopAutoCycle() {
    if (this.autoCycleTimer) { clearInterval(this.autoCycleTimer); this.autoCycleTimer = null; }
  }

  resetAutoCycle() { if (this.autoCycleEnabled) this.startAutoCycle(); }

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
    this.analyser.getByteFrequencyData(this.agcDataArray);
    let max = 0;
    for (let i = 0; i < this.agcDataArray.length; i++) {
      if (this.agcDataArray[i] > max) max = this.agcDataArray[i];
    }
    
    // max is 0-255. We want a target normalized peak of around 180-200.
    const normalized = max / 255;
    this.lastPeak = this.lastPeak * 0.95 + normalized * 0.05; // Smoothing

    // Avoid division by zero
    const peak = Math.max(this.lastPeak, 0.01);
    
    // Target gain to bring peaks to ~0.7 intensity
    let targetGain = (0.7 / peak) * 4.0; // 4.0 is a base scaling factor for butterchurn
    
    // Constrain gain to sane levels (e.g. 1x to 15x)
    targetGain = Math.min(Math.max(targetGain, 1.0), 15.0);
    
    // Apply energy slider on top of AGC for fine tuning
    targetGain *= this.energyMultiplier;
    if (this.boostActive) targetGain *= 2.0;

    this.visualizerGainNode.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.2);
  }

  toggleKickLock() {
    this.kickLockEnabled = !this.kickLockEnabled;
    
    // Update routing
    if (this.currentSource) {
      this.currentSource.disconnect(this.analyser);
      this.analyser.disconnect();
      this.kickFilter.disconnect();

      if (this.kickLockEnabled) {
        // Source -> Filter -> Analyser -> Gain
        this.currentSource.connect(this.kickFilter);
        this.kickFilter.connect(this.analyser);
        this.analyser.connect(this.visualizerGainNode);
      } else {
        // Source -> Analyser -> Gain
        this.currentSource.connect(this.analyser);
        this.analyser.connect(this.visualizerGainNode);
      }
    }
    return this.kickLockEnabled;
  }

  setBoost(active) {
    this.boostActive = active;
  }

  destroy() {
    this.stopRenderLoop();
    this.stopAutoCycle();
    this.disconnectSource();
    if (this.audioContext) this.audioContext.close();
  }
}
