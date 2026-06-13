from __future__ import annotations

import sqlite3
from typing import Any

from app.db import get_connection
from app.mqtt_users import (
    MqttUserCommandError,
    create_or_update_mqtt_user,
    generate_password,
    hash_password_for_registry,
    reload_broker,
)


class RegistryNotFoundError(ValueError):
    """Raised when a requested registry resource does not exist."""


class RegistryConflictError(ValueError):
    """Raised when a unique or ownership constraint is violated."""


class RegistryOperationError(RuntimeError):
    """Raised when an external operation (e.g. broker command) fails."""


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
            device = _row_to_dict(row) or {}
            if device:
                _auto_provision_device_mqtt_client(conn, device)
            return device
    except sqlite3.IntegrityError as exc:
        raise RegistryConflictError("device_id already exists") from exc
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc


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


def _ensure_scope_exists(
    conn: sqlite3.Connection,
    *,
    domain_id: int | None,
    site_id: int | None,
    device_pk_id: int | None,
) -> None:
    if domain_id is not None:
        found = conn.execute("SELECT 1 FROM domains WHERE id = ?", (domain_id,)).fetchone()
        if found is None:
            raise RegistryNotFoundError("domain not found")

    if site_id is not None:
        found = conn.execute("SELECT domain_id FROM sites WHERE id = ?", (site_id,)).fetchone()
        if found is None:
            raise RegistryNotFoundError("site not found")
        if domain_id is not None and found["domain_id"] != domain_id:
            raise RegistryConflictError("site does not belong to selected domain")

    if device_pk_id is not None:
        found = conn.execute("SELECT site_id FROM devices WHERE id = ?", (device_pk_id,)).fetchone()
        if found is None:
            raise RegistryNotFoundError("device not found")


