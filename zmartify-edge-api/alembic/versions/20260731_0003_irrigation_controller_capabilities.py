"""add irrigation controller zone capacity

Revision ID: 20260731_0003
Revises: 20260712_0002
Create Date: 2026-07-31 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260731_0003"
down_revision = "20260712_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("irrigation_runtime_state", sa.Column("max_zones", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("irrigation_runtime_state", "max_zones")