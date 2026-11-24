# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

**Techsara Secret Santa 2026** – a full-stack web app for ~170 Techsara Solutions employees:
account activation → join → submit 3 wishes → server-side random draw → animated gift-box reveal of
the one colleague you are gifting. HR runs everything (people, text, images, dates, budget, theme,
emails, draw) from an admin dashboard at `/admin`.

Stack: **Node.js ≥ 22.13 (developed on 24) + Express 5 + built-in `node:sqlite`**, vanilla HTML/CSS/JS
frontend (no build step). Dependencies: `express`, `multer`, `nodemailer`, `bcryptjs`, `xlsx`
(SheetJS 0.20.3 installed from cdn.sheetjs.com – the npm-registry `xlsx` is outdated/vulnerable).

## Commands

```bash
npm install          # install deps
npm start            # run on http://localhost:3000 (loads .env if present)
npm run dev          # same, with auto-restart on file changes
npm test             # draw-engine unit tests + full end-to-end privacy test (spawns a server on a temp DB)
npm run seed-demo    # LOCAL ONLY: 170 demo employees, password Santa@2026 (refuses in production)
npm run create-admin -- --email x@techsarasolutions.com --name "Name" --password "Pass-1234" [--role hr_admin]
```

Reset local data: stop the server and delete the `data/` folder (DB, uploads, encryption key).
A new super admin password is printed in the console on the next start.

## Layout

```
server.js               Express app: security headers, routes, static pages, photo access, errors
src/db.js               SQLite connection + full schema (CREATE IF NOT EXISTS) + tx() helper
src/security.js         AES-256-GCM encrypt/decrypt, HMAC, tokens, OTP codes, bcrypt, password rules
src/settings.js         ALL customizable content/config: DEFAULTS, validation SCHEMA, PUBLIC_KEYS, templates
src/privacy.js          The ONLY module that reads/writes `wishlists` and `assignments` (see invariants)
src/draw.js             Pure draw algorithm (secure shuffle, derangement, location groups, validation) – unit tested
src/auth.js             Cookie sessions (sha256 of token stored), CSRF, role guards, same-origin check
src/mailer.js           Nodemailer SMTP, {{placeholder}} templates, in-app notifications. The logo is embedded
                        inline (cid:), using the small `logo_email` copy the admin page makes at upload time,
                        with the corner branches from public/img/email-branch-*.png. Look (colours, fonts) =
                        `email_*` settings; Gmail/Outlook ignore web fonts, so font stacks end in installed fonts
src/otp.js              Issue/verify 6-digit OTPs (hashed, 10 min, 5 attempts, resend throttle)
src/scheduler.js        Every 5 min: auto deadline reminder + auto-close registration at deadline
src/audit.js            Audit log writer
src/util.js             Rate limiter, image + audio upload with magic-byte validation, helpers
src/routes/public.js    GET /api/public/config (public settings, budget, gallery, music playlist, counts)
src/routes/employee.js  /api/auth/*, /api/me, /api/registration, /api/wishes, /api/assignment, /api/notifications
src/routes/admin.js     /api/admin/* (employees, import, photos, settings, branding, gallery, music, draw,
                        reminders, notifications, audit, admins, emergency override)
public/                 index (landing), rules, login, app (employee dashboard), admin – each page = HTML shell + js/<page>.js
public/js/common.js     Shared SS.* helpers: api(), esc(), theme, snow, lights, confetti, countdown, modal, toast
scripts/                create-admin.js, seed-demo.js
test/                   draw.test.js (algorithm), mailer.test.js (email logo), e2e.test.js (whole journey + privacy assertions)
deploy/                 systemd unit, nginx site, backup script (see DEPLOY-EC2.md)
data/                   (gitignored) santa.db, secret.key, uploads/public, uploads/photos
```

## Privacy invariants – do not break these

1. **Only `src/privacy.js` touches `wishlists` and `assignments`.** Routes call its functions; never
   query those tables elsewhere (admin routes may JOIN `assignments` only for `giver_id`/`revealed_at`
   status, never `receiver_enc`).
