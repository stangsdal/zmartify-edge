"""add encrypted system email settings

Revision ID: 20260808_0008
Revises: 20260808_0007
Create Date: 2026-08-08 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260808_0008"
down_revision = "20260808_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_email_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=320), nullable=False),
        sa.Column("sender", sa.String(length=320), nullable=False),
        sa.Column("password_encrypted", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_system_email_settings_singleton"),
    )


def downgrade() -> None:
    op.drop_table("system_email_settings")