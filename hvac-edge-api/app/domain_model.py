from __future__ import annotations

import json
import hashlib
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.db import get_connection
from app.registry import RegistryNotFoundError

NOTIFICATION_EVENT_TYPES = {
    "device_offline",
    "device_online",
    "ota_failed",
    "controller_fault",
    "temperature_alarm",
    "setpoint_write_failed",
    "zone_setpoint_changed",
}


class DomainModelError(ValueError):
    """Domain model validation/lookup errors."""


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _new_uuid() -> str:
    return str(uuid.uuid4())


def _row_to_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def _parse_iso_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _age_ms(raw: str | None, now: datetime | None = None) -> int | None:
    timestamp = _parse_iso_datetime(raw)
    if timestamp is None:
        return None
    ref = now or datetime.now(UTC)
    delta_ms = int((ref - timestamp).total_seconds() * 1000)
    return max(0, delta_ms)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _ingest_min_interval_ms() -> int:
    raw = os.getenv("HVAC_EDGE_INGEST_MIN_INTERVAL_MS", "0").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def _history_retention_days() -> int:
    raw = os.getenv("HVAC_EDGE_HISTORY_RETENTION_DAYS", "30").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 30


def _prune_history(conn: Any, *, device_pk_id: int | None = None) -> None:
    cutoff = (datetime.now(UTC) - timedelta(days=_history_retention_days())).replace(microsecond=0).isoformat()
    if device_pk_id is None:
        conn.execute("DELETE FROM temperature_history WHERE created_at < ?", (cutoff,))
        conn.execute("DELETE FROM setpoint_history WHERE created_at < ?", (cutoff,))
        conn.execute("DELETE FROM demand_history WHERE created_at < ?", (cutoff,))
        conn.execute("DELETE FROM device_health_history WHERE created_at < ?", (cutoff,))
        return

    conn.execute("DELETE FROM temperature_history WHERE device_id = ? AND created_at < ?", (device_pk_id, cutoff))
    conn.execute("DELETE FROM setpoint_history WHERE device_id = ? AND created_at < ?", (device_pk_id, cutoff))
    conn.execute("DELETE FROM demand_history WHERE device_id = ? AND created_at < ?", (device_pk_id, cutoff))
    conn.execute("DELETE FROM device_health_history WHERE device_id = ? AND created_at < ?", (device_pk_id, cutoff))


def _parse_int_list_json(raw: str | None) -> list[int]:
    if not raw:
        return []
    try:
        values = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(values, list):
        return []
    result: list[int] = []
    for value in values:
        try:
            int_value = int(value)
        except (TypeError, ValueError):
            continue
        if int_value > 0:
            result.append(int_value)
    return sorted(set(result))


def _resolve_device(conn: Any, device_external_id: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT d.id, d.uuid, d.device_id, d.display_name, d.site_id, d.last_seen_at,
               s.uuid AS site_uuid, s.name AS site_name, s.domain_id,
               dm.uuid AS domain_uuid, dm.slug AS domain_slug, dm.name AS domain_name
        FROM devices d
        LEFT JOIN sites s ON s.id = d.site_id
        LEFT JOIN domains dm ON dm.id = s.domain_id
        WHERE d.device_id = ?
        """,
        (device_external_id,),
    ).fetchone()
    result = _row_to_dict(row)
    if result is None:
        raise RegistryNotFoundError("device not found")
    return result


def _resolve_site(conn: Any, site_ref: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT s.id, s.uuid, s.name, s.slug, s.domain_id,
               d.uuid AS domain_uuid, d.slug AS domain_slug, d.name AS domain_name
        FROM sites s
        JOIN domains d ON d.id = s.domain_id
        WHERE s.uuid = ? OR s.slug = ? OR CAST(s.id AS TEXT) = ?
        """,
        (site_ref, site_ref, site_ref),
    ).fetchone()
    result = _row_to_dict(row)
    if result is None:
        raise RegistryNotFoundError("site not found")
    return result


def ensure_default_zones(device_external_id: str, zone_count: int = 3) -> None:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        existing = conn.execute(
            "SELECT zone_id FROM zone_metadata WHERE device_id = ?",
            (device["id"],),
        ).fetchall()
        have = {int(row["zone_id"]) for row in existing}
        for zone_id in range(1, zone_count + 1):
            if zone_id in have:
                continue
            conn.execute(
                """
                INSERT INTO zone_metadata(uuid, device_id, zone_id, name, sort_order)
                VALUES (?, ?, ?, ?, ?)
                """,
                (_new_uuid(), device["id"], zone_id, f"zone-{zone_id}", zone_id),
            )
        conn.commit()


def ensure_default_channels(device_external_id: str, channel_count: int = 16) -> None:
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        existing = conn.execute(
            "SELECT channel_id FROM channel_metadata WHERE device_id = ?",
            (device["id"],),
        ).fetchall()
        have = {int(row["channel_id"]) for row in existing}
        for channel_id in range(1, channel_count + 1):
            if channel_id in have:
                continue
            conn.execute(
                """
                INSERT INTO channel_metadata(uuid, device_id, channel_id, name, sort_order)
                VALUES (?, ?, ?, ?, ?)
                """,
                (_new_uuid(), device["id"], channel_id, f"channel-{channel_id}", channel_id),
            )
        conn.commit()


