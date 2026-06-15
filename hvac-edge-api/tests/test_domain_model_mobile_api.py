from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "domain_model.sqlite"
    monkeypatch.setenv("HVAC_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("HVAC_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("HVAC_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("HVAC_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")

    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner

    initialize_database()
    ensure_bootstrap_owner()

    from main import app

    return TestClient(app)


def test_zone_metadata_and_mobile_shape(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    device = client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": "hvac-gateway-aabbcc",
            "display_name": "Gateway",
            "mac": "AA:BB:CC:DD:EE:FF",
            "firmware_version": "0.1.2",
        },
    )
    assert device.status_code == 201

    assign = client.post("/devices/hvac-gateway-aabbcc/assign-site", headers=headers, json={"site_id": site_id})
    assert assign.status_code == 200

    zones = client.get("/devices/hvac-gateway-aabbcc/zones", headers=headers)
    assert zones.status_code == 200
    assert len(zones.json()) >= 3

    rename = client.post(
        "/devices/hvac-gateway-aabbcc/zones/1/rename",
        headers=headers,
        json={"name": "Living Room"},
    )
    assert rename.status_code == 200
    assert rename.json()["name"] == "Living Room"

    meta = client.post(
        "/devices/hvac-gateway-aabbcc/zones/1/metadata",
        headers=headers,
        json={"icon": "sofa", "floor": "Ground Floor", "area_m2": 28.5},
    )
    assert meta.status_code == 200
    assert meta.json()["icon"] == "sofa"

    mobile_device = client.get("/mobile/devices/hvac-gateway-aabbcc", headers=headers)
    assert mobile_device.status_code == 200
    assert mobile_device.json()["zones"][0]["name"] == "Living Room"


def test_mobile_setpoint_updates_twin_and_events(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    domain_id = domain.json()["id"]
    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    site_id = site.json()["id"]

    client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": "hvac-gateway-ddaacc",
            "display_name": "Gateway 2",
            "mac": "DD:AA:CC:00:11:22",
            "firmware_version": "0.1.2",
        },
    )
    client.post("/devices/hvac-gateway-ddaacc/assign-site", headers=headers, json={"site_id": site_id})

    zones = client.get("/devices/hvac-gateway-ddaacc/zones", headers=headers).json()
    zone_ref = zones[0]["zone_uuid"]

    setpoint = client.post(
        f"/mobile/zones/{zone_ref}/setpoint",
        headers=headers,
        json={"target_temperature_c": 22.5},
    )
    assert setpoint.status_code == 200
    assert setpoint.json()["zone"]["target_temperature_c"] == 22.5

    events = client.get("/events/recent", headers=headers)
    assert events.status_code == 200
    assert any(evt["event_type"] == "zone_setpoint_changed" for evt in events.json())

    notifs = client.get("/mobile/notifications", headers=headers)
    assert notifs.status_code == 200
    assert isinstance(notifs.json(), list)
