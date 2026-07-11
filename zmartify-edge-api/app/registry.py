from __future__ import annotations

import secrets
import sqlite3
import uuid
from typing import Any

from app.db import get_connection
from app.mqtt_acl import generate_acl_file
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


def _new_uuid() -> str:
    return str(uuid.uuid4())


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def _sync_domain_to_core_v2(conn: sqlite3.Connection, domain: dict[str, Any]) -> None:
    if not _table_exists(conn, "core_domains_v2"):
        return
    conn.execute(
        """
        INSERT INTO core_domains_v2(uuid, slug, name)
        VALUES (?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
            name=excluded.name,
            uuid=excluded.uuid
        """,
        (domain.get("uuid"), domain.get("slug"), domain.get("name")),
    )


def _sync_site_to_core_v2(conn: sqlite3.Connection, site: dict[str, Any]) -> None:
    if not (_table_exists(conn, "core_domains_v2") and _table_exists(conn, "core_sites_v2")):
        return

    domain_row = conn.execute(
        "SELECT uuid, slug, name FROM domains WHERE id = ?",
        (site.get("domain_id"),),
    ).fetchone()
    if domain_row is None:
        return

    conn.execute(
        """
        INSERT INTO core_domains_v2(uuid, slug, name)
        VALUES (?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
            name=excluded.name,
            uuid=excluded.uuid
        """,
        (domain_row["uuid"], domain_row["slug"], domain_row["name"]),
    )

    core_domain = conn.execute(
        "SELECT id FROM core_domains_v2 WHERE slug = ?",
        (domain_row["slug"],),
    ).fetchone()
    if core_domain is None:
        return

    conn.execute(
        """
        INSERT INTO core_sites_v2(uuid, domain_id, slug, name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(domain_id, slug) DO UPDATE SET
            name=excluded.name,
            uuid=excluded.uuid
        """,
        (site.get("uuid"), int(core_domain["id"]), site.get("slug"), site.get("name")),
    )


def _sync_device_to_core_v2(conn: sqlite3.Connection, device: dict[str, Any]) -> None:
    if not (
        _table_exists(conn, "core_domains_v2")
        and _table_exists(conn, "core_sites_v2")
        and _table_exists(conn, "core_devices_v2")
    ):
        return

    core_site_id: int | None = None
    site_id = device.get("site_id")
    if site_id is not None:
        site_row = conn.execute(
            """
            SELECT s.uuid, s.slug, s.name, d.uuid AS domain_uuid, d.slug AS domain_slug, d.name AS domain_name
            FROM sites s
            JOIN domains d ON d.id = s.domain_id
            WHERE s.id = ?
            """,
            (site_id,),
        ).fetchone()
        if site_row is not None:
            conn.execute(
                """
                INSERT INTO core_domains_v2(uuid, slug, name)
                VALUES (?, ?, ?)
                ON CONFLICT(slug) DO UPDATE SET
                    name=excluded.name,
                    uuid=excluded.uuid
                """,
                (site_row["domain_uuid"], site_row["domain_slug"], site_row["domain_name"]),
            )
            core_domain = conn.execute(
                "SELECT id FROM core_domains_v2 WHERE slug = ?",
                (site_row["domain_slug"],),
            ).fetchone()
            if core_domain is not None:
                conn.execute(
                    """
                    INSERT INTO core_sites_v2(uuid, domain_id, slug, name)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(domain_id, slug) DO UPDATE SET
                        name=excluded.name,
                        uuid=excluded.uuid
                    """,
                    (site_row["uuid"], int(core_domain["id"]), site_row["slug"], site_row["name"]),
                )
                core_site = conn.execute(
                    "SELECT id FROM core_sites_v2 WHERE domain_id = ? AND slug = ?",
                    (int(core_domain["id"]), site_row["slug"]),
                ).fetchone()
                if core_site is not None:
                    core_site_id = int(core_site["id"])

    conn.execute(
        """
        INSERT INTO core_devices_v2(
            uuid,
            device_ref,
            display_name,
            site_id,
            product_type,
            product_model,
            firmware_version,
            integration_mode,
            identity_json,
            last_seen_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_ref) DO UPDATE SET
            uuid=excluded.uuid,
            display_name=excluded.display_name,
            site_id=excluded.site_id,
            product_type=excluded.product_type,
            product_model=excluded.product_model,
            firmware_version=excluded.firmware_version,
            integration_mode=excluded.integration_mode,
            identity_json=excluded.identity_json,
            last_seen_at=excluded.last_seen_at
        """,
        (
            device.get("uuid"),
            device.get("device_id"),
            device.get("display_name"),
            core_site_id,
            device.get("device_type") or "hvac",
            None,
            device.get("firmware_version"),
            device.get("integration_mode") or "mqtt",
            None,
            device.get("last_seen_at"),
        ),
    )


