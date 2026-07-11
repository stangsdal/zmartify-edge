from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-device-lifecycle.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")
    monkeypatch.setenv("ZMART_EDGE_ENABLE_MANUAL_FIRMWARE_REFRESH", "1")

    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner

    initialize_database()
    ensure_bootstrap_owner()

    from main import app

    return TestClient(app)


def _seed_domain_site(client: TestClient, headers: dict[str, str], suffix: str = "dvl") -> tuple[int, int]:
    domain = client.post("/domains", headers=headers, json={"slug": f"house-{suffix}", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(
        f"/domains/{domain_id}/sites",
        headers=headers,
        json={"slug": f"main-{suffix}", "name": "Main"},
    )
    assert site.status_code == 201
    return domain_id, site.json()["id"]


def test_api_v2_device_discover_claim_and_push(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain_id, site_id = _seed_domain_site(client, headers)

    import app.router_v2_device_lifecycle as lifecycle

    monkeypatch.setattr(
        lifecycle,
        "discover_remote_device",
        lambda _base_url: {
            "base_url": "http://192.168.10.57",
            "identity": {
                "device_id": "hvac-gateway-v2lifecycle01",
                "mac": "AA:BB:CC:DD:EE:FF",
                "firmware_version": "1.0.0",
            },
            "claim": {},
            "status": {"state": "discoverable"},
        },
    )
    monkeypatch.setattr(lifecycle, "push_remote_onboarding_config", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(
        lifecycle,
        "get_remote_onboarding_status",
        lambda _base_url: {
            "state": "claimed",
            "device_id": "hvac-gateway-v2lifecycle01",
            "edge_url": "https://pilot.zmartify.dk",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        },
    )

    discover = client.post("/api/v2/devices/discover", headers=headers, json={"base_url": "http://192.168.10.57"})
    assert discover.status_code == 200

    claim = client.post(
        "/api/v2/devices/claim",
        headers=headers,
        json={
            "base_url": "http://192.168.10.57",
            "claim_token": "claim-token",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Gateway V2 Lifecycle",
        },
    )
    assert claim.status_code == 201
    assert claim.json()["device"]["device_id"] == "hvac-gateway-v2lifecycle01"

    push = client.post(
        "/api/v2/devices/hvac-gateway-v2lifecycle01/push-config",
        headers=headers,
        json={"claim_token": "claim-token"},
    )
    assert push.status_code == 200
    assert push.json()["state"] == "claimed"

    onboarding = client.get("/api/v2/devices/hvac-gateway-v2lifecycle01/onboarding-status", headers=headers)
    assert onboarding.status_code == 200


def test_api_v2_device_firmware_refresh(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    _, site_id = _seed_domain_site(client, headers, suffix="rfw")

    create = client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": "hvac-gateway-v2rfw01",
            "display_name": "Gateway RFW",
            "mac": "AA:BB:CC:DD:EE:00",
            "firmware_version": "1.0.0",
        },
    )
    assert create.status_code == 201

    assign = client.post("/devices/hvac-gateway-v2rfw01/assign-site", headers=headers, json={"site_id": site_id})
    assert assign.status_code == 200

    import app.router_v2_device_lifecycle as lifecycle
    monkeypatch.setattr(lifecycle, "get_remote_device_version", lambda _base_url: {"version": "1.0.1"})

    refresh = client.post(
        "/api/v2/devices/hvac-gateway-v2rfw01/firmware/refresh",
        headers=headers,
        params={"base_url": "http://192.168.10.57"},
    )
    assert refresh.status_code == 200
    assert refresh.json()["firmware_version"] == "1.0.1"
