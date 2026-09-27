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
    assert "GROUP BY s.id, s.uuid, s.slug, s.name, s.address, s.latitude, s.longitude, d.uuid, d.slug, d.name" in sql_log[0]


def test_existing_postgres_hvac_projection_columns_skip_runtime_ddl(monkeypatch):
    sql_log: list[str] = []
    existing_columns = [
        "thermostat_element_id",
        "controlled_element_ids_json",
        "assigned_channel_ids_json",
        "rssi_element_dbm",
        "rssi_control_unit_dbm",
        "floor_temperature_c",
        "configuration_json",
        "setpoint_profiles_json",
        "zone_mode",
    ]

    class _PostgresConnection(_FakeConnection):
        def execute(self, sql: str, parameters=()):
            sql_log.append(sql)
            cursor = _FakeCursor(sql_log)
            if "information_schema.columns" in sql:
                cursor.fetchall = lambda: [{"column_name": column_name} for column_name in existing_columns]
            return cursor

    monkeypatch.setattr(domain_model, "get_database_backend", lambda: "postgres")

    domain_model._ensure_hvac_projection_schema(_PostgresConnection(sql_log))

    assert not any(sql.strip().startswith("ALTER TABLE zone_state") for sql in sql_log)