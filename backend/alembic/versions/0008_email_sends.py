"""add email_sends

Open signup (no invite code) lets anyone make the app mail an address. This
table is what the per-address and daily caps count (crud.claim_email_slot).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_sends",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("recipient", sa.String(length=64), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_sends_recipient", "email_sends", ["recipient"])
    op.create_index("ix_email_sends_sent_at", "email_sends", ["sent_at"])


def downgrade() -> None:
    op.drop_index("ix_email_sends_sent_at", table_name="email_sends")
    op.drop_index("ix_email_sends_recipient", table_name="email_sends")
    op.drop_table("email_sends")
