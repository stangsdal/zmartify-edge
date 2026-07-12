# Zmartify Edge v2 Process Tracker

This tracker follows the phased migration process described in [docs/zmartify-edge-v2-architecture-ux-redesign.md](docs/zmartify-edge-v2-architecture-ux-redesign.md).

## Working Rules

- Work in phase-sized deliveries, each with explicit exit criteria.
- Keep features mergeable in small increments.
- Validate each phase increment with build/tests before commit.
- Preserve compatibility where possible while moving toward v2 contracts.
- Use greenfield validation: no legacy data backfill required; run clean onboarding/create flows instead.

## Phase Status

1. Phase 0 - Freeze and document v1: `completed`
- Existing architecture doc exists.
- Completed: OpenAPI snapshot artifact captured at `docs/api-snapshots/edge-api-openapi.json` (137 paths).
- Completed: MQTT topic map artifact captured at `docs/api-snapshots/mqtt-topic-map.json` (legacy/v2/dual command + outcome topics, ingest HTTP paths, realtime ws topics).

2. Phase 1 - PostgreSQL and Timescale foundation: `in progress`
- Completed: compose service scaffold for postgres-timescale and `DATABASE_URL` environment wiring.
- Completed: backend dependency and config scaffolding (`psycopg`, `SQLAlchemy`, `Alembic`, db metadata in `/health`).
- Completed: Alembic baseline scaffold and first baseline revision.
- Completed: first SQLAlchemy-managed core v2 tables migration (`core_domains_v2`, `core_sites_v2`, `core_devices_v2`).
- Completed: transitional dual-write bridge from registry writes into `core_*_v2` when tables exist.
- Open: migrate active runtime persistence from SQLite to PostgreSQL-backed SQLAlchemy models.

3. Phase 2 - Core platform extraction: `partially started`
- Existing role/auth/domain/site/device endpoints exist.
- Completed: initial `/api/v2` core router extraction (domains/sites/devices adapters, UUID-first refs).
- Completed: `/api/v2` auth/users and mqtt-clients adapter router extraction.
- Completed: `/api/v2` events/mobile-notifications adapter router extraction.
- Completed: `/api/v2` device-lifecycle adapter router extraction (discover/claim/push-config/onboarding-status/firmware-refresh).
- Completed: `/api/v2` device-domain adapter router extraction (zones/channels/ingest/history/freshness).
- Completed: `/api/v2` device-ota adapter router extraction (`ota`, `ota/stage`, `ota/poll`, `ota/download`).
- Completed: mobile websocket stream extraction into adapter router (dual-path compatibility: `/mobile/ws/...` + `/api/v2/mobile/ws/...`).
- Completed: setpoint-outcome MQTT listener extraction from `main.py` into dedicated module with unit tests.
- Completed: system-status router extraction (`health`, `registry/status`, `admin/acl/*`) from `main.py` into `app/router_system_status.py` with dead-import cleanup.
- Open: continue extraction from `main.py` into v2 service/router modules.

4. Phase 3 - Device contract and canonical twin: `in progress`
- Twin ingestion and mobile views exist.
- Completed: initial versioned schema scaffolds under `contracts/` (device contract, mqtt v2, ota manifest).
- Completed: backend ingest/command checkpoint validation hooks (`warn` mode default, `enforce` available).
- Completed: staging compose override for enforce mode (`docker-compose.staging.yml`).
- Completed: staged compose config merge validation confirms enforce mode resolves for both API services.
- Completed: production flipped to `ZMART_EDGE_CONTRACT_VALIDATION_MODE=enforce` on 2026-07-12 after 2h of warn-mode traffic showed zero contract violations; live twin ingest verified under enforce (HTTP 200, freshness moving).
- Completed: initial generic realtime websocket endpoint (`/api/v2/ws`) with topic-subscribe protocol handshake and test coverage.
- Completed: realtime topic-hub fan-out foundation with publish hooks for `device.state.updated` and `hvac.zone.updated` topics.
- Completed: deterministic realtime fan-out test strategy (`/api/v2/ws` integration + topic-hub unit test).
- Completed: event/notification realtime fan-out hooks from domain lifecycle (`event.created`, `notification.created`).
- Completed: scoped realtime topic filtering for non-admin users (`site:{id}:events`, `user:{id}:notifications`) with unit coverage.
- Completed: notification read-state realtime fan-out (`notification.read`, `notification.read_all`) from notification lifecycle updates.
- Completed: irrigation run realtime fan-out hooks (`irrigation.run.updated`) and site-event publication.
- Completed: dedicated MQTT-v2 ingest service/router for reported-state and setpoint-outcome paths (`/api/v2/devices/{id}/ingest/mqtt/*`) beyond listener-only compatibility.
- Completed: enforce-mode negative-path regression coverage for all mqtt-v2 ingest endpoints (reported-state, setpoint-outcome, irrigation-outcome).
- Open: firmware/adapters contract conformance and strict-mode rollout.

