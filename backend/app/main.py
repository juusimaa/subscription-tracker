# FastAPI entrypoint: defines the HTTP routes and wires them to crud.py.
# Run directly with `uvicorn app.main:app --reload` (see backend/Dockerfile
# and docker-compose.yml for how this gets started in containers).

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app import auth, crud, models, renewals, schemas
from app.database import get_db

# No Base.metadata.create_all() here any more. It used to run at import time
# and build any missing tables, which was enough only for as long as the
# schema was append-only and the data disposable: it creates missing *tables*
# and never alters existing ones, so every column added so far cost a
# `docker compose down -v` or a hand-written ALTER TABLE.
#
# Alembic owns the schema now (backend/alembic/). The container applies it
# before uvicorn starts -- see backend/entrypoint.sh -- so importing this
# module no longer touches the database at all. Running the app by hand means
# running `alembic upgrade head` first, once, from backend/.

# The title, description and tag list below are not decoration: they are what
# FastAPI renders as the interactive API docs at /docs (Swagger UI) and /redoc,
# both generated from the same /openapi.json this metadata feeds. Every route
# carries a `tags=` so those pages group the endpoints the same way the
# sections of this file do, rather than listing all of them under "default".
app = FastAPI(
    title="Subscription Tracker API",
    version="0.1.0",
    description=(
        "Track recurring subscriptions and what they cost.\n\n"
        "Every route except `/health`, `/register` and `/token` needs a Bearer "
        "token, and only ever sees the calling user's own data. To try them "
        "out here: register, then use **Authorize** above (the OAuth2 password "
        "flow posts to `/token`, where the email goes in the `username` field)."
    ),
    openapi_tags=[
        {"name": "Health", "description": "Liveness check. No authentication."},
        {"name": "Auth", "description": "Registration, login, and who-am-I."},
        {
            "name": "Subscriptions",
            "description": "The subscriptions themselves, plus what they cost per period.",
        },
        {
            "name": "Categories",
            "description": (
                "Managing the category list. A subscription carries a category "
                "*name*, and using a name that isn't in the list yet adds it, so "
                "a category never has to be created up front."
            ),
        },
        {
            "name": "Backup",
            "description": (
                "Export an account to one JSON file and restore it. Files carry "
                "no ids, email or password hash, so they are safe to hand over "
                "and can be restored into a fresh account."
            ),
        },
    ],
)

# The React dev server runs on a different origin (localhost:5173) than this
# API (localhost:8000). Browsers block cross-origin requests by default, so
# CORS middleware explicitly allows the frontend's origin to call this API.
# allow_headers=["*"] already covers the Authorization header the frontend
# sends; because the token travels in a header rather than a cookie, no
# credentials/SameSite configuration is needed here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=schemas.Health, tags=["Health"])
def health():
    """Used by Docker's healthcheck (see docker-compose.yml) to confirm the
    API is actually up and responding, not just that the container started.
    Deliberately left unauthenticated -- Docker has no token to present."""
    return {"status": "ok"}


# --- Auth routes ---


