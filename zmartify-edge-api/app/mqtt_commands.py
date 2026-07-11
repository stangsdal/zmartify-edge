from __future__ import annotations

import os
import shlex
import subprocess

from app.registry import get_device_mqtt_credentials


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


def publish_setpoint_command(device_id: str, zone_id: int, target_temperature_c: float) -> None:
    _publish_command(device_id, f"zone-{int(zone_id)}/target-temperature/set", f"{float(target_temperature_c):.1f}")


def publish_zone_name_command(device_id: str, zone_id: int, zone_name: str) -> None:
    name = str(zone_name).strip()
    if not name:
        raise MqttCommandError("zone name is required")
    _publish_command(device_id, f"zone-{int(zone_id)}/$name/set", name)