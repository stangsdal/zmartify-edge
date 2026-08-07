# zmartify-edge-api (Phases A-D implemented)

This directory contains the initial backend scaffold for the Raspberry Pi edge milestone.

## What is implemented

- FastAPI app entrypoint (`main.py`)
- Startup-time SQLite migration runner
- Migration `001_init.sql` with registry schema
- Phase B registry CRUD endpoints for domains, sites, and devices
- Phase C MQTT client lifecycle endpoints (create/list/get/rotate/enable/disable/delete)
- Automatic device MQTT client provisioning on device registration
- Phase D ACL generation from registry state with generation logging
- Phase 1 foundation scaffolding for PostgreSQL/Timescale (`DATABASE_URL`, compose service, deps)
- Device-initiated bootstrap staging and MQTT-triggered pull OTA

## Local run (dev)

```bash
cd edge/zmartify-edge-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

## Database configuration (transition mode)

Current runtime remains SQLite for compatibility with the existing backend data-access layer.

Environment variables:

- `DATABASE_URL` (new): migration target wiring, used for backend metadata and upcoming SQLAlchemy/Alembic work.
- `ZMART_EDGE_DB_PATH` (current active runtime): SQLite file path.
- `ZMART_EDGE_CONTRACT_VALIDATION_MODE`: `off`, `warn` (default), or `enforce`.

Recommended rollout:

- local/dev: `warn`
- staging: `enforce`
- production: `enforce` once firmware/adapters pass conformance checks

Example:

```bash
export DATABASE_URL=postgresql://zmartify:<secret>@postgres-timescale:5432/zmartify
export ZMART_EDGE_DB_PATH=/data/hvac-edge.sqlite
```

Health endpoint now reports both `db_backend` and `database_url_scheme` for rollout visibility.

## Alembic baseline (Phase 1 start)

This repository now includes an Alembic scaffold and baseline revision:

- `alembic.ini`
- `alembic/env.py`
- `alembic/versions/20260712_0001_baseline_transition.py`
- `alembic/versions/20260712_0002_core_domain_tables.py`

Run baseline migrate command:

```bash
alembic upgrade head
```

Note: the active runtime data path still uses SQLite access functions while SQLAlchemy/Alembic migration is introduced incrementally.

## Staging contract enforcement

For staging environments, run compose with the staging override to force strict contract checks:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

This sets `ZMART_EDGE_CONTRACT_VALIDATION_MODE=enforce` for both API service variants.

## Core v2 dual-write bridge (transitional)

Registry write paths now perform a best-effort sync into `core_*_v2` tables when those tables exist:

- domain create/rename -> `core_domains_v2`
- site create -> `core_sites_v2`
- device create/assign-site/rename/firmware-update -> `core_devices_v2`

This bridge is intentionally non-breaking while legacy sqlite tables remain active source-of-truth.

## Compose run

```bash
cd edge
docker compose up -d --build
```

`zmartify-edge-api` is now built from `zmartify-edge-api/Dockerfile` with system and
Python dependencies baked into the image.

API endpoints currently:

- `GET /health`
- `GET /registry/status`
- `POST /domains`
- `GET /domains`
- `GET /domains/{domain_id}`
- `DELETE /domains/{domain_id}`
- `POST /domains/{domain_id}/sites`
- `GET /domains/{domain_id}/sites`
- `GET /sites/{site_id}`
- `DELETE /sites/{site_id}`
- `POST /devices`
- `GET /devices`
- `GET /devices/{device_id}`
- `POST /devices/{device_id}/assign-site`
- `POST /devices/{device_id}/rename`
- `DELETE /devices/{device_id}`
- `POST /mqtt/clients`
- `GET /mqtt/clients`
- `GET /mqtt/clients/{id}`
- `POST /mqtt/clients/{id}/rotate-password`
- `POST /mqtt/clients/{id}/disable`
- `POST /mqtt/clients/{id}/enable`
- `DELETE /mqtt/clients/{id}`

## Device Bootstrap And Field OTA

The Edge service does not need inbound connectivity to a gateway's LAN address.
For outbound bootstrap, an owner, admin, or installer stages the device's
six-digit claim token with `POST /api/v2/devices/bootstrap/stage`. The gateway
then calls the public `POST /api/v2/device-bootstrap/config` endpoint. A valid
claim returns Edge URL, device-admin token, and MQTT credentials once; the stored
claim token is SHA-256 hashed, expires after 10 minutes, and is deleted on use.

For field OTA, stage a firmware binary with:

```text
POST /api/v2/devices/{device_id}/ota/stage?version={version}&force={false|true}
```

The response includes `sha256` and `size_bytes`, which must be checked against
the local artifact. A dedicated management MQTT principal then publishes payload
`1`, QoS 1, non-retained, to:

```text
homie/5/{device_id}/gateway/ota-check/set
```

The device authenticates its own poll and download requests using its
device-admin token:

```text
GET /api/v2/devices/{device_id}/ota/poll?current_version={version}
GET /api/v2/devices/{device_id}/ota/download?sha256={sha256}
```

Edge returns a download URL only when the staged version differs from the device
version, unless `force=true`. Do not publish using device credentials or attempt
to proxy a field OTA through a private `local_url`. Confirm the gateway's version
and health after its self-initiated reboot, and retain Edge access logs as the
transfer audit record.

## MQTT command execution mode

By default, external broker commands are disabled for safe local development.
In this mode ACL generation runs in dry-run mode automatically and still records
rows in `acl_generation_log`.

- `ZMART_EDGE_APPLY_MQTT_COMMANDS=0` (default)

To enable real `mosquitto_passwd` and broker reload actions:

```bash
export ZMART_EDGE_APPLY_MQTT_COMMANDS=1
export ZMART_EDGE_MQTT_PASSWD_FILE=/mosquitto/config/passwd
export ZMART_EDGE_MQTT_ACL_FILE=/mosquitto/config/acl
export ZMART_EDGE_MOSQUITTO_PASSWD_BIN=mosquitto_passwd
export ZMART_EDGE_MQTT_RELOAD_CMD='docker kill -s HUP hvac-mosquitto'
# optional fallback
export ZMART_EDGE_MQTT_RESTART_CMD='docker restart hvac-mosquitto'
```

Optional overrides:

- `ZMART_EDGE_DRY_RUN_ACL_WRITE=1` force dry-run ACL generation even when command mode is enabled.
