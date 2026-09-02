# Zmartify Edge - Raspberry Pi clean v2 installation

This is the canonical installation guide for the new Edge runtime. It assumes
an empty deployment and does not restore historical SQLite or PostgreSQL data.

## Target

Use a Raspberry Pi 4 or 5 with 4 GB RAM or more, 64-bit Raspberry Pi OS Lite,
Ethernet and preferably an SSD. Configure a fixed DHCP reservation and the
hostname `zmartify-edge`.

Public DNS records should point to the Pi (or its reverse proxy):

```text
app.zmartify.dk    user application
admin.zmartify.dk  system administration
api.zmartify.dk    API and web assets
mqtt.zmartify.dk   MQTT over TLS
```

The TLS certificate must cover all four names. Certbot stores the source
certificate under `/etc/letsencrypt/live/app.zmartify.dk/`; a deploy hook copies
the active certificate into the project’s `acme/` mount with restricted
permissions. Standalone renewal briefly stops the HTTP redirect container so
Certbot can bind port 80. A wildcard certificate for `*.zmartify.dk` is also
suitable.

## Operating-system preparation

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y git curl jq ufw ca-certificates
sudo raspi-config
```

Enable SSH, set the hostname, select the correct timezone, and reboot. Keep
the Pi on Ethernet. SSH is a management-plane service and must be allowed only
from the trusted management networks `192.168.1.0/24` and `192.168.14.0/24`.
Do not allow SSH from `192.168.20.0/24`; that subnet contains other DMZ
servers. TCP ports 80, 443 and 8883 are handled separately below.

## Docker and checkout

```bash
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sudo sh /tmp/get-docker.sh
sudo usermod -aG docker "$USER"
sudo reboot
```

After reboot:

```bash
git clone https://github.com/stangsdal/zmartify-edge.git ~/zmartify-edge
cd ~/zmartify-edge
cp .env.example .env
mkdir -p mosquitto/config mosquitto/data mosquitto/log zmartify-admin/dist
```

Edit `.env` and replace every `replace-with-...` value. Do not commit `.env`.

## Build and start

Build the one active frontend:

```bash
cd zmartify-admin
npm ci
npm run build
cd ..
```

Validate the merged Compose configuration, then start the clean runtime:

```bash
docker compose config >/tmp/zmartify-edge-compose.yml
docker compose up -d --build
```

The runtime contains one API process, PostgreSQL/TimescaleDB, Mosquitto, a
backup sidecar, and an HTTP-to-HTTPS redirect. There is no second API process
and no deployed legacy `admin-ui` bundle.

## First checks

```bash
docker compose ps
curl -k https://127.0.0.1/health
curl -k https://127.0.0.1/health/ready
curl -k https://127.0.0.1/registry/status
docker compose logs --tail=100 zmartify-edge-api
```

Verify externally after DNS and certificate installation:

```bash
curl -I https://app.zmartify.dk/
curl -I https://admin.zmartify.dk/
curl https://api.zmartify.dk/health
```

The web clients use their current HTTPS host for API calls by default, so no
browser CORS configuration is required. `api.zmartify.dk` is the canonical
machine-facing API hostname.

The first administrator is created by the application bootstrap flow. Use
`admin.zmartify.dk` for system setup, then create sites and invite site users.
Normal users should use `app.zmartify.dk` and can only see sites and products
allowed by their active site memberships.

Install the certificate hooks on the Pi:

```bash
sudo install -m 0755 scripts/deploy_certbot_cert.sh \
  /etc/letsencrypt/renewal-hooks/deploy/zmartify-edge.sh
sudo install -m 0755 scripts/certbot-pre-stop-http-redirect.sh \
  /etc/letsencrypt/renewal-hooks/pre/zmartify-edge-stop-http.sh
sudo install -m 0755 scripts/certbot-post-start-http-redirect.sh \
  /etc/letsencrypt/renewal-hooks/post/zmartify-edge-start-http.sh
sudo certbot renew --dry-run
```

## MQTT and firewall

The broker accepts internal MQTT on the Docker network and public TLS MQTT on
8883. Do not expose PostgreSQL or port 1883 on the host. The application
generates the broker ACL from the device/site registry.

Device onboarding is outbound-only. An unclaimed gateway polls the public
bootstrap endpoint over HTTPS and then opens its own TLS MQTT connection to
`mqtt.zmartify.dk:8883`; the Edge must never call into a gateway's private LAN.
The customer-facing QR flow stages the device claim against a selected site
before the gateway is powered on or connected to local Wi-Fi.

Example firewall baseline:

```bash
sudo ufw default deny incoming
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw allow from 192.168.14.0/24 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8883/tcp
sudo ufw enable
```

There must be no SSH allow rule for `192.168.20.0/24`. UFW rule order is not
the design control here; the intended policy is that incoming traffic is denied
by default and only the two listed management subnets are allowed to TCP/22.
If an older broader SSH rule exists, remove it before enabling the baseline.

Raspberry Pi Connect is separate from this inbound SSH policy. It normally
uses connections initiated by the Pi to Raspberry Pi Connect services rather
than requiring port 22 to be reachable from the DMZ. Preserve outbound access
for HTTPS/WebSocket on TCP 443 and, where required by the network, the
documented STUN/TURN ports. Validate on the Pi with:

```bash
rpi-connect doctor
```

If Raspberry Pi Connect is used as a recovery path, test it independently; do
not widen the SSH rule to the DMZ subnet just to support Connect.

## Backups and operations

The `edge-db-backup` service writes PostgreSQL dumps to its Docker volume.
Run and inspect a restore drill regularly:

```bash
docker compose run --rm --entrypoint bash edge-db-backup \
  /usr/local/bin/backup_edge_db.sh backup --backend postgres --out /backups --keep 14
docker compose run --rm --entrypoint bash edge-db-backup \
  /usr/local/bin/backup_edge_db.sh restore-drill --backend postgres --out /backups
```

Useful commands:

```bash
docker compose logs --tail=200 zmartify-edge-api
docker compose logs --tail=200 mosquitto
docker compose restart zmartify-edge-api
docker compose up -d --build zmartify-edge-api
```

For a clean reinstall, stop the stack and replace the deployment directory
only after confirming that no data is needed. This guide does not prescribe
deleting volumes; that is an explicit operator decision.

# AHC9000 data model

For AHC9000 devices, Edge must treat each Wavin channel with a thermostat
assignment as one public HVAC zone. Each channel-zone owns one or more assigned
elements: thermostat elements provide room telemetry, while valve elements
provide valve membership, output and current data. The mapping is read from the
controller's live element assignment data and persisted in
`zone_state.controlled_element_ids_json`; Edge must not maintain a hardcoded
channel-to-element table. Packed setpoint values are read and written by the
zone's single Modbus channel. Channel 17 is separate and is not a room zone.

Controller-wide telemetry is stored separately. The Modbus inlet sensor is
represented as `inlet_temperature_c` (the English field name for fremløb), and
unknown sensor values are `null`, not zero.