def list_device_zones(device_external_id: str) -> list[dict[str, Any]]:
    ensure_default_zones(device_external_id)
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        rows = conn.execute(
            """
            SELECT zm.uuid AS zone_uuid, zm.zone_id, zm.name, zm.icon, zm.sort_order, zm.floor, zm.area_m2,
                   zs.current_temperature, zs.target_temperature, zs.demand, zs.active, zs.fault,
                   zs.source_timestamp, zs.updated_at,
                   ds.online AS device_online
            FROM zone_metadata zm
            LEFT JOIN zone_state zs ON zs.device_id = zm.device_id AND zs.zone_id = zm.zone_id
            LEFT JOIN device_state ds ON ds.device_id = zm.device_id
            WHERE zm.device_id = ?
            ORDER BY zm.sort_order ASC, zm.zone_id ASC
            """,
            (device["id"],),
        ).fetchall()

    zones: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for row in rows:
        zones.append(
            {
                "zone_uuid": row["zone_uuid"],
                "zone_id": row["zone_id"],
                "name": row["name"],
                "icon": row["icon"],
                "sort_order": row["sort_order"],
                "floor": row["floor"],
                "area_m2": row["area_m2"],
                "current_temperature_c": row["current_temperature"],
                "target_temperature_c": row["target_temperature"],
                "demand": None if row["demand"] is None else bool(row["demand"]),
                "active": None if row["active"] is None else bool(row["active"]),
                "fault": row["fault"],
                "updated_at": row["updated_at"],
                "source_timestamp": row["source_timestamp"],
                "freshness_age_ms": _age_ms(row["updated_at"], now),
                "online": bool(row["device_online"]) if row["device_online"] is not None else bool(device["last_seen_at"]),
            }
        )
    return zones


def get_device_zone(device_external_id: str, zone_id: int) -> dict[str, Any]:
    ensure_default_zones(device_external_id, zone_count=max(3, int(zone_id)))
    zones = list_device_zones(device_external_id)
    for zone in zones:
        if int(zone["zone_id"]) == int(zone_id):
            return zone
    raise RegistryNotFoundError("zone not found")


def list_device_channels(device_external_id: str) -> list[dict[str, Any]]:
    ensure_default_channels(device_external_id)
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        rows = conn.execute(
            """
                 SELECT cm.uuid AS channel_uuid, cm.channel_id, cm.name, cm.icon, cm.sort_order, cm.linked_zone_ids_json,
                   cs.active, cs.fault, cs.source_timestamp, cs.updated_at,
                   ds.online AS device_online
            FROM channel_metadata cm
            LEFT JOIN channel_state cs ON cs.device_id = cm.device_id AND cs.channel_id = cm.channel_id
            LEFT JOIN device_state ds ON ds.device_id = cm.device_id
            WHERE cm.device_id = ?
            ORDER BY cm.sort_order ASC, cm.channel_id ASC
            """,
            (device["id"],),
        ).fetchall()

    channels: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for row in rows:
        channels.append(
            {
                "channel_uuid": row["channel_uuid"],
                "channel_id": row["channel_id"],
                "name": row["name"],
                "icon": row["icon"],
                "sort_order": row["sort_order"],
                "linked_zone_ids": _parse_int_list_json(row["linked_zone_ids_json"]),
                "active": None if row["active"] is None else bool(row["active"]),
                "fault": row["fault"],
                "updated_at": row["updated_at"],
                "source_timestamp": row["source_timestamp"],
                "freshness_age_ms": _age_ms(row["updated_at"], now),
                "online": bool(row["device_online"]) if row["device_online"] is not None else bool(device["last_seen_at"]),
            }
        )
    return channels


def get_device_channel(device_external_id: str, channel_id: int) -> dict[str, Any]:
    channels = list_device_channels(device_external_id)
    for channel in channels:
        if int(channel["channel_id"]) == int(channel_id):
            return channel
    raise RegistryNotFoundError("channel not found")


