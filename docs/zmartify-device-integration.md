# Zmartify Device Integration Guide

This guide covers how an ESP32-based device connects outbound to the Zmartify
Edge server, gets claimed, receives MQTT credentials, and receives OTA updates.

## 1. Required server settings

Set these backend environment variables to the public URLs that devices should use:

```bash
ZMART_EDGE_PUBLIC_API_BASE=https://api.zmartify.dk
ZMART_EDGE_PUBLIC_MQTT_URI=mqtts://mqtt.zmartify.dk:8883
```

The server returns these values in onboarding payloads. For lab setups you can
still connect directly to a LAN broker, but the production flow should use the
public endpoints above.

## 2. Device requirements

Each device needs:

- A stable device ID such as `zmartify-gateway-aabbccddeeff`
- A base URL for the local device HTTP endpoint during onboarding
- MQTT support for Homie-style topics under `homie/5`
- An HTTP endpoint for claim, status, firmware, and reboot operations

## 3. Onboarding flow

The backend exposes these endpoints for device setup:

- `POST /devices/discover`
- `POST /devices/claim`
- `POST /devices/{device_id}/push-config`
- `GET /devices/{device_id}/onboarding-status`

The Edge server must not connect into the device's private LAN. The preferred
production sequence is:

1. Create the domain and site in the admin API.
2. Scan the device QR code in the Zmartify app and authenticate an existing
   user or create a user account.
3. Prepare/stage the device claim for the selected site.
4. Connect the device to local Wi-Fi. The unclaimed device generates a short-
   lived claim token and polls the public bootstrap endpoint over HTTPS.
5. The Edge returns the device-admin token and MQTT credentials; the device
   connects outbound to `mqtt.zmartify.dk:8883` and starts telemetry.
6. Verify the device is online in the app.

Local `/identity`, `/claim-token`, and `/onboarding/status` calls are bench and
diagnostic tools only. They are not required for a customer installation.

The current legacy admin screen still exposes local discovery/claim and must
not be used as the production QR flow until it is replaced by the staged QR
flow described above.

Before treating onboarding as ready, verify that the customer's network allows
the gateway's outbound DNS and HTTPS traffic to `api.zmartify.dk` (TCP 443)
and outbound TLS MQTT traffic to `mqtt.zmartify.dk` (TCP 8883). No inbound NAT,
port forward, or Edge-to-device route is required. A gateway can therefore be
reachable from a technician's local workstation while still being unable to
complete onboarding if its own VLAN has no Internet egress or blocks these
destinations.

The current AHC9000 firmware generates its short-lived claim token locally;
the existing device QR material is not yet a cryptographic device-pairing
secret. The temporary bench procedure can stage that token after local
diagnostics, but a production QR flow should be completed by provisioning a
factory pairing secret (or an equivalent authenticated enrollment mechanism)
and having the device present it to the public bootstrap endpoint. A QR code
containing only the device ID must not be treated as proof of device ownership.

Example discovery request:

```bash
curl -X POST https://api.zmartify.dk/devices/discover \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{"base_url":"192.168.10.60"}'
```

Example claim request:

```bash
curl -X POST https://api.zmartify.dk/devices/claim \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "base_url":"192.168.10.60",
    "claim_token":"123456",
    "domain_id":1,
    "site_id":1,
    "display_name":"Boiler Room Gateway"
  }'
```

The push-config payload includes:

- `device_admin_token`
- `edge_url`
- `mqtt_uri`
- `mqtt_username`
- `mqtt_password`
- `mqtt_base` set to `homie/5`
- `domain_id`
- `site_id`
- optional `claim_token`

## 4. MQTT configuration

Devices should publish and subscribe under:

```text
homie/5/<device-id>/...
```

The backend provisions a unique MQTT username and password per device. A
typical device-side configuration looks like this:

```text
mqtt_enabled = true
mqtt_uri = mqtts://mqtt.zmartify.dk:8883
mqtt_username = device_<device-id>
mqtt_password = <provisioned-password>
mqtt_base = homie/5
mqtt_qos = 1
mqtt_retain = true
```

Example retained state topic:

```text
homie/5/zmartify-gateway-aabbccddeeff/$state ready
```

Example setpoint command topic:

```text
homie/5/zmartify-gateway-aabbccddeeff/zone-1/target-temperature/set
```

## 5. OTA flow

The backend supports two OTA paths:

- Direct device OTA via `POST /devices/{device_id}/ota`
- Staged OTA via `POST /devices/{device_id}/ota/stage`

Recommended staged sequence:

1. Upload firmware bytes to `/devices/{device_id}/ota/stage?version=<semver>`.
2. Poll `/devices/{device_id}/ota/poll?current_version=<version>`.
3. Download from `/devices/{device_id}/ota/download?sha256=<hash>`.
4. Apply firmware on the device.
5. Call `/devices/{device_id}/firmware/refresh` if you need to re-read staged metadata.

## 6. Implementation notes

- The server requires a site assignment before `push-config` will succeed.
- Device auth is enforced with the provisioned device admin token.
- The current implementation is built around ESP32-S3 hardware and Homie-style
  MQTT topics.
- Keep MQTT local-first for lab setups and use TLS for production deployment.
