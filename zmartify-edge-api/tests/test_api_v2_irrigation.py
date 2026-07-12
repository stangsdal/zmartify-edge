from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-irrigation.sqlite"
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


def _auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer emergency-token"}


def _seed_device(client: TestClient) -> str:
    from app import db

    with db.get_connection() as conn:
        domain_id = conn.execute("INSERT INTO domains(uuid, slug, name) VALUES ('dom-irrig', 'dom-irrig', 'Dom Irrig')").lastrowid
        site_id = conn.execute(
            "INSERT INTO sites(uuid, domain_id, slug, name) VALUES ('site-irrig', ?, 'site-irrig', 'Site Irrig')",
            (domain_id,),
        ).lastrowid
        conn.execute(
            """
            INSERT INTO devices(uuid, device_id, display_name, site_id, device_type, integration_mode)
            VALUES ('dev-irrig', 'dev-irrig', 'Dev Irrig', ?, 'irrigation', 'mqtt')
            """,
            (site_id,),
        )
        conn.commit()
    return "dev-irrig"


def test_irrigation_v2_zone_and_program_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    device_id = _seed_device(client)
    headers = _auth_headers()

    list_empty = client.get(f"/api/v2/devices/{device_id}/irrigation/zones", headers=headers)
    assert list_empty.status_code == 200
    assert list_empty.json()["zones"] == []

    upsert_zone = client.put(
        f"/api/v2/devices/{device_id}/irrigation/zones",
        headers=headers,
        json={
            "local_ref": "zone-a",
            "name": "Front Lawn",
            "enabled": True,
            "metadata": {"flow_lpm": 12.5},
        },
    )
    assert upsert_zone.status_code == 200
    zone = upsert_zone.json()["zone"]
    assert zone["local_ref"] == "zone-a"
    assert zone["name"] == "Front Lawn"

    list_zones = client.get(f"/api/v2/devices/{device_id}/irrigation/zones", headers=headers)
    assert list_zones.status_code == 200
    assert len(list_zones.json()["zones"]) == 1

    list_programs_empty = client.get(f"/api/v2/devices/{device_id}/irrigation/programs", headers=headers)
    assert list_programs_empty.status_code == 200
    assert list_programs_empty.json()["programs"] == []

    create_program = client.post(
        f"/api/v2/devices/{device_id}/irrigation/programs",
        headers=headers,
        json={
            "name": "Morning Cycle",
            "enabled": True,
            "seasonal_adjustment": 0.9,
            "weather_mode": "automatic",
        },
    )
    assert create_program.status_code == 200
    program = create_program.json()["program"]
    assert program["name"] == "Morning Cycle"
    assert program["enabled"] is True

    list_programs = client.get(f"/api/v2/devices/{device_id}/irrigation/programs", headers=headers)
    assert list_programs.status_code == 200
    assert len(list_programs.json()["programs"]) == 1


def test_irrigation_v2_404_on_unknown_device(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = _auth_headers()

    response = client.get("/api/v2/devices/missing/irrigation/zones", headers=headers)
    assert response.status_code == 404