def _write_zone_metadata(
    device_external_id: str,
    zone_id: int,
    *,
    name: str | None = None,
    icon: str | None = None,
    sort_order: int | None = None,
    floor: str | None = None,
    area_m2: float | None = None,
) -> dict[str, Any]:
    if zone_id < 1:
        raise DomainModelError("zone_id must be >= 1")

    ensure_default_zones(device_external_id)
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            "SELECT id FROM zone_metadata WHERE device_id = ? AND zone_id = ?",
            (device["id"], zone_id),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("zone not found")

        current = conn.execute(
            "SELECT name, icon, sort_order, floor, area_m2 FROM zone_metadata WHERE id = ?",
            (row["id"],),
        ).fetchone()
        conn.execute(
            """
            UPDATE zone_metadata
            SET name = ?,
                icon = ?,
                sort_order = ?,
                floor = ?,
                area_m2 = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                name if name is not None else current["name"],
                icon if icon is not None else current["icon"],
                sort_order if sort_order is not None else current["sort_order"],
                floor if floor is not None else current["floor"],
                area_m2 if area_m2 is not None else current["area_m2"],
                now,
                row["id"],
            ),
        )
        conn.commit()

    return get_device_zone(device_external_id, zone_id)


def rename_zone(device_external_id: str, zone_id: int, name: str) -> dict[str, Any]:
    if not name.strip():
        raise DomainModelError("name is required")
    return _write_zone_metadata(device_external_id, zone_id, name=name.strip())


def set_zone_metadata(
    device_external_id: str,
    zone_id: int,
    *,
    name: str | None = None,
    icon: str | None = None,
    sort_order: int | None = None,
    floor: str | None = None,
    area_m2: float | None = None,
) -> dict[str, Any]:
    if name is not None and not name.strip():
        raise DomainModelError("name cannot be blank")
    return _write_zone_metadata(
        device_external_id,
        zone_id,
        name=name.strip() if name is not None else None,
        icon=icon,
        sort_order=sort_order,
        floor=floor,
        area_m2=area_m2,
    )


def _write_channel_metadata(
    device_external_id: str,
    channel_id: int,
    *,
    name: str | None = None,
    icon: str | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    if channel_id < 1:
        raise DomainModelError("channel_id must be >= 1")

    ensure_default_channels(device_external_id)
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            "SELECT id FROM channel_metadata WHERE device_id = ? AND channel_id = ?",
            (device["id"], channel_id),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("channel not found")

        current = conn.execute(
            "SELECT name, icon, sort_order FROM channel_metadata WHERE id = ?",
            (row["id"],),
        ).fetchone()
        conn.execute(
            """
            UPDATE channel_metadata
            SET name = ?,
                icon = ?,
                sort_order = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                name if name is not None else current["name"],
                icon if icon is not None else current["icon"],
                sort_order if sort_order is not None else current["sort_order"],
                now,
                row["id"],
            ),
        )
        conn.commit()

    return get_device_channel(device_external_id, channel_id)


def set_channel_zone_links(device_external_id: str, channel_id: int, zone_ids: list[int]) -> dict[str, Any]:
    ensure_default_channels(device_external_id)
    max_zone_id = 3
    if zone_ids:
        max_zone_id = max(max_zone_id, max(int(zone_id) for zone_id in zone_ids))
    ensure_default_zones(device_external_id, zone_count=max_zone_id)

    cleaned = sorted({int(zone_id) for zone_id in zone_ids if int(zone_id) > 0})
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)

        existing = conn.execute(
            "SELECT 1 FROM channel_metadata WHERE device_id = ? AND channel_id = ?",
            (device["id"], channel_id),
        ).fetchone()
        if existing is None:
            raise RegistryNotFoundError("channel not found")

        if cleaned:
            placeholders = ",".join("?" for _ in cleaned)
            valid_rows = conn.execute(
                f"SELECT zone_id FROM zone_metadata WHERE device_id = ? AND zone_id IN ({placeholders})",
                (device["id"], *cleaned),
            ).fetchall()
            valid_zone_ids = {int(row["zone_id"]) for row in valid_rows}
            missing = [zone_id for zone_id in cleaned if zone_id not in valid_zone_ids]
            if missing:
                raise DomainModelError("zone_ids contain unknown zones for this device")

        conn.execute(
            """
            UPDATE channel_metadata
            SET linked_zone_ids_json = ?,
                updated_at = ?
            WHERE device_id = ? AND channel_id = ?
            """,
            (json.dumps(cleaned, separators=(",", ":")), now, device["id"], channel_id),
        )
        conn.commit()

    return get_device_channel(device_external_id, channel_id)


def set_channel_metadata(
    device_external_id: str,
    channel_id: int,
    *,
    name: str | None = None,
    icon: str | None = None,
    sort_order: int | None = None,
) -> dict[str, Any]:
    if name is not None and not name.strip():
        raise DomainModelError("name cannot be blank")
    return _write_channel_metadata(
        device_external_id,
        channel_id,
        name=name.strip() if name is not None else None,
        icon=icon,
        sort_order=sort_order,
    )


def upsert_channel_state(
    device_external_id: str,
    channel_id: int,
    *,
    active: bool | None = None,
    fault: str | None = None,
    source: str = "rest",
    source_timestamp: str | None = None,
) -> dict[str, Any]:
    ensure_default_channels(device_external_id)
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        conn.execute(
            """
            INSERT INTO channel_state(device_id, channel_id, active, fault, source_timestamp, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, channel_id) DO UPDATE SET
                active = excluded.active,
                fault = excluded.fault,
                source_timestamp = excluded.source_timestamp,
                updated_at = excluded.updated_at
            """,
            (
                device["id"],
                channel_id,
                None if active is None else int(bool(active)),
                fault,
                source_timestamp or now,
                now,
            ),
        )
        conn.commit()

    result = get_device_channel(device_external_id, channel_id)
    if active is not None:
        log_event(
            "channel_state_updated",
            domain_id=device.get("domain_id"),
            site_id=device.get("site_id"),
            device_pk_id=device["id"],
            payload={"device_id": device_external_id, "channel_id": channel_id, "active": bool(active), "source": source},
        )
    return result


