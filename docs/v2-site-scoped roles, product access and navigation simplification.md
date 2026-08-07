
# Zmartify Edge – Site-Scoped Roles, Product Access and Navigation Simplification

## Objective

Redesign and implement the authorization and navigation model in:

`https://github.com/stangsdal/zmartify-edge`

The goal is to make Zmartify Edge simple for normal users while supporting multiple sites, multiple product families such as HVAC and Irrigation, and future expansion.

The current implementation uses global roles such as `owner`, `admin`, `installer`, and `viewer`, together with a separate `user_site_access` table.

This must be replaced with a model where only the platform administrator is global. All normal permissions must be assigned per site.

At the same time, simplify the frontend navigation and remove duplicated user flows, especially the multiple ways of accessing HVAC zones.

---

# 1. Target Authorization Model

Implement four user-facing roles.

| Role | Scope | Description |
|---|---|---|
| `administrator` | Global | Full access to the complete Zmartify platform |
| `owner` | Site | Full administration and operation of one specific site |
| `user` | Site | Normal operation of allowed systems, but no system administration |
| `viewer` | Site | Read-only access |

A user may have different roles on different sites.

Example:

```text
Peter
├── Stangsdal        owner
├── Summer House     owner
└── Parents House    viewer

Anne
├── Stangsdal        user
└── Summer House     viewer
```

Do NOT derive ownership from `created_by_user_id`.

Ownership must be represented through site membership.

`created_by_user_id` may remain for audit/history purposes only.

---

# 2. Global Roles

Only the following role should normally remain global:

```text
administrator
```

The current bootstrap/root account should receive `administrator`.

Existing global roles:

```text
owner
viewer
installer
```

must no longer be used for normal site authorization.

Existing data contains only test data, so prioritize a clean target schema rather than maintaining unnecessary legacy complexity.

If replacing old migrations is cleaner than creating a complicated backwards migration, document the approach and implement a clean development migration/reset path.

---

# 3. Site Membership Model

Replace or supersede:

```text
user_site_access
```

with:

```text
site_memberships
```

Recommended schema:

```sql
CREATE TABLE site_memberships (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID NOT NULL UNIQUE,
    user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id             BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    role                VARCHAR(32) NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    invited_by_user_id  BIGINT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, site_id),

    CHECK (role IN ('owner', 'user', 'viewer')),
    CHECK (status IN ('invited', 'active', 'disabled'))
);
```

Use the actual database technology currently being implemented in Edge v2. If PostgreSQL migration work is already underway, implement directly using PostgreSQL conventions.

---

# 4. Product-Level Access

A user may be allowed to access only selected product types on a site.

Initial product types include:

```text
hvac
irrigation
weather
energy
```

Future product types must be addable without changing the authorization architecture.

Recommended schema:

```sql
CREATE TABLE site_membership_product_access (
    membership_id BIGINT NOT NULL
        REFERENCES site_memberships(id) ON DELETE CASCADE,

    product_type VARCHAR(64) NOT NULL,

    PRIMARY KEY (membership_id, product_type)
);
```

Semantic rule:

```text
No product_access rows for a membership
=
access to all products installed at that site
```

Rows in `site_membership_product_access` therefore act as an explicit product allow-list only when one or more rows exist.

Example:

```text
Anne
Site: Summer House
Role: user

Product access:
hvac
```

Anne must not see or access irrigation even if an irrigation controller exists at the same site.

Authorization must be enforced by the API, not only by hiding UI elements.

---

# 5. Permission Matrix

Implement permissions centrally rather than scattering role-name checks throughout controllers/routes.

Target behavior:

