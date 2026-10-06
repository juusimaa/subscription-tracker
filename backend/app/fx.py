# Exchange rates: European Central Bank reference rates, fetched on demand
# from Frankfurter (https://frankfurter.dev) and cached in the fx_rates table
# (PLAN.md milestone 10).
#
# Why on demand rather than on a schedule: both apps scale to zero, so there
# is no process awake to run a daily job, and €0 hosting rules out keeping
# one awake for it. The first request that needs a rate it does not have
# fetches it; everyone after reads the table.
#
# Why it fails open: a rate source that is down must never take the
# dashboard with it. Whatever is stored is used, and the answer says how old
# it is (`stale`, `as_of`), which the frontend puts in words next to the
# total. A currency with no stored rate at all cannot be converted, and is
# reported rather than guessed at (RateTable.convert returns None).
#
# The conversion rule, which the frontend's fx.js repeats exactly:
#
# - A charge on a given day uses the latest rate published on or before that
#   day. The ECB publishes on TARGET working days, so a Saturday charge uses
#   Friday's rate.
# - A charge still to come uses the latest rate there is -- which is the same
#   rule, since nothing has been published after today.
# - Every converted charge is rounded to the cent before it is added to
#   anything, so a total and the per-currency lines it is made of always
#   agree to the cent.

import bisect
import logging
import os
import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.currencies import CURRENCIES, DEFAULT_CURRENCY
from app.database import SessionLocal

logger = logging.getLogger(__name__)

FX_API_URL = os.getenv("FX_API_URL", "https://api.frankfurter.dev/v1").rstrip("/")
# The ECB publishes once a working day, around 16:00 CET. Six hours keeps a
# warm process from asking more than a few times a day.
REFRESH_EVERY = timedelta(hours=6)
# After a failed fetch, how long to serve stored rates before trying again,
# so a dead provider costs one 3-second timeout per ten minutes rather than
# one per request.
RETRY_AFTER = timedelta(minutes=10)
# The newest stored rate is "stale" when it is older than this. Four days
# covers a weekend plus a public holiday, when no rate is due at all.
STALE_AFTER = timedelta(days=4)
# The ECB series start on 4 Jan 1999; nothing older exists to fetch.
FIRST_RATE_DAY = date(1999, 1, 4)
# How far before a requested day to read, so the day itself has a rate to
# fall back on (a long holiday weekend at the start of a year).
LOOKBACK = timedelta(days=14)
CENT = Decimal("0.01")


def _fetch(path: str, params: dict) -> dict:
    """One GET against Frankfurter. Replaced in the test suite (see
    tests/conftest.py), which must never reach the network."""
    response = httpx.get(f"{FX_API_URL}{path}", params=params, timeout=3.0)
    response.raise_for_status()
    return response.json()


# Per-process memory of what was fetched and when. Losing it (a restart, a
# scale-to-zero) costs at most one extra fetch, which is why it is not
# stored anywhere.
_lock = threading.Lock()
_state: dict = {}


def reset() -> None:
    """Forget every fetch attempt. The test suite calls this between tests,
    whose database is emptied underneath this memory."""
    with _lock:
        _state.clear()
        _state.update(latest_ok=None, latest_failed=None, covered_from={}, backfill_failed={})


reset()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _store(rows: Iterable[tuple[date, str, Decimal]]) -> None:
    """Inserts the rates not already stored. In its own session, so a
    concurrent request inserting the same day cannot roll back anything the
    calling request is doing."""
    rows = [(day, code, rate) for day, code, rate in rows if code in CURRENCIES and code != "EUR"]
    if not rows:
        return
    with SessionLocal() as session:
        days = {day for day, _, _ in rows}
        codes = {code for _, code, _ in rows}
        existing = set(
            session.query(models.FxRate.day, models.FxRate.currency)
            .filter(
                models.FxRate.day >= min(days),
                models.FxRate.day <= max(days),
                models.FxRate.currency.in_(codes),
            )
            .all()
        )
        for day, code, rate in rows:
            if (day, code) not in existing:
                session.add(models.FxRate(day=day, currency=code, rate=Decimal(str(rate))))
        try:
            session.commit()
        except IntegrityError:
            # Another request stored the same day first. Its rows are the
            # same published figures, so there is nothing to reconcile.
            session.rollback()


def _refresh_latest() -> None:
    now = _now()
    ok, failed = _state["latest_ok"], _state["latest_failed"]
    if ok is not None and now - ok < REFRESH_EVERY:
        return
    if failed is not None and now - failed < RETRY_AFTER:
        return
    try:
        body = _fetch("/latest", {"base": "EUR"})
        day = date.fromisoformat(body["date"])
        _store((day, code, Decimal(str(rate))) for code, rate in body["rates"].items())
        _state["latest_ok"] = now
    except Exception:  # noqa: BLE001 -- any failure means "use what is stored"
        logger.warning("fx: latest rates could not be fetched", exc_info=True)
        _state["latest_failed"] = now


