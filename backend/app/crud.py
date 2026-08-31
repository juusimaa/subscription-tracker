# CRUD = Create, Read, Update, Delete: the actual database operations,
# kept separate from main.py so the route handlers stay focused on HTTP
# concerns (status codes, request/response shapes) rather than SQL logic.
#
# Every subscription function takes a user_id and filters on it. That filter
# is the entire multi-user security boundary: the route handlers pass the id
# from the verified token, never one supplied by the client.

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import hash_password

# --- Users ---


def get_user_by_email(db: Session, email: str) -> models.User | None:
    return db.query(models.User).filter(models.User.email == email).first()


def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    # The plaintext password stops here: only its bcrypt hash is handed to the
    # model, so it is never written to Postgres.
    db_user = models.User(email=user.email, hashed_password=hash_password(user.password))
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


# --- Subscriptions ---


def get_subscriptions(
    db: Session,
    user_id: int,
    category: str | None = None,
    billing_cycle: models.BillingCycle | None = None,
    active: bool | None = None,
) -> list[models.Subscription]:
    """All of one user's subscriptions, optionally narrowed down.

    The filters are additive: passing None for one leaves that dimension
    unfiltered, so the same function serves both the plain list and the
    filtered views without a second query builder.
    """
    query = db.query(models.Subscription).filter(models.Subscription.user_id == user_id)
    if category is not None:
        # Categories are free text typed by the user, so "Music" and "music"
        # are the same category as far as filtering is concerned.
        query = query.filter(func.lower(models.Subscription.category) == category.lower())
    if billing_cycle is not None:
        query = query.filter(models.Subscription.billing_cycle == billing_cycle)
    if active is not None:
        query = query.filter(models.Subscription.active.is_(active))
    return query.order_by(models.Subscription.next_renewal_date).all()


def get_categories(db: Session, user_id: int) -> list[str]:
    """The distinct categories this user has actually used, so a client can
    offer a filter list without pulling down every subscription. Rows with no
    category are skipped -- there is nothing to filter by."""
    rows = (
        db.query(models.Subscription.category)
        .filter(
            models.Subscription.user_id == user_id,
            models.Subscription.category.isnot(None),
        )
        .distinct()
        .order_by(models.Subscription.category)
        .all()
    )
    return [category for (category,) in rows]


def get_subscription(db: Session, subscription_id: int, user_id: int) -> models.Subscription | None:
    # Filtering on user_id as well as id matters more than it looks: without
    # it, any logged-in user could read, edit or delete anyone else's rows just
    # by guessing an integer. Returning None here makes those attempts 404,
    # which also avoids confirming that someone else's id exists.
    return (
        db.query(models.Subscription)
        .filter(
            models.Subscription.id == subscription_id,
            models.Subscription.user_id == user_id,
        )
        .first()
    )


def _sync_cancellation(db_subscription: models.Subscription) -> None:
    """Keeps `active` and `cancelled_date` telling the same story.

    A client that cancels a subscription normally just sends active=false, so
    the date it stopped costing money is filled in here -- without it the
    spend summary has no way to know which months it should still count. An
    explicit cancelled_date in the request is left alone, so a cancellation
    can be backdated. Reactivating clears the date: the subscription is
    running again, and a stale date would zero out its future months.
    """
    if db_subscription.active:
        db_subscription.cancelled_date = None
    elif db_subscription.cancelled_date is None:
        db_subscription.cancelled_date = date.today()


def create_subscription(
    db: Session, subscription: schemas.SubscriptionCreate, user_id: int
) -> models.Subscription:
    # model_dump() turns the Pydantic schema into a plain dict, which is then
    # unpacked as keyword args to build the SQLAlchemy model instance. The
    # owner is added separately -- it comes from the token, and deliberately
    # isn't a field the client can send.
    db_subscription = models.Subscription(**subscription.model_dump(), user_id=user_id)
    # A subscription being added now almost always starts now. Recording that
    # beats leaving it unknown: without a start date the spend summary has to
    # assume the subscription was running for every month it is asked about.
    if db_subscription.started_date is None:
        db_subscription.started_date = date.today()
    _sync_cancellation(db_subscription)
    db.add(db_subscription)
    db.commit()
    # refresh() reloads the row from Postgres so db_subscription.id (assigned
    # by the database) is populated before we return it.
    db.refresh(db_subscription)
    return db_subscription


def update_subscription(
    db: Session, subscription_id: int, subscription: schemas.SubscriptionUpdate, user_id: int
) -> models.Subscription | None:
    db_subscription = get_subscription(db, subscription_id, user_id)
    if db_subscription is None:
        return None
    # exclude_unset=True skips fields the client didn't include in the
    # request, so a partial update doesn't overwrite existing values with None.
    for field, value in subscription.model_dump(exclude_unset=True).items():
        setattr(db_subscription, field, value)
    _sync_cancellation(db_subscription)
    db.commit()
    db.refresh(db_subscription)
    return db_subscription


def delete_subscription(db: Session, subscription_id: int, user_id: int) -> bool:
    db_subscription = get_subscription(db, subscription_id, user_id)
    if db_subscription is None:
        return False
    db.delete(db_subscription)
    db.commit()
    return True
