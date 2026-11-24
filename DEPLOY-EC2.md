# Deploying to AWS EC2

A single small instance comfortably serves 170 employees. This guide uses **Ubuntu 24.04**, **nginx**,
**Let's Encrypt** and **systemd**. Replace `santa.techsarasolutions.com` with your real domain.

## 1. Launch the instance

- AMI: Ubuntu Server 24.04 LTS · Type: `t3.small` (t3.micro also works) · Storage: 20 GB gp3
- Security group inbound: **22** (SSH – your office IP only), **80** and **443** (HTTP/HTTPS)
- Allocate an **Elastic IP** and attach it, then create a DNS `A` record
  `santa.techsarasolutions.com → <Elastic IP>`.

## 2. Install Node.js 24, nginx and tools

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs nginx sqlite3 git
node -v   # v24.x
```

## 3. Copy the app

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin santa
sudo mkdir -p /opt/techsara-santa /var/lib/techsara-santa
# Either git clone your repository into /opt/techsara-santa, or copy it from your laptop:
#   scp -r server.js package.json package-lock.json src public scripts deploy ubuntu@<ip>:/tmp/santa/
#   sudo cp -r /tmp/santa/* /opt/techsara-santa/
cd /opt/techsara-santa
sudo npm ci --omit=dev
sudo chown -R santa:santa /opt/techsara-santa /var/lib/techsara-santa
```

Do **not** copy your local `data/` folder – production starts with a clean database
(unless you deliberately want to migrate it, in which case copy `data/` and its `secret.key` together).

## 4. Configure `.env`

```bash
sudo -u santa cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → DATA_KEY
sudo -u santa nano .env
```

```ini
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
TZ=Asia/Kolkata
TRUST_PROXY=1
COOKIE_SECURE=true
DATA_DIR=/var/lib/techsara-santa
DATA_KEY=<the 64-character hex key you generated>
ADMIN_EMAIL=hr@techsarasolutions.com
ADMIN_NAME=HR Admin
ADMIN_PASSWORD=<a strong temporary password>
```

```bash
sudo chmod 600 /opt/techsara-santa/.env
```

**Store `DATA_KEY` in your password manager.** Without it, wishes and assignments can't be decrypted.

## 5. Run it as a service

```bash
sudo cp deploy/techsara-santa.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now techsara-santa
sudo systemctl status techsara-santa
journalctl -u techsara-santa -f        # live logs
```

## 6. nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/techsara-santa
sudo sed -i 's/santa.techsarasolutions.com/YOUR.DOMAIN/' /etc/nginx/sites-available/techsara-santa
sudo ln -s /etc/nginx/sites-available/techsara-santa /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR.DOMAIN --redirect -m it@techsarasolutions.com --agree-tos
```

Open `https://YOUR.DOMAIN/admin`, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` and change the password.

## 7. First-time setup in the admin panel

1. **Email & Templates** → enter SMTP details, set *Public site URL* to `https://YOUR.DOMAIN`,
   turn on *Send email notifications*, send a test email.
   - Microsoft 365: `smtp.office365.com`, port 587, SSL off, mailbox user + password/app password.
   - Google Workspace: `smtp.gmail.com`, port 587, app password.
   - Amazon SES: `email-smtp.<region>.amazonaws.com`, port 587, SES SMTP credentials (verify the domain).
2. **Access & Login** → confirm the allowed email domain(s).
3. **Import & Photos** → upload the employee CSV/Excel, then photos named by Employee ID.
4. **Branding / Dates & Budget / Steps & Rules / Theme** → customize.
5. **Registrations & Reminders** → open registrations and announce the link.

## 8. Backups

```bash
sudo chmod +x /opt/techsara-santa/deploy/backup.sh
sudo crontab -e
# add:
15 2 * * * DATA_DIR=/var/lib/techsara-santa /opt/techsara-santa/deploy/backup.sh
```

Optionally sync `/var/backups/techsara-santa` to S3 (`aws s3 sync`) – see the comment in the script.
Also consider an EBS snapshot schedule (AWS Backup / Data Lifecycle Manager).

## Updating the app

```bash
cd /opt/techsara-santa
sudo -u santa git pull            # or copy the new files over
sudo npm ci --omit=dev
sudo systemctl restart techsara-santa
```

The database schema is created/updated automatically on start.

## Troubleshooting

| Symptom | Check |
|---|---|
| 502 Bad Gateway | `systemctl status techsara-santa`, `journalctl -u techsara-santa -n 100` |
| Sign-in works but you get logged out immediately | `COOKIE_SECURE=true` requires HTTPS – finish step 6 |
| All users hit "Too many attempts" | `TRUST_PROXY=1` must be set behind nginx so real client IPs are used |
| Dates/times look shifted | `TZ=Asia/Kolkata` in `.env`, then restart |
| OTP / reminder emails not arriving | Admin → Notification Log shows delivery status; send a test email |
