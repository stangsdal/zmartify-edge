CREATE TABLE IF NOT EXISTS system_email_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    sender TEXT NOT NULL,
    password_encrypted TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by_user_id INTEGER,
    FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);