from __future__ import annotations

from datetime import UTC, datetime

from app.db import get_connection, initialize_database
from app.domain_model import upsert_hvac_controller_state, upsert_zone_state
from app.registry import create_device, create_domain, create_site
from app.weather_telemetry import WeatherTelemetryCollector, get_site_weather


def _setup(monkeypatch, tmp_path):
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(tmp_path / "weather.sqlite"))
    initialize_database()
    domain = create_domain("house", "House")
    site = create_site(domain["id"], "home", "Home", "Main Street", 55.67, 12.56)
    device = create_device(
        device_id="zmartify-hvac-ahc9000-test",
        display_name="AHC9000",
        mac=None,
        firmware_version="1.0",
    )
    with get_connection() as conn:
        conn.execute("UPDATE devices SET site_id = ? WHERE id = ?", (site["id"], device["id"]))
    upsert_zone_state(
        device["device_id"],
        1,
        current_temperature=20.5,
        target_temperature=21.0,
        demand=True,
        active=True,
        zone_mode=2,
        battery_percent=88,
        source_timestamp="2026-09-26T12:00:00+00:00",
    )
    upsert_hvac_controller_state(
        device["device_id"],
        {"inlet_temperature_c": 31.5, "total_current_ma": 420},
        source_timestamp="2026-09-26T12:00:00+00:00",
    )
    return site, device


def test_collects_weather_and_upserts_forecast(monkeypatch, tmp_path):
    site, _device = _setup(monkeypatch, tmp_path)
    payload = {
        "current": {"time": "2026-09-26T12:00", "temperature_2m": 12.5, "relative_humidity_2m": 77},
        "hourly": {
            "time": ["2026-09-26T13:00", "2026-09-26T14:00"],
            "temperature_2m": [13.0, 13.5],
            "shortwave_radiation": [120.0, 90.0],
        },
    }
    collector = WeatherTelemetryCollector(
        weather_fetcher=lambda latitude, longitude: payload,
        now_fn=lambda: datetime(2026, 9, 26, 12, 5, tzinfo=UTC),
    )

    assert collector.collect_weather_once() == 3
    payload["hourly"]["temperature_2m"][0] = 13.2
    assert collector.collect_weather_once() == 3

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT kind, weather_at, temperature_c FROM site_weather WHERE site_id = ? ORDER BY weather_at",
            (site["id"],),
        ).fetchall()
    assert len(rows) == 3
    assert rows[1]["temperature_c"] == 13.2

    weather = get_site_weather(site["uuid"])
    assert weather["current"]["temperature_c"] == 12.5
    assert weather["latitude"] == 55.67


def test_samples_ahc9000_state_once_per_interval(monkeypatch, tmp_path):
    _site, _device = _setup(monkeypatch, tmp_path)
    collector = WeatherTelemetryCollector(now_fn=lambda: datetime(2026, 9, 26, 12, 7, tzinfo=UTC))

    assert collector.sample_hvac_once() == 1
    assert collector.sample_hvac_once() == 1

    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM hvac_telemetry_samples").fetchall()
    assert len(rows) == 1
    assert rows[0]["sampled_at"] == "2026-09-26T12:05:00+00:00"
    assert rows[0]["current_temperature_c"] == 20.5
    assert rows[0]["target_temperature_c"] == 21.0
    assert rows[0]["demand"] == 1
    assert rows[0]["inlet_temperature_c"] == 31.5