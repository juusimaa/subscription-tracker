# Data Model: Move Hosting from Azure to UpCloud

**The application schema does not change.** No model or migration is added.
`alembic upgrade head` on the new database must produce exactly the schema
`test_migrations.py` already checks.

This document lists the entities the move adds: what each holds and how its
state changes.

## Production server

| Field | Value / rule |
|---|---|
| Plan | Starter `1xCPU-2GB`, zone `fi-hel1`, Ubuntu 24.04 LTS |
| Interfaces | public IPv4 (DNS A records point here), plus SDN private (reaches the database) |
| Firewall | inbound 22/tcp, 80/tcp and 443/tcp; everything else dropped. Stateless rules, so return traffic is allowed explicitly. |
| Users | `admin` (maintainer, key only, sudo); `deploy` (forced-command key only, in the `docker` group) |
| Files | `/opt/subscription-tracker/` (Compose file, Caddyfile, `bin/`, `maintenance/`, `systemd/`); `/etc/subscription-tracker/.env` (secrets, `root:deploy 0640`); `/var/lib/subscription-tracker/` (`image-tag.env`, `previous-tag`, `deploy.lock`, `ops-state.json`, `flags/`) |
| Volumes | `caddy_data` (certificates, must persist), `caddy_config` |

## Managed database

| Field | Value / rule |
|---|---|
| Plan | `rdb.development.1CPU-1GB`, 10 GiB, 1 node, PostgreSQL **16** |
| Network | attached to the SDN network at creation; `public_access = false` |
| Connection | private hostname; `sslmode=verify-full` with UpCloud's CA, or `require` (R4) |
| Backups | provider only: daily full + WAL every 5 min, 3-day PITR, backup hour 02:00 UTC. A restore creates a new database service (research R3). |
| Growth | storage +10 GiB steps, online; `DB_STORAGE_GIB` in the server env must be updated to match |

## Alert state (`ops-state.json`)

One entry per check id (`memory`, `disk`, `db_size`, `cert:<host>`,
`check_error`), plus one consecutive-failure counter per check group
(`errors:memory`, `errors:disk`, `errors:db_size`, `errors:cert`) that
drives `check_error`:

```text
{ "<check>":        { "firing": bool, "since": ISO-8601 UTC | null, "detail": str },
  "errors:<group>": { "consecutive": int } }
```

A counter resets to 0 when its check runs; at 3, `check_error` fires.

Transitions for each check:

```text
ok ──(threshold crossed)──▶ firing   : send "ALERT" email once
firing ──(still crossed)──▶ firing   : no email
firing ──(back under)─────▶ ok       : send "RECOVERED" email once
```

If an email fails to send, the state is not advanced, so the next run
retries.

## Site state machine

```text
                 cutover runbook
   (azure) ───────────────────────────▶ live
                                         │  ▲
            touch flags/maintenance      │  │  rm flags/maintenance
                                         ▼  │
                                     maintenance
                                         │  ▲
            pause runbook                │  │  resume runbook
            (archive → delete → Pages)   ▼  │  (provision → restore → DNS back)
                                       paused
```

| State | DNS | Server | Database | Visitors see | Cost |
|---|---|---|---|---|---|
| live | A → server | running | running | the app | €20.98 + VAT |
| maintenance | A → server | running, Caddy serves 503 | running | EN/FI maintenance page, `503` + `Retry-After` | same |
| paused | Cloudflare Pages custom domain | **deleted** | **deleted** | EN/FI "paused" page | €0 |

Rule: going from **maintenance** to **paused** requires a checked archive on
the maintainer's machine *and* an `age`-encrypted copy in personal storage
outside UpCloud (FR-027) before any resource is deleted. UpCloud's backups
are deleted along with the database.

## Deploy record

| Field | Rule |
|---|---|
| `IMAGE_TAG` | in `/var/lib/subscription-tracker/image-tag.env` (deploy-owned), not the secrets file, so `deploy.sh` can write it without write access to secrets; always `sha-<7 hex>`, never `latest` |
| `previous-tag` | the tag running before the last deploy, used by the automatic rollback and for a manual one |
| Lock | `flock /var/lib/subscription-tracker/deploy.lock`; a second deploy waits and never runs in parallel |
