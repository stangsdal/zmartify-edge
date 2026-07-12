from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER
from app.contracts import ContractValidationError
from app.domain_model import DomainModelError
from app.mqtt_v2_ingest import ingest_mqtt_v2_irrigation_outcome, ingest_mqtt_v2_reported_state, ingest_mqtt_v2_setpoint_outcome
from app.registry import RegistryNotFoundError


def create_mqtt_ingest_v2_router(
    require_roles: Callable[[Request, set[str]], None],
    publish_zone_state_update: Callable[[str, dict], None],
) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-mqtt-ingest"])

    @router.post("/devices/{device_id}/ingest/mqtt/reported-state")
    def v2_ingest_mqtt_reported_state(device_id: str, payload: dict[str, Any], request: Request) -> dict:
        device_token_device_id = getattr(request.state, "device_token_device_id", None)
        if device_token_device_id != device_id:
            require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            return ingest_mqtt_v2_reported_state(
                device_id,
                payload,
                source="mqtt_v2_ingest_api",
                publish_zone_state_update_hook=publish_zone_state_update,
            )
        except ContractValidationError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/ingest/mqtt/hvac/zones/{zone_id}/setpoint-outcome")
    def v2_ingest_mqtt_setpoint_outcome(device_id: str, zone_id: int, payload: dict[str, Any], request: Request) -> dict:
        device_token_device_id = getattr(request.state, "device_token_device_id", None)
        if device_token_device_id != device_id:
            require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            return ingest_mqtt_v2_setpoint_outcome(device_id, zone_id, payload)
        except ContractValidationError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/ingest/mqtt/irrigation/outcome")
    def v2_ingest_mqtt_irrigation_outcome(device_id: str, payload: dict[str, Any], request: Request) -> dict:
        device_token_device_id = getattr(request.state, "device_token_device_id", None)
        if device_token_device_id != device_id:
            require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            return ingest_mqtt_v2_irrigation_outcome(device_id, payload)
        except ContractValidationError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DomainModelError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return router
