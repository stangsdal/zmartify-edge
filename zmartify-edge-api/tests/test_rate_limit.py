from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "rate-limit.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("ZMART_EDGE_RATE_LIMIT_ENABLED", "1")
    monkeypatch.setenv("ZMART_EDGE_AUTH_RATE_LIMIT", "2")
    monkeypatch.setenv("ZMART_EDGE_AUTH_RATE_LIMIT_WINDOW_SECONDS", "60")

    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner
    from app.rate_limit import reset_rate_limit_state

    initialize_database()
    ensure_bootstrap_owner()
    reset_rate_limit_state()

    from main import app

    return TestClient(app)


def test_auth_login_is_rate_limited(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    payload = {"username": "owner", "password": "wrong"}

    assert client.post("/auth/login", json=payload).status_code == 401
    assert client.post("/auth/login", json=payload).status_code == 401

    limited = client.post("/auth/login", json=payload)

    assert limited.status_code == 429
    assert limited.json()["detail"] == "too many requests"
    assert int(limited.headers["Retry-After"]) >= 1


def test_non_sensitive_paths_are_not_rate_limited(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    for _ in range(4):
        response = client.get("/health/live")
        assert response.status_code == 200