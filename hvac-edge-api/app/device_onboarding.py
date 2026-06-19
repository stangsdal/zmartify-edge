from __future__ import annotations

import json
import socket
from urllib import error, request


class DeviceOnboardingError(RuntimeError):
    pass


def normalize_device_base_url(base_url: str) -> str:
    cleaned = base_url.strip()
    if not cleaned:
        raise DeviceOnboardingError("device base_url is required")
    if "://" not in cleaned:
        cleaned = f"http://{cleaned}"
    return cleaned.rstrip("/")


def _request_json(method: str, url: str, payload: dict | None = None) -> dict:
    data: bytes | None = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=10) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise DeviceOnboardingError(f"device request failed: {exc.code} {detail}") from exc
    except error.URLError as exc:
        raise DeviceOnboardingError(f"device request failed: {exc.reason}") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise DeviceOnboardingError("device request failed: timed out") from exc

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise DeviceOnboardingError("device returned invalid json") from exc


def discover_remote_device(base_url: str) -> dict:
    normalized = normalize_device_base_url(base_url)
    identity = _request_json("GET", f"{normalized}/identity")
    status = _request_json("GET", f"{normalized}/onboarding/status")
    try:
        claim = _request_json("GET", f"{normalized}/claim-token")
    except DeviceOnboardingError as exc:
        # Claimed devices intentionally reject claim-token requests with 409.
        if status.get("state") == "unclaimed":
            raise
        if "device request failed: 409" not in str(exc):
            raise
        claim = {
            "device_id": identity.get("device_id", ""),
            "claim_token": "",
            "expires_in_s": 0,
            "error": "device already claimed",
        }
    return {
        "base_url": normalized,
        "identity": identity,
        "claim": claim,
        "status": status,
    }


def push_remote_onboarding_config(base_url: str, payload: dict) -> dict:
    normalized = normalize_device_base_url(base_url)
    return _request_json("POST", f"{normalized}/onboarding/configure", payload)


def get_remote_onboarding_status(base_url: str) -> dict:
    normalized = normalize_device_base_url(base_url)
    return _request_json("GET", f"{normalized}/onboarding/status")


def _request_octet_stream_json(method: str, url: str, payload: bytes, timeout_s: int = 120) -> dict:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/octet-stream",
    }

    req = request.Request(url, data=payload, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout_s) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise DeviceOnboardingError(f"device request failed: {exc.code} {detail}") from exc
    except error.URLError as exc:
        raise DeviceOnboardingError(f"device request failed: {exc.reason}") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise DeviceOnboardingError("device request failed: timed out") from exc

    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise DeviceOnboardingError("device returned invalid json") from exc


def push_remote_firmware(base_url: str, firmware_bytes: bytes) -> dict:
    normalized = normalize_device_base_url(base_url)
    if not firmware_bytes:
        raise DeviceOnboardingError("firmware payload is empty")
    return _request_octet_stream_json("POST", f"{normalized}/ota", firmware_bytes, timeout_s=180)


def trigger_remote_reboot(base_url: str) -> dict:
    normalized = normalize_device_base_url(base_url)
    return _request_json("POST", f"{normalized}/reboot")
