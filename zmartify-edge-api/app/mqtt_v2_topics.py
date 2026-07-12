from __future__ import annotations

import os
import re

_TOPIC_SEGMENT_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _clean_segment(value: str, fallback: str) -> str:
    text = (value or "").strip()
    if text and _TOPIC_SEGMENT_RE.fullmatch(text):
        return text
    return fallback


def _legacy_base() -> str:
    return os.getenv("ZMART_EDGE_COMMAND_MQTT_BASE", "homie/5").strip().rstrip("/") or "homie/5"


def _v2_base() -> str:
    return os.getenv("ZMART_EDGE_COMMAND_MQTT_V2_BASE", "zmartify/v2").strip().rstrip("/") or "zmartify/v2"


def _topic_style() -> str:
    style = os.getenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "legacy").strip().lower()
    if style in {"legacy", "v2", "dual"}:
        return style
    return "legacy"


def command_topics_for_setpoint(device_id: str, zone_id: int) -> list[str]:
    safe_device = _clean_segment(device_id, "device")
    safe_zone = max(1, int(zone_id))

    legacy = f"{_legacy_base()}/{safe_device}/zone-{safe_zone}/target-temperature/set"
    v2 = f"{_v2_base()}/devices/{safe_device}/commands/hvac/zones/{safe_zone}/setpoint"

    style = _topic_style()
    if style == "v2":
        return [v2]
    if style == "dual":
        return [legacy, v2]
    return [legacy]


def command_topics_for_zone_name(device_id: str, zone_id: int) -> list[str]:
    safe_device = _clean_segment(device_id, "device")
    safe_zone = max(1, int(zone_id))

    legacy = f"{_legacy_base()}/{safe_device}/zone-{safe_zone}/$name/set"
    v2 = f"{_v2_base()}/devices/{safe_device}/commands/hvac/zones/{safe_zone}/name"

    style = _topic_style()
    if style == "v2":
        return [v2]
    if style == "dual":
        return [legacy, v2]
    return [legacy]


def outcome_subscription_topics(device_id: str) -> list[str]:
    safe_device = _clean_segment(device_id, "device")

    legacy = f"{_legacy_base()}/{safe_device}/+/last-setpoint-command"
    v2 = f"{_v2_base()}/devices/{safe_device}/events/hvac/zones/+/setpoint-outcome"

    style = _topic_style()
    if style == "v2":
        return [v2]
    if style == "dual":
        return [legacy, v2]
    return [legacy]


def parse_setpoint_outcome_topic(topic: str) -> tuple[str, int] | None:
    parts = str(topic or "").split("/")

    # Legacy: homie/5/<device>/zone-<zone_id>/last-setpoint-command
    if len(parts) >= 5 and parts[-1] == "last-setpoint-command":
        node = parts[-2]
        if node.startswith("zone-"):
            try:
                zone_id = int(node[5:])
            except ValueError:
                zone_id = 0
            if zone_id > 0:
                return parts[-3], zone_id

    # v2: zmartify/v2/devices/<device>/events/hvac/zones/<zone_id>/setpoint-outcome
    if len(parts) >= 9 and parts[-1] == "setpoint-outcome":
        try:
            devices_idx = parts.index("devices")
            zones_idx = parts.index("zones")
        except ValueError:
            devices_idx = -1
            zones_idx = -1
        if devices_idx >= 0 and zones_idx > devices_idx + 1 and zones_idx + 1 < len(parts):
            device_id = parts[devices_idx + 1]
            try:
                zone_id = int(parts[zones_idx + 1])
            except ValueError:
                zone_id = 0
            if device_id and zone_id > 0:
                return device_id, zone_id

    return None
