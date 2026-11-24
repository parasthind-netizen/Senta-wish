#!/usr/bin/env bash
# Pull the requested ref (default origin/main), install deps, restart, health-check.
# Rolls back to the previous commit if the new one doesn't come up.
#   sudo santa-deploy [git-sha]
set -euo pipefail
APP_DIR=/opt/techsara-santa
REF="${1:-origin/main}"
cd "$APP_DIR"

as_santa() { runuser -u santa -- "$@"; }

PREV=$(git rev-parse HEAD)
as_santa git fetch -q origin
as_santa git reset -q --hard "$REF"
NEW=$(git rev-parse HEAD)
echo "deploying $PREV -> $NEW"

install_and_restart() {
  as_santa env HOME=/home/santa npm ci --omit=dev --no-audit --no-fund --loglevel=error
  [ -f deploy/ec2/deploy.sh ] && install -m 755 deploy/ec2/deploy.sh /usr/local/bin/santa-deploy
  systemctl daemon-reload
  systemctl enable -q techsara-santa
  systemctl restart techsara-santa
}

healthy() {
  for _ in $(seq 1 20); do
    curl -fsS -o /dev/null http://127.0.0.1:3000/api/public/config && return 0
    sleep 1
  done
  return 1
}

install_and_restart
if healthy; then
  echo "OK: $NEW is live"
else
  echo "FAILED: rolling back to $PREV"; journalctl -u techsara-santa -n 40 --no-pager || true
  as_santa git reset -q --hard "$PREV"
  install_and_restart
  healthy && echo "rolled back to $PREV"
  exit 1
fi
