"""baseline transition revision scaffold

Revision ID: 20260712_0001
Revises:
Create Date: 2026-07-12 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260712_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Baseline only: existing schema is still managed by sqlite migration SQL files.
    # Follow-up revisions will introduce SQLAlchemy-managed tables incrementally.
    pass


def downgrade() -> None:
    pass
