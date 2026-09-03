# SQLAlchemy ORM models -- these map directly to Postgres tables.
# Alembic owns the schema (backend/alembic/), and test_migrations.py asserts
# the revisions and these classes describe the same tables, so this file stays
# the single source of truth for what the schema *means*.

import enum
from datetime import date, timedelta

from sqlalchemy import (
    Column,
    Date,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)

from app import renewals
from app.database import Base


class BillingCycle(str, enum.Enum):
    """Inheriting from str as well as Enum lets FastAPI/Pydantic serialize
    this straight to a JSON string (e.g. "monthly") instead of an int."""

    monthly = "monthly"
    yearly = "yearly"


class SubscriptionStatus(str, enum.Enum):
    """Where a subscription is in its life, replacing the `active` boolean.

    A boolean could only say "running" or "not running", which collapsed three
    genuinely different situations into one. All three exist, none of them
    bills, and they are not interchangeable:

    - `trial` is running and costs nothing yet. It converts on one date and
      converts once, which is why its renewal date is never rolled forward.
    - `paused` has stopped billing but is expected back, so what it cost
      before the pause is still real history.
    - `cancelled` has stopped for good, and the term already paid for may
      still be running (see main._last_charged_month).

    Inheriting from str as well as Enum, for the same reason BillingCycle
    does: it serializes straight to a JSON string.
    """

    active = "active"
    trial = "trial"
    paused = "paused"
    # "cancelled", not the design's internal "archived": this API has said
    # cancelled since it had a cancelled_date column, and the design's own UI
    # label is "Cancelled" too.
    cancelled = "cancelled"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    # unique=True makes Postgres itself reject a duplicate signup, even if two
    # registrations race past the application's own "is this taken?" check.
    email = Column(String, unique=True, nullable=False, index=True)
    # Only ever the bcrypt hash -- the plaintext password is never stored,
    # logged, or returned by the API (see schemas.User, which omits it).
    hashed_password = Column(String, nullable=False)
    # Bumped by crud.update_password and embedded in every token issued from
    # then on (auth.create_access_token's "tv" claim). A JWT cannot be revoked
    # individually, but get_current_user rejects one whose "tv" no longer
    # matches this column, so moving the counter invalidates every token
    # issued before the change at once -- which is what makes "changing your
    # password signs out other devices" (see the Account dialog copy) true
    # rather than aspirational.
    token_version = Column(Integer, nullable=False, default=0, server_default="0")


class SubscriptionGroup(Base):
    """Links several `Subscription` rows that are really the same service
    taken out more than once -- Netflix cancelled and later restored, say.

    Deliberately just an id and an owner, with no name of its own: the
    newest run's name is the current name, which is the right answer when a
    service is renamed between runs (see TODO.md item 8). A subscription
    points at this table rather than at another subscription row, so
    deleting any one run leaves the rest of the group intact.
    """

    __tablename__ = "subscription_groups"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)


