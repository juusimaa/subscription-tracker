# Research: Move Hosting from Azure to UpCloud

Researched 2026-10-09. UpCloud's pricing page sits behind a Cloudflare
challenge, so the prices below were read in a browser and from the UpCloud
calculator (`calc.upcloud.com`, zone FI-HEL1). Items marked **(verify at
provisioning)** could not be confirmed from an official page; the rehearsal
checks each one.

## R1. Server plan

- **Decision**: Starter `1xCPU-2GB`, €6/month (1 vCPU, 2 GB, 20 GB Standard
  SSD, 0.5 TB fair-transfer egress), zone `fi-hel1`.
- **Rationale**:
  - UpCloud replaced its plans in 2026. The Developer and General Purpose
    server plans can no longer be deployed; the current families are
    **Starter, Premium and Cloud Native**.
  - Starter is the cheapest 2 GB plan.
  - The workload (uvicorn, nginx serving static files, Caddy) fits easily in
    2 GB.
  - Servers are billed hourly, capped at 672 hours per month.
- **Alternatives considered**:
  - Premium 1xCPU-2GB at €12: faster disk and a free 24-hour server backup.
    Not needed, because the server holds no data.
  - Cloud Native at €12+ for 4 GB: its smallest size is 4 GB. It is the only
    family not billed while stopped, but pausing deletes the server anyway
    (R9).
- **Billing note**: "Starter and Premium plan Cloud Servers are billed per hour
  regardless of whether the server is powered on or shut down."
- Sources: https://upcloud.com/pricing/,
  https://upcloud.com/docs/products/cloud-servers/configurations/,
  https://upcloud.com/docs/products/cloud-servers/plans/

## R2. Database plan and version

- **Decision**: Managed PostgreSQL **16**, plan `rdb.development.1CPU-1GB`
  (€9/month), 10 GiB of storage at €0.04/GiB (€0.40), single node, `fi-hel1`.
