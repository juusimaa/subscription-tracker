# CRUD = Create, Read, Update, Delete: the actual database operations,
# kept separate from main.py so the route handlers stay focused on HTTP
# concerns (status codes, request/response shapes) rather than SQL logic.
#
# Every subscription function takes a user_id and filters on it. That filter
# is the entire multi-user security boundary: the route handlers pass the id
# from the verified token, never one supplied by the client.

from datetime import date

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import hash_password

# --- Users ---


def get_user_by_email(db: Session, email: str) -> models.User | None:
    return db.query(models.User).filter(models.User.email == email).first()


def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    # The plaintext password stops here: only its bcrypt hash is handed to the
    # model, so it is never written to Postgres.
    db_user = models.User(email=user.email, hashed_password=hash_password(user.password))
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


# --- Categories ---
#
# Subscriptions store a category *name*, not a foreign key (see the comment on
# models.Category), so these functions are responsible for keeping the two in
# step: a rename rewrites the name on every subscription using it, and a
# delete decides what happens to those subscriptions rather than leaving them
# pointing at something that no longer exists.


def get_categories(db: Session, user_id: int) -> list[tuple[models.Category, int]]:
    """This user's categories, each with the number of subscriptions using it.

    The count comes from one grouped query with an outer join rather than a
    follow-up count per category, so listing N categories stays a single
    round trip. The join matches on lowercased names because a subscription
    may have been saved with different capitalisation.
    """
    return (
        db.query(models.Category, func.count(models.Subscription.id))
        .outerjoin(
            models.Subscription,
            and_(
                models.Subscription.user_id == user_id,
                func.lower(models.Subscription.category) == func.lower(models.Category.name),
            ),
        )
        .filter(models.Category.user_id == user_id)
        .group_by(models.Category.id)
        # Sorted case-insensitively so "music" lands next to "Movies" rather
        # than after every capitalised name, as a plain sort would put it.
        .order_by(func.lower(models.Category.name))
        .all()
    )


def get_category(db: Session, category_id: int, user_id: int) -> models.Category | None:
    # Scoped by user_id for the same reason get_subscription is: an id alone
    # must never be enough to reach someone else's row.
    return (
        db.query(models.Category)
        .filter(models.Category.id == category_id, models.Category.user_id == user_id)
        .first()
    )


def get_category_by_name(db: Session, name: str, user_id: int) -> models.Category | None:
    return (
        db.query(models.Category)
        .filter(
            models.Category.user_id == user_id,
            func.lower(models.Category.name) == name.strip().lower(),
        )
        .first()
    )


def count_subscriptions_in_category(db: Session, name: str, user_id: int) -> int:
    return (
        db.query(models.Subscription)
        .filter(
            models.Subscription.user_id == user_id,
            func.lower(models.Subscription.category) == name.lower(),
        )
        .count()
    )


def create_category(db: Session, name: str, user_id: int) -> models.Category:
    db_category = models.Category(name=name.strip(), user_id=user_id)
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


def rename_category(db: Session, category: models.Category, new_name: str) -> models.Category:
    """Renames the category and carries every subscription using it across.

    Both halves happen in one transaction: a rename that updated the category
    list but left subscriptions labelled with the old name would quietly split
    one category into two.
    """
    old_name = category.name
    category.name = new_name.strip()
    _relabel_subscriptions(db, old_name, category.user_id, category.name)
    db.commit()
    db.refresh(category)
    return category


def delete_category(
    db: Session, category: models.Category, reassign_to: models.Category | None = None
) -> None:
    """Deletes the category, moving any subscriptions using it to
    `reassign_to`, or clearing their category when that is None.

    The caller decides which of those it wants; refusing to delete a category
    that is still in use is handled in the route, so this function is only
    ever asked to carry out a decision that has already been made.
    """
    _relabel_subscriptions(
        db,
        category.name,
        category.user_id,
        reassign_to.name if reassign_to is not None else None,
    )
    db.delete(category)
    db.commit()


def _relabel_subscriptions(db: Session, old_name: str, user_id: int, new_name: str | None) -> None:
    """Points every subscription labelled `old_name` at `new_name` (or at no
    category at all). A bulk UPDATE rather than a loop: this is one statement
    the database can do by itself, however many rows it touches."""
    (
        db.query(models.Subscription)
        .filter(
            models.Subscription.user_id == user_id,
            func.lower(models.Subscription.category) == old_name.lower(),
        )
        .update({models.Subscription.category: new_name}, synchronize_session=False)
    )


