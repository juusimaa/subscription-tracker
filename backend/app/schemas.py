# Pydantic schemas -- these define the shape of data going in and out of the
# API (request bodies and JSON responses). They're deliberately separate from
# the SQLAlchemy models in models.py: models.py describes the database table,
# these describe the API contract. Keeping them apart means, e.g., the client
# is never allowed to set `id` on create, even though the DB model has one.

from datetime import date, datetime
from decimal import Decimal

from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, model_validator

from app.models import BillingCycle


def _check_dates(started: date | None, cancelled: date | None) -> None:
    """A subscription cancelled before it started would silently total up to
    zero in every month, which reads as a bug rather than as the typo it
    usually is -- so it is rejected as a 422 instead."""
    if started is not None and cancelled is not None and cancelled < started:
        raise ValueError("cancelled_date cannot be earlier than started_date")


class SubscriptionBase(BaseModel):
    # from_attributes=True lets this be built directly from a SQLAlchemy row
    # (Subscription.model_validate(db_row)), which is what the export route
    # does; the subclasses below inherit it.
    model_config = ConfigDict(from_attributes=True)

    name: str
    cost: Decimal
    billing_cycle: BillingCycle = BillingCycle.monthly
    next_renewal_date: date
    # Left off, this defaults to today on create (see crud.create_subscription).
    # Set it explicitly when adding a subscription you have had for a while,
    # otherwise the spend summary shows nothing for the months before today.
    started_date: date | None = None
    category: str | None = None
    active: bool = True
    # Usually left off: flipping `active` to false sets this to today
    # automatically (see crud._sync_cancellation). Send it explicitly only to
    # record a cancellation that happened on some other date.
    cancelled_date: date | None = None

    @model_validator(mode="after")
    def _validate_dates(self):
        _check_dates(self.started_date, self.cancelled_date)
        return self


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
    started_date: date | None = None
    category: str | None = None
    active: bool | None = None
    cancelled_date: date | None = None

    @model_validator(mode="after")
    def _validate_dates(self):
        # Only catches a request that sets both dates at once; a partial update
        # cannot be checked against the stored row from here.
        _check_dates(self.started_date, self.cancelled_date)
        return self


class Subscription(SubscriptionBase):
    """What the API returns to the client. Includes the database-assigned id."""

    id: int


# --- Categories ---


class CategoryBase(BaseModel):
    """A category name. Whitespace is stripped and the result must be
    non-empty, so " " never becomes a category that is impossible to pick out
    of a list."""

    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
    ]


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(CategoryBase):
    """Renaming is the only edit a category has: everything else about it is
    derived from the subscriptions that use it."""

    pass


class Category(CategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # How many of this user's subscriptions currently use the category. Mostly
    # there so a client can warn before deleting one that is still in use.
    subscription_count: int = 0


# --- Auth ---


class UserCreate(BaseModel):
    """What the client sends on POST /register."""

    # EmailStr rejects malformed addresses before they ever reach the database
    # (validated by the email-validator package, pulled in via requirements).
    email: EmailStr
    # bcrypt hashes at most 72 bytes and raises on anything longer, so the
    # upper bound is enforced here as a clean 422 rather than a 500 later.
    password: str = Field(min_length=8, max_length=72)


class User(BaseModel):
    """What the API returns about a user. Note what is absent: the password
    hash is never serialized, so it cannot leak through a response even by
    accident."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr


class Token(BaseModel):
    """The response from POST /token. `token_type` is always "bearer"; the
    field is part of the OAuth2 spec that FastAPI's docs page expects."""

    access_token: str
    token_type: str = "bearer"


# --- Backup (export / import) ---
#
# The backup file is deliberately made of the same SubscriptionBase fields the
# rest of the API speaks, minus anything account-specific: no `id`, no
# `user_id`, no email. That makes a file portable -- it can be restored into a
# fresh account, or into a different one, without carrying over ids that mean
# nothing there.


BACKUP_VERSION = 1


class BackupSubscription(SubscriptionBase):
    """One subscription as it appears in a backup file. Identical to what the
    API returns, except the database-assigned id is left out."""

    pass


class Backup(BaseModel):
    """The whole file: what GET /export produces and POST /import accepts.

    `version` is what makes this survivable. A future change to the fields can
    look at it and decide whether to migrate the file or refuse it, instead of
    guessing at the shape of whatever it was handed.
    """

    version: int = BACKUP_VERSION
    # Set on export, ignored on import -- it is there so a file found later on
    # disk says when it was taken.
    exported_at: datetime | None = None
    # Category names only. Included in their own right so that categories with
    # nothing in them yet survive a backup, which they wouldn't if the list
    # were reconstructed from the subscriptions.
    categories: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    ] = []
    subscriptions: list[BackupSubscription] = []


class ImportResult(BaseModel):
    """What POST /import reports back: enough to tell at a glance whether the
    file landed as expected, without having to re-fetch the whole list."""

    mode: str
    subscriptions_imported: int
    # Merge mode only: rows skipped because a subscription of that name was
    # already there. Always 0 after a replace, which starts from nothing.
    subscriptions_skipped: int
    categories_imported: int
