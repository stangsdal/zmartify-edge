CREATE TABLE IF NOT EXISTS irrigation_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    local_ref TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 0,
    fault TEXT,
    is_master_valve INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
    UNIQUE(device_id, local_ref)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_outputs_device_id ON irrigation_outputs(device_id);

CREATE TABLE IF NOT EXISTS irrigation_hydraulics_state (
    device_id INTEGER PRIMARY KEY,
    flow_lpm REAL,
    pressure_bar REAL,
    water_liters REAL,
    source_timestamp TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS irrigation_power_state (
    device_id INTEGER PRIMARY KEY,
    voltage_rms_v REAL,
    current_rms_a REAL,
    real_power_w REAL,
    power_factor REAL,
    source_timestamp TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS irrigation_weather_state (
    device_id INTEGER PRIMARY KEY,
    temperature_c REAL,
    rain_mm REAL,
    wind_mps REAL,
    eto_mm REAL,
    source_timestamp TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS irrigation_rain_delay (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    active_until TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_irrigation_rain_delay_device_id ON irrigation_rain_delay(device_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_rain_delay_active_until ON irrigation_rain_delay(active_until);
