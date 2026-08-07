import asyncio
import json
import os
import uuid
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.auth import (
    AuthError,
    authenticate_bearer_token,
    authenticate_emergency_token,
    audit_action,
    ensure_bootstrap_administrator,
)
from app.permissions import accessible_site_ids, require_global_admin, require_site_permission
from app.contracts import ContractValidationError, validate_mqtt_v2_command, validate_mqtt_v2_reported_state
from app.db import get_connection, initialize_database
from app.device_onboarding import (
    DeviceOnboardingError,
    discover_remote_device,
    get_remote_device_version,
    get_remote_onboarding_status,
    normalize_device_base_url,
    push_remote_onboarding_config,
    push_remote_firmware,
    trigger_remote_reboot,
)
from app.domain_model import (
    DomainModelError,
    get_device_channel,
    get_device_zone,
    get_mobile_site,
    ingest_device_twin_snapshot,
    list_device_channels,
    list_device_zones,
    list_mobile_domains,
    list_mobile_sites,
    log_event,
    rename_zone,
    resolve_zone_ref,
    set_realtime_emit_hooks,
    set_channel_metadata,
    set_channel_zone_links,
    set_zone_metadata,
    upsert_device_state,
    upsert_channel_state,
    upsert_zone_state,
)
from app.mqtt_commands import (
    MqttCommandError,
    publish_setpoint_command,
    publish_zone_name_command,
    should_forward_setpoint_commands,
)
from app.irrigation_domain import set_irrigation_run_emit_hook, set_irrigation_status_emit_hook
from app.registry import (
    authenticate_device_admin_token,
    RegistryConflictError,
    RegistryNotFoundError,
    RegistryOperationError,
    assign_device_site,
    create_device,
    delete_device,
    get_device,
    get_device_admin_token,
    get_device_mqtt_credentials,
    get_device_onboarding_context,
    list_devices,
    rename_device,
    rotate_mqtt_client_password,
    ensure_device_admin_token,
    update_device_firmware_version,
    update_device_local_url,
)
from app.router_auth_invites import create_auth_invites_router
from app.router_domains_sites import create_domains_sites_router
from app.router_legacy_auth_users import create_legacy_auth_users_router
from app.router_legacy_mobile_telemetry import create_legacy_mobile_telemetry_router
from app.router_v2_auth_users import create_auth_users_v2_router
from app.router_v2_core import create_core_v2_router
from app.router_v2_device_ota import create_device_ota_v2_router
from app.router_v2_device_lifecycle import create_device_lifecycle_v2_router
from app.router_v2_device_bootstrap import create_device_bootstrap_v2_router
from app.router_v2_device_domain import create_device_domain_v2_router
from app.router_v2_mobile_events import create_mobile_events_v2_router
from app.router_v2_mobile_ws import create_mobile_ws_v2_router
from app.router_v2_mqtt_clients import create_mqtt_clients_v2_router
from app.router_mqtt_clients import create_mqtt_clients_router
from app.router_v2_mqtt_ingest import create_mqtt_ingest_v2_router
from app.router_system_status import create_system_status_router
from app.router_v2_realtime_ws import create_realtime_ws_v2_router
from app.router_v2_irrigation import create_irrigation_v2_router
from app.rate_limit import check_rate_limit
from app.realtime_topic_hub import RealtimeTopicHub
from app.setpoint_outcome_listener import create_setpoint_outcome_listener
from app.schemas import (
    ChannelMetadataIn,
    ChannelOut,
    ChannelStateIn,
    ChannelZoneLinksIn,
    DeviceTwinIngestIn,
    DeviceTwinIngestResult,
    DeviceAssignSite,
    DeviceClaimIn,
    DeviceClaimOut,
    DeviceCreate,
    DeviceDiscoverIn,
    DeviceDiscoverOut,
    DeviceOnboardingStatusOut,
    DeviceOut,
    DevicePushConfigIn,
    DeviceRename,
    MobileSetpointIn,
    MqttClientCreate,
    MqttClientOut,
    MqttCredentialOut,
    ZoneMetadataIn,
    ZoneOut,
    ZoneRenameIn,
)

app = FastAPI(title="Zmartify Edge API", version="0.1.0")

_REQUIRED_PUBLIC_EDGE_URL = "https://pilot.zmartify.dk"
_REQUIRED_PUBLIC_MQTT_URI = "mqtts://pilot.zmartify.dk:8883"

_PROTECTED_PREFIXES = ("/admin", "/domains", "/sites", "/devices", "/mqtt", "/users", "/mobile", "/events", "/api")
_PROTECTED_EXACT_PATHS = {"/auth/me", "/auth/logout"}


def _allow_manual_firmware_refresh() -> bool:
    return os.getenv("ZMART_EDGE_ENABLE_MANUAL_FIRMWARE_REFRESH", "0").strip() == "1"


