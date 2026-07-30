from __future__ import annotations

import os
from math import ceil
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.domain_model import get_device_freshness
from app.irrigation_domain import (
    complete_irrigation_run,
    create_program_run,
    create_program_schedule,
    create_irrigation_program,
    delete_irrigation_program,
    delete_program_schedule,
    finish_current_irrigation_run_step,
    get_irrigation_program,
    get_irrigation_hydraulics,
    get_irrigation_power,
    get_irrigation_weather,
    get_site_irrigation_overview,
    list_irrigation_runs,
    list_irrigation_outputs,
    list_program_zones,
    list_program_schedules,
    list_irrigation_programs,
    list_irrigation_zones,
    replace_program_zones,
    set_irrigation_rain_delay,
    start_next_irrigation_run_step,
    update_irrigation_program,
    update_program_schedule,
    upsert_irrigation_hydraulics_state,
    upsert_irrigation_output_state,
    upsert_irrigation_power_state,
    upsert_irrigation_weather_state,
    upsert_irrigation_zone,
)
from app.mqtt_commands import MqttCommandError, publish_irrigation_command
from app.registry import RegistryNotFoundError, get_device


class IrrigationZoneUpsertIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    local_ref: str = Field(min_length=1)
    name: str = Field(min_length=1)
    enabled: bool = True
    metadata: dict = Field(default_factory=dict)


class IrrigationProgramCreateIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)
    enabled: bool = True
    seasonal_adjustment: float = Field(default=1.0, ge=0.1, le=5.0)
    weather_mode: str = Field(default="automatic", min_length=1)


class IrrigationScheduleCreateIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)
    start_local_time: str = Field(min_length=3)
    weekdays: list[int] = Field(default_factory=list)
    recurrence_type: str = Field(default="weekdays", min_length=1)
    interval_days: int | None = Field(default=None, ge=1, le=366)
    anchor_date: str | None = None
    dates: list[str] = Field(default_factory=list)
    enabled: bool = True


class IrrigationScheduleUpdateIn(IrrigationScheduleCreateIn):
    pass


class IrrigationProgramZoneIn(BaseModel):
    zone_id: str | None = None
    local_ref: str | None = None
    duration_seconds: int = Field(default=600, ge=1, le=86400)
    sort_order: int = Field(default=0, ge=0)
    enabled: bool = True


class IrrigationProgramZonesReplaceIn(BaseModel):
    zones: list[IrrigationProgramZoneIn] = Field(default_factory=list)


class IrrigationRunIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    trigger_type: str = Field(default="manual", min_length=1)


class IrrigationProgramUpdateIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)
    enabled: bool = True
    seasonal_adjustment: float = Field(default=1.0, ge=0.1, le=5.0)
    weather_mode: str = Field(default="automatic", min_length=1)


class IrrigationOutputUpsertIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    local_ref: str = Field(min_length=1)
    name: str = Field(min_length=1)
    enabled: bool = True
    active: bool = False
    fault: str | None = None
    is_master_valve: bool = False
    metadata: dict = Field(default_factory=dict)


class IrrigationHydraulicsIn(BaseModel):
    flow_lpm: float | None = None
    pressure_bar: float | None = None
    water_liters: float | None = None
    source_timestamp: str | None = None


class IrrigationPowerIn(BaseModel):
    voltage_rms_v: float | None = None
    current_rms_a: float | None = None
    real_power_w: float | None = None
    power_factor: float | None = None
    source_timestamp: str | None = None


class IrrigationWeatherIn(BaseModel):
    temperature_c: float | None = None
    rain_mm: float | None = None
    wind_mps: float | None = None
    eto_mm: float | None = None
    source_timestamp: str | None = None


class RainDelayIn(BaseModel):
    delay_hours: int = Field(default=24, ge=1, le=168)
    reason: str | None = None


class IrrigationCommandIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    command_type: str = Field(min_length=1)
    target_ref: str | None = None
    parameters: dict = Field(default_factory=dict)


def _command_freshness_limit_ms() -> int:
    raw = os.getenv("ZMART_EDGE_IRRIGATION_COMMAND_MAX_AGE_SECONDS", "120").strip() or "120"
    try:
        seconds = max(1, int(raw))
    except ValueError:
        seconds = 120
    return seconds * 1000