| Capability | Administrator | Site Owner | User | Viewer |
|---|:---:|:---:|:---:|:---:|
| Read site | ✓ | ✓ | ✓ | ✓ |
| Read device state | ✓ | ✓ | ✓ | ✓ |
| Read history | ✓ | ✓ | ✓ | ✓ |
| Read alerts | ✓ | ✓ | ✓ | ✓ |
| Change HVAC setpoint | ✓ | ✓ | ✓ | ✗ |
| Change normal HVAC schedule | ✓ | ✓ | ✓ | ✗ |
| Start/stop irrigation | ✓ | ✓ | ✓ | ✗ |
| Change irrigation schedule | ✓ | ✓ | ✓ | ✗ |
| Rain delay | ✓ | ✓ | ✓ | ✗ |
| Acknowledge ordinary alarms | ✓ | ✓ | ✓ | optionally ✗ |
| Device configuration | ✓ | ✓ | ✗ | ✗ |
| Zone metadata/configuration | ✓ | ✓ | ✗ | ✗ |
| Add/remove device | ✓ | ✓ | ✗ | ✗ |
| Manage site members | ✓ | ✓ | ✗ | ✗ |
| Assign product access | ✓ | ✓ | ✗ | ✗ |
| OTA firmware | ✓ | configurable owner access | ✗ | ✗ |
| MQTT / ACL administration | ✓ | ✗ | ✗ | ✗ |
| Global user administration | ✓ | ✗ | ✗ | ✗ |
| Platform/system settings | ✓ | ✗ | ✗ | ✗ |

Create centralized authorization helpers such as:

```python
require_global_admin(...)
require_site_access(...)
require_site_role(...)
require_product_access(...)
require_site_permission(...)
```

Avoid code like:

```python
if "owner" in user.roles:
```

inside unrelated API handlers.

Instead use semantic checks such as:

```python
require_site_permission(
    user=user,
    site_id=site_id,
    product_type="hvac",
    permission="operate",
)
```

---

# 6. Access Context API

Extend `/auth/me` or introduce:

```http
GET /api/v2/me/context
```

The frontend must be able to obtain all information required to construct the user experience without making many authorization queries.

Recommended response:

```json
{
  "user": {
    "id": 12,
    "uuid": "...",
    "display_name": "Anne",
    "global_roles": []
  },

  "is_administrator": false,

  "sites": [
    {
      "id": 42,
      "uuid": "...",
      "name": "Summer House",
      "role": "user",

      "products": [
        {
          "type": "hvac",
          "allowed": true,
          "permissions": {
            "read": true,
            "operate": true,
            "configure": false,
            "administer": false
          }
        }
      ]
    }
  ]
}
```

Do not make the frontend independently reimplement backend authorization rules.

The backend should resolve effective permissions and return them.

---

# 7. Frontend AccessContext

Introduce a central React authorization context, for example:

```text
src/auth/AccessContext.tsx
src/auth/permissions.ts
src/auth/useAccess.ts
```

The context must expose functionality similar to:

```typescript
isAdministrator()

sites()

currentSite()

canAccessSite(siteId)

canAccessProduct(siteId, "hvac")

canRead(siteId, "hvac")

canOperate(siteId, "hvac")

canConfigure(siteId, "hvac")

canManageMembers(siteId)
```

Do not spread raw role comparisons through pages and components.

Pages should ask for capabilities.

Example:

```typescript
const { canOperate, canConfigure } = useAccess();

const allowOperation = canOperate(siteId, 'hvac');
const allowConfiguration = canConfigure(siteId, 'hvac');
```

---

# 8. Route Guards

Frontend route visibility is UX only.

All backend APIs must enforce the same authorization independently.

Add reusable route guards such as:

```text
RequireAuthentication
RequireAdministrator
RequireSiteAccess
RequireProductAccess
RequirePermission
```

Example:

```tsx
<RequireProductAccess
    siteId={siteId}
    product="hvac"
    permission="read"
>
    <HvacZonesPage />
</RequireProductAccess>
```

Directly entering a URL for an unauthorized page must not expose the page.

The API must independently return HTTP 403 for unauthorized calls.

---

# 9. Simplify the Route Model

The current application has duplicate HVAC zone routes such as:

```text
/app/rooms
/app/control/hvac/overview
/app/control/hvac/zones
```

that lead to overlapping functionality.

Replace these with canonical site-oriented routes.

Recommended canonical structure:

```text
/app
/app/sites/:siteId

/app/sites/:siteId/hvac
/app/sites/:siteId/hvac/zones
/app/sites/:siteId/hvac/zones/:zoneId
/app/sites/:siteId/hvac/history
/app/sites/:siteId/hvac/settings

/app/sites/:siteId/irrigation
/app/sites/:siteId/irrigation/zones
/app/sites/:siteId/irrigation/zones/:zoneId
/app/sites/:siteId/irrigation/programs
/app/sites/:siteId/irrigation/history
/app/sites/:siteId/irrigation/settings

/app/sites/:siteId/alerts
/app/sites/:siteId/people
/app/sites/:siteId/settings

/app/admin/sites
/app/admin/devices
/app/admin/users
/app/admin/system
```

