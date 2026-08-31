# SQLAlchemy ORM models -- these map directly to Postgres tables.
# Base.metadata.create_all() in main.py reads these classes and issues the
# CREATE TABLE statements, so this file is the single source of truth for
# the database schema.

import enum

from sqlalchemy import Boolean, Column, Date, Enum, ForeignKey, Integer, Numeric, String

from app.database import Base


class BillingCycle(str, enum.Enum):
    """Inheriting from str as well as Enum lets FastAPI/Pydantic serialize
    this straight to a JSON string (e.g. "monthly") instead of an int."""

    monthly = "monthly"
    yearly = "yearly"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    # unique=True makes Postgres itself reject a duplicate signup, even if two
    # registrations race past the application's own "is this taken?" check.
    email = Column(String, unique=True, nullable=False, index=True)
    # Only ever the bcrypt hash -- the plaintext password is never stored,
    # logged, or returned by the API (see schemas.User, which omits it).
    hashed_password = Column(String, nullable=False)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # Numeric (not Float) avoids floating-point rounding errors on money values.
    cost = Column(Numeric(10, 2), nullable=False)
    billing_cycle = Column(Enum(BillingCycle), nullable=False, default=BillingCycle.monthly)
    next_renewal_date = Column(Date, nullable=False)
    # When the subscription began costing money. NULL means "unknown" -- only
    # possible for rows that predate this column -- and the spend summary
    # treats those as having always been running, which is how it behaved
    # before the column existed.
    started_date = Column(Date, nullable=True)
    category = Column(String, nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    # When this subscription stopped costing money. NULL while it is running,
    # and NULL too for a row cancelled before this column existed -- the
    # spend summary treats that unknown case as "not charged in any period"
    # rather than inventing a date.
    cancelled_date = Column(Date, nullable=True)
    # The owner of this row. nullable=False so a subscription can never end up
    # orphaned and visible to everyone; indexed because every single query in
    # crud.py filters on it.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
