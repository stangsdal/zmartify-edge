from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import ROLE_ADMIN, ROLE_OWNER, ROLE_VIEWER, ROLE_INSTALLER
from app.db import get_connection
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

    @router.get("/domains")
    def v2_list_domains(request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        return [_domain_v2_payload(item) for item in list_domains()]

    @router.post("/domains", status_code=status.HTTP_201_CREATED)
    def v2_create_domain(payload: DomainCreate, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            return _domain_v2_payload(create_domain(payload.slug, payload.name))
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    @router.get("/domains/{domain_ref}")
    def v2_get_domain(domain_ref: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        domain_id = _resolve_domain_id(domain_ref)
        try:
            return _domain_v2_payload(get_domain(domain_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/domains/{domain_ref}/rename")
    def v2_rename_domain(domain_ref: str, payload: DomainRename, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        domain_id = _resolve_domain_id(domain_ref)
        try:
            return _domain_v2_payload(rename_domain(domain_id, payload.name))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/domains/{domain_ref}/sites", status_code=status.HTTP_201_CREATED)
    def v2_create_site(domain_ref: str, payload: SiteCreate, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        domain_id = _resolve_domain_id(domain_ref)
        try:
            return _site_v2_payload(create_site(domain_id, payload.slug, payload.name))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    @router.get("/domains/{domain_ref}/sites")
    def v2_list_sites(domain_ref: str, request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        domain_id = _resolve_domain_id(domain_ref)
        try:
            return [_site_v2_payload(item) for item in list_sites(domain_id)]
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/sites/{site_ref}")
    def v2_get_site(site_ref: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        site_id = _resolve_site_id(site_ref)
        try:
            return _site_v2_payload(get_site(site_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/devices")
    def v2_list_devices(request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        return [_device_v2_payload(item) for item in list_devices()]

    @router.post("/devices", status_code=status.HTTP_201_CREATED)
    def v2_create_device(payload: DeviceCreate, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
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
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return _device_v2_payload(get_device(device_ref))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/devices/{device_ref}/assign-site")
    def v2_assign_device_site(device_ref: str, payload: DeviceAssignSiteRef, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        site_id = _resolve_site_id(payload.site_ref)
        try:
            return _device_v2_payload(assign_device_site(device_ref, site_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router
