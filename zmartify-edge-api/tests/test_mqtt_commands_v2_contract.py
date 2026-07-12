from __future__ import annotations

import json
from types import SimpleNamespace

from app import mqtt_commands


class _Result:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_publish_setpoint_command_uses_v2_contract_payload_for_v2_topics(monkeypatch):
    calls: list[list[str]] = []

    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "v2")
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})

    def _fake_run(cmd, capture_output, text, timeout):
        calls.append(list(cmd))
        return _Result(returncode=0)

    monkeypatch.setattr(mqtt_commands.subprocess, "run", _fake_run)

    mqtt_commands.publish_setpoint_command("dev-1", 2, 21.5)

    assert len(calls) == 1
    cmd = calls[0]
    topic = cmd[cmd.index("-t") + 1]
    message = cmd[cmd.index("-m") + 1]

    assert topic == "zmartify/v2/devices/dev-1/commands/hvac/zones/2/setpoint"
    payload = json.loads(message)
    assert payload["schema_version"] == "2.0"
    assert payload["command_type"] == "hvac.zone.setpoint"
    assert payload["target_ref"] == "zone:2"
    assert payload["parameters"]["target_temperature_c"] == 21.5


def test_publish_zone_name_command_dual_mode_keeps_legacy_and_v2(monkeypatch):
    calls: list[list[str]] = []

    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "dual")
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})

    def _fake_run(cmd, capture_output, text, timeout):
        calls.append(list(cmd))
        return _Result(returncode=0)

    monkeypatch.setattr(mqtt_commands.subprocess, "run", _fake_run)

    mqtt_commands.publish_zone_name_command("dev-1", 3, "Kitchen")

    assert len(calls) == 2
    topics = [cmd[cmd.index("-t") + 1] for cmd in calls]
    messages = [cmd[cmd.index("-m") + 1] for cmd in calls]

    assert "homie/5/dev-1/zone-3/$name/set" in topics
    assert "zmartify/v2/devices/dev-1/commands/hvac/zones/3/name" in topics

    legacy_idx = topics.index("homie/5/dev-1/zone-3/$name/set")
    v2_idx = topics.index("zmartify/v2/devices/dev-1/commands/hvac/zones/3/name")

    assert messages[legacy_idx] == "Kitchen"
    v2_payload = json.loads(messages[v2_idx])
    assert v2_payload["command_type"] == "hvac.zone.rename"
    assert v2_payload["parameters"]["name"] == "Kitchen"
