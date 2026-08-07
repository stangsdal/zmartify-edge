CREATE TABLE IF NOT EXISTS site_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    site_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    invited_by_user_id INTEGER,
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    accepted_by_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
    FOREIGN KEY(invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CHECK (role IN ('owner', 'user', 'viewer'))
);

CREATE TABLE IF NOT EXISTS site_invitation_product_access (
    invitation_id INTEGER NOT NULL,
    product_type TEXT NOT NULL,
    PRIMARY KEY(invitation_id, product_type),
    FOREIGN KEY(invitation_id) REFERENCES site_invitations(id) ON DELETE CASCADE,
    CHECK (product_type IN ('hvac', 'irrigation', 'weather', 'energy'))
);

CREATE INDEX IF NOT EXISTS idx_site_invitations_email ON site_invitations(email, expires_at);
CREATE INDEX IF NOT EXISTS idx_site_invitations_site ON site_invitations(site_id, expires_at);