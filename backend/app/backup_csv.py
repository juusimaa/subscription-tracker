# The CSV side of GET /export.
#
# JSON is the backup; this is the interchange format. A spreadsheet opens it,
# a person can hand-edit a row, and `curl -OJ localhost:8000/export?format=csv`
# is the shortest path there is to a file full of real data to test against --
# which is most of the reason it exists.
#
# It is deliberately one-directional. POST /import speaks JSON only: the
# frontend parses a dropped .csv into the same Backup shape and sends that,
# because it has to read the file anyway to show the summary dialog before
# anything is written, and a second parser on the server would be a second
# place for the two to disagree about what a row means.
#
# Two things a CSV cannot carry, both by nature rather than by omission:
#
#   - Categories nothing is using. The file has one row per subscription, so a
#     category set up in advance has nothing to appear in. It survives a JSON
#     round trip and not a CSV one.
#   - `version` and `exported_at`, which have no column to live in. A CSV read
#     back in is therefore assumed to be current, where a JSON file says which
#     build wrote it and can be refused or migrated on that basis.
#
# Anyone who needs an exact restore wants the JSON.

import csv
import io

from app import schemas

# The first six are the columns and the order the design handoff pins
# (README section 12, *Behaviour the implementation owns*), so a file from
# here is the file that document describes. The three after them are added
# rather than substituted: without the dates, re-importing an export would
# silently rewrite when each subscription started and stopped, and every past
# month in the spend summary with it -- a round trip that changes the numbers
# is not a round trip. Adding columns keeps the pinned ones where they are.
#
# The short names are the handoff's; the appended ones are named after the API
# fields they carry, which is also what the JSON export calls them.
COLUMNS = [
    "name",
    "category",
    "status",
    "cycle",
    "cost",
    "next_renewal",
    "started_date",
    "cancelled_date",
    "paused_date",
    "archived_date",
]


def _cell(value) -> str:
    """Empty for a missing value, never the string "None"."""
    return "" if value is None else str(value)


def to_csv(backup: schemas.Backup) -> str:
    """One row per subscription, with a header line.

    Values are the API's own -- `cancelled` rather than the design's internal
    `archived`, and lowercase cycles -- so the words in the file are the words
    every other route uses. Only the column *names* come from the design.

    csv.writer rather than string joining: a subscription called
    `Netflix, shared` is ordinary, and quoting it correctly is exactly the
    part that is easy to get wrong by hand.
    """
    buffer = io.StringIO()
    # \r\n is what RFC 4180 specifies and what Excel expects; every CSV reader
    # worth using handles it, and lineterminator has to be set explicitly
    # because csv.writer otherwise follows the platform.
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(COLUMNS)
    for subscription in backup.subscriptions:
        writer.writerow(
            [
                subscription.name,
                _cell(subscription.category),
                subscription.status.value,
                subscription.billing_cycle.value,
                # Two decimals always, so a column of costs lines up and a
                # spreadsheet reads it as money rather than as text.
                f"{subscription.cost:.2f}",
                subscription.next_renewal_date.isoformat(),
                _cell(subscription.started_date),
                _cell(subscription.cancelled_date),
                _cell(subscription.paused_date),
                _cell(subscription.archived_date),
            ]
        )
    return buffer.getvalue()
