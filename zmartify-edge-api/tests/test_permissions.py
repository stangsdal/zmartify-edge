from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.auth import AuthError, AuthenticatedUser
from app.db import get_connection, initialize_database
from app.permissions import accessible_site_ids, require_global_admin, require_site_permission


def _seed_membership(tmp_path: Path, monkeypatch, *, role: str, products: list[str]) -> tuple[AuthenticatedUser, int]:
    db_path = tmp_path / "permissions.sqlite"
    monkeypatch.setenv("ZMART_EDGE_DB_PATH", str(db_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    initialize_database()

    with get_connection() as conn:
        domain_id = conn.execute("INSERT INTO domains(uuid, slug, name) VALUES (?, ?, ?)", (str(uuid.uuid4()), "permission-domain", "Permission Domain")).lastrowid
        site_id = conn.execute("INSERT INTO sites(uuid, domain_id, slug, name) VALUES (?, ?, ?, ?)", (str(uuid.uuid4()), domain_id, "permission-site", "Permission Site")).lastrowid
        user_id = conn.execute(
            "INSERT INTO users(uuid, username, display_name, password_hash, enabled) VALUES (?, ?, ?, ?, 1)",
            (str(uuid.uuid4()), "member", "Member", "not-used"),
        ).lastrowid
        membership_id = conn.execute(
            "INSERT INTO site_memberships(uuid, user_id, site_id, role) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), user_id, site_id, role),
        ).lastrowid
        for product in products:
            conn.execute(
                "INSERT INTO site_membership_product_access(membership_id, product_type) VALUES (?, ?)",
                (membership_id, product),
            )
        conn.commit()

    return AuthenticatedUser(user_id=user_id, username="member", roles=set(), token_id=None), int(site_id)


def test_user_can_operate_explicitly_allowed_product(monkeypatch, tmp_path: Path):
    user, site_id = _seed_membership(tmp_path, monkeypatch, role="user", products=["hvac"])

    access = require_site_permission(user, site_id, product_type="hvac", permission="operate")

    assert access.role == "user"
    assert access.allowed_products == frozenset({"hvac"})


def test_product_allow_list_denies_other_product(monkeypatch, tmp_path: Path):
    user, site_id = _seed_membership(tmp_path, monkeypatch, role="user", products=["hvac"])

    with pytest.raises(AuthError, match="product access denied"):
        require_site_permission(user, site_id, product_type="irrigation", permission="read")


def test_viewer_cannot_operate(monkeypatch, tmp_path: Path):
    user, site_id = _seed_membership(tmp_path, monkeypatch, role="viewer", products=[])

    require_site_permission(user, site_id, product_type="hvac", permission="read")
    with pytest.raises(AuthError, match="site permission denied"):
        require_site_permission(user, site_id, product_type="hvac", permission="operate")


def test_global_administrator_bypasses_site_membership(monkeypatch, tmp_path: Path):
    _user, site_id = _seed_membership(tmp_path, monkeypatch, role="viewer", products=[])
    administrator = AuthenticatedUser(user_id=999, username="administrator", roles={"administrator"}, token_id=None)

    access = require_site_permission(administrator, site_id, product_type="irrigation", permission="administer")
    require_global_admin(administrator)

    assert access.is_administrator is True


def test_accessible_site_ids_uses_active_memberships(monkeypatch, tmp_path: Path):
    user, site_id = _seed_membership(tmp_path, monkeypatch, role="viewer", products=[])
    no_memberships = AuthenticatedUser(user_id=999, username="none", roles=set(), token_id=None)

    assert accessible_site_ids(user) == {site_id}
    assert accessible_site_ids(no_memberships) == set()