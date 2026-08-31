# Backend TODO

Gaps found in a review of the backend on 2026-08-31, in roughly the order they
are worth doing. Four items from that review are already fixed and are
recorded at the bottom for context, since the notes here refer back to them.

## 1. No migrations

`Base.metadata.create_all()` creates missing *tables* and never alters existing
ones, as the comment in `main.py` says. (The test suite added below sidesteps
this rather than solving it: it drops and recreates the schema between tests,
so it never has an existing table to alter.) Adding `user_id`, then `cancelled_date`
and `started_date`, has already meant a `docker compose down -v` or a
hand-written `ALTER TABLE` each time.

That is survivable while the only data is local test rows. It stops being
survivable at milestone 7, where the Azure database holds data worth keeping and
`down -v` is not an option. Alembic now, with two tables and a schema that fits
on a screen, is far cheaper than Alembic later.

## 2. Account management

`/register`, `/token` and `/me` are the entire account surface. Missing:

- **Change password** -- the one users notice immediately.
- **Delete account** -- `crud.delete_all_user_data` already does most of the
  work; it deletes the subscriptions and categories but deliberately leaves the
  user row.
- **Password reset** and **email verification**, both noted as deliberately
  skipped in PLAN.md milestone 6. They need an email path, so they are a bigger
  step than the first two.

## 3. Rate limiting on `/token` and `/register`

Nothing throttles login attempts. bcrypt's cost factor is the only brake on
guessing a password, and registration is a wide-open endpoint. `slowapi` (a
`limiter.limit("5/minute")` decorator) covers both, or the equivalent at
whatever sits in front of the app once it is deployed.

## 4. `/health` does not check the database

It returns `{"status": "ok"}` unconditionally, so Docker's healthcheck reports
the backend healthy while Postgres is unreachable and every real request is
failing. A `SELECT 1` through the session makes the check mean what the
`docker-compose.yml` healthcheck already assumes it means.

## 5. CORS origin is hardcoded

`allow_origins=["http://localhost:5173"]` in `main.py`. Correct for local
Compose, and wrong everywhere the app is actually deployed -- which is
milestone 7, so this blocks that work. Read it from an env var with the current
value as the default, the same way `DATABASE_URL` is handled.

Note it pairs with the known frontend gap in PLAN.md milestone 5: `VITE_API_URL`
is inlined at build time. Both sides of the origin problem want solving together.

## 6. Check-then-insert races return 500

`register` and `create_category` both ask "does this exist?" and then insert. Two
concurrent identical requests both pass the check, and the second one trips the
unique constraint -- surfacing as an unhandled `IntegrityError`, i.e. a 500,
where the sequential path returns a clean 400/409. `ensure_category` has the same
shape.

The check is worth keeping for the good error message; catching `IntegrityError`
around the commit and converting it to the same 400/409 closes the window.

## 7. Imports are validated more loosely than writes

`BackupSubscription` inherits the unconstrained `SubscriptionBase`, so a
hand-edited backup file can still introduce the negative costs and blank names
that `POST` and `PUT` now reject.

This is a deliberate trade rather than an oversight: those rules live on the
request schemas precisely so they cannot break `GET /export` for data that is
already stored (see the fix notes below). A tighter import wants a separate
constrained schema for the import direction only, so export stays permissive and
import does not. Low priority -- the file is the user's own data -- but worth
knowing the asymmetry is there.

## Minor

- **No pagination** on `GET /subscriptions`. Fine at personal scale; the route
  returns everything.
- **No logging.** No request log beyond uvicorn's, and no structured logging, so
  a 500 in production is only visible in container output.
- **`cost` precision is silently truncated.** `10.999999` is accepted and stored
  as `11.00` by `Numeric(10, 2)`. Harmless, arguably surprising --
  `decimal_places=2` on the `Cost` type would turn it into a 422 instead, at the
  cost of rejecting requests that work today.
- **Category matching is unindexed.** Every category filter and the
  `get_categories` join compare `func.lower(...)`, which cannot use a plain
  index. At this size it does not matter; a functional index on
  `lower(category)` is the fix if it ever does.

---

## Fixed on 2026-08-31

**No tests.** There were none, and no test dependency. There are now 81, run
with `pytest` from `backend/`, and the four things TODO.md asked for first are
all pinned down: per-user isolation, a monthly plan cancelled in June, a yearly
plan cancelled the day after renewing, and the validation rules that had
already reached the database once.

Three decisions in there worth keeping:

- **SQLite by default, Postgres on demand.** `pytest` works on a clean
  checkout with nothing running; `TEST_DATABASE_URL=...` runs the identical
  suite against real Postgres, and both are green. That is what makes the
  `Numeric` caveat in the original note safe to live with: the one place the
  difference shows through (Postgres returns `Decimal`, SQLite a float) is
  handled by a `money()` helper in `conftest.py`, so no assertion quietly
  depends on which database it ran against.
