from app.db import initialize_database
from app.registry import (
    create_device,
    create_domain,
    create_mqtt_client,
    create_site,
    get_mqtt_client,
    list_mqtt_clients,
    rotate_mqtt_client_password,
    set_mqtt_client_enabled,
)


def _set_db(monkeypatch, tmp_path):
    db_path = tmp_path / "mqtt_clients.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")
    initialize_database()


def test_create_domain_scoped_homeassistant_client(monkeypatch, tmp_path):
    _set_db(monkeypatch, tmp_path)

    domain = create_domain("house", "Main House")
    created = create_mqtt_client(
        client_type="homeassistant",
        domain_id=domain["id"],
        site_id=None,
        device_pk_id=None,
        username=None,
    )

    assert created["username"].startswith("homeassistant_domain_")
    assert isinstance(created["password"], str)
    assert len(created["password"]) >= 20


def test_auto_device_client_is_created_on_device_registration(monkeypatch, tmp_path):
    _set_db(monkeypatch, tmp_path)

    create_device(
        device_id="hvac-gateway-7a254c",
        display_name="Gateway",
        mac=None,
        firmware_version="0.4.0",
    )

    clients = list_mqtt_clients()
    assert len(clients) == 1
    assert clients[0]["client_type"] == "device"
    assert clients[0]["username"] == "device_hvac-gateway-7a254c"


def test_rotate_disable_enable_client(monkeypatch, tmp_path):
    _set_db(monkeypatch, tmp_path)

    domain = create_domain("house", "Main House")
    site = create_site(domain["id"], "ground-floor", "Ground Floor")

    created = create_mqtt_client(
        client_type="service",
        domain_id=domain["id"],
        site_id=site["id"],
        device_pk_id=None,
        username="service_house",
    )

    rotated = rotate_mqtt_client_password(created["id"])
    assert rotated["mqtt_client_id"] == created["id"]
    assert rotated["username"] == "service_house"
    assert rotated["password_one_time"] is True

    disabled = set_mqtt_client_enabled(created["id"], enabled=False)
    assert disabled["enabled"] == 0

    enabled = set_mqtt_client_enabled(created["id"], enabled=True)
    assert enabled["enabled"] == 1

    fetched = get_mqtt_client(created["id"])
    assert fetched["username"] == "service_house"
