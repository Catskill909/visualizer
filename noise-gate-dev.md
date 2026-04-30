# Noise Gate — Dev Planning

## Context

Conversation with an AI about real-world club/venue audio performance revealed a gap: the app has no silence threshold. When a laptop mic sits in a loud club at 110dB of constant ambient noise, AGC normalizes that noise to 0.5 and Butterchurn animates continuously on pure room noise — jittery, unresponsive to actual musical beats. A noise gate solves this by cutting signal processing below a configurable floor.

---

## Current Audio Pipeline Audit

### What exists today

| Feature | File | Status |
|---------|------|--------|
| AGC (Auto-Gain Control) | `src/visualizer.js` → `updateAGC()` | ✅ Built |
| Energy multiplier (0.2–5.0) | `src/visualizer.js` → `setEnergy()` | ✅ Built |
| Kick Lock (150Hz low-pass) | `src/visualizer.js` → `toggleKickLock()` | ✅ Built |
| VU meter bar | `src/controls.js` → `updateVUMeter()` | ✅ Built |
| Signal status text | `index.html` `#signal-status` | ✅ Built |
| **Noise gate / silence threshold** | — | ❌ Missing |

### `updateAGC()` — current logic (no gate)

```
peak = max sample deviation / 128   (0.0 – 1.0)
lastPeak = lastPeak * 0.95 + peak * 0.05   (slow smoothing)
targetGain = 0.5 / currentPeak   clamped to 0.5–3.0
targetGain *= energyMultiplier
targetGain *= 2.0 if boost active
hypeLevel = peak * energyMultiplier   (drives VU meter)
```

**The problem:** no check before setting `targetGain`. A constant 90dB room noise floor produces a steady `peak` → AGC locks in a stable gain → visuals animate endlessly on noise. No beats, no silence, just jitter.

---

## Phase 1 — Core Noise Gate

### What it does

