# Subscription Tracker

A small app for tracking recurring subscriptions (Netflix, HBO, etc.), built as a learning project for Docker, PostgreSQL, and CI/CD to Azure. See [PLAN.md](PLAN.md) for the full project plan.

## Stack

- **Backend:** FastAPI + SQLAlchemy
- **Frontend:** React (Vite)
- **Database:** PostgreSQL
- Three containers (`db`, `backend`, `frontend`), orchestrated with Docker Compose for local dev.

## Running locally

1. Copy the example env file:

   ```
   cp .env.example .env
   ```

2. Generate a signing key for the auth tokens and put it in `.env` as
   `SECRET_KEY` (the backend refuses to start without one):

   ```
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

   `.env` is gitignored — the real key never gets committed.

3. Start everything:

   ```
   docker compose up --build
   ```

4. Open:
   - Frontend: http://localhost:5173
   - Backend API docs: http://localhost:8000/docs

Data persists across restarts in a named Docker volume (`db_data`). To reset the database entirely:

```
docker compose down -v
```

## Accounts

Every subscription belongs to a user, and all API routes except `/health`,
`/register` and `/token` require a login. Sign up on the frontend, or straight
against the API:

```
curl -X POST localhost:8000/register -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"at-least-8-chars"}'
```

Logging in returns a JWT, which the frontend keeps in `localStorage` and sends
as `Authorization: Bearer <token>` on every request. Tokens expire after 12
hours; a different browser or device starts logged out. On http://localhost:8000/docs
the **Authorize** button logs the docs page in the same way.

## Backup and restore

`GET /export` returns everything in the logged-in account as one JSON
document — its subscriptions and its category list, including categories
nothing uses yet:

```
curl localhost:8000/export -H "Authorization: Bearer $TOKEN" > backup.json
```

`POST /import` reads that file back. It carries no ids, no email and no
password hash, so a backup restores into a fresh account just as well as the
one it came from:

```
curl -X POST localhost:8000/import -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d @backup.json
```

By default the file is **merged**: a subscription whose name is already in the
account is skipped, so importing the same file twice is harmless. Add
`?replace=true` for a true restore — it deletes the account's existing
subscriptions and categories first, so the account ends up matching the file
exactly. Either way the import is one transaction; a file that fails part way
through leaves the account untouched. The response says what happened:

```
{"mode":"merge","subscriptions_imported":12,"subscriptions_skipped":0,"categories_imported":3}
```

The file carries a `version` field. A file whose version this build doesn't
read is refused with a 400 rather than imported on a guess.

## CI — images on GHCR

Every push to `main` runs [.github/workflows/build-and-push.yml](.github/workflows/build-and-push.yml),
which builds both images and pushes them to GitHub Container Registry:

- `ghcr.io/<owner>/subscription-tracker-backend`
- `ghcr.io/<owner>/subscription-tracker-frontend`

Each is tagged `latest` and `sha-<short commit>`. The frontend image is the
Nginx production stage (static build), not the Vite dev server that Compose
runs locally. Packages are private by default — make them public, or
`docker login ghcr.io` with a personal access token, to pull them elsewhere.

Nothing deploys these yet; that's milestone 7.

## Project layout

```
backend/            # FastAPI app
frontend/           # React (Vite) app
docker-compose.yml
.github/workflows/  # CI: build and push images to GHCR
```
