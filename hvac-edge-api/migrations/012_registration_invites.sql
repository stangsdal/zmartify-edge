CREATE TABLE IF NOT EXISTS registration_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    invite_code TEXT NOT NULL,
    device_id TEXT,
    label TEXT,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by_user_id INTEGER,
    created_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(used_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_registration_invites_token_hash ON registration_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_registration_invites_expires_at ON registration_invites(expires_at);
CREATE INDEX IF NOT EXISTS idx_registration_invites_device_id ON registration_invites(device_id);
