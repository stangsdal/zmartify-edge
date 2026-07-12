from __future__ import annotations

from pathlib import Path

from app import db
from app.auth import ensure_bootstrap_owner
from app.db import initialize_database
from app.irrigation_domain import (
    create_irrigation_program,
    create_program_run,
    complete_irrigation_run,
    set_irrigation_run_emit_hook,
    set_irrigation_status_emit_hook,
    set_irrigation_rain_delay,
    upsert_irrigation_hydraulics_state,
    upsert_irrigation_output_state,
    upsert_irrigation_power_state,
    upsert_irrigation_weather_state,
    upsert_irrigation_zone,
)


def _setup_db(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "irrigation-realtime-hooks.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    initialize_database()
    ensure_bootstrap_owner()


def _seed_irrigation_device() -> str:
    with db.get_connection() as conn:
        domain_id = conn.execute("INSERT INTO domains(uuid, slug, name) VALUES ('dom-irrig-hook', 'dom-irrig-hook', 'Dom Hook')").lastrowid
        site_id = conn.execute(
            "INSERT INTO sites(uuid, domain_id, slug, name) VALUES ('site-irrig-hook', ?, 'site-irrig-hook', 'Site Hook')",
            (domain_id,),
        ).lastrowid
        conn.execute(
            """
            INSERT INTO devices(uuid, device_id, display_name, site_id, device_type, integration_mode)
            VALUES ('dev-irrig-hook', 'dev-irrig-hook', 'Irrig Hook Device', ?, 'irrigation', 'mqtt')
            """,
            (site_id,),
        )
        conn.commit()
    return "dev-irrig-hook"


def test_irrigation_run_emits_realtime_hook_events(monkeypatch, tmp_path: Path):
    _setup_db(monkeypatch, tmp_path)
    device_id = _seed_irrigation_device()

    upsert_irrigation_zone(device_id, local_ref="zone-1", name="Front", enabled=True)
    program = create_irrigation_program(device_id, name="Morning", enabled=True, seasonal_adjustment=1.0, weather_mode="automatic")

    captured: list[dict] = []

    def _hook(event: dict) -> None:
        captured.append(event)

    set_irrigation_run_emit_hook(_hook)
    try:
        run = create_program_run(device_id, program["program_id"], trigger_type="manual")
        complete_irrigation_run(device_id, run["run_id"], status="completed")
    finally:
        set_irrigation_run_emit_hook(None)

    assert len(captured) >= 2
    assert captured[0]["event_type"] == "irrigation.run.updated"
    assert captured[0]["action"] == "started"
    assert captured[-1]["action"] == "completed"


def test_irrigation_status_emits_realtime_hook_events(monkeypatch, tmp_path: Path):
    _setup_db(monkeypatch, tmp_path)
    device_id = _seed_irrigation_device()

    captured: list[dict] = []

    def _hook(event: dict) -> None:
        captured.append(event)

    set_irrigation_status_emit_hook(_hook)
    try:
        upsert_irrigation_output_state(device_id, local_ref="out-1", name="Valve 1", enabled=True, active=False)
        upsert_irrigation_hydraulics_state(device_id, flow_lpm=9.3, pressure_bar=2.1, water_liters=80.0)
        upsert_irrigation_power_state(device_id, voltage_rms_v=230.0, current_rms_a=0.7, real_power_w=140.0, power_factor=0.86)
        upsert_irrigation_weather_state(device_id, temperature_c=17.0, rain_mm=0.0, wind_mps=3.4, eto_mm=2.0)
        set_irrigation_rain_delay(device_id, delay_hours=6, reason="rain")
    finally:
        set_irrigation_status_emit_hook(None)

    assert len(captured) == 5
    assert captured[0]["event_type"] == "irrigation.status.updated"
    assert captured[0]["action"] == "output.upserted"
    assert captured[0]["state_type"] == "outputs"
    assert captured[-1]["action"] == "rain_delay.set"
    assert captured[-1]["state_type"] == "weather"
