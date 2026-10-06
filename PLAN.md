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
5. ~~**GitHub Actions**~~ ✅ — on push to `main`, build both images and push them to GitHub Container Registry. Details below.
6. ~~**Multi-user auth (JWT)**~~ ✅ — add a `users` table and scope every subscription to its owner, so the app is safe to expose publicly in step 8. Details below.
7. ~~**Invite code for registration**~~ ✅ — gate `POST /register` behind a shared invite code (env var, checked alongside the existing rate limit) before the app is reachable on a public URL. Registration is architecturally open to anyone (milestone 6), and step 9 is what actually verifies an email belongs to whoever is registering with it — until that exists, an invite code is the stopgap that keeps step 8's public deploy from being genuinely open signup. Removed once step 9 lands.
8. ~~**Deploy to Azure Container Apps**~~ ✅ — backend + frontend as two container apps, both pulling the images already published to GHCR. Database is [Neon](https://neon.tech)'s free Postgres tier rather than Azure Database for PostgreSQL: Neon costs nothing at this scale and scales to zero on its own, while the cheapest Azure-managed Postgres (Burstable B1ms) runs ~$15–20/month with no free tier. Redis is dropped for this deployment — `app/cache.py` already fails open, so there's nothing worth paying to keep. Details below.
9. ~~**Password reset and email verification**~~ ✅ — the two account-surface gaps milestone 6 deliberately skipped, built for real this time. Needs an actual email-sending path (e.g. [Resend](https://resend.com)), which nothing in this stack has today — only `email-validator`, which checks an address's *format*, not that anyone reads it. New accounts land unverified and stay usable (registering, logging in, tracking subscriptions all still work), and anything that emails the user unprompted (any future renewal-reminder notification) is gated on verification. Password reset is the exception: it works for unverified accounts too, and completing it verifies the address. Once this exists, step 7's invite code is no longer the thing standing between a public URL and open signup — but it deliberately **stays** while the app is in beta; removing it is a separate, later decision. Provider: Resend (free tier). Details below.
10. **Multi-currency support** — closes TODO.md's D7, which was recorded as a decision to revisit rather than a task, on the grounds that every subscription today is silently assumed to be EUR. Currency lives on the **subscription**, not the user — `cost` gains a `currency` column, since two subscriptions on one account can legitimately be billed in different currencies (D4's own reasoning: don't force a schema constraint that isn't true about the user's money). Users additionally get a **default currency** setting, pre-filling new subscriptions rather than acting as a source of truth — the first of what will likely be several user-specific settings, so it gets its own typed column(s) rather than a JSONB blob, following the `token_version` precedent (milestone 6) instead of inventing a schemaless settings store. Still to decide, and worth settling before backend work starts since it drives the schema and has real UX impact: how the category panel and the per-month/year cost panel show a mix of currencies once summing raw `cost` across rows stops being meaningful — separate per-currency subtotals, a converted grand total (needing a conversion-rate source, live or cached), or something else.
    * Currency settings at the bottom. TBD how to poll currency rates.
      
       <img width="1874" height="596" alt="Currency settings at the bottom of the page" src="https://github.com/user-attachments/assets/080681c0-1b1c-42e3-a798-914f770ec632" />
    * Cost input control when adding a new subscription
      
       <img width="390" height="250" alt="Cost input control for new subsctiption" src="https://github.com/user-attachments/assets/4aee43ca-00c4-4491-9af6-484959dd5682" />
    * Cost column when editing subsctiption (currency cannot be changed)
   
      <img width="508" height="194" alt="image" src="https://github.com/user-attachments/assets/71b18c65-4e1c-4628-836a-f253aee136cf" />
    * Currency breakdown at the top of the page. When all subscriptions uses same currency this is not shown.
   
      <img width="2220" height="974" alt="image" src="https://github.com/user-attachments/assets/be6185f1-3667-47b9-b3b1-84785453d95c" />
    * Coming up panel
   
      <img width="904" height="1110" alt="image" src="https://github.com/user-attachments/assets/6f772707-5aac-407b-96d6-4bb0bcb5abd3" />
    * Strip uses only selected currency
   
      <img width="2206" height="456" alt="image" src="https://github.com/user-attachments/assets/e13a8ca2-baeb-4c15-b8b7-90eec78bb4a4" />






## Milestone 5 — GitHub Actions to GHCR (done)

One workflow, `.github/workflows/build-and-push.yml`, triggered by pushes to
`main` (documentation-only commits are skipped via `paths-ignore`) and by a
manual **Run workflow** button. It builds and publishes, and nothing more —
deploying these images is milestone 8.

**Registry:** GHCR rather than Docker Hub, because it needs no external
account. The `GITHUB_TOKEN` that Actions mints for each run is enough to push,
once the workflow asks for `packages: write` — the default token is read-only.
Nothing is stored as a repository secret, and the token dies with the run.

**Images:** `ghcr.io/<owner>/subscription-tracker-backend` and
`-frontend`, each tagged twice. `latest` always tracks the newest `main` build;
`sha-<short>` is immutable and pins one commit, which is what a deploy should
reference — `latest` moves underneath you and makes a rollback ambiguous.

**One job, run twice.** A `strategy.matrix` supplies the build context and
image name per image instead of duplicating the job. The frontend entry also
sets `target: production`, so the published image is the Nginx stage serving
static files — never the Vite dev server that `docker-compose.yml` targets
locally. `fail-fast: false` keeps one failure from cancelling the other build.

**Caching:** every run gets a clean runner with an empty Docker cache, so
without `cache-from`/`cache-to: type=gha` each build would reinstall every pip
and npm dependency from scratch. `mode=max` also caches intermediate stages,
which is what makes the frontend's multi-stage build cheap. The scope is keyed
per image so the two builds don't overwrite each other's cache.

**Verified:** both images build locally exactly as the workflow builds them
(`docker build ./backend` and `docker build --target production ./frontend`).

**Gap fixed in milestone 8:** Vite inlines `VITE_API_URL` at *build* time, so
the published frontend image had the fallback `http://localhost:8000` baked
into its JavaScript bundle — correct for local `docker compose`, wrong for
Azure. Fixed by reading the backend URL at runtime instead of build time; see
milestone 8 below.

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
token blocklist. There is also no password reset and no email verification —
both are milestone 9. The 12-hour expiry is the only thing that ends a session.

**Session behaviour to expect:** `localStorage` is per-origin, per-browser. Same
browser tomorrow means still logged in (until the token expires); a different
browser, device, or private window means the login screen again. Logging in from
two browsers gives two independent valid tokens — nothing invalidates the older
one, which is why the expiry is kept short.

## Milestone 8 — Azure Container Apps deploy (done)

**Infra** (Germany West Central, near Neon's `eu-central-1`, all in the
existing `subscription-tracker-rg` resource group): one Container Apps
Environment (`subscription-tracker-env`) holding two apps,
`subscription-tracker-backend` and `subscription-tracker-frontend`, each on
the Consumption plan at 0.25 vCPU / 0.5Gi with `min-replicas: 0` — this is a
low-traffic hobby deploy, so scaling to zero when idle (both apps, and Neon
itself) matters more here than avoiding cold starts. A $10/month budget alert
on the resource group notifies at 80% and 100% of spend.

**Secrets:** `SECRET_KEY` and `INVITE_CODE` were freshly generated for
production (never reused from local dev), and `DATABASE_URL` is Neon's
**unpooled** connection string — see milestone 7's note and
`backend/app/database.py`/`backend/alembic/env.py`, which both read the one
`DATABASE_URL` var, and Neon's pooler (PgBouncer, transaction mode) can
misbehave with Alembic's DDL/locking. All three are Container Apps secrets,
referenced by the containers via `secretref`, never plain env values.
`CORS_ORIGINS` on the backend points at the frontend app's own FQDN.

**No separate migration step needed:** `backend/entrypoint.sh` already runs
`alembic upgrade head` before every container start (see milestone 2/3's
Dockerfile), so the backend app migrated Neon's schema itself on first boot —
milestone 5's plan to run this "separately" turned out to be unnecessary.

**The `VITE_API_URL`-at-build-time gap (flagged in milestone 5) is fixed with
a runtime config, not a build arg:** the frontend's production (Nginx) image
now has `frontend/docker-entrypoint.sh` render `frontend/config.template.js`
into `/usr/share/nginx/html/config.js` via `envsubst`, using whatever `API_URL`
env var the Container App has, at container *startup* — `index.html` loads it
before the app bundle, and `src/api.js` reads `window.__API_URL__` first,
falling back to the build-time `VITE_API_URL` (for local Vite dev, which has
no `config.js`) and then `http://localhost:8000`. One built image now works
against any backend URL; changing it later is a Container Apps env var update,
not a rebuild.

**Continuous deploy:** `build-and-push.yml`'s `deploy` job (added in milestone
5's PR, inert until now) is live — `AZURE_DEPLOY_ENABLED` is `true`, backed by
an Azure AD app registration + service principal with an OIDC federated
credential scoped to `repo:<owner>/subscription-tracker:ref:refs/heads/main`
(`azure/login`, no long-lived secret in GitHub) and a **Container Apps
Contributor** role assignment scoped to just the resource group — not
`Contributor`, so a compromised workflow run can't touch anything outside the
two container apps. Every push to `main` now builds, publishes, and rolls out
automatically, pinned to the immutable `sha-<short>` tag.

**GHCR images:** already publicly pullable with no registry secret needed —
GHCR packages inherit this repo's public visibility by default, so Container
Apps' anonymous pulls just worked.

## Milestone 9 — Password reset and email verification (done)

**As built, where it differs from the plan below:** the module is
`app/mailer.py`, not `app/email.py`, so it can never shadow the standard
library's `email` package. Every message about the email (the nudge, what a
link just did, "password changed") shares one strip under the header
(`EmailStrip.jsx`), the same chrome as the session-expired strip, rather
than using the Save notice, which belongs to list writes. The Account
dialog's status sits under the address in its "Signed in as" block instead
of in a section of its own. Emails go out in English only for now; the
backend doesn't know a user's interface language.

**Provider: [Resend](https://resend.com), free tier.** 3,000 emails/month
(100/day), 3 domains, €0. That is orders of magnitude more than verification
and reset mail will ever use here, so no provider is *cheaper*. The
alternatives were weighed on other grounds:

- Azure Communication Services: ~$0.00025/email, so cents a month on the
  existing bill. Domain setup is clunkier and new resources start with low
  send quotas.
- Brevo: the largest free tier, from an EU company, but a heavy
  marketing-suite product.
- Postmark: only 100/month free.
- Amazon SES: needs an AWS account and has a sandbox-exit process.

The sending code sits behind a small interface, so swapping providers later
means writing one function. Sending needs `subscriptionstrack.com`'s DNS: an
SPF/DKIM record from Resend (send from a subdomain such as
`mail.subscriptionstrack.com`) plus a DMARC record.

**Invite code stays.** The app is still in beta, so `INVITE_CODE` keeps
gating `POST /register`. Removing it is its own later change. This milestone
only builds the email path.

### Backend

- **Migration `0006_email_verified_at`:** `users.email_verified_at`, a
  nullable timestamp. Null means unverified. Existing users start unverified
  and see the nudge described below; there is no backfill, since nobody has
  proven an address yet. `User` responses gain `email_verified: bool`.
- **No token table.** Verify and reset links carry short-lived signed JWTs
  (the same `SECRET_KEY` and HS256), each with a `purpose` claim:
  - Verify: `{sub, purpose: "verify", email, exp: 48h}`. Including `email`
    keeps the token tied to the address it was sent to. Reusing it is
    harmless, because verifying is idempotent.
  - Reset: `{sub, purpose: "reset", tv: token_version, exp: 1h}`. Completing a
    reset goes through `crud.update_password`, which bumps `token_version`. That
    makes each link **single-use**, and it also signs out every session (the
    same as change password does today).
  - `get_current_user` must **reject any token that has a `purpose` claim**,
    so an emailed link can never be used as an access token.
- **`app/email.py`:** `send_email(to, subject, text, html)`, switched by
  `EMAIL_BACKEND`:
  - `resend`: one `httpx` POST to `api.resend.com/emails`. `httpx` moves from
    `requirements-dev.txt` into `requirements.txt`.
  - `console` (the default): logs the message, including the link, which is
    enough for local dev.
  - Tests use a fixture that captures an in-memory outbox.

  Mail is sent from FastAPI `BackgroundTasks`, so a slow provider never slows
  the request, and response timing doesn't reveal whether an account exists.
  A send failure is logged and never surfaces as a 500.
- **New env vars:**
  - `EMAIL_BACKEND`
  - `RESEND_API_KEY` (a Container Apps secret, referenced with `secretref`)
  - `EMAIL_FROM` (`Subscription Tracker <no-reply@mail.subscriptionstrack.com>`)
  - `APP_URL` (`https://subscriptionstrack.com`, the base for the links)

  Add them to `.env.example`, `docker-compose.yml`, the README env table and
  the Azure app.
- **Endpoints.** Error statuses are **400, never 401**, because `api.js`
  treats any 401 as "session expired":
  - `POST /register`: unchanged, and also queues the verification email.
  - `POST /me/verification` (authenticated, 3/hour): resends the
    verification email. Returns 204, or 204 as a no-op if already verified.
  - `POST /verify-email {token}` (unauthenticated): returns 200 with
    `{email}`. A bad or expired token gets 400 `{"detail": "expired"}` or
    `{"detail": "invalid"}`.
  - `POST /password-reset {email}` (5/hour per IP): **always 202**, whether
    the account exists or not, so it can't be used to check for an email.
    Sends only if the account exists.
  - `POST /password-reset/confirm {token, new_password}`: sets the password
    (bumping `tv`), marks the email verified, and returns a `Token` so the
    user lands signed in. A bad, expired or used token gets 400.
- **Gating rule (approved 2026-10-06):** a password reset
  **is allowed for unverified accounts**, and completing it **verifies the
  address**, since clicking the link proves the user reads that inbox.
  Without this, someone who registers and forgets their password before
  verifying would be locked out for good. Verification still gates mail the
  user didn't ask for, meaning future renewal reminders.
- **Tests:**
  - Token purpose separation (a reset or verify token used as a bearer
    token gets 401).
  - Reset link is single-use, and expires.
  - Verify is idempotent.
  - Unknown email still gets 202 with nothing sent.
  - Rate limits.
  - The migration, on the SQLite + Postgres matrix.

### Frontend (planned with impeccable shape: Operate mode, inside the existing DESIGN.md world)

No router is added. `main.jsx` reads `?verify=` and `?reset=` once on load,
hands them to `App`, and clears them from the URL with
`history.replaceState`. That way a token never sits in history and a reload
never re-submits it.

1. **Login, "Forgot password?"**
   - A text link under the password field. Full login only, not the compact
     re-auth dialog, where Log out is the way out.
   - It swaps the same card to a single email field and a primary
     button, "Send reset link".
   - Success replaces the form with one status line: "If there's an
     account for *x*, a reset link is on its way. It works for 1 hour." The
     wording is neutral, so it doesn't reveal whether an account exists.
   - "Back to sign in" returns to the form.
2. **Reset screen (`?reset=TOKEN`)**
   - The login card titled "Set a new password", with one new-password field
     that uses the same rules and hint as Change password.
   - Success signs the user straight in. A Save notice on the dashboard
     reads "Password changed. You've been signed out everywhere else."
   - If the token is expired or used, the card says so plainly and offers
     the email field pre-armed, "Send a new link", instead of a dead end.
3. **Verify landing (`?verify=TOKEN`)** works whether or not the user is
   signed in, because the link often opens in another browser:
   - Signed in: the dashboard loads, and the Save-notice line reads "Email
     confirmed."
   - Signed out: the login card shows a status line above the form:
     "*x* is confirmed. Sign in to continue."
   - Expired: the line says so, and offers a new link (signed in) or says
     "sign in to send a new one" (signed out).
4. **Unverified nudge**
   - One quiet line under the header, on the page ground, in Ink at 78%,
     with **no Signal Red**. It's not money or a deadline (The One Signal
     Rule), and it's not an attention banner.
   - It reads: "Confirm *x* so you can reset your password by email. Send the
     link again". After a send, the line reads "Sent. Check *x*."
   - The user can dismiss it, which is remembered per browser in
     `localStorage` (wrapped in try/catch).
   - It never blocks anything.
5. **Account dialog, new "Email" section** above Change password. It shows
   the address with "Confirmed" or "Not confirmed yet · Send link". This is
   the permanent home for the status after the nudge is dismissed.
6. **The emails themselves**
   - Plain text plus minimal HTML, in a system font with one Ink-coloured
     square-cornered link button. No images and no tracking pixels.
   - Resend's open and click tracking is **off**, to match the "no tracking"
     positioning.
   - Copy follows the product voice. It says what the link does, when it
     expires, and "If you didn't ask for this, ignore it. Nothing has
     changed."

**States to cover in Playwright visual specs** (extend `tests/visual/mocks.js`):
- forgot form
- forgot sent
- reset form
- reset expired
- verify success (signed in and signed out)
- verify expired
- nudge
- nudge sent
- account Email section, both states

Each runs on mobile and desktop.

**Out of scope:**
- Removing the invite code.
- Renewal-reminder emails, which also need a scheduler that doesn't exist
  yet.
- Changing the account email address.
- Mailpit in compose, a nice-to-have if the console backend proves too thin.

## Notes / rationale

- Auth landed *before* the Azure deploy, not after, for two reasons. The schema
  had no migration tool at the time — `Base.metadata.create_all()` only creates
  missing tables, so adding a non-null `user_id` to `subscriptions` was a
  `docker compose down -v` while the only data is local test rows, and would
  have needed a real migration once there's an Azure database worth keeping.
  (Implementing it did in fact require a `down -v`.) Alembic has since taken
  the schema over, so step 8 no longer inherits that problem. And step 8 puts
  `POST`/`DELETE` endpoints on a public URL, which shouldn't happen while they're
  unauthenticated. It didn't block step 5, which only builds images and doesn't
  care what's in them.
- Doing step 1 without Docker first avoids debugging Docker networking and SQL at the same time — Postgres + FastAPI get learned locally before containers are introduced.
- Frontend and backend are separate containers (rather than one combined container) to get more realistic multi-container Docker Compose practice.
