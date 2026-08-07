from __future__ import annotations

import uuid
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-device-bootstrap.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")

    from app.auth import ensure_bootstrap_owner
    from app.db import initialize_database

    initialize_database()
    ensure_bootstrap_owner()

    from main import app

    return TestClient(app)


def test_api_v2_device_bootstrap_stage_requires_site_configure_access(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    administrator_headers = {"Authorization": "Bearer emergency-token"}

    domain = client.post("/domains", headers=administrator_headers, json={"slug": "bootstrap-domain", "name": "Bootstrap Domain"})
    assert domain.status_code == 201
    site = client.post(
        f"/domains/{domain.json()['id']}/sites",
        headers=administrator_headers,
        json={"slug": "bootstrap-site", "name": "Bootstrap Site"},
    )
    assert site.status_code == 201

    from app.auth import hash_password
    from app.db import get_connection

    with get_connection() as conn:
        user_id = conn.execute(
            "INSERT INTO users(uuid, username, display_name, password_hash, enabled) VALUES (?, ?, ?, ?, 1)",
            (str(uuid.uuid4()), "bootstrap-viewer", "Bootstrap Viewer", hash_password("VeryStrongPass123!")),
        ).lastrowid
        membership_id = conn.execute(
            "INSERT INTO site_memberships(uuid, user_id, site_id, role) VALUES (?, ?, ?, 'viewer')",
            (str(uuid.uuid4()), user_id, site.json()["id"]),
        ).lastrowid
        conn.execute(
            "INSERT INTO site_membership_product_access(membership_id, product_type) VALUES (?, 'hvac')",
            (membership_id,),
        )
        conn.commit()

    login = client.post("/auth/login", json={"username": "bootstrap-viewer", "password": "VeryStrongPass123!"})
    assert login.status_code == 200
    viewer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    staged = client.post(
        "/api/v2/devices/bootstrap/stage",
        headers=viewer_headers,
        json={
            "device_id": "hvac-bootstrap-authorization01",
            "claim_token": "123456",
            "domain_id": domain.json()["id"],
            "site_id": site.json()["id"],
            "display_name": "Bootstrap Authorization",
            "product_type": "hvac",
        },
    )
    assert staged.status_code == 403