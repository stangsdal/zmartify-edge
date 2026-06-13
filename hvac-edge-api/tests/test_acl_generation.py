from app.db import get_connection, initialize_database
from app.mqtt_acl import generate_acl_file
from app.registry import (
    assign_device_site,
    create_device,
    create_domain,
    create_mqtt_client,
    create_site,
)


def _set_db(monkeypatch, tmp_path):
    db_path = tmp_path / "acl.sqlite"
    acl_path = tmp_path / "acl"
    monkeypatch.setenv("HVAC_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("HVAC_EDGE_MQTT_ACL_FILE", str(acl_path))
    # Avoid writing broker-side files in tests; generation still returns content and logs in DB.
    monkeypatch.setenv("HVAC_EDGE_DRY_RUN_ACL_WRITE", "1")
    monkeypatch.setenv("HVAC_EDGE_APPLY_MQTT_COMMANDS", "0")
    initialize_database()
    return db_path


def test_acl_generation_contains_expected_topics(monkeypatch, tmp_path):
    db_path = _set_db(monkeypatch, tmp_path)

    domain = create_domain("house", "Main House")
    site = create_site(domain["id"], "ground-floor", "Ground Floor")

    create_device(
        device_id="hvac-gateway-7a254c",
        display_name="Gateway",
        mac=None,
        firmware_version="0.4.0",
    )
    assign_device_site("hvac-gateway-7a254c", site["id"])

    # Add a domain-scoped Home Assistant client.
    create_mqtt_client(
        client_type="homeassistant",
        domain_id=domain["id"],
        site_id=site["id"],
        device_pk_id=None,
        username="homeassistant_house",
    )

    with get_connection(db_path) as conn:
        acl_content = generate_acl_file(conn)

    assert "user device_hvac-gateway-7a254c" in acl_content
    assert "topic readwrite homie/5/hvac-gateway-7a254c/#" in acl_content
    assert "user homeassistant_house" in acl_content
    assert "topic read homie/5/hvac-gateway-7a254c/#" in acl_content
    assert "topic write homie/5/hvac-gateway-7a254c/zone-+/target-temperature/set" in acl_content


def test_acl_generation_log_written(monkeypatch, tmp_path):
    db_path = _set_db(monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        generate_acl_file(conn)
        row = conn.execute(
            "SELECT success, message FROM acl_generation_log ORDER BY id DESC LIMIT 1"
        ).fetchone()

    assert row is not None
    assert row["success"] == 1
    assert "generated acl" in row["message"]
