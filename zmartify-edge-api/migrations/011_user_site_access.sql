CREATE TABLE IF NOT EXISTS user_site_access (
    user_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, site_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_site_access_user_id ON user_site_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_site_access_site_id ON user_site_access(site_id);