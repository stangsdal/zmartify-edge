from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import AuthError, AuthenticatedUser, audit_action
from app.device_onboarding import DeviceOnboardingError, push_remote_firmware, trigger_remote_reboot
from app.mqtt_commands import MqttCommandError, publish_device_ota_check, publish_irrigation_command
from app.permissions import PRODUCT_TYPES, require_global_admin, require_site_permission
from app.registry import RegistryNotFoundError, get_device_admin_token, get_device_onboarding_context
from app.schemas import DeviceOtaOut, DeviceOtaPollOut, DeviceOtaStageOut

_REQUIRED_PUBLIC_EDGE_URL = "https://api.zmartify.dk"


def _ota_stage_root() -> Path:
    return Path(os.getenv("ZMART_EDGE_OTA_STAGE_DIR", "/data/ota-stage"))


def _ota_stage_dir(device_id: str) -> Path:
    return _ota_stage_root() / device_id


def _ota_stage_meta_path(device_id: str) -> Path:
    return _ota_stage_dir(device_id) / "meta.json"


def _ota_stage_bin_path(device_id: str) -> Path:
    return _ota_stage_dir(device_id) / "firmware.bin"


def _ota_load_stage(device_id: str) -> dict | None:
    meta_path = _ota_stage_meta_path(device_id)
    bin_path = _ota_stage_bin_path(device_id)
    if not meta_path.exists() or not bin_path.exists():
        return None
    with meta_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    data["bin_path"] = str(bin_path)
    return data


def _ota_save_stage(device_id: str, firmware_bytes: bytes, version: str, force: bool, notes: str | None) -> dict:
    stage_dir = _ota_stage_dir(device_id)
    stage_dir.mkdir(parents=True, exist_ok=True)

    sha256 = hashlib.sha256(firmware_bytes).hexdigest()
    size_bytes = len(firmware_bytes)
    uploaded_at = datetime.now(timezone.utc).isoformat()

    bin_path = _ota_stage_bin_path(device_id)
    meta_path = _ota_stage_meta_path(device_id)
    with bin_path.open("wb") as f:
        f.write(firmware_bytes)

    meta = {
        "device_id": device_id,
        "version": version,
        "sha256": sha256,
        "size_bytes": size_bytes,
        "force": bool(force),
        "notes": notes,
        "uploaded_at": uploaded_at,
        "staged_at": uploaded_at,
        "triggered_at": None,
        "trigger_status": "not_triggered",
        "last_error": None,
    }
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f)

    return meta


def _edge_public_base_url() -> str:
    configured = os.getenv("ZMART_EDGE_PUBLIC_API_BASE", "").strip()
    if configured.rstrip("/") == _REQUIRED_PUBLIC_EDGE_URL:
        return _REQUIRED_PUBLIC_EDGE_URL
    return _REQUIRED_PUBLIC_EDGE_URL


def _version_parts(value: str | None) -> tuple[int, int, int] | None:
    normalized = str(value or "").strip().lower().lstrip("v").split("-", 1)[0]
    if not normalized:
        return None
    parts = normalized.split(".")
    if len(parts) > 3 or any(not item.isdigit() for item in parts):
        return None
    numbers = [int(item) for item in parts]
    return tuple((numbers + [0, 0, 0])[:3])


def _version_from_filename(filename: str | None) -> str | None:
    """Extract the release version from the uploaded artifact name."""
    name = Path(str(filename or "")).name
    match = re.search(r"(?:^|[-_])v?(\d+\.\d+\.\d+)(?:[-_.]|$)", name, flags=re.IGNORECASE)
    return match.group(1) if match else None


