from __future__ import annotations

import os
import json
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER, ROLE_VIEWER, audit_action
from app.db import get_connection
from app.device_onboarding import (
    DeviceOnboardingError,
    discover_remote_device,
    get_remote_network_config,
    get_remote_device_version,
    get_remote_onboarding_status,
    get_remote_sd_card_status,
    normalize_device_base_url,
    push_remote_onboarding_config,
)
from app.domain_model import DomainModelError, upsert_device_state
from app.mqtt_commands import MqttCommandError, publish_irrigation_command
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    RegistryOperationError,
    assign_device_site,
    create_device,
    ensure_device_admin_token,
    get_device,
    get_device_mqtt_credentials,
    get_device_onboarding_context,
    rotate_mqtt_client_password,
    update_device_firmware_version,
    update_device_local_url,
)
from app.schemas import (
    DeviceClaimIn,
    DeviceClaimOut,
    DeviceControllerSettingsIn,
    DeviceControllerSettingsOut,
    DeviceDiscoverIn,
    DeviceDiscoverOut,
    DeviceOnboardingStatusOut,
    DevicePushConfigIn,
    DeviceSdCardInitializeIn,
    DeviceSdCardStatusOut,
)


_REQUIRED_PUBLIC_EDGE_URL = "https://pilot.zmartify.dk"
_REQUIRED_PUBLIC_MQTT_URI = "mqtts://pilot.zmartify.dk:8883"


def _edge_public_base_url() -> str:
    configured = os.getenv("ZMART_EDGE_PUBLIC_API_BASE", "").strip()
    if configured.rstrip("/") == _REQUIRED_PUBLIC_EDGE_URL:
        return _REQUIRED_PUBLIC_EDGE_URL
    return _REQUIRED_PUBLIC_EDGE_URL


def _edge_public_mqtt_uri() -> str:
    configured = os.getenv("ZMART_EDGE_PUBLIC_MQTT_URI", "").strip()
    if configured == _REQUIRED_PUBLIC_MQTT_URI:
        return _REQUIRED_PUBLIC_MQTT_URI
    return _REQUIRED_PUBLIC_MQTT_URI


def _allow_manual_firmware_refresh() -> bool:
    return os.getenv("ZMART_EDGE_ENABLE_MANUAL_FIRMWARE_REFRESH", "0").strip() == "1"


def _build_device_push_payload(device_id: str, claim_token: str | None) -> dict:
    context = get_device_onboarding_context(device_id)
    credentials = get_device_mqtt_credentials(device_id)
    device_admin_token = ensure_device_admin_token(device_id)
    if context.get("site_id") is None or context.get("domain_id") is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device must be assigned to a site before push-config")

    payload = {
        "device_admin_token": device_admin_token,
        "edge_url": _edge_public_base_url(),
        "mqtt_uri": _edge_public_mqtt_uri(),
        "mqtt_username": credentials["username"],
        "mqtt_password": credentials["password"],
        "mqtt_base": "homie/5",
        "domain_id": context["domain_id"],
        "site_id": context["site_id"],
    }
    if claim_token:
        payload["claim_token"] = claim_token
    return payload


def _device_local_url(device_id: str) -> str:
    device = get_device_onboarding_context(device_id)
    local_url = device.get("local_url")
    if not local_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device local_url not set")
    return str(local_url)


def _controller_settings_payload(device_id: str, local_url: str, settings: dict, reboot_required: bool = False) -> dict:
    return {
        "device_id": device_id,
        "local_url": local_url,
        "mqtt_broker_uri": settings.get("mqtt_broker_uri") or settings.get("mqtt_uri"),
        "mqtt_port": settings.get("mqtt_port"),
        "mqtt_username": settings.get("mqtt_username"),
        "mqtt_password_configured": settings.get("mqtt_password_configured"),
        "mqtt_tls_enabled": settings.get("mqtt_tls_enabled"),
        "ntp_server": settings.get("ntp_server"),
        "timezone": settings.get("timezone"),
        "reboot_required": reboot_required or bool(settings.get("reboot_required")),
    }


def _fallback_controller_settings(device_id: str, local_url: str) -> dict:
    credentials = get_device_mqtt_credentials(device_id)
    mqtt_uri = _edge_public_mqtt_uri()
    return _controller_settings_payload(
        device_id,
        local_url,
        {
            "mqtt_broker_uri": mqtt_uri,
            "mqtt_port": 8883 if mqtt_uri.startswith("mqtts://") else 1883,
            "mqtt_username": credentials.get("username"),
            "mqtt_password_configured": bool(credentials.get("password")),
            "mqtt_tls_enabled": mqtt_uri.startswith("mqtts://"),
            "ntp_server": "pool.ntp.org",
            "timezone": "CET-1CEST,M3.5.0/2,M10.5.0/3",
        },
    )


def _sd_card_status_payload(device_id: str, local_url: str, status_payload: dict, source: str = "device_http") -> dict:
    return {
        "device_id": device_id,
        "local_url": local_url,
        "state": status_payload.get("state") or "unknown",
        "mounted": bool(status_payload.get("mounted")),
        "total_bytes": status_payload.get("total_bytes"),
        "free_bytes": status_payload.get("free_bytes"),
        "mount_point": status_payload.get("mount_point"),
        "card_name": status_payload.get("card_name"),
        "last_error": status_payload.get("last_error"),
        "source": source,
        "command_id": status_payload.get("command_id"),
        "command_status": status_payload.get("command_status"),
    }