def create_domain(slug: str, name: str) -> dict[str, Any]:
    try:
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO domains(uuid, slug, name) VALUES (?, ?, ?)",
                (_new_uuid(), slug, name),
            )
            row = conn.execute(
                "SELECT id, uuid, slug, name, created_at FROM domains WHERE id = ?",
                (cur.lastrowid,),
            ).fetchone()
            domain = _row_to_dict(row) or {}
            if domain:
                _sync_domain_to_core_v2(conn, domain)
            return domain
    except sqlite3.IntegrityError as exc:
        raise RegistryConflictError("domain slug already exists") from exc


def list_domains() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, uuid, slug, name, created_at FROM domains ORDER BY id"
        ).fetchall()
        return [_row_to_dict(row) or {} for row in rows]


def get_domain(domain_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, uuid, slug, name, created_at FROM domains WHERE id = ?",
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


def rename_domain(domain_id: int, name: str) -> dict[str, Any]:
    with get_connection() as conn:
        cur = conn.execute("UPDATE domains SET name = ? WHERE id = ?", (name, domain_id))
        if cur.rowcount == 0:
            raise RegistryNotFoundError("domain not found")
        row = conn.execute(
            "SELECT id, uuid, slug, name, created_at FROM domains WHERE id = ?",
            (domain_id,),
        ).fetchone()
        domain = _row_to_dict(row) or {}
        if domain:
            _sync_domain_to_core_v2(conn, domain)
        return domain


def create_site(domain_id: int, slug: str, name: str) -> dict[str, Any]:
    with get_connection() as conn:
        exists = conn.execute("SELECT 1 FROM domains WHERE id = ?", (domain_id,)).fetchone()
        if exists is None:
            raise RegistryNotFoundError("domain not found")

        try:
            cur = conn.execute(
                "INSERT INTO sites(uuid, domain_id, slug, name) VALUES (?, ?, ?, ?)",
                (_new_uuid(), domain_id, slug, name),
            )
        except sqlite3.IntegrityError as exc:
            raise RegistryConflictError("site slug already exists in this domain") from exc

        row = conn.execute(
            "SELECT id, uuid, domain_id, slug, name, created_at FROM sites WHERE id = ?",
            (cur.lastrowid,),
        ).fetchone()
        site = _row_to_dict(row) or {}
        if site:
            _sync_site_to_core_v2(conn, site)
        return site


def list_sites(domain_id: int) -> list[dict[str, Any]]:
    with get_connection() as conn:
        exists = conn.execute("SELECT 1 FROM domains WHERE id = ?", (domain_id,)).fetchone()
        if exists is None:
            raise RegistryNotFoundError("domain not found")

        rows = conn.execute(
            "SELECT id, uuid, domain_id, slug, name, created_at FROM sites WHERE domain_id = ? ORDER BY id",
            (domain_id,),
        ).fetchall()
        return [_row_to_dict(row) or {} for row in rows]


def get_site(site_id: int) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, uuid, domain_id, slug, name, created_at FROM sites WHERE id = ?",
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
                INSERT INTO devices(uuid, device_id, display_name, mac, firmware_version)
                VALUES (?, ?, ?, ?, ?)
                """,
                (_new_uuid(), device_id, display_name, mac, firmware_version),
            )
            row = conn.execute(
                """
                SELECT id, uuid, device_id, display_name, mac, firmware_version, site_id, local_url,
                       device_type, integration_mode, created_at, last_seen_at
                FROM devices
                WHERE id = ?
                """,
                (cur.lastrowid,),
            ).fetchone()
            device = _row_to_dict(row) or {}
            if device:
                _auto_provision_device_mqtt_client(conn, device)
                _sync_device_to_core_v2(conn, device)
            return device
    except sqlite3.IntegrityError as exc:
        raise RegistryConflictError("device_id already exists") from exc
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc


def list_devices() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
                 SELECT id, uuid, device_id, display_name, mac, firmware_version, site_id, local_url,
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
                 SELECT id, uuid, device_id, display_name, mac, firmware_version, site_id, local_url,
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
                 SELECT id, uuid, device_id, display_name, mac, firmware_version, site_id, local_url,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()
        device_payload = _row_to_dict(row) or {}
        if device_payload:
            _sync_device_to_core_v2(conn, device_payload)
        generate_acl_file(conn)
    try:
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc
    return device_payload


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
                 SELECT id, uuid, device_id, display_name, mac, firmware_version, site_id, local_url,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()
        device_payload = _row_to_dict(row) or {}
        if device_payload:
            _sync_device_to_core_v2(conn, device_payload)
        return device_payload


def delete_device(device_id: str) -> None:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM devices WHERE device_id = ?", (device_id,))
        if cur.rowcount == 0:
            raise RegistryNotFoundError("device not found")
        generate_acl_file(conn)
    try:
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc


def update_device_local_url(device_id: str, local_url: str) -> dict[str, Any]:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE devices SET local_url = ? WHERE device_id = ?",
            (local_url, device_id),
        )
        if cur.rowcount == 0:
            raise RegistryNotFoundError("device not found")
        row = conn.execute(
            """
            SELECT id, device_id, display_name, mac, firmware_version, site_id, local_url,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()
        return _row_to_dict(row) or {}


def update_device_firmware_version(device_id: str, firmware_version: str | None) -> dict[str, Any]:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE devices SET firmware_version = ? WHERE device_id = ?",
            (firmware_version, device_id),
        )
        if cur.rowcount == 0:
            raise RegistryNotFoundError("device not found")
        row = conn.execute(
            """
            SELECT id, device_id, display_name, mac, firmware_version, site_id, local_url,
                   device_type, integration_mode, created_at, last_seen_at
            FROM devices
            WHERE device_id = ?
            """,
            (device_id,),
        ).fetchone()
        device_payload = _row_to_dict(row) or {}
        if device_payload:
            _sync_device_to_core_v2(conn, device_payload)
        return device_payload


