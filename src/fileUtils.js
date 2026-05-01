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
export async function downloadFile(filename, content) {
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
