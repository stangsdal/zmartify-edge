ALTER TABLE devices ADD COLUMN product_type TEXT;

UPDATE devices
SET product_type = CASE device_type
    WHEN 'hvac_gateway' THEN 'hvac'
    WHEN 'hvac_controller' THEN 'hvac'
    WHEN 'irrigation_controller' THEN 'irrigation'
    WHEN 'weather_station' THEN 'weather'
    WHEN 'energy_meter' THEN 'energy'
    ELSE 'unknown'
END
WHERE product_type IS NULL;

CREATE TABLE IF NOT EXISTS site_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    invited_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, site_id),
    CHECK (role IN ('owner', 'user', 'viewer')),
    CHECK (status IN ('invited', 'active', 'disabled')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
    FOREIGN KEY(invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS site_membership_product_access (
    membership_id INTEGER NOT NULL,
    product_type TEXT NOT NULL,
    PRIMARY KEY(membership_id, product_type),
    CHECK (product_type IN ('hvac', 'irrigation', 'weather', 'energy')),
    FOREIGN KEY(membership_id) REFERENCES site_memberships(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_memberships_user ON site_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_site_memberships_site ON site_memberships(site_id, status);
CREATE INDEX IF NOT EXISTS idx_devices_product_type ON devices(product_type);

INSERT OR IGNORE INTO roles(name) VALUES ('administrator');