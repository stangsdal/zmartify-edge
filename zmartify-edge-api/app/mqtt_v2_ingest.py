from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.contracts import (
    ContractValidationError,
    validate_mqtt_v2_irrigation_outcome,
    validate_mqtt_v2_reported_state,
    validate_mqtt_v2_setpoint_command_outcome,
)
from app.db import get_connection
from app.domain_model import ingest_device_twin_snapshot, ingest_setpoint_command_outcome, list_device_zones
from app.domain_model import log_event
from app.irrigation_domain import (
    set_irrigation_rain_delay,
    upsert_irrigation_hydraulics_state,
    upsert_irrigation_output_state,
    upsert_irrigation_power_state,
    upsert_irrigation_weather_state,
)
from app.registry import RegistryNotFoundError


def _safe_source_timestamp(payload: dict[str, Any]) -> str:
    raw = payload.get("source_timestamp")
    if isinstance(raw, str) and raw.strip():
        return raw
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def ingest_mqtt_v2_reported_state(
    device_id: str,
    payload: dict[str, Any],
    *,
    source: str = "mqtt_v2_ingest",
    publish_zone_state_update_hook=None,
) -> dict[str, Any]:
    reported = dict(payload or {})
    validate_mqtt_v2_reported_state(reported)

    hvac = _as_dict(reported.get("hvac"))
    zones = [item for item in _as_list(hvac.get("zones")) if isinstance(item, dict)]
    channels = [item for item in _as_list(hvac.get("channels")) if isinstance(item, dict)]

    hvac_result = ingest_device_twin_snapshot(
        device_id,
        source=source,
        source_timestamp=reported.get("source_timestamp"),
        firmware_version=reported.get("firmware_version"),
        online=reported.get("online"),
        mqtt_connected=reported.get("mqtt_connected"),
        last_error=reported.get("last_error"),
        zones=zones,
        channels=channels,
    )

    if hvac_result.get("applied") and publish_zone_state_update_hook is not None:
        for zone in list_device_zones(device_id):
            publish_zone_state_update_hook(device_id, zone)

    irrigation = _as_dict(reported.get("irrigation"))
    hydraulics = _as_dict(reported.get("hydraulics"))
    power = _as_dict(reported.get("power"))

    if not hydraulics:
        hydraulics = _as_dict(irrigation.get("hydraulics"))
    if not power:
        power = _as_dict(irrigation.get("power"))

    weather = _as_dict(irrigation.get("weather"))

    outputs_updated = 0
    for index, output in enumerate(_as_list(irrigation.get("outputs"))):
        if not isinstance(output, dict):
            continue
        local_ref = str(output.get("local_ref") or output.get("output_ref") or output.get("output_id") or f"output-{index + 1}").strip()
        if not local_ref:
            continue
        name = str(output.get("name") or local_ref).strip() or local_ref
        upsert_irrigation_output_state(
            device_id,
            local_ref=local_ref,
            name=name,
            enabled=bool(output.get("enabled", True)),
            active=bool(output.get("active", False)),
            fault=str(output["fault"]) if output.get("fault") is not None else None,
            is_master_valve=bool(output.get("is_master_valve", False)),
            metadata=_as_dict(output.get("metadata")),
        )
        outputs_updated += 1

    hydraulics_updated = False
    if hydraulics:
        upsert_irrigation_hydraulics_state(
            device_id,
            flow_lpm=hydraulics.get("flow_lpm"),
            pressure_bar=hydraulics.get("pressure_bar"),
            water_liters=hydraulics.get("water_liters"),
            source_timestamp=str(hydraulics.get("source_timestamp") or _safe_source_timestamp(reported)),
        )
        hydraulics_updated = True

    power_updated = False
    if power:
        upsert_irrigation_power_state(
            device_id,
            voltage_rms_v=power.get("voltage_rms_v"),
            current_rms_a=power.get("current_rms_a"),
            real_power_w=power.get("real_power_w"),
            power_factor=power.get("power_factor"),
            source_timestamp=str(power.get("source_timestamp") or _safe_source_timestamp(reported)),
        )
        power_updated = True

    weather_updated = False
    if weather:
        upsert_irrigation_weather_state(
            device_id,
            temperature_c=weather.get("temperature_c"),
            rain_mm=weather.get("rain_mm"),
            wind_mps=weather.get("wind_mps"),
            eto_mm=weather.get("eto_mm"),
            source_timestamp=str(weather.get("source_timestamp") or _safe_source_timestamp(reported)),
        )
        weather_updated = True

    rain_delay_set = False
    rain_delay_payload = _as_dict(irrigation.get("rain_delay"))
    delay_hours_raw = rain_delay_payload.get("delay_hours", irrigation.get("rain_delay_hours"))
    if isinstance(delay_hours_raw, (int, float)) and int(delay_hours_raw) > 0:
        set_irrigation_rain_delay(
            device_id,
            delay_hours=int(delay_hours_raw),
            reason=(str(rain_delay_payload.get("reason")).strip() or None) if rain_delay_payload.get("reason") is not None else None,
        )
        rain_delay_set = True

    return {
        "device_id": device_id,
        "source": source,
        "source_timestamp": reported.get("source_timestamp"),
        "hvac": hvac_result,
        "irrigation": {
            "outputs_updated": outputs_updated,
            "hydraulics_updated": hydraulics_updated,
            "power_updated": power_updated,
            "weather_updated": weather_updated,
            "rain_delay_set": rain_delay_set,
        },
    }


