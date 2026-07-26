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


def test_api_v2_device_controller_settings_proxy(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain_id, site_id = _seed_domain_site(client, headers, suffix="settings")

    import app.router_v2_device_lifecycle as lifecycle

    monkeypatch.setattr(
        lifecycle,
        "discover_remote_device",
        lambda _base_url: {
            "base_url": "http://192.168.10.113",
            "identity": {
                "device_id": "zmartify-irrigation-settings01",
                "mac": "AA:BB:CC:DD:EE:11",
                "firmware_version": "v5.0.0",
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
            "device_id": "zmartify-irrigation-settings01",
            "edge_url": "https://pilot.zmartify.dk",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        },
    )

    claim = client.post(
        "/api/v2/devices/claim",
        headers=headers,
        json={
            "base_url": "http://192.168.10.113",
            "claim_token": "claim-token",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Irrigation Settings",
        },
    )
    assert claim.status_code == 201

    monkeypatch.setattr(
        lifecycle,
        "get_remote_network_config",
        lambda _base_url: {
            "mqtt_broker_uri": "mqtts://pilot.zmartify.dk:8883",
            "mqtt_port": 8883,
            "mqtt_username": "device_zmartify-irrigation-settings01",
            "mqtt_password_configured": True,
            "mqtt_tls_enabled": True,
            "ntp_server": "pool.ntp.org",
            "timezone": "CET-1CEST,M3.5.0,M10.5.0/3",
        },
    )
    captured: dict[str, object] = {}

    def fake_publish_settings_command(device_id: str, command_type: str, target_ref: str | None, payload: dict) -> dict:
        captured["device_id"] = device_id
        captured["command_type"] = command_type
        captured["target_ref"] = target_ref
        captured["payload"] = payload
        return {"command_id": "cmd-test", "status": "published"}

    monkeypatch.setattr(lifecycle, "publish_irrigation_command", fake_publish_settings_command)

    settings = client.get("/api/v2/devices/zmartify-irrigation-settings01/controller-settings", headers=headers)
    assert settings.status_code == 200
    assert settings.json()["timezone"] == "CET-1CEST,M3.5.0,M10.5.0/3"
    assert settings.json()["mqtt_password_configured"] is True

    update = client.put(
        "/api/v2/devices/zmartify-irrigation-settings01/controller-settings",
        headers=headers,
        json={
            "timezone": "UTC0",
            "ntp_server": "time.cloudflare.com",
            "mqtt_password": "",
        },
    )
    assert update.status_code == 200
    assert update.json()["reboot_required"] is True
    assert captured["device_id"] == "zmartify-irrigation-settings01"
    assert captured["command_type"] == "irrigation.config.network"
    assert captured["target_ref"] is None
    assert captured["payload"] == {"timezone": "UTC0", "ntp_server": "time.cloudflare.com"}


def test_api_v2_device_sd_card_status_and_initialize(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain_id, site_id = _seed_domain_site(client, headers, suffix="sdcard")

    import app.router_v2_device_lifecycle as lifecycle

    monkeypatch.setattr(
        lifecycle,
        "discover_remote_device",
        lambda _base_url: {
            "base_url": "http://192.168.10.113",
            "identity": {
                "device_id": "zmartify-irrigation-sdcard01",
                "mac": "AA:BB:CC:DD:EE:22",
                "firmware_version": "v5.0.0",
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
            "device_id": "zmartify-irrigation-sdcard01",
            "edge_url": "https://pilot.zmartify.dk",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        },
    )

    claim = client.post(
        "/api/v2/devices/claim",
        headers=headers,
        json={
            "base_url": "http://192.168.10.113",
            "claim_token": "claim-token",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Irrigation SD Card",
        },
    )
    assert claim.status_code == 201

    monkeypatch.setattr(
        lifecycle,
        "get_remote_sd_card_status",
        lambda _base_url: {
            "state": "mounted",
            "mounted": True,
            "total_bytes": 31_000_000_000,
            "card_total_bytes": 31_000_000_000,
            "filesystem_total_bytes": 31_000_000_000,
            "free_bytes": 29_000_000_000,
            "mount_point": "/sdcard",
            "card_name": "SD32G",
            "last_error": "",
        },
    )
    captured: dict[str, object] = {}

    def fake_publish_sd_command(device_id: str, command_type: str, target_ref: str | None, payload: dict) -> dict:
        captured["device_id"] = device_id
        captured["command_type"] = command_type
        captured["target_ref"] = target_ref
        captured["payload"] = payload
        return {"command_id": "cmd-sd", "status": "published"}

    monkeypatch.setattr(lifecycle, "publish_irrigation_command", fake_publish_sd_command)

    status = client.get("/api/v2/devices/zmartify-irrigation-sdcard01/storage/sd-card", headers=headers)
    assert status.status_code == 200
    assert status.json()["state"] == "mounted"
    assert status.json()["mounted"] is True
    assert status.json()["card_total_bytes"] == 31_000_000_000
    assert status.json()["filesystem_total_bytes"] == 31_000_000_000
    assert status.json()["free_bytes"] == 29_000_000_000

    from app.domain_model import log_event
    from app.registry import get_device

    device = get_device("zmartify-irrigation-sdcard01")
    log_event(
        "device_storage_status",
        domain_id=domain_id,
        site_id=site_id,
        device_pk_id=int(device["id"]),
        payload={
            "device_id": "zmartify-irrigation-sdcard01",
            "storage": {
                "sd_card": {
                    "state": "mounted",
                    "mounted": True,
                    "total_bytes": 15_931_539_456,
                    "card_total_bytes": 15_931_539_456,
                    "filesystem_total_bytes": 534763520,
                    "free_bytes": 464746496,
                    "mount_point": "/sdcard",
                    "card_name": "SL16G",
                    "last_error": "",
                }
            },
        },
    )
    monkeypatch.setattr(lifecycle, "get_remote_sd_card_status", lambda _base_url: (_ for _ in ()).throw(lifecycle.DeviceOnboardingError("timed out")))
    fallback_status = client.get("/api/v2/devices/zmartify-irrigation-sdcard01/storage/sd-card", headers=headers)
    assert fallback_status.status_code == 200
    assert fallback_status.json()["source"] == "mqtt_reported_state"
    assert fallback_status.json()["mounted"] is True
    assert fallback_status.json()["card_total_bytes"] == 15_931_539_456
    assert fallback_status.json()["filesystem_total_bytes"] == 534763520
    assert fallback_status.json()["card_name"] == "SL16G"

    initialize = client.post(
        "/api/v2/devices/zmartify-irrigation-sdcard01/storage/sd-card/initialize",
        headers=headers,
        json={"format": True},
    )
    assert initialize.status_code == 200
    assert initialize.json()["state"] == "initialize_requested"
    assert initialize.json()["command_id"] == "cmd-sd"
    assert captured["device_id"] == "zmartify-irrigation-sdcard01"
    assert captured["command_type"] == "irrigation.config.storage.sd-card.initialize"
    assert captured["target_ref"] is None
    assert captured["payload"] == {"format": True}
