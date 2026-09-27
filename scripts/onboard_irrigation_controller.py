#!/usr/bin/env python3
from __future__ import annotations

import getpass
import json
import os
import secrets
import ssl
import sys
import urllib.error
import urllib.request

EDGE_URL = os.getenv("EDGE_BASE_URL", "https://api.zmartify.dk").rstrip("/")
DEVICE_URL = os.getenv("DEVICE_BASE_URL", "http://192.168.10.113").rstrip("/")
DEVICE_ID = os.getenv("DEVICE_ID", "zmartify-irrigation-01")
DISPLAY_NAME = os.getenv("DISPLAY_NAME", "Zmartify Irrigation")
DOMAIN_ID = int(os.getenv("DOMAIN_ID", "1"))
SITE_ID = int(os.getenv("SITE_ID", "1"))


def request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, object] | None = None,
    bearer_token: str | None = None,
) -> dict[str, object]:
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20, context=ssl.create_default_context()) as response:
            response_body = response.read().decode("utf-8")
            return json.loads(response_body) if response_body.strip() else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
    except (TimeoutError, OSError, urllib.error.URLError) as exc:
        raise RuntimeError(f"Unable to contact {url}: {exc}") from exc


def required_secret(environment_name: str, prompt: str) -> str:
    value = os.getenv(environment_name, "").strip()
    if not value:
        value = getpass.getpass(prompt).strip()
    if not value:
        raise RuntimeError(f"{environment_name} is required")
    return value


def main() -> int:
    edge_username = os.getenv("ZMART_EDGE_USERNAME", "admin").strip() or "admin"
    edge_password = required_secret("ZMART_EDGE_PASSWORD", "Edge admin password: ")
    controller_token = required_secret("ZIC_HTTP_ADMIN_TOKEN", "Controller HTTP admin token: ")

    health = request_json(f"{DEVICE_URL}/health")
    firmware_version = str(health.get("firmware_version") or "").strip() or None

    login = request_json(
        f"{EDGE_URL}/auth/login",
        method="POST",
        payload={"username": edge_username, "password": edge_password},
    )
    access_token = str(login.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("Edge login did not return an access token")

    claim_token = f"{secrets.randbelow(1_000_000):06d}"
    staged = request_json(
        f"{EDGE_URL}/api/v2/devices/bootstrap/stage",
        method="POST",
        bearer_token=access_token,
        payload={
            "device_id": DEVICE_ID,
            "claim_token": claim_token,
            "domain_id": DOMAIN_ID,
            "site_id": SITE_ID,
            "display_name": DISPLAY_NAME,
            "firmware_version": firmware_version,
            "product_type": "irrigation",
        },
    )
    if staged.get("state") != "staged":
        raise RuntimeError("Edge did not stage the controller")

    config = request_json(
        f"{EDGE_URL}/api/v2/device-bootstrap/config",
        method="POST",
        payload={"device_id": DEVICE_ID, "claim_token": claim_token},
    )
    mqtt_uri = str(config.get("mqtt_uri") or "").strip()
    mqtt_username = str(config.get("mqtt_username") or "").strip()
    mqtt_password = str(config.get("mqtt_password") or "").strip()
    if not mqtt_uri or not mqtt_username or not mqtt_password:
        raise RuntimeError("Edge bootstrap response omitted MQTT configuration")

    network_result = request_json(
        f"{DEVICE_URL}/config/network",
        method="POST",
        bearer_token=controller_token,
        payload={
            "mqtt_broker_uri": mqtt_uri,
            "mqtt_port": 8883,
            "mqtt_username": mqtt_username,
            "mqtt_password": mqtt_password,
            "mqtt_tls_enabled": True,
        },
    )
    if not network_result.get("ok"):
        raise RuntimeError("Controller rejected MQTT configuration")

    request_json(f"{DEVICE_URL}/reboot", method="POST", bearer_token=controller_token)
    print(f"Staged {DEVICE_ID} for domain {DOMAIN_ID}, site {SITE_ID}.")
    print("MQTT configuration accepted; controller reboot requested.")
    print("No credentials were written to disk or printed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
