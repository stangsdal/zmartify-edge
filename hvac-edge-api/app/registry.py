from __future__ import annotations

import sqlite3
from typing import Any

from app.db import get_connection


class RegistryNotFoundError(ValueError):
    """Raised when a requested registry resource does not exist."""


class RegistryConflictError(ValueError):
    """Raised when a unique or ownership constraint is violated."""


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def create_domain(slug: str, name: str) -> dict[str, Any]:
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO domains(slug, name) VALUES (?, ?)",
                (slug, name),
            )
            row = conn.execute(
                "SELECT id, slug, name, created_at FROM domains WHERE id = ?",
                (cur.lastrowid,),
            ).fetchone()
            return _row_to_dict(row) or {}
    except sqlite3.IntegrityError as exc:
        raise RegistryConflictError("domain slug already exists") from exc


def list_domains() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, slug, name, created_at FROM domains ORDER BY id"
        ).fetchall()
        return [_row_to_dict(row) or {} for row in rows]


def get_domain(domain_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, slug, name, created_at FROM domains WHERE id = ?",
            (domain_id,),
        ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RegistryNotFoundError("domain not found")
        return result


def delete_domain(domain_id: int) -> None:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM domains WHERE id = ?", (domain_id,))
        if cur.rowcount == 0:
            raise RegistryNotFoundError("domain not found")


def create_site(domain_id: int, slug: str, name: str) -> dict[str, Any]:
    with get_connection() as conn:
        exists = conn.execute("SELECT 1 FROM domains WHERE id = ?", (domain_id,)).fetchone()
        if exists is None:
            raise RegistryNotFoundError("domain not found")

        try:
            cur = conn.execute(
                "INSERT INTO sites(domain_id, slug, name) VALUES (?, ?, ?)",
                (domain_id, slug, name),
            )
        except sqlite3.IntegrityError as exc:
            raise RegistryConflictError("site slug already exists in this domain") from exc

        row = conn.execute(
            "SELECT id, domain_id, slug, name, created_at FROM sites WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        return _row_to_dict(row) or {}


def list_sites(domain_id: int) -> list[dict[str, Any]]:
    with get_connection() as conn:
        exists = conn.execute("SELECT 1 FROM domains WHERE id = ?", (domain_id,)).fetchone()
        if exists is None:
            raise RegistryNotFoundError("domain not found")

        rows = conn.execute(
            "SELECT id, domain_id, slug, name, created_at FROM sites WHERE domain_id = ? ORDER BY id",
            (domain_id,),
        ).fetchall()
        return [_row_to_dict(row) or {} for row in rows]


def get_site(site_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, domain_id, slug, name, created_at FROM sites WHERE id = ?",
            (site_id,),
        ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RegistryNotFoundError("site not found")
        return result


def delete_site(site_id: int) -> None:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM sites WHERE id = ?", (site_id,))
        if cur.rowcount == 0:
            raise RegistryNotFoundError("site not found")


def create_device(
    *,
    device_id: str,
    display_name: str,
    mac: str | None,
    firmware_version: str | None,
) -> dict[str, Any]:
    try:
        with get_connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO devices(device_id, display_name, mac, firmware_version)
                VALUES (?, ?, ?, ?)
                """,
                (device_id, display_name, mac, firmware_version),
            )
            row = conn.execute(
                """
                SELECT id, device_id, display_name, mac, firmware_version, site_id,
                       device_type, integration_mode, created_at, last_seen_at
                FROM devices
                WHERE id = ?
                """,
                (cur.lastrowid,),
            ).fetchone()
            return _row_to_dict(row) or {}
    except sqlite3.IntegrityError as exc:
        raise RegistryConflictError("device_id already exists") from exc


def list_devices() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, device_id, display_name, mac, firmware_version, site_id,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            ORDER BY id
            """
        ).fetchall()
        return [_row_to_dict(row) or {} for row in rows]


def get_device(device_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, device_id, display_name, mac, firmware_version, site_id,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RegistryNotFoundError("device not found")
        return result


def assign_device_site(device_id: str, site_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        device = conn.execute("SELECT 1 FROM devices WHERE device_id = ?", (device_id,)).fetchone()
        if device is None:
            raise RegistryNotFoundError("device not found")

        site = conn.execute("SELECT 1 FROM sites WHERE id = ?", (site_id,)).fetchone()
        if site is None:
            raise RegistryNotFoundError("site not found")

        conn.execute("UPDATE devices SET site_id = ? WHERE device_id = ?", (site_id, device_id))
        row = conn.execute(
            """
            SELECT id, device_id, display_name, mac, firmware_version, site_id,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()
        return _row_to_dict(row) or {}


def rename_device(device_id: str, display_name: str) -> dict[str, Any]:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE devices SET display_name = ? WHERE device_id = ?",
            (display_name, device_id),
        )
        if cur.rowcount == 0:
            raise RegistryNotFoundError("device not found")

        row = conn.execute(
            """
            SELECT id, device_id, display_name, mac, firmware_version, site_id,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()
        return _row_to_dict(row) or {}


def delete_device(device_id: str) -> None:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM devices WHERE device_id = ?", (device_id,))
        if cur.rowcount == 0:
            raise RegistryNotFoundError("device not found")
