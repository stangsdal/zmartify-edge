import uuid
from pathlib import Path

from app.auth import AuthenticatedUser
from app.db import get_connection, initialize_database
from app.router_v2_realtime_ws import _filter_topics_for_user


def _member(monkeypatch, tmp_path: Path) -> AuthenticatedUser:
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(tmp_path / "realtime-scope.sqlite"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    initialize_database()
    with get_connection() as conn:
        domain_id = conn.execute("INSERT INTO domains(uuid, slug, name) VALUES (?, ?, ?)", (str(uuid.uuid4()), "realtime-domain", "Realtime Domain")).lastrowid
        site_id = conn.execute("INSERT INTO sites(uuid, domain_id, slug, name) VALUES (?, ?, ?, ?)", (str(uuid.uuid4()), domain_id, "realtime-site", "Realtime Site")).lastrowid
        user_id = conn.execute(
            "INSERT INTO users(uuid, username, display_name, password_hash, enabled) VALUES (?, ?, ?, ?, 1)",
            (str(uuid.uuid4()), "viewer", "Viewer", "not-used"),
        ).lastrowid
        membership_id = conn.execute(
            "INSERT INTO site_memberships(uuid, user_id, site_id, role) VALUES (?, ?, ?, 'viewer')",
            (str(uuid.uuid4()), user_id, site_id),
        ).lastrowid
        conn.execute("INSERT INTO site_membership_product_access(membership_id, product_type) VALUES (?, 'hvac')", (membership_id,))
        conn.execute(
            "INSERT INTO devices(uuid, device_id, display_name, site_id, device_type, integration_mode, product_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), "hvac-1", "HVAC", site_id, "hvac_gateway", "mqtt", "hvac"),
        )
        conn.commit()
    return AuthenticatedUser(user_id=user_id, username="viewer", roles=set(), token_id=123)


def test_realtime_topic_scope_administrator_allows_all_topics(monkeypatch):
    user = AuthenticatedUser(user_id=None, username="administrator", roles={"administrator"}, token_id=None)

    topics = [
        "events",
        "site:10:events",
        "user:99:notifications",
        "device:hvac-1:state",
    ]

    filtered = _filter_topics_for_user(user, topics)
    assert set(filtered) == set(topics)


def test_realtime_topic_scope_viewer_limits_site_and_device_topics(monkeypatch, tmp_path: Path):
    user = _member(monkeypatch, tmp_path)

    topics = [
        "events",
        "site:1:events",
        "site:2:events",
        f"user:{user.user_id}:notifications",
        "user:99:notifications",
        "device:hvac-1:state",
        "zone:zone-uuid-1:state",
    ]

    filtered = _filter_topics_for_user(user, topics)
    assert "events" not in filtered
    assert "site:1:events" in filtered
    assert "site:2:events" not in filtered
    assert f"user:{user.user_id}:notifications" in filtered
    assert "user:99:notifications" not in filtered
    assert "device:hvac-1:state" in filtered
    assert "zone:zone-uuid-1:state" not in filtered


def test_realtime_topic_scope_user_without_membership_has_no_site_event_topics(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(tmp_path / "realtime-empty.sqlite"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    initialize_database()
    user = AuthenticatedUser(user_id=12, username="unscoped", roles=set(), token_id=44)

    topics = ["site:1:events", "user:12:notifications"]
    filtered = _filter_topics_for_user(user, topics)

    assert "site:1:events" not in filtered
    assert "user:12:notifications" in filtered
