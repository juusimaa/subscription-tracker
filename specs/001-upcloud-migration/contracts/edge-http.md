# Contract: Public edge (what the two hostnames guarantee)

The application's HTTP API and its responses are **unchanged**; the README's
API table remains the contract for them. This document covers what Caddy adds
in front.

## Hosts and TLS (FR-007)

| Host | Upstream | TLS |
|---|---|---|
| `https://subscriptionstrack.com` | `frontend:80` (nginx, static files plus the existing security headers and CSP) | automatic Let's Encrypt certificate, ZeroSSL fallback, renewed by Caddy |
| `https://api.subscriptionstrack.com` | `backend:8000` (uvicorn) | same |
| `http://` on either host | — | `308` redirect to `https://` (Caddy default) |

- DNS: grey-cloud A records at Cloudflare pointing at the server's public
  IPv4.
- Any CAA records must allow `letsencrypt.org` and `sectigo.com`.

## Client address (FR-009) — the rule the rate limits depend on

- Caddy runs with **no `trusted_proxies`**, so it **replaces** any
  client-sent `X-Forwarded-For` with exactly one value: the TCP peer's IP.
- With `TRUST_FORWARDED_FOR=true`, the backend's `client_address()` takes the
  last entry, which is therefore always the real client.
- The backend port (8000) and the frontend port (80) are **not published** on
  the host, so no request can reach them except through Caddy.
- If Cloudflare's proxy (orange cloud) is ever turned on, this rule breaks.
  `trusted_proxies` must then list Cloudflare's ranges, and this contract and
  its test must change in the same PR.

**Test** (`deploy/tests/edge/`, CI job `deploy-config`):
1. Start Caddy plus the backend (SQLite, `TRUST_FORWARDED_FOR=true`) with
   hosts set to `app.localhost` and `api.localhost`. These use Caddy's
   internal CA, so nothing goes out to the network.
2. Send 6 `POST /token` requests, each with a different spoofed
   `X-Forwarded-For`.
3. The 6th must be `429`. If the spoofed value were honored, all 6 would get
   through.

## Maintenance mode (FR-005, cutover, pause)

While `/srv/flags/maintenance` exists in the Caddy container (bind-mounted
from `/var/lib/subscription-tracker/flags/`), both hosts answer as follows.

| Request | Response |
|---|---|
| any path on either host, except `GET /health` on the API host | `503`, `Retry-After: 600`, `Cache-Control: no-store`, body = `maintenance/index.html` (English and Finnish side by side, chosen without JavaScript) |
| `GET https://api…/health` | passed through to the backend, so the operator's smoke tests and UptimeRobot can tell "maintenance" from "broken" |

- It is toggled with `touch` and `rm`. No reload and no container restart are
  needed, because the `file` matcher is checked on every request.
- The UptimeRobot monitor on the apex watches for a keyword that appears only
  in the app's HTML. It therefore reports maintenance as down, which is the
  intended signal during unplanned maintenance. Monitors are paused for
  planned windows.

**Test**: the same edge setup, with the flag file present. `GET /` on both
hosts must be `503` with the maintenance text, and `GET /health` on the API
host must be `200`. With the flag removed, both hosts serve normally.

## Paused (FR-025)

- Both hostnames are custom domains of a Cloudflare Pages project that serves
  the "paused" variant of the same EN/FI page over HTTPS at €0.
- API requests receive that HTML page with status 200. Nothing calls the API
  while the frontend is paused too.
- This state is verified manually in the pause/resume rehearsal (quickstart
  §6). It has no CI test, because it exists only on Cloudflare.
