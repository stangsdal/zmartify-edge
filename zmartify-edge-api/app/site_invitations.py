from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.auth import AuthError, hash_password, hash_token
from app.db import get_connection
from app.permissions import PRODUCT_TYPES, SITE_ROLES
from app.site_memberships import create_site_member_in_connection


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise AuthError("a valid email address is required")
    return normalized


def _validate(role: str, product_types: list[str]) -> None:
    if role not in SITE_ROLES:
        raise AuthError("unknown site role")
    invalid_products = set(product_types) - PRODUCT_TYPES
    if invalid_products:
        raise AuthError("unknown product type")


def invitation_url(token: str) -> str:
    base_url = os.environ.get("ZMART_EDGE_PILOT_APP_LOGIN_URL", "https://pilot.zmartify.dk/app/login").strip()
    parsed = urlsplit(base_url)
    params = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "site_invitation_token"]
    params.append(("site_invitation_token", token))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(params), parsed.fragment))


def delete_site_invitation(invitation_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM site_invitations WHERE id = ? AND accepted_at IS NULL", (invitation_id,))
        conn.commit()


def _out(conn, invitation_id: int) -> dict:
    row = conn.execute(
        """
        SELECT si.id, si.uuid, si.email, si.site_id, si.role, si.invited_by_user_id,
               si.expires_at, si.accepted_at, si.accepted_by_user_id, si.created_at, s.name AS site_name
        FROM site_invitations si
        JOIN sites s ON s.id = si.site_id
        WHERE si.id = ?
        """,
        (invitation_id,),
    ).fetchone()
    if row is None:
        raise AuthError("site invitation not found")
    products = conn.execute(
        "SELECT product_type FROM site_invitation_product_access WHERE invitation_id = ? ORDER BY product_type",
        (invitation_id,),
    ).fetchall()
    return {
        "id": int(row["id"]),
        "uuid": row["uuid"],
        "email": row["email"],
        "site_id": int(row["site_id"]),
        "site_name": row["site_name"],
        "role": row["role"],
        "product_types": [str(product["product_type"]) for product in products],
        "expires_at": row["expires_at"],
        "accepted_at": row["accepted_at"],
        "created_at": row["created_at"],
    }


def create_site_invitation(*, site_id: int, email: str, role: str, product_types: list[str], invited_by_user_id: int | None, expires_hours: int = 168) -> tuple[dict, str]:
    normalized_email = _normalize_email(email)
    _validate(role, product_types)
    expiry = _now() + timedelta(hours=max(1, min(expires_hours, 24 * 30)))
    raw_token = secrets.token_urlsafe(36)

    with get_connection() as conn:
        if conn.execute("SELECT 1 FROM sites WHERE id = ?", (site_id,)).fetchone() is None:
            raise AuthError("site not found")
        cur = conn.execute(
            """
            INSERT INTO site_invitations(uuid, token_hash, email, site_id, role, invited_by_user_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), hash_token(raw_token), normalized_email, site_id, role, invited_by_user_id, expiry.isoformat()),
        )
        invitation_id = int(cur.lastrowid)
        for product_type in sorted(set(product_types)):
            conn.execute(
                "INSERT INTO site_invitation_product_access(invitation_id, product_type) VALUES (?, ?)",
                (invitation_id, product_type),
            )
        conn.execute(
            "INSERT INTO audit_log(user_id, action, resource_type, resource_id, metadata) VALUES (?, ?, ?, ?, ?)",
            (invited_by_user_id, "site_invitation_created", "site_invitation", str(invitation_id), f'{{"site_id": {site_id}, "email": "{normalized_email}"}}'),
        )
        result = _out(conn, invitation_id)
        conn.commit()
    return result, raw_token


def list_site_invitations(site_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT id FROM site_invitations WHERE site_id = ? ORDER BY id DESC", (site_id,)).fetchall()
        return [_out(conn, int(row["id"])) for row in rows]


def validate_site_invitation(token: str) -> dict:
    try:
        with get_connection() as conn:
            invitation = _load_pending(conn, token)
            site = conn.execute("SELECT name FROM sites WHERE id = ?", (invitation["site_id"],)).fetchone()
            products = conn.execute(
                "SELECT product_type FROM site_invitation_product_access WHERE invitation_id = ? ORDER BY product_type",
                (invitation["id"],),
            ).fetchall()
            return {
                "valid": True,
                "site_name": site["name"] if site else None,
                "role": invitation["role"],
                "product_types": [str(row["product_type"]) for row in products],
                "expires_at": invitation["expires_at"],
                "reason": None,
            }
    except AuthError as exc:
        return {"valid": False, "reason": str(exc)}


def _load_pending(conn, token: str) -> dict:
    invitation = conn.execute(
        "SELECT id, email, site_id, role, expires_at, accepted_at FROM site_invitations WHERE token_hash = ?",
        (hash_token(token),),
    ).fetchone()
    if invitation is None:
        raise AuthError("invalid site invitation")
    if invitation["accepted_at"]:
        raise AuthError("site invitation already accepted")
    expires_at = datetime.fromisoformat(str(invitation["expires_at"]))
    if _now() >= expires_at:
        raise AuthError("site invitation expired")
    return invitation


def accept_site_invitation(*, token: str, user_id: int, user_email: str | None) -> dict:
    if not user_email:
        raise AuthError("your account needs an email address to accept this invitation")
    with get_connection() as conn:
        invitation = _load_pending(conn, token)
        if _normalize_email(user_email) != str(invitation["email"]):
            raise AuthError("site invitation email does not match your account")
        products = conn.execute(
            "SELECT product_type FROM site_invitation_product_access WHERE invitation_id = ?",
            (invitation["id"],),
        ).fetchall()
        membership = create_site_member_in_connection(
            conn,
            site_id=int(invitation["site_id"]),
            user_id=user_id,
            role=str(invitation["role"]),
            status="active",
            product_types=[str(row["product_type"]) for row in products],
            invited_by_user_id=None,
        )
        updated = conn.execute(
            "UPDATE site_invitations SET accepted_at = ?, accepted_by_user_id = ? WHERE id = ? AND accepted_at IS NULL",
            (_now().isoformat(), user_id, invitation["id"]),
        )
        if updated.rowcount == 0:
            raise AuthError("site invitation already accepted")
        conn.execute(
            "INSERT INTO audit_log(user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?)",
            (user_id, "site_invitation_accepted", "site_invitation", str(invitation["id"])),
        )
        conn.commit()
        return membership


def register_and_accept_site_invitation(*, token: str, username: str, display_name: str, password: str) -> int:
    if len(password) < 12:
        raise AuthError("password must be at least 12 characters")
    with get_connection() as conn:
        invitation = _load_pending(conn, token)
        try:
            user = conn.execute(
                """
                INSERT INTO users(uuid, username, email, display_name, password_hash, enabled)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (str(uuid.uuid4()), username.strip(), invitation["email"], display_name.strip(), hash_password(password)),
            )
        except Exception as exc:
            if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
                raise AuthError("username already exists") from exc
            raise
        user_id = int(user.lastrowid)
        products = conn.execute(
            "SELECT product_type FROM site_invitation_product_access WHERE invitation_id = ?",
            (invitation["id"],),
        ).fetchall()
        create_site_member_in_connection(
            conn,
            site_id=int(invitation["site_id"]),
            user_id=user_id,
            role=str(invitation["role"]),
            status="active",
            product_types=[str(row["product_type"]) for row in products],
            invited_by_user_id=invitation["invited_by_user_id"] if "invited_by_user_id" in invitation.keys() else None,
        )
        updated = conn.execute(
            "UPDATE site_invitations SET accepted_at = ?, accepted_by_user_id = ? WHERE id = ? AND accepted_at IS NULL",
            (_now().isoformat(), user_id, invitation["id"]),
        )
        if updated.rowcount == 0:
            raise AuthError("site invitation already accepted")
        conn.execute(
            "INSERT INTO audit_log(user_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?)",
            (user_id, "site_invitation_registered", "site_invitation", str(invitation["id"])),
        )
        conn.commit()
        return user_id