class ZoneStreamHub:
    def __init__(self) -> None:
        self._subscriptions: dict[str, set[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def subscribe(self, zone_ref: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._subscriptions.setdefault(zone_ref, set()).add(websocket)

    async def unsubscribe(self, zone_ref: str, websocket: WebSocket) -> None:
        listeners = self._subscriptions.get(zone_ref)
        if not listeners:
            return
        listeners.discard(websocket)
        if not listeners:
            self._subscriptions.pop(zone_ref, None)

    async def publish(self, zone_ref: str, zone_payload: dict) -> None:
        listeners = list(self._subscriptions.get(zone_ref, set()))
        if not listeners:
            return
        message = {"type": "zone_update", "zone_ref": zone_ref, "zone": zone_payload}
        stale: list[WebSocket] = []
        for websocket in listeners:
            try:
                await websocket.send_json(message)
            except Exception:
                stale.append(websocket)
        if stale:
            active = self._subscriptions.get(zone_ref, set())
            for websocket in stale:
                active.discard(websocket)
            if not active:
                self._subscriptions.pop(zone_ref, None)

    def publish_from_sync(self, zone_ref: str, zone_payload: dict) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.publish(zone_ref, zone_payload), self._loop)


zone_stream_hub = ZoneStreamHub()
realtime_topic_hub = RealtimeTopicHub()
setpoint_outcome_listener = create_setpoint_outcome_listener()


def _extract_device_ingest_device_id(path: str) -> str | None:
    parts = path.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "api" and parts[1] == "v2":
        parts = parts[2:]
    if len(parts) >= 4 and parts[0] == "devices":
        if parts[2] == "ingest" and parts[3] == "twin":
            return parts[1]
        if parts[2] == "ota" and parts[3] in {"poll", "download"}:
            return parts[1]
    return None


def _create_spa_handler(dist_path: Path):
    """Factory function to create SPA handler with correct path binding."""
    dist_root = dist_path.resolve()

    no_cache_headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    def handler(path: str = "") -> FileResponse:
        requested_path = (path or "").lstrip("/")
        if requested_path:
            candidate = (dist_root / requested_path).resolve()
            if dist_root in candidate.parents and candidate.is_file():
                if requested_path in {"sw.js", "manifest.json", "index.html"}:
                    return FileResponse(candidate, headers=no_cache_headers)
                return FileResponse(candidate)

        return FileResponse(dist_root / "index.html", headers=no_cache_headers)

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
    Path("/zmartify-admin/dist"),
    Path("/app-dist"),
    Path(__file__).resolve().parent / "zmartify-admin" / "dist",
    Path(__file__).resolve().parent.parent / "zmartify-admin" / "dist",
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
    if path == "/api/v2/device-bootstrap/config":
        return False
    if path in {"/api/v2/site-invitations/validate", "/api/v2/site-invitations/register"}:
        return False
    if path.startswith("/api/v2/devices/") and "/ota/download" in path:
        return False
    if path in _PROTECTED_EXACT_PATHS:
        return True
    for prefix in _PROTECTED_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return True
    return False


def _resolve_site_filter_id(site_ref: str | None) -> int | None:
    if not site_ref:
        return None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM sites WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?",
            (site_ref, site_ref, site_ref),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
    return int(row["id"])


def _mobile_site_scope_ids(request: Request) -> set[int] | None:
    auth_user = getattr(request.state, "auth_user", None)
    return accessible_site_ids(auth_user) if auth_user is not None else set()


def _mobile_site_scope_ids_for_user(auth_user) -> set[int] | None:
    return accessible_site_ids(auth_user) if auth_user is not None else set()


def _publish_zone_state_update(device_id: str, zone: dict) -> None:
    zone_ref = zone.get("zone_uuid")
    if zone_ref:
        zone_stream_hub.publish_from_sync(str(zone_ref), zone)
        realtime_topic_hub.publish_from_sync(
            f"zone:{zone_ref}:state",
            "hvac.zone.updated",
            {"device_id": device_id, "zone": zone},
        )
    zone_id = zone.get("zone_id")
    if zone_id is not None:
        zone_stream_hub.publish_from_sync(f"{device_id}:{int(zone_id)}", zone)
    realtime_topic_hub.publish_from_sync(
        f"device:{device_id}:state",
        "device.state.updated",
        {"device_id": device_id, "zone": zone},
    )


def _publish_event_update(event: dict) -> None:
    site_id = event.get("site_id")
    event_type = str(event.get("event_type") or "event.created")
    event_id = event.get("event_id")
    if site_id is not None:
        realtime_topic_hub.publish_from_sync(
            f"site:{int(site_id)}:events",
            "event.created",
            {
                "event_id": event_id,
                "event_type": event_type,
                "site_id": int(site_id),
                "domain_id": event.get("domain_id"),
                "device_id": event.get("device_id"),
                "zone_id": event.get("zone_id"),
                "payload": event.get("payload") or {},
                "created_at": event.get("created_at"),
            },
        )
    realtime_topic_hub.publish_from_sync(
        "events",
        "event.created",
        {
            "event_id": event_id,
            "event_type": event_type,
            "site_id": site_id,
            "domain_id": event.get("domain_id"),
            "device_id": event.get("device_id"),
            "zone_id": event.get("zone_id"),
            "payload": event.get("payload") or {},
            "created_at": event.get("created_at"),
        },
    )


def _publish_notification_update(notification: dict) -> None:
    user_id = notification.get("user_id")
    if user_id is None:
        return
    event = notification.get("event") or {}
    realtime_topic_hub.publish_from_sync(
        f"user:{int(user_id)}:notifications",
        "notification.created",
        {
            "notification_id": notification.get("notification_id"),
            "user_id": int(user_id),
            "read": bool(notification.get("read", False)),
            "created_at": notification.get("created_at"),
            "event": event,
        },
    )


def _publish_notification_state_update(state_event: dict) -> None:
    user_id = state_event.get("user_id")
    if user_id is None:
        return
    event_type = str(state_event.get("event_type") or "notification.updated")
    payload: dict = {
        "user_id": int(user_id),
        "event_type": event_type,
    }
    if state_event.get("notification") is not None:
        payload["notification"] = state_event.get("notification")
    if state_event.get("notification_ids") is not None:
        payload["notification_ids"] = list(state_event.get("notification_ids") or [])
    if state_event.get("updated") is not None:
        payload["updated"] = int(state_event.get("updated") or 0)

    realtime_topic_hub.publish_from_sync(
        f"user:{int(user_id)}:notifications",
        event_type,
        payload,
    )


def _publish_irrigation_run_update(event: dict) -> None:
    event_type = str(event.get("event_type") or "irrigation.run.updated")
    device_id = event.get("device_id")
    site_id = event.get("site_id")
    payload = {
        "event_type": event_type,
        "action": event.get("action"),
        "device_id": device_id,
        "site_id": site_id,
        "run": event.get("run"),
    }

    if device_id:
        realtime_topic_hub.publish_from_sync(
            f"device:{device_id}:irrigation",
            event_type,
            payload,
        )
    if site_id is not None:
        realtime_topic_hub.publish_from_sync(
            f"site:{int(site_id)}:events",
            event_type,
            payload,
        )


def _publish_irrigation_status_update(event: dict) -> None:
    event_type = str(event.get("event_type") or "irrigation.status.updated")
    device_id = event.get("device_id")
    site_id = event.get("site_id")
    payload = {
        "event_type": event_type,
        "action": event.get("action"),
        "state_type": event.get("state_type"),
        "device_id": device_id,
        "site_id": site_id,
        "state": event.get("state"),
    }

    if device_id:
        realtime_topic_hub.publish_from_sync(
            f"device:{device_id}:irrigation",
            event_type,
            payload,
        )
    if site_id is not None:
        realtime_topic_hub.publish_from_sync(
            f"site:{int(site_id)}:events",
            event_type,
            payload,
        )


def _enforce_mobile_site_scope(request: Request, site_pk_id: int) -> None:
    scoped_site_ids = _mobile_site_scope_ids(request)
    if scoped_site_ids is None:
        return
    if site_pk_id not in scoped_site_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")


def _require_site_product_permission(request: Request, site_id: int, product_type: str, permission: str) -> None:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    try:
        require_site_permission(auth_user, site_id, product_type=product_type, permission=permission)  # type: ignore[arg-type]
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


def _resolve_device_site_pk_id(device_id: str) -> int | None:
    with get_connection() as conn:
        row = conn.execute("SELECT site_id FROM devices WHERE device_id = ?", (device_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    return int(row["site_id"]) if row["site_id"] is not None else None


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    allowed, retry_after = check_rate_limit(request)
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"detail": "too many requests"},
            headers={"Retry-After": str(retry_after)},
        )
    return await call_next(request)


@app.middleware("http")
async def admin_token_middleware(request: Request, call_next):
    if request.method == "OPTIONS" or not _is_protected_path(request.url.path):
        return await call_next(request)

    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "missing bearer token"})

    token = authorization[len("Bearer ") :].strip()
    try:
        auth_user = authenticate_bearer_token(token)
        request.state.auth_user = auth_user
    except AuthError:
        ingest_device_id = _extract_device_ingest_device_id(request.url.path)
        if ingest_device_id and authenticate_device_admin_token(ingest_device_id, token):
            request.state.device_token_device_id = ingest_device_id
            return await call_next(request)
        auth_user = authenticate_emergency_token(token)
        if auth_user is None:
            return JSONResponse(status_code=403, content={"detail": "invalid bearer token"})
        request.state.auth_user = auth_user

    return await call_next(request)


