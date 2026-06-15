CREATE TABLE IF NOT EXISTS zone_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    floor TEXT,
    area_m2 REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    UNIQUE(device_id, zone_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    UNIQUE(device_id, channel_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zone_state (
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    current_temperature REAL,
    target_temperature REAL,
    demand INTEGER,
    active INTEGER,
    fault TEXT,
    source TEXT,
    source_timestamp TEXT,
    updated_at TEXT,
    PRIMARY KEY(device_id, zone_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_state (
    device_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    active INTEGER,
    fault TEXT,
    source_timestamp TEXT,
    updated_at TEXT,
    PRIMARY KEY(device_id, channel_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_state (
    device_id INTEGER PRIMARY KEY,
    online INTEGER,
    mqtt_connected INTEGER,
    last_seen_at TEXT,
    source_timestamp TEXT,
    updated_at TEXT,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    domain_id INTEGER,
    site_id INTEGER,
    device_id INTEGER,
    zone_id INTEGER,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE SET NULL,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE SET NULL,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    event_id INTEGER,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(event_id) REFERENCES event_log(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS temperature_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER,
    zone_id INTEGER,
    current_temperature REAL,
    target_temperature REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_zone_metadata_device_sort ON zone_metadata(device_id, sort_order, zone_id);
CREATE INDEX IF NOT EXISTS idx_zone_state_updated ON zone_state(updated_at);
CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at);
CREATE INDEX IF NOT EXISTS idx_event_log_device ON event_log(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at);
CREATE INDEX IF NOT EXISTS idx_temp_history_zone_created ON temperature_history(device_id, zone_id, created_at);

ALTER TABLE domains ADD COLUMN uuid TEXT;
UPDATE domains SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_uuid ON domains(uuid);

ALTER TABLE sites ADD COLUMN uuid TEXT;
UPDATE sites SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_uuid ON sites(uuid);

ALTER TABLE devices ADD COLUMN uuid TEXT;
UPDATE devices SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_uuid ON devices(uuid);

ALTER TABLE mqtt_clients ADD COLUMN uuid TEXT;
UPDATE mqtt_clients SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))) WHERE uuid IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mqtt_clients_uuid ON mqtt_clients(uuid);