def _age_ms(raw: str | None) -> int | None:
    if not raw:
        return None
    normalized = str(raw).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return max(0, int((datetime.now(UTC) - parsed.astimezone(UTC)).total_seconds() * 1000))


def _ensure_irrigation_device_commandable(device_id: str) -> None:
    freshness = get_device_freshness(device_id)
    device = freshness.get("device") or {}
    online = device.get("online")
    mqtt_connected = device.get("mqtt_connected")
    freshness_age_ms = _age_ms(device.get("source_timestamp"))
    if freshness_age_ms is None:
        freshness_age_ms = device.get("freshness_age_ms")

    if online is not True or mqtt_connected is not True:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="controller is offline or mqtt is disconnected",
        )
    if freshness_age_ms is None or int(freshness_age_ms) > _command_freshness_limit_ms():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="controller telemetry is stale; wait for the device to reconnect before sending commands",
        )


def _default_irrigation_controller_timezone() -> str:
    raw = os.getenv("ZMART_EDGE_IRRIGATION_CONTROLLER_TIMEZONE", "").strip()
    if raw:
        return raw
    return "CET-1CEST,M3.5.0/2,M10.5.0/3"


def _controller_program_zone_ref(local_ref: str) -> str:
    text = str(local_ref or "").strip().lower()
    for prefix in ("zone:", "zone-", "zone_", "zone"):
        if text.startswith(prefix):
            suffix = text[len(prefix) :].strip()
            if suffix.isdigit() and int(suffix) > 0:
                return f"zone:{int(suffix)}"
    return str(local_ref)


def _build_irrigation_program_sync_payload(device_id: str) -> dict:
    programs_payload: list[dict] = []
    programs = list_irrigation_programs(device_id)
    for program in programs:
        zone_items = list_program_zones(device_id, program["program_id"])
        schedule_items = list_program_schedules(device_id, program["program_id"])

        sorted_zone_items = sorted(
            zone_items,
            key=lambda item: (int(item.get("sort_order") or 0), str(item.get("program_zone_id") or "")),
        )
        zones_payload = []
        for index, zone in enumerate(sorted_zone_items, start=1):
            duration_seconds = max(60, int(zone.get("duration_seconds") or 60))
            duration_seconds = int(ceil(duration_seconds / 60.0) * 60)
            zones_payload.append(
                {
                    "zone_ref": _controller_program_zone_ref(str(zone["local_ref"])),
                    "sort_order": index,
                    "duration_seconds": duration_seconds,
                    "enabled": bool(zone.get("enabled", True) and zone.get("zone_enabled", True)),
                }
            )

        schedules_payload = []
        for schedule in schedule_items:
            schedules_payload.append(
                {
                    "schedule_id": str(schedule["schedule_id"]),
                    "name": str(schedule["name"]),
                    "enabled": bool(schedule.get("enabled", True)),
                    "recurrence_type": str(schedule.get("recurrence_type") or "weekdays"),
                    "weekdays": [int(day) for day in schedule.get("weekdays") or []],
                    "start_local_time": str(schedule["start_local_time"]),
                    "interval_days": schedule.get("interval_days"),
                    "anchor_date": schedule.get("anchor_date") or None,
                    "dates": [str(value) for value in schedule.get("dates") or []],
                }
            )

        programs_payload.append(
            {
                "program_id": str(program["program_id"]),
                "name": str(program["name"]),
                "enabled": bool(program.get("enabled", True)),
                "seasonal_adjust_pct": max(0, min(200, int(round(float(program.get("seasonal_adjustment") or 1.0) * 100.0)))),
                "weather_mode": str(program.get("weather_mode") or "automatic"),
                "zones": zones_payload,
                "schedules": schedules_payload,
            }
        )

    return {
        "config_revision": int(datetime.now(UTC).timestamp()),
        "timezone": _default_irrigation_controller_timezone(),
        "programs": programs_payload,
    }


def _sync_irrigation_programs_to_controller(device_id: str) -> dict:
    _ensure_irrigation_device_commandable(device_id)
    payload = _build_irrigation_program_sync_payload(device_id)
    command_type = "irrigation.config.programs.clear" if not payload["programs"] else "irrigation.config.programs.replace"
    parameters = {"config_revision": payload["config_revision"]} if command_type.endswith(".clear") else payload
    return publish_irrigation_command(device_id, command_type=command_type, target_ref=None, parameters=parameters)


