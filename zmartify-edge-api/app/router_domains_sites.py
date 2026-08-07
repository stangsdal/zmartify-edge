from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import AuthError, audit_action
from app.permissions import require_global_admin
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    create_domain,
    create_site,
    delete_domain,
    delete_site,
    get_domain,
    get_site,
    list_domains,
    list_sites,
    rename_domain,
    update_site,
)
from app.schemas import DomainCreate, DomainOut, DomainRename, SiteCreate, SiteOut, SiteUpdate


def create_domains_sites_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(tags=["domains-sites"])

    def require_platform_administrator(request: Request) -> None:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_global_admin(auth_user)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @router.post("/domains", response_model=DomainOut, status_code=status.HTTP_201_CREATED)
    def api_create_domain(payload: DomainCreate, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            domain = create_domain(payload.slug, payload.name)
            audit_action(actor_user_id=request.state.auth_user.user_id, action="create_domain", resource_type="domain", resource_id=str(domain["id"]))
            return domain
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    @router.get("/domains", response_model=list[DomainOut])
    def api_list_domains(request: Request) -> list[dict]:
        require_platform_administrator(request)
        return list_domains()

    @router.get("/domains/{domain_id}", response_model=DomainOut)
    def api_get_domain(domain_id: int, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            return get_domain(domain_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/domains/{domain_id}/rename", response_model=DomainOut)
    def api_rename_domain(domain_id: int, payload: DomainRename, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            return rename_domain(domain_id, payload.name)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.delete("/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
    def api_delete_domain(domain_id: int, request: Request) -> Response:
        require_platform_administrator(request)
        try:
            delete_domain(domain_id)
            audit_action(actor_user_id=request.state.auth_user.user_id, action="delete_domain", resource_type="domain", resource_id=str(domain_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/domains/{domain_id}/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
    def api_create_site(domain_id: int, payload: SiteCreate, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            site = create_site(domain_id, payload.slug, payload.name, payload.address)
            audit_action(actor_user_id=request.state.auth_user.user_id, action="create_site", resource_type="site", resource_id=str(site["id"]))
            return site
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    @router.get("/domains/{domain_id}/sites", response_model=list[SiteOut])
    def api_list_sites(domain_id: int, request: Request) -> list[dict]:
        require_platform_administrator(request)
        try:
            return list_sites(domain_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/sites/{site_id}", response_model=SiteOut)
    def api_get_site(site_id: int, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            return get_site(site_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.put("/sites/{site_id}", response_model=SiteOut)
    def api_update_site(site_id: int, payload: SiteUpdate, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            site = update_site(site_id, name=payload.name, address=payload.address)
            audit_action(actor_user_id=request.state.auth_user.user_id, action="update_site", resource_type="site", resource_id=str(site_id))
            return site
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
    def api_delete_site(site_id: int, request: Request) -> Response:
        require_platform_administrator(request)
        try:
            delete_site(site_id)
            audit_action(actor_user_id=request.state.auth_user.user_id, action="delete_site", resource_type="site", resource_id=str(site_id))
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router