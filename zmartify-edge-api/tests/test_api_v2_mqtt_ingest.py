from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-mqtt-ingest.sqlite"
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


def _seed_device(client: TestClient, headers: dict[str, str], suffix: str = "v2mi") -> str:
    domain = client.post("/domains", headers=headers, json={"slug": f"domain-{suffix}", "name": "Domain"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(
        f"/domains/{domain_id}/sites",
        headers=headers,
        json={"slug": f"site-{suffix}", "name": "Site"},
    )
    assert site.status_code == 201
    site_id = site.json()["id"]

    device_id = f"hvac-gateway-{suffix}"
    created = client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": device_id,
            "display_name": "Gateway",
            "mac": "AA:BB:CC:DD:EE:AA",
            "firmware_version": "1.0.0",
        },
    )
    assert created.status_code == 201

    assigned = client.post(f"/devices/{device_id}/assign-site", headers=headers, json={"site_id": site_id})
    assert assigned.status_code == 200
    return device_id


def test_v2_mqtt_reported_state_ingest_updates_hvac_and_irrigation(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}
    device_id = _seed_device(client, headers, suffix="v2mi01")

    reported = client.post(
        f"/api/v2/devices/{device_id}/ingest/mqtt/reported-state",
        headers=headers,
        json={
            "schema_version": "2.0",
            "source_timestamp": "2026-07-12T15:00:00Z",
            "firmware_version": "2.1.0",
            "hvac": {
                "zones": [{"zone_id": 1, "target_temperature_c": 22.5}],
                "channels": [{"channel_id": 1, "active": True}],
            },
            "irrigation": {
                "outputs": [
                    {"local_ref": "out-1", "name": "Valve 1", "active": True, "enabled": True},
                    {"local_ref": "master", "name": "Master", "is_master_valve": True, "enabled": True},
                ],
                "weather": {
                    "temperature_c": 19.4,
                    "rain_mm": 0.2,
                    "wind_mps": 3.3,
                    "eto_mm": 2.2,
                },
                "rain_delay": {"delay_hours": 8, "reason": "Forecast"},
            },
            "hydraulics": {"flow_lpm": 10.3, "pressure_bar": 2.4, "water_liters": 42.0},
            "power": {"voltage_rms_v": 230.0, "current_rms_a": 0.6, "real_power_w": 120.0, "power_factor": 0.89},
        },
    )

    assert reported.status_code == 200
    body = reported.json()
    assert body["hvac"]["applied"] is True
    assert body["irrigation"]["outputs_updated"] == 2
    assert body["irrigation"]["hydraulics_updated"] is True
    assert body["irrigation"]["power_updated"] is True
    assert body["irrigation"]["weather_updated"] is True
    assert body["irrigation"]["rain_delay_set"] is True

    weather = client.get(f"/api/v2/devices/{device_id}/irrigation/weather", headers=headers)
    assert weather.status_code == 200
    assert weather.json()["temperature_c"] == 19.4
    assert weather.json()["rain_delay"] is not None

    outputs = client.get(f"/api/v2/devices/{device_id}/irrigation/outputs", headers=headers)
    assert outputs.status_code == 200
    assert len(outputs.json()["outputs"]) == 2


def test_v2_mqtt_setpoint_outcome_ingest_logs_outcome(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("ZMART_EDGE_FORWARD_SETPOINT_TO_MQTT", "1")
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}
    device_id = _seed_device(client, headers, suffix="v2mi02")

    zones = client.get(f"/devices/{device_id}/zones", headers=headers)
    assert zones.status_code == 200
    zone_ref = zones.json()[0]["zone_uuid"]

    import main

    monkeypatch.setattr(main, "publish_setpoint_command", lambda *_args, **_kwargs: None)

    pending = client.post(
        f"/mobile/zones/{zone_ref}/setpoint",
        headers=headers,
        json={"target_temperature_c": 23.0},
    )
    assert pending.status_code == 200
    assert pending.json()["pending"] is True

    ingest_outcome = client.post(
        f"/api/v2/devices/{device_id}/ingest/mqtt/hvac/zones/1/setpoint-outcome",
        headers=headers,
        json={
            "schema_version": "2.0",
            "command_id": "cmd-xyz",
            "result": "rejected",
            "detail": "locked",
            "source_timestamp": "2026-07-12T15:05:00Z",
            "requested_target_temperature_c": 23.0,
            "confirmed_target_temperature_c": 21.5,
        },
    )
    assert ingest_outcome.status_code == 200
    assert ingest_outcome.json()["zone_id"] == 1

    events = client.get("/events/recent", headers=headers, params={"event_type": "setpoint_write_failed"})
    assert events.status_code == 200
    assert len(events.json()) >= 1


def test_v2_mqtt_irrigation_outcome_ingest_maps_alarm_to_controller_fault(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}
    device_id = _seed_device(client, headers, suffix="v2mi03")

    ingest_outcome = client.post(
        f"/api/v2/devices/{device_id}/ingest/mqtt/irrigation/outcome",
        headers=headers,
        json={
            "schema_version": "2.0",
            "source_timestamp": "2026-07-12T15:10:00Z",
            "event_type": "pump.fault",
            "severity": "alarm",
            "result": "failed",
            "detail": "dry-run protection",
            "zone_id": 1,
            "payload": {"fault_code": "PUMP_DRY_RUN"},
        },
    )

    assert ingest_outcome.status_code == 200
    assert ingest_outcome.json()["mapped_event_type"] == "controller_fault"

    events = client.get("/events/recent", headers=headers, params={"event_type": "controller_fault"})
    assert events.status_code == 200
    assert len(events.json()) >= 1
