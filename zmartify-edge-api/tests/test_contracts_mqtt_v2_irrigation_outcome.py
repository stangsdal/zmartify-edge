from __future__ import annotations

import pytest

from app.contracts import ContractValidationError, validate_mqtt_v2_irrigation_outcome


def test_irrigation_outcome_contract_accepts_valid_payload(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")

    validate_mqtt_v2_irrigation_outcome(
        {
            "schema_version": "2.0",
            "source_timestamp": "2026-07-12T16:00:00Z",
            "event_type": "run.step.completed",
            "severity": "info",
            "result": "ok",
            "zone_id": 1,
            "payload": {"flow_lpm": 10.2},
        }
    )


def test_irrigation_outcome_contract_rejects_missing_event_type(monkeypatch):
    monkeypatch.setenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "enforce")

    with pytest.raises(ContractValidationError):
        validate_mqtt_v2_irrigation_outcome(
            {
                "schema_version": "2.0",
                "source_timestamp": "2026-07-12T16:00:00Z",
                "severity": "alarm",
            }
        )
