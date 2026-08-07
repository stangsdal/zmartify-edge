"""add outbound device bootstrap claims

Revision ID: 20260804_0005
Revises: 20260801_0004
Create Date: 2026-08-04 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260804_0005"
down_revision = "20260801_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "device_bootstrap_claims",
        sa.Column("device_id", sa.Text(), primary_key=True),
        sa.Column("claim_token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["device_id"], ["devices.device_id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("device_bootstrap_claims")