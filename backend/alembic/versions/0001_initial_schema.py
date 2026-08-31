"""initial schema

The three tables as they stand today -- users, categories, subscriptions --
captured as the starting point every later migration builds on. Before this,
the schema was whatever `Base.metadata.create_all()` happened to produce at
startup, which creates missing *tables* and never alters existing ones: every
column added so far (user_id, then cancelled_date and started_date) needed a
`docker compose down -v` or a hand-written ALTER TABLE.

Note the `subscriptions.next_renewal_date` column. models.py calls the
attribute `renewal_anchor_date` -- it holds an anchor that renewals are
derived from, not a date that gets rolled forward -- but the column keeps its
original name, so that rename needed no migration. The column name is what
this file is about; see models.py for what it means.

Revision ID: 0001
Revises:
Create Date: 2026-08-31
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Created and dropped by hand below rather than left to create_table, which on
# Postgres emits CREATE TYPE as a side effect and never emits the matching
# DROP TYPE -- so a downgrade would leave the type behind and the next upgrade
# would fail with "type billingcycle already exists".
billing_cycle = sa.Enum("monthly", "yearly", name="billingcycle")


def upgrade() -> None:
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    # Each table is created only if it is absent, which makes this revision
    # safe to run against a database that predates Alembic: any local Compose
    # volume or deployed database whose tables were built by create_all()
    # already has them, and running `alembic upgrade head` there records the
    # revision without trying to create what is already there. (The equivalent
    # by hand is `alembic stamp 0001`; doing it here means nobody has to know
    # that.) On an empty database every branch is taken and this is an
    # ordinary initial migration.
    if "users" not in existing:
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("email", sa.String(), nullable=False),
            sa.Column("hashed_password", sa.String(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_users_id", "users", ["id"], unique=False)
        # Unique at the database level, not just checked by the app: two
        # registrations racing past crud's "is this taken?" check are stopped
        # here.
        op.create_index("ix_users_email", "users", ["email"], unique=True)

    if "categories" not in existing:
        op.create_table(
            "categories",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            # Two users may both have a "Music"; one user may not have two.
            sa.UniqueConstraint("user_id", "name", name="uq_categories_user_name"),
        )
        op.create_index("ix_categories_id", "categories", ["id"], unique=False)
        op.create_index("ix_categories_user_id", "categories", ["user_id"], unique=False)

    if "subscriptions" not in existing:
        op.create_table(
            "subscriptions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            # Numeric, not Float: money must not round.
            sa.Column("cost", sa.Numeric(precision=10, scale=2), nullable=False),
            sa.Column("billing_cycle", billing_cycle, nullable=False),
            sa.Column("next_renewal_date", sa.Date(), nullable=False),
            sa.Column("started_date", sa.Date(), nullable=True),
            sa.Column("category", sa.String(), nullable=True),
            sa.Column("active", sa.Boolean(), nullable=False),
            sa.Column("cancelled_date", sa.Date(), nullable=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_subscriptions_id", "subscriptions", ["id"], unique=False)
        # Every query in crud.py filters on user_id.
        op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
    op.drop_index("ix_subscriptions_id", table_name="subscriptions")
    op.drop_table("subscriptions")

    op.drop_index("ix_categories_user_id", table_name="categories")
    op.drop_index("ix_categories_id", table_name="categories")
    op.drop_table("categories")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_id", table_name="users")
    op.drop_table("users")

    # No-op on SQLite, which has no standalone enum type; see the note above.
    billing_cycle.drop(op.get_bind(), checkfirst=True)
