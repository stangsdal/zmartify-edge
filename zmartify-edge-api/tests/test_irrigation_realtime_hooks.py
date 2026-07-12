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
