# Backend TODO

Gaps found in a review of the backend on 2026-08-31, in roughly the order they
are worth doing. Six items from that review are already fixed and are
recorded at the bottom for context, since the notes here refer back to them.
Item 3 is the most recent of them, and the numbering of what is left is not
closed up, for the same reason the D-items keep theirs. Items 7 and 8 are
fixed too, as of 2026-09-02, and are written up at the bottom with the rest.

Items D1-D7 came later and from somewhere else -- reading the spending dashboard
design handoff against the API on 2026-09-01 -- so they carry their own
numbering and their own priority order. D1 is done and D4 is closed without a
change; both are written up at the bottom with the rest. The numbering of the
others is left alone, because the notes below refer to each other by it.

Item 1 is partly fixed as of 2026-09-03 -- change password and delete account
are done, written up at the bottom -- and kept at number 1 for what is left of
it, the same reason the D-items keep theirs.

## 1. Account management

`/register`, `/token` and `/me` used to be the entire account surface.
Change password and delete account are done now (see the fix notes at the
bottom). What's left:

- **Password reset** and **email verification**, both noted as deliberately
  skipped in PLAN.md milestone 6. They need an email path, so they are a bigger
  step than the first two were.

## 2. Rate limiting on `/token` and `/register`

Nothing throttles login attempts. bcrypt's cost factor is the only brake on
guessing a password, and registration is a wide-open endpoint. `slowapi` (a
`limiter.limit("5/minute")` decorator) covers both, or the equivalent at
whatever sits in front of the app once it is deployed.

## 4. CORS origin is hardcoded

`allow_origins=["http://localhost:5173"]` in `main.py`. Correct for local
Compose, and wrong everywhere the app is actually deployed -- which is
milestone 7, so this blocks that work. Read it from an env var with the current
value as the default, the same way `DATABASE_URL` is handled.

Note it pairs with the known frontend gap in PLAN.md milestone 5: `VITE_API_URL`
is inlined at build time. Both sides of the origin problem want solving together.

## 5. Check-then-insert races return 500

`register` and `create_category` both ask "does this exist?" and then insert. Two
concurrent identical requests both pass the check, and the second one trips the
unique constraint -- surfacing as an unhandled `IntegrityError`, i.e. a 500,
where the sequential path returns a clean 400/409. `ensure_category` has the same
shape.

The check is worth keeping for the good error message; catching `IntegrityError`
around the commit and converting it to the same 400/409 closes the window.

## 6. Imports are validated more loosely than writes

`BackupSubscription` inherits the unconstrained `SubscriptionBase`, so a
hand-edited backup file can still introduce the negative costs and blank names
that `POST` and `PUT` now reject.

This is a deliberate trade rather than an oversight: those rules live on the
request schemas precisely so they cannot break `GET /export` for data that is
already stored (see the fix notes below). A tighter import wants a separate
constrained schema for the import direction only, so export stays permissive and
import does not. Low priority -- the file is the user's own data -- but worth
knowing the asymmetry is there.

Since the import UI landed (see the fix notes below) the *browser* does enforce
those rules before sending, so the loose path is now only reachable by calling
`POST /import` directly. That narrows the exposure and does not close it, and it
introduces a second asymmetry worth naming: the design's copy for a bad file
prints a status code ("422 -- nothing was imported"), and a file the browser
rejected never reached the server, so there is no code to print. The UI says
"Nothing was imported." without one. Tightening the import schema is what would
let that message be literally true, and is the reason to do this item.

Note the one field where import *is* now stricter than the schema:
`crud.import_backup` trims `name`, because `_match_key` already trims to find
the row and storing the untrimmed spelling would leave the account holding a
name no sort or search agrees with.

## Supporting the spending dashboard design

A second set of gaps, from reading the frontend handoff in
`../design_handoff_spending_dashboard` (README.md, STATES.md, seed-data.json)
against the current API on 2026-09-01. These are feature work rather than
defects: the API is self-consistent, it just cannot answer some of what the
design asks. Numbered separately because they do not slot into the priority
order above -- D2 and D3 are the ones the dashboard cannot be built without,
and D7 may never be worth doing at all.

