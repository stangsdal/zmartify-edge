from app.mqtt_v2_topics import (
    command_topics_for_setpoint,
    command_topics_for_zone_name,
    outcome_subscription_topics,
    parse_setpoint_outcome_topic,
)


def test_default_legacy_topic_mode(monkeypatch):
    monkeypatch.delenv("ZMART_EDGE_MQTT_TOPIC_STYLE", raising=False)

    assert command_topics_for_setpoint("dev-1", 2) == ["homie/5/dev-1/zone-2/target-temperature/set"]
    assert command_topics_for_zone_name("dev-1", 2) == ["homie/5/dev-1/zone-2/$name/set"]
    assert outcome_subscription_topics("dev-1") == ["homie/5/dev-1/+/last-setpoint-command"]


def test_dual_topic_mode(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_MQTT_TOPIC_STYLE", "dual")

    setpoint_topics = command_topics_for_setpoint("dev-1", 2)
    assert "homie/5/dev-1/zone-2/target-temperature/set" in setpoint_topics
    assert "zmartify/v2/devices/dev-1/commands/hvac/zones/2/setpoint" in setpoint_topics


def test_parse_setpoint_outcome_topics_for_both_styles():
    assert parse_setpoint_outcome_topic("homie/5/dev-1/zone-2/last-setpoint-command") == ("dev-1", 2)
    assert parse_setpoint_outcome_topic("zmartify/v2/devices/dev-1/events/hvac/zones/2/setpoint-outcome") == ("dev-1", 2)
    assert parse_setpoint_outcome_topic("invalid") is None