def create_device_ota_v2_router() -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-device-ota"])

    def require_device_configure(device_id: str, request: Request) -> dict:
        try:
            device = get_device_onboarding_context(device_id)
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

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
        return device

    @router.post("/devices/{device_id}/ota", response_model=DeviceOtaOut)
    async def v2_device_ota(device_id: str, request: Request, reboot: bool = False) -> dict:
        try:
            device = require_device_configure(device_id, request)
            local_url = device.get("local_url")
            if not local_url:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="device local_url not set")

            firmware_bytes = await request.body()
            if not firmware_bytes:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="firmware payload is empty")

            ota_response = push_remote_firmware(local_url, firmware_bytes)

            reboot_triggered = False
            reboot_response = None
            reboot_error = None
            if reboot:
                try:
                    reboot_response = trigger_remote_reboot(local_url)
                    reboot_triggered = bool(reboot_response.get("ok", True))
                except DeviceOnboardingError as exc:
                    reboot_error = str(exc)

            written_bytes = None
            if isinstance(ota_response, dict):
                raw_written = ota_response.get("written_bytes")
                if isinstance(raw_written, int):
                    written_bytes = raw_written

            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="device_ota",
                resource_type="device",
                resource_id=device_id,
                metadata={
                    "base_url": local_url,
                    "reboot": reboot,
                    "payload_bytes": len(firmware_bytes),
                    "written_bytes": written_bytes,
                    "reboot_error": reboot_error,
                },
            )

            return {
                "device_id": device_id,
                "local_url": local_url,
                "ota_response": ota_response,
                "written_bytes": written_bytes,
                "reboot_requested": reboot,
                "reboot_triggered": reboot_triggered,
                "reboot_response": reboot_response,
                "reboot_error": reboot_error,
            }
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except DeviceOnboardingError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/ota/stage", response_model=DeviceOtaStageOut)
    async def v2_device_ota_stage(
        device_id: str,
        request: Request,
        version: str | None = None,
        force: bool = False,
        notes: str | None = None,
    ) -> dict:
        try:
            _ = require_device_configure(device_id, request)
            firmware_bytes = await request.body()
            if not firmware_bytes:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="firmware payload is empty")

            filename_version = _version_from_filename(request.headers.get("x-firmware-filename"))
            resolved_version = filename_version or (version.strip() if version else None)
            if not resolved_version or _version_parts(resolved_version) is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="firmware version must be present in the filename, e.g. zmartify-hvac-ahc9000-0.3.12.bin")
            if version and filename_version and _version_parts(version) != _version_parts(filename_version):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="firmware version does not match filename")

            staged = _ota_save_stage(device_id, firmware_bytes, version=resolved_version, force=force, notes=notes)
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="stage_device_ota",
                resource_type="device",
                resource_id=device_id,
                metadata={
                    "version": staged["version"],
                    "sha256": staged["sha256"],
                    "size_bytes": staged["size_bytes"],
                    "force": staged["force"],
                },
            )
            return staged
        except RegistryNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    @router.post("/devices/{device_id}/ota/trigger")
    def v2_device_ota_trigger(device_id: str, request: Request) -> dict:
        _ = require_device_configure(device_id, request)
        try:
            result = publish_device_ota_check(device_id)
            staged = _ota_load_stage(device_id)
            if staged is not None:
                staged["triggered_at"] = datetime.now(timezone.utc).isoformat()
                staged["trigger_status"] = "published"
                staged["last_error"] = None
                with _ota_stage_meta_path(device_id).open("w", encoding="utf-8") as f:
                    json.dump({key: value for key, value in staged.items() if key != "bin_path"}, f)
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="trigger_device_ota",
                resource_type="device",
                resource_id=device_id,
                metadata={"topic": result.get("topic")},
            )
            return result
        except (RegistryNotFoundError, MqttCommandError) as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.get("/devices/{device_id}/ota/status")
    def v2_device_ota_status(device_id: str, request: Request) -> dict:
        _ = require_device_configure(device_id, request)
        staged = _ota_load_stage(device_id)
        device = get_device_onboarding_context(device_id)
        current_version = str(device.get("firmware_version") or "").strip() or None
        if staged is None:
            return {
                "device_id": device_id,
                "state": "not_staged",
                "staged_version": None,
                "current_version": current_version,
                "deployed": False,
            }

        staged_version = str(staged.get("version") or "").strip() or None
        deployed = bool(current_version and staged_version and _version_parts(current_version) == _version_parts(staged_version))
        if deployed:
            state = "deployed"
        elif staged.get("triggered_at"):
            state = "awaiting_device"
        else:
            state = "staged"
        return {
            "device_id": device_id,
            "state": state,
            "deployed": deployed,
            "staged_version": staged_version,
            "current_version": current_version,
            "staged_at": staged.get("staged_at") or staged.get("uploaded_at"),
            "triggered_at": staged.get("triggered_at"),
            "trigger_status": staged.get("trigger_status"),
            "last_seen_at": device.get("last_seen_at"),
            "sha256": staged.get("sha256"),
            "size_bytes": staged.get("size_bytes"),
            "last_error": staged.get("last_error"),
        }

    @router.post("/devices/{device_id}/ota/pull-config")
    def v2_configure_device_pull_ota(device_id: str, request: Request) -> dict:
        device = require_device_configure(device_id, request)
        if str(device.get("device_type") or "") != "irrigation_controller":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="pull OTA MQTT bootstrap is only supported for irrigation controllers")
        try:
            device_token = get_device_admin_token(device_id)
            command = publish_irrigation_command(
                device_id,
                "irrigation.ota.config",
                None,
                {"edge_url": _edge_public_base_url(), "device_token": device_token},
            )
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="configure_device_pull_ota",
                resource_type="device",
                resource_id=device_id,
                metadata={"command_id": command.get("command_id")},
            )
            return {"device_id": device_id, "status": "published", "command_id": command.get("command_id")}
        except (RegistryNotFoundError, MqttCommandError) as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    @router.get("/devices/{device_id}/ota/poll", response_model=DeviceOtaPollOut)
    def v2_device_ota_poll(device_id: str, request: Request, current_version: str | None = None) -> dict:
        _ = request
        staged = _ota_load_stage(device_id)
        if staged is None:
            return {
                "device_id": device_id,
                "update_available": False,
                "reason": "no staged update",
            }

        if not staged.get("force") and current_version:
            current = _version_parts(current_version)
            staged_version = _version_parts(staged.get("version"))
            if current is not None and staged_version is not None and staged_version <= current:
                return {
                    "device_id": device_id,
                    "update_available": False,
                    "reason": "staged version is not newer than device version",
                }

        base = _edge_public_base_url()
        return {
            "device_id": device_id,
            "update_available": True,
            "version": staged.get("version"),
            "sha256": staged.get("sha256"),
            "size_bytes": staged.get("size_bytes"),
            "download_url": f"{base}/api/v2/devices/{device_id}/ota/download?sha256={staged.get('sha256')}",
        }

    @router.get("/devices/{device_id}/ota/download")
    def v2_device_ota_download(device_id: str, request: Request, sha256: str) -> Response:
        _ = request
        staged = _ota_load_stage(device_id)
        if staged is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no staged update")

        expected_sha = str(staged.get("sha256") or "")
        if not expected_sha or sha256 != expected_sha:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="staged update not found")

        bin_path = _ota_stage_bin_path(device_id)
        if not bin_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="staged binary missing")

        payload = bin_path.read_bytes()
        return Response(
            content=payload,
            media_type="application/octet-stream",
            headers={
                "Content-Length": str(len(payload)),
                "X-Firmware-Version": str(staged.get("version") or ""),
                "X-Firmware-Sha256": expected_sha,
            },
        )

    return router
