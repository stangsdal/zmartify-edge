from __future__ import annotations

import hashlib
import json
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
    catalog_root = _write_catalog(tmp_path)
    monkeypatch.setenv("ZMART_EDGE_FIRMWARE_CATALOG_DIR", str(catalog_root))
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import app.router_v2_device_ota as ota

    monkeypatch.setattr(ota, "get_device_onboarding_context", lambda device_id: {
        "device_id": device_id,
        "device_type": "ahc9000",
        "local_url": "http://192.168.10.57",
    })
    monkeypatch.setattr(
        ota,
        "publish_device_ota_check",
        lambda device_id: {
            "device_id": device_id,
            "status": "published",
            "topic": f"homie/5/{device_id}/gateway/ota-check/set",
        },
    )

    payload = b"catalog-ota"

    pushed = client.post("/api/v2/devices/ahc9000-ota01/ota", headers=headers, content=payload)
    assert pushed.status_code == 410

    raw_staged = client.post(
        "/api/v2/devices/ahc9000-ota01/ota/stage?version=1.2.3",
        headers=headers,
        content=payload,
    )
    assert raw_staged.status_code == 410

    staged = client.post(
        "/api/v2/devices/ahc9000-ota01/ota/stage-catalog",
        headers=headers,
        json={"catalog_id": "ahc9000", "version": "1.2.3"},
    )
    assert staged.status_code == 200
    staged_json = staged.json()
    assert staged_json["version"] == "1.2.3"
    assert staged_json["size_bytes"] == len(payload)

    expected_sha = hashlib.sha256(payload).hexdigest()
    assert staged_json["sha256"] == expected_sha

    triggered = client.post(
        "/api/v2/devices/ahc9000-ota01/ota/trigger",
        headers={"Authorization": "Bearer emergency-token"},
    )
    assert triggered.status_code == 200
    assert triggered.json()["status"] == "published"
    assert triggered.json()["topic"].endswith("/gateway/ota-check/set")

    poll_available = client.get(
        "/api/v2/devices/ahc9000-ota01/ota/poll",
        headers={"Authorization": "Bearer emergency-token"},
        params={"current_version": "1.0.0"},
    )
    assert poll_available.status_code == 200
    assert poll_available.json()["update_available"] is True
    assert poll_available.json()["sha256"] == expected_sha

    poll_current = client.get(
        "/api/v2/devices/hvac-gateway-ota01/ota/poll",
        headers={"Authorization": "Bearer emergency-token"},
        params={"current_version": "1.2.3"},
    )
    assert poll_current.status_code == 200
    assert poll_current.json()["update_available"] is False

    poll_newer = client.get(
        "/api/v2/devices/ahc9000-ota01/ota/poll",
        headers={"Authorization": "Bearer emergency-token"},
        params={"current_version": "1.3.0"},
    )
    assert poll_newer.status_code == 200
    assert poll_newer.json()["update_available"] is False
    assert poll_newer.json()["reason"] == "staged version is not newer than device version"

    downloaded = client.get(
        "/api/v2/devices/ahc9000-ota01/ota/download",
        headers={"Authorization": "Bearer emergency-token"},
        params={"sha256": expected_sha},
    )
    assert downloaded.status_code == 200
    assert downloaded.content == payload
    assert downloaded.headers["x-firmware-sha256"] == expected_sha


def _write_catalog(tmp_path: Path, *, firmware: bytes = b"catalog-ota", checksum: str | None = None) -> Path:
    root = tmp_path / "firmware-catalog"
    release = root / "ahc9000"
    release.mkdir(parents=True)
    (release / "firmware-1.2.3.bin").write_bytes(firmware)
    (release / "releases.json").write_text(json.dumps({"releases": [{
        "version": "1.2.3",
        "ota": {"path": "firmware-1.2.3.bin", "sha256": checksum or hashlib.sha256(firmware).hexdigest()},
    }]}), encoding="utf-8")
    (root / "catalog.json").write_text(json.dumps({
        "controllers": [{
            "id": "ahc9000",
            "device_id_patterns": ["ahc9000"],
            "releases": "ahc9000/releases.json",
        }],
    }), encoding="utf-8")
    return root


def test_api_v2_stages_ota_from_validated_catalog(monkeypatch, tmp_path: Path):
    catalog_root = _write_catalog(tmp_path)
    monkeypatch.setenv("ZMART_EDGE_FIRMWARE_CATALOG_DIR", str(catalog_root))
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import app.router_v2_device_ota as ota

    monkeypatch.setattr(ota, "get_device_onboarding_context", lambda device_id: {
        "device_id": device_id,
        "device_type": "ahc9000",
        "local_url": "http://192.168.10.57",
    })

    response = client.post(
        "/api/v2/devices/zmartify-hvac-ahc9000-01/ota/stage-catalog",
        headers=headers,
        json={"catalog_id": "ahc9000", "version": "1.2.3"},
    )
    assert response.status_code == 200
    assert response.json()["version"] == "1.2.3"
    assert response.json()["sha256"] == hashlib.sha256(b"catalog-ota").hexdigest()


def test_api_v2_rejects_invalid_or_incompatible_catalog_ota(monkeypatch, tmp_path: Path):
    catalog_root = _write_catalog(tmp_path, checksum="0" * 64)
    monkeypatch.setenv("ZMART_EDGE_FIRMWARE_CATALOG_DIR", str(catalog_root))
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    import app.router_v2_device_ota as ota

    monkeypatch.setattr(ota, "get_device_onboarding_context", lambda device_id: {
        "device_id": device_id,
        "device_type": "nilan",
        "local_url": "http://192.168.10.142",
    })
    incompatible = client.post(
        "/api/v2/devices/zmartify-hvac-nilan-01/ota/stage-catalog",
        headers=headers,
        json={"catalog_id": "ahc9000", "version": "1.2.3"},
    )
    assert incompatible.status_code == 400

    monkeypatch.setattr(ota, "get_device_onboarding_context", lambda device_id: {
        "device_id": device_id,
        "device_type": "ahc9000",
        "local_url": "http://192.168.10.57",
    })
    bad_checksum = client.post(
        "/api/v2/devices/zmartify-hvac-ahc9000-01/ota/stage-catalog",
        headers=headers,
        json={"catalog_id": "ahc9000", "version": "1.2.3"},
    )
    assert bad_checksum.status_code == 503
    assert "checksum mismatch" in bad_checksum.json()["detail"]