def ensure_category(db: Session, name: str | None, user_id: int) -> str | None:
    """Registers a category name a subscription is about to use, and returns
    the spelling to store.

    This is what keeps the managed list complete without forcing clients to
    create a category before they can use it: typing a brand new name into a
    subscription adds it to the list. If the name already exists in any
    capitalisation, the stored spelling wins, so "netflix" typed into one
    subscription does not sit alongside an existing "Netflix" as a second
    category that filtering would treat as the same thing anyway.
    """
    if name is None:
        return None
    name = name.strip()
    if not name:
        # An empty string is not a category; store it as "no category" so it
        # cannot show up as a nameless entry in the list.
        return None
    existing = get_category_by_name(db, name, user_id)
    if existing is not None:
        return existing.name
    # No commit here: this runs inside the caller's create/update transaction,
    # so the category and the subscription are saved together or not at all.
    db.add(models.Category(name=name, user_id=user_id))
    return name


# --- Subscriptions ---


def _columns(fields: dict) -> dict:
    """Translates a schema's field names into model attribute names.

    Two differ, and for the same underlying reason -- the API's name for
    something is not always the column that stores it, and a write has to land
    on the column:

    - `next_renewal_date` is derived from the anchor the table actually holds
      (see models.Subscription).
    - `active` stopped being a column in revision 0002 and is now a read-only
      property over `status`. Setting either of these properties would raise,
      since a computed attribute has nothing to write to.

    A lone `active` is translated into the status it stands for; when `status`
    came too, it wins and `active` is dropped, because schemas.resolve_status
    has already rejected the case where the two disagree. Dropping it is not
    optional either way: leaving it in the dict is the setattr that raises.
    """
    fields = dict(fields)
    if "next_renewal_date" in fields:
        fields["renewal_anchor_date"] = fields.pop("next_renewal_date")
    legacy_active = fields.pop("active", None)
    if legacy_active is not None and fields.get("status") is None:
        fields["status"] = (
            models.SubscriptionStatus.active
            if legacy_active
            else models.SubscriptionStatus.cancelled
        )
    # A partial update that mentioned neither must not write status=None over
    # a real one; SubscriptionUpdate uses None to mean "not sent".
    if "status" in fields and fields["status"] is None:
        del fields["status"]
    return fields


def get_subscriptions(
    db: Session,
    user_id: int,
    category: str | None = None,
    billing_cycle: models.BillingCycle | None = None,
    active: bool | None = None,
    status: models.SubscriptionStatus | None = None,
) -> list[models.Subscription]:
    """All of one user's subscriptions, optionally narrowed down.

    The filters are additive: passing None for one leaves that dimension
    unfiltered, so the same function serves both the plain list and the
    filtered views without a second query builder.

    `status` and `active` are the precise and the coarse version of the same
    filter. `active=True` still means exactly what it used to -- the status
    that bills -- so every existing caller is unaffected. `active=False` now
    means every status that does not bill rather than only `cancelled`, which
    is the honest reading of "not active" and the only one that stays true as
    statuses are added; a caller that specifically wants cancelled rows should
    say `status=cancelled`.
    """
    query = db.query(models.Subscription).filter(models.Subscription.user_id == user_id)
    if category is not None:
        # Categories are free text typed by the user, so "Music" and "music"
        # are the same category as far as filtering is concerned.
        query = query.filter(func.lower(models.Subscription.category) == category.lower())
    if billing_cycle is not None:
        query = query.filter(models.Subscription.billing_cycle == billing_cycle)
    if status is not None:
        query = query.filter(models.Subscription.status == status)
    if active is not None:
        # Not `Subscription.active`, which is a Python property now and has no
        # SQL to compile to.
        running = models.Subscription.status == models.SubscriptionStatus.active
        query = query.filter(running if active else ~running)
    # Soonest renewal first, as before -- but sorted in Python rather than by
    # the database, because the date being sorted on is now computed and the
    # stored anchor is not a stand-in for it: a 2019 anchor and a 2026 one can
    # both renew next Tuesday. The list is one user's subscriptions, so this
    # is a handful of rows; the day it is not, it wants pagination first (see
    # TODO.md) and an expression index or a stored column after that.
    subscriptions = query.all()
    subscriptions.sort(key=lambda sub: (sub.next_renewal_date, sub.name.lower(), sub.id))
    return subscriptions