def ingest_mqtt_v2_setpoint_outcome(device_id: str, zone_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    normalized = parse_mqtt_v2_setpoint_outcome_payload(payload)

    result = ingest_setpoint_command_outcome(
        device_id,
        int(zone_id),
        result=normalized["result"],
        detail=normalized["detail"],
        requested_target_c=normalized["requested_target_c"],
        confirmed_target_c=normalized["confirmed_target_c"],
        payload={"source": "mqtt_v2_setpoint_outcome_ingest", "raw": normalized["raw"]},
    )

    return {
        "device_id": device_id,
        "zone_id": int(zone_id),
        "command_id": result.get("command_id"),
        "event": result.get("event"),
    }


def parse_mqtt_v2_setpoint_outcome_payload(payload: dict[str, Any]) -> dict[str, Any]:
    outcome = dict(payload or {})
    validate_mqtt_v2_setpoint_command_outcome(outcome)

    result = str(outcome.get("result") or "").strip().lower()
    if not result:
        raise ContractValidationError("setpoint outcome result is required")

    requested_target_c = (
        float(outcome["requested_target_temperature_c"])
        if isinstance(outcome.get("requested_target_temperature_c"), (int, float))
        else None
    )
    confirmed_target_c = (
        float(outcome["confirmed_target_temperature_c"])
        if isinstance(outcome.get("confirmed_target_temperature_c"), (int, float))
        else None
    )
    detail = str(outcome["detail"]) if outcome.get("detail") is not None else None

    return {
        "result": result,
        "detail": detail,
        "requested_target_c": requested_target_c,
        "confirmed_target_c": confirmed_target_c,
        "raw": outcome,
    }


def _resolve_device_context(device_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, site_id FROM devices WHERE device_id = ?",
            (device_id,),
        ).fetchone()
        if row is None:
            raise RegistryNotFoundError("device not found")
        site_id = int(row["site_id"]) if row["site_id"] is not None else None
        domain_id = None
        if site_id is not None:
            site_row = conn.execute("SELECT domain_id FROM sites WHERE id = ?", (site_id,)).fetchone()
            if site_row is not None and site_row["domain_id"] is not None:
                domain_id = int(site_row["domain_id"])
    return {"device_pk_id": int(row["id"]), "site_id": site_id, "domain_id": domain_id}


def ingest_mqtt_v2_irrigation_outcome(device_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    outcome = dict(payload or {})
    validate_mqtt_v2_irrigation_outcome(outcome)

    normalized_event_type = str(outcome.get("event_type") or "irrigation.status.feedback").strip().lower()
    severity = str(outcome.get("severity") or "info").strip().lower()
    result = str(outcome.get("result") or "").strip().lower()
    detail = str(outcome.get("detail") or "").strip() or None

    mapped_event_type = "irrigation_status_feedback"
    if severity in {"alarm", "critical"} or result in {"failed", "fault", "error"}:
        mapped_event_type = "controller_fault"

    context = _resolve_device_context(device_id)
    event = log_event(
        mapped_event_type,
        domain_id=context["domain_id"],
        site_id=context["site_id"],
        device_pk_id=context["device_pk_id"],
        zone_id=int(outcome["zone_id"]) if isinstance(outcome.get("zone_id"), int) else None,
        payload={
            "device_id": device_id,
            "event_type": normalized_event_type,
            "severity": severity,
            "result": result or None,
            "detail": detail,
            "run_id": outcome.get("run_id"),
            "program_id": outcome.get("program_id"),
            "payload": outcome.get("payload") if isinstance(outcome.get("payload"), dict) else {},
            "source": "mqtt_v2_irrigation_outcome_ingest",
        },
    )

    return {
        "device_id": device_id,
        "mapped_event_type": mapped_event_type,
        "event": event,
    }
