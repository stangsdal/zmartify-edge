CREATE TABLE IF NOT EXISTS auth_login_state (
    username TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT,
    lock_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_login_state_lock_until ON auth_login_state(lock_until);
