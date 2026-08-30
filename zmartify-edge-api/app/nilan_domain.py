from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.db import get_connection
from app.registry import RegistryNotFoundError


_FIELDS = (
    "online", "controller_online", "freshness_age_ms", "run", "ventilation_level",
    "actual_inlet_level", "actual_exhaust_level", "room_temperature_c",
    "inlet_temperature_c", "outlet_temperature_c", "extract_temperature_c",
    "humidity_pct", "co2_ppm", "filter_days_remaining", "status",
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
    result["online"] = None if result["online"] is None else bool(result["online"])
    result["controller_online"] = None if result["controller_online"] is None else bool(result["controller_online"])
    result["run"] = None if result["run"] is None else bool(result["run"])
    result.pop("device_id", None)
    return {"device_id": device_external_id, **result}
