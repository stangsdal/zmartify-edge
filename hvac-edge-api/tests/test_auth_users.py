from __future__ import annotations

import os
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "auth.sqlite"
    monkeypatch.setenv("HVAC_EDGE_DB_PATH", str(db_path))
    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner

    initialize_database()
    ensure_bootstrap_owner()
    from main import app

    return TestClient(app)


def test_setup_status_and_login_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    setup = client.get("/setup/status")
    assert setup.status_code == 200
    assert setup.json()["initialized"] is True

    # Login should fail with unknown credentials.
    bad = client.post("/auth/login", json={"username": "admin", "password": "wrong-password-123"})
    assert bad.status_code == 401


def test_user_crud_with_owner(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("HVAC_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")
    client = _client(monkeypatch, tmp_path)

    headers = {"Authorization": "Bearer emergency-token"}

    create = client.post(
        "/users",
        headers=headers,
        json={
            "username": "tech1",
            "display_name": "Installer Tech",
            "password": "long-password-1234",
            "roles": ["installer"],
        },
    )
    assert create.status_code == 201
    user_id = create.json()["id"]

    listed = client.get("/users", headers=headers)
    assert listed.status_code == 200
    assert any(u["username"] == "tech1" for u in listed.json())

    disabled = client.post(f"/users/{user_id}/disable", headers=headers)
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] == 0

    enabled = client.post(f"/users/{user_id}/enable", headers=headers)
    assert enabled.status_code == 200
    assert enabled.json()["enabled"] == 1

    role_change = client.post(f"/users/{user_id}/roles", headers=headers, json={"roles": ["viewer"]})
    assert role_change.status_code == 200
    assert role_change.json()["roles"] == ["viewer"]

    reset = client.post(
        f"/users/{user_id}/reset-password",
        headers=headers,
        json={"password": "another-long-password-1234"},
    )
    assert reset.status_code == 200

    delete = client.delete(f"/users/{user_id}", headers=headers)
    assert delete.status_code == 204

    audit = client.get("/admin/audit-log", headers=headers)
    assert audit.status_code == 200
    assert len(audit.json()) >= 1


def test_auth_me_with_bearer_token(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("HVAC_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")
    client = _client(monkeypatch, tmp_path)

    headers = {"Authorization": "Bearer emergency-token"}
    created = client.post(
        "/users",
        headers=headers,
        json={
            "username": "admin2",
            "display_name": "Admin Two",
            "password": "VeryStrongPass123!",
            "roles": ["admin"],
        },
    )
    assert created.status_code == 201

    login = client.post("/auth/login", json={"username": "admin2", "password": "VeryStrongPass123!"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "admin2"
    assert "admin" in me.json()["roles"]