- **No test depends on today's date.** The spend tests all use a year that is
  fully in the past, and the one place an exact count would have been
  date-dependent -- how many times a monthly plan renews in a 90-day window,
  which is three or four depending on the months -- asserts the property
  instead: each renewal listed once, a calendar month apart, summing to the
  total. A suite that passes in August and fails in February is worse than no
  suite, and the first draft of that test did exactly that.
- **Tests go through HTTP, not through `crud.py`.** The status codes are part
  of the contract: isolation failing as a 403 instead of a 404 would leak that
  someone else's id exists, and only a test that calls the route can see the
  difference.

Two states the API cannot produce are reached through `/import`, which is the
honest path to them: a row with no `started_date`, and one inactive with no
`cancelled_date`. `POST /subscriptions` defaults the first and stamps the
second, so those rows only exist as restores of old files -- which is exactly
what the spend summary's "assume as little as possible" branches are for.

Not covered, and worth adding next: the backup round trip itself (merge vs
replace, the duplicate-name skip), category rename and delete reassignment, and
anything that runs this suite automatically -- it is a `pytest` a person has to
remember to type until CI runs it.


**Renewal dates never moved.** `next_renewal_date` was written once at creation
and never again, so a month after adding Netflix its renewal date sat in the
past for good -- the missing mechanic in an app whose whole subject is
*recurring* payments. It also quietly broke the spend summary:
`_last_charged_month` reads that date to work out how much of a cancelled
yearly plan was already paid for, and a stale one made a plan cancelled in its
fourth year count three months of that year instead of twelve.

The date is now **derived rather than stored**, which is the part worth
keeping: the column holds an *anchor* (`Subscription.renewal_anchor_date`) and
`next_renewal_date` is a property computing the first renewal on or after
today. There is nothing to keep in step -- no scheduled job needing somewhere
to run, and no GET quietly writing to the database as a side effect of being
read. The anchor also stays intact as history, and a client sending a
years-old date is now saying something true rather than something stale.

The attribute was renamed but the *column* keeps the name
`next_renewal_date`, so this needed no ALTER TABLE -- which is the only reason
it could ship while migrations (item 2) are still outstanding.

- `renewals.py` does the date arithmetic in whole calendar months, because
  `timedelta` cannot express "one month". A plan anchored on the 31st bills on
  the 28th in February and is back on the 31st in March: every step is measured
  from the anchor, so the month-end clamp cannot accumulate and drag the
  schedule permanently backwards.
- A cancelled subscription is measured from its cancellation date, not from
  today, so it reports the renewal that would have come next -- the end of the
  term already paid for -- instead of rolling forward through renewals that
  will never happen. `_last_charged_month` is now reading a real date.
- `GET /subscriptions` sorts in Python: the anchor is not a stand-in for the
  derived date, since a 2019 anchor and a 2026 one can both renew next Tuesday.
  Fine for one account's rows; it wants pagination before it wants an index.

**`GET /subscriptions/upcoming?days=30`**, which live dates made possible: what
is about to be charged, and when. Each renewal in the window is listed with the
full amount due on the day -- so a monthly plan appears three times in
`?days=90`, and a yearly plan brings its whole cost to the one day it lands on,
rather than the per-month share the spend summary works in. Active
subscriptions only, and renewals before a `started_date` are skipped.


**A partial update could make an account permanently unreadable.** `PUT
/subscriptions/{id}` with only `cancelled_date` was validated against nothing --
`SubscriptionUpdate` can only compare fields the request actually carried -- so
a date earlier than the stored `started_date` was committed. The same invariant
also sat on `SubscriptionBase`, which doubles as the *response* model, so the
stored row then failed validation on the way out: `GET /subscriptions` and
`GET /export` returned 500 for that account from then on, with no way back
through the API except deleting the row blind.

Fixed in three places, and the shape of the fix is the point:

- `crud.update_subscription` re-checks the *merged* row and rolls back, so a
  rejected edit changes nothing; `create_subscription` re-checks too, because
  its `started_date` default could produce the same invalid row on its own.
- The route returns 422, matching what the schema returns for the same mistake
  caught one layer earlier.
- The invariant moved **off** the response model. A response model that rejects
  data is a trap: it converts one bad row into a total outage for every route
  that lists it. Requests are where bad data is stopped; what is already stored
  is always serialized as-is.

**Missing validation on `name` and `cost`.** A negative cost was accepted and
subtracted from every total (a real `monthly_total` of `-88.99` during the
review); a cost above `Numeric(10, 2)` was a 500 from Postgres on commit; a
blank or whitespace-only name was accepted. `SubscriptionName` and `Cost` in
`schemas.py` now constrain both, on create and update alike.
