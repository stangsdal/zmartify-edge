from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import uuid
from typing import Any

from app.db import get_connection
from app.registry import RegistryNotFoundError

_IRRIGATION_RUN_EMIT_HOOK = None
_IRRIGATION_STATUS_EMIT_HOOK = None


def set_irrigation_run_emit_hook(run_hook=None) -> None:
    global _IRRIGATION_RUN_EMIT_HOOK
    _IRRIGATION_RUN_EMIT_HOOK = run_hook


def set_irrigation_status_emit_hook(status_hook=None) -> None:
    global _IRRIGATION_STATUS_EMIT_HOOK
    _IRRIGATION_STATUS_EMIT_HOOK = status_hook


def _emit_irrigation_run_event(payload: dict[str, Any]) -> None:
    if _IRRIGATION_RUN_EMIT_HOOK is None:
        return
    try:
        _IRRIGATION_RUN_EMIT_HOOK(payload)
    except Exception:
        pass


def _emit_irrigation_status_event(payload: dict[str, Any]) -> None:
    if _IRRIGATION_STATUS_EMIT_HOOK is None:
        return
    try:
        _IRRIGATION_STATUS_EMIT_HOOK(payload)
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


def _parse_str_list_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        values = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(values, list):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def list_program_zones(device_external_id: str, program_id: str) -> list[dict[str, Any]]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        rows = conn.execute(
            """
            SELECT pz.uuid, pz.sort_order, pz.duration_seconds, pz.enabled, pz.created_at, pz.updated_at,
                   z.uuid AS zone_uuid, z.local_ref, z.name, z.enabled AS zone_enabled
            FROM irrigation_program_zones pz
            JOIN irrigation_zones z ON z.id = pz.zone_id
            WHERE pz.program_id = ?
            ORDER BY pz.sort_order, pz.id
            """,
            (program["id"],),
        ).fetchall()

    return [
        {
            "program_zone_id": row["uuid"],
            "zone_id": row["zone_uuid"],
            "local_ref": row["local_ref"],
            "zone_name": row["name"],
            "zone_enabled": bool(row["zone_enabled"]),
            "sort_order": int(row["sort_order"]),
            "duration_seconds": int(row["duration_seconds"]),
            "enabled": bool(row["enabled"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def replace_program_zones(device_external_id: str, program_id: str, zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        zone_rows = conn.execute(
            "SELECT id, uuid, local_ref FROM irrigation_zones WHERE device_id = ?",
            (device["id"],),
        ).fetchall()
        zones_by_ref: dict[str, int] = {}
        for row in zone_rows:
            zones_by_ref[str(row["uuid"])] = int(row["id"])
            zones_by_ref[str(row["local_ref"])] = int(row["id"])

        conn.execute("DELETE FROM irrigation_program_zones WHERE program_id = ?", (program["id"],))
        for index, item in enumerate(zones):
            zone_ref = str(item.get("zone_id") or item.get("local_ref") or "").strip()
            zone_pk_id = zones_by_ref.get(zone_ref)
            if zone_pk_id is None:
                raise RegistryNotFoundError("irrigation zone not found")
            duration_seconds = max(1, int(item.get("duration_seconds") or 600))
            sort_order = int(item.get("sort_order") if item.get("sort_order") is not None else index)
            enabled = bool(item.get("enabled", True))
            conn.execute(
                """
                INSERT INTO irrigation_program_zones(uuid, program_id, zone_id, sort_order, duration_seconds, enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), program["id"], zone_pk_id, sort_order, duration_seconds, 1 if enabled else 0, _now_iso()),
            )
        conn.execute("UPDATE irrigation_programs SET revision = revision + 1, updated_at = ? WHERE id = ?", (_now_iso(), program["id"]))
        conn.commit()

    return list_program_zones(device_external_id, program_id)


def list_program_schedules(device_external_id: str, program_id: str) -> list[dict[str, Any]]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        rows = conn.execute(
            """
            SELECT uuid, name, start_local_time, weekdays_json, recurrence_type, interval_days, anchor_date, dates_json,
                   enabled, created_at, updated_at
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
                "recurrence_type": row["recurrence_type"] or "weekdays",
                "interval_days": row["interval_days"],
                "anchor_date": row["anchor_date"],
                "dates": _parse_str_list_json(row["dates_json"]),
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
    recurrence_type: str = "weekdays",
    interval_days: int | None = None,
    anchor_date: str | None = None,
    dates: list[str] | None = None,
    enabled: bool = True,
) -> dict[str, Any]:
    weekdays_json = json.dumps([int(day) for day in weekdays], separators=(",", ":"))
    dates_json = json.dumps([str(date) for date in (dates or [])], separators=(",", ":"))
    schedule_uuid = str(uuid.uuid4())

    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        conn.execute(
            """
            INSERT INTO irrigation_schedule_rules(
                uuid, program_id, name, start_local_time, weekdays_json, recurrence_type,
                interval_days, anchor_date, dates_json, enabled
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                schedule_uuid,
                program["id"],
                name,
                start_local_time,
                weekdays_json,
                recurrence_type,
                interval_days,
                anchor_date,
                dates_json,
                1 if enabled else 0,
            ),
        )
        conn.commit()

    schedules = list_program_schedules(device_external_id, program_id)
    for schedule in schedules:
        if schedule["schedule_id"] == schedule_uuid:
            return schedule
    raise RegistryNotFoundError("irrigation schedule not found")


def update_program_schedule(
    device_external_id: str,
    program_id: str,
    schedule_id: str,
    *,
    name: str,
    start_local_time: str,
    weekdays: list[int],
    recurrence_type: str = "weekdays",
    interval_days: int | None = None,
    anchor_date: str | None = None,
    dates: list[str] | None = None,
    enabled: bool = True,
) -> dict[str, Any]:
    weekdays_json = json.dumps([int(day) for day in weekdays], separators=(",", ":"))
    dates_json = json.dumps([str(date) for date in (dates or [])], separators=(",", ":"))
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        cur = conn.execute(
            """
            UPDATE irrigation_schedule_rules
            SET name = ?, start_local_time = ?, weekdays_json = ?, recurrence_type = ?, interval_days = ?,
                anchor_date = ?, dates_json = ?, enabled = ?, updated_at = ?
            WHERE program_id = ? AND uuid = ?
            """,
            (
                name,
                start_local_time,
                weekdays_json,
                recurrence_type,
                interval_days,
                anchor_date,
                dates_json,
                1 if enabled else 0,
                _now_iso(),
                program["id"],
                schedule_id,
            ),
        )
        if cur.rowcount == 0:
            raise RegistryNotFoundError("irrigation schedule not found")
        conn.commit()

    schedules = list_program_schedules(device_external_id, program_id)
    for schedule in schedules:
        if schedule["schedule_id"] == schedule_id:
            return schedule
    raise RegistryNotFoundError("irrigation schedule not found")


def delete_program_schedule(device_external_id: str, program_id: str, schedule_id: str) -> None:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        cur = conn.execute(
            """
            DELETE FROM irrigation_schedule_rules
            WHERE program_id = ? AND uuid = ?
            """,
            (program["id"], schedule_id),
        )
        if cur.rowcount == 0:
            raise RegistryNotFoundError("irrigation schedule not found")
        conn.commit()


def create_program_run(device_external_id: str, program_id: str, *, trigger_type: str = "manual") -> dict[str, Any]:
    run_uuid = str(uuid.uuid4())
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        program = _resolve_program(conn, device["id"], program_id)
        active_row = conn.execute(
            """
            SELECT uuid
            FROM irrigation_runs
            WHERE device_id = ? AND status = 'running'
            ORDER BY id DESC
            LIMIT 1
            """,
            (device["id"],),
        ).fetchone()
        if active_row is not None:
            raise ValueError("an irrigation program is already running")

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
            SELECT pz.duration_seconds, z.id, z.name
            FROM irrigation_program_zones pz
            JOIN irrigation_zones z ON z.id = pz.zone_id
            WHERE pz.program_id = ? AND pz.enabled = 1 AND z.enabled = 1
            ORDER BY pz.sort_order, pz.id
            """,
            (program["id"],),
        ).fetchall()
        if not zone_rows:
            zone_rows = conn.execute(
                """
                SELECT 600 AS duration_seconds, id, name
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
                (str(uuid.uuid4()), run_pk_id, int(zone_row["id"]), str(zone_row["name"]), int(zone_row["duration_seconds"])),
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


def start_next_irrigation_run_step(device_external_id: str, run_id: str) -> dict[str, Any] | None:
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        run_row = conn.execute(
            """
            SELECT id
            FROM irrigation_runs
            WHERE device_id = ? AND uuid = ? AND status = 'running'
            """,
            (device["id"], run_id),
        ).fetchone()
        if run_row is None:
            raise RegistryNotFoundError("irrigation run not found")

        step_row = conn.execute(
            """
            SELECT rs.id, rs.uuid, rs.duration_seconds, z.local_ref, z.name
            FROM irrigation_run_steps rs
            JOIN irrigation_zones z ON z.id = rs.zone_id
            WHERE rs.run_id = ? AND rs.status = 'planned' AND z.enabled = 1
            ORDER BY rs.id
            LIMIT 1
            """,
            (int(run_row["id"]),),
        ).fetchone()
        if step_row is None:
            return None

        conn.execute(
            """
            UPDATE irrigation_run_steps
            SET status = 'running', started_at = ?, finished_at = NULL
            WHERE id = ?
            """,
            (now, int(step_row["id"])),
        )
        conn.execute(
            """
            UPDATE irrigation_runs
            SET updated_at = ?
            WHERE id = ?
            """,
            (now, int(run_row["id"])),
        )
        conn.commit()

        return {
            "step_id": step_row["uuid"],
            "local_ref": step_row["local_ref"],
            "zone_name": step_row["name"],
            "duration_seconds": int(step_row["duration_seconds"]),
            "started_at": now,
        }


def finish_current_irrigation_run_step(device_external_id: str, run_id: str, *, status: str = "skipped") -> dict[str, Any] | None:
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        run_row = conn.execute(
            """
            SELECT id
            FROM irrigation_runs
            WHERE device_id = ? AND uuid = ? AND status = 'running'
            """,
            (device["id"], run_id),
        ).fetchone()
        if run_row is None:
            raise RegistryNotFoundError("irrigation run not found")

        step_row = conn.execute(
            """
            SELECT rs.id, rs.uuid, rs.duration_seconds, z.local_ref, rs.zone_name
            FROM irrigation_run_steps rs
            LEFT JOIN irrigation_zones z ON z.id = rs.zone_id
            WHERE rs.run_id = ? AND rs.status = 'running'
            ORDER BY rs.id
            LIMIT 1
            """,
            (int(run_row["id"]),),
        ).fetchone()
        if step_row is None:
            return None

        conn.execute(
            """
            UPDATE irrigation_run_steps
            SET status = ?, finished_at = ?
            WHERE id = ?
            """,
            (status, now, int(step_row["id"])),
        )
        conn.execute(
            """
            UPDATE irrigation_runs
            SET updated_at = ?
            WHERE id = ?
            """,
            (now, int(run_row["id"])),
        )
        conn.commit()

        return {
            "step_id": step_row["uuid"],
            "local_ref": step_row["local_ref"],
            "zone_name": step_row["zone_name"],
            "duration_seconds": int(step_row["duration_seconds"]),
            "finished_at": now,
            "status": status,
        }


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
                SELECT rs.uuid, z.local_ref, rs.zone_name, rs.duration_seconds, rs.status, rs.started_at, rs.finished_at
                FROM irrigation_run_steps rs
                LEFT JOIN irrigation_zones z ON z.id = rs.zone_id
                WHERE rs.run_id = ?
                ORDER BY rs.id
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
                            "local_ref": step_row["local_ref"],
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


def ensure_irrigation_run_started(
    device_external_id: str,
    run_id: str,
    *,
    trigger_type: str = "manual",
    started_at: str | None = None,
) -> dict[str, Any]:
    now = _now_iso()
    effective_started_at = started_at or now
    site_pk_id: int | None = None

    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        site_pk_id = int(device["site_id"]) if device.get("site_id") is not None else None
        row = conn.execute(
            """
            SELECT id
            FROM irrigation_runs
            WHERE device_id = ? AND uuid = ?
            """,
            (device["id"], run_id),
        ).fetchone()
        if row is None:
            conn.execute(
                """
                INSERT INTO irrigation_runs(uuid, device_id, program_id, trigger_type, status, started_at, updated_at)
                VALUES (?, ?, NULL, ?, 'running', ?, ?)
                """,
                (run_id, device["id"], trigger_type, effective_started_at, now),
            )
        else:
            conn.execute(
                """
                UPDATE irrigation_runs
                SET status = 'running',
                    started_at = COALESCE(started_at, ?),
                    finished_at = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (effective_started_at, now, int(row["id"])),
            )
        conn.commit()

    runs = list_irrigation_runs(device_external_id, limit=100)
    for run in runs:
        if run["run_id"] == run_id:
            _emit_irrigation_run_event(
                {
                    "event_type": "irrigation.run.updated",
                    "action": "started",
                    "device_id": device_external_id,
                    "site_id": site_pk_id,
                    "run": run,
                }
            )
            return run
    raise RegistryNotFoundError("irrigation run not found")


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
            """
            SELECT d.id, d.device_id, d.display_name, d.device_type, d.integration_mode, ds.online, ds.mqtt_connected
            FROM devices d
            LEFT JOIN device_state ds ON ds.device_id = d.id
            WHERE d.site_id = ?
            ORDER BY d.id
            """,
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

        device_summaries: list[dict[str, Any]] = []
        for row in device_rows:
            device_pk_id = int(row["id"])

            output_counts_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total_count,
                    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_count,
                    SUM(CASE WHEN fault IS NOT NULL AND fault != '' THEN 1 ELSE 0 END) AS fault_count
                FROM irrigation_outputs
                WHERE device_id = ?
                """,
                (device_pk_id,),
            ).fetchone()

            hydraulics = conn.execute(
                """
                SELECT flow_lpm, pressure_bar, water_liters, source_timestamp, updated_at
                FROM irrigation_hydraulics_state
                WHERE device_id = ?
                """,
                (device_pk_id,),
            ).fetchone()
            power = conn.execute(
                """
                SELECT voltage_rms_v, current_rms_a, real_power_w, power_factor, source_timestamp, updated_at
                FROM irrigation_power_state
                WHERE device_id = ?
                """,
                (device_pk_id,),
            ).fetchone()
            weather = conn.execute(
                """
                SELECT temperature_c, rain_mm, wind_mps, eto_mm, source_timestamp, updated_at
                FROM irrigation_weather_state
                WHERE device_id = ?
                """,
                (device_pk_id,),
            ).fetchone()
            rain_delay = _active_rain_delay_for_device(conn, device_pk_id)

            device_summaries.append(
                {
                    "device_id": row["device_id"],
                    "display_name": row["display_name"],
                    "device_type": row["device_type"],
                    "integration_mode": row["integration_mode"],
                    "online": bool(row["online"]) if row["online"] is not None else False,
                    "mqtt_connected": bool(row["mqtt_connected"]) if row["mqtt_connected"] is not None else False,
                    "outputs": {
                        "total": int(output_counts_row["total_count"] if output_counts_row is not None and output_counts_row["total_count"] is not None else 0),
                        "active": int(output_counts_row["active_count"] if output_counts_row is not None and output_counts_row["active_count"] is not None else 0),
                        "faulted": int(output_counts_row["fault_count"] if output_counts_row is not None and output_counts_row["fault_count"] is not None else 0),
                    },
                    "hydraulics": None
                    if hydraulics is None
                    else {
                        "flow_lpm": hydraulics["flow_lpm"],
                        "pressure_bar": hydraulics["pressure_bar"],
                        "water_liters": hydraulics["water_liters"],
                        "source_timestamp": hydraulics["source_timestamp"],
                        "updated_at": hydraulics["updated_at"],
                    },
                    "power": None
                    if power is None
                    else {
                        "voltage_rms_v": power["voltage_rms_v"],
                        "current_rms_a": power["current_rms_a"],
                        "real_power_w": power["real_power_w"],
                        "power_factor": power["power_factor"],
                        "source_timestamp": power["source_timestamp"],
                        "updated_at": power["updated_at"],
                    },
                    "weather": None
                    if weather is None
                    else {
                        "temperature_c": weather["temperature_c"],
                        "rain_mm": weather["rain_mm"],
                        "wind_mps": weather["wind_mps"],
                        "eto_mm": weather["eto_mm"],
                        "source_timestamp": weather["source_timestamp"],
                        "updated_at": weather["updated_at"],
                    },
                    "rain_delay": rain_delay,
                }
            )

    return {
        "site_id": site["site_id"],
        "site_name": site["site_name"],
        "device_count": len(device_ids),
        "zone_count": int(zone_count_row["count"] if zone_count_row is not None else 0),
        "program_count": int(program_count_row["count"] if program_count_row is not None else 0),
        "active_run_count": int(active_run_row["count"] if active_run_row is not None else 0),
        "devices": device_summaries,
    }


def list_irrigation_outputs(device_external_id: str) -> list[dict[str, Any]]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        rows = conn.execute(
            """
            SELECT uuid, local_ref, name, enabled, active, fault, is_master_valve, metadata_json, created_at, updated_at
            FROM irrigation_outputs
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
                "output_id": row["uuid"],
                "local_ref": row["local_ref"],
                "name": row["name"],
                "enabled": bool(row["enabled"]),
                "active": bool(row["active"]),
                "fault": row["fault"],
                "is_master_valve": bool(row["is_master_valve"]),
                "metadata": metadata,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        )
    return result


def upsert_irrigation_output_state(
    device_external_id: str,
    *,
    local_ref: str,
    name: str,
    enabled: bool = True,
    active: bool = False,
    fault: str | None = None,
    is_master_valve: bool = False,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata_json = json.dumps(metadata or {}, separators=(",", ":"), sort_keys=True)
    site_pk_id: int | None = None
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        site_pk_id = int(device["site_id"]) if device.get("site_id") is not None else None
        row = conn.execute(
            "SELECT id, uuid FROM irrigation_outputs WHERE device_id = ? AND local_ref = ?",
            (device["id"], local_ref),
        ).fetchone()
        if row is None:
            output_uuid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO irrigation_outputs(uuid, device_id, local_ref, name, enabled, active, fault, is_master_valve, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    output_uuid,
                    device["id"],
                    local_ref,
                    name,
                    1 if enabled else 0,
                    1 if active else 0,
                    fault,
                    1 if is_master_valve else 0,
                    metadata_json,
                ),
            )
        else:
            output_uuid = row["uuid"]
            conn.execute(
                """
                UPDATE irrigation_outputs
                SET name = ?, enabled = ?, active = ?, fault = ?, is_master_valve = ?, metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    name,
                    1 if enabled else 0,
                    1 if active else 0,
                    fault,
                    1 if is_master_valve else 0,
                    metadata_json,
                    _now_iso(),
                    row["id"],
                ),
            )
        conn.commit()

    outputs = list_irrigation_outputs(device_external_id)
    for item in outputs:
        if item["output_id"] == output_uuid:
            _emit_irrigation_status_event(
                {
                    "event_type": "irrigation.status.updated",
                    "action": "output.upserted",
                    "state_type": "outputs",
                    "device_id": device_external_id,
                    "site_id": site_pk_id,
                    "state": item,
                }
            )
            return item
    raise RegistryNotFoundError("irrigation output not found")


def _upsert_device_state_row(conn: Any, table_name: str, device_pk_id: int, values: dict[str, Any]) -> None:
    columns = ["device_id", *values.keys(), "updated_at"]
    placeholders = ",".join("?" for _ in columns)
    update_clause = ", ".join(f"{column} = excluded.{column}" for column in values.keys()) + ", updated_at = excluded.updated_at"
    sql = (
        f"INSERT INTO {table_name}({','.join(columns)}) VALUES ({placeholders}) "
        f"ON CONFLICT(device_id) DO UPDATE SET {update_clause}"
    )
    conn.execute(sql, (device_pk_id, *values.values(), _now_iso()))


def upsert_irrigation_hydraulics_state(
    device_external_id: str,
    *,
    flow_lpm: float | None = None,
    pressure_bar: float | None = None,
    water_liters: float | None = None,
    source_timestamp: str | None = None,
) -> dict[str, Any]:
    site_pk_id: int | None = None
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        site_pk_id = int(device["site_id"]) if device.get("site_id") is not None else None
        _upsert_device_state_row(
            conn,
            "irrigation_hydraulics_state",
            device["id"],
            {
                "flow_lpm": flow_lpm,
                "pressure_bar": pressure_bar,
                "water_liters": water_liters,
                "source_timestamp": source_timestamp or _now_iso(),
            },
        )
        conn.commit()
    state = get_irrigation_hydraulics(device_external_id)
    _emit_irrigation_status_event(
        {
            "event_type": "irrigation.status.updated",
            "action": "hydraulics.upserted",
            "state_type": "hydraulics",
            "device_id": device_external_id,
            "site_id": site_pk_id,
            "state": state,
        }
    )
    return state


def upsert_irrigation_power_state(
    device_external_id: str,
    *,
    voltage_rms_v: float | None = None,
    current_rms_a: float | None = None,
    real_power_w: float | None = None,
    power_factor: float | None = None,
    source_timestamp: str | None = None,
) -> dict[str, Any]:
    site_pk_id: int | None = None
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        site_pk_id = int(device["site_id"]) if device.get("site_id") is not None else None
        _upsert_device_state_row(
            conn,
            "irrigation_power_state",
            device["id"],
            {
                "voltage_rms_v": voltage_rms_v,
                "current_rms_a": current_rms_a,
                "real_power_w": real_power_w,
                "power_factor": power_factor,
                "source_timestamp": source_timestamp or _now_iso(),
            },
        )
        conn.commit()
    state = get_irrigation_power(device_external_id)
    _emit_irrigation_status_event(
        {
            "event_type": "irrigation.status.updated",
            "action": "power.upserted",
            "state_type": "power",
            "device_id": device_external_id,
            "site_id": site_pk_id,
            "state": state,
        }
    )
    return state


def upsert_irrigation_weather_state(
    device_external_id: str,
    *,
    temperature_c: float | None = None,
    rain_mm: float | None = None,
    wind_mps: float | None = None,
    eto_mm: float | None = None,
    source_timestamp: str | None = None,
) -> dict[str, Any]:
    site_pk_id: int | None = None
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        site_pk_id = int(device["site_id"]) if device.get("site_id") is not None else None
        _upsert_device_state_row(
            conn,
            "irrigation_weather_state",
            device["id"],
            {
                "temperature_c": temperature_c,
                "rain_mm": rain_mm,
                "wind_mps": wind_mps,
                "eto_mm": eto_mm,
                "source_timestamp": source_timestamp or _now_iso(),
            },
        )
        conn.commit()
    state = get_irrigation_weather(device_external_id)
    _emit_irrigation_status_event(
        {
            "event_type": "irrigation.status.updated",
            "action": "weather.upserted",
            "state_type": "weather",
            "device_id": device_external_id,
            "site_id": site_pk_id,
            "state": state,
        }
    )
    return state


def _active_rain_delay_for_device(conn: Any, device_pk_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT uuid, active_until, reason, created_at
        FROM irrigation_rain_delay
        WHERE device_id = ?
        ORDER BY id DESC
        LIMIT 1
        """,
        (device_pk_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "rain_delay_id": row["uuid"],
        "active_until": row["active_until"],
        "reason": row["reason"],
        "created_at": row["created_at"],
    }


def set_irrigation_rain_delay(device_external_id: str, *, delay_hours: int, reason: str | None = None) -> dict[str, Any]:
    safe_hours = max(1, min(int(delay_hours), 168))
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        site_pk_id = int(device["site_id"]) if device.get("site_id") is not None else None
        active_until = (datetime.now(timezone.utc) + timedelta(hours=safe_hours)).isoformat()
        rain_delay_uuid = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO irrigation_rain_delay(uuid, device_id, active_until, reason)
            VALUES (?, ?, ?, ?)
            """,
            (rain_delay_uuid, device["id"], active_until, reason),
        )
        conn.commit()
        current = _active_rain_delay_for_device(conn, device["id"])
    result = {
        "device_id": device_external_id,
        "delay_hours": safe_hours,
        "rain_delay": current,
    }
    _emit_irrigation_status_event(
        {
            "event_type": "irrigation.status.updated",
            "action": "rain_delay.set",
            "state_type": "weather",
            "device_id": device_external_id,
            "site_id": site_pk_id,
            "state": result,
        }
    )
    return result


def get_irrigation_hydraulics(device_external_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            """
            SELECT flow_lpm, pressure_bar, water_liters, source_timestamp, updated_at
            FROM irrigation_hydraulics_state
            WHERE device_id = ?
            """,
            (device["id"],),
        ).fetchone()
    if row is None:
        return {
            "device_id": device_external_id,
            "flow_lpm": None,
            "pressure_bar": None,
            "water_liters": None,
            "source_timestamp": None,
            "updated_at": None,
        }
    return {
        "device_id": device_external_id,
        "flow_lpm": row["flow_lpm"],
        "pressure_bar": row["pressure_bar"],
        "water_liters": row["water_liters"],
        "source_timestamp": row["source_timestamp"],
        "updated_at": row["updated_at"],
    }


def get_irrigation_power(device_external_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            """
            SELECT voltage_rms_v, current_rms_a, real_power_w, power_factor, source_timestamp, updated_at
            FROM irrigation_power_state
            WHERE device_id = ?
            """,
            (device["id"],),
        ).fetchone()
    if row is None:
        return {
            "device_id": device_external_id,
            "voltage_rms_v": None,
            "current_rms_a": None,
            "real_power_w": None,
            "power_factor": None,
            "source_timestamp": None,
            "updated_at": None,
        }
    return {
        "device_id": device_external_id,
        "voltage_rms_v": row["voltage_rms_v"],
        "current_rms_a": row["current_rms_a"],
        "real_power_w": row["real_power_w"],
        "power_factor": row["power_factor"],
        "source_timestamp": row["source_timestamp"],
        "updated_at": row["updated_at"],
    }


def get_irrigation_weather(device_external_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            """
            SELECT temperature_c, rain_mm, wind_mps, eto_mm, source_timestamp, updated_at
            FROM irrigation_weather_state
            WHERE device_id = ?
            """,
            (device["id"],),
        ).fetchone()
        rain_delay = _active_rain_delay_for_device(conn, device["id"])

    if row is None:
        return {
            "device_id": device_external_id,
            "temperature_c": None,
            "rain_mm": None,
            "wind_mps": None,
            "eto_mm": None,
            "source_timestamp": None,
            "updated_at": None,
            "rain_delay": rain_delay,
        }
    return {
        "device_id": device_external_id,
        "temperature_c": row["temperature_c"],
        "rain_mm": row["rain_mm"],
        "wind_mps": row["wind_mps"],
        "eto_mm": row["eto_mm"],
        "source_timestamp": row["source_timestamp"],
        "updated_at": row["updated_at"],
        "rain_delay": rain_delay,
    }
