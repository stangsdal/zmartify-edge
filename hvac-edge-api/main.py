import os
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.db import get_connection, get_db_path, initialize_database
from app.mqtt_acl import build_acl_preview_for_client, build_acl_status
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    RegistryOperationError,
    assign_device_site,
    create_device,
    create_domain,
    create_mqtt_client,
    create_site,
    delete_device,
    delete_domain,
    delete_mqtt_client,
    delete_site,
    get_device,
    get_domain,
    get_mqtt_client,
    get_site,
    list_devices,
    list_domains,
    list_mqtt_clients,
    list_sites,
    regenerate_acl_now,
    rename_domain,
    rename_device,
    rotate_mqtt_client_password,
    set_mqtt_client_enabled,
)
from app.schemas import (
    DeviceAssignSite,
    DeviceCreate,
    DeviceOut,
    DeviceRename,
    DomainCreate,
    DomainRename,
    DomainOut,
    MqttClientCreate,
    MqttClientOut,
    MqttCredentialOut,
    SiteCreate,
    SiteOut,
)

app = FastAPI(title="HVAC Edge API", version="0.1.0")

_PROTECTED_PREFIXES = ("/admin", "/domains", "/sites", "/devices", "/mqtt")


def _create_spa_handler(dist_path: Path):
    """Factory function to create SPA handler with correct path binding."""
    def handler(_path: str = "") -> FileResponse:  # noqa: ARG001 - path used by route matching
        return FileResponse(dist_path / "index.html")
    return handler


# Admin UI (React) at /ui
admin_ui_dist_candidates = [
    Path("/admin-ui/dist"),
    Path(__file__).resolve().parent / "admin-ui" / "dist",
    Path(__file__).resolve().parent.parent / "admin-ui" / "dist",
]
for admin_ui_dist in admin_ui_dist_candidates:
    if admin_ui_dist.exists():
        assets_dir = admin_ui_dist / "assets"
        if assets_dir.exists():
            app.mount("/ui/assets", StaticFiles(directory=assets_dir), name="admin-ui-assets")

        app.add_api_route("/ui", _create_spa_handler(admin_ui_dist), methods=["GET"])
        app.add_api_route("/ui/", _create_spa_handler(admin_ui_dist), methods=["GET"])
        app.add_api_route("/ui/{path:path}", _create_spa_handler(admin_ui_dist), methods=["GET"])
        break

# Ionic PWA (Ionic React) at /app
ionic_pwa_dist_candidates = [
    Path("/app-dist"),
    Path(__file__).resolve().parent / "hvac-admin" / "dist",
    Path(__file__).resolve().parent.parent / "hvac-admin" / "dist",
]
for ionic_pwa_dist in ionic_pwa_dist_candidates:
    if ionic_pwa_dist.exists():
        assets_dir = ionic_pwa_dist / "assets"
        if assets_dir.exists():
            app.mount("/app/assets", StaticFiles(directory=assets_dir), name="ionic-pwa-assets")

        app.add_api_route("/app", _create_spa_handler(ionic_pwa_dist), methods=["GET"])
        app.add_api_route("/app/", _create_spa_handler(ionic_pwa_dist), methods=["GET"])
        app.add_api_route("/app/{path:path}", _create_spa_handler(ionic_pwa_dist), methods=["GET"])
        break


def _is_protected_path(path: str) -> bool:
    for prefix in _PROTECTED_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return True
    return False


@app.middleware("http")
async def admin_token_middleware(request: Request, call_next):
    if request.method == "OPTIONS" or not _is_protected_path(request.url.path):
        return await call_next(request)

    configured_token = os.getenv("ADMIN_API_TOKEN", "").strip()
    if not configured_token:
        return JSONResponse(status_code=503, content={"detail": "admin token not configured"})

    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "missing bearer token"})

    provided_token = authorization[len("Bearer ") :].strip()
    if not secrets.compare_digest(provided_token, configured_token):
        return JSONResponse(status_code=403, content={"detail": "invalid bearer token"})

    return await call_next(request)


@app.on_event("startup")
def startup_event() -> None:
    initialize_database()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "hvac-edge-api",
        "db_path": str(get_db_path()),
    }


@app.get("/registry/status")
def registry_status() -> dict:
    return {
        "phase": "C",
        "status": "registry_and_mqtt_client_lifecycle_enabled",
    }