def _insert_mqtt_client(
    conn: sqlite3.Connection,
    *,
    username: str,
    client_type: str,
    domain_id: int | None,
    site_id: int | None,
    device_pk_id: int | None,
) -> dict[str, Any]:
    try:
        cur = conn.execute(
            """
            INSERT INTO mqtt_clients(username, client_type, domain_id, site_id, device_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (username, client_type, domain_id, site_id, device_pk_id),
        )
    except sqlite3.IntegrityError as exc:
        raise RegistryConflictError("mqtt username already exists") from exc

    row = conn.execute(
        """
        SELECT id, username, client_type, domain_id, site_id, device_id, created_at, enabled
        FROM mqtt_clients
        WHERE id = ?
        """,
        (cur.lastrowid,),
    ).fetchone()
    return _row_to_dict(row) or {}


def _write_mqtt_credentials(
    conn: sqlite3.Connection,
    *,
    mqtt_client_id: int,
    password_plain: str,
) -> None:
    password_hash = hash_password_for_registry(password_plain)
    conn.execute(
        """
        INSERT INTO mqtt_credentials(mqtt_client_id, password_hash, password_plain_for_initial_display)
        VALUES (?, ?, ?)
        ON CONFLICT(mqtt_client_id) DO UPDATE SET
            password_hash=excluded.password_hash,
            password_plain_for_initial_display=excluded.password_plain_for_initial_display,
            rotated_at=CURRENT_TIMESTAMP
        """,
        (mqtt_client_id, password_hash, password_plain),
    )


def _auto_provision_device_mqtt_client(conn: sqlite3.Connection, device: dict[str, Any]) -> None:
    username = f"device_{device['device_id']}"

    existing = conn.execute(
        """
        SELECT id, username FROM mqtt_clients WHERE client_type = 'device' AND device_id = ? LIMIT 1
        """,
        (device["id"],),
    ).fetchone()
    if existing is not None:
        return

    password = generate_password()
    client = _insert_mqtt_client(
        conn,
        username=username,
        client_type="device",
        domain_id=None,
        site_id=device.get("site_id"),
        device_pk_id=device["id"],
    )
    _write_mqtt_credentials(conn, mqtt_client_id=client["id"], password_plain=password)
    create_or_update_mqtt_user(username, password)
    reload_broker()


def _default_mqtt_username(
    *,
    conn: sqlite3.Connection,
    client_type: str,
    domain_id: int | None,
    site_id: int | None,
    device_pk_id: int | None,
) -> str:
    if client_type == "device":
        if device_pk_id is None:
            raise RegistryConflictError("device client requires device_id")
        row = conn.execute("SELECT device_id FROM devices WHERE id = ?", (device_pk_id,)).fetchone()
        if row is None:
            raise RegistryNotFoundError("device not found")
        return f"device_{row['device_id']}"
    if client_type in {"homeassistant", "homey"}:
        if domain_id is None:
            raise RegistryConflictError(f"{client_type} client requires domain_id")
        return f"{client_type}_domain_{domain_id}"
    if client_type == "admin":
        return "admin_local"
    if client_type == "service":
        if domain_id is not None:
            return f"service_domain_{domain_id}"
        if site_id is not None:
            return f"service_site_{site_id}"
        return "service_local"
    raise RegistryConflictError("unsupported client_type")


def create_mqtt_client(
    *,
    client_type: str,
    domain_id: int | None,
    site_id: int | None,
    device_pk_id: int | None,
    username: str | None,
) -> dict[str, Any]:
    password = generate_password()
    with get_connection() as conn:
        _ensure_scope_exists(
            conn,
            domain_id=domain_id,
            site_id=site_id,
            device_pk_id=device_pk_id,
        )
        resolved_username = username or _default_mqtt_username(
            conn=conn,
            client_type=client_type,
            domain_id=domain_id,
            site_id=site_id,
            device_pk_id=device_pk_id,
        )

        client = _insert_mqtt_client(
            conn,
            username=resolved_username,
            client_type=client_type,
            domain_id=domain_id,
            site_id=site_id,
            device_pk_id=device_pk_id,
        )
        _write_mqtt_credentials(conn, mqtt_client_id=client["id"], password_plain=password)

    try:
        create_or_update_mqtt_user(resolved_username, password)
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc

    client["password"] = password
    return client


def list_mqtt_clients() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, username, client_type, domain_id, site_id, device_id, created_at, enabled
            FROM mqtt_clients
            ORDER BY id
            """
        ).fetchall()
        return [_row_to_dict(row) or {} for row in rows]


def get_mqtt_client(client_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, username, client_type, domain_id, site_id, device_id, created_at, enabled
            FROM mqtt_clients
            WHERE id = ?
            """,
            (client_id,),
        ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RegistryNotFoundError("mqtt client not found")
        return result


def rotate_mqtt_client_password(client_id: int) -> dict[str, Any]:
    password = generate_password()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, username FROM mqtt_clients WHERE id = ?",
            (client_id,),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("mqtt client not found")
        username = row["username"]
        _write_mqtt_credentials(conn, mqtt_client_id=client_id, password_plain=password)

    try:
        create_or_update_mqtt_user(username, password)
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc

    return {
        "mqtt_client_id": client_id,
        "username": username,
        "password": password,
        "password_one_time": True,
    }


def set_mqtt_client_enabled(client_id: int, enabled: bool) -> dict[str, Any]:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE mqtt_clients SET enabled = ? WHERE id = ?",
            (1 if enabled else 0, client_id),
        )
        if cur.rowcount == 0:
            raise RegistryNotFoundError("mqtt client not found")
        row = conn.execute(
            """
            SELECT id, username, client_type, domain_id, site_id, device_id, created_at, enabled
            FROM mqtt_clients
            WHERE id = ?
            """,
            (client_id,),
        ).fetchone()

    try:
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc

    return _row_to_dict(row) or {}


def delete_mqtt_client(client_id: int) -> None:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM mqtt_clients WHERE id = ?", (client_id,))
        if cur.rowcount == 0:
            raise RegistryNotFoundError("mqtt client not found")

    try:
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc
