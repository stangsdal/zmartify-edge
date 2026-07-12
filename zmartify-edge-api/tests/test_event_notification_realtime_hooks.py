from __future__ import annotations

from pathlib import Path

from app import db
from app.auth import ensure_bootstrap_owner
from app.db import initialize_database
from app.domain_model import (
    list_notifications_for_user,
    log_event,
    mark_all_notifications_read,
    mark_notification_read,
    set_realtime_emit_hooks,
)


def _setup_db(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "event-notification-hooks.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")
    initialize_database()
    ensure_bootstrap_owner()


def _seed_users() -> tuple[int, int]:
    with db.get_connection() as conn:
        first_id = conn.execute(
            """
            INSERT INTO users(uuid, username, email, display_name, password_hash, enabled)
            VALUES ('user-hook-admin', 'hook-admin', 'hook-admin@example.com', 'Hook Admin', 'hash', 1)
            """
        ).lastrowid
        second_id = conn.execute(
            """
            INSERT INTO users(uuid, username, email, display_name, password_hash, enabled)
            VALUES ('user-hook-viewer', 'hook-viewer', 'hook-viewer@example.com', 'Hook Viewer', 'hash', 1)
            """
        ).lastrowid
        conn.commit()
    return int(first_id), int(second_id)


def test_log_event_emits_event_and_notifications(monkeypatch, tmp_path: Path):
    _setup_db(monkeypatch, tmp_path)
    expected_user_ids = set(_seed_users())
    with db.get_connection() as conn:
        enabled_user_rows = conn.execute("SELECT id FROM users WHERE enabled = 1").fetchall()
    enabled_user_ids = {int(row["id"]) for row in enabled_user_rows}

    captured_events: list[dict] = []
    captured_notifications: list[dict] = []

    def _event_hook(event: dict) -> None:
        captured_events.append(event)

    def _notification_hook(notification: dict) -> None:
        captured_notifications.append(notification)

    set_realtime_emit_hooks(event_hook=_event_hook, notification_hook=_notification_hook)
    try:
        event = log_event(
            "zone_setpoint_changed",
            payload={"zone_id": 2, "status": "ok"},
        )
    finally:
        set_realtime_emit_hooks(event_hook=None, notification_hook=None)

    assert event["event_type"] == "zone_setpoint_changed"

    assert len(captured_events) == 1
    emitted_event = captured_events[0]
    assert emitted_event["event_type"] == "zone_setpoint_changed"
    assert emitted_event["site_id"] is None
    assert emitted_event["payload"]["status"] == "ok"

    assert len(captured_notifications) == len(enabled_user_ids)
    emitted_user_ids = {item["user_id"] for item in captured_notifications}
    assert emitted_user_ids == enabled_user_ids
    assert expected_user_ids.issubset(emitted_user_ids)
    for emitted_notification in captured_notifications:
        assert emitted_notification["event"]["event_type"] == "zone_setpoint_changed"
        assert emitted_notification["read"] is False


def test_notification_read_and_read_all_emit_state_events(monkeypatch, tmp_path: Path):
    _setup_db(monkeypatch, tmp_path)
    seeded_user_ids = _seed_users()

    state_events: list[dict] = []

    def _state_hook(payload: dict) -> None:
        state_events.append(payload)

    set_realtime_emit_hooks(notification_state_hook=_state_hook)
    try:
        log_event("zone_setpoint_changed", payload={"zone_id": 1})
        log_event("zone_setpoint_changed", payload={"zone_id": 2})
        first_user = seeded_user_ids[0]
        notifications = list_notifications_for_user(first_user, limit=20)
        assert len(notifications) >= 1
        target_notification_id = notifications[0]["notification_id"]

        updated = mark_notification_read(target_notification_id, user_id=first_user, read=True)
        assert updated["read"] is True

        updated_count = mark_all_notifications_read(user_id=first_user)
        assert updated_count >= 0
    finally:
        set_realtime_emit_hooks(notification_state_hook=None)

    assert any(item.get("event_type") == "notification.read" for item in state_events)
    assert any(item.get("event_type") == "notification.read_all" for item in state_events)
