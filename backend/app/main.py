# FastAPI entrypoint: defines the HTTP routes and wires them to crud.py.
# Run directly with `uvicorn app.main:app --reload` (see backend/Dockerfile
# and docker-compose.yml for how this gets started in containers).

from decimal import Decimal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import Base, engine, get_db

# Creates any tables that don't exist yet, based on the models in models.py.
# Fine for a learning project; a production app would use a migration tool
# (e.g. Alembic) instead, so schema changes are tracked and reversible.
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Subscription Tracker API")

# The React dev server runs on a different origin (localhost:5173) than this
# API (localhost:8000). Browsers block cross-origin requests by default, so
# CORS middleware explicitly allows the frontend's origin to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Used by Docker's healthcheck (see docker-compose.yml) to confirm the
    API is actually up and responding, not just that the container started."""
    return {"status": "ok"}


# Depends(get_db) is FastAPI's dependency injection: for each request, it
# calls get_db() (defined in database.py), hands the yielded session to the
# route function as `db`, and runs the cleanup code after the response is sent.
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
    """Normalizes every active subscription to a monthly cost (yearly plans
    are divided by 12) and sums them, so the frontend can show one figure
    regardless of how each subscription bills."""
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
