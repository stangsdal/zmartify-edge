from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "api-v2-realtime-ws.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("ZMART_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")

    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner

    initialize_database()
    ensure_bootstrap_owner()

    from main import app

    return TestClient(app)


def test_api_v2_realtime_ws_subscribe_flow(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    with client.websocket_connect("/api/v2/ws?token=emergency-token") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        assert ready["protocol"] == "v2"

        ws.send_text(json.dumps({"type": "subscribe", "topics": ["device:abc:state", "site:xyz:overview"]}))
        subscribed = ws.receive_json()
        assert subscribed["type"] == "subscribed"
        assert "device:abc:state" in subscribed["topics"]
        assert "site:xyz:overview" in subscribed["topics"]

        ws.send_text("ping")
        pong = ws.receive_json()
        assert pong["type"] == "pong"


