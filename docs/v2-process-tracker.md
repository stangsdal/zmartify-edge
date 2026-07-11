# Zmartify Edge v2 Process Tracker

This tracker follows the phased migration process described in [docs/zmartify-edge-v2-architecture-ux-redesign.md](docs/zmartify-edge-v2-architecture-ux-redesign.md).

## Working Rules

- Work in phase-sized deliveries, each with explicit exit criteria.
- Keep features mergeable in small increments.
- Validate each phase increment with build/tests before commit.
- Preserve compatibility where possible while moving toward v2 contracts.
- Use greenfield validation: no legacy data backfill required; run clean onboarding/create flows instead.

## Phase Status

1. Phase 0 - Freeze and document v1: `in progress`
- Existing architecture doc exists.
- Open: capture current API/OpenAPI snapshot and MQTT map as explicit artifacts.

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
- Open: continue extraction from `main.py` into v2 service/router modules.

4. Phase 3 - Device contract and canonical twin: `in progress`
- Twin ingestion and mobile views exist.
- Completed: initial versioned schema scaffolds under `contracts/` (device contract, mqtt v2, ota manifest).
- Completed: backend ingest/command checkpoint validation hooks (`warn` mode default, `enforce` available).
- Completed: staging compose override for enforce mode (`docker-compose.staging.yml`).
- Completed: staged compose config merge validation confirms enforce mode resolves for both API services.
- Open: firmware/adapters contract conformance and strict-mode rollout.

5. Phase 4 - MQTT v2 adapter: `not started`
- Open: add v2 topic mapping and dedicated ingest pipeline.

6. Phase 5 - Irrigation backend: `early stage`
- UI scaffolding and route architecture are in place.
- Open: add dedicated irrigation backend model/tables/endpoints.

7. Phase 6 - New responsive app shell: `in progress`
- Completed: responsive nav shell, mobile/tablet/desktop behavior, onboarding flow routes.
- Completed: product-neutral Home, Control/Insights/Alerts redesign iterations.
- Open: complete remaining UX parity screens and deeper API bindings.

8. Phase 7 - HVAC firmware alignment: `not started`
- Early validation support added: optional live HVAC smoke tests include edge twin-shape and command-feedback sequence checks.
- Latest run: direct live HVAC smoke (`RUN_LIVE_HVAC=1`, base `http://192.168.10.57`) completed with 3 passed and 2 skipped (edge-assisted checks not enabled).
- Latest attempt with edge-assisted flags passed baseline live checks with same 3 passed / 2 skipped, indicating `LIVE_EDGE_*` credentials were still not provided in environment.
- Added helper script `scripts/run_live_edge_assisted_hvac.sh`; current run fell back to baseline live smoke due missing edge env vars.
- Latest helper-script rerun (after OTA extraction): baseline fallback still valid, 3 passed / 2 skipped.

9. Phase 8 - Irrigation firmware integration: `not started`

10. Phase 9 - Production hardening: `not started`

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

1. Execute full stage-gate rehearsal using clean environment and onboarding-based creation flow.
2. Run live HVAC contract smoke checks and capture conformance notes.
3. Continue splitting backend domains from `main.py` into `/api/v2` modules while preserving compatibility (next target: mobile websocket stream).
