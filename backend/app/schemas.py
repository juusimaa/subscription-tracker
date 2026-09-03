# Pydantic schemas -- these define the shape of data going in and out of the
# API (request bodies and JSON responses). They're deliberately separate from
# the SQLAlchemy models in models.py: models.py describes the database table,
# these describe the API contract. Keeping them apart means, e.g., the client
# is never allowed to set `id` on create, even though the DB model has one.

import enum
from datetime import date, datetime
from decimal import Decimal

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    PlainSerializer,
    StringConstraints,
    model_validator,
)

from app.models import BillingCycle, SubscriptionStatus


def check_dates(
    started: date | None, cancelled: date | None, paused: date | None = None
) -> None:
    """A subscription stopped before it started would silently total up to
    zero in every month, which reads as a bug rather than as the typo it
    usually is -- so it is rejected as a 422 instead.

    Both stop dates are checked, and named individually in the message: a
    client that sent a bad paused_date is not helped by being told about
    cancelled_date. `paused` defaults to None so the two-argument calls that
    predate it still mean what they did.

    Public rather than private because crud.py calls it too: the schemas below
    can only check the fields one request happened to carry, so the merged row
    is checked again where it is actually assembled (see crud.py).
    """
    for field, stopped in (("cancelled_date", cancelled), ("paused_date", paused)):
        if started is not None and stopped is not None and stopped < started:
            raise ValueError(f"{field} cannot be earlier than started_date")


def check_archived(status: SubscriptionStatus, archived_date: date | None) -> None:
    """`archived` is a flag, not a status: an archived record keeps
    `status: cancelled` (TODO.md item 7). A row that is archived but not
    cancelled would mean something no UI action can produce and no reader
    can interpret, so it is rejected the same way a `status`/`active`
    contradiction is.

    Like check_dates, this only catches what one request can see whole.
    SubscriptionUpdate is a partial update and cannot know the stored status,
    so the merged-row re-check in crud.update_subscription is what actually
    enforces this for PUT.
    """
    if archived_date is not None and status != SubscriptionStatus.cancelled:
        raise ValueError("archived_date can only be set on a cancelled subscription")


def resolve_status(
    status: SubscriptionStatus | None, active: bool | None
) -> SubscriptionStatus | None:
    """Reconciles the `status` field with the legacy `active` boolean.

    `active` is the only way clients written before statuses existed can say
    "cancel this", and backup files taken by those builds carry it instead of
    a status, so it keeps working: on its own it means active or cancelled,
    exactly as it always did.

    Sending both is fine when they agree and a 422 when they do not. Picking a
    winner would mean guessing which half of a contradiction the client meant,
    and guessing wrong here silently cancels a subscription or silently
    revives one.

    Returns None when neither was sent, which a partial update reads as "leave
    the status alone" -- the reason this returns rather than defaulting.
    """
    if status is None:
        if active is None:
            return None
        return SubscriptionStatus.active if active else SubscriptionStatus.cancelled
    if active is not None and active != (status == SubscriptionStatus.active):
        raise ValueError(
            f"active={active} contradicts status={status.value}; send one or the other"
        )
    return status


# The two fields a client can get wrong in a way that neither the database nor
# the arithmetic can absorb. Declared once and reused by the create and update
# schemas below, so POST and PUT enforce the same limits -- a rule applied to
# only one of them is a rule a client can walk straight around by editing.
#
# The upper bound on cost is not arbitrary: models.Subscription stores it as
# Numeric(10, 2), so anything larger is rejected by Postgres itself. Catching
# it here turns what was a 500 (psycopg NumericValueOutOfRange, raised on
# commit, long after the request was accepted) into a plain 422. The lower
# bound matters just as much: a negative cost is subtracted from every total,
# so one typo can make a whole month's spend read as less than it is.
SubscriptionName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Cost = Annotated[Decimal, Field(gt=0, le=Decimal("99999999.99"))]