Old routes may temporarily redirect to the new canonical routes.

Do not maintain two independent pages that represent the same HVAC zones.

---

# 10. One HVAC Zone View

There must be one canonical HVAC zone overview.

For example:

```text
/app/sites/:siteId/hvac/zones
```

Every authorized user sees the same basic page.

The functionality shown on that page depends on permissions.

Viewer:

```text
Living room
21.4 °C
Target 22.0 °C
Heating
```

User:

```text
Living room
21.4 °C

Target
[-] 22.0 °C [+]

Schedule
Weekdays 06:00–22:30
```

Site Owner additionally sees:

```text
Advanced / Configure

Zone name
Floor
Icon
Channel mapping
Device mapping
Calibration
Technical settings
```

Do NOT create separate "normal zone" and "configuration zone" pages unless a complex technical configuration genuinely requires its own subpage.

Prefer progressive disclosure:

```text
same entity
+
additional controls based on permission
```

This principle should also be applied to irrigation zones where practical.

---

# 11. Navigation Principles

Navigation must be generated dynamically from the current access context.

Do not hardcode a generic navigation menu and merely disable unauthorized items.

Unauthorized and irrelevant sections should normally not be rendered at all.

A user must not see menu entries for products that the user cannot access.

Example:

```text
Anne
Site: Summer House
Role: user
Products: HVAC only
```

Mobile navigation could become:

```text
Home
HVAC
Alerts
More
```

Do NOT show:

```text
Irrigation
Water
Devices
Users
Integrations
System
```

If Anne has access to both HVAC and Irrigation:

```text
Home
Systems
Insights
Alerts
More
```

`Systems` then shows:

```text
HVAC
Irrigation
```

If only one product is accessible, avoid forcing the user through an unnecessary `Systems` intermediary.

---

# 12. Navigation Manifest

Replace hardcoded navigation such as the current `ResponsiveNavigation.tsx` approach with a declarative navigation manifest.

Example:

```typescript
type NavigationItem = {
  id: string;
  label: string;
  icon: string;
  route: (ctx: NavigationContext) => string;

  visibleWhen: (ctx: AccessContext) => boolean;
};

const navigationItems: NavigationItem[] = [
  {
    id: 'home',
    label: 'Home',
    route: ctx => `/app/sites/${ctx.siteId}`,
    visibleWhen: () => true
  },

  {
    id: 'hvac',
    label: 'HVAC',
    route: ctx => `/app/sites/${ctx.siteId}/hvac`,
    visibleWhen: ctx => ctx.canAccessProduct(ctx.siteId, 'hvac')
  },

  {
    id: 'irrigation',
    label: 'Irrigation',
    route: ctx => `/app/sites/${ctx.siteId}/irrigation`,
    visibleWhen: ctx => ctx.canAccessProduct(ctx.siteId, 'irrigation')
  }
];
```

Render mobile, tablet and desktop navigation from the same logical manifest.

Do not maintain separate authorization logic for each layout.

---

# 13. Target Mobile UX

Keep mobile navigation to a maximum of approximately five primary items.

Use adaptive navigation.

Single-product user example:

```text
┌────────────────────────────┐
│ Summer House          ▼    │
├────────────────────────────┤
│                            │
│ Site dashboard             │
│                            │
├────────────────────────────┤
│ Home   HVAC  Alerts  More  │
└────────────────────────────┘
```

Multi-product user:

```text
Home
Systems
Insights
Alerts
More
```

Site Owner may see management functions inside `More` rather than occupying permanent bottom-navigation positions.

For example:

```text
More

Site
  People
  Devices
  Site settings

Account
  Profile
  Notifications
```

Administrator receives an additional administration section.

---

# 14. Desktop UX

Desktop may use a persistent sidebar, but it must follow the same permission rules.

Example for Site Owner:

```text
Summer House
────────────
Overview
HVAC
Irrigation
Insights
Alerts

Manage
People
Devices
Site Settings
```