Worth recording first, so nobody re-investigates it: **sorting is already
covered.** The design specifies all six columns sorted client-side with ties
broken on name (README §7, *Interactions*), `GET /subscriptions` returns the
whole unpaginated list, and `crud.get_subscriptions` already sorts by next
renewal, then lowercased name, then id -- which is exactly the design's default
sort and tie-break. No query parameters needed.

### D2. `upcoming` cannot be asked about an arbitrary period

`GET /subscriptions/upcoming` is anchored to today: `days` is 1-365 forward, and
the window always starts now. The design's "Coming up" panel lists the charges in
the *selected* period, and the period picker spans 2025-01 to 2027-12 -- so past
months, and months further out than 365 days.

The arithmetic already exists and is general: `renewals.occurrences_between`
takes an arbitrary start and end. Only the route signature is today-shaped. A
`from`/`to` pair (or `year`/`month`) alongside the existing `days` would do it,
keeping `days` working for callers that want the "next 30 days" question.

Note `days_until` stops making sense for a window in the past. It is there so the
client does not have to redo date arithmetic or disagree with the server about
what today is, which still holds -- it just goes negative, and the design does
not display it for past periods anyway.

### D3. No per-category breakdown for a period

The "By category" section needs, per category and for the selected period: an
amount, a share of the period total, and the names of the subscriptions in it.
`/subscriptions/summary/spend` takes a `category` filter but returns no grouping,
so producing that section today is one request per category.

Computing it client-side from `GET /subscriptions` only works for the current
month. It cannot reproduce the started/cancelled-aware arithmetic
`_is_charged` and `_last_charged_month` do for past periods -- which is the whole
reason that logic lives on the server. A grouped response on the existing route
is the smaller change; a separate route is the cleaner one, since the current
response shape (`year`, `total`, `months`) has no room for a second axis.

### D5. Validation answers 422 where the design expects 400, with no field map

The design renders validation errors at the field that caused them, and prints
the status code in the user-visible copy ("400 -- the change wasn't saved").
The API returns **422** for a non-positive cost, a blank name and the date
ordering rule -- deliberately, and consistently between schema-level and
crud-level rejection (see the fix notes below). Either the copy changes or the
route maps to 400; the status is part of the contract now, so this is a decision
rather than a bug.

Separately, FastAPI's 422 body is `detail: [{loc, msg}, ...]`, and the frontend
has to turn that into per-field messages like "Required -- pick a service or type
a name." Nothing in the API names the field in a form a client can key on
without parsing `loc`.

There is also a genuine conflict of models hiding in here. The design validates
**"Renewal date must be in the future."** This API does the opposite on purpose:
`next_renewal_date` is an *anchor*, a date years in the past is valid and often
correct, and the response rolls it forward to the renewal that is actually next.
Adopting the design's rule would break that. Someone has to pick, and the anchor
model is the one the rest of the system is built on.

### D6. Category deletion counts cancelled plans; the design does not

The design blocks deleting a category only while a **live** subscription uses it,
and says so in the dialog: "Cancelled plans keep their category on record but
don't block deletion." `crud.count_subscriptions_in_category` counts every row
regardless of `active`, so a category used only by cancelled plans returns 409
where the design shows Delete enabled.

The dialog also wants two things `schemas.Category` cannot supply: a monthly
total per category ("EUR 41.97/mo"), and a usage string that distinguishes "Only
cancelled plans" from "Unused". `subscription_count` is a single all-inclusive
number and cannot tell those apart. Note that "live" now needs defining against
four statuses rather than a boolean (see the D1 write-up): a trial occupies a
category without paying for it, and a paused plan is coming back.

### D7. Presentation fields with no home, probably by design

Recorded so the question is not reopened, not because they need doing:

- **Brand tiles.** The design's record shape carries `mono`, `brandBg`,
  `brandFg` and `monoSize`. Nothing stores them. A client-side lookup keyed on
  name is the right call unless they should be per-subscription and editable, in
  which case they are four nullable columns.
