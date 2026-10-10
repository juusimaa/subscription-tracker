---

description: "Task list for moving production hosting from Azure + Neon to UpCloud"
---

# Tasks: Move Hosting from Azure to UpCloud

**Input**: Design documents from `specs/001-upcloud-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. Constitution Principle II ("Every Rule Has a Test",
non-negotiable) requires them, and plan.md names the test files. Behavior that
only exists on real infrastructure (TLS issuance, the private network,
UpCloud backups, reboot recovery, DNS) is proved by the rehearsal and
quickstart tasks instead, and the PR says so.

**Organization**: Tasks are grouped by user story. Story phases are ordered
by delivery, not only by priority, because the cutover (US1) has two hard
preconditions in US3: the deploy job (plan, delivery step 3) and the restore
drill (FR-018). US1 is therefore split into a preparation phase and a cutover
phase, with US3 between them. See "Dependencies & Execution Order".

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Tasks marked **(manual)** happen in a provider console, DNS or on the
  server, not in the repository. Each one says what to record and where.

## Path Conventions

- Production assets: `deploy/` at the repository root (new)
- Deploy tests: `deploy/tests/`, a separate pytest root, so the backend's bare
  `pytest` from `backend/` is unchanged
- Workflows: `.github/workflows/`
- Existing app code: `backend/app/`, `frontend/`

## PR mapping (one PR per step, per the constitution)

| PR | Tasks | Effect on production |
|---|---|---|
| PR 1: deploy assets + `deploy-config` CI job | T001–T012, T015–T020, T025–T031 | none |
| (no PR) provision + rehearse | T013–T014, T021–T024, T033, T035–T040 | none (staging hostnames only) |
| PR 2: `deploy-upcloud` job | T032, T034 | deploys to staging hostnames |
| PR 3: production docs, merged in the cutover window | T041–T043 (cutover T044–T045) | UpCloud is production |
| PR 5 (may fold into PR 1 if ready): paused page + pause/resume runbooks | T049–T052 (rehearsal T053) | none |
| PR 4: decommission | T055–T056, T059 (manual T054, T057, T058) | Azure and Neon removed |

Every PR branches from `main` and is squash-merged; nothing is committed
directly to `main`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the `deploy/` tree and its separate test root.

- [x] T001 Create branch `001-upcloud-deploy-assets` from `main`, then create the directories `deploy/bin/`, `deploy/systemd/`, `deploy/maintenance/` and `deploy/tests/edge/`, and a `deploy/README.md` that opens with a purpose paragraph ("everything production needs that isn't an image; not yet live") and empty headed sections, in this order: Environment, Provision, Deploys, Manual rollback, Migrations (expand then contract), Alerts, Restore, Cutover, Rollback, Pause, Resume, Decommission
- [x] T002 [P] Create `deploy/tests/pytest.ini` (with a header comment saying why this is a separate root: the backend's bare `pytest` must stay unchanged, Principle II) that registers an `edge` marker for tests needing Docker, and `deploy/tests/requirements.txt` with only `pytest`, pinned to the version in `backend/requirements-dev.txt`. Tests use stdlib `urllib`, `ssl` and `subprocess`, so nothing else is added (Principle V)
- [x] T003 [P] Create `deploy/tests/sample.env` with every variable listed in `specs/001-upcloud-migration/contracts/server-env.md` (app, edge and operations tables), filled with obvious dummy values (`SECRET_KEY=not-a-secret`, `IMAGE_TAG=sha-0000000`, `APP_HOST=app.localhost`, `API_HOST=api.localhost`, `DB_STORAGE_GIB=10`, `REDIS_URL` left out on purpose), plus a header comment saying it exists only so `docker compose config` and the edge test can run offline and that it must never hold a real value

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The production stack definition, its CI check, and a provisioned
server answering on the staging hostnames. Every story needs this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Stack definition (PR 1)

- [x] T004 Create `deploy/compose.prod.yml` with a header comment and a reason on every non-default setting (Principle I):
  - services `caddy` (`caddy:2.11.7`, the version research R5 pins), `backend` (`ghcr.io/<owner>/subscription-tracker-backend:${IMAGE_TAG:?}`) and `frontend` (`ghcr.io/<owner>/subscription-tracker-frontend:${IMAGE_TAG:?}`), never `latest`;
  - `env_file: /etc/subscription-tracker/.env` for backend and frontend;
  - **no** `ports:` on backend or frontend (only Caddy can reach them, contracts/edge-http.md § Client address); Caddy publishes `80:80`, `443:443` and `443:443/udp`;
  - `restart: unless-stopped` on all three (FR-012, research R7);
  - backend healthcheck copied from `docker-compose.yml` (Python `urllib` hitting `/health`); a **new** frontend healthcheck (`wget -qO- http://127.0.0.1/` or equivalent available in the nginx image) because `docker compose up --wait` needs one for the frontend (contracts/deploy-interface.md § Behavior step 3);
  - Caddy volumes: named `caddy_data:/data` (certificates, must persist) and `caddy_config:/config`; bind mounts `./Caddyfile:/etc/caddy/Caddyfile:ro`, `./maintenance:/srv/maintenance:ro`, `/var/lib/subscription-tracker/flags:/srv/flags:ro`;
  - no Redis service, with the comment "FR-014: no cache in production, there is no current need and the app fails open (Principle V)"