def ingest_device_twin_snapshot(
    device_external_id: str,
    *,
    source: str,
    source_timestamp: str | None,
    online: bool | None,
    mqtt_connected: bool | None,
    last_error: str | None,
    zones: list[dict[str, Any]] | None,
    channels: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "source": source,
                "source_timestamp": source_timestamp,
                "online": online,
                "mqtt_connected": mqtt_connected,
                "last_error": last_error,
                "zones": zones or [],
                "channels": channels or [],
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    now_iso = _now_iso()

    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        ingest_row = conn.execute(
            "SELECT last_source, last_payload_hash, last_ingested_at FROM twin_ingest_state WHERE device_id = ?",
            (device["id"],),
        ).fetchone()

        min_interval_ms = _ingest_min_interval_ms()
        last_ingested_at = None if ingest_row is None else ingest_row["last_ingested_at"]
        if min_interval_ms > 0 and last_ingested_at:
            elapsed = _age_ms(last_ingested_at)
            if elapsed is not None and elapsed < min_interval_ms:
                conn.execute(
                    """
                    INSERT INTO twin_ingest_state(device_id, last_source, last_payload_hash, last_ingested_at, last_result)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(device_id) DO UPDATE SET
                        last_source = excluded.last_source,
                        last_payload_hash = excluded.last_payload_hash,
                        last_ingested_at = excluded.last_ingested_at,
                        last_result = excluded.last_result
                    """,
                    (device["id"], source, fingerprint, now_iso, "rate_limited"),
                )
                conn.commit()
                return {
                    "device_id": device_external_id,
                    "source": source,
                    "source_timestamp": source_timestamp,
                    "zone_updates": 0,
                    "channel_updates": 0,
                    "applied": False,
                    "skip_reason": "rate_limited",
                }

        dedup_enabled = _env_bool("HVAC_EDGE_INGEST_DEDUP_ENABLED", True)
        if dedup_enabled and ingest_row is not None:
            if ingest_row["last_source"] == source and ingest_row["last_payload_hash"] == fingerprint:
                conn.execute(
                    """
                    INSERT INTO twin_ingest_state(device_id, last_source, last_payload_hash, last_ingested_at, last_result)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(device_id) DO UPDATE SET
                        last_source = excluded.last_source,
                        last_payload_hash = excluded.last_payload_hash,
                        last_ingested_at = excluded.last_ingested_at,
                        last_result = excluded.last_result
                    """,
                    (device["id"], source, fingerprint, now_iso, "deduplicated"),
                )
                conn.commit()
                return {
                    "device_id": device_external_id,
                    "source": source,
                    "source_timestamp": source_timestamp,
                    "zone_updates": 0,
                    "channel_updates": 0,
                    "applied": False,
                    "skip_reason": "deduplicated",
                }

    device_state = upsert_device_state(
        device_external_id,
        online=online,
        mqtt_connected=mqtt_connected,
        source=source,
        source_timestamp=source_timestamp,
        last_error=last_error,
    )

    zone_count = 0
    for zone in zones or []:
        zone_id = int(zone["zone_id"])
        upsert_zone_state(
            device_external_id,
            zone_id,
            current_temperature=zone.get("current_temperature_c"),
            target_temperature=zone.get("target_temperature_c"),
            demand=zone.get("demand"),
            active=zone.get("active"),
            fault=zone.get("fault"),
            source=source,
            source_timestamp=source_timestamp,
        )
        zone_count += 1

    channel_count = 0
    for channel in channels or []:
        channel_id = int(channel["channel_id"])
        upsert_channel_state(
            device_external_id,
            channel_id,
            active=channel.get("active"),
            fault=channel.get("fault"),
            source=source,
            source_timestamp=source_timestamp,
        )
        channel_count += 1

    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        conn.execute(
            """
            INSERT INTO twin_ingest_state(device_id, last_source, last_payload_hash, last_ingested_at, last_applied_at, last_result)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                last_source = excluded.last_source,
                last_payload_hash = excluded.last_payload_hash,
                last_ingested_at = excluded.last_ingested_at,
                last_applied_at = excluded.last_applied_at,
                last_result = excluded.last_result
            """,
            (device["id"], source, fingerprint, now_iso, now_iso, "applied"),
        )
        conn.commit()

    return {
        "device_id": device_external_id,
        "source": source,
        "source_timestamp": source_timestamp,
        "device_state": device_state,
        "zone_updates": zone_count,
        "channel_updates": channel_count,
        "applied": True,
    }


def get_device_freshness(device_external_id: str) -> dict[str, Any]:
    now = datetime.now(UTC)
    zones = list_device_zones(device_external_id)
    channels = list_device_channels(device_external_id)

    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            "SELECT updated_at, source_timestamp, online, mqtt_connected FROM device_state WHERE device_id = ?",
            (device["id"],),
        ).fetchone()

    device_updated_at = None if row is None else row["updated_at"]
    source_timestamp = None if row is None else row["source_timestamp"]

    return {
        "device_id": device_external_id,
        "device": {
            "online": None if row is None or row["online"] is None else bool(row["online"]),
            "mqtt_connected": None if row is None or row["mqtt_connected"] is None else bool(row["mqtt_connected"]),
            "updated_at": device_updated_at,
            "source_timestamp": source_timestamp,
            "freshness_age_ms": _age_ms(device_updated_at, now),
        },
        "zones": [
            {
                "zone_id": zone["zone_id"],
                "updated_at": zone["updated_at"],
                "source_timestamp": zone["source_timestamp"],
                "freshness_age_ms": zone.get("freshness_age_ms"),
            }
            for zone in zones
        ],
        "channels": [
            {
                "channel_id": channel["channel_id"],
                "updated_at": channel["updated_at"],
                "source_timestamp": channel["source_timestamp"],
                "freshness_age_ms": channel.get("freshness_age_ms"),
            }
            for channel in channels
        ],
    }


