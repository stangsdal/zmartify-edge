# Zmartify Edge v2 Process Tracker

This tracker follows the phased migration process described in [docs/zmartify-edge-v2-architecture-ux-redesign.md](docs/zmartify-edge-v2-architecture-ux-redesign.md).

## Working Rules

- Work in phase-sized deliveries, each with explicit exit criteria.
- Keep features mergeable in small increments.
- Validate each phase increment with build/tests before commit.
- Preserve compatibility where possible while moving toward v2 contracts.

## Phase Status

1. Phase 0 - Freeze and document v1: `in progress`
- Existing architecture doc exists.
- Open: capture current API/OpenAPI snapshot and MQTT map as explicit artifacts.

2. Phase 1 - PostgreSQL and Timescale foundation: `in progress`
- Completed: compose service scaffold for postgres-timescale and `DATABASE_URL` environment wiring.
- Completed: backend dependency and config scaffolding (`psycopg`, `SQLAlchemy`, `Alembic`, db metadata in `/health`).
- Completed: Alembic baseline scaffold and first baseline revision.
- Completed: first SQLAlchemy-managed core v2 tables migration (`core_domains_v2`, `core_sites_v2`, `core_devices_v2`).
- Open: migrate active runtime persistence from SQLite to PostgreSQL-backed SQLAlchemy models.

3. Phase 2 - Core platform extraction: `partially started`
- Existing role/auth/domain/site/device endpoints exist.
- Open: complete v2 router structure and UUID-first public model.

4. Phase 3 - Device contract and canonical twin: `in progress`
- Twin ingestion and mobile views exist.
- Completed: initial versioned schema scaffolds under `contracts/` (device contract, mqtt v2, ota manifest).
- Completed: backend ingest/command checkpoint validation hooks (`warn` mode default, `enforce` available).
- Completed: staging compose override for enforce mode (`docker-compose.staging.yml`).
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

1. Start dual-write or migration bridge from current sqlite-backed domain data into `core_*_v2` tables.
2. Execute staging test run with enforce mode and capture conformance findings per device type.
3. Split backend router structure toward `/api/v2` modules while preserving compatibility.
