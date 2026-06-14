from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path

from app.mqtt_users import should_apply_external_commands


_ACL_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_TOPIC_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _acl_output_path() -> Path:
    return Path(os.getenv("HVAC_EDGE_MQTT_ACL_FILE", "/mosquitto/config/acl"))


def _write_acl_atomic(output_path: Path, content: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        # Write in-place to preserve existing ownership/permissions (important
        # when the broker process owns the file and this process runs as a
        # different user but still has write access via group or world bits).
        with output_path.open("w", encoding="utf-8") as fh:
            fh.write(content)
    else:
        tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
        tmp_path.write_text(content, encoding="utf-8")
        tmp_path.replace(output_path)


def _load_acl_sources(conn: sqlite3.Connection) -> tuple[list[sqlite3.Row], list[sqlite3.Row], list[sqlite3.Row]]:
    clients = conn.execute(
        """
        SELECT id, username, client_type, domain_id, site_id, device_id, enabled
        FROM mqtt_clients
        WHERE enabled = 1
        ORDER BY id
        """
    ).fetchall()

    devices = conn.execute(
        """
        SELECT d.id, d.device_id, d.site_id, s.domain_id
        FROM devices d
        LEFT JOIN sites s ON s.id = d.site_id
        """
    ).fetchall()

    sites = conn.execute("SELECT id, domain_id FROM sites").fetchall()
    return clients, devices, sites


def _map_domain_devices(devices: list[sqlite3.Row]) -> dict[int, list[str]]:
    mapping: dict[int, list[str]] = {}
    for row in devices:
        domain_id = row["domain_id"]
        if domain_id is None:
            continue
        mapping.setdefault(domain_id, []).append(row["device_id"])
    for domain_id in mapping:
        mapping[domain_id] = sorted(set(mapping[domain_id]))
    return mapping


def _map_site_domain(sites: list[sqlite3.Row]) -> dict[int, int]:
    return {row["id"]: row["domain_id"] for row in sites}


def _render_acl_content(clients: list[sqlite3.Row], devices: list[sqlite3.Row], sites: list[sqlite3.Row]) -> str:
    lines: list[str] = []
    domain_devices = _map_domain_devices(devices)
    site_domain = _map_site_domain(sites)

    device_id_by_pk = {row["id"]: row["device_id"] for row in devices}

    def safe_username(username: str) -> str:
        if not _ACL_USERNAME_RE.fullmatch(username):
            raise ValueError(f"invalid ACL username: {username!r}")
        return username

    def safe_topic_segment(segment: str) -> str:
        if not _TOPIC_SEGMENT_RE.fullmatch(segment):
            raise ValueError(f"invalid ACL topic segment: {segment!r}")
        return segment

    for client in clients:
        username = safe_username(client["username"])
        client_type = client["client_type"]
        domain_id = client["domain_id"]
        site_id = client["site_id"]
        device_pk = client["device_id"]

        lines.append(f"user {username}")

        if client_type == "admin":
            lines.append("topic readwrite #")
            lines.append("")
            continue

        if client_type == "device":
            device_topic_id = None
            if device_pk is not None:
                device_topic_id = device_id_by_pk.get(device_pk)
            if device_topic_id is None and username.startswith("device_"):
                device_topic_id = username[len("device_"):]
            if device_topic_id:
                lines.append(f"topic readwrite homie/5/{safe_topic_segment(device_topic_id)}/#")
            lines.append("")
            continue

        # Domain-scoped smart-home/service clients.
        resolved_domain_id = domain_id
        if resolved_domain_id is None and site_id is not None:
            resolved_domain_id = site_domain.get(site_id)

        if resolved_domain_id is not None:
            for dev_id in domain_devices.get(resolved_domain_id, []):
                safe_dev_id = safe_topic_segment(dev_id)
                lines.append(f"topic read homie/5/{safe_dev_id}/#")
                if client_type in {"homeassistant", "homey", "service"}:
                    lines.append(f"topic write homie/5/{safe_dev_id}/+/target-temperature/set")
        else:
            # Conservative fallback for unscoped service users.
            if client_type == "service":
                lines.append("topic read homie/5/#")

        lines.append("")

    # Ensure trailing newline for mosquitto parser friendliness.
    return "\n".join(lines).rstrip() + "\n"


def _log_generation(conn: sqlite3.Connection, success: bool, message: str) -> None:
    conn.execute(
        "INSERT INTO acl_generation_log(success, message) VALUES (?, ?)",
        (1 if success else 0, message),
    )


def build_acl_status(conn: sqlite3.Connection, *, acl_path: Path, limit: int) -> dict:
    safe_limit = max(1, min(limit, 100))
    exists = acl_path.exists()
    size_bytes = acl_path.stat().st_size if exists else 0
    checksum = None
    if exists:
        import hashlib

        checksum = hashlib.sha256(acl_path.read_bytes()).hexdigest()

    rows = conn.execute(
        """
        SELECT id, success, message, generated_at
        FROM acl_generation_log
        ORDER BY id DESC
        LIMIT ?
        """,
        (safe_limit,),
    ).fetchall()

    logs = [
        {
            "id": row["id"],
            "success": bool(row["success"]),
            "message": row["message"],
            "generated_at": row["generated_at"],
        }
        for row in rows
    ]

    return {
        "acl_file": {
            "path": str(acl_path),
            "exists": exists,
            "size_bytes": size_bytes,
            "sha256": checksum,
        },
        "generation_logs": logs,
    }


def generate_acl_file(conn: sqlite3.Connection) -> str:
    clients, devices, sites = _load_acl_sources(conn)
    content = _render_acl_content(clients, devices, sites)

    # In local/dev mode where broker commands are disabled, default to dry-run to
    # avoid writes to container-only paths like /mosquitto/config/acl.
    dry_run = _bool_env("HVAC_EDGE_DRY_RUN_ACL_WRITE", False) or (not should_apply_external_commands())
    output_path = _acl_output_path()

    try:
        if not dry_run:
            _write_acl_atomic(output_path, content)
        _log_generation(conn, True, f"generated acl for {len(clients)} clients")
        return content
    except Exception as exc:  # noqa: BLE001 - write failures should be logged and surfaced
        _log_generation(conn, False, f"acl generation failed: {exc}")
        raise
