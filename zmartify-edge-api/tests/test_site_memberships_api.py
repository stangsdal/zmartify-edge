from __future__ import annotations

import uuid
from pathlib import Path

from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(tmp_path / "memberships.sqlite"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ZMART_EDGE_APPLY_MQTT_COMMANDS", "0")

    from app.db import initialize_database

    initialize_database()
    from main import app

    return TestClient(app)


def _login(client: TestClient, username: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"username": username, "password": "VeryStrongPass123!"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_site_owner_manages_members_and_cannot_remove_final_owner(monkeypatch, tmp_path: Path):
    client = _client(monkeypatch, tmp_path)

    from app.auth import hash_password
    from app.db import get_connection

    with get_connection() as conn:
        domain_id = conn.execute("INSERT INTO domains(uuid, slug, name) VALUES (?, ?, ?)", (str(uuid.uuid4()), "members-domain", "Members Domain")).lastrowid
        site_id = conn.execute("INSERT INTO sites(uuid, domain_id, slug, name) VALUES (?, ?, ?, ?)", (str(uuid.uuid4()), domain_id, "members-site", "Members Site")).lastrowid
        owner_id = conn.execute(
            "INSERT INTO users(uuid, username, display_name, password_hash, enabled) VALUES (?, ?, ?, ?, 1)",
            (str(uuid.uuid4()), "site-owner", "Site Owner", hash_password("VeryStrongPass123!")),
        ).lastrowid
        guest_id = conn.execute(
            "INSERT INTO users(uuid, username, display_name, password_hash, enabled) VALUES (?, ?, ?, ?, 1)",
            (str(uuid.uuid4()), "site-guest", "Site Guest", hash_password("VeryStrongPass123!")),
        ).lastrowid
        viewer_id = conn.execute(
            "INSERT INTO users(uuid, username, display_name, password_hash, enabled) VALUES (?, ?, ?, ?, 1)",
            (str(uuid.uuid4()), "site-viewer", "Site Viewer", hash_password("VeryStrongPass123!")),
        ).lastrowid
        owner_membership_id = conn.execute(
            "INSERT INTO site_memberships(uuid, user_id, site_id, role) VALUES (?, ?, ?, 'owner')",
            (str(uuid.uuid4()), owner_id, site_id),
        ).lastrowid
        conn.execute(
            "INSERT INTO site_memberships(uuid, user_id, site_id, role) VALUES (?, ?, ?, 'viewer')",
            (str(uuid.uuid4()), viewer_id, site_id),
        )
        conn.commit()

    owner_headers = _login(client, "site-owner")
    candidates = client.get(f"/api/v2/sites/{site_id}/member-candidates", headers=owner_headers)
    assert candidates.status_code == 200
    assert candidates.json() == [
        {"id": guest_id, "username": "site-guest", "display_name": "Site Guest", "email": None}
    ]

    created = client.post(
        f"/api/v2/sites/{site_id}/members",
        headers=owner_headers,
        json={"user_id": guest_id, "role": "user", "product_types": ["hvac"]},
    )
    assert created.status_code == 201
    member = created.json()
    assert member["role"] == "user"
    assert member["product_types"] == ["hvac"]

    updated = client.put(
        f"/api/v2/sites/{site_id}/members/{member['id']}",
        headers=owner_headers,
        json={"product_types": ["irrigation"]},
    )
    assert updated.status_code == 200
    assert updated.json()["product_types"] == ["irrigation"]

    viewer_headers = _login(client, "site-viewer")
    forbidden = client.get(f"/api/v2/sites/{site_id}/members", headers=viewer_headers)
    assert forbidden.status_code == 403

    final_owner = client.delete(f"/api/v2/sites/{site_id}/members/{owner_membership_id}", headers=owner_headers)
    assert final_owner.status_code == 400
    assert "at least one active owner" in final_owner.json()["detail"]