5. Phase 4 - MQTT v2 adapter: `early stage`
- Completed: topic normalization helper for legacy/v2/dual command and outcome topic paths.
- Completed: setpoint outcome listener parsing/subscription support for both legacy and v2 topic styles.
- Completed: payload-level v2 command contract objects for HVAC setpoint/rename publish path with enforce-mode validation coverage.
- Completed: v2 setpoint outcome payload contract schema + runtime validation wired into listener ingest path.
- Completed: dedicated v2 ingest routing/service layer for reported-state and setpoint-outcome ingestion, including regression coverage.
- Completed: initial irrigation outcome schema + ingest endpoint (`irrigation-outcome.schema.json`, `/api/v2/devices/{id}/ingest/mqtt/irrigation/outcome`) with alarm-to-event mapping.
- Completed: typed irrigation outcome taxonomy (run/valve/hydraulics/power/weather categories) with side-effects: run completion mapping and valve fault propagation into output state.
- Open: deeper firmware topic alignment for irrigation outcome publishing.

6. Phase 5 - Irrigation backend: `early stage`
- UI scaffolding and route architecture are in place.
- Completed: irrigation foundation migration (`013_irrigation_foundation.sql`) with core zone/program tables.
- Completed: initial irrigation backend domain and `/api/v2/devices/{device_id}/irrigation/*` router skeleton.
- Completed: irrigation API skeleton coverage added to stage-gate rehearsal.
- Completed: irrigation schedules and run-history foundation (`014_irrigation_schedules_and_runs.sql`) with API routes for schedule creation/listing and manual program runs.
- Completed: site irrigation overview endpoint (`/api/v2/sites/{site_id}/irrigation/overview`).
- Completed: irrigation operations-state foundation (`015_irrigation_operations_state.sql`) with output/master-valve records, hydraulics/power/weather state, rain-delay API endpoints, and regression coverage.
- Completed: irrigation status/alarm realtime fan-out for operations-state mutations (`irrigation.status.updated` on output/hydraulics/power/weather/rain-delay updates).
- Completed: site irrigation overview now includes per-device operations-state summary (outputs activity/faults + hydraulics/power/weather + rain-delay snapshot).
- Completed: operations-state models are now fed by dedicated MQTT-v2 reported-state ingest (hydraulics/power/weather/outputs/rain-delay telemetry path).
- Open: command-side irrigation execution feedback/outcome contract coverage from firmware events.

7. Phase 6 - New responsive app shell: `in progress`
- Completed: responsive nav shell, mobile/tablet/desktop behavior, onboarding flow routes.
- Completed: product-neutral Home, Control/Insights/Alerts redesign iterations.
- Completed: realtime irrigation status topic consumption in app shell pages (Home + Water Insights) over `/api/v2/ws` subscriptions.
- Completed: irrigation alarm drill-down and status badges in app shell (Alerts + Weather surfaces consume realtime irrigation topic stream and rain-delay/fault snapshots).
- Completed: irrigation manual-run command feedback traces in app shell via realtime topic stream correlation.
- Completed: per-device irrigation alarm history navigation from Alerts into enriched irrigation detail surface with realtime event history and operations-state snapshots.
- Completed: irrigation programs and hydraulics/power app-shell surfaces now consume real backend program/schedule data and realtime overview/status traces.
- Completed: irrigation program management actions in app shell (create program, enable/pause toggle, add schedule, run now) bound to v2 program endpoints.
- Open: complete remaining UX parity screens and deeper API bindings.

