from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(tmp_path / "password-reset.sqlite"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")

    from app.db import initialize_database

    initialize_database()
    from main import app

    return TestClient(app)


TEST_PASS = "VeryStrongPass123!"


def _login(client: TestClient, username: str, password: str = TEST_PASS) -> dict[str, str]:
    response = client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    access_token = response.json()["access_token"]
    return {"Authorization": "Bearer " + access_token}


def _create_admin_and_user(*, user_email: str | None = "resetme@example.com") -> int:
    from app.auth import create_user

    create_user(
        actor_user_id=None,
        username="reset-admin",
        display_name="Reset Administrator",
        password=TEST_PASS,
        email=None,
        roles=["administrator"],
    )
    user = create_user(
        actor_user_id=None,
        username="reset-target",
        display_name="Reset Target",
        password=TEST_PASS,
        email=user_email,
        roles=[],
    )
    return user["id"]


def test_admin_sends_reset_link_and_user_completes_reset(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    user_id = _create_admin_and_user()

    captured: dict = {}

    def fake_send(*, recipient: str, display_name: str, reset_url: str, expires_at: str) -> None:
        captured.update(recipient=recipient, display_name=display_name, reset_url=reset_url, expires_at=expires_at)

    monkeypatch.setattr("app.router_v2_auth_users.send_password_reset", fake_send)

    admin_headers = _login(client, "reset-admin")
    response = client.post(f"/api/v2/users/{user_id}/send-password-reset", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["sent"] is True
    assert body["email"] == "resetme@example.com"
    assert captured["recipient"] == "resetme@example.com"
    assert "password_reset_token=" in captured["reset_url"]

    token = captured["reset_url"].split("password_reset_token=")[1]

    validated = client.get("/api/v2/auth/password-reset/validate", params={"token": token})
    assert validated.status_code == 200
    assert validated.json()["valid"] is True
    assert validated.json()["username"] == "reset-target"

    completed = client.post(
        "/api/v2/auth/password-reset/complete",
        json={"token": token, "new_password": "BrandNewSecret123!"},
    )
    assert completed.status_code == 200
    assert completed.json() == {"ok": True, "username": "reset-target"}

    old_login = client.post("/auth/login", json={"username": "reset-target", "password": "VeryStrongPass123!"})
    assert old_login.status_code == 401

    new_login = client.post("/auth/login", json={"username": "reset-target", "password": "BrandNewSecret123!"})
    assert new_login.status_code == 200

    reused = client.post(
        "/api/v2/auth/password-reset/complete",
        json={"token": token, "new_password": "AnotherSecret12345!"},
    )
    assert reused.status_code == 400
    assert "already been used" in reused.json()["detail"]


def test_reset_completion_revokes_existing_sessions(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    user_id = _create_admin_and_user()

    monkeypatch.setattr(
        "app.router_v2_auth_users.send_password_reset",
        lambda *, recipient, display_name, reset_url, expires_at: None,
    )

    user_headers = _login(client, "reset-target")
    assert client.get("/auth/me", headers=user_headers).status_code == 200

    admin_headers = _login(client, "reset-admin")
    assert client.post(f"/api/v2/users/{user_id}/send-password-reset", headers=admin_headers).status_code == 200

    from app.password_resets import create_password_reset, complete_password_reset

    _info, token = create_password_reset(user_id=user_id, actor_user_id=None)
    complete_password_reset(token=token, new_password="BrandNewSecret123!")

    assert client.get("/auth/me", headers=user_headers).status_code in {401, 403}


def test_send_reset_requires_admin_and_user_email(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    user_id = _create_admin_and_user(user_email=None)

    user_headers = _login(client, "reset-target")
    forbidden = client.post(f"/api/v2/users/{user_id}/send-password-reset", headers=user_headers)
    assert forbidden.status_code == 403

    admin_headers = _login(client, "reset-admin")
    no_email = client.post(f"/api/v2/users/{user_id}/send-password-reset", headers=admin_headers)
    assert no_email.status_code == 400
    assert "email" in no_email.json()["detail"]

    anonymous = client.post(f"/api/v2/users/{user_id}/send-password-reset")
    assert anonymous.status_code == 401


def test_email_failure_rolls_back_reset_token(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    user_id = _create_admin_and_user()

    from app.email_delivery import EmailDeliveryError

    def failing_send(**_kwargs) -> None:
        raise EmailDeliveryError("outbound email is not configured")

    monkeypatch.setattr("app.router_v2_auth_users.send_password_reset", failing_send)

    admin_headers = _login(client, "reset-admin")
    response = client.post(f"/api/v2/users/{user_id}/send-password-reset", headers=admin_headers)
    assert response.status_code == 503

    from app.db import get_connection

    with get_connection() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = ?", (user_id,)
        ).fetchone()["c"]
    assert count == 0


def test_validate_rejects_expired_and_unknown_tokens(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)
    user_id = _create_admin_and_user()

    unknown = client.get("/api/v2/auth/password-reset/validate", params={"token": "not-a-real-token-at-all"})
    assert unknown.status_code == 200
    assert unknown.json()["valid"] is False

    from app.password_resets import create_password_reset
    from app.db import get_connection

    _info, token = create_password_reset(user_id=user_id, actor_user_id=None)
    with get_connection() as conn:
        conn.execute(
            "UPDATE password_reset_tokens SET expires_at = '2000-01-01T00:00:00+00:00' WHERE user_id = ?",
            (user_id,),
        )
        conn.commit()

    expired = client.get("/api/v2/auth/password-reset/validate", params={"token": token})
    assert expired.status_code == 200
    assert expired.json()["valid"] is False
    assert "expired" in expired.json()["reason"]

    completed = client.post(
        "/api/v2/auth/password-reset/complete",
        json={"token": token, "new_password": "BrandNewSecret123!"},
    )
    assert completed.status_code == 400


def test_new_reset_link_invalidates_previous_link(monkeypatch, tmp_path: Path):
    _client(monkeypatch, tmp_path)
    user_id = _create_admin_and_user()

    from app.password_resets import create_password_reset, validate_password_reset

    _first_info, first_token = create_password_reset(user_id=user_id, actor_user_id=None)
    _second_info, second_token = create_password_reset(user_id=user_id, actor_user_id=None)

    assert validate_password_reset(first_token)["valid"] is False
    assert validate_password_reset(second_token)["valid"] is True
