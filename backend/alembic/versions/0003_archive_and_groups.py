"""archive subscriptions and link runs into groups

Two independent additions (TODO.md items 7 and 8), sharing one migration
because neither moves a row:

- `archived_date`, nullable, same shape as `cancelled_date`/`paused_date` --
  visibility only, never read by any total.
- `subscription_groups` (id, user_id) plus a nullable `group_id` on
  `subscriptions`. NULL means "a group of one", so every existing row is
  already correct and this needs no backfill -- a row only ever gets a
  group_id when POST .../restore links it into one.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscription_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_subscription_groups_id", "subscription_groups", ["id"], unique=False
    )
    op.create_index(
        "ix_subscription_groups_user_id", "subscription_groups", ["user_id"], unique=False
    )

    op.add_column("subscriptions", sa.Column("archived_date", sa.Date(), nullable=True))
    # Batch mode: SQLite's ALTER TABLE cannot add a column that also adds a
    # foreign key constraint (Alembic raises NotImplementedError on it
    # directly, the same reason 0002 uses batch mode to drop a column). Batch
    # mode rebuilds the table instead, which SQLite can do in one go.
    with op.batch_alter_table("subscriptions") as batch:
        batch.add_column(
            sa.Column(
                "group_id",
                sa.Integer(),
                sa.ForeignKey(
                    "subscription_groups.id",
                    name="fk_subscriptions_group_id_subscription_groups",
                ),
                nullable=True,
            )
        )
    op.create_index("ix_subscriptions_group_id", "subscriptions", ["group_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_subscriptions_group_id", table_name="subscriptions")
    with op.batch_alter_table("subscriptions") as batch:
        batch.drop_column("group_id")
        batch.drop_column("archived_date")

    op.drop_index("ix_subscription_groups_user_id", table_name="subscription_groups")
    op.drop_index("ix_subscription_groups_id", table_name="subscription_groups")
    op.drop_table("subscription_groups")
