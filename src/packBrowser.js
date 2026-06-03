/**
 * packBrowser.js — the shared Import / Browse-Packs modal (Phase 2 / milkdrop-pack-import.md §4).
 *
 * ONE component injected into any page (player / editor / timeline) — not duplicated per page.
 * Two tabs: "From File" (the existing .dcshow.json import, handed to onImportFile) and
 * "Community Packs" (browse a manifest, install/uninstall with the §2c progress UX).
 *
 * Public API:  showPackBrowser({ engine, onImportFile })
 *   engine        — VisualizerEngine (for loadCommunityPresets refresh after install/uninstall)
 *   onImportFile  — (File) => void   reuses each page's existing file-import handler (Tab 1)
 */

import { installPackFromZip, uninstallPack, listInstalledPacks } from './packInstaller.js';

const MANIFEST_URL = '/pack-manifest.json';
const STYLE_ID = 'dc-pack-styles';
let _root = null;          // current modal root (null when closed)
let _escHandler = null;

export async function showPackBrowser({ engine, onImportFile } = {}) {
    if (_root) return;                       // already open — no double-open
    _injectStyles();
    _root = _buildDom();
    document.body.appendChild(_root);
    _wire({ engine, onImportFile });
    _activateTab('packs');                   // lead with the new feature; File is one tab over
    await _renderPacks(engine);
}

function _close() {
    if (!_root) return;
    _root.remove();
    _root = null;
    if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function _buildDom() {
    const root = document.createElement('div');
    root.className = 'dc-pack-backdrop';
    root.innerHTML = `
      <div class="dc-pack-card" role="dialog" aria-modal="true" aria-label="Import presets">
        <div class="dc-pack-head">
          <div class="dc-pack-tabs">
            <button class="dc-pack-tab" data-tab="packs">Community Packs</button>
            <button class="dc-pack-tab" data-tab="file">From File</button>
          </div>
          <button class="dc-pack-x" aria-label="Close">✕</button>
        </div>
        <div class="dc-pack-body">
          <section class="dc-pack-pane" data-pane="packs">
            <div class="dc-pack-list"><div class="dc-pack-loading">Loading packs…</div></div>
            <div class="dc-pack-foot"></div>
          </section>
          <section class="dc-pack-pane" data-pane="file" hidden>
            <label class="dc-pack-drop">
              <input type="file" accept=".json,.dcshow.json" hidden>
              <div class="dc-pack-drop-icon">📄</div>
              <div class="dc-pack-drop-title">Drop a <b>.dcshow.json</b> file here</div>
              <div class="dc-pack-drop-sub">or click to browse · <span class="dc-pack-dim">.milk support coming later</span></div>
            </label>
          </section>
        </div>
      </div>`;
    return root;
}

function _wire({ engine, onImportFile }) {
    _root.querySelector('.dc-pack-x').addEventListener('click', _close);
    _root.addEventListener('mousedown', (e) => { if (e.target === _root) _close(); }); // backdrop click
    _escHandler = (e) => { if (e.key === 'Escape') _close(); };
    document.addEventListener('keydown', _escHandler);

    _root.querySelectorAll('.dc-pack-tab').forEach((t) =>
        t.addEventListener('click', () => _activateTab(t.dataset.tab)));

    // Tab 1 — file import: hand the file to the page's existing handler, then close.
    const input = _root.querySelector('.dc-pack-drop input');
    const drop = _root.querySelector('.dc-pack-drop');
    input.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) { _close(); onImportFile?.(f); }
    });
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => {
        const f = e.dataTransfer?.files?.[0];
        if (f) { _close(); onImportFile?.(f); }
    });
}

