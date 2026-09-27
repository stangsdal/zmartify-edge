CREATE TABLE IF NOT EXISTS site_weather (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    site_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    weather_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    temperature_c REAL,
    apparent_temperature_c REAL,
    relative_humidity_percent REAL,
    precipitation_mm REAL,
    cloud_cover_percent REAL,
    surface_pressure_hpa REAL,
    wind_speed_kmh REAL,
    wind_direction_degrees REAL,
    shortwave_radiation_wm2 REAL,
    weather_code INTEGER,
    provider TEXT NOT NULL,
    UNIQUE(site_id, kind, weather_at),
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_weather_site_kind_time
ON site_weather(site_id, kind, weather_at);

CREATE TABLE IF NOT EXISTS hvac_telemetry_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    site_id INTEGER NOT NULL,
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    sampled_at TEXT NOT NULL,
    source_timestamp TEXT,
    current_temperature_c REAL,
    target_temperature_c REAL,
    floor_temperature_c REAL,
    demand INTEGER,
    active INTEGER,
    zone_mode INTEGER,
    battery_percent INTEGER,
    rssi_element_dbm REAL,
    rssi_control_unit_dbm REAL,
    inlet_temperature_c REAL,
    dhw_temperature_c REAL,
    total_current_ma REAL,
    UNIQUE(device_id, zone_id, sampled_at),
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hvac_telemetry_site_time
ON hvac_telemetry_samples(site_id, sampled_at);

CREATE INDEX IF NOT EXISTS idx_hvac_telemetry_device_zone_time
ON hvac_telemetry_samples(device_id, zone_id, sampled_at);