Example for normal HVAC User:

```text
Summer House
────────────
Overview
HVAC
Insights
Alerts
```

Example for Administrator:

```text
Zmartify Edge
─────────────
Overview
Sites
Devices
Users
Alerts

Administration
Integrations
Audit
System
```

Administrator may switch into a site's operational view to see what site users see.

---

# 15. Site Selector

Introduce a simple global site selector for users who can access multiple sites.

Example:

```text
Summer House ▼
```

Selector choices must contain only sites accessible to the logged-in user.

Persist the most recently selected site locally.

When switching site:

1. Resolve the new membership.
2. Resolve accessible products.
3. Rebuild navigation immediately.
4. If the current page is unavailable on the new site, redirect to that site's overview.

Example:

Anne is on:

```text
Stangsdal / Irrigation
```

and selects:

```text
Summer House
```

where she has HVAC-only access.

Redirect to:

```text
/app/sites/<summer-house>/hvac
```

or site overview.

Never leave the user on an unauthorized irrigation route.

---

# 16. Home / Site Overview

The site home page should show only systems that the user can access.

Example HVAC-only User:

```text
Good evening, Anne

Summer House

HVAC
21.3 °C
2 zones heating

Alerts
No active alerts
```

Do not show an irrigation card with "No access".

Simply omit it.

Site Owner with HVAC + Irrigation could see:

```text
HVAC
21.3 °C

Irrigation
Idle
Next run tomorrow 06:00

Water today
824 L

Alerts
0
```

---

# 17. Invitation Flow

Site Owner must be able to invite users from the site's People page.

Target flow:

```text
Invite person

Email
anne@example.com

Role
○ Site Owner
● User
○ Viewer

System access
[x] HVAC
[ ] Irrigation

Send invitation
```

The invitation must contain:

```text
site_id
membership_role
product access
invited_by_user_id
expiry
```

On registration/acceptance:

```text
User account
    +
Site membership
    +
Product access
```

must be created atomically.

A user who already exists must be able to accept an invitation to an additional site.

Do not require one account per homeowner/site relationship.

---

# 18. Site Owner Management Rules

Site Owners may:

```text
invite owner/user/viewer
change user ↔ viewer
configure product access
remove membership
```

Prevent accidental orphaning of a site.

Do not permit removal or demotion of the final active Site Owner unless an Administrator performs an explicit override or another owner is assigned first.

Audit all membership changes.

---

# 19. Viewer Behavior

Viewer means read-only.

The UI should not merely disable buttons.

Prefer not to render write controls.

Example:

Instead of:

```text
Target 22 °C
[- disabled] [+ disabled]
```

show:

```text
Target
22 °C
```

Likewise, viewers should see irrigation status but not Start/Stop controls.

---

# 20. User Behavior

`user` is an operational role.

Users may interact with normal product functions but must not see technical administration controls.

Examples:

HVAC:

```text
setpoint
normal schedule
operating mode
```

Irrigation:

```text
manual start/stop
normal schedules/programs
rain delay
```

Do not expose:

```text
MQTT
device assignment
firmware
channel mapping
calibration
integration settings
advanced service parameters
```

unless explicitly permitted by a future permission model.

---

# 21. Administrator Experience

Administrator should not see every management function mixed into normal site operation.

Separate:

```text
Operational UI
```

from:

```text
Platform Administration
```

Recommended administrator section:

```text
/admin

Sites
Devices
Users
Invitations
Integrations
Audit
System
```

Normal site operation remains under:

```text
/sites/:siteId/...
```

This avoids mixing "control my house" with "administer Zmartify Edge".

---

# 22. Remove Menu Duplication

Review the existing frontend for overlapping concepts such as:

```text
Rooms
HVAC Overview
HVAC Zones
Devices
Systems
Settings
More / Settings
```

Consolidate them.

Target terminology:

```text
Site
System
Zone
Program
Device
People
Settings
```

Use `Zone` rather than `Room` as the architectural entity.

The UI may display a human-friendly label such as "Rooms" in HVAC-specific contexts if desired, but routes, models and components should consistently use HVAC zones.

Avoid having:

```text
Rooms
and
HVAC Zones
```

