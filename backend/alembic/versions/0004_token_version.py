"""add token_version to users

A password change needs a way to invalidate every token issued before it,
without keeping a revocation list. This column is that mechanism: bumped by
crud.update_password, embedded in every token as the "tv" claim, and checked
by auth.get_current_user on every request. server_default '0' backfills every
existing row to the version already implied by every token in the wild (none
of them carry a "tv" claim yet), so nothing already logged in is signed out by
this migration itself -- only a password change from here on does that.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("token_version")
