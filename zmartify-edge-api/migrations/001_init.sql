CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(domain_id, slug),
    FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    mac TEXT,
    firmware_version TEXT,
    site_id INTEGER,
    device_type TEXT NOT NULL DEFAULT 'hvac_gateway',
    integration_mode TEXT NOT NULL DEFAULT 'mqtt',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mqtt_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    client_type TEXT NOT NULL,
    domain_id INTEGER,
    site_id INTEGER,
    device_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enabled INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mqtt_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mqtt_client_id INTEGER NOT NULL UNIQUE,
    password_hash TEXT,
    password_plain_for_initial_display TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rotated_at TEXT,
    FOREIGN KEY(mqtt_client_id) REFERENCES mqtt_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS acl_generation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success INTEGER NOT NULL,
    message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sites_domain_id ON sites(domain_id);
CREATE INDEX IF NOT EXISTS idx_devices_site_id ON devices(site_id);
CREATE INDEX IF NOT EXISTS idx_mqtt_clients_domain_id ON mqtt_clients(domain_id);
CREATE INDEX IF NOT EXISTS idx_mqtt_clients_site_id ON mqtt_clients(site_id);
CREATE INDEX IF NOT EXISTS idx_mqtt_clients_device_id ON mqtt_clients(device_id);
