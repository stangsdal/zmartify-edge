from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from app.db import get_connection


def _client(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "domain_model.sqlite"
    monkeypatch.setenv("HVAC_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("HVAC_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("HVAC_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("HVAC_EDGE_ENABLE_EMERGENCY_TOKEN", "1")
    monkeypatch.setenv("ADMIN_API_TOKEN", "emergency-token")

    from app.db import initialize_database
    from app.auth import ensure_bootstrap_owner

    initialize_database()
    ensure_bootstrap_owner()

    from main import app

    return TestClient(app)


def _seed_domain_site_device(client: TestClient, headers: dict[str, str], device_id: str) -> str:
    domain = client.post("/domains", headers=headers, json={"slug": f"domain-{device_id[-4:]}", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": f"site-{device_id[-4:]}", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    create = client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": device_id,
            "display_name": "Gateway",
            "mac": "AA:BB:CC:DD:EE:FF",
            "firmware_version": "0.1.2",
        },
    )
    assert create.status_code == 201

    assign = client.post(f"/devices/{device_id}/assign-site", headers=headers, json={"site_id": site_id})
    assert assign.status_code == 200
    return device_id


def test_zone_metadata_and_mobile_shape(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    assert domain.status_code == 201
    domain_id = domain.json()["id"]

    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    assert site.status_code == 201
    site_id = site.json()["id"]

    device = client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": "hvac-gateway-aabbcc",
            "display_name": "Gateway",
            "mac": "AA:BB:CC:DD:EE:FF",
            "firmware_version": "0.1.2",
        },
    )
    assert device.status_code == 201

    assign = client.post("/devices/hvac-gateway-aabbcc/assign-site", headers=headers, json={"site_id": site_id})
    assert assign.status_code == 200

    zones = client.get("/devices/hvac-gateway-aabbcc/zones", headers=headers)
    assert zones.status_code == 200
    assert len(zones.json()) >= 3

    rename = client.post(
        "/devices/hvac-gateway-aabbcc/zones/1/rename",
        headers=headers,
        json={"name": "Living Room"},
    )
    assert rename.status_code == 200
    assert rename.json()["name"] == "Living Room"

    meta = client.post(
        "/devices/hvac-gateway-aabbcc/zones/1/metadata",
        headers=headers,
        json={"icon": "sofa", "floor": "Ground Floor", "area_m2": 28.5},
    )
    assert meta.status_code == 200
    assert meta.json()["icon"] == "sofa"

    mobile_device = client.get("/mobile/devices/hvac-gateway-aabbcc", headers=headers)
    assert mobile_device.status_code == 200
    assert mobile_device.json()["zones"][0]["name"] == "Living Room"


def test_mobile_setpoint_updates_twin_and_events(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    domain = client.post("/domains", headers=headers, json={"slug": "house", "name": "House"})
    domain_id = domain.json()["id"]
    site = client.post(f"/domains/{domain_id}/sites", headers=headers, json={"slug": "main", "name": "Main"})
    site_id = site.json()["id"]

    client.post(
        "/devices",
        headers=headers,
        json={
            "device_id": "hvac-gateway-ddaacc",
            "display_name": "Gateway 2",
            "mac": "DD:AA:CC:00:11:22",
            "firmware_version": "0.1.2",
        },
    )
    client.post("/devices/hvac-gateway-ddaacc/assign-site", headers=headers, json={"site_id": site_id})

    zones = client.get("/devices/hvac-gateway-ddaacc/zones", headers=headers).json()
    zone_ref = zones[0]["zone_uuid"]

    setpoint = client.post(
        f"/mobile/zones/{zone_ref}/setpoint",
        headers=headers,
        json={"target_temperature_c": 22.5},
    )
    assert setpoint.status_code == 200
    assert setpoint.json()["zone"]["target_temperature_c"] == 22.5

    events = client.get("/events/recent", headers=headers)
    assert events.status_code == 200
    assert any(evt["event_type"] == "zone_setpoint_changed" for evt in events.json())

    notifs = client.get("/mobile/notifications", headers=headers)
    assert notifs.status_code == 200
    assert isinstance(notifs.json(), list)


def test_events_filtering_by_type_and_device(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-ffeedd")
    zone_ref = client.get(f"/devices/{device_id}/zones", headers=headers).json()[0]["zone_uuid"]

    # Generate two setpoint-change events plus one metadata event.
    sp1 = client.post(f"/mobile/zones/{zone_ref}/setpoint", headers=headers, json={"target_temperature_c": 20.0})
    assert sp1.status_code == 200
    sp2 = client.post(f"/mobile/zones/{zone_ref}/setpoint", headers=headers, json={"target_temperature_c": 21.0})
    assert sp2.status_code == 200
    rename = client.post(f"/devices/{device_id}/zones/1/rename", headers=headers, json={"name": "Hall"})
    assert rename.status_code == 200

    filtered = client.get("/events/recent", headers=headers, params={"event_type": "zone_setpoint_changed"})
    assert filtered.status_code == 200
    assert len(filtered.json()) >= 2
    assert all(evt["event_type"] == "zone_setpoint_changed" for evt in filtered.json())

    device_filtered = client.get(
        f"/events/device/{device_id}",
        headers=headers,
        params={"event_type": "zone_setpoint_changed"},
    )
    assert device_filtered.status_code == 200
    assert len(device_filtered.json()) >= 2
    assert all(evt["event_type"] == "zone_setpoint_changed" for evt in device_filtered.json())


def test_notification_read_and_read_all(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    emergency = {"Authorization": "Bearer emergency-token"}

    created_user = client.post(
        "/users",
        headers=emergency,
        json={
            "username": "mobileviewer",
            "display_name": "Mobile Viewer",
            "password": "VeryStrongPass123!",
            "roles": ["viewer"],
        },
    )
    assert created_user.status_code == 201

    login = client.post("/auth/login", json={"username": "mobileviewer", "password": "VeryStrongPass123!"})
    assert login.status_code == 200
    bearer = {"Authorization": f"Bearer {login.json()['access_token']}"}

    device_id = _seed_domain_site_device(client, emergency, "hvac-gateway-112233")
    zone_ref = client.get(f"/devices/{device_id}/zones", headers=emergency).json()[0]["zone_uuid"]

    # Generate notification-eligible event types.
    first = client.post(f"/mobile/zones/{zone_ref}/setpoint", headers=emergency, json={"target_temperature_c": 23.0})
    assert first.status_code == 200
    second = client.post(f"/mobile/zones/{zone_ref}/setpoint", headers=emergency, json={"target_temperature_c": 24.0})
    assert second.status_code == 200

    notifications = client.get("/mobile/notifications", headers=bearer)
    assert notifications.status_code == 200
    assert len(notifications.json()) >= 2

    unread = client.get("/mobile/notifications", headers=bearer, params={"unread_only": True})
    assert unread.status_code == 200
    assert len(unread.json()) >= 2
    first_notification_id = unread.json()[0]["notification_id"]

    mark_one = client.post(f"/mobile/notifications/{first_notification_id}/read", headers=bearer)
    assert mark_one.status_code == 200
    assert mark_one.json()["read"] is True

    unread_after_one = client.get("/mobile/notifications", headers=bearer, params={"unread_only": True})
    assert unread_after_one.status_code == 200
    assert len(unread_after_one.json()) >= 1

    mark_all = client.post("/mobile/notifications/read-all", headers=bearer)
    assert mark_all.status_code == 200
    assert mark_all.json()["updated"] >= 1

    unread_after_all = client.get("/mobile/notifications", headers=bearer, params={"unread_only": True})
    assert unread_after_all.status_code == 200
    assert unread_after_all.json() == []


def test_channel_metadata_state_and_mobile_shape(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-aa3311")

    channels = client.get(f"/devices/{device_id}/channels", headers=headers)
    assert channels.status_code == 200
    assert len(channels.json()) >= 8

    set_meta = client.post(
        f"/devices/{device_id}/channels/1/metadata",
        headers=headers,
        json={"name": "Pump", "icon": "pump", "sort_order": 1},
    )
    assert set_meta.status_code == 200
    assert set_meta.json()["name"] == "Pump"
    assert set_meta.json()["icon"] == "pump"

    set_state = client.post(
        f"/devices/{device_id}/channels/1/state",
        headers=headers,
        json={"active": True, "fault": None},
    )
    assert set_state.status_code == 200
    assert set_state.json()["active"] is True

    mobile_channels = client.get(f"/mobile/devices/{device_id}/channels", headers=headers)
    assert mobile_channels.status_code == 200
    assert len(mobile_channels.json()["channels"]) >= 8
    assert mobile_channels.json()["channels"][0]["name"] == "Pump"

    mobile_device = client.get(f"/mobile/devices/{device_id}", headers=headers)
    assert mobile_device.status_code == 200
    assert "channels" in mobile_device.json()
    assert len(mobile_device.json()["channels"]) >= 8


def test_channel_zone_links_and_twin_ingest(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-445566")

    links = client.post(
        f"/devices/{device_id}/channels/1/link-zones",
        headers=headers,
        json={"zone_ids": [1, 2]},
    )
    assert links.status_code == 200
    assert links.json()["linked_zone_ids"] == [1, 2]

    ingest = client.post(
        f"/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "device_push",
            "online": True,
            "mqtt_connected": True,
            "zones": [
                {"zone_id": 1, "current_temperature_c": 21.2, "target_temperature_c": 22.0, "active": True},
                {"zone_id": 2, "current_temperature_c": 20.1, "target_temperature_c": 21.0, "active": False},
            ],
            "channels": [
                {"channel_id": 1, "active": True},
                {"channel_id": 2, "active": False, "fault": "stuck"},
            ],
        },
    )
    assert ingest.status_code == 200
    body = ingest.json()
    assert body["applied"] is True
    assert body["skip_reason"] is None
    assert body["zone_updates"] == 2
    assert body["channel_updates"] == 2

    zone1 = client.get(f"/devices/{device_id}/zones/1", headers=headers)
    assert zone1.status_code == 200
    assert zone1.json()["current_temperature_c"] == 21.2
    assert zone1.json()["target_temperature_c"] == 22.0

    channel1 = client.get(f"/devices/{device_id}/channels/1", headers=headers)
    assert channel1.status_code == 200
    assert channel1.json()["active"] is True
    assert channel1.json()["linked_zone_ids"] == [1, 2]

    mobile = client.get(f"/mobile/devices/{device_id}", headers=headers)
    assert mobile.status_code == 200
    assert mobile.json()["channels"][0]["linked_zone_ids"] == [1, 2]


def test_ingest_dedup_and_rate_limit(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("HVAC_EDGE_INGEST_MIN_INTERVAL_MS", "999999")
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-123abc")

    first = client.post(
        f"/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "firmware_periodic",
            "online": True,
            "zones": [{"zone_id": 1, "current_temperature_c": 21.0}],
        },
    )
    assert first.status_code == 200
    assert first.json()["applied"] is True
    assert first.json()["skip_reason"] is None

    second = client.post(
        f"/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "firmware_periodic",
            "online": True,
            "zones": [{"zone_id": 1, "current_temperature_c": 21.0}],
        },
    )
    assert second.status_code == 200
    assert second.json()["applied"] is False
    assert second.json()["skip_reason"] == "rate_limited"


def test_mobile_device_freshness_endpoint(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-fresh01")

    ingest = client.post(
        f"/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "firmware_periodic",
            "online": True,
            "mqtt_connected": True,
            "zones": [{"zone_id": 1, "current_temperature_c": 20.4, "target_temperature_c": 21.0}],
            "channels": [{"channel_id": 1, "active": True}],
        },
    )
    assert ingest.status_code == 200

    freshness = client.get(f"/mobile/devices/{device_id}/freshness", headers=headers)
    assert freshness.status_code == 200
    body = freshness.json()
    assert body["device_id"] == device_id
    assert body["device"]["freshness_age_ms"] is not None
    assert any(zone["zone_id"] == 1 and zone["freshness_age_ms"] is not None for zone in body["zones"])
    assert any(channel["channel_id"] == 1 and channel["freshness_age_ms"] is not None for channel in body["channels"])


def test_mobile_api_hides_internal_database_ids(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-bnd001")
    zone_ref = client.get(f"/devices/{device_id}/zones", headers=headers).json()[0]["zone_uuid"]

    setpoint = client.post(
        f"/mobile/zones/{zone_ref}/setpoint",
        headers=headers,
        json={"target_temperature_c": 22.0},
    )
    assert setpoint.status_code == 200

    mobile_device = client.get(f"/mobile/devices/{device_id}", headers=headers)
    assert mobile_device.status_code == 200
    site_id = mobile_device.json()["site"]["site_id"]

    site_devices = client.get(f"/mobile/sites/{site_id}/devices", headers=headers)
    assert site_devices.status_code == 200
    assert isinstance(site_devices.json()["site_id"], str)

    assert isinstance(mobile_device.json()["site"]["site_id"], str)

    mobile_events = client.get("/mobile/events", headers=headers)
    assert mobile_events.status_code == 200
    assert len(mobile_events.json()["events"]) >= 1
    sample = mobile_events.json()["events"][0]
    assert "id" not in sample
    assert "domain_id" not in sample
    assert "site_id" not in sample


def test_history_foundation_tables_populated(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-hist01")
    zones = client.get(f"/devices/{device_id}/zones", headers=headers)
    assert zones.status_code == 200
    zone_ref = zones.json()[0]["zone_uuid"]

    first_ingest = client.post(
        f"/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "firmware_periodic",
            "online": True,
            "mqtt_connected": True,
            "zones": [{"zone_id": 1, "current_temperature_c": 20.5, "target_temperature_c": 21.0, "demand": True}],
        },
    )
    assert first_ingest.status_code == 200

    second_ingest = client.post(
        f"/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "firmware_periodic",
            "online": True,
            "mqtt_connected": True,
            "zones": [{"zone_id": 1, "current_temperature_c": 20.7, "target_temperature_c": 22.0, "demand": False}],
        },
    )
    assert second_ingest.status_code == 200

    setpoint = client.post(
        f"/mobile/zones/{zone_ref}/setpoint",
        headers=headers,
        json={"target_temperature_c": 22.5},
    )
    assert setpoint.status_code == 200

    with get_connection() as conn:
        device_row = conn.execute("SELECT id FROM devices WHERE device_id = ?", (device_id,)).fetchone()
        assert device_row is not None
        device_pk = int(device_row["id"])

        temp_count = conn.execute("SELECT COUNT(*) AS c FROM temperature_history WHERE device_id = ?", (device_pk,)).fetchone()["c"]
        setpoint_count = conn.execute("SELECT COUNT(*) AS c FROM setpoint_history WHERE device_id = ?", (device_pk,)).fetchone()["c"]
        demand_count = conn.execute("SELECT COUNT(*) AS c FROM demand_history WHERE device_id = ?", (device_pk,)).fetchone()["c"]
        health_count = conn.execute("SELECT COUNT(*) AS c FROM device_health_history WHERE device_id = ?", (device_pk,)).fetchone()["c"]

    assert temp_count >= 2
    assert setpoint_count >= 1
    assert demand_count >= 2
    assert health_count >= 1


def test_device_admin_token_can_ingest_for_own_device_only(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    admin_headers = {"Authorization": "Bearer emergency-token"}

    device_a = _seed_domain_site_device(client, admin_headers, "hvac-gateway-a1b2c3")
    device_b = _seed_domain_site_device(client, admin_headers, "hvac-gateway-d4e5f6")

    from app.registry import ensure_device_admin_token

    token = ensure_device_admin_token(device_a)
    device_headers = {"Authorization": f"Bearer {token}"}

    own = client.post(
        f"/devices/{device_a}/ingest/twin",
        headers=device_headers,
        json={"source": "firmware_periodic", "online": True, "zones": [{"zone_id": 1, "current_temperature_c": 22.0}]},
    )
    assert own.status_code == 200

    other = client.post(
        f"/devices/{device_b}/ingest/twin",
        headers=device_headers,
        json={"source": "firmware_periodic", "online": True, "zones": [{"zone_id": 1, "current_temperature_c": 22.0}]},
    )
    assert other.status_code == 403


def test_ingest_allows_high_zone_ids_beyond_default_bootstrap(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    headers = {"Authorization": "Bearer emergency-token"}

    device_id = _seed_domain_site_device(client, headers, "hvac-gateway-778899")

    ingest = client.post(
        f"/devices/{device_id}/ingest/twin",
        headers=headers,
        json={
            "source": "firmware_periodic",
            "online": True,
            "zones": [
                {"zone_id": 1, "current_temperature_c": 21.0},
                {"zone_id": 8, "current_temperature_c": 19.5},
            ],
        },
    )
    assert ingest.status_code == 200
    assert ingest.json()["zone_updates"] == 2

    zone_8 = client.get(f"/devices/{device_id}/zones/8", headers=headers)
    assert zone_8.status_code == 200
    assert zone_8.json()["current_temperature_c"] == 19.5
