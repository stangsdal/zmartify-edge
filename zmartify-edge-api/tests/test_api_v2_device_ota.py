from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-device-ota.sqlite"
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


def test_api_v2_device_ota_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token", "Content-Type": "application/octet-stream"}

    import app.router_v2_device_ota as ota

    monkeypatch.setattr(ota, "get_device_onboarding_context", lambda _device_id: {"local_url": "http://192.168.10.57"})
    monkeypatch.setattr(ota, "push_remote_firmware", lambda _base_url, payload: {"written_bytes": len(payload)})
    monkeypatch.setattr(ota, "trigger_remote_reboot", lambda _base_url: {"ok": True})

    payload = b"firmware-v2-payload"

    pushed = client.post("/api/v2/devices/hvac-gateway-ota01/ota?reboot=true", headers=headers, content=payload)
    assert pushed.status_code == 200
    assert pushed.json()["written_bytes"] == len(payload)
    assert pushed.json()["reboot_triggered"] is True

    staged = client.post(
        "/api/v2/devices/hvac-gateway-ota01/ota/stage?version=2.0.0&force=false",
        headers=headers,
        content=payload,
    )
    assert staged.status_code == 200
    staged_json = staged.json()
    assert staged_json["version"] == "2.0.0"
    assert staged_json["size_bytes"] == len(payload)

    expected_sha = hashlib.sha256(payload).hexdigest()
    assert staged_json["sha256"] == expected_sha

    poll_available = client.get(
        "/api/v2/devices/hvac-gateway-ota01/ota/poll",
        headers={"Authorization": "Bearer emergency-token"},
        params={"current_version": "1.0.0"},
    )
    assert poll_available.status_code == 200
    assert poll_available.json()["update_available"] is True
    assert poll_available.json()["sha256"] == expected_sha

    poll_current = client.get(
        "/api/v2/devices/hvac-gateway-ota01/ota/poll",
        headers={"Authorization": "Bearer emergency-token"},
        params={"current_version": "2.0.0"},
    )
    assert poll_current.status_code == 200
    assert poll_current.json()["update_available"] is False

    downloaded = client.get(
        "/api/v2/devices/hvac-gateway-ota01/ota/download",
        headers={"Authorization": "Bearer emergency-token"},
        params={"sha256": expected_sha},
    )
    assert downloaded.status_code == 200
    assert downloaded.content == payload
    assert downloaded.headers["x-firmware-sha256"] == expected_sha
