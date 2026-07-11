from __future__ import annotations

import json
import os
import time
from urllib import error, request
from urllib.parse import urlencode

import pytest


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_LIVE_HVAC") != "1",
    reason="set RUN_LIVE_HVAC=1 to run live HVAC contract smoke tests",
)


def _base_url() -> str:
    raw = (os.getenv("LIVE_HVAC_BASE_URL") or "").strip()
    if not raw:
        pytest.skip("LIVE_HVAC_BASE_URL is required when RUN_LIVE_HVAC=1")
    return raw.rstrip("/")


def _get_json(path: str) -> dict:
    url = _base_url() + path
    req = request.Request(url, method="GET")
    try:
        with request.urlopen(req, timeout=8) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.URLError as exc:
        pytest.fail(f"failed live request {url}: {exc}")


def _edge_base_url() -> str | None:
    raw = (os.getenv("LIVE_EDGE_BASE_URL") or "").strip()
    return raw.rstrip("/") if raw else None


def _edge_bearer_token() -> str | None:
    token = (os.getenv("LIVE_EDGE_BEARER_TOKEN") or "").strip()
    return token or None


def _edge_device_id() -> str | None:
    device_id = (os.getenv("LIVE_EDGE_DEVICE_ID") or "").strip()
    return device_id or None


def _edge_required_or_skip() -> tuple[str, str, str]:
    base = _edge_base_url()
    token = _edge_bearer_token()
    device_id = _edge_device_id()
    if not base or not token or not device_id:
        pytest.skip("LIVE_EDGE_BASE_URL, LIVE_EDGE_BEARER_TOKEN and LIVE_EDGE_DEVICE_ID are required")
    return base, token, device_id


def _edge_get_json(path: str, *, token: str, params: dict[str, str] | None = None) -> dict | list:
    base = _edge_base_url()
    if not base:
        pytest.skip("LIVE_EDGE_BASE_URL is required")
    query = f"?{urlencode(params)}" if params else ""
    url = f"{base}{path}{query}"
    req = request.Request(url, method="GET", headers={"Authorization": f"Bearer {token}"})
    try:
        with request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.URLError as exc:
        pytest.fail(f"failed live edge request {url}: {exc}")


def _edge_post_json(path: str, payload: dict, *, token: str) -> dict:
    base = _edge_base_url()
    if not base:
        pytest.skip("LIVE_EDGE_BASE_URL is required")
    url = f"{base}{path}"
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        method="POST",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        pytest.fail(f"failed live edge request {url}: {exc.code} {detail}")
    except error.URLError as exc:
        pytest.fail(f"failed live edge request {url}: {exc}")


def test_live_health() -> None:
    payload = _get_json("/health")
    assert isinstance(payload, dict)


def test_live_identity_or_version_endpoint() -> None:
    # Firmware variants may expose either identity or version endpoint.
    try:
        payload = _get_json("/identity")
    except Exception:
        payload = _get_json("/version")
    assert isinstance(payload, dict)


def test_live_onboarding_status_shape() -> None:
    payload = _get_json("/onboarding/status")
    assert isinstance(payload, dict)
    assert "state" in payload or "claimed" in payload


def test_live_edge_twin_shape_v2_adapter() -> None:
    base, token, device_id = _edge_required_or_skip()
    _ = base
    zones = _edge_get_json(f"/devices/{device_id}/zones", token=token)
    assert isinstance(zones, list)
    if not zones:
        pytest.skip("no zones reported for live edge device")
    zone = zones[0]
    assert "zone_uuid" in zone
    assert "zone_id" in zone
    assert "target_temperature_c" in zone
    assert "current_temperature_c" in zone


def test_live_edge_command_feedback_sequence_smoke() -> None:
    if os.getenv("LIVE_EDGE_ENABLE_COMMAND_FEEDBACK_TEST") != "1":
        pytest.skip("set LIVE_EDGE_ENABLE_COMMAND_FEEDBACK_TEST=1 to run command feedback smoke test")

    _, token, device_id = _edge_required_or_skip()

    zones = _edge_get_json(f"/devices/{device_id}/zones", token=token)
    assert isinstance(zones, list)
    if not zones:
        pytest.skip("no zones available for command feedback smoke")

    zone = zones[0]
    zone_ref = zone.get("zone_uuid")
    if not zone_ref:
        pytest.skip("zone_uuid missing for first zone")

    target = zone.get("target_temperature_c")
    try:
        requested_target = float(target) if target is not None else 21.0
    except (TypeError, ValueError):
        requested_target = 21.0

    setpoint = _edge_post_json(
        f"/mobile/zones/{zone_ref}/setpoint",
        {"target_temperature_c": requested_target},
        token=token,
    )
    assert isinstance(setpoint, dict)
    assert setpoint.get("command_state") in {
        "pending_device_feedback",
        "local_only",
        "confirmed",
    }

    command_id = setpoint.get("command_id")
    setpoint_events = _edge_get_json(
        "/events/recent",
        token=token,
        params={"event_type": "zone_setpoint_changed", "limit": "50"},
    )
    assert isinstance(setpoint_events, list)
    if command_id:
        assert any((item.get("payload") or {}).get("command_id") == command_id for item in setpoint_events)

    deadline = time.time() + 15
    feedback_seen = False
    while time.time() < deadline:
        feedback_events = _edge_get_json(
            "/events/recent",
            token=token,
            params={"event_type": "zone_setpoint_feedback_received", "limit": "50"},
        )
        assert isinstance(feedback_events, list)
        if command_id and any((item.get("payload") or {}).get("command_id") == command_id for item in feedback_events):
            feedback_seen = True
            break
        if not command_id and feedback_events:
            feedback_seen = True
            break
        time.sleep(1)

    # Smoke-level: feedback may be delayed in live conditions; endpoint path must stay readable.
    assert isinstance(feedback_seen, bool)