2. An employee may read: their own wishes; and **only after the draw is finalized AND released**, the
   wishes/name/department/photo of their single assigned recipient. No API may reveal who someone's
   own Secret Santa is.
3. Admins never receive wish content or giver→receiver pairs, **except** via the super-admin emergency
   override (`overrides` table, 15-minute window, password + reason, every view audited).
4. Wish payloads and `receiver_enc` are AES-256-GCM encrypted with a key from `DATA_KEY` or
   `data/secret.key`. `receiver_tag` is an HMAC so SQLite can enforce one Santa per recipient.
5. Notifications, email templates and audit-log `details` must **never** include wishes or assignments.
6. Employee photos are served via `/media/photos/:file` with an access check (self, unwrapped Santa,
   or admin). Branding/gallery images and background music in `/uploads/` are public.
7. Enforce rules server-side. Hiding something in the UI is not access control.

`test/e2e.test.js` asserts most of these – run `npm test` after touching auth, privacy, routes or draw.

## Conventions

- **CSP is `script-src 'self'`** – no inline `<script>` or `onclick=` attributes. Put JS in
  `public/js/*.js` and bind with `addEventListener`. Inline `style=` attributes are allowed.
- Frontend renders with template strings – **always wrap dynamic values in `SS.esc()`** (or
  `SS.nl2br()`); only link out via `SS.safeUrl()` + `rel="noopener noreferrer nofollow"`.
- Mutating API calls need the `X-CSRF-Token` header – `SS.api()` adds it automatically
  (employee token from `/api/session`, admin token from `/api/admin/me` / login).
- Adding a customizable setting = add it to `DEFAULTS` **and** `SCHEMA` in `src/settings.js`, add it
  to `PUBLIC_KEYS` if pages need it, then expose a field in the relevant admin view in
  `public/js/admin.js` (field definitions like `BRANDING_FIELDS` are rendered by `settingsPanel()`).
- Admin views are functions in the `VIEWS` object in `public/js/admin.js`, routed by `#/<name>`.
- Theme colours are CSS custom properties (`--midnight`, `--red`, `--green`, `--gold`) set at runtime
  from settings by `SS.applyTheme()`; derive shades with `color-mix()` rather than hard-coding.
- Use `httpError(status, message)` for user-facing errors; messages under 500 are shown to the user.
- Times are stored as ISO strings (`nowIso()`); admin-entered dates are `YYYY-MM-DDTHH:mm` local time,
  so the server needs `TZ` set (e.g. `TZ=Asia/Kolkata` in `.env`).
- Run as a **single process** – the rate limiter and scheduler are in-memory (no cluster mode).

## Environment (.env)

See `.env.example`. Key variables: `PORT`, `HOST`, `TZ`, `DATA_DIR`, `DATA_KEY`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, and in production `NODE_ENV=production`, `TRUST_PROXY=1`, `COOKIE_SECURE=true`.
SMTP is configured from the admin panel (Email & Templates), not env. In development, OTP codes are
printed to the server console when email is not configured.

## Deployment

**Can run on the company LAN from a Windows PC** (port 80, `NODE_ENV=production`, `DATA_KEY` in
`.env`) via the scheduled task “Techsara Secret Santa” → `deploy/windows/run-santa.ps1` (restart loop,
logs to `logs/server.log`). To apply code changes: `deploy\windows\stop-santa.ps1` then
`Start-ScheduledTask -TaskName 'Techsara Secret Santa'`. On a PC where it's live, don't run `npm start`
alongside it (port clash) and don't delete `data/` – it holds real data. Details: `DEPLOY-LAN-WINDOWS.md`.
Machine-specific details (the live address etc.) belong in the gitignored `CLAUDE.local.md`, not here –
this repo is public.

Alternative/future: AWS EC2 behind nginx + Let's Encrypt with systemd – `DEPLOY-EC2.md`.
Back up `DATA_DIR` **and** the encryption key together.