@app.post("/register", response_model=schemas.User, status_code=201, tags=["Auth"])
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """Create an account. Returns the new user without a token: the frontend
    follows this immediately with a call to /token."""
    if crud.get_user_by_email(db, user.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    return crud.create_user(db, user)


@app.post("/token", response_model=schemas.Token, tags=["Auth"])
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Exchange email + password for a JWT.

    OAuth2PasswordRequestForm reads a form-encoded body with fields named
    "username" and "password" -- that naming is fixed by the OAuth2 spec, so
    the email goes in "username". Following the spec is what lets the
    "Authorize" button on /docs log in against this endpoint.
    """
    user = crud.get_user_by_email(db, form_data.username)
    # One combined check with one generic message: replying "no such user"
    # separately from "wrong password" would let anyone enumerate which email
    # addresses have accounts.
    if user is None or not auth.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return schemas.Token(access_token=auth.create_access_token(user.id))


@app.get("/me", response_model=schemas.User, tags=["Auth"])
def read_me(current_user: models.User = Depends(auth.get_current_user)):
    """Who am I? The frontend uses this on startup to check whether a token
    left over in localStorage is still valid before showing the app."""
    return current_user


# --- Category routes ---
#
# Categories exist so they can be managed as a list in their own right. A
# subscription still just carries a category *name*, and using a name that
# isn't in the list yet adds it (crud.ensure_category), so a client is never
# forced to create the category first.


@app.get("/categories", response_model=list[schemas.Category], tags=["Categories"])
def list_categories(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """This user's categories, each with a count of the subscriptions using
    it -- enough for a filter list, and enough to warn before deleting one
    that is still in use."""
    return [
        schemas.Category(id=category.id, name=category.name, subscription_count=count)
        for category, count in crud.get_categories(db, current_user.id)
    ]


@app.post(
    "/categories", response_model=schemas.Category, status_code=201, tags=["Categories"]
)
def create_category(
    category: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Adds an empty category, ready to be used by subscriptions later."""
    if crud.get_category_by_name(db, category.name, current_user.id) is not None:
        # 409 rather than 400: the request is well-formed, it just collides
        # with something that already exists.
        raise HTTPException(status_code=409, detail="Category already exists")
    db_category = crud.create_category(db, category.name, current_user.id)
    # A brand new category has nothing using it yet, so the count is 0 without
    # needing to ask the database.
    return schemas.Category(id=db_category.id, name=db_category.name, subscription_count=0)


@app.put(
    "/categories/{category_id}", response_model=schemas.Category, tags=["Categories"]
)
def update_category(
    category_id: int,
    category: schemas.CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Renames a category, relabelling every subscription that used the old
    name so nothing is left behind under a name that no longer exists."""
    db_category = crud.get_category(db, category_id, current_user.id)
    if db_category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    clash = crud.get_category_by_name(db, category.name, current_user.id)
    if clash is not None and clash.id != db_category.id:
        # Allowing this would silently merge two categories into one, which is
        # a bigger decision than a rename and not obviously what was meant.
        raise HTTPException(status_code=409, detail="Category already exists")
    db_category = crud.rename_category(db, db_category, category.name)
    count = crud.count_subscriptions_in_category(db, db_category.name, current_user.id)
    return schemas.Category(
        id=db_category.id, name=db_category.name, subscription_count=count
    )


@app.delete("/categories/{category_id}", status_code=204, tags=["Categories"])
def delete_category(
    category_id: int,
    reassign_to: int | None = Query(
        default=None,
        description="Move subscriptions using this category to the category with this id.",
    ),
    detach: bool = Query(
        default=False,
        description="Leave subscriptions using this category with no category at all.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Deletes a category.

    A category still in use needs to say what happens to those subscriptions:
    pass reassign_to to move them, or detach=true to clear their category.
    Without either, the request is refused rather than quietly stripping the
    category off subscriptions the caller may have forgotten about -- the
    error says how many would have been affected.
    """
    db_category = crud.get_category(db, category_id, current_user.id)
    if db_category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    target = None
    if reassign_to is not None:
        if detach:
            raise HTTPException(
                status_code=400, detail="Pass either reassign_to or detach, not both"
            )
        if reassign_to == category_id:
            raise HTTPException(
                status_code=400, detail="Cannot reassign a category to itself"
            )
        target = crud.get_category(db, reassign_to, current_user.id)
        if target is None:
            raise HTTPException(status_code=404, detail="Category to reassign to not found")

    in_use = crud.count_subscriptions_in_category(db, db_category.name, current_user.id)
    if in_use and target is None and not detach:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{in_use} subscription(s) still use this category; "
                "pass reassign_to=<category_id> or detach=true"
            ),
        )
    crud.delete_category(db, db_category, target)


# --- Backup routes ---
#
# One file in, one file out, holding everything an account owns: its
# subscriptions and its category list. What is *not* in it matters as much --
# no ids, no email, no password hash -- so a backup can be restored into a
# fresh account, and handing one to someone gives away no credentials.


