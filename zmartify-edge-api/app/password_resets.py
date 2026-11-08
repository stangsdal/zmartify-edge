from __future__ import annotations

import json
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.auth import AuthError, hash_password, hash_token
from app.db import get_connection

DEFAULT_RESET_TTL_HOURS = 24


def _now() -> datetime:
    return datetime.now(timezone.utc)


def password_reset_url(token: str) -> str:
    base_url = os.environ.get("ZMART_EDGE_APP_LOGIN_URL", "https://api.zmartify.dk/app/login").strip()
    parsed = urlsplit(base_url)
    params = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "password_reset_token"]
    params.append(("password_reset_token", token))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(params), parsed.fragment))


def _audit(conn, actor_user_id: int | None, action: str, user_id: int, metadata: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO audit_log(user_id, action, resource_type, resource_id, metadata) VALUES (?, ?, ?, ?, ?)",
        (actor_user_id, action, "user", str(user_id), json.dumps(metadata) if metadata else None),
    )


def create_password_reset(*, user_id: int, actor_user_id: int | None, expires_hours: int = DEFAULT_RESET_TTL_HOURS) -> tuple[dict, str]:
    """Create a password reset token for a user and return (info, raw_token)."""
    ttl_hours = max(1, min(int(expires_hours), 168))
    raw_token = secrets.token_urlsafe(36)
    expires_at = _now() + timedelta(hours=ttl_hours)

    with get_connection() as conn:
        user = conn.execute(
            "SELECT id, username, display_name, email, enabled FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if user is None:
            raise AuthError("user not found")
        if not user["enabled"]:
            raise AuthError("user is disabled")
        email = (user["email"] or "").strip()
        if not email:
            raise AuthError("user has no email address on file")

        # Invalidate any previous unused reset tokens for this user.
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
            (_now().isoformat(), user_id),
        )
        cur = conn.execute(
            """
            INSERT INTO password_reset_tokens(uuid, token_hash, user_id, created_by_user_id, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), hash_token(raw_token), user_id, actor_user_id, expires_at.isoformat()),
        )
        reset_id = cur.lastrowid
        _audit(conn, actor_user_id, "password_reset_link_issued", user_id, {"expires_at": expires_at.isoformat()})
        conn.commit()

    info = {
        "id": reset_id,
        "user_id": user_id,
        "username": user["username"],
        "display_name": user["display_name"],
        "email": email,
        "expires_at": expires_at.isoformat(),
    }
    return info, raw_token


def delete_password_reset(reset_id: int) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM password_reset_tokens WHERE id = ? AND used_at IS NULL", (reset_id,))
        conn.commit()


def _parse_dt(raw: str) -> datetime:
    parsed = datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _load_pending(conn, token: str) -> dict:
    row = conn.execute(
        """
        SELECT r.id, r.user_id, r.expires_at, r.used_at, u.username, u.enabled
        FROM password_reset_tokens r
        JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ?
        """,
        (hash_token(token),),
    ).fetchone()
    if row is None:
        raise AuthError("reset link is invalid")
    if row["used_at"] is not None:
        raise AuthError("reset link has already been used")
    if _parse_dt(row["expires_at"]) <= _now():
        raise AuthError("reset link has expired")
    if not row["enabled"]:
        raise AuthError("user is disabled")
    return {"id": row["id"], "user_id": row["user_id"], "username": row["username"], "expires_at": row["expires_at"]}


def validate_password_reset(token: str) -> dict:
    with get_connection() as conn:
        try:
            pending = _load_pending(conn, token)
        except AuthError as exc:
            return {"valid": False, "reason": str(exc)}
    return {
        "valid": True,
        "username": pending["username"],
        "expires_at": pending["expires_at"],
        "reason": None,
    }


def complete_password_reset(*, token: str, new_password: str) -> str:
    """Set a new password using a reset token. Returns the username."""
    if len(new_password) < 12:
        raise AuthError("password must be at least 12 characters")

    with get_connection() as conn:
        pending = _load_pending(conn, token)
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (hash_password(new_password), pending["user_id"]),
        )
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?",
            (_now().isoformat(), pending["id"]),
        )
        # Revoke existing sessions so only the new password grants access.
        conn.execute(
            "UPDATE api_tokens SET enabled = 0 WHERE user_id = ?",
            (pending["user_id"],),
        )
        _audit(conn, pending["user_id"], "password_reset_completed", pending["user_id"])
        conn.commit()
    return pending["username"]
