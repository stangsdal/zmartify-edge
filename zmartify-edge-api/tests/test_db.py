from __future__ import annotations

from app import db


class _FakeCursor:
    def __init__(self, connection: "_FakePsycopgConnection"):
        self._connection = connection
        self.rowcount = 1

    def execute(self, sql: str, parameters=()):
        self._connection.commands.append((sql, tuple(parameters) if isinstance(parameters, (list, tuple)) else parameters))
        if sql == "SELECT lastval() AS id" and self._connection.fail_lastval:
            raise db.psycopg.ProgrammingError("lastval unavailable")

    def fetchone(self):
        return {"id": 42}

    def fetchall(self):
        return []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None


class _FakePsycopgConnection:
    def __init__(self, fail_lastval: bool):
        self.fail_lastval = fail_lastval
        self.commands: list[tuple[str, object]] = []

    def cursor(self):
        return _FakeCursor(self)


def test_postgres_execute_releases_savepoint_when_lastval_succeeds(monkeypatch):
    fake_connection = _FakePsycopgConnection(fail_lastval=False)
    monkeypatch.setattr(db.psycopg, "connect", lambda *args, **kwargs: fake_connection)
    monkeypatch.setenv("DATABASE_URL", "postgresql://example/db")

    conn = db.PostgresConnection()
    cursor = conn.execute("INSERT INTO devices(uuid) VALUES (?)", ("dev-1",))

    assert cursor.lastrowid == 42
    assert ("SAVEPOINT copilot_lastval", ()) in fake_connection.commands
    assert ("RELEASE SAVEPOINT copilot_lastval", ()) in fake_connection.commands


def test_postgres_execute_rolls_back_savepoint_when_lastval_fails(monkeypatch):
    fake_connection = _FakePsycopgConnection(fail_lastval=True)
    monkeypatch.setattr(db.psycopg, "connect", lambda *args, **kwargs: fake_connection)
    monkeypatch.setenv("DATABASE_URL", "postgresql://example/db")

    conn = db.PostgresConnection()
    cursor = conn.execute("INSERT INTO device_state(device_id) VALUES (?)", (2,))

    assert cursor.lastrowid is None
    assert ("SAVEPOINT copilot_lastval", ()) in fake_connection.commands
    assert ("ROLLBACK TO SAVEPOINT copilot_lastval", ()) in fake_connection.commands
    assert ("RELEASE SAVEPOINT copilot_lastval", ()) in fake_connection.commands