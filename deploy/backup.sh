#!/bin/sh
# Nightly PostgreSQL + append-only media backup. Both are production records:
# source product images and generated Content Studio revisions must never be
# treated as disposable or reconstructed from an external scraper.
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

APP_CONTAINER="$(docker compose -f /srv/eh-platform/docker-compose.yml ps -q app)"
MEDIA_SRC="$(docker inspect "$APP_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/srv/eh-media"}}{{.Source}}{{end}}{{end}}')"
LATEST_MEDIA="$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'eh-media-*.tar.gz' -o -name 'eh-media-incremental-*.tar.gz' \) -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)"

if [ -z "$LATEST_MEDIA" ]; then
  tar -czf "$BACKUP_DIR/eh-media-$STAMP.tar.gz" -C "$MEDIA_SRC" .
  MEDIA_RESULT="eh-media-$STAMP.tar.gz (full)"
else
  NEW_MEDIA_COUNT="$(find "$MEDIA_SRC" -type f -newer "$LATEST_MEDIA" -print | wc -l | tr -d ' ')"
  if [ "$NEW_MEDIA_COUNT" -gt 0 ]; then
    (
      cd "$MEDIA_SRC"
      find . -type f -newer "$LATEST_MEDIA" -print0 \
        | tar --null -czf "$BACKUP_DIR/eh-media-incremental-$STAMP.tar.gz" --files-from -
    )
    MEDIA_RESULT="eh-media-incremental-$STAMP.tar.gz ($NEW_MEDIA_COUNT new files)"
  else
    MEDIA_RESULT="no media changes since $(basename "$LATEST_MEDIA")"
  fi
fi

# Prune old backups.
find "$BACKUP_DIR" -name 'eh_system-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date -Iseconds) database backup written: eh_system-$STAMP.sql.gz; media: $MEDIA_RESULT"

# Media is append-only and restored as the newest full archive followed by all
# later incrementals. Do not prune that chain automatically; move complete
# chains offsite or create a new verified full baseline before removing one.

# Optional offsite copy — uncomment once an rclone remote is configured:
# rclone copy "$BACKUP_DIR" remote:eh-backups/ --include "*-$STAMP.*"
