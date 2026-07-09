#!/bin/sh
# Nightly Postgres backup. The database is the only non-rebuildable state —
# media and the catalog can be regenerated from the scraper data.
#
# Crontab (see deploy/crontab.example):
#   30 2 * * * /srv/eh-platform/deploy/backup.sh >> /var/log/eh-backup.log 2>&1
set -eu

BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
docker compose -f /srv/eh-platform/docker-compose.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-eh}" -d "${POSTGRES_DB:-eh_system}" --no-owner \
  | gzip > "$BACKUP_DIR/eh_system-$STAMP.sql.gz"

# Prune old backups.
find "$BACKUP_DIR" -name 'eh_system-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date -Iseconds) backup written: eh_system-$STAMP.sql.gz"

# Optional offsite copy — uncomment once an rclone remote is configured:
# rclone copy "$BACKUP_DIR/eh_system-$STAMP.sql.gz" remote:eh-backups/
