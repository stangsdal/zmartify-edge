from fastapi import FastAPI, HTTPException, Response, status

from app.db import get_db_path, initialize_database
from app.registry import (
    RegistryConflictError,
    RegistryNotFoundError,
    assign_device_site,
    create_device,
    create_domain,
    create_site,
    delete_device,
    delete_domain,
    delete_site,
    get_device,
    get_domain,
    get_site,
    list_devices,
    list_domains,
    list_sites,
    rename_device,
)
from app.schemas import (
    DeviceAssignSite,
    DeviceCreate,
    DeviceOut,
    DeviceRename,
    DomainCreate,
    DomainOut,
    SiteCreate,
    SiteOut,
)

app = FastAPI(title="HVAC Edge API", version="0.1.0")


@app.on_event("startup")
def startup_event() -> None:
    initialize_database()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "hvac-edge-api",
        "db_path": str(get_db_path()),
    }


@app.get("/registry/status")
def registry_status() -> dict:
    return {
        "phase": "B",
        "status": "registry_crud_enabled",
    }


@app.post("/domains", response_model=DomainOut, status_code=status.HTTP_201_CREATED)
def api_create_domain(payload: DomainCreate) -> dict:
    try:
        return create_domain(payload.slug, payload.name)
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/domains", response_model=list[DomainOut])
def api_list_domains() -> list[dict]:
    return list_domains()


@app.get("/domains/{domain_id}", response_model=DomainOut)
def api_get_domain(domain_id: int) -> dict:
    try:
        return get_domain(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_domain(domain_id: int) -> Response:
    try:
        delete_domain(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/domains/{domain_id}/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
def api_create_site(domain_id: int, payload: SiteCreate) -> dict:
    try:
        return create_site(domain_id, payload.slug, payload.name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/domains/{domain_id}/sites", response_model=list[SiteOut])
def api_list_sites(domain_id: int) -> list[dict]:
    try:
        return list_sites(domain_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.get("/sites/{site_id}", response_model=SiteOut)
def api_get_site(site_id: int) -> dict:
    try:
        return get_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_site(site_id: int) -> Response:
    try:
        delete_site(site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/devices", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
def api_create_device(payload: DeviceCreate) -> dict:
    try:
        return create_device(
            device_id=payload.device_id,
            display_name=payload.display_name,
            mac=payload.mac,
            firmware_version=payload.firmware_version,
        )
    except RegistryConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/devices", response_model=list[DeviceOut])
def api_list_devices() -> list[dict]:
    return list_devices()


@app.get("/devices/{device_id}", response_model=DeviceOut)
def api_get_device(device_id: str) -> dict:
    try:
        return get_device(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/assign-site", response_model=DeviceOut)
def api_assign_site(device_id: str, payload: DeviceAssignSite) -> dict:
    try:
        return assign_device_site(device_id, payload.site_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.post("/devices/{device_id}/rename", response_model=DeviceOut)
def api_rename_device(device_id: str, payload: DeviceRename) -> dict:
    try:
        return rename_device(device_id, payload.display_name)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@app.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def api_delete_device(device_id: str) -> Response:
    try:
        delete_device(device_id)
    except RegistryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
