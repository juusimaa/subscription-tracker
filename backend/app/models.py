# SQLAlchemy ORM models -- these map directly to Postgres tables.
# Base.metadata.create_all() in main.py reads these classes and issues the
# CREATE TABLE statements, so this file is the single source of truth for
# the database schema.

import enum

from sqlalchemy import Boolean, Column, Date, Enum, Integer, Numeric, String

from app.database import Base


class BillingCycle(str, enum.Enum):
    """Inheriting from str as well as Enum lets FastAPI/Pydantic serialize
    this straight to a JSON string (e.g. "monthly") instead of an int."""

    monthly = "monthly"
    yearly = "yearly"


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # Numeric (not Float) avoids floating-point rounding errors on money values.
    cost = Column(Numeric(10, 2), nullable=False)
    billing_cycle = Column(Enum(BillingCycle), nullable=False, default=BillingCycle.monthly)
    next_renewal_date = Column(Date, nullable=False)
    category = Column(String, nullable=True)
    active = Column(Boolean, nullable=False, default=True)
