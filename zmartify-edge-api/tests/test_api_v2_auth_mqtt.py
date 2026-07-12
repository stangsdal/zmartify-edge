from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-auth-mqtt.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
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


def test_api_v2_auth_and_users(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    me = client.get("/api/v2/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["username"]

    users = client.get("/api/v2/users", headers=headers)
    assert users.status_code == 200
    assert isinstance(users.json(), list)
    assert len(users.json()) >= 1

    user_id = users.json()[0]["id"]
    user_detail = client.get(f"/api/v2/users/{user_id}", headers=headers)
    assert user_detail.status_code == 200

    site_access = client.get(f"/api/v2/users/{user_id}/site-access", headers=headers)
    assert site_access.status_code == 200
    assert "site_ids" in site_access.json()


def test_api_v2_mqtt_clients_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain = client.post("/domains", headers=headers, json={"slug": "mqtthouse", "name": "MQTT House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(
        f"/domains/{domain_id}/sites",
        headers=headers,
        json={"slug": "mqttmain", "name": "MQTT Main"},
    )
    assert site.status_code == 201
    site_id = site.json()["id"]

    created = client.post(
        "/api/v2/mqtt/clients",
        headers=headers,
        json={
            "client_type": "homeassistant",
            "domain_id": domain_id,
            "site_id": site_id,
            "device_id": None,
            "username": "ha_v2_test",
        },
    )
    assert created.status_code == 201
    client_id = created.json()["mqtt_client_id"]

    listed = client.get("/api/v2/mqtt/clients", headers=headers)
    assert listed.status_code == 200
    assert any(item["id"] == client_id for item in listed.json())

    detail = client.get(f"/api/v2/mqtt/clients/{client_id}", headers=headers)
    assert detail.status_code == 200

    rotated = client.post(f"/api/v2/mqtt/clients/{client_id}/rotate-password", headers=headers)
    assert rotated.status_code == 200
    assert rotated.json()["mqtt_client_id"] == client_id

    disabled = client.post(f"/api/v2/mqtt/clients/{client_id}/disable", headers=headers)
    assert disabled.status_code == 200
    assert int(disabled.json()["enabled"]) == 0

    enabled = client.post(f"/api/v2/mqtt/clients/{client_id}/enable", headers=headers)
    assert enabled.status_code == 200
    assert int(enabled.json()["enabled"]) == 1

    deleted = client.delete(f"/api/v2/mqtt/clients/{client_id}", headers=headers)
    assert deleted.status_code == 204
