# FastAPI entrypoint: defines the HTTP routes and wires them to crud.py.
# Run directly with `uvicorn app.main:app --reload` (see backend/Dockerfile
# and docker-compose.yml for how this gets started in containers).

from decimal import Decimal

from fastapi import Depends, FastAPI, HTTPException, status
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
# ones. Adding user_id to subscriptions therefore needs a
# `docker compose down -v` to take effect on a database created before auth.
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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    return crud.get_subscriptions(db, current_user.id)


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


@app.get("/subscriptions/summary/monthly-total")
def monthly_total(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Normalizes every active subscription to a monthly cost (yearly plans
    are divided by 12) and sums them, so the frontend can show one figure
    regardless of how each subscription bills."""
    subscriptions = crud.get_subscriptions(db, current_user.id)
    total = Decimal("0")
    for sub in subscriptions:
        if not sub.active:
            continue
        if sub.billing_cycle == models.BillingCycle.yearly:
            total += sub.cost / Decimal("12")
        else:
            total += sub.cost
    return {"monthly_total": round(total, 2)}
