-- Zmartify Edge v2: PostgreSQL schema bootstrap
-- Machine-translated from the SQLite runtime schema in creation order (greenfield: no data migration).

CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE IF NOT EXISTS domains (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, uuid TEXT);

CREATE TABLE IF NOT EXISTS sites (
    id BIGSERIAL PRIMARY KEY,
    domain_id INTEGER NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, uuid TEXT,
    UNIQUE(domain_id, slug),
    FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devices (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    mac TEXT,
    firmware_version TEXT,
    site_id INTEGER,
    device_type TEXT NOT NULL DEFAULT 'hvac_gateway',
    integration_mode TEXT NOT NULL DEFAULT 'mqtt',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT, local_url TEXT, device_admin_token TEXT, uuid TEXT,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mqtt_clients (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    client_type TEXT NOT NULL,
    domain_id INTEGER,
    site_id INTEGER,
    device_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enabled INTEGER NOT NULL DEFAULT 1, uuid TEXT,
    FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mqtt_credentials (
    id BIGSERIAL PRIMARY KEY,
    mqtt_client_id INTEGER NOT NULL UNIQUE,
    password_hash TEXT,
    password_plain_for_initial_display TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rotated_at TEXT,
    FOREIGN KEY(mqtt_client_id) REFERENCES mqtt_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS acl_generation_log (
    id BIGSERIAL PRIMARY KEY,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success INTEGER NOT NULL,
    message TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    last_login_at TEXT
, uuid TEXT);

CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    PRIMARY KEY(user_id, role_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    last_used_at TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS auth_login_state (
    username TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT,
    lock_until TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zone_metadata (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    floor TEXT,
    area_m2 DOUBLE PRECISION,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    UNIQUE(device_id, zone_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_metadata (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT, linked_zone_ids_json TEXT,
    UNIQUE(device_id, channel_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zone_state (
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    current_temperature DOUBLE PRECISION,
    target_temperature DOUBLE PRECISION,
    demand INTEGER,
    active INTEGER,
    fault TEXT,
    source TEXT,
    source_timestamp TEXT,
    updated_at TEXT,
    PRIMARY KEY(device_id, zone_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_state (
    device_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    active INTEGER,
    fault TEXT,
    source_timestamp TEXT,
    updated_at TEXT,
    PRIMARY KEY(device_id, channel_id),
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_state (
    device_id INTEGER PRIMARY KEY,
    online INTEGER,
    mqtt_connected INTEGER,
    last_seen_at TEXT,
    source_timestamp TEXT,
    updated_at TEXT,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_log (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    domain_id INTEGER,
    site_id INTEGER,
    device_id INTEGER,
    zone_id INTEGER,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE SET NULL,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE SET NULL,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    event_id INTEGER,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(event_id) REFERENCES event_log(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS temperature_history (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER,
    zone_id INTEGER,
    current_temperature DOUBLE PRECISION,
    target_temperature DOUBLE PRECISION,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS twin_ingest_state (
    device_id INTEGER PRIMARY KEY,
    last_source TEXT,
    last_payload_hash TEXT,
    last_ingested_at TEXT,
    last_applied_at TEXT,
    last_result TEXT,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS setpoint_history (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    target_temperature DOUBLE PRECISION,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS demand_history (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    zone_id INTEGER NOT NULL,
    demand INTEGER,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_health_history (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    online INTEGER,
    mqtt_connected INTEGER,
    last_error TEXT,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_site_access (
    user_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, site_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS registration_invites (
    id BIGSERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS irrigation_zones (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    local_ref TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
    UNIQUE(device_id, local_ref)
);

CREATE TABLE IF NOT EXISTS irrigation_programs (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    seasonal_adjustment DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    weather_mode TEXT NOT NULL DEFAULT 'automatic',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS irrigation_schedule_rules (
    id BIGSERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS irrigation_runs (
    id BIGSERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS irrigation_run_steps (
    id BIGSERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS irrigation_outputs (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    local_ref TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 0,
    fault TEXT,
    is_master_valve INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
    UNIQUE(device_id, local_ref)
);

CREATE TABLE IF NOT EXISTS irrigation_hydraulics_state (
    device_id INTEGER PRIMARY KEY,
    flow_lpm DOUBLE PRECISION,
    pressure_bar DOUBLE PRECISION,
    water_liters DOUBLE PRECISION,
    source_timestamp TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS irrigation_power_state (
    device_id INTEGER PRIMARY KEY,
    voltage_rms_v DOUBLE PRECISION,
    current_rms_a DOUBLE PRECISION,
    real_power_w DOUBLE PRECISION,
    power_factor DOUBLE PRECISION,
    source_timestamp TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS irrigation_weather_state (
    device_id INTEGER PRIMARY KEY,
    temperature_c DOUBLE PRECISION,
    rain_mm DOUBLE PRECISION,
    wind_mps DOUBLE PRECISION,
    eto_mm DOUBLE PRECISION,
    source_timestamp TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS irrigation_rain_delay (
    id BIGSERIAL PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    device_id INTEGER NOT NULL,
    active_until TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sites_domain_id ON sites(domain_id);

CREATE INDEX IF NOT EXISTS idx_devices_site_id ON devices(site_id);

CREATE INDEX IF NOT EXISTS idx_mqtt_clients_domain_id ON mqtt_clients(domain_id);

CREATE INDEX IF NOT EXISTS idx_mqtt_clients_site_id ON mqtt_clients(site_id);

CREATE INDEX IF NOT EXISTS idx_mqtt_clients_device_id ON mqtt_clients(device_id);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_auth_login_state_lock_until ON auth_login_state(lock_until);

CREATE INDEX IF NOT EXISTS idx_zone_metadata_device_sort ON zone_metadata(device_id, sort_order, zone_id);

CREATE INDEX IF NOT EXISTS idx_zone_state_updated ON zone_state(updated_at);

CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at);

CREATE INDEX IF NOT EXISTS idx_event_log_device ON event_log(device_id, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at);

CREATE INDEX IF NOT EXISTS idx_temp_history_zone_created ON temperature_history(device_id, zone_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_uuid ON domains(uuid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_uuid ON sites(uuid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_uuid ON devices(uuid);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mqtt_clients_uuid ON mqtt_clients(uuid);

CREATE INDEX IF NOT EXISTS idx_channel_metadata_device_sort
ON channel_metadata(device_id, sort_order, channel_id);

CREATE INDEX IF NOT EXISTS idx_twin_ingest_state_applied
ON twin_ingest_state(last_applied_at);

CREATE INDEX IF NOT EXISTS idx_setpoint_history_zone_created
ON setpoint_history(device_id, zone_id, created_at);

CREATE INDEX IF NOT EXISTS idx_demand_history_zone_created
ON demand_history(device_id, zone_id, created_at);

CREATE INDEX IF NOT EXISTS idx_device_health_history_created
ON device_health_history(device_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);

CREATE INDEX IF NOT EXISTS idx_user_site_access_user_id ON user_site_access(user_id);

CREATE INDEX IF NOT EXISTS idx_user_site_access_site_id ON user_site_access(site_id);

CREATE INDEX IF NOT EXISTS idx_registration_invites_token_hash ON registration_invites(token_hash);

CREATE INDEX IF NOT EXISTS idx_registration_invites_expires_at ON registration_invites(expires_at);

CREATE INDEX IF NOT EXISTS idx_registration_invites_device_id ON registration_invites(device_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_zones_device_id ON irrigation_zones(device_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_programs_device_id ON irrigation_programs(device_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_schedule_rules_program_id ON irrigation_schedule_rules(program_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_runs_device_id ON irrigation_runs(device_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_runs_program_id ON irrigation_runs(program_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_run_steps_run_id ON irrigation_run_steps(run_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_outputs_device_id ON irrigation_outputs(device_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_rain_delay_device_id ON irrigation_rain_delay(device_id);

CREATE INDEX IF NOT EXISTS idx_irrigation_rain_delay_active_until ON irrigation_rain_delay(active_until);
