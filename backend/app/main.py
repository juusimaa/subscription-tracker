# FastAPI entrypoint: defines the HTTP routes and wires them to crud.py.
# Run directly with `uvicorn app.main:app --reload` (see backend/Dockerfile
# and docker-compose.yml for how this gets started in containers).

from datetime import date, timedelta
from decimal import Decimal

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.database import Base, engine, get_db

# Creates any tables that don't exist yet, based on the models in models.py.
# Fine for a learning project; a production app would use a migration tool
# (e.g. Alembic) instead, so schema changes are tracked and reversible.
#
# Worth knowing: this only creates *missing* tables, it never alters existing
# ones. Adding a column (user_id, later cancelled_date) therefore needs either
# a `docker compose down -v` or a hand-written ALTER TABLE to take effect on a
# database created before it:
#   ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancelled_date DATE;
#   ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS started_date DATE;
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Subscription Tracker API")

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


@app.get("/health")
def health():
    """Used by Docker's healthcheck (see docker-compose.yml) to confirm the
    API is actually up and responding, not just that the container started.
    Deliberately left unauthenticated -- Docker has no token to present."""
    return {"status": "ok"}


# --- Auth routes ---


@app.post("/register", response_model=schemas.User, status_code=201)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """Create an account. Returns the new user without a token: the frontend
    follows this immediately with a call to /token."""
    if crud.get_user_by_email(db, user.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    return crud.create_user(db, user)


@app.post("/token", response_model=schemas.Token)
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


@app.get("/me", response_model=schemas.User)
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


@app.get("/categories", response_model=list[schemas.Category])
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


@app.post("/categories", response_model=schemas.Category, status_code=201)
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


@app.put("/categories/{category_id}", response_model=schemas.Category)
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


@app.delete("/categories/{category_id}", status_code=204)
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


@app.get("/subscriptions", response_model=list[schemas.Subscription])
def list_subscriptions(
    category: str | None = Query(
        default=None,
        description="Only subscriptions in this category (case-insensitive).",
    ),
    billing_cycle: models.BillingCycle | None = Query(
        default=None,
        description="Only subscriptions billed on this cycle: monthly or yearly.",
    ),
    active: bool | None = Query(
        default=None,
        description="Only active (true) or only cancelled (false) subscriptions.",
    ),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Every filter is optional; omitting them all returns the full list, so
    existing callers are unaffected. FastAPI validates billing_cycle against
    the BillingCycle enum, meaning a typo like ?billing_cycle=weekly comes
    back as a 422 rather than silently matching nothing."""
    return crud.get_subscriptions(
        db,
        current_user.id,
        category=category,
        billing_cycle=billing_cycle,
        active=active,
    )


@app.post("/subscriptions", response_model=schemas.Subscription, status_code=201)
def create_subscription(
    subscription: schemas.SubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.create_subscription(db, subscription, current_user.id)


@app.get("/subscriptions/{subscription_id}", response_model=schemas.Subscription)
def get_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_subscription = crud.get_subscription(db, subscription_id, current_user.id)
    if db_subscription is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return db_subscription


@app.put("/subscriptions/{subscription_id}", response_model=schemas.Subscription)
def update_subscription(
    subscription_id: int,
    subscription: schemas.SubscriptionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    db_subscription = crud.update_subscription(db, subscription_id, subscription, current_user.id)
    if db_subscription is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return db_subscription


@app.delete("/subscriptions/{subscription_id}", status_code=204)
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


def _last_charged_month(subscription: models.Subscription) -> tuple[int, int]:
    """The last (year, month) a cancelled subscription still cost money.

    Monthly plans stop at the end of the month they were cancelled in. Yearly
    plans do not: the year has already been paid for, so cancelling the day
    after renewing still leaves eleven months of service that were bought and
    paid for. Those run to the end of the paid term, which ends the day before
    next_renewal_date -- the date the *next* payment would have been due.

    The later of the two dates wins, so a yearly subscription whose renewal
    date was never kept up to date falls back to its cancellation month
    instead of losing months it was demonstrably still being paid for.
    """
    cancelled = (subscription.cancelled_date.year, subscription.cancelled_date.month)
    if subscription.billing_cycle != models.BillingCycle.yearly:
        return cancelled
    paid_until = subscription.next_renewal_date - timedelta(days=1)
    return max(cancelled, (paid_until.year, paid_until.month))


def _is_charged(subscription: models.Subscription, year: int, month: int) -> bool:
    """Was this subscription costing money in the given month?

    Months before it started are never charged. After that, a subscription
    that is still running counts for every month asked about, including months
    still in the future -- that is what makes a full-year figure a projection.
    A cancelled one counts up to _last_charged_month and no further.

    Rows that predate these columns are handled by assuming as little as
    possible: no started_date means the start is unknown, so it is treated as
    having always been running (how the summary behaved before the column
    existed), while inactive with no cancelled_date counts for nothing rather
    than inventing spend that may never have happened.
    """
    if subscription.started_date is not None:
        started = (subscription.started_date.year, subscription.started_date.month)
        if (year, month) < started:
            return False
    if subscription.active:
        return True
    if subscription.cancelled_date is None:
        return False
    return (year, month) <= _last_charged_month(subscription)


@app.get("/subscriptions/summary/spend")
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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """What a period actually costs, cancellations included up to the month
    they were cancelled.

    This is the historical/projected view, and it deliberately does not filter
    on `active`: a monthly subscription cancelled in June contributed six
    months of cost to that year and is counted for exactly those six, then
    zero. A cancelled yearly plan keeps counting to the end of the term that
    was already paid for (see _last_charged_month), and nothing counts before
    a subscription's started_date. Compare with /summary/monthly-total, which
    answers the different question of what is being paid *now* and so ignores
    cancelled subscriptions entirely.

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


@app.get("/subscriptions/summary/monthly-total")
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
