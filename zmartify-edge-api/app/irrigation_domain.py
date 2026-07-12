from __future__ import annotations

import json
import uuid
from typing import Any

from app.db import get_connection
from app.registry import RegistryNotFoundError


def _resolve_device(conn: Any, device_external_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id, device_id, site_id FROM devices WHERE device_id = ?",
        (device_external_id,),
    ).fetchone()
    if row is None:
        raise RegistryNotFoundError("device not found")
    return {"id": int(row["id"]), "device_id": row["device_id"], "site_id": row["site_id"]}


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
