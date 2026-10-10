# deploy/: production on UpCloud

Everything production needs that isn't an image: the Compose file and
Caddyfile that run on the server, its first-boot setup, the deploy and
alert scripts, and the runbooks for every manual operation. The design and
the reasons behind it are in
[specs/001-upcloud-migration/](../specs/001-upcloud-migration/).

**Not yet live.** Production still runs on Azure Container Apps and Neon
until the cutover below; these files describe the server that replaces them.

| Path | What it is |
|---|---|
| `compose.prod.yml` | The stack: Caddy, backend, frontend. No database (managed) and no Redis (FR-014). |
| `Caddyfile` | TLS, reverse proxy, maintenance switch ([contract](../specs/001-upcloud-migration/contracts/edge-http.md)). |
| `maintenance/index.html` | The EN/FI page served with `503` during maintenance. |
| `cloud-init.yaml` | First-boot setup: Docker, users, SSH hardening, log caps, automatic updates. |
| `bin/deploy.sh` | The deploy key's forced command ([contract](../specs/001-upcloud-migration/contracts/deploy-interface.md)). |
| `bin/ops-check.py` | Memory, disk, database-size and certificate alerts ([contract](../specs/001-upcloud-migration/contracts/ops-alerts.md)). |
| `bin/verify-copy.sh`, `bin/verify-copy.sql` | Proves two databases hold the same data. |
| `systemd/` | Timers for `ops-check.py` and the weekly image prune. |
| `tests/` | Tests for all of the above; run by the `deploy-config` CI job. |

Run the tests locally with `pip install -r deploy/tests/requirements.txt`
and `python -m pytest deploy/tests` (the `edge` tests need Docker; add
`-m "not edge"` to skip them).

## Environment

The server reads three files. None of them is in the repository.

| File | Owner, mode | Written by | Holds |
|---|---|---|---|
| `/etc/subscription-tracker/.env` | `root:deploy`, `0640` | the maintainer, by hand | every variable below |
| `/var/lib/subscription-tracker/image-tag.env` | `deploy:deploy` | `deploy.sh` only | `IMAGE_TAG=sha-<7 hex>` |
| `/var/lib/subscription-tracker/previous-tag` | `deploy:deploy` | `deploy.sh` only | the tag that ran before the last deploy |

`IMAGE_TAG` is kept out of the secrets file on purpose: `deploy.sh` runs as
`deploy`, which can read the secrets but not write them, and the one value
it must write lives in a file it owns.

Admin shells get `COMPOSE_FILE` and `COMPOSE_ENV_FILES` from
`/etc/profile.d/subscription-tracker.sh`, so a plain `docker compose …`
there means the production stack with both env files. Every runbook below
relies on that.

**Rotating a secret**: edit `/etc/subscription-tracker/.env` with
`sudo -e`, then `docker compose up -d`. Nothing else.

**App variables** (meanings as in the main [README](../README.md)'s
environment table):

| Variable | Production value |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://<user>:<pw>@<private host>:<port>/<db>?sslmode=verify-full&sslrootcert=/etc/subscription-tracker/upcloud-ca.pem`, or `sslmode=require` if UpCloud offers no CA certificate (research R4) |
| `SECRET_KEY` | **copied unchanged from Azure**, so existing sessions and emailed links keep working |
| `CORS_ORIGINS` | `https://subscriptionstrack.com` (plus the staging origin while it exists) |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` | unchanged from Azure |
| `TURNSTILE_HOSTNAMES` | `subscriptionstrack.com` (plus the staging hostname while it exists) |
| `EMAIL_BACKEND`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DAILY_CAP` | unchanged from Azure |
| `APP_URL` | `https://subscriptionstrack.com` (the staging URL during rehearsal) |
| `REDIS_URL` | **not set**: no cache in production (FR-014) |

`TRUST_FORWARDED_FOR=true` is set by `compose.prod.yml`, not here: it is
only true because Caddy is in front. The frontend's `API_URL` is derived
from `API_HOST` there too.

**Edge variables** (read by Caddy and the frontend):

| Variable | Value |
|---|---|
| `APP_HOST` | `subscriptionstrack.com` (`staging.subscriptionstrack.com` during rehearsal) |
| `API_HOST` | `api.subscriptionstrack.com` (`api-staging.subscriptionstrack.com` during rehearsal) |
| `ACME_EMAIL` | the maintainer's address, for Let's Encrypt expiry notices |