@app.get("/admin/acl/status")
def acl_status(limit: int = 10) -> dict:
    acl_path = Path(os.getenv("HVAC_EDGE_MQTT_ACL_FILE", "/mosquitto/config/acl"))
    with get_connection() as conn:
        return build_acl_status(conn, acl_path=acl_path, limit=limit)


@app.get("/admin/acl/preview/{client_id}")
def acl_preview(client_id: int) -> dict:
    with get_connection() as conn:
        try:
            return build_acl_preview_for_client(conn, client_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/admin/acl/regenerate")
def admin_regenerate_acl() -> dict:
    try:
        return regenerate_acl_now()
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/domains", response_model=DomainOut, status_code=status.HTTP_201_CREATED)
def api_create_domain(payload: DomainCreate) -> dict:
    try:
        return create_domain(payload.slug, payload.name)
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/domains", response_model=list[DomainOut])
def api_list_domains() -> list[dict]:
    return list_domains()


@app.get("/domains/{domain_id}", response_model=DomainOut)
def api_get_domain(domain_id: int) -> dict:
    try:
        return get_domain(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/domains/{domain_id}/rename", response_model=DomainOut)
def api_rename_domain(domain_id: int, payload: DomainRename) -> dict:
    try:
        return rename_domain(domain_id, payload.name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_domain(domain_id: int) -> Response:
    try:
        delete_domain(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/domains/{domain_id}/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def api_create_site(domain_id: int, payload: SiteCreate) -> dict:
    try:
        return create_site(domain_id, payload.slug, payload.name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/domains/{domain_id}/sites", response_model=list[SiteOut])
def api_list_sites(domain_id: int) -> list[dict]:
    try:
        return list_sites(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/sites/{site_id}", response_model=SiteOut)
def api_get_site(site_id: int) -> dict:
    try:
        return get_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_site(site_id: int) -> Response:
    try:
        delete_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/devices", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def api_create_device(payload: DeviceCreate) -> dict:
    try:
        return create_device(
            device_id=payload.device_id,
            display_name=payload.display_name,
            mac=payload.mac,
            firmware_version=payload.firmware_version,
        )
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.get("/devices", response_model=list[DeviceOut])
def api_list_devices() -> list[dict]:
    return list_devices()


@app.get("/devices/{device_id}", response_model=DeviceOut)
def api_get_device(device_id: str) -> dict:
    try:
        return get_device(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/assign-site", response_model=DeviceOut)
def api_assign_site(device_id: str, payload: DeviceAssignSite) -> dict:
    try:
        return assign_device_site(device_id, payload.site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/rename", response_model=DeviceOut)
def api_rename_device(device_id: str, payload: DeviceRename) -> dict:
    try:
        return rename_device(device_id, payload.display_name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_device(device_id: str) -> Response:
    try:
        delete_device(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/mqtt/clients", response_model=MqttCredentialOut, status_code=status.HTTP_201_CREATED)
def api_create_mqtt_client(payload: MqttClientCreate) -> dict:
    try:
        created = create_mqtt_client(
            client_type=payload.client_type,
            domain_id=payload.domain_id,
            site_id=payload.site_id,
            device_pk_id=payload.device_id,
            username=payload.username,
        )
        return {
            "mqtt_client_id": created["id"],
            "username": created["username"],
            "password": created["password"],
            "password_one_time": True,
        }
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.get("/mqtt/clients", response_model=list[MqttClientOut])
def api_list_mqtt_clients() -> list[dict]:
    return list_mqtt_clients()


@app.get("/mqtt/clients/{client_id}", response_model=MqttClientOut)
def api_get_mqtt_client(client_id: int) -> dict:
    try:
        return get_mqtt_client(client_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/mqtt/clients/{client_id}/rotate-password", response_model=MqttCredentialOut)
def api_rotate_mqtt_password(client_id: int) -> dict:
    try:
        return rotate_mqtt_client_password(client_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/mqtt/clients/{client_id}/disable", response_model=MqttClientOut)
def api_disable_mqtt_client(client_id: int) -> dict:
    try:
        return set_mqtt_client_enabled(client_id, enabled=False)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/mqtt/clients/{client_id}/enable", response_model=MqttClientOut)
def api_enable_mqtt_client(client_id: int) -> dict:
    try:
        return set_mqtt_client_enabled(client_id, enabled=True)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.delete("/mqtt/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_mqtt_client(client_id: int) -> Response:
    try:
        delete_mqtt_client(client_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/mobile/sites")
def mobile_sites() -> dict:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT s.id AS site_id, s.name AS site_name, s.slug AS site_slug,
                   d.id AS domain_id, d.name AS domain_name
            FROM sites s
            JOIN domains d ON d.id = s.domain_id
            ORDER BY s.id
            """
        ).fetchall()

    return {
        "sites": [
            {
                "site_id": row["site_id"],
                "site_name": row["site_name"],
                "site_slug": row["site_slug"],
                "domain": {"domain_id": row["domain_id"], "domain_name": row["domain_name"]},
            }
            for row in rows
        ]
    }


@app.get("/mobile/sites/{site_id}/devices")
def mobile_site_devices(site_id: int) -> dict:
    with get_connection() as conn:
        site = conn.execute("SELECT id, name FROM sites WHERE id = ?", (site_id,)).fetchone()
        if site is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")

        rows = conn.execute(
            """
            SELECT device_id, display_name, firmware_version, integration_mode, last_seen_at
            FROM devices
            WHERE site_id = ?
            ORDER BY id
            """,
            (site_id,),
        ).fetchall()

    devices = []
    for row in rows:
        devices.append(
            {
                "device_id": row["device_id"],
                "display_name": row["display_name"],
                "firmware_version": row["firmware_version"],
                "online": bool(row["last_seen_at"]),
                "integration_mode": row["integration_mode"],
            }
        )

    return {"site_id": site["id"], "site_name": site["name"], "devices": devices}


def _default_device_zones(device_id: str) -> list[dict]:
    # Zone telemetry is not yet persisted in SQLite; provide stable app-facing placeholders.
    return [
        {
            "zone_id": 1,
            "name": "zone-1",
            "current_temperature_c": None,
            "target_temperature_c": None,
            "demand": None,
            "fault": None,
            "device_id": device_id,
        },
        {
            "zone_id": 2,
            "name": "zone-2",
            "current_temperature_c": None,
            "target_temperature_c": None,
            "demand": None,
            "fault": None,
            "device_id": device_id,
        },
        {
            "zone_id": 3,
            "name": "zone-3",
            "current_temperature_c": None,
            "target_temperature_c": None,
            "demand": None,
            "fault": None,
            "device_id": device_id,
        },
    ]


@app.get("/mobile/devices/{device_id}")
def mobile_device(device_id: str) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT d.device_id, d.display_name, d.firmware_version, d.integration_mode,
                   d.last_seen_at, s.id AS site_id, s.name AS site_name
            FROM devices d
            LEFT JOIN sites s ON s.id = d.site_id
            WHERE d.device_id = ?
            """,
            (device_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")

    return {
        "device_id": row["device_id"],
        "display_name": row["display_name"],
        "firmware_version": row["firmware_version"],
        "online": bool(row["last_seen_at"]),
        "integration_mode": row["integration_mode"],
        "site": {"site_id": row["site_id"], "site_name": row["site_name"]} if row["site_id"] else None,
        "zones": _default_device_zones(row["device_id"]),
    }


@app.get("/mobile/devices/{device_id}/zones")
def mobile_device_zones(device_id: str) -> dict:
    with get_connection() as conn:
        exists = conn.execute("SELECT 1 FROM devices WHERE device_id = ?", (device_id,)).fetchone()

    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")

    return {"device_id": device_id, "zones": _default_device_zones(device_id)}


@app.post("/mobile/devices/{device_id}/zones/{zone_id}/setpoint")
def mobile_setpoint(device_id: str, zone_id: int, payload: dict) -> dict:
    target = payload.get("target_temperature_c")
    if not isinstance(target, (int, float)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_temperature_c must be numeric")

    with get_connection() as conn:
        exists = conn.execute("SELECT 1 FROM devices WHERE device_id = ?", (device_id,)).fetchone()

    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")

    return {
        "device_id": device_id,
        "zone_id": zone_id,
        "target_temperature_c": float(target),
        "command_state": "queued",
    }


@app.get("/mobile/events")
def mobile_events(limit: int = 50) -> dict:
    safe_limit = max(1, min(limit, 200))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, generated_at, success, message
            FROM acl_generation_log
            ORDER BY id DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()

    return {
        "events": [
            {
                "event_id": row["id"],
                "timestamp": row["generated_at"],
                "kind": "acl_generation",
                "status": "ok" if row["success"] else "error",
                "message": row["message"],
            }
            for row in rows
        ]
    }
