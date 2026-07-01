# zmartify-edge

Edge control-plane repository for Zmartify HVAC.

This repository contains:
- Public Edge API (FastAPI)
- Admin and mobile web apps
- MQTT broker configuration
- Docker Compose deployment setup

## Repository Structure

- hvac-edge-api/: FastAPI backend (public API, onboarding, ACL, registry, mobile APIs)
- hvac-admin/: Ionic admin/mobile UI
- admin-ui/: operational admin UI
- mosquitto/: broker config and runtime paths
- docs/: operations and setup guides
- docker-compose.yml: production-oriented service orchestration

## Requirements

- Docker Engine 24+
- Docker Compose v2+
- Linux host (Raspberry Pi supported)
- TLS certificate files mounted under ./acme for HTTPS/TLS endpoints

## Quick Start (Compose)

1. Clone and enter repository.

```bash
git clone https://github.com/stangsdal/zmartify-edge.git
cd zmartify-edge
```

2. Ensure required directories exist.

```bash
mkdir -p mosquitto/config mosquitto/data mosquitto/log acme admin-ui/dist hvac-admin/dist
```

3. Build frontend artifacts (if not already present).

```bash
cd admin-ui && npm ci && npm run build
cd ../hvac-admin && npm ci && npm run build
cd ..
```

4. Start services.

```bash
docker compose up -d --build
```

5. Verify health.

```bash
curl -k https://localhost/health
curl -k https://localhost/registry/status
```

## Core Environment Variables

Configured in docker-compose.yml for hvac-edge-api:

- MQTT_HOST=mosquitto
- MQTT_PORT=1883
- HVAC_EDGE_DB_PATH=/data/hvac-edge.sqlite
- HVAC_EDGE_APPLY_MQTT_COMMANDS=1
- HVAC_EDGE_MQTT_ACL_FILE=/mosquitto/config/acl
- HVAC_EDGE_MQTT_PASSWD_FILE=/mosquitto/config/passwd
- HVAC_EDGE_MQTT_RELOAD_CMD=docker kill -s HUP hvac-mosquitto
- HVAC_EDGE_MQTT_RESTART_CMD=docker restart hvac-mosquitto
- HVAC_EDGE_FORWARD_SETPOINT_TO_MQTT=1
- HVAC_EDGE_PUBLIC_API_BASE=https://pilot.zmartify.dk
- HVAC_EDGE_PUBLIC_MQTT_URI=mqtts://mqtt.pilot.zmartify.dk:8883
- ADMIN_API_TOKEN=<token>

Optional:

- HVAC_EDGE_ENABLE_MANUAL_FIRMWARE_REFRESH=1 (enables manual firmware refresh endpoint)
- HVAC_EDGE_OTA_STAGE_DIR=/data/ota-stage

## API Overview

Base URL examples:
- Production: https://pilot.zmartify.dk
- Local HTTP container: http://localhost:8080
- Local HTTPS container: https://localhost

### Setup and Auth

- GET /setup/status
- POST /auth/login
- GET /auth/invite/validate
- POST /auth/register
- POST /auth/logout
- GET /auth/me

### Service and ACL

- GET /health
- GET /registry/status
- GET /admin/acl/status
- GET /admin/acl/preview/{client_id}
- POST /admin/acl/regenerate

### Invite Management

- POST /admin/invites/register
- POST /admin/invites/register/bulk
- GET /admin/invites/register

### Domain and Site Management

- POST /domains
- GET /domains
- GET /domains/{domain_id}
- POST /domains/{domain_id}/rename
- DELETE /domains/{domain_id}
- POST /domains/{domain_id}/sites
- GET /domains/{domain_id}/sites
- GET /sites/{site_id}
- DELETE /sites/{site_id}

### Device Lifecycle and Onboarding

- POST /devices
- GET /devices
- GET /devices/{device_id}
- POST /devices/discover
- POST /devices/claim
- POST /devices/{device_id}/assign-site
- POST /devices/{device_id}/rename
- DELETE /devices/{device_id}
- POST /devices/{device_id}/push-config
- GET /devices/{device_id}/onboarding-status

### OTA

- POST /devices/{device_id}/ota
- POST /devices/{device_id}/ota/stage
- GET /devices/{device_id}/ota/poll
- GET /devices/{device_id}/ota/download
- POST /devices/{device_id}/firmware/refresh

### Device State and Twin Ingest

- GET /devices/{device_id}/zones
- GET /devices/{device_id}/zones/{zone_id}
- POST /devices/{device_id}/zones/{zone_id}/rename
- POST /devices/{device_id}/zones/{zone_id}/metadata
- GET /devices/{device_id}/channels
- GET /devices/{device_id}/channels/{channel_id}
- POST /devices/{device_id}/channels/{channel_id}/metadata
- POST /devices/{device_id}/channels/{channel_id}/state
- POST /devices/{device_id}/channels/{channel_id}/link-zones
- POST /devices/{device_id}/ingest/twin

### Mobile API

- WebSocket /mobile/ws/zones/{zone_ref}
- GET /mobile/devices/{device_id}/freshness
- GET /mobile/sites
- GET /mobile/domains
- GET /mobile/sites/{site_id}
- GET /mobile/sites/{site_id}/devices
- GET /mobile/sites/{site_id}/zones
- GET /mobile/devices/{device_id}
- GET /mobile/devices/{device_id}/zones
- GET /mobile/devices/{device_id}/channels
- POST /mobile/zones/{zone_ref}/setpoint
- POST /mobile/zones/{zone_ref}/rename
- GET /mobile/zones/{zone_ref}/history
- GET /mobile/devices/{device_id}/history
- GET /mobile/events
- GET /mobile/notifications
- POST /mobile/notifications/read-all
- POST /mobile/notifications/{notification_id}/read

### MQTT Client Management

- POST /mqtt/clients
- GET /mqtt/clients
- GET /mqtt/clients/{client_id}
- POST /mqtt/clients/{client_id}/rotate-password
- POST /mqtt/clients/{client_id}/disable
- POST /mqtt/clients/{client_id}/enable
- DELETE /mqtt/clients/{client_id}

### Users and Audit

- POST /users
- GET /users
- GET /users/{user_id}
- POST /users/{user_id}/disable
- POST /users/{user_id}/enable
- POST /users/{user_id}/reset-password
- POST /users/{user_id}/roles
- DELETE /users/{user_id}
- GET /users/{user_id}/site-access
- POST /users/{user_id}/site-access
- GET /admin/audit-log

### Events

- GET /events
- GET /events/recent
- GET /events/device/{device_id}

## Operations

- Compose services:

```bash
docker compose ps
docker compose logs --tail=200 hvac-edge-api
docker compose logs --tail=200 mosquitto
```

- Restart API only:

```bash
docker compose restart hvac-edge-api
```

- Rebuild API image:

```bash
docker compose up -d --build hvac-edge-api
```

## Documentation

- Full edge setup guide: docs/hvac-edge-setup.md
- API implementation: hvac-edge-api/main.py
- Backend service notes: hvac-edge-api/README.md

## Notes

- The firmware repository is separate: hvac-gateway.
- For production, keep TLS certificates current and restrict host-level access to 80/443/8883 as needed.
