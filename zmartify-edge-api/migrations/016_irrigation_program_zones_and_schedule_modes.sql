CREATE TABLE IF NOT EXISTS irrigation_program_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    program_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 600,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(program_id) REFERENCES irrigation_programs(id) ON DELETE CASCADE,
    FOREIGN KEY(zone_id) REFERENCES irrigation_zones(id) ON DELETE CASCADE,
    UNIQUE(program_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_irrigation_program_zones_program_id ON irrigation_program_zones(program_id);

ALTER TABLE irrigation_schedule_rules ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'weekdays';
ALTER TABLE irrigation_schedule_rules ADD COLUMN interval_days INTEGER;
ALTER TABLE irrigation_schedule_rules ADD COLUMN anchor_date TEXT;
ALTER TABLE irrigation_schedule_rules ADD COLUMN dates_json TEXT NOT NULL DEFAULT '[]';