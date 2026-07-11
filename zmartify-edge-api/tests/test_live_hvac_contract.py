from __future__ import annotations

import json
import os
from urllib import error, request

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
