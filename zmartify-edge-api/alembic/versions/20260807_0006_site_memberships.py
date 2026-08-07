"""add site scoped memberships and device product types

Revision ID: 20260807_0006
Revises: 20260804_0005
Create Date: 2026-08-07 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260807_0006"
down_revision = "20260804_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("product_type", sa.String(length=64), nullable=False, server_default="unknown"))
    op.execute(
        """
        UPDATE devices
        SET product_type = CASE device_type
            WHEN 'hvac_gateway' THEN 'hvac'
            WHEN 'hvac_controller' THEN 'hvac'
            WHEN 'irrigation_controller' THEN 'irrigation'
            WHEN 'weather_station' THEN 'weather'
            WHEN 'energy_meter' THEN 'energy'
            ELSE 'unknown'
        END
        """
    )
    op.create_index("idx_devices_product_type", "devices", ["product_type"])
    op.create_table(
        "site_memberships",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("invited_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "site_id", name="uq_site_memberships_user_site"),
        sa.CheckConstraint("role IN ('owner', 'user', 'viewer')", name="ck_site_memberships_role"),
        sa.CheckConstraint("status IN ('invited', 'active', 'disabled')", name="ck_site_memberships_status"),
    )
    op.create_index("idx_site_memberships_user", "site_memberships", ["user_id", "status"])
    op.create_index("idx_site_memberships_site", "site_memberships", ["site_id", "status"])
    op.create_table(
        "site_membership_product_access",
        sa.Column("membership_id", sa.BigInteger(), sa.ForeignKey("site_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_type", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("membership_id", "product_type"),
        sa.CheckConstraint("product_type IN ('hvac', 'irrigation', 'weather', 'energy')", name="ck_membership_product_type"),
    )
    op.execute("INSERT INTO roles(name) VALUES ('administrator') ON CONFLICT (name) DO NOTHING")


def downgrade() -> None:
    op.drop_table("site_membership_product_access")
    op.drop_index("idx_site_memberships_site", table_name="site_memberships")
    op.drop_index("idx_site_memberships_user", table_name="site_memberships")
    op.drop_table("site_memberships")
    op.drop_index("idx_devices_product_type", table_name="devices")
    op.drop_column("devices", "product_type")