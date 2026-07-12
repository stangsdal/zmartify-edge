from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER, ROLE_VIEWER, list_user_site_access
from app.domain_model import (
    list_events,
    list_notifications_for_user,
    mark_all_notifications_read,
    mark_notification_read,
)
from app.db import get_connection
from app.registry import RegistryNotFoundError
from app.schemas import EventOut, NotificationOut


def _resolve_domain_filter_id(domain_ref: str | None) -> int | None:
    if not domain_ref:
        return None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM domains WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?",
            (domain_ref, domain_ref, domain_ref),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="domain not found")
    return int(row["id"])


def _resolve_site_filter_id(site_ref: str | None) -> int | None:
    if not site_ref:
        return None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM sites WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?",
            (site_ref, site_ref, site_ref),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
    return int(row["id"])


def _mobile_event_projection(event: dict) -> dict:
    payload = dict(event.get("payload") or {})
    return {
        "event_id": event.get("uuid"),
        "event_type": event.get("event_type"),
        "created_at": event.get("created_at"),
        "device_id": event.get("device_external_id") or payload.get("device_id"),
        "zone_id": event.get("zone_id"),
        "payload": payload,
    }


def _mobile_site_scope_ids(request: Request) -> set[int] | None:
    auth_user = getattr(request.state, "auth_user", None)
    if auth_user is None or auth_user.user_id is None:
        return None
    if ROLE_ADMIN in auth_user.roles:
        return None
    return set(list_user_site_access(auth_user.user_id))


def create_mobile_events_v2_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-mobile-events"])

    @router.get("/events", response_model=list[EventOut])
    def v2_events_list(
        request: Request,
        limit: int = 100,
        event_type: str | None = None,
        domain_id: int | None = None,
        site_id: int | None = None,
    ) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        return list_events(limit=limit, event_type=event_type, domain_id=domain_id, site_id=site_id)

    @router.get("/events/recent", response_model=list[EventOut])
    def v2_events_recent(
        request: Request,
        limit: int = 50,
        event_type: str | None = None,
        domain_id: int | None = None,
        site_id: int | None = None,
    ) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        return list_events(limit=limit, event_type=event_type, domain_id=domain_id, site_id=site_id)

    @router.get("/events/device/{device_id}", response_model=list[EventOut])
    def v2_events_for_device(
        device_id: str,
        request: Request,
        limit: int = 100,
        event_type: str | None = None,
    ) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return list_events(limit=limit, device_external_id=device_id, event_type=event_type)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/mobile/events")
    def v2_mobile_events(
        request: Request,
        limit: int = 50,
        event_type: str | None = None,
        domain_id: str | None = None,
        site_id: str | None = None,
    ) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        scoped_site_ids = _mobile_site_scope_ids(request)
        resolved_domain_id = _resolve_domain_filter_id(domain_id)
        resolved_site_id = _resolve_site_filter_id(site_id)
        if scoped_site_ids is not None and resolved_site_id is not None and resolved_site_id not in scoped_site_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="site not found")
        events = list_events(
            limit=limit,
            event_type=event_type,
            domain_id=resolved_domain_id,
            site_id=resolved_site_id,
            allowed_site_ids=scoped_site_ids,
        )
        return {"events": [_mobile_event_projection(event) for event in events]}

    @router.get("/mobile/notifications", response_model=list[NotificationOut])
    def v2_mobile_notifications(request: Request, limit: int = 100, unread_only: bool = False) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        if auth_user.user_id is None:
            return []
        notifications = list_notifications_for_user(auth_user.user_id, limit=limit)
        if unread_only:
            return [item for item in notifications if not item["read"]]
        return notifications

    @router.post("/mobile/notifications/read-all")
    def v2_mobile_mark_all_notifications_read(request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None or auth_user.user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        updated_count = mark_all_notifications_read(user_id=auth_user.user_id)
        return {"updated": updated_count}

    @router.post("/mobile/notifications/{notification_id}/read", response_model=NotificationOut)
    def v2_mobile_mark_notification_read(notification_id: str, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        auth_user = getattr(request.state, "auth_user", None)
        if auth_user is None or auth_user.user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            return mark_notification_read(notification_id, user_id=auth_user.user_id, read=True)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router
