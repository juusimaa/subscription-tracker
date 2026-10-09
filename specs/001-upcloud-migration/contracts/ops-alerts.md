# Contract: Operational alerts

Every alert goes by email to `ALERT_EMAIL`. Each alert is sent **once when
it starts firing** and **once when it recovers**; it is never repeated while
the condition holds. The state lives in `ops-state.json` (see
[data-model.md](../data-model.md)). Spec requirements: FR-019, FR-028, and the
edge cases on certificates and disk space. There is no cost alert and no
backup alert (FR-017 and FR-019 as amended on 2026-10-09).

| Check id | Source | Condition (fires when) | Cadence | Spec |
|---|---|---|---|---|
| `uptime:app`, `uptime:api` | UptimeRobot Free (external) | `https://subscriptionstrack.com` lacks its app keyword, or `https://api.subscriptionstrack.com/health` is not 200, for one 5-minute interval | 5 min | FR-019 |
| `memory` | `/proc/meminfo` | `1 − MemAvailable/MemTotal > 0.80` | 5 min | FR-028 |
| `disk` | `statvfs("/")` | used > 80% | 5 min | FR-028, edge case "disk full" |
| `db_size` | `SELECT pg_database_size(current_database())` through `postgres:16` `psql` | size > 80% of `DB_STORAGE_GIB` | hourly | FR-028 |
| `cert:<host>` | TLS handshake to each host, read `notAfter` | under 14 days to expiry | daily | edge case "certificate renewal" |
| `check_error` | `ops-check` itself | a check could not run (psql or TLS error) on 3 consecutive runs | per run | keeps silent failures visible |

**Also in place, outside `ops-check`:**
- UpCloud's own low-balance email when the prepaid credit has under 7 days
  left. This comes from UpCloud and isn't part of this plan.
- GitHub's failed-workflow email for deploys.
- An optional heartbeat ping (`UPTIMEROBOT_HEARTBEAT_URL`). It catches a
  server that is up enough to answer HTTP but too broken to send alerts.

## Email format

- Subject: `[subscriptionstrack] ALERT <check id>: <one-line detail>`, or
  `RECOVERED`.
- Body: the measured value, the threshold, the time (UTC) and the runbook
  section to follow.
- The email is sent through Resend's HTTP API with the app's existing key and
  sender domain.
- If sending fails, the state is not advanced, so the next run tries again.
  A failure to send never touches the app.

## Tests (`deploy/tests/test_ops_check.py`, offline)

Fakes stand in for `/proc/meminfo`, `statvfs`, `psql`, the TLS probe and
Resend. The tests check that:

- each threshold is exactly at the boundary: 80% does not fire, and anything
  over 80% does;
- firing → still firing sends one email in total;
- firing → recovered sends one RECOVERED email;
- a failed send leaves the state unchanged, so the next run retries;
- `cert:<host>` fires at 13 days 23 h left but not at exactly 14 days. Times
  come from an injected clock, never the wall clock (Principle II).
