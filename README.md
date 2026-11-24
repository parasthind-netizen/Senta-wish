# 🎄 Techsara Secret Santa 2026 🎁

> *“Spread joy. Keep the secret. Make someone’s Christmas magical.”*

A festive, secure Secret Santa portal for Techsara Solutions: employees activate an account, join,
share 3 wishes and – after HR runs the draw – unwrap an animated gift box to discover who they are
gifting. HR controls everything from an admin dashboard.

## Run it locally

Requirements: **Node.js 22.13+** (24 recommended).

```bash
npm install
copy .env.example .env      # Windows  (macOS/Linux: cp .env.example .env)
npm start
```

- Employee site: http://localhost:3000
- HR admin: http://localhost:3000/admin – on first start the console prints the super-admin email and a
  temporary password (you'll be asked to change it).

Optional – try it with 170 demo employees (all use the password `Santa@2026`, e.g. sign in as `TS1001`):

```bash
npm run seed-demo
```

To start completely fresh, stop the server and delete the `data/` folder.

> Without email configured, one-time codes (account activation / OTP sign-in / password reset) are printed
> in the server console. Configure SMTP in **Admin → Email & Templates** to email them for real.

## Features

**Employees** – sign-up with official email + password (optional Employee ID and emailed code checks), password or OTP sign-in,
forgot password, join with rules agreement, 3-wish form (name, description, link, price), edit until the
draw, in-app notifications, optional profile photo, and a suspenseful gift-box reveal with confetti showing
the recipient's name, team, wishes, links and budget.

**HR admin** – dashboard with participation stats; employee directory (add/edit/deactivate/delete, bulk
actions, per-employee photo upload); CSV/Excel import with preview; bulk photo upload by file name;
registration open/close; reminders to targeted groups; CSV export; draw engine (random or single chain,
avoid mutual pairs, require complete wishes, sealed release for a live reveal moment, guarded reset);
**full customization** of every text, logo, hero image, photo gallery, dates, budget, steps, rules,
messages, colours (with presets), snow and lights, email templates, SMTP, allowed email domains and
login method; HR admin accounts with roles; audit log; and a logged emergency override.

## Privacy & security

- Employees can see only their own wishes and – after the draw is released – their one recipient's.
  Nobody can find out who their own Santa is. Admins can't see wishes or assignments (only through a
  15-minute, password-confirmed, fully audited super-admin emergency override).
- Rules are enforced in the API/data layer (`src/privacy.js`), not by hiding things in the page.
- Wish lists and assignments are **encrypted at rest** (AES-256-GCM).
- The draw uses a cryptographically secure shuffle on the server and is verified before saving
  (no self-assignment, everyone gives and receives exactly once). Tested at 170 participants.
- bcrypt passwords, account lockout, rate limits, hashed session tokens in HttpOnly SameSite cookies,
  CSRF tokens, strict Content-Security-Policy, magic-byte image validation, audit log.

## Tests

```bash
npm test
```

Runs the draw-engine tests and an end-to-end test that boots a server on a temporary database and
checks the whole journey plus the privacy rules.

## Going live

- **Company LAN from a Windows PC** (current setup): **[DEPLOY-LAN-WINDOWS.md](DEPLOY-LAN-WINDOWS.md)**
- **AWS EC2** with HTTPS: **[DEPLOY-EC2.md](DEPLOY-EC2.md)**

Project conventions for contributors are in **[CLAUDE.md](CLAUDE.md)**.
