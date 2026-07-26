#!/usr/bin/env bash
set -euo pipefail

# Zmartify Edge database backup and restore-drill helper (Phase 9 hardening).
#
# Usage:
#   ./scripts/backup_edge_db.sh backup [--backend auto|postgres|sqlite] [--db PATH] [--url URL] [--out DIR] [--keep N]
#   ./scripts/backup_edge_db.sh restore-drill [--backend auto|postgres|sqlite] [--db PATH] [--url URL] [--out DIR]
#
# backup:        snapshot the runtime DB, verify the produced artifact,
#                and prune old snapshots beyond retention count.
# restore-drill: verify the newest snapshot is readable. For PostgreSQL this
#                checks the custom dump catalog without writing to the live DB.

MODE="${1:-backup}"
shift || true

DB_PATH="${ZMART_EDGE_DB_PATH:-/data/hvac-edge.sqlite}"
DATABASE_URL="${DATABASE_URL:-}"
BACKEND="auto"
OUT_DIR="backups"
KEEP=14

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend) BACKEND="$2"; shift 2 ;;
    --db) DB_PATH="$2"; shift 2 ;;
    --url) DATABASE_URL="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT_DIR"

resolve_backend() {
  if [[ "$BACKEND" != "auto" ]]; then
    echo "$BACKEND"
    return
  fi
  if [[ -n "$DATABASE_URL" && "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
    echo "postgres"
    return
  fi
  echo "sqlite"
}

verify_postgres_dump() {
  local target="$1"
  if ! command -v pg_restore >/dev/null 2>&1; then
    echo "pg_restore binary is required" >&2
    exit 1
  fi
  if ! pg_restore --list "$target" >/tmp/zmartify-pg-restore-list.txt; then
    echo "PostgreSQL dump verification FAILED for $target" >&2
    return 1
  fi
  local tables
  tables="$(grep -c ' TABLE ' /tmp/zmartify-pg-restore-list.txt || true)"
  rm -f /tmp/zmartify-pg-restore-list.txt
  if [[ "$tables" -lt 1 ]]; then
    echo "PostgreSQL dump verification FAILED: no tables found in $target" >&2
    return 1
  fi
  echo "Verified $target (custom dump readable, $tables tables)"
}

verify_sqlite_db() {
  local target="$1"
  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "sqlite3 binary is required" >&2
    exit 1
  fi
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
    RESOLVED_BACKEND="$(resolve_backend)"
    case "$RESOLVED_BACKEND" in
      postgres)
        if [[ -z "$DATABASE_URL" ]]; then
          echo "DATABASE_URL is required for PostgreSQL backups" >&2
          exit 1
        fi
        if ! command -v pg_dump >/dev/null 2>&1; then
          echo "pg_dump binary is required" >&2
          exit 1
        fi
        SNAPSHOT="$OUT_DIR/zmartify-postgres-$STAMP.dump"
        pg_dump --format=custom --no-owner --no-privileges --file "$SNAPSHOT" "$DATABASE_URL"
        verify_postgres_dump "$SNAPSHOT"
        ls -1t "$OUT_DIR"/zmartify-postgres-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
          rm -f "$old"
          echo "Pruned old snapshot $old"
        done
        ;;
      sqlite)
        if [[ ! -f "$DB_PATH" ]]; then
          echo "Database not found at $DB_PATH" >&2
          exit 1
        fi
        SNAPSHOT="$OUT_DIR/hvac-edge-$STAMP.sqlite"
        sqlite3 "$DB_PATH" ".backup '$SNAPSHOT'"
        verify_sqlite_db "$SNAPSHOT"
        ls -1t "$OUT_DIR"/hvac-edge-*.sqlite 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
          rm -f "$old"
          echo "Pruned old snapshot $old"
        done
        ;;
      *)
        echo "Unknown backend: $RESOLVED_BACKEND" >&2
        exit 2
        ;;
    esac

    echo "Backup complete: $SNAPSHOT"
    ;;

  restore-drill)
    RESOLVED_BACKEND="$(resolve_backend)"
    case "$RESOLVED_BACKEND" in
      postgres)
        LATEST="$(ls -1t "$OUT_DIR"/zmartify-postgres-*.dump 2>/dev/null | head -n 1 || true)"
        if [[ -z "$LATEST" ]]; then
          echo "No PostgreSQL snapshots found in $OUT_DIR; run backup first" >&2
          exit 1
        fi
        verify_postgres_dump "$LATEST"
        echo "Restore drill OK from $LATEST"
        ;;
      sqlite)
        LATEST="$(ls -1t "$OUT_DIR"/hvac-edge-*.sqlite 2>/dev/null | head -n 1 || true)"
        if [[ -z "$LATEST" ]]; then
          echo "No SQLite snapshots found in $OUT_DIR; run backup first" >&2
          exit 1
        fi
        DRILL_TARGET="$(mktemp -t hvac-edge-restore-drill).sqlite"
        cp "$LATEST" "$DRILL_TARGET"
        verify_sqlite_db "$DRILL_TARGET"
        DEVICE_COUNT="$(sqlite3 "$DRILL_TARGET" "SELECT COUNT(*) FROM devices;" 2>/dev/null || echo "n/a")"
        echo "Restore drill OK from $LATEST (devices: $DEVICE_COUNT)"
        rm -f "$DRILL_TARGET"
        ;;
      *)
        echo "Unknown backend: $RESOLVED_BACKEND" >&2
        exit 2
        ;;
    esac
    ;;

  *)
    echo "Unknown mode: $MODE (use backup or restore-drill)" >&2
    exit 2
    ;;
esac
