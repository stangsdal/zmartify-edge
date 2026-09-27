"""add site location

Revision ID: 20260926_0012
Revises: 20260911_0011
Create Date: 2026-09-26 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260926_0012"
down_revision = "20260911_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sites", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("sites", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("sites", "longitude")
    op.drop_column("sites", "latitude")