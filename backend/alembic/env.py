"""How Alembic connects to the database and what it compares against.

Two things are wired up here that the generated default does not do:

  * the URL comes from DATABASE_URL (via app.database), not from alembic.ini,
    so migrations always run against the database the app itself uses;
  * target_metadata is the app's own Base.metadata, which is what makes
    `alembic revision --autogenerate` able to diff models.py against the
    live schema.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Importing models is what populates Base.metadata -- Base on its own knows
# about no tables until the classes that inherit from it have been imported.
from app import models  # noqa: F401
from app.database import DATABASE_URL, Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set here rather than in alembic.ini: see the note there.
config.set_main_option("sqlalchemy.url", DATABASE_URL)

target_metadata = Base.metadata

# SQLite cannot ALTER a column at all -- Alembic's "batch" mode works around
# that by rebuilding the table. Harmless on Postgres, which is why it is
# switched on by dialect rather than left to whoever writes the next
# migration to remember. The test suite runs on SQLite by default, so a
# migration that only works on Postgres would not be caught otherwise.
RENDER_AS_BATCH = DATABASE_URL.startswith("sqlite")


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade head --sql`).

    Useful for handing a DBA the statements, or reviewing what a deploy is
    about to do, without a live connection.
    """
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=RENDER_AS_BATCH,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """The normal path: connect and apply."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=RENDER_AS_BATCH,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