- **Rationale**:
  - The Developer 1 GB plan is the only database tier that fits the budget
    with VAT included (see R10).
  - Data is under 0.5 GB, and the app uses one uvicorn process with a pool of
    5 connections plus 10 overflow.
  - Storage grows online in 10 GiB steps.
  - PostgreSQL versions 15, 16, 17 and 18 are offered (from the UpCloud
    Terraform provider's API schema, 2026-10-08). 16 is pinned at creation to
    match the test suite (constitution Principle III).
- **Alternatives considered**:
  - Developer 1CPU-2GB at €14.40 with 10 GiB. The total would be €25.60 with
    VAT, over the ceiling.
  - Legacy bundled `1x1xCPU-2GB-25GB`, about €30 according to a third party.
    Over budget.
  - Standard plans from about €60. Over budget.
  - Postgres in a container on the server. The maintainer asked for a
    provider-maintained database, and this would put patching and backups
    back on us.
- **Verify at provisioning**:
  - `max_connections` on the 1 GB plan is comfortably above 15.
    **Found (T013, 2026-10-10):** `SHOW max_connections` returns 50.
- **Billing note**: "Billing continues as long as the instance exists, even if
  it is stopped."
- Sources: https://upcloud.com/docs/products/managed-postgresql/configurations/,
  https://upcloud.com/docs/products/managed-postgresql/faq/,
  https://upcloud.com/docs/changelog/2025-05-26-additional-disk-space-managed-databases/

## R3. Backups and retention

- **Decision**: UpCloud's built-in backups only.
  - A daily full backup plus WAL copied every 5 minutes, giving 3 days of
    point-in-time recovery.
  - Backups are stored off-site by UpCloud and don't count against the
    database's storage.
  - The backup hour is set to 02:00 UTC.
  - The restore runbook uses UpCloud's restore into a **new** database
    service, then points `DATABASE_URL` at it.
- **Rationale**:
  - The maintainer amended FR-017 to 3 days on 2026-10-09 to keep cost and
    surface low.
  - 15-day retention starts at the Standard plans, about €60/month.
- **Alternatives considered**:
  - **Nightly `age`-encrypted dumps to Cloudflare R2, kept 14 days, on the
    free tier.** These would have survived losing the UpCloud account and
    stretched recovery to 14 days. Offered and declined: it adds a script,
    a bucket, a token and an alert.
  - **Standard plan:** over budget.
- **Accepted risks**:
  - Data deleted by mistake and noticed after 3 days is gone.
  - Losing the UpCloud account loses the data.
  - Users' own JSON exports are the only fallback.
- **Verify at provisioning**:
  - That a restore into a new service works.
  - How long it takes. This is drilled before cutover against SC-005, which
    allows under 1 hour.
- Sources: https://upcloud.com/docs/products/managed-postgresql/backups/

## R4. Network isolation and TLS to the database

- **Decision**:
  - Create an **SDN private network plus an SDN router** in `fi-hel1` before
    the database.
  - Attach the database to that network **at creation**. Attaching later
    rebuilds the database and can't be undone.
  - Leave `public_access` off, which is the API default.
  - The server gets a second interface on the same SDN network.
  - `DATABASE_URL` uses the private hostname, with `sslmode=verify-full` if
    UpCloud provides a CA certificate for the service, otherwise
    `sslmode=require`.
- **Rationale**:
  - Only the SDN range is allowed to connect ("the whole range of the SDN
    network is always whitelisted").
  - UpCloud's firewall doesn't apply to databases, so network membership is
    the access control (FR-010).
  - SDN networks and routers are free.
- **Verify at provisioning**:
  - Whether TLS is enforced, and whether a CA certificate can be downloaded.
    The docs only show an `sslmode` field.
    **Found (T013, 2026-10-10):** enforced: `sslmode=disable` gets `no
    pg_hba.conf entry … no encryption`. The server certificate is signed by
    a per-project "Project CA" whose certificate the console offers, and
    `sslmode=verify-full` with it succeeds against the hostname, so
    production uses `verify-full`. The backend container mounts the CA file
    at the path `sslrootcert` names (`deploy/compose.prod.yml`). The
    database listens on a non-default port (11569 here), shown on the
    console's Connection panel.
  - That a connection from outside the SDN is refused.
- Sources: https://upcloud.com/docs/guides/connect-managed-databases-sdn-private-networks/,
  https://upcloud.com/docs/products/managed-postgresql/connecting/,
  https://upcloud.com/docs/products/managed-postgresql/ip-access-control/

## R5. Edge proxy and TLS

- **Decision**: Caddy `2.11.7` (official image, pinned).
  - Two site blocks, `{$APP_HOST}` → `frontend:80` and `{$API_HOST}` →
    `backend:8000`.
  - Certificates are stored in a named volume on `/data`.
  - The server firewall allows only 22, 80 and 443.
  - `trusted_proxies` is not configured.
- **Rationale**:
  - DNS stays at Cloudflare in DNS-only mode, so the HTTP-01 and TLS-ALPN-01
    challenges reach the server directly. Let's Encrypt is used, with ZeroSSL
    as fallback, and renewal is automatic.
  - **XFF guarantee (FR-009)**: with no trusted proxies, Caddy *replaces*
    `X-Forwarded-For` with the peer IP. In Caddy v2.11.7,
    `reverseproxy.go`'s `addForwardedHeaders` calls
    `req.Header.Set("X-Forwarded-For", clientIP)` for untrusted peers.
  - The backend's existing rule — key on the last entry when
    `TRUST_FORWARDED_FOR=true` — therefore sees the real client, and a
    client-supplied value is discarded.
  - The backend and frontend ports are not published on the host, so only
    Caddy can reach them.
- **Maintenance mode**: a `file` matcher on `/srv/flags/maintenance`. While
  that file exists, both sites answer `503` with `Retry-After` and the static
  EN/FI page. It is toggled with `touch` and `rm`, with no reload needed.
- **Caveat recorded in the Caddyfile**: if the Cloudflare proxy (orange cloud)
  is ever turned on, `trusted_proxies` must list Cloudflare's ranges, or every
  user would share one rate-limit key.
- **Alternatives considered**:
  - nginx with certbot: two components plus a renewal hook.
  - Traefik: label-driven configuration is harder to read (Principle I).
- Sources: https://caddyserver.com/docs/automatic-https,
  https://caddyserver.com/docs/caddyfile/directives/reverse_proxy,
  https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/reverseproxy/reverseproxy.go

## R6. Deploys and the deploy credential

- **Decision**: CI runs `ssh deploy@<host> sha-<7>`. The deploy key's
  `authorized_keys` line is:

  ```
  restrict,command="/opt/subscription-tracker/bin/deploy.sh" ssh-ed25519 …
  ```

  `deploy.sh` then works through these steps:
  1. Validates `$SSH_ORIGINAL_COMMAND` against `^sha-[0-9a-f]{7}$` and exits 64
     if it doesn't match.
  2. Records the current tag in `previous-tag`.
  3. Writes the new `IMAGE_TAG`, then runs `docker compose pull` and
     `docker compose up -d --wait --wait-timeout 120`.
  4. On failure, restores the previous tag, runs `up -d --wait` again and exits
     non-zero, so the CI job fails.
  5. On success, checks `https://$API_HOST/health` through Caddy.

  Deploys are serialized by `flock`, and the host key is pinned in a GitHub
  secret.
- **Rationale**:
  - The credential can only start a deploy of an image already published by
    this repository's CI. It cannot run commands, forward ports or touch the
    UpCloud account (FR-016).
  - No UpCloud API token is needed for deploys at all.
  - A few seconds of interruption while containers are recreated is within
    the spec ("at most a brief interruption").
- **Known limit**: a rollback doesn't downgrade the schema. If a migration ran
  and the new version then failed its health check, the old image runs on the
  newer schema. This is the same exposure Azure revisions had today. Keeping
  migrations additive (expand, then contract) is the existing practice, and
  it is now written down in `deploy/README.md`.
- **Alternatives considered**:
  - An UpCloud API token: account-wide, with no per-endpoint scopes.
  - GitHub OIDC to an SSH CA: no native support, and it adds a CA service.
  - A self-hosted runner on the server: the runner would hold a long-lived
    GitHub credential and run untrusted job code next to production.
  - Watchtower: it polls `latest`, so deploys wouldn't be pinned to a commit
    and wouldn't be gated on health.
- Sources: https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT,
  https://docs.docker.com/reference/cli/docker/compose/up/

## R7. Host maintenance

- **Decision**:
  - Ubuntu 24.04 `unattended-upgrades` (security updates are on by default),
    plus `Automatic-Reboot "true"` at `04:30` Europe/Helsinki.
  - Docker's json-file logs capped at `max-size 10m` and `max-file 3` in
    `daemon.json`.
  - A weekly `docker image prune -a -f --filter until=168h`. The previous tag
    stays available for rollback, and `deploy.sh` re-pulls it if needed.
  - Containers use `restart: unless-stopped`, and `docker.service` is enabled.
- **Rationale**:
  - FR-012: security updates are automatic, and the app returns after a reboot
    on its own.
  - Edge case "disk full": logs are capped and old images pruned.
- **Disk and memory budget**: 20 GB disk with images under 1 GB. A heavier
  process later would show up in `ops-check`'s memory alert.
- Sources: https://ubuntu.com/server/docs/how-to/software/automatic-updates/,
  https://docs.docker.com/engine/logging/drivers/json-file/,
  https://docs.docker.com/engine/containers/start-containers-automatically/

## R8. Monitoring and alerts

- **Decision**:
  - **Downtime (FR-019)**: UptimeRobot Free with two HTTPS keyword monitors at
    a 5-minute interval, email alerts. One watches `https://subscriptionstrack.com`
    and the other `https://api.subscriptionstrack.com/health`. Commercial use
    is allowed on the free plan.
  - **Everything else**: `ops-check.py`, stdlib Python run by systemd timers.
    It alerts by email to `ALERT_EMAIL` through Resend's HTTP API.

    | Check | Threshold | Cadence |
    |---|---|---|
    | Memory | above 80% used (MemAvailable) | 5 min |
    | Root disk | above 80% | 5 min |
    | Database size vs. plan storage (`pg_database_size` ÷ `DB_STORAGE_GIB`) | above 80% | hourly |
    | TLS certificate expiry, both hosts | under 14 days left | daily |

    An alert is sent once per crossing: a state file records which alerts are
    active, and an alert is re-armed when its condition clears. A
    "recovered" email is sent when that happens.
  - **Heartbeat**: `ops-check` also pings an UptimeRobot heartbeat monitor, if
    the free plan includes one. That catches the case where the server is
    dead and can't send its own alerts. **(verify)** — otherwise the two HTTP
    monitors already cover a dead server.
- **Rationale**:
  - UpCloud has no documented server metrics alerts. Database alerts exist
    only through the API.
  - Cloudflare health checks are paid.
  - One small script covers FR-028 and the cert-renewal edge case.
  - Alert emails count toward Resend's 100/day free quota, which is shared
    with the app. Sending once per crossing keeps alerts to a handful a month.
- **No cost alert**: dropped from FR-019 by the maintainer on 2026-10-09.
  - UpCloud has no budget alerts, and every resource here is fixed-price, so
    the cost follows from the plan.
  - The design considered and dropped was a daily inventory check through an
    IP-restricted UpCloud API token. Dropping it also removes the only
    UpCloud API token this setup would have held.
- **Alternatives considered**:
  - Netdata: a resident daemon.
  - Better Stack: the free interval is unverified.
- Sources: https://uptimerobot.com/pricing/, https://uptimerobot.com/terms,
  https://upcloud.com/docs/getting-started/accounts/account-balance/,
  https://upcloud.com/docs/products/managed-postgresql/monitoring/

## R9. Pausing and resuming

- **Decision**:
  - **Pause:**
    1. Turn on maintenance mode.
    2. Take a final `pg_dump -Fc` and download it to the maintainer's
       machine. A second copy, encrypted with `age`, goes to personal storage
       outside UpCloud (FR-027), e.g. a cloud drive.
    3. Verify the archive's row counts by restoring it into a throwaway local
       Postgres 16.
    4. Delete the database, the server, its storage and the SDN
       network/router.
    5. Point both hostnames at a **Cloudflare Pages** project serving
       `deploy/maintenance/index.html` in its "paused" variant.
  - **Resume:** the provisioning runbook again, then `pg_restore` from the
    archive, a row-count check, and the DNS switch back.
  - Resume is rehearsed once, on staging, before the first real pause.
- **Rationale**:
  - Every UpCloud resource bills while stopped (R1, R2), so deleting them is
    the only way to reach €0 (SC-009).
  - Pages is free, serves both the apex and the `api` subdomain over HTTPS,
    and needs no code.
  - API calls receiving an HTML 200 doesn't matter while the frontend is
    paused too.
  - A 2-hour resume target is realistic: provisioning takes about 15 minutes,
    cloud-init about 5, the restore a few seconds, then DNS and TLS.
- **Caveat**: adding a Pages custom domain needs the grey-cloud A records
  removed first. Cloudflare then creates a proxied record. On resume, the
  custom domains are removed from Pages before the A records are re-created.
- **Alternatives considered**:
  - Stopping the resources: they keep billing.
  - A Cloudflare Worker returning a JSON 503: more code for no user-visible
    gain.
- Sources: https://developers.cloudflare.com/pages/configuration/custom-domains/

## R10. Cost

| Item | €/month excl. VAT |
|---|---|
| Starter 1xCPU-2GB server (includes IPv4, 0.5 TB egress) | 6.00 |
| `rdb.development.1CPU-1GB` compute | 9.00 |
| Database storage 10 GiB × €0.04 | 0.40 |
| SDN network + router, firewall | 0.00 |
| Egress beyond the allowance (throttled, never billed) | 0.00 |
| Cloudflare Pages, UptimeRobot Free, Resend Free | 0.00 |
| **Total** | **15.40** |
| **Total with 25.5% Finnish VAT** | **19.33** |

- The total is under €25 including VAT, with €5.67 of headroom.
- If the account is VAT-registered and reclaims VAT, the effective cost is
  €15.40.
- Database prices assume a 30-day month, while servers are capped at 28 days.
  A 31-day month adds about €0.30.

## R11. Moving the data from Neon

- **Decision**: run both `pg_dump` and `pg_restore` from the new server,
  using the `postgres:16` image.
  - **Dump:** custom format with `--no-owner --no-privileges`, over Neon's
    **unpooled** endpoint with `sslmode=require`.
  - **Restore:** over the private network, with
    `--no-owner --no-privileges --exit-on-error`, followed by `ANALYZE`.
  - **Check:** per-table row counts, sequence values, and per-user aggregates
    (subscription count, category count, and the sum of `cost` per currency)
    compared by script.
- **Freezing writes**:
  1. Disable ingress on the Azure backend Container App
     (`az containerapp ingress disable`). This is reversible with `enable`
     for rollback.
  2. Set `ALTER DATABASE … SET default_transaction_read_only = on` on Neon
     and terminate open sessions.
- **Rationale**:
  - Neon advises against dumping through the pooler.
  - The server reaches both Neon (public) and UpCloud (private).
  - The data is a few MB, so the copy takes seconds.
- Sources: https://neon.com/docs/import/migrate-from-neon,
  https://neon.com/docs/manage/backup-pg-dump,
  https://www.postgresql.org/docs/16/app-pgrestore.html

## R12. Cutover sequence

- **Decision**:

  | Time | Step |
  |---|---|
  | T−24 h | Lower both DNS records' TTL to 60 s. Announce the window on the app (optional email). |
  | T−0 | Turn on maintenance on the new server, which is already running and verified on the staging hostnames. Point both hostnames at the new server. Caddy issues the production certificates. |
  | T+5 min | The old TTL has expired. Freeze writes on Azure and Neon (R11). |
  | T+6 | Dump, restore and check (R11). |
  | T+10 | Smoke test with the hostnames forced to the new IP. Sign in, check the dashboard totals, run signup, verify and reset with a test address. |
  | T+15 | Turn off maintenance. Merge PR 3 (the production docs). |

- **Rollback**:
  - **Before maintenance is turned off:** DNS back, Azure ingress back on, and
    Neon set read-write. Nothing is lost.
  - **After maintenance is turned off, within the soak period:**
    1. Maintenance on.
    2. Dump UpCloud and restore it into Neon over the old schema contents, so
       data written since cutover is **copied back, not lost**.
    3. Neon set read-write, Azure ingress back on, DNS back.
- **Rationale**:
  - FR-004 and FR-005, SC-003: about 15 minutes of maintenance. The old side
    stops accepting writes before the copy.
  - Stragglers on stale DNS reach Azure, which is still fully working until
    the freeze, so nothing they write is lost.
