from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import (
    AuthError,
    create_user,
    delete_user,
    get_user,
    list_audit_logs,
    list_users,
    reset_user_password,
    set_user_enabled,
    set_user_roles,
)
from app.permissions import require_global_admin
from app.schemas import (
    AuditLogOut,
    UserCreateIn,
    UserOut,
    UserResetPasswordIn,
    UserRoleUpdateIn,
)

def create_legacy_auth_users_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(tags=["legacy-auth-users"])

    def require_platform_administrator(request: Request) -> None:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_global_admin(auth_user)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    def validate_global_roles(roles: list[str]) -> None:
        if set(roles) - {"administrator"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="only the administrator global role is supported")

    @router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
    def api_create_user(payload: UserCreateIn, request: Request) -> dict:
        require_platform_administrator(request)
        actor = request.state.auth_user
        validate_global_roles(payload.roles)
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
        require_platform_administrator(request)
        return list_users()

    @router.get("/users/{user_id}", response_model=UserOut)
    def api_get_user(user_id: int, request: Request) -> dict:
        require_platform_administrator(request)
        try:
            return get_user(user_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/users/{user_id}/disable", response_model=UserOut)
    def api_disable_user(user_id: int, request: Request) -> dict:
        require_platform_administrator(request)
        actor = request.state.auth_user
        try:
            return set_user_enabled(actor_user_id=actor.user_id, user_id=user_id, enabled=False)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/users/{user_id}/enable", response_model=UserOut)
    def api_enable_user(user_id: int, request: Request) -> dict:
        require_platform_administrator(request)
        actor = request.state.auth_user
        try:
            return set_user_enabled(actor_user_id=actor.user_id, user_id=user_id, enabled=True)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/users/{user_id}/reset-password", response_model=UserOut)
    def api_reset_user_password(user_id: int, payload: UserResetPasswordIn, request: Request) -> dict:
        require_platform_administrator(request)
        actor = request.state.auth_user
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
        require_platform_administrator(request)
        actor = request.state.auth_user
        validate_global_roles(payload.roles)
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
        require_platform_administrator(request)
        actor = request.state.auth_user
        try:
            delete_user(actor_user_id=actor.user_id, user_id=user_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/admin/audit-log", response_model=list[AuditLogOut])
    def api_audit_log(request: Request, limit: int = 200) -> list[dict]:
        require_platform_administrator(request)
        return list_audit_logs(limit=limit)

    return router
