/**
 * platform.js — marks the page as running in the desktop app (Tauri) so
 * web-only UI can be hidden with markup instead of per-page JS.
 *
 *   data-web-only      hidden in the desktop app (features that silently do
 *                      nothing in WKWebView — e.g. output windows need
 *                      window.open, which Tauri 1 doesn't support)
 *   data-desktop-only  shown only in the desktop app
 *
 * The desktop app is the shipping product: see README → Platform support.
 */
export const IS_DESKTOP = typeof window !== 'undefined' && !!window.__TAURI__;

if (typeof document !== 'undefined') {
  if (IS_DESKTOP) document.documentElement.classList.add('is-desktop');
  const style = document.createElement('style');
  style.textContent =
    '.is-desktop [data-web-only]{display:none!important}' +
    'html:not(.is-desktop) [data-desktop-only]{display:none!important}' +
    // Timeline per-zone output chips route zones to output windows (web only).
    '.is-desktop .tl-zone-out-chip{display:none!important}';
  document.head.appendChild(style);
}
