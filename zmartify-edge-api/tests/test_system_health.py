from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "health.sqlite"
    mqtt_config = tmp_path / "mosquitto"
    mqtt_config.mkdir()
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_MQTT_ACL_FILE", str(mqtt_config / "acl"))
    monkeypatch.setenv("MQTT_HOST", "127.0.0.1")
    monkeypatch.setenv("MQTT_PORT", "1883")
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")

    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner

    initialize_database()
    ensure_bootstrap_owner()

    from main import app

    return TestClient(app)


def test_health_live_is_public(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "service": "zmartify-edge-api"}


def test_health_ready_reports_checks(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    import app.router_system_status as system_status

    monkeypatch.setattr(system_status, "_mqtt_check", lambda: {"ok": True, "host": "127.0.0.1", "port": 1883})

    response = client.get("/health/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["checks"]["database"]["ok"] is True
    assert payload["checks"]["database"]["runtime_backend"] == "sqlite"
    assert payload["checks"]["migrations"]["applied_count"] >= 1
    assert payload["checks"]["mqtt"]["ok"] is True
    assert payload["checks"]["storage"]["ok"] is True


def test_health_ready_returns_503_when_dependency_fails(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    import app.router_system_status as system_status

    monkeypatch.setattr(system_status, "_mqtt_check", lambda: {"ok": False, "error": "connection refused"})

    response = client.get("/health/ready")

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["ok"] is False
    assert detail["checks"]["mqtt"]["error"] == "connection refused"