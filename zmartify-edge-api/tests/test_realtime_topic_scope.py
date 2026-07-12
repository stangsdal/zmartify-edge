from app.auth import AuthenticatedUser, ROLE_INSTALLER, ROLE_OWNER, ROLE_VIEWER
from app.router_v2_realtime_ws import _filter_topics_for_user


def test_realtime_topic_scope_owner_allows_all_topics(monkeypatch):
    user = AuthenticatedUser(user_id=None, username="owner", roles={ROLE_OWNER}, token_id=None)

    topics = [
        "events",
        "site:10:events",
        "user:99:notifications",
        "device:hvac-1:state",
    ]

    filtered = _filter_topics_for_user(user, topics)
    assert set(filtered) == set(topics)


def test_realtime_topic_scope_viewer_limits_site_and_user_topics(monkeypatch):
    monkeypatch.setattr("app.router_v2_realtime_ws.list_user_site_access", lambda user_id: [3, 7])
    user = AuthenticatedUser(user_id=42, username="viewer", roles={ROLE_VIEWER}, token_id=123)

    topics = [
        "events",
        "site:7:events",
        "site:8:events",
        "user:42:notifications",
        "user:99:notifications",
        "device:hvac-1:state",
        "zone:zone-uuid-1:state",
    ]

    filtered = _filter_topics_for_user(user, topics)
    assert "events" not in filtered
    assert "site:7:events" in filtered
    assert "site:8:events" not in filtered
    assert "user:42:notifications" in filtered
    assert "user:99:notifications" not in filtered
    assert "device:hvac-1:state" in filtered
    assert "zone:zone-uuid-1:state" in filtered


def test_realtime_topic_scope_installer_without_sites_has_no_site_event_topics(monkeypatch):
    monkeypatch.setattr("app.router_v2_realtime_ws.list_user_site_access", lambda user_id: [])
    user = AuthenticatedUser(user_id=12, username="installer", roles={ROLE_INSTALLER}, token_id=44)

    topics = ["site:1:events", "user:12:notifications"]
    filtered = _filter_topics_for_user(user, topics)

    assert "site:1:events" not in filtered
    assert "user:12:notifications" in filtered
