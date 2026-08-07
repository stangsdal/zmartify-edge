from __future__ import annotations

import uuid
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    db_path = tmp_path / "access-context.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")

    from app.db import initialize_database

    initialize_database()
    from main import app

    return TestClient(app)


def test_access_context_resolves_site_role_and_product_allow_list(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    from app.auth import hash_password
    from app.db import get_connection

    with get_connection() as conn:
        domain_id = conn.execute("INSERT INTO domains(uuid, slug, name) VALUES (?, ?, ?)", (str(uuid.uuid4()), "context-domain", "Context Domain")).lastrowid
        site_id = conn.execute("INSERT INTO sites(uuid, domain_id, slug, name) VALUES (?, ?, ?, ?)", (str(uuid.uuid4()), domain_id, "context-site", "Context Site")).lastrowid
        user_id = conn.execute(
            "INSERT INTO users(uuid, username, display_name, password_hash, enabled) VALUES (?, ?, ?, ?, 1)",
            (str(uuid.uuid4()), "anne", "Anne", hash_password("VeryStrongPass123!")),
        ).lastrowid
        membership_id = conn.execute(
            "INSERT INTO site_memberships(uuid, user_id, site_id, role) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), user_id, site_id, "user"),
        ).lastrowid
        conn.execute(
            "INSERT INTO site_membership_product_access(membership_id, product_type) VALUES (?, ?)",
            (membership_id, "hvac"),
        )
        for device_id, product_type in (("hvac-context", "hvac"), ("irrigation-context", "irrigation")):
            conn.execute(
                "INSERT INTO devices(uuid, device_id, display_name, product_type) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), device_id, device_id, product_type),
            )
            conn.execute("UPDATE devices SET site_id = ? WHERE device_id = ?", (site_id, device_id))
        conn.commit()

    login = client.post("/auth/login", json={"username": "anne", "password": "VeryStrongPass123!"})
    assert login.status_code == 200
    context = client.get("/api/v2/me/context", headers={"Authorization": f"Bearer {login.json()['access_token']}"})

    assert context.status_code == 200
    body = context.json()
    assert body["is_administrator"] is False
    assert body["sites"] == [
        {
            "id": site_id,
            "uuid": body["sites"][0]["uuid"],
            "name": "Context Site",
            "role": "user",
            "products": [
                {"type": "hvac", "allowed": True, "permissions": {"read": True, "operate": True, "configure": False, "administer": False}},
                {"type": "irrigation", "allowed": False, "permissions": {"read": False, "operate": False, "configure": False, "administer": False}},
            ],
        }
    ]