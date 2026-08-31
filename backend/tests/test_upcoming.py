# GET /subscriptions/upcoming: what is about to be charged.
#
# The money here is not the money the summaries report, and that difference is
# most of what these tests pin down. /summary/spend spreads a yearly plan
# across the twelve months it covers; this route puts the whole year's cost on
# the one day it is actually taken.

from datetime import date, timedelta

from conftest import add_subscription

TODAY = date.today()


def upcoming(client, auth, **params) -> dict:
    response = client.get("/subscriptions/upcoming", params=params, headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


class TestTheWindow:
    def test_defaults_to_thirty_days(self, client, auth):
        summary = upcoming(client, auth)
        assert summary["days"] == 30
        assert summary["through"] == str(TODAY + timedelta(days=30))

    def test_a_renewal_inside_the_window_is_listed(self, client, auth):
        add_subscription(client, auth, next_renewal_date=str(TODAY + timedelta(days=5)))
        entry = upcoming(client, auth, days=10)["renewals"][0]
        assert entry["renewal_date"] == str(TODAY + timedelta(days=5))
        assert entry["days_until"] == 5
        assert entry["subscription"]["name"] == "Netflix"

    def test_a_renewal_beyond_the_window_is_not(self, client, auth):
        add_subscription(client, auth, next_renewal_date=str(TODAY + timedelta(days=40)))
        assert upcoming(client, auth, days=30)["renewals"] == []

    def test_the_last_day_is_included(self, client, auth):
        add_subscription(client, auth, next_renewal_date=str(TODAY + timedelta(days=10)))
        assert len(upcoming(client, auth, days=10)["renewals"]) == 1

    def test_a_renewal_today_is_included(self, client, auth):
        add_subscription(client, auth, next_renewal_date=str(TODAY))
        assert upcoming(client, auth, days=1)["renewals"][0]["days_until"] == 0

    def test_the_window_is_bounded(self, client, auth):
        assert client.get("/subscriptions/upcoming?days=0", headers=auth).status_code == 422
        assert client.get("/subscriptions/upcoming?days=366", headers=auth).status_code == 422

    def test_the_route_is_not_read_as_a_subscription_id(self, client, auth):
        """Declared before /subscriptions/{id}. Declared after it, "upcoming"
        would be handed to that route as an id and come back 422."""
        assert client.get("/subscriptions/upcoming", headers=auth).status_code == 200


class TestEachChargeIsListedSeparately:
    def test_a_monthly_plan_appears_once_per_renewal(self, client, auth):
        """Three or four charges in 90 days, not one.

        Deliberately not asserting an exact count: 90 days spans three month
        boundaries or two depending on which months they are and where the
        anchor sits, so a magic number here would be a test that passes in
        August and fails in February. What must hold every day of the year is
        that each renewal is listed once, roughly a month apart, and that the
        total is the sum of them.
        """
        add_subscription(client, auth, cost="10.00", next_renewal_date=str(TODAY))
        summary = upcoming(client, auth, days=90)
        dates = [date.fromisoformat(e["renewal_date"]) for e in summary["renewals"]]

        assert len(dates) >= 3
        assert len(set(dates)) == len(dates), "no renewal is listed twice"
        gaps = {(later - earlier).days for earlier, later in zip(dates, dates[1:])}
        assert gaps <= {28, 29, 30, 31}, f"renewals should be a calendar month apart, got {gaps}"
        assert summary["total"] == 10.0 * len(dates)

    def test_a_yearly_plan_brings_its_whole_cost_to_one_day(self, client, auth):
        # Not 120/12: this is what leaves the account on the day.
        add_subscription(
            client,
            auth,
            billing_cycle="yearly",
            cost="120.00",
            next_renewal_date=str(TODAY + timedelta(days=10)),
        )
        summary = upcoming(client, auth, days=30)
        assert len(summary["renewals"]) == 1
        assert summary["renewals"][0]["cost"] == 120.0
        assert summary["total"] == 120.0

    def test_the_total_is_the_sum_of_what_is_listed(self, client, auth):
        add_subscription(client, auth, name="A", cost="10.00", next_renewal_date=str(TODAY))
        add_subscription(
            client, auth, name="B", cost="5.55", next_renewal_date=str(TODAY + timedelta(days=3))
        )
        summary = upcoming(client, auth, days=30)
        assert summary["total"] == round(sum(e["cost"] for e in summary["renewals"]), 2)

    def test_renewals_are_ordered_soonest_first(self, client, auth):
        add_subscription(client, auth, name="Later", next_renewal_date=str(TODAY + timedelta(days=20)))
        add_subscription(client, auth, name="Sooner", next_renewal_date=str(TODAY + timedelta(days=2)))
        dates = [e["renewal_date"] for e in upcoming(client, auth, days=30)["renewals"]]
        assert dates == sorted(dates)


class TestWhatIsLeftOut:
    def test_cancelled_subscriptions_are_not_upcoming(self, client, auth):
        """Whatever its dates say, a cancelled subscription is not going to be
        billed again."""
        created = add_subscription(client, auth, next_renewal_date=str(TODAY + timedelta(days=5)))
        client.put(f"/subscriptions/{created['id']}", json={"active": False}, headers=auth)
        assert upcoming(client, auth, days=365)["renewals"] == []

    def test_renewals_before_the_start_date_are_skipped(self, client, auth):
        """A plan added now but starting next quarter is not due tomorrow."""
        add_subscription(
            client,
            auth,
            next_renewal_date=str(TODAY + timedelta(days=2)),
            started_date=str(TODAY + timedelta(days=200)),
        )
        assert upcoming(client, auth, days=60)["renewals"] == []

    def test_an_empty_account_totals_zero(self, client, auth):
        summary = upcoming(client, auth)
        assert summary["renewals"] == [] and summary["total"] == 0.0


class TestFilters:
    def test_by_category(self, client, auth):
        add_subscription(client, auth, name="Netflix", category="Movies", next_renewal_date=str(TODAY))
        add_subscription(client, auth, name="Spotify", category="Music", next_renewal_date=str(TODAY))
        summary = upcoming(client, auth, days=7, category="movies")
        assert [e["subscription"]["name"] for e in summary["renewals"]] == ["Netflix"]

    def test_by_billing_cycle(self, client, auth):
        add_subscription(client, auth, name="Monthly", next_renewal_date=str(TODAY))
        add_subscription(
            client, auth, name="Yearly", billing_cycle="yearly", next_renewal_date=str(TODAY)
        )
        summary = upcoming(client, auth, days=7, billing_cycle="yearly")
        assert [e["subscription"]["name"] for e in summary["renewals"]] == ["Yearly"]
