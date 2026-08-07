from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import AuthError
from app.domain_model import DomainModelError, get_device_freshness, get_device_history, get_zone_history, resolve_zone_ref
from app.permissions import require_site_permission
from app.registry import RegistryNotFoundError
from app.schemas import DeviceFreshnessOut


def create_legacy_mobile_telemetry_router(
    resolve_device_site_pk_id: Callable[[str], int | None],
) -> APIRouter:
    router = APIRouter(tags=["legacy-mobile-telemetry"])

    def require_hvac_read(device_id: str, request: Request) -> None:
        site_id = resolve_device_site_pk_id(device_id)
        if site_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_site_permission(auth_user, site_id, product_type="hvac", permission="read")
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @router.get("/mobile/devices/{device_id}/freshness", response_model=DeviceFreshnessOut)
    def mobile_device_freshness(device_id: str, request: Request) -> dict:
        require_hvac_read(device_id, request)
        try:
            return get_device_freshness(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/mobile/zones/{zone_ref}/history")
    def mobile_zone_history(zone_ref: str, request: Request, window: str = "24h", offset_ms: int = 0) -> dict:
        try:
            device_id, _zone_id = resolve_zone_ref(zone_ref)
            require_hvac_read(device_id, request)
            return get_zone_history(zone_ref, window=window, offset_ms=offset_ms)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/mobile/devices/{device_id}/history")
    def mobile_device_history(device_id: str, request: Request, window: str = "24h", offset_ms: int = 0) -> dict:
        try:
            require_hvac_read(device_id, request)
            return get_device_history(device_id, window=window, offset_ms=offset_ms)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return router
