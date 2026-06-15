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


class DomainRename(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)


class DomainOut(BaseModel):
    id: int
    uuid: str | None = None
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
    uuid: str | None = None
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
    uuid: str | None = None
    device_id: str
    display_name: str
    mac: str | None
    firmware_version: str | None
    site_id: int | None
    local_url: str | None = None
    device_type: str
    integration_mode: str
    created_at: str
    last_seen_at: str | None


class DeviceDiscoverIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    base_url: str = Field(min_length=1)


class DeviceDiscoverOut(BaseModel):
    base_url: str
    identity: dict
    claim: dict
    status: dict


class DeviceClaimIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    base_url: str = Field(min_length=1)
    claim_token: str | None = None
    domain_id: int
    site_id: int
    display_name: str | None = None


class DevicePushConfigIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    claim_token: str | None = None


class DeviceClaimOut(BaseModel):
    device: DeviceOut
    onboarding_status: dict


class DeviceOnboardingStatusOut(BaseModel):
    state: str
    device_id: str
    edge_url: str | None
    mqtt_configured: bool
    mqtt_connected: bool
    last_error: str | None


class ZoneRenameIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)


class ZoneMetadataIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    floor: str | None = None
    area_m2: float | None = None


class ZoneOut(BaseModel):
    zone_uuid: str
    zone_id: int
    name: str
    icon: str | None = None
    sort_order: int
    floor: str | None = None
    area_m2: float | None = None
    current_temperature_c: float | None = None
    target_temperature_c: float | None = None
    demand: bool | None = None
    active: bool | None = None
    fault: str | None = None
    updated_at: str | None = None
    source_timestamp: str | None = None
    freshness_age_ms: int | None = None
    online: bool


class ChannelMetadataIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = None
    icon: str | None = None
    sort_order: int | None = None


class ChannelStateIn(BaseModel):
    active: bool | None = None
    fault: str | None = None


class ChannelZoneLinksIn(BaseModel):
    zone_ids: list[int] = Field(default_factory=list)


class TelemetryZoneIn(BaseModel):
    zone_id: int
    current_temperature_c: float | None = None
    target_temperature_c: float | None = None
    demand: bool | None = None
    active: bool | None = None
    fault: str | None = None


class TelemetryChannelIn(BaseModel):
    channel_id: int
    active: bool | None = None
    fault: str | None = None


class DeviceTwinIngestIn(BaseModel):
    source: str = Field(default="device_ingest", min_length=1)
    source_timestamp: str | None = None
    online: bool | None = None
    mqtt_connected: bool | None = None
    last_error: str | None = None
    zones: list[TelemetryZoneIn] = Field(default_factory=list)
    channels: list[TelemetryChannelIn] = Field(default_factory=list)


class ChannelOut(BaseModel):
    channel_uuid: str
    channel_id: int
    name: str
    icon: str | None = None
    sort_order: int
    linked_zone_ids: list[int] = Field(default_factory=list)
    active: bool | None = None
    fault: str | None = None
    updated_at: str | None = None
    source_timestamp: str | None = None
    freshness_age_ms: int | None = None
    online: bool


class DeviceTwinIngestResult(BaseModel):
    device_id: str
    source: str
    source_timestamp: str | None = None
    zone_updates: int
    channel_updates: int
    device_state: dict | None = None
    applied: bool = True
    skip_reason: str | None = None


class FreshnessDeviceOut(BaseModel):
    online: bool | None = None
    mqtt_connected: bool | None = None
    updated_at: str | None = None
    source_timestamp: str | None = None
    freshness_age_ms: int | None = None


class FreshnessZoneOut(BaseModel):
    zone_id: int
    updated_at: str | None = None
    source_timestamp: str | None = None
    freshness_age_ms: int | None = None


class FreshnessChannelOut(BaseModel):
    channel_id: int
    updated_at: str | None = None
    source_timestamp: str | None = None
    freshness_age_ms: int | None = None


class DeviceFreshnessOut(BaseModel):
    device_id: str
    device: FreshnessDeviceOut
    zones: list[FreshnessZoneOut] = Field(default_factory=list)
    channels: list[FreshnessChannelOut] = Field(default_factory=list)


class MobileSetpointIn(BaseModel):
    target_temperature_c: float


class EventOut(BaseModel):
    id: int
    uuid: str
    event_type: str
    domain_id: int | None = None
    site_id: int | None = None
    device_id: int | None = None
    zone_id: int | None = None
    payload: dict = Field(default_factory=dict)
    created_at: str


class NotificationOut(BaseModel):
    notification_id: str
    read: bool
    created_at: str
    event: dict


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


class AuthLoginIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthLoginOut(BaseModel):
    access_token: str
    expires_at: str


class SetupStatusOut(BaseModel):
    initialized: bool


class UserCreateIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    username: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    password: str = Field(min_length=12)
    email: str | None = None
    roles: list[str] = Field(default_factory=list)


class UserRoleUpdateIn(BaseModel):
    roles: list[str] = Field(default_factory=list)


class UserResetPasswordIn(BaseModel):
    password: str = Field(min_length=12)


class UserSiteAccessUpdateIn(BaseModel):
    site_ids: list[int] = Field(default_factory=list)


class UserOut(BaseModel):
    id: int
    uuid: str | None = None
    username: str
    email: str | None
    display_name: str
    enabled: int
    created_at: str
    updated_at: str | None
    last_login_at: str | None
    roles: list[str]


class AuditLogOut(BaseModel):
    id: int
    user_id: int | None
    username: str | None
    action: str
    resource_type: str | None
    resource_id: str | None
    metadata: str | None
    created_at: str
