# Authorization V2

## Role model

`administrator` is the only global human role. It has full platform access and can operate any site.

Normal users obtain access through an active `site_memberships` row. A membership role is one of `owner`, `user`, or `viewer`.

| Permission | Owner | User | Viewer |
| --- | --- | --- | --- |
| Read | Yes | Yes | Yes |
| Operate | Yes | Yes | No |
| Configure | Yes | No | No |
| Administer site | Yes | No | No |

## Product access

`site_membership_product_access` is an optional allow-list. No rows means all product types installed at the site are available. One or more rows restrict access to those product types.

The initial product types are `hvac`, `irrigation`, `weather`, and `energy`. `devices.product_type` is used when authorizing device-backed operations and realtime topics.

## Evaluation

The backend evaluates access in this order:

1. Authenticate the actor.
2. Resolve the site, directly or through the assigned device.
3. Allow a global administrator, otherwise load an active site membership.
4. Apply the product allow-list.
5. Apply the requested semantic permission.

`app.permissions` owns this evaluation through `require_global_admin`, `require_site_access`, `require_product_access`, and `require_site_permission`. API handlers should use these helpers rather than compare normal global role names.

## Invitations

A site owner or administrator creates a `site_invitations` record with recipient email, site, role, product grants, inviter, expiry, and a hashed one-time token. The email link supports both existing-account acceptance and new-account registration. Acceptance creates the user when needed, membership, and product rows in one database transaction, then consumes the invitation.

SMTP has an environment-variable fallback: `ZMART_EDGE_SMTP_HOST`, `ZMART_EDGE_SMTP_PORT`, `ZMART_EDGE_SMTP_USERNAME`, `ZMART_EDGE_SMTP_PASSWORD`, and `ZMART_EDGE_SMTP_FROM`. A global administrator may instead configure it in System settings. The password is encrypted in `system_email_settings` with deployment-only `ZMART_EDGE_SETTINGS_ENCRYPTION_KEY`; read APIs return only the configured state and never the secret.

## Migration strategy

PostgreSQL uses Alembic migrations; SQLite clean development databases use numbered SQL migrations. The PostgreSQL bootstrap schema mirrors both. Legacy `user_site_access` and old global normal-user roles remain only for compatibility paths while these paths are migrated; they must not be used for new site-scoped endpoint authorization.

## Future extensions

Per-device access can be added as a child allow-list of `site_memberships` without changing role evaluation. Temporary installer/service access should be modeled as an expiring site grant, not a permanent global role.