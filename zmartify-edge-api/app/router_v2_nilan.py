from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import AuthError
from app.nilan_domain import get_nilan_state
from app.permissions import require_site_permission
from app.registry import RegistryNotFoundError


def create_nilan_v2_router(resolve_device_site_pk_id: Callable[[str], int | None]) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-nilan"])

    @router.get("/devices/{device_id}/hvac/nilan")
    def v2_nilan_state(device_id: str, request: Request) -> dict:
        site_id = resolve_device_site_pk_id(device_id)
        if site_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_site_permission(auth_user, site_id, product_type="hvac", permission="read")
            return get_nilan_state(device_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router
