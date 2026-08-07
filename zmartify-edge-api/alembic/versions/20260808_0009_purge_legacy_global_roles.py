"""purge legacy global roles

Revision ID: 20260808_0009
Revises: 20260808_0008
Create Date: 2026-08-08 00:00:00
"""
from __future__ import annotations

from alembic import op


revision = "20260808_0009"
down_revision = "20260808_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM user_roles
        WHERE role_id IN (SELECT id FROM roles WHERE name <> 'administrator')
        """
    )
    op.execute("DELETE FROM roles WHERE name <> 'administrator'")


def downgrade() -> None:
    op.execute("INSERT INTO roles(name) VALUES ('owner') ON CONFLICT (name) DO NOTHING")
    op.execute("INSERT INTO roles(name) VALUES ('admin') ON CONFLICT (name) DO NOTHING")
    op.execute("INSERT INTO roles(name) VALUES ('installer') ON CONFLICT (name) DO NOTHING")
    op.execute("INSERT INTO roles(name) VALUES ('viewer') ON CONFLICT (name) DO NOTHING")