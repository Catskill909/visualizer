/**
 * downloadFile — cross-environment file save helper.
 *
 * In the Tauri macOS app (window.__TAURI__ defined): opens a native Save As
 * sheet via the save_file Rust command. Returns true if saved, false if the
 * user cancelled.
 *
 * In the browser: falls back to the standard <a download> approach, which
 * sends the file to the browser's Downloads folder. Always returns true.
 *
 * @param {string} filename  Suggested filename (including extension).
 * @param {string} content   File content as a string (JSON, etc.).
 * @returns {Promise<boolean>} true = saved, false = cancelled.
 */
let _audioLoadingModal = null;

export function showAudioLoadingModal() {
    if (!_audioLoadingModal) {
        const el = document.createElement('div');
        el.className = 'audio-loading-modal';
        el.innerHTML = '<div class="audio-loading-ring"></div><div class="audio-loading-text">Audio Loading</div>';
        document.body.appendChild(el);
        _audioLoadingModal = el;
    }
    _audioLoadingModal.classList.remove('hidden');
}

export function hideAudioLoadingModal() {
    if (_audioLoadingModal) _audioLoadingModal.classList.add('hidden');
}

/**
 * pickAudioFileDesktop — desktop (Tauri) audio picker used by the player,
 * editor and timeline. Returns a lightweight file-like object
 * `{ name, type, streamUrl }`, or null if the user cancelled.
 *
 * The audio is STREAMED from disk (`pick_audio_path` + `convertFileSrc`, the
 * asset protocol with range requests), so even a 2-hour file starts almost
 * instantly and isn't loaded into memory. The old path (`pick_audio_file`: whole
 * file → base64 over IPC → decoded byte-by-byte) took a long spinner and several
 * times the file size in RAM. It stays as a fallback if streaming isn't
 * available. Pass the result to engine.connectAudioFile().
 */
export async function pickAudioFileDesktop() {
    const tauri = window.__TAURI__;
    try {
        const r = await tauri.invoke('pick_audio_path');
        if (!r) return null;
        return { name: r.name, type: '', streamUrl: tauri.tauri.convertFileSrc(r.path) };
    } catch (err) {
        console.warn('[audio] streaming pick unavailable, falling back to full read:', err);
    }
    showAudioLoadingModal();
    try {
        const result = await tauri.invoke('pick_audio_file');
        if (!result) return null;
        const bin = atob(result.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], result.name, { type: 'audio/mpeg' });
    } finally {
        hideAudioLoadingModal();
    }
}

export async function downloadFile(filename, content) {
    const mb = content.length / 1_048_576;
    if (mb > 50 && !confirm(`This export is ~${mb.toFixed(0)} MB — continue?`)) {
        return false;
    }

    if (window.__TAURI__) {
        try {
            const result = await window.__TAURI__.invoke('save_file', { filename, content });
            return result !== null;
        } catch (e) {
            console.error('[downloadFile] Tauri save_file failed:', e);
            return false;
        }
    }
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
}
