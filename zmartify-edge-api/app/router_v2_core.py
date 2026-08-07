from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import AuthError, AuthenticatedUser
from app.db import get_connection
from app.permissions import accessible_site_ids, require_global_admin, require_site_permission
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    assign_device_site,
    create_device,
    create_domain,
    create_site,
    get_device,
    get_domain,
    get_site,
    list_devices,
    list_domains,
    list_sites,
    rename_domain,
)
from app.schemas import DeviceCreate, DomainCreate, DomainRename, SiteCreate


class DeviceAssignSiteRef(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    site_ref: str = Field(min_length=1)


def _resolve_domain_id(domain_ref: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM domains WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?",
            (domain_ref, domain_ref, domain_ref),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="domain not found")
    return int(row["id"])


def _resolve_site_id(site_ref: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM sites WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?",
            (site_ref, site_ref, site_ref),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
    return int(row["id"])


def _domain_v2_payload(domain: dict) -> dict:
    return {
        "domain_ref": domain.get("uuid") or str(domain.get("id")),
        "slug": domain.get("slug"),
        "name": domain.get("name"),
        "created_at": domain.get("created_at"),
    }


def _site_v2_payload(site: dict) -> dict:
    return {
        "site_ref": site.get("uuid") or str(site.get("id")),
        "domain_id": site.get("domain_id"),
        "slug": site.get("slug"),
        "name": site.get("name"),
        "address": site.get("address"),
        "created_at": site.get("created_at"),
    }


def _device_v2_payload(device: dict) -> dict:
    return {
        "device_ref": device.get("device_id"),
        "display_name": device.get("display_name"),
        "firmware_version": device.get("firmware_version"),
        "site_id": device.get("site_id"),
        "created_at": device.get("created_at"),
        "last_seen_at": device.get("last_seen_at"),
    }


def create_core_v2_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-core"])

    def auth_user(request: Request) -> AuthenticatedUser:
        user = getattr(request.state, "auth_user", None)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        return user

    def require_platform_administrator(request: Request) -> None:
        try:
            require_global_admin(auth_user(request))
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    def require_site_read(site_id: int, request: Request) -> None:
        try:
            require_site_permission(auth_user(request), site_id, product_type=None, permission="read")
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    def require_site_configure(site_id: int, request: Request) -> None:
        try:
            require_site_permission(auth_user(request), site_id, product_type=None, permission="configure")
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    def readable_site_ids(request: Request) -> set[int] | None:
        return accessible_site_ids(auth_user(request))

    @router.get("/domains")
    def v2_list_domains(request: Request) -> list[dict]:
        site_ids = readable_site_ids(request)
        if site_ids is None:
            return [_domain_v2_payload(item) for item in list_domains()]
        if not site_ids:
            return []
        with get_connection() as conn:
            rows = conn.execute(
                f"SELECT DISTINCT domain_id FROM sites WHERE id IN ({','.join('?' for _ in site_ids)})",
                tuple(sorted(site_ids)),
            ).fetchall()
        domain_ids = {int(row["domain_id"]) for row in rows}
        return [_domain_v2_payload(item) for item in list_domains() if int(item["id"]) in domain_ids]

    @router.post("/domains", status_code=status.HTTP_201_CREATED)
    def v2_create_domain(payload: DomainCreate, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            return _domain_v2_payload(create_domain(payload.slug, payload.name))
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    @router.get("/domains/{domain_ref}")
    def v2_get_domain(domain_ref: str, request: Request) -> dict:
        domain_id = _resolve_domain_id(domain_ref)
        site_ids = readable_site_ids(request)
        if site_ids is not None:
            with get_connection() as conn:
                row = conn.execute(
                    f"SELECT 1 FROM sites WHERE domain_id = ? AND id IN ({','.join('?' for _ in site_ids) or 'NULL'})",
                    (domain_id, *sorted(site_ids)),
                ).fetchone()
            if row is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="domain not found")
        try:
            return _domain_v2_payload(get_domain(domain_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/domains/{domain_ref}/rename")
    def v2_rename_domain(domain_ref: str, payload: DomainRename, request: Request) -> dict:
        require_platform_administrator(request)
        domain_id = _resolve_domain_id(domain_ref)
        try:
            return _domain_v2_payload(rename_domain(domain_id, payload.name))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/domains/{domain_ref}/sites", status_code=status.HTTP_201_CREATED)
    def v2_create_site(domain_ref: str, payload: SiteCreate, request: Request) -> dict:
        require_platform_administrator(request)
        domain_id = _resolve_domain_id(domain_ref)
        try:
            return _site_v2_payload(create_site(domain_id, payload.slug, payload.name, payload.address))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    @router.get("/domains/{domain_ref}/sites")
    def v2_list_sites(domain_ref: str, request: Request) -> list[dict]:
        domain_id = _resolve_domain_id(domain_ref)
        try:
            site_ids = readable_site_ids(request)
            return [
                _site_v2_payload(item)
                for item in list_sites(domain_id)
                if site_ids is None or int(item["id"]) in site_ids
            ]
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/sites/{site_ref}")
    def v2_get_site(site_ref: str, request: Request) -> dict:
        site_id = _resolve_site_id(site_ref)
        require_site_read(site_id, request)
        try:
            return _site_v2_payload(get_site(site_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/devices")
    def v2_list_devices(request: Request) -> list[dict]:
        site_ids = readable_site_ids(request)
        return [
            _device_v2_payload(item)
            for item in list_devices()
            if site_ids is None or (item.get("site_id") is not None and int(item["site_id"]) in site_ids)
        ]

    @router.post("/devices", status_code=status.HTTP_201_CREATED)
    def v2_create_device(payload: DeviceCreate, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            return _device_v2_payload(
                create_device(
                    device_id=payload.device_id,
                    display_name=payload.display_name,
                    mac=payload.mac,
                    firmware_version=payload.firmware_version,
                )
            )
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    @router.get("/devices/{device_ref}")
    def v2_get_device(device_ref: str, request: Request) -> dict:
        try:
            device = get_device(device_ref)
            site_id = device.get("site_id")
            if site_id is None:
                require_platform_administrator(request)
            else:
                require_site_read(int(site_id), request)
            return _device_v2_payload(device)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/devices/{device_ref}/assign-site")
    def v2_assign_device_site(device_ref: str, payload: DeviceAssignSiteRef, request: Request) -> dict:
        site_id = _resolve_site_id(payload.site_ref)
        require_site_configure(site_id, request)
        try:
            return _device_v2_payload(assign_device_site(device_ref, site_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router
