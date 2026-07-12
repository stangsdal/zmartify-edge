# Zmartify Edge v2 Stage-Gate Test Plan (Greenfield)

This plan assumes **no migration/backfill of existing data**.
Validation is done by resetting to an empty runtime and performing complete re-onboarding + creation flows.

## Preconditions

- Build artifacts available for `admin-ui` and `zmartify-admin`.
- Python environment configured for `zmartify-edge-api`.
- Docker Engine + Compose v2 available.
- Optional live HVAC controller reachable for contract smoke tests.

## Stage Gates

### Phase 0 - Freeze and Document v1

Checks:

- Export OpenAPI from running API: `GET /openapi.json`.
- Capture current MQTT topic map and onboarding/OTA notes.
- Keep sqlite backup only for reference (no data migration usage).

Exit artifact:

- Snapshot files committed under `docs/`.

### Phase 1 - Postgres/Timescale Foundation

Checks:

- `docker compose -f docker-compose.yml -f docker-compose.staging.yml config` succeeds.
- Alembic migrations run on empty DB:
  - `alembic upgrade head`
- Health endpoint available after compose up.

Exit artifact:

- Migration chain passes from empty DB.

### Phase 2 - Core Platform Extraction

Checks (greenfield API flow):

- Create domain, site, device from empty runtime.
- Assign device to site.
- Verify dual-write rows exist in `core_*_v2` tables.
- Verify auth/admin routes still function.

Exit artifact:

- End-to-end create flows pass against empty DB.

### Phase 3 - Device Contract and Canonical Twin

Checks:

- Contract mode `enforce` active in staging override.
- Invalid payloads rejected with 400.
- Valid twin ingest accepted.
- Command state flow (`pending -> feedback`) validated.

Exit artifact:

- Contract enforcement tests passing.

### Phase 4 - MQTT v2 Adapter

Checks:

- ACL generation includes expected v2-compatible command topics.
- Device command publication path works.
- Outcome feedback updates command status.

Exit artifact:

- MQTT command + feedback loop verified.

### Phase 5-10 (Execution Policy)

For each remaining phase, execute same discipline:

- Start from clean environment.
- Run feature tests + regression tests.
- Record phase-specific acceptance evidence in `docs/v2-process-tracker.md`.
- Do not mark complete without executable verification evidence.

## Optional Live HVAC Contract Smoke Test

Run only when live controller is reachable:

```bash
RUN_LIVE_HVAC=1 LIVE_HVAC_BASE_URL=http://192.168.10.57 \
  /Users/peter/zmartify-edge/.venv/bin/python -m pytest -q \
  zmartify-edge-api/tests/test_live_hvac_contract.py
```

## Recommended Execution Command

```bash
./scripts/run_v2_greenfield_rehearsal.sh
```

The script performs deterministic checks for phases 1-4 and fails fast on any broken stage gate.
