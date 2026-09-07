"""add quarterly billing cycle

Issue #21: a subscription can now bill every three months, not just monthly
or yearly. models.BillingCycle gained a "quarterly" member; this teaches
Postgres's native `billingcycle` type the same value. SQLite has no
standalone enum type -- billing_cycle renders there as a plain VARCHAR (see
0001's note) -- so it needs nothing done to accept a new string.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        # Postgres 12+ allows ADD VALUE inside a transaction as long as the
        # new value is not used by the same transaction -- this migration
        # only adds it, so the single implicit transaction Alembic runs it in
        # is fine.
        op.execute("ALTER TYPE billingcycle ADD VALUE IF NOT EXISTS 'quarterly'")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # Postgres has no ALTER TYPE ... DROP VALUE. Undoing this means rebuilding
    # the type from scratch: rename the old one out of the way, create a new
    # one without 'quarterly', and cast the column across via USING. That cast
    # is what actually enforces the downgrade -- it fails outright if any row
    # is still 'quarterly', which is the right outcome. Unlike 0002's
    # status-to-boolean downgrade, there is no old-schema value to fall back
    # to for a quarterly plan; monthly and yearly are both wrong answers.
    op.execute("ALTER TYPE billingcycle RENAME TO billingcycle_old")
    billing_cycle = sa.Enum("monthly", "yearly", name="billingcycle")
    billing_cycle.create(bind)
    op.execute(
        "ALTER TABLE subscriptions "
        "ALTER COLUMN billing_cycle TYPE billingcycle "
        "USING billing_cycle::text::billingcycle"
    )
    op.execute("DROP TYPE billingcycle_old")
