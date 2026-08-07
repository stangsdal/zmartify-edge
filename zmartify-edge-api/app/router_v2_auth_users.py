from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import (
    AuthError,
    ROLE_ADMIN,
    ROLE_OWNER,
    get_user,
    list_user_site_access,
    list_users,
    logout_token,
    require_any_role,
)
from app.permissions import access_context
from app.permissions import require_site_permission
from app.schemas import SiteMembershipCandidateOut, SiteMembershipCreateIn, SiteMembershipOut, SiteMembershipUpdateIn, UserOut
from app.site_memberships import create_site_member, delete_site_member, list_site_member_candidates, list_site_members, update_site_member


def create_auth_users_v2_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-auth-users"])

    @router.get("/auth/me", response_model=UserOut)
    def v2_auth_me(request: Request) -> dict:
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

    @router.get("/me/context")
    def v2_access_context(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            return access_context(auth_user)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    def require_site_administration(site_id: int, request: Request) -> None:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_site_permission(auth_user, site_id, product_type=None, permission="administer")
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @router.get("/sites/{site_id}/members", response_model=list[SiteMembershipOut])
    def v2_list_site_members(site_id: int, request: Request) -> list[dict]:
        require_site_administration(site_id, request)
        try:
            return list_site_members(site_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/sites/{site_id}/member-candidates", response_model=list[SiteMembershipCandidateOut])
    def v2_list_site_member_candidates(site_id: int, request: Request) -> list[dict]:
        require_site_administration(site_id, request)
        try:
            return list_site_member_candidates(site_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/sites/{site_id}/members", response_model=SiteMembershipOut, status_code=status.HTTP_201_CREATED)
    def v2_create_site_member(site_id: int, payload: SiteMembershipCreateIn, request: Request) -> dict:
        require_site_administration(site_id, request)
        try:
            return create_site_member(
                site_id=site_id,
                user_id=payload.user_id,
                role=payload.role,
                status=payload.status,
                product_types=payload.product_types,
                invited_by_user_id=request.state.auth_user.user_id,
            )
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.put("/sites/{site_id}/members/{membership_id}", response_model=SiteMembershipOut)
    def v2_update_site_member(site_id: int, membership_id: int, payload: SiteMembershipUpdateIn, request: Request) -> dict:
        require_site_administration(site_id, request)
        try:
            return update_site_member(
                site_id=site_id,
                membership_id=membership_id,
                role=payload.role,
                status=payload.status,
                product_types=payload.product_types,
            )
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.delete("/sites/{site_id}/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
    def v2_delete_site_member(site_id: int, membership_id: int, request: Request) -> Response:
        require_site_administration(site_id, request)
        try:
            delete_site_member(site_id=site_id, membership_id=membership_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post("/auth/logout")
    def v2_auth_logout(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        logout_token(auth_user.token_id, auth_user.user_id)
        return {"ok": True}

    @router.get("/users", response_model=list[UserOut])
    def v2_list_users(request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        return list_users()

    @router.get("/users/{user_id}", response_model=UserOut)
    def v2_get_user(user_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            return get_user(user_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/users/{user_id}/site-access")
    def v2_get_user_site_access(user_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            return {"user_id": user_id, "site_ids": list_user_site_access(user_id)}
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/auth/ping")
    def v2_auth_ping(request: Request) -> Response:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_any_role(auth_user, {ROLE_OWNER, ROLE_ADMIN})
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
