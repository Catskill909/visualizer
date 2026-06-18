# DiscoCast Admin Console + Preset Sharing

> Single source of truth for the **discocast** app's admin console and the public
> preset-upload/sharing flow. Sibling topic to [`promo-page-split.md`](promo-page-split.md)
> (the split + counting). Lives in the discocast repo, not winamp-screen.

## Status
- **State:** ✅ **BUILT + PUSHED 2026-06-17** to `github.com/Catskill909/discocast` (`main`).
  Full flow tested locally (admin auth, stats, submit, honeypot, bot-block, moderation,
  image/preset serving, reset). **Awaiting Coolify redeploy to go live.**
- **Where:** all in the discocast repo (`server.js`, `promo/admin.html`, `promo/submit.html`).
- **Auth:** reuses the existing **`STATS_KEY`** env var — no new secret to add in Coolify.

## URLs
- **`/admin`** — password-gated console (stats + submissions moderation).
- **`/submit`** — public 5-step preset upload wizard (linked from the promo footer).
- `/stats` now just redirects to `/admin`; `/stats.json?key=` still works for raw JSON.

## Admin console (`promo/admin.html`)
Clean dark UI (Inter + Space Grotesk, matches the promo). Password modal on load → key
held in `sessionStorage`, sent as `x-admin-key` header on every API call.
- **Stats tab:** page views, downloads mac/win/total, "counting since / last update",
  **Reset stats** button (this is how you zero the bot-inflated counter post-deploy).
- **Submissions tab:** filter Pending/Approved/Rejected/All; each card shows a large
  thumbnail (190px), name, description, email, date, status badge; **View / Approve /
  Reject / Delete**; link to download the raw preset. Pending count shows as a badge.
- **Detail modal:** click a thumbnail, name, or **View** → lightbox with a large contained
  image, full description, and approve/reject/delete/download actions (Esc / backdrop closes).
  This is the "larger view" of a submission (there is no separate public view page yet).
- **Preset download** uses the sanitized **preset name** as the filename (not the random id).

## Public upload wizard (`promo/submit.html`)
5 steps, each validated before advancing:
1. Preset `.json` (drag/drop or pick) + name + description
2. Preview image (PNG/JPG/WEBP/GIF, with live preview)
3. Email (stored for contact, not shown publicly)
4. Review
5. Submit → "Submitted for review" success screen

Everything lands as **`pending`** — nothing is public until an admin approves it.

## Server API (`server.js`)
Admin routes gated by `requireAdmin` (`x-admin-key` header or `?key=`):
- `GET /api/stats` · `POST /api/stats/reset`
- `GET /api/submissions` · `GET /api/submissions/:id/image` · `GET /api/submissions/:id/preset`
- `POST /api/submissions/:id/approve|reject` · `DELETE /api/submissions/:id`

Public:
- `POST /api/submit` — `multer` (memory storage) multipart: `preset`, `image`, + fields.

## Bot / spam defences (no captcha, no third party)
1. Multi-step client wizard (bots rarely finish 5 steps).
2. **Honeypot** hidden `website` field → if filled, server returns `ok:true` but stores nothing.
3. **Bot-UA block** on `/api/submit` (same `BOT_UA` regex used for counting) → 403.
4. **Per-IP rate limit** — 5 submissions/hour (in-memory Map).
5. **Size caps** — 6 MB/file hard ceiling (multer).
6. **Validation** — preset must parse as JSON; email must match; image mimetype whitelist.
7. **Moderation queue** — the ultimate wall; nothing public until approved.

## Storage (on the `/data` Coolify volume)
```
/data/submissions/<id>/
  meta.json    # { id, name, description, email, status, createdAt, image, presetBytes }
  preset.json  # the uploaded export
  image.<ext>  # the thumbnail
```
`/data/counts.json` holds the view/download counters (unchanged). Both survive redeploys
because `/data` is the mounted volume.

## Counting accuracy (Phase 1, shipped earlier this session)
Page views count only when the request looks human: a browser-style `Accept: text/html`
**and** a non-bot user-agent. Downloads skip bot UAs too. Kills the inflation from health
checks / crawlers / scanners / link unfurlers. (The pre-fix inflated number is cleared with
the **Reset stats** button in the admin console.)

## Deploy / go-live
1. Coolify auto-redeploys discocast on the new push (Dockerfile build). `multer` is in
   `package.json` so it installs in the image.
2. `STATS_KEY` is already set → it's also the admin password. No new env var.
3. After redeploy: open `/admin`, unlock, hit **Reset stats** for a clean baseline, then
   test `/submit` end-to-end and confirm the submission appears in the Submissions tab.

## Future (not built)
- **Public gallery** of approved presets (browse + one-click import back into the app).
- Outbound email confirmations (needs self-hosted SMTP — deferred).
- Per-day time-series / referrers in the Stats tab (the panel is built to expand).