def get_subscription(db: Session, subscription_id: int, user_id: int) -> models.Subscription | None:
    # Filtering on user_id as well as id matters more than it looks: without
    # it, any logged-in user could read, edit or delete anyone else's rows just
    # by guessing an integer. Returning None here makes those attempts 404,
    # which also avoids confirming that someone else's id exists.
    return (
        db.query(models.Subscription)
        .filter(
            models.Subscription.id == subscription_id,
            models.Subscription.user_id == user_id,
        )
        .first()
    )


def _sync_status_dates(db_subscription: models.Subscription) -> None:
    """Keeps `status`, `cancelled_date` and `paused_date` telling one story.

    A client that stops a subscription normally just sends the new status, so
    the date it stopped costing money is filled in here -- without it the
    spend summary has no way to know which months it should still count. An
    explicit date in the request is left alone, so a stop can be backdated.
    Moving back to a running status clears both dates: the subscription is
    billing again, and a stale date would zero out its future months.

    Only the date belonging to the current status is kept. A subscription is
    in one state at a time, and a leftover paused_date on a cancelled row
    would be read by stopped_date as a pause that is no longer happening.

    The one case worth spelling out is pausing and *then* cancelling. It
    stopped costing money on the day it was paused, not on the day someone got
    around to making that permanent, so the pause date carries over rather
    than today's being stamped -- otherwise the months in between are counted
    as spend that never happened. An explicit cancelled_date still wins, which
    is what makes the fix correctable when the intent really was today.
    """
    status = db_subscription.status
    if status == models.SubscriptionStatus.cancelled:
        if db_subscription.cancelled_date is None:
            db_subscription.cancelled_date = db_subscription.paused_date or date.today()
        db_subscription.paused_date = None
    elif status == models.SubscriptionStatus.paused:
        if db_subscription.paused_date is None:
            db_subscription.paused_date = date.today()
        db_subscription.cancelled_date = None
    else:
        db_subscription.cancelled_date = None
        db_subscription.paused_date = None


def create_subscription(
    db: Session, subscription: schemas.SubscriptionCreate, user_id: int
) -> models.Subscription:
    # model_dump() turns the Pydantic schema into a plain dict, which is then
    # unpacked as keyword args to build the SQLAlchemy model instance. The
    # owner is added separately -- it comes from the token, and deliberately
    # isn't a field the client can send.
    db_subscription = models.Subscription(**_columns(subscription.model_dump()), user_id=user_id)
    db_subscription.category = ensure_category(db, db_subscription.category, user_id)
    # A subscription being added now almost always starts now. Recording that
    # beats leaving it unknown: without a start date the spend summary has to
    # assume the subscription was running for every month it is asked about.
    if db_subscription.started_date is None:
        db_subscription.started_date = date.today()
    _sync_status_dates(db_subscription)
    # Both of the calls above write dates, so the row is only now final. A
    # request carrying a back-dated cancelled_date and no started_date passes
    # the schema (it has nothing to compare against) and then has today's date
    # filled in above, which turns it into exactly the row the schema meant to
    # reject. Checking here, after every default is applied, is the only place
    # that sees what will actually be stored.
    schemas.check_dates(
        db_subscription.started_date,
        db_subscription.cancelled_date,
        db_subscription.paused_date,
    )
    db.add(db_subscription)
    db.commit()
    # refresh() reloads the row from Postgres so db_subscription.id (assigned
    # by the database) is populated before we return it.
    db.refresh(db_subscription)
    return db_subscription


def update_subscription(
    db: Session, subscription_id: int, subscription: schemas.SubscriptionUpdate, user_id: int
) -> models.Subscription | None:
    db_subscription = get_subscription(db, subscription_id, user_id)
    if db_subscription is None:
        return None
    # exclude_unset=True skips fields the client didn't include in the
    # request, so a partial update doesn't overwrite existing values with None.
    fields = subscription.model_dump(exclude_unset=True)
    for field, value in _columns(fields).items():
        setattr(db_subscription, field, value)
    # Only when the request actually touched the category: doing it
    # unconditionally would re-register the existing name on every edit.
    if "category" in fields:
        db_subscription.category = ensure_category(db, db_subscription.category, user_id)
    _sync_status_dates(db_subscription)
    # The merged row, not the request. SubscriptionUpdate can only compare the
    # fields one request happened to carry, so a PUT sending cancelled_date on
    # its own was checked against nothing and committed -- leaving a stored row
    # the API's own rules say cannot exist.
    #
    # The rollback matters as much as the check. Without it the invalid values
    # are already set on a live ORM object, and any later flush on this session
    # would write them; rolling back discards the whole edit, so a rejected
    # update changes nothing at all.
    try:
        schemas.check_dates(
            db_subscription.started_date,
            db_subscription.cancelled_date,
            db_subscription.paused_date,
        )
    except ValueError:
        db.rollback()
        raise
    db.commit()
    db.refresh(db_subscription)
    return db_subscription


