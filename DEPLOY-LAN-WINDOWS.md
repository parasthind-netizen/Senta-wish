# Running on the company network from a Windows PC

The site is served directly by this Windows machine to everyone on the office LAN.
`<PC-IP>` below is the PC's IPv4 address on the office network (`ipconfig` → Ethernet adapter).

| | |
|---|---|
| Employee site | **http://&lt;PC-IP&gt;** |
| HR admin | **http://&lt;PC-IP&gt;/admin** |
| Port | 80 (set in `.env`) |
| Auto-start | Scheduled task **“Techsara Secret Santa”** – starts hidden when you sign in to Windows, restarts the server within 5 s if it ever stops |
| Logs | `logs\server.log` (rotates at 10 MB) |
| Data | `data\` (database + uploaded photos) |
| Encryption key | `DATA_KEY` in `.env` – keep a copy in a password manager |

## Everyday commands (PowerShell, in the project folder)

```powershell
# Stop the site (it starts again at your next Windows sign-in)
powershell -ExecutionPolicy Bypass -File deploy\windows\stop-santa.ps1

# Start it again now
Start-ScheduledTask -TaskName 'Techsara Secret Santa'

# Restart after changing code or .env
powershell -ExecutionPolicy Bypass -File deploy\windows\stop-santa.ps1; Start-ScheduledTask -TaskName 'Techsara Secret Santa'

# Watch the log
Get-Content logs\server.log -Wait -Tail 30

# Remove auto-start completely
powershell -ExecutionPolicy Bypass -File deploy\windows\stop-santa.ps1 -Remove

# Re-install auto-start (e.g. on another PC)
powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
```

## Keep it reachable

- **Stay signed in and plugged in.** The task runs while you're signed in to Windows. Sleep on AC is set
  to *Never*, but **closing the lid still sleeps the laptop** – keep it open, or set
  *Control Panel → Power Options → Choose what closing the lid does → Plugged in: Do nothing*.
- **Fixed IP.** The address usually comes from DHCP and could change. Ask IT to reserve the PC's IP
  for its Ethernet adapter (find the MAC with `getmac /v`). If the IP ever changes, update
  *Admin → Email & Templates → Public site URL* (used in email links) and tell employees the new address.
- **Use the IP, not the PC name**, unless the office DNS can resolve the PC name (a public DNS such as
  8.8.8.8 can't, and VMware/Hyper-V adapters can make the name point to the wrong address).
- **Firewall.** Inbound access may already work through a Windows Firewall rule for
  *“Node.js JavaScript Runtime”* (created when Windows first asked to allow Node.js), but only for the
  network profile it was created on. If colleagues can't connect, an administrator can run:
  ```powershell
  New-NetFirewallRule -DisplayName 'Techsara Secret Santa (HTTP 80)' -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Any
  ```
- **Port** – set `PORT` in `.env`; 80 means employees don't have to type a port. Pick another if 80 is taken.

## Security notes for a LAN deployment

- Traffic is plain **HTTP**: passwords and wishes travel unencrypted across the office network. Fine for
  a trusted office LAN; for HTTPS, put it behind IT's reverse proxy / certificate, or use the EC2 guide
  (`DEPLOY-EC2.md`) with Let's Encrypt.
- Sign-up is **official email + password** – the email must already be in the HR directory and each
  email can be claimed only once. Someone who knows a colleague's email could sign up as them before they
  do; if that happens, use *Admin → Employees → Manage → Reset login*. For stronger checks turn on
  *Admin → Access & Login → Email a 6-digit code at sign-up* (needs SMTP) and/or *Also ask for Employee ID*.
- “Forgot password” and “Email me a one-time code” need SMTP. Until email is set up, HR can help a
  locked-out employee with *Reset login* (they then sign up again; their wishes are kept).

## Backups

Copy these three things somewhere safe (e.g. a OneDrive/SharePoint folder only HR can access), ideally
daily during the event – stop the site first or copy while idle:

- `data\santa.db` (plus `santa.db-wal` / `santa.db-shm` if present)
- `data\uploads\`
- `.env` (contains `DATA_KEY` – without it the database's wishes and assignments are unreadable)
