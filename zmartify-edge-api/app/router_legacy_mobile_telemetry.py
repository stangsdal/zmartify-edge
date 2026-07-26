from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER, ROLE_VIEWER
from app.domain_model import DomainModelError, get_device_freshness, get_device_history, get_zone_history, resolve_zone_ref
from app.registry import RegistryNotFoundError
from app.schemas import DeviceFreshnessOut


def create_legacy_mobile_telemetry_router(
    require_roles: Callable[[Request, set[str]], None],
    resolve_device_site_pk_id: Callable[[str], int | None],
    enforce_mobile_site_scope: Callable[[Request, int], None],
) -> APIRouter:
    router = APIRouter(tags=["legacy-mobile-telemetry"])

    @router.get("/mobile/devices/{device_id}/freshness", response_model=DeviceFreshnessOut)
    def mobile_device_freshness(device_id: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        site_pk_id = resolve_device_site_pk_id(device_id)
        if site_pk_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
        enforce_mobile_site_scope(request, site_pk_id)
        try:
            return get_device_freshness(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/mobile/zones/{zone_ref}/history")
    def mobile_zone_history(zone_ref: str, request: Request, window: str = "24h", offset_ms: int = 0) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            device_id, _zone_id = resolve_zone_ref(zone_ref)
            site_pk_id = resolve_device_site_pk_id(device_id)
            if site_pk_id is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
            enforce_mobile_site_scope(request, site_pk_id)
            return get_zone_history(zone_ref, window=window, offset_ms=offset_ms)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/mobile/devices/{device_id}/history")
    def mobile_device_history(device_id: str, request: Request, window: str = "24h", offset_ms: int = 0) -> dict:
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

    return router
