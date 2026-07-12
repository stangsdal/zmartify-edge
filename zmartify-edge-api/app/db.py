from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_DB_PATH = "/data/hvac-edge.sqlite"


def get_db_path() -> Path:
    raw = os.getenv("ZMART_EDGE_DB_PATH", DEFAULT_DB_PATH)
    return Path(raw)


def get_database_url() -> str:
    raw = (os.getenv("DATABASE_URL") or "").strip()
    if raw:
        return raw
    # Backward-compatible default while sqlite remains active runtime.
    return f"sqlite:///{get_db_path()}"


def get_database_backend() -> str:
    parsed = urlparse(get_database_url())
    scheme = (parsed.scheme or "sqlite").lower()
    if scheme.startswith("postgres"):
        return "postgres"
    return "sqlite"


def _ensure_db_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def get_connection(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or get_db_path()
    _ensure_db_parent(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _ensure_schema_migrations(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    conn.commit()


def apply_migrations(conn: sqlite3.Connection, migrations_dir: Path) -> None:
    _ensure_schema_migrations(conn)

    migration_files = sorted(migrations_dir.glob("*.sql"))
    for migration in migration_files:
        already_applied = conn.execute(
            "SELECT 1 FROM schema_migrations WHERE filename = ? LIMIT 1", (migration.name,)
        ).fetchone()
        if already_applied:
            continue

        sql_text = migration.read_text(encoding="utf-8")
        with conn:
            conn.executescript(sql_text)
            conn.execute(
                "INSERT INTO schema_migrations(filename) VALUES (?)",
                (migration.name,),
            )


def initialize_database() -> None:
    base_dir = Path(__file__).resolve().parent.parent
    migrations_dir = base_dir / "migrations"

    with get_connection() as conn:
        apply_migrations(conn, migrations_dir)
