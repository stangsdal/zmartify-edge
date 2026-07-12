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
from app.schemas import UserOut


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