class SubscriptionBase(BaseModel):
    # from_attributes=True lets this be built directly from a SQLAlchemy row
    # (Subscription.model_validate(db_row)), which is what the export route
    # does; the subclasses below inherit it.
    model_config = ConfigDict(from_attributes=True)

    name: str
    cost: Decimal
    billing_cycle: BillingCycle = BillingCycle.monthly
    # Read and written through the same name, but not quite the same thing on
    # each side: what a client sends is the *anchor* the schedule is measured
    # from, and what comes back is the next renewal derived from it (see the
    # property on models.Subscription). Sending a date years in the past is
    # therefore fine and often right -- it says when the plan started billing,
    # and the response rolls it forward to the renewal that is actually next.
    next_renewal_date: date
    # Left off, this defaults to today on create (see crud.create_subscription).
    # Set it explicitly when adding a subscription you have had for a while,
    # otherwise the spend summary shows nothing for the months before today.
    started_date: date | None = None
    category: str | None = None
    # Where the subscription is in its life. This is the field to send; see
    # models.SubscriptionStatus for what each value means and what it costs.
    status: SubscriptionStatus = SubscriptionStatus.active
    # The legacy spelling of the same thing, always returned so that clients
    # predating statuses keep working. On the way in it is optional and
    # reconciled by resolve_status; on the way out it is computed from
    # `status` (models.Subscription.active), so the two can never disagree in
    # a response.
    active: bool = True
    # Usually left off: moving to `cancelled` sets this to today automatically
    # (see crud._sync_status_dates). Send it explicitly only to record a
    # cancellation that happened on some other date.
    cancelled_date: date | None = None
    # The same, for a pause. Set automatically when the status becomes
    # `paused`; what the spend summary reads to know which months a paused
    # subscription really did bill in.
    paused_date: date | None = None
    # Visibility only -- never read by any total. Normally set and cleared by
    # POST .../archive and .../unarchive; settable here too, the same way
    # cancelled_date is, so a restored backup can carry it. Only valid on a
    # cancelled row (see check_archived).
    archived_date: date | None = None


class SubscriptionCreate(SubscriptionBase):
    """What the client sends on POST /subscriptions.

    The same fields as the base, but constrained: the base doubles as the
    response shape (see the note on `Subscription`), so the rules a *request*
    has to satisfy live here rather than there.
    """

    name: SubscriptionName
    cost: Cost
    # Both optional here, unlike the base, so that "not sent" is distinguishable
    # from "sent as the default" -- without which a client sending only
    # active=false could not be told apart from one sending nothing, and the
    # legacy alias would be silently ignored.
    status: SubscriptionStatus | None = None
    active: bool | None = None

    @model_validator(mode="after")
    def _validate(self):
        # Resolved here rather than in crud so that a contradictory pair is a
        # 422 from the schema, alongside every other malformed-request check,
        # instead of a ValueError the route has to translate.
        self.status = resolve_status(self.status, self.active) or SubscriptionStatus.active
        # A create carries every field at once, so this sees the whole row.
        # It still is not the last word: crud.create_subscription fills in a
        # missing started_date afterwards and re-checks what it ends up with.
        check_dates(self.started_date, self.cancelled_date, self.paused_date)
        check_archived(self.status, self.archived_date)
        return self


class SubscriptionUpdate(BaseModel):
    """What the client sends on PUT /subscriptions/{id}. Every field is
    optional so a client can update just one field (e.g. only `active`)
    without having to resend the whole subscription."""

    name: SubscriptionName | None = None
    cost: Cost | None = None
    billing_cycle: BillingCycle | None = None
    next_renewal_date: date | None = None
    started_date: date | None = None
    category: str | None = None
    status: SubscriptionStatus | None = None
    # None means "not sent" for both of these, so a PUT touching neither
    # leaves the status alone. crud._columns translates a lone `active` into
    # the status it stands for.
    active: bool | None = None
    cancelled_date: date | None = None
    paused_date: date | None = None
    archived_date: date | None = None

    @model_validator(mode="after")
    def _validate(self):
        # Checked but deliberately not assigned: writing the resolved status
        # back would mark the field as set, and exclude_unset is what stops a
        # partial update from overwriting everything it did not mention.
        resolve_status(self.status, self.active)
        # check_archived is deliberately not called here -- a partial update
        # carrying only archived_date can't be checked against a status it
        # never mentioned. crud.update_subscription re-checks the merged row.
        # Only catches a request that sets both dates at once. A partial update
        # cannot be checked against the stored row from here, which is exactly
        # why crud.update_subscription checks the merged row as well -- sending
        # cancelled_date on its own used to slip past this and be committed.
        check_dates(self.started_date, self.cancelled_date, self.paused_date)
        return self


