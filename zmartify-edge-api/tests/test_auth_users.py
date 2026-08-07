from __future__ import annotations

import os
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "auth.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
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

    from app.db import get_connection

    with get_connection() as conn:
        roles = conn.execute(
            """
            SELECT r.name
            FROM user_roles ur
            JOIN users u ON u.id = ur.user_id
            JOIN roles r ON r.id = ur.role_id
            WHERE u.username = 'admin'
            """
        ).fetchall()
    assert [row["name"] for row in roles] == ["administrator"]


def test_user_crud_with_owner(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")
    client = _client(monkeypatch, tmp_path)

    headers = {"Authorization": "Bearer emergency-token"}

    create = client.post(
        "/users",
        headers=headers,
        json={
            "username": "tech1",
            "display_name": "Site Member",
            "password": "long-password-1234",
            "roles": [],
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

    role_change = client.post(f"/users/{user_id}/roles", headers=headers, json={"roles": []})
    assert role_change.status_code == 200
    assert role_change.json()["roles"] == []

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


def test_legacy_global_roles_are_rejected(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")
    client = _client(monkeypatch, tmp_path)

    response = client.post(
        "/users",
        headers={"Authorization": "Bearer emergency-token"},
        json={
            "username": "legacy-role-user",
            "display_name": "Legacy Role User",
            "password": "long-password-1234",
            "roles": ["viewer"],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "only the administrator global role is supported"


def test_auth_me_with_bearer_token(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
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
            "roles": ["administrator"],
        },
    )
    assert created.status_code == 201

    login = client.post("/auth/login", json={"username": "admin2", "password": "VeryStrongPass123!"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "admin2"
    assert "administrator" in me.json()["roles"]
