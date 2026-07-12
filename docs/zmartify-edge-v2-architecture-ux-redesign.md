# Zmartify Edge v2 – Architecture & UX Redesign

**Status:** Proposed target architecture  
**Repository:** `stangsdal/zmartify-edge`  
**Scope:** Shared edge control plane for HVAC, irrigation and future Zmartify products  
**Target clients:** Responsive web app first, installable PWA immediately, Capacitor-based iOS/Android app later  
**Primary database:** PostgreSQL with TimescaleDB  
**Document version:** 0.2  

---

## 1. Executive summary

Zmartify Edge already contains several valuable platform capabilities: authentication, users and roles, domains and sites, device onboarding, MQTT credentials and ACL generation, OTA, device state ingestion, notifications, audit logging and a mobile-oriented Ionic/React frontend.

The current implementation is nevertheless strongly shaped around HVAC. The existing zone model, mobile API and user interface assume temperatures, setpoints, rooms and heating demand. Irrigation introduces a different domain model consisting of controllers, valve outputs, irrigation zones, programs, schedules, flow, pressure, weather compensation, transformer load, alarms and water consumption.

Zmartify Edge v2 shall therefore become a product-neutral platform with shared lifecycle services and separate product modules.

The recommended target architecture is:

```text
Users and mobile/web clients
            │
            ▼
Responsive Ionic/React application
            │
            ▼
        FastAPI v2
            │
   ┌────────┼─────────┐
   │        │         │
Core     Product    Realtime
platform modules    services
   │        │         │
   └────────┼─────────┘
            │
   PostgreSQL + TimescaleDB
            │
            ▼
      MQTT adapter layer
            │
      Eclipse Mosquitto
            │
   ┌────────┴─────────┐
   ▼                  ▼
HVAC controller   Irrigation controller
```

The core architectural decisions are:

1. Replace SQLite with PostgreSQL now, while the system contains test data only.
2. Add TimescaleDB for telemetry, trends and long-term history.
3. Preserve controller autonomy. Edge is not required for HVAC regulation or irrigation execution.
4. Define a common Zmartify Device Contract v2 for identity, capabilities, onboarding, commands, OTA and diagnostics.
5. Keep product-specific models for HVAC and irrigation.
6. Add a canonical device twin between MQTT payloads and application APIs.
7. Consolidate administration and mobile functions into one responsive Ionic/React application.
8. Retain Homie v5 compatibility for Homey and future Home Assistant integrations through adapters.

---

## 2. Goals and non-goals

### 2.1 Goals

Zmartify Edge v2 shall:

- support multiple product families without redesigning the platform;
- provide a stable contract between edge, firmware and apps;
- support multiple domains, sites, users and devices;
- provide secure onboarding, credentials, OTA and configuration deployment;
- support real-time commands with acknowledgement and outcome tracking;
- store relational configuration and high-volume telemetry efficiently;
- provide responsive mobile, tablet and desktop interfaces;
- remain deployable on a Raspberry Pi-class edge host;
- support later migration to central cloud hosting;
- support native mobile packaging through Capacitor;
- preserve offline operation of controllers;
- support Homey, Home Assistant and other integrations.

### 2.2 Non-goals for the first v2 release

The first v2 release does not require:

- microservices for every module;
- Kubernetes;
- a separate event-streaming platform such as Kafka;
- multi-region cloud operation;
- full SaaS billing;
- AI-based control decisions;
- replacement of controller-side safety logic;
- immediate removal of the existing v1 endpoints.

The recommended deployment remains a modular monolith with clear internal boundaries.

---

## 3. Architectural principles

### 3.1 Controllers are autonomous

Controllers execute all safety-critical and time-critical functions locally.

HVAC remains responsible for:

- AHC9000 polling;
- setpoint validation and writes;
- local communication recovery;
- local state and diagnostics.

Irrigation remains responsible for:

- schedules and program execution;
- valve sequencing;
- master valve timing;
- flow and pressure protection;
- weather and rain-delay enforcement;
- safe shutdown;
- local configuration backup;
- continued operation during edge or internet outages.

### 3.2 Edge is the control plane

Edge provides:

- user interfaces;
- site and fleet administration;
- onboarding and credentials;
- historical data;
- remote commands;
- configuration distribution;
- firmware distribution;
- alerts and notifications;
- integrations;
- analytics and reporting.

### 3.3 Shared lifecycle, separate product domains

HVAC and irrigation share:

- device identity;
- ownership;
- sites;
- user access;
- onboarding;
- MQTT credentials;
- OTA;
- freshness;
- events;
- commands;
- notifications;
- diagnostics.

They do not share the same domain state model.

### 3.4 Capability-driven behaviour

Clients and edge services shall use device capabilities rather than hard-coded assumptions.

Examples:

```text
hvac.zones
hvac.channels
hvac.setpoints
irrigation.zones
irrigation.programs
irrigation.manual_run
hydraulics.flow
hydraulics.pressure
power.va
storage.tf_card
weather.local
weather.remote
device.ota
device.diagnostics
```

### 3.5 Version all contracts

Version separately:

- REST API;
- MQTT topic structure;
- JSON schemas;
- device contract;
- database migrations;
- OTA manifest;
- configuration payloads.

---

## 4. Target system architecture

### 4.1 Logical components

```text
┌─────────────────────────────────────────────────────────────┐
│                    Zmartify Web / Mobile App                │
│ Ionic + React + TypeScript + Capacitor                      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / WebSocket
┌──────────────────────────────▼──────────────────────────────┐
│                        FastAPI v2                           │
│                                                            │
│  Core                                                       │
│  - Auth and sessions                                        │
│  - Domains and sites                                        │
│  - Device registry                                          │
│  - Access control                                           │
│  - Commands                                                 │
│  - Events and notifications                                 │
│  - OTA and configuration                                    │
│  - Audit                                                    │
│                                                            │
│  Products                                                   │
│  - HVAC                                                     │
│  - Irrigation                                               │
│  - Weather                                                  │
│  - Energy                                                   │
│                                                            │
│  Adapters                                                   │
│  - MQTT v2                                                  │
│  - Homie v5                                                 │
│  - Homey                                                    │
│  - Home Assistant                                           │
└───────────────┬──────────────────────────┬──────────────────┘
                │                          │
                ▼                          ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│ PostgreSQL               │   │ Eclipse Mosquitto            │
│ + TimescaleDB            │   │ TLS, ACL, per-device creds   │
└──────────────────────────┘   └──────────────┬───────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                    HVAC ESP32 gateway              Irrigation ESP32
```

