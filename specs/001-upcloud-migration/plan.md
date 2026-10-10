# Implementation Plan: Move Hosting from Azure to UpCloud

**Branch**: `001-upcloud-migration-plan` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-upcloud-migration/spec.md`

## Summary

Production moves off Azure Container Apps and Neon. It goes to one always-on
UpCloud **Starter 1xCPU-2GB** server and an UpCloud-managed **PostgreSQL 18**
database on the **Developer 1 CPU / 1 GB** plan with 10 GiB of storage, both in
`fi-hel1`. The two talk over a private SDN network, and the database has no
public access.

The server runs the same two GHCR images under Docker Compose. A **Caddy**
reverse proxy sits in front: it terminates TLS for both hostnames, renews
certificates itself, overwrites any client-sent `X-Forwarded-For`, and serves
a maintenance page while a flag file is present.

**Deploys:** CI deploys over SSH with a key that can do only one thing: run
the deploy script with an image tag. The script waits for health checks and
rolls back by itself.

**Backups:** UpCloud's own, with 3 days of point-in-time recovery (FR-017,
as amended 2026-10-09). No off-site copy is made.

**Alerts:**
- UptimeRobot (free) covers downtime.
- A small stdlib-Python `ops-check` on the server covers memory, disk,
  database storage and certificate expiry, and emails the maintainer through
  Resend.
- There is no cost alert (FR-019, as amended).

**Cutover, rollback, pause and resume** are committed runbooks. Pausing
archives the database and **deletes** the UpCloud resources, because UpCloud
bills both servers and databases while they are stopped. A static Cloudflare
Pages notice then stands in at no cost.

**Cost:** €15.40/month excluding VAT, or €19.33 including 25.5% Finnish VAT,
under the €25 ceiling (FR-020). Every other service is on a free tier.

## Technical Context

**Language/Version**: Python 3.13 for the backend (unchanged) and Python 3
(Ubuntu 24.04 system interpreter, stdlib only) for the `ops-check` host
script. POSIX `sh`/`bash` for the deploy script. JavaScript
frontend unchanged.

**Primary Dependencies**:
- Docker Engine + Compose v2 on Ubuntu 24.04 LTS.
- Caddy `2.11.7`, a new runtime component that replaces Azure's ingress.
- `age`, on the maintainer's machine only, to encrypt the pause archive's
  second copy.
- `postgres:18` image for `pg_dump`/`psql`, so the host needs no client
  package and the version always matches.
- External, all free: UptimeRobot and Cloudflare Pages.
- Unchanged: Resend and Turnstile.

**Storage**: UpCloud Managed PostgreSQL 18, `rdb.development.1CPU-1GB`, 10 GiB,
single node, 3-day PITR. No app schema change.

**Testing**:
- Existing `pytest` (SQLite and Postgres 18 legs) and the Playwright visual
  suite, unchanged.
- New `deploy-config` CI job:
  - `docker compose config` on the production Compose file;
  - `caddy validate` and `shellcheck`;
  - `pytest deploy/tests` for `ops-check` and the deploy script's argument
    guard;
  - an edge integration test that runs Caddy and the backend and proves a
    spoofed `X-Forwarded-For` cannot dodge rate limits, and that the
    maintenance flag answers 503 on both hosts.

**Target Platform**: Ubuntu 24.04 LTS cloud server (UpCloud Starter, 1 vCPU,
2 GB, 20 GB disk), zone `fi-hel1`.

**Project Type**: Web service (existing backend and frontend), plus deployment
and operations assets.

**Performance Goals**: A cold first page load under 2 s and a first sign-in
under 1 s from Europe (SC-002). Nothing scales to zero, so this is met by
design and checked in the quickstart.

**Constraints**:
- At most €25/month including VAT.
- At most 30 minutes of planned downtime at cutover.
- The database is never publicly reachable.
- Inbound traffic only on 22 (key only), 80 and 443.
- Secrets live only in a root-only file on the server (`0600`) and in GitHub
  secrets.

**Scale/Scope**:
- A handful of users and a database well under 0.5 GB, the size Neon's free
  tier was enforcing.
- 10 GiB of database storage is about 20× headroom. Storage can grow online
  in 10 GiB steps.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Code is written to be read | Every new file (Compose, Caddyfile, cloud-init, scripts, workflow job) opens with a purpose comment, and every non-default setting carries its reason. The README's deploy, environment and architecture sections move to UpCloud in the PR that makes it production. Stale Neon and Azure comments are fixed, e.g. `backend/app/database.py`'s pool comment and `.env.example`'s `TRUST_FORWARDED_FOR` note. | ✅ planned |
| II. Every rule has a test | New behavior gets tests: `ops-check` thresholds and dedupe, the deploy argument guard, the edge's XFF overwrite and the maintenance 503. Behavior that can only exist on real infrastructure is verified by the rehearsal and quickstart, and the PR says so. That covers TLS issuance, the private network, UpCloud backups, reboot recovery and DNS cutover. Tests stay offline and deterministic: Resend and UpCloud are replaced by fakes in `deploy/tests`. | ✅ planned |
| III. Test what production runs | Production runs Postgres 18, the same major as Neon and the test suite (UpCloud offers 15–18; moved from 16 on 2026-10-10, research R2) and Python 3.13 images. The edge test runs the real Caddy version that production pins. | ✅ |
| IV. One source of truth per contract | No schema or API change. The HTTP contract is unchanged, and the XFF guarantee the rate limits depend on is now asserted by a test of the proxy. The production environment variables are documented once, in [contracts/server-env.md](contracts/server-env.md) and the README table. | ✅ |
| V. Simplicity and a small surface | No Redis in production (FR-014: there is no current need, and the cache fails open). One server, one Compose file and no orchestration layer. Additions are justified in Complexity Tracking: Caddy and the `ops-check` script. No new backend or frontend dependency. | ✅ with justifications below |
| Quality gates | `sqlite`, `postgres` and `visual` keep reporting on every PR (FR-023). The new `deploy-config` job runs on every push with no `paths:` filter, so it can be made required. | ✅ |

**Post-design re-check (after Phase 1)**: still passes. The design added no
schema, API or app dependency. Two spec requirements were amended with the
maintainer (see "Spec changes" below), and neither is a constitution
violation.

## Spec changes (agreed with the maintainer, 2026-10-09)

Research showed two requirements that could not be met within budget as
originally written. The maintainer chose to lower them rather than add
anything to meet them.

1. **FR-017 backups: 3 days, provider-only.** UpCloud's affordable Developer
   database plans keep 3 days of point-in-time recovery. 15 days starts at the
   Standard plan, about €60/month. A free off-site copy (nightly dumps to
   Cloudflare R2) was offered and declined, to keep the setup small.
   **Consequence:** a mistake noticed more than 3 days later cannot be undone
   from a backup, and losing the UpCloud account would lose the data. The
   restore runbook and drill use UpCloud's own restore.
2. **FR-019: no cost alert.** UpCloud has no budget alerts, and every resource
   here is fixed-price, so the monthly cost follows from the plan. The
   downtime alert stays. UpCloud's own low-balance email still arrives
   because the account is prepaid, but nothing in this plan depends on it.

## Project Structure

### Documentation (this feature)

```text
specs/001-upcloud-migration/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, with sources
├── data-model.md        # Phase 1: operational entities and state machines (no schema change)
├── quickstart.md        # Phase 1: validation scenarios mapped to SCs
├── contracts/
│   ├── deploy-interface.md   # the SSH forced-command contract CI calls
│   ├── server-env.md         # /etc/subscription-tracker/.env: every variable
│   ├── edge-http.md          # what the public hostnames guarantee (TLS, XFF, maintenance, paused)
│   └── ops-alerts.md         # every alert: condition, threshold, dedupe, channel
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
deploy/                          # NEW — everything production needs that isn't an image
├── README.md                    # runbooks: provision, cutover, rollback, restore, pause, resume, decommission
├── compose.prod.yml             # caddy + backend + frontend, images pinned by IMAGE_TAG
├── Caddyfile                    # two sites, TLS, maintenance matcher, logging
├── cloud-init.yaml              # first boot: docker, deploy user, unattended-upgrades + reboot window, log rotation, timers
├── maintenance/index.html       # EN + FI notice served by Caddy during maintenance (also published as the paused page)
├── bin/
│   ├── deploy.sh                # SSH forced command: validate tag → pull → up --wait → rollback on failure
│   └── ops-check.py             # stdlib: memory/disk/db-size/cert checks → Resend
├── systemd/                     # timer + service units for ops-check and image prune
└── tests/
    ├── test_ops_check.py        # thresholds, once-per-crossing dedupe, fakes for Resend/UpCloud/psql
    ├── test_deploy_guard.py     # bad tags rejected before any docker call (fake docker on PATH)
    └── edge/                    # compose override + test for XFF overwrite and maintenance 503

