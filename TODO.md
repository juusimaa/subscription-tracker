# Backend TODO

Gaps found in a review of the backend on 2026-08-31, in roughly the order they
are worth doing. Two items from that review are already fixed and are recorded
at the bottom for context, since the notes here refer back to them.

## 1. Renewal dates never move

`next_renewal_date` is written when a subscription is created and never again --
nothing in `crud.py` or `main.py` advances it. A month after adding Netflix its
renewal date is in the past, and it stays there forever.

For an app whose whole subject is *recurring* payments this is the missing
mechanic rather than a missing nicety, and it quietly damages something else:
`_last_charged_month` in `main.py` uses `next_renewal_date` to work out how much
of a cancelled yearly plan was already paid for, so a stale date makes that
figure wrong too.

Two ways to fix it, and the choice matters:

- **Roll the date forward** when it falls into the past -- on read, or in a
  scheduled job. Simple, but it mutates rows as a side effect of a GET, and a
  job needs somewhere to run.
- **Store an anchor** (the day of the month or the start date) and *derive* the
  next occurrence on demand. Nothing to keep in step, and history stays intact.
  This is the better shape; `next_renewal_date` becomes a computed field.

Either way, watch the month-end case: a plan anchored on the 31st has to bill on
the 28th/30th in shorter months, and `timedelta` cannot express "one month".

Once dates are live, the feature the app is actually missing becomes possible:
`GET /subscriptions/upcoming?days=30` -- what is about to be charged. That is
the question a subscription tracker exists to answer, and today there is no way
to ask it.

## 2. No tests

There are none, and no test dependency in `requirements.txt`.

The two things most worth pinning down are already written and easy to get
wrong again: the spend arithmetic (`_monthly_cost`, `_is_charged`,
`_last_charged_month` -- cancellations mid-year, yearly plans cancelled after
renewing, rows with no `started_date`) and the per-user isolation that every
`crud.py` function depends on. The invalid-update bug fixed below dies to a
single test; it would never have reached the database with one in place.

`pytest` + `httpx` against a throwaway Postgres (or SQLite, if the `Numeric`
behaviour is not what is being asserted) is enough. Start with:

- one user cannot read, edit, or delete another's subscription id (404, not 403)
- a monthly plan cancelled in June counts for six months of that year, then zero
- a yearly plan cancelled the day after renewing still counts to the end of the
  paid term
- the validation rules fixed below, so they cannot regress

## 3. No migrations

`Base.metadata.create_all()` creates missing *tables* and never alters existing
ones, as the comment in `main.py` says. Adding `user_id`, then `cancelled_date`
and `started_date`, has already meant a `docker compose down -v` or a
hand-written `ALTER TABLE` each time.

That is survivable while the only data is local test rows. It stops being
survivable at milestone 7, where the Azure database holds data worth keeping and
`down -v` is not an option. Alembic now, with two tables and a schema that fits
on a screen, is far cheaper than Alembic later.

## 4. Account management

`/register`, `/token` and `/me` are the entire account surface. Missing:

- **Change password** -- the one users notice immediately.
- **Delete account** -- `crud.delete_all_user_data` already does most of the
  work; it deletes the subscriptions and categories but deliberately leaves the
  user row.
- **Password reset** and **email verification**, both noted as deliberately
  skipped in PLAN.md milestone 6. They need an email path, so they are a bigger
  step than the first two.

## 5. Rate limiting on `/token` and `/register`

Nothing throttles login attempts. bcrypt's cost factor is the only brake on
guessing a password, and registration is a wide-open endpoint. `slowapi` (a
`limiter.limit("5/minute")` decorator) covers both, or the equivalent at
whatever sits in front of the app once it is deployed.

## 6. `/health` does not check the database

It returns `{"status": "ok"}` unconditionally, so Docker's healthcheck reports
the backend healthy while Postgres is unreachable and every real request is
failing. A `SELECT 1` through the session makes the check mean what the
`docker-compose.yml` healthcheck already assumes it means.

## 7. CORS origin is hardcoded

`allow_origins=["http://localhost:5173"]` in `main.py`. Correct for local
Compose, and wrong everywhere the app is actually deployed -- which is
milestone 7, so this blocks that work. Read it from an env var with the current
value as the default, the same way `DATABASE_URL` is handled.

Note it pairs with the known frontend gap in PLAN.md milestone 5: `VITE_API_URL`
is inlined at build time. Both sides of the origin problem want solving together.

## 8. Check-then-insert races return 500

`register` and `create_category` both ask "does this exist?" and then insert. Two
concurrent identical requests both pass the check, and the second one trips the
unique constraint -- surfacing as an unhandled `IntegrityError`, i.e. a 500,
where the sequential path returns a clean 400/409. `ensure_category` has the same
shape.

The check is worth keeping for the good error message; catching `IntegrityError`
around the commit and converting it to the same 400/409 closes the window.

## 9. Imports are validated more loosely than writes

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
