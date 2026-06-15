CREATE TABLE IF NOT EXISTS twin_ingest_state (
    device_id INTEGER PRIMARY KEY,
    last_source TEXT,
    last_payload_hash TEXT,
    last_ingested_at TEXT,
    last_applied_at TEXT,
    last_result TEXT,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_twin_ingest_state_applied
ON twin_ingest_state(last_applied_at);
