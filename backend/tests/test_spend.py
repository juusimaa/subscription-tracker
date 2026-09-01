# The spend arithmetic: _charge_dates in main.py, and _monthly_cost for the
# other summary. Easy to get wrong, easy to get wrong *again*, and wrong in a
# way nobody notices -- a total that is quietly a few months short still looks
# like a total.
#
# /summary/spend counts money in the month it changed hands, so a yearly plan
# is one charge for the full amount rather than a twelfth of it in each of
# twelve months. Most of what is pinned down below is what that means at the
# edges: a plan that starts or stops part way through the year.
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


class TestYearlyPlansAreOneCharge:
    def test_a_plan_started_in_october_costs_its_full_price_that_year(self, client, auth):
        """The bug this was reported as. EUR 149.99 left the account on 20
        October; the year it left in is the year it cost. Spreading it over
        the twelve months it covers used to leave three of them -- EUR 37.50
        -- in the year the money was actually spent."""
        add_subscription(
            client,
            auth,
            name="Yearly",
            cost="149.99",
            billing_cycle="yearly",
            started_date=f"{LAST_YEAR}-10-20",
            next_renewal_date=f"{LAST_YEAR + 1}-10-20",
        )
        summary = spend(client, auth, LAST_YEAR)
        assert summary["total"] == 149.99
        assert [m["total"] for m in summary["months"]] == [0.0] * 9 + [149.99, 0.0, 0.0]

    def test_a_stale_renewal_anchor_does_not_move_the_charge(self, client, auth):
        """next_renewal_date is whatever the client last said, and the add
        form defaults it to today -- which for a plan being back-dated to last
        October is neither the renewal nor the start. The billing schedule
        comes from started_date for exactly this reason."""
        add_subscription(
            client,
            auth,
            cost="149.99",
            billing_cycle="yearly",
            started_date=f"{LAST_YEAR}-10-20",
            next_renewal_date=str(date.today()),
        )
        assert spend(client, auth, LAST_YEAR)["total"] == 149.99

    def test_it_is_charged_again_a_year_later(self, client, auth):
        add_subscription(
            client,
            auth,
            cost="149.99",
            billing_cycle="yearly",
            started_date=f"{LAST_YEAR - 1}-10-20",
            next_renewal_date=f"{LAST_YEAR}-10-20",
        )
        months = [m["total"] for m in spend(client, auth, LAST_YEAR)["months"]]
        assert months == [0.0] * 9 + [149.99, 0.0, 0.0]


class TestCancelledYearlyPlans:
    def test_cancelled_the_day_after_renewing_keeps_the_whole_charge(self, client, auth):
        """The year was paid for in one go on 1 March, so cancelling on the
        2nd does not refund it -- and does not move it, either: it stays in
        March, where the money actually left.

        The anchor here is three years stale, which is the case that has
        always been easiest to get wrong -- the stored date is in the past and
        is not the term that was running when the cancellation happened.
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
        assert [m["total"] for m in spend(client, auth, LAST_YEAR)["months"]] == [
            0.0,
            0.0,
            120.0,
        ] + [0.0] * 9
        # Nothing further is ever billed: the next renewal never happened.
        assert spend(client, auth, LAST_YEAR + 1)["total"] == 0.0

    def test_cancelled_on_the_renewal_date_still_counts_that_charge(self, client, auth):
        """The boundary. The renewal fell on the day it was cancelled, so the
        money went out before anyone stopped it -- `end` is inclusive of the
        stop date for precisely this."""
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
        assert months[5] == 120.0, "June, the month it was cancelled in, was still charged"
        assert months[6] == 0.0, "July was not"


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