def _fallback_sd_card_status(device_id: str, local_url: str, detail: str | None = None) -> dict:
    mqtt_status = _latest_mqtt_sd_card_status(device_id, local_url)
    if mqtt_status is not None:
        return mqtt_status
    return _sd_card_status_payload(
        device_id,
        local_url,
        {
            "state": "unreachable",
            "mounted": False,
            "last_error": detail or "controller HTTP status endpoint is not reachable from edge",
        },
        source="edge_fallback",
    )


def _latest_mqtt_sd_card_status(device_id: str, local_url: str) -> dict | None:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT e.payload_json
            FROM event_log e
            JOIN devices d ON d.id = e.device_id
            WHERE d.device_id = ? AND e.event_type = 'device_storage_status'
            ORDER BY e.id DESC
            LIMIT 1
            """,
            (device_id,),
        ).fetchone()
    if row is None:
        return None
    try:
        payload = json.loads(row["payload_json"] or "{}")
    except json.JSONDecodeError:
        return None
    storage = payload.get("storage") if isinstance(payload.get("storage"), dict) else {}
    sd_card = storage.get("sd_card") if isinstance(storage.get("sd_card"), dict) else None
    if sd_card is None:
        return None
    return _sd_card_status_payload(device_id, local_url, sd_card, source="mqtt_reported_state")


def create_device_lifecycle_v2_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-device-lifecycle"])

    @router.post("/devices/discover", response_model=DeviceDiscoverOut)
    def v2_discover_device(payload: DeviceDiscoverIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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

    @router.post("/devices/claim", response_model=DeviceClaimOut, status_code=status.HTTP_201_CREATED)
    def v2_claim_device(payload: DeviceClaimIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
                require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
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

            push_payload = _build_device_push_payload(device_id, payload.claim_token)
            try:
                push_remote_onboarding_config(payload.base_url, push_payload)
            except DeviceOnboardingError as exc:
                if not is_reclaim or "timed out" not in str(exc).lower():
                    raise
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

    @router.post("/devices/{device_id}/push-config", response_model=DeviceOnboardingStatusOut)
    def v2_push_device_config(device_id: str, payload: DevicePushConfigIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            device = get_device_onboarding_context(device_id)
            local_url = device.get("local_url")
            if not local_url:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device local_url not set")
            push_payload = _build_device_push_payload(device_id, payload.claim_token)
            push_remote_onboarding_config(local_url, push_payload)
            status_payload = get_remote_onboarding_status(local_url)
            audit_action(actor_user_id=request.state.auth_user.user_id, action="push_device_config", resource_type="device", resource_id=device_id)
            return status_payload
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DeviceOnboardingError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/devices/{device_id}/onboarding-status", response_model=DeviceOnboardingStatusOut)
    def v2_device_onboarding_status(device_id: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            local_url = _device_local_url(device_id)
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

    @router.get("/devices/{device_id}/controller-settings", response_model=DeviceControllerSettingsOut)
    def v2_get_device_controller_settings(device_id: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            local_url = _device_local_url(device_id)
            try:
                settings = get_remote_network_config(local_url)
            except DeviceOnboardingError:
                return _fallback_controller_settings(device_id, local_url)
            return _controller_settings_payload(device_id, local_url, settings)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    @router.put("/devices/{device_id}/controller-settings", response_model=DeviceControllerSettingsOut)
    def v2_update_device_controller_settings(device_id: str, payload: DeviceControllerSettingsIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            local_url = _device_local_url(device_id)
            update_payload = payload.model_dump(exclude_none=True)
            if update_payload.get("mqtt_password") == "":
                update_payload.pop("mqtt_password")
            publish_irrigation_command(device_id, "irrigation.config.network", None, update_payload)
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="update_controller_settings",
                resource_type="device",
                resource_id=device_id,
                metadata={"updated_fields": sorted(update_payload.keys())},
            )
            fallback = _fallback_controller_settings(device_id, local_url)
            return _controller_settings_payload(device_id, local_url, {**fallback, **update_payload}, reboot_required=True)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except (MqttCommandError, RegistryOperationError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/devices/{device_id}/storage/sd-card", response_model=DeviceSdCardStatusOut)
    def v2_get_device_sd_card_status(device_id: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            local_url = _device_local_url(device_id)
            try:
                status_payload = get_remote_sd_card_status(local_url)
            except DeviceOnboardingError as exc:
                return _fallback_sd_card_status(device_id, local_url, str(exc))
            return _sd_card_status_payload(device_id, local_url, status_payload)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/storage/sd-card/initialize", response_model=DeviceSdCardStatusOut)
    def v2_initialize_device_sd_card(device_id: str, payload: DeviceSdCardInitializeIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            local_url = _device_local_url(device_id)
            result = publish_irrigation_command(
                device_id,
                "irrigation.config.storage.sd-card.initialize",
                None,
                {"format": payload.format},
            )
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="initialize_sd_card",
                resource_type="device",
                resource_id=device_id,
                metadata={"format": payload.format, "command_id": result.get("command_id")},
            )
            status_payload = _fallback_sd_card_status(device_id, local_url)
            status_payload["state"] = "initialize_requested"
            status_payload["command_id"] = result.get("command_id")
            status_payload["command_status"] = result.get("status")
            status_payload["last_error"] = None
            return status_payload
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except (MqttCommandError, RegistryOperationError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/firmware/refresh")
    def v2_refresh_device_firmware(device_id: str, request: Request, base_url: str | None = None) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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

    return router
