#!/usr/bin/env bash
# One-time setup of an Amazon Linux 2023 (arm64 or x86_64) EC2 host for Techsara Secret Santa,
# published through a Cloudflare Tunnel (no inbound 80/443 needed).
#
#   sudo CF_TUNNEL_TOKEN=... bash bootstrap.sh
#
# Safe to re-run: existing .env / data / admin are never overwritten.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-24.11.1}"
APP_DIR=/opt/techsara-santa
DATA_DIR=/var/lib/techsara-santa
REPO_URL="${REPO_URL:-https://github.com/parasthind-netizen/Senta-wish.git}"

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }

echo "== packages"
dnf install -y -q git tar xz sqlite >/dev/null

echo "== swap (1 GB RAM box: npm install needs headroom)"
if ! swapon --show | grep -q /swapfile; then
  dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== node $NODE_VERSION"
ARCH=$(uname -m); case "$ARCH" in aarch64) NARCH=arm64;; x86_64) NARCH=x64;; esac
if [ "$(node -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NARCH.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1
fi
ln -sf /usr/local/bin/node /usr/bin/node
node -v

echo "== app user + dirs"
id santa >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/santa --shell /sbin/nologin santa
mkdir -p "$DATA_DIR" /var/backups/techsara-santa
chown -R santa:santa "$DATA_DIR" && chmod 700 "$DATA_DIR"
if [ ! -d "$APP_DIR/.git" ]; then git clone -q "$REPO_URL" "$APP_DIR"; fi
chown -R santa:santa "$APP_DIR"
git config --system --add safe.directory "$APP_DIR"

echo "== .env"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
TZ=Asia/Kolkata
TRUST_PROXY=1
COOKIE_SECURE=true
DATA_DIR=$DATA_DIR
DATA_KEY=$(openssl rand -hex 32)
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@techsarasolutions.com}
ADMIN_NAME=HR Admin
EOF
  chown santa:santa "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
  echo "   generated new DATA_KEY -> back up $APP_DIR/.env together with $DATA_DIR"
fi

echo "== systemd unit"
cat > /etc/systemd/system/techsara-santa.service <<EOF
[Unit]
Description=Techsara Secret Santa
After=network.target

[Service]
Type=simple
User=santa
Group=santa
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --env-file=$APP_DIR/.env server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

echo "== deploy helper (used by CI) + sudo rule"
install -m 755 "$(dirname "$0")/deploy.sh" /usr/local/bin/santa-deploy
echo 'ec2-user ALL=(root) NOPASSWD: /usr/local/bin/santa-deploy' > /etc/sudoers.d/santa-deploy
chmod 440 /etc/sudoers.d/santa-deploy

echo "== nightly backup"
cat > /etc/cron.daily/techsara-santa-backup <<EOF
#!/bin/sh
ts=\$(date +%F)
sqlite3 $DATA_DIR/santa.db ".backup /var/backups/techsara-santa/santa-\$ts.db"
tar -czf /var/backups/techsara-santa/uploads-\$ts.tgz -C $DATA_DIR uploads 2>/dev/null || true
cp $APP_DIR/.env /var/backups/techsara-santa/env-\$ts
chmod 600 /var/backups/techsara-santa/*
find /var/backups/techsara-santa -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/techsara-santa-backup
dnf install -y -q cronie >/dev/null && systemctl enable --now crond >/dev/null

echo "== cloudflared"
if ! command -v cloudflared >/dev/null; then
  CARCH=$([ "$NARCH" = arm64 ] && echo aarch64 || echo x86_64)
  dnf install -y -q "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CARCH.rpm" >/dev/null
fi
if [ -n "${CF_TUNNEL_TOKEN:-}" ] && ! systemctl is-enabled cloudflared >/dev/null 2>&1; then
  cloudflared service install "$CF_TUNNEL_TOKEN"
fi

/usr/local/bin/santa-deploy
echo "== done"