- **Currency.** Everything in the design is in euros; `cost` is a bare
  `Numeric(10, 2)` with no currency anywhere in the schema. Hardcoding EUR in the
  frontend is fine and is what the design assumes, but it is an unstated
  assumption rather than a decision anyone has made.
- **Quick-add catalogue.** The empty state offers eight one-tap services, and
  STATES.md notes the list "should come from a small curated catalogue, ranked by
  popularity in the user's region". That is an endpoint if it is ever real; a
  static frontend list is the honest v1.

(The `POST /:id/archive` and `/:id/restore` bullet that used to live here is
gone rather than struck: item 7's 2026-09-02 refresh reopened the question --
archiving turned out to carry a real invariant a generic `PUT` couldn't
enforce in one place -- and both now exist as dedicated routes. See the fix
notes at the bottom.)

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

## Fixed on 2026-09-03

**1 (part). Change password and delete account.** `PUT /me/password` and
`DELETE /me` are the two new routes; `/register`, `/token` and `/me` were the
whole account surface before this.

- **Both require the caller's current password again**, even though the
  request already carries a valid Bearer token. A token proves there is a
  session, not that whoever is holding it right now is the account owner --
  the same reason a browser re-asks for a password before changing one. This
  goes beyond what the item asked for (it only named the two features, not
  how to authorize them), and is the more defensible default for an
  irreversible action.
- **A password change now actually signs out every other device**, which
  needed a mechanism that did not exist: `users.token_version` (new column,
  migration 0004), bumped by `crud.update_password` and embedded in every
  JWT's `tv` claim. `auth.get_current_user` rejects a token whose `tv` no
  longer matches the row. A stateless JWT cannot be revoked individually, but
  invalidating all of them at once by moving one counter costs nothing extra
  per request, since the row is already loaded.
- **The device making the change stays logged in.** Bumping `token_version`
  also invalidates the token the change-password request itself was
  authenticated with, so `PUT /me/password` mints and returns a fresh one
  (`response_model=schemas.Token`, not `schemas.User` as first drafted) and
  the frontend stores it the same way login does.
- **`crud.delete_user` does what `delete_all_user_data` (the item's
  suggestion) does not finish.** That function only ever deleted
  subscriptions and categories, deliberately leaving the user row -- it was
  built for `replace`-mode import, which needs the first two gone but the
  account to still exist. Account deletion needed a second step:
  `subscription_groups` has its own FK into `users` that
  `delete_all_user_data` never touches, so it is cleared before the user row,
  since nothing here cascades at the database level.
- **New tests:** `test_account.py` -- wrong-current-password on both routes,
  the short-password 422, cross-account isolation, and the token_version
  behaviour specifically: the changing device's *old* token goes stale, its
  *new* one keeps working, and a second logged-in session goes stale too.

Frontend: `AccountDialog.jsx` (new) is the "Account" dialog behind the
signed-in email in the header -- change password, delete account with a
typed-DELETE confirmation. It asks for the password on delete too, matching
the backend decision above rather than the design handoff's own mock, which
only showed the typed confirmation.

Verified against the actual local Compose Postgres volume: `alembic upgrade
head` ran 0003 -> 0004 against it, then the full flow was driven through a
real browser -- wrong password rejected, mismatch rejected inline, a
successful change confirmed live (old token 401s, new one and a reload both
keep working, a second concurrent session goes stale), then account deletion
confirmed for real (login after returns 401, both prompts guarded correctly)
-- with no console errors at any step.

Still open: password reset and email verification, both needing an email path
this build does not have. See item 1 above.

---

## Fixed on 2026-09-02

**7. Archive old subscriptions, and 8. One subscription, several runs.** Built
together in one pass, since 8 was gated on decisions 7's refresh settled and
the two turned out to share one migration -- one nullable column
(`archived_date`) plus one new table (`subscription_groups`) and one nullable
FK (`group_id`), no row migration for either.

