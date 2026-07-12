from __future__ import annotations

import json
from typing import Protocol

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


class RealtimeHubProtocol(Protocol):
    async def subscribe_many(self, websocket: WebSocket, topics: list[str]) -> list[str]: ...

    async def unsubscribe_all(self, websocket: WebSocket) -> None: ...


def create_realtime_ws_v2_router(realtime_hub: RealtimeHubProtocol) -> APIRouter:
    router = APIRouter(tags=["api-v2-realtime-ws"])

    @router.websocket("/api/v2/ws")
    async def v2_realtime_ws(websocket: WebSocket) -> None:
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

        await websocket.accept()
        await websocket.send_json({"type": "ready", "protocol": "v2"})

        try:
            while True:
                raw = await websocket.receive_text()
                message = raw.strip()
                if not message:
                    continue
                if message.lower() == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue

                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    await websocket.send_json({"type": "error", "code": "invalid_json"})
                    continue

                msg_type = str(payload.get("type") or "").strip().lower()
                if msg_type != "subscribe":
                    await websocket.send_json({"type": "error", "code": "unsupported_message"})
                    continue

                topics_raw = payload.get("topics") or []
                if not isinstance(topics_raw, list):
                    await websocket.send_json({"type": "error", "code": "invalid_topics"})
                    continue

                normalized = [str(topic).strip() for topic in topics_raw if str(topic).strip()]
                subscribed_topics = await realtime_hub.subscribe_many(websocket, normalized)
                await websocket.send_json({"type": "subscribed", "topics": subscribed_topics})
        except WebSocketDisconnect:
            pass
        finally:
            await realtime_hub.unsubscribe_all(websocket)

    return router