as separate navigation concepts.

---

# 23. Backend Authorization Must Be Authoritative

Every API endpoint involving a site or device must resolve:

```text
actor
→ site
→ membership
→ product
→ permission
```

Device authorization must be derived through the device's assigned site.

Example:

```text
Device
→ site_id = 42

User
→ membership(site 42)
→ role=user
→ allowed products=hvac

Device type=irrigation_controller

Result:
403 Forbidden
```

Do not trust the frontend to enforce device restrictions.

---

# 24. Device Product Classification

Ensure devices have a reliable `product_type`.

Examples:

```text
hvac
irrigation
weather
watersensor
energy
```

Product access should preferably be determined through capabilities/product type, not through individual hardcoded device IDs.

Initial access filtering should operate at product level.

Specific per-device ACL is a future extension.

Design the schema so it can later add:

```text
site_membership_device_access
```

without changing `site_memberships`.

Do not implement per-device ACL now unless required by existing code.

---

# 25. Backend API Changes

Implement or adapt endpoints approximately as follows:

```http
GET    /api/v2/me/context

GET    /api/v2/sites
GET    /api/v2/sites/{site_id}

GET    /api/v2/sites/{site_id}/members
POST   /api/v2/sites/{site_id}/members/invite
PATCH  /api/v2/sites/{site_id}/members/{membership_id}
DELETE /api/v2/sites/{site_id}/members/{membership_id}

GET    /api/v2/sites/{site_id}/products
```

Membership update payload example:

```json
{
  "role": "user",
  "products": ["hvac"]
}
```

Reuse existing invitation security where practical, but adapt it to site membership invitations.

---

# 26. Migration Strategy

## Implementation Decisions

The authorization redesign is introduced incrementally while preserving device and service authentication.

- PostgreSQL is the production target. Alembic revisions are the incremental production migration path; the PostgreSQL bootstrap schema and SQLite numbered migrations are kept equivalent for clean development/test databases.
- `user_roles` remains only for the global `administrator` role. Normal global `owner`, `admin`, `installer`, and `viewer` checks are retired as site-scoped endpoint enforcement is introduced.
- The bootstrap account is migrated to global `administrator`. The emergency token remains a machine-only operational escape hatch and is not a site membership.
- Human authorization applies to browser/API users. Device MQTT credentials, device bootstrap, telemetry ingest, and OTA-download service paths remain authenticated as machine/device operations and do not require site membership resolution.
- Canonical user-facing routes use site UUIDs and zone UUIDs. Numeric `zone_id` and `zone-<id>` remain stable device/integration identifiers.
- `devices.product_type` is authoritative for product access. Initial mapping is `hvac_gateway`/`hvac_controller` -> `hvac`, `irrigation_controller` -> `irrigation`, `weather_station` -> `weather`, and `energy_meter` -> `energy`. Unknown device types are not exposed to non-administrators until explicitly classified.
- Membership invitations support both a new account and an existing authenticated account. Acceptance consumes the invitation and creates the membership and product-access rows in one transaction.

Because the system currently contains test data only, favor a clean model.

Suggested implementation order:

1. Add/replace database schema.
2. Add centralized permission service.
3. Update authentication context.
4. Implement site membership APIs.
5. Implement product access APIs.
6. Update existing site/device API authorization.
7. Add `/me/context`.
8. Implement frontend `AccessContext`.
9. Create canonical site-oriented routes.
10. Add dynamic navigation manifest.
11. Consolidate HVAC zones into one view.
12. Apply permission-aware controls to HVAC.
13. Apply same model to irrigation.
14. Implement People/invite UI.
15. Add route redirects from legacy URLs.
16. Remove obsolete routes/components after verification.
17. Update tests and documentation.

Do backend authorization before relying on frontend hiding.

---

# 27. Testing Requirements

Add automated tests covering at least these scenarios.

Administrator:

```text
can access every site
can access every product
can administer platform
```

Site Owner:

```text
can administer own site
cannot administer unrelated site
can manage site users
can configure allowed devices
```

User:

```text
can operate allowed product
cannot configure device
cannot manage people
cannot access disallowed product
```

Viewer:

```text
can read allowed product
cannot issue commands
cannot modify schedules
cannot configure anything
```