### 4.2 Deployment model

Initial deployment:

```text
Docker Compose
├── zmartify-edge-api
├── zmartify-web
├── mosquitto
├── postgres-timescale
├── backup
└── reverse-proxy or FastAPI TLS termination
```

Recommended later addition:

```text
├── redis                  optional cache and job coordination
├── worker                 background jobs
└── object-storage         firmware and large exports
```

For the first migration, Redis is optional. PostgreSQL advisory locks and a small in-process scheduler are sufficient.

---

## 5. Database decision

### 5.1 Recommendation

Replace SQLite with PostgreSQL and TimescaleDB immediately.

The present environment contains test data only, so there is little benefit in maintaining a transitional SQLite production path. Continuing with SQLite would create avoidable migration work when telemetry volume, concurrent clients and product complexity increase.

### 5.2 Why PostgreSQL

PostgreSQL provides:

- reliable concurrent writes;
- transactional schema migrations;
- JSONB for product-specific state;
- strong foreign keys and constraints;
- row-level locking;
- mature backup and restore;
- role-based database security;
- UUID support;
- full-text and structured indexing;
- later PostGIS support;
- easier central hosting.

### 5.3 Why TimescaleDB

TimescaleDB provides:

- hypertables for telemetry;
- retention policies;
- continuous aggregates;
- time bucketing;
- compression;
- SQL access to time-series data;
- one backup and security model for relational and telemetry data.

### 5.4 What belongs in PostgreSQL

Relational configuration:

- users;
- sessions;
- roles;
- domains;
- sites;
- devices;
- components;
- capabilities;
- credentials metadata;
- programs;
- schedules;
- desired configuration;
- commands;
- command outcomes;
- events;
- notifications;
- audit log;
- firmware releases;
- OTA deployments.

### 5.5 What belongs in TimescaleDB

High-volume history:

- temperature;
- humidity;
- setpoints;
- demand;
- valve state;
- flow;
- pressure;
- water volume;
- voltage;
- current;
- apparent power in VA;
- real power in W;
- power factor;
- transformer load;
- weather values;
- device health metrics;
- communication counters.

### 5.6 Initial database container

Recommended image family:

```text
timescale/timescaledb:latest-pg17
```

Production deployments shall pin an explicit tested version rather than use `latest`.

---

## 6. Database model

### 6.1 Core entity hierarchy

```text
Domain
└── Site
    ├── Device
    │   ├── Component
    │   ├── Capability
    │   ├── Reported State
    │   ├── Desired State
    │   ├── Commands
    │   └── Telemetry
    ├── Users through Site Access
    ├── Events
    └── Notifications
```

### 6.2 Core tables

#### `domains`

```sql
id                  uuid primary key
slug                text unique not null
name                text not null
created_at          timestamptz not null
updated_at          timestamptz not null
```

#### `sites`

```sql
id                  uuid primary key
domain_id           uuid not null references domains(id)
slug                text not null
name                text not null
timezone            text not null default 'Europe/Copenhagen'
latitude            numeric(9,6)
longitude           numeric(9,6)
created_at          timestamptz not null
updated_at          timestamptz not null
unique(domain_id, slug)
```

#### `devices`

```sql
id                  uuid primary key
site_id             uuid references sites(id)
device_key          text unique not null
display_name        text not null
product_type        text not null
product_model       text not null
hardware_revision   text
firmware_version    text
integration_mode    text not null
local_url           text
status              text not null
last_seen_at        timestamptz
created_at          timestamptz not null
updated_at          timestamptz not null
```

#### `device_capabilities`

```sql
device_id           uuid not null references devices(id)
capability          text not null
version             text
metadata            jsonb not null default '{}'
primary key(device_id, capability)
```

#### `components`

```sql
id                  uuid primary key
device_id           uuid not null references devices(id)
local_ref           text not null
component_type      text not null
name                text not null
sort_order          integer not null default 0
metadata            jsonb not null default '{}'
enabled             boolean not null default true
created_at          timestamptz not null
updated_at          timestamptz not null
unique(device_id, local_ref)
```

Examples of `component_type`:

```text
hvac.zone
hvac.channel
irrigation.zone
irrigation.output
irrigation.master_valve
sensor.flow
sensor.pressure
sensor.weather
power.transformer
storage.tf_card
```

#### `device_reported_state`

```sql
device_id           uuid primary key references devices(id)
schema_version      text not null
state               jsonb not null
source_timestamp    timestamptz
received_at         timestamptz not null
```

#### `device_desired_state`

```sql
device_id           uuid primary key references devices(id)
schema_version      text not null
revision            bigint not null
state               jsonb not null
updated_by          uuid references users(id)
updated_at          timestamptz not null
```

#### `component_reported_state`

```sql
component_id        uuid primary key references components(id)
state               jsonb not null
source_timestamp    timestamptz
received_at         timestamptz not null
```

### 6.3 User and access tables

```text
users
roles
user_roles
site_access
sessions
registration_invites
password_reset_tokens
audit_entries
```

Roles for v2:

```text
owner
admin
installer
operator
viewer
service
```

### 6.4 Command tables

#### `commands`

```sql
id                  uuid primary key
device_id           uuid not null references devices(id)
component_id        uuid references components(id)
command_type        text not null
parameters          jsonb not null
status              text not null
origin_type         text not null
origin_user_id      uuid references users(id)
created_at          timestamptz not null
expires_at          timestamptz
accepted_at         timestamptz
completed_at        timestamptz
error_code          text
error_message       text
correlation_id      uuid
```

Allowed command states:

```text
queued
published
accepted
running
completed
rejected
failed
expired
cancelled
```

### 6.5 Event and notification tables

