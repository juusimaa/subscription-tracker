"""add email_verified_at to users

PLAN.md milestone 9: the first thing in this app that proves an address is
read by whoever registered it. Null means unverified. No backfill on purpose:
no account has proven its address yet, including every one that exists
today, so every existing row correctly starts unverified.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email_verified_at")
