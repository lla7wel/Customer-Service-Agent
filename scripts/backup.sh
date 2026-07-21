#!/usr/bin/env bash
# =============================================================================
# Backup PostgreSQL + media before any migration or risky operation.
#
#   ./scripts/backup.sh                 # db + media into ./backups/<timestamp>/
#   ./scripts/backup.sh --db-only
#   ./scripts/backup.sh --media-only
#
# Reads DATABASE_URL and MEDIA_ROOT from the environment or repo-root .env.
# In Docker production, run it on the host with DATABASE_URL pointing at the
# published Postgres port (or `docker compose exec postgres pg_dump ...`).
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a; # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"; set +a
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR:-$ROOT_DIR/backups}/$STAMP"
mkdir -p "$DEST"

DB_ONLY=false; MEDIA_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --db-only) DB_ONLY=true ;;
    --media-only) MEDIA_ONLY=true ;;
  esac
done

if [[ "$MEDIA_ONLY" != true ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set — cannot back up the database." >&2; exit 1
  fi
  echo "Backing up database → $DEST/db.dump"
  pg_dump --format=custom --no-owner --file="$DEST/db.dump" "$DATABASE_URL"
  echo "Database backup complete ($(du -h "$DEST/db.dump" | cut -f1))."
fi

if [[ "$DB_ONLY" != true ]]; then
  MEDIA_SRC="${MEDIA_ROOT:-}"
  if [[ -n "$MEDIA_SRC" && -d "$MEDIA_SRC" ]]; then
    echo "Backing up media ($MEDIA_SRC) → $DEST/media.tar.gz"
    tar -czf "$DEST/media.tar.gz" -C "$MEDIA_SRC" .
    echo "Media backup complete ($(du -h "$DEST/media.tar.gz" | cut -f1))."
  else
    echo "MEDIA_ROOT is not set or does not exist — skipping media backup." >&2
  fi
fi

echo "Backup finished: $DEST"
