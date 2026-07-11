from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "device_onboarding.sqlite"
    ota_stage_dir = tmp_path / "ota-stage"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_OTA_STAGE_DIR", str(ota_stage_dir))
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


def test_discover_and_claim_device(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import main

    def fake_discover(base_url: str) -> dict:
        assert base_url == "192.168.10.60"
        return {
            "base_url": "http://192.168.10.60",
            "identity": {
                "device_id": "hvac-gateway-aabbccddeeff",
                "mac": "AA:BB:CC:DD:EE:FF",
                "firmware_version": "1.2.3",
                "hardware": "waveshare-esp32-s3-rs485-can",
                "capabilities": ["ahc9000", "mqtt", "homie-v5", "ota", "rs485"],
            },
            "claim": {"device_id": "hvac-gateway-aabbccddeeff", "claim_token": "123456", "expires_in_s": 600},
            "status": {"state": "unclaimed", "device_id": "hvac-gateway-aabbccddeeff", "edge_url": None, "mqtt_configured": False, "mqtt_connected": False, "last_error": None},
        }

    def fake_push(base_url: str, payload: dict) -> dict:
        assert base_url in {"192.168.10.60", "http://192.168.10.60"}
        assert payload["device_admin_token"]
        if "claim_token" in payload:
            assert payload["claim_token"] == "123456"
        assert payload["mqtt_username"] == "device_hvac-gateway-aabbccddeeff"
        assert payload["mqtt_password"]
        return {"ok": True, "state": "mqtt_configured"}

    def fake_status(base_url: str) -> dict:
        assert base_url in {"192.168.10.60", "http://192.168.10.60"}
        return {
            "state": "online",
            "device_id": "hvac-gateway-aabbccddeeff",
            "edge_url": "http://testserver",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        }

    monkeypatch.setattr(main, "discover_remote_device", fake_discover)
    monkeypatch.setattr(main, "push_remote_onboarding_config", fake_push)
    monkeypatch.setattr(main, "get_remote_onboarding_status", fake_status)

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    discover = client.post("/devices/discover", headers=headers, json={"base_url": "192.168.10.60"})
    assert discover.status_code == 200
    assert discover.json()["identity"]["device_id"] == "hvac-gateway-aabbccddeeff"

    claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "claim_token": "123456",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert claim.status_code == 201
    body = claim.json()
    assert body["device"]["device_id"] == "hvac-gateway-aabbccddeeff"
    assert body["device"]["local_url"] == "http://192.168.10.60"
    assert body["onboarding_status"]["state"] == "online"

    status_resp = client.get("/devices/hvac-gateway-aabbccddeeff/onboarding-status", headers=headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["mqtt_connected"] is True

    push = client.post(
        "/devices/hvac-gateway-aabbccddeeff/push-config",
        headers=headers,
        json={},
    )
    assert push.status_code == 200
    assert push.json()["state"] == "online"


def test_reclaim_existing_device_rotates_credentials(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import main

    push_calls: list[dict] = []
    rotate_calls: list[int] = []

    def fake_discover(_base_url: str) -> dict:
        return {
            "base_url": "http://192.168.10.60",
            "identity": {
                "device_id": "hvac-gateway-aabbccddeeff",
                "mac": "AA:BB:CC:DD:EE:FF",
                "firmware_version": "1.2.3",
                "hardware": "waveshare-esp32-s3-rs485-can",
                "capabilities": ["ahc9000", "mqtt", "homie-v5", "ota", "rs485"],
            },
            "claim": {"device_id": "hvac-gateway-aabbccddeeff", "claim_token": "123456", "expires_in_s": 600},
            "status": {"state": "unclaimed", "device_id": "hvac-gateway-aabbccddeeff", "edge_url": None, "mqtt_configured": False, "mqtt_connected": False, "last_error": None},
        }

    def fake_push(_base_url: str, payload: dict) -> dict:
        push_calls.append(payload)
        assert payload["device_admin_token"]
        return {"ok": True, "state": "mqtt_configured"}

    def fake_status(_base_url: str) -> dict:
        return {
            "state": "online",
            "device_id": "hvac-gateway-aabbccddeeff",
            "edge_url": "http://testserver",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        }

    def fake_rotate(client_id: int) -> dict:
        rotate_calls.append(client_id)
        return {
            "mqtt_client_id": client_id,
            "username": "device_hvac-gateway-aabbccddeeff",
            "password": "rotated-password",
            "password_one_time": True,
        }

    monkeypatch.setattr(main, "discover_remote_device", fake_discover)
    monkeypatch.setattr(main, "push_remote_onboarding_config", fake_push)
    monkeypatch.setattr(main, "get_remote_onboarding_status", fake_status)
    monkeypatch.setattr(main, "rotate_mqtt_client_password", fake_rotate)

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    first_claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "claim_token": "123456",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert first_claim.status_code == 201

    second_claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert second_claim.status_code == 201
    assert second_claim.json()["onboarding_status"]["state"] == "online"

    assert len(push_calls) == 2
    assert "claim_token" in push_calls[0]
    assert "claim_token" not in push_calls[1]
    assert len(rotate_calls) == 1


def test_reclaim_timeout_uses_status_recovery(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import main
    from app.device_onboarding import DeviceOnboardingError

    push_calls = 0

    def fake_discover(_base_url: str) -> dict:
        return {
            "base_url": "http://192.168.10.60",
            "identity": {
                "device_id": "hvac-gateway-aabbccddeeff",
                "mac": "AA:BB:CC:DD:EE:FF",
                "firmware_version": "1.2.3",
                "hardware": "waveshare-esp32-s3-rs485-can",
                "capabilities": ["ahc9000", "mqtt", "homie-v5", "ota", "rs485"],
            },
            "claim": {"device_id": "hvac-gateway-aabbccddeeff", "claim_token": "123456", "expires_in_s": 600},
            "status": {"state": "unclaimed", "device_id": "hvac-gateway-aabbccddeeff", "edge_url": None, "mqtt_configured": False, "mqtt_connected": False, "last_error": None},
        }

    def fake_push(_base_url: str, _payload: dict) -> dict:
        nonlocal push_calls
        push_calls += 1
        if push_calls == 2:
            raise DeviceOnboardingError("device request failed: timed out")
        return {"ok": True, "state": "mqtt_configured"}

    def fake_status(_base_url: str) -> dict:
        return {
            "state": "online",
            "device_id": "hvac-gateway-aabbccddeeff",
            "edge_url": "http://testserver",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        }

    monkeypatch.setattr(main, "discover_remote_device", fake_discover)
    monkeypatch.setattr(main, "push_remote_onboarding_config", fake_push)
    monkeypatch.setattr(main, "get_remote_onboarding_status", fake_status)

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    first_claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "claim_token": "123456",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert first_claim.status_code == 201

    second_claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert second_claim.status_code == 201
    assert second_claim.json()["onboarding_status"]["state"] == "online"


def test_device_ota_proxy(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import main

    def fake_discover(_base_url: str) -> dict:
        return {
            "base_url": "http://192.168.10.60",
            "identity": {
                "device_id": "hvac-gateway-aabbccddeeff",
                "mac": "AA:BB:CC:DD:EE:FF",
                "firmware_version": "1.2.3",
                "hardware": "waveshare-esp32-s3-rs485-can",
                "capabilities": ["ahc9000", "mqtt", "homie-v5", "ota", "rs485"],
            },
            "claim": {"device_id": "hvac-gateway-aabbccddeeff", "claim_token": "123456", "expires_in_s": 600},
            "status": {"state": "unclaimed", "device_id": "hvac-gateway-aabbccddeeff", "edge_url": None, "mqtt_configured": False, "mqtt_connected": False, "last_error": None},
        }

    def fake_push(_base_url: str, _payload: dict) -> dict:
        return {"ok": True, "state": "mqtt_configured"}

    def fake_status(_base_url: str) -> dict:
        return {
            "state": "online",
            "device_id": "hvac-gateway-aabbccddeeff",
            "edge_url": "http://testserver",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        }

    def fake_ota(base_url: str, firmware_bytes: bytes) -> dict:
        assert base_url == "http://192.168.10.60"
        assert firmware_bytes == b"fw-bytes"
        return {"ok": True, "written_bytes": 8, "reboot_required": True}

    def fake_reboot(base_url: str) -> dict:
        assert base_url == "http://192.168.10.60"
        return {"ok": True}

    monkeypatch.setattr(main, "discover_remote_device", fake_discover)
    monkeypatch.setattr(main, "push_remote_onboarding_config", fake_push)
    monkeypatch.setattr(main, "get_remote_onboarding_status", fake_status)
    monkeypatch.setattr(main, "push_remote_firmware", fake_ota)
    monkeypatch.setattr(main, "trigger_remote_reboot", fake_reboot)

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "claim_token": "123456",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert claim.status_code == 201

    ota = client.post(
        "/devices/hvac-gateway-aabbccddeeff/ota?reboot=true",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=b"fw-bytes",
    )
    assert ota.status_code == 200
    body = ota.json()
    assert body["device_id"] == "hvac-gateway-aabbccddeeff"
    assert body["written_bytes"] == 8
    assert body["reboot_requested"] is True
    assert body["reboot_triggered"] is True


def test_device_ota_empty_payload(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import main

    def fake_discover(_base_url: str) -> dict:
        return {
            "base_url": "http://192.168.10.60",
            "identity": {
                "device_id": "hvac-gateway-aabbccddeeff",
                "mac": "AA:BB:CC:DD:EE:FF",
                "firmware_version": "1.2.3",
                "hardware": "waveshare-esp32-s3-rs485-can",
                "capabilities": ["ahc9000", "mqtt", "homie-v5", "ota", "rs485"],
            },
            "claim": {"device_id": "hvac-gateway-aabbccddeeff", "claim_token": "123456", "expires_in_s": 600},
            "status": {"state": "unclaimed", "device_id": "hvac-gateway-aabbccddeeff", "edge_url": None, "mqtt_configured": False, "mqtt_connected": False, "last_error": None},
        }

    def fake_push(_base_url: str, _payload: dict) -> dict:
        return {"ok": True, "state": "mqtt_configured"}

    def fake_status(_base_url: str) -> dict:
        return {
            "state": "online",
            "device_id": "hvac-gateway-aabbccddeeff",
            "edge_url": "http://testserver",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        }

    monkeypatch.setattr(main, "discover_remote_device", fake_discover)
    monkeypatch.setattr(main, "push_remote_onboarding_config", fake_push)
    monkeypatch.setattr(main, "get_remote_onboarding_status", fake_status)

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "claim_token": "123456",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert claim.status_code == 201

    ota = client.post(
        "/devices/hvac-gateway-aabbccddeeff/ota",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=b"",
    )
    assert ota.status_code == 400
    assert "firmware payload is empty" in ota.text


def test_device_ota_stage_poll_download(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import main

    def fake_discover(_base_url: str) -> dict:
        return {
            "base_url": "http://192.168.10.60",
            "identity": {
                "device_id": "hvac-gateway-aabbccddeeff",
                "mac": "AA:BB:CC:DD:EE:FF",
                "firmware_version": "1.2.3",
                "hardware": "waveshare-esp32-s3-rs485-can",
                "capabilities": ["ahc9000", "mqtt", "homie-v5", "ota", "rs485"],
            },
            "claim": {"device_id": "hvac-gateway-aabbccddeeff", "claim_token": "123456", "expires_in_s": 600},
            "status": {"state": "unclaimed", "device_id": "hvac-gateway-aabbccddeeff", "edge_url": None, "mqtt_configured": False, "mqtt_connected": False, "last_error": None},
        }

    def fake_push(_base_url: str, _payload: dict) -> dict:
        return {"ok": True, "state": "mqtt_configured"}

    def fake_status(_base_url: str) -> dict:
        return {
            "state": "online",
            "device_id": "hvac-gateway-aabbccddeeff",
            "edge_url": "http://testserver",
            "mqtt_configured": True,
            "mqtt_connected": True,
            "last_error": None,
        }

    monkeypatch.setattr(main, "discover_remote_device", fake_discover)
    monkeypatch.setattr(main, "push_remote_onboarding_config", fake_push)
    monkeypatch.setattr(main, "get_remote_onboarding_status", fake_status)

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    claim = client.post(
        "/devices/claim",
        headers=headers,
        json={
            "base_url": "192.168.10.60",
            "claim_token": "123456",
            "domain_id": domain_id,
            "site_id": site_id,
            "display_name": "Boiler Room Gateway",
        },
    )
    assert claim.status_code == 201

    fw = b"new-fw-binary"
    sha = hashlib.sha256(fw).hexdigest()
    stage = client.post(
        "/devices/hvac-gateway-aabbccddeeff/ota/stage?version=1.2.4",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=fw,
    )
    assert stage.status_code == 200
    assert stage.json()["sha256"] == sha

    poll = client.get(
        "/devices/hvac-gateway-aabbccddeeff/ota/poll?current_version=1.2.3",
        headers=headers,
    )
    assert poll.status_code == 200
    poll_body = poll.json()
    assert poll_body["update_available"] is True
    assert poll_body["version"] == "1.2.4"
    assert poll_body["sha256"] == sha
    assert "/devices/hvac-gateway-aabbccddeeff/ota/download?sha256=" in poll_body["download_url"]

    download = client.get(
        f"/devices/hvac-gateway-aabbccddeeff/ota/download?sha256={sha}",
        headers=headers,
    )
    assert download.status_code == 200
    assert download.content == fw
    assert download.headers.get("x-firmware-sha256") == sha
