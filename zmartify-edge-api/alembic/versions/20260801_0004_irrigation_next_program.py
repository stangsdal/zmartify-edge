"""add next irrigation program runtime field

Revision ID: 20260801_0004
Revises: 20260731_0003
Create Date: 2026-08-01 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260801_0004"
down_revision = "20260731_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("irrigation_runtime_state", sa.Column("next_program_name", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("irrigation_runtime_state", "next_program_name")