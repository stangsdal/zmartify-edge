"""add site membership invitations

Revision ID: 20260808_0007
Revises: 20260807_0006
Create Date: 2026-08-08 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260808_0007"
down_revision = "20260807_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_invitations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("token_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("invited_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('owner', 'user', 'viewer')", name="ck_site_invitations_role"),
    )
    op.create_table(
        "site_invitation_product_access",
        sa.Column("invitation_id", sa.BigInteger(), sa.ForeignKey("site_invitations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_type", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("invitation_id", "product_type"),
        sa.CheckConstraint("product_type IN ('hvac', 'irrigation', 'weather', 'energy')", name="ck_site_invitation_product_type"),
    )
    op.create_index("idx_site_invitations_email", "site_invitations", ["email", "expires_at"])
    op.create_index("idx_site_invitations_site", "site_invitations", ["site_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("idx_site_invitations_site", table_name="site_invitations")
    op.drop_index("idx_site_invitations_email", table_name="site_invitations")
    op.drop_table("site_invitation_product_access")
    op.drop_table("site_invitations")