import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.auth import (
    AuthError,
    ROLE_ADMIN,
    ROLE_INSTALLER,
    ROLE_OWNER,
    ROLE_VIEWER,
    authenticate_bearer_token,
    authenticate_emergency_token,
    audit_action,
    create_user,
    delete_user,
    ensure_bootstrap_owner,
    get_user,
    is_initialized,
    list_audit_logs,
    list_user_site_access,
    list_users,
    login,
    logout_token,
    require_any_role,
    reset_user_password,
    set_user_enabled,
    set_user_roles,
    set_user_site_access,
)
from app.db import get_connection, get_db_path, initialize_database
from app.device_onboarding import (
    DeviceOnboardingError,
    discover_remote_device,
    get_remote_onboarding_status,
    normalize_device_base_url,
    push_remote_onboarding_config,
)
from app.domain_model import (
    DomainModelError,
    get_device_channel,
    get_device_history,
    get_device_freshness,
    get_device_zone,
    get_zone_history,
    get_mobile_site,
    ingest_device_twin_snapshot,
    list_device_channels,
    list_device_zones,
    list_events,
    list_mobile_domains,
    list_mobile_sites,
    list_notifications_for_user,
    log_event,
    mark_all_notifications_read,
    mark_notification_read,
    rename_zone,
    resolve_zone_ref,
    set_channel_metadata,
    set_channel_zone_links,
    set_zone_metadata,
    upsert_device_state,
    upsert_channel_state,
    upsert_zone_state,
)
from app.mqtt_acl import build_acl_preview_for_client, build_acl_status
from app.registry import (
    authenticate_device_admin_token,
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
    get_device_admin_token,
    get_device_mqtt_credentials,
    get_device_onboarding_context,
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
    ensure_device_admin_token,
    set_mqtt_client_enabled,
    update_device_local_url,
)
from app.schemas import (
    ChannelMetadataIn,
    ChannelOut,
    ChannelStateIn,
    ChannelZoneLinksIn,
    DeviceFreshnessOut,
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
    EventOut,
    DomainCreate,
    DomainRename,
    DomainOut,
    MobileSetpointIn,
    MqttClientCreate,
    MqttClientOut,
    MqttCredentialOut,
    NotificationOut,
    SetupStatusOut,
    ZoneMetadataIn,
    ZoneOut,
    ZoneRenameIn,
    UserCreateIn,
    UserOut,
    UserResetPasswordIn,
    UserRoleUpdateIn,
    UserSiteAccessUpdateIn,
    AuthLoginIn,
    AuthLoginOut,
    AuditLogOut,
    SiteCreate,
    SiteOut,
)

app = FastAPI(title="HVAC Edge API", version="0.1.0")

_PROTECTED_PREFIXES = ("/admin", "/domains", "/sites", "/devices", "/mqtt", "/users", "/mobile", "/events")


def _extract_device_ingest_device_id(path: str) -> str | None:
    parts = path.strip("/").split("/")
    if len(parts) == 4 and parts[0] == "devices" and parts[2] == "ingest" and parts[3] == "twin":
        return parts[1]
    return None


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


def _resolve_domain_filter_id(domain_ref: str | None) -> int | None:
    if not domain_ref:
        return None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM domains WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?",
            (domain_ref, domain_ref, domain_ref),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="domain not found")
    return int(row["id"])


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


def _mobile_event_projection(event: dict) -> dict:
    payload = dict(event.get("payload") or {})
    return {
        "event_id": event.get("uuid"),
        "event_type": event.get("event_type"),
        "created_at": event.get("created_at"),
        "device_id": event.get("device_external_id") or payload.get("device_id"),
        "zone_id": event.get("zone_id"),
        "payload": payload,
    }


def _mobile_site_scope_ids(request: Request) -> set[int] | None:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None or auth_user.user_id is None:
        return None
    if ROLE_OWNER in auth_user.roles or ROLE_ADMIN in auth_user.roles:
        return None
    scoped_site_ids = set(list_user_site_access(auth_user.user_id))
    if not scoped_site_ids:
        return None
    return scoped_site_ids


def _enforce_mobile_site_scope(request: Request, site_pk_id: int) -> None:
    scoped_site_ids = _mobile_site_scope_ids(request)
    if scoped_site_ids is None:
        return
    if site_pk_id not in scoped_site_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")


