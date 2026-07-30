from __future__ import annotations

from app import domain_model


class _FakeCursor:
    def __init__(self, sql_log: list[str]):
        self._sql_log = sql_log

    def execute(self, sql: str, parameters=()):
        self._sql_log.append(sql)
        return self

    def fetchall(self):
        return []


class _FakeConnection:
    def __init__(self, sql_log: list[str]):
        self._sql_log = sql_log

    def execute(self, sql: str, parameters=()):
        self._sql_log.append(sql)
        return _FakeCursor(self._sql_log)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None


def test_list_mobile_domains_groups_all_selected_non_aggregates(monkeypatch):
    sql_log: list[str] = []
    monkeypatch.setattr(domain_model, "get_connection", lambda: _FakeConnection(sql_log))

    domain_model.list_mobile_domains()

    assert sql_log
    assert "GROUP BY d.id, d.uuid, d.slug, d.name" in sql_log[0]


def test_list_mobile_sites_groups_all_selected_non_aggregates(monkeypatch):
    sql_log: list[str] = []
    monkeypatch.setattr(domain_model, "get_connection", lambda: _FakeConnection(sql_log))

    domain_model.list_mobile_sites()

    assert sql_log
    assert "GROUP BY s.id, s.uuid, s.slug, s.name, s.address, d.uuid, d.slug, d.name" in sql_log[0]