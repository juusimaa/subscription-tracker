# The renewal date arithmetic, tested directly rather than through the API.
# No database and no HTTP: these are pure functions, and a failure here should
# point at the arithmetic rather than at whatever route happened to call it.

from datetime import date

import pytest

from app import renewals


class TestAddMonths:
    def test_adds_whole_calendar_months(self):
        assert renewals.add_months(date(2026, 1, 15), 1) == date(2026, 2, 15)
        assert renewals.add_months(date(2026, 1, 15), 12) == date(2027, 1, 15)

    def test_rolls_over_the_year(self):
        assert renewals.add_months(date(2026, 12, 15), 1) == date(2027, 1, 15)
        assert renewals.add_months(date(2026, 11, 30), 14) == date(2028, 1, 30)

    def test_clamps_to_a_shorter_month(self):
        # The case timedelta cannot express: "one month" after 31 January is
        # the last day of February, whatever that happens to be.
        assert renewals.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
        assert renewals.add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
        assert renewals.add_months(date(2026, 3, 31), 1) == date(2026, 4, 30)

    def test_the_clamp_does_not_stick(self):
        """A short February must not drag the whole schedule back to the 28th.

        This is the regression this function exists for: clamping from the
        previous *result* rather than from the anchor would give 28 March
        here, and a plan anchored on the 31st would silently lose three days
        a month for the rest of its life.
        """
        assert renewals.add_months(date(2026, 1, 31), 2) == date(2026, 3, 31)
        assert renewals.add_months(date(2026, 1, 31), 3) == date(2026, 4, 30)
        assert renewals.add_months(date(2026, 1, 31), 4) == date(2026, 5, 31)

    def test_handles_the_leap_day_anchor(self):
        assert renewals.add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)
        assert renewals.add_months(date(2024, 2, 29), 48) == date(2028, 2, 29)


class TestNextOccurrence:
    def test_an_anchor_in_the_future_is_left_alone(self):
        # Nothing is rolled: a subscription added today with a renewal date
        # next month keeps exactly the date the client sent.
        assert renewals.next_occurrence(date(2026, 9, 15), 1, date(2026, 8, 31)) == date(
            2026, 9, 15
        )

    def test_an_anchor_on_the_day_is_the_occurrence(self):
        # On-or-after, not strictly after: money changes hands today.
        assert renewals.next_occurrence(date(2020, 1, 15), 1, date(2026, 1, 15)) == date(
            2026, 1, 15
        )

    def test_a_stale_monthly_anchor_rolls_forward(self):
        assert renewals.next_occurrence(date(2020, 1, 15), 1, date(2026, 8, 31)) == date(
            2026, 9, 15
        )

    def test_a_stale_yearly_anchor_rolls_forward(self):
        assert renewals.next_occurrence(date(2020, 3, 15), 12, date(2026, 8, 31)) == date(
            2027, 3, 15
        )
        # Landing inside the anchor's own month must not skip a year.
        assert renewals.next_occurrence(date(2020, 3, 15), 12, date(2026, 3, 1)) == date(
            2026, 3, 15
        )

    def test_month_end_and_leap_day_anchors(self):
        assert renewals.next_occurrence(date(2026, 1, 31), 1, date(2026, 2, 1)) == date(
            2026, 2, 28
        )
        assert renewals.next_occurrence(date(2024, 2, 29), 12, date(2026, 1, 1)) == date(
            2026, 2, 28
        )

    @pytest.mark.parametrize("cycle_months", [1, 12])
    def test_the_result_is_never_in_the_past(self, cycle_months):
        """The property that matters, stated as a property.

        Whatever the anchor and whatever the day, the answer is on or after
        the date asked about -- which is the whole reason renewal dates are
        derived instead of stored.
        """
        reference = date(2026, 8, 31)
        for day in (1, 15, 28, 29, 30, 31):
            for month in range(1, 13):
                anchor = date(2019, month, min(day, 28 if month == 2 else 30))
                assert renewals.next_occurrence(anchor, cycle_months, reference) >= reference


class TestOccurrencesBetween:
    def test_lists_every_monthly_charge_in_the_window(self):
        # Four separate charges, not one: each is money leaving the account.
        assert list(
            renewals.occurrences_between(date(2026, 1, 31), 1, date(2026, 1, 1), date(2026, 4, 30))
        ) == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]

    def test_a_yearly_plan_appears_at_most_once(self):
        assert list(
            renewals.occurrences_between(date(2020, 1, 10), 12, date(2026, 1, 1), date(2026, 3, 1))
        ) == [date(2026, 1, 10)]

    def test_both_ends_are_included(self):
        assert list(
            renewals.occurrences_between(date(2026, 5, 10), 1, date(2026, 5, 10), date(2026, 6, 10))
        ) == [date(2026, 5, 10), date(2026, 6, 10)]

    def test_a_window_with_no_renewal_is_empty(self):
        assert (
            list(
                renewals.occurrences_between(
                    date(2026, 1, 20), 1, date(2026, 1, 21), date(2026, 2, 19)
                )
            )
            == []
        )
