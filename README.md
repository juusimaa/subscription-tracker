# Subscription Tracker

[![Tests](https://github.com/juusimaa/subscription-tracker/actions/workflows/test.yml/badge.svg?branch=main&event=push)](https://github.com/juusimaa/subscription-tracker/actions/workflows/test.yml)
[![Build and push images](https://github.com/juusimaa/subscription-tracker/actions/workflows/build-and-push.yml/badge.svg?branch=main)](https://github.com/juusimaa/subscription-tracker/actions/workflows/build-and-push.yml)
[![Publish API docs](https://github.com/juusimaa/subscription-tracker/actions/workflows/docs.yml/badge.svg?branch=main)](https://github.com/juusimaa/subscription-tracker/actions/workflows/docs.yml)

A small app for tracking recurring subscriptions (Netflix, HBO, etc.), built as
a learning project for Docker, PostgreSQL, and CI/CD to Azure. See
[PLAN.md](PLAN.md) for the full project plan and milestones.

Because it is a learning project, the code is written to be read: every source
file opens with a comment explaining what it is for, and the non-obvious
decisions are explained where they were made rather than in a document that
drifts out of date. This README is the guided tour that ties those files
together — what each layer is responsible for, and why it is a separate layer
at all.

## Stack

- **Backend:** FastAPI + SQLAlchemy (Python 3.13)
- **Frontend:** React 19 (Vite)
- **Database:** PostgreSQL 16
- **Auth:** JWT bearer tokens, bcrypt-hashed passwords
- Three containers (`db`, `backend`, `frontend`), orchestrated with Docker
  Compose for local dev; images published to GHCR by GitHub Actions.

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
     (or the published reference: https://juusimaa.github.io/subscription-tracker)

Data persists across restarts in a named Docker volume (`db_data`). To reset the
database entirely:

```
docker compose down -v
```

### The environment variables

Compose reads `.env` automatically and passes these through to the containers
that need them ([.env.example](.env.example) documents the same list):

| Variable | Used by | Notes |
| --- | --- | --- |
| `POSTGRES_DB` | `db` | Database created on first start. |
| `POSTGRES_PASSWORD` | `db` | Superuser password for the `postgres` role. |
| `DATABASE_URL` | `backend` | Full SQLAlchemy URL. Host is `db`, not `localhost` — see [Docker & Compose](#9-docker--compose). |
| `SECRET_KEY` | `backend` | Signs the JWTs. Changing it logs everyone out. |
| `VITE_API_URL` | `frontend` | Baked into the browser bundle, so it must be an address *your browser* can reach. |

---

## The shape of the whole thing

```
Browser (localhost:5173)
   │  fetch() with Authorization: Bearer <jwt>
   ▼
┌──────────────────────────────────────────────┐
│ frontend container — Vite dev server (React) │
└──────────────────────────────────────────────┘
   │  HTTP/JSON, cross-origin (CORS)
   ▼
┌──────────────────────────────────────────────┐
│ backend container — uvicorn → FastAPI        │
│                                              │
│   main.py     HTTP: routes, status codes     │
│   auth.py     tokens, password hashing       │
│   schemas.py  what JSON may go in and out    │
│   crud.py     the queries                    │
│   models.py   the tables                     │
│   database.py engine + per-request session   │
└──────────────────────────────────────────────┘
   │  SQL over Docker's internal network (db:5432)
   ▼
┌──────────────────────────────────────────────┐
│ db container — PostgreSQL 16                 │
│   volume db_data → survives `compose down`   │
└──────────────────────────────────────────────┘
```

The backend split is the part worth internalising, because it is the same split
most server applications end up with under different names:

- **models.py** describes the *database*.
- **schemas.py** describes the *API*.
- Keeping them apart is what lets the two differ on purpose. `models.User` has a
  `hashed_password` column; `schemas.User` has no such field, so the hash cannot
  leak through a response even if a handler returns the whole row. Likewise the
  client may not send `id` or `user_id` on create, because the create schema
  simply has nowhere to put them.
- **crud.py** knows SQL but nothing about HTTP — it never raises a 404.
- **main.py** knows HTTP but writes no SQL — it turns `None` from crud into a
  404, and a Pydantic model into a validated 201.

---

## Layer by layer

### 1. PostgreSQL — [docker-compose.yml](docker-compose.yml)

Runs from the official `postgres:16` image, pinned to a major version so a
rebuild can't silently land a breaking upgrade.

Two Docker concepts do the real work here:

- **The named volume `db_data`.** Container filesystems are ephemeral: without
  this, every `docker compose down` would destroy the database. The volume maps
  Postgres's data directory to storage Docker manages outside the container, so
  it outlives the container and is only removed by an explicit `down -v`.
- **The healthcheck.** Compose polls `pg_isready` so `backend` can wait for
  `condition: service_healthy` — Postgres *accepting connections*, not merely
  "the container started". Without it the backend races the database on a cold
  start and crashes on the first connection attempt.

The `5432:5432` port mapping is a convenience for GUI clients on your Mac. The
backend does not use it; containers reach each other over Compose's internal
network instead.

### 2. SQLAlchemy models — [backend/app/models.py](backend/app/models.py)

Python classes that map to tables. This file is the source of truth for the
schema; [Alembic](#3-migrations--backendalembic) is what applies it to a database.

Three tables: `users`, `categories`, `subscriptions`. Details worth noticing:

- **`Numeric(10, 2)` for money, never `Float`.** Binary floating point cannot
  represent `0.10` exactly; summing a column of them drifts. `Numeric` maps to
  Postgres `NUMERIC` and arrives in Python as `Decimal`, which is exact.
- **`user_id` is `nullable=False` and indexed.** Not-null means a row can never
  end up orphaned and visible to everyone; the index exists because *every*
  query in crud.py filters on it.
- **Constraints live in the database, not only in code.** `users.email` is
  `unique=True`, so a duplicate signup is rejected by Postgres even if two
  registrations race past the application's own check. `categories` carries a
  composite `UniqueConstraint(user_id, name)`: two users may both have "Music",
  one user may not have it twice.
- **`Subscription.category` is a plain string, not a foreign key** to
  `categories`. That is a deliberate trade: a subscription is never blocked by a
  missing category row, and clients can keep sending just a name.
  `crud.ensure_category` is what keeps the two in step.

Editing this file is only half of a schema change; the other half is a
migration, below.

### 3. Migrations — [backend/alembic/](backend/alembic/)

Alembic owns the schema. This used to be `Base.metadata.create_all()` at
startup, which creates missing *tables* and never alters an existing one — so
every column added (`user_id`, then `cancelled_date` and `started_date`) cost a
`docker compose down -v` or a hand-written `ALTER TABLE`. Survivable while the
only data is local test rows, and not survivable at all once a deployed
database holds anything worth keeping.

The backend container runs `alembic upgrade head` before uvicorn starts, from
[entrypoint.sh](backend/entrypoint.sh) — so `docker compose up` needs no
migration step of its own. Three details in how that is wired:

- **It is an `ENTRYPOINT`, not part of the `CMD`.** A `command:` in
  docker-compose.yml replaces `CMD` but not `ENTRYPOINT`, so overriding how the
  app starts (as local dev does, to add `--reload`) cannot skip the migration.
- **A failed migration stops the container.** Better a loud failure on start
  than an app serving requests against a schema its code does not match.
- **The first revision adopts a database that predates Alembic.** It creates
  each table only if it is absent, so running it against an existing Compose
  volume records the revision instead of failing on "table users already
  exists". Migrations could otherwise only be adopted by throwing the data
  away.

Adding a schema change, from `backend/`:

```
alembic revision --autogenerate -m "what changed"   # diff models.py, draft it
alembic upgrade head                                # apply it
```

Always read what `--autogenerate` produced: it diffs models.py against the live
database and is good at columns and indexes, but it cannot know that a new
not-null column needs a default for existing rows, and it does not see a rename
— only a drop and an add.

`alembic current` shows where a database stands, `alembic downgrade -1` steps
back one revision.

The pairing that keeps this honest is in the test suite: the fixtures build the
schema from models.py, and `test_migrations.py` asserts that
`alembic upgrade head` on an empty database produces exactly that same schema.
A model edited without a migration passes every other test and fails that one.

### 4. Pydantic schemas — [backend/app/schemas.py](backend/app/schemas.py)

The API contract. FastAPI uses these classes to parse and validate every
request body, and to shape every response.

Validation is declarative — you write the type, not the check:

- `EmailStr` rejects a malformed address before it reaches the database.
- `password: str = Field(min_length=8, max_length=72)` — the upper bound exists
  because bcrypt hashes at most 72 bytes and *raises* beyond that. Declaring it
  turns a would-be 500 into a clean 422.
- `StringConstraints(strip_whitespace=True, min_length=1)` on category names
  means `"  "` can never become an unpickable blank category.
- `@model_validator` handles rules spanning two fields, like "cancelled before
  started" — a typo that would otherwise total silently to zero every month.

A schema failure produces a **422** whose `detail` is a *list of per-field
objects*, whereas `HTTPException` produces a `detail` string. That is the exact
divergence `formatError` in [frontend/src/api.js](frontend/src/api.js) flattens.

Three patterns recur here and are worth recognising:

- **`from_attributes=True`** lets a schema be built straight from a SQLAlchemy
  row, reading attributes instead of dict keys. It is why handlers can return
  ORM objects directly.
- **Separate Create / Update / Read classes.** `SubscriptionUpdate` makes every
  field optional so `PUT` can carry one field; `crud` then uses
  `model_dump(exclude_unset=True)` so absent fields aren't overwritten with
  `None`. The distinction between "sent as null" and "not sent" is real, and
  this is how it survives.
- **`Money = Annotated[Decimal, PlainSerializer(float)]`.** Pydantic v2 renders
  a bare `Decimal` as a JSON *string* (`"15.99"`). The summary routes predate
  having a `response_model` and emitted a number. Keeping `Decimal` for the
  arithmetic and converting only at serialization preserves both the exactness
  and the wire format.

### 5. crud.py — [backend/app/crud.py](backend/app/crud.py)

Every database operation, and nothing else. No `HTTPException`, no status codes:
a function that finds nothing returns `None`, and the route decides that means
404. That separation is what would let the same functions serve a CLI or a
background job.

**The security boundary lives here.** Every subscription and category function
takes a `user_id` and filters on it. The route handlers pass the id from the
verified token — never one supplied by the client — so there is no request shape
that reads another account's rows.

Two techniques worth studying:

- **`get_categories` does one grouped query with an outer join**, returning each
  category with a count of the subscriptions using it, instead of a count query
  per category. Listing N categories stays one round trip rather than N+1. The
  join matches on lowercased names, since a subscription may have been saved
  with different capitalisation.
- **Transaction boundaries are chosen, not accidental.** `ensure_category` calls
  `db.add` but never `db.commit`, so the new category and the subscription that
  introduced it are saved together or not at all. `import_backup` is one
  transaction over the whole file: a file that fails half way leaves the account
  exactly as it was. And because the session is `autoflush=False`, a category
  added a moment ago is invisible to a query until commit — which is why the
  import resolves names against a dict read once up front instead of asking the
  database per row.

### 6. main.py — [backend/app/main.py](backend/app/main.py)

The HTTP layer, and the only file that knows what a status code is.

**Routes as annotated functions.** `@app.post("/subscriptions", response_model=schemas.Subscription, status_code=201)`
says what the route accepts and returns. `response_model` is not documentation —
it *filters*: fields absent from the schema are dropped on the way out.

**Dependency injection with `Depends`** is the concept that carries the most
weight. Two dependencies appear on nearly every route:

- `db: Session = Depends(get_db)` — [database.py](backend/app/database.py)
  defines `get_db` as a generator. FastAPI runs it up to the `yield` before the
  handler, hands over the session, and runs the `finally` after the response is
  sent — so the session is closed even if the handler raised. Dependencies are
  cached per request, so the route and the auth dependency share one session,
  and therefore one transaction.
- `current_user: models.User = Depends(auth.get_current_user)` — validates the
  token and returns the `User`, or rejects with 401 **before the handler body
  runs**. That is why `delete_subscription` never asks "is this user logged
  in?": by the time it executes, they are.

**Query parameters are typed too.** `billing_cycle: BillingCycle | None` means
`?billing_cycle=weekly` comes back as a 422 instead of quietly matching nothing;
`year: int = Query(ge=1970, le=9999)` bounds the range without an `if`.

**Status codes are chosen to mean something.** 409 rather than 400 for a
duplicate category — the request is well-formed, it just collides. 409 again
when deleting a category still in use, with the error naming how many
subscriptions would be affected and what to pass (`reassign_to` or `detach`)
rather than silently stripping the category off rows the caller forgot about.

**CORS middleware.** The page is served from `localhost:5173` and the API from
`localhost:8000` — different origins, which browsers block by default.
`CORSMiddleware` allows that one origin. Because the token travels in a header
rather than a cookie, no CSRF or SameSite configuration is needed.

**The OpenAPI metadata is functional.** The `title`, `description` and
`openapi_tags` on the `FastAPI(...)` call, plus the `tags=` on every route, are
what `/docs` and `/redoc` render — all generated from the same `/openapi.json`
that the type annotations feed, and the same document that gets published to
[GitHub Pages](https://juusimaa.github.io/subscription-tracker). Every docstring
and `description=` on a `Query` is therefore public API documentation, not just
a note to the next reader.

> Note the routes are `def`, not `async def`. That is correct here: SQLAlchemy's
> synchronous `Session` blocks, and FastAPI runs plain `def` handlers in a
> threadpool. Marking them `async` without an async driver would block the event
> loop and *hurt* concurrency.

### 7. auth.py — [backend/app/auth.py](backend/app/auth.py)

Password hashing, token minting, and the dependency that turns an
`Authorization` header into a `User`.

- **Passwords are bcrypt-hashed, never stored or logged.** bcrypt generates a
  random salt per call and embeds it in the output, so two users with the same
  password still get different hashes. `checkpw` compares in constant time.
- **`SECRET_KEY` is read with no fallback.** A hardcoded default would get
  committed, and anyone reading the repo could then mint a token for any
  account. Refusing to start is the safer failure.
- **A JWT is signed, not encrypted.** Anyone holding one can read its claims —
  paste one into jwt.io and see. That is fine for a user id and an expiry, and
  the reason nothing secret goes in there. What the signature buys is that `sub`
  cannot be changed to another user's id without the key.
- **The user is loaded fresh from the database on every request**, not trusted
  from the token's contents, so a deleted account stops working immediately
  instead of remaining valid until its token expires.
- **Failures are deliberately indistinguishable.** A bad signature and an
  expired token give the same 401; login answers "incorrect email or password"
  for both a missing user and a wrong password, so the endpoint can't be used to
  enumerate which addresses have accounts.
- **`/token` follows the OAuth2 password flow**, which fixes the field names as
  `username` and `password` — so the email goes in `username`. Following the
  spec is what makes the **Authorize** button on `/docs` a real login.

Nothing invalidates an issued token, so the 12-hour expiry is the only thing
that ever revokes one; logout is purely client-side. Real revocation needs a
token blocklist, which is out of scope here.

### 8. React frontend — [frontend/src/](frontend/src/)

Vite serves the app in dev and builds it to static files for production. There
is no framework beyond React itself, no router and no state library — one
screen, so `useState` is the right amount of machinery.

The UI is the **spending dashboard** from the design handoff: a headline total
for a selected period, a trend strip, four KPIs, spend by category, the charges
coming up, the full subscription list with inline editing, and the import
and export panel at the page foot. The split is
[App.jsx](frontend/src/App.jsx) for the data and the error states,
[dashboard/](frontend/src/dashboard/) for the view. That line is where the
design's most demanding rule lives: **a failed fetch must never blank the
page** — the last known good data stays on screen under a banner saying how
old it is, which only works if the thing holding the data is not the thing
rendering the failure.

- **Every colour, size and space is a token.** The design system's stylesheet
  is vendored as [modernist.css](frontend/src/modernist.css) and is the source
  of truth; [dashboard.css](frontend/src/dashboard.css) only arranges things.
  Zero border radius anywhere, everything flush left, 2px rules between major
  sections and 1px between peer rows.
- **The period drives everything.** One `{ view, year, month }` selection feeds
  the headline, the KPIs, the category bars, the Coming up list and the trend
  highlight, so they cannot disagree. The figures behind it are the server's
  real month-by-month totals from `/subscriptions/summary/spend`, one request
  per year in the 2025–2027 range.
- **Errors appear where the user can act on them.** Field problems render at
  the field, transport and auth problems as a strip at the top of the page, a
  record deleted elsewhere in the row it affects. Nothing is a toast.

- **[api.js](frontend/src/api.js) is the only file that knows the backend
  exists.** One `request()` wrapper attaches the bearer token, normalises
  errors, and handles `204 No Content` (a `DELETE` has no body to parse). Every
  other module calls named functions like `getSubscriptions()`.
- **The 401 path is centralised.** When the backend rejects a token, `request()`
  clears it and dispatches an `auth-expired` event. What `App.jsx` does with it
  depends on whether there is a page worth keeping: with no data it drops to
  the login screen, and with a rendered dashboard it shows a quiet strip under
  the header instead. The figures are still worth reading — only writes will
  fail — and signing in from there keeps the period, sort and scroll position.
- **The token lives in `localStorage`**, so a reload keeps you logged in while a
  different browser or private window starts logged out. `App.jsx` initialises
  its state lazily from it, then calls `/me` to check the token is still valid
  before showing the app.
- **`VITE_API_URL` is `localhost:8000`, not `backend:8000`.** Only variables
  prefixed `VITE_` are exposed to client code, and they are inlined into the
  bundle at build time — this value is used by code running in *your browser*,
  which knows nothing of Docker's internal network. It is also why the signing
  key is never a `VITE_` variable.
- **[services.js](frontend/src/services.js) is a client-side catalogue** of
  well-known services: the brand tile drawn beside a name, and a typical price
  for the empty state's one-tap tiles. Nothing about it is stored — the API has
  no home for a brand colour or a monogram — so adding a service is an edit to
  one file rather than a migration.
- **[backup.js](frontend/src/backup.js) reads and diffs an import file** —
  `.csv` and `.json` both become the body `POST /import` accepts, and the
  summary dialog's Add / Update / Unchanged ledger is computed from the real
  records on screen rather than estimated. Both halves are here rather than on
  the server because the design requires the diff *before* anything is written;
  a bad row is reported by name and row number, since editing that file is the
  user's only repair path.
- **[renewals.js](frontend/src/renewals.js) mirrors the backend's date
  arithmetic**, because `/subscriptions/upcoming` is anchored to today while
  the period picker reaches back to 2025 and forward to 2027. It is a mirror,
  not the truth; the comment at the top says exactly where it can differ.

### 9. Docker & Compose

**[backend/Dockerfile](backend/Dockerfile)** — `python:3.13-slim` for a smaller
image and attack surface. `requirements.txt` is copied and installed *before*
the app code, so Docker's layer cache reuses the install step on every rebuild
where dependencies haven't changed; only the fast `COPY app` layer below it
re-runs. Its `ENTRYPOINT` is
[entrypoint.sh](backend/entrypoint.sh), which applies migrations and then
`exec`s the `CMD` — `exec` so uvicorn becomes PID 1 and receives Docker's
`SIGTERM` directly, instead of a shell swallowing it and the container being
killed after the grace period.

**[frontend/Dockerfile](frontend/Dockerfile)** is a **multi-stage build**, the
technique worth taking away from this project. The `build` stage uses Node to
compile React into static files; the `production` stage copies just those files
into `nginx:alpine`. Node is needed to *build* the app but not to *serve* it, so
it never ships — the published image is a web server plus static assets.

**[docker-compose.yml](docker-compose.yml)** wires the three together for local
development:

- **Service names are hostnames.** Compose puts every service on one network and
  gives it a DNS name matching its key, which is why `DATABASE_URL` points at
  `db:5432`. This name resolves only between containers.
- **`depends_on: condition: service_healthy`** waits for a real readiness
  signal, not just process start.
- **Bind mounts give hot reload.** `./backend/app:/app/app` maps your source
  into the container so uvicorn's `--reload` picks up edits without a rebuild.
  Only source is mounted — dependencies installed by the Dockerfile stay in the
  image.
- **Dev overrides production defaults here, not in the Dockerfile.** Compose
  overrides the backend `CMD` to add `--reload`, and targets the frontend's
  `build` stage to run Vite's dev server instead of Nginx. The Dockerfiles keep
  the production forms, which is exactly what CI publishes. Note what the
  override does *not* reach: `CMD` is replaced, `ENTRYPOINT` is not, so local
  dev still gets its migrations applied.

### 10. CI — [.github/workflows/](.github/workflows/)

Three workflows, each triggered by what it actually depends on:

| Workflow | Runs on | Does |
| --- | --- | --- |
| [`test.yml`](.github/workflows/test.yml) | pushes and **pull requests** touching `backend/**` | The test suite, twice — against SQLite and against Postgres 16 |
| [`build-and-push.yml`](.github/workflows/build-and-push.yml) | pushes to `main` | Builds both images, publishes them to GHCR |
| [`docs.yml`](.github/workflows/docs.yml) | pushes to `main` touching `backend/**` or `docs/**` | Generates `openapi.json` from the app and publishes the [API reference](https://juusimaa.github.io/subscription-tracker) |

`test.yml` is the only one that also runs on pull requests: a suite that only
runs after a merge reports the problem too late to be worth much. It runs both
database legs because they are not the same database in the way that matters —
Postgres returns a `Numeric` column as a `Decimal`, SQLite as a float — so
Postgres is the leg that must be green, and the SQLite leg is what stops the
zero-setup `pytest` path from quietly rotting.

**Images.** Every push to `main` builds both and pushes them to GitHub Container
Registry:

- `ghcr.io/<owner>/subscription-tracker-backend`
- `ghcr.io/<owner>/subscription-tracker-frontend`

Each is tagged `latest` and `sha-<short commit>` — the immutable tag is what a
deployment should pin to, since `latest` moves. The frontend image is the Nginx
production stage, never the Vite dev server Compose runs locally.

Patterns worth copying, visible across the three: a **matrix** runs one job
definition twice instead of two near-identical copies (once per image in the
build, once per database in the tests); **`paths`/`paths-ignore`** keep a
workflow from running for commits it cannot be affected by; **`concurrency`
with `cancel-in-progress`** cancels a superseded run — except in `docs.yml`,
where cancelling half way through a deployment is how a site ends up broken;
and **`permissions`** grants the automatic `GITHUB_TOKEN` only what each job
needs, so the build can publish images but cannot push commits, and the tests
can do neither.

Packages are private by default — make them public, or `docker login ghcr.io`
with a personal access token, to pull them elsewhere. Nothing deploys these yet;
that's milestone 7.

---

## A request end to end

`POST /subscriptions`, from the click to the row appearing — every layer above,
in order.

1. **Browser.** `createSubscription(data)` in [api.js](frontend/src/api.js)
   builds a `fetch` with `Content-Type: application/json` and
   `Authorization: Bearer <token>`. Note what the body does *not* contain: any
   notion of who owns the row.
2. **CORS preflight.** Because the request carries a custom header, the browser
   first sends `OPTIONS /subscriptions` and waits. `CORSMiddleware` answers it;
   the handler never runs. Only then is the real POST sent. (This is why a
   missing origin shows up as an opaque network error rather than a 4xx.)
3. **uvicorn** parses the HTTP and calls the ASGI app.
4. **Routing.** FastAPI matches method + path to `create_subscription`.
5. **Dependencies resolve first.** `get_db` opens a session and suspends at its
   `yield`. `oauth2_scheme` pulls the bearer token. `get_current_user` verifies
   the signature and expiry, then loads the `User` — using the *same* cached
   session. Any failure here is a 401 and the handler never runs.
6. **Body validation.** The JSON is parsed into `SubscriptionCreate`: `cost`
   becomes `Decimal`, dates become `date`, `billing_cycle` becomes the enum. A
   bad payload is a 422 nobody had to write.
7. **The handler runs in a threadpool** (it is `def`) and delegates to
   `crud.create_subscription`, which unpacks the schema into a model, adds
   `user_id` *separately* from the token, registers the category, defaults
   `started_date` to today, then `add` → `commit` → `refresh` (the refresh loads
   the database-assigned `id`).
8. **The response model shapes the output.** The returned ORM object is read
   through `schemas.Subscription` — possible thanks to `from_attributes=True` —
   which drops anything not on the schema and encodes `Decimal` and `date` to
   JSON. Status 201.
9. **Back out through CORS middleware**, which stamps the
   `Access-Control-Allow-Origin` header the browser requires.
10. **Teardown.** FastAPI resumes `get_db`; its `finally` closes the session and
    returns the connection to the pool.
11. **Frontend** parses the JSON and gets the new `id`, which React needs as a
    list key and for later `PUT`/`DELETE`.

**When the token has expired**, the path diverges at step 5: no body is ever
read, no database write is attempted, and the 401 sends the UI back to the login
screen.

---

## API reference

Everything except the first three requires `Authorization: Bearer <token>`, and
only ever sees the calling user's own data.

**Published reference: https://juusimaa.github.io/subscription-tracker** — the
full API, browsable without running anything. It is generated from the app
itself: `.github/workflows/docs.yml` imports the FastAPI application on every
push to `main`, dumps its `openapi.json`, and publishes it with the Redoc page
in [`docs/index.html`](docs/index.html). Nothing there is written by hand, so it
cannot drift from the routes it describes.

Running locally, the same spec is served interactively at
http://localhost:8000/docs (Swagger UI) and http://localhost:8000/redoc.

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/health` | Readiness check, used by Docker's healthcheck: 200 only if a `SELECT 1` reaches the database, 503 otherwise. Unauthenticated. |
| `POST` | `/register` | Create an account. |
| `POST` | `/token` | Exchange email + password for a JWT (form-encoded; email goes in `username`). |
| `GET` | `/me` | The logged-in user — used to check a stored token is still valid. |
| `GET` | `/subscriptions` | List, with optional `category`, `billing_cycle`, `status`, `active` filters. |
| `POST` | `/subscriptions` | Create one. |
| `GET` | `/subscriptions/upcoming` | What is about to be charged: every renewal in the next `days` (default 30), with the full amount due on each day, plus any trial converting in the window. |
| `GET` | `/subscriptions/{id}` | Fetch one. |
| `PUT` | `/subscriptions/{id}` | Partial update — send only the fields that change. |
| `DELETE` | `/subscriptions/{id}` | Delete one. |
| `GET` | `/subscriptions/summary/monthly-total` | What is being paid *now*: active subscriptions normalised to a monthly figure, plus the yearly equivalent. |
| `GET` | `/subscriptions/summary/spend` | What a period *cost*: month-by-month breakdown for a year, each charge counted in the month it was taken, stopped plans included up to the day they stopped. |
| `GET` | `/categories` | Categories with a count of the subscriptions using each. |
| `POST` | `/categories` | Add an empty category. |
| `PUT` | `/categories/{id}` | Rename, relabelling every subscription using the old name. |
| `DELETE` | `/categories/{id}` | Delete; needs `reassign_to=<id>` or `detach=true` if still in use. |
| `GET` | `/export` | The whole account as one file — `?format=json` (the backup) or `?format=csv` (the spreadsheet version). |
| `POST` | `/import` | Read such a document back — `?mode=merge` (the default) or `?mode=replace` for a true restore. |

The two summary routes answer genuinely different questions, which is why they
are separate endpoints rather than one with a flag: `monthly-total` counts only
what is billing right now, expressed as a rate, so a yearly plan is shown at a
twelfth of its price. `spend` counts money that actually moved, in the month it
moved: a yearly plan is one charge for its full price in the month it renews,
and a plan cancelled or paused in June keeps every charge taken up to that day.
A €149.99 yearly plan taken out in October 2025 therefore reads as €149.99 in
2025, not the €37.50 an amortized figure would leave in the year.

`upcoming` is a third question again — the same arithmetic as `spend`, pointed
forwards: it lists the charges still to come rather than totalling up the ones
already made. A monthly plan appears once per renewal, so it is listed three
times in `?days=90`.

### Subscription statuses

A subscription is `active`, `trial`, `paused` or `cancelled`. The distinction
that matters is that three of those do not bill, and they do not mean the same
thing:

- **`trial`** is running and free. It counts toward no total, converts **once**
  on its renewal date — which is therefore never rolled forward — and appears
  in `upcoming` on that day at a cost of `0`, with the real price in the nested
  subscription so a client can say "then €9.99/mo".
- **`paused`** has stopped billing but is expected back. What it cost *before*
  the pause is still real history: `paused_date` records when it stopped, and
  `spend` counts every month up to it. Without that date a pause would
  retroactively erase a year of spend.
- **`cancelled`** has stopped for good, with `cancelled_date` playing the same
  role — and a yearly plan keeps counting to the end of the term already paid
  for. Pausing and *then* cancelling keeps the pause date, because that is when
  the money actually stopped.

The older `active` boolean still works, on the way in and the way out: it maps
to active-or-cancelled exactly as it always did, so trial and paused both report
`false`. Sending `status` and `active` together is fine when they agree and a
422 when they contradict each other — guessing which half was meant would
silently cancel a subscription or silently revive one. As a *filter*,
`active=false` means every status that does not bill; use `status=cancelled` to
ask for cancelled rows specifically.

### Renewal dates

`next_renewal_date` is written like a date and read like a schedule. What a
client sends is the **anchor** the billing schedule is measured from; what comes
back is the next renewal *derived* from it — the first one falling on or after
today. Nothing rolls the stored value forward, so it cannot go stale: a
subscription added in 2020 and never touched since still reports the right date
today, and no scheduled job or write-on-read is involved.

Two consequences worth knowing:

- Sending a date in the past is fine, and is usually the right thing to do when
  adding a subscription you have had for a while — it says when the plan started
  billing.
- Whole calendar months are used, not 30-day steps, so a plan anchored on the
  31st bills on the 28th in February and is back on the 31st in March.

A cancelled subscription is measured from the day it was cancelled rather than
from today, so it reports the renewal that *would* have come next — the day the
term already paid for runs out, which is what lets `spend` count a cancelled
yearly plan to the end of that term.

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
hours; a different browser or device starts logged out. On
http://localhost:8000/docs the **Authorize** button logs the docs page in the
same way.

## Backup and restore

`GET /export` returns everything in the logged-in account as one file — its
subscriptions and its category list, including categories nothing uses yet.
Both formats carry a `Content-Disposition` filename, so `curl -OJ` lands a
dated file on disk without naming it:

```
curl -OJ localhost:8000/export -H "Authorization: Bearer $TOKEN"
curl -OJ 'localhost:8000/export?format=csv' -H "Authorization: Bearer $TOKEN"
```

**JSON is the backup and CSV is the interchange format.** A JSON round trip
reproduces the account exactly. A CSV is one row per subscription, which a
spreadsheet opens and a person can hand-edit — and which has nowhere to keep a
category nothing is using, or the file's `version` stamp. Its columns are
`name,category,status,cycle,cost,next_renewal` (the order the design handoff
pins) followed by `started_date,cancelled_date,paused_date`: without those
three, re-importing an export would silently rewrite when each subscription
started and stopped, and every past month in the spend summary with it.

`POST /import` reads a file back. It takes JSON only — the frontend parses a
dropped `.csv` into this shape itself, because it has to read the file anyway
to show the summary before anything is written. The file carries no ids, no
email and no password hash, so a backup restores into a fresh account just as
well as the one it came from:

```
curl -X POST 'localhost:8000/import?mode=merge' -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d @backup.json
```

`mode=merge` is the default because it is the one that cannot delete anything.
A row whose name matches one already in the account (trimmed, case-insensitive)
**updates** that subscription; a row with no counterpart is added. So importing
the same file twice is a no-op, and importing an edited file does what it looks
like it does — which is the whole workflow this exists for: export, edit the
file, read it back. Two rows of the same name are paired off in order against
two subscriptions of that name, because a user really can have two Netflix
accounts.

`mode=replace` is the true restore: it deletes the account's existing
subscriptions and categories first, so the account ends up matching the file
exactly. Either way the import is one transaction; a file that fails part way
through leaves the account untouched. The response says what happened:

```
{"mode":"merge","subscriptions_imported":1,"subscriptions_updated":1,
 "subscriptions_unchanged":10,"subscriptions_removed":0,"categories_imported":1}
```

`?replace=true` is still accepted as the older spelling of `mode`. Sending both
is a 422 unless they agree — guessing which half of a contradiction the caller
meant would empty an account on a coin flip.

The file carries a `version` field. A file whose version this build doesn't
read is refused with a 400 rather than imported on a guess.

## Tests

```
cd backend
pip install -r requirements-dev.txt
pytest
```

143 tests, no services required: `conftest.py` points the app at a throwaway
SQLite file, so a clean checkout can run the suite with nothing else started.
To run the identical suite against real Postgres — the one place the two
databases differ is `Numeric`, which comes back as a `Decimal` from Postgres
and a float from SQLite:

```
docker compose up -d db
docker compose exec db psql -U postgres -c "CREATE DATABASE subscriptions_test;"
TEST_DATABASE_URL=postgresql+psycopg://postgres:devpassword@db:5432/subscriptions_test pytest
```

What they cover, and why those things:

| File | What it pins down |
| --- | --- |
| `test_renewals.py` | The date arithmetic, directly: month-end clamping that does not stick, leap days, and the property that a derived renewal is never in the past. |
| `test_isolation.py` | That one user cannot read, edit or delete another's rows — as a **404**, not a 403, which would confirm the id exists. |
| `test_spend.py` | The spend arithmetic: a monthly plan cancelled in June, a yearly plan cancelled the day after renewing, and rows with unknown dates. |
| `test_subscriptions.py` | The derived renewal date through the API, the cancellation bookkeeping, and every validation rule that has already reached the database once. |
| `test_upcoming.py` | The window, one entry per charge, and what is deliberately left out. |
| `test_status.py` | The four subscription statuses: that a pause stops the spend without erasing the months already billed, that a trial costs nothing and converts once, and that the legacy `active` boolean still means what it always meant. |
| `test_migrations.py` | That the revisions and `models.py` describe the same schema, that a downgrade leaves nothing behind, and — since revision 0002 — what a data migration does to the rows themselves. |

Two conventions worth keeping if you add more: no test may depend on what
today's date is (the spend tests all use a year fully in the past), and tests
call the API over HTTP rather than `crud.py` directly, because the status code
is as much a part of the contract as the body.

CI runs all of this on every push and pull request that touches `backend/`,
against both databases — see [`test.yml`](.github/workflows/test.yml). The badge
at the top of this README is that workflow's result on `main`; it is scoped to
`branch=main&event=push` so an in-flight pull request cannot turn it red.

It goes red if *either* database leg fails, which is the point of running both.

## Deliberate simplifications

Things a production app would do differently, listed so they read as choices
rather than oversights:

- **The tests cover the backend only.** The suite (see [Tests](#tests)) runs in
  CI against both databases, but nothing tests the React frontend, and no test
  drives a browser.
- **No token revocation.** Logout is client-side only; the 12-hour expiry is the
  only thing that invalidates a token.
- **CORS allows exactly one hardcoded origin**, which will need to become
  configurable before a deployed frontend can call the API.
- **Postgres runs as the superuser** with a password from `.env`; a real
  deployment would use a least-privilege role and a managed secret store.
- **Some of the dashboard is computed client-side because the API cannot
  answer it yet**: the charges in an arbitrary month (the `upcoming` route only
  looks forward from today), and the per-category split for a period, which
  costs one request per category instead of one grouped response. Both are
  written up as D2 and D3 in [TODO.md](TODO.md).
- **No currency anywhere in the schema.** `cost` is a bare `Numeric(10, 2)` and
  the frontend hardcodes EUR, which is an unstated assumption rather than a
  decision anyone made.

## Project layout

```
backend/
  Dockerfile          # python:3.13-slim, deps cached before app code
  requirements.txt
  requirements-dev.txt # test-only deps; never installed into the image
  pytest.ini          # so `pytest` alone works from backend/
  entrypoint.sh       # runs `alembic upgrade head`, then execs the app
  alembic.ini         # migration config; the URL comes from DATABASE_URL
  alembic/            # env.py + versions/ — the schema's history
  tests/              # see Tests above
  app/
    main.py           # FastAPI app: routes, status codes, CORS, OpenAPI metadata
    backup_csv.py     # the CSV side of GET /export (JSON is the real backup)
    auth.py           # bcrypt hashing, JWT mint/verify, get_current_user dependency
    schemas.py        # Pydantic: the API contract (validation + serialization)
    crud.py           # every database query, all scoped by user_id
    models.py         # SQLAlchemy tables — source of truth for the schema
    database.py       # engine, session factory, get_db dependency
docs/
  index.html          # Redoc page for the published API reference
.github/workflows/
  test.yml            # pytest on SQLite and Postgres, on push and PR
  build-and-push.yml  # builds and publishes both images to GHCR
  docs.yml            # publishes the API reference to GitHub Pages
frontend/
  Dockerfile          # multi-stage: Node builds, Nginx serves
  src/
    App.jsx           # auth gate, data loading, and the page-level error states
    api.js            # the only module that talks to the backend
    backup.js         # parses an import file and diffs it against the page
    Login.jsx         # register / log in; also the re-auth dialog
    modernist.css     # the design system's tokens and component classes
    dashboard.css     # layout for the dashboard, built from those tokens
    format.js         # money, dates, and the period range
    renewals.js       # client-side mirror of backend/app/renewals.py
    services.js       # brand tiles and the quick-add catalogue
    icons.jsx         # the four Lucide glyphs the design uses
    MonoTile.jsx      # the 20px brand square
    dashboard/        # Hero, TrendStrip, KpiBand, CategoryBars, ComingUp,
                      # TrialBanner, SubscriptionTable, AddForm, ImportExport,
                      # dialogs
docker-compose.yml    # db + backend + frontend for local dev
.env.example          # every variable the stack reads
.github/workflows/    # CI: build and push images to GHCR
PLAN.md               # project plan and milestones
```
