# CRUD = Create, Read, Update, Delete: the actual database operations,
# kept separate from main.py so the route handlers stay focused on HTTP
# concerns (status codes, request/response shapes) rather than SQL logic.
#
# Every subscription function takes a user_id and filters on it. That filter
# is the entire multi-user security boundary: the route handlers pass the id
# from the verified token, never one supplied by the client.

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


def get_subscriptions(db: Session, user_id: int) -> list[models.Subscription]:
    return (
        db.query(models.Subscription)
        .filter(models.Subscription.user_id == user_id)
        .order_by(models.Subscription.next_renewal_date)
        .all()
    )


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


def create_subscription(
    db: Session, subscription: schemas.SubscriptionCreate, user_id: int
) -> models.Subscription:
    # model_dump() turns the Pydantic schema into a plain dict, which is then
    # unpacked as keyword args to build the SQLAlchemy model instance. The
    # owner is added separately -- it comes from the token, and deliberately
    # isn't a field the client can send.
    db_subscription = models.Subscription(**subscription.model_dump(), user_id=user_id)
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
