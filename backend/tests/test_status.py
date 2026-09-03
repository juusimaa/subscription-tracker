# The four subscription statuses, and the arithmetic that changed with them.
#
# The boolean these replaced could only say "running" or "not running", and
# the interesting cases are the ones that distinction could not hold: a trial
# that is running and free, and a pause that stops the billing without
# erasing the months already billed. Both of those are silent-wrong-total
# bugs if they regress, so they get most of the tests here.
#
# Like test_spend.py, every test that totals a period uses a year fully in the
# past, so none of them depend on what today happens to be.

from datetime import date, timedelta

from app import schemas
from conftest import add_subscription

TODAY = date.today()
LAST_YEAR = TODAY.year - 1


def get(client, auth, subscription_id: int) -> dict:
    response = client.get(f"/subscriptions/{subscription_id}", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


def put(client, auth, subscription_id: int, **body):
    return client.put(f"/subscriptions/{subscription_id}", json=body, headers=auth)


def monthly_total(client, auth) -> float:
    response = client.get("/subscriptions/summary/monthly-total", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()["monthly_total"]


def spend(client, auth, year: int, **params) -> dict:
    response = client.get(
        "/subscriptions/summary/spend", params={"year": year, **params}, headers=auth
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestTheLegacyActiveAlias:
    """`active` is what every client written before statuses existed sends and
    reads. It has to keep meaning what it meant, in both directions."""

    def test_each_status_reports_the_active_flag_its_meaning_implies(self, client, auth):
        for status, expected in [
            ("active", True),
            ("trial", False),
            ("paused", False),
            ("cancelled", False),
        ]:
            created = add_subscription(client, auth, name=f"S-{status}", status=status)
            assert created["status"] == status
            assert created["active"] is expected, status

    def test_writing_active_false_cancels(self, client, auth):
        created = add_subscription(client, auth)
        assert put(client, auth, created["id"], active=False).status_code == 200
        assert get(client, auth, created["id"])["status"] == "cancelled"

    def test_writing_active_true_reactivates(self, client, auth):
        created = add_subscription(client, auth, status="paused")
        assert put(client, auth, created["id"], active=True).status_code == 200
        assert get(client, auth, created["id"])["status"] == "active"

    def test_creating_with_active_false_cancels(self, client, auth):
        assert add_subscription(client, auth, active=False)["status"] == "cancelled"

    def test_a_contradictory_pair_is_refused_rather_than_resolved(self, client, auth):
        """Picking a winner would silently cancel a subscription or silently
        revive one, depending on which half was guessed."""
        created = add_subscription(client, auth)
        response = put(client, auth, created["id"], status="paused", active=True)
        assert response.status_code == 422, response.text
        assert get(client, auth, created["id"])["status"] == "active"

    def test_an_agreeing_pair_is_accepted(self, client, auth):
        created = add_subscription(client, auth)
        assert put(client, auth, created["id"], status="cancelled", active=False).status_code == 200
        assert get(client, auth, created["id"])["status"] == "cancelled"

    def test_a_partial_update_mentioning_neither_leaves_the_status_alone(self, client, auth):
        created = add_subscription(client, auth, status="trial")
        assert put(client, auth, created["id"], cost="20.00").status_code == 200
        assert get(client, auth, created["id"])["status"] == "trial"


class TestStatusDates:
    def test_pausing_records_a_pause_date_and_not_a_cancellation(self, client, auth):
        """The bug this whole change was written for: `active=False` used to be
        the only way to stop a subscription, so pausing stamped a cancellation
        date on a plan nobody had cancelled."""
        created = add_subscription(client, auth)
        put(client, auth, created["id"], status="paused")
        paused = get(client, auth, created["id"])
        assert paused["paused_date"] == str(TODAY)
        assert paused["cancelled_date"] is None

    def test_cancelling_records_a_cancellation_date_and_not_a_pause(self, client, auth):
        created = add_subscription(client, auth)
        put(client, auth, created["id"], status="cancelled")
        cancelled = get(client, auth, created["id"])
        assert cancelled["cancelled_date"] == str(TODAY)
        assert cancelled["paused_date"] is None

    def test_resuming_clears_the_pause_date(self, client, auth):
        created = add_subscription(client, auth, status="paused")
        put(client, auth, created["id"], status="active")
        resumed = get(client, auth, created["id"])
        assert resumed["paused_date"] is None and resumed["cancelled_date"] is None

    def test_a_backdated_stop_is_left_alone(self, client, auth):
        created = add_subscription(
            client, auth, started_date=f"{LAST_YEAR}-01-01", next_renewal_date=f"{LAST_YEAR}-01-01"
        )
        put(client, auth, created["id"], status="paused", paused_date=f"{LAST_YEAR}-06-01")
        assert get(client, auth, created["id"])["paused_date"] == f"{LAST_YEAR}-06-01"

    def test_a_stop_date_before_the_start_date_is_refused(self, client, auth):
        created = add_subscription(client, auth, started_date=f"{LAST_YEAR}-06-01")
        response = put(client, auth, created["id"], status="paused", paused_date=f"{LAST_YEAR}-01-01")
        assert response.status_code == 422, response.text
        assert "paused_date" in response.text
        # The rejected edit changed nothing, including the status.
        assert get(client, auth, created["id"])["status"] == "active"


class TestPausingThenCancelling:
    """A plan paused in June and cancelled in September stopped costing money
    in June. Stamping today's date on the cancellation would count three
    months of spend that never happened."""

    def test_the_cancellation_inherits_the_pause_date(self, client, auth):
        created = add_subscription(
            client,
            auth,
            cost="10.00",
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-01-01",
        )
        put(client, auth, created["id"], status="paused", paused_date=f"{LAST_YEAR}-06-10")
        put(client, auth, created["id"], status="cancelled")

        cancelled = get(client, auth, created["id"])
        assert cancelled["cancelled_date"] == f"{LAST_YEAR}-06-10"
        assert cancelled["paused_date"] is None
        assert spend(client, auth, LAST_YEAR)["total"] == 60.0

    def test_an_explicit_date_still_wins(self, client, auth):
        """Which is what makes the inherited date correctable when the pause
        really did end and the cancellation happened later."""
        created = add_subscription(
            client, auth, started_date=f"{LAST_YEAR}-01-01", next_renewal_date=f"{LAST_YEAR}-01-01"
        )
        put(client, auth, created["id"], status="paused", paused_date=f"{LAST_YEAR}-06-10")
        put(client, auth, created["id"], status="cancelled", cancelled_date=f"{LAST_YEAR}-09-01")
        assert get(client, auth, created["id"])["cancelled_date"] == f"{LAST_YEAR}-09-01"


class TestWhatCountsTowardTotals:
    def test_only_active_plans_are_paid_right_now(self, client, auth):
        for status in ("active", "trial", "paused", "cancelled"):
            add_subscription(client, auth, name=f"S-{status}", cost="10.00", status=status)
        assert monthly_total(client, auth) == 10.0

    def test_a_pause_stops_the_spend_without_erasing_it(self, client, auth):
        """The regression this is really about. A paused plan that reported
        having never cost anything would rewrite a year of history every time
        someone hit pause."""
        add_subscription(
            client,
            auth,
            cost="10.00",
            started_date=f"{LAST_YEAR}-01-05",
            next_renewal_date=f"{LAST_YEAR}-01-05",
            status="paused",
            paused_date=f"{LAST_YEAR}-06-20",
        )
        summary = spend(client, auth, LAST_YEAR)
        assert [m["total"] for m in summary["months"]] == [10.0] * 6 + [0.0] * 6
        assert summary["total"] == 60.0

    def test_a_paused_yearly_plan_keeps_the_year_it_had_already_paid_for(self, client, auth):
        """The year was already paid for; pausing in March does not refund it,
        exactly as cancelling in March does not. The whole charge sits in
        March, the month it was actually taken."""
        add_subscription(
            client,
            auth,
            cost="120.00",
            billing_cycle="yearly",
            started_date=f"{LAST_YEAR}-03-01",
            next_renewal_date=f"{LAST_YEAR}-03-01",
            status="paused",
            paused_date=f"{LAST_YEAR}-03-02",
        )
        summary = spend(client, auth, LAST_YEAR)
        assert summary["total"] == 120.0
        assert [m["total"] for m in summary["months"]] == [0.0, 0.0, 120.0] + [0.0] * 9

    def test_a_trial_counts_for_nothing_in_any_month(self, client, auth):
        """Free until it converts, and converting is what moves it off the
        trial status -- so while it carries that status, no month it spans
        cost anything."""
        add_subscription(
            client,
            auth,
            cost="10.00",
            started_date=f"{LAST_YEAR}-01-05",
            next_renewal_date=f"{LAST_YEAR}-01-05",
            status="trial",
        )
        assert spend(client, auth, LAST_YEAR)["total"] == 0.0

    def test_a_stopped_plan_with_no_stop_date_counts_for_nothing(self, client, auth):
        """The state a version 1 backup restores into, and the state a
        downgrade leaves behind: stopped, date unknown. Inventing spend for it
        would be worse than counting none."""
        response = client.post(
            "/import",
            json={
                "version": 1,
                "categories": [],
                "subscriptions": [
                    {
                        "name": "Unknown",
                        "cost": 10.0,
                        "billing_cycle": "monthly",
                        "next_renewal_date": f"{LAST_YEAR}-01-05",
                        "started_date": f"{LAST_YEAR}-01-05",
                        "active": False,
                        "cancelled_date": None,
                    }
                ],
            },
            headers=auth,
        )
        assert response.status_code == 200, response.text
        assert spend(client, auth, LAST_YEAR)["total"] == 0.0


class TestTrialsInUpcoming:
    def test_a_trial_is_listed_once_at_no_cost_on_its_conversion_date(self, client, auth):
        """Once, because a trial converts one time; at zero, because nothing
        leaves the account that day and `total` is real money due."""
        conversion = TODAY + timedelta(days=10)
        add_subscription(
            client, auth, cost="9.99", status="trial", next_renewal_date=str(conversion)
        )
        summary = client.get(
            "/subscriptions/upcoming", params={"days": 365}, headers=auth
        ).json()

        assert len(summary["renewals"]) == 1
        entry = summary["renewals"][0]
        assert entry["renewal_date"] == str(conversion)
        assert entry["cost"] == 0.0
        assert summary["total"] == 0.0
        # The real price still travels, so a client can say "then EUR 9.99/mo".
        assert float(entry["subscription"]["cost"]) == 9.99

    def test_a_trial_converting_after_the_window_is_not_listed(self, client, auth):
        add_subscription(
            client, auth, status="trial", next_renewal_date=str(TODAY + timedelta(days=90))
        )
        assert client.get(
            "/subscriptions/upcoming", params={"days": 30}, headers=auth
        ).json()["renewals"] == []

    def test_paused_plans_are_not_upcoming(self, client, auth):
        add_subscription(
            client, auth, status="paused", next_renewal_date=str(TODAY + timedelta(days=5))
        )
        assert client.get(
            "/subscriptions/upcoming", params={"days": 365}, headers=auth
        ).json()["renewals"] == []


class TestTrialRenewalDates:
    def test_a_trials_conversion_date_is_not_rolled_forward(self, client, auth):
        """A trial converts once. Rolling a conversion that has come and gone
        into next month would report a second one that never happens."""
        created = add_subscription(
            client,
            auth,
            status="trial",
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-02-01",
        )
        assert get(client, auth, created["id"])["next_renewal_date"] == f"{LAST_YEAR}-02-01"

    def test_an_active_plans_date_still_rolls(self, client, auth):
        created = add_subscription(
            client,
            auth,
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-02-01",
        )
        assert get(client, auth, created["id"])["next_renewal_date"] >= str(TODAY)


class TestStoppedRenewalDates:
    """What `next_renewal_date` means once a plan has stopped.

    Every plan here bills upfront, so a cancellation is never followed by
    another charge. The date a stopped row reports is therefore not a charge
    still to come but the day the term already paid for runs out -- and the
    frontend labels it "access ends" on that understanding.
    """

    def test_a_cancelled_plan_reports_the_end_of_the_term_it_paid_for(self, client, auth):
        created = add_subscription(
            client,
            auth,
            started_date=f"{LAST_YEAR}-01-10",
            next_renewal_date=f"{LAST_YEAR}-01-10",
        )
        put(client, auth, created["id"], status="cancelled", cancelled_date=f"{LAST_YEAR}-06-20")
        # Paid on the 10th of June, so June the 10th bought cover to July the
        # 10th and nothing is charged after that.
        assert get(client, auth, created["id"])["next_renewal_date"] == f"{LAST_YEAR}-07-10"

    def test_cancelling_on_a_renewal_day_still_gets_the_period_just_paid_for(self, client, auth):
        """The regression this class is really about. Cancelling the moment
        the money leaves the account used to report the term as running out
        that same morning, because the day it stopped is itself a renewal day
        -- but that day's charge was taken (the spend summary counts it) and
        it bought another whole month."""
        created = add_subscription(
            client,
            auth,
            started_date=f"{LAST_YEAR}-01-10",
            next_renewal_date=f"{LAST_YEAR}-01-10",
        )
        put(client, auth, created["id"], status="cancelled", cancelled_date=f"{LAST_YEAR}-06-10")
        assert get(client, auth, created["id"])["next_renewal_date"] == f"{LAST_YEAR}-07-10"

    def test_a_cancelled_yearly_plan_keeps_the_rest_of_the_year(self, client, auth):
        created = add_subscription(
            client,
            auth,
            billing_cycle="yearly",
            started_date=f"{LAST_YEAR}-03-01",
            next_renewal_date=f"{LAST_YEAR}-03-01",
        )
        put(client, auth, created["id"], status="cancelled", cancelled_date=f"{LAST_YEAR}-03-02")
        assert get(client, auth, created["id"])["next_renewal_date"] == f"{LAST_YEAR + 1}-03-01"

    def test_a_backdated_cancellation_before_a_future_anchor_is_not_ignored(self, client, auth):
        """Regression: cancelled_date is editable after the fact (see
        test_an_explicit_date_still_wins above), so a stop date can land
        before the stored anchor -- e.g. the anchor was left at today when
        the plan was added, and the cancellation is then backdated to months
        earlier. The
        old code used next_occurrence, whose "an anchor in the future is
        itself the next occurrence" rule handed that anchor back untouched,
        reporting access as running until a date that had nothing to do with
        the actual cancellation."""
        created = add_subscription(
            client,
            auth,
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=str(TODAY),
        )
        put(client, auth, created["id"], status="cancelled", cancelled_date=f"{LAST_YEAR}-03-03")
        assert get(client, auth, created["id"])["next_renewal_date"] == f"{LAST_YEAR}-04-03"

    def test_a_paused_plan_reports_when_it_would_charge_again(self, client, auth):
        created = add_subscription(
            client,
            auth,
            started_date=f"{LAST_YEAR}-01-10",
            next_renewal_date=f"{LAST_YEAR}-01-10",
        )
        put(client, auth, created["id"], status="paused", paused_date=f"{LAST_YEAR}-06-20")
        assert get(client, auth, created["id"])["next_renewal_date"] == f"{LAST_YEAR}-07-10"


class TestFiltering:
    def setup_account(self, client, auth):
        for status in ("active", "trial", "paused", "cancelled"):
            add_subscription(client, auth, name=f"S-{status}", status=status)

    def names(self, client, auth, **params) -> set:
        response = client.get("/subscriptions", params=params, headers=auth)
        assert response.status_code == 200, response.text
        return {s["name"] for s in response.json()}

    def test_status_selects_exactly_one_kind(self, client, auth):
        self.setup_account(client, auth)
        assert self.names(client, auth, status="paused") == {"S-paused"}
        assert self.names(client, auth, status="cancelled") == {"S-cancelled"}

    def test_active_true_still_means_what_it_always_meant(self, client, auth):
        self.setup_account(client, auth)
        assert self.names(client, auth, active="true") == {"S-active"}

    def test_active_false_means_every_status_that_does_not_bill(self, client, auth):
        self.setup_account(client, auth)
        assert self.names(client, auth, active="false") == {"S-trial", "S-paused", "S-cancelled"}

    def test_an_unknown_status_is_rejected_rather_than_matching_nothing(self, client, auth):
        assert client.get("/subscriptions", params={"status": "lapsed"}, headers=auth).status_code == 422

    def test_spend_can_be_narrowed_to_one_status(self, client, auth):
        add_subscription(
            client,
            auth,
            name="Kept",
            cost="10.00",
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-01-01",
        )
        add_subscription(
            client,
            auth,
            name="Dropped",
            cost="5.00",
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-01-01",
            status="cancelled",
            cancelled_date=f"{LAST_YEAR}-12-31",
        )
        assert spend(client, auth, LAST_YEAR, status="cancelled")["total"] == 60.0


class TestBackups:
    def test_a_version_1_file_restores_with_statuses_derived_from_active(self, client, auth):
        """Every backup taken before statuses existed says `active` and has
        never heard of `status`. Refusing those would make the version field a
        way to strand data rather than a way to migrate it."""
        response = client.post(
            "/import",
            json={
                "version": 1,
                "categories": [],
                "subscriptions": [
                    {
                        "name": "Running",
                        "cost": 10.0,
                        "billing_cycle": "monthly",
                        "next_renewal_date": str(TODAY),
                        "active": True,
                    },
                    {
                        "name": "Stopped",
                        "cost": 10.0,
                        "billing_cycle": "monthly",
                        "next_renewal_date": str(TODAY),
                        "active": False,
                        "cancelled_date": str(TODAY),
                    },
                ],
            },
            headers=auth,
        )
        assert response.status_code == 200, response.text
        statuses = {
            s["name"]: s["status"]
            for s in client.get("/subscriptions", headers=auth).json()
        }
        assert statuses == {"Running": "active", "Stopped": "cancelled"}

    def test_a_round_trip_preserves_trial_and_paused(self, client, auth, other_auth):
        """The reason export had to learn about statuses at all: through a
        version 1 file both of these come back as cancelled."""
        add_subscription(client, auth, name="Trial", status="trial")
        add_subscription(client, auth, name="Paused", status="paused")

        exported = client.get("/export", headers=auth).json()
        assert exported["version"] == schemas.BACKUP_VERSION

        assert client.post("/import", json=exported, headers=other_auth).status_code == 200
        statuses = {
            s["name"]: s["status"]
            for s in client.get("/subscriptions", headers=other_auth).json()
        }
        assert statuses == {"Trial": "trial", "Paused": "paused"}

    def test_a_pause_date_survives_the_round_trip(self, client, auth, other_auth):
        add_subscription(
            client,
            auth,
            name="Paused",
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-01-01",
            status="paused",
            paused_date=f"{LAST_YEAR}-06-10",
        )
        exported = client.get("/export", headers=auth).json()
        client.post("/import", json=exported, headers=other_auth)
        restored = client.get("/subscriptions", headers=other_auth).json()[0]
        assert restored["paused_date"] == f"{LAST_YEAR}-06-10"

    def test_a_version_this_build_cannot_read_is_still_refused(self, client, auth):
        response = client.post(
            "/import", json={"version": 99, "categories": [], "subscriptions": []}, headers=auth
        )
        assert response.status_code == 400
        assert "99" in response.json()["detail"]
