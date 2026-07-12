from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER, ROLE_VIEWER
from app.contracts import ContractValidationError, validate_mqtt_v2_reported_state
from app.domain_model import (
    DomainModelError,
    get_device_channel,
    get_device_freshness,
    get_device_history,
    get_device_zone,
    get_zone_history,
    ingest_device_twin_snapshot,
    list_device_channels,
    list_device_zones,
    rename_zone,
    set_channel_metadata,
    set_channel_zone_links,
    set_zone_metadata,
    upsert_channel_state,
)
from app.mqtt_commands import MqttCommandError, publish_zone_name_command, should_forward_setpoint_commands
from app.registry import RegistryNotFoundError
from app.schemas import (
    ChannelMetadataIn,
    ChannelOut,
    ChannelStateIn,
    ChannelZoneLinksIn,
    DeviceFreshnessOut,
    DeviceTwinIngestIn,
    DeviceTwinIngestResult,
    ZoneMetadataIn,
    ZoneOut,
    ZoneRenameIn,
)


def create_device_domain_v2_router(
    require_roles: Callable[[Request, set[str]], None],
    resolve_device_site_pk_id: Callable[[str], int | None],
    enforce_mobile_site_scope: Callable[[Request, int], None],
    publish_zone_state_update: Callable[[str, dict], None],
) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-device-domain"])

    @router.get("/devices/{device_id}/zones", response_model=list[ZoneOut])
    def v2_device_zones(device_id: str, request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return list_device_zones(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/devices/{device_id}/zones/{zone_id}", response_model=ZoneOut)
    def v2_get_device_zone(device_id: str, zone_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return get_device_zone(device_id, zone_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/zones/{zone_id}/rename", response_model=ZoneOut)
    def v2_rename_device_zone(device_id: str, zone_id: int, payload: ZoneRenameIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            if should_forward_setpoint_commands():
                try:
                    publish_zone_name_command(device_id, zone_id, payload.name)
                except MqttCommandError as exc:
                    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"zone name publish failed: {exc}") from exc
            return rename_zone(device_id, zone_id, payload.name)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/zones/{zone_id}/metadata", response_model=ZoneOut)
    def v2_set_device_zone_metadata(device_id: str, zone_id: int, payload: ZoneMetadataIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            if payload.name and should_forward_setpoint_commands():
                try:
                    publish_zone_name_command(device_id, zone_id, payload.name)
                except MqttCommandError as exc:
                    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"zone name publish failed: {exc}") from exc
            return set_zone_metadata(
                device_id,
                zone_id,
                name=payload.name,
                icon=payload.icon,
                sort_order=payload.sort_order,
                floor=payload.floor,
                area_m2=payload.area_m2,
            )
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/devices/{device_id}/channels", response_model=list[ChannelOut])
    def v2_device_channels(device_id: str, request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return list_device_channels(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/devices/{device_id}/channels/{channel_id}", response_model=ChannelOut)
    def v2_get_device_channel(device_id: str, channel_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return get_device_channel(device_id, channel_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/channels/{channel_id}/metadata", response_model=ChannelOut)
    def v2_set_device_channel_metadata(device_id: str, channel_id: int, payload: ChannelMetadataIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            return set_channel_metadata(
                device_id,
                channel_id,
                name=payload.name,
                icon=payload.icon,
                sort_order=payload.sort_order,
            )
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/channels/{channel_id}/state", response_model=ChannelOut)
    def v2_set_device_channel_state(device_id: str, channel_id: int, payload: ChannelStateIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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

    @router.post("/devices/{device_id}/channels/{channel_id}/link-zones", response_model=ChannelOut)
    def v2_set_device_channel_zone_links(device_id: str, channel_id: int, payload: ChannelZoneLinksIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            return set_channel_zone_links(device_id, channel_id, payload.zone_ids)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/ingest/twin", response_model=DeviceTwinIngestResult)
    def v2_ingest_device_twin(device_id: str, payload: DeviceTwinIngestIn, request: Request) -> dict:
        device_token_device_id = getattr(request.state, "device_token_device_id", None)
        if device_token_device_id != device_id:
            require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
                    publish_zone_state_update(device_id, zone)
            return result
        except ContractValidationError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/mobile/zones/{zone_ref}/history")
    def v2_mobile_zone_history(zone_ref: str, request: Request, window: str = "24h", offset_ms: int = 0) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return get_zone_history(zone_ref, window=window, offset_ms=offset_ms)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/mobile/devices/{device_id}/history")
    def v2_mobile_device_history(device_id: str, request: Request, window: str = "24h", offset_ms: int = 0) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            site_pk_id = resolve_device_site_pk_id(device_id)
            if site_pk_id is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
            enforce_mobile_site_scope(request, site_pk_id)
            return get_device_history(device_id, window=window, offset_ms=offset_ms)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/mobile/devices/{device_id}/freshness", response_model=DeviceFreshnessOut)
    def v2_mobile_device_freshness(device_id: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        site_pk_id = resolve_device_site_pk_id(device_id)
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
        enforce_mobile_site_scope(request, site_pk_id)
        try:
            return get_device_freshness(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router
