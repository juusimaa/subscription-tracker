# Contract: Production server environment

This contract covers `/etc/subscription-tracker/.env`, which is `root:deploy`
with mode `0640`. It is written by hand during provisioning and is never in
the repository or an image (FR-013). Compose reads it through `env_file` and
`--env-file`.

## App variables (same meaning as today; see the README's environment table)

| Variable | Production value / rule | Change from Azure |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://<user>:<pw>@<private-host>:<port>/<db>?sslmode=verify-full&sslrootcert=/etc/subscription-tracker/upcloud-ca.pem` (or `sslmode=require`, see research R4) | Neon → UpCloud private host |
| `SECRET_KEY` | **carried over unchanged**, so existing sign-in tokens and emailed links keep working (spec US1 scenario 3) | moved |
| `CORS_ORIGINS` | `https://subscriptionstrack.com`; the staging origin is added during rehearsal and removed at decommission | the old `.azurecontainerapps.io` origin is dropped |
| `TRUST_FORWARDED_FOR` | `true`, set by `deploy/compose.prod.yml` rather than this file, because it is only safe with Caddy in front (Caddy overwrites XFF, see [edge-http.md](edge-http.md)). | comment now names Caddy, not Azure |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES` | unchanged; staging hostname added during rehearsal | moved |
| `EMAIL_BACKEND`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `EMAIL_DAILY_CAP` | unchanged values | moved |
| `API_URL` (frontend) | not in this file: `deploy/compose.prod.yml` derives it as `https://$API_HOST` | moved |
| `TURNSTILE_SITE_KEY` (frontend) | unchanged | moved |
| `REDIS_URL` | **unset**. No cache in production (FR-014). | unchanged |

## Edge variables

| Variable | Value |
|---|---|
| `APP_HOST` | `subscriptionstrack.com` (`staging.subscriptionstrack.com` during rehearsal) |
| `API_HOST` | `api.subscriptionstrack.com` (`api-staging.subscriptionstrack.com` during rehearsal) |
| `ACME_EMAIL` | the maintainer's address; Let's Encrypt sends expiry notices there |

## Operations variables (read by `ops-check.py`, never by the app)

| Variable | Purpose |
|---|---|
| `ALERT_EMAIL` | where alerts go (the maintainer) |
| `DB_STORAGE_GIB` | the database plan's storage, the denominator of the database-size alert (10) |
| `UPTIMEROBOT_HEARTBEAT_URL` | optional dead-server heartbeat (research R8) |

## Deploy record (not in this file)

`IMAGE_TAG` (`sha-<7 hex>`) lives in `/var/lib/subscription-tracker/image-tag.env`,
owned by `deploy` and written only by `deploy.sh`. It cannot live here:
this file is `root:deploy 0640`, so `deploy.sh`, running as `deploy`, can
read it but not write it. Compose reads both files (`--env-file` twice).

## Rules

- Every variable above is documented in `deploy/README.md`. App variables
  stay in the main README table, whose "Azure" wording becomes "production".
- Rotating a secret means editing the file and then running
  `docker compose up -d` (deploy user) — nothing else.
- `.env.example` remains the local-development source and is not used in
  production.