class Category(Base):
    """A user's own list of categories, so they can be managed (added,
    renamed, deleted) as things in their own right rather than only existing
    as a side effect of typing a name into a subscription.

    Subscription.category deliberately stays a plain string rather than a
    foreign key here: that keeps the subscription API unchanged for clients
    that just send a name, and means a subscription is never blocked by a
    missing category row. crud.ensure_category keeps the two in step by
    registering any name a subscription introduces.
    """

    __tablename__ = "categories"
    # Two categories called "Music" belonging to *different* users are fine;
    # the same user having two is not. The database enforces that rather than
    # trusting every code path to remember to check.
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_categories_user_name"),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # Numeric (not Float) avoids floating-point rounding errors on money values.
    cost = Column(Numeric(10, 2), nullable=False)
    billing_cycle = Column(Enum(BillingCycle), nullable=False, default=BillingCycle.monthly)
    # The renewal date the client last told us about -- an *anchor*, not a
    # deadline. Every future renewal is derived from it by the property below
    # rather than being written back here, so nothing has to keep it current:
    # a row created in 2020 and never touched since still reports the right
    # next renewal today.
    #
    # The attribute is named for what it is; the column keeps its original
    # name so the change needs no ALTER TABLE (see the note on migrations in
    # main.py).
    renewal_anchor_date = Column("next_renewal_date", Date, nullable=False)
    # When the subscription began costing money. NULL means "unknown" -- only
    # possible for rows that predate this column -- and the spend summary
    # treats those as having always been running, which is how it behaved
    # before the column existed.
    started_date = Column(Date, nullable=True)
    category = Column(String, nullable=True)
    # The single source of truth for whether this subscription bills. It
    # replaced an `active` boolean in revision 0002; `active` survives as a
    # derived property below, because it is what every existing client and
    # every backup file written so far speaks.
    status = Column(
        Enum(SubscriptionStatus), nullable=False, default=SubscriptionStatus.active
    )
    # When this subscription stopped costing money for good. NULL while it is
    # running, and NULL too for a row cancelled before this column existed --
    # the spend summary treats that unknown case as "not charged in any
    # period" rather than inventing a date.
    cancelled_date = Column(Date, nullable=True)
    # The same thing for a pause, and it exists for the same reason. Without a
    # date, a subscription paused today would report having never cost
    # anything, retroactively erasing every month it really did bill -- the
    # bug _last_charged_month was written to prevent for cancellations.
    paused_date = Column(Date, nullable=True)
    # When this row was archived -- visibility only, never arithmetic. Only
    # ever set while status is cancelled (schemas.check_archived enforces it
    # on every write), and crud.update_subscription clears it as a side
    # effect of a status change that moves the row off cancelled, so
    # "archived but not cancelled" can never be a stored state reached
    # through a normal edit.
    archived_date = Column(Date, nullable=True)
    # Which SubscriptionGroup this run belongs to, if any. NULL means a group
    # of one -- every row that predates grouping, and every row that has
    # never been restored -- so this needed no backfill when it was added.
    # Named explicitly (unlike the other foreign keys here) because SQLite's
    # batch-mode ALTER, used to add this column in migration 0003, requires a
    # named constraint to rebuild the table; the migration names it the same
    # way so the two describe one schema, not two.
    group_id = Column(
        Integer,
        ForeignKey("subscription_groups.id", name="fk_subscriptions_group_id_subscription_groups"),
        nullable=True,
        index=True,
    )
    # The owner of this row. nullable=False so a subscription can never end up
    # orphaned and visible to everyone; indexed because every single query in
    # crud.py filters on it.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    @property
    def cycle_months(self) -> int:
        """How many months one billing period covers."""
        return 12 if self.billing_cycle == BillingCycle.yearly else 1

    @property
    def active(self) -> bool:
        """Whether this subscription is billing normally.

        Kept as a read/write alias over `status` rather than dropped: it is
        what every client written against this API sends and reads, and what
        sits in every backup file taken so far. The mapping preserves the
        *meaning* the flag always had -- "counts toward the totals and will be
        billed again" -- which trial and paused both fail, so both report
        false. See schemas.SubscriptionUpdate for the write direction.
        """
        return self.status == SubscriptionStatus.active

    @property
    def stopped_date(self) -> date | None:
        """The day this subscription stopped costing money, or None if it has
        not stopped.

        Cancelled and paused are different states with the same arithmetic:
        both bill up to a date and not after it. Naming that idea once is what
        lets the spend summary and next_renewal_date treat them together
        without either having to know which one it is looking at.

        None for a row that stopped before its date column existed, which is
        deliberately indistinguishable from "still running" here -- the
        callers decide what to do with an unknown, and they do different
        things (see main._is_charged).
        """
        if self.status == SubscriptionStatus.cancelled:
            return self.cancelled_date
        if self.status == SubscriptionStatus.paused:
            return self.paused_date
        return None

    @property
    def next_renewal_date(self) -> date:
        """When money next changes hands -- computed, never stored.

        This is the field the API returns and the frontend displays. Deriving
        it is what stops a renewal date from going stale: there is no rolled
        value to keep in step, no scheduled job, and no GET that quietly
        writes to the database.

        A stopped subscription -- cancelled or paused -- is measured from the
        day it stopped instead of from today, so it reports the renewal that
        would have come next: the day the term already paid for runs out,
        which is exactly what the spend summary needs (see
        _last_charged_month in main.py). Rolling it past that point would be
        inventing renewals that never happen. For a paused plan that same date
        is also the honest answer to "when would this resume charging".

        A trial is the exception that does not roll at all. It converts once,
        on one date, and the anchor *is* that date -- so rolling a conversion
        that has come and gone into next month would report a second
        conversion that is never going to happen. It stays put until something
        moves the subscription off `trial`, which is the event the date was
        always describing.
        """
        if self.status == SubscriptionStatus.trial:
            return self.renewal_anchor_date
        stopped = self.stopped_date
        # The day *after* it stopped, not the day itself. A charge taken on
        # the stopping day still happened -- _charge_dates counts it -- and
        # every plan here bills upfront, so that charge bought one more whole
        # period. Measuring from the stopping day would return that day back
        # and report the term as running out on the morning it was paid for.
        reference = stopped + timedelta(days=1) if stopped is not None else date.today()
        return renewals.next_occurrence(self.renewal_anchor_date, self.cycle_months, reference)
