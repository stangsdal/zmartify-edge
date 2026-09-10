from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(tmp_path / "nilan.sqlite"))
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")
    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner
    initialize_database()
    ensure_bootstrap_owner()
    from main import app
    return TestClient(app)


def _seed_device(client: TestClient, headers: dict[str, str], suffix: str) -> str:
    domain = client.post("/domains", headers=headers, json={"slug": f"nilan-domain-{suffix}", "name": "Nilan"}).json()
    site = client.post(f"/domains/{domain['id']}/sites", headers=headers, json={"slug": "home", "name": "Home"}).json()
    device_id = f"zmartify-hvac-nilan-{suffix}"
    assert client.post("/devices", headers=headers, json={"device_id": device_id, "display_name": "Comfort 302"}).status_code == 201
    assert client.post(f"/devices/{device_id}/assign-site", headers=headers, json={"site_id": site["id"]}).status_code == 200
    return device_id


def test_nilan_state_is_ingested_and_readable(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(tmp_path / "nilan.sqlite"))
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")
    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner
    initialize_database()
    ensure_bootstrap_owner()
    from main import app
    client = TestClient(app)
    headers = {"Authorization": "Bearer emergency-token"}
    domain = client.post("/domains", headers=headers, json={"slug": "nilan-domain", "name": "Nilan"}).json()
    site = client.post(f"/domains/{domain['id']}/sites", headers=headers, json={"slug": "home", "name": "Home"}).json()
    device_id = "zmartify-hvac-nilan-aabbcc"
    assert client.post("/devices", headers=headers, json={"device_id": device_id, "display_name": "Comfort 302"}).status_code == 201
    assert client.post(f"/devices/{device_id}/assign-site", headers=headers, json={"site_id": site["id"]}).status_code == 200
    response = client.post(
        f"/api/v2/devices/{device_id}/ingest/mqtt/reported-state",
        headers=headers,
        json={"device_id": device_id, "online": True, "controller_online": True, "ventilation_level": 2,
              "actual_inlet_level": 40, "actual_exhaust_level": 30, "room_temperature_c": None,
              "co2_ppm": None, "humidity_pct": 48.0, "status": "fresh"},
    )
    assert response.status_code == 200
    assert response.json()["nilan"]["applied"] is True
    state = client.get(f"/api/v2/devices/{device_id}/hvac/nilan", headers=headers)
    assert state.status_code == 200
    assert state.json()["ventilation_level"] == 2
    assert state.json()["room_temperature_c"] is None
    assert state.json()["co2_ppm"] is None


def test_canonical_nilan_v2_envelope_is_ingested(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}
    device_id = _seed_device(client, headers, suffix="nilan-envelope")
    response = client.post(
        f"/api/v2/devices/{device_id}/ingest/mqtt/reported-state",
        headers=headers,
        json={
            "schema_version": "2.0",
            "source_timestamp": "2026-08-28T12:00:00Z",
            "firmware_version": "0.3.0",
            "online": True,
            "mqtt_connected": True,
            "hvac": {"zones": [], "channels": [], "nilan": {
                "controller_online": True,
                "ventilation_level": 3,
                "run_actual": True,
                "mode_actual": 3,
                "bypass_open": True,
                "bypass_close": False,
                "t1_intake_c": 8.5,
                "t2_inlet_c": 17.2,
                "t3_exhaust_c": 21.4,
                "t4_outlet_c": 10.1,
                "t7_inlet_c": 19.8,
                "t8_outdoor_c": 7.9,
                "t9_heater_c": 24.6,
                "controller_board_temperature_c": 31.5,
                "bus_version": 21,
                "app_version_major": "02",
                "app_version_minor": "13",
                "app_version_release": "04",
                "co2_ppm": None,
                "filter_days_remaining": 283,
                "filter_interval_days": 365,
            }},
        },
    )
    assert response.status_code == 200
    assert response.json()["nilan"]["applied"] is True
    state = client.get(f"/api/v2/devices/{device_id}/hvac/nilan", headers=headers).json()
    assert state["ventilation_level"] == 3
    assert state["filter_days_remaining"] == 283
    assert state["filter_interval_days"] == 365
    assert state["run_actual"] is True
    assert state["mode_actual"] == 3
    assert state["bypass_open"] is True
    assert state["bypass_close"] is False
    assert state["t1_intake_c"] == 8.5
    assert state["t7_inlet_c"] == 19.8
    assert state["t9_heater_c"] == 24.6
    assert state["controller_board_temperature_c"] == 31.5
    assert state["bus_version"] == 21
    assert [state["app_version_major"], state["app_version_minor"], state["app_version_release"]] == ["02", "13", "04"]
