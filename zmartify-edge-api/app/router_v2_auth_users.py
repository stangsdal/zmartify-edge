from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import (
    AuthError,
    get_user,
    list_users,
    login,
    logout_token,
)
from app.email_delivery import EmailDeliveryError, send_site_invitation, send_smtp_test_email
from app.email_settings import EmailSettingsError, get_email_settings, update_email_settings
from app.permissions import access_context, require_global_admin
from app.permissions import require_site_permission
from app.schemas import AuthLoginOut, SiteInvitationAcceptIn, SiteInvitationCreateIn, SiteInvitationOut, SiteInvitationRegisterIn, SiteInvitationValidateOut, SiteMembershipCandidateOut, SiteMembershipCreateIn, SiteMembershipOut, SiteMembershipUpdateIn, SystemEmailSettingsIn, SystemEmailSettingsOut, SystemEmailTestIn, UserOut
from app.site_invitations import accept_site_invitation, create_site_invitation, delete_site_invitation, invitation_url, list_site_invitations, register_and_accept_site_invitation, validate_site_invitation
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

    def require_platform_administration(request: Request) -> None:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_global_admin(auth_user)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @router.get("/admin/system/email-settings", response_model=SystemEmailSettingsOut)
    def v2_get_system_email_settings(request: Request) -> dict:
        require_platform_administration(request)
        return get_email_settings()

    @router.put("/admin/system/email-settings", response_model=SystemEmailSettingsOut)
    def v2_update_system_email_settings(payload: SystemEmailSettingsIn, request: Request) -> dict:
        require_platform_administration(request)
        try:
            return update_email_settings(
                host=payload.host,
                port=payload.port,
                username=payload.username,
                sender=payload.sender,
                password=payload.password,
                actor_user_id=request.state.auth_user.user_id,
            )
        except EmailSettingsError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/admin/system/email-settings/test")
    def v2_test_system_email_settings(payload: SystemEmailTestIn, request: Request) -> dict:
        require_platform_administration(request)
        try:
            send_smtp_test_email(recipient=payload.recipient)
        except EmailDeliveryError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        return {"sent": True}

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

    @router.get("/sites/{site_id}/invitations", response_model=list[SiteInvitationOut])
    def v2_list_site_invitations(site_id: int, request: Request) -> list[dict]:
        require_site_administration(site_id, request)
        return list_site_invitations(site_id)

    @router.post("/sites/{site_id}/invitations", response_model=SiteInvitationOut, status_code=status.HTTP_201_CREATED)
    def v2_create_site_invitation(site_id: int, payload: SiteInvitationCreateIn, request: Request) -> dict:
        require_site_administration(site_id, request)
        try:
            invitation, _token = create_site_invitation(
                site_id=site_id,
                email=payload.email,
                role=payload.role,
                product_types=payload.product_types,
                invited_by_user_id=request.state.auth_user.user_id,
                expires_hours=payload.expires_hours,
            )
            try:
                send_site_invitation(
                    recipient=invitation["email"],
                    site_name=invitation["site_name"],
                    role=invitation["role"],
                    invitation_url=invitation_url(_token),
                )
            except EmailDeliveryError as exc:
                delete_site_invitation(invitation["id"])
                raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
            return invitation
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/site-invitations/accept", response_model=SiteMembershipOut)
    def v2_accept_site_invitation(payload: SiteInvitationAcceptIn, request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None or auth_user.user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            user = get_user(auth_user.user_id)
            return accept_site_invitation(token=payload.token, user_id=auth_user.user_id, user_email=user.get("email"))
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.get("/site-invitations/validate", response_model=SiteInvitationValidateOut)
    def v2_validate_site_invitation(token: str) -> dict:
        return validate_site_invitation(token)

    @router.post("/site-invitations/register", response_model=AuthLoginOut)
    def v2_register_site_invitation(payload: SiteInvitationRegisterIn) -> dict:
        try:
            register_and_accept_site_invitation(
                token=payload.token,
                username=payload.username,
                display_name=payload.display_name,
                password=payload.password,
            )
            token, expires_at, _user_id = login(payload.username, payload.password)
            return {"access_token": token, "expires_at": expires_at}
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/auth/logout")
    def v2_auth_logout(request: Request) -> dict:
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        logout_token(auth_user.token_id, auth_user.user_id)
        return {"ok": True}

    @router.get("/users", response_model=list[UserOut])
    def v2_list_users(request: Request) -> list[dict]:
        require_platform_administration(request)
        return list_users()

    @router.get("/users/{user_id}", response_model=UserOut)
    def v2_get_user(user_id: int, request: Request) -> dict:
        require_platform_administration(request)
        try:
            return get_user(user_id)
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/auth/ping")
    def v2_auth_ping(request: Request) -> Response:
        require_platform_administration(request)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
