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


def test_publish_nilan_command_uses_firmware_compact_payload(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "v2")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(
        mqtt_commands.subprocess,
        "run",
        lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result(),
    )

    result = mqtt_commands.publish_nilan_command("nilan-1", "ventilation", 3)

    command = json.loads(calls[0][calls[0].index("-m") + 1])
    assert calls[0][calls[0].index("-t") + 1] == "zmartify/v2/devices/nilan-1/commands/hvac/ventilation"
    assert command["command_id"] == result["command_id"]
    assert command["level"] == 3
    assert "parameters" not in command


def test_publish_nilan_vent_set_allows_off_and_uses_vent_set_payload(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "v2")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(
        mqtt_commands.subprocess,
        "run",
        lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result(),
    )

    result = mqtt_commands.publish_nilan_command("nilan-1", "vent_set", 0)

    command = json.loads(calls[0][calls[0].index("-m") + 1])
    assert calls[0][calls[0].index("-t") + 1] == "zmartify/v2/devices/nilan-1/commands/hvac/vent-set"
    assert command["command_id"] == result["command_id"]
    assert command["vent_set"] == 0


def test_publish_nilan_mode_set_uses_controller_mode_payload(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "v2")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(
        mqtt_commands.subprocess,
        "run",
        lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result(),
    )

    result = mqtt_commands.publish_nilan_command("nilan-1", "mode_set", 3)

    command = json.loads(calls[0][calls[0].index("-m") + 1])
    assert calls[0][calls[0].index("-t") + 1] == "zmartify/v2/devices/nilan-1/commands/hvac/mode-set"
    assert command["command_id"] == result["command_id"]
    assert command["mode_set"] == 3


def test_publish_nilan_filter_commands_use_supported_intervals(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "v2")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(
        mqtt_commands.subprocess,
        "run",
        lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result(),
    )

    mqtt_commands.publish_nilan_command("nilan-1", "filter_interval", 274)
    mqtt_commands.publish_nilan_command("nilan-1", "filter_reset", 274)

    topics = [call[call.index("-t") + 1] for call in calls]
    payloads = [json.loads(call[call.index("-m") + 1]) for call in calls]
    assert topics == [
        "zmartify/v2/devices/nilan-1/commands/hvac/filter-interval",
        "zmartify/v2/devices/nilan-1/commands/hvac/filter-reset",
    ]
    assert [payload["filter_interval_days"] for payload in payloads] == [274, 274]

    try:
        mqtt_commands.publish_nilan_command("nilan-1", "filter_interval", 200)
    except mqtt_commands.MqttCommandError as exc:
        assert "183, 274 or 365" in str(exc)
    else:
        raise AssertionError("unsupported filter interval was accepted")


def test_publish_setpoint_command_preserves_supplied_command_id(monkeypatch):
    calls: list[list[str]] = []

    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "v2")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(
        mqtt_commands.subprocess,
        "run",
        lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result(returncode=0),
    )

    mqtt_commands.publish_setpoint_command("dev-1", 2, 21.5, command_id="sp-123")

    message = calls[0][calls[0].index("-m") + 1]
    assert json.loads(message)["command_id"] == "sp-123"


def test_publish_setpoint_command_includes_firmware_profile(monkeypatch):
    calls: list[list[str]] = []

    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "v2")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(
        mqtt_commands.subprocess,
        "run",
        lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result(returncode=0),
    )

    mqtt_commands.publish_setpoint_command("dev-1", 2, 21.5, setpoint_mode=4)

    message = calls[0][calls[0].index("-m") + 1]
    assert json.loads(message)["parameters"] == {"target_temperature_c": 21.5, "setpoint_mode": 4}


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


def test_publish_zone_mode_command_uses_v2_contract(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(mqtt_commands.subprocess, "run", lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result())

    result = mqtt_commands.publish_zone_mode_command("dev-1", 2, 5, command_id="mode-1")
    message = calls[0][calls[0].index("-m") + 1]
    assert result["topic"].endswith("/zones/2/mode")
    assert json.loads(message)["parameters"] == {"zone_mode": 5}


def test_publish_zone_configuration_command_uses_supported_fields(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})
    monkeypatch.setattr(mqtt_commands.subprocess, "run", lambda cmd, capture_output, text, timeout: calls.append(list(cmd)) or _Result())

    mqtt_commands.publish_zone_configuration_command("dev-1", 2, {"min_temperature_c": 5, "unknown": 99})
    message = calls[0][calls[0].index("-m") + 1]
    assert json.loads(message)["parameters"] == {"min_temperature_c": 5.0}


def test_publish_irrigation_command_uses_compact_irrigation_payload(monkeypatch):
    calls: list[list[str]] = []

    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")
    monkeypatch.setattr(mqtt_commands, "get_device_mqtt_credentials", lambda _device_id: {"username": "dev-u", "password": "dev-p"})

    def _fake_run(cmd, capture_output, text, timeout):
        calls.append(list(cmd))
        return _Result(returncode=0)

    monkeypatch.setattr(mqtt_commands.subprocess, "run", _fake_run)

    result = mqtt_commands.publish_irrigation_command(
        "zmartify-irrigation-01",
        "irrigation.zone.start",
        "zone:3",
        {"duration_seconds": 600},
    )

    assert result["status"] == "published"
    assert len(calls) == 1
    cmd = calls[0]
    topic = cmd[cmd.index("-t") + 1]
    message = cmd[cmd.index("-m") + 1]

    assert topic == "zmartify/v2/devices/zmartify-irrigation-01/commands/irrigation/zone/start"
    assert "-r" not in cmd
    payload = json.loads(message)
    assert payload["command_id"] == result["command_id"]
    assert payload["source_timestamp"].endswith("Z")
    assert "schema_version" not in payload
    assert "command_type" not in payload
    assert "target_ref" not in payload
    assert payload["parameters"]["zone_id"] == 3
    assert payload["parameters"]["duration_seconds"] == 600
