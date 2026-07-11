# Zmartify Edge Raspberry Pi 4 Setup Guide

This guide is now maintained in the `zmartify-edge` repository.

- Repository scope: edge control plane (API, admin UI, broker, deployment)
- Firmware (ESP32) remains in the separate `hvac-gateway` repository
- Recommended local clone path: `~/zmartify-edge`

## Production Public Endpoints (Confirmed)

Use these public endpoints for deployed environments:

- Edge API base URL: `https://pilot.zmartify.dk`
- MQTT broker URI (TLS): `mqtts://mqtt.pilot.zmartify.dk:8883`

For device onboarding payloads, ensure backend env vars are set accordingly:

```bash
ZMART_EDGE_PUBLIC_API_BASE=https://pilot.zmartify.dk
ZMART_EDGE_PUBLIC_MQTT_URI=mqtts://mqtt.pilot.zmartify.dk:8883
```

Note: local IP examples elsewhere in this guide are for LAN diagnostics and direct ESP32 access only.

## 1. Recommended Hardware

Use:

* Raspberry Pi 4, 4 GB or 8 GB RAM
* Raspberry Pi OS Lite 64-bit
* Ethernet connection preferred
* Good quality power supply
* 32 GB+ SD card or SSD

Use 64-bit Raspberry Pi OS if possible. Docker’s official Raspberry Pi OS docs note that 32-bit support is more limited going forward.

---

## 2. Prepare Raspberry Pi OS

Update system:

```bash
sudo apt update
sudo apt upgrade -y
sudo reboot
```

Install useful tools:

```bash
sudo apt install -y git curl vim jq ufw
```

Set hostname:

```bash
sudo raspi-config
```

Suggested hostname:

```text
hvac-edge
```

---

## 3. Install Docker

Use Docker’s official install path for Raspberry Pi OS.

Quick development install:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

Allow your user to run Docker:

```bash
sudo usermod -aG docker $USER
sudo reboot
```

Verify:

```bash
docker version
docker compose version
```

---

## 4. Create Project Folder

Use `~/hvac-edge` as the runtime/deploy folder on the Raspberry Pi for compatibility with existing service scripts.
You can still keep the source repository cloned as `~/zmartify-edge` on your development machine.

```bash
mkdir -p ~/hvac-edge
cd ~/hvac-edge
```

Create folders:

```bash
mkdir -p mosquitto/config
mkdir -p mosquitto/data
mkdir -p mosquitto/log
mkdir -p zmartify-edge-api
mkdir -p caddy
```

---

## 5. Create Mosquitto Config

The official Mosquitto Docker image supports mounting custom config at `/mosquitto/config`.

Create:

```bash
nano mosquitto/config/mosquitto.conf
```

Paste:

```conf
persistence true
persistence_location /mosquitto/data/

log_dest file /mosquitto/log/mosquitto.log
log_dest stdout

allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl

listener 1883
protocol mqtt

# Future:
# listener 8883
# protocol mqtt
# cafile /mosquitto/config/ca.crt
# certfile /mosquitto/config/server.crt
# keyfile /mosquitto/config/server.key
```

---

## 6. Create MQTT Users

Create password file using the Mosquitto container:

```bash
docker run --rm -it \
  -v "$PWD/mosquitto/config:/mosquitto/config" \
  eclipse-mosquitto \
  mosquitto_passwd -c /mosquitto/config/passwd esp32_hvac
```

Add Home Assistant user:

```bash
docker run --rm -it \
  -v "$PWD/mosquitto/config:/mosquitto/config" \
  eclipse-mosquitto \
  mosquitto_passwd /mosquitto/config/passwd homeassistant_house
```

Add admin user:

```bash
docker run --rm -it \
  -v "$PWD/mosquitto/config:/mosquitto/config" \
  eclipse-mosquitto \
  mosquitto_passwd /mosquitto/config/passwd admin
```

---

## 7. Create MQTT ACL File

Create:

```bash
nano mosquitto/config/acl
```

Paste initial lab ACL:

```conf
user esp32_hvac
topic readwrite homie/5/+/#

user homeassistant_house
topic read homie/5/#
topic write homie/5/+/+/target-temperature/set

user admin
topic readwrite #
```

> **Note:** Mosquitto ACL wildcards must be standalone level components per the MQTT spec. `hvac-gateway-+` is invalid; use `+` per level. Later, replace with per-device and per-domain ACLs once dynamic security is enabled.

---

## 8. Create Docker Compose File

Create:

```bash
nano docker-compose.yml
```

Paste:

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:latest
    container_name: hvac-mosquitto
    restart: unless-stopped
    ports:
      - "8883:1883"
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - ./mosquitto/data:/mosquitto/data
      - ./mosquitto/log:/mosquitto/log

  zmartify-edge-api:
    image: python:3.12-slim
    container_name: zmartify-edge-api
    restart: unless-stopped
    working_dir: /app
    command: sh -c "pip install fastapi uvicorn paho-mqtt && uvicorn main:app --host 0.0.0.0 --port 8080"
    ports:
      - "443:8080"
    volumes:
      - ./zmartify-edge-api:/app
    environment:
      - MQTT_HOST=mosquitto
      - MQTT_PORT=1883
    depends_on:
      - mosquitto
```

---

## 9. Create Minimal Edge API

Create:

```bash
nano zmartify-edge-api/main.py
```

Paste:

```python
from fastapi import FastAPI
import os

app = FastAPI(title="HVAC Edge API")

@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "zmartify-edge-api",
        "mqtt_host": os.getenv("MQTT_HOST", "mosquitto")
    }

@app.get("/mqtt/status")
def mqtt_status():
    return {
        "configured": True,
        "host": os.getenv("MQTT_HOST", "mosquitto"),
        "port": int(os.getenv("MQTT_PORT", "1883"))
    }
```

---

## 10. Start Backend

```bash
docker compose up -d
```

Check containers:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f mosquitto
```

Check API:

```bash
curl http://localhost:8080/health
```

From another machine:

```bash
curl http://<raspberry-pi-ip>:8080/health
```

---

## 11. Test MQTT Broker

Subscribe:

```bash
docker exec -it hvac-mosquitto mosquitto_sub \
  -h localhost \
  -u admin \
  -P '<admin-password>' \
  -t 'homie/5/#' \
  -v
```

Publish test message in another terminal:

```bash
docker exec -it hvac-mosquitto mosquitto_pub \
  -h localhost \
  -u admin \
  -P '<admin-password>' \
  -t 'homie/5/test-device/$state' \
  -m 'ready' \
  -r
```

Expected subscriber output:

```text
homie/5/test-device/$state ready
```

---

## 12. Device Integration Guide

Device onboarding, MQTT topic conventions, and OTA procedures now live in [docs/zmartify-device-integration.md](docs/zmartify-device-integration.md).

That guide is the source of truth for firmware developers building IoT devices
against this server.

---

## 13. Legacy Notes

This file is preserved as a broader deployment reference for Raspberry Pi and
broker setup. For new device firmware work, use the integration guide above so
the onboarding flow stays aligned with the current API.
