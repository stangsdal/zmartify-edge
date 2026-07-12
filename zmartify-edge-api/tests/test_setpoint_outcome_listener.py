from __future__ import annotations

from app.setpoint_outcome_listener import SetpointOutcomeMqttListener


class _Msg:
    def __init__(self, topic: str, payload: bytes):
        self.topic = topic
        self.payload = payload


def test_parse_zone_topic_valid_and_invalid():
    parsed = SetpointOutcomeMqttListener._parse_zone_topic("homie/5/device-a/zone-3/last-setpoint-command")
    assert parsed == ("device-a", 3)

    parsed_v2 = SetpointOutcomeMqttListener._parse_zone_topic(
        "zmartify/v2/devices/device-a/events/hvac/zones/3/setpoint-outcome"
    )
    assert parsed_v2 == ("device-a", 3)

    assert SetpointOutcomeMqttListener._parse_zone_topic("homie/5/device-a/nope/last-setpoint-command") is None
    assert SetpointOutcomeMqttListener._parse_zone_topic("homie/5/device-a/zone-0/last-setpoint-command") is None
    assert SetpointOutcomeMqttListener._parse_zone_topic("bad") is None


def test_on_message_ingests_last_setpoint_command():
    captured = []

    listener = SetpointOutcomeMqttListener(
        list_devices_fn=lambda: [],
        get_device_mqtt_credentials_fn=lambda _device_id: {},
        ingest_setpoint_command_outcome_fn=lambda *args, **kwargs: captured.append((args, kwargs)),
        mqtt_client_module=None,
    )

    msg = _Msg(
        "homie/5/device-a/zone-3/last-setpoint-command",
        b'{"result":"confirmed","requested":21.5,"confirmed":21.0,"detail":"ok"}',
    )
    listener._on_message(None, None, msg)

    assert len(captured) == 1
    args, kwargs = captured[0]
    assert args[0] == "device-a"
    assert args[1] == 3
    assert kwargs["result"] == "confirmed"
    assert kwargs["requested_target_c"] == 21.5
    assert kwargs["confirmed_target_c"] == 21.0


def test_on_message_ingests_v2_setpoint_outcome(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")
    captured = []

    listener = SetpointOutcomeMqttListener(
        list_devices_fn=lambda: [],
        get_device_mqtt_credentials_fn=lambda _device_id: {},
        ingest_setpoint_command_outcome_fn=lambda *args, **kwargs: captured.append((args, kwargs)),
        mqtt_client_module=None,
    )

    msg = _Msg(
        "zmartify/v2/devices/device-a/events/hvac/zones/3/setpoint-outcome",
        b'{"schema_version":"2.0","command_id":"cmd-123","result":"confirmed","source_timestamp":"2026-07-12T12:00:00Z","requested_target_temperature_c":21.5,"confirmed_target_temperature_c":21.0,"detail":"ok"}',
    )
    listener._on_message(None, None, msg)

    assert len(captured) == 1
    args, kwargs = captured[0]
    assert args[0] == "device-a"
    assert args[1] == 3
    assert kwargs["result"] == "confirmed"
    assert kwargs["requested_target_c"] == 21.5
    assert kwargs["confirmed_target_c"] == 21.0
    assert kwargs["payload"]["source"] == "mqtt_v2_setpoint_outcome"


def test_on_message_ignores_invalid_v2_outcome_under_enforce(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")
    captured = []

    listener = SetpointOutcomeMqttListener(
        list_devices_fn=lambda: [],
        get_device_mqtt_credentials_fn=lambda _device_id: {},
        ingest_setpoint_command_outcome_fn=lambda *args, **kwargs: captured.append((args, kwargs)),
        mqtt_client_module=None,
    )

    invalid_msg = _Msg(
        "zmartify/v2/devices/device-a/events/hvac/zones/3/setpoint-outcome",
        b'{"schema_version":"2.0","result":"confirmed","source_timestamp":"2026-07-12T12:00:00Z"}',
    )
    listener._on_message(None, None, invalid_msg)

    assert captured == []


def test_device_listener_targets_respects_override(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_SETPOINT_OUTCOME_DEVICE_ID", "device-b")

    listener = SetpointOutcomeMqttListener(
        list_devices_fn=lambda: [{"device_id": "device-a"}, {"device_id": "device-b"}],
        get_device_mqtt_credentials_fn=lambda device_id: {"username": device_id + "-u", "password": "pw"},
        ingest_setpoint_command_outcome_fn=lambda *_args, **_kwargs: None,
        mqtt_client_module=None,
    )

    targets = listener._device_listener_targets()
    assert targets == [("device-b", "device-b-u", "pw")]