```text
events
notifications
notification_deliveries
notification_preferences
```

Events are immutable system facts. Notifications are user-facing messages derived from events.

### 6.6 HVAC product tables

```text
hvac_zones
hvac_channels
hvac_channel_zone_links
hvac_setpoint_profiles
```

Do not store irrigation zones in the HVAC zone table.

### 6.7 Irrigation product tables

```text
irrigation_controllers
irrigation_zones
irrigation_outputs
irrigation_programs
irrigation_program_steps
irrigation_schedule_rules
irrigation_runs
irrigation_run_steps
irrigation_weather_adjustments
irrigation_zone_profiles
irrigation_calibrations
```

#### `irrigation_zones`

```sql
id                      uuid primary key
component_id            uuid unique not null references components(id)
output_component_id     uuid references components(id)
name                    text not null
enabled                 boolean not null default true
area_m2                 numeric
soil_type               text
plant_type              text
sprinkler_type          text
precipitation_rate_mm_h numeric
expected_flow_lpm       numeric
minimum_pressure_bar    numeric
maximum_pressure_bar    numeric
maximum_runtime_minutes integer
metadata                jsonb not null default '{}'
```

#### `irrigation_programs`

```sql
id                  uuid primary key
site_id             uuid not null references sites(id)
controller_device_id uuid not null references devices(id)
name                text not null
enabled             boolean not null default true
seasonal_adjustment numeric not null default 1.0
weather_mode        text not null default 'automatic'
revision            bigint not null
created_at          timestamptz not null
updated_at          timestamptz not null
```

### 6.8 Timescale telemetry table

A single generic telemetry table is recommended initially:

```sql
create table telemetry_samples (
    time              timestamptz not null,
    site_id           uuid not null,
    device_id         uuid not null,
    component_id      uuid,
    metric            text not null,
    value_double      double precision,
    value_text        text,
    unit              text,
    quality           smallint,
    tags              jsonb not null default '{}'
);
```

Convert to hypertable:

```sql
select create_hypertable('telemetry_samples', by_range('time'));
```

Typical metrics:

```text
hvac.temperature_c
hvac.setpoint_c
hvac.demand
irrigation.flow_lpm
irrigation.pressure_bar
irrigation.water_liters
irrigation.zone_runtime_seconds
power.voltage_rms_v
power.current_rms_a
power.apparent_power_va
power.real_power_w
power.power_factor
weather.temperature_c
weather.rain_mm
weather.wind_mps
weather.eto_mm
```

Later, heavily used metric groups can be moved to typed hypertables if required.

---

## 7. Zmartify Device Contract v2

### 7.1 Purpose

The device contract is the stable boundary between:

- edge backend;
- HVAC firmware;
- irrigation firmware;
- apps;
- Homey and Home Assistant adapters;
- manufacturing and service tools.

### 7.2 Common local HTTP API

All Zmartify controllers should expose:

```http
GET  /api/v2/health
GET  /api/v2/status
GET  /api/v2/version
GET  /api/v2/identity
GET  /api/v2/capabilities

GET  /api/v2/onboarding/status
POST /api/v2/onboarding/configure
POST /api/v2/onboarding/reset

GET  /api/v2/config
POST /api/v2/config/apply
POST /api/v2/config/export

GET  /api/v2/diagnostics
POST /api/v2/reboot
POST /api/v2/ota
```

### 7.3 Identity document

```json
{
  "schema_version": "2.0",
  "device_id": "zic-s3-000001",
  "device_uuid": "018f4d27-2cbe-7a1b-96b9-4fae36b5d3e2",
  "manufacturer": "Zmartify",
  "product_type": "irrigation_controller",
  "product_model": "zmartify-irrigation-16",
  "hardware_revision": "A",
  "firmware": {
    "version": "0.1.0",
    "build_id": "git-abcd1234",
    "esp_idf_version": "6.0.1"
  }
}
```

### 7.4 Capability document

```json
{
  "schema_version": "2.0",
  "capabilities": [
    {"id": "irrigation.zones", "version": "1.0", "count": 15},
    {"id": "irrigation.master_valve", "version": "1.0", "count": 1},
    {"id": "irrigation.programs", "version": "1.0"},
    {"id": "hydraulics.flow", "version": "1.0"},
    {"id": "hydraulics.pressure", "version": "1.0"},
    {"id": "power.va", "version": "1.0"},
    {"id": "storage.tf_card", "version": "1.0"},
    {"id": "device.ota", "version": "1.0"}
  ]
}
```

### 7.5 Standard response envelope

```json
{
  "schema_version": "2.0",
  "request_id": "req-018f...",
  "data": {},
  "error": null
}
```

Errors:

```json
{
  "schema_version": "2.0",
  "request_id": "req-018f...",
  "data": null,
  "error": {
    "code": "COMMAND_REJECTED",
    "message": "Zone cannot start because pressure protection is active",
    "details": {}
  }
}
```

---

## 8. API v2

### 8.1 API conventions

Base path:

```text
/api/v2
```

Conventions:

- UUIDs are used for public edge resources.
- Controller-local numeric IDs remain available as `local_ref`.
- Timestamps use RFC 3339 UTC.
- Commands are asynchronous unless explicitly documented otherwise.
- Mutating requests support idempotency keys.
- List endpoints support cursor pagination.
- Filtering uses explicit query parameters.
- All error responses use stable error codes.

### 8.2 Authentication

```http
POST /api/v2/auth/login
POST /api/v2/auth/refresh
POST /api/v2/auth/logout
GET  /api/v2/auth/me
GET  /api/v2/auth/sessions
DELETE /api/v2/auth/sessions/{session_id}
```

Web:

- short-lived access token;
- refresh token in secure HttpOnly cookie;
- CSRF protection where required.

Native app:

- tokens stored through Capacitor secure storage;
- optional biometric unlock later.

### 8.3 Domains and sites

