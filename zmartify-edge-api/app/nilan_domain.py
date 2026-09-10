from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.db import get_connection
from app.registry import RegistryNotFoundError


_FIELDS = (
    "online", "controller_online", "freshness_age_ms", "run", "ventilation_level",
    "run_actual", "mode_actual", "bypass_open", "bypass_close",
    "actual_inlet_level", "actual_exhaust_level", "inlet_speed", "exhaust_speed",
    "run_set", "mode_set", "vent_set", "temp_set", "service_mode", "service_pct", "room_temperature_c",
    "inlet_temperature_c", "outlet_temperature_c", "extract_temperature_c",
    "t1_intake_c", "t2_inlet_c", "t3_exhaust_c", "t4_outlet_c",
    "t7_inlet_c", "t8_outdoor_c", "t9_heater_c", "controller_board_temperature_c",
    "bus_version", "app_version_major", "app_version_minor", "app_version_release",
    "humidity_pct", "co2_ppm", "filter_days_remaining", "filter_interval_days", "status",
    "poll_requests", "poll_responses",
)


def _device(conn: Any, device_external_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT id FROM devices WHERE device_id = ?", (device_external_id,)).fetchone()
    if row is None:
        raise RegistryNotFoundError("device not found")
    return row


def upsert_nilan_state(device_external_id: str, payload: dict[str, Any], *, source_timestamp: str | None) -> dict[str, Any]:
    now = datetime.now(UTC).replace(microsecond=0).isoformat()
    values = {field: payload.get(field) for field in _FIELDS}
    values["online"] = None if values["online"] is None else int(bool(values["online"]))
    values["controller_online"] = None if values["controller_online"] is None else int(bool(values["controller_online"]))
    values["run"] = None if values["run"] is None else int(bool(values["run"]))
    values["run_actual"] = None if values["run_actual"] is None else int(bool(values["run_actual"]))
    values["bypass_open"] = None if values["bypass_open"] is None else int(bool(values["bypass_open"]))
    values["bypass_close"] = None if values["bypass_close"] is None else int(bool(values["bypass_close"]))
    values["poll_requests"] = int(values["poll_requests"] or 0)
    values["poll_responses"] = int(values["poll_responses"] or 0)
    values["source_timestamp"] = source_timestamp or now
    values["updated_at"] = now
    with get_connection() as conn:
        device = _device(conn, device_external_id)
        columns = ["device_id", "source_timestamp", *_FIELDS, "updated_at"]
        placeholders = ",".join("?" for _ in columns)
        updates = ",".join(f"{column}=excluded.{column}" for column in ["source_timestamp", *_FIELDS, "updated_at"])
        conn.execute(
            f"INSERT INTO nilan_hvac_state ({','.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT(device_id) DO UPDATE SET {updates}",
            (device["id"], *(values[column] for column in ["source_timestamp", *_FIELDS, "updated_at"])),
        )
        conn.commit()
    return get_nilan_state(device_external_id)


def get_nilan_state(device_external_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        device = _device(conn, device_external_id)
        row = conn.execute("SELECT * FROM nilan_hvac_state WHERE device_id = ?", (device["id"],)).fetchone()
    if row is None:
        return {"device_id": device_external_id, "available": False, **{field: None for field in ("source_timestamp", *_FIELDS)}}
    result = {"device_id": device_external_id, "available": True, **{key: row[key] for key in row.keys()}}
    source_timestamp = result.get("source_timestamp")
    if source_timestamp:
        try:
            timestamp = datetime.fromisoformat(str(source_timestamp).replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=UTC)
            result["freshness_age_ms"] = max(0, int((datetime.now(UTC) - timestamp).total_seconds() * 1000))
        except (TypeError, ValueError):
            pass
    result["online"] = None if result["online"] is None else bool(result["online"])
    result["controller_online"] = None if result["controller_online"] is None else bool(result["controller_online"])
    result["run"] = None if result["run"] is None else bool(result["run"])
    result["run_actual"] = None if result["run_actual"] is None else bool(result["run_actual"])
    result["bypass_open"] = None if result["bypass_open"] is None else bool(result["bypass_open"])
    result["bypass_close"] = None if result["bypass_close"] is None else bool(result["bypass_close"])
    result.pop("device_id", None)
    return {"device_id": device_external_id, **result}
