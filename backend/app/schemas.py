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
    pass


class SubscriptionUpdate(BaseModel):
    name: str | None = None
    cost: Decimal | None = None
    billing_cycle: BillingCycle | None = None
    next_renewal_date: date | None = None
    category: str | None = None
    active: bool | None = None


class Subscription(SubscriptionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