```http
GET    /api/v2/domains
POST   /api/v2/domains
GET    /api/v2/domains/{domain_id}
PATCH  /api/v2/domains/{domain_id}
DELETE /api/v2/domains/{domain_id}

GET    /api/v2/sites
POST   /api/v2/sites
GET    /api/v2/sites/{site_id}
PATCH  /api/v2/sites/{site_id}
DELETE /api/v2/sites/{site_id}
GET    /api/v2/sites/{site_id}/overview
```

### 8.4 Device lifecycle

```http
GET    /api/v2/devices
POST   /api/v2/devices/discover
POST   /api/v2/devices/claim
GET    /api/v2/devices/{device_id}
PATCH  /api/v2/devices/{device_id}
DELETE /api/v2/devices/{device_id}

GET    /api/v2/devices/{device_id}/capabilities
GET    /api/v2/devices/{device_id}/components
GET    /api/v2/devices/{device_id}/state
GET    /api/v2/devices/{device_id}/freshness
GET    /api/v2/devices/{device_id}/diagnostics
POST   /api/v2/devices/{device_id}/config/deploy
POST   /api/v2/devices/{device_id}/reboot
```

### 8.5 Commands

```http
POST /api/v2/devices/{device_id}/commands
GET  /api/v2/commands/{command_id}
POST /api/v2/commands/{command_id}/cancel
GET  /api/v2/devices/{device_id}/commands
```

Request:

```json
{
  "command_type": "irrigation.zone.start",
  "component_id": "018f...",
  "parameters": {
    "duration_seconds": 600
  },
  "expires_in_seconds": 30
}
```

### 8.6 HVAC API

```http
GET  /api/v2/sites/{site_id}/hvac/overview
GET  /api/v2/devices/{device_id}/hvac/zones
GET  /api/v2/devices/{device_id}/hvac/zones/{zone_id}
POST /api/v2/devices/{device_id}/hvac/zones/{zone_id}/setpoint
GET  /api/v2/devices/{device_id}/hvac/channels
POST /api/v2/devices/{device_id}/hvac/channels/{channel_id}/mode
```

### 8.7 Irrigation API

```http
GET  /api/v2/sites/{site_id}/irrigation/overview
GET  /api/v2/devices/{device_id}/irrigation/zones
GET  /api/v2/devices/{device_id}/irrigation/zones/{zone_id}
PATCH /api/v2/devices/{device_id}/irrigation/zones/{zone_id}
POST /api/v2/devices/{device_id}/irrigation/zones/{zone_id}/start
POST /api/v2/devices/{device_id}/irrigation/stop
POST /api/v2/devices/{device_id}/irrigation/pause
POST /api/v2/devices/{device_id}/irrigation/resume

GET    /api/v2/devices/{device_id}/irrigation/programs
POST   /api/v2/devices/{device_id}/irrigation/programs
GET    /api/v2/devices/{device_id}/irrigation/programs/{program_id}
PUT    /api/v2/devices/{device_id}/irrigation/programs/{program_id}
DELETE /api/v2/devices/{device_id}/irrigation/programs/{program_id}
POST   /api/v2/devices/{device_id}/irrigation/programs/{program_id}/run

GET  /api/v2/devices/{device_id}/irrigation/hydraulics
GET  /api/v2/devices/{device_id}/irrigation/power
GET  /api/v2/devices/{device_id}/irrigation/weather
POST /api/v2/devices/{device_id}/irrigation/rain-delay
```

### 8.8 History and insights

```http
GET /api/v2/telemetry
GET /api/v2/sites/{site_id}/insights/water
GET /api/v2/sites/{site_id}/insights/energy
GET /api/v2/sites/{site_id}/insights/hvac
GET /api/v2/devices/{device_id}/history
GET /api/v2/components/{component_id}/history
```

Example:

```text
GET /api/v2/telemetry?component_id=...&metric=irrigation.flow_lpm&from=...&to=...&bucket=5m
```

### 8.9 Events and notifications

```http
GET  /api/v2/events
GET  /api/v2/notifications
POST /api/v2/notifications/read-all
POST /api/v2/notifications/{notification_id}/read
GET  /api/v2/notification-preferences
PUT  /api/v2/notification-preferences
```

### 8.10 Administration

```http
GET    /api/v2/admin/users
POST   /api/v2/admin/users
PATCH  /api/v2/admin/users/{user_id}
GET    /api/v2/admin/audit
GET    /api/v2/admin/mqtt-clients
POST   /api/v2/admin/mqtt-clients
POST   /api/v2/admin/mqtt-clients/{client_id}/rotate
GET    /api/v2/admin/system/health
GET    /api/v2/admin/system/storage
GET    /api/v2/admin/system/database
```

---

## 9. Realtime API

### 9.1 WebSocket endpoint

```text
/api/v2/ws
```

Client subscribes after authentication:

```json
{
  "type": "subscribe",
  "topics": [
    "site:018f...:overview",
    "device:018f...:state",
    "command:018f..."
  ]
}
```

Server events:

```text
device.state.updated
component.state.updated
command.updated
event.created
notification.created
irrigation.run.updated
hvac.zone.updated
```

### 9.2 Fallback

The app shall remain usable with HTTP polling if WebSocket is unavailable.

---

## 10. MQTT v2 mapping

### 10.1 Topic root

```text
zmartify/v2/{domain_id}/{site_id}/{device_id}
```

UUIDs or stable slugs may be used in topics. Stable device keys are preferred where readability is important, but they must never encode user secrets.

### 10.2 Lifecycle topics

```text
.../identity
.../capabilities
.../availability
.../reported
.../events
.../metrics
.../diagnostics
```

Commands:

```text
.../commands/{command_id}
.../command-results/{command_id}
```

Desired configuration:

```text
.../desired
.../desired/ack
```

### 10.3 Retain rules

Retained:

```text
identity
capabilities
availability
reported
```

Not retained:

```text
events
metrics
commands
command-results
```

Commands shall include expiry and idempotency data.

### 10.4 QoS

Recommended:

```text
identity, capabilities, reported     QoS 1
commands and command-results         QoS 1
events                               QoS 1
high-frequency metrics               QoS 0 or 1 by metric class
availability                         QoS 1 with LWT
```

### 10.5 Reported state example – HVAC

