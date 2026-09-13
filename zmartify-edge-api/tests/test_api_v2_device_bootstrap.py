from __future__ import annotations

import csv
import io
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


def test_factory_label_export_only_includes_never_connected_devices(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("ZMART_EDGE_FACTORY_PAIRING_KEY", "test-factory-pairing-key-with-at-least-32-bytes")
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    from app.domain_model import upsert_device_state
    from app.registry import create_device

    pending_id = "zmartify-hvac-ahc9000-aabbccddeeff"
    connected_id = "zmartify-hvac-ahc9000-112233445566"
    create_device(
        device_id=pending_id,
        display_name="Pending Controller",
        mac="AA:BB:CC:DD:EE:FF",
        firmware_version="0.3.55",
    )
    create_device(
        device_id=connected_id,
        display_name="Connected Controller",
        mac="11:22:33:44:55:66",
        firmware_version="0.3.55",
    )
    upsert_device_state(connected_id, online=True, mqtt_connected=True, source="test")
    upsert_device_state(connected_id, online=False, mqtt_connected=False, source="test")

    response = client.get("/api/v2/devices/bootstrap/labels.csv", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 1
    assert rows[0]["device_id"] == pending_id
    assert rows[0]["mac"] == "AA:BB:CC:DD:EE:FF"
    assert rows[0]["pairing_code"].count("-") == 3
    assert rows[0]["pairing_code"] in rows[0]["qr_url"]
    assert pending_id in rows[0]["qr_url"]
    assert "test-factory-pairing-key" not in response.text

    repeated = client.get("/api/v2/devices/bootstrap/labels.csv", headers=headers)
    assert repeated.text == response.text


def test_api_v2_device_bootstrap_stage_requires_site_owner(monkeypatch, tmp_path: Path):
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

    with get_connection() as conn:
        conn.execute("UPDATE site_memberships SET role = 'owner' WHERE id = ?", (membership_id,))
        conn.commit()

    access_context = client.get("/api/v2/me/context", headers=viewer_headers)
    assert access_context.status_code == 200
    assert access_context.json()["sites"] == [
        {
            "id": site.json()["id"],
            "uuid": site.json()["uuid"],
            "name": "Bootstrap Site",
            "domain_id": domain.json()["id"],
            "domain_name": "Bootstrap Domain",
            "role": "owner",
            "products": [],
        }
    ]

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
    assert staged.status_code == 201