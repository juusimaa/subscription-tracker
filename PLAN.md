# Subscription Tracker — Project Plan

A learning project to get hands-on with **Docker**, **PostgreSQL**, and a **CI/CD pipeline to Azure**, by building a simple app that tracks recurring subscriptions (Netflix, HBO, etc.).

## Stack

- **Backend:** Python + FastAPI + SQLAlchemy, talking to Postgres
- **Frontend:** React (Vite), calling the API
- **Database:** PostgreSQL
- **Containers:** 3 total — `frontend`, `backend`, `db`

## Data model (minimal to start)

- `subscriptions` table:
  - name (Netflix, HBO, ...)
  - cost
  - billing cycle (monthly/yearly)
  - next renewal date
  - category
  - active / cancelled
  - user_id — owner of the row (added in milestone 6)
- `users` table (milestone 6):
  - email (unique)
  - hashed_password (bcrypt — never the plaintext)
- Later, optional: `payment_history` table to track past charges

## Folder structure

```
docker-subscription-tracker/
├── backend/
│   ├── app/            # FastAPI app, models, routes
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml   # local dev: frontend + backend + postgres
├── .github/workflows/
│   └── build-and-push.yml
└── README.md
```

## Milestones

1. ~~**Backend first, no Docker yet**~~ ✅ — FastAPI + Postgres running locally, CRUD endpoints for subscriptions (list/add/edit/delete, maybe a "total monthly spend" endpoint). This is where the Postgres basics get learned.
2. ~~**Dockerize the backend**~~ ✅ — Dockerfile, connect to a Postgres container via Compose, use env vars for the connection string, add a named volume so data persists across restarts.
3. ~~**Build the frontend**~~ ✅ — simple React UI (list subscriptions, add/edit form, total cost summary), Dockerized as its own container, calling the backend API.
4. ~~**docker-compose.yml**~~ ✅ ties all three together for local dev (`docker compose up`).
5. **GitHub Actions** — on push, build both images, push to GitHub Container Registry.
6. ~~**Multi-user auth (JWT)**~~ ✅ — add a `users` table and scope every subscription to its owner, so the app is safe to expose publicly in step 7. Details below.
7. **Deploy to Azure Container Apps** — backend + frontend as two container apps. Postgres either via Azure Database for PostgreSQL (flexible server) or kept in a container to stay fully free.

## Milestone 6 — JWT auth (done)

Hand-rolled with FastAPI's `OAuth2PasswordBearer`, rather than a hosted identity
provider (Auth0, Entra ID). No new containers, and local Compose dev works as it
did before. Four new backend dependencies: `pyjwt` and `bcrypt` for the tokens
and hashing, plus `email-validator` (backs Pydantic's `EmailStr`) and
`python-multipart` (required to parse the form-encoded body the OAuth2 password
flow uses -- `/token` fails at import without it).

**How it works:** the user logs in with email + password, the backend checks the
bcrypt hash and returns a signed token (`{"sub": user_id, "exp": ...}`). The
frontend stores it in `localStorage` and sends it as `Authorization: Bearer ...`
on every later request. The token is *signed, not encrypted* — readable by
anyone, forgeable by no one, since only the server holds `SECRET_KEY`. So the
payload carries an id and an expiry, never anything secret.

**Backend changes:**

- New `app/auth.py` — password hashing, token creation, and a `get_current_user`
  dependency that decodes the token and loads the user. The user is re-read from
  the database on every request rather than trusted from the token's claims, so
  a deleted account stops working immediately.
- `GET /me` — added during implementation, not in the original sketch. The
  frontend calls it on startup to find out whether a token left in
  `localStorage` is still valid, instead of rendering the app and discovering
  the answer from a failed data fetch.
- `models.py` — a `User` model, plus a `user_id` foreign key on `Subscription`.
- `crud.py` — every function takes `user_id` and filters on it. This includes
  the single-row lookups: filtering only by `id` on update/delete would let one
  user edit another's rows by guessing an integer.
- `main.py` — `POST /register` and `POST /token`, and
  `Depends(get_current_user)` on every subscription route, `monthly_total`
  included.
- `SECRET_KEY` read from the environment, added to `.env.example` and
  `docker-compose.yml` alongside `DATABASE_URL`. Never a hardcoded default — a
  committed key lets anyone mint a token for any account.

**Frontend changes** (~80 lines; the existing form/table/summary is untouched and
just renders one level deeper):

- A `Login.jsx` with email/password and a register toggle.
- A gate in `App.jsx`: no token means render `<Login>` instead of the app, and
  don't fetch subscriptions until there is one.
- A logout button — remove the token from `localStorage`, clear the state.
- 401 handling in `api.js` — clear the token and return to login, so an expired
  session doesn't surface as a raw "Request failed: 401" over an empty table.

Because the token rides in a header rather than a cookie, this skips
`SameSite`/`Secure` cookie config, `allow_credentials`, and CSRF entirely. The
existing CORS block already allows the `Authorization` header via
`allow_headers=["*"]`, so it needs no change. The tradeoff is that a token in
`localStorage` is exposed to any XSS on the page; acceptable here, and revisited
if this ever stops being a learning project.

**Verified end to end:** unauthenticated requests are rejected while `/health`
stays open for Docker's healthcheck; two users see only their own rows and
totals; one user's GET/PUT/DELETE against another's subscription id returns 404;
forged and expired tokens are both 401; a wrong password and an unknown email
give the identical message, so accounts can't be enumerated; and the backend
refuses to boot without a `SECRET_KEY`.

**Deliberately not built:** logout is client-side only -- the discarded token
stays cryptographically valid until it expires, since real revocation needs a
token blocklist. There is also no password reset and no email verification. The
12-hour expiry is the only thing that ends a session.

**Session behaviour to expect:** `localStorage` is per-origin, per-browser. Same
browser tomorrow means still logged in (until the token expires); a different
browser, device, or private window means the login screen again. Logging in from
two browsers gives two independent valid tokens — nothing invalidates the older
one, which is why the expiry is kept short.

## Notes / rationale

- Auth landed *before* the Azure deploy, not after, for two reasons. The schema
  has no migration tool — `Base.metadata.create_all()` only creates missing
  tables, so adding a non-null `user_id` to `subscriptions` is a
  `docker compose down -v` while the only data is local test rows, and a real
  migration once there's an Azure database worth keeping. (Implementing it did
  in fact require a `down -v`.) And step 7 puts
  `POST`/`DELETE` endpoints on a public URL, which shouldn't happen while they're
  unauthenticated. It doesn't block step 5, which only builds images and doesn't
  care what's in them.
- Doing step 1 without Docker first avoids debugging Docker networking and SQL at the same time — Postgres + FastAPI get learned locally before containers are introduced.
- Frontend and backend are separate containers (rather than one combined container) to get more realistic multi-container Docker Compose practice.
