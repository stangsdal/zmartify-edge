CREATE TABLE device_bootstrap_claims (
    device_id TEXT PRIMARY KEY,
    claim_token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);