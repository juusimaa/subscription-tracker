# Pydantic schemas -- these define the shape of data going in and out of the
# API (request bodies and JSON responses). They're deliberately separate from
# the SQLAlchemy models in models.py: models.py describes the database table,
# these describe the API contract. Keeping them apart means, e.g., the client
# is never allowed to set `id` on create, even though the DB model has one.

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models import BillingCycle


class SubscriptionBase(BaseModel):
    name: str
    cost: Decimal
    billing_cycle: BillingCycle = BillingCycle.monthly
    next_renewal_date: date
    category: str | None = None
    active: bool = True


class SubscriptionCreate(SubscriptionBase):
    """What the client sends on POST /subscriptions. Same fields as the base
    for now, but kept as its own class so create-only fields could be added
    later without touching the other schemas."""

    pass


class SubscriptionUpdate(BaseModel):
    """What the client sends on PUT /subscriptions/{id}. Every field is
    optional so a client can update just one field (e.g. only `active`)
    without having to resend the whole subscription."""

    name: str | None = None
    cost: Decimal | None = None
    billing_cycle: BillingCycle | None = None
    next_renewal_date: date | None = None
    category: str | None = None
    active: bool | None = None


class Subscription(SubscriptionBase):
    """What the API returns to the client. Includes the database-assigned id."""

    # from_attributes=True lets this schema be built directly from a
    # SQLAlchemy model instance (e.g. Subscription.model_validate(db_row)),
    # rather than requiring a plain dict.
    model_config = ConfigDict(from_attributes=True)

    id: int