def ensure_device_admin_token(device_id: str) -> str:
    token = secrets.token_urlsafe(24)
    with get_connection() as conn:
        row = conn.execute(
            "SELECT device_admin_token FROM devices WHERE device_id = ?",
            (device_id,),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("device not found")
        existing = row["device_admin_token"]
        if existing:
            return str(existing)
        conn.execute(
            "UPDATE devices SET device_admin_token = ? WHERE device_id = ?",
            (token, device_id),
        )
        conn.commit()
    return token


def get_device_admin_token(device_id: str) -> str:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT device_admin_token FROM devices WHERE device_id = ?",
            (device_id,),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("device not found")
        token = row["device_admin_token"]
        if not token:
            raise RegistryNotFoundError("device admin token not available")
        return str(token)


def authenticate_device_admin_token(device_id: str, token: str) -> bool:
    if not token:
        return False
    with get_connection() as conn:
        row = conn.execute(
            "SELECT device_admin_token FROM devices WHERE device_id = ?",
            (device_id,),
        ).fetchone()
        if row is None:
            return False
        stored = row["device_admin_token"]
        if not stored:
            return False
        return secrets.compare_digest(str(stored), token)


def get_device_onboarding_context(device_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT d.id, d.device_id, d.display_name, d.mac, d.firmware_version, d.site_id, d.local_url,
                   d.device_type, d.integration_mode, d.created_at, d.last_seen_at,
                   s.domain_id
            FROM devices d
            LEFT JOIN sites s ON s.id = d.site_id
            WHERE d.device_id = ?
            """,
            (device_id,),
        ).fetchone()
        result = _row_to_dict(row)
        if result is None:
            raise RegistryNotFoundError("device not found")
        return result


def get_device_mqtt_credentials(device_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT mc.id AS mqtt_client_id, mc.username, cred.password_plain_for_initial_display AS password
            FROM devices d
            JOIN mqtt_clients mc ON mc.device_id = d.id AND mc.client_type = 'device'
            JOIN mqtt_credentials cred ON cred.mqtt_client_id = mc.id
            WHERE d.device_id = ?
            ORDER BY mc.id ASC
            LIMIT 1
            """,
            (device_id,),
        ).fetchone()
        result = _row_to_dict(row)
        if result is None or not result.get("password"):
            raise RegistryNotFoundError("device mqtt credentials not available")
        return result


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
    generate_acl_file(conn)
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
        generate_acl_file(conn)

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
        generate_acl_file(conn)

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
        generate_acl_file(conn)

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
        generate_acl_file(conn)

    try:
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc


def regenerate_acl_now() -> dict[str, Any]:
    with get_connection() as conn:
        content = generate_acl_file(conn)

    try:
        reload_broker()
    except MqttUserCommandError as exc:
        raise RegistryOperationError(str(exc)) from exc

    return {
        "ok": True,
        "line_count": len(content.splitlines()),
    }
