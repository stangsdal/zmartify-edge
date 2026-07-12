from __future__ import annotations

from datetime import datetime, timezone
import json
import uuid
from typing import Any

from app.db import get_connection
from app.registry import RegistryNotFoundError

_IRRIGATION_RUN_EMIT_HOOK = None


def set_irrigation_run_emit_hook(run_hook=None) -> None:
    global _IRRIGATION_RUN_EMIT_HOOK
    _IRRIGATION_RUN_EMIT_HOOK = run_hook


def _emit_irrigation_run_event(payload: dict[str, Any]) -> None:
    if _IRRIGATION_RUN_EMIT_HOOK is None:
        return
    try:
        _IRRIGATION_RUN_EMIT_HOOK(payload)
    except Exception:
        pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_device(conn: Any, device_external_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id, device_id, site_id FROM devices WHERE device_id = ?",
        (device_external_id,),
    ).fetchone()
    if row is None:
        raise RegistryNotFoundError("device not found")
    return {"id": int(row["id"]), "device_id": row["device_id"], "site_id": row["site_id"]}


def _resolve_program(conn: Any, device_pk_id: int, program_id: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT id, uuid, name, enabled, seasonal_adjustment, weather_mode, revision, created_at, updated_at
        FROM irrigation_programs
        WHERE device_id = ? AND uuid = ?
        """,
        (device_pk_id, program_id),
    ).fetchone()
    if row is None:
        raise RegistryNotFoundError("irrigation program not found")
    return {
        "id": int(row["id"]),
        "program_id": row["uuid"],
        "name": row["name"],
        "enabled": bool(row["enabled"]),
        "seasonal_adjustment": float(row["seasonal_adjustment"]),
        "weather_mode": row["weather_mode"],
        "revision": int(row["revision"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _resolve_site(conn: Any, site_ref: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT id, uuid, slug, name
        FROM sites
        WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?
        """,
        (site_ref, site_ref, site_ref),
    ).fetchone()
    if row is None:
        raise RegistryNotFoundError("site not found")
    return {
        "id": int(row["id"]),
        "site_id": row["uuid"] or row["slug"] or str(row["id"]),
        "site_name": row["name"],
    }


