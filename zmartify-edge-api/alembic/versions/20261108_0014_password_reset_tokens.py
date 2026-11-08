"""add password reset tokens

Revision ID: 20261108_0014
Revises: 20260926_0013
Create Date: 2026-11-08 00:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261108_0014"
down_revision = "20260926_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("token_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_password_reset_tokens_user", "password_reset_tokens", ["user_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("idx_password_reset_tokens_user", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