@app.on_event("startup")
async def startup_event() -> None:
    initialize_database()
    ensure_bootstrap_administrator()
    zone_stream_hub.set_loop(asyncio.get_running_loop())
    realtime_topic_hub.set_loop(asyncio.get_running_loop())
    set_realtime_emit_hooks(
        event_hook=_publish_event_update,
        notification_hook=_publish_notification_update,
        notification_state_hook=_publish_notification_state_update,
    )
    set_irrigation_run_emit_hook(_publish_irrigation_run_update)
    set_irrigation_status_emit_hook(_publish_irrigation_status_update)
    setpoint_outcome_listener.start()


@app.on_event("shutdown")
async def shutdown_event() -> None:
    set_irrigation_run_emit_hook(None)
    set_irrigation_status_emit_hook(None)
    setpoint_outcome_listener.stop()


def _require_global_administrator(request: Request) -> None:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    try:
        require_global_admin(auth_user)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


def _require_roles(request: Request, _legacy_roles: set[str]) -> None:
    _require_global_administrator(request)


def _require_authenticated(request: Request) -> None:
    if getattr(request.state, "auth_user", None) is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")


app.include_router(create_core_v2_router(_require_roles))
app.include_router(create_system_status_router())
app.include_router(create_mqtt_clients_router(_require_roles))
app.include_router(create_auth_invites_router(_require_roles))
app.include_router(create_legacy_auth_users_router(_require_roles))
app.include_router(create_domains_sites_router(_require_roles))
app.include_router(create_mobile_events_v2_router(prefix="", tags=["legacy-mobile-events"]))
app.include_router(create_legacy_mobile_telemetry_router(_resolve_device_site_pk_id))
app.include_router(create_auth_users_v2_router(_require_roles))
app.include_router(create_mqtt_clients_v2_router())
app.include_router(create_mqtt_ingest_v2_router(_require_roles, _publish_zone_state_update))
app.include_router(create_mobile_events_v2_router())
app.include_router(create_realtime_ws_v2_router(realtime_topic_hub))
app.include_router(create_irrigation_v2_router(_resolve_device_site_pk_id))
app.include_router(create_mobile_ws_v2_router(_resolve_device_site_pk_id, zone_stream_hub))
app.include_router(create_device_lifecycle_v2_router())
app.include_router(create_device_bootstrap_v2_router())
app.include_router(create_device_ota_v2_router())
app.include_router(
    create_device_domain_v2_router(
        _require_roles,
        _resolve_device_site_pk_id,
        _enforce_mobile_site_scope,
        _publish_zone_state_update,
    )
)


