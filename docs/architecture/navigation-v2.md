# Navigation V2

## Route hierarchy

Operational routes are site-oriented and use the site UUID from the access context:

```text
/app/sites/:siteId
/app/sites/:siteId/hvac
/app/sites/:siteId/hvac/zones
/app/sites/:siteId/hvac/zones/:zoneId
/app/sites/:siteId/irrigation
/app/sites/:siteId/irrigation/programs
/app/sites/:siteId/people
/app/sites/:siteId/settings
```

Platform administration remains separate under `/app` administration routes. Legacy paths are retained temporarily for compatibility and should redirect to these canonical routes as each screen is migrated.

## Access context and site selection

`GET /api/v2/me/context` is the source of truth for site membership, installed products, and effective permissions. `AccessContext` persists the selected authorized site in local storage. A canonical site route resolves that site and selects it before rendering.

If a route names an inaccessible site or product, the route guard redirects to the selected site overview. API authorization remains authoritative and returns 403 independently of the UI.

## Navigation rules

Responsive navigation is produced from the selected site's allowed products. HVAC and irrigation links are omitted when the corresponding product is unavailable. A normal user sees operational navigation only; platform administration is shown only to administrators.

The HVAC zone overview is the shared operational page. Role permissions control which controls appear: viewers see read-only state, users can operate, and owners can access configuration actions.

## Migration notes

Screens still using a page-local `SiteSelector` should migrate to `AccessContext.selectedSiteId` and `selectSite`. This ensures a site switch changes product navigation immediately and prevents a stale product view from surviving a site change.