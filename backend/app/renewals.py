# Renewal date arithmetic, kept in one place and free of any database or
# schema imports so models.py can use it without a circular import.
#
# The one thing worth knowing before reading any of this: `timedelta` cannot
# express "one month". A month is 28, 29, 30 or 31 days depending on which one
# it is, so every function here works in whole calendar months and asks the
# calendar how long each one actually is.

from calendar import monthrange
from collections.abc import Iterator
from datetime import date, timedelta


def add_months(anchor: date, months: int) -> date:
    """`anchor` shifted forward by whole calendar months.

    A day that does not exist in the target month is clamped to that month's
    last day: the 31st of January plus one month is the 28th of February.

    The clamp is always computed from the *anchor*, never from the previous
    result, which is what keeps a plan anchored on the 31st billing on the
    31st again in March instead of being permanently dragged back to the 28th
    by one short February.
    """
    # Counting months from year zero makes the year rollover plain division
    # rather than a loop with a special case at December.
    total = (anchor.year * 12) + (anchor.month - 1) + months
    year, month = divmod(total, 12)
    return date(year, month + 1, min(anchor.day, monthrange(year, month + 1)[1]))


def next_occurrence(anchor: date, cycle_months: int, on_or_after: date) -> date:
    """The first renewal on or after `on_or_after`, for a plan that renews
    every `cycle_months` months starting from `anchor`.

    An anchor in the future is itself the next occurrence -- nothing is
    rolled, so a subscription added today with a renewal date next month keeps
    the date the client sent.
    """
    if anchor >= on_or_after:
        return anchor
    # Jump straight to roughly the right period instead of stepping a month at
    # a time: an anchor left untouched since 2020 is one calculation, not
    # seventy iterations. The month count ignores the day of the month, so the
    # estimate can land one period short -- never more -- and the loop below
    # settles it.
    elapsed_months = (on_or_after.year - anchor.year) * 12 + (on_or_after.month - anchor.month)
    periods = elapsed_months // cycle_months
    occurrence = add_months(anchor, periods * cycle_months)
    while occurrence < on_or_after:
        periods += 1
        occurrence = add_months(anchor, periods * cycle_months)
    return occurrence


def occurrences_between(
    anchor: date, cycle_months: int, start: date, end: date
) -> Iterator[date]:
    """Every renewal falling in `start`..`end`, both ends included.

    A monthly plan renews several times in a 90-day window, and each of those
    renewals is a separate charge, so they are yielded separately rather than
    collapsed into the first one.

    Each step is measured from the anchor rather than from the previous
    result, so the month-end clamping in add_months cannot accumulate.
    """
    occurrence = next_occurrence(anchor, cycle_months, start)
    while occurrence <= end:
        yield occurrence
        occurrence = next_occurrence(anchor, cycle_months, occurrence + timedelta(days=1))
