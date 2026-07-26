from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import (
    AuthError,
    ROLE_ADMIN,
    ROLE_INSTALLER,
    ROLE_OWNER,
    get_user,
    is_initialized,
    issue_registration_invite,
    issue_registration_invites_bulk,
    list_registration_invites,
    login,
    logout_token,
    register_user_with_invite,
    validate_registration_invite,
)
from app.schemas import (
    AuthLoginIn,
    AuthLoginOut,
    AuthRegisterByInviteIn,
    InviteBulkCreateIn,
    InviteBulkCreateOut,
    InviteCreateIn,
    InviteCreateOut,
    InviteListItemOut,
    InviteValidateOut,
    SetupStatusOut,
    UserOut,
)


def create_auth_invites_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(tags=["auth-invites"])

    @router.get("/setup/status", response_model=SetupStatusOut)
    def setup_status() -> dict:
        return {"initialized": is_initialized()}

    @router.post("/auth/login", response_model=AuthLoginOut)
    def auth_login(payload: AuthLoginIn) -> dict:
        try:
            token, expires_at, _user_id = login(payload.username, payload.password)
            return {"access_token": token, "expires_at": expires_at}
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    @router.get("/auth/invite/validate", response_model=InviteValidateOut)
    def auth_validate_invite(token: str) -> dict:
        return validate_registration_invite(token)

    @router.post("/auth/register", response_model=AuthLoginOut)
    def auth_register_by_invite(payload: AuthRegisterByInviteIn) -> dict:
        try:
            register_user_with_invite(
                invite_token=payload.invite_token,
                username=payload.username,
                display_name=payload.display_name,
                password=payload.password,
                email=payload.email,
            )
            token, expires_at, _user_id = login(payload.username, payload.password)
            return {"access_token": token, "expires_at": expires_at}
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/auth/logout")
    def auth_logout(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        logout_token(auth_user.token_id, auth_user.user_id)
        return {"ok": True}

    @router.get("/auth/me", response_model=UserOut)
    def auth_me(request: Request) -> dict:
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

    @router.post("/admin/invites/register", response_model=InviteCreateOut)
    def admin_create_registration_invite(payload: InviteCreateIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        auth_user = request.state.auth_user
        try:
            return issue_registration_invite(
                actor_user_id=auth_user.user_id,
                device_id=payload.device_id,
                label=payload.label,
                expires_hours=payload.expires_hours,
            )
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/admin/invites/register/bulk", response_model=InviteBulkCreateOut)
    def admin_create_registration_invites_bulk(payload: InviteBulkCreateIn, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        auth_user = request.state.auth_user
        try:
            return issue_registration_invites_bulk(
                actor_user_id=auth_user.user_id,
                device_ids=payload.device_ids,
                label_prefix=payload.label_prefix,
                expires_hours=payload.expires_hours,
            )
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/admin/invites/register", response_model=list[InviteListItemOut])
    def admin_list_registration_invites(request: Request, limit: int = 200) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        return list_registration_invites(limit=limit)

    return router