```json
{
  "schema_version": "2.0",
  "source_timestamp": "2026-07-12T21:00:00Z",
  "firmware_version": "0.1.9",
  "hvac": {
    "zones": {
      "zone:1": {
        "temperature_c": 21.4,
        "setpoint_c": 22.0,
        "demand": true,
        "online": true
      }
    },
    "channels": {
      "channel:1": {
        "mode": 0,
        "active": true
      }
    }
  }
}
```

### 10.6 Reported state example – irrigation

```json
{
  "schema_version": "2.0",
  "source_timestamp": "2026-07-12T21:00:00Z",
  "firmware_version": "0.1.0",
  "irrigation": {
    "state": "running",
    "active_program": "program:morning",
    "active_zone": "zone:3",
    "remaining_seconds": 420,
    "rain_delay_until": null
  },
  "hydraulics": {
    "flow_lpm": 31.2,
    "pressure_bar": 3.6,
    "expected_flow_lpm": 30.0,
    "health": "normal"
  },
  "power": {
    "voltage_rms_v": 24.3,
    "current_rms_a": 0.86,
    "apparent_power_va": 20.9,
    "real_power_w": 16.5,
    "power_factor": 0.79,
    "transformer_load_percent": 34.8
  },
  "storage": {
    "tf_card_present": true,
    "tf_card_free_bytes": 14812323840
  }
}
```

### 10.7 Metrics payload

```json
{
  "schema_version": "2.0",
  "samples": [
    {
      "metric": "irrigation.flow_lpm",
      "component_ref": "sensor:flow:1",
      "value": 31.2,
      "unit": "L/min",
      "timestamp": "2026-07-12T21:00:00Z"
    }
  ]
}
```

### 10.8 Command payload

```json
{
  "schema_version": "2.0",
  "command_id": "018f...",
  "command_type": "irrigation.zone.start",
  "target_ref": "zone:3",
  "parameters": {
    "duration_seconds": 600
  },
  "requested_at": "2026-07-12T21:00:00Z",
  "expires_at": "2026-07-12T21:00:30Z"
}
```

### 10.9 Command result

```json
{
  "schema_version": "2.0",
  "command_id": "018f...",
  "status": "completed",
  "accepted_at": "2026-07-12T21:00:01Z",
  "completed_at": "2026-07-12T21:00:02Z",
  "result": {
    "active_zone": "zone:3",
    "duration_seconds": 600
  },
  "error": null
}
```

### 10.10 Homie v5 compatibility

Homie v5 remains supported for HVAC and Homey integration.

The edge backend shall include an adapter:

```text
Homie v5 MQTT
    ↓
HVAC adapter
    ↓
Canonical device twin
    ↓
API v2 and database
```

The irrigation firmware may publish both native Zmartify v2 and Homey discovery data. The canonical device twin remains the internal source of truth.

---

## 11. OTA and configuration

### 11.1 Firmware releases

Firmware metadata shall include:

```text
product_type
product_model
hardware_revisions
version
release_channel
size
sha256
signature
minimum_bootloader
release_notes
created_at
```

### 11.2 OTA transport options

Supported:

- edge-pushed local OTA;
- device pull OTA;
- TF-card offline update for irrigation;
- future cloud OTA.

All transports shall use the same signed manifest and image validation.

### 11.3 Configuration revisions

Configuration shall be revisioned:

```json
{
  "schema_version": "2.0",
  "revision": 42,
  "generated_at": "2026-07-12T21:00:00Z",
  "device_id": "zic-s3-000001",
  "configuration": {}
}
```

The controller acknowledges:

```json
{
  "revision": 42,
  "status": "applied",
  "applied_at": "2026-07-12T21:00:03Z",
  "errors": []
}
```

### 11.4 TF-card use

The irrigation TF-card is optional service media.

Recommended structure:

```text
/zmartify/
├── update/
│   ├── firmware.bin
│   ├── manifest.json
│   └── signature.sig
├── config/
│   ├── exported-config.json
│   └── import-config.json
├── logs/
├── reports/
├── backup/
└── factory/
```

The controller must operate normally without a TF-card.

---

## 12. Backend source structure

Recommended structure:

```text
zmartify-edge-api/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── database/
│   │   ├── domains/
│   │   ├── sites/
│   │   ├── users/
│   │   ├── access/
│   │   ├── events/
│   │   ├── notifications/
│   │   ├── audit/
│   │   ├── commands/
│   │   └── ota/
│   ├── devices/
│   │   ├── registry/
│   │   ├── onboarding/
│   │   ├── twin/
│   │   ├── capabilities/
│   │   └── diagnostics/
│   ├── products/
│   │   ├── hvac/
│   │   └── irrigation/
│   ├── integrations/
│   │   ├── mqtt_v2/
│   │   ├── homie_v5/
│   │   ├── homey/
│   │   └── home_assistant/
│   ├── telemetry/
│   └── api/
│       ├── dependencies.py
│       └── v2/
├── migrations/
├── tests/
└── alembic.ini
```

Recommended ORM and migrations:

```text
SQLAlchemy 2.x
Alembic
psycopg 3
```

Pydantic models remain the API schema layer.

---

## 13. Frontend redesign

### 13.1 Recommendation

Keep Ionic, React, TypeScript, Vite, Tailwind and Capacitor.

Consolidate `zmartify-admin` and `admin-ui` into one application. The same application shall adapt its navigation and density to role and screen size.

### 13.2 Application shell

Mobile bottom navigation:

```text
Home | Control | Insights | Alerts | More
```

Tablet navigation rail:

```text
Home
Control
Insights
Alerts
More
```

Desktop sidebar:

```text
Overview
Sites
Systems
Devices
Automations
Insights
Alerts
Users
Integrations
System
```

### 13.3 Route map