Archiving:

- `archived_date` (models.py) is only ever set on a cancelled row, enforced by
  `schemas.check_archived` -- called from `SubscriptionCreate._validate`
  (sees the whole row) and re-checked on the *merged* row in
  `crud.update_subscription`, the same shape as `check_dates`, because a
  partial `PUT` can't be checked until it's merged with what's stored.
- `POST /subscriptions/{id}/archive`, `/unarchive` and `/restore`
  (main.py) resolve the two questions the refreshed item 7 flagged as
  "backend's to make": dedicated routes over the generic `PUT`, decided this
  build, because archiving's invariant (must already be cancelled) needs
  enforcing in one place rather than re-derived from whatever a `PUT` happens
  to send; `PATCH` vs `PUT` was the lower-stakes of the two and stayed `PUT`,
  untouched.
- **409, not 422**, for "can't do this from here" -- already cancelled to
  archive, already archived to unarchive, already cancelled to restore.
  Matches the existing precedent (`create_category`'s duplicate,
  `update_category`'s name clash) for a well-formed request blocked by
  current state, keeping 422 for malformed request data only.
- **Reactivate un-archives as a side effect, but only when the request itself
  didn't ask to archive.** `PUT {status: "active"}` on an archived row clears
  `archived_date` along with it -- no separate unarchive call needed. The one
  subtlety, in `crud.update_subscription`: this auto-clear is skipped when
  `archived_date` is itself a field the request sent, so an explicit
  `archived_date` that turns out to disagree with the row's resulting status
  still hits `check_archived` as a 422, instead of being silently laundered
  into a no-op by the same code that makes Reactivate convenient.
- Backup version bumped to 3; `archived_date` appended to JSON and to the CSV
  columns (after `paused_date`) -- round-trips exactly like `cancelled_date`
  and `paused_date` already did.

One subscription, several runs:

- `subscription_groups` (id, user_id) -- the item's own recommendation over a
  self-referencing FK, so deleting any one run never scatters the rest.
- `POST /subscriptions/{id}/restore` (the route was "leaning towards" in the
  item's open decisions; decided) copies name/category/cost/cycle onto a new
  row, defaults `started_date` and the renewal anchor to today -- both
  overridable in the request body, per "editable" in the original ask --
  and links `group_id`: creating the group on the row's first restore if it
  didn't have one yet, reusing it on every restore after. The row being
  restored is left exactly as it was.
- **The backup's "cannot carry the id" question was resolved by not solving
  it.** `group_id` lives only on the response `Subscription` schema, never on
  `SubscriptionBase`, so it is absent from both JSON and CSV. A restored file
  always comes back as groups of one; nothing detects or reports the
  difference, it is simply the file format's limit, unchanged from what the
  item's own open-decisions list already said. The file-local ordinal/label
  scheme it also raised was not built -- there was nothing to remap, since no
  id ever leaves in the first place.
- The item's sequencing note -- do D2 and D3 first so `frontend/src/renewals.js`
  is not rewritten twice -- turned out not to bind here: nothing about how a
  run is stored changed the renewal walk, only which rows exist, so this
  shipped without waiting on either.
- Whether the group has a name of its own: still no, as the item recorded --
  the newest run's name is the current name.

Frontend:

- `SubscriptionTable.jsx`: a cancelled row now shows Reactivate / Restore, plus
  either Archive or (once archived) Restore to list + Delete. Reactivate is
  the old "Restore" button relabelled -- the design's naming resolution
  (Reactivate vs Restore to list vs Restore) carried over word for word.
- Archived rows stay hidden even with "Show cancelled" on. A second toggle,
  "Show archived -- N", appears only once cancelled rows are shown, mirroring
  the existing `showCancelled` pattern.
- `RestoreDialog.jsx` (new): the two editable dates the item asked for
  (start, renewal), both defaulting to today.

Tests: `test_archive.py` and `test_restore.py` (new), plus the hardcoded
backup-version assertions in `test_backup.py` and `test_status.py` updated for
the bump to 3.

Verified against the actual local Compose Postgres volume, not just the
suite: `alembic upgrade head` ran 0002 -> 0003 against it, then the full
flow was driven through a real browser against the running stack --
cancel, archive (row disappears, "Show archived" reveals it), unarchive,
restore (new linked row, old one untouched, totals recompute) -- with no
console errors at any step.

## Fixed on 2026-09-01

**3. `/health` did not check the database.** It returned `{"status": "ok"}`
unconditionally, which made it a check on nothing: the route never touched the
database, so it answered 200 with Postgres stopped and every real request
failing. It now runs a `SELECT 1` through the request's session and answers
**503** when that raises.

- **503, not 500.** The app is fine; its dependency is not. Docker's
  healthcheck cannot tell the difference -- `urllib.request.urlopen` raises on
  any non-2xx -- but anything else in front of the app can, and 503 is the code
  that means "try again later" rather than "this request was broken".
- **The success body is unchanged.** Still exactly `{"status": "ok"}`, so
  nothing that already reads this route has to learn a new shape; what changed
  is which requests get it. `schemas.Health` keeps its `Literal["ok"]` for the
  same reason -- there is no second healthy answer, and an unhealthy one is not
  a 200 with a different string in it.
- **The exception text never reaches the body.** SQLAlchemy quotes the
  connection string it tried, credentials included, and this route is
  unauthenticated. The response says "Database unavailable" and nothing else;
  `raise ... from exc` keeps the original in the traceback uvicorn prints,
  which is the only place it belongs until there is real logging (see "Minor").
- **The failure is tested, which is the part that was missing.** A healthcheck
  that cannot go red is decoration. `test_health.py` overrides the `get_db`
  dependency with a session that raises from `execute()` -- not from the
  constructor, because that is where a real outage surfaces: SQLAlchemy
  connects lazily, so `SessionLocal()` succeeds with Postgres stopped, and that
  is precisely why the old route could not fail.

This is what `docker-compose.yml` always assumed the route meant: the frontend
waits on `condition: service_healthy` for the backend, and until now that
gate would open on a backend that could not serve a single page.

**D4. Duplicate subscription names -- closed, no change.** STATES.md specifies a
`Duplicate (409)` state ("You already track Netflix. Edit that subscription
instead.") with nothing behind it, and the item asked whether to put uniqueness
on the write path.

The answer is no: **two subscriptions can legitimately have the same name.** Two
Netflix accounts -- one per household member, one personal and one shared -- are
an ordinary thing to track, and so are two phone plans on the same carrier. A
409 there would refuse to record something true about the user's money, and the
only workaround it leaves is a fake name, which corrupts the data to satisfy a
rule that was never real.

That also settles the tension the item recorded: `crud.import_backup` already
allows two rows called "Netflix" *within* one file, on exactly this reasoning.
The rule now matches in both directions instead of contradicting itself
depending on how the row arrived.

`import_backup`'s merge skip stays as it is, and is not the same rule. It
compares against names *already in the account* so that re-importing a file
twice does not leave two of everything -- de-duplicating one operation, not
policing what the account may contain. A user who wants a second Netflix still
adds one; nothing about the write path stops them.

The design's Duplicate state has no server behind it and will not get one. Its
copy is worth keeping as a **warning** rather than an error if anyone wants it
-- "you already track Netflix" is useful information right up until it becomes
a refusal -- but that is a frontend decision, and this API has nothing to say
about it.

**D1. Status was a boolean; the design has four states.** `active: bool` could
only say "running" or "not running", which collapsed three genuinely different
situations into one. `models.SubscriptionStatus` replaces it with **active /
trial / paused / cancelled**, and `paused_date` joins `cancelled_date` so a
pause has a date of its own.

The decisions worth keeping:

- **`active` did not go away; it became a derived alias.** It is still
  accepted on every write and still returned on every read, mapping to
  active-or-cancelled exactly as it always did. That is what let 21 existing
  test assertions and every backup file taken so far keep working untouched.
  The mapping preserves the *meaning* the flag always had -- "counts toward
  the totals and will be billed again" -- so trial and paused both report
  false, which is the reading every existing consumer of the flag already
  assumed.
- **Sending `status` and `active` together is a 422 when they disagree.**
  Resolving a contradiction by picking a winner would silently cancel a
  subscription or silently revive one, depending on which half was guessed.
  They are accepted when they agree, so a client can migrate one call at a
  time.
- **A pause needs a date for the same reason a cancellation does.** Without
  one, a subscription paused today reports having never cost anything, and a
  year of real spend disappears from the trend the moment someone hits pause
  -- the exact bug `_last_charged_month` was written to prevent for
  cancellations. `stopped_date` names the idea once, and `_is_charged` and
  `_last_charged_month` now work in terms of it, so the two states share
  arithmetic instead of duplicating it.
- **Pausing and then cancelling keeps the pause date.** It stopped costing
  money the day it was paused, not the day someone got around to making that
  permanent; stamping today's date would count the months in between as spend
  that never happened. An explicit `cancelled_date` still wins, which is what
  makes it correctable when the intent really was today.
- **A trial's renewal date is never rolled forward.** A trial converts once,
  on one date, and the anchor *is* that date -- so rolling a conversion that
  has come and gone into next month would report a second one that is never
  going to happen. It stays put until something moves the row off `trial`,
  which is the event the date was always describing.
- **Trials appear in `/upcoming` once, at a cost of 0.** Nothing leaves the
  account on a conversion day -- the trial is free until it ends -- and this
  route's `total` is real money due, which a trial's eventual price is not
  yet. The full price still travels in the nested `subscription`, so a client
  can render "then EUR 9.99/mo" without a second request.
- **`active=false` as a *filter* now means every status that does not bill**,
  not only cancelled. That is the honest reading of "not active" and the only
  one that stays true as statuses are added; `?status=cancelled` is how to ask
  for cancelled rows specifically. This is the one place the alias is not a
  perfect stand-in for the old behaviour, and it is documented on the route.
- **The backup version went to 2, and version 1 files are still read.** A
  version 1 file says `active` and has never heard of `status`, which the
  import schema resolves the same way it resolves a legacy request -- so
  reading one needs no separate code path, only the permission to try. This
  is the migration the `version` field was put there to make possible;
  refusing a file this build genuinely cannot read is still the behaviour for
  anything outside the supported set.

**Revision 0002 is the first migration that moves rows**, and the first one
tested that way (see the amended note above). Going up is lossless: every
existing row is active or cancelled, two of the four new values. Going down
cannot be -- three statuses have to land on `active = false` -- but what it
leaves behind is a shape the old code already understands rather than a broken
one: a trial or paused row becomes inactive with a NULL `cancelled_date`,
which is exactly the "stopped, date unknown" case `_is_charged` has always had
a branch for, and which counts toward no month rather than inventing spend.

Verified on both databases, since the enum handling is where they differ most:
119 tests green on SQLite and on Postgres 16.

Not covered: the frontend still speaks the old vocabulary. It never read
`active` at all, so nothing is broken, but nothing surfaces trial or paused
either until the dashboard is built.

---

## Fixed on 2026-08-31

**No migrations.** Alembic now owns the schema, and
`Base.metadata.create_all()` is gone from `main.py` -- importing the app no
longer touches the database at all. The backend container runs
`alembic upgrade head` from `entrypoint.sh` before uvicorn starts.

Four decisions worth keeping:

- **The first revision adopts a database it did not create.** It creates each
  table only if it is absent, so `upgrade head` against the existing Compose
  volume -- or anything already deployed -- records the revision instead of
  failing on "table users already exists". Verified against the local volume:
  stamped `0001`, all rows intact. The alternative was telling every existing
  database to run `alembic stamp head` by hand, or to start again empty.
- **Migrations run in the `ENTRYPOINT`, not the `CMD`.** A `command:` in
  docker-compose.yml replaces `CMD` and leaves `ENTRYPOINT` alone, so the
  `--reload` override local dev uses cannot skip them. A failed migration stops
  the container rather than starting an app against a schema its code does not
  match.
- **`test_migrations.py` pins the migrations to models.py.** Nothing else
  would: the fixtures build the schema with `create_all()`, so a column added
  to a model without a revision passes every other test and only fails on a
  database that has seen migrations -- exactly what this was meant to prevent.
  The test upgrades an empty database and asserts `compare_metadata` finds no
  difference from the models. Types are not compared: the same declaration
  renders differently on SQLite and Postgres (`billing_cycle` is a native enum
  on one, a VARCHAR with a check constraint on the other), so comparing them
  would report which database ran the test rather than any real drift.
- **The enum type is dropped explicitly on downgrade.** `create_table` emits
  `CREATE TYPE` on Postgres as a side effect and `drop_table` never emits the
  matching `DROP TYPE`, so a downgrade would leave the type behind and the next
  upgrade would fail on "type billingcycle already exists". The second test
  upgrades, downgrades and upgrades *again*, because a single upgrade cannot
  see that.

Covered as of revision 0002, which was the first data migration and brought
the two tests that caveat asked for: `test_migrations.py` now inserts rows
under the old schema, upgrades, and checks what the backfill made of them --
in both directions. Before that, a migration was tested only by the schema it
left behind, never by what it did to the rows.


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
it could ship before migrations existed. The column name is what the initial
Alembic revision records.

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

**Import and export, section 12.** The handoff's maintenance panel had nothing
behind it on the frontend and two gaps on the backend. Both halves now exist:
`GET /export?format=csv`, `POST /import?mode=merge|replace`, and the page-foot
panel with its drop zone, paste box and summary dialog.

The decisions worth keeping:

- **Merge updates a matching name; it used to skip it.** Skipping made
  re-importing an *edited* file do nothing at all -- which is the case this
  whole surface exists for -- and it did so silently. Updating still leaves
  re-importing an unchanged file a no-op, which is the property the skip was
  really protecting; it just reports it as `unchanged` instead of pretending
  there was a conflict. `subscriptions_skipped` is gone from `ImportResult` and
  `subscriptions_updated`, `subscriptions_unchanged` and `subscriptions_removed`
  replace it.
- **Duplicates are paired off in order, not collapsed.** Two rows called
  "Netflix" in one file are still both imported (D4), so the file's first one
  updates the account's first one and a third with nothing left to match is
  added. That is what keeps a file containing duplicates idempotent: it neither
  multiplies the rows nor merges them into one.
- **CSV goes out but does not come in.** The design requires the summary
  dialog's diff to be computed before anything is written, so the browser has to
  parse the file regardless; a second parser on the server would be a second
  place for the two to disagree about what a row means. The cost is that a CSV
  cannot be `curl`-ed into `POST /import` -- convert it or use the JSON.
- **The CSV carries three columns the handoff does not list.**
  `started_date`, `cancelled_date` and `paused_date` are appended after the six
  pinned ones. Without them a CSV round trip rewrites when each subscription
  started and stopped, and every past month in the spend summary with it. The
  two things a CSV still cannot carry -- a category nothing is using, and the
  `version` stamp -- are why JSON is the backup.
- **`mode` and `replace` are reconciled the way `status` and `active` are.**
  Both are accepted, agreeing is fine, disagreeing is a 422. Guessing which half
  of that contradiction the caller meant empties an account on a coin flip.
- **The import is diffed against the page, then confirmed, then written once.**
  Nothing is optimistic and nothing is estimated: the Add / Update / Unchanged
  counts in the dialog are the counts the server reports back, which is checked
  end to end rather than assumed.

One rough edge found while building and left alone, because it is the D1
decision working as designed: hand-editing `status` in an exported *JSON* file
is a 422 unless `active` is edited or deleted too, since export writes both and
`resolve_status` refuses a contradiction. The CSV has no `active` column and the
browser's parser drops it, so both of the paths a person actually uses are
clear; only `curl` with a hand-edited JSON hits it.