Multiple memberships:

```text
same account:
owner on site A
user HVAC-only on site B
viewer on site C
```

Product filtering:

```text
user with HVAC-only access receives 403 from irrigation APIs
```

Navigation:

```text
HVAC-only user never sees irrigation navigation
viewer does not see edit controls
site owner sees management controls
administrator sees admin navigation
```

Route protection:

```text
manually entering unauthorized URL redirects/403s correctly
```

---

# 28. Acceptance Scenario A

User:

```text
Anne
```

Membership:

```text
Summer House
role=user
products=[hvac]
```

Expected UI:

```text
Home
HVAC
Alerts
More
```

Expected HVAC zone:

```text
current temperature
target temperature
setpoint controls
schedule
```

Must NOT show:

```text
Irrigation
Devices
Users
Invites
System
MQTT
OTA
technical configuration
```

Direct request to an irrigation API must return:

```http
403 Forbidden
```

---

# 29. Acceptance Scenario B

User:

```text
Peter
```

Membership:

```text
Stangsdal
role=owner
products=ALL
```

Expected UI includes:

```text
Overview
HVAC
Irrigation
Insights
Alerts

Management:
People
Devices
Site Settings
```

Peter can invite Anne as:

```text
role=user
product=hvac
```

without requiring Administrator intervention.

---

# 30. Acceptance Scenario C

User:

```text
Service Viewer
```

Memberships:

```text
Site A → viewer → HVAC
Site B → viewer → HVAC + Irrigation
Site C → viewer → Irrigation
```

The site selector shows A, B and C.

Navigation changes immediately when site is changed.

No write controls are ever displayed.

---

# 31. Refactoring Rules

Do not solve this by adding more `isAdmin`, `isOwner`, `isViewer` booleans throughout React components.

Do not solve authorization only by hiding navigation.

Do not duplicate zone pages for different roles.

Do not make role logic product-specific.

Implement:

```text
central access context
central permission resolution
central navigation manifest
canonical entity routes
progressive disclosure based on permissions
```

---

# 32. Backwards Compatibility

Existing API v1 may remain temporarily if required by existing controllers.

Do not break HVAC controller MQTT/device communication merely to implement the new frontend authorization model.

Authorization and frontend redesign should be separable from device protocol changes.

Add compatibility redirects for important old frontend URLs during migration.

---

# 33. Documentation

Add:

```text
docs/architecture/authorization-v2.md
docs/architecture/navigation-v2.md
```

Document:

```text
role model
site memberships
product access
permission matrix
authorization evaluation
navigation rules
route hierarchy
migration approach
future per-device ACL extension
future temporary installer/service access
```

---

# 34. Future Extension – Do Not Implement Yet

Design for, but do not implement unless trivial:

```text
temporary installer/service role
membership expiration
custom roles
fine-grained permissions
per-device access
per-zone access
time-limited guest access
API/service accounts
```

A future installer model should preferably be a temporary site grant rather than a permanent global role.

Example:

```text
Installer
Site: Stangsdal
Products: HVAC
Configure: yes
Expires: 2026-08-14 18:00
```

The initial implementation must remain simple.

---

# 35. Definition of Done

The work is complete when:

- Global Administrator exists.
- Owner/User/Viewer are site-scoped.
- One account can have different roles on several sites.
- Product-level access works.
- Backend enforces all permissions.
- Frontend receives effective permissions from backend.
- Navigation is generated dynamically from access context.
- Unauthorized products disappear from navigation.
- Site switching rebuilds navigation correctly.
- HVAC zone overview exists in one canonical location.
- Viewer, User and Owner see the same zone entity with progressively richer controls.
- Duplicate Rooms/HVAC Zones flows are consolidated.
- Mobile navigation remains simple.
- Desktop administration is separated from normal site operation.
- Existing HVAC device integration continues to work.
- Automated authorization and navigation tests pass.
- Architecture documentation is updated.

Before implementation, inspect the existing schema, migrations, API routes, `auth.py`, `App.tsx`, `ResponsiveNavigation.tsx`, HVAC Rooms/Zone components, irrigation components and existing tests.

Implement in incremental commits so database/auth, API, frontend access context, navigation refactor and UX consolidation can be reviewed separately.