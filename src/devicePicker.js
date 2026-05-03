/**
 * devicePicker.js — Shared device picker modal
 *
 * Enumerates audio input devices, shows a radio-button modal if ≥ 2 devices
 * exist, and resolves with the chosen deviceId. Used by:
 *   - Main app (index.html → controls.js)
 *   - Preset Studio (editor.html → editor/main.js)
 *   - Timeline Editor (timeline.html → timeline/main.js)
 *
 * The modal markup is injected into the DOM on first use if it doesn't
 * already exist (so editor.html and timeline.html don't need HTML changes).
 */

const MODAL_ID = 'device-picker-modal';

// ─── Inject modal markup if missing ───────────────────────────────────────────

function ensureModal() {
  if (document.getElementById(MODAL_ID)) return;

  const html = `
    <div id="${MODAL_ID}" class="device-picker-backdrop" hidden role="dialog" aria-modal="true" aria-label="Choose audio input">
      <div class="device-picker-dialog">
        <h2 class="device-picker-title">Choose Audio Input</h2>
        <p class="device-picker-subtitle">Select the device to use for live audio.</p>
        <div id="device-picker-list" class="device-picker-list" role="radiogroup"></div>
        <div class="device-picker-actions">
          <button id="device-picker-confirm" class="device-picker-btn device-picker-btn--primary" type="button" disabled>Connect</button>
          <button id="device-picker-cancel" class="device-picker-btn device-picker-btn--secondary" type="button">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

// ─── Inject styles if missing ─────────────────────────────────────────────────

function ensureStyles() {
  if (document.getElementById('device-picker-styles')) return;

  const css = `
    .device-picker-backdrop {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,.72); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
    }
    .device-picker-backdrop[hidden] {
      display: none !important;
    }
    .device-picker-dialog {
      background: #1a1a1e; border: 1px solid rgba(255,255,255,.08);
      border-radius: 16px; padding: 28px 32px 24px;
      min-width: 340px; max-width: 420px; width: 90vw;
      box-shadow: 0 24px 80px rgba(0,0,0,.6);
    }
    .device-picker-title {
      font-size: 17px; font-weight: 600; color: #fff; margin: 0 0 4px;
    }
    .device-picker-subtitle {
      font-size: 13px; color: rgba(255,255,255,.45); margin: 0 0 18px;
    }
    .device-picker-list {
      display: flex; flex-direction: column; gap: 6px;
      max-height: 260px; overflow-y: auto; margin-bottom: 20px;
    }
    .device-picker-item {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; border-radius: 10px; cursor: pointer;
      border: 1px solid rgba(255,255,255,.06);
      background: rgba(255,255,255,.03);
      transition: background .15s, border-color .15s;
    }
    .device-picker-item:hover { background: rgba(255,255,255,.07); }
    .device-picker-item.selected {
      background: rgba(100,140,255,.12);
      border-color: rgba(100,140,255,.4);
    }
    .device-picker-radio {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.25);
      flex-shrink: 0; position: relative;
      transition: border-color .15s;
    }
    .device-picker-item.selected .device-picker-radio {
      border-color: #648cff;
    }
    .device-picker-item.selected .device-picker-radio::after {
      content: ''; position: absolute; inset: 3px;
      border-radius: 50%; background: #648cff;
    }
    .device-picker-label {
      font-size: 14px; color: rgba(255,255,255,.85);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .device-picker-actions {
      display: flex; gap: 10px; justify-content: flex-end;
    }
    .device-picker-btn {
      padding: 9px 22px; border-radius: 8px; border: none;
      font-size: 14px; font-weight: 500; cursor: pointer;
      transition: background .15s, opacity .15s;
    }
    .device-picker-btn--primary {
      background: #648cff; color: #fff;
    }
    .device-picker-btn--primary:disabled {
      opacity: .35; cursor: default;
    }
    .device-picker-btn--secondary {
      background: rgba(255,255,255,.08); color: rgba(255,255,255,.7);
    }
    .device-picker-btn--secondary:hover {
      background: rgba(255,255,255,.12);
    }
  `;
  const style = document.createElement('style');
  style.id = 'device-picker-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Show the device picker modal and return the selected deviceId.
 * If only one device exists, returns its ID immediately (no modal).
 * If user cancels, returns null.
 *
 * @returns {Promise<string|null>} deviceId or null
 */
export async function pickAudioDevice() {
  // 1. Try enumerating first — in Tauri/macOS (entitlement already granted) or
  //    when the user has previously allowed mic access, labels are already present.
  let devices = await navigator.mediaDevices.enumerateDevices();
  let audioInputs = devices.filter(d => d.kind === 'audioinput');
  const hasLabels = audioInputs.length > 0 && audioInputs.some(d => d.label);

  if (!hasLabels) {
    // Labels are hidden — request a temporary stream to unlock them.
    let tempStream;
    try {
      tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('[DevicePicker] Permission denied:', err);
      throw err;
    }
    devices = await navigator.mediaDevices.enumerateDevices();
    audioInputs = devices.filter(d => d.kind === 'audioinput');
    tempStream.getTracks().forEach(t => t.stop());
  }

  // 0 devices — fallback to default
  if (audioInputs.length === 0) return null;

  // 1 device — skip picker
  if (audioInputs.length === 1) return audioInputs[0].deviceId;

  // 2+ devices — show modal
  ensureStyles();
  ensureModal();

  return new Promise(resolve => {
    const modal   = document.getElementById(MODAL_ID);
    const list    = document.getElementById('device-picker-list');
    const confirm = document.getElementById('device-picker-confirm');
    const cancel  = document.getElementById('device-picker-cancel');

    let selectedId = null;

    // Build device list
    list.innerHTML = '';
    audioInputs.forEach((device, i) => {
      const item = document.createElement('div');
      item.className = 'device-picker-item';
      item.dataset.deviceId = device.deviceId;
      item.innerHTML = `
        <span class="device-picker-radio"></span>
        <span class="device-picker-label">${device.label || `Audio Input ${i + 1}`}</span>
      `;
      item.addEventListener('click', () => {
        list.querySelectorAll('.device-picker-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        selectedId = device.deviceId;
        confirm.disabled = false;
      });
      list.appendChild(item);
    });

    confirm.disabled = true;
    modal.hidden = false;

    const cleanup = () => {
      modal.hidden = true;
      confirm.replaceWith(confirm.cloneNode(true));
      cancel.replaceWith(cancel.cloneNode(true));
      document.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBackdrop);
    };

    const onKey = e => {
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    };

    const onBackdrop = e => {
      if (e.target === modal) { cleanup(); resolve(null); }
    };

    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);

    confirm.addEventListener('click', () => {
      cleanup();
      resolve(selectedId);
    }, { once: true });

    cancel.addEventListener('click', () => {
      cleanup();
      resolve(null);
    }, { once: true });
  });
}

/**
 * Full flow: pick a device, connect to it, return the stream's actual deviceId.
 * Convenience wrapper for entry points that just need "pick + connect".
 *
 * @param {VisualizerEngine} engine
 * @returns {Promise<{connected: boolean, deviceId: string|null, label: string}>}
 */
export async function pickAndConnect(engine) {
  const deviceId = await pickAudioDevice();
  if (deviceId === null && deviceId !== undefined) {
    // User cancelled
    return { connected: false, deviceId: null, label: '' };
  }

  await engine.connectMicrophone(deviceId);

  // Read actual connected device from stream
  const stream = engine._micStream;
  const track  = stream?.getAudioTracks()[0];
  const settings = track?.getSettings?.() || {};
  const label = track?.label || 'Microphone';

  return {
    connected: true,
    deviceId: settings.deviceId || deviceId,
    label,
  };
}
