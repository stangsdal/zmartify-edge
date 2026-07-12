CREATE TABLE IF NOT EXISTS irrigation_schedule_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    program_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    start_local_time TEXT NOT NULL,
    weekdays_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(program_id) REFERENCES irrigation_programs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_irrigation_schedule_rules_program_id ON irrigation_schedule_rules(program_id);

CREATE TABLE IF NOT EXISTS irrigation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    program_id INTEGER,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    total_runtime_seconds INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY(program_id) REFERENCES irrigation_programs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_irrigation_runs_device_id ON irrigation_runs(device_id);
CREATE INDEX IF NOT EXISTS idx_irrigation_runs_program_id ON irrigation_runs(program_id);

CREATE TABLE IF NOT EXISTS irrigation_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    run_id INTEGER NOT NULL,
    zone_id INTEGER,
    zone_name TEXT,
    duration_seconds INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES irrigation_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(zone_id) REFERENCES irrigation_zones(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_irrigation_run_steps_run_id ON irrigation_run_steps(run_id);
