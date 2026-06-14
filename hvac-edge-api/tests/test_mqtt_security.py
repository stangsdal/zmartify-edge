import subprocess

import pytest

from app.db import initialize_database
from app.mqtt_users import MqttUserCommandError, reload_broker
from app.registry import create_mqtt_client


def _set_db(monkeypatch, tmp_path):
    db_path = tmp_path / "mqtt_security.sqlite"
    monkeypatch.setenv("HVAC_EDGE_DB_PATH", str(db_path))
    monkeypatch.setenv("HVAC_EDGE_APPLY_MQTT_COMMANDS", "0")
    monkeypatch.setenv("HVAC_EDGE_DRY_RUN_ACL_WRITE", "1")
    initialize_database()
    return db_path


def test_acl_generation_rejects_invalid_username(monkeypatch, tmp_path):
    _set_db(monkeypatch, tmp_path)

    with pytest.raises(ValueError):
        create_mqtt_client(
            client_type="service",
            domain_id=None,
            site_id=None,
            device_pk_id=None,
            username="bad\nuser",
        )


def test_reload_broker_uses_split_args_not_shell(monkeypatch):
    monkeypatch.setenv("HVAC_EDGE_APPLY_MQTT_COMMANDS", "1")
    monkeypatch.setenv("HVAC_EDGE_MQTT_RELOAD_CMD", "printf ok")

    calls = []

    def fake_run(args, capture_output, text):
        calls.append(args)

        class Result:
            returncode = 0
            stderr = ""

        return Result()

    monkeypatch.setattr(subprocess, "run", fake_run)

    reload_broker()

    assert calls[0] == ["printf", "ok"]


def test_reload_broker_rejects_empty_command(monkeypatch):
    monkeypatch.setenv("HVAC_EDGE_APPLY_MQTT_COMMANDS", "1")
    monkeypatch.setenv("HVAC_EDGE_MQTT_RELOAD_CMD", "   ")

    with pytest.raises(MqttUserCommandError):
        reload_broker()
