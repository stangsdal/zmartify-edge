"""add weather and thermal history

Revision ID: 20260926_0013
Revises: 20260926_0012
Create Date: 2026-09-26 00:00:00
"""
from __future__ import annotations

from alembic import op


revision = "20260926_0013"
down_revision = "20260926_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS site_weather (
            id BIGSERIAL PRIMARY KEY, uuid TEXT NOT NULL UNIQUE,
            site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, weather_at TEXT NOT NULL, fetched_at TEXT NOT NULL,
            temperature_c DOUBLE PRECISION, apparent_temperature_c DOUBLE PRECISION,
            relative_humidity_percent DOUBLE PRECISION, precipitation_mm DOUBLE PRECISION,
            cloud_cover_percent DOUBLE PRECISION, surface_pressure_hpa DOUBLE PRECISION,
            wind_speed_kmh DOUBLE PRECISION, wind_direction_degrees DOUBLE PRECISION,
            shortwave_radiation_wm2 DOUBLE PRECISION, weather_code INTEGER,
            provider TEXT NOT NULL, UNIQUE(site_id, kind, weather_at)
        );
        CREATE INDEX IF NOT EXISTS idx_site_weather_site_kind_time ON site_weather(site_id, kind, weather_at);
        CREATE TABLE IF NOT EXISTS hvac_telemetry_samples (
            id BIGSERIAL PRIMARY KEY, uuid TEXT NOT NULL UNIQUE,
            site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
            zone_id INTEGER NOT NULL, sampled_at TEXT NOT NULL, source_timestamp TEXT,
            current_temperature_c DOUBLE PRECISION, target_temperature_c DOUBLE PRECISION,
            floor_temperature_c DOUBLE PRECISION, demand INTEGER, active INTEGER,
            zone_mode INTEGER, battery_percent INTEGER, rssi_element_dbm DOUBLE PRECISION,
            rssi_control_unit_dbm DOUBLE PRECISION, inlet_temperature_c DOUBLE PRECISION,
            dhw_temperature_c DOUBLE PRECISION, total_current_ma DOUBLE PRECISION,
            UNIQUE(device_id, zone_id, sampled_at)
        );
        CREATE INDEX IF NOT EXISTS idx_hvac_telemetry_site_time ON hvac_telemetry_samples(site_id, sampled_at);
        CREATE INDEX IF NOT EXISTS idx_hvac_telemetry_device_zone_time ON hvac_telemetry_samples(device_id, zone_id, sampled_at);
    """)


def downgrade() -> None:
    op.drop_table("hvac_telemetry_samples")
    op.drop_table("site_weather")