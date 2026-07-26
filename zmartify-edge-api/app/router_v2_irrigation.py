from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.irrigation_domain import (
    complete_irrigation_run,
    create_program_run,
    create_program_schedule,
    create_irrigation_program,
    delete_irrigation_program,
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
    upsert_irrigation_hydraulics_state,
    upsert_irrigation_output_state,
    upsert_irrigation_power_state,
    upsert_irrigation_weather_state,
    upsert_irrigation_zone,
)
from app.mqtt_commands import MqttCommandError, publish_irrigation_command
from app.registry import RegistryNotFoundError


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
            return {"device_id": device_id, "program": program}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

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
            return {"device_id": device_id, "program": program}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.delete("/api/v2/devices/{device_id}/irrigation/programs/{program_id}")
    def v2_delete_irrigation_program(device_id: str, program_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            delete_irrigation_program(device_id, program_id)
            return {"deleted": True}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

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
            return {"device_id": device_id, "program_id": program_id, "zones": zones}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

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
            return {"device_id": device_id, "program_id": program_id, "schedule": schedule}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

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
            run = create_program_run(device_id, program_id, trigger_type=payload.trigger_type)
            command = None
            first_step = start_next_irrigation_run_step(device_id, run["run_id"])
            if first_step is not None:
                command = publish_irrigation_command(
                    device_id,
                    command_type="irrigation.zone.start",
                    target_ref=first_step["local_ref"],
                    parameters={"duration_seconds": first_step["duration_seconds"]},
                )
                run = next((item for item in list_irrigation_runs(device_id, limit=20) if item["run_id"] == run["run_id"]), run)
            return {"device_id": device_id, "program_id": program_id, "run": run, "command": command}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except MqttCommandError as exc:
            if run is not None:
                complete_irrigation_run(device_id, run["run_id"], status="failed")
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
