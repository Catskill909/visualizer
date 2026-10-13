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
import './platform.css'; // the rules live in a real stylesheet (CSP-safe in the desktop app)

export const IS_DESKTOP = typeof window !== 'undefined' && !!window.__TAURI__;


if (IS_DESKTOP && typeof document !== 'undefined') {
  document.documentElement.classList.add('is-desktop');
}
