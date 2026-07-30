from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import shlex
import subprocess
import uuid

from app.contracts import ContractValidationError, validate_mqtt_v2_command
from app.registry import get_device_mqtt_credentials
from app.mqtt_v2_topics import command_topic_for_irrigation, command_topics_for_setpoint, command_topics_for_zone_name


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


def _now_zulu() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _zone_id_from_ref(target_ref: str | None, parameters: dict) -> int | None:
    raw = target_ref or parameters.get("zone_id") or parameters.get("zone")
    if raw is None:
        return None
    text = str(raw).strip().lower()
    for prefix in ("zone:", "zone-", "zone_", "zone"):
        if text.startswith(prefix):
            text = text[len(prefix) :]
            break
    try:
        zone_id = int(text)
    except ValueError:
        return None
    return zone_id if zone_id > 0 else None


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


def _publish_to_topic(device_id: str, topic: str, payload: str, *, retain: bool = True) -> None:
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
        ]
    )
    if retain:
        cmd.append("-r")

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


def publish_irrigation_command(
    device_id: str,
    command_type: str,
    target_ref: str | None,
    parameters: dict | None = None,
    *,
    command_id: str | None = None,
) -> dict:
    raw_parameters = parameters or {}
    command_id = str(command_id or f"cmd-{uuid.uuid4().hex[:16]}").strip()
    firmware_parameters: dict[str, object] = {}

    if command_type == "irrigation.zone.start":
        zone_id = _zone_id_from_ref(target_ref, raw_parameters)
        if zone_id is None:
            raise MqttCommandError("irrigation zone command requires a zone target")
        firmware_parameters["zone_id"] = zone_id
        firmware_parameters["duration_seconds"] = int(raw_parameters.get("duration_seconds") or 300)
    elif command_type == "irrigation.program.start":
        program_id = raw_parameters.get("program_id")
        try:
            program_number = int(program_id)
        except (TypeError, ValueError) as exc:
            raise MqttCommandError("irrigation program command requires a numeric program_id") from exc
        if program_number <= 0:
            raise MqttCommandError("irrigation program command requires a numeric program_id")
        firmware_parameters["program_id"] = program_number
    elif command_type == "irrigation.program.skip":
        firmware_parameters = {}
    elif command_type == "irrigation.zone.stop":
        zone_id = _zone_id_from_ref(target_ref, raw_parameters)
        if zone_id is None:
            raise MqttCommandError("irrigation zone command requires a zone target")
        firmware_parameters["zone_id"] = zone_id
    elif command_type == "irrigation.stop_all":
        firmware_parameters = {}
    elif command_type == "irrigation.rain_delay":
        firmware_parameters["delay_hours"] = int(raw_parameters.get("delay_hours") or 0)
    else:
        firmware_parameters = dict(raw_parameters)

    topic = command_topic_for_irrigation(device_id, command_type)
    payload = {
        "command_id": command_id,
        "source_timestamp": _now_zulu(),
        "parameters": firmware_parameters,
    }
    _publish_to_topic(device_id, topic, json.dumps(payload, separators=(",", ":"), sort_keys=True), retain=False)
    return {"command_id": command_id, "status": "published", "topic": topic}


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