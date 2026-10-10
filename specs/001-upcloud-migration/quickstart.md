# Quickstart: validating the UpCloud move

These are runnable checks that prove the move works. Each one names the spec
item it proves. Step-by-step commands live in `deploy/README.md` (the
runbooks); this file says **what to run and what you should see**.

## Prerequisites

- An UpCloud account, provisioned per `deploy/README.md` § Provision: SDN
  network and router, the database, the server, and the firewall.
- Cloudflare access for DNS and Pages.
- An `age` key pair on your machine, used only for the pause archive.
- An SSH admin key, plus a separately generated deploy key.
- `docker` locally, for the throwaway Postgres 18 used to check archives.

## 1. CI checks, offline (every PR)

```bash
cd deploy && python -m pytest tests -q          # ops-check, deploy guard, edge
docker compose -f deploy/compose.prod.yml --env-file deploy/tests/sample.env config -q
```

Expected: all pass. The edge test shows `429` on the 6th spoofed-XFF request,
`503` on both hosts with the maintenance flag, and `200` on `/health`
(contract: [edge-http.md](contracts/edge-http.md)).

## 2. Staging rehearsal (before cutover)

1. Point `staging.` and `api-staging.subscriptionstrack.com` at the server,
   then deploy the current `main` tag through the deploy key.
   **Expected:** CI's deploy job is green and both hosts serve valid HTTPS.
   **Proves:** FR-007, FR-015.
2. Copy Neon to the database (`deploy/README.md` § Cutover, steps "dump",
   "restore" and "verify") without freezing Neon.
   **Expected:** the verify script prints matching row counts and per-user
   aggregates. **Proves:** FR-003.
3. Run signup → verify → sign in → reset with a fresh address on staging.
   **Expected:** the emails arrive, Turnstile passes, and the 6th rapid
   `/token` attempt gets `429`. **Proves:** FR-008, FR-009.
4. From your laptop, try `psql` against the database hostname.
   **Expected:** the connection is refused or times out.
   From the server, connect with `sslmode=verify-full` (or `require`).
   **Expected:** it connects. **Proves:** FR-010.
5. Run `nmap -Pn -p 1-10000 <server-ip>`.
   **Expected:** only 22, 80 and 443 are open. Then try
   `ssh deploy@<ip> 'id'` with the deploy key. **Expected:** exit 64 and no
   shell. **Proves:** FR-011, FR-016.
6. Reboot the server (`sudo reboot`).
   **Expected:** the site is back without anyone touching it, within
   3 minutes. **Proves:** FR-012.
7. Deploy a deliberately broken tag; a branch build whose `/health` returns
   503 works.
   **Expected:** CI fails with exit 1 and the previous version keeps serving.
   **Proves:** FR-015, US3 scenario 2.
8. Restore drill. Use UpCloud's restore to create a new database service from
   a backup taken within the last 3 days. Point a scratch backend at it and
   compare row counts with production. Then delete the scratch service, which
   is billed hourly and costs a few cents.
   **Expected:** the row counts match, and the drill takes under 1 hour.
   **Proves:** FR-017, FR-018, SC-005.
9. Alert drill:
   - `fallocate` a file that takes the disk past 80%;
   - stop the backend for 6 minutes.

   **Expected:** one ALERT email for each (the disk one from `ops-check`, the
   backend one from UptimeRobot), one RECOVERED email after each is undone,
   and no repeats. **Proves:** FR-019, FR-028.
10. Pause/resume drill, on staging hostnames only. Follow § Pause, then
    § Resume.
    **Expected:** the paused page shows on both staging hosts. The UpCloud
    resource list is empty; billing stopping is checked on the next hourly
    invoice line. After resume, the archive's row counts match.
    **Proves:** FR-024–FR-027, SC-009.

## 3. Cutover (production, within 30 minutes)

Follow `deploy/README.md` § Cutover.

**Expected:**
- The maintenance page is shown throughout (FR-005).
- Writes on Azure are refused after the freeze.
- The verify script matches (SC-001).
- The smoke test passes: a pre-existing test account signs in and sees
  unchanged totals, and a reset link sent before cutover still works
  (US1 scenario 3).
- Total time is 30 minutes or less (SC-003).

## 4. After cutover

| Check | How | Expected | Proves |
|---|---|---|---|
| Cold start | No traffic for at least 2 hours (early morning), then a hard reload of `https://subscriptionstrack.com` and a sign-in, with the DevTools network tab open, from a European connection | page load under 2 s, sign-in under 1 s | SC-002 |
| Deploy speed | merge a trivial PR | live within 15 minutes, no manual step | SC-004 |
| Availability | UptimeRobot 30-day report | at least 99.5%, excluding the cutover window | SC-006 |
| Cost | UpCloud billing after the first full month | €15.40 excl. VAT (€19.33 incl.) or less, under €25 | SC-007 |
| Decommission | after the 7-day soak, follow § Decommission; `git grep -i -E 'azurecontainerapps\|neon'` | Azure and Neon gone within 14 days; matches only in historical notes | SC-008, FR-021, FR-022 |
