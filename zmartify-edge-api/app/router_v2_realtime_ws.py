from __future__ import annotations

import json
from typing import Protocol

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.auth import (
    AuthError,
    AuthenticatedUser,
    authenticate_bearer_token,
    authenticate_emergency_token,
)
from app.db import get_connection
from app.permissions import is_global_administrator, require_site_permission


class RealtimeHubProtocol(Protocol):
    async def subscribe_many(self, websocket: WebSocket, topics: list[str]) -> list[str]: ...

    async def unsubscribe_all(self, websocket: WebSocket) -> None: ...


def _filter_topics_for_user(auth_user: AuthenticatedUser, topics: list[str]) -> list[str]:
    normalized = sorted({topic.strip() for topic in topics if topic and topic.strip()})
    if not normalized:
        return []

    if is_global_administrator(auth_user):
        return normalized

    allowed: list[str] = []
    for topic in normalized:
        if topic.startswith("user:") and topic.endswith(":notifications"):
            parts = topic.split(":")
            if len(parts) == 3 and auth_user.user_id is not None and parts[1].isdigit() and int(parts[1]) == auth_user.user_id:
                allowed.append(topic)
            continue

        if topic.startswith("site:") and topic.endswith(":events"):
            parts = topic.split(":")
            if len(parts) == 3:
                with get_connection() as conn:
                    row = conn.execute("SELECT id FROM sites WHERE CAST(id AS TEXT) = ? OR uuid = ?", (parts[1], parts[1])).fetchone()
                if row is not None:
                    try:
                        require_site_permission(auth_user, int(row["id"]), product_type=None, permission="read")
                        allowed.append(topic)
                    except AuthError:
                        pass
            continue

        if topic.startswith("device:"):
            parts = topic.split(":")
            if len(parts) >= 3:
                with get_connection() as conn:
                    row = conn.execute("SELECT site_id, product_type FROM devices WHERE device_id = ?", (parts[1],)).fetchone()
                if row is not None and row["site_id"] and row["product_type"]:
                    try:
                        require_site_permission(auth_user, int(row["site_id"]), product_type=str(row["product_type"]), permission="read")
                        allowed.append(topic)
                    except AuthError:
                        pass
            continue

        if topic.startswith("zone:"):
            parts = topic.split(":")
            if len(parts) >= 3:
                with get_connection() as conn:
                    row = conn.execute(
                        """
                        SELECT d.site_id, d.product_type
                        FROM zone_metadata zm
                        JOIN devices d ON d.id = zm.device_id
                        WHERE zm.uuid = ?
                        """,
                        (parts[1],),
                    ).fetchone()
                if row is not None and row["site_id"] and row["product_type"]:
                    try:
                        require_site_permission(auth_user, int(row["site_id"]), product_type=str(row["product_type"]), permission="read")
                        allowed.append(topic)
                    except AuthError:
                        pass

    return sorted(set(allowed))


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
                scoped_topics = _filter_topics_for_user(auth_user, normalized)
                subscribed_topics = await realtime_hub.subscribe_many(websocket, scoped_topics)
                await websocket.send_json({"type": "subscribed", "topics": subscribed_topics})
        except WebSocketDisconnect:
            pass
        finally:
            await realtime_hub.unsubscribe_all(websocket)

    return router