8. Phase 7 - HVAC firmware alignment: `started`
- Completed: firmware v0.2.0 (zmartify-hvac-ahc9000 commit 18c7709) adds MQTT v2 setpoint contract support: subscribes to `zmartify/v2/devices/{id}/commands/hvac/zones/+/setpoint` for command_id correlation and dual-publishes schema-conformant `setpoint-outcome` payloads alongside legacy topics.
- Completed: firmware v0.2.0 deployed to live device 192.168.10.57 via OTA (`POST /ota` + reboot); post-OTA health verified (AHC9000 detected, 0 poll failures).
- Completed: edge ACL generation now grants devices `zmartify/v2/devices/{id}/#` readwrite alongside legacy homie topics.
- Completed: production edge deployed from merged `main` (b426a9a + fixes) with `ZMART_EDGE_MQTT_TOPIC_STYLE=dual`, contracts volume mount, regenerated ACL, and broker restart for client resubscribe.
- Completed: live end-to-end v2 loop validated on 2026-07-12: dual-published setpoint command -> firmware v0.2.0 -> v2 `setpoint-outcome` ingested by edge (`setpoint_command_outcome_received` events with source `mqtt_v2_setpoint_outcome`, result `confirmed`, command_id echoed).
- Completed: duplicate outcome ingestion resolved — setpoint listener now runs only in the primary HTTPS API service (`ZMART_EDGE_ENABLE_SETPOINT_OUTCOME_LISTENER=0` on the http service); re-validated live with exactly one event per topic source.
- Completed: firmware v0.2.1 (commit 2d03a7b) fixes twin-push identity regression from the repo rename — device id now read from provisioned NVS `mqtt_client_id` with MAC fallback; twin pushes restored to HTTP 200 under enforce mode.
- Early validation support added: optional live HVAC smoke tests include edge twin-shape and command-feedback sequence checks.
- Latest run: direct live HVAC smoke (`RUN_LIVE_HVAC=1`, base `http://192.168.10.57`) completed with 3 passed and 2 skipped (edge-assisted checks not enabled).
- Latest attempt with edge-assisted flags passed baseline live checks with same 3 passed / 2 skipped, indicating `LIVE_EDGE_*` credentials were still not provided in environment.
- Added helper script `scripts/run_live_edge_assisted_hvac.sh`; current run fell back to baseline live smoke due missing edge env vars.
- Latest helper-script rerun (after OTA extraction): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after mobile-websocket extraction): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after setpoint-listener extraction): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after realtime websocket endpoint addition): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after realtime fan-out foundation): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after realtime scoped fan-out + irrigation skeleton): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after realtime read-state + irrigation schedules/runs + mqtt topic normalization): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after mqtt-v2 command-contract + irrigation realtime/overview increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after mqtt-v2 outcome contract increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation operations-state increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation status-fanout increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation overview operations-state expansion): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after mqtt-v2 ingest + irrigation realtime UI increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation outcome contract + ingest increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation alarm drill-down UI increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation command feedback trace UI increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation alert-navigation/detail-history increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation programs + hydraulics parity increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation program actions increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after irrigation outcome taxonomy increment): baseline fallback still valid, 3 passed / 2 skipped.
- Latest helper-script rerun (after enforce-mode ingest coverage increment): baseline fallback still valid, 3 passed / 2 skipped.

9. Phase 8 - Irrigation firmware integration: `not started`

10. Phase 9 - Production hardening: `started`
- Completed: database backup + restore-drill helper (`scripts/backup_edge_db.sh`) with integrity verification and retention pruning; validated end-to-end against a freshly initialized edge database.
- Completed: scheduled backup sidecar (`edge-db-backup` compose service) running daily snapshots into a dedicated `edge-backups` volume with configurable interval/retention.
- Open: enforce-mode default rollout and remaining hardening checklist items.

11. Phase 10 - Native mobile packaging: `not started`

## Branching Recommendation

Recommended branch model from architecture doc:

- `feature/v2-postgres-foundation`
- `feature/v2-core-domain`
- `feature/v2-device-contract`
- `feature/v2-mqtt`
- `feature/v2-irrigation-domain`
- `feature/v2-responsive-app-shell`
- `feature/v2-hvac-adapter`
- `feature/v2-production-hardening`

Current redesign stream branch: `docs/edge-v2-architecture-redesign`.

## Definition of Done (Per Increment)

- Build succeeds for `zmartify-admin`.
- Changed routes/components are functional and navigable.
- Errors are presented with actionable wording.
- Commit message describes one coherent increment.
- Push to remote completed.

## Next Process-Aligned Steps

1. Continue strict contract rollout across adapters/firmware paths and close remaining enforce-mode gaps.
2. Plan and stage the enforce-mode default flip (warn -> enforce) once firmware payload conformance is confirmed.
3. Align firmware publish payloads (Phase 7/8) with the typed outcome taxonomy once live device credentials are available.