.github/workflows/
├── build-and-push.yml           # deploy job: Azure → UpCloud over SSH (gated by UPCLOUD_DEPLOY_ENABLED)
└── test.yml                     # + deploy-config job

backend/app/database.py          # comment only: pool_pre_ping reason no longer "Neon scales to zero"
.env.example, README.md, PLAN.md # production docs move to UpCloud (milestone 12)
```

**Structure Decision**: a new top-level `deploy/` directory holds every
production artifact that is not part of an image, alongside `backend/` and
`frontend/`. Production configuration stays separate from local development:
`docker-compose.yml` is untouched, so the zero-setup local stack doesn't
change. The scripts live with the config they operate on, and `deploy/tests`
is a separate pytest root. That keeps the backend's bare `pytest` from
`backend/` unchanged.

## Delivery sequence (one PR per step, per the constitution)

1. **PR 1: deploy assets and the `deploy-config` CI job.**
   - Contents: everything under `deploy/`, its tests, and a README section
     "Deploying to UpCloud (not yet live)".
   - Effect on production: none.
2. **Provision and rehearse.** No PR, unless the rehearsal finds fixes.
   - Create the SDN network and router, the database and the server, following
     the runbook.
   - Run the full stack on `staging.` and `api-staging.subscriptionstrack.com`
     with a copy of the Neon data.
   - Rehearse a restore from UpCloud's backups (FR-018) and a pause/resume (FR-026).
   - Confirm the database's TLS mode and connection limit.
3. **PR 2: the UpCloud deploy job.** It sits next to the Azure job and is gated
   on `UPCLOUD_DEPLOY_ENABLED`. Merge it after the rehearsal; until cutover it
   deploys to the staging hostnames.
4. **Cutover** (runbook, at most 30 minutes) together with **PR 3: production
   docs**. The README, `.env.example`, the `database.py` comment and PLAN.md
   milestone 12 describe UpCloud as production. Merge PR 3 in the cutover
   window (FR-022).
5. **7-day soak, then PR 4: decommission.**
   - Remove the Azure deploy job and the Azure secrets and variables.
   - Archive the final Neon export, then delete the Neon project and the
     Azure resource group.
   - Remove the staging hostnames from CORS, Turnstile and DNS.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| Caddy as a fourth container | Azure's ingress provided TLS, renewal and the forwarded-for header. Something on the server has to do that now. | nginx + certbot is two moving parts plus a renewal hook. Exposing uvicorn directly has no TLS and no XFF control. Caddy does TLS, renewal, XFF overwrite and the maintenance matcher in about 30 lines. |
| `ops-check.py` host script + systemd timers | UpCloud has no server memory or disk alerts, and FR-028 and the cert-renewal edge case need alerts. | Netdata or a Prometheus stack is a resident daemon with far more surface. Paid monitoring breaks the budget. One stdlib script with one state file covers all four checks. |
| Staging hostnames during rehearsal | Certificates, CORS, Turnstile and the private database link can only be proven on the real server, before cutover puts users on it. | Rehearsing on the production hostnames means cutting DNS over first, so the rehearsal's failures would be outages. |
