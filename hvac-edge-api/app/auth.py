from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.db import get_connection

ROLE_OWNER = "owner"
ROLE_ADMIN = "admin"
ROLE_INSTALLER = "installer"
ROLE_VIEWER = "viewer"

_PASSWORD_HASHER = PasswordHasher()


class AuthError(ValueError):
    pass


@dataclass
class AuthenticatedUser:
    user_id: int | None
    username: str
    roles: set[str]
    token_id: int | None
    emergency: bool = False


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _new_uuid() -> str:
    return str(uuid.uuid4())


def hash_password(password: str) -> str:
    return _PASSWORD_HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _PASSWORD_HASHER.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _role_ids(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute("SELECT id, name FROM roles").fetchall()
    return {row["name"]: row["id"] for row in rows}


def _roles_for_user(conn: sqlite3.Connection, user_id: int) -> set[str]:
    rows = conn.execute(
        """
        SELECT r.name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
        """,
        (user_id,),
    ).fetchall()
    return {row["name"] for row in rows}


def _audit(conn: sqlite3.Connection, user_id: int | None, action: str, resource_type: str | None = None, resource_id: str | None = None, metadata: dict | None = None) -> None:
    conn.execute(
        """
        INSERT INTO audit_log(user_id, action, resource_type, resource_id, metadata)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, action, resource_type, resource_id, json.dumps(metadata) if metadata else None),
    )


def is_initialized() -> bool:
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()
        return bool(row and row["c"] > 0)


def ensure_bootstrap_owner() -> None:
    with get_connection() as conn:
        row = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()
        if row and row["c"] > 0:
            return

        password = secrets.token_urlsafe(18)
        password_hash = hash_password(password)
        cur = conn.execute(
            """
            INSERT INTO users(uuid, username, display_name, password_hash, enabled)
            VALUES (?, ?, ?, ?, 1)
            """,
            (_new_uuid(), "admin", "Administrator", password_hash),
        )

        roles = _role_ids(conn)
        owner_role_id = roles.get(ROLE_OWNER)
        if owner_role_id is None:
            raise RuntimeError("owner role missing")

        conn.execute(
            "INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)",
            (cur.lastrowid, owner_role_id),
        )
        _audit(conn, cur.lastrowid, "bootstrap_owner_user", "user", str(cur.lastrowid), {"username": "admin"})
        conn.commit()

    print(f"Initial admin password: {password}")


def _login_limit_window_seconds() -> int:
    return int(os.getenv("HVAC_EDGE_LOGIN_WINDOW_SECONDS", "300"))


def _login_max_attempts() -> int:
    return int(os.getenv("HVAC_EDGE_LOGIN_MAX_ATTEMPTS", "5"))


def _login_lockout_seconds() -> int:
    return int(os.getenv("HVAC_EDGE_LOGIN_LOCKOUT_SECONDS", "900"))


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _clear_failures(conn: sqlite3.Connection, username: str) -> None:
    conn.execute("DELETE FROM auth_login_state WHERE username = ?", (username,))


def _is_locked(conn: sqlite3.Connection, username: str) -> bool:
    row = conn.execute(
        "SELECT lock_until, window_started_at FROM auth_login_state WHERE username = ?",
        (username,),
    ).fetchone()
    if row is None:
        return False

    now = _now_utc()
    lock_until = _parse_dt(row["lock_until"])
    if lock_until and now < lock_until:
        return True

    # Expired lock or stale window; clear row.
    window_started_at = _parse_dt(row["window_started_at"])
    if lock_until or (
        window_started_at and (now - window_started_at).total_seconds() > _login_limit_window_seconds()
    ):
        _clear_failures(conn, username)
        conn.commit()
    return False


def _record_failure(conn: sqlite3.Connection, username: str, user_id: int | None = None) -> None:
    now = _now_utc()
    row = conn.execute(
        "SELECT failed_count, window_started_at FROM auth_login_state WHERE username = ?",
        (username,),
    ).fetchone()

    window_started = _parse_dt(row["window_started_at"]) if row else None
    failed_count = int(row["failed_count"]) if row else 0

    if window_started is None or (now - window_started).total_seconds() > _login_limit_window_seconds():
        failed_count = 1
        window_started = now
    else:
        failed_count += 1

    lock_until: datetime | None = None
    if failed_count >= _login_max_attempts():
        lock_until = now + timedelta(seconds=_login_lockout_seconds())
        failed_count = 0
        _audit(
            conn,
            user_id,
            "login_lockout",
            "auth",
            username,
            {"lock_until": _iso(lock_until)},
        )

    conn.execute(
        """
        INSERT INTO auth_login_state(username, failed_count, window_started_at, lock_until, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(username) DO UPDATE SET
          failed_count = excluded.failed_count,
          window_started_at = excluded.window_started_at,
          lock_until = excluded.lock_until,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
            username,
            failed_count,
            _iso(window_started),
            _iso(lock_until) if lock_until else None,
        ),
    )
    conn.commit()


def _token_ttl_hours() -> int:
    return int(os.getenv("HVAC_EDGE_ACCESS_TOKEN_TTL_HOURS", "24"))


def login(username: str, password: str) -> tuple[str, str, int]:
    with get_connection() as conn:
        if _is_locked(conn, username):
            raise AuthError("account temporarily locked due to repeated failed login attempts")

        user = conn.execute(
            "SELECT id, username, password_hash, enabled FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if user is None or user["enabled"] != 1:
            _record_failure(conn, username)
            raise AuthError("invalid username or password")

        if not verify_password(user["password_hash"], password):
            _record_failure(conn, username, user_id=user["id"])
            _audit(conn, user["id"], "login_failed", "user", str(user["id"]))
            conn.commit()
            raise AuthError("invalid username or password")

        _clear_failures(conn, username)

        raw_token = secrets.token_urlsafe(48)
        token_hash = hash_token(raw_token)
        expires_at = _now_utc() + timedelta(hours=_token_ttl_hours())

        token_cur = conn.execute(
            """
            INSERT INTO api_tokens(user_id, token_hash, expires_at, enabled)
            VALUES (?, ?, ?, 1)
            """,
            (user["id"], token_hash, _iso(expires_at)),
        )

        conn.execute(
            "UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (user["id"],),
        )
        _audit(conn, user["id"], "login", "user", str(user["id"]), {"token_id": token_cur.lastrowid})
        conn.commit()

        return raw_token, _iso(expires_at), user["id"]


def authenticate_bearer_token(token: str) -> AuthenticatedUser:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT t.id AS token_id, t.user_id, t.enabled AS token_enabled, t.expires_at,
                   u.username, u.enabled AS user_enabled
            FROM api_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = ?
            """,
            (hash_token(token),),
        ).fetchone()
        if row is None:
            raise AuthError("invalid bearer token")
        if row["token_enabled"] != 1 or row["user_enabled"] != 1:
            raise AuthError("token or user disabled")

        expires_at = row["expires_at"]
        if expires_at:
            try:
                expiry = datetime.fromisoformat(expires_at)
            except ValueError as exc:
                raise AuthError("invalid token expiry") from exc
            if _now_utc() >= expiry:
                raise AuthError("token expired")

        roles = _roles_for_user(conn, row["user_id"])
        conn.execute("UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?", (row["token_id"],))
        conn.commit()
        return AuthenticatedUser(
            user_id=row["user_id"],
            username=row["username"],
            roles=roles,
            token_id=row["token_id"],
        )


def authenticate_emergency_token(token: str) -> AuthenticatedUser | None:
    enabled = os.getenv("HVAC_EDGE_ENABLE_EMERGENCY_TOKEN", "0").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return None
    configured = os.getenv("ADMIN_API_TOKEN", "").strip()
    if not configured:
        return None
    if not secrets.compare_digest(token, configured):
        return None
    return AuthenticatedUser(
        user_id=None,
        username="emergency_token",
        roles={ROLE_OWNER},
        token_id=None,
        emergency=True,
    )


def require_any_role(user: AuthenticatedUser, allowed_roles: set[str]) -> None:
    if not (user.roles & allowed_roles):
        raise AuthError("insufficient role permissions")


def logout_token(token_id: int | None, user_id: int | None) -> None:
    if token_id is None:
        return
    with get_connection() as conn:
        conn.execute("UPDATE api_tokens SET enabled = 0 WHERE id = ?", (token_id,))
        _audit(conn, user_id, "logout", "api_token", str(token_id))
        conn.commit()


def list_users() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, uuid, username, email, display_name, enabled, created_at, updated_at, last_login_at
            FROM users
            ORDER BY id
            """
        ).fetchall()
        out: list[dict] = []
        for row in rows:
            roles = sorted(_roles_for_user(conn, row["id"]))
            out.append(
                {
                    "id": row["id"],
                    "uuid": row["uuid"],
                    "username": row["username"],
                    "email": row["email"],
                    "display_name": row["display_name"],
                    "enabled": row["enabled"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "last_login_at": row["last_login_at"],
                    "roles": roles,
                }
            )
        return out


def get_user(user_id: int) -> dict:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, uuid, username, email, display_name, enabled, created_at, updated_at, last_login_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
        if row is None:
            raise AuthError("user not found")
        return {
            "id": row["id"],
            "uuid": row["uuid"],
            "username": row["username"],
            "email": row["email"],
            "display_name": row["display_name"],
            "enabled": row["enabled"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_login_at": row["last_login_at"],
            "roles": sorted(_roles_for_user(conn, row["id"])),
        }


def create_user(*, actor_user_id: int | None, username: str, display_name: str, password: str, email: str | None, roles: list[str]) -> dict:
    if len(password) < 12:
        raise AuthError("password must be at least 12 characters")

    with get_connection() as conn:
        try:
            cur = conn.execute(
                """
                INSERT INTO users(uuid, username, email, display_name, password_hash, enabled)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (_new_uuid(), username, email, display_name, hash_password(password)),
            )
        except sqlite3.IntegrityError as exc:
            raise AuthError("username already exists") from exc

        new_user_id = cur.lastrowid
        role_map = _role_ids(conn)
        selected = roles or [ROLE_VIEWER]
        for role_name in selected:
            role_id = role_map.get(role_name)
            if role_id is None:
                raise AuthError(f"unknown role: {role_name}")
            conn.execute("INSERT OR IGNORE INTO user_roles(user_id, role_id) VALUES (?, ?)", (new_user_id, role_id))

        _audit(conn, actor_user_id, "user_creation", "user", str(new_user_id), {"username": username, "roles": selected})
        conn.commit()

    return get_user(new_user_id)


def set_user_enabled(*, actor_user_id: int | None, user_id: int, enabled: bool) -> dict:
    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE users SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (1 if enabled else 0, user_id),
        )
        if cur.rowcount == 0:
            raise AuthError("user not found")
        _audit(conn, actor_user_id, "user_enable" if enabled else "user_disable", "user", str(user_id))
        conn.commit()
    return get_user(user_id)


def reset_user_password(*, actor_user_id: int | None, user_id: int, password: str) -> dict:
    if len(password) < 12:
        raise AuthError("password must be at least 12 characters")

    with get_connection() as conn:
        cur = conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (hash_password(password), user_id),
        )
        if cur.rowcount == 0:
            raise AuthError("user not found")
        _audit(conn, actor_user_id, "reset_password", "user", str(user_id))
        conn.commit()
    return get_user(user_id)


def set_user_roles(*, actor_user_id: int | None, user_id: int, roles: list[str]) -> dict:
    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if exists is None:
            raise AuthError("user not found")

        role_map = _role_ids(conn)
        for role_name in roles:
            if role_name not in role_map:
                raise AuthError(f"unknown role: {role_name}")

        conn.execute("DELETE FROM user_roles WHERE user_id = ?", (user_id,))
        for role_name in roles:
            conn.execute(
                "INSERT INTO user_roles(user_id, role_id) VALUES (?, ?)",
                (user_id, role_map[role_name]),
            )

        _audit(conn, actor_user_id, "role_changes", "user", str(user_id), {"roles": roles})
        conn.commit()

    return get_user(user_id)


def list_user_site_access(user_id: int) -> list[int]:
    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if exists is None:
            raise AuthError("user not found")
        rows = conn.execute(
            "SELECT site_id FROM user_site_access WHERE user_id = ? ORDER BY site_id",
            (user_id,),
        ).fetchall()
        return [int(row["site_id"]) for row in rows]


def set_user_site_access(*, actor_user_id: int | None, user_id: int, site_ids: list[int]) -> list[int]:
    normalized_ids = sorted({int(site_id) for site_id in site_ids if int(site_id) > 0})
    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if exists is None:
            raise AuthError("user not found")

        if normalized_ids:
            placeholders = ",".join("?" for _ in normalized_ids)
            rows = conn.execute(
                f"SELECT id FROM sites WHERE id IN ({placeholders})",
                tuple(normalized_ids),
            ).fetchall()
            existing_site_ids = {int(row["id"]) for row in rows}
            missing = [site_id for site_id in normalized_ids if site_id not in existing_site_ids]
            if missing:
                raise AuthError(f"site not found: {missing[0]}")

        conn.execute("DELETE FROM user_site_access WHERE user_id = ?", (user_id,))
        for site_id in normalized_ids:
            conn.execute(
                "INSERT INTO user_site_access(user_id, site_id) VALUES (?, ?)",
                (user_id, site_id),
            )

        _audit(conn, actor_user_id, "user_site_access_set", "user", str(user_id), {"site_ids": normalized_ids})
        conn.commit()

    return normalized_ids


def delete_user(*, actor_user_id: int | None, user_id: int) -> None:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if cur.rowcount == 0:
            raise AuthError("user not found")
        _audit(conn, actor_user_id, "user_delete", "user", str(user_id))
        conn.commit()


def list_audit_logs(limit: int = 200) -> list[dict]:
    safe_limit = max(1, min(limit, 500))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT a.id, a.user_id, u.username, a.action, a.resource_type, a.resource_id, a.metadata, a.created_at
            FROM audit_log a
            LEFT JOIN users u ON u.id = a.user_id
            ORDER BY a.id DESC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
        return [
            {
                "id": row["id"],
                "user_id": row["user_id"],
                "username": row["username"],
                "action": row["action"],
                "resource_type": row["resource_type"],
                "resource_id": row["resource_id"],
                "metadata": row["metadata"],
                "created_at": row["created_at"],
            }
            for row in rows
        ]


def audit_action(*, actor_user_id: int | None, action: str, resource_type: str | None = None, resource_id: str | None = None, metadata: dict | None = None) -> None:
    with get_connection() as conn:
        _audit(conn, actor_user_id, action, resource_type, resource_id, metadata)
        conn.commit()
