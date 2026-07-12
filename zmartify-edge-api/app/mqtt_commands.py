from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import shlex
import subprocess
import uuid

from app.contracts import ContractValidationError, validate_mqtt_v2_command
from app.registry import get_device_mqtt_credentials
from app.mqtt_v2_topics import command_topics_for_setpoint, command_topics_for_zone_name


class MqttCommandError(RuntimeError):
    """Raised when a MQTT command publish fails."""


def _mqtt_host() -> str:
    return os.getenv("MQTT_HOST", "mosquitto").strip() or "mosquitto"


def _mqtt_port() -> int:
    raw = os.getenv("MQTT_PORT", "1883").strip() or "1883"
    try:
        return int(raw)
    except ValueError:
        return 1883


def _mqtt_base_topic() -> str:
    return os.getenv("ZMART_EDGE_COMMAND_MQTT_BASE", "homie/5").strip().rstrip("/") or "homie/5"


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def should_forward_setpoint_commands() -> bool:
    raw = os.getenv("ZMART_EDGE_FORWARD_SETPOINT_TO_MQTT", "0")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _mosquitto_pub_command() -> list[str]:
    configured = os.getenv("ZMART_EDGE_MOSQUITTO_PUB_BIN", "mosquitto_pub")
    cmd = shlex.split(configured)
    if not cmd:
        raise MqttCommandError("empty mosquitto_pub command")
    return cmd


def _device_mqtt_credentials(device_id: str) -> tuple[str, str]:
    creds = get_device_mqtt_credentials(device_id)
    username = str(creds.get("username") or "").strip()
    password = str(creds.get("password") or "").strip()
    if not username or not password:
        raise MqttCommandError("device mqtt credentials unavailable")
    return username, password


def _publish_command(device_id: str, topic_suffix: str, payload: str) -> None:
    username, password = _device_mqtt_credentials(device_id)

    topic = f"{_mqtt_base_topic()}/{device_id}/{topic_suffix.lstrip('/')}"

    cmd = _mosquitto_pub_command()
    cmd.extend(
        [
            "-h",
            _mqtt_host(),
            "-p",
            str(_mqtt_port()),
            "-u",
            username,
            "-P",
            password,
            "-t",
            topic,
            "-m",
            payload,
            "-q",
            "1",
            "-r",
        ]
    )

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
    except FileNotFoundError as exc:
        raise MqttCommandError("mosquitto_pub binary not found in edge-api container") from exc
    except subprocess.TimeoutExpired as exc:
        raise MqttCommandError("mosquitto publish timed out") from exc

    if result.returncode != 0:
        raise MqttCommandError(f"mosquitto_pub failed: {result.stderr.strip() or result.stdout.strip() or 'unknown error'}")


def _publish_to_topic(device_id: str, topic: str, payload: str) -> None:
    username, password = _device_mqtt_credentials(device_id)

    cmd = _mosquitto_pub_command()
    cmd.extend(
        [
            "-h",
            _mqtt_host(),
            "-p",
            str(_mqtt_port()),
            "-u",
            username,
            "-P",
            password,
            "-t",
            topic,
            "-m",
            payload,
            "-q",
            "1",
            "-r",
        ]
    )

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
    except FileNotFoundError as exc:
        raise MqttCommandError("mosquitto_pub binary not found in edge-api container") from exc
    except subprocess.TimeoutExpired as exc:
        raise MqttCommandError("mosquitto publish timed out") from exc

    if result.returncode != 0:
        raise MqttCommandError(f"mosquitto_pub failed: {result.stderr.strip() or result.stdout.strip() or 'unknown error'}")


def _is_v2_command_topic(topic: str) -> bool:
    return "/commands/" in str(topic)


def _build_v2_command_payload(*, command_type: str, target_ref: str | None, parameters: dict) -> str:
    payload = {
        "schema_version": "2.0",
        "command_id": f"cmd-{uuid.uuid4().hex[:16]}",
        "command_type": command_type,
        "target_ref": target_ref,
        "parameters": parameters,
        "requested_at": _now_iso(),
        "expires_at": None,
    }
    try:
        validate_mqtt_v2_command(payload)
    except ContractValidationError as exc:
        raise MqttCommandError(f"mqtt v2 command payload invalid: {exc}") from exc
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def publish_setpoint_command(device_id: str, zone_id: int, target_temperature_c: float) -> None:
    legacy_payload = f"{float(target_temperature_c):.1f}"
    v2_payload = _build_v2_command_payload(
        command_type="hvac.zone.setpoint",
        target_ref=f"zone:{int(zone_id)}",
        parameters={"target_temperature_c": float(target_temperature_c)},
    )
    for topic in command_topics_for_setpoint(device_id, int(zone_id)):
        _publish_to_topic(device_id, topic, v2_payload if _is_v2_command_topic(topic) else legacy_payload)


def publish_zone_name_command(device_id: str, zone_id: int, zone_name: str) -> None:
    name = str(zone_name).strip()
    if not name:
        raise MqttCommandError("zone name is required")
    v2_payload = _build_v2_command_payload(
        command_type="hvac.zone.rename",
        target_ref=f"zone:{int(zone_id)}",
        parameters={"name": name},
    )
    for topic in command_topics_for_zone_name(device_id, int(zone_id)):
        _publish_to_topic(device_id, topic, v2_payload if _is_v2_command_topic(topic) else name)