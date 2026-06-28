#!/bin/sh
# Backup SQLite database to remote storage using rclone.
#
# SETUP (one-time):
#   1. Install rclone: https://rclone.org/install/
#   2. Configure a remote: rclone config
#      - Backblaze B2: follow https://rclone.org/b2/
#      - AWS S3:       follow https://rclone.org/s3/
#   3. Set BACKUP_REMOTE env var (e.g. "b2:my-bucket" or "s3:my-bucket/satellites")
#
# RESTORE:
#   rclone copy "${BACKUP_REMOTE}/satellites-backups/satellites_<DATE>.db" /restore/
#   # Then stop the backend and replace the live DB:
#   docker compose stop backend
#   cp /restore/satellites_<DATE>.db /path/to/satellites_data/satellites.db
#   docker compose start backend
#
# CRON EXAMPLE (host cron — run daily at 02:00):
#   0 2 * * * DB_PATH=/var/lib/docker/volumes/satellites_data/_data/satellites.db \
#             BACKUP_REMOTE=b2:my-bucket \
#             /srv/satellites/scripts/backup-sqlite.sh >> /var/log/satellites-backup.log 2>&1

set -e

DB_PATH="${DB_PATH:-/data/satellites.db}"
REMOTE="${BACKUP_REMOTE:?BACKUP_REMOTE env var is required (e.g. b2:my-bucket)}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: database not found at $DB_PATH" >&2
  exit 1
fi

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/satellites_${DATE}.db"

# SQLite online backup (safe under concurrent writes)
sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"

# Upload to remote
rclone copy "$BACKUP_FILE" "${REMOTE}/satellites-backups/"

# Cleanup local temp file
rm -f "$BACKUP_FILE"

# Delete backups older than RETENTION_DAYS
rclone delete "${REMOTE}/satellites-backups/" \
  --min-age "${RETENTION_DAYS}d" \
  --include "satellites_*.db"

echo "[$(date -Iseconds)] Backup OK: satellites_${DATE}.db → ${REMOTE}/satellites-backups/"
