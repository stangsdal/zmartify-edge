"""create core v2 domain tables

Revision ID: 20260712_0002
Revises: 20260712_0001
Create Date: 2026-07-12 00:20:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260712_0002"
down_revision = "20260712_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "core_domains_v2",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("slug", sa.String(length=120), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "core_sites_v2",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("domain_id", sa.Integer(), sa.ForeignKey("core_domains_v2.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_sites_v2_domain_slug", "core_sites_v2", ["domain_id", "slug"], unique=True)

    op.create_table(
        "core_devices_v2",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("device_ref", sa.String(length=120), nullable=False, unique=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("site_id", sa.Integer(), sa.ForeignKey("core_sites_v2.id", ondelete="SET NULL"), nullable=True),
        sa.Column("product_type", sa.String(length=80), nullable=False),
        sa.Column("product_model", sa.String(length=120), nullable=True),
        sa.Column("firmware_version", sa.String(length=120), nullable=True),
        sa.Column("integration_mode", sa.String(length=80), nullable=False),
        sa.Column("identity_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("core_devices_v2")
    op.drop_index("ix_core_sites_v2_domain_slug", table_name="core_sites_v2")
    op.drop_table("core_sites_v2")
    op.drop_table("core_domains_v2")
