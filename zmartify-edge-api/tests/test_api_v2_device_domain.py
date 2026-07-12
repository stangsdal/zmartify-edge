from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-device-domain.sqlite"
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


def _seed_device(client: TestClient, headers: dict[str, str], suffix: str = "v2dd") -> str:
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

    assign = client.post(f"/devices/{device_id}/assign-site", headers=headers, json={"site_id": site_id})
    assert assign.status_code == 200

    return device_id


def test_api_v2_device_domain_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_device(client, headers)

    zones = client.get(f"/api/v2/devices/{device_id}/zones", headers=headers)
    assert zones.status_code == 200
    zone_id = zones.json()[0]["zone_id"]
    zone_ref = zones.json()[0]["zone_uuid"]

    zone_rename = client.post(
        f"/api/v2/devices/{device_id}/zones/{zone_id}/rename",
        headers=headers,
        json={"name": "Living"},
    )
    assert zone_rename.status_code == 200

    zone_meta = client.post(
        f"/api/v2/devices/{device_id}/zones/{zone_id}/metadata",
        headers=headers,
        json={"icon": "home", "floor": "Ground"},
    )
    assert zone_meta.status_code == 200

    channels = client.get(f"/api/v2/devices/{device_id}/channels", headers=headers)
    assert channels.status_code == 200
    channel_id = channels.json()[0]["channel_id"]

    channel_meta = client.post(
        f"/api/v2/devices/{device_id}/channels/{channel_id}/metadata",
        headers=headers,
        json={"name": "Pump"},
    )
    assert channel_meta.status_code == 200

    channel_state = client.post(
        f"/api/v2/devices/{device_id}/channels/{channel_id}/state",
        headers=headers,
        json={"active": True},
    )
    assert channel_state.status_code == 200

    link = client.post(
        f"/api/v2/devices/{device_id}/channels/{channel_id}/link-zones",
        headers=headers,
        json={"zone_ids": [zone_id]},
    )
    assert link.status_code == 200

    ingest = client.post(
        f"/api/v2/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "firmware_periodic",
            "source_timestamp": "2026-07-12T10:00:00Z",
            "online": True,
            "mqtt_connected": True,
            "zones": [{"zone_id": zone_id, "target_temperature_c": 21.0}],
            "channels": [{"channel_id": channel_id, "active": True}],
        },
    )
    assert ingest.status_code == 200

    history_zone = client.get(f"/api/v2/mobile/zones/{zone_ref}/history", headers=headers)
    assert history_zone.status_code == 200

    history_device = client.get(f"/api/v2/mobile/devices/{device_id}/history", headers=headers)
    assert history_device.status_code == 200

    freshness = client.get(f"/api/v2/mobile/devices/{device_id}/freshness", headers=headers)
    assert freshness.status_code == 200
