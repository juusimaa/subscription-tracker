# Shared test setup. pytest imports this automatically for every test in this
# directory -- the fixtures below are available by name without importing
# anything.

import os
import uuid
from datetime import date
from decimal import Decimal

import pytest

# These two have to be set BEFORE app.database and app.main are imported, and
# that is why they are at module level rather than in a fixture:
#
#   DATABASE_URL  what every session in the suite connects to, and what
#                 test_migrations.py runs `alembic upgrade head` against.
#   SECRET_KEY    app.auth refuses to import without one, deliberately (see
#                 the comment there) -- a hardcoded default would be a
#                 publicly known signing key.
#
# database.py calls load_dotenv(), which does *not* overwrite variables that
# are already set, so what is set here wins over any local .env file.
#
# The default is a throwaway SQLite file: `pytest` then works on a clean
# checkout with nothing running, no Postgres, no Compose. Set TEST_DATABASE_URL
# to run the same suite against real Postgres:
#
#   TEST_DATABASE_URL=postgresql+psycopg://postgres:devpassword@localhost:5432/subscriptions_test pytest
#
# It is a separate variable from DATABASE_URL on purpose. The fixture below
# drops every table between tests, and a variable the app already reads is one
# an editor or a shell profile could have pointed at a database holding real
# rows.
# `or` rather than a getenv default: an empty value means "not configured"
# just as much as an unset one does, and CI sets the variable to "" for the
# leg that is meant to run on SQLite. Left as a default, that empty string
# would reach create_engine() and fail with a much less obvious error.
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL") or "sqlite:///./test.db"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("SECRET_KEY", "test-only-key-not-used-outside-the-suite")
# /register and /token are rate limited (see app/main.py) at 5/minute per
# remote address. TestClient's requests all share one fake address, and the
# register() helper below runs on nearly every test in this suite -- left
# enabled, the limiter would start rejecting registrations partway through a
# full run for reasons that have nothing to do with what those tests check.
# tests/test_rate_limit.py turns it back on for exactly the requests it needs.
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def clean_database():
    """A fresh, empty schema for every test.

    autouse so no test can forget it: a suite where tests see each other's
    rows fails in whatever order pytest happens to run them in, which is the
    worst kind of failure to debug.

    Built from models.py with create_all() rather than by running the
    migrations: 80-odd `alembic upgrade head` runs would pay for a schema that
    is identical either way. That the two really are identical is not assumed
    -- test_migrations.py asserts it, which is where a migration missing for a
    model change is caught.
    """
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    """The API, called over HTTP the way a real client calls it.

    Deliberately not a direct crud.py call: the routes are where the status
    codes, the response models and the token check live, and those are exactly
    what the tests below are pinning down.
    """
    with TestClient(app) as test_client:
        yield test_client


def register(
    client,
    email: str | None = None,
    password: str = "password123",
    invite_code: str | None = None,
) -> dict:
    """Creates an account and returns the Authorization header for it.

    The email defaults to a unique one so two calls in the same test give two
    genuinely different users -- which is the whole point of the isolation
    tests. invite_code is omitted from the request entirely when not given,
    matching what a client talking to a deployment with no INVITE_CODE set
    would send -- see test_invite_code.py for the gate itself.
    """
    email = email or f"user-{uuid.uuid4().hex[:12]}@example.com"
    payload = {"email": email, "password": password}
    if invite_code is not None:
        payload["invite_code"] = invite_code
    response = client.post("/register", json=payload)
    assert response.status_code == 201, response.text
    token = client.post(
        "/token", data={"username": email, "password": password}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth(client):
    """Headers for one logged-in user -- the common case."""
    return register(client)


@pytest.fixture
def other_auth(client):
    """Headers for a second, unrelated user. Its rows must never be visible to
    `auth`, which is what the isolation tests check."""
    return register(client)


def add_subscription(client, auth: dict, **overrides) -> dict:
    """Creates a subscription and returns the response body.

    Every field has a default so a test only spells out what it actually cares
    about; a test about cancellation should not have to invent a cost.
    """
    payload = {
        "name": "Netflix",
        "cost": "15.99",
        "billing_cycle": "monthly",
        "next_renewal_date": str(date.today()),
        "started_date": str(date.today()),
    }
    payload.update(overrides)
    response = client.post("/subscriptions", json=payload, headers=auth)
    assert response.status_code == 201, response.text
    return response.json()


def money(value) -> Decimal:
    """JSON money as a Decimal, whatever shape it arrived in.

    This is the one place the SQLite/Postgres difference TODO.md warns about
    leaks into the tests. Postgres returns a `Numeric` column as a Decimal, so
    a cost serializes as "15.99"; SQLite hands back a float, which serializes
    as 15.99. Comparing through str() is exact either way, and means no
    assertion here is quietly asserting which database it ran against.
    """
    return Decimal(str(value))