```text
/app
├── /login
├── /home
├── /sites
│   └── /:siteId
├── /control
│   ├── /hvac
│   │   ├── /overview
│   │   ├── /zones
│   │   └── /zones/:zoneId
│   └── /irrigation
│       ├── /overview
│       ├── /zones
│       ├── /zones/:zoneId
│       ├── /programs
│       ├── /programs/:programId
│       ├── /manual
│       ├── /hydraulics
│       ├── /weather
│       └── /power
├── /insights
│   ├── /water
│   ├── /energy
│   ├── /hvac
│   └── /devices/:deviceId
├── /alerts
├── /notifications
├── /more
│   ├── /profile
│   ├── /settings
│   ├── /devices
│   ├── /users
│   ├── /integrations
│   └── /system
└── /onboarding
    ├── /discover
    ├── /claim
    ├── /assign-site
    └── /complete
```

Admin-only routes may use the same components with enhanced actions rather than a separate admin application.

---

## 14. UX design principles

### 14.1 Simplicity

The first screen must answer:

- Is everything okay?
- What is running?
- Is action required?
- How much energy or water is being used?

### 14.2 Progressive disclosure

Show essential state first. Detailed technical data is available under diagnostics and service views.

### 14.3 Product-neutral home

Home shall show site systems rather than assume heating.

### 14.4 Safe commands

Potentially disruptive actions require clear confirmation:

- stop all irrigation;
- factory reset;
- OTA;
- delete site;
- rotate credentials;
- run valves manually for long periods.

### 14.5 Responsive targets

```text
Mobile      < 768 px
Tablet      768–1199 px
Desktop     >= 1200 px
```

Touch targets shall be at least approximately 44 px.

---

## 15. Wireframes

### 15.1 Mobile home

```text
┌─────────────────────────────┐
│ Zmartify            🔔  👤  │
│ Stangsdal                   │
├─────────────────────────────┤
│ Good evening, Peter         │
│ All systems normal          │
├─────────────────────────────┤
│ IRRIGATION                  │
│ Idle                        │
│ Next: Morning · 05:30       │
│ Water today: 1,284 L        │
│                    [Open]   │
├─────────────────────────────┤
│ HVAC                        │
│ Average: 21.3 °C            │
│ Heating: 2 rooms            │
│                    [Open]   │
├─────────────────────────────┤
│ WEATHER                     │
│ Dry · 18 °C · Wind 3 m/s    │
├─────────────────────────────┤
│ Home Control Insights Alerts│
└─────────────────────────────┘
```

### 15.2 Irrigation overview

```text
┌─────────────────────────────┐
│ ‹ Irrigation       ⚙        │
├─────────────────────────────┤
│ STATUS                      │
│ ● Running                   │
│ Front lawn · 08:24 left     │
│ Flow 31.2 L/min             │
│ Pressure 3.6 bar            │
│              [Pause] [Stop] │
├─────────────────────────────┤
│ TODAY                       │
│ Water       1,284 L         │
│ Runtime     46 min          │
│ Programs    2 of 3 complete │
├─────────────────────────────┤
│ ZONES                       │
│ Front lawn       Running    │
│ Orchard          Scheduled  │
│ Beds             Complete   │
│                   [View all]│
├─────────────────────────────┤
│ Overview Zones Programs More│
└─────────────────────────────┘
```

### 15.3 Irrigation zone detail

```text
┌─────────────────────────────┐
│ ‹ Front lawn                │
├─────────────────────────────┤
│ Status: Idle                │
│ Last run: Today 05:30       │
│ Water used: 412 L           │
├─────────────────────────────┤
│ Manual run                  │
│ Duration  [ 10 min      ▼ ] │
│           [ Start zone ]    │
├─────────────────────────────┤
│ Hydraulic profile           │
│ Expected flow   30 L/min    │
│ Last flow       31.2 L/min  │
│ Pressure        3.6 bar     │
│ Health          Normal      │
├─────────────────────────────┤
│ Settings                    │
│ Area 1,200 m²               │
│ Type Lawn                   │
│ Sprinkler MP Rotator        │
└─────────────────────────────┘
```

### 15.4 Program editor

```text
┌─────────────────────────────┐
│ ‹ Morning program     Save  │
├─────────────────────────────┤
│ Enabled              [ on ] │
│ Start time            05:30 │
│ Days            M T W T F S │
│ Weather mode      Automatic │
│ Seasonal adjust        85 % │
├─────────────────────────────┤
│ STEPS                       │
│ 1 Front lawn       15 min   │
│ 2 Orchard          25 min   │
│ 3 Beds             10 min   │
│              [ + Add zone ] │
├─────────────────────────────┤
│ Estimated water: 1,420 L    │
└─────────────────────────────┘
```

### 15.5 Hydraulics and power

```text
┌─────────────────────────────┐
│ Hydraulics                  │
├─────────────────────────────┤
│ Flow            31.2 L/min  │
│ Pressure             3.6 bar│
│ System health          97 % │
├─────────────────────────────┤
│ 24 VAC                      │
│ Voltage              24.3 V │
│ Current              0.86 A │
│ Load                 20.9 VA│
│ Transformer load       35 % │
│ Power factor           0.79 │
├─────────────────────────────┤
│ [ Flow chart ]              │
│ [ Pressure chart ]          │
│ [ VA chart ]                │
└─────────────────────────────┘
```

### 15.6 Desktop administration

```text
┌──────────────┬──────────────────────────────────────────────┐
│ ZMARTIFY     │ Stangsdal                                    │
│              │                                              │
│ Overview     │ System status                                │
│ Sites        │ ┌──────────┐ ┌──────────┐ ┌───────────────┐ │
│ Systems      │ │ HVAC     │ │ Irrig.  │ │ Weather       │ │
│ Devices      │ │ Online   │ │ Running │ │ Dry           │ │
│ Automations  │ └──────────┘ └──────────┘ └───────────────┘ │
│ Insights     │                                              │
│ Alerts       │ Devices                                      │
│ Users        │ ┌──────────────┬─────────┬────────┬───────┐ │
│ Integrations │ │ Device       │ Product │ Status │ FW    │ │
│ System       │ ├──────────────┼─────────┼────────┼───────┤ │
│              │ │ HVAC gateway │ HVAC    │ Online │0.1.9  │ │
│              │ │ Irrigation   │ Irrig.  │ Online │0.1.0  │ │
│              │ └──────────────┴─────────┴────────┴───────┘ │
└──────────────┴──────────────────────────────────────────────┘
```