**Operations variables** (read by `ops-check.py`, never by the app):

| Variable | Value |
|---|---|
| `ALERT_EMAIL` | where alerts go (the maintainer) |
| `DB_STORAGE_GIB` | the database plan's storage in GiB (`10`); update it whenever the storage is grown |
| `UPTIMEROBOT_HEARTBEAT_URL` | optional heartbeat URL (research R8); leave empty if the free plan has none |

## Provision

Builds the server and database from nothing, for the staging rehearsal, a
resume after a pause, or a rebuild. The order matters: the database must be
attached to the private network **when it is created** (research R4).

The account must be out of UpCloud's free trial: the trial only offers
`fi-hel2` for servers, and the network, database and server must share one
zone.

1. **Private network.** In the UpCloud console, zone `fi-hel1`, create an
   SDN private network and an SDN router, and attach the router to the
   network.
2. **Database.** Create Managed PostgreSQL:
   - version **18**: the same major as Neon, so the copy is a supported
     same-version dump and restore, and what the test suite runs (FR-002,
     Principle III);
   - plan `rdb.development.1CPU-1GB`, **10 GiB** storage, 1 node, `fi-hel1`;
   - attached to the SDN network **at creation**, since attaching later
     rebuilds the database;
   - public access **off**;
   - backup hour `02:00 UTC`.

   Note the hostname, port, user, password and database name from the
   **Connection → Private** tab. The hostname is the same one the public tab
   shows, and it works from the server even with public access off. The port is **not** 5432 (it was 11569). Download
   the CA certificate: UpCloud signs the database certificate with a
   per-project CA and enforces TLS, so production uses `verify-full`
   (research R4).
