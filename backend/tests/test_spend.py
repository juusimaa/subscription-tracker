# The spend arithmetic: _monthly_cost, _is_charged and _last_charged_month in
# main.py. Easy to get wrong, easy to get wrong *again*, and wrong in a way
# nobody notices -- a total that is quietly a few months short still looks
# like a total.
#
# Every test here uses a year that is fully in the past, so none of them
# depend on what today happens to be. A suite that starts failing in December
# is worse than no suite.

from datetime import date

from conftest import add_subscription

LAST_YEAR = date.today().year - 1


def spend(client, auth, year: int, **params) -> dict:
    response = client.get(
        "/subscriptions/summary/spend", params={"year": year, **params}, headers=auth
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestCancelledMonthlyPlans:
    def test_cancelled_in_june_counts_for_six_months_then_zero(self, client, auth):
        add_subscription(
            client,
            auth,
            name="Monthly",
            cost="10.00",
            billing_cycle="monthly",
            next_renewal_date=f"{LAST_YEAR}-01-05",
            started_date=f"{LAST_YEAR}-01-05",
            active=False,
            cancelled_date=f"{LAST_YEAR}-06-20",
        )
        summary = spend(client, auth, LAST_YEAR)
        assert [m["total"] for m in summary["months"]] == [10.0] * 6 + [0.0] * 6
        assert summary["total"] == 60.0

    def test_it_counts_for_nothing_the_following_year(self, client, auth):
        add_subscription(
            client,
            auth,
            cost="10.00",
            next_renewal_date=f"{LAST_YEAR}-01-05",
            started_date=f"{LAST_YEAR}-01-05",
            active=False,
            cancelled_date=f"{LAST_YEAR}-06-20",
        )
        assert spend(client, auth, LAST_YEAR + 1)["total"] == 0.0


class TestCancelledYearlyPlans:
    def test_cancelled_the_day_after_renewing_still_counts_to_the_end_of_the_term(
        self, client, auth
    ):
        """The year was already paid for on 1 March, so cancelling on the 2nd
        does not refund the other eleven months.

        The anchor here is three years stale, which is the case that used to
        break: _last_charged_month read the stored date, found a paid term
        that ended before the cancellation, and fell back to the cancellation
        month -- counting three months of the year instead of twelve.
        """
        add_subscription(
            client,
            auth,
            name="Yearly",
            cost="120.00",
            billing_cycle="yearly",
            next_renewal_date=f"{LAST_YEAR - 3}-03-01",
            started_date=f"{LAST_YEAR - 3}-03-01",
            active=False,
            cancelled_date=f"{LAST_YEAR}-03-02",
        )
        # 120 a year is 10 a month, charged for every month of the year it was
        # cancelled in...
        assert [m["total"] for m in spend(client, auth, LAST_YEAR)["months"]] == [10.0] * 12
        # ...and on into the following year until the term actually ends.
        assert [m["total"] for m in spend(client, auth, LAST_YEAR + 1)["months"]] == [
            10.0,
            10.0,
        ] + [0.0] * 10

    def test_cancelled_on_the_renewal_date_still_counts_that_month(self, client, auth):
        """The boundary case _last_charged_month keeps its max() for: the
        derived renewal is the cancellation day itself, so the paid term ends
        the day before -- and the month of cancellation would drop out
        entirely without it."""
        add_subscription(
            client,
            auth,
            cost="120.00",
            billing_cycle="yearly",
            next_renewal_date=f"{LAST_YEAR - 2}-06-01",
            started_date=f"{LAST_YEAR - 2}-06-01",
            active=False,
            cancelled_date=f"{LAST_YEAR}-06-01",
        )
        months = [m["total"] for m in spend(client, auth, LAST_YEAR)["months"]]
        assert months[5] == 10.0, "June, the month it was cancelled in, must still count"
        assert months[6] == 0.0, "July must not"


class TestRowsWithMissingDates:
    """Rows that predate the started_date and cancelled_date columns.

    Both tests reach that state through `/import`, which is the one path that
    can still produce it: a restore reproduces what the file says, including
    "unknown", where POST /subscriptions defaults a missing started_date to
    today. Stamping today's date on a subscription that has been running for
    years would quietly rewrite its history in this very summary.
    """

    def restore(self, client, auth, **fields) -> dict:
        subscription = {"name": "Old", "cost": "10.00", "billing_cycle": "monthly"}
        subscription.update(fields)
        response = client.post(
            "/import",
            json={"version": 1, "categories": [], "subscriptions": [subscription]},
            headers=auth,
        )
        assert response.status_code == 200, response.text
        return client.get("/subscriptions", headers=auth).json()[0]

    def test_no_started_date_is_treated_as_always_running(self, client, auth):
        """The start is unknown, so the summary assumes as little as possible
        and counts every month asked about -- which is how it behaved before
        there was a column to be unsure about."""
        stored = self.restore(client, auth, next_renewal_date=f"{LAST_YEAR}-05-05")
        assert stored["started_date"] is None, "a restore must not invent a start date"
        assert [m["total"] for m in spend(client, auth, LAST_YEAR)["months"]] == [10.0] * 12

    def test_inactive_with_no_cancelled_date_counts_for_nothing(self, client, auth):
        """The other unknown, and the opposite decision: rather than invent a
        cancellation date and bill months that may never have happened, it
        counts nothing."""
        stored = self.restore(
            client,
            auth,
            next_renewal_date=f"{LAST_YEAR}-01-05",
            started_date=f"{LAST_YEAR}-01-05",
            active=False,
        )
        assert stored["active"] is False and stored["cancelled_date"] is None
        assert spend(client, auth, LAST_YEAR)["total"] == 0.0


class TestNothingBeforeTheStart:
    def test_months_before_started_date_are_not_charged(self, client, auth):
        add_subscription(
            client,
            auth,
            cost="10.00",
            next_renewal_date=f"{LAST_YEAR}-07-15",
            started_date=f"{LAST_YEAR}-07-15",
        )
        assert [m["total"] for m in spend(client, auth, LAST_YEAR)["months"]] == [0.0] * 6 + [
            10.0
        ] * 6


class TestTheTotalAgreesWithTheBreakdown:
    def test_total_is_the_sum_of_the_months(self, client, auth):
        # Not a separately computed figure: a client charting the breakdown
        # and showing the total must not see the two disagree by a cent.
        add_subscription(client, auth, cost="15.99", started_date=f"{LAST_YEAR}-01-01")
        add_subscription(
            client,
            auth,
            name="Yearly",
            cost="99.99",
            billing_cycle="yearly",
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-01-01",
        )
        summary = spend(client, auth, LAST_YEAR)
        assert summary["total"] == round(sum(m["total"] for m in summary["months"]), 2)

    def test_a_single_month_returns_one_entry(self, client, auth):
        add_subscription(client, auth, cost="10.00", started_date=f"{LAST_YEAR}-01-01")
        summary = spend(client, auth, LAST_YEAR, month=3)
        assert [m["month"] for m in summary["months"]] == [3]
        assert summary["total"] == 10.0


class TestMonthlyTotal:
    """The other summary, answering the other question: what is being paid
    *now*. It ignores cancelled subscriptions entirely, where /summary/spend
    counts them for the months they ran."""

    def test_normalizes_yearly_plans_to_a_monthly_figure(self, client, auth):
        add_subscription(client, auth, cost="10.00", billing_cycle="monthly")
        add_subscription(
            client, auth, name="Yearly", cost="120.00", billing_cycle="yearly"
        )
        assert client.get("/subscriptions/summary/monthly-total", headers=auth).json() == {
            "monthly_total": 20.0,
            "yearly_total": 240.0,
        }

    def test_ignores_cancelled_subscriptions(self, client, auth):
        created = add_subscription(client, auth, cost="10.00")
        client.put(f"/subscriptions/{created['id']}", json={"active": False}, headers=auth)
        assert client.get("/subscriptions/summary/monthly-total", headers=auth).json() == {
            "monthly_total": 0.0,
            "yearly_total": 0.0,
        }