function _activateTab(name) {
    _root.querySelectorAll('.dc-pack-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    _root.querySelectorAll('.dc-pack-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
}

// ---------------------------------------------------------------------------
// Community Packs tab
// ---------------------------------------------------------------------------

async function _renderPacks(engine) {
    const list = _root.querySelector('.dc-pack-list');
    const foot = _root.querySelector('.dc-pack-foot');

    // Community packs are bundled in the DESKTOP app only (not served on the web — §15).
    // Show them in the Tauri app, or in dev (so headless verify + local testing work).
    const onDesktop = typeof window !== 'undefined' && !!window.__TAURI__;
    const inDev = !!(import.meta && import.meta.env && import.meta.env.DEV);
    if (!onDesktop && !inDev) {
        list.innerHTML = `<div class="dc-pack-empty">Community packs install in the <b>DiscoCast desktop app</b>.
          <br><span class="dc-pack-dim">Get the Mac/Windows app to browse &amp; install preset packs. The <b>From File</b> tab works here.</span></div>`;
        return;
    }

    let manifest, installed;
    try {
        [manifest, installed] = await Promise.all([
            fetch(MANIFEST_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
            listInstalledPacks(),
        ]);
    } catch (e) {
        list.innerHTML = `<div class="dc-pack-empty">Couldn't load the pack list.<br><span class="dc-pack-dim">${_esc(e.message)}</span></div>`;
        return;
    }
    const installedById = new Map(installed.map((p) => [p.id, p]));
    const packs = manifest.packs || [];
    list.innerHTML = '';
    for (const pack of packs) list.appendChild(_packCard(pack, installedById.get(pack.id), engine, foot, installed));
    // Orphans: installed packs no longer in the catalog (e.g. a renamed/removed pack) — show them
    // so they're removable. Without this they'd linger uninstallable in storage.
    const manifestIds = new Set(packs.map((p) => p.id));
    for (const meta of installed) {
        if (!manifestIds.has(meta.id)) list.appendChild(_orphanCard(meta, engine));
    }
    if (!list.children.length) list.innerHTML = `<div class="dc-pack-empty">No packs available yet.</div>`;
    _renderFoot(foot, engine, installed);
}

// Card for an installed pack that's no longer in the manifest — Remove only.
function _orphanCard(meta, engine) {
    const card = document.createElement('div');
    card.className = 'dc-pack-row';
    card.innerHTML = `
      <div class="dc-pack-ic">📦</div>
      <div class="dc-pack-info">
        <div class="dc-pack-name">${_esc(meta.name || meta.id)}</div>
        <div class="dc-pack-meta">${meta.presetCount || '?'} presets · installed</div>
        <div class="dc-pack-desc dc-pack-dim">No longer in the catalog</div>
      </div>
      <div class="dc-pack-act"><div class="dc-pack-badge">✓ Installed</div></div>`;
    const rm = document.createElement('button');
    rm.className = 'dc-pack-btn';
    rm.textContent = 'Remove';
    rm.addEventListener('click', async () => { rm.disabled = true; await uninstallPack(meta.id, { engine }); _renderPacks(engine); });
    card.querySelector('.dc-pack-act').appendChild(rm);
    return card;
}

function _packCard(pack, installedMeta, engine, foot) {
    const card = document.createElement('div');
    card.className = 'dc-pack-row';
    const sizeStr = pack.sizeEstimateMB ? (pack.sizeEstimateMB < 1 ? `${Math.round(pack.sizeEstimateMB * 1024)} KB` : `${pack.sizeEstimateMB} MB`) : '';
    const credit = pack.sourceUrl
        ? `<div class="dc-pack-src">Source: <a class="dc-pack-link" href="${_esc(pack.sourceUrl)}" target="_blank" rel="noopener">${_esc(pack.author || 'source')}</a>${pack.license ? ' · ' + _esc(pack.license) : ''}</div>`
        : (pack.author ? `<div class="dc-pack-src">Source: ${_esc(pack.author)}${pack.license ? ' · ' + _esc(pack.license) : ''}</div>` : '');
    card.innerHTML = `
      <div class="dc-pack-ic">${pack.icon || '📦'}</div>
      <div class="dc-pack-info">
        <div class="dc-pack-name">${_esc(pack.name)}</div>
        <div class="dc-pack-meta">${pack.presetCount} presets${sizeStr ? ' · ' + sizeStr : ''}</div>
        <div class="dc-pack-desc">${_esc(pack.description || '')}</div>
        ${credit}
      </div>
      <div class="dc-pack-act"></div>`;
    // External link → open in the system browser on desktop (Tauri), normal link on web.
    const link = card.querySelector('.dc-pack-link');
    if (link) link.addEventListener('click', (e) => {
        if (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.shell && window.__TAURI__.shell.open) {
            e.preventDefault();
            window.__TAURI__.shell.open(link.href).catch(() => {});
        }
    });
    const act = card.querySelector('.dc-pack-act');
    _setCardState(act, installedMeta ? 'installed' : 'idle', { pack, engine, foot });
    return card;
}

// Per-card state machine + the §2c progress UX.
function _setCardState(act, state, ctx, data = {}) {
    const { pack, engine, foot } = ctx;
    act.innerHTML = '';
    if (state === 'idle' || state === 'error') {
        const btn = document.createElement('button');
        btn.className = 'dc-pack-btn primary';
        btn.textContent = state === 'error' ? 'Retry' : 'Install';
        btn.addEventListener('click', () => _install(act, ctx));
        act.appendChild(btn);
        if (state === 'error') {
            const e = document.createElement('div');
            e.className = 'dc-pack-err';
            e.textContent = data.error || 'Failed';
            act.appendChild(e);
        }
    } else if (state === 'busy') {
        act.innerHTML = `
          <div class="dc-pack-prog"><div class="dc-pack-bar" style="width:${data.pct || 0}%"></div></div>
          <div class="dc-pack-prog-label">${_esc(data.label || '…')}</div>
          <button class="dc-pack-cancel" aria-label="Cancel">✕</button>`;
        act.querySelector('.dc-pack-cancel').addEventListener('click', () => data.onCancel?.());
    } else if (state === 'installed') {
        const brand = pack.brand || pack.name || pack.id;
        act.innerHTML = `<div class="dc-pack-badge">✓ Installed</div>
          <div class="dc-pack-hint">search <b>“${_esc(brand)}”</b> in any preset menu</div>`;
        const rm = document.createElement('button');
        rm.className = 'dc-pack-btn';
        rm.textContent = 'Remove';
        rm.addEventListener('click', () => _uninstall(act, ctx));
        act.appendChild(rm);
    }
}

async function _install(act, ctx) {
    const { pack, engine, foot } = ctx;
    const controller = new AbortController();
    let cancelled = false;
    const onCancel = () => { cancelled = true; controller.abort(); };
    const fmtMB = (b) => (b / 1024 / 1024).toFixed(1);

    const onProgress = ({ phase, current, total }) => {
        let pct = total ? Math.round((current / total) * 100) : 0;
        let label = '…';
        if (phase === 'download') label = total ? `Downloading ${fmtMB(current)} / ${fmtMB(total)} MB` : 'Downloading…';
        else if (phase === 'unzip') { label = 'Unzipping…'; pct = 0; }
        else if (phase === 'extract') label = `Reading ${current} / ${total}`;
        else if (phase === 'install') label = `Installing ${current} / ${total}`;
        else if (phase === 'done') { label = 'Done'; pct = 100; }
        _setCardState(act, 'busy', ctx, { pct, label, onCancel });
    };

    _setCardState(act, 'busy', ctx, { pct: 0, label: 'Starting…', onCancel });
    try {
        const { installed, failed } = await installPackFromZip(pack, { engine, onProgress, signal: controller.signal });
        _setCardState(act, 'installed', ctx);
        _refreshFoot(foot, engine);
        if (failed && failed.length) {
            const note = document.createElement('div');
            note.className = 'dc-pack-warn';
            note.textContent = `${installed} installed · ${failed.length} skipped`;
            act.appendChild(note);
        }
    } catch (e) {
        if (cancelled) { _setCardState(act, 'idle', ctx); await uninstallPack(pack.id, { engine }).catch(() => {}); }
        else _setCardState(act, 'error', ctx, { error: e.message });
    }
}

async function _uninstall(act, ctx) {
    const { pack, engine, foot } = ctx;
    _setCardState(act, 'busy', ctx, { pct: 0, label: 'Removing…' });
    try {
        await uninstallPack(pack.id, { engine });
        _setCardState(act, 'idle', ctx);
        _refreshFoot(foot, engine);
    } catch (e) {
        _setCardState(act, 'installed', ctx);
    }
}

async function _renderFoot(foot, engine) {
    const installed = await listInstalledPacks();
    const community = installed.reduce((n, p) => n + (p.presetCount || 0), 0);
    const bundled = engine ? engine.getPresetNames().filter((n) => !n.startsWith('custom:') && !n.startsWith('community:')).length : 0;
    foot.textContent = `Installed: ${bundled} bundled${community ? ` + ${community} community` : ''}`;
}
function _refreshFoot(foot, engine) { _renderFoot(foot, engine); }

// ---------------------------------------------------------------------------
function _esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
    .dc-pack-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;
      background:rgba(6,8,14,.66);backdrop-filter:blur(6px);animation:dcpf .15s ease}
    @keyframes dcpf{from{opacity:0}to{opacity:1}}
    .dc-pack-card{width:min(620px,92vw);max-height:84vh;display:flex;flex-direction:column;
      background:#14161c;border:1px solid rgba(255,255,255,.10);border-radius:14px;
      box-shadow:0 24px 70px rgba(0,0,0,.55);color:#e8e9ee;font:14px/1.45 system-ui,sans-serif;overflow:hidden}
    .dc-pack-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;
      border-bottom:1px solid rgba(255,255,255,.08)}
    .dc-pack-tabs{display:flex;gap:6px}
    .dc-pack-tab{background:transparent;border:1px solid transparent;color:#9aa0ad;padding:7px 13px;border-radius:9px;
      cursor:pointer;font-weight:600;font-size:13px}
    .dc-pack-tab.on{background:rgba(255,255,255,.07);color:#fff;border-color:rgba(255,255,255,.12)}
    /* No focus ring on mouse-click; keyboard nav still gets one via :focus-visible */
    .dc-pack-tab:focus:not(:focus-visible),.dc-pack-x:focus:not(:focus-visible),.dc-pack-btn:focus:not(:focus-visible){outline:none}
    .dc-pack-x{background:transparent;border:0;color:#9aa0ad;font-size:16px;cursor:pointer;padding:6px 8px;border-radius:8px}
    .dc-pack-x:hover{background:rgba(255,255,255,.07);color:#fff}
    .dc-pack-body{overflow:auto;padding:14px}
    .dc-pack-list{display:flex;flex-direction:column;gap:10px}
    .dc-pack-loading,.dc-pack-empty{color:#8a8f9b;text-align:center;padding:34px 10px}
    .dc-pack-row{display:flex;gap:12px;align-items:center;padding:12px;border:1px solid rgba(255,255,255,.08);
      border-radius:11px;background:rgba(255,255,255,.02)}
    .dc-pack-ic{font-size:24px;width:34px;text-align:center;flex:none}
    .dc-pack-info{flex:1;min-width:0}
    .dc-pack-name{font-weight:700}
    .dc-pack-meta{color:#9aa0ad;font-size:12px;margin:2px 0}
    .dc-pack-desc{color:#b9bdc7;font-size:12.5px}
    .dc-pack-src{font-size:11px;color:#6b7080;margin-top:3px}
    .dc-pack-link{color:#7aa0ff;text-decoration:none}
    .dc-pack-link:hover{text-decoration:underline}
    .dc-pack-dim{color:#6b7080}
    .dc-pack-act{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:5px;min-width:128px}
    .dc-pack-btn{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#e8e9ee;
      padding:7px 15px;border-radius:9px;cursor:pointer;font-weight:600;font-size:13px}
    .dc-pack-btn:hover{background:rgba(255,255,255,.12)}
    .dc-pack-btn.primary{background:#3a6df0;border-color:#3a6df0;color:#fff}
    .dc-pack-btn.primary:hover{background:#5380ff}
    .dc-pack-badge{color:#46d39a;font-weight:700;font-size:13px}
    .dc-pack-hint{font-size:11px;color:#9aa0ad;text-align:right;max-width:150px}
    .dc-pack-hint b{color:#cfd3db}
    .dc-pack-prog{width:128px;height:7px;border-radius:5px;background:rgba(255,255,255,.10);overflow:hidden}
    .dc-pack-bar{height:100%;background:#3a6df0;transition:width .15s ease}
    .dc-pack-prog-label{font-size:11px;color:#9aa0ad}
    .dc-pack-cancel{background:transparent;border:0;color:#9aa0ad;cursor:pointer;font-size:12px;padding:2px 6px;border-radius:6px}
    .dc-pack-cancel:hover{background:rgba(255,255,255,.08);color:#fff}
    .dc-pack-err,.dc-pack-warn{font-size:11px;color:#f1a33a}
    .dc-pack-foot{margin-top:14px;color:#8a8f9b;font-size:12px;text-align:center}
    .dc-pack-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
      padding:42px 18px;border:1.5px dashed rgba(255,255,255,.18);border-radius:12px;cursor:pointer;text-align:center}
    .dc-pack-drop.drag{border-color:#3a6df0;background:rgba(58,109,240,.08)}
    .dc-pack-drop-icon{font-size:30px}
    .dc-pack-drop-title{font-weight:600}
    .dc-pack-drop-sub{color:#9aa0ad;font-size:12.5px}
    @media (prefers-reduced-motion:reduce){.dc-pack-backdrop{animation:none}.dc-pack-bar{transition:none}}`;
    document.head.appendChild(s);
}
