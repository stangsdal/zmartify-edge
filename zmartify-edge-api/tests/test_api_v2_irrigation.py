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


def _site_ref() -> str:
    return "site-irrig"


def test_irrigation_v2_zone_and_program_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    device_id = _seed_device(client)
    headers = _auth_headers()

    overview_initial = client.get(f"/api/v2/sites/{_site_ref()}/irrigation/overview", headers=headers)
    assert overview_initial.status_code == 200
    assert overview_initial.json()["device_count"] == 1

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

    overview_after_zone = client.get(f"/api/v2/sites/{_site_ref()}/irrigation/overview", headers=headers)
    assert overview_after_zone.status_code == 200
    assert overview_after_zone.json()["zone_count"] >= 1

    outputs_empty = client.get(f"/api/v2/devices/{device_id}/irrigation/outputs", headers=headers)
    assert outputs_empty.status_code == 200
    assert outputs_empty.json()["outputs"] == []

    upsert_output = client.put(
        f"/api/v2/devices/{device_id}/irrigation/outputs",
        headers=headers,
        json={
            "local_ref": "out-1",
            "name": "Valve 1",
            "enabled": True,
            "active": True,
            "is_master_valve": False,
            "metadata": {"line": "north"},
        },
    )
    assert upsert_output.status_code == 200
    assert upsert_output.json()["output"]["name"] == "Valve 1"

    upsert_master = client.put(
        f"/api/v2/devices/{device_id}/irrigation/outputs",
        headers=headers,
        json={
            "local_ref": "master",
            "name": "Master Valve",
            "enabled": True,
            "active": False,
            "is_master_valve": True,
            "metadata": {"line": "main"},
        },
    )
    assert upsert_master.status_code == 200
    assert upsert_master.json()["output"]["is_master_valve"] is True

    outputs = client.get(f"/api/v2/devices/{device_id}/irrigation/outputs", headers=headers)
    assert outputs.status_code == 200
    assert len(outputs.json()["outputs"]) == 2

    set_hydraulics = client.post(
        f"/api/v2/devices/{device_id}/irrigation/hydraulics",
        headers=headers,
        json={"flow_lpm": 12.2, "pressure_bar": 2.4, "water_liters": 120.0},
    )
    assert set_hydraulics.status_code == 200
    assert set_hydraulics.json()["flow_lpm"] == 12.2

    set_power = client.post(
        f"/api/v2/devices/{device_id}/irrigation/power",
        headers=headers,
        json={"voltage_rms_v": 230.0, "current_rms_a": 0.8, "real_power_w": 160.0, "power_factor": 0.87},
    )
    assert set_power.status_code == 200
    assert set_power.json()["real_power_w"] == 160.0

    set_weather = client.post(
        f"/api/v2/devices/{device_id}/irrigation/weather",
        headers=headers,
        json={"temperature_c": 18.5, "rain_mm": 0.2, "wind_mps": 4.1, "eto_mm": 2.3},
    )
    assert set_weather.status_code == 200
    assert set_weather.json()["temperature_c"] == 18.5

    rain_delay = client.post(
        f"/api/v2/devices/{device_id}/irrigation/rain-delay",
        headers=headers,
        json={"delay_hours": 12, "reason": "Forecast rain"},
    )
    assert rain_delay.status_code == 200
    assert rain_delay.json()["delay_hours"] == 12

    hydraulics = client.get(f"/api/v2/devices/{device_id}/irrigation/hydraulics", headers=headers)
    assert hydraulics.status_code == 200
    assert hydraulics.json()["pressure_bar"] == 2.4

    power = client.get(f"/api/v2/devices/{device_id}/irrigation/power", headers=headers)
    assert power.status_code == 200
    assert power.json()["power_factor"] == 0.87

    weather = client.get(f"/api/v2/devices/{device_id}/irrigation/weather", headers=headers)
    assert weather.status_code == 200
    assert weather.json()["rain_delay"] is not None

    overview_with_ops = client.get(f"/api/v2/sites/{_site_ref()}/irrigation/overview", headers=headers)
    assert overview_with_ops.status_code == 200
    overview_device = overview_with_ops.json()["devices"][0]
    assert overview_device["outputs"]["total"] == 2
    assert overview_device["outputs"]["active"] == 1
    assert overview_device["hydraulics"]["pressure_bar"] == 2.4
    assert overview_device["power"]["real_power_w"] == 160.0
    assert overview_device["weather"]["temperature_c"] == 18.5
    assert overview_device["rain_delay"] is not None

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
    program_id = str(program["program_id"])

    get_program = client.get(f"/api/v2/devices/{device_id}/irrigation/programs/{program_id}", headers=headers)
    assert get_program.status_code == 200
    assert get_program.json()["program"]["program_id"] == program_id

    update_program = client.put(
        f"/api/v2/devices/{device_id}/irrigation/programs/{program_id}",
        headers=headers,
        json={
            "name": "Morning Cycle Updated",
            "enabled": False,
            "seasonal_adjustment": 1.1,
            "weather_mode": "manual_override",
        },
    )
    assert update_program.status_code == 200
    assert update_program.json()["program"]["name"] == "Morning Cycle Updated"
    assert update_program.json()["program"]["enabled"] is False

    schedules_empty = client.get(
        f"/api/v2/devices/{device_id}/irrigation/programs/{program_id}/schedules",
        headers=headers,
    )
    assert schedules_empty.status_code == 200
    assert schedules_empty.json()["schedules"] == []

    create_schedule = client.post(
        f"/api/v2/devices/{device_id}/irrigation/programs/{program_id}/schedules",
        headers=headers,
        json={
            "name": "Weekday AM",
            "start_local_time": "06:30",
            "weekdays": [1, 2, 3, 4, 5],
            "enabled": True,
        },
    )
    assert create_schedule.status_code == 200
    assert create_schedule.json()["schedule"]["name"] == "Weekday AM"

    run_start = client.post(
        f"/api/v2/devices/{device_id}/irrigation/programs/{program_id}/run",
        headers=headers,
        json={"trigger_type": "manual"},
    )
    assert run_start.status_code == 200
    run_id = run_start.json()["run"]["run_id"]
    assert isinstance(run_start.json()["run"].get("steps"), list)

    overview_running = client.get(f"/api/v2/sites/{_site_ref()}/irrigation/overview", headers=headers)
    assert overview_running.status_code == 200
    assert overview_running.json()["active_run_count"] >= 1

    list_runs = client.get(f"/api/v2/devices/{device_id}/irrigation/runs", headers=headers)
    assert list_runs.status_code == 200
    assert len(list_runs.json()["runs"]) >= 1

    complete_run = client.post(
        f"/api/v2/devices/{device_id}/irrigation/runs/{run_id}/complete",
        headers=headers,
    )
    assert complete_run.status_code == 200
    assert complete_run.json()["run"]["status"] == "completed"

    overview_completed = client.get(f"/api/v2/sites/{_site_ref()}/irrigation/overview", headers=headers)
    assert overview_completed.status_code == 200
    assert overview_completed.json()["active_run_count"] == 0

    list_programs = client.get(f"/api/v2/devices/{device_id}/irrigation/programs", headers=headers)
    assert list_programs.status_code == 200
    assert len(list_programs.json()["programs"]) == 1

    delete_program = client.delete(f"/api/v2/devices/{device_id}/irrigation/programs/{program_id}", headers=headers)
    assert delete_program.status_code == 200
    assert delete_program.json()["deleted"] is True

    list_programs_after_delete = client.get(f"/api/v2/devices/{device_id}/irrigation/programs", headers=headers)
    assert list_programs_after_delete.status_code == 200
    assert list_programs_after_delete.json()["programs"] == []


def test_irrigation_v2_404_on_unknown_device(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = _auth_headers()

    response = client.get("/api/v2/devices/missing/irrigation/zones", headers=headers)
    assert response.status_code == 404
