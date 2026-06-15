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
    return os.getenv("HVAC_EDGE_COMMAND_MQTT_BASE", "homie/5").strip().rstrip("/") or "homie/5"


def should_forward_setpoint_commands() -> bool:
    raw = os.getenv("HVAC_EDGE_FORWARD_SETPOINT_TO_MQTT", "0")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _mosquitto_pub_command() -> list[str]:
    configured = os.getenv("HVAC_EDGE_MOSQUITTO_PUB_BIN", "mosquitto_pub")
    cmd = shlex.split(configured)
    if not cmd:
        raise MqttCommandError("empty mosquitto_pub command")
    return cmd


def publish_setpoint_command(device_id: str, zone_id: int, target_temperature_c: float) -> None:
    creds = get_device_mqtt_credentials(device_id)
    username = str(creds.get("username") or "").strip()
    password = str(creds.get("password") or "").strip()
    if not username or not password:
        raise MqttCommandError("device mqtt credentials unavailable")

    topic = f"{_mqtt_base_topic()}/{device_id}/zone-{int(zone_id)}/target-temperature/set"
    payload = f"{float(target_temperature_c):.1f}"

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

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise MqttCommandError(f"mosquitto_pub failed: {result.stderr.strip() or result.stdout.strip() or 'unknown error'}")