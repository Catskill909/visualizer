# Promo Page Split + Download/View Counting

> Single source of truth for: isolating the promo page into its own container, and
> adding download + page-view counting. Nothing here is built yet.

## Status
- **State:** PLANNED — not started. Captured 2026-06-16, deferred by user ("don't want to get into it now").
- **Scope:** WEB ONLY — the front-facing promo/download page. NOT the macOS `.dmg`, NOT the
  Windows `.exe`, NOT the Tauri/visualizer app. No telemetry ever goes inside the shipped product.
- **Goal:** (1) De-risk by giving the promo page its own container, separate from the working app
  deploy. (2) Count promo-page views + Download-button clicks/downloads, split by macOS vs Windows.
- **Decision still open:** what the isolated promo container runs (see Options). User leaning: not
  decided — wants this doc first.

## Why this came up
User asked: "can the promo page count downloads / page views?" Constraints surfaced:
- **No Cloudflare, ever.** Rules out Cloudflare Web Analytics.
- **No third-party analytics.** Self-hosted only.
- The current CSP blocks third-party scripts anyway (see below).
- User is **wary of touching the working web install** to add analytics → wants isolation first.

## Current reality (the risk)
The promo page and the real app **share one container today.**
- [`Dockerfile`](Dockerfile) builds the whole Vite app and serves everything from ONE nginx:
  the visualizer at `/` AND the promo page together.
- The `.dmg` is copied explicitly into `/usr/share/nginx/html/promo/` (Dockerfile line 28).
- [`nginx.conf`](nginx.conf) line 16 sets a strict CSP: `script-src 'self'`, `connect-src 'self'`.
  → Any third-party analytics tracker is silently BLOCKED unless its domain is added to the CSP.
- Hosting: nginx in Docker, managed via **Coolify** (self-hosted PaaS with a web dashboard — but
  Coolify only shows deploy/runtime logs, NOT view/download counts; nothing counts these today).

**The risk:** editing this nginx/CSP to add analytics means editing the same container that serves
the working app. Hence the plan to split the promo page out first.

## The plan: isolate the promo page in its own container
Move the promo page (`promo/` + its assets + the `.dmg`/`.exe`) into a standalone container with
its own small server. Worst case if something breaks = promo page only; the real app deploy is
never touched. Once isolated, counting can be added freely.

## Options for what the isolated promo container runs

### Option A — Tiny Node server, counting built in  ⭐ (recommended)
A small Express (or similar) server serves the promo files AND counts views + downloads ITSELF.
- Every page view = a request to `/` → increment a views counter.
- Every download = a request to `/DiscoCast-Visualizer.dmg` (mac) or the `.exe` (windows) →
  increment per-OS download counters. This is the most ACCURATE download number (counts the actual
  file fetch, not just a button click).
- Expose a simple private `/stats` page to read the numbers.
- One container, no extra app, no third party, no CSP changes needed, fully self-hosted.
- Persistence: counters must survive container restarts → write to a file/SQLite on a mounted
  Docker volume (otherwise numbers reset on every redeploy).

### Option B — nginx + separate self-hosted Umami app
Keep nginx serving the page; run **Umami** (self-hosted dashboard app + its own DB) alongside.
- Umami gives a polished web dashboard you log into.
- Coolify has a one-click Umami service template.
- Setup: deploy Umami in Coolify → it generates a **website ID** + a **dashboard domain**
  (e.g. `analytics.yourdomain.com`) → those get wired into the promo page.
- Repo edits then needed: add Umami `<script>` to promo `index.html` head; add `data-umami-event`
  attrs to the 4 Download links (hero + bottom, mac + windows) for click tracking; add the Umami
  domain to `script-src` + `connect-src` in the promo container's CSP (own domain, still self-hosted).
- More moving parts (two services + a database) but the nicest dashboard.
- NOTE: tracks button CLICKS, not completed downloads (people cancel/retry) → less accurate than A
  for true download totals.

### Option C — Just isolate now, decide counting later
Split the promo page into its own plain container to de-risk the app immediately; add counting as a
follow-up once isolated. Lowest commitment first step.

## Recommendation
**Option A (tiny Node server).** It folds the counting INTO the one server the promo page needs
anyway — no separate dashboard app, no CSP wrangling, no third party, accurate server-side download
counts, full control ("then I can do anything I want"). Matches the no-Cloudflare / no-third-party /
self-hosted-everything stance.

## Open questions to resolve when picking this up
1. **Coolify volumes:** how are this container's volumes managed — Coolify UI, or a compose file in
   the repo? (Needed to persist counters/logs across restarts.)
2. **Per-OS breakdown** confirmed wanted (mac vs windows separately) — it's free either way.
3. For Option A: is a private `/stats` page enough, or is a password/login wanted on it?
4. Build wiring: the promo container needs the `.dmg`/`.exe` copied in (today the main Dockerfile
   does this at line 28) — the split must carry that over.

## Reference — relevant files
- [`Dockerfile`](Dockerfile) — current combined build (app + promo in one container).
- [`nginx.conf`](nginx.conf) — strict CSP at line 16 (blocks third-party scripts).
- [`promo/index.html`](promo/index.html) — the page; Download links have ids `hero-download-btn`,
  `download-btn`, plus the two Windows `.exe` links (good hooks for click tracking).
- `promo/` — page assets, `.dmg`, `.exe`, `version.json`.
