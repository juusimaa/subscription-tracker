import enum

from sqlalchemy import Boolean, Column, Date, Enum, Integer, Numeric, String

from app.database import Base


class BillingCycle(str, enum.Enum):
    monthly = "monthly"
    yearly = "yearly"


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    cost = Column(Numeric(10, 2), nullable=False)
    billing_cycle = Column(Enum(BillingCycle), nullable=False, default=BillingCycle.monthly)
    next_renewal_date = Column(Date, nullable=False)
    category = Column(String, nullable=True)
    active = Column(Boolean, nullable=False, default=True)
