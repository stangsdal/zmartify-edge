from __future__ import annotations

import uuid

from app.auth import AuthError
from app.db import get_connection
from app.permissions import PRODUCT_TYPES, SITE_ROLES


def _site_exists(conn, site_id: int) -> bool:
    return conn.execute("SELECT 1 FROM sites WHERE id = ?", (site_id,)).fetchone() is not None


def _member_out(conn, membership_id: int) -> dict:
    row = conn.execute(
        """
        SELECT sm.id, sm.uuid, sm.user_id, sm.role, sm.status, sm.created_at, sm.updated_at,
               u.username, u.display_name, u.email
        FROM site_memberships sm
        JOIN users u ON u.id = sm.user_id
        WHERE sm.id = ?
        """,
        (membership_id,),
    ).fetchone()
    if row is None:
        raise AuthError("site membership not found")
    product_rows = conn.execute(
        "SELECT product_type FROM site_membership_product_access WHERE membership_id = ? ORDER BY product_type",
        (membership_id,),
    ).fetchall()
    return {
        "id": int(row["id"]),
        "uuid": row["uuid"],
        "user_id": int(row["user_id"]),
        "username": row["username"],
        "display_name": row["display_name"],
        "email": row["email"],
        "role": row["role"],
        "status": row["status"],
        "product_types": [str(product["product_type"]) for product in product_rows],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_site_members(site_id: int) -> list[dict]:
    with get_connection() as conn:
        if not _site_exists(conn, site_id):
            raise AuthError("site not found")
        rows = conn.execute("SELECT id FROM site_memberships WHERE site_id = ? ORDER BY id", (site_id,)).fetchall()
        return [_member_out(conn, int(row["id"])) for row in rows]


def list_site_member_candidates(site_id: int) -> list[dict]:
    with get_connection() as conn:
        if not _site_exists(conn, site_id):
            raise AuthError("site not found")
        rows = conn.execute(
            """
            SELECT u.id, u.username, u.display_name, u.email
            FROM users u
            WHERE u.enabled = 1
              AND NOT EXISTS (
                  SELECT 1
                  FROM site_memberships sm
                  WHERE sm.site_id = ? AND sm.user_id = u.id
              )
            ORDER BY u.display_name, u.username, u.id
            """,
            (site_id,),
        ).fetchall()
        return [
            {
                "id": int(row["id"]),
                "username": row["username"],
                "display_name": row["display_name"],
                "email": row["email"],
            }
            for row in rows
        ]


def _validate(role: str, status: str, product_types: list[str]) -> None:
    if role not in SITE_ROLES:
        raise AuthError("unknown site role")
    if status not in {"invited", "active", "disabled"}:
        raise AuthError("unknown membership status")
    invalid_products = set(product_types) - PRODUCT_TYPES
    if invalid_products:
        raise AuthError("unknown product type")


def create_site_member(*, site_id: int, user_id: int, role: str, status: str, product_types: list[str], invited_by_user_id: int | None) -> dict:
    _validate(role, status, product_types)
    with get_connection() as conn:
        if not _site_exists(conn, site_id):
            raise AuthError("site not found")
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            raise AuthError("user not found")
        if conn.execute("SELECT 1 FROM site_memberships WHERE user_id = ? AND site_id = ?", (user_id, site_id)).fetchone():
            raise AuthError("user already has a membership at this site")
        cur = conn.execute(
            """
            INSERT INTO site_memberships(uuid, user_id, site_id, role, status, invited_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), user_id, site_id, role, status, invited_by_user_id),
        )
        membership_id = int(cur.lastrowid)
        for product_type in sorted(set(product_types)):
            conn.execute(
                "INSERT INTO site_membership_product_access(membership_id, product_type) VALUES (?, ?)",
                (membership_id, product_type),
            )
        result = _member_out(conn, membership_id)
        conn.commit()
        return result


def _ensure_owner_remains(conn, membership: dict, role: str, status: str) -> None:
    if membership["role"] != "owner" or membership["status"] != "active" or (role == "owner" and status == "active"):
        return
    owners = conn.execute(
        "SELECT COUNT(*) AS count FROM site_memberships WHERE site_id = ? AND role = 'owner' AND status = 'active'",
        (membership["site_id"],),
    ).fetchone()
    if int(owners["count"]) <= 1:
        raise AuthError("a site must retain at least one active owner")


def update_site_member(*, site_id: int, membership_id: int, role: str | None, status: str | None, product_types: list[str] | None) -> dict:
    with get_connection() as conn:
        membership = conn.execute(
            "SELECT id, site_id, role, status FROM site_memberships WHERE id = ? AND site_id = ?",
            (membership_id, site_id),
        ).fetchone()
        if membership is None:
            raise AuthError("site membership not found")
        next_role = role or str(membership["role"])
        next_status = status or str(membership["status"])
        _validate(next_role, next_status, product_types or [])
        _ensure_owner_remains(conn, membership, next_role, next_status)
        conn.execute(
            "UPDATE site_memberships SET role = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (next_role, next_status, membership_id),
        )
        if product_types is not None:
            conn.execute("DELETE FROM site_membership_product_access WHERE membership_id = ?", (membership_id,))
            for product_type in sorted(set(product_types)):
                conn.execute(
                    "INSERT INTO site_membership_product_access(membership_id, product_type) VALUES (?, ?)",
                    (membership_id, product_type),
                )
        result = _member_out(conn, membership_id)
        conn.commit()
        return result


def delete_site_member(*, site_id: int, membership_id: int) -> None:
    with get_connection() as conn:
        membership = conn.execute(
            "SELECT id, site_id, role, status FROM site_memberships WHERE id = ? AND site_id = ?",
            (membership_id, site_id),
        ).fetchone()
        if membership is None:
            raise AuthError("site membership not found")
        _ensure_owner_remains(conn, membership, role="", status="disabled")
        conn.execute("DELETE FROM site_memberships WHERE id = ?", (membership_id,))
        conn.commit()