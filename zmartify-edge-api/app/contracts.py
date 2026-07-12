from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, FormatChecker, ValidationError
except Exception:  # pragma: no cover - dependency may be absent in lightweight dev envs
    Draft202012Validator = None  # type: ignore[assignment]
    FormatChecker = None  # type: ignore[assignment]
    ValidationError = Exception  # type: ignore[assignment]


class ContractValidationError(ValueError):
    """Raised when a payload fails contract validation in enforce mode."""


def _contracts_root() -> Path:
    # .../zmartify-edge/zmartify-edge-api/app/contracts.py -> .../zmartify-edge/contracts
    return Path(__file__).resolve().parents[2] / "contracts"


def _validation_mode() -> str:
    raw = os.getenv("ZMART_EDGE_CONTRACT_VALIDATION_MODE", "warn").strip().lower()
    if raw in {"off", "warn", "enforce"}:
        return raw
    return "warn"


@lru_cache(maxsize=8)
def _validator(schema_rel_path: str) -> Draft202012Validator:
    if Draft202012Validator is None:
        raise ContractValidationError("jsonschema dependency is not installed")
    schema_path = _contracts_root() / schema_rel_path
    if not schema_path.exists():
        raise ContractValidationError(f"schema file not found: {schema_path}")
    with schema_path.open("r", encoding="utf-8") as handle:
        schema = json.load(handle)
    checker = FormatChecker() if FormatChecker is not None else None
    return Draft202012Validator(schema, format_checker=checker)


def _render_error(schema_name: str, exc: ValidationError) -> str:
    dotted_path = ".".join(str(part) for part in list(exc.path))
    field = dotted_path or "<root>"
    return f"{schema_name} validation failed at {field}: {exc.message}"


def _handle_validation_failure(schema_name: str, exc: ValidationError) -> None:
    mode = _validation_mode()
    if mode == "off":
        return

    message = _render_error(schema_name, exc)
    if mode == "enforce":
        raise ContractValidationError(message) from exc

    # Warn mode allows gradual rollout before strict enforcement.
    print(f"[contracts] {message}")


def validate_mqtt_v2_reported_state(payload: dict) -> None:
    mode = _validation_mode()
    if Draft202012Validator is None:
        if mode == "enforce":
            raise ContractValidationError("jsonschema dependency is not installed")
        print("[contracts] jsonschema dependency missing; reported-state validation skipped")
        return
    try:
        _validator("mqtt-v2/reported-state.schema.json").validate(payload)
    except ValidationError as exc:
        _handle_validation_failure("mqtt-v2/reported-state", exc)


def validate_mqtt_v2_command(payload: dict) -> None:
    mode = _validation_mode()
    if Draft202012Validator is None:
        if mode == "enforce":
            raise ContractValidationError("jsonschema dependency is not installed")
        print("[contracts] jsonschema dependency missing; command validation skipped")
        return
    try:
        _validator("mqtt-v2/command.schema.json").validate(payload)
    except ValidationError as exc:
        _handle_validation_failure("mqtt-v2/command", exc)


def validate_mqtt_v2_setpoint_command_outcome(payload: dict) -> None:
    mode = _validation_mode()
    if Draft202012Validator is None:
        if mode == "enforce":
            raise ContractValidationError("jsonschema dependency is not installed")
        print("[contracts] jsonschema dependency missing; setpoint outcome validation skipped")
        return
    try:
        _validator("mqtt-v2/setpoint-command-outcome.schema.json").validate(payload)
    except ValidationError as exc:
        _handle_validation_failure("mqtt-v2/setpoint-command-outcome", exc)