def _resolve_device_site_pk_id(device_id: str) -> int | None:
    with get_connection() as conn:
        row = conn.execute("SELECT site_id FROM devices WHERE device_id = ?", (device_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    return int(row["site_id"]) if row["site_id"] is not None else None


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
def startup_event() -> None:
    initialize_database()
    ensure_bootstrap_owner()


def _require_roles(request: Request, allowed_roles: set[str]) -> None:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    try:
        require_any_role(auth_user, allowed_roles)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


def _enforce_admin_user_guardrails(actor_roles: set[str], target_roles: list[str], action: str) -> None:
    if ROLE_ADMIN not in actor_roles or ROLE_OWNER in actor_roles:
        return

    target_role_set = set(target_roles)
    if ROLE_OWNER in target_role_set:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin cannot manage owner user")

    if action in {"delete_user", "set_roles"} and ROLE_ADMIN in target_role_set:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin cannot modify peer admin user")


def _edge_public_base_url(request: Request) -> str:
    configured = os.getenv("HVAC_EDGE_PUBLIC_API_BASE", "").strip()
    if configured:
        return configured.rstrip("/")
    return str(request.base_url).rstrip("/")


def _edge_public_mqtt_uri(request: Request) -> str:
    configured = os.getenv("HVAC_EDGE_PUBLIC_MQTT_URI", "").strip()
    if configured:
        return configured
    host = request.url.hostname or "127.0.0.1"
    port = os.getenv("HVAC_EDGE_PUBLIC_MQTT_PORT", "1883").strip() or "1883"
    return f"mqtt://{host}:{port}"


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


@app.get("/setup/status", response_model=SetupStatusOut)
def setup_status() -> dict:
    return {"initialized": is_initialized()}


@app.post("/auth/login", response_model=AuthLoginOut)
def auth_login(payload: AuthLoginIn) -> dict:
    try:
        token, expires_at, _user_id = login(payload.username, payload.password)
        return {"access_token": token, "expires_at": expires_at}
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@app.post("/auth/logout")
def auth_logout(request: Request) -> dict:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    logout_token(auth_user.token_id, auth_user.user_id)
    return {"ok": True}


@app.get("/auth/me", response_model=UserOut)
def auth_me(request: Request) -> dict:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    if auth_user.user_id is None:
        return {
            "id": 0,
            "username": auth_user.username,
            "email": None,
            "display_name": "Emergency Owner",
            "enabled": 1,
            "created_at": "",
            "updated_at": None,
            "last_login_at": None,
            "roles": sorted(auth_user.roles),
        }
    return get_user(auth_user.user_id)


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
def acl_status(request: Request, limit: int = 10) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    acl_path = Path(os.getenv("HVAC_EDGE_MQTT_ACL_FILE", "/mosquitto/config/acl"))
    with get_connection() as conn:
        return build_acl_status(conn, acl_path=acl_path, limit=limit)


@app.get("/admin/acl/preview/{client_id}")
def acl_preview(client_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    with get_connection() as conn:
        try:
            return build_acl_preview_for_client(conn, client_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/admin/acl/regenerate")
def admin_regenerate_acl(request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        result = regenerate_acl_now()
        auth_user = request.state.auth_user
        audit_action(actor_user_id=auth_user.user_id, action="acl_regeneration", resource_type="acl")
        return result
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/domains", response_model=DomainOut, status_code=status.HTTP_201_CREATED)
def api_create_domain(payload: DomainCreate, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        domain = create_domain(payload.slug, payload.name)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="create_domain", resource_type="domain", resource_id=str(domain["id"]))
        return domain
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/domains", response_model=list[DomainOut])
def api_list_domains(request: Request) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    return list_domains()


@app.get("/domains/{domain_id}", response_model=DomainOut)
def api_get_domain(domain_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return get_domain(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/domains/{domain_id}/rename", response_model=DomainOut)
def api_rename_domain(domain_id: int, payload: DomainRename, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        return rename_domain(domain_id, payload.name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_domain(domain_id: int, request: Request) -> Response:
    _require_roles(request, {ROLE_OWNER})
    try:
        delete_domain(domain_id)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="delete_domain", resource_type="domain", resource_id=str(domain_id))
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/domains/{domain_id}/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def api_create_site(domain_id: int, payload: SiteCreate, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        site = create_site(domain_id, payload.slug, payload.name)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="create_site", resource_type="site", resource_id=str(site["id"]))
        return site
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/domains/{domain_id}/sites", response_model=list[SiteOut])
def api_list_sites(domain_id: int, request: Request) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return list_sites(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/sites/{site_id}", response_model=SiteOut)
def api_get_site(site_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return get_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_site(site_id: int, request: Request) -> Response:
    _require_roles(request, {ROLE_OWNER})
    try:
        delete_site(site_id)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="delete_site", resource_type="site", resource_id=str(site_id))
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/devices", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def api_create_device(payload: DeviceCreate, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
            _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    return list_devices()


@app.get("/devices/{device_id}", response_model=DeviceOut)
def api_get_device(device_id: str, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return get_device(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/push-config", response_model=DeviceOnboardingStatusOut)
def api_push_device_config(device_id: str, payload: DevicePushConfigIn, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return list_device_zones(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/devices/{device_id}/zones/{zone_id}", response_model=ZoneOut)
def api_get_device_zone(device_id: str, zone_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return get_device_zone(device_id, zone_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/zones/{zone_id}/rename", response_model=ZoneOut)
def api_rename_device_zone(device_id: str, zone_id: int, payload: ZoneRenameIn, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    try:
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    try:
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return list_device_channels(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/devices/{device_id}/channels/{channel_id}", response_model=ChannelOut)
def api_get_device_channel(device_id: str, channel_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return get_device_channel(device_id, channel_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/channels/{channel_id}/metadata", response_model=ChannelOut)
def api_set_device_channel_metadata(device_id: str, channel_id: int, payload: ChannelMetadataIn, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
        _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    try:
        return ingest_device_twin_snapshot(
            device_id,
            source=payload.source,
            source_timestamp=payload.source_timestamp,
            online=payload.online,
            mqtt_connected=payload.mqtt_connected,
            last_error=payload.last_error,
            zones=[item.model_dump(exclude_none=True) for item in payload.zones],
            channels=[item.model_dump(exclude_none=True) for item in payload.channels],
        )
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/mobile/devices/{device_id}/freshness", response_model=DeviceFreshnessOut)
def mobile_device_freshness(device_id: str, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    site_pk_id = _resolve_device_site_pk_id(device_id)
    if site_pk_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    _enforce_mobile_site_scope(request, site_pk_id)
    try:
        return get_device_freshness(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/assign-site", response_model=DeviceOut)
def api_assign_site(device_id: str, payload: DeviceAssignSite, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    try:
        return assign_device_site(device_id, payload.site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/rename", response_model=DeviceOut)
def api_rename_device(device_id: str, payload: DeviceRename, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    try:
        return rename_device(device_id, payload.display_name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_device(device_id: str, request: Request) -> Response:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        delete_device(device_id)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="delete_device", resource_type="device", resource_id=device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/mqtt/clients", response_model=MqttCredentialOut, status_code=status.HTTP_201_CREATED)
def api_create_mqtt_client(payload: MqttClientCreate, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    try:
        created = create_mqtt_client(
            client_type=payload.client_type,
            domain_id=payload.domain_id,
            site_id=payload.site_id,
            device_pk_id=payload.device_id,
            username=payload.username,
        )
        audit_action(actor_user_id=request.state.auth_user.user_id, action="create_mqtt_client", resource_type="mqtt_client", resource_id=str(created["id"]))
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
def api_list_mqtt_clients(request: Request) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    return list_mqtt_clients()


@app.get("/mqtt/clients/{client_id}", response_model=MqttClientOut)
def api_get_mqtt_client(client_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return get_mqtt_client(client_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/mqtt/clients/{client_id}/rotate-password", response_model=MqttCredentialOut)
def api_rotate_mqtt_password(client_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        rotated = rotate_mqtt_client_password(client_id)
        audit_action(actor_user_id=request.state.auth_user.user_id, action="rotate_mqtt_password", resource_type="mqtt_client", resource_id=str(client_id))
        return rotated
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/mqtt/clients/{client_id}/disable", response_model=MqttClientOut)
def api_disable_mqtt_client(client_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        return set_mqtt_client_enabled(client_id, enabled=False)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/mqtt/clients/{client_id}/enable", response_model=MqttClientOut)
def api_enable_mqtt_client(client_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        return set_mqtt_client_enabled(client_id, enabled=True)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.delete("/mqtt/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_mqtt_client(client_id: int, request: Request) -> Response:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        delete_mqtt_client(client_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryOperationError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/mobile/sites")
def mobile_sites(request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    return {"sites": list_mobile_sites(site_ids=_mobile_site_scope_ids(request))}


@app.get("/mobile/domains")
def mobile_domains(request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    return {"domains": list_mobile_domains(site_ids=_mobile_site_scope_ids(request))}


@app.get("/mobile/sites/{site_id}")
def mobile_site_detail(site_id: str, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    resolved_site_id = _resolve_site_filter_id(site_id)
    _enforce_mobile_site_scope(request, resolved_site_id)
    try:
        return get_mobile_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/mobile/sites/{site_id}/devices")
def mobile_site_devices(site_id: str, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
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
                "integration_mode": "gateway",
            }
            for item in site.get("devices", [])
        ],
    }


@app.get("/mobile/devices/{device_id}")
def mobile_device(device_id: str, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    site_pk_id = _resolve_device_site_pk_id(device_id)
    if site_pk_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    _enforce_mobile_site_scope(request, site_pk_id)
    with get_connection() as conn:
        row = conn.execute(
            """
                     SELECT d.device_id, d.display_name, d.firmware_version, d.integration_mode,
                         d.last_seen_at, s.uuid AS site_uuid, s.slug AS site_slug, s.name AS site_name
            FROM devices d
            LEFT JOIN sites s ON s.id = d.site_id
            WHERE d.device_id = ?
            """,
            (device_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")

    zones = list_device_zones(device_id)
    channels = list_device_channels(device_id)
    return {
        "device_id": row["device_id"],
        "display_name": row["display_name"],
        "firmware_version": row["firmware_version"],
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    site_pk_id = _resolve_device_site_pk_id(device_id)
    if site_pk_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    _enforce_mobile_site_scope(request, site_pk_id)
    try:
        return {"device_id": device_id, "zones": list_device_zones(device_id)}
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/mobile/devices/{device_id}/channels")
def mobile_device_channels(device_id: str, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
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
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
    try:
        device_id, zone_id = resolve_zone_ref(zone_ref)
        context = get_device_onboarding_context(device_id)
        site_pk_id = context.get("site_id")
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
        _enforce_mobile_site_scope(request, int(site_pk_id))
        zone = upsert_zone_state(
            device_id,
            zone_id,
            target_temperature=float(payload.target_temperature_c),
            source="mobile_api",
        )
        log_event(
            "zone_setpoint_changed",
            domain_id=context.get("domain_id"),
            site_id=context.get("site_id"),
            device_pk_id=context["id"],
            zone_id=zone_id,
            payload={
                "device_id": device_id,
                "zone_id": zone_id,
                "target_temperature_c": float(payload.target_temperature_c),
                "source": "mobile_api",
            },
        )
        return {
            "device_id": device_id,
            "zone_id": zone_id,
            "target_temperature_c": float(payload.target_temperature_c),
            "command_state": "queued",
            "zone": zone,
        }
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/mobile/zones/{zone_ref}/history")
def mobile_zone_history(zone_ref: str, request: Request, window: str = "24h") -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        device_id, _zone_id = resolve_zone_ref(zone_ref)
        site_pk_id = _resolve_device_site_pk_id(device_id)
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
        _enforce_mobile_site_scope(request, site_pk_id)
        return get_zone_history(zone_ref, window=window)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/mobile/devices/{device_id}/history")
def mobile_device_history(device_id: str, request: Request, window: str = "24h") -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        site_pk_id = _resolve_device_site_pk_id(device_id)
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
        _enforce_mobile_site_scope(request, site_pk_id)
        return get_device_history(device_id, window=window)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DomainModelError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/events", response_model=list[EventOut])
def events_list(
    request: Request,
    limit: int = 100,
    event_type: str | None = None,
    domain_id: int | None = None,
    site_id: int | None = None,
) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    return list_events(limit=limit, event_type=event_type, domain_id=domain_id, site_id=site_id)


@app.get("/events/recent", response_model=list[EventOut])
def events_recent(
    request: Request,
    limit: int = 50,
    event_type: str | None = None,
    domain_id: int | None = None,
    site_id: int | None = None,
) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    return list_events(limit=limit, event_type=event_type, domain_id=domain_id, site_id=site_id)


@app.get("/events/device/{device_id}", response_model=list[EventOut])
def events_for_device(
    device_id: str,
    request: Request,
    limit: int = 100,
    event_type: str | None = None,
) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    try:
        return list_events(limit=limit, device_external_id=device_id, event_type=event_type)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/mobile/events")
def mobile_events(
    request: Request,
    limit: int = 50,
    event_type: str | None = None,
    domain_id: str | None = None,
    site_id: str | None = None,
) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    scoped_site_ids = _mobile_site_scope_ids(request)
    resolved_domain_id = _resolve_domain_filter_id(domain_id)
    resolved_site_id = _resolve_site_filter_id(site_id)
    if scoped_site_ids is not None and resolved_site_id is not None and resolved_site_id not in scoped_site_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
    events = list_events(
        limit=limit,
        event_type=event_type,
        domain_id=resolved_domain_id,
        site_id=resolved_site_id,
        allowed_site_ids=scoped_site_ids,
    )
    return {"events": [_mobile_event_projection(event) for event in events]}


@app.get("/mobile/notifications", response_model=list[NotificationOut])
def mobile_notifications(request: Request, limit: int = 100, unread_only: bool = False) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    if auth_user.user_id is None:
        return []
    notifications = list_notifications_for_user(auth_user.user_id, limit=limit)
    if unread_only:
        return [item for item in notifications if not item["read"]]
    return notifications


@app.post("/mobile/notifications/read-all")
def mobile_mark_all_notifications_read(request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None or auth_user.user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    updated_count = mark_all_notifications_read(user_id=auth_user.user_id)
    return {"updated": updated_count}


@app.post("/mobile/notifications/{notification_id}/read", response_model=NotificationOut)
def mobile_mark_notification_read(notification_id: str, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None or auth_user.user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    try:
        return mark_notification_read(notification_id, user_id=auth_user.user_id, read=True)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def api_create_user(payload: UserCreateIn, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    actor = request.state.auth_user
    if ROLE_ADMIN in actor.roles and ROLE_OWNER not in actor.roles:
        disallowed = {ROLE_OWNER, ROLE_ADMIN}
        if disallowed & set(payload.roles):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin may only assign installer/viewer roles")
    try:
        return create_user(
            actor_user_id=actor.user_id,
            username=payload.username,
            display_name=payload.display_name,
            password=payload.password,
            email=payload.email,
            roles=payload.roles,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/users", response_model=list[UserOut])
def api_list_users(request: Request) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    return list_users()


@app.get("/users/{user_id}", response_model=UserOut)
def api_get_user(user_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        return get_user(user_id)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/users/{user_id}/disable", response_model=UserOut)
def api_disable_user(user_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    actor = request.state.auth_user
    target = get_user(user_id)
    _enforce_admin_user_guardrails(actor.roles, target["roles"], "disable_user")
    try:
        return set_user_enabled(actor_user_id=actor.user_id, user_id=user_id, enabled=False)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/users/{user_id}/enable", response_model=UserOut)
def api_enable_user(user_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    actor = request.state.auth_user
    target = get_user(user_id)
    _enforce_admin_user_guardrails(actor.roles, target["roles"], "enable_user")
    try:
        return set_user_enabled(actor_user_id=actor.user_id, user_id=user_id, enabled=True)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/users/{user_id}/reset-password", response_model=UserOut)
def api_reset_user_password(user_id: int, payload: UserResetPasswordIn, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    actor = request.state.auth_user
    target = get_user(user_id)
    _enforce_admin_user_guardrails(actor.roles, target["roles"], "reset_password")
    try:
        return reset_user_password(
            actor_user_id=actor.user_id,
            user_id=user_id,
            password=payload.password,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/users/{user_id}/roles", response_model=UserOut)
def api_set_user_roles(user_id: int, payload: UserRoleUpdateIn, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    actor = request.state.auth_user
    target = get_user(user_id)
    _enforce_admin_user_guardrails(actor.roles, target["roles"], "set_roles")
    if ROLE_ADMIN in actor.roles and ROLE_OWNER in set(payload.roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin cannot assign owner role")
    if ROLE_ADMIN in actor.roles and ROLE_ADMIN in set(payload.roles):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin cannot assign admin role")
    try:
        return set_user_roles(
            actor_user_id=actor.user_id,
            user_id=user_id,
            roles=payload.roles,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_user(user_id: int, request: Request) -> Response:
    _require_roles(request, {ROLE_OWNER})
    actor = request.state.auth_user
    target = get_user(user_id)
    if ROLE_OWNER in target["roles"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="owner user cannot be deleted")
    try:
        delete_user(actor_user_id=actor.user_id, user_id=user_id)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/users/{user_id}/site-access")
def api_get_user_site_access(user_id: int, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    try:
        site_ids = list_user_site_access(user_id)
        return {"user_id": user_id, "site_ids": site_ids}
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/users/{user_id}/site-access")
def api_set_user_site_access(user_id: int, payload: UserSiteAccessUpdateIn, request: Request) -> dict:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    actor = request.state.auth_user
    try:
        site_ids = set_user_site_access(actor_user_id=actor.user_id, user_id=user_id, site_ids=payload.site_ids)
        return {"user_id": user_id, "site_ids": site_ids}
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/admin/audit-log", response_model=list[AuditLogOut])
def api_audit_log(request: Request, limit: int = 200) -> list[dict]:
    _require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
    return list_audit_logs(limit=limit)
