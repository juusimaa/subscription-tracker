#!/bin/sh
# Applies any pending migrations, then hands off to whatever command the
# container was given (uvicorn, by default -- see the Dockerfile's CMD, and
# the --reload variant docker-compose.yml overrides it with).
#
# This is an ENTRYPOINT rather than part of the CMD on purpose: a `command:`
# in docker-compose.yml replaces CMD but not ENTRYPOINT, so the migration step
# cannot be skipped by overriding how the app is started.
#
# `set -e` makes a failed migration stop the container instead of starting an
# app against a schema that is not the one its code expects -- a loud failure
# on deploy, rather than a quiet one on the first request that touches a
# missing column.
set -e

echo "Running database migrations..."
alembic upgrade head

# exec replaces this shell with the app, so the app becomes PID 1 and receives
# Docker's SIGTERM directly on `docker compose stop`. Without it the shell
# stays PID 1, swallows the signal, and the container is killed after the
# 10-second grace period instead of shutting down cleanly.
exec "$@"
