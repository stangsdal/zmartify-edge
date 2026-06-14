from __future__ import annotations

import hashlib
import os
import secrets
import shlex
import string
import subprocess
import re


class MqttUserCommandError(RuntimeError):
    """Raised when mosquitto or broker reload command execution fails."""


_MQTT_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def should_apply_external_commands() -> bool:
    return _bool_env("HVAC_EDGE_APPLY_MQTT_COMMANDS", False)


def generate_password(length: int = 28) -> str:
    alphabet = string.ascii_letters + string.digits + "-_.~!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def hash_password_for_registry(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _validate_username(username: str) -> str:
    if not _MQTT_USERNAME_RE.fullmatch(username):
        raise MqttUserCommandError("invalid mqtt username format")
    return username


def _parse_command(raw: str) -> list[str]:
    cmd = shlex.split(raw)
    if not cmd:
        raise MqttUserCommandError("empty command is not allowed")
    return cmd


def create_or_update_mqtt_user(username: str, password: str) -> None:
    if not should_apply_external_commands():
        return

    _validate_username(username)
    if not password:
        raise MqttUserCommandError("password must not be empty")

    passwd_file = os.getenv("HVAC_EDGE_MQTT_PASSWD_FILE", "/mosquitto/config/passwd")
    mosquitto_passwd_bin = os.getenv("HVAC_EDGE_MOSQUITTO_PASSWD_BIN", "mosquitto_passwd")
    args = [mosquitto_passwd_bin, "-b"]

    if not os.path.exists(passwd_file):
        args.append("-c")

    args.extend([passwd_file, username, password])
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise MqttUserCommandError(
            f"mosquitto_passwd failed (code={result.returncode}): {result.stderr.strip()}"
        )


def reload_broker() -> None:
    if not should_apply_external_commands():
        return

    reload_cmd = os.getenv("HVAC_EDGE_MQTT_RELOAD_CMD", "docker kill -s HUP hvac-mosquitto")
    result = subprocess.run(_parse_command(reload_cmd), capture_output=True, text=True)
    if result.returncode != 0:
        # Fallback restart only when explicit fallback command is set.
        restart_cmd = os.getenv("HVAC_EDGE_MQTT_RESTART_CMD")
        if restart_cmd:
            fallback = subprocess.run(_parse_command(restart_cmd), capture_output=True, text=True)
            if fallback.returncode == 0:
                return
            raise MqttUserCommandError(
                f"reload failed and restart failed: reload={result.stderr.strip()} restart={fallback.stderr.strip()}"
            )
        raise MqttUserCommandError(f"reload failed: {result.stderr.strip()}")
