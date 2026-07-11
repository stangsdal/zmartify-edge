# Zmartify Device Integration Guide

This guide covers how an ESP32-based device connects to the Zmartify Edge server,
gets claimed, receives MQTT credentials, and receives OTA updates.

## 1. Required server settings

Set these backend environment variables to the public URLs that devices should use:

```bash
ZMART_EDGE_PUBLIC_API_BASE=https://pilot.zmartify.dk
ZMART_EDGE_PUBLIC_MQTT_URI=mqtts://mqtt.pilot.zmartify.dk:8883
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

Recommended sequence:

1. Create the domain and site in the admin API.
2. Discover the device using its local base URL.
3. Claim the device with the domain, site, and optional claim token.
4. Push configuration to the device.
5. Verify onboarding status until MQTT is connected.

Example discovery request:

```bash
curl -X POST https://pilot.zmartify.dk/devices/discover \
  -H 'Authorization: Bearer <admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{"base_url":"192.168.10.60"}'
```

Example claim request:

```bash
curl -X POST https://pilot.zmartify.dk/devices/claim \
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
mqtt_uri = mqtts://mqtt.pilot.zmartify.dk:8883
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