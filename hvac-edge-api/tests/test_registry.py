from app.db import get_connection, initialize_database
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    assign_device_site,
    create_device,
    create_domain,
    create_site,
    delete_device,
    delete_domain,
    delete_site,
    get_device,
    get_domain,
    get_site,
    list_devices,
    list_domains,
    list_sites,
    rename_device,
)


def _set_db(monkeypatch, tmp_path):
    db_path = tmp_path / "registry.sqlite"
    monkeypatch.setenv("HVAC_EDGE_DB_PATH", str(db_path))
    initialize_database()
    return db_path


def test_schema_tables_exist(monkeypatch, tmp_path):
    db_path = _set_db(monkeypatch, tmp_path)
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('domains','sites','devices')"
        ).fetchall()
    assert len(rows) == 3


def test_domain_site_device_crud(monkeypatch, tmp_path):
    _set_db(monkeypatch, tmp_path)

    domain = create_domain("house", "Main House")
    assert domain["slug"] == "house"

    assert len(list_domains()) == 1
    assert get_domain(domain["id"])["name"] == "Main House"

    site = create_site(domain["id"], "ground-floor", "Ground Floor")
    assert site["domain_id"] == domain["id"]
    assert len(list_sites(domain["id"])) == 1
    assert get_site(site["id"])["slug"] == "ground-floor"

    device = create_device(
        device_id="hvac-gateway-7a254c",
        display_name="AHC9000 Gateway",
        mac="AA:BB:CC:DD:EE:FF",
        firmware_version="0.4.0",
    )
    assert device["site_id"] is None

    assigned = assign_device_site("hvac-gateway-7a254c", site["id"])
    assert assigned["site_id"] == site["id"]

    renamed = rename_device("hvac-gateway-7a254c", "Gateway Renamed")
    assert renamed["display_name"] == "Gateway Renamed"

    assert len(list_devices()) == 1
    assert get_device("hvac-gateway-7a254c")["display_name"] == "Gateway Renamed"

    delete_device("hvac-gateway-7a254c")
    assert len(list_devices()) == 0

    delete_site(site["id"])
    assert len(list_sites(domain["id"])) == 0

    delete_domain(domain["id"])
    assert len(list_domains()) == 0


def test_conflicts_and_not_found(monkeypatch, tmp_path):
    _set_db(monkeypatch, tmp_path)

    domain = create_domain("house", "Main House")

    try:
        create_domain("house", "Duplicate")
        assert False, "expected conflict"
    except RegistryConflictError:
        pass

    site = create_site(domain["id"], "main-house", "Main House")
    try:
        create_site(domain["id"], "main-house", "Duplicate Site")
        assert False, "expected conflict"
    except RegistryConflictError:
        pass

    try:
        get_domain(999999)
        assert False, "expected not found"
    except RegistryNotFoundError:
        pass

    create_device(
        device_id="hvac-gateway-aabbcc",
        display_name="Device 1",
        mac=None,
        firmware_version=None,
    )
    try:
        assign_device_site("hvac-gateway-aabbcc", 999999)
        assert False, "expected site not found"
    except RegistryNotFoundError:
        pass

    try:
        assign_device_site("missing-device", site["id"])
        assert False, "expected device not found"
    except RegistryNotFoundError:
        pass
