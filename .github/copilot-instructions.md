# Zmartify Edge Copilot Recipe

This repository contains the Zmartify Edge platform and several related runtime surfaces. Treat local changes as valuable and preserve user work.

## Repository Map

- `zmartify-admin/`: Ionic React/Vite/TypeScript admin application.
- `zmartify-edge-api/`: FastAPI/Python backend, SQL migrations, MQTT v2 ingest and domain model.
- `zmartify-hvac-ahc9000/` is a sibling workspace at `/Users/peter/zmartify-hvac-ahc9000`, not a child of this repository. It contains the ESP-IDF HVAC firmware.
- `contracts/` and `device-contract-v2/`: device and MQTT schemas. Keep implementation and contracts aligned.
- `docs/`: architecture, test plans and operational notes.
- `scripts/`: deployment, backup, onboarding and live verification helpers.

## Working Rules

1. Start from the smallest concrete anchor: failing test, endpoint, symbol, log line, or nearby implementation.
2. Before editing, state one falsifiable local hypothesis, one cheap check that could disconfirm it, and the smallest edit that tests it.
3. Prefer existing abstractions, schemas, helpers and naming conventions. Fix root causes; do not mask symptoms with duplicated fallbacks.
4. Keep changes narrowly scoped. Do not revert, reset, clean, or overwrite unrelated user changes, dirty host files, secrets, certificates, database volumes, or generated artifacts.
5. Use `apply_patch` for manual edits. Preserve surrounding formatting and public APIs. Avoid unrelated refactors and unnecessary comments.
6. After the first substantive edit, immediately run the cheapest focused executable validation available. If it fails, repair and rerun that same check before broadening scope.
7. Finish with at least one executable post-edit validation. Report commands that could not be run and any remaining risk.
8. Do not commit or create branches unless explicitly requested.
9. Prefer standard Git CLI for repository operations. Inspect `git status --short` before and after work.
10. Never expose or copy `.env`, passwords, tokens, private keys, MQTT credentials, or bearer tokens.

## Local Validation

### Admin UI

From `zmartify-admin/`:

```bash
npm test
npm run build
```

The production build must pass TypeScript and Vite. If deployment-only asset generation is blocked by stale TypeScript/Vitest dependencies, use `npx vite build` only as a documented fallback; do not treat it as a replacement for fixing tests or types.

Frontend tests live under `src/`. After package changes, run `npm install` in a production checkout before building.

### Backend

From `zmartify-edge-api/`:

```bash
PYTHONPATH=. ../.venv/bin/pytest -q
```

For a focused change, run the narrowest relevant test file first, especially domain-model/mobile API tests. Keep migrations and schema tests in the validation scope when database behavior changes.

### Firmware

Firmware repository: `/Users/peter/zmartify-hvac-ahc9000`.

```bash
cd /Users/peter/zmartify-hvac-ahc9000
source ~/.espressif/v6.0.1/esp-idf/export.sh
idf.py build
```

The live HVAC device is an ESP32-S3 with 8 MB flash. The firmware is OTA-only; there is no USB serial connection. If the repo was renamed and the build cache contains the old path, use `rm -rf build && idf.py set-target esp32s3` before rebuilding.

ESP-IDF v6 does not provide bundled cJSON for this project. Do not add a cJSON dependency casually; the firmware currently uses string-based JSON field extraction in `hvac_mqtt.c`.

## HVAC Data-Model Invariants

When testing thermostat visibility, validate the complete chain:

`Modbus element status -> ahc9000_adapter.cpp -> hvac_mqtt.c -> retained v2 state/reported -> mqtt_v2_ingest.py -> domain_model.py -> mobile zones API -> admin UI`

Important facts:

- Wavin status bit `0x8000` means alive/online; bit `0x0100` is the TP thermostat flag.
- Assigned elements must still be represented as thermostats when TP is absent, because live devices may omit the TP bit.
- The v2 reported state must be valid JSON, use schema version `2.0`, include zones and thermostat/controlled-element identifiers, and publish to `zmartify/v2/devices/<device_id>/state/reported`.
- Large Homie descriptions and reported-state payloads need adequate buffers and asynchronous retry behavior. Do not reintroduce task-stack allocations for large payloads; static storage is safer after prior FreeRTOS stack-overflow incidents.
- Device model availability can lag MQTT connection. Allow real elapsed time and ignore empty early snapshots rather than declaring the model broken.
- Validate live firmware with `/health`, `/debug/elements`, `/zones?extended=1`, `/mqtt/log`, and a parsed latest retained `state/reported` payload. Require the expected zone count and channel/thermostat data.
- The production app must use the selected site's UUID for `/mobile/sites/{site_uuid}/zones`. Numeric internal site IDs and public site UUIDs are different concepts.

