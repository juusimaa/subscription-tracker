"""add currencies and the exchange-rate cache

PLAN.md milestone 10. Every subscription carries the currency it is billed
in, and every user the currency totals are shown in (and new subscriptions
start in). Both default to EUR, which is what every existing row already
was -- the frontend hardcoded euros -- so the server default *is* the
backfill and nothing has to be guessed.

fx_rates caches European Central Bank reference rates, fetched on demand by
app/fx.py. One row per published day and currency, as units of that
currency per 1 EUR (the ECB's own base), so no row is needed for EUR itself.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "subscriptions",
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
    )
    op.add_column(
        "users",
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
    )
    op.create_table(
        "fx_rates",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("rate", sa.Numeric(14, 6), nullable=False),
        sa.PrimaryKeyConstraint("day", "currency"),
    )


def downgrade() -> None:
    op.drop_table("fx_rates")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("currency")
    with op.batch_alter_table("subscriptions") as batch:
        batch.drop_column("currency")
