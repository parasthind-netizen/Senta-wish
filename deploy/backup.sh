#!/usr/bin/env bash
# Nightly backup of the database, uploads and encryption key.
# crontab -e  →  15 2 * * * /opt/techsara-santa/deploy/backup.sh
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/techsara-santa}"
DEST="${BACKUP_DIR:-/var/backups/techsara-santa}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
# Consistent online copy of the SQLite database (safe while the app is running)
sqlite3 "$DATA_DIR/santa.db" ".backup '$DEST/santa-$STAMP.db'"
tar -czf "$DEST/uploads-$STAMP.tgz" -C "$DATA_DIR" uploads
[ -f "$DATA_DIR/secret.key" ] && cp "$DATA_DIR/secret.key" "$DEST/secret-$STAMP.key"
chmod 600 "$DEST"/*
# Keep 14 days
find "$DEST" -type f -mtime +14 -delete
# Optional: copy off the server, e.g.  aws s3 sync "$DEST" s3://your-bucket/techsara-santa/
