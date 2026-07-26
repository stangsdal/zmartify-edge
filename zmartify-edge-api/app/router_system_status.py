from __future__ import annotations

import os
import socket
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER, audit_action
from app.db import get_connection, get_database_backend, get_database_url, get_db_path, get_runtime_database_backend
from app.mqtt_acl import build_acl_preview_for_client, build_acl_status
from app.registry import RegistryOperationError, regenerate_acl_now


def _database_check() -> dict:
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1").fetchone()
        return {
            "ok": True,
            "runtime_backend": get_runtime_database_backend(),
            "configured_backend": get_database_backend(),
        }
    except Exception as exc:  # pragma: no cover - defensive for runtime readiness
        return {
            "ok": False,
            "runtime_backend": get_runtime_database_backend(),
            "configured_backend": get_database_backend(),
            "error": str(exc),
        }


def _migration_check() -> dict:
    try:
        with get_connection() as conn:
            row = conn.execute("SELECT COUNT(*) AS count FROM schema_migrations").fetchone()
        return {"ok": True, "applied_count": int(row["count"] if row else 0)}
    except Exception as exc:  # pragma: no cover - defensive for runtime readiness
        return {"ok": False, "error": str(exc)}


def _mqtt_check() -> dict:
    host = os.getenv("MQTT_HOST", "mosquitto").strip() or "mosquitto"
    raw_port = os.getenv("MQTT_PORT", "1883").strip()
    try:
        port = int(raw_port)
    except ValueError:
        return {"ok": False, "host": host, "port": raw_port, "error": "invalid MQTT_PORT"}
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return {"ok": True, "host": host, "port": port}
    except OSError as exc:
        return {"ok": False, "host": host, "port": port, "error": str(exc)}


def _storage_check() -> dict:
    db_path = get_db_path()
    paths = {
        "data": db_path.parent,
        "mqtt_config": Path(os.getenv("ZMART_EDGE_MQTT_ACL_FILE", "/mosquitto/config/acl")).parent,
    }
    results: dict[str, dict] = {}
    for name, path in paths.items():
        exists = path.exists()
        writable = exists and os.access(path, os.W_OK)
        results[name] = {"path": str(path), "exists": exists, "writable": writable}
    return {"ok": all(item["exists"] and item["writable"] for item in results.values()), "paths": results}


def _ready_payload() -> dict:
    checks = {
        "database": _database_check(),
        "migrations": _migration_check(),
        "mqtt": _mqtt_check(),
        "storage": _storage_check(),
    }
    return {"ok": all(check.get("ok") is True for check in checks.values()), "checks": checks}


def create_system_status_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(tags=["system-status"])

    @router.get("/health")
    def health() -> dict:
        db_url = get_database_url()
        db_scheme = db_url.split(":", 1)[0] if ":" in db_url else "sqlite"
        return {
            "ok": True,
            "service": "zmartify-edge-api",
            "db_path": str(get_db_path()),
            "db_backend": get_runtime_database_backend(),
            "configured_database_backend": get_database_backend(),
            "database_url_scheme": db_scheme,
        }

    @router.get("/health/live")
    def health_live() -> dict:
        return {"ok": True, "service": "zmartify-edge-api"}

    @router.get("/health/ready")
    def health_ready() -> dict:
        payload = _ready_payload()
        if not payload["ok"]:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=payload)
        return payload

    @router.get("/registry/status")
    def registry_status() -> dict:
        return {
            "phase": "C",
            "status": "registry_and_mqtt_client_lifecycle_enabled",
        }

    @router.get("/admin/acl/status")
    def acl_status(request: Request, limit: int = 10) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        acl_path = Path(os.getenv("ZMART_EDGE_MQTT_ACL_FILE", "/mosquitto/config/acl"))
        with get_connection() as conn:
            return build_acl_status(conn, acl_path=acl_path, limit=limit)

    @router.get("/admin/acl/preview/{client_id}")
    def acl_preview(client_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        with get_connection() as conn:
            try:
                return build_acl_preview_for_client(conn, client_id)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/admin/acl/regenerate")
    def admin_regenerate_acl(request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            result = regenerate_acl_now()
            auth_user = request.state.auth_user
            audit_action(actor_user_id=auth_user.user_id, action="acl_regeneration", resource_type="acl")
            return result
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return router
