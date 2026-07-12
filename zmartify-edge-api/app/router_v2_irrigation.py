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
    list_irrigation_runs,
    list_program_schedules,
    list_irrigation_programs,
    list_irrigation_zones,
    update_irrigation_program,
    upsert_irrigation_zone,
)
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
    enabled: bool = True


class IrrigationRunIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    trigger_type: str = Field(default="manual", min_length=1)


class IrrigationProgramUpdateIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)
    enabled: bool = True
    seasonal_adjustment: float = Field(default=1.0, ge=0.1, le=5.0)
    weather_mode: str = Field(default="automatic", min_length=1)


def create_irrigation_v2_router(require_roles) -> APIRouter:
    router = APIRouter(tags=["api-v2-irrigation"])

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

    @router.post("/api/v2/devices/{device_id}/irrigation/programs/{program_id}/run")
    def v2_start_irrigation_program_run(device_id: str, program_id: str, request: Request, payload: IrrigationRunIn) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            run = create_program_run(device_id, program_id, trigger_type=payload.trigger_type)
            return {"device_id": device_id, "program_id": program_id, "run": run}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/api/v2/devices/{device_id}/irrigation/runs/{run_id}/complete")
    def v2_complete_irrigation_run(device_id: str, run_id: str, request: Request) -> dict:
        require_roles(request, {"owner", "admin", "installer"})
        try:
            run = complete_irrigation_run(device_id, run_id)
            return {"device_id": device_id, "run": run}
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router
