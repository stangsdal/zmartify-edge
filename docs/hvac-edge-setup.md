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
HVAC_EDGE_PUBLIC_API_BASE=https://pilot.zmartify.dk
HVAC_EDGE_PUBLIC_MQTT_URI=mqtts://mqtt.pilot.zmartify.dk:8883
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
mkdir -p hvac-edge-api
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

  hvac-edge-api:
    image: python:3.12-slim
    container_name: hvac-edge-api
    restart: unless-stopped
    working_dir: /app
    command: sh -c "pip install fastapi uvicorn paho-mqtt && uvicorn main:app --host 0.0.0.0 --port 8080"
    ports:
      - "443:8080"
    volumes:
      - ./hvac-edge-api:/app
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
nano hvac-edge-api/main.py
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
        "service": "hvac-edge-api",
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

## 12. Configure ESP32

On the ESP32 side, configure NVS or firmware settings:

```text
mqtt_enabled = true
mqtt_uri = mqtt://hvac-edge:1883
mqtt_username = esp32_hvac
mqtt_password = Zmartify2019
mqtt_base = homie/5
mqtt_qos = 1
mqtt_retain = true
```

The ESP32 project already has MQTT scaffolding, but publish functions currently return `ESP_ERR_NOT_SUPPORTED`, so firmware MQTT implementation must be completed before this will publish real data.

---

## 13. Expected ESP32 Topics

Once ESP32 MQTT is implemented, verify:

```bash
docker exec -it hvac-mosquitto mosquitto_sub \
  -h localhost \
  -u admin \
  -P '<admin-password>' \
  -t 'homie/5/#' \
  -v
```

Expected examples:

```text
homie/5/hvac-gateway-aabbccddeeff/$state ready
homie/5/hvac-gateway-aabbccddeeff/gateway/health ok
homie/5/hvac-gateway-aabbccddeeff/zone-1/current-temperature 21.4
homie/5/hvac-gateway-aabbccddeeff/zone-1/target-temperature 22.0
```

Setpoint command test:

```bash
docker exec -it hvac-mosquitto mosquitto_pub \
  -h localhost \
  -u admin \
  -P '<admin-password>' \
  -t 'homie/5/hvac-gateway-aabbccddeeff/zone-1/target-temperature/set' \
  -m '22.5'
```

The ESP32 must route this through its existing guarded setpoint write path.

---

## 14. Firewall

Enable firewall:

```bash
sudo ufw allow ssh
sudo ufw allow 1883/tcp
sudo ufw allow 8080/tcp
sudo ufw enable
sudo ufw status
```

For production, restrict MQTT to IoT VLAN only.

---

## 15. Home Assistant Setup

In Home Assistant:

1. Add MQTT integration.
2. Broker host: Raspberry Pi IP.
3. Port: `1883`.
4. Username: `homeassistant_house`.
5. Password: matching password.
6. Subscribe/inspect `homie/5/#`.

Do not expose Mosquitto directly to the internet.

---

## 16. Operational Checks

Run:

```bash
docker compose ps
docker compose logs --tail=100 mosquitto
curl http://localhost:8080/health
```

MQTT retained topic check:

```bash
docker exec -it hvac-mosquitto mosquitto_sub \
  -h localhost \
  -u admin \
  -P '<admin-password>' \
  -t 'homie/5/#' \
  -v \
  -C 20
```

---

## 17. Backup

Back up:

```bash
~/hvac-edge/docker-compose.yml
~/hvac-edge/mosquitto/config
~/hvac-edge/mosquitto/data
~/hvac-edge/hvac-edge-api
```

Simple backup command:

```bash
tar czf hvac-edge-backup-$(date +%Y%m%d).tar.gz ~/hvac-edge
```

---

## 18. Next Backend Milestones

After MQTT is working:

1. Add SQLite device registry.
2. Add domain/site/device model.
3. Add per-device MQTT credentials.
4. Add per-domain ACL generation.
5. Add Home Assistant Discovery or Homie-aware bridge.
6. Add cloud sync agent.
7. Add iPhone-app-ready command queue.
8. Add TLS for MQTT.
9. Add web admin UI.
10. Add future Matter bridge support.

---

## 19. Production Notes

Before production:

* Use unique MQTT credentials per ESP32.
* Use unique MQTT credentials per smart-home client.
* Add ACL generation.
* Add TLS.
* Add API authentication.
* Add audit logging.
* Disable debug endpoints from WAN.
* Keep HVAC control local-first.
* Do not require cloud for normal heating operation.
