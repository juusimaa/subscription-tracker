"""subscription status replaces the active boolean

A subscription used to be either active or not, which collapsed three
different situations into one boolean. `status` replaces it (see
models.SubscriptionStatus), and `paused_date` joins `cancelled_date` so a
paused plan's history survives the pause.

This is the first revision that migrates *rows* rather than only schema, and
the backfill is the part worth reading. Going up, `active` is a lossless
narrowing: every existing row is either active or cancelled, which are two of
the four new values. Coming back down is not lossless, and cannot be -- see
downgrade().

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Created and dropped by hand, exactly as billingcycle is in 0001: on Postgres
# add_column emits no CREATE TYPE, and drop_column emits no DROP TYPE, so a
# downgrade would otherwise leave the type behind and the next upgrade would
# fail with "type subscriptionstatus already exists". 0001's own note explains
# why the second upgrade in test_downgrade_removes_everything_it_created is
# what catches that.
subscription_status = sa.Enum(
    "active", "trial", "paused", "cancelled", name="subscriptionstatus"
)


def upgrade() -> None:
    bind = op.get_bind()
    # No-op on SQLite, which has no standalone enum type and renders this as a
    # VARCHAR with a check constraint instead.
    subscription_status.create(bind, checkfirst=True)

    # Added nullable, then backfilled, then made NOT NULL. Adding it NOT NULL
    # in one step needs a server_default to satisfy the existing rows, and
    # that default would then be schema the models do not describe -- drift
    # test_migrations.py is not configured to catch, since Alembic does not
    # compare server defaults by default.
    op.add_column("subscriptions", sa.Column("status", subscription_status, nullable=True))
    op.add_column("subscriptions", sa.Column("paused_date", sa.Date(), nullable=True))

    # `NOT active` rather than `active = false` or `active = 0`: Postgres
    # stores the column as a real boolean and SQLite as 0/1, and NOT is the
    # one spelling both read the same way.
    op.execute("UPDATE subscriptions SET status = 'active'")
    op.execute("UPDATE subscriptions SET status = 'cancelled' WHERE NOT active")

    # Batch mode because SQLite cannot ALTER a column or DROP one on older
    # versions; it rebuilds the table and copies the rows. On Postgres it is a
    # thin wrapper over the plain ALTERs.
    with op.batch_alter_table("subscriptions") as batch:
        batch.alter_column("status", existing_type=subscription_status, nullable=False)
        batch.drop_column("active")


def downgrade() -> None:
    op.add_column("subscriptions", sa.Column("active", sa.Boolean(), nullable=True))

    # Deliberately lossy, and there is no version of this that is not: three
    # of the four statuses have to land on `active = false`, because that is
    # the only value the old schema has for "not billing".
    #
    # What that leaves behind is a shape the old code already understands
    # rather than a broken one. A trial or paused row becomes inactive with a
    # NULL cancelled_date -- exactly the "stopped, date unknown" case
    # _is_charged has always had a branch for, which counts it toward no
    # month rather than inventing spend. Cancelled rows keep their date and
    # are unchanged. The distinction between trial and paused is simply gone;
    # a downgrade is a retreat to a schema that cannot express it.
    op.execute("UPDATE subscriptions SET active = (status = 'active')")

    with op.batch_alter_table("subscriptions") as batch:
        batch.alter_column("active", existing_type=sa.Boolean(), nullable=False)
        batch.drop_column("paused_date")
        batch.drop_column("status")

    subscription_status.drop(op.get_bind(), checkfirst=True)
