#!/usr/bin/env bash
# =============================================================================
# Restore a backup created by scripts/backup.sh.
#
#   ./scripts/restore.sh backups/20260721-120000            # db + media
#   ./scripts/restore.sh backups/20260721-120000 --db-only
#   ./scripts/restore.sh backups/20260721-120000 --media-only
#
# SAFETY: pg_restore uses --clean --if-exists against DATABASE_URL. This
# REPLACES current data. It refuses to run without --yes.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a; # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"; set +a
fi

SRC="${1:-}"
if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "Usage: ./scripts/restore.sh <backup-dir> [--db-only|--media-only] --yes" >&2; exit 1
fi

DB_ONLY=false; MEDIA_ONLY=false; CONFIRMED=false
for arg in "${@:2}"; do
  case "$arg" in
    --db-only) DB_ONLY=true ;;
    --media-only) MEDIA_ONLY=true ;;
    --yes) CONFIRMED=true ;;
  esac
done

if [[ "$CONFIRMED" != true ]]; then
  echo "This restore REPLACES current database/media content. Re-run with --yes to confirm." >&2
  exit 1
fi

if [[ "$MEDIA_ONLY" != true && -f "$SRC/db.dump" ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is not set — cannot restore the database." >&2; exit 1
  fi
  echo "Restoring database from $SRC/db.dump ..."
  pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$SRC/db.dump"
  echo "Database restore complete."
fi

if [[ "$DB_ONLY" != true && -f "$SRC/media.tar.gz" ]]; then
  MEDIA_DEST="${MEDIA_ROOT:-}"
  if [[ -z "$MEDIA_DEST" ]]; then
    echo "MEDIA_ROOT is not set — cannot restore media." >&2; exit 1
  fi
  mkdir -p "$MEDIA_DEST"
  echo "Restoring media into $MEDIA_DEST ..."
  tar -xzf "$SRC/media.tar.gz" -C "$MEDIA_DEST"
  echo "Media restore complete."
fi

echo "Restore finished."
