from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.auth import AuthError, AuthenticatedUser, audit_action
from app.mqtt_commands import MqttCommandError, publish_device_ota_check, publish_irrigation_command
from app.permissions import PRODUCT_TYPES, require_global_admin, require_site_permission
from app.registry import RegistryNotFoundError, get_device_admin_token, get_device_onboarding_context
from app.schemas import DeviceOtaPollOut, DeviceOtaStageOut

_REQUIRED_PUBLIC_EDGE_URL = "https://api.zmartify.dk"


class CatalogOtaStageIn(BaseModel):
    catalog_id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    version: str = Field(min_length=5, max_length=64, pattern=r"^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$")
    force: bool = False


def _firmware_catalog_root() -> Path:
    configured = os.getenv("ZMART_EDGE_FIRMWARE_CATALOG_DIR", "").strip()
    candidates = [
        Path(configured) if configured else None,
        Path("/zmartify-admin/dist/firmware"),
        Path(__file__).resolve().parents[2] / "zmartify-admin" / "public" / "firmware",
    ]
    for candidate in candidates:
        if candidate is not None and (candidate / "catalog.json").is_file():
            return candidate.resolve()
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="firmware catalog is unavailable")


def _catalog_child(root: Path, relative_path: str, label: str) -> Path:
    candidate = (root / relative_path).resolve()
    if root not in candidate.parents or not candidate.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid catalog {label}")
    return candidate


def _load_catalog_ota(catalog_id: str, requested_version: str, device: dict) -> tuple[bytes, str, str]:
    root = _firmware_catalog_root()
    try:
        catalog = json.loads((root / "catalog.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="firmware catalog is invalid") from exc

    controller = next((item for item in catalog.get("controllers", []) if item.get("id") == catalog_id), None)
    if controller is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="firmware catalog release not found")

    patterns = controller.get("device_id_patterns") or [catalog_id]
    identity = " ".join(str(device.get(key) or "") for key in ("device_id", "display_name", "device_type", "product_type")).lower()
    if not any(str(pattern).lower() in identity for pattern in patterns):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="firmware release is incompatible with this controller")

    releases_path = _catalog_child(root, str(controller.get("releases") or ""), "release index")
    try:
        release_index = json.loads(releases_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="firmware release index is invalid") from exc
    release = next((item for item in release_index.get("releases", []) if item.get("version") == requested_version), None)
    if release is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="firmware catalog version not found")
    version = str(release.get("version") or "").strip()
    ota = release.get("ota")
    if not isinstance(ota, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="catalog release has no OTA artifact")
    expected_sha256 = str(ota.get("sha256") or "").lower()
    if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="firmware catalog OTA checksum is invalid")

    ota_path = _catalog_child(releases_path.parent, str(ota.get("path") or ""), "OTA artifact")
    firmware_bytes = ota_path.read_bytes()
    actual_sha256 = hashlib.sha256(firmware_bytes).hexdigest()
    if actual_sha256 != expected_sha256:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="firmware catalog OTA checksum mismatch")
    return firmware_bytes, version, expected_sha256


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

    @router.post("/devices/{device_id}/ota")
    def v2_device_ota_upload_disabled(device_id: str, request: Request) -> None:
        _ = require_device_configure(device_id, request)
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="firmware upload is disabled; stage an exact firmware catalog release",
        )

    @router.post("/devices/{device_id}/ota/stage")
    def v2_device_ota_stage_upload_disabled(device_id: str, request: Request) -> None:
        _ = require_device_configure(device_id, request)
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="firmware upload is disabled; stage an exact firmware catalog release",
        )

    @router.post("/devices/{device_id}/ota/stage-catalog", response_model=DeviceOtaStageOut)
    def v2_device_ota_stage_catalog(device_id: str, payload: CatalogOtaStageIn, request: Request) -> dict:
        try:
            device = require_device_configure(device_id, request)
            firmware_bytes, version, catalog_sha256 = _load_catalog_ota(payload.catalog_id, payload.version, device)
            staged = _ota_save_stage(
                device_id,
                firmware_bytes,
                version=version,
                force=payload.force,
                notes=f"Firmware catalog release {payload.catalog_id} {version}",
            )
            if staged["sha256"] != catalog_sha256:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="staged firmware checksum mismatch")
            audit_action(
                actor_user_id=request.state.auth_user.user_id,
                action="stage_catalog_device_ota",
                resource_type="device",
                resource_id=device_id,
                metadata={
                    "catalog_id": payload.catalog_id,
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
