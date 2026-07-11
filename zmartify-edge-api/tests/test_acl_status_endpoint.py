from __future__ import annotations

from pathlib import Path

from app.db import get_connection, initialize_database
from app.mqtt_acl import build_acl_status, generate_acl_file


def test_acl_status_reports_checksum_and_logs(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "acl_status.sqlite"
    acl_path = tmp_path / "acl_status.acl"

    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_MQTT_ACL_FILE", str(acl_path))
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "1")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "0")

    initialize_database()
    with get_connection(db_path) as conn:
        generate_acl_file(conn)

    with get_connection(db_path) as conn:
        status = build_acl_status(conn, acl_path=acl_path, limit=5)

    assert status["acl_file"]["exists"] is True
    assert status["acl_file"]["size_bytes"] >= 1
    assert isinstance(status["acl_file"]["sha256"], str)
    assert len(status["generation_logs"]) >= 1
    assert "success" in status["generation_logs"][0]