3. **Server.** Create a Starter `1xCPU-2GB` server, Ubuntu 24.04,
   `fi-hel1`:
   - storage: the plan's own **20 GB** disk, €6.00 in total. The console
     may offer a 25 GB MaxIOPS disk instead, which adds €5.58 a month for
     speed this server doesn't need (research R1, R10). Check the price
     breakdown before creating;
   - public IPv4 on, public IPv6 **off** (nothing uses it, and the firewall
     below would need a second set of rules);
   - the **existing** SDN network attached, IP by DHCP;
   - login key: your own public key, never the deploy key;
   - user data: `deploy/cloud-init.yaml` with `<ADMIN_PUBKEY>` replaced by
     your whole SSH public key line and `<DEPLOY_PUBKEY>` by only the
     base64 part of the deploy key's (`ssh-keygen -t ed25519 -C gha-deploy
     -f gha-deploy -N ''`, then `cut -d' ' -f2 gha-deploy.pub`).

   Wait for `ssh admin@<server-ip> 'cloud-init status --wait'` to print
   `status: done` before the firewall and files.
4. **Firewall.** UpCloud's rules are stateless, so replies to the server's
   own outbound traffic (apt, image pulls, ACME, DNS) need inbound rules
   too. Add these inbound IPv4 accept rules, set outbound to accept, and set
   the inbound default to drop **last** (FR-011). Keep an SSH session open
   and try a new one before closing it.

   | Protocol | Source port | Destination port | For |
   |---|---|---|---|
   | TCP | | 22 | SSH |
   | TCP | | 80 | HTTP → 308, ACME |
   | TCP | | 443 | HTTPS |
   | UDP | | 443 | HTTP/3 |
   | UDP | 53 | | DNS replies |
   | TCP | 53 | | DNS replies |
   | UDP | 123 | | NTP replies |
   | TCP | | 32768–60999 | replies to outbound connections |
   | UDP | | 32768–60999 | replies to outbound connections |
   | ICMP | | | ping, path MTU |

   The database needs no rule of its own: its replies arrive on the
   return-traffic ports.
5. **Files.** From a checkout of `main`:

   ```sh
   rsync -r deploy/compose.prod.yml deploy/Caddyfile deploy/maintenance \
     deploy/bin deploy/systemd admin@<server-ip>:/tmp/st/
   ssh admin@<server-ip>
   sudo cp -r /tmp/st/. /opt/subscription-tracker/ && rm -rf /tmp/st
   sudo chown -R root:root /opt/subscription-tracker
   sudo cp /opt/subscription-tracker/systemd/*.service \
     /opt/subscription-tracker/systemd/*.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now image-prune.timer ops-check-frequent.timer \
     ops-check-hourly.timer ops-check-daily.timer
   ```

   The timers are enabled here rather than in `cloud-init.yaml` because
   these files don't exist on the server until this step.

   Then write the secrets file, with values from the Azure Container Apps
   secrets and the database from step 2 (§ Environment):

   ```sh
   sudo install -o root -g deploy -m 0640 /dev/null /etc/subscription-tracker/.env
   sudo -e /etc/subscription-tracker/.env
   # if step 2 offered a CA certificate:
   sudo install -o root -g deploy -m 0644 ca.pem /etc/subscription-tracker/upcloud-ca.pem
   ```

6. **DNS and allow-lists.** At Cloudflare, add **grey-cloud** (DNS only) A
   records for `staging` and `api-staging` pointing at the server's public
   IPv4. When moving the names from an older server, stop that server's
   stack first (`docker compose stop`): Let's Encrypt may still resolve the
   old address, fail validation there and make Caddy back off for minutes.
   If that happens, `docker compose restart caddy` once DNS has moved
   (Let's Encrypt allows 5 failed validations per hostname an hour). Add `https://staging.subscriptionstrack.com` to `CORS_ORIGINS`
   and `staging.subscriptionstrack.com` to `TURNSTILE_HOSTNAMES` (Azure's
   too, if Turnstile must pass there) and to the Turnstile widget's
   hostnames in Cloudflare.
7. **First start**, with the tag of the current `main` build (the `sha-…`
   tag in GHCR):

   ```sh
   echo IMAGE_TAG=sha-<7 hex> | sudo -u deploy tee /var/lib/subscription-tracker/image-tag.env
   docker compose up -d --wait
   ```

   The backend's entrypoint runs `alembic upgrade head` against the empty
   database. Check `https://staging.subscriptionstrack.com` and
   `https://api-staging.subscriptionstrack.com/health`.

## Deploys

Merges to `main` deploy themselves: CI's `deploy-upcloud` job runs
`ssh deploy@<server> sha-<7 hex>`, and the deploy key's forced command runs
`bin/deploy.sh` with that tag. The job's result is the script's exit code:

| Exit | Meaning | Production afterwards | Action |
|---|---|---|---|
| 0 | new tag live and healthy | new version | none |
| 1 | new tag failed health; rolled back | previous version (schema may be newer, § Migrations) | fix forward with a new PR |
| 2 | rollback failed too | **degraded** | § Manual rollback, now |
| 64 | invalid tag | unchanged, nothing ran | check the workflow |
| 75 | image pull failed | unchanged | re-run the job |

A deploy checks the new version twice: `docker compose up --wait` (the
backend's healthcheck reaches the database) and `https://$API_HOST/health`
through Caddy.

To deploy a tag by hand, from a machine holding the deploy key:
`ssh -i gha-deploy deploy@<server-ip> sha-<7 hex>`.

## Manual rollback

For deploy exit 2, or any time a known-good version must run again:

```sh
ssh admin@<server-ip>
cat /var/lib/subscription-tracker/previous-tag   # the last version before the failed deploy
echo IMAGE_TAG=sha-<good tag> | sudo -u deploy tee /var/lib/subscription-tracker/image-tag.env
docker compose up -d --wait
docker compose ps; docker compose logs --tail 100 backend
```

If no tag starts, the problem is not the image: check the database (UpCloud
console), the disk (`df -h`) and `docker compose logs caddy`.

## Migrations (expand, then contract)

A rollback restores the previous **image**, not the previous **schema**: the
new image's entrypoint has already run `alembic upgrade head`, and nothing
runs a downgrade (research R6). The old version must therefore work on the
new schema. Keep every migration additive:

1. **Expand**: add the new column or table (nullable or with a default) and
   ship code that works with or without it.
2. **Contract**: drop or tighten the old one only in a later PR, after the
   expand release has been live for a while.

Renaming a column is an expand (add new, write both) plus a contract (drop
old), never a single `ALTER … RENAME`.

## Alerts

Everything emails the maintainer: UptimeRobot directly, everything else
through `ops-check.py` and Resend. Each alert is sent once when it starts
and once (`RECOVERED`) when it clears. Subject:
`[subscriptionstrack] ALERT <check>: <detail>`.

| Check | Fires when | Cadence | What to do |
|---|---|---|---|
| UptimeRobot, app | `https://subscriptionstrack.com` lacks the app's keyword (also during maintenance) | 5 min | `docker compose ps`; if a container is down, `docker compose logs <service>`; § Manual rollback if the last deploy is the cause |
| UptimeRobot, API | `https://api.subscriptionstrack.com/health` is not 200 | 5 min | as above; `/health` failing with the containers up means the database is unreachable: check it in the UpCloud console |
| `memory` | over 80% of memory in use | 5 min | `docker stats --no-stream`; restart the heavy container; if it recurs, consider a larger plan |
| `disk` | over 80% of `/` in use | 5 min | `docker system df`; `docker image prune -a --filter until=168h`; check `/var/lib/docker/containers` log sizes |
| `db_size` | database over 80% of `DB_STORAGE_GIB` | hourly | grow storage by 10 GiB in the UpCloud console (online), then update `DB_STORAGE_GIB` |
| `cert:<host>` | under 14 days to expiry, or the certificate is invalid | daily | `docker compose logs caddy \| grep -i acme`; check DNS still points here and ports 80/443 are open |
| `check_error` | a check could not run 3 times in a row | per run | `journalctl -u ops-check-<kind>` for the error |
| heartbeat (optional) | `ops-check` stopped pinging | per UptimeRobot | the server is down or the timers stopped: `systemctl list-timers` |

Also in place without anything here: UpCloud's low-balance email, and
GitHub's failed-workflow email for deploys.

## Restore

Restores the database from UpCloud's backups: point-in-time, anywhere in
the last **3 days** (FR-017). Target: under **1 hour** from start to
production running on the restored data (SC-005). Accepted risk: there is
no copy outside UpCloud, so data deleted and noticed after 3 days, or the
loss of the UpCloud account, is not recoverable (plan.md § Spec changes).

1. In the UpCloud console, open the database → Backups → restore to a
   point in time. This creates a **new** database service. Put it in
   `fi-hel1`, on the **same SDN network**, public access off.
2. Check it before trusting it, from the server, with a scratch backend
   that never serves traffic (no Caddy, no ports):

   ```sh
   docker run --rm -e DATABASE_URL='<restored URL>' \
     ghcr.io/juusimaa/subscription-tracker-backend:$(sed -n 's/^IMAGE_TAG=//p' /var/lib/subscription-tracker/image-tag.env) \
     python -c "print('connects')"
   ```

   The entrypoint runs `alembic upgrade head` first, so this also proves
   the restored schema is current. Then compare it with production:

   ```sh
   export OLD_DATABASE_URL='<production URL>' NEW_DATABASE_URL='<restored URL>'
   /opt/subscription-tracker/bin/verify-copy.sh
   ```

   Differences are expected (that's why you're restoring); read them and
   make sure they are the ones you want.
3. To make it production: `sudo -e /etc/subscription-tracker/.env`, set
   `DATABASE_URL` to the restored service, then `docker compose up -d --wait`.
   Check the site.
4. Delete the old database service once the restored one has run cleanly
   for a day.

## Cutover

The one-time move from Azure + Neon. Total maintenance target **≤ 30
minutes** (FR-005, SC-003); the plan takes about 15. Preconditions: the
staging rehearsal and restore drill are done (tasks T021–T024, T034–T040),
and PR 3 (production docs) is open and green.

Throughout, `<db>` is Neon's database name, and `NEON_URL` is Neon's
**unpooled** connection string with `sslmode=require` (Neon advises against
dumping through the pooler).

**T−24 h**

- At Cloudflare, lower the TTL of the apex and `api` records to 60 s.
- Announce the window (optional email).

**T−0: maintenance on, DNS over**

```sh
ssh admin@<server-ip>
sudo touch /var/lib/subscription-tracker/flags/maintenance
```

- Pause both UptimeRobot monitors.
- `sudo -e /etc/subscription-tracker/.env`: set `APP_HOST=subscriptionstrack.com`,
  `API_HOST=api.subscriptionstrack.com`, `APP_URL=https://subscriptionstrack.com`,
  and the production origin in `CORS_ORIGINS`. Then `docker compose up -d --wait`.
- At Cloudflare, point both A records (apex and `api`, grey cloud) at the
  server's IPv4.
- Watch Caddy obtain the production certificates:
  `docker compose logs -f caddy | grep -i "certificate obtained"`.

From here, visitors whose DNS has switched see the maintenance page; the
rest still reach Azure, which still works, so nothing they write is lost.

**T+5 min: freeze writes on the old side**

```sh
az containerapp ingress disable -n <backend app> -g subscription-tracker-rg
```

Then, in Neon's SQL editor:

```sql
ALTER DATABASE <db> SET default_transaction_read_only = on;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE datname = '<db>' AND pid <> pg_backend_pid();
```

**T+6: copy**, on the server (`UPCLOUD_URL` is `DATABASE_URL` from the env
file in `postgresql://` form):

```sh
export NEON_URL='postgresql://…?sslmode=require' UPCLOUD_URL='postgresql://…'
cd /tmp
docker run --rm -e NEON_URL -v "$PWD:/work" postgres:18 \
  sh -c 'pg_dump -Fc --no-owner --no-privileges -f /work/neon.dump "$NEON_URL"'
docker run --rm -e UPCLOUD_URL -v /etc/subscription-tracker:/etc/subscription-tracker:ro postgres:18 \
  sh -c 'psql "$UPCLOUD_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
docker run --rm -e UPCLOUD_URL -v "$PWD:/work" -v /etc/subscription-tracker:/etc/subscription-tracker:ro postgres:18 \
  sh -c 'pg_restore --no-owner --no-privileges --exit-on-error -d "$UPCLOUD_URL" /work/neon.dump && psql "$UPCLOUD_URL" -c ANALYZE'
OLD_DATABASE_URL="$NEON_URL" NEW_DATABASE_URL="$UPCLOUD_URL" /opt/subscription-tracker/bin/verify-copy.sh
```

`verify-copy.sh` must exit 0. If it doesn't, stop: § Rollback, first case.

**T+10: smoke test**, with the hostnames forced to the new server:

- `curl --resolve api.subscriptionstrack.com:443:<server-ip> https://api.subscriptionstrack.com/health`
  → 200.
- With a hosts-file entry for both names: the test account signs in and its
  totals match the T−0 record; a reset link requested before T−0 still
  works; signup → verify → sign in → reset works with a fresh address.

**T+15: open**

```sh
sudo rm /var/lib/subscription-tracker/flags/maintenance
```

- Resume UptimeRobot (switch the monitors to the production hostnames).
- Merge PR 3.

Up to this point every step is undone by § Rollback's first case. After the
flag is removed, users write to UpCloud, and the second case applies.

## Rollback

**Before the maintenance flag is removed.** Nothing was written to UpCloud
that matters, and Neon holds everything:

1. At Cloudflare, point both A records back to their Azure values.
2. `az containerapp ingress enable -n <backend app> -g subscription-tracker-rg --type external --target-port 8000`
3. In Neon: `ALTER DATABASE <db> SET default_transaction_read_only = off;`
4. Resume the UptimeRobot monitors.

**After it is removed, within the 7-day soak.** Writes since the cutover are
on UpCloud only; they are **copied back, not lost**:

1. `sudo touch /var/lib/subscription-tracker/flags/maintenance`
2. Dump UpCloud and restore it into Neon, replacing Neon's contents (the
   same commands as § Cutover's copy step with `NEON_URL` and `UPCLOUD_URL`
   swapped; Neon is still read-only, so first
   `ALTER DATABASE <db> SET default_transaction_read_only = off;`).
3. `OLD_DATABASE_URL="$UPCLOUD_URL" NEW_DATABASE_URL="$NEON_URL" verify-copy.sh`
   must exit 0.
4. Azure ingress on (step 2 above), DNS back (step 1 above).
5. Leave the UpCloud server in maintenance until the cause is understood.

## Pause

To be written with the pause/resume work (tasks T049–T053).

## Resume

To be written with the pause/resume work (tasks T049–T053).

## Decommission

To be written after the cutover and the 7-day soak (tasks T054–T059).
