from app.contracts import ContractValidationError, validate_mqtt_v2_setpoint_command_outcome


def test_validate_mqtt_v2_setpoint_outcome_accepts_valid_payload(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")

    payload = {
        "schema_version": "2.0",
        "command_id": "cmd-123",
        "result": "confirmed",
        "source_timestamp": "2026-07-12T12:00:00Z",
        "requested_target_temperature_c": 21.5,
        "confirmed_target_temperature_c": 21.0,
        "detail": "ok",
    }

    validate_mqtt_v2_setpoint_command_outcome(payload)


def test_validate_mqtt_v2_setpoint_outcome_rejects_invalid_payload(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")

    payload = {
        "schema_version": "2.0",
        "result": "confirmed",
        "source_timestamp": "2026-07-12T12:00:00Z",
    }

    try:
        validate_mqtt_v2_setpoint_command_outcome(payload)
        raised = False
    except ContractValidationError:
        raised = True

    assert raised is True