def list_irrigation_zones(device_external_id: str) -> list[dict[str, Any]]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        rows = conn.execute(
            """
            SELECT uuid, local_ref, name, enabled, metadata_json, created_at, updated_at
            FROM irrigation_zones
            WHERE device_id = ?
            ORDER BY id
            """,
            (device["id"],),
        ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except json.JSONDecodeError:
            metadata = {}
        result.append(
            {
                "zone_id": row["uuid"],
                "local_ref": row["local_ref"],
                "name": row["name"],
                "enabled": bool(row["enabled"]),
                "metadata": metadata,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )
    return result


def upsert_irrigation_zone(
    device_external_id: str,
    *,
    local_ref: str,
    name: str,
    enabled: bool = True,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata_json = json.dumps(metadata or {}, separators=(",", ":"), sort_keys=True)
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            "SELECT id, uuid FROM irrigation_zones WHERE device_id = ? AND local_ref = ?",
            (device["id"], local_ref),
        ).fetchone()
        if row is None:
            zone_uuid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO irrigation_zones(uuid, device_id, local_ref, name, enabled, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (zone_uuid, device["id"], local_ref, name, 1 if enabled else 0, metadata_json),
            )
        else:
            zone_uuid = row["uuid"]
            conn.execute(
                """
                UPDATE irrigation_zones
                SET name = ?, enabled = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (name, 1 if enabled else 0, metadata_json, row["id"]),
            )
        conn.commit()

    zones = list_irrigation_zones(device_external_id)
    for zone in zones:
        if zone["zone_id"] == zone_uuid:
            return zone
    raise RegistryNotFoundError("irrigation zone not found")


def list_irrigation_programs(device_external_id: str) -> list[dict[str, Any]]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        rows = conn.execute(
            """
            SELECT uuid, name, enabled, seasonal_adjustment, weather_mode, revision, created_at, updated_at
            FROM irrigation_programs
            WHERE device_id = ?
            ORDER BY id
            """,
            (device["id"],),
        ).fetchall()
    return [
        {
            "program_id": row["uuid"],
            "name": row["name"],
            "enabled": bool(row["enabled"]),
            "seasonal_adjustment": float(row["seasonal_adjustment"]),
            "weather_mode": row["weather_mode"],
            "revision": int(row["revision"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def get_irrigation_program(device_external_id: str, program_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        return _resolve_program(conn, device["id"], program_id)


def create_irrigation_program(
    device_external_id: str,
    *,
    name: str,
    enabled: bool = True,
    seasonal_adjustment: float = 1.0,
    weather_mode: str = "automatic",
) -> dict[str, Any]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program_uuid = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO irrigation_programs(uuid, device_id, name, enabled, seasonal_adjustment, weather_mode)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                program_uuid,
                device["id"],
                name,
                1 if enabled else 0,
                float(seasonal_adjustment),
                weather_mode,
            ),
        )
        conn.commit()

    programs = list_irrigation_programs(device_external_id)
    for program in programs:
        if program["program_id"] == program_uuid:
            return program
    raise RegistryNotFoundError("irrigation program not found")


def update_irrigation_program(
    device_external_id: str,
    program_id: str,
    *,
    name: str,
    enabled: bool,
    seasonal_adjustment: float,
    weather_mode: str,
) -> dict[str, Any]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        conn.execute(
            """
            UPDATE irrigation_programs
            SET name = ?, enabled = ?, seasonal_adjustment = ?, weather_mode = ?, revision = revision + 1, updated_at = ?
            WHERE id = ?
            """,
            (name, 1 if enabled else 0, float(seasonal_adjustment), weather_mode, _now_iso(), program["id"]),
        )
        conn.commit()
    return get_irrigation_program(device_external_id, program_id)


def delete_irrigation_program(device_external_id: str, program_id: str) -> None:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        conn.execute("DELETE FROM irrigation_programs WHERE id = ?", (program["id"],))
        conn.commit()


def list_program_schedules(device_external_id: str, program_id: str) -> list[dict[str, Any]]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        rows = conn.execute(
            """
            SELECT uuid, name, start_local_time, weekdays_json, enabled, created_at, updated_at
            FROM irrigation_schedule_rules
            WHERE program_id = ?
            ORDER BY id
            """,
            (program["id"],),
        ).fetchall()

    schedules: list[dict[str, Any]] = []
    for row in rows:
        try:
            weekdays = json.loads(row["weekdays_json"] or "[]")
        except json.JSONDecodeError:
            weekdays = []
        schedules.append(
            {
                "schedule_id": row["uuid"],
                "name": row["name"],
                "start_local_time": row["start_local_time"],
                "weekdays": weekdays if isinstance(weekdays, list) else [],
                "enabled": bool(row["enabled"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )
    return schedules


def create_program_schedule(
    device_external_id: str,
    program_id: str,
    *,
    name: str,
    start_local_time: str,
    weekdays: list[int],
    enabled: bool = True,
) -> dict[str, Any]:
    weekdays_json = json.dumps([int(day) for day in weekdays], separators=(",", ":"))
    schedule_uuid = str(uuid.uuid4())

    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        conn.execute(
            """
            INSERT INTO irrigation_schedule_rules(uuid, program_id, name, start_local_time, weekdays_json, enabled)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (schedule_uuid, program["id"], name, start_local_time, weekdays_json, 1 if enabled else 0),
        )
        conn.commit()

    schedules = list_program_schedules(device_external_id, program_id)
    for schedule in schedules:
        if schedule["schedule_id"] == schedule_uuid:
            return schedule
    raise RegistryNotFoundError("irrigation schedule not found")


def create_program_run(device_external_id: str, program_id: str, *, trigger_type: str = "manual") -> dict[str, Any]:
    run_uuid = str(uuid.uuid4())
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)

        cur = conn.execute(
            """
            INSERT INTO irrigation_runs(uuid, device_id, program_id, trigger_type, status, started_at, updated_at)
            VALUES (?, ?, ?, ?, 'running', ?, ?)
            """,
            (run_uuid, device["id"], program["id"], trigger_type, now, now),
        )
        run_pk_id = int(cur.lastrowid)

        zone_rows = conn.execute(
            """
            SELECT id, name
            FROM irrigation_zones
            WHERE device_id = ? AND enabled = 1
            ORDER BY id
            """,
            (device["id"],),
        ).fetchall()
        for zone_row in zone_rows:
            conn.execute(
                """
                INSERT INTO irrigation_run_steps(uuid, run_id, zone_id, zone_name, duration_seconds, status)
                VALUES (?, ?, ?, ?, ?, 'planned')
                """,
                (str(uuid.uuid4()), run_pk_id, int(zone_row["id"]), str(zone_row["name"]), 600),
            )
        conn.commit()

    runs = list_irrigation_runs(device_external_id, limit=20)
    for run in runs:
        if run["run_id"] == run_uuid:
            _emit_irrigation_run_event(
                {
                    "event_type": "irrigation.run.updated",
                    "action": "started",
                    "device_id": device_external_id,
                    "site_id": device.get("site_id"),
                    "run": run,
                }
            )
            return run
    raise RegistryNotFoundError("irrigation run not found")


def list_irrigation_runs(device_external_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 500))
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        rows = conn.execute(
            """
            SELECT r.id, r.uuid, p.uuid AS program_uuid, r.trigger_type, r.status, r.started_at, r.finished_at,
                   r.total_runtime_seconds, r.created_at, r.updated_at
            FROM irrigation_runs r
            LEFT JOIN irrigation_programs p ON p.id = r.program_id
            WHERE r.device_id = ?
            ORDER BY r.id DESC
            LIMIT ?
            """,
            (device["id"], safe_limit),
        ).fetchall()

        runs: list[dict[str, Any]] = []
        for row in rows:
            step_rows = conn.execute(
                """
                SELECT uuid, zone_name, duration_seconds, status, started_at, finished_at
                FROM irrigation_run_steps
                WHERE run_id = ?
                ORDER BY id
                """,
                (int(row["id"]),),
            ).fetchall()
            runs.append(
                {
                    "run_id": row["uuid"],
                    "program_id": row["program_uuid"],
                    "trigger_type": row["trigger_type"],
                    "status": row["status"],
                    "started_at": row["started_at"],
                    "finished_at": row["finished_at"],
                    "total_runtime_seconds": row["total_runtime_seconds"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "steps": [
                        {
                            "step_id": step_row["uuid"],
                            "zone_name": step_row["zone_name"],
                            "duration_seconds": int(step_row["duration_seconds"]),
                            "status": step_row["status"],
                            "started_at": step_row["started_at"],
                            "finished_at": step_row["finished_at"],
                        }
                        for step_row in step_rows
                    ],
                }
            )
    return runs


def complete_irrigation_run(device_external_id: str, run_id: str, *, status: str = "completed") -> dict[str, Any]:
    site_pk_id: int | None = None
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        site_pk_id = int(device["site_id"]) if device.get("site_id") is not None else None
        row = conn.execute(
            """
            SELECT id, started_at
            FROM irrigation_runs
            WHERE device_id = ? AND uuid = ?
            """,
            (device["id"], run_id),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("irrigation run not found")

        started_at = str(row["started_at"])
        total_runtime_seconds = None
        try:
            started_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            total_runtime_seconds = max(0, int((datetime.now(timezone.utc) - started_dt).total_seconds()))
        except Exception:
            total_runtime_seconds = None

        now = _now_iso()
        conn.execute(
            """
            UPDATE irrigation_runs
            SET status = ?, finished_at = ?, total_runtime_seconds = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, now, total_runtime_seconds, now, int(row["id"])),
        )
        conn.execute(
            """
            UPDATE irrigation_run_steps
            SET status = CASE WHEN status = 'planned' THEN 'skipped' ELSE status END,
                finished_at = COALESCE(finished_at, ?)
            WHERE run_id = ?
            """,
            (now, int(row["id"])),
        )
        conn.commit()

    runs = list_irrigation_runs(device_external_id, limit=100)
    for run in runs:
        if run["run_id"] == run_id:
            _emit_irrigation_run_event(
                {
                    "event_type": "irrigation.run.updated",
                    "action": "completed",
                    "device_id": device_external_id,
                    "site_id": site_pk_id,
                    "run": run,
                }
            )
            return run
    raise RegistryNotFoundError("irrigation run not found")


def get_site_irrigation_overview(site_ref: str) -> dict[str, Any]:
    with get_connection() as conn:
        site = _resolve_site(conn, site_ref)

        device_rows = conn.execute(
            "SELECT id, device_id, display_name FROM devices WHERE site_id = ? ORDER BY id",
            (site["id"],),
        ).fetchall()
        device_ids = [int(row["id"]) for row in device_rows]

        if not device_ids:
            return {
                "site_id": site["site_id"],
                "site_name": site["site_name"],
                "device_count": 0,
                "zone_count": 0,
                "program_count": 0,
                "active_run_count": 0,
                "devices": [],
            }

        placeholders = ",".join("?" for _ in device_ids)
        zone_count_row = conn.execute(
            f"SELECT COUNT(*) AS count FROM irrigation_zones WHERE device_id IN ({placeholders})",
            tuple(device_ids),
        ).fetchone()
        program_count_row = conn.execute(
            f"SELECT COUNT(*) AS count FROM irrigation_programs WHERE device_id IN ({placeholders})",
            tuple(device_ids),
        ).fetchone()
        active_run_row = conn.execute(
            f"SELECT COUNT(*) AS count FROM irrigation_runs WHERE device_id IN ({placeholders}) AND status = 'running'",
            tuple(device_ids),
        ).fetchone()

    return {
        "site_id": site["site_id"],
        "site_name": site["site_name"],
        "device_count": len(device_ids),
        "zone_count": int(zone_count_row["count"] if zone_count_row is not None else 0),
        "program_count": int(program_count_row["count"] if program_count_row is not None else 0),
        "active_run_count": int(active_run_row["count"] if active_run_row is not None else 0),
        "devices": [
            {
                "device_id": row["device_id"],
                "display_name": row["display_name"],
            }
            for row in device_rows
        ],
    }
