from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER, ROLE_VIEWER, audit_action
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    RegistryOperationError,
    create_mqtt_client,
    delete_mqtt_client,
    get_mqtt_client,
    list_mqtt_clients,
    rotate_mqtt_client_password,
    set_mqtt_client_enabled,
)
from app.schemas import MqttClientCreate, MqttClientOut, MqttCredentialOut


def create_mqtt_clients_v2_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-mqtt"])

    @router.post("/mqtt/clients", response_model=MqttCredentialOut, status_code=status.HTTP_201_CREATED)
    def v2_create_mqtt_client(payload: MqttClientCreate, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            created = create_mqtt_client(
                client_type=payload.client_type,
                domain_id=payload.domain_id,
                site_id=payload.site_id,
                device_pk_id=payload.device_id,
                username=payload.username,
            )
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="create_mqtt_client",
                resource_type="mqtt_client",
                resource_id=str(created["id"]),
            )
            return {
                "mqtt_client_id": created["id"],
                "username": created["username"],
                "password": created["password"],
                "password_one_time": True,
            }
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryConflictError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    @router.get("/mqtt/clients", response_model=list[MqttClientOut])
    def v2_list_mqtt_clients(request: Request) -> list[dict]:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        return list_mqtt_clients()

    @router.get("/mqtt/clients/{client_id}", response_model=MqttClientOut)
    def v2_get_mqtt_client(client_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER, ROLE_VIEWER})
        try:
            return get_mqtt_client(client_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/mqtt/clients/{client_id}/rotate-password", response_model=MqttCredentialOut)
    def v2_rotate_mqtt_password(client_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            rotated = rotate_mqtt_client_password(client_id)
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="rotate_mqtt_password",
                resource_type="mqtt_client",
                resource_id=str(client_id),
            )
            return rotated
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    @router.post("/mqtt/clients/{client_id}/disable", response_model=MqttClientOut)
    def v2_disable_mqtt_client(client_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            return set_mqtt_client_enabled(client_id, enabled=False)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    @router.post("/mqtt/clients/{client_id}/enable", response_model=MqttClientOut)
    def v2_enable_mqtt_client(client_id: int, request: Request) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            return set_mqtt_client_enabled(client_id, enabled=True)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    @router.delete("/mqtt/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
    def v2_delete_mqtt_client(client_id: int, request: Request) -> Response:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN})
        try:
            delete_mqtt_client(client_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except RegistryOperationError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