class Subscription(SubscriptionBase):
    """What the API returns to the client. Includes the database-assigned id.

    Deliberately inherits the *unconstrained* base. A response model that
    rejects data is a trap: a row that somehow violates a rule would fail
    validation on the way out, turning one bad row into a 500 for every route
    that lists or exports it -- the whole account unreadable over a single
    field. Requests are where bad data is stopped (SubscriptionCreate,
    SubscriptionUpdate, and the re-check in crud.py); what is already stored
    is always serialized as it is.
    """

    id: int
    # Which SubscriptionGroup this run belongs to, or None for a group of
    # one. Read-only and deliberately absent from SubscriptionBase: a client
    # never sets this directly, only POST .../restore does (see
    # crud.restore_subscription). Also absent from the backup format -- see
    # the note on BackupSubscription.
    group_id: int | None = None


class SubscriptionRestore(BaseModel):
    """What POST /subscriptions/{id}/restore accepts. Both fields default to
    today in crud.restore_subscription when omitted -- "starts today" is the
    common case, and TODO.md item 8 asks for it to stay editable rather than
    forcing a second call to move the date."""

    started_date: date | None = None
    next_renewal_date: date | None = None


# --- Spend summaries ---
#
# The two summary routes answer different questions and so have different
# shapes: /summary/spend is the historical/projected view of a period,
# /summary/monthly-total is what is being paid right now. Declaring both as
# schemas rather than returning bare dicts is what puts their fields on the
# /docs page, where an untyped route shows an empty response instead.


# A money amount that stays a Decimal in Python but goes out as a JSON number.
#
# The serializer is the whole point. Pydantic v2 renders a bare Decimal as a
# JSON *string* ("15.99"), whereas these two routes predate having a
# response_model at all and were encoded by FastAPI's jsonable_encoder, which
# produces a number (15.99). Declaring the schemas without this would quietly
# change what the routes return, so the exactness is kept where the arithmetic
# happens and only the last step down to JSON becomes a float.
Money = Annotated[Decimal, PlainSerializer(float, return_type=float)]


class SpendMonth(BaseModel):
    """One month's share of a period's cost. `month` is 1-12."""

    month: int = Field(ge=1, le=12)
    total: Money


class SpendSummary(BaseModel):
    """What GET /subscriptions/summary/spend returns.

    `total` is the sum of `months`, not a separately computed figure, so a
    client can chart the breakdown and show the total without the two
    disagreeing by a rounding cent.
    """

    year: int
    total: Money
    # One entry when a single month was asked for, twelve otherwise.
    months: list[SpendMonth]


class MonthlyTotal(BaseModel):
    """What GET /subscriptions/summary/monthly-total returns. `yearly_total`
    is the same money viewed over 12 months, not a second sum."""

    monthly_total: Money
    yearly_total: Money


# --- Upcoming renewals ---
#
# A different question again from either summary: not what a period costs on
# average, but what is about to be charged and when.


class UpcomingRenewal(BaseModel):
    """One charge that is about to happen. `cost` is the full amount that will
    be billed on the day, not the per-month share /summary/spend works in: the
    question here is what will leave the account, and a yearly plan takes its
    whole year's cost at once."""

    subscription: Subscription
    renewal_date: date
    # Days from today, so a client can say "in 3 days" without redoing the
    # date arithmetic (and without disagreeing with the server about what
    # today is, which is a real risk across timezones).
    days_until: int
    cost: Money


class UpcomingSummary(BaseModel):
    """What GET /subscriptions/upcoming returns.

    A monthly plan renews more than once in a long enough window, and each of
    those renewals is listed separately, so `renewals` can hold more entries
    than the account has subscriptions. `total` is the sum of their costs --
    the real money due in the window.
    """

    days: int
    # The last day covered, inclusive. Returned rather than left to the client
    # to work out, so what the window meant is never in doubt.
    through: date
    total: Money
    renewals: list[UpcomingRenewal]


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


class PasswordChange(BaseModel):
    """What the client sends on PUT /me/password. `current_password` is
    required even though the request already carries a valid Bearer token:
    the token alone proves the request has *a* session, not that whoever is
    holding it right now is the account owner -- the same reason a website
    re-asks for your password before changing it."""

    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


class AccountDelete(BaseModel):
    """What the client sends on DELETE /me. Deleting the account is
    irreversible, so it asks for the password again for the same reason
    PasswordChange does."""

    password: str


# --- Backup (export / import) ---
#
# The backup file is deliberately made of the same SubscriptionBase fields the
# rest of the API speaks, minus anything account-specific: no `id`, no
# `user_id`, no email. That makes a file portable -- it can be restored into a
# fresh account, or into a different one, without carrying over ids that mean
# nothing there.


