import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

SLUG_RE = re.compile(r"^[a-z0-9-]+$")
DEVICE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
MQTT_CLIENT_TYPES = {"device", "homeassistant", "homey", "admin", "service"}


class DomainCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    slug: str = Field(min_length=1)
    name: str = Field(min_length=1)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        if not SLUG_RE.fullmatch(value):
            raise ValueError("slug must contain only a-z, 0-9, and hyphen")
        return value


class DomainOut(BaseModel):
    id: int
    slug: str
    name: str
    created_at: str


class SiteCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    slug: str = Field(min_length=1)
    name: str = Field(min_length=1)

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, value: str) -> str:
        if not SLUG_RE.fullmatch(value):
            raise ValueError("slug must contain only a-z, 0-9, and hyphen")
        return value


class SiteOut(BaseModel):
    id: int
    domain_id: int
    slug: str
    name: str
    created_at: str


class DeviceCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    device_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    mac: str | None = None
    firmware_version: str | None = None

    @field_validator("device_id")
    @classmethod
    def validate_device_id(cls, value: str) -> str:
        if not DEVICE_ID_RE.fullmatch(value):
            raise ValueError("device_id must contain only lowercase a-z, 0-9, and hyphen")
        return value


class DeviceAssignSite(BaseModel):
    site_id: int


class DeviceRename(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: str = Field(min_length=1)


class DeviceOut(BaseModel):
    id: int
    device_id: str
    display_name: str
    mac: str | None
    firmware_version: str | None
    site_id: int | None
    device_type: str
    integration_mode: str
    created_at: str
    last_seen_at: str | None


class MqttClientCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    client_type: str = Field(min_length=1)
    domain_id: int | None = None
    site_id: int | None = None
    device_id: int | None = None
    username: str | None = None

    @field_validator("client_type")
    @classmethod
    def validate_client_type(cls, value: str) -> str:
        if value not in MQTT_CLIENT_TYPES:
            raise ValueError("client_type must be one of: device, homeassistant, homey, admin, service")
        return value


class MqttClientOut(BaseModel):
    id: int
    username: str
    client_type: str
    domain_id: int | None
    site_id: int | None
    device_id: int | None
    created_at: str
    enabled: int


class MqttCredentialOut(BaseModel):
    mqtt_client_id: int
    username: str
    password: str
    password_one_time: bool = True
