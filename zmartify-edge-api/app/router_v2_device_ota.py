from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.auth import ROLE_ADMIN, ROLE_INSTALLER, ROLE_OWNER, audit_action
from app.device_onboarding import DeviceOnboardingError, push_remote_firmware, trigger_remote_reboot
from app.registry import RegistryNotFoundError, get_device_onboarding_context
from app.schemas import DeviceOtaOut, DeviceOtaPollOut, DeviceOtaStageOut

_REQUIRED_PUBLIC_EDGE_URL = "https://pilot.zmartify.dk"


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
    }
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f)

    return meta


def _edge_public_base_url() -> str:
    configured = os.getenv("ZMART_EDGE_PUBLIC_API_BASE", "").strip()
    if configured.rstrip("/") == _REQUIRED_PUBLIC_EDGE_URL:
        return _REQUIRED_PUBLIC_EDGE_URL
    return _REQUIRED_PUBLIC_EDGE_URL


def create_device_ota_v2_router(require_roles: Callable[[Request, set[str]], None]) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["api-v2-device-ota"])

    @router.post("/devices/{device_id}/ota", response_model=DeviceOtaOut)
    async def v2_device_ota(device_id: str, request: Request, reboot: bool = False) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            device = get_device_onboarding_context(device_id)
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
        version: str,
        force: bool = False,
        notes: str | None = None,
    ) -> dict:
        require_roles(request, {ROLE_OWNER, ROLE_ADMIN, ROLE_INSTALLER})
        try:
            _ = get_device_onboarding_context(device_id)
            firmware_bytes = await request.body()
            if not firmware_bytes:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="firmware payload is empty")

            staged = _ota_save_stage(device_id, firmware_bytes, version=version.strip(), force=force, notes=notes)
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

        if not staged.get("force") and current_version and current_version.strip() == staged.get("version"):
            return {
                "device_id": device_id,
                "update_available": False,
                "reason": "already on staged version",
            }

        base = _edge_public_base_url()
        return {
            "device_id": device_id,
            "update_available": True,
            "version": staged.get("version"),
            "sha256": staged.get("sha256"),
            "size_bytes": staged.get("size_bytes"),
            "download_url": f"{base}/devices/{device_id}/ota/download?sha256={staged.get('sha256')}",
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