def _backfill(db: Session, codes: set[str], since: date) -> None:
    """Makes sure every code has rates from `since` on, fetching the gap in
    one time-series request per calendar year (a year of one currency is
    about 255 rows). Starts LOOKBACK before `since`, so a first charge on a
    weekend or holiday has the rate published before it."""
    since = max(since - LOOKBACK, FIRST_RATE_DAY)
    now = _now()
    wanted: set[str] = set()
    for code in codes:
        covered = _state["covered_from"].get(code)
        if covered is not None and covered <= since:
            continue
        earliest = (
            db.query(func.min(models.FxRate.day)).filter(models.FxRate.currency == code).scalar()
        )
        # A few days' slack: 1 January is never a publishing day, so a
        # series that genuinely starts on the 2nd is complete.
        if earliest is not None and earliest <= since + timedelta(days=5):
            _state["covered_from"][code] = since
            continue
        failed = _state["backfill_failed"].get(code)
        if failed is not None and now - failed < RETRY_AFTER:
            continue
        wanted.add(code)
    if not wanted:
        return
    today = date.today()
    start = since
    try:
        while start <= today:
            end = min(date(start.year, 12, 31), today)
            body = _fetch(
                f"/{start.isoformat()}..{end.isoformat()}",
                {"base": "EUR", "symbols": ",".join(sorted(wanted))},
            )
            _store(
                (date.fromisoformat(day), code, Decimal(str(rate)))
                for day, rates in body.get("rates", {}).items()
                for code, rate in rates.items()
            )
            start = end + timedelta(days=1)
        for code in wanted:
            _state["covered_from"][code] = since
    except Exception:  # noqa: BLE001 -- as in _refresh_latest
        logger.warning("fx: rates since %s could not be fetched", since, exc_info=True)
        for code in wanted:
            _state["backfill_failed"][code] = now


@dataclass
class RateTable:
    """The rates one request converts with. Built by `load`; everything
    after that is arithmetic, with no further database or network access."""

    target: str
    series: dict[str, tuple[list[date], list[Decimal]]] = field(default_factory=dict)
    # The newest day every needed currency has a rate for (the oldest of
    # their newest days), or None when nothing needed converting.
    as_of: date | None = None
    stale: bool = False
    # Needed currencies with no stored rate at all.
    missing: set[str] = field(default_factory=set)

    def rate_on(self, code: str, day: date) -> Decimal | None:
        """Units of `code` per 1 EUR on `day`: the latest rate on or before
        it, or the earliest known one for a day before the stored series
        begins (a backfill that failed). None when there is no rate."""
        if code == "EUR":
            return Decimal(1)
        entry = self.series.get(code)
        if not entry or not entry[0]:
            return None
        days, rates = entry
        index = bisect.bisect_right(days, day) - 1
        return rates[max(index, 0)]

    def convert(self, amount, code: str, day: date) -> Decimal | None:
        """`amount` of `code`, charged on `day`, in the target currency and
        rounded to the cent. None when either side has no rate."""
        amount = Decimal(str(amount))
        if code == self.target:
            return amount.quantize(CENT, ROUND_HALF_UP)
        from_rate = self.rate_on(code, day)
        to_rate = self.rate_on(self.target, day)
        if from_rate is None or to_rate is None:
            return None
        return (amount / from_rate * to_rate).quantize(CENT, ROUND_HALF_UP)


def load(db: Session, codes: Iterable[str], target: str, since: date | None = None) -> RateTable:
    """The rates needed to convert `codes` into `target` for charges from
    `since` on (default: today, which is all a future charge needs).

    Fetches only when something is missing or the latest rate is due a
    refresh, and never raises over a fetch: a failure leaves the table with
    whatever was stored, marked stale."""
    target = target or DEFAULT_CURRENCY
    needed = {code for code in codes if code != target}
    if not needed:
        # Nothing to convert: an account in one currency never touches the
        # rate source at all.
        return RateTable(target=target)
    needed = (needed | {target}) - {"EUR"}
    since = since or date.today()
    with _lock:
        _refresh_latest()
        _backfill(db, needed, since)

    rows = (
        db.query(models.FxRate.currency, models.FxRate.day, models.FxRate.rate)
        .filter(models.FxRate.currency.in_(needed), models.FxRate.day >= since - LOOKBACK)
        .order_by(models.FxRate.currency, models.FxRate.day)
        .all()
    )
    series: dict[str, tuple[list[date], list[Decimal]]] = {}
    for code, day, rate in rows:
        days, rates = series.setdefault(code, ([], []))
        days.append(day)
        rates.append(Decimal(str(rate)))
    newest = dict(
        db.query(models.FxRate.currency, func.max(models.FxRate.day))
        .filter(models.FxRate.currency.in_(needed))
        .group_by(models.FxRate.currency)
        .all()
    )
    for code, day in newest.items():
        if code not in series:
            # Nothing inside the window -- only possible when every recent
            # fetch failed -- so fall back to the newest rate there is.
            rate = (
                db.query(models.FxRate.rate)
                .filter(models.FxRate.currency == code, models.FxRate.day == day)
                .scalar()
            )
            series[code] = ([day], [Decimal(str(rate))])
    missing = {code for code in needed if code not in newest}
    as_of = min(newest.values()) if newest else None
    stale = bool(missing) or as_of is None or as_of < date.today() - STALE_AFTER
    return RateTable(target=target, series=series, as_of=as_of, stale=stale, missing=missing)
