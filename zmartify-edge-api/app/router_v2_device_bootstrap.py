from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.auth import AuthError, AuthenticatedUser, audit_action
from app.db import get_connection
from app.permissions import PRODUCT_TYPES, require_global_admin, require_site_permission
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    assign_device_site,
    create_device,
    ensure_device_admin_token,
    get_device_mqtt_credentials,
    get_device_onboarding_context,
    get_device,
    rotate_mqtt_client_password,
)

_EDGE_URL = "https://pilot.zmartify.dk"
_MQTT_URI = "mqtts://pilot.zmartify.dk:8883"
_CLAIM_LIFETIME_S = 600


class DeviceBootstrapStageIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    device_id: str = Field(min_length=1, max_length=128)
    claim_token: str = Field(pattern=r"^[0-9]{6}$")
    domain_id: int
    site_id: int
    display_name: str = Field(min_length=1, max_length=128)
    mac: str | None = Field(default=None, max_length=32)
    firmware_version: str | None = Field(default=None, max_length=64)
    product_type: Literal["hvac", "irrigation", "weather", "energy"] = "hvac"


class DeviceBootstrapPollIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    device_id: str = Field(min_length=1, max_length=128)
    claim_token: str = Field(pattern=r"^[0-9]{6}$")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def create_device_bootstrap_v2_router() -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-device-bootstrap"])

    def require_target_site_configure(payload: DeviceBootstrapStageIn, request: Request) -> None:
        auth_user: AuthenticatedUser | None = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        try:
            require_site_permission(
                auth_user,
                payload.site_id,
                product_type=payload.product_type,
                permission="configure",
            )
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    def require_existing_device_configure(device: dict, request: Request) -> None:
        auth_user: AuthenticatedUser | None = getattr(request.state, "auth_user", None)
        if auth_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required")
        site_id = device.get("site_id")
        product_type = str(device.get("product_type") or "")
        try:
            if site_id is None or product_type not in PRODUCT_TYPES:
                require_global_admin(auth_user)
            else:
                require_site_permission(auth_user, int(site_id), product_type=product_type, permission="configure")  # type: ignore[arg-type]
        except AuthError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    @router.post("/devices/bootstrap/stage", status_code=status.HTTP_201_CREATED)
    def stage_device_bootstrap(payload: DeviceBootstrapStageIn, request: Request) -> dict:
        require_target_site_configure(payload, request)
        existing_device = False
        try:
            device = create_device(
                device_id=payload.device_id,
                display_name=payload.display_name,
                mac=payload.mac,
                firmware_version=payload.firmware_version,
                product_type=payload.product_type,
            )
        except RegistryConflictError:
            existing_device = True
            try:
                device = get_device(payload.device_id)
                require_existing_device_configure(device, request)
            except RegistryNotFoundError as exc:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

        try:
            device = assign_device_site(payload.device_id, payload.site_id)
            context = get_device_onboarding_context(payload.device_id)
            if int(context.get("domain_id") or 0) != payload.domain_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="site does not belong to domain")
            if existing_device:
                credentials = get_device_mqtt_credentials(payload.device_id)
                rotate_mqtt_client_password(int(credentials["mqtt_client_id"]))
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=_CLAIM_LIFETIME_S)
            with get_connection() as conn:
                conn.execute("DELETE FROM device_bootstrap_claims WHERE device_id = ?", (payload.device_id,))
                conn.execute(
                    "INSERT INTO device_bootstrap_claims(device_id, claim_token_hash, expires_at) VALUES (?, ?, ?)",
                    (payload.device_id, _token_hash(payload.claim_token), expires_at.isoformat()),
                )
            audit_action(actor_user_id=request.state.auth_user.user_id, action="stage_device_bootstrap", resource_type="device", resource_id=payload.device_id)
            return {"device": device, "expires_at": expires_at.isoformat(), "state": "staged"}
        except Exception:
            if existing_device:
                raise
            from app.registry import delete_device

            delete_device(payload.device_id)
            raise

    @router.post("/device-bootstrap/config")
    def poll_device_bootstrap(payload: DeviceBootstrapPollIn) -> dict:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT claim_token_hash, expires_at FROM device_bootstrap_claims WHERE device_id = ?",
                (payload.device_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="bootstrap claim not found")
            if datetime.now(timezone.utc) >= datetime.fromisoformat(str(row["expires_at"])):
                conn.execute("DELETE FROM device_bootstrap_claims WHERE device_id = ?", (payload.device_id,))
                raise HTTPException(status_code=status.HTTP_410_GONE, detail="bootstrap claim expired")
            if not secrets.compare_digest(str(row["claim_token_hash"]), _token_hash(payload.claim_token)):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="invalid bootstrap claim")
            conn.execute("DELETE FROM device_bootstrap_claims WHERE device_id = ?", (payload.device_id,))

        try:
            context = get_device_onboarding_context(payload.device_id)
            credentials = get_device_mqtt_credentials(payload.device_id)
            return {
                "device_admin_token": ensure_device_admin_token(payload.device_id),
                "edge_url": _EDGE_URL,
                "mqtt_uri": _MQTT_URI,
                "mqtt_username": credentials["username"],
                "mqtt_password": credentials["password"],
                "mqtt_base": "homie/5",
                "domain_id": context["domain_id"],
                "site_id": context["site_id"],
                "claim_token": payload.claim_token,
            }
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return router