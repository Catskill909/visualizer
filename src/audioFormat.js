/**
 * audioFormat.js — single source of truth for which audio files the app accepts.
 *
 * Playback runs through an <audio> element (see visualizer.js connectAudioFile),
 * so the file must be decodable by the host engine. These extensions decode in
 * BOTH WKWebView (macOS app + Safari) AND WebView2/Chromium (Windows app + Chrome).
 * AIFF is intentionally excluded — it only decodes in Apple's engine, so it would
 * load silently on Windows and break audio reactivity with no feedback.
 */

export const SUPPORTED_AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];

// Human-readable list for the modal, in the order we want to show it.
export const SUPPORTED_AUDIO_LABELS = ['MP3', 'WAV', 'FLAC', 'OGG', 'AAC', 'M4A'];

/**
 * isSupportedAudioFile — true if the file's extension is one we can play
 * everywhere. Keys off the extension (MIME type is unreliable, often empty
 * in the Tauri native file picker).
 * @param {File|{name:string}} file
 * @returns {boolean}
 */
export function isSupportedAudioFile(file) {
  if (!file || !file.name) return false;
  const ext = file.name.split('.').pop().toLowerCase();
  return SUPPORTED_AUDIO_EXTS.includes(ext);
}

let _formatModal = null;

function buildModal() {
  const el = document.createElement('div');
  el.className = 'audio-format-modal hidden';
  el.innerHTML = `
    <div class="afm-card" role="dialog" aria-modal="true" aria-labelledby="afm-title">
      <div class="afm-icon" aria-hidden="true">♪</div>
      <div class="afm-title" id="afm-title">Unsupported audio format</div>
      <div class="afm-msg"></div>
      <div class="afm-formats">${SUPPORTED_AUDIO_LABELS.join(' · ')}</div>
      <button class="afm-btn" type="button">Got it</button>
    </div>`;
  document.body.appendChild(el);

  const close = () => hideUnsupportedAudioModal();
  // Dismiss: button, backdrop click, Esc.
  el.querySelector('.afm-btn').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.classList.contains('hidden')) close();
  });
  return el;
}

/**
 * showUnsupportedAudioModal — clean modal telling the user the file can't be
 * played and listing the formats that can. Reuses one element across calls.
 * @param {File|{name:string}} file
 */
export function showUnsupportedAudioModal(file) {
  if (!_formatModal) _formatModal = buildModal();
  const name = file && file.name ? file.name : 'That file';
  _formatModal.querySelector('.afm-msg').textContent =
    `“${name}” can’t be played. Please load one of these formats:`;
  _formatModal.classList.remove('hidden');
}

export function hideUnsupportedAudioModal() {
  if (_formatModal) _formatModal.classList.add('hidden');
}