@app.get("/export", response_model=schemas.Backup, tags=["Backup"])
def export_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Everything in the calling user's account, as one JSON document.

    Empty categories are listed in their own right rather than being inferred
    from the subscriptions, so a category set up in advance survives a backup
    and restore even while nothing is using it yet.
    """
    return schemas.Backup(
        version=schemas.BACKUP_VERSION,
        # Timezone-aware and in UTC: a bare local timestamp in a file that may
        # be restored anywhere is ambiguous by the time anyone reads it.
        exported_at=datetime.now(timezone.utc),
        categories=[category.name for category, _ in crud.get_categories(db, current_user.id)],
        subscriptions=[
            schemas.BackupSubscription.model_validate(sub)
            for sub in crud.get_subscriptions(db, current_user.id)
        ],
    )


@app.post("/import", response_model=schemas.ImportResult, tags=["Backup"])
def import_data(
    backup: schemas.Backup,
    replace: bool = Query(
        default=False,
        description=(
            "Delete this account's existing subscriptions and categories first, "
            "so the account ends up matching the file exactly. Off by default: "
            "the file is merged into what is already there."
        ),
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Restores a file from GET /export into the calling user's account.

    Merging is the default because it is the one that cannot lose data: a
    subscription whose name is already in the account is skipped, so importing
    the same file twice is harmless. `replace=true` is the true restore -- it
    empties the account first, and is the only mode that can delete anything.

    The import is one transaction. If any part of it fails, the account is
    left exactly as it was rather than half-restored.
    """
    if backup.version not in schemas.SUPPORTED_BACKUP_VERSIONS:
        # Refusing beats guessing: a file from a version this build has never
        # seen may name its fields differently, and importing it on hope would
        # write silently wrong data. Versions it *can* read are read -- a
        # version 1 file predates statuses and says `active` instead, which
        # schemas.BackupSubscription resolves on the way in.
        readable = ", ".join(str(v) for v in sorted(schemas.SUPPORTED_BACKUP_VERSIONS))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported backup version {backup.version}; "
                f"this API reads version(s) {readable}"
            ),
        )
    return crud.import_backup(db, backup, current_user.id, replace=replace)


# --- Subscription routes ---
#
# Depends(get_db) is FastAPI's dependency injection: for each request, it
# calls get_db() (defined in database.py), hands the yielded session to the
# route function as `db`, and runs the cleanup code after the response is sent.
#
# Depends(auth.get_current_user) works the same way for the caller's identity:
# it validates the Bearer token and returns the User, or rejects the request
# with 401 before the handler body ever runs. Every route below passes
# current_user.id into crud so it only ever touches that user's own rows.


