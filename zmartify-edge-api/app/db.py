from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

DEFAULT_DB_PATH = "/data/hvac-edge.sqlite"
_LASTROWID_TABLES = {
    "acl_generation_log",
    "api_tokens",
    "audit_log",
    "auth_login_state",
    "channel_metadata",
    "core_devices_v2",
    "core_domains_v2",
    "core_sites_v2",
    "demand_history",
    "device_health_history",
    "device_state",
    "devices",
    "domains",
    "event_log",
    "irrigation_outputs",
    "irrigation_runs",
    "irrigation_run_steps",
    "irrigation_program_runs",
    "irrigation_program_schedules",
    "irrigation_programs",
    "irrigation_zones",
    "mqtt_clients",
    "mqtt_credentials",
    "notifications",
    "registration_invites",
    "roles",
    "setpoint_history",
    "sites",
    "temperature_history",
    "users",
    "zone_metadata",
}


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


def get_runtime_database_backend() -> str:
    return get_database_backend()


def _ensure_db_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _postgres_connection_url() -> str:
    raw = get_database_url().strip()
    if raw.startswith("postgres://"):
        return raw.replace("postgres://", "postgresql://", 1)
    if raw.startswith("postgresql+psycopg://"):
        return raw.replace("postgresql+psycopg://", "postgresql://", 1)
    return raw


def _translate_sql(sql: str) -> str:
    if re.search(r"FROM\s+sqlite_master", sql, flags=re.IGNORECASE):
        return "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = %s LIMIT 1"

    translated = sql.replace("?", "%s")
    translated = re.sub(
        r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+(.+?)\s+VALUES\s*(.+?)\s*$",
        r"INSERT INTO \1 VALUES \2 ON CONFLICT DO NOTHING",
        translated,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return translated


def _insert_table_name(sql: str) -> str | None:
    match = re.match(r"\s*INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)", sql, flags=re.IGNORECASE)
    return match.group(1).lower() if match else None


class PostgresCursor:
    def __init__(self, cursor: psycopg.Cursor):
        self._cursor = cursor
        self.lastrowid: int | None = None

    @property
    def rowcount(self) -> int:
        return int(self._cursor.rowcount or 0)

    def fetchone(self) -> dict[str, Any] | None:
        return self._cursor.fetchone()

    def fetchall(self) -> list[dict[str, Any]]:
        return list(self._cursor.fetchall())


class PostgresConnection:
    def __init__(self) -> None:
        self._conn = psycopg.connect(_postgres_connection_url(), row_factory=dict_row)

    def execute(self, sql: str, parameters: tuple[Any, ...] | list[Any] = ()) -> PostgresCursor:
        translated = _translate_sql(sql)
        cursor = self._conn.cursor()
        try:
            cursor.execute(translated, parameters)
            wrapped = PostgresCursor(cursor)
            table_name = _insert_table_name(translated)
            if table_name in _LASTROWID_TABLES:
                try:
                    with self._conn.cursor() as id_cursor:
                        id_cursor.execute("SAVEPOINT copilot_lastval")
                        id_cursor.execute("SELECT lastval() AS id")
                        row = id_cursor.fetchone()
                        wrapped.lastrowid = int(row["id"]) if row and row.get("id") is not None else None
                except psycopg.Error:
                    try:
                        with self._conn.cursor() as rollback_cursor:
                            rollback_cursor.execute("ROLLBACK TO SAVEPOINT copilot_lastval")
                            rollback_cursor.execute("RELEASE SAVEPOINT copilot_lastval")
                    except psycopg.Error:
                        pass
                    wrapped.lastrowid = None
                else:
                    try:
                        with self._conn.cursor() as release_cursor:
                            release_cursor.execute("RELEASE SAVEPOINT copilot_lastval")
                    except psycopg.Error:
                        pass
            return wrapped
        except psycopg.IntegrityError as exc:
            raise sqlite3.IntegrityError(str(exc)) from exc

    def executescript(self, sql: str) -> None:
        with self._conn.cursor() as cursor:
            cursor.execute(sql)

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> PostgresConnection:
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        try:
            if exc_type is None:
                self.commit()
            else:
                self.rollback()
        finally:
            self.close()


def get_connection(path: Path | None = None) -> sqlite3.Connection | PostgresConnection:
    if path is None and get_database_backend() == "postgres":
        return PostgresConnection()

    db_path = path or get_db_path()
    _ensure_db_parent(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _ensure_schema_migrations(conn: sqlite3.Connection | PostgresConnection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    conn.commit()


def apply_migrations(conn: sqlite3.Connection | PostgresConnection, migrations_dir: Path) -> None:
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


def initialize_postgres_database() -> None:
    base_dir = Path(__file__).resolve().parent.parent
    schema_path = base_dir / "db" / "postgres_schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with get_connection() as conn:
        conn.executescript(schema_sql)
        for role in ("owner", "admin", "installer", "viewer"):
            conn.execute("INSERT OR IGNORE INTO roles(name) VALUES (?)", (role,))
        conn.execute("INSERT OR IGNORE INTO schema_migrations(filename) VALUES (?)", ("postgres_schema.sql",))


def initialize_database() -> None:
    if get_database_backend() == "postgres":
        initialize_postgres_database()
        return

    base_dir = Path(__file__).resolve().parent.parent
    migrations_dir = base_dir / "migrations"

    with get_connection() as conn:
        apply_migrations(conn, migrations_dir)
