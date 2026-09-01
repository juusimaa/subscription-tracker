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


def occurrence_on_or_after(anchor: date, cycle_months: int, on_or_after: date) -> date:
    """The first date in the schedule on or after `on_or_after`, counted in
    both directions from `anchor`.

    next_occurrence deliberately never looks earlier than the anchor: it
    answers "when is the next renewal", and an anchor the client sent for next
    month *is* that answer. This one answers a different question -- where
    does the repeating schedule land inside a given window -- and for that a
    window earlier than the anchor is the normal case, not a mistake. A plan
    anchored on next March has been billing on the same day every year before
    that, and the spend summary has to be able to see those charges.
    """
    elapsed_months = (on_or_after.year - anchor.year) * 12 + (on_or_after.month - anchor.month)
    # Floor division, so a window before the anchor gives a negative period
    # count. Truncation towards zero would round the wrong way there and land
    # after the window instead of before it.
    periods = elapsed_months // cycle_months
    occurrence = add_months(anchor, periods * cycle_months)
    # The month count above ignores the day of the month, so the estimate can
    # be one period out either way -- never more. These two settle it, and
    # only one of them ever runs.
    while occurrence < on_or_after:
        periods += 1
        occurrence = add_months(anchor, periods * cycle_months)
    while (earlier := add_months(anchor, (periods - 1) * cycle_months)) >= on_or_after:
        periods -= 1
        occurrence = earlier
    return occurrence


def _walk(
    anchor: date, cycle_months: int, start: date, end: date, first
) -> Iterator[date]:
    """Every date in the schedule between `start` and `end`, both ends
    included, beginning wherever `first` says the window opens.

    Each step is measured from the anchor rather than from the previous
    result, so the month-end clamping in add_months cannot accumulate.
    """
    occurrence = first(anchor, cycle_months, start)
    while occurrence <= end:
        yield occurrence
        occurrence = first(anchor, cycle_months, occurrence + timedelta(days=1))


def occurrences_between(
    anchor: date, cycle_months: int, start: date, end: date
) -> Iterator[date]:
    """Every renewal falling in `start`..`end`, both ends included.

    A monthly plan renews several times in a 90-day window, and each of those
    renewals is a separate charge, so they are yielded separately rather than
    collapsed into the first one.

    Nothing before the anchor is yielded, which is what /upcoming wants: a
    subscription whose renewal date is next month is not also due this month.
    Use charges_between for the backward-looking view.
    """
    return _walk(anchor, cycle_months, start, end, next_occurrence)


def charges_between(
    anchor: date, cycle_months: int, start: date, end: date
) -> Iterator[date]:
    """The same window, with the schedule extended backwards through the
    anchor as well as forwards -- every date the plan billed on, not only the
    ones still to come. This is what the spend summary asks for, since the
    period it is totalling up is usually already over.
    """
    return _walk(anchor, cycle_months, start, end, occurrence_on_or_after)
