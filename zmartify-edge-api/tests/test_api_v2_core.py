from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-core.sqlite"
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


def test_api_v2_domain_site_device_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    created_domain = client.post(
        "/api/v2/domains",
        headers=headers,
        json={"slug": "house-v2", "name": "House V2"},
    )
    assert created_domain.status_code == 201
    domain = created_domain.json()
    assert isinstance(domain["domain_ref"], str)

    listed_domains = client.get("/api/v2/domains", headers=headers)
    assert listed_domains.status_code == 200
    assert len(listed_domains.json()) == 1

    created_site = client.post(
        f"/api/v2/domains/{domain['domain_ref']}/sites",
        headers=headers,
        json={"slug": "main-v2", "name": "Main V2"},
    )
    assert created_site.status_code == 201
    site = created_site.json()
    assert isinstance(site["site_ref"], str)

    created_device = client.post(
        "/api/v2/devices",
        headers=headers,
        json={
            "device_id": "hvac-gateway-v2core01",
            "display_name": "HVAC Gateway V2",
            "mac": "AA:BB:CC:DD:EE:FF",
            "firmware_version": "1.0.0",
        },
    )
    assert created_device.status_code == 201

    assign = client.post(
        "/api/v2/devices/hvac-gateway-v2core01/assign-site",
        headers=headers,
        json={"site_ref": site["site_ref"]},
    )
    assert assign.status_code == 200
    assert assign.json()["site_id"] is not None

    listed_devices = client.get("/api/v2/devices", headers=headers)
    assert listed_devices.status_code == 200
    assert len(listed_devices.json()) == 1


def test_api_v2_requires_auth(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    resp = client.get("/api/v2/domains")
    assert resp.status_code == 401
