from __future__ import annotations

from pathlib import Path


def _setup_db(monkeypatch, tmp_path: Path):
    db_path = tmp_path / "registry-dual-write.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("ZMART_EDGE_DRY_RUN_ACL_WRITE", "1")

    from app.db import initialize_database

    initialize_database()
    return db_path


def test_registry_dual_write_when_core_v2_tables_exist(monkeypatch, tmp_path: Path):
    _setup_db(monkeypatch, tmp_path)

    from app.db import get_connection
    from app.registry import assign_device_site, create_device, create_domain, create_site

    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS core_domains_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS core_sites_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                domain_id INTEGER NOT NULL,
                slug TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(domain_id, slug)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS core_devices_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                device_ref TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                site_id INTEGER,
                product_type TEXT NOT NULL,
                product_model TEXT,
                firmware_version TEXT,
                integration_mode TEXT NOT NULL,
                identity_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TEXT
            )
            """
        )

    domain = create_domain("house-v2", "House V2")
    site = create_site(int(domain["id"]), "main-v2", "Main V2")
    create_device(
        device_id="hvac-gateway-dw01",
        display_name="Gateway DW",
        mac="AA:BB:CC:DD:EE:FF",
        firmware_version="1.0.0",
    )
    assign_device_site("hvac-gateway-dw01", int(site["id"]))

    with get_connection() as conn:
        domain_row = conn.execute(
            "SELECT slug, name FROM core_domains_v2 WHERE slug = ?",
            ("house-v2",),
        ).fetchone()
        assert domain_row is not None
        assert domain_row["name"] == "House V2"

        site_row = conn.execute(
            "SELECT slug, name FROM core_sites_v2 WHERE slug = ?",
            ("main-v2",),
        ).fetchone()
        assert site_row is not None

        device_row = conn.execute(
            "SELECT device_ref, display_name, firmware_version FROM core_devices_v2 WHERE device_ref = ?",
            ("hvac-gateway-dw01",),
        ).fetchone()
        assert device_row is not None
        assert device_row["display_name"] == "Gateway DW"
        assert device_row["firmware_version"] == "1.0.0"