_HISTORY_WINDOWS: dict[str, tuple[timedelta, int]] = {
    "1h": (timedelta(hours=1), 60),
    "24h": (timedelta(hours=24), 300),
    "7d": (timedelta(days=7), 3600),
    "30d": (timedelta(days=30), 21600),
}


def _history_window(window: str) -> tuple[timedelta, int]:
    if window not in _HISTORY_WINDOWS:
        raise DomainModelError("window must be one of: 1h, 24h, 7d, 30d")
    return _HISTORY_WINDOWS[window]


def _aggregate_numeric_points(rows: list[Any], *, value_key: str, bucket_seconds: int, now: datetime) -> list[dict[str, Any]]:
    grouped: dict[int, list[float]] = {}
    for row in rows:
        created = _parse_iso_datetime(row["created_at"])
        if created is None:
            continue
        value = row[value_key]
        if value is None:
            continue
        epoch = int(created.timestamp())
        bucket = epoch - (epoch % bucket_seconds)
        grouped.setdefault(bucket, []).append(float(value))

    result: list[dict[str, Any]] = []
    for bucket in sorted(grouped.keys()):
        values = grouped[bucket]
        avg_value = sum(values) / len(values)
        bucket_dt = datetime.fromtimestamp(bucket, tz=UTC)
        result.append({"bucket_start": bucket_dt.isoformat(), "value": round(avg_value, 3), "age_ms": _age_ms(bucket_dt.isoformat(), now)})
    return result


def get_zone_history(zone_ref: str, *, window: str = "24h") -> dict[str, Any]:
    span, bucket_seconds = _history_window(window)
    now = datetime.now(UTC)
    cutoff = (now - span).replace(microsecond=0).isoformat()
    device_external_id, zone_id = resolve_zone_ref(zone_ref)

    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        temp_rows = conn.execute(
            """
            SELECT current_temperature, target_temperature, created_at
            FROM temperature_history
            WHERE device_id = ? AND zone_id = ? AND created_at >= ?
            ORDER BY created_at ASC
            """,
            (device["id"], zone_id, cutoff),
        ).fetchall()
        setpoint_rows = conn.execute(
            """
            SELECT target_temperature, created_at
            FROM setpoint_history
            WHERE device_id = ? AND zone_id = ? AND created_at >= ?
            ORDER BY created_at ASC
            """,
            (device["id"], zone_id, cutoff),
        ).fetchall()
        demand_rows = conn.execute(
            """
            SELECT demand, created_at
            FROM demand_history
            WHERE device_id = ? AND zone_id = ? AND created_at >= ?
            ORDER BY created_at ASC
            """,
            (device["id"], zone_id, cutoff),
        ).fetchall()

    temperature_current = _aggregate_numeric_points(temp_rows, value_key="current_temperature", bucket_seconds=bucket_seconds, now=now)
    temperature_target = _aggregate_numeric_points(temp_rows, value_key="target_temperature", bucket_seconds=bucket_seconds, now=now)
    setpoint_points = _aggregate_numeric_points(setpoint_rows, value_key="target_temperature", bucket_seconds=bucket_seconds, now=now)
    demand_points = _aggregate_numeric_points(demand_rows, value_key="demand", bucket_seconds=bucket_seconds, now=now)

    return {
        "device_id": device_external_id,
        "zone_id": zone_id,
        "zone_ref": zone_ref,
        "window": window,
        "bucket_seconds": bucket_seconds,
        "temperature_current": temperature_current,
        "temperature_target": temperature_target,
        "setpoint": setpoint_points,
        "demand": demand_points,
    }


def get_device_history(device_external_id: str, *, window: str = "24h") -> dict[str, Any]:
    span, bucket_seconds = _history_window(window)
    now = datetime.now(UTC)
    cutoff = (now - span).replace(microsecond=0).isoformat()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        health_rows = conn.execute(
            """
            SELECT online, mqtt_connected, created_at
            FROM device_health_history
            WHERE device_id = ? AND created_at >= ?
            ORDER BY created_at ASC
            """,
            (device["id"], cutoff),
        ).fetchall()

    online_points = _aggregate_numeric_points(health_rows, value_key="online", bucket_seconds=bucket_seconds, now=now)
    mqtt_points = _aggregate_numeric_points(health_rows, value_key="mqtt_connected", bucket_seconds=bucket_seconds, now=now)

    return {
        "device_id": device_external_id,
        "window": window,
        "bucket_seconds": bucket_seconds,
        "online": online_points,
        "mqtt_connected": mqtt_points,
    }


