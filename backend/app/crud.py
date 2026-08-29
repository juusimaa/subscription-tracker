from sqlalchemy.orm import Session

from app import models, schemas


def get_subscriptions(db: Session) -> list[models.Subscription]:
    return db.query(models.Subscription).order_by(models.Subscription.next_renewal_date).all()


def get_subscription(db: Session, subscription_id: int) -> models.Subscription | None:
    return db.query(models.Subscription).filter(models.Subscription.id == subscription_id).first()


def create_subscription(db: Session, subscription: schemas.SubscriptionCreate) -> models.Subscription:
    db_subscription = models.Subscription(**subscription.model_dump())
    db.add(db_subscription)
    db.commit()
    db.refresh(db_subscription)
    return db_subscription


def update_subscription(
    db: Session, subscription_id: int, subscription: schemas.SubscriptionUpdate
) -> models.Subscription | None:
    db_subscription = get_subscription(db, subscription_id)
    if db_subscription is None:
        return None
    for field, value in subscription.model_dump(exclude_unset=True).items():
        setattr(db_subscription, field, value)
    db.commit()
    db.refresh(db_subscription)
    return db_subscription


def delete_subscription(db: Session, subscription_id: int) -> bool:
    db_subscription = get_subscription(db, subscription_id)
    if db_subscription is None:
        return False
    db.delete(db_subscription)
    db.commit()
    return True
