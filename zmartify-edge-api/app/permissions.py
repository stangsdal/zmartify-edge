from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.auth import AuthError, AuthenticatedUser
from app.db import get_connection


GLOBAL_ADMIN_ROLE = "administrator"
SITE_ROLES = frozenset({"owner", "user", "viewer"})
PRODUCT_TYPES = frozenset({"hvac", "irrigation", "weather", "energy"})
Permission = Literal["read", "operate", "configure", "administer"]

_ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset({"read", "operate", "configure", "administer"}),
    "user": frozenset({"read", "operate"}),
    "viewer": frozenset({"read"}),
}


@dataclass(frozen=True)
class SiteAccess:
    membership_id: int | None
    site_id: int
    role: str
    unrestricted_products: bool
    allowed_products: frozenset[str]
    is_administrator: bool


def is_global_administrator(user: AuthenticatedUser) -> bool:
    return user.emergency or GLOBAL_ADMIN_ROLE in user.roles


def accessible_site_ids(user: AuthenticatedUser) -> set[int] | None:
    if is_global_administrator(user):
        return None
    if user.user_id is None:
        return set()
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT site_id FROM site_memberships WHERE user_id = ? AND status = 'active'",
            (user.user_id,),
        ).fetchall()
    return {int(row["site_id"]) for row in rows}


def require_global_admin(user: AuthenticatedUser) -> None:
    if not is_global_administrator(user):
        raise AuthError("global administrator permission required")


def _active_membership(user: AuthenticatedUser, site_id: int) -> SiteAccess:
    if user.user_id is None:
        raise AuthError("site membership required")

    with get_connection() as conn:
        membership = conn.execute(
            """
            SELECT id, role
            FROM site_memberships
            WHERE user_id = ? AND site_id = ? AND status = 'active'
            """,
            (user.user_id, site_id),
        ).fetchone()
        if membership is None:
            raise AuthError("site access denied")
        rows = conn.execute(
            "SELECT product_type FROM site_membership_product_access WHERE membership_id = ?",
            (membership["id"],),
        ).fetchall()

    allowed_products = frozenset(str(row["product_type"]) for row in rows)
    return SiteAccess(
        membership_id=int(membership["id"]),
        site_id=site_id,
        role=str(membership["role"]),
        unrestricted_products=not allowed_products,
        allowed_products=allowed_products,
        is_administrator=False,
    )


def require_site_access(user: AuthenticatedUser, site_id: int) -> SiteAccess:
    if is_global_administrator(user):
        return SiteAccess(
            membership_id=None,
            site_id=site_id,
            role="administrator",
            unrestricted_products=True,
            allowed_products=PRODUCT_TYPES,
            is_administrator=True,
        )
    return _active_membership(user, site_id)


def require_site_role(user: AuthenticatedUser, site_id: int, allowed_roles: set[str]) -> SiteAccess:
    access = require_site_access(user, site_id)
    if not access.is_administrator and access.role not in allowed_roles:
        raise AuthError("site role permission denied")
    return access


def require_product_access(user: AuthenticatedUser, site_id: int, product_type: str) -> SiteAccess:
    if product_type not in PRODUCT_TYPES:
        raise AuthError("unknown product type")
    access = require_site_access(user, site_id)
    if not access.is_administrator and not access.unrestricted_products and product_type not in access.allowed_products:
        raise AuthError("product access denied")
    return access


def require_site_permission(
    user: AuthenticatedUser,
    site_id: int,
    *,
    product_type: str | None,
    permission: Permission,
) -> SiteAccess:
    access = require_product_access(user, site_id, product_type) if product_type else require_site_access(user, site_id)
    if access.is_administrator:
        return access
    if permission not in _ROLE_PERMISSIONS.get(access.role, frozenset()):
        raise AuthError("site permission denied")
    return access


def access_context(user: AuthenticatedUser) -> dict:
    if user.user_id is None:
        return {
            "user": {"id": 0, "username": user.username, "display_name": "Emergency Token", "global_roles": []},
            "is_administrator": True,
            "sites": [],
        }

    administrator = is_global_administrator(user)
    with get_connection() as conn:
        user_row = conn.execute(
            "SELECT id, uuid, username, display_name FROM users WHERE id = ?",
            (user.user_id,),
        ).fetchone()
        if user_row is None:
            raise AuthError("user not found")

        if administrator:
            memberships = conn.execute(
                """
                SELECT s.id, s.uuid, s.name, 'administrator' AS role
                FROM sites s
                ORDER BY s.name, s.id
                """
            ).fetchall()
        else:
            memberships = conn.execute(
                """
                SELECT s.id, s.uuid, s.name, sm.id AS membership_id, sm.role
                FROM site_memberships sm
                JOIN sites s ON s.id = sm.site_id
                WHERE sm.user_id = ? AND sm.status = 'active'
                ORDER BY s.name, s.id
                """,
                (user.user_id,),
            ).fetchall()

        sites: list[dict] = []
        for membership in memberships:
            site_id = int(membership["id"])
            installed_rows = conn.execute(
                """
                SELECT DISTINCT product_type
                FROM devices
                WHERE site_id = ? AND product_type IN ('hvac', 'irrigation', 'weather', 'energy')
                ORDER BY product_type
                """,
                (site_id,),
            ).fetchall()
            installed_products = [str(row["product_type"]) for row in installed_rows]

            if administrator:
                allowed_products = set(installed_products)
            else:
                allowed_rows = conn.execute(
                    "SELECT product_type FROM site_membership_product_access WHERE membership_id = ?",
                    (membership["membership_id"],),
                ).fetchall()
                explicit_products = {str(row["product_type"]) for row in allowed_rows}
                allowed_products = set(installed_products) if not explicit_products else set(installed_products) & explicit_products

            role = str(membership["role"])
            permissions = frozenset({"read", "operate", "configure", "administer"}) if administrator else _ROLE_PERMISSIONS[role]
            sites.append(
                {
                    "id": site_id,
                    "uuid": membership["uuid"],
                    "name": membership["name"],
                    "role": role,
                    "products": [
                        {
                            "type": product,
                            "allowed": product in allowed_products,
                            "permissions": {
                                "read": product in allowed_products and "read" in permissions,
                                "operate": product in allowed_products and "operate" in permissions,
                                "configure": product in allowed_products and "configure" in permissions,
                                "administer": product in allowed_products and "administer" in permissions,
                            },
                        }
                        for product in installed_products
                    ],
                }
            )

    return {
        "user": {
            "id": int(user_row["id"]),
            "uuid": user_row["uuid"],
            "username": user_row["username"],
            "display_name": user_row["display_name"],
            "global_roles": [GLOBAL_ADMIN_ROLE] if administrator else [],
        },
        "is_administrator": administrator,
        "sites": sites,
    }