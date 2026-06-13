# hvac-edge-api (Phase B in progress)

This directory contains the initial backend scaffold for the Raspberry Pi edge milestone.

## What is implemented

- FastAPI app entrypoint (`main.py`)
- Startup-time SQLite migration runner
- Migration `001_init.sql` with registry schema
- Phase B registry CRUD endpoints for domains, sites, and devices
- Placeholders for MQTT users, ACL generation, and security helpers

## Local run (dev)

```bash
cd edge/hvac-edge-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

## Compose run

```bash
cd edge
docker compose up -d --build
```

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
