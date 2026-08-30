CREATE TABLE IF NOT EXISTS nilan_hvac_state (
    device_id INTEGER PRIMARY KEY,
    source_timestamp TEXT,
    online INTEGER,
    controller_online INTEGER,
    freshness_age_ms INTEGER,
    run INTEGER,
    ventilation_level INTEGER,
    actual_inlet_level INTEGER,
    actual_exhaust_level INTEGER,
    room_temperature_c REAL,
    inlet_temperature_c REAL,
    outlet_temperature_c REAL,
    extract_temperature_c REAL,
    humidity_pct REAL,
    co2_ppm INTEGER,
    filter_days_remaining INTEGER,
    status TEXT,
    poll_requests INTEGER NOT NULL DEFAULT 0,
    poll_responses INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nilan_hvac_state_updated_at ON nilan_hvac_state(updated_at);
