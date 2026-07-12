from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-mobile-events.sqlite"
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


def _seed_device(client: TestClient, headers: dict[str, str], suffix: str = "v2evt") -> str:
    domain = client.post("/domains", headers=headers, json={"slug": f"house-{suffix}", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(
        f"/domains/{domain_id}/sites",
        headers=headers,
        json={"slug": f"main-{suffix}", "name": "Main"},
    )
    assert site.status_code == 201
    site_id = site.json()["id"]

    device_id = f"hvac-gateway-{suffix}"
    create = client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": device_id,
            "display_name": "Gateway",
            "mac": "AA:BB:CC:DD:EE:FF",
            "firmware_version": "1.0.0",
        },
    )
    assert create.status_code == 201

    assigned = client.post(f"/devices/{device_id}/assign-site", headers=headers, json={"site_id": site_id})
    assert assigned.status_code == 200

    return device_id


def test_api_v2_events_and_mobile_notifications(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_device(client, headers)

    zones = client.get(f"/devices/{device_id}/zones", headers=headers)
    assert zones.status_code == 200
    zone_ref = zones.json()[0]["zone_uuid"]

    setpoint = client.post(
        f"/mobile/zones/{zone_ref}/setpoint",
        headers=headers,
        json={"target_temperature_c": 22.0},
    )
    assert setpoint.status_code == 200

    events_recent = client.get("/api/v2/events/recent", headers=headers)
    assert events_recent.status_code == 200
    assert isinstance(events_recent.json(), list)

    events_device = client.get(f"/api/v2/events/device/{device_id}", headers=headers)
    assert events_device.status_code == 200
    assert isinstance(events_device.json(), list)

    mobile_events = client.get("/api/v2/mobile/events", headers=headers)
    assert mobile_events.status_code == 200
    assert "events" in mobile_events.json()

    notifications = client.get("/api/v2/mobile/notifications", headers=headers)
    assert notifications.status_code == 200
    assert isinstance(notifications.json(), list)

    read_all = client.post("/api/v2/mobile/notifications/read-all", headers=headers)
    assert read_all.status_code == 401
