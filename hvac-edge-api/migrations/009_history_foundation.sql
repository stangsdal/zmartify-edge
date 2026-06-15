CREATE TABLE IF NOT EXISTS setpoint_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    target_temperature REAL,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS demand_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    demand INTEGER,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_health_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    online INTEGER,
    mqtt_connected INTEGER,
    last_error TEXT,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_setpoint_history_zone_created
ON setpoint_history(device_id, zone_id, created_at);

CREATE INDEX IF NOT EXISTS idx_demand_history_zone_created
ON demand_history(device_id, zone_id, created_at);

CREATE INDEX IF NOT EXISTS idx_device_health_history_created
ON device_health_history(device_id, created_at);