def _controller_program_number(device_id: str, program_id: str) -> int:
    programs = list_irrigation_programs(device_id)
    for index, program in enumerate(programs, start=1):
        if program["program_id"] == program_id:
            return index
    raise RegistryNotFoundError("irrigation program not found")


def _find_irrigation_run(device_id: str, run_id: str, *, limit: int = 100) -> dict:
    run = next((item for item in list_irrigation_runs(device_id, limit=limit) if item["run_id"] == run_id), None)
    if run is None:
        raise RegistryNotFoundError("irrigation run not found")
    return run


def _parse_firmware_version(value: str | None) -> tuple[int, int, int]:
    normalized = str(value or "").strip()
    if normalized.startswith(("v", "V")):
        normalized = normalized[1:]
    normalized = normalized.split("-", 1)[0]
    parts = []
    for item in normalized.split("."):
        if not item.isdigit():
            break
        parts.append(int(item))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def _supports_controller_local_program_run(device_id: str) -> bool:
    device = get_device(device_id)
    return _parse_firmware_version(device.get("firmware_version")) >= (5, 2, 0)


def create_irrigation_v2_router(require_roles) -> APIRouter:
    router = APIRouter(tags=["api-v2-irrigation"])

    @router.get("/api/v2/sites/{site_id}/irrigation/overview")
    def v2_site_irrigation_overview(site_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return get_site_irrigation_overview(site_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/zones")
    def v2_list_irrigation_zones(device_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return {"device_id": device_id, "zones": list_irrigation_zones(device_id)}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.put("/api/v2/devices/{device_id}/irrigation/zones")
    def v2_upsert_irrigation_zone(device_id: str, payload: IrrigationZoneUpsertIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            zone = upsert_irrigation_zone(
                device_id,
                local_ref=payload.local_ref,
                name=payload.name,
                enabled=payload.enabled,
                metadata=payload.metadata,
            )
            return {"device_id": device_id, "zone": zone}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/outputs")
    def v2_list_irrigation_outputs(device_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return {"device_id": device_id, "outputs": list_irrigation_outputs(device_id)}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.put("/api/v2/devices/{device_id}/irrigation/outputs")
    def v2_upsert_irrigation_output(device_id: str, payload: IrrigationOutputUpsertIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            output = upsert_irrigation_output_state(
                device_id,
                local_ref=payload.local_ref,
                name=payload.name,
                enabled=payload.enabled,
                active=payload.active,
                fault=payload.fault,
                is_master_valve=payload.is_master_valve,
                metadata=payload.metadata,
            )
            return {"device_id": device_id, "output": output}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/programs")
    def v2_list_irrigation_programs(device_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return {"device_id": device_id, "programs": list_irrigation_programs(device_id)}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/programs")
    def v2_create_irrigation_program(device_id: str, payload: IrrigationProgramCreateIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            program = create_irrigation_program(
                device_id,
                name=payload.name,
                enabled=payload.enabled,
                seasonal_adjustment=payload.seasonal_adjustment,
                weather_mode=payload.weather_mode,
            )
            _sync_irrigation_programs_to_controller(device_id)
            return {"device_id": device_id, "program": program}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/programs/{program_id}")
    def v2_get_irrigation_program(device_id: str, program_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return {"device_id": device_id, "program": get_irrigation_program(device_id, program_id)}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.put("/api/v2/devices/{device_id}/irrigation/programs/{program_id}")
    def v2_update_irrigation_program(device_id: str, program_id: str, payload: IrrigationProgramUpdateIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            program = update_irrigation_program(
                device_id,
                program_id,
                name=payload.name,
                enabled=payload.enabled,
                seasonal_adjustment=payload.seasonal_adjustment,
                weather_mode=payload.weather_mode,
            )
            _sync_irrigation_programs_to_controller(device_id)
            return {"device_id": device_id, "program": program}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.delete("/api/v2/devices/{device_id}/irrigation/programs/{program_id}")
    def v2_delete_irrigation_program(device_id: str, program_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            delete_irrigation_program(device_id, program_id)
            _sync_irrigation_programs_to_controller(device_id)
            return {"deleted": True}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/zones")
    def v2_list_irrigation_program_zones(device_id: str, program_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            zones = list_program_zones(device_id, program_id)
            return {"device_id": device_id, "program_id": program_id, "zones": zones}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.put("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/zones")
    def v2_replace_irrigation_program_zones(
        device_id: str,
        program_id: str,
        payload: IrrigationProgramZonesReplaceIn,
        request: Request,
    ) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            zones = replace_program_zones(device_id, program_id, [zone.model_dump() for zone in payload.zones])
            _sync_irrigation_programs_to_controller(device_id)
            return {"device_id": device_id, "program_id": program_id, "zones": zones}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/schedules")
    def v2_list_irrigation_program_schedules(device_id: str, program_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            schedules = list_program_schedules(device_id, program_id)
            return {"device_id": device_id, "program_id": program_id, "schedules": schedules}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/schedules")
    def v2_create_irrigation_program_schedule(
        device_id: str,
        program_id: str,
        payload: IrrigationScheduleCreateIn,
        request: Request,
    ) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            schedule = create_program_schedule(
                device_id,
                program_id,
                name=payload.name,
                start_local_time=payload.start_local_time,
                weekdays=payload.weekdays,
                recurrence_type=payload.recurrence_type,
                interval_days=payload.interval_days,
                anchor_date=payload.anchor_date,
                dates=payload.dates,
                enabled=payload.enabled,
            )
            _sync_irrigation_programs_to_controller(device_id)
            return {"device_id": device_id, "program_id": program_id, "schedule": schedule}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.put("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/schedules/{schedule_id}")
    def v2_update_irrigation_program_schedule(
        device_id: str,
        program_id: str,
        schedule_id: str,
        payload: IrrigationScheduleUpdateIn,
        request: Request,
    ) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            schedule = update_program_schedule(
                device_id,
                program_id,
                schedule_id,
                name=payload.name,
                start_local_time=payload.start_local_time,
                weekdays=payload.weekdays,
                recurrence_type=payload.recurrence_type,
                interval_days=payload.interval_days,
                anchor_date=payload.anchor_date,
                dates=payload.dates,
                enabled=payload.enabled,
            )
            _sync_irrigation_programs_to_controller(device_id)
            return {"device_id": device_id, "program_id": program_id, "schedule": schedule}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.delete("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/schedules/{schedule_id}")
    def v2_delete_irrigation_program_schedule(device_id: str, program_id: str, schedule_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            delete_program_schedule(device_id, program_id, schedule_id)
            _sync_irrigation_programs_to_controller(device_id)
            return {"deleted": True}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/runs")
    def v2_list_irrigation_runs(device_id: str, request: Request, limit: int = 50) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return {"device_id": device_id, "runs": list_irrigation_runs(device_id, limit=limit)}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/hydraulics")
    def v2_get_irrigation_hydraulics(device_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return get_irrigation_hydraulics(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/hydraulics")
    def v2_upsert_irrigation_hydraulics(device_id: str, payload: IrrigationHydraulicsIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            return upsert_irrigation_hydraulics_state(
                device_id,
                flow_lpm=payload.flow_lpm,
                pressure_bar=payload.pressure_bar,
                water_liters=payload.water_liters,
                source_timestamp=payload.source_timestamp,
            )
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/power")
    def v2_get_irrigation_power(device_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return get_irrigation_power(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/power")
    def v2_upsert_irrigation_power(device_id: str, payload: IrrigationPowerIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            return upsert_irrigation_power_state(
                device_id,
                voltage_rms_v=payload.voltage_rms_v,
                current_rms_a=payload.current_rms_a,
                real_power_w=payload.real_power_w,
                power_factor=payload.power_factor,
                source_timestamp=payload.source_timestamp,
            )
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.get("/api/v2/devices/{device_id}/irrigation/weather")
    def v2_get_irrigation_weather(device_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer", "viewer"})
        try:
            return get_irrigation_weather(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/weather")
    def v2_upsert_irrigation_weather(device_id: str, payload: IrrigationWeatherIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            return upsert_irrigation_weather_state(
                device_id,
                temperature_c=payload.temperature_c,
                rain_mm=payload.rain_mm,
                wind_mps=payload.wind_mps,
                eto_mm=payload.eto_mm,
                source_timestamp=payload.source_timestamp,
            )
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/rain-delay")
    def v2_set_irrigation_rain_delay(device_id: str, payload: RainDelayIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            return set_irrigation_rain_delay(device_id, delay_hours=payload.delay_hours, reason=payload.reason)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/commands")
    def v2_publish_irrigation_command(device_id: str, payload: IrrigationCommandIn, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        if not payload.command_type.startswith("irrigation."):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="only irrigation commands are supported by this endpoint")
        try:
            _ensure_irrigation_device_commandable(device_id)
            return publish_irrigation_command(
                device_id,
                command_type=payload.command_type,
                target_ref=payload.target_ref,
                parameters=payload.parameters,
            )
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/run")
    def v2_start_irrigation_program_run(device_id: str, program_id: str, request: Request, payload: IrrigationRunIn) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        run = None
        try:
            _ensure_irrigation_device_commandable(device_id)
            command = None
            if _supports_controller_local_program_run(device_id):
                controller_program_id = _controller_program_number(device_id, program_id)
                run = create_program_run(device_id, program_id, trigger_type="manual_controller")
                command = publish_irrigation_command(
                    device_id,
                    command_type="irrigation.program.start",
                    target_ref=None,
                    parameters={"program_id": controller_program_id},
                    command_id=run["run_id"],
                )
            else:
                run = create_program_run(device_id, program_id, trigger_type=payload.trigger_type)
                first_step = start_next_irrigation_run_step(device_id, run["run_id"])
                if first_step is not None:
                    command = publish_irrigation_command(
                        device_id,
                        command_type="irrigation.zone.start",
                        target_ref=first_step["local_ref"],
                        parameters={"duration_seconds": first_step["duration_seconds"]},
                        command_id=run["run_id"],
                    )
            run = _find_irrigation_run(device_id, run["run_id"], limit=20)
            return {"device_id": device_id, "program_id": program_id, "run": run, "command": command}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        except MqttCommandError as exc:
            if run is not None:
                complete_irrigation_run(device_id, run["run_id"], status="failed")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/runs/{run_id}/stop")
    def v2_stop_irrigation_program_run(device_id: str, run_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            run_snapshot = _find_irrigation_run(device_id, run_id)
            current_step = None
            command = None
            if run_snapshot.get("trigger_type") == "manual_controller":
                command = publish_irrigation_command(
                    device_id,
                    command_type="irrigation.stop_all",
                    target_ref=None,
                    parameters={},
                )
            else:
                current_step = finish_current_irrigation_run_step(device_id, run_id, status="stopped")
            if command is None and current_step is not None and current_step.get("local_ref"):
                command = publish_irrigation_command(
                    device_id,
                    command_type="irrigation.zone.stop",
                    target_ref=str(current_step["local_ref"]),
                    parameters={},
                )
            run = complete_irrigation_run(device_id, run_id, status="aborted")
            return {"device_id": device_id, "run": run, "stopped_step": current_step, "command": command}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            complete_irrigation_run(device_id, run_id, status="failed")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/runs/{run_id}/skip")
    def v2_skip_irrigation_program_run_step(device_id: str, run_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            run_snapshot = _find_irrigation_run(device_id, run_id)
            if run_snapshot.get("trigger_type") == "manual_controller":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="skip is not available for controller-local program runs",
                )
            skipped_step = finish_current_irrigation_run_step(device_id, run_id, status="skipped")
            next_step = start_next_irrigation_run_step(device_id, run_id)
            stop_command = None
            start_command = None
            if next_step is not None:
                start_command = publish_irrigation_command(
                    device_id,
                    command_type="irrigation.zone.start",
                    target_ref=next_step["local_ref"],
                    parameters={"duration_seconds": next_step["duration_seconds"]},
                )
                run = next((item for item in list_irrigation_runs(device_id, limit=20) if item["run_id"] == run_id), None)
            else:
                if skipped_step is not None and skipped_step.get("local_ref"):
                    stop_command = publish_irrigation_command(
                        device_id,
                        command_type="irrigation.zone.stop",
                        target_ref=str(skipped_step["local_ref"]),
                        parameters={},
                    )
                run = complete_irrigation_run(device_id, run_id, status="completed")
            return {
                "device_id": device_id,
                "run": run,
                "skipped_step": skipped_step,
                "next_step": next_step,
                "stop_command": stop_command,
                "start_command": start_command,
            }
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            complete_irrigation_run(device_id, run_id, status="failed")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/runs/{run_id}/complete")
    def v2_complete_irrigation_run(device_id: str, run_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            run = complete_irrigation_run(device_id, run_id)
            return {"device_id": device_id, "run": run}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router