# Bumped to 3 when subscriptions gained archived_date. Version 1 and 2 files
# are still read -- see SUPPORTED_BACKUP_VERSIONS -- so every backup taken
# before this change restores exactly as it did.
BACKUP_VERSION = 3

# What POST /import accepts. A version 1 file carries `active` and no
# `status`, which BackupSubscription resolves the same way it resolves a
# legacy request, so reading one needs no separate code path -- only the
# permission to try. This is the migration the `version` field was put there
# to make possible: refusing a file this build genuinely cannot read stays the
# behaviour for anything outside this set.
SUPPORTED_BACKUP_VERSIONS = frozenset({1, 2, 3})


class BackupSubscription(SubscriptionBase):
    """One subscription as it appears in a backup file. Identical to what the
    API returns, except the database-assigned id -- and group_id -- are left
    out.

    group_id is account-local (see the note above schemas.Backup on why a
    file carries no ids), and grouping several runs of one service is not
    yet solved for the file format (TODO.md item 8 flags it as needing a
    file-local ordinal or label, not an integer id). A restored backup
    therefore always comes back as groups of one; nothing about that is
    detected or reported, it is simply the information a file cannot carry
    yet.

    Both `status` and `active` are optional for the same reason they are on
    SubscriptionCreate: this schema reads version 1 files, which say `active`
    and have never heard of `status`. Export always writes both.
    """

    status: SubscriptionStatus | None = None
    active: bool | None = None

    @model_validator(mode="after")
    def _resolve_status(self):
        self.status = resolve_status(self.status, self.active) or SubscriptionStatus.active
        return self


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


class BackupFormat(str, enum.Enum):
    """What GET /export writes.

    JSON is the backup: it carries the version, the timestamp and the
    categories nothing is using yet, so a round trip through it reproduces the
    account exactly. CSV is the interchange format -- a spreadsheet can open
    it and a person can hand-edit it, which is most of why it exists -- and it
    is lossy in two known ways, both recorded in app/backup_csv.py.
    """

    json = "json"
    csv = "csv"


class ImportMode(str, enum.Enum):
    """How POST /import treats what is already in the account.

    Named rather than a boolean because the two are not degrees of the same
    thing: merge writes, replace deletes and then writes, and only one of them
    can lose data. A caller has to say which it meant.
    """

    merge = "merge"
    replace = "replace"


def resolve_import_mode(mode: ImportMode | None, replace: bool | None) -> ImportMode:
    """Reconciles ?mode= with the older ?replace= boolean.

    The same shape as resolve_status, and for the same reason: `replace` is
    what the route has accepted since importing existed, so it keeps working,
    while `mode` is the spelling the design asks for. Sending both is fine
    when they agree and a 422 when they do not -- picking a winner would mean
    guessing which half of a contradiction the caller meant, and guessing
    wrong here wipes an account.

    Merge is the default because it is the one that cannot delete anything.
    """
    from_replace = None if replace is None else (ImportMode.replace if replace else ImportMode.merge)
    if mode is None:
        return from_replace or ImportMode.merge
    if from_replace is not None and from_replace is not mode:
        raise ValueError(
            f"replace={replace} contradicts mode={mode.value}; send one or the other"
        )
    return mode


class ImportResult(BaseModel):
    """What POST /import reports back: enough to tell at a glance whether the
    file landed as expected, without having to re-fetch the whole list.

    The four subscription counters partition the file plus, in replace mode,
    what was there before -- so they add up to something a caller can check
    rather than being four loosely related numbers.
    """

    mode: str
    # Rows in the file that had no counterpart in the account and were added.
    subscriptions_imported: int
    # Merge mode only: rows whose name matched something already there and
    # whose fields differed, so the stored row was brought in line with the
    # file. Always 0 after a replace, which starts from an empty account.
    subscriptions_updated: int
    # Merge mode only: matched and already identical, so nothing was written.
    # This is what makes importing the same file twice a visible no-op rather
    # than an invisible one.
    subscriptions_unchanged: int
    # Replace mode only: rows deleted to make room for the file. Reported
    # because it is the only number in here that describes a loss, and the
    # caller should be able to see it without diffing before and after.
    subscriptions_removed: int
    categories_imported: int


# --- Health ---


class Health(BaseModel):
    """What GET /health returns. A fixed literal rather than a plain str: the
    only healthy answer is "ok", and saying so in the schema means /docs
    documents the actual value instead of promising an open-ended string."""

    status: Literal["ok"] = "ok"
