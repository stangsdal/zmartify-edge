from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import (
    AuthError,
    ROLE_ADMIN,
    ROLE_OWNER,
    create_user,
    delete_user,
    get_user,
    list_audit_logs,
    list_user_site_access,
    list_users,
    reset_user_password,
    set_user_enabled,
    set_user_roles,
    set_user_site_access,
)
from app.schemas import (
    AuditLogOut,
    UserCreateIn,
    UserOut,
    UserResetPasswordIn,
    UserRoleUpdateIn,
    UserSiteAccessUpdateIn,
)


def _enforce_admin_user_guardrails(actor_roles: set[str], target_roles: list[str], action: str) -> None:
    if ROLE_ADMIN not in actor_roles or ROLE_OWNER in actor_roles:
        return

    target_role_set = set(target_roles)
    if ROLE_OWNER in target_role_set:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin cannot manage owner user")

    if action in {"delete_user", "set_roles"} and ROLE_ADMIN in target_role_set:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin cannot modify peer admin user")


def create_legacy_auth_users_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(tags=["legacy-auth-users"])

    @router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
    def api_create_user(payload: UserCreateIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
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

    @router.get("/users", response_model=list[UserOut])
    def api_list_users(request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        return list_users()

    @router.get("/users/{user_id}", response_model=UserOut)
    def api_get_user(user_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            return get_user(user_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/users/{user_id}/disable", response_model=UserOut)
    def api_disable_user(user_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        actor = request.state.auth_user
        target = get_user(user_id)
        _enforce_admin_user_guardrails(actor.roles, target["roles"], "disable_user")
        try:
            return set_user_enabled(actor_user_id=actor.user_id, user_id=user_id, enabled=False)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/users/{user_id}/enable", response_model=UserOut)
    def api_enable_user(user_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        actor = request.state.auth_user
        target = get_user(user_id)
        _enforce_admin_user_guardrails(actor.roles, target["roles"], "enable_user")
        try:
            return set_user_enabled(actor_user_id=actor.user_id, user_id=user_id, enabled=True)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/users/{user_id}/reset-password", response_model=UserOut)
    def api_reset_user_password(user_id: int, payload: UserResetPasswordIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
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

    @router.post("/users/{user_id}/roles", response_model=UserOut)
    def api_set_user_roles(user_id: int, payload: UserRoleUpdateIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
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

    @router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
    def api_delete_user(user_id: int, request: Request) -> Response:
        require_roles(request, {ROLE_OWNER})
        actor = request.state.auth_user
        target = get_user(user_id)
        if ROLE_OWNER in target["roles"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="owner user cannot be deleted")
        try:
            delete_user(actor_user_id=actor.user_id, user_id=user_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/users/{user_id}/site-access")
    def api_get_user_site_access(user_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            site_ids = list_user_site_access(user_id)
            return {"user_id": user_id, "site_ids": site_ids}
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/users/{user_id}/site-access")
    def api_set_user_site_access(user_id: int, payload: UserSiteAccessUpdateIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        actor = request.state.auth_user
        try:
            site_ids = set_user_site_access(actor_user_id=actor.user_id, user_id=user_id, site_ids=payload.site_ids)
            return {"user_id": user_id, "site_ids": site_ids}
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/admin/audit-log", response_model=list[AuditLogOut])
    def api_audit_log(request: Request, limit: int = 200) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        return list_audit_logs(limit=limit)

    return router
