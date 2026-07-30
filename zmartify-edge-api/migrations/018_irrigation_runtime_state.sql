CREATE TABLE IF NOT EXISTS irrigation_runtime_state (
    device_id INTEGER PRIMARY KEY,
    active_program_name TEXT,
    active_zone_id INTEGER,
    active_zone_name TEXT,
    remaining_seconds INTEGER,
    next_run_at TEXT,
    rain_delay_active INTEGER,
    blocked_reason TEXT,
    source_timestamp TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);
