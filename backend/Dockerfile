# python:3.13-slim rather than the default "python" image: much smaller
# (fewer OS packages), which means a faster build/push and a smaller attack
# surface. 3.13 (not the newest 3.14) is used because it has broader
# prebuilt-wheel support for our dependencies -- see PLAN.md notes.
FROM python:3.13-slim

# All subsequent instructions (COPY, RUN, CMD) run relative to this directory
# inside the container.
WORKDIR /app

# Dependencies are copied and installed *before* the app code. Docker caches
# each layer, so as long as requirements.txt doesn't change, this layer is
# reused on rebuilds instead of reinstalling every package -- only app code
# changes trigger a fast rebuild of the layers below.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# The schema the app expects, and the script that applies it before starting.
COPY alembic.ini entrypoint.sh ./
COPY alembic ./alembic

# Documents which port the app listens on. This doesn't actually publish the
# port to the host -- that's done by the "ports:" mapping in
# docker-compose.yml (or `docker run -p`).
EXPOSE 8000

# Every start goes through entrypoint.sh, which runs `alembic upgrade head`
# and then execs the command below. Keeping migrations in the ENTRYPOINT means
# the `command:` override in docker-compose.yml cannot skip them.
ENTRYPOINT ["./entrypoint.sh"]

# The default command when the container starts. docker-compose.yml
# overrides this for local dev to add --reload for hot-reloading; this
# plain version (no --reload) is what would run in production/Azure.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
