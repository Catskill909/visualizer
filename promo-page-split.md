# Promo Page Split + Download/View Counting

> Single source of truth for: the promo page split into its own repo/container,
> and the self-hosted download + page-view counting that the split enables.

## Status
- **State:** ✅ **SHIPPED (code) 2026-06-17.** Promo page is fully split into its own
  repo + standalone Node server with view + per-OS download counting. Local smoke-test
  passed. **Remaining = Coolify deploy** (stand up the new app at `discocast.supersoul.top`,
  add the `/data` volume, set `STATS_KEY`).
- **Scope:** WEB ONLY — the front-facing promo/download page. No telemetry ever goes inside
  the shipped product (`.dmg` / `.exe` / Tauri app).
- **Goal (met):** (1) De-risked — promo has its own container, separate from the app deploy.
  (2) Counting is now possible because the same server that serves the installer counts the fetch.

## What shipped (architecture)

The promo page is now a **standalone repo + Coolify app**, completely separate from the visualizer:

- **Repo:** https://github.com/Catskill909/discocast — cloned locally as a **sibling** of this
  repo: `~/Desktop/discocast` (the macOS build relies on that sibling path).
- **Domain:** `discocast.supersoul.top` (Coolify A record created 2026-06-17).
- **Server:** `discocast/server.js` — tiny Express app that:
  - serves the promo page + all assets + installers from `discocast/promo/`,
  - **counts page views** (`GET /`) and **per-OS downloads** by intercepting the two installer
    paths *before* static serving — counts the actual file fetch (most accurate), split mac/win,
  - persists counters to `DATA_DIR/counts.json` (atomic write) — `DATA_DIR=/data` on a Coolify volume,
  - exposes private **`/stats`** (HTML) + **`/stats.json`**, gated by `STATS_KEY` query param.
  - Sets its own CSP (allows the page's inline script + Google Fonts) — no nginx involved.
- **Installers live IN the discocast repo** (committed): `DiscoCast-Visualizer.dmg` +
  `DiscoCast Visualizer_0.1.0_x64-setup.exe` (stable names — the Download buttons point at them).

### Counted paths (must stay in sync with promo/index.html Download hrefs)
- macOS: `/DiscoCast-Visualizer.dmg`
- Windows: `/DiscoCast Visualizer_0.1.0_x64-setup.exe` (note the space)
- Page view: `GET /`

## How the installers get into discocast
The installers are still **built in THIS repo** (winamp-screen) and delivered into the sibling
discocast repo:
- **macOS:** `build-and-sign.sh` builds/signs/notarizes as always, then writes the finished
  `.dmg`, `version.json`, and the version-span patch into `../discocast/promo/` (via the new
  `PROMO_REPO` var, default `../discocast`; guard at the top fails fast if the sibling is missing).
  After a build → `cd ../discocast && git add -A && commit && push` (the script prints this reminder).
- **Windows:** `.github/workflows/build-windows.yml` still produces the `.exe` artifact in this
  repo; drop it into `discocast/promo/` (stable name), commit, push. No CI change needed.

## The cut from the main repo (what changed here on 2026-06-17)
- [`vite.config.js`](vite.config.js) — removed the `promo` rollup input. *This alone stops promo
  being bundled into the web `dist/` **and** into the macOS/Windows Tauri app bundles* (Tauri's
  `distDir` is `../dist`). Verified: `npm run build` → `dist/` has main/editor/timeline/output,
  **no promo, no .dmg**.
- [`Dockerfile`](Dockerfile) — removed the line that copied the `.dmg` into nginx. The app
  container now serves only the visualizer.
- [`build-and-sign.sh`](build-and-sign.sh) — added `PROMO_REPO`/`PROMO_DIR` + early guard;
  repointed all 4 promo writes (dated `.dmg`, stable `.dmg`, `version.json`, `index.html` span)
  to the discocast repo; final summary prints the commit/push reminder.
- [`.gitignore`](.gitignore) — removed the `!promo/DiscoCast-Visualizer.dmg` exception.
- Deleted the `promo/` folder from this repo entirely.

## Deploy checklist (the only thing left)
In Coolify, create a NEW application (do **not** touch the existing app deploy):
1. Source = `github.com/Catskill909/discocast`, build pack = **Dockerfile**.
2. Domain `discocast.supersoul.top`, container port **3000**.
3. **Persistent volume mounted at `/data`** — without it, counters reset every redeploy.
4. Env **`STATS_KEY=<secret>`** — `/stats` then requires `?key=<secret>`.
5. After deploy: hit `/` (page loads), `/stats?key=…` (dashboard), do a test download, confirm
   the count ticks. Then point public links / DNS at discocast and you're done.

## Open questions — resolved
1. ~~Coolify volumes~~ → mount a named volume at `/data`, `DATA_DIR=/data` (set in Dockerfile).
2. Per-OS breakdown → ✅ implemented (mac vs windows separately).
3. `/stats` protection → ✅ `STATS_KEY` query-param gate (open if unset — set it in prod).
4. Build wiring → ✅ `build-and-sign.sh` delivers the `.dmg` into the discocast repo.

## Future (lives in the discocast server)
"Visualizer-export JSON files for group sharing" — the discocast Node server is the intended home
for hosting/sharing exported presets/timelines (a real app we control, not static hosting).

## Reference — files
- discocast repo: `server.js`, `Dockerfile`, `promo/` (page + assets + installers), `README.md`.
- this repo: [`vite.config.js`](vite.config.js), [`Dockerfile`](Dockerfile),
  [`build-and-sign.sh`](build-and-sign.sh), [`.gitignore`](.gitignore).
