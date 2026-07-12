from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.irrigation_domain import (
    create_irrigation_program,
    list_irrigation_programs,
    list_irrigation_zones,
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

    return router