def _edge_public_base_url(request: Request) -> str:
    _ = request
    configured = os.getenv("ZMART_EDGE_PUBLIC_API_BASE", "").strip()
    if configured.rstrip("/") == _REQUIRED_PUBLIC_EDGE_URL:
        return _REQUIRED_PUBLIC_EDGE_URL
    return _REQUIRED_PUBLIC_EDGE_URL


def _edge_public_mqtt_uri(request: Request) -> str:
    _ = request
    configured = os.getenv("ZMART_EDGE_PUBLIC_MQTT_URI", "").strip()
    if configured == _REQUIRED_PUBLIC_MQTT_URI:
        return _REQUIRED_PUBLIC_MQTT_URI
    return _REQUIRED_PUBLIC_MQTT_URI


def _build_device_push_payload(request: Request, device_id: str, claim_token: str | None) -> dict:
    context = get_device_onboarding_context(device_id)
    credentials = get_device_mqtt_credentials(device_id)
    device_admin_token = get_device_admin_token(device_id)
    if context.get("site_id") is None or context.get("domain_id") is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device must be assigned to a site before push-config")

    payload = {
        "device_admin_token": device_admin_token,
        "edge_url": _edge_public_base_url(request),
        "mqtt_uri": _edge_public_mqtt_uri(request),
        "mqtt_username": credentials["username"],
        "mqtt_password": credentials["password"],
        "mqtt_base": "homie/5",
        "domain_id": context["domain_id"],
        "site_id": context["site_id"],
    }
    if claim_token:
        payload["claim_token"] = claim_token
    return payload