def delete_subscription(db: Session, subscription_id: int, user_id: int) -> bool:
    db_subscription = get_subscription(db, subscription_id, user_id)
    if db_subscription is None:
        return False
    db.delete(db_subscription)
    db.commit()
    return True


# --- Backup (export / import) ---


def delete_all_user_data(db: Session, user_id: int) -> None:
    """Wipes one user's subscriptions and categories, and nothing else -- the
    account itself stays. Used by a `replace` import, which has to clear the
    slate before it writes.

    No commit: the caller runs this inside the same transaction as the import
    that follows, so a file that fails validation half way through can't leave
    the account empty.
    """
    db.query(models.Subscription).filter(models.Subscription.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(models.Category).filter(models.Category.user_id == user_id).delete(
        synchronize_session=False
    )


def import_backup(
    db: Session, backup: schemas.Backup, user_id: int, replace: bool = False
) -> schemas.ImportResult:
    """Writes a backup file's contents into one user's account.

    `replace` empties the account first, so what comes back is exactly what is
    in the file. Otherwise the file is merged in, and a subscription whose name
    already exists (in any capitalisation) is skipped rather than added a
    second time -- re-importing the same file twice should not leave two of
    everything.

    Only names already in the account are treated as duplicates: two rows
    called "Netflix" *within* the file are both imported, because a user really
    can have two, and silently dropping one would lose data the file says
    exists.

    The whole thing is one transaction. A file that fails part way through
    leaves the account exactly as it was, rather than half-restored.
    """
    if replace:
        delete_all_user_data(db, user_id)
        existing_names: set[str] = set()
    else:
        existing_names = {
            name.lower()
            for (name,) in db.query(models.Subscription.name)
            .filter(models.Subscription.user_id == user_id)
            .all()
        }

    # Categories are resolved against this dict rather than through
    # ensure_category, which asks the database each time. The session is
    # autoflush=False (see database.py), so a category added a moment ago is
    # still invisible to a query until the commit -- asking per row would
    # insert the same name repeatedly and trip the unique constraint. One read
    # up front, kept in step as names are added, avoids both.
    known_categories: dict[str, str] = {
        category.name.lower(): category.name
        for category in db.query(models.Category)
        .filter(models.Category.user_id == user_id)
        .all()
    }
    categories_added = 0

    def register_category(name: str | None) -> str | None:
        """The import's own ensure_category: registers a name if it is new and
        returns the spelling to store, so a subscription labelled "netflix"
        joins an existing "Netflix" rather than splitting it in two."""
        nonlocal categories_added
        if name is None:
            return None
        name = name.strip()
        if not name:
            return None
        existing = known_categories.get(name.lower())
        if existing is not None:
            return existing
        db.add(models.Category(name=name, user_id=user_id))
        known_categories[name.lower()] = name
        categories_added += 1
        return name

    # Categories first, so a subscription referring to one picks up the file's
    # own spelling for it rather than introducing its own capitalisation.
    for name in backup.categories:
        register_category(name)

    imported = skipped = 0
    for subscription in backup.subscriptions:
        if subscription.name.lower() in existing_names:
            skipped += 1
            continue
        db_subscription = models.Subscription(
            **_columns(subscription.model_dump()), user_id=user_id
        )
        db_subscription.category = register_category(db_subscription.category)
        # Deliberately no started_date default and no _sync_status_dates here,
        # unlike create_subscription: a restore reproduces what the file says,
        # including "start unknown". Stamping today's date on a subscription
        # that has been running for years would quietly rewrite its history in
        # the spend summary.
        db.add(db_subscription)
        imported += 1

    db.commit()

    return schemas.ImportResult(
        mode="replace" if replace else "merge",
        subscriptions_imported=imported,
        subscriptions_skipped=skipped,
        categories_imported=categories_added,
    )
