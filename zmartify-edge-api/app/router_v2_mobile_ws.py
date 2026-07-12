from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth import (
    AuthError,
    ROLE_ADMIN,
    ROLE_INSTALLER,
    ROLE_OWNER,
    ROLE_VIEWER,
    authenticate_bearer_token,
    authenticate_emergency_token,
    require_any_role,
)
from app.domain_model import DomainModelError, get_device_zone, resolve_zone_ref
from app.registry import RegistryNotFoundError


class ZoneHubProtocol(Protocol):
    async def subscribe(self, zone_ref: str, websocket: WebSocket) -> None: ...

    async def unsubscribe(self, zone_ref: str, websocket: WebSocket) -> None: ...


def create_mobile_ws_v2_router(
    resolve_device_site_pk_id: Callable[[str], int | None],
    mobile_site_scope_ids_for_user: Callable[[Any], set[int] | None],
    zone_stream_hub: ZoneHubProtocol,
) -> APIRouter:
    router = APIRouter(tags=["api-v2-mobile-ws"])

    @router.websocket("/mobile/ws/zones/{zone_ref}")
    @router.websocket("/api/v2/mobile/ws/zones/{zone_ref}")
    async def v2_mobile_zone_stream(websocket: WebSocket, zone_ref: str) -> None:
        token = (websocket.query_params.get("token") or "").strip()
        if not token:
            await websocket.close(code=4401, reason="missing bearer token")
            return

        try:
            auth_user = authenticate_bearer_token(token)
        except AuthError:
            auth_user = authenticate_emergency_token(token)
            if auth_user is None:
                await websocket.close(code=4403, reason="invalid bearer token")
                return

        try:
            require_any_role(auth_user, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        except AuthError:
            await websocket.close(code=4403, reason="insufficient role permissions")
            return

        try:
            device_id, zone_id = resolve_zone_ref(zone_ref)
            site_pk_id = resolve_device_site_pk_id(device_id)
            if site_pk_id is None:
                await websocket.close(code=4404, reason="device not found")
                return
            scoped_site_ids = mobile_site_scope_ids_for_user(auth_user)
            if scoped_site_ids is not None and site_pk_id not in scoped_site_ids:
                await websocket.close(code=4404, reason="site not found")
                return
            zone = get_device_zone(device_id, zone_id)
        except (RegistryNotFoundError, DomainModelError):
            await websocket.close(code=4404, reason="zone not found")
            return

        await zone_stream_hub.subscribe(zone_ref, websocket)
        await websocket.send_json({"type": "zone_update", "zone_ref": zone_ref, "zone": zone})

        try:
            while True:
                message = await websocket.receive_text()
                if message.strip().lower() == "ping":
                    await websocket.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        finally:
            await zone_stream_hub.unsubscribe(zone_ref, websocket)

    return router
