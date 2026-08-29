from decimal import Decimal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import Base, engine, get_db

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Subscription Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/subscriptions", response_model=list[schemas.Subscription])
def list_subscriptions(db: Session = Depends(get_db)):
    return crud.get_subscriptions(db)


@app.post("/subscriptions", response_model=schemas.Subscription, status_code=201)
def create_subscription(subscription: schemas.SubscriptionCreate, db: Session = Depends(get_db)):
    return crud.create_subscription(db, subscription)


@app.get("/subscriptions/{subscription_id}", response_model=schemas.Subscription)
def get_subscription(subscription_id: int, db: Session = Depends(get_db)):
    db_subscription = crud.get_subscription(db, subscription_id)
    if db_subscription is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return db_subscription


@app.put("/subscriptions/{subscription_id}", response_model=schemas.Subscription)
def update_subscription(
    subscription_id: int, subscription: schemas.SubscriptionUpdate, db: Session = Depends(get_db)
):
    db_subscription = crud.update_subscription(db, subscription_id, subscription)
    if db_subscription is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return db_subscription


@app.delete("/subscriptions/{subscription_id}", status_code=204)
def delete_subscription(subscription_id: int, db: Session = Depends(get_db)):
    if not crud.delete_subscription(db, subscription_id):
        raise HTTPException(status_code=404, detail="Subscription not found")


@app.get("/subscriptions/summary/monthly-total")
def monthly_total(db: Session = Depends(get_db)):
    subscriptions = crud.get_subscriptions(db)
    total = Decimal("0")
    for sub in subscriptions:
        if not sub.active:
            continue
        if sub.billing_cycle == models.BillingCycle.yearly:
            total += sub.cost / Decimal("12")
        else:
            total += sub.cost
    return {"monthly_total": round(total, 2)}