@app.get("/subscriptions", response_model=list[schemas.Subscription], tags=["Subscriptions"])
def list_subscriptions(
    category: str | None = Query(
        default=None,
        description="Only subscriptions in this category (case-insensitive).",
    ),
    billing_cycle: models.BillingCycle | None = Query(
        default=None,
        description="Only subscriptions billed on this cycle: monthly or yearly.",
    ),
    status: models.SubscriptionStatus | None = Query(
        default=None,
        description="Only subscriptions with this status: active, trial, paused or cancelled.",
    ),
    active: bool | None = Query(
        default=None,
        description=(
            "Only billing (true) or only non-billing (false) subscriptions. The "
            "coarse version of `status`, kept for clients that predate it: false "
            "now covers trial and paused as well as cancelled, so use "
            "`status=cancelled` to ask for cancelled rows specifically."
        ),
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Every filter is optional; omitting them all returns the full list, so
    existing callers are unaffected. FastAPI validates billing_cycle and
    status against their enums, meaning a typo like ?billing_cycle=weekly
    comes back as a 422 rather than silently matching nothing."""
    return crud.get_subscriptions(
        db,
        current_user.id,
        category=category,
        billing_cycle=billing_cycle,
        active=active,
        status=status,
    )


@app.post(
    "/subscriptions", response_model=schemas.Subscription, status_code=201, tags=["Subscriptions"]
)
def create_subscription(
    subscription: schemas.SubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Leaving started_date off means "starts today", so a request that also
    back-dates cancelled_date describes a subscription cancelled before it
    began. crud spots that once the default is filled in; it is a 422 here for
    the same reason the schema rejects the spelled-out version."""
    try:
        return crud.create_subscription(db, subscription, current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# Declared before /subscriptions/{subscription_id}, and it has to stay there:
# FastAPI matches routes in the order they are defined, so with the parameter
# route first, "upcoming" would be handed to it as a subscription id and come
# back as a 422 for a path that plainly exists. The two summary routes are
# safe either way -- they are two path segments deep, so nothing can confuse
# them with a single id.
@app.get(
    "/subscriptions/upcoming",
    response_model=schemas.UpcomingSummary,
    tags=["Subscriptions"],
)
def upcoming(
    days: int = Query(
        default=30,
        ge=1,
        le=365,
        description="How far ahead to look, in days from today (inclusive).",
    ),
    category: str | None = Query(
        default=None,
        description="Only subscriptions in this category (case-insensitive).",
    ),
    billing_cycle: models.BillingCycle | None = Query(
        default=None,
        description="Only subscriptions billed on this cycle.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """What is about to be charged, and when.

    Active subscriptions and trials about to convert; nothing else. A
    cancelled or paused one is not going to be billed, whatever its dates say.

    Each renewal in the window is listed separately with the full amount due
    on the day, so a monthly plan appears three times in a 90-day window and a
    yearly plan brings its whole year's cost to the one day it lands on. That
    is deliberately not what /summary/spend does -- it spreads a yearly cost
    across the twelve months it covers, because it answers what a period costs
    rather than what is leaving the account this week.

    A trial appears **once**, on the day it converts, at a cost of 0. Both
    halves of that are deliberate. Once, because a trial converts one time and
    then bills as a normal subscription under a different status, so treating
    its date as a recurring anchor would invent conversions that never happen.
    At 0, because nothing leaves the account on that day -- the trial is free
    until it ends -- and this route's `total` is real money due, which a
    trial's eventual price is not yet. The full price still travels in the
    nested `subscription`, which is what lets a client say "then EUR 9.99/mo"
    without a second request.

    Renewals before a subscription's started_date are skipped, so a plan added
    now but starting next quarter does not show up as due tomorrow.
    """
    today = date.today()
    through = today + timedelta(days=days)
    # Deliberately unfiltered by status: which statuses belong here is this
    # route's own rule, decided per subscription below, not something a caller
    # passes in.
    subscriptions = crud.get_subscriptions(
        db,
        current_user.id,
        category=category,
        billing_cycle=billing_cycle,
    )

    def add(subscription, renewal_date, cost):
        if subscription.started_date is not None and renewal_date < subscription.started_date:
            return
        due.append(
            {
                "subscription": subscription,
                "renewal_date": renewal_date,
                "days_until": (renewal_date - today).days,
                "cost": cost,
            }
        )

    due = []
    for subscription in subscriptions:
        if subscription.status == models.SubscriptionStatus.trial:
            # next_renewal_date is the conversion date and is never rolled for
            # a trial (see models.Subscription), so this is a window check
            # rather than a schedule.
            conversion = subscription.next_renewal_date
            if today <= conversion <= through:
                add(subscription, conversion, Decimal("0"))
        elif subscription.active:
            for renewal_date in renewals.occurrences_between(
                subscription.renewal_anchor_date, subscription.cycle_months, today, through
            ):
                add(subscription, renewal_date, subscription.cost)

    # Soonest first; name and id only to keep two renewals on the same day in
    # a stable, predictable order rather than whatever the query returned.
    due.sort(
        key=lambda entry: (
            entry["renewal_date"],
            entry["subscription"].name.lower(),
            entry["subscription"].id,
        )
    )
    return {
        "days": days,
        "through": through,
        "total": round(sum((entry["cost"] for entry in due), Decimal("0")), 2),
        "renewals": due,
    }


@app.get(
    "/subscriptions/{subscription_id}",
    response_model=schemas.Subscription,
    tags=["Subscriptions"],
)
def get_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_subscription = crud.get_subscription(db, subscription_id, current_user.id)
    if db_subscription is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return db_subscription


@app.put(
    "/subscriptions/{subscription_id}",
    response_model=schemas.Subscription,
    tags=["Subscriptions"],
)
def update_subscription(
    subscription_id: int,
    subscription: schemas.SubscriptionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """A rejected edit changes nothing: crud re-checks the row the update would
    actually produce, and a request that would leave started_date after
    cancelled_date comes back as a 422 with the stored row untouched."""
    try:
        db_subscription = crud.update_subscription(
            db, subscription_id, subscription, current_user.id
        )
    except ValueError as exc:
        # 422 (not 400) to match what the schemas return for the same mistake
        # caught one layer earlier -- a client sending both dates at once and a
        # client sending only one should not see two different status codes.
        raise HTTPException(status_code=422, detail=str(exc))
    if db_subscription is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return db_subscription


@app.delete("/subscriptions/{subscription_id}", status_code=204, tags=["Subscriptions"])
def delete_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not crud.delete_subscription(db, subscription_id, current_user.id):
        raise HTTPException(status_code=404, detail="Subscription not found")


def _monthly_cost(subscription: models.Subscription) -> Decimal:
    """One subscription's cost expressed per month. Yearly plans are spread
    across the 12 months they cover rather than landing entirely in their
    renewal month, which is what makes monthly and yearly figures comparable."""
    if subscription.billing_cycle == models.BillingCycle.yearly:
        return subscription.cost / Decimal("12")
    return subscription.cost


def _last_charged_month(
    subscription: models.Subscription, stopped: date
) -> tuple[int, int]:
    """The last (year, month) a stopped subscription still cost money.

    Monthly plans stop at the end of the month they stopped in. Yearly plans
    do not: the year has already been paid for, so stopping the day after
    renewing still leaves eleven months of service that were bought and paid
    for. Those run to the end of the paid term, which ends the day before
    next_renewal_date -- the date the *next* payment would have been due.

    That date is computed from the stop date (see
    models.Subscription.next_renewal_date), so this is the real end of the
    real term. It used to be whatever renewal date was stored when the row was
    created, which for anything more than a year old was in the past -- and a
    paid term that ends before the stop is not a term at all.

    The later of the two dates still wins, which matters at the boundary:
    stopping exactly on a renewal date makes the derived date that same day,
    so the month it stopped in would otherwise be dropped.

    `stopped` is passed in rather than read off the subscription because a
    pause and a cancellation are the same arithmetic on different columns, and
    the caller has already resolved which one applies.
    """
    stopped_month = (stopped.year, stopped.month)
    if subscription.billing_cycle != models.BillingCycle.yearly:
        return stopped_month
    paid_until = subscription.next_renewal_date - timedelta(days=1)
    return max(stopped_month, (paid_until.year, paid_until.month))


def _is_charged(subscription: models.Subscription, year: int, month: int) -> bool:
    """Was this subscription costing money in the given month?

    A trial never was: it is free until it converts, and converting is what
    moves it off `trial`, so as long as it carries that status the answer is
    no for every month including past ones. That is checked before the start
    date, because it holds regardless of when the trial began.

    Months before it started are never charged. After that, a subscription
    that is still running counts for every month asked about, including months
    still in the future -- that is what makes a full-year figure a projection.
    A stopped one -- cancelled or paused -- counts up to _last_charged_month
    and no further, which is what keeps a pause from retroactively erasing the
    months the subscription really did bill in.

    Rows that predate these columns are handled by assuming as little as
    possible: no started_date means the start is unknown, so it is treated as
    having always been running (how the summary behaved before the column
    existed), while a stopped row with no stop date counts for nothing rather
    than inventing spend that may never have happened.
    """
    if subscription.status == models.SubscriptionStatus.trial:
        return False
    if subscription.started_date is not None:
        started = (subscription.started_date.year, subscription.started_date.month)
        if (year, month) < started:
            return False
    if subscription.active:
        return True
    stopped = subscription.stopped_date
    if stopped is None:
        return False
    return (year, month) <= _last_charged_month(subscription, stopped)


@app.get(
    "/subscriptions/summary/spend",
    response_model=schemas.SpendSummary,
    tags=["Subscriptions"],
)
def spend(
    year: int | None = Query(
        default=None,
        ge=1970,
        le=9999,
        description="Calendar year to total up. Defaults to the current year.",
    ),
    month: int | None = Query(
        default=None,
        ge=1,
        le=12,
        description="Single month to total up. Omit for the whole year.",
    ),
    category: str | None = Query(
        default=None,
        description="Only total up subscriptions in this category (case-insensitive).",
    ),
    billing_cycle: models.BillingCycle | None = Query(
        default=None,
        description="Only total up subscriptions billed on this cycle.",
    ),
    status: models.SubscriptionStatus | None = Query(
        default=None,
        description=(
            "Only total up subscriptions with this status -- e.g. what the "
            "plans you have since cancelled cost you over the year."
        ),
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """What a period actually costs, stopped plans included up to the month
    they stopped.

    This is the historical/projected view, and it deliberately does not
    filter by status of its own accord: a monthly subscription cancelled in
    June contributed six months of cost to that year and is counted for
    exactly those six, then zero. The same goes for one paused in June -- the
    pause stops the spend, it does not undo it. A stopped yearly plan keeps
    counting to the end of the term that was already paid for (see
    _last_charged_month), a trial counts for nothing at all, and nothing
    counts before a subscription's started_date. Compare with
    /summary/monthly-total, which answers the different question of what is
    being paid *now* and so ignores everything that is not billing.

    The optional `status` filter narrows *which* subscriptions are totalled;
    it does not change any of the above for the ones that remain.

    `months` always breaks the period down month by month (one entry when
    `month` is given, twelve otherwise) and `total` is the sum of those
    entries, so a client can chart the breakdown and show the total without
    the two disagreeing by a rounding cent.
    """
    year = year or date.today().year
    subscriptions = crud.get_subscriptions(
        db,
        current_user.id,
        category=category,
        billing_cycle=billing_cycle,
        status=status,
    )
    months = [month] if month is not None else list(range(1, 13))

    breakdown = []
    for m in months:
        total = sum(
            (_monthly_cost(sub) for sub in subscriptions if _is_charged(sub, year, m)),
            Decimal("0"),
        )
        breakdown.append({"month": m, "total": round(total, 2)})

    return {
        "year": year,
        "total": sum((entry["total"] for entry in breakdown), Decimal("0")),
        "months": breakdown,
    }


@app.get(
    "/subscriptions/summary/monthly-total",
    response_model=schemas.MonthlyTotal,
    tags=["Subscriptions"],
)
def monthly_total(
    category: str | None = Query(
        default=None,
        description="Only total up subscriptions in this category (case-insensitive).",
    ),
    billing_cycle: models.BillingCycle | None = Query(
        default=None,
        description="Only total up subscriptions billed on this cycle.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Normalizes every active subscription to a monthly cost (yearly plans
    are divided by 12) and sums them, so the frontend can show one figure
    regardless of how each subscription bills.

    Active only, in the strict sense: trials cost nothing yet, paused plans
    are not being charged, and cancelled ones are gone. None of the three
    belongs in what is being paid right now, which is why this route takes no
    `status` filter -- the status set is the question it answers.

    Accepts the same category/billing_cycle filters as the list route, so a
    filtered view can show the total for exactly what it displays. The yearly
    figure is the same money viewed over 12 months, not a separate sum -- it
    is returned alongside rather than replacing monthly_total, which existing
    clients already read.
    """
    subscriptions = crud.get_subscriptions(
        db,
        current_user.id,
        category=category,
        billing_cycle=billing_cycle,
        active=True,
    )
    total = sum((_monthly_cost(sub) for sub in subscriptions), Decimal("0"))
    return {"monthly_total": round(total, 2), "yearly_total": round(total * 12, 2)}