If the raw signal peak is below a threshold, suppress it: zero out `hypeLevel` and hold gain steady (don't let AGC "chase" the noise floor). The visualizer goes quiet/still during silence and snaps back immediately when a real transient (kick, snare, drop) breaks through.

### Engine changes — `src/visualizer.js`

**New properties (add to constructor):**
```js
this.noiseGateEnabled = false;      // off by default
this.noiseGateThreshold = 0.05;    // 0.0–1.0; default = 5% of full scale
this._gateClosed = false;           // internal state — are we gated?
```

**Modified `updateAGC()`:**
```js
updateAGC() {
  this.analyser.getByteTimeDomainData(this.agcDataArray);
  let max = 0;
  for (let i = 0; i < this.agcDataArray.length; i++) {
    const val = Math.abs(this.agcDataArray[i] - 128);
    if (val > max) max = val;
  }
  const peak = max / 128;

  // --- NOISE GATE ---
  if (this.noiseGateEnabled && peak < this.noiseGateThreshold) {
    this._gateClosed = true;
    this.hypeLevel = 0;
    return; // hold current gain — don't let AGC normalize noise floor
  }
  this._gateClosed = false;
  // --- END GATE ---

  // ... existing AGC logic unchanged below ...
}
```

**New public methods:**
```js
toggleNoiseGate() {
  this.noiseGateEnabled = !this.noiseGateEnabled;
  return this.noiseGateEnabled;
}

setNoiseGateThreshold(value) {        // 0.0–1.0
  this.noiseGateThreshold = value;
}

getGateState() {
  return this._gateClosed;            // for UI feedback
}
```

---

### UI changes — `index.html`

Add after the Kick Lock switch row in `#audio-tuning-panel`:

```html
<div class="switch-row">
  <label class="switch-label" for="toggle-noisegate">Noise Gate</label>
  <label class="switch">
    <input type="checkbox" id="toggle-noisegate" />
    <span class="switch-track"></span>
  </label>
</div>

<div class="slider-row" id="noisegate-threshold-row" style="display:none">
  <label>Gate Threshold</label>
  <div class="slider-with-icon">
    <span>🔇</span>
    <input type="range" id="noisegate-threshold" min="0.01" max="0.30" step="0.01" value="0.05" />
  </div>
</div>
```

The threshold slider is hidden when the gate is off — show/hide on toggle.

---

### Controls changes — `src/controls.js`

**Add to `this.els`:**
```js
toggleNoisegate: document.getElementById('toggle-noisegate'),
noiseGateThresholdRow: document.getElementById('noisegate-threshold-row'),
noiseGateThreshold: document.getElementById('noisegate-threshold'),
```

**Add to event bindings (after Kick Lock block):**
```js
els.toggleNoisegate.addEventListener('change', () => {
  const active = engine.toggleNoiseGate();
  els.noiseGateThresholdRow.style.display = active ? '' : 'none';
  this.showToast(active ? '🔇 Noise Gate ON' : '🔇 Noise Gate OFF');
});

els.noiseGateThreshold.addEventListener('input', (e) => {
  engine.setNoiseGateThreshold(parseFloat(e.target.value));
});
```

**VU meter gate indicator** — update `updateVUMeter()` to show gated state:
```js
updateVUMeter() {
  const level = this.engine.hypeLevel || 0;
  const gated = this.engine.noiseGateEnabled && this.engine._gateClosed;
  const width = Math.min(level * 100, 100);
  this.els.vuMeterBar.style.width = width + '%';

  if (gated) {
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
```

---

## Phase 2 — Enhancements for DJs / Live Venues

These build on the core gate and address real-world DJ booth scenarios specifically.

---

### 2A — Gate Attack / Release (smoothing)

A hard gate creates an abrupt cut — fine for digital silence but jarring in a live room where the "noise" bleeds in slowly. Attack/release controls let the gate open and close with a small ramp.

- **Attack** — how fast the gate opens when signal exceeds threshold (ms)
- **Release** — how fast the gate closes when signal drops below threshold (ms)

Simple implementation: track a `_gateGain` float (0.0–1.0) and lerp it toward 0 or 1 per frame instead of hard-switching. No new Web Audio nodes needed.

```js
// In updateAGC(), replace the hard return with:
const targetGateGain = (peak < this.noiseGateThreshold) ? 0 : 1;
const rate = (targetGateGain > this._gateGain) ? this._gateAttack : this._gateRelease;
this._gateGain = this._gateGain + (targetGateGain - this._gateGain) * rate;
this.hypeLevel = peak * this.energyMultiplier * this._gateGain;
```

---

### 2B — Adaptive Threshold ("Learn the Room")

Instead of a fixed threshold, add a "Learn Room" button that samples the ambient noise floor for 3 seconds and sets the threshold to `averagePeak * 1.3` automatically. Ideal for club setup — press it during a quiet moment before the set starts.

```
UI: [Learn Room] button  → samples 3s → sets threshold → shows toast "Gate threshold set to 12%"
```

---

### 2C — Relative Change Detection (Beat Spike Mode)

Instead of absolute peak, look for **relative change** from the running average. If the room noise floor is sitting at 80% peak, a kick drum at 90% is still a +10% spike — gate passes it, everything else is blocked.

```js
// Rolling noise floor estimate
this._noiseFloor = this._noiseFloor * 0.999 + peak * 0.001;  // very slow average
const spike = peak - this._noiseFloor;
const gated = spike < this.noiseGateThreshold;
```

This makes the gate "adaptive" without the Learn Room button — it figures out the room automatically over ~30 seconds. Works well for sustained loud environments where absolute threshold would need constant adjustment.

---

### 2D — Source Routing Recommendations (User-Facing Docs)

Not a code feature — a help panel / tooltip in the UI guiding users toward better inputs in a club:

**Priority order (best to worst for a club):**
1. **Booth Out / Record Out → USB interface** — direct line from DJ mixer, zero room noise
2. **Loopback / BlackHole** — if DJ is on the same Mac, route internal audio directly
3. **USB audio interface with XLR mic** — better preamp, further from speakers
4. **Built-in mic** — last resort; use Noise Gate + Kick Lock + low Energy multiplier

This should live as a `?` tooltip on the Noise Gate row, or a "Club Setup Guide" section accessible from the Audio Performance panel.

---

### 2E — Input Clipping Warning

When a laptop mic is overwhelmed (peak hits 1.0 / full scale), the signal is clipped and no amount of filtering recovers the waveform. A visual warning — the VU meter bar flashing red or a "CLIPPING" status text — tells the user immediately that they need to physically move the laptop or use a different input, not adjust software settings.

```js
// In updateVUMeter():
if (peak >= 0.98) {
  this.els.signalStatus.textContent = 'CLIPPING — move mic';
  this.els.vuMeterBar.classList.add('clipping');
}
```

CSS: `.vu-meter-bar.clipping` — flash animation, red override.

---

### 2F — Freeze-on-Silence Mode

When the gate closes (signal drops below threshold), instead of letting the visualizer freeze on whatever frame it was on, optionally **hold the last frame cleanly** or **slow the render speed to 0.1×** so it looks like an intentional pause rather than a frozen bug.

Connects to `engine.freezeFrame()` / `engine.setRenderSpeed()` already planned in `midi-dev.md`.

```js
// In updateAGC() when gate closes:
if (this.freezeOnSilence) engine.setRenderSpeed(0.05);
// When gate opens:
engine.setRenderSpeed(1.0);
```

---

### 2G — MIDI Binding for Gate

Once the MIDI system (Phase 3 in `midi-dev.md`) is built, the noise gate naturally gets bindings:

| Action | MIDI | Keyboard |
|--------|------|----------|
| Noise Gate toggle | CC 91 | `N` |
| Gate threshold up | — | `Shift+N` |
| Gate threshold down | — | `Ctrl+N` |
| Learn Room | Note 45 | `Alt+N` |

---

## Implementation Order

| Step | What | Complexity |
|------|------|-----------|
| 1 | Core gate in `updateAGC()` — hard threshold, `noiseGateEnabled` flag | Low |
| 2 | Switch + threshold slider in `index.html` | Low |
| 3 | `controls.js` bindings + GATED status in VU meter | Low |
| 4 | Clipping warning (2E) | Low — add to existing `updateVUMeter()` |
| 5 | Attack/release smoothing (2A) | Medium |
| 6 | Relative change / spike detection (2C) | Medium |
| 7 | Learn Room button (2B) | Medium |
| 8 | Freeze-on-silence (2F) | Medium — depends on `setRenderSpeed()` from midi-dev |
| 9 | Source routing help UI (2D) | ✅ Done — added to in-app User Guide (Audio Sources + Live Performance sections) |
| 10 | MIDI bindings (2G) | Deferred — depends on midi-dev Phase 3 |

Steps 1–4 are a single clean session. Steps 5–7 add a session. Steps 8–10 are deferred.

---

## Files Touched (Phase 1)

| File | Change |
|------|--------|
| `src/visualizer.js` | `noiseGateEnabled`, `noiseGateThreshold`, `_gateClosed` properties; gate logic in `updateAGC()`; `toggleNoiseGate()`, `setNoiseGateThreshold()`, `getGateState()` methods |
| `index.html` | Noise Gate switch + threshold slider row in `#audio-tuning-panel` |
| `src/controls.js` | DOM refs, event bindings, `updateVUMeter()` GATED state |

No new files needed for Phase 1. Clean additive changes only.

---

## Open Questions

- Should the gate threshold slider be visible at all times (for power users) or only when gate is enabled? **Current plan: hidden when off — show on enable.**
- Should `lastPeak` smoothing still run when gated, or reset? **Current plan: hold `lastPeak` frozen when gated so AGC doesn't drift during silence.**
- Freeze-on-silence: opt-in toggle or automatic when gate is on? **Defer decision until after Phase 1 is live and tested in a real room.**
