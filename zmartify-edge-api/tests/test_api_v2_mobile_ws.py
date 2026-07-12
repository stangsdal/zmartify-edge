from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-mobile-ws.sqlite"
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


def _seed_zone_ref(client: TestClient, headers: dict[str, str], suffix: str = "v2ws") -> str:
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
            "display_name": "Gateway WS",
            "mac": "AA:BB:CC:DD:EE:11",
            "firmware_version": "1.0.0",
        },
    )
    assert create.status_code == 201

    assign = client.post(f"/devices/{device_id}/assign-site", headers=headers, json={"site_id": site_id})
    assert assign.status_code == 200

    zones = client.get(f"/api/v2/devices/{device_id}/zones", headers=headers)
    assert zones.status_code == 200
    zone_ref = zones.json()[0]["zone_uuid"]
    assert zone_ref
    return zone_ref


def test_api_v2_mobile_zone_websocket(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    zone_ref = _seed_zone_ref(client, headers)

    with client.websocket_connect(f"/api/v2/mobile/ws/zones/{zone_ref}?token=emergency-token") as ws:
        first = ws.receive_json()
        assert first["type"] == "zone_update"
        assert first["zone_ref"] == zone_ref
        assert isinstance(first["zone"], dict)

        ws.send_text("ping")
        pong = ws.receive_json()
        assert pong["type"] == "pong"