---

## 16. Frontend source structure

```text
zmartify-app/
├── src/
│   ├── app/
│   │   ├── router/
│   │   ├── shell/
│   │   ├── auth/
│   │   └── providers/
│   ├── core/
│   │   ├── api/
│   │   ├── realtime/
│   │   ├── query/
│   │   ├── permissions/
│   │   └── storage/
│   ├── design-system/
│   │   ├── components/
│   │   ├── tokens/
│   │   └── icons/
│   ├── features/
│   │   ├── home/
│   │   ├── sites/
│   │   ├── devices/
│   │   ├── hvac/
│   │   ├── irrigation/
│   │   ├── insights/
│   │   ├── alerts/
│   │   ├── onboarding/
│   │   └── administration/
│   └── main.tsx
├── capacitor.config.ts
└── package.json
```

Recommended state and data approach:

- TanStack Query for server state;
- small local stores only for UI state;
- WebSocket updates merged into query cache;
- React Hook Form and schema validation for forms;
- generated TypeScript API types from OpenAPI.

---

## 17. Design system

### 17.1 Core components

```text
AppShell
ResponsiveNavigation
PageHeader
SiteSelector
SystemCard
DeviceCard
MetricCard
StatusBadge
ZoneCard
ProgramCard
AlertCard
TrendChart
CommandSheet
ConfirmationDialog
EmptyState
OfflineBanner
FreshnessIndicator
PermissionGate
```

### 17.2 Visual language

Core:

- neutral surfaces;
- strong status hierarchy;
- limited use of gradients;
- restrained motion;
- accessible contrast;
- semantic status colours.

Product accents:

```text
HVAC          warm orange
Irrigation    blue-green
Weather       cyan
Energy        violet
Warnings      amber
Critical      red
```

Product colours must not replace semantic alarm colours.

---

## 18. Security model

### 18.1 User authentication

- password hashing with Argon2id;
- short-lived access tokens;
- rotating refresh tokens;
- session revocation;
- rate limiting;
- optional MFA later;
- no permanent admin token in browser local storage.

### 18.2 Device authentication

Each device receives:

- unique MQTT client ID;
- unique generated password or certificate;
- topic-scoped ACL;
- onboarding token with limited lifetime;
- credential rotation support.

### 18.3 Local controller API

Before claim, only limited endpoints are exposed.

After claim, write endpoints require a device administration credential or signed short-lived edge token.

### 18.4 Secrets

Remove production fallbacks such as:

```text
change-me-admin-token
```

Startup shall fail when required production secrets are absent.

### 18.5 Audit

Record:

- login and logout;
- failed authentication;
- device claims;
- user and role changes;
- configuration changes;
- manual commands;
- OTA deployment;
- credential rotation;
- destructive actions.

---

## 19. Reliability and operations

### 19.1 Health endpoints

```text
/health/live
/health/ready
```

Readiness includes:

- database;
- MQTT broker;
- migration status;
- storage availability.

### 19.2 Backup

Daily backups shall include:

- PostgreSQL logical backup;
- firmware metadata;
- broker configuration;
- application configuration;
- optional encrypted off-device copy.

### 19.3 Database retention

Example policy:

```text
Raw high-frequency telemetry: 90 days
Five-minute aggregates:       2 years
Hourly aggregates:            10 years
Events and audit:              retained by policy
```

Actual policies remain configurable.

### 19.4 Observability

Collect:

- structured logs;
- API latency;
- database health;
- MQTT connection status;
- ingestion lag;
- command latency;
- failed commands;
- controller freshness;
- storage usage.

Prometheus and Grafana can be added later without changing domain architecture.

---

## 20. Migration strategy

Because existing data is test data, the migration should be a clean architectural reset rather than a complex production data conversion.

### Phase 0 – Freeze and document current v1

Deliverables:

- tag current working edge version;
- export current API OpenAPI document;
- document MQTT topics in use;
- record current onboarding and OTA flows;
- capture representative HVAC payloads;
- back up SQLite for reference only.

Exit criterion:

- current pilot can be recreated from source and backup.

### Phase 1 – PostgreSQL and Timescale foundation

Tasks:

- add PostgreSQL/Timescale container;
- add SQLAlchemy and Alembic;
- add configuration through `DATABASE_URL`;
- create initial v2 schema;
- create database health checks;
- add automated development reset and seed commands;
- remove SQLite as the default runtime database.

Suggested environment:

```text
DATABASE_URL=postgresql+psycopg://zmartify:<secret>@postgres:5432/zmartify
```

Exit criterion:

- all new v2 tests run against PostgreSQL;
- Timescale extension is enabled;
- schema can be created from migrations on an empty database.

### Phase 2 – Core platform extraction

Tasks:

- split `main.py` into routers and services;
- migrate domains, sites, users, roles and audit;
- migrate registry and device credentials;
- introduce UUID public IDs;
- implement v2 authentication and sessions;
- preserve v1 routes as adapters where useful.

Exit criterion:

- domain, site, user and device administration works through API v2.

### Phase 3 – Device Contract and canonical twin

Tasks:

- define JSON schemas;
- implement capability registry;
- implement reported and desired state;
- implement command state machine;
- implement generic WebSocket updates;
- add compatibility adapter for current HVAC twin ingestion.

Exit criterion:

- current HVAC gateway appears in the v2 registry and app without firmware changes.

### Phase 4 – MQTT v2 adapter

Tasks:

- add MQTT v2 subscriptions;
- add canonical ingest pipeline;
- add command publication;
- add command result handling;
- maintain Homie v5 adapter;
- revise ACL generation for v2 topics.

Exit criterion:

- test device can report state and execute acknowledged commands through MQTT v2.

### Phase 5 – Irrigation backend

Tasks:

- add irrigation tables and services;
- implement zones, outputs, programs and schedules;
- add hydraulics, power and weather state;
- add irrigation command types;
- add telemetry ingestion;
- add water and runtime aggregates.

Exit criterion:

- simulated irrigation controller can be fully administered and monitored.

### Phase 6 – New responsive app shell

Tasks:

- create responsive navigation;
- implement product-neutral home;
- implement site overview;
- implement common devices and alerts;
- implement HVAC module using API v2;
- implement irrigation module;
- implement role-based administration.

Exit criterion:

- mobile, tablet and desktop flows are functional in one application.

### Phase 7 – HVAC firmware alignment

Tasks:

- add `/api/v2` aliases or native endpoints;
- add capability manifest;
- remove hard-coded broker assumptions;
- add generic command envelope if beneficial;
- retain Homie v5 compatibility;
- validate OTA and onboarding against Device Contract v2.

Exit criterion:

- HVAC firmware supports the common lifecycle contract while retaining current operation.

### Phase 8 – Irrigation firmware integration

Tasks:

- implement Device Contract v2 natively;
- implement MQTT v2;
- implement configuration revision and acknowledgement;
- implement signed OTA and TF-card update;
- publish hydraulic and power telemetry;
- validate offline autonomy.

Exit criterion:

- physical irrigation controller operates through Edge v2 and continues safely when edge is offline.

### Phase 9 – Production hardening

Tasks:

- secure secrets;
- backup and restore testing;
- rate limiting;
- penetration review;
- database retention;
- load testing;
- upgrade and rollback tests;
- mobile PWA installation tests;
- accessibility tests.

Exit criterion:

- production readiness checklist approved.

### Phase 10 – Native mobile packaging

Tasks:

- Capacitor iOS and Android builds;
- secure token storage;
- push notifications;
- background refresh;
- deep links;
- optional biometric unlock.

---

## 21. Suggested migration branches

```text
feature/v2-postgres-foundation
feature/v2-core-domain
feature/v2-device-contract
feature/v2-mqtt
feature/v2-irrigation-domain
feature/v2-responsive-app-shell
feature/v2-hvac-adapter
feature/v2-production-hardening
```

Avoid implementing the entire redesign in one branch.

---

## 22. Testing strategy

### 22.1 Backend

- unit tests for services;
- API integration tests against PostgreSQL;
- migration tests from empty database;
- MQTT contract tests;
- command state transition tests;
- permission tests;
- retention and aggregation tests.

### 22.2 Firmware contract

Maintain reusable contract tests for:

```text
health
identity
capabilities
onboarding
configuration
commands
command results
OTA manifest
reported state
```

### 22.3 Frontend

- component tests;
- route and permission tests;
- API mock tests;
- responsive visual tests;
- Playwright end-to-end tests;
- offline and reconnect tests.

### 22.4 Hardware-in-the-loop

For HVAC:

- AHC9000 state and setpoint operations;
- RS485 error handling;
- MQTT reconnect;
- OTA rollback.

For irrigation:

- valve commands;
- master valve sequence;
- flow and pressure alarms;
- power measurement;
- TF-card import/export;
- schedule execution while edge is offline.

---

## 23. Implementation priorities

### Must have for v2 foundation

- PostgreSQL and TimescaleDB;
- API v2;
- common device contract;
- canonical twin;
- command framework;
- responsive app shell;
- HVAC adapter;
- irrigation domain model;
- secure authentication;
- migrations and tests.

### Should have

- continuous aggregates;
- configuration revisions;
- signed OTA manifests;
- TF-card service workflow;
- water and power insights;
- improved notification preferences.

### Could have later

- Redis;
- background worker service;
- central cloud sync;
- PostGIS;
- AI anomaly detection;
- commercial fleet dashboard;
- billing and subscriptions.

---

## 24. Key decisions

| Decision | Recommendation |
|---|---|
| Primary database | PostgreSQL 17 |
| Time-series storage | TimescaleDB extension |
| Backend architecture | Modular FastAPI monolith |
| API | REST v2 + WebSocket |
| MQTT | Zmartify MQTT v2 with adapters |
| Homey compatibility | Retain Homie v5 |
| Frontend | Ionic + React + TypeScript |
| Mobile strategy | PWA first, Capacitor later |
| Public identifiers | UUID |
| Local controller identifiers | Stable local references, often numeric |
| Controllers | Autonomous |
| Edge role | Control plane and history |
| Existing SQLite data | Discard after reference backup |
| Existing v1 API | Temporary compatibility layer |

---

## 25. Immediate next actions

1. Approve PostgreSQL/TimescaleDB as the v2 database.
2. Add a pinned TimescaleDB service to Docker Compose.
3. Introduce SQLAlchemy, Alembic and `DATABASE_URL`.
4. Create the v2 core migrations.
5. Create `contracts/` with Device Contract JSON schemas.
6. Add a compatibility adapter for the current HVAC controller.
7. Build the generic command model.
8. Create the new responsive app shell before implementing irrigation screens.
9. Implement irrigation backend against the v2 model only.
10. Remove the old admin UI after feature parity is achieved.

---

## 26. Proposed repository changes

```text
zmartify-edge/
├── contracts/
│   ├── device-contract-v2/
│   ├── mqtt-v2/
│   └── ota/
├── docs/
│   └── zmartify-edge-v2-architecture-ux-redesign.md
├── zmartify-edge-api/
│   ├── app/
│   ├── migrations/
│   └── tests/
├── zmartify-app/
├── mosquitto/
├── postgres/
├── ops/
└── docker-compose.yml
```

During migration, `zmartify-admin` can remain until `zmartify-app` reaches parity. It can then be renamed or replaced in a controlled commit.

---

## 27. Conclusion

Zmartify Edge should now move from an HVAC-specific pilot to a shared product platform.

The timing is favourable because current data is disposable, the HVAC firmware already provides a mature reference implementation, and the irrigation controller has not yet become constrained by legacy backend assumptions.

The recommended redesign preserves the strongest existing work—FastAPI, MQTT, onboarding, OTA, Ionic, React and controller autonomy—while replacing the elements that would otherwise limit future growth: SQLite, HVAC-specific state models, duplicated admin interfaces and unversioned integration contracts.

The most important deliverable is not merely a new database or new user interface. It is a stable Zmartify Device Contract and a product-neutral platform architecture that allows HVAC, irrigation, weather, energy, pump and future systems to coexist without repeated redesign.
