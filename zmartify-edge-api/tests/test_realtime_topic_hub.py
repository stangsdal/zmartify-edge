from __future__ import annotations

import asyncio

from app.realtime_topic_hub import RealtimeTopicHub


class _FakeWebSocket:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.messages.append(payload)


def test_realtime_topic_hub_subscribe_and_publish():
    hub = RealtimeTopicHub()
    ws = _FakeWebSocket()

    async def _run() -> None:
        subscribed = await hub.subscribe_many(ws, ["device:a:state"])
        assert subscribed == ["device:a:state"]

        await hub.publish(
            "device:a:state",
            "device.state.updated",
            {"device_id": "a"},
        )

    asyncio.run(_run())

    assert len(ws.messages) == 1
    assert ws.messages[0]["type"] == "event"
    assert ws.messages[0]["topic"] == "device:a:state"
    assert ws.messages[0]["event_type"] == "device.state.updated"
    assert ws.messages[0]["payload"]["device_id"] == "a"
