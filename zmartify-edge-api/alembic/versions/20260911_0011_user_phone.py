"""add user phone

Revision ID: 20260911_0011
Revises: 20260911_0010
Create Date: 2026-09-11 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260911_0011"
down_revision = "20260911_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "phone")