@app.post("/devices", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def api_create_device(payload: DeviceCreate, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        device = create_device(
            device_id=payload.device_id,
            display_name=payload.display_name,
            mac=payload.mac,
            firmware_version=payload.firmware_version,
        )
        audit_action(actor_user_id=request.state.auth_user.user_id, action="register_device", resource_type="device", resource_id=device["device_id"])
        return device
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/devices/discover", response_model=DeviceDiscoverOut)
def api_discover_device(payload: DeviceDiscoverIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        discovered = discover_remote_device(payload.base_url)
        audit_action(
            actor_user_id=request.state.auth_user.user_id,
            action="discover_device",
            resource_type="device_base_url",
            resource_id=discovered["base_url"],
        )
        return discovered
    except DeviceOnboardingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/devices/claim", response_model=DeviceClaimOut, status_code=status.HTTP_201_CREATED)
def api_claim_device(payload: DeviceClaimIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        discovered = discover_remote_device(payload.base_url)
        identity = discovered["identity"]
        device_id = identity["device_id"]
        display_name = payload.display_name or identity["device_id"]

        try:
            device = create_device(
                device_id=device_id,
                display_name=display_name,
                mac=identity.get("mac"),
                firmware_version=identity.get("firmware_version"),
            )
            is_reclaim = False
        except RegistryConflictError:
            # Existing device re-claim: only owner/admin can rotate creds and overwrite remote config.
            _require_global_administrator(request)
            is_reclaim = True
            device = get_device(device_id)

        device = assign_device_site(device_id, payload.site_id)
        device = update_device_local_url(device_id, normalize_device_base_url(payload.base_url))
        ensure_device_admin_token(device_id)

        if is_reclaim:
            credentials = get_device_mqtt_credentials(device_id)
            rotate_mqtt_client_password(int(credentials["mqtt_client_id"]))

        if not is_reclaim and not payload.claim_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="claim_token is required when claiming an unregistered device")

        push_payload = _build_device_push_payload(request, device_id, payload.claim_token)
        try:
            push_remote_onboarding_config(payload.base_url, push_payload)
        except DeviceOnboardingError as exc:
            if not is_reclaim or "timed out" not in str(exc).lower():
                raise
            # Some devices apply config successfully but respond slowly after MQTT restart.
            recovery_status = get_remote_onboarding_status(payload.base_url)
            if recovery_status.get("state") not in {"claimed", "mqtt_configured", "online"}:
                raise

        onboarding_status = get_remote_onboarding_status(payload.base_url)

        audit_action(
            actor_user_id=request.state.auth_user.user_id,
            action="reclaim_device" if is_reclaim else "claim_device",
            resource_type="device",
            resource_id=device_id,
            metadata={
                "site_id": payload.site_id,
                "domain_id": payload.domain_id,
                "base_url": device.get("local_url"),
                "reclaim": is_reclaim,
            },
        )
        return {"device": device, "onboarding_status": onboarding_status}
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    except DeviceOnboardingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/devices", response_model=list[DeviceOut])
def api_list_devices(request: Request) -> list[dict]:
    _require_global_administrator(request)
    return list_devices()


@app.get("/devices/{device_id}", response_model=DeviceOut)
def api_get_device(device_id: str, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        return get_device(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/push-config", response_model=DeviceOnboardingStatusOut)
def api_push_device_config(device_id: str, payload: DevicePushConfigIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        device = get_device_onboarding_context(device_id)
        local_url = device.get("local_url")
        if not local_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device local_url not set")
        push_payload = _build_device_push_payload(request, device_id, payload.claim_token)
        push_remote_onboarding_config(local_url, push_payload)
        status_payload = get_remote_onboarding_status(local_url)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="push_device_config", resource_type="device", resource_id=device_id)
        return status_payload
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DeviceOnboardingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/devices/{device_id}/onboarding-status", response_model=DeviceOnboardingStatusOut)
def api_device_onboarding_status(device_id: str, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        device = get_device_onboarding_context(device_id)
        local_url = device.get("local_url")
        if not local_url:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device local_url not set")
        status_payload = get_remote_onboarding_status(local_url)
        upsert_device_state(
            device_id,
            online=status_payload.get("state") == "online",
            mqtt_connected=bool(status_payload.get("mqtt_connected")),
            source="device_onboarding_status",
            last_error=status_payload.get("last_error"),
        )
        return status_payload
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except DeviceOnboardingError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/devices/{device_id}/zones", response_model=list[ZoneOut])
def api_device_zones(device_id: str, request: Request) -> list[dict]:
    _require_global_administrator(request)
    try:
        return list_device_zones(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/devices/{device_id}/zones/{zone_id}", response_model=ZoneOut)
def api_get_device_zone(device_id: str, zone_id: int, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        return get_device_zone(device_id, zone_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/zones/{zone_id}/rename", response_model=ZoneOut)
def api_rename_device_zone(device_id: str, zone_id: int, payload: ZoneRenameIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        if should_forward_setpoint_commands():
            try:
                publish_zone_name_command(device_id, zone_id, payload.name)
            except MqttCommandError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"zone name publish failed: {exc}") from exc

        zone = rename_zone(device_id, zone_id, payload.name)
        log_event(
            "zone_metadata_updated",
            payload={"device_id": device_id, "zone_id": zone_id, "name": payload.name},
        )
        return zone
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/devices/{device_id}/zones/{zone_id}/metadata", response_model=ZoneOut)
def api_set_device_zone_metadata(device_id: str, zone_id: int, payload: ZoneMetadataIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        if payload.name and should_forward_setpoint_commands():
            try:
                publish_zone_name_command(device_id, zone_id, payload.name)
            except MqttCommandError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"zone name publish failed: {exc}") from exc

        zone = set_zone_metadata(
            device_id,
            zone_id,
            name=payload.name,
            icon=payload.icon,
            sort_order=payload.sort_order,
            floor=payload.floor,
            area_m2=payload.area_m2,
        )
        log_event(
            "zone_metadata_updated",
            payload={"device_id": device_id, "zone_id": zone_id, "metadata": payload.model_dump(exclude_none=True)},
        )
        return zone
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/devices/{device_id}/channels", response_model=list[ChannelOut])
def api_device_channels(device_id: str, request: Request) -> list[dict]:
    _require_global_administrator(request)
    try:
        return list_device_channels(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/devices/{device_id}/channels/{channel_id}", response_model=ChannelOut)
def api_get_device_channel(device_id: str, channel_id: int, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        return get_device_channel(device_id, channel_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/channels/{channel_id}/metadata", response_model=ChannelOut)
def api_set_device_channel_metadata(device_id: str, channel_id: int, payload: ChannelMetadataIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        channel = set_channel_metadata(
            device_id,
            channel_id,
            name=payload.name,
            icon=payload.icon,
            sort_order=payload.sort_order,
        )
        log_event(
            "channel_metadata_updated",
            payload={"device_id": device_id, "channel_id": channel_id, "metadata": payload.model_dump(exclude_none=True)},
        )
        return channel
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/devices/{device_id}/channels/{channel_id}/state", response_model=ChannelOut)
def api_set_device_channel_state(device_id: str, channel_id: int, payload: ChannelStateIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        return upsert_channel_state(
            device_id,
            channel_id,
            active=payload.active,
            fault=payload.fault,
            source="admin_api",
        )
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/devices/{device_id}/channels/{channel_id}/link-zones", response_model=ChannelOut)
def api_set_device_channel_zone_links(device_id: str, channel_id: int, payload: ChannelZoneLinksIn, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        channel = set_channel_zone_links(device_id, channel_id, payload.zone_ids)
        log_event(
            "channel_zone_links_updated",
            payload={"device_id": device_id, "channel_id": channel_id, "zone_ids": payload.zone_ids},
        )
        return channel
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/devices/{device_id}/ingest/twin", response_model=DeviceTwinIngestResult)
def api_ingest_device_twin(device_id: str, payload: DeviceTwinIngestIn, request: Request) -> dict:
    device_token_device_id = getattr(request.state, "device_token_device_id", None)
    if device_token_device_id != device_id:
        _require_global_administrator(request)
    try:
        validate_mqtt_v2_reported_state(
            {
                "schema_version": "2.0",
                "source_timestamp": payload.source_timestamp or datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "firmware_version": payload.firmware_version,
                "hvac": {
                    "zones": [item.model_dump(exclude_none=True) for item in payload.zones],
                    "channels": [item.model_dump(exclude_none=True) for item in payload.channels],
                },
            }
        )

        result = ingest_device_twin_snapshot(
            device_id,
            source=payload.source,
            source_timestamp=payload.source_timestamp,
            firmware_version=payload.firmware_version,
            online=payload.online,
            mqtt_connected=payload.mqtt_connected,
            last_error=payload.last_error,
            zones=[item.model_dump(exclude_none=True) for item in payload.zones],
            channels=[item.model_dump(exclude_none=True) for item in payload.channels],
        )
        if result.get("applied"):
            for zone in list_device_zones(device_id):
                _publish_zone_state_update(device_id, zone)
        return result
    except ContractValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/devices/{device_id}/firmware/refresh")
def api_refresh_device_firmware(
    device_id: str,
    request: Request,
    base_url: str | None = None,
) -> dict:
    _require_global_administrator(request)
    if not _allow_manual_firmware_refresh():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    try:
        device = get_device(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    candidate_urls: list[str] = []
    if isinstance(base_url, str) and base_url.strip():
        candidate_urls.append(base_url.strip())
    local_url = device.get("local_url") if isinstance(device, dict) else None
    if isinstance(local_url, str) and local_url.strip():
        candidate_urls.append(local_url.strip())

    seen: set[str] = set()
    normalized_candidates: list[str] = []
    for raw in candidate_urls:
        normalized = normalize_device_base_url(raw)
        if normalized in seen:
            continue
        seen.add(normalized)
        normalized_candidates.append(normalized)

    for candidate in normalized_candidates:
        try:
            version_payload = get_remote_device_version(candidate)
            live_version = version_payload.get("version")
            if isinstance(live_version, str) and live_version.strip():
                resolved_version = live_version.strip()
                update_device_firmware_version(device_id, resolved_version)
                return {
                    "device_id": device_id,
                    "firmware_version": resolved_version,
                    "source": "remote_version",
                    "base_url": candidate,
                }
        except DeviceOnboardingError:
            continue
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="unable to query device /version; provide base_url reachable from edge",
    )


@app.post("/devices/{device_id}/assign-site", response_model=DeviceOut)
def api_assign_site(device_id: str, payload: DeviceAssignSite, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        return assign_device_site(device_id, payload.site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/rename", response_model=DeviceOut)
def api_rename_device(device_id: str, payload: DeviceRename, request: Request) -> dict:
    _require_global_administrator(request)
    try:
        return rename_device(device_id, payload.display_name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_device(device_id: str, request: Request) -> Response:
    _require_global_administrator(request)
    try:
        delete_device(device_id)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="delete_device", resource_type="device", resource_id=device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/mobile/sites")
def mobile_sites(request: Request) -> dict:
    _require_authenticated(request)
    return {"sites": list_mobile_sites(site_ids=_mobile_site_scope_ids(request))}


@app.get("/mobile/domains")
def mobile_domains(request: Request) -> dict:
    _require_authenticated(request)
    return {"domains": list_mobile_domains(site_ids=_mobile_site_scope_ids(request))}


@app.get("/mobile/sites/{site_id}")
def mobile_site_detail(site_id: str, request: Request) -> dict:
    _require_authenticated(request)
    resolved_site_id = _resolve_site_filter_id(site_id)
    _enforce_mobile_site_scope(request, resolved_site_id)
    try:
        site = get_mobile_site(site_id)
        for device in site.get("devices", []):
            local_url = device.get("local_url")
            if not local_url or not device.get("online"):
                continue
            try:
                version_payload = get_remote_device_version(local_url)
                live_version = version_payload.get("version")
                if isinstance(live_version, str) and live_version:
                    if live_version != device.get("firmware_version"):
                        update_device_firmware_version(device.get("device_id"), live_version)
                    device["firmware_version"] = live_version
            except DeviceOnboardingError:
                continue
        return site
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/mobile/sites/{site_id}/devices")
def mobile_site_devices(site_id: str, request: Request) -> dict:
    _require_authenticated(request)
    resolved_site_id = _resolve_site_filter_id(site_id)
    _enforce_mobile_site_scope(request, resolved_site_id)
    try:
        site = get_mobile_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {
        "site_id": site["site_id"],
        "site_name": site["site_name"],
        "devices": [
            {
                "device_id": item.get("device_id"),
                "display_name": item.get("display_name"),
                "firmware_version": item.get("firmware_version"),
                "online": bool(item.get("online")),
                "device_type": item.get("device_type"),
                "integration_mode": item.get("integration_mode"),
            }
            for item in site.get("devices", [])
        ],
    }


@app.get("/mobile/sites/{site_id}/zones")
def mobile_site_zones(site_id: str, request: Request) -> dict:
    _require_authenticated(request)
    resolved_site_id = _resolve_site_filter_id(site_id)
    _enforce_mobile_site_scope(request, resolved_site_id)
    try:
        site = get_mobile_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    devices_out = []
    for item in site.get("devices", []):
        if item.get("device_type") != "hvac_gateway":
            continue
        device_id = item.get("device_id")
        if not device_id:
            continue
        try:
            zones = list_device_zones(device_id)
        except RegistryNotFoundError:
            continue
        devices_out.append(
            {
                "device_id": device_id,
                "display_name": item.get("display_name"),
                "zones": zones,
            }
        )

    return {
        "site_id": site["site_id"],
        "site_name": site["site_name"],
        "devices": devices_out,
    }


@app.get("/mobile/devices/{device_id}")
def mobile_device(device_id: str, request: Request) -> dict:
    _require_authenticated(request)
    site_pk_id = _resolve_device_site_pk_id(device_id)
    if site_pk_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    _enforce_mobile_site_scope(request, site_pk_id)
    with get_connection() as conn:
        row = conn.execute(
            """
                     SELECT d.device_id, d.display_name, d.firmware_version, d.local_url, d.integration_mode,
                         d.last_seen_at, s.uuid AS site_uuid, s.slug AS site_slug, s.name AS site_name
            FROM devices d
            LEFT JOIN sites s ON s.id = d.site_id
            WHERE d.device_id = ?
            """,
            (device_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")

    firmware_version = row["firmware_version"]

    if row["local_url"]:
        try:
            version_payload = get_remote_device_version(row["local_url"])
            live_version = version_payload.get("version")
            if isinstance(live_version, str) and live_version:
                if live_version != firmware_version:
                    update_device_firmware_version(device_id, live_version)
                firmware_version = live_version
        except DeviceOnboardingError:
            pass

    zones = list_device_zones(device_id)
    channels = list_device_channels(device_id)
    return {
        "device_id": row["device_id"],
        "display_name": row["display_name"],
        "firmware_version": firmware_version,
        "online": bool(row["last_seen_at"]),
        "integration_mode": row["integration_mode"],
        "site": {"site_id": row["site_uuid"] or row["site_slug"], "site_name": row["site_name"]}
        if row["site_uuid"] or row["site_slug"]
        else None,
        "zones": zones,
        "channels": channels,
    }


@app.get("/mobile/devices/{device_id}/zones")
def mobile_device_zones(device_id: str, request: Request) -> dict:
    _require_authenticated(request)
    site_pk_id = _resolve_device_site_pk_id(device_id)
    if site_pk_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    _enforce_mobile_site_scope(request, site_pk_id)
    try:
        return {"device_id": device_id, "zones": list_device_zones(device_id)}
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/mobile/zones/{zone_ref}")
def mobile_zone_by_ref(zone_ref: str, request: Request) -> dict:
    _require_authenticated(request)
    try:
        device_id, zone_id = resolve_zone_ref(zone_ref)
        site_pk_id = _resolve_device_site_pk_id(device_id)
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
        _enforce_mobile_site_scope(request, site_pk_id)
        return {
            "device_id": device_id,
            "zone": get_device_zone(device_id, zone_id),
        }
    except (RegistryNotFoundError, DomainModelError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/mobile/devices/{device_id}/channels")
def mobile_device_channels(device_id: str, request: Request) -> dict:
    _require_authenticated(request)
    site_pk_id = _resolve_device_site_pk_id(device_id)
    if site_pk_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    _enforce_mobile_site_scope(request, site_pk_id)
    try:
        return {"device_id": device_id, "channels": list_device_channels(device_id)}
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/mobile/zones/{zone_ref}/setpoint")
def mobile_setpoint(zone_ref: str, payload: MobileSetpointIn, request: Request) -> dict:
    try:
        device_id, zone_id = resolve_zone_ref(zone_ref)
        context = get_device_onboarding_context(device_id)
        site_pk_id = context.get("site_id")
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
        _require_site_product_permission(request, int(site_pk_id), "hvac", "operate")

        requested_target_c = float(payload.target_temperature_c)
        command_id: str | None = None
        command_state = "local_only"
        if should_forward_setpoint_commands():
            try:
                command_id = f"sp-{uuid.uuid4().hex[:12]}"
                validate_mqtt_v2_command(
                    {
                        "schema_version": "2.0",
                        "command_id": command_id,
                        "command_type": "set_zone_setpoint",
                        "target_ref": zone_ref,
                        "parameters": {
                            "device_id": device_id,
                            "zone_id": zone_id,
                            "target_temperature_c": requested_target_c,
                        },
                        "requested_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                    }
                )
                publish_setpoint_command(device_id, zone_id, requested_target_c)
                command_state = "pending_device_feedback"
            except MqttCommandError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"setpoint publish failed: {exc}") from exc

        if command_state == "pending_device_feedback":
            zone = get_device_zone(device_id, zone_id)
        else:
            zone = upsert_zone_state(
                device_id,
                zone_id,
                target_temperature=requested_target_c,
                source="mobile_api",
            )
            _publish_zone_state_update(device_id, zone)
        log_event(
            "zone_setpoint_changed",
            domain_id=context.get("domain_id"),
            site_id=context.get("site_id"),
            device_pk_id=context["id"],
            zone_id=zone_id,
            payload={
                "device_id": device_id,
                "zone_id": zone_id,
                "target_temperature_c": requested_target_c,
                "source": "mobile_api",
                "command_state": command_state,
                "command_id": command_id,
            },
        )
        return {
            "device_id": device_id,
            "zone_id": zone_id,
            "target_temperature_c": requested_target_c,
            "pending": command_state == "pending_device_feedback",
            "command_state": command_state,
            "command_id": command_id,
            "zone": zone,
        }
    except ContractValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/mobile/zones/{zone_ref}/rename", response_model=ZoneOut)
def mobile_rename_zone(zone_ref: str, payload: ZoneRenameIn, request: Request) -> dict:
    try:
        device_id, zone_id = resolve_zone_ref(zone_ref)
        context = get_device_onboarding_context(device_id)
        site_pk_id = context.get("site_id")
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
        _require_site_product_permission(request, int(site_pk_id), "hvac", "configure")

        if should_forward_setpoint_commands():
            try:
                publish_zone_name_command(device_id, zone_id, payload.name)
            except MqttCommandError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"zone name publish failed: {exc}") from exc

        zone = rename_zone(device_id, zone_id, payload.name)
        _publish_zone_state_update(device_id, zone)
        log_event(
            "zone_metadata_updated",
            domain_id=context.get("domain_id"),
            site_id=context.get("site_id"),
            device_pk_id=context["id"],
            zone_id=zone_id,
            payload={"device_id": device_id, "zone_id": zone_id, "name": payload.name, "source": "mobile_api"},
        )
        return zone
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


