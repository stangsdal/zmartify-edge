from __future__ import annotations

import asyncio
from fastapi import WebSocket


class RealtimeTopicHub:
    def __init__(self) -> None:
        self._subscriptions: dict[str, set[WebSocket]] = {}
        self._websocket_topics: dict[WebSocket, set[str]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def subscribe_many(self, websocket: WebSocket, topics: list[str]) -> list[str]:
        normalized = sorted({topic.strip() for topic in topics if topic and topic.strip()})
        if not normalized:
            return []
        ws_topics = self._websocket_topics.setdefault(websocket, set())
        for topic in normalized:
            self._subscriptions.setdefault(topic, set()).add(websocket)
            ws_topics.add(topic)
        return sorted(ws_topics)

    async def unsubscribe_all(self, websocket: WebSocket) -> None:
        topics = self._websocket_topics.pop(websocket, set())
        for topic in topics:
            listeners = self._subscriptions.get(topic)
            if not listeners:
                continue
            listeners.discard(websocket)
            if not listeners:
                self._subscriptions.pop(topic, None)

    async def publish(self, topic: str, event_type: str, payload: dict) -> None:
        listeners = list(self._subscriptions.get(topic, set()))
        if not listeners:
            return
        message = {
            "type": "event",
            "topic": topic,
            "event_type": event_type,
            "payload": payload,
        }
        stale: list[WebSocket] = []
        for websocket in listeners:
            try:
                await websocket.send_json(message)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.unsubscribe_all(websocket)

    def publish_from_sync(self, topic: str, event_type: str, payload: dict) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.publish(topic, event_type, payload), self._loop)
