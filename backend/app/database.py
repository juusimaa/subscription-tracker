# Sets up the SQLAlchemy connection to Postgres and exposes a per-request
# session via FastAPI's dependency injection (see get_db below).

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import declarative_base, sessionmaker

# Reads variables from backend/.env (used when running the backend directly on
# the host, e.g. `uvicorn app.main:app`). Inside Docker Compose, the
# DATABASE_URL env var is injected directly by docker-compose.yml instead, so
# this call is a no-op there.
#
# The path is pinned rather than left to dotenv's default, which searches
# upward from the working directory and takes the first .env it finds. That
# default reads backend/.env only when the process happens to be started from
# backend/. Started from anywhere else -- or from a git worktree, which has no
# backend/.env of its own -- the search climbs past this directory and lands on
# the *root* .env, which is a different file for a different job: Compose's
# ${VAR} substitution source, carrying values meant for containers. Loading it
# here silently reconfigures the app, and the failure is a long way from the
# cause (INVITE_CODE set there turns ~47 tests red at once, all of them
# looking like real failures). backend/.env.example documents exactly the
# variables this file is meant to supply.
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_FILE)

# The default value matches the credentials in docker-compose.yml, so the app
# also works if DATABASE_URL isn't set. In Compose, DATABASE_URL points at
# "db" (the Postgres service name) instead of "localhost" -- containers on
# the same Compose network can resolve each other by service name.
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://postgres:devpassword@localhost:5432/subscriptions"
)

# The engine manages the pool of actual connections to Postgres.
#
# pool_pre_ping is important in production: the deployed DB is Neon, which
# scales to zero and drops idle connections on suspend, so a pooled
# connection can go stale between requests. Without pre_ping, SQLAlchemy
# would hand out that dead connection and the query would fail with
# "server closed the connection unexpectedly". pool_recycle backs this up
# by proactively retiring connections older than the given age.
#
# pool_size/max_overflow/pool_timeout configure QueuePool, which SQLAlchemy
# uses for Postgres and for file-based SQLite (e.g. the test suite's
# sqlite:///./test.db). An in-memory SQLite URL (sqlite://, no path) gets
# SingletonThreadPool instead, which doesn't accept them -- that combination
# is only used by the docs workflow to import the app without a real
# database, so skip the QueuePool-only options there.
url = make_url(DATABASE_URL)
engine_kwargs = {"pool_pre_ping": True}
if not (url.get_backend_name() == "sqlite" and not url.database):
    engine_kwargs.update(pool_size=5, max_overflow=10, pool_timeout=30, pool_recycle=1800)

engine = create_engine(DATABASE_URL, **engine_kwargs)
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
