#!/usr/bin/env bash
set -euo pipefail

# Zmartify Edge database backup and restore-drill helper (Phase 9 hardening).
#
# Usage:
#   ./scripts/backup_edge_db.sh backup [--db PATH] [--out DIR] [--keep N]
#   ./scripts/backup_edge_db.sh restore-drill [--db PATH] [--out DIR]
#
# backup:        snapshot the SQLite DB with sqlite3 .backup, verify integrity,
#                and prune old snapshots beyond retention count.
# restore-drill: restore the newest snapshot into a temp file and verify it is
#                a readable, consistent database (no writes to the live DB).

MODE="${1:-backup}"
shift || true

DB_PATH="${ZMART_EDGE_DB_PATH:-/data/hvac-edge.sqlite}"
OUT_DIR="backups"
KEEP=14

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB_PATH="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 binary is required" >&2
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

verify_db() {
  local target="$1"
  local result
  result="$(sqlite3 "$target" "PRAGMA integrity_check;")"
  if [[ "$result" != "ok" ]]; then
    echo "Integrity check FAILED for $target: $result" >&2
    return 1
  fi
  local tables
  tables="$(sqlite3 "$target" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")"
  if [[ "$tables" -lt 1 ]]; then
    echo "Restore verification FAILED: no tables found in $target" >&2
    return 1
  fi
  echo "Verified $target (integrity ok, $tables tables)"
}

case "$MODE" in
  backup)
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    SNAPSHOT="$OUT_DIR/hvac-edge-$STAMP.sqlite"
    sqlite3 "$DB_PATH" ".backup '$SNAPSHOT'"
    verify_db "$SNAPSHOT"

    # Prune snapshots beyond retention count (newest first retained).
    ls -1t "$OUT_DIR"/hvac-edge-*.sqlite 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
      rm -f "$old"
      echo "Pruned old snapshot $old"
    done
    echo "Backup complete: $SNAPSHOT"
    ;;

  restore-drill)
    LATEST="$(ls -1t "$OUT_DIR"/hvac-edge-*.sqlite 2>/dev/null | head -n 1 || true)"
    if [[ -z "$LATEST" ]]; then
      echo "No snapshots found in $OUT_DIR; run backup first" >&2
      exit 1
    fi
    DRILL_TARGET="$(mktemp -t hvac-edge-restore-drill).sqlite"
    cp "$LATEST" "$DRILL_TARGET"
    verify_db "$DRILL_TARGET"
    DEVICE_COUNT="$(sqlite3 "$DRILL_TARGET" "SELECT COUNT(*) FROM devices;" 2>/dev/null || echo "n/a")"
    echo "Restore drill OK from $LATEST (devices: $DEVICE_COUNT)"
    rm -f "$DRILL_TARGET"
    ;;

  *)
    echo "Unknown mode: $MODE (use backup or restore-drill)" >&2
    exit 2
    ;;
esac
