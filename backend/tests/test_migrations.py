"""The migrations and models.py must describe the same schema.

Alembic's weak point is that nothing forces the two to agree: a column added
to models.py without a matching revision works fine in this suite (the
fixtures build the schema straight from the models) and fails on a deployed
database that only ever sees migrations. That is precisely the failure mode
migrations were added to prevent, so it gets a test of its own.
"""

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app.database import Base, engine

BACKEND_DIR = Path(__file__).resolve().parents[1]


def alembic_config() -> Config:
    """Alembic pointed at this checkout, whatever directory pytest ran from.

    No URL is set: env.py reads DATABASE_URL, which conftest.py has already
    pointed at the throwaway test database. Migrations in this test therefore
    run against exactly the database the rest of the suite uses.
    """
    config = Config(BACKEND_DIR / "alembic.ini")
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


@pytest.fixture
def empty_database():
    """A database with no tables at all, restored to the fixture's schema after.

    The autouse `clean_database` fixture has already created the schema from
    models.py by the time a test body runs, and its teardown expects to drop
    that same schema -- so this both clears the way for a migration run and
    puts things back.
    """
    Base.metadata.drop_all(bind=engine)
    drop_version_table()
    yield
    drop_version_table()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def drop_version_table() -> None:
    """Alembic's own bookkeeping table, which models.py knows nothing about."""
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


def test_migrations_produce_the_schema_the_models_describe(empty_database):
    """`alembic upgrade head` on an empty database == create_all() from models.

    This is the test that fails when someone edits models.py and forgets
    `alembic revision --autogenerate`.
    """
    command.upgrade(alembic_config(), "head")

    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            # Types are deliberately not compared. The suite runs on both
            # SQLite and Postgres, and the two render the same declaration
            # differently -- billing_cycle is a native enum on Postgres and a
            # VARCHAR with a check constraint on SQLite -- so a type-level
            # diff would report a difference between databases rather than a
            # difference between the migrations and the models. Missing,
            # extra and renamed tables, columns, indexes and constraints, all
            # of which are what actually drifts, are still compared.
            opts={"compare_type": False},
        )
        differences = compare_metadata(context, Base.metadata)

    assert differences == [], f"models.py and the migrations disagree: {differences}"


def test_downgrade_removes_everything_it_created(empty_database):
    """Down to base and back up again, twice over.

    A downgrade that leaves something behind only shows up on the *next*
    upgrade, as a "already exists" error -- Postgres enum types are the usual
    culprit, since dropping a table does not drop the type its column used.
    Upgrading a second time is what catches that.
    """
    config = alembic_config()

    command.upgrade(config, "head")
    command.downgrade(config, "base")

    remaining = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert remaining == set()

    command.upgrade(config, "head")

    assert {"users", "categories", "subscriptions"} <= set(inspect(engine).get_table_names())


def test_the_status_backfill_maps_every_existing_row(empty_database):
    """Revision 0002 against a database holding rows, not just tables.

    Every migration before it only ever moved schema around, so the suite
    could get away with checking the shape it left behind. 0002 rewrites data
    -- the `active` boolean becomes a `status` -- and a backfill that dropped
    or mislabelled rows would leave a schema that still matches models.py
    perfectly while quietly cancelling everyone's subscriptions.
    """
    config = alembic_config()
    command.upgrade(config, "0001")

    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO users (id, email, hashed_password) VALUES (1, 'a@b.c', 'x')")
        )
        # One of each, written the way 0001's schema spells them: the boolean
        # is all that schema has to say whether a subscription is running.
        for row_id, name, active in [(1, "Running", True), (2, "Stopped", False)]:
            connection.execute(
                text(
                    "INSERT INTO subscriptions "
                    "(id, name, cost, billing_cycle, next_renewal_date, active, user_id) "
                    "VALUES (:id, :name, 10.00, 'monthly', '2026-01-01', :active, 1)"
                ),
                {"id": row_id, "name": name, "active": active},
            )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        statuses = dict(
            connection.execute(text("SELECT name, status FROM subscriptions")).all()
        )

    assert statuses == {"Running": "active", "Stopped": "cancelled"}


def test_the_status_backfill_reverses_into_the_boolean_it_came_from(empty_database):
    """Downgrading is lossy on purpose -- three statuses share one `false` --
    but it must not lose *rows*, and the one distinction the old schema can
    still make has to survive.
    """
    config = alembic_config()
    command.upgrade(config, "head")

    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO users (id, email, hashed_password) VALUES (1, 'a@b.c', 'x')")
        )
        for row_id, name, status in [
            (1, "Running", "active"),
            (2, "Trialling", "trial"),
            (3, "Paused", "paused"),
            (4, "Stopped", "cancelled"),
        ]:
            connection.execute(
                text(
                    "INSERT INTO subscriptions "
                    "(id, name, cost, billing_cycle, next_renewal_date, status, user_id) "
                    "VALUES (:id, :name, 10.00, 'monthly', '2026-01-01', :status, 1)"
                ),
                {"id": row_id, "name": name, "status": status},
            )

    command.downgrade(config, "0001")

    with engine.connect() as connection:
        flags = dict(connection.execute(text("SELECT name, active FROM subscriptions")).all())

    # bool() because SQLite stores the column as 0/1 and Postgres as a real
    # boolean; the same assertion has to mean the same thing on both.
    assert {name: bool(flag) for name, flag in flags.items()} == {
        "Running": True,
        "Trialling": False,
        "Paused": False,
        "Stopped": False,
    }


def test_upgrade_adopts_a_database_that_predates_alembic():
    """A schema built by the old `create_all()` is adopted, not rebuilt.

    Every existing database -- the local Compose volume, and anything already
    deployed -- has tables that Alembic did not create and has no record of.
    The first revision has to recognise them and record itself rather than
    failing on "table users already exists", or migrations could only ever be
    adopted by throwing the data away.
    """
    # The autouse fixture has already built the schema from models.py, which
    # is exactly the state this is about; only Alembic's record is missing.
    drop_version_table()

    # Explicitly the first revision rather than "head": adoption is a claim
    # about the baseline only. A database that predates Alembic is at the
    # schema 0001 describes, so anything after it still has to run normally.
    command.upgrade(alembic_config(), "0001")

    with engine.connect() as connection:
        assert MigrationContext.configure(connection).get_current_revision() == "0001"

    drop_version_table()
