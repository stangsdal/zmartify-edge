#!/usr/bin/env bash
set -euo pipefail

# Claim a LAN device when the public Edge API cannot reach the private LAN.
# Credentials and claim tokens are kept in memory and never printed.

EDGE_BASE_URL="${EDGE_BASE_URL:-https://pilot.zmartify.dk}"
DEVICE_BASE_URL="${DEVICE_BASE_URL:-http://192.168.10.142}"
DOMAIN_ID="${DOMAIN_ID:-1}"
SITE_ID="${SITE_ID:-1}"
DISPLAY_NAME="${DISPLAY_NAME:-Nilan Comfort 302}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

if [[ -z "${NILAN_PASSWORD:-}" ]]; then
    printf 'NILAN_PASSWORD is not set\n' >&2
    exit 2
fi

python3 - "$EDGE_BASE_URL" "$DEVICE_BASE_URL" "$DOMAIN_ID" "$SITE_ID" "$DISPLAY_NAME" <<'PY'
import json
import ssl
import sys
import os
import urllib.error
import urllib.request

try:
    TLS_CONTEXT = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
except OSError:
    TLS_CONTEXT = ssl.create_default_context()

# Never send private-LAN device traffic through a shell-configured proxy.
HTTP_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    urllib.request.HTTPSHandler(context=TLS_CONTEXT),
)

edge, device, domain_id, site_id, display_name = sys.argv[1:]
username = "admin"
password = os.environ["NILAN_PASSWORD"]

def request_json(url, method="GET", payload=None, headers=None):
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    h = {"Accept": "application/json"}
    if payload is not None:
        h["Content-Type"] = "application/json"
        h["Content-Length"] = str(len(body))
        h["Connection"] = "close"
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with HTTP_OPENER.open(req, timeout=20) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"HTTP {exc.code} from {url}: {detail}")
    except (TimeoutError, OSError) as exc:
        raise SystemExit(f"Network timeout/error contacting {url}: {exc}") from exc

identity = request_json(device.rstrip("/") + "/identity")
status = request_json(device.rstrip("/") + "/onboarding/status")
if status.get("state") != "unclaimed":
    raise SystemExit(f"Device is not unclaimed (state={status.get('state')!r})")

login = request_json(edge.rstrip("/") + "/auth/login", "POST", {
    "username": username,
    "password": password,
})
access_token = login.get("access_token")
if not access_token:
    raise SystemExit("Edge login did not return an access token")
auth = {"Authorization": f"Bearer {access_token}"}

# Fetch the short-lived local token only immediately before the Edge staging
# transaction, minimizing the time the device must remain in claim mode.
claim = request_json(device.rstrip("/") + "/claim-token")
claim_token = claim.get("claim_token")
if not claim_token:
    raise SystemExit("Device did not return a claim token")

stage = request_json(edge.rstrip("/") + "/api/v2/devices/bootstrap/stage", "POST", {
    "device_id": identity["device_id"],
    "claim_token": claim_token,
    "domain_id": int(domain_id),
    "site_id": int(site_id),
    "display_name": display_name,
    "firmware_version": identity.get("firmware_version"),
    "product_type": "hvac",
}, auth)

# The bootstrap endpoint is used as the credential/claim transaction, while
# the Mac performs the final local write because this device is LAN-only.
config = request_json(edge.rstrip("/") + "/api/v2/device-bootstrap/config", "POST", {
    "device_id": identity["device_id"],
    "claim_token": claim_token,
})
config_size = len(json.dumps(config, separators=(",", ":")).encode())
if config_size >= 4096:
    raise SystemExit(f"Onboarding payload is too large for current device firmware: {config_size} bytes")
request_json(device.rstrip("/") + "/onboarding/configure", "POST", config)
final_status = request_json(device.rstrip("/") + "/onboarding/status")

print(json.dumps({
    "device_id": identity["device_id"],
    "edge_stage": stage.get("state"),
    "device_state": final_status.get("state"),
    "mqtt_configured": final_status.get("mqtt_configured"),
    "edge_url_configured": final_status.get("edge_url_configured"),
}, indent=2))
PY
