from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken

from app.auth import AuthError
from app.db import get_connection


class EmailSettingsError(AuthError):
    pass


def _cipher() -> Fernet:
    key = os.getenv("ZMART_EDGE_SETTINGS_ENCRYPTION_KEY", "").strip()
    if not key:
        raise EmailSettingsError("SMTP settings encryption key is not configured")
    try:
        return Fernet(key.encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise EmailSettingsError("SMTP settings encryption key is invalid") from exc


def get_email_settings() -> dict:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT host, port, username, sender, password_encrypted, updated_at FROM system_email_settings WHERE id = 1"
        ).fetchone()
    if row is None:
        return {
            "configured": bool(os.getenv("ZMART_EDGE_SMTP_HOST", "").strip() and os.getenv("ZMART_EDGE_SMTP_PASSWORD", "")),
            "source": "environment",
            "host": os.getenv("ZMART_EDGE_SMTP_HOST", "").strip() or None,
            "port": int(os.getenv("ZMART_EDGE_SMTP_PORT", "465")),
            "username": os.getenv("ZMART_EDGE_SMTP_USERNAME", "").strip() or None,
            "sender": os.getenv("ZMART_EDGE_SMTP_FROM", "").strip() or None,
            "password_configured": bool(os.getenv("ZMART_EDGE_SMTP_PASSWORD", "")),
            "updated_at": None,
        }
    return {
        "configured": True,
        "source": "settings",
        "host": row["host"],
        "port": int(row["port"]),
        "username": row["username"],
        "sender": row["sender"],
        "password_configured": bool(row["password_encrypted"]),
        "updated_at": row["updated_at"],
    }


def update_email_settings(*, host: str, port: int, username: str, sender: str, password: str | None, actor_user_id: int | None) -> dict:
    with get_connection() as conn:
        existing = conn.execute("SELECT password_encrypted FROM system_email_settings WHERE id = 1").fetchone()
        if not password and existing is None:
            raise EmailSettingsError("SMTP password is required for initial configuration")
        encrypted_password = existing["password_encrypted"] if existing is not None and not password else _cipher().encrypt(str(password).encode("utf-8")).decode("utf-8")
        conn.execute(
            """
            INSERT INTO system_email_settings(id, host, port, username, sender, password_encrypted, updated_by_user_id)
            VALUES (1, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET host = excluded.host, port = excluded.port, username = excluded.username,
                sender = excluded.sender, password_encrypted = excluded.password_encrypted, updated_at = CURRENT_TIMESTAMP,
                updated_by_user_id = excluded.updated_by_user_id
            """,
            (host.strip(), port, username.strip(), sender.strip(), encrypted_password, actor_user_id),
        )
        conn.commit()
    return get_email_settings()


def smtp_configuration() -> dict:
    with get_connection() as conn:
        row = conn.execute("SELECT host, port, username, sender, password_encrypted FROM system_email_settings WHERE id = 1").fetchone()
    if row is None:
        return {
            "host": os.getenv("ZMART_EDGE_SMTP_HOST", "").strip(),
            "port": int(os.getenv("ZMART_EDGE_SMTP_PORT", "465")),
            "username": os.getenv("ZMART_EDGE_SMTP_USERNAME", "").strip(),
            "sender": os.getenv("ZMART_EDGE_SMTP_FROM", os.getenv("ZMART_EDGE_SMTP_USERNAME", "")).strip(),
            "password": os.getenv("ZMART_EDGE_SMTP_PASSWORD", ""),
        }
    try:
        password = _cipher().decrypt(str(row["password_encrypted"]).encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise EmailSettingsError("stored SMTP password cannot be decrypted") from exc
    return {"host": row["host"], "port": int(row["port"]), "username": row["username"], "sender": row["sender"], "password": password}