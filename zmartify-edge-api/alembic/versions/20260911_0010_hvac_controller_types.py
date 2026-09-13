"""distinguish HVAC controller families

Revision ID: 20260911_0010
Revises: 20260808_0009
Create Date: 2026-09-11 00:00:00
"""
from __future__ import annotations

from alembic import op


revision = "20260911_0010"
down_revision = "20260808_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE devices
        SET device_type = CASE
            WHEN LOWER(device_id) LIKE '%nilan%'
              OR LOWER(display_name) LIKE '%nilan%'
              OR LOWER(display_name) LIKE '%cts602%'
              OR LOWER(display_name) LIKE '%comfort 302%'
                THEN 'hvac_nilan'
                        ELSE 'hvac_ahc9000'
        END
        WHERE product_type = 'hvac' OR device_type = 'hvac_gateway'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE devices
        SET device_type = 'hvac_gateway'
        WHERE device_type IN ('hvac_ahc9000', 'hvac_nilan')
        """
    )