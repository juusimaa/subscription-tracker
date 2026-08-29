# Sets up the SQLAlchemy connection to Postgres and exposes a per-request
# session via FastAPI's dependency injection (see get_db below).

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Reads variables from a local .env file (used when running the backend
# directly on the host, e.g. `uvicorn app.main:app`). Inside Docker Compose,
# the DATABASE_URL env var is injected directly by docker-compose.yml instead,
# so this call is a no-op there.
load_dotenv()

# The default value matches the credentials in docker-compose.yml, so the app
# also works if DATABASE_URL isn't set. In Compose, DATABASE_URL points at
# "db" (the Postgres service name) instead of "localhost" -- containers on
# the same Compose network can resolve each other by service name.
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://postgres:devpassword@localhost:5432/subscriptions"
)

# The engine manages the pool of actual connections to Postgres.
engine = create_engine(DATABASE_URL)
# Each call to SessionLocal() gives a new "conversation" with the database.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# All ORM models (see models.py) inherit from this so SQLAlchemy knows about them.
Base = declarative_base()


def get_db():
    """FastAPI dependency: opens a DB session for one request, closes it after.

    Using `yield` (instead of `return`) lets FastAPI run the `finally` block
    once the request is done, guaranteeing the session is closed even if the
    request handler raises an error.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
