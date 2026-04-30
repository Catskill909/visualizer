/**
 * importResultModal.js — Shared Import Result Modal
 *
 * Provides a single `showImportResult({ imported, names, failed })` function
 * used by every import surface in the app:
 *   - Main visualizer drawer  (controls.js)
 *   - Preset Editor library   (editor/presetLibrary.js)
 *   - Timeline Editor         (timelineEditor.js)
 *
 * The modal is injected into the DOM the first time it's needed (lazy), so
 * this module can be imported by any page without requiring an HTML change —
 * though each page's CSS must include the `.dc-import-modal-*` styles
 * (defined in src/style.css and re-used via the shared class names).
 *
 * Result object shape (matches what importFromFile / importTimelineBundle return):
 *   {
 *     imported : number,          // count of successfully imported items
 *     names    : string[],        // display names of successfully imported items
 *     failed   : { name: string, error: string }[]  // items that failed
 *   }
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Lazily create and cache the modal DOM node. */
function _getOrCreateModal() {
    let el = document.getElementById('dc-import-result-modal');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'dc-import-result-modal';
    el.className = 'dc-import-modal-backdrop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'dc-import-modal-title');
    el.hidden = true;

    el.innerHTML = `
        <div class="dc-import-modal-card">
            <div class="dc-import-modal-header">
                <span class="dc-import-modal-title" id="dc-import-modal-title">Import Complete</span>
            </div>
            <div class="dc-import-modal-body" id="dc-import-modal-body"></div>
            <div class="dc-import-modal-footer">
                <button class="dc-import-modal-ok" id="dc-import-modal-ok" type="button">OK</button>
            </div>
        </div>`;

    document.body.appendChild(el);

    // Close on backdrop click
    el.addEventListener('click', e => {
        if (e.target === el) _close(el);
    });

    return el;
}

function _close(el) {
    el.hidden = true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the import result modal.
 *
 * @param {object}   result
 * @param {number}   result.imported  - count of successfully imported items
 * @param {string[]} [result.names]   - display names of successfully imported items
 * @param {{ name: string, error: string }[]} [result.failed] - items that failed
 * @param {string}   [result.context] - optional label e.g. "timeline" or "preset"
 */
export function showImportResult({ imported = 0, names = [], failed = [], context = 'preset' }) {
    const el   = _getOrCreateModal();
    const body = document.getElementById('dc-import-modal-body');
    const noun = context === 'timeline' ? 'timeline' : `preset${imported !== 1 ? 's' : ''}`;

    let html = '';

    if (imported > 0) {
        const listItems = names.length
            ? names.map(n => `<li class="dc-import-modal-name">${_esc(n)}</li>`).join('')
            : '';
        html += `
            <div class="dc-import-modal-section dc-import-modal-success">
                <div class="dc-import-modal-section-head">
                    <svg class="dc-import-modal-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <strong>${imported} ${noun} imported successfully</strong>
                </div>
                ${listItems ? `<ul class="dc-import-modal-list">${listItems}</ul>` : ''}
            </div>`;
    }

    if (failed.length > 0) {
        const failItems = failed
            .map(f => `<li class="dc-import-modal-name dc-import-modal-fail-item">
                            ${_esc(f.name)}
                            ${f.error ? `<span class="dc-import-modal-err"> — ${_esc(f.error)}</span>` : ''}
                        </li>`)
            .join('');
        html += `
            <div class="dc-import-modal-section dc-import-modal-failure">
                <div class="dc-import-modal-section-head">
                    <svg class="dc-import-modal-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    <strong>${failed.length} failed</strong>
                </div>
                <ul class="dc-import-modal-list">${failItems}</ul>
            </div>`;
    }

    if (imported === 0 && failed.length === 0) {
        html = `<p class="dc-import-modal-empty">Nothing was imported — check the file format.</p>`;
    }

    body.innerHTML = html;
    el.hidden = false;

    // Register a one-shot Escape listener each time the modal opens
    const onKey = e => {
        if (e.key === 'Escape') { _close(el); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);

    // OK button — also removes the Escape listener
    const okBtn = document.getElementById('dc-import-modal-ok');
    const onOk = () => {
        _close(el);
        document.removeEventListener('keydown', onKey);
        okBtn.removeEventListener('click', onOk);
    };
    okBtn.addEventListener('click', onOk);

    okBtn.focus();
}

/** HTML-escape a string to prevent XSS from preset names. */
function _esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