## Production Deployment

Production host:

```bash
ssh zmartify@zmartify-edge
cd /home/zmartify/zmartify-edge
```

The remote directory may not be a Git checkout. Inspect `docker-compose.yml`, `docker compose ps`, bind mounts, images and logs before assuming `git pull` is available. Never overwrite remote `.env` or secrets.

The production Compose model is:

- `zmartify-edge-api` builds from `./zmartify-edge-api`.
- `zmartify-admin/dist` is mounted read-only at `/zmartify-admin/dist` and is served by the API.
- `./contracts` must be mounted at `/contracts:ro` because backend schema resolution depends on it.
- Postgres/Timescale data lives in Docker volumes; do not delete volumes.

### Stable SSH deployment

A long-lived SSH terminal can remain connected while new SSH handshakes time out. Reuse a multiplexed control socket and run transfers sequentially:

```bash
ssh -M -S ~/.ssh/cm-%C -o ControlPersist=10m \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
  -o ConnectTimeout=10 -fnN zmartify-edge

rsync -az --partial --timeout=120 \
  -e 'ssh -S ~/.ssh/cm-%C -o ControlMaster=auto -o ControlPersist=10m' \
  SOURCE zmartify@zmartify-edge:/home/zmartify/zmartify-edge/TARGET
```

Do not open many independent or parallel SSH sessions during deployment. Transfer the frontend, backend modules, and migrations as separate sequential operations. Verify remote file presence before rebuilding.

Recommended deployment order:

1. Run local focused tests and `npm run build`.
2. Inspect remote containers, mounts, logs and database schema.
3. Transfer only the required source files and the built `zmartify-admin/dist`.
4. Check whether the migration is already applied; never blindly rerun destructive SQL.
5. Run `docker compose build zmartify-edge-api`.
6. Run `docker compose up -d --no-deps zmartify-edge-api` for API-only changes.
7. Restart `hvac-mosquitto` after ACL changes so devices reconnect and resubscribe; HUP alone does not re-grant denied subscriptions.
8. Verify startup logs, API health, authenticated endpoint status and browser behavior.
9. Reload the production app and confirm the actual rendered zones, temperatures, thermostat data and absence of new console/API errors.

Production uses v2 MQTT topic style and contract enforcement. Keep those settings intact unless the task explicitly changes the rollout strategy.

## Database and Migrations

- Inspect `schema_migrations` and relevant columns before applying SQL.
- Production already contains `zone_state.battery_percent` when the HVAC battery migration is present; do not apply the same `ALTER TABLE` again without an idempotent guard.
- Preserve Postgres/Timescale volumes and take backups before risky schema operations.
- Keep clean-install schema files and incremental migrations consistent.

## Live Device and MQTT Operations

Live HVAC device: `192.168.10.57`.

OTA flow:

```bash
curl --fail --data-binary @build/zmartify-hvac-ahc9000.bin http://192.168.10.57/ota
curl --fail -X POST http://192.168.10.57/reboot
```

Allow approximately 60-90 seconds after reboot before concluding that MQTT/device detection failed. Verify health and data after the delay. Prefer OTA over any imagined serial workflow.

The device identity is stored in NVS under `cfg/mqtt_client_id`; a MAC-derived fallback includes the firmware project-name prefix, so renaming the project can break registry matching. Provision ACLs and MQTT credentials for the actual onboarding/device ID.

MQTT/ACL operational facts:

- Production broker endpoint is `mqtts://mqtt.zmartify.dk:8883`.
- Keep ACL and passwd ownership/modes compatible with Mosquitto uid/gid 1883.
- Mosquitto cannot necessarily read certificates directly from `/etc/letsencrypt/live`; use the established readable TLS copy under `mosquitto/config/tls` when required.
- Never print credentials or private key contents in command output.

## Troubleshooting Discipline

When the app shows no data, test each boundary in order:

1. Browser request URL and response status.
2. Mounted frontend bundle and cache/service-worker version.
3. API logs and traceback for the exact request.
4. Backend database schema and persisted device/zone state.
5. MQTT ingest logs and retained v2 reported state.
6. Device health, zones, elements and MQTT log.

A green local test does not prove production is current. A successful MQTT connection does not prove the reported JSON is valid or persisted. A successful API response does not prove the browser loaded the new bundle. Keep these checks separate and record the observed status at each boundary.

## Final Report

End each task with a concise report containing:

- Files or runtime surfaces changed.
- Focused validation commands and results.
- Deployment/restart status, if applicable.
- Live observations, including offline/stale states that are separate from empty data.
- Remaining blockers or risks.