def _insert_notifications_for_event(conn: Any, event_id: int, event_type: str) -> None:
    if event_type not in NOTIFICATION_EVENT_TYPES:
        return
    users = conn.execute("SELECT id FROM users WHERE enabled = 1").fetchall()
    now = _now_iso()
    for row in users:
        conn.execute(
            """
            INSERT INTO notifications(uuid, user_id, event_id, read, created_at)
            VALUES (?, ?, ?, 0, ?)
            """,
            (_new_uuid(), row["id"], event_id, now),
        )


def log_event(
    event_type: str,
    *,
    domain_id: int | None = None,
    site_id: int | None = None,
    device_pk_id: int | None = None,
    zone_id: int | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = _now_iso()
    payload_json = json.dumps(payload or {}, separators=(",", ":"), sort_keys=True)
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO event_log(uuid, event_type, domain_id, site_id, device_id, zone_id, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (_new_uuid(), event_type, domain_id, site_id, device_pk_id, zone_id, payload_json, now),
        )
        _insert_notifications_for_event(conn, int(cur.lastrowid), event_type)
        row = conn.execute(
            "SELECT id, uuid, event_type, domain_id, site_id, device_id, zone_id, payload_json, created_at FROM event_log WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        conn.commit()
    return _row_to_dict(row) or {}


def upsert_device_state(
    device_external_id: str,
    *,
    online: bool | None = None,
    mqtt_connected: bool | None = None,
    source: str = "rest",
    source_timestamp: str | None = None,
    last_error: str | None = None,
) -> dict[str, Any]:
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        existing = conn.execute(
            "SELECT online, mqtt_connected FROM device_state WHERE device_id = ?",
            (device["id"],),
        ).fetchone()
        prev_online = None if existing is None else existing["online"]
        prev_mqtt = None if existing is None else existing["mqtt_connected"]

        conn.execute(
            """
            INSERT INTO device_state(device_id, online, mqtt_connected, last_seen_at, source_timestamp, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                online = excluded.online,
                mqtt_connected = excluded.mqtt_connected,
                last_seen_at = excluded.last_seen_at,
                source_timestamp = excluded.source_timestamp,
                updated_at = excluded.updated_at
            """,
            (
                device["id"],
                None if online is None else int(bool(online)),
                None if mqtt_connected is None else int(bool(mqtt_connected)),
                now if online else None,
                source_timestamp or now,
                now,
            ),
        )

        conn.execute(
            "UPDATE devices SET last_seen_at = ? WHERE id = ?",
            (now if online else None, device["id"]),
        )

        conn.execute(
            """
            INSERT INTO device_health_history(uuid, device_id, online, mqtt_connected, last_error, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                _new_uuid(),
                device["id"],
                None if online is None else int(bool(online)),
                None if mqtt_connected is None else int(bool(mqtt_connected)),
                last_error,
                source,
                now,
            ),
        )

        _prune_history(conn, device_pk_id=device["id"])

        state_row = conn.execute(
            "SELECT device_id, online, mqtt_connected, last_seen_at, source_timestamp, updated_at FROM device_state WHERE device_id = ?",
            (device["id"],),
        ).fetchone()

        if online is not None and prev_online is not None and int(bool(online)) != int(prev_online):
            log_payload = {"device_id": device_external_id, "online": bool(online), "source": source, "last_error": last_error}
            conn.execute(
                """
                INSERT INTO event_log(uuid, event_type, domain_id, site_id, device_id, zone_id, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    _new_uuid(),
                    "device_online" if online else "device_offline",
                    device.get("domain_id"),
                    device.get("site_id"),
                    device["id"],
                    json.dumps(log_payload, separators=(",", ":"), sort_keys=True),
                    now,
                ),
            )
        if mqtt_connected is not None and prev_mqtt is not None and int(bool(mqtt_connected)) != int(prev_mqtt):
            conn.execute(
                """
                INSERT INTO event_log(uuid, event_type, domain_id, site_id, device_id, zone_id, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    _new_uuid(),
                    "mqtt_connected" if mqtt_connected else "mqtt_disconnected",
                    device.get("domain_id"),
                    device.get("site_id"),
                    device["id"],
                    json.dumps({"device_id": device_external_id, "source": source, "last_error": last_error}, separators=(",", ":"), sort_keys=True),
                    now,
                ),
            )

        conn.commit()

    result = _row_to_dict(state_row) or {}
    if "online" in result and result["online"] is not None:
        result["online"] = bool(result["online"])
    if "mqtt_connected" in result and result["mqtt_connected"] is not None:
        result["mqtt_connected"] = bool(result["mqtt_connected"])
    return result


def upsert_zone_state(
    device_external_id: str,
    zone_id: int,
    *,
    current_temperature: float | None = None,
    target_temperature: float | None = None,
    demand: bool | None = None,
    active: bool | None = None,
    fault: str | None = None,
    source: str = "rest",
    source_timestamp: str | None = None,
) -> dict[str, Any]:
    ensure_default_zones(device_external_id, zone_count=max(3, int(zone_id)))
    now = _now_iso()
    with get_connection() as conn:
        device = _resolve_device(conn, device_external_id)
        row = conn.execute(
            "SELECT current_temperature, target_temperature, demand FROM zone_state WHERE device_id = ? AND zone_id = ?",
            (device["id"], zone_id),
        ).fetchone()

        conn.execute(
            """
            INSERT INTO zone_state(device_id, zone_id, current_temperature, target_temperature, demand, active, fault, source_timestamp, updated_at, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, zone_id) DO UPDATE SET
                current_temperature = excluded.current_temperature,
                target_temperature = excluded.target_temperature,
                demand = excluded.demand,
                active = excluded.active,
                fault = excluded.fault,
                source_timestamp = excluded.source_timestamp,
                updated_at = excluded.updated_at,
                source = excluded.source
            """,
            (
                device["id"],
                zone_id,
                current_temperature,
                target_temperature,
                None if demand is None else int(bool(demand)),
                None if active is None else int(bool(active)),
                fault,
                source_timestamp or now,
                now,
                source,
            ),
        )

        if current_temperature is not None or target_temperature is not None:
            conn.execute(
                """
                INSERT INTO temperature_history(uuid, device_id, zone_id, current_temperature, target_temperature, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (_new_uuid(), device["id"], zone_id, current_temperature, target_temperature, now),
            )

        if target_temperature is not None and (row is None or row["target_temperature"] != target_temperature):
            conn.execute(
                """
                INSERT INTO setpoint_history(uuid, device_id, zone_id, target_temperature, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (_new_uuid(), device["id"], zone_id, target_temperature, source, now),
            )

        if demand is not None:
            previous_demand = None if row is None else row["demand"]
            if previous_demand is None or int(bool(demand)) != int(previous_demand):
                conn.execute(
                    """
                    INSERT INTO demand_history(uuid, device_id, zone_id, demand, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (_new_uuid(), device["id"], zone_id, int(bool(demand)), source, now),
                )

        _prune_history(conn, device_pk_id=device["id"])

        if row is not None:
            if current_temperature is not None and row["current_temperature"] != current_temperature:
                conn.execute(
                    """
                    INSERT INTO event_log(uuid, event_type, domain_id, site_id, device_id, zone_id, payload_json, created_at)
                    VALUES (?, 'zone_temperature_changed', ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _new_uuid(),
                        device.get("domain_id"),
                        device.get("site_id"),
                        device["id"],
                        zone_id,
                        json.dumps({"device_id": device_external_id, "zone_id": zone_id, "current_temperature_c": current_temperature}, separators=(",", ":"), sort_keys=True),
                        now,
                    ),
                )
            if target_temperature is not None and row["target_temperature"] != target_temperature:
                conn.execute(
                    """
                    INSERT INTO event_log(uuid, event_type, domain_id, site_id, device_id, zone_id, payload_json, created_at)
                    VALUES (?, 'zone_setpoint_changed', ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _new_uuid(),
                        device.get("domain_id"),
                        device.get("site_id"),
                        device["id"],
                        zone_id,
                        json.dumps({"device_id": device_external_id, "zone_id": zone_id, "target_temperature_c": target_temperature}, separators=(",", ":"), sort_keys=True),
                        now,
                    ),
                )

        conn.commit()

    return get_device_zone(device_external_id, zone_id)


def resolve_zone_ref(zone_ref: str) -> tuple[str, int]:
    # Preferred public ref: zone_metadata.uuid
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT d.device_id, zm.zone_id
            FROM zone_metadata zm
            JOIN devices d ON d.id = zm.device_id
            WHERE zm.uuid = ?
            """,
            (zone_ref,),
        ).fetchone()
        if row is not None:
            return str(row["device_id"]), int(row["zone_id"])

    # Compatibility: <device_id>:<zone_id>
    if ":" in zone_ref:
        dev, raw_zone = zone_ref.split(":", 1)
        try:
            zid = int(raw_zone)
        except ValueError as exc:
            raise DomainModelError("zone reference must be uuid or <device_id>:<zone_id>") from exc
        return dev, zid

    raise RegistryNotFoundError("zone not found")


def list_mobile_domains() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
                 SELECT COALESCE(d.uuid, d.slug) AS domain_id, d.slug AS domain_slug, d.name AS domain_name,
                   COUNT(s.id) AS site_count,
                   COUNT(dev.id) AS device_count
            FROM domains d
            LEFT JOIN sites s ON s.domain_id = d.id
            LEFT JOIN devices dev ON dev.site_id = s.id
            GROUP BY d.id
            ORDER BY d.id
            """
        ).fetchall()
    return [_row_to_dict(row) or {} for row in rows]


def list_mobile_sites() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
                 SELECT COALESCE(s.uuid, s.slug) AS site_id, s.slug AS site_slug, s.name AS site_name,
                     COALESCE(d.uuid, d.slug) AS domain_id, d.name AS domain_name, d.slug AS domain_slug,
                   COUNT(dev.id) AS device_count
            FROM sites s
            JOIN domains d ON d.id = s.domain_id
            LEFT JOIN devices dev ON dev.site_id = s.id
            GROUP BY s.id
            ORDER BY s.id
            """
        ).fetchall()
    return [_row_to_dict(row) or {} for row in rows]


def get_mobile_site(site_ref: str) -> dict[str, Any]:
    with get_connection() as conn:
        site = _resolve_site(conn, site_ref)
        rows = conn.execute(
            """
            SELECT d.device_id, d.uuid, d.display_name, d.firmware_version,
                   ds.online, ds.mqtt_connected, ds.updated_at
            FROM devices d
            LEFT JOIN device_state ds ON ds.device_id = d.id
            WHERE d.site_id = ?
            ORDER BY d.id
            """,
            (site["id"],),
        ).fetchall()
    return {
        "site_id": site["uuid"] or site["slug"],
        "site_name": site["name"],
        "site_slug": site["slug"],
        "domain": {
            "domain_id": site["domain_uuid"] or site["domain_slug"],
            "domain_name": site["domain_name"],
        },
        "devices": [
            {
                "device_id": row["device_id"],
                "device_uuid": row["uuid"],
                "display_name": row["display_name"],
                "firmware_version": row["firmware_version"],
                "online": bool(row["online"]) if row["online"] is not None else False,
                "mqtt_connected": bool(row["mqtt_connected"]) if row["mqtt_connected"] is not None else False,
                "updated_at": row["updated_at"],
            }
            for row in rows
        ],
    }


def list_events(
    *,
    limit: int = 100,
    device_external_id: str | None = None,
    event_type: str | None = None,
    domain_id: int | None = None,
    site_id: int | None = None,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    with get_connection() as conn:
        params: list[Any] = []
        where_clauses: list[str] = []
        if device_external_id:
            dev = _resolve_device(conn, device_external_id)
            where_clauses.append("e.device_id = ?")
            params.append(dev["id"])
        if event_type:
            where_clauses.append("e.event_type = ?")
            params.append(event_type)
        if domain_id is not None:
            where_clauses.append("e.domain_id = ?")
            params.append(domain_id)
        if site_id is not None:
            where_clauses.append("e.site_id = ?")
            params.append(site_id)

        where = ""
        if where_clauses:
            where = "WHERE " + " AND ".join(where_clauses)

        rows = conn.execute(
            f"""
            SELECT e.id, e.uuid, e.event_type, e.domain_id, e.site_id, e.device_id, e.zone_id, e.payload_json, e.created_at,
                   d.device_id AS device_external_id
            FROM event_log e
            LEFT JOIN devices d ON d.id = e.device_id
            {where}
            ORDER BY e.id DESC
            LIMIT ?
            """,
            (*params, safe_limit),
        ).fetchall()

    events: list[dict[str, Any]] = []
    for row in rows:
        event = _row_to_dict(row) or {}
        try:
            event["payload"] = json.loads(event.pop("payload_json") or "{}")
        except json.JSONDecodeError:
            event["payload"] = {}
        events.append(event)
    return events


def list_notifications_for_user(user_id: int, *, limit: int = 100) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT n.id, n.uuid, n.read, n.created_at,
                   e.uuid AS event_uuid, e.event_type, e.payload_json, e.created_at AS event_created_at
            FROM notifications n
            JOIN event_log e ON e.id = n.event_id
            WHERE n.user_id = ?
            ORDER BY n.id DESC
            LIMIT ?
            """,
            (user_id, safe_limit),
        ).fetchall()

    result: list[dict[str, Any]] = []
    for row in rows:
        payload = {}
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        result.append(
            {
                "notification_id": row["uuid"],
                "read": bool(row["read"]),
                "created_at": row["created_at"],
                "event": {
                    "event_id": row["event_uuid"],
                    "event_type": row["event_type"],
                    "payload": payload,
                    "created_at": row["event_created_at"],
                },
            }
        )
    return result


def mark_notification_read(notification_uuid: str, *, user_id: int, read: bool = True) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT n.id
            FROM notifications n
            WHERE n.uuid = ? AND n.user_id = ?
            """,
            (notification_uuid, user_id),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("notification not found")

        conn.execute(
            """
            UPDATE notifications
            SET read = ?
            WHERE id = ?
            """,
            (1 if read else 0, row["id"]),
        )
        conn.commit()

    notifications = list_notifications_for_user(user_id, limit=500)
    for notification in notifications:
        if notification["notification_id"] == notification_uuid:
            return notification
    raise RegistryNotFoundError("notification not found")


def mark_all_notifications_read(*, user_id: int) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """
            UPDATE notifications
            SET read = 1
            WHERE user_id = ? AND read = 0
            """,
            (user_id,),
        )
        conn.commit()
    return int(cur.rowcount or 0)