- [x] T005 Create `deploy/Caddyfile` with a header comment and reasons:
  - a global block containing `{$CADDY_TEST_GLOBALS}` (empty in production; the edge test sets it to `local_certs` so nothing reaches Let's Encrypt), and the ACME email from `{$ACME_EMAIL}`;
  - site `{$APP_HOST}` → `reverse_proxy frontend:80`; site `{$API_HOST}` → `reverse_proxy backend:8000`;
  - **no `trusted_proxies`**, with a comment explaining that Caddy then replaces any client-sent `X-Forwarded-For` with the peer IP (research R5, Caddy v2.11.7 `addForwardedHeaders`), which is what makes `TRUST_FORWARDED_FOR=true` safe (FR-009), and the caveat that turning on Cloudflare's orange cloud requires listing Cloudflare's ranges in `trusted_proxies` and changing `contracts/edge-http.md` and its test in the same PR;
  - a shared snippet for maintenance mode: `file /srv/flags/maintenance` matcher; when matched, every request except `GET /health` on the API host answers `503` with headers `Retry-After: 600` and `Cache-Control: no-store` and body `/srv/maintenance/index.html`; `GET /health` on the API host is passed to the backend (contracts/edge-http.md § Maintenance mode);
  - access logs to stdout (captured and capped by Docker's json-file driver, T007)
- [x] T006 [P] Create `deploy/maintenance/index.html`: a self-contained static page (inline CSS, **no JavaScript**, no external requests) showing the maintenance notice in English and Finnish side by side, with a header comment; reuse the app's palette from `DESIGN.md` so it looks like the product
- [x] T007 [P] Create `deploy/cloud-init.yaml` with a header comment and a reason per setting:
  - packages `docker-ce`, `docker-compose-plugin` (Docker's apt repo), `unattended-upgrades`;
  - users `admin` (SSH key only, sudo) and `deploy` (in group `docker`, no password, `authorized_keys` line `restrict,command="/opt/subscription-tracker/bin/deploy.sh" ssh-ed25519 <DEPLOY_PUBKEY> gha-deploy` as a placeholder the provisioning runbook fills in);
  - `sshd`: `PasswordAuthentication no`, `PermitRootLogin no` (FR-011);
  - directories `/opt/subscription-tracker` (root, 0755), `/etc/subscription-tracker` (root:deploy, 0750), `/var/lib/subscription-tracker` and `/var/lib/subscription-tracker/flags` (deploy:deploy, 0750);
  - `/etc/docker/daemon.json` with `"log-driver": "json-file"`, `"log-opts": {"max-size": "10m", "max-file": "3"}` (edge case "disk full", research R7);
  - `/etc/apt/apt.conf.d/52subscription-tracker` with `Unattended-Upgrade::Automatic-Reboot "true";` and `Unattended-Upgrade::Automatic-Reboot-Time "04:30";`, timezone `Europe/Helsinki` (FR-012);
  - `systemctl enable docker`
- [x] T008 [P] Create `deploy/systemd/image-prune.service` (runs `docker image prune -a -f --filter until=168h`) and `deploy/systemd/image-prune.timer` (weekly), each with a header comment saying the previous tag stays available for rollback because it is under 7 days old, and `deploy.sh` re-pulls it otherwise (research R7). Add the install and `systemctl enable --now image-prune.timer` step to `deploy/cloud-init.yaml` (after T007)
- [x] T009 Add a `deploy-config` job to `.github/workflows/test.yml` with a comment explaining why it has **no** `paths:` filter (so it can become a required check, constitution Quality Gates). Steps:
  1. `docker compose -f deploy/compose.prod.yml --env-file deploy/tests/sample.env config -q` (with `env_file` resolved against `deploy/tests/sample.env` through a CI-only override or `--env-file`; whichever the job uses, comment why);
  2. `docker run --rm -v "$PWD/deploy:/deploy:ro" --env-file deploy/tests/sample.env caddy:2.11.7 caddy validate --config /deploy/Caddyfile --adapter caddyfile`;
  3. `shellcheck deploy/bin/*.sh`;
  4. `pip install -r deploy/tests/requirements.txt && python -m pytest deploy/tests -q` (includes the `edge` tests; Docker is available on `ubuntu-latest`)
- [x] T010 Write `deploy/README.md` § Environment: one table per contracts/server-env.md section (app, edge, operations), the file's location, owner and mode (`/etc/subscription-tracker/.env`, `root:deploy`, `0640`), that `IMAGE_TAG` is **not** in that file but in `/var/lib/subscription-tracker/image-tag.env` (deploy-owned, so `deploy.sh` can write it without being able to write secrets; see T031), and the rotation rule (edit the file, then `docker compose up -d`)
- [x] T011 Write `deploy/README.md` § Provision, ordered as research R4 requires:
  1. create the SDN private network and SDN router in `fi-hel1`;
  2. create Managed PostgreSQL **18**, plan `rdb.development.1CPU-1GB`, **10 GiB**, 1 node, `fi-hel1`, attached to the SDN network **at creation** (attaching later rebuilds the database), `public_access` off, backup hour `02:00 UTC`;
  3. create the Starter `1xCPU-2GB` server, Ubuntu 24.04, `fi-hel1`, with a second interface on the SDN network, user data = `deploy/cloud-init.yaml` with the deploy public key filled in;
  4. server firewall: inbound `22/tcp`, `80/tcp`, `443/tcp`, `443/udp` accepted, explicit rules for return traffic (rules are stateless), default drop (FR-011);
  5. copy `deploy/compose.prod.yml`, `deploy/Caddyfile`, `deploy/maintenance/`, `deploy/bin/` and `deploy/systemd/` to `/opt/subscription-tracker/`; write `/etc/subscription-tracker/.env` by hand from the Azure values (`SECRET_KEY` **unchanged**, contracts/server-env.md) and download UpCloud's CA certificate to `/etc/subscription-tracker/upcloud-ca.pem` if one is offered;
  6. grey-cloud A records for `staging.` and `api-staging.subscriptionstrack.com`; add the staging origin to `CORS_ORIGINS` and the staging hostname to `TURNSTILE_HOSTNAMES` and to the Turnstile widget in Cloudflare;
  7. first start: `docker compose --env-file /var/lib/subscription-tracker/image-tag.env -f compose.prod.yml up -d --wait`, with `alembic upgrade head` run by the backend entrypoint against the empty database

### Provisioning (manual, after PR 1 merges)

- [ ] T012 Open PR 1 once T001–T011 and the PR-1 tasks in Phases 3 and 4 are done; confirm `sqlite`, `postgres`, `visual` and the new `deploy-config` checks are green (FR-023), squash-merge
- [x] T013 (manual) Provision UpCloud per `deploy/README.md` § Provision with the staging hostnames. Record in `specs/001-upcloud-migration/research.md` under each "verify at provisioning" item: whether TLS is enforced on the database and whether a CA certificate is downloadable (decides `sslmode=verify-full` vs `require`, R4), `SHOW max_connections` (must be comfortably above 15, R2), and the billed prices seen in the console (R10)
- [x] T014 (manual) Start the stack on the staging hostnames with the current `main` tag. Confirm `https://staging.subscriptionstrack.com` and `https://api-staging.subscriptionstrack.com/health` answer with valid certificates and that `http://` redirects with `308` (FR-007, contracts/edge-http.md § Hosts and TLS)

**Checkpoint**: an empty-database copy of the app runs on UpCloud behind
Caddy on the staging hostnames. User story work can start.

---

## Phase 3: User Story 1 - Users keep using the app (Priority: P1) 🎯 MVP — preparation and rehearsal

**Goal**: Everything the cutover needs, proven on staging: edge behavior the
rate limits depend on, the data copy and its check, and the runbooks.

**Independent Test**: on staging, the verify script prints matching row
counts and per-user aggregates against Neon; signup → verify → sign in →
reset works; the 6th rapid `/token` attempt gets `429`.

### Tests for User Story 1 (PR 1)

- [x] T015 [P] [US1] Create `deploy/tests/edge/compose.edge.yml`, an override of `deploy/compose.prod.yml` with a header comment: builds `backend` from `./backend` and `frontend` from `./frontend` instead of pulling GHCR images; backend on SQLite with `TRUST_FORWARDED_FOR=true` and rate limits enabled; `APP_HOST=app.localhost`, `API_HOST=api.localhost`, `CADDY_TEST_GLOBALS=local_certs`; the flags directory bind-mounted from a pytest temp dir; Caddy's 443 published on a free local port
- [x] T016 [US1] Create `deploy/tests/edge/test_edge.py` (marker `edge`), starting the stack from T015 once per module and tearing it down after. Each test's name and docstring name the rule it protects (Principle II):
  - `test_spoofed_forwarded_for_cannot_dodge_the_token_rate_limit`: 6 `POST https://api.localhost/token` requests, each with a different `X-Forwarded-For`; the 6th must be `429` (FR-009, contracts/edge-http.md § Client address);
  - `test_maintenance_flag_answers_503_on_both_hosts`: with `flags/maintenance` present, `GET /` on both hosts is `503` with `Retry-After: 600`, `Cache-Control: no-store` and the maintenance text (FR-005);
  - `test_health_passes_through_during_maintenance`: `GET https://api.localhost/health` is `200` with the flag present;
  - `test_removing_the_flag_restores_service_without_reload`: after `rm`, both hosts serve normally with no container restart;
  - `test_backend_and_frontend_ports_are_not_published`: `docker compose port` returns nothing for `backend:8000` and `frontend:80`.
  Use `ssl` with Caddy's internal root (copied out of the `caddy_data` volume) rather than disabling verification

### Implementation for User Story 1

- [x] T017 [P] [US1] Create `deploy/bin/verify-copy.sql` with a header comment: one query each for per-table row counts of `users`, `subscription_groups`, `categories`, `subscriptions`, `fx_rates`, `email_sends` and `alembic_version`; the `last_value` of every sequence; and per-user aggregates ordered by user id (subscription count, category count, `sum(cost)` per currency). Output must be stable text so two runs can be diffed (research R11)
- [x] T018 [US1] Create `deploy/bin/verify-copy.sh` (POSIX `sh`, header comment, passes `shellcheck`): reads `OLD_DATABASE_URL` and `NEW_DATABASE_URL` from the environment (never as arguments, so they don't show in `ps`), runs `verify-copy.sql` against each through `docker run --rm postgres:18 psql`, writes both outputs to a temp dir, prints `diff -u`, exits `0` on a match and `1` otherwise, and never prints either URL. Note in the PR that it has no automated test because it needs two live Postgres servers; T021 and T044 prove it (Principle II)
- [x] T019 [US1] Write `deploy/README.md` § Cutover as the timed checklist from research R12, with exact commands:
  - T−24 h: lower both DNS records' TTL to 60 s; announce the window (optional email);
  - T−0: `touch /var/lib/subscription-tracker/flags/maintenance` on the new server; pause the UptimeRobot monitors; switch `APP_HOST`/`API_HOST` and `CORS_ORIGINS` to the production names, `docker compose up -d`; point both A records at the server; confirm Caddy obtained production certificates;
  - T+5 min: freeze writes: `az containerapp ingress disable` on the backend Container App, then on Neon `ALTER DATABASE <db> SET default_transaction_read_only = on;` and `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '<db>' AND pid <> pg_backend_pid();`;
  - T+6: on the server, `pg_dump -Fc --no-owner --no-privileges` over Neon's **unpooled** endpoint with `sslmode=require`; drop and recreate the public schema on UpCloud; `pg_restore --no-owner --no-privileges --exit-on-error` over the private network; `ANALYZE`; run `verify-copy.sh` (all through `postgres:18`);
  - T+10: smoke test with the hostnames forced to the new IP (`curl --resolve`, browser hosts entry): test account signs in and totals match the T−0 record; a reset link requested before T−0 still works; signup → verify → sign in → reset with a fresh address;
  - T+15: `rm` the maintenance flag; resume UptimeRobot; merge PR 3.
  State the 30-minute ceiling (FR-005, SC-003) and the point after which the Rollback section applies
- [x] T020 [US1] Write `deploy/README.md` § Rollback with both cases from research R12:
  - **before the maintenance flag is removed**: DNS back to Azure, `az containerapp ingress enable`, Neon `ALTER DATABASE … SET default_transaction_read_only = off`; nothing is lost;
  - **after, within the soak period**: maintenance on, dump UpCloud and restore it into Neon (replacing Neon's contents) so writes since cutover are **copied back, not lost**, run `verify-copy.sh` in the reverse direction, Neon read-write, Azure ingress on, DNS back

### Rehearsal on staging (manual)

- [ ] T021 [US1] (manual) Copy Neon into the UpCloud database using the dump/restore/verify steps of § Cutover **without** freezing Neon (quickstart §2 step 2). Expected: `verify-copy.sh` exits 0 (FR-003). Fix the runbook in a follow-up PR if any command was wrong
- [ ] T022 [US1] (manual) On staging, run signup → verify → sign in → password reset with a fresh address. Expected: emails arrive, Turnstile passes, the email caps apply, and the 6th rapid `/token` attempt gets `429` (FR-008, FR-009; quickstart §2 step 3)
- [ ] T023 [US1] (manual) From a laptop, `psql` to the database's hostname must be refused or time out; from the server, connecting with the `sslmode` chosen in T013 must succeed (FR-010; quickstart §2 step 4)
- [ ] T024 [US1] (manual) Stop the database connection (e.g. restart the managed database from the console) while the app runs: `/health` must answer `503` within its timeout rather than hang, and recover on its own when the database is back (edge case "Database unreachable")

**Checkpoint**: the data copy is proven and every runbook step has been run
once. The cutover itself waits for Phase 4.

---

## Phase 4: User Story 3 - The maintainer can deploy, recover and stay within budget (Priority: P2)

**Goal**: Merges deploy themselves with health-gated rollback, a backup can
be restored by runbook, and the maintainer hears about downtime and filling
resources.

**Independent Test**: merge a trivial change and watch it reach staging (and,
after cutover, production) with no manual step; follow § Restore into a
scratch database and match row counts; stop the backend and receive the
downtime alert.

### Tests for User Story 3 (PR 1, written first; they must fail before T030/T031)

- [x] T025 [P] [US3] Create `deploy/tests/test_deploy_guard.py`, running `deploy/bin/deploy.sh` as a subprocess with `SSH_ORIGINAL_COMMAND` set and a fake `docker` (and fake `curl`) on `PATH` that append their argv to a log file and exit with codes the test chooses. Test names and docstrings state the rule (contracts/deploy-interface.md § Tests):
  - each of `""`, `"latest"`, `"sha-ABCDEFG"`, `"sha-1234567; rm -rf /"`, `"sha-1234567 extra"`, `"$(id)"` exits **64** and the fake records **no** calls;
  - `sha-1234567` reaches `docker compose pull`;
  - a failing `up --wait` restores `previous-tag`, runs `up -d --wait` again and exits **1**;
  - a failing rollback exits **2**;
  - a failing `pull` exits **75** with the running tag unchanged;
  - a failing `https://$API_HOST/health` check after a successful `up` rolls back and exits **1**;
  - stdout and stderr never contain a value from the env file (seed it with a sentinel string)
- [x] T026 [P] [US3] Create `deploy/tests/test_ops_check.py`, importing `deploy/bin/ops-check.py` via `importlib` and injecting fakes for `/proc/meminfo` content, `statvfs`, the `psql` runner, the TLS probe, the Resend sender and the clock (never the wall clock, Principle II). Tests (contracts/ops-alerts.md § Tests):
  - memory, disk and `db_size` at exactly 80% do **not** fire; just over 80% does;
  - firing then still firing sends exactly one email in total;
  - firing then back under sends exactly one `RECOVERED` email;
  - a failed send leaves `ops-state.json` unchanged, so the next run retries;
  - `cert:<host>` fires at 13 days 23 h left and not at exactly 14 days;
  - `check_error` fires only after a check fails to run on 3 consecutive runs;
  - the subject format is `[subscriptionstrack] ALERT <check id>: <detail>` / `RECOVERED`;
  - with `UPTIMEROBOT_HEARTBEAT_URL` unset no heartbeat is sent, with it set one GET is made

### Implementation for User Story 3 (PR 1)

- [x] T027 [US3] Create `deploy/bin/deploy.sh` (bash, header comment, reasons inline, passes `shellcheck`) implementing contracts/deploy-interface.md exactly:
  1. validate `$SSH_ORIGINAL_COMMAND` against `^sha-[0-9a-f]{7}$` **before any other command**, else exit 64;
  2. `flock /var/lib/subscription-tracker/deploy.lock`;
  3. read the running tag from `/var/lib/subscription-tracker/image-tag.env` and write it to `/var/lib/subscription-tracker/previous-tag`;
  4. write `IMAGE_TAG=<tag>` to `image-tag.env` (resolves the conflict that the secrets file is `root:deploy 0640` and so not writable by `deploy`; record this in the header comment and in data-model.md § Deploy record);
  5. `docker compose pull` (failure → restore tag, exit 75), then `docker compose up -d --wait --wait-timeout 120`;
  6. `curl -fsS https://$API_HOST/health` through Caddy;
  7. on failure in 5 or 6, restore `previous-tag`, `up -d --wait`, exit 1; if that fails, exit 2.
  Paths (`STATE_DIR`, `ENV_FILE`, `COMPOSE_FILE`) default to the production paths and may be overridden by environment for the tests; comment why that is safe (`restrict` and sshd's default `PermitUserEnvironment no` mean an SSH client cannot set them). Never `cat` or echo the env file
- [x] T028 [US3] Create `deploy/bin/ops-check.py` (stdlib-only Python 3, header comment) implementing contracts/ops-alerts.md:
  - subcommands `frequent` (memory, disk; 5 min), `hourly` (`db_size` via `docker run --rm postgres:18 psql "$DATABASE_URL" -tAc 'SELECT pg_database_size(current_database())'` against `DB_STORAGE_GIB`) and `daily` (`cert:<APP_HOST>`, `cert:<API_HOST>` via an `ssl` handshake reading `notAfter`);
  - reads `/etc/subscription-tracker/.env` itself (no third-party dotenv);
  - state in `/var/lib/subscription-tracker/ops-state.json` as `{ "<check>": { "firing": bool, "since": ISO-8601 UTC, "detail": str } }` (data-model.md § Alert state), written atomically (temp file + rename);
  - transitions `ok → firing` sends ALERT once, `firing → firing` sends nothing, `firing → ok` sends RECOVERED once; state advances only after a successful send;
  - `check_error` after 3 consecutive failures to run a check (consecutive count stored in the same state file);
  - emails via `urllib` POST to `https://api.resend.com/emails` with `RESEND_API_KEY` and `EMAIL_FROM` to `ALERT_EMAIL`; body has measured value, threshold, UTC time and the `deploy/README.md` section to follow;
  - optional GET to `UPTIMEROBOT_HEARTBEAT_URL` on every `frequent` run;
  - every collaborator (clock, file paths, psql runner, TLS probe, sender) injectable for T026
- [x] T029 [P] [US3] Create `deploy/systemd/ops-check-frequent.service` + `.timer` (every 5 min), `ops-check-hourly.service` + `.timer` and `ops-check-daily.service` + `.timer`, each `User=deploy` (needs the `docker` group for `psql` and read access to the `root:deploy` env file), with header comments; add their install and `systemctl enable --now` to `deploy/cloud-init.yaml`
- [x] T030 [US3] Write `deploy/README.md` § Deploys (how CI calls the forced command, the exit-code table from contracts/deploy-interface.md), § Manual rollback (for exit 2: SSH as `admin`, write the last good tag to `image-tag.env`, `docker compose up -d --wait`), § Migrations (keep migrations additive, expand then contract, because a rollback does not downgrade the schema, research R6) and § Alerts (the table from contracts/ops-alerts.md, including UptimeRobot and what each alert's runbook step is)
- [x] T031 [US3] Write `deploy/README.md` § Restore: create a **new** database service from UpCloud's backups (point-in-time within the last 3 days, FR-017), attached to the same SDN network; point a scratch backend at it (`docker run` of the backend image with an overridden `DATABASE_URL`, no Caddy) and compare `verify-copy.sh` output with production; to make it production, update `DATABASE_URL` in the env file, `docker compose up -d --wait`, then delete the old service. State the SC-005 target of under 1 hour and the accepted risk (no copy outside UpCloud, plan.md § Spec changes)

### Deploy job (PR 2, after T012 merged and staging is up)

- [ ] T032 [US3] Add job `deploy-upcloud` to `.github/workflows/build-and-push.yml` next to the existing Azure `deploy` job, with comments in the file's existing style:
  - `needs: build`, `if: github.ref == 'refs/heads/main' && vars.UPCLOUD_DEPLOY_ENABLED == 'true'`;
  - `concurrency: { group: upcloud-deploy, cancel-in-progress: false }`;
  - `permissions: contents: read` only;
  - steps: compute `sha-${GITHUB_SHA::7}` exactly as the Azure job does; write `secrets.UPCLOUD_DEPLOY_SSH_KEY` to a `0600` temp file and `secrets.UPCLOUD_KNOWN_HOSTS` to a known-hosts file; `ssh -i <key> -o UserKnownHostsFile=<file> -o StrictHostKeyChecking=yes deploy@${{ secrets.UPCLOUD_DEPLOY_HOST }} "$TAG"`; a non-zero exit fails the job
- [ ] T033 [US3] (manual) Generate the deploy key pair (ed25519, comment `gha-deploy`), install the public key in `deploy`'s `authorized_keys` with the `restrict,command=…` prefix, run `ssh-keyscan` on the server's public IP and check the fingerprint against the console, then set repository secrets `UPCLOUD_DEPLOY_SSH_KEY`, `UPCLOUD_DEPLOY_HOST`, `UPCLOUD_KNOWN_HOSTS` and variable `UPCLOUD_DEPLOY_ENABLED=true` (`GH_TOKEN` for the `juusimaa` account if `gh` needs it)
- [ ] T034 [US3] Open and merge PR 2 (T032). Expected: the next `main` build's `deploy-upcloud` job is green and staging serves the new tag (FR-015; quickstart §2 step 1)

### Verification on staging (manual)

- [ ] T035 [US3] (manual) `nmap -Pn -p 1-10000 <server-ip>` shows only 22, 80 and 443 open; `ssh -i <deploy key> deploy@<ip> id` exits 64 with no shell; password SSH for `admin` is refused (FR-011, FR-016; quickstart §2 step 5)
- [ ] T036 [US3] (manual) `sudo reboot`; the site must be back with no manual step within 3 minutes. Then check `/etc/docker/daemon.json` log caps are in effect and `systemctl list-timers` shows `image-prune` and the three `ops-check` timers (FR-012; quickstart §2 step 6)
- [ ] T037 [US3] (manual) Deploy a deliberately broken tag (a throwaway branch build whose `/health` returns 503, invoked over the deploy key by hand). Expected: exit 1, the previous version keeps serving (FR-015, US3 scenario 2; quickstart §2 step 7)
- [ ] T038 [US3] (manual) Restore drill per § Restore into a scratch service; time it; row counts must match; delete the scratch service afterwards. Record the duration in the PR or `deploy/README.md` (FR-017, FR-018, SC-005; quickstart §2 step 8). **Precondition for the cutover (T044)**
- [ ] T039 [US3] (manual) Create UptimeRobot Free monitors: HTTPS keyword monitor on the app host (a keyword that appears only in the app's HTML, not the maintenance page) and HTTPS monitor on `<api host>/health`, 5-minute interval, email to the maintainer; check whether the free plan offers a heartbeat monitor and, if so, set `UPTIMEROBOT_HEARTBEAT_URL`. Record the outcome in research.md R8 (FR-019). Point them at the staging hostnames now; T045 switches them
- [ ] T040 [US3] (manual) Alert drill: `fallocate` a file pushing `/` past 80% and stop the backend for 6 minutes. Expected: exactly one ALERT and one RECOVERED email for each, no repeats (FR-019, FR-028; quickstart §2 step 9)

**Checkpoint**: deploys, rollback, restore and alerts are proven on staging.
The cutover can be scheduled.

---

## Phase 5: User Story 1 - Users keep using the app (Priority: P1) 🎯 MVP — cutover

**Goal**: Production moves to UpCloud with nothing lost.

**Independent Test**: per-table row counts and sampled per-user totals match
the pre-cutover record; the test account signs in with its existing password;
signup → verify → sign in → reset works with a new address; both public URLs
have valid certificates.

### Production docs (PR 3, prepared before, merged in the window)

- [ ] T041 [P] [US1] Update `README.md` so UpCloud is production (FR-022): the intro and § Stack (UpCloud server + managed PostgreSQL 16 in `fi-hel1`, no Redis), the `TRUST_FORWARDED_FOR` row of the environment table ("the real client behind Caddy"), § 9 Docker & Compose (point to `deploy/compose.prod.yml` and `deploy/README.md`), § 10 CI table (`build-and-push.yml` deploys over SSH; new `deploy-config` job), § Open signup's rate-limit line ("behind Caddy"), § Backup and restore (provider backups, 3 days, link to `deploy/README.md` § Restore), § Project layout (`deploy/`). Azure stays mentioned only as the rollback target until US4
- [ ] T042 [P] [US1] Update the comment in `backend/app/main.py` above `TRUST_FORWARDED_FOR` (lines ~195–205): replace "Envoy appends…" with Caddy's behavior (it **replaces** the header with the peer address, so the last, and only, entry is the real client), keeping the warning about running without a proxy. Update the `TRUST_FORWARDED_FOR` note in `.env.example` the same way. Comment-only change; no test change needed, state so in the PR
- [ ] T043 [P] [US1] Update the `pool_pre_ping` comment in `backend/app/database.py` (line ~41): the reason is now "the managed database restarts for maintenance and the pool must drop dead connections", not "Neon scales to zero". Add `## Milestone 12 — UpCloud hosting` to `PLAN.md` after Milestone 11, summarizing plan.md and linking `specs/001-upcloud-migration/`. Remove "not yet live" from `deploy/README.md`

### Cutover (manual, per runbook)

- [ ] T044 [US1] (manual) **Preconditions**: T021–T024 and T034–T040 done; PR 3 open and green. At T−24 h lower both DNS records' TTL to 60 s and announce the window. Just before T−0, record per-user counts and totals from Neon with `verify-copy.sql` and export a JSON backup of the test account through the app. Then run `deploy/README.md` § Cutover end to end, timing each step. Expected: maintenance page throughout (FR-005), Azure refuses writes after the freeze, `verify-copy.sh` exits 0 (FR-003, SC-001), total ≤ 30 minutes (SC-003). Merge PR 3 at T+15 (FR-022). If anything fails before the flag is removed, follow § Rollback
- [ ] T045 [US1] (manual) Post-cutover: check certificates on `subscriptionstrack.com` and `api.subscriptionstrack.com` (US1 scenario 4); sign in as the test account and compare with its JSON export (scenario 1); open a reset link issued before T−0 (scenario 3); run signup → verify → sign in → reset with a new address (scenario 2); switch the UptimeRobot monitors to the production hostnames and unpause them; confirm the next merge's `deploy-upcloud` job deploys production. Start the 7-day soak clock and note the date in `PLAN.md` Milestone 12

**Checkpoint**: MVP delivered — production runs on UpCloud with all data and
behavior preserved.

---

## Phase 6: User Story 2 - Fast responses at any time of day (Priority: P2)

**Goal**: No cold start. Met by design (nothing scales to zero); this phase
proves it.

**Independent Test**: after ≥ 2 hours of no traffic, the first page load is
under 2 s and the first sign-in under 1 s from a European connection.

- [ ] T046 [US2] Check that nothing in `deploy/compose.prod.yml` or `deploy/cloud-init.yaml` stops or idles a service (no `scale`, no on-demand socket activation) and that the backend pool settings in `backend/app/database.py` keep connections warm; if a gap is found, fix it with a reason comment (FR-006)
- [ ] T047 [US2] (manual) After ≥ 2 hours with no traffic (early morning, UptimeRobot paused for the window so it does not warm the site), hard-reload `https://subscriptionstrack.com` and sign in with DevTools' network tab open from a European connection. Record both timings in `PLAN.md` Milestone 12. Expected: page < 2 s, sign-in < 1 s (SC-002)
- [ ] T048 [US2] (manual) From the Caddy access log, check that scanner paths (`/wp-*`, `/.git/*`, `/.env`) are answered by nginx's static fallback or a 404 without reaching the database, and that response times for real users did not change during a burst (edge case "Bot scanners"). If the backend is being hit, add a cheap `respond 404` matcher for those paths to `deploy/Caddyfile` with a reason comment and an edge test in `deploy/tests/edge/test_edge.py`

**Checkpoint**: SC-002 measured and recorded.

---

## Phase 7: User Story 5 - Pause the site to stop paying for it (Priority: P3)

**Goal**: A runbook takes hosting cost to €0 and back with nothing lost.

**Independent Test**: on a staging copy, follow § Pause: the paused notice
shows on both hostnames, the UpCloud resource list is empty and the archive is
stored outside UpCloud in two places. Follow § Resume: row counts and the test
account match the archive.

**Ordering note**: rehearse this **before** Phase 8 removes the staging
hostnames. The rehearsal must never run against production: either use a
second, temporary set of UpCloud resources provisioned per § Provision on the
staging hostnames (billed hourly, a few cents), or run it during the
pre-cutover rehearsal window if this phase is ready by then (plan, delivery
step 2).

- [ ] T049 [P] [US5] Create `deploy/maintenance/paused/index.html`: same structure and styling as `deploy/maintenance/index.html`, text saying the service is paused (not under maintenance) in English and Finnish, no JavaScript, and a header comment saying it is published to Cloudflare Pages while paused (FR-025)
- [ ] T050 [P] [US5] Create `deploy/bin/check-archive.sh` (POSIX `sh`, header comment, passes `shellcheck`): starts a throwaway local `postgres:18` container, `pg_restore`s the given `.dump` into it with `--no-owner --no-privileges --exit-on-error`, runs `deploy/bin/verify-copy.sql`, prints the output, removes the container, and, when `LIVE_DATABASE_URL` is set, diffs against the live database's output and exits non-zero on a mismatch (FR-024). Note in the PR that it is proved by T053 rather than a CI test
- [ ] T051 [US5] Write `deploy/README.md` § Pause (research R9), with exact commands and the hard rule from data-model.md ("no resource is deleted until a checked archive exists on the maintainer's machine **and** an `age`-encrypted copy is in personal storage outside UpCloud"):
  1. `touch` the maintenance flag (freezes writes);
  2. `pg_dump -Fc` on the server, `scp` to the maintainer's machine as `admin`;
  3. `check-archive.sh` with `LIVE_DATABASE_URL` reachable through an SSH tunnel; must exit 0;
  4. `age -r <maintainer pubkey>` the dump and store the encrypted copy in a second place (e.g. a personal cloud drive), access restricted to the maintainer (FR-027);
  5. delete the database, the server and its storage, the SDN router and network (stopping is not enough: they bill while stopped, R1/R2);
  6. remove both grey-cloud A records, add both hostnames as custom domains of the Cloudflare Pages project serving `deploy/maintenance/paused/` (the caveat in R9);
  7. disable `UPCLOUD_DEPLOY_ENABLED` and pause UptimeRobot.
  State that verification and reset links may expire while paused (edge case) and the SC-009 targets
- [ ] T052 [US5] Write `deploy/README.md` § Resume: remove the custom domains from the Pages project **first**, then § Provision, `pg_restore` the archive over the private network, `verify-copy.sh`/`check-archive.sh` against the archive, `rm` the maintenance flag, recreate the A records, re-enable `UPCLOUD_DEPLOY_ENABLED` (updating `UPCLOUD_DEPLOY_HOST` and `UPCLOUD_KNOWN_HOSTS` for the new server), unpause UptimeRobot; target ≤ 2 hours (SC-009)
- [ ] T053 [US5] (manual) Create the Cloudflare Pages project (free) for `deploy/maintenance/paused/` (direct upload is enough; no build). Rehearse § Pause then § Resume on staging hostnames per the ordering note above. Expected: the paused page over HTTPS on both staging hosts, an empty UpCloud resource list for the rehearsal resources, billing stopping on the next hourly line, and after resume the archive's row counts match and the test account signs in (FR-024–FR-027, SC-009; quickstart §2 step 10). Fix the runbooks from what the rehearsal finds

**Checkpoint**: pause and resume are rehearsed; FR-026's precondition for a
first real pause is met.

---

## Phase 8: User Story 4 - The old hosting is shut down cleanly (Priority: P3)

**Goal**: Azure and Neon are gone and nothing describes them as live.

**Independent Test**: the Azure resource group and Neon project no longer
exist; the Azure secrets and variable are gone from the repository settings;
`git grep -i -E 'azurecontainerapps|neon'` finds only historical notes.

**Precondition**: 7 days of production on UpCloud with no data-affecting
incident (FR-021), and T053 done if the rehearsal relies on the staging
hostnames.

- [ ] T054 [US4] (manual) Archive a final Neon export: `pg_dump -Fc` over the unpooled endpoint, check it with `deploy/bin/check-archive.sh`, keep it on the maintainer's machine and an `age`-encrypted copy in personal storage outside both providers (FR-021, US4 scenario 1)
- [ ] T055 [US4] Remove the Azure `deploy` job and its comments from `.github/workflows/build-and-push.yml`, and update the workflow's header comment so the `deploy-upcloud` job is the only deploy path
- [ ] T056 [P] [US4] Rewrite any remaining live-tense Azure/Neon references: `README.md` (intro "CI/CD to Azure", rollback-target mentions added in T041), `PLAN.md` Milestone 8 marked as superseded by Milestone 12 (keep it as history), and `deploy/README.md` § Cutover and § Rollback marked as historical (completed on the cutover date). Then run `git grep -i -E 'azurecontainerapps|azure|neon'` and confirm every hit is a historical note (SC-008, FR-022, US4 scenario 2)
- [ ] T057 [US4] (manual) Remove the staging hostnames: delete their DNS records, remove the staging origin from `CORS_ORIGINS` and the staging hostname from `TURNSTILE_HOSTNAMES` in `/etc/subscription-tracker/.env` (then `docker compose up -d`), and remove it from the Turnstile widget in Cloudflare
- [ ] T058 [US4] (manual) Delete the repository secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` and variable `AZURE_DEPLOY_ENABLED`; delete the App Registration's federated credential; delete the Azure resource group `subscription-tracker-rg`; delete the Neon project. Confirm in both consoles that nothing tied to this app is running or billing, within 14 days of cutover (FR-021, SC-008)
- [ ] T059 [US4] Open PR 4 with T055–T056, listing the manual steps T054, T057 and T058 and their dates in the description; squash-merge

**Checkpoint**: one production setup remains, and the repository describes it.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Measurements that need time in production, and final consistency.

- [ ] T060 [P] (manual) Merge a trivial PR and time it from merge to live in production; must be ≤ 15 minutes with no manual step (SC-004). Record in `PLAN.md` Milestone 12
- [ ] T061 [P] (manual) After 30 days, read UptimeRobot's availability report: ≥ 99.5% excluding the cutover window (SC-006). After the first full billing month, compare the UpCloud invoice with research R10 (€15.40 excl. VAT, under €25 incl. VAT) (SC-007, FR-020). Record both in `PLAN.md` Milestone 12
- [ ] T062 Make `deploy-config` a required status check on `main` alongside `sqlite`, `postgres` and `visual` (branch protection), and mention it in `README.md` § 10 CI
- [ ] T063 Re-read every new file under `deploy/` and the changed workflow jobs against constitution Principle I (header comment, a reason on every non-default setting) and fix gaps; run the whole of `specs/001-upcloud-migration/quickstart.md` §1 locally and confirm it passes
- [ ] T064 Update `specs/001-upcloud-migration/research.md` "verify at provisioning" items with what was found (T013, T039) and mark `spec.md` **Status** as Implemented

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup. T012 (merge PR 1) also needs the PR-1 tasks of Phases 3 and 4 (T015–T020, T025–T031). T013–T014 need PR 1 merged.
- **US1 preparation (Phase 3)**: code tasks T015–T020 can start after T004–T005; the staging rehearsal T021–T024 needs T014.
- **US3 (Phase 4)**: code tasks T025–T031 can start after Setup; T032–T040 need T014; T034 needs T033.
- **US1 cutover (Phase 5)**: needs Phase 3 **and** T034 (deploy job live, plan step 3) **and** T038 (restore drill, FR-018).
- **US2 (Phase 6)**: needs the cutover (T045).
- **US5 (Phase 7)**: code and runbook tasks T049–T052 can start any time after Phase 2; the rehearsal T053 must not touch production and should run while staging hostnames exist (before T057).
- **US4 (Phase 8)**: needs T045 plus the 7-day soak; T057 waits for T053 if that rehearsal uses the staging hostnames.
- **Polish (Phase 9)**: T060 after cutover; T061 after 30 days; the rest any time after Phase 8.

### User Story Dependencies

- **US1 (P1)**: the MVP. Its cutover depends on US3's deploy job and restore drill; nothing else.
- **US2 (P2)**: depends only on US1 being live. No code of its own unless T046/T048 find a gap.
- **US3 (P2)**: independent of the other stories; testable on staging.
- **US5 (P3)**: independent of US1–US4 in code; its rehearsal needs a non-production stack.
- **US4 (P3)**: depends on US1 (and the soak).

### Within Each User Story

- Tests (T016, T025, T026) are written first and must fail before the code they test (T005 behavior, T027, T028).
- Scripts before the runbook sections that call them; runbooks before the manual steps that follow them.
- Manual verification steps record their result where the task says, so the next phase has evidence.

### Parallel Opportunities

- Phase 1: T002 and T003.
- Phase 2: T006, T007 and T008 (different files) after T004–T005 are sketched; T010 and T011 are both in `deploy/README.md`, so run them one after the other.
- Phase 3 and Phase 4 code work can be done side by side: T015/T017 [US1] alongside T025/T026/T029 [US3].
- Phase 5: T041, T042 and T043 touch different files.
- Phase 7: T049 and T050.
- Phase 9: T060 and T061.

---

## Parallel Example: PR 1 (US1 + US3 code)

```bash
# Tests first, in parallel:
Task: "Edge stack override in deploy/tests/edge/compose.edge.yml"           # T015
Task: "Deploy guard tests in deploy/tests/test_deploy_guard.py"             # T025
Task: "ops-check tests in deploy/tests/test_ops_check.py"                  # T026

# Then the independent implementations:
Task: "Copy-check queries in deploy/bin/verify-copy.sql"                   # T017
Task: "systemd timers for ops-check in deploy/systemd/"                    # T029
```

## Parallel Example: PR 3 (production docs)

```bash
Task: "README.md: UpCloud is production"                                    # T041
Task: "XFF comment in backend/app/main.py and .env.example"                 # T042
Task: "database.py pool comment and PLAN.md Milestone 12"                   # T043
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 + Phase 2 code (T001–T011) together with the PR-1 code of Phases 3 and 4 → PR 1.
2. Provision staging (T013–T014) and rehearse the copy (T021–T024).
3. Deploy job, restore drill and alerts (T032–T040) — the cutover's preconditions.
4. Cutover with PR 3 (T041–T045).
5. **STOP and VALIDATE**: US1's independent test; then the soak begins.

### Incremental Delivery

1. PR 1 → no production effect, CI proves the stack definition.
2. Staging rehearsal → evidence for FR-003, FR-008–FR-012, FR-016–FR-019, FR-028.
3. PR 2 → merges deploy themselves (to staging, then production).
4. Cutover + PR 3 → users on UpCloud (MVP).
5. US2 measurement → SC-002 recorded.
6. US5 runbooks + rehearsal → the site can be paused safely.
7. PR 4 after the soak → one production setup.

---

## Notes

- [P] tasks touch different files and have no unfinished dependencies.
- `deploy/README.md` is written by many tasks (T010, T011, T019, T020, T030, T031, T051, T052); never run two of them at once.
- `deploy/cloud-init.yaml` is edited by T007, T008 and T029, in that order.
- Design gap resolved here: contracts/server-env.md lists `IMAGE_TAG` in the `root:deploy 0640` secrets file, but `deploy.sh` (running as `deploy`) must write it. T027 moves it to `/var/lib/subscription-tracker/image-tag.env`; T010 documents it, and T027 updates data-model.md § Deploy record. Update contracts/server-env.md's `IMAGE_TAG` row in the same PR.
- Secrets never enter the repository; `deploy/tests/sample.env` holds dummy values only.
