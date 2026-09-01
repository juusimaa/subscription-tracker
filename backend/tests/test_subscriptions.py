# Subscriptions through the API: the derived renewal date, the validation
# rules, and the cancellation bookkeeping.
#
# The validation tests are the ones TODO.md singles out -- the invalid-update
# bug reached the database because nothing here existed to stop it, and it
# turned one bad row into a 500 for every route that listed the account.

from datetime import date, timedelta

from conftest import add_subscription, money


class TestTheRenewalDateIsDerived:
    def test_a_stale_anchor_reports_a_date_in_the_future(self, client, auth):
        created = add_subscription(
            client, auth, next_renewal_date="2020-01-15", started_date="2020-01-15"
        )
        renewal = date.fromisoformat(created["next_renewal_date"])
        assert renewal >= date.today(), "a renewal date must never be in the past"
        assert renewal.day == 15, "the anchor's day of the month survives"

    def test_a_future_anchor_is_returned_unchanged(self, client, auth):
        next_month = date.today() + timedelta(days=30)
        created = add_subscription(client, auth, next_renewal_date=str(next_month))
        assert created["next_renewal_date"] == str(next_month)

    def test_the_derived_date_is_stable_across_reads(self, client, auth):
        created = add_subscription(client, auth, next_renewal_date="2020-01-15")
        fetched = client.get(f"/subscriptions/{created['id']}", headers=auth).json()
        listed = client.get("/subscriptions", headers=auth).json()[0]
        assert created["next_renewal_date"] == fetched["next_renewal_date"]
        assert created["next_renewal_date"] == listed["next_renewal_date"]

    def test_a_yearly_plan_derives_on_the_yearly_cycle(self, client, auth):
        created = add_subscription(
            client,
            auth,
            billing_cycle="yearly",
            next_renewal_date="2022-03-15",
            started_date="2022-03-15",
        )
        renewal = date.fromisoformat(created["next_renewal_date"])
        assert renewal >= date.today() and (renewal.month, renewal.day) == (3, 15)

    def test_listing_is_ordered_by_the_derived_date(self, client, auth):
        """Not by the stored anchor: a 2019 anchor and a 2026 one can both
        renew next week, so ordering by what is stored is not ordering by
        what is shown."""
        today = date.today()
        add_subscription(client, auth, name="Later", next_renewal_date=str(today + timedelta(days=20)))
        add_subscription(client, auth, name="Sooner", next_renewal_date=str(today + timedelta(days=2)))
        add_subscription(client, auth, name="Stale", next_renewal_date="2019-06-01")
        dates = [s["next_renewal_date"] for s in client.get("/subscriptions", headers=auth).json()]
        assert dates == sorted(dates)

    def test_a_cancelled_plan_reports_the_end_of_its_paid_term(self, client, auth):
        """Measured from the cancellation, not from today, so it does not roll
        forward through renewals that will never happen."""
        created = add_subscription(
            client,
            auth,
            billing_cycle="yearly",
            next_renewal_date="2022-03-15",
            started_date="2022-03-15",
            active=False,
            cancelled_date="2023-06-01",
        )
        assert created["next_renewal_date"] == "2024-03-15"


class TestUpdates:
    def test_sending_a_renewal_date_sets_the_new_anchor(self, client, auth):
        created = add_subscription(client, auth, next_renewal_date="2020-01-15")
        in_three_days = date.today() + timedelta(days=3)
        response = client.put(
            f"/subscriptions/{created['id']}",
            json={"next_renewal_date": str(in_three_days)},
            headers=auth,
        )
        assert response.status_code == 200, response.text
        assert response.json()["next_renewal_date"] == str(in_three_days)

    def test_a_partial_update_leaves_the_other_fields_alone(self, client, auth):
        created = add_subscription(client, auth, next_renewal_date="2020-01-15", category="Movies")
        updated = client.put(
            f"/subscriptions/{created['id']}", json={"cost": "20.00"}, headers=auth
        ).json()
        assert updated["next_renewal_date"] == created["next_renewal_date"]
        assert updated["category"] == "Movies"
        assert money(updated["cost"]) == money("20.00")

    def test_updating_a_missing_subscription_is_404(self, client, auth):
        assert client.put("/subscriptions/999999", json={"cost": "1.00"}, headers=auth).status_code == 404


class TestCancellation:
    def test_cancelling_stamps_todays_date(self, client, auth):
        created = add_subscription(client, auth)
        cancelled = client.put(
            f"/subscriptions/{created['id']}", json={"active": False}, headers=auth
        ).json()
        assert cancelled["active"] is False
        assert cancelled["cancelled_date"] == str(date.today())

    def test_an_explicit_date_is_kept_so_a_cancellation_can_be_backdated(self, client, auth):
        created = add_subscription(client, auth, started_date="2020-01-01")
        cancelled = client.put(
            f"/subscriptions/{created['id']}",
            json={"active": False, "cancelled_date": "2024-05-05"},
            headers=auth,
        ).json()
        assert cancelled["cancelled_date"] == "2024-05-05"

    def test_reactivating_clears_the_date(self, client, auth):
        created = add_subscription(client, auth)
        client.put(f"/subscriptions/{created['id']}", json={"active": False}, headers=auth)
        revived = client.put(
            f"/subscriptions/{created['id']}", json={"active": True}, headers=auth
        ).json()
        assert revived["cancelled_date"] is None

    def test_a_cancelled_date_on_a_running_subscription_is_cleared(self, client, auth):
        """`active` is what says whether a subscription is running; a date sent
        without it is not a cancellation. Left set, it would zero out the
        subscription's future months in the spend summary."""
        created = add_subscription(client, auth, started_date="2020-01-01")
        updated = client.put(
            f"/subscriptions/{created['id']}", json={"cancelled_date": "2024-05-05"}, headers=auth
        ).json()
        assert updated["active"] is True and updated["cancelled_date"] is None


class TestValidation:
    """The rules recorded as fixed in TODO.md. Each one reached the database
    once already."""

    def test_a_negative_cost_is_rejected(self, client, auth):
        # It was subtracted from every total: one typo made a whole month's
        # spend read as less than it was.
        response = client.post(
            "/subscriptions",
            json={"name": "X", "cost": "-88.99", "next_renewal_date": str(date.today())},
            headers=auth,
        )
        assert response.status_code == 422

    def test_a_zero_cost_is_rejected(self, client, auth):
        response = client.post(
            "/subscriptions",
            json={"name": "X", "cost": "0", "next_renewal_date": str(date.today())},
            headers=auth,
        )
        assert response.status_code == 422

    def test_a_cost_too_large_for_the_column_is_a_422_not_a_500(self, client, auth):
        # Numeric(10, 2) rejects this in Postgres; catching it in the schema
        # turns a psycopg error raised on commit into a plain 422.
        response = client.post(
            "/subscriptions",
            json={
                "name": "X",
                "cost": "100000000.00",
                "next_renewal_date": str(date.today()),
            },
            headers=auth,
        )
        assert response.status_code == 422

    def test_a_blank_name_is_rejected(self, client, auth):
        for name in ("", "   "):
            response = client.post(
                "/subscriptions",
                json={"name": name, "cost": "1.00", "next_renewal_date": str(date.today())},
                headers=auth,
            )
            assert response.status_code == 422, f"{name!r} should not be a name"

    def test_a_name_is_stripped(self, client, auth):
        assert add_subscription(client, auth, name="  Netflix  ")["name"] == "Netflix"

    def test_the_same_rules_apply_to_updates(self, client, auth):
        """A rule enforced only on create is a rule a client walks around by
        editing."""
        created = add_subscription(client, auth)
        for payload in ({"cost": "-1.00"}, {"name": "  "}, {"cost": "100000000.00"}):
            response = client.put(
                f"/subscriptions/{created['id']}", json=payload, headers=auth
            )
            assert response.status_code == 422, payload


class TestTheDateInvariant:
    """cancelled_date cannot precede started_date -- a subscription cancelled
    before it started totals to zero in every month, which reads as a bug
    rather than as the typo it usually is."""

    def test_rejected_when_a_create_spells_out_both_dates(self, client, auth):
        response = client.post(
            "/subscriptions",
            json={
                "name": "X",
                "cost": "1.00",
                "next_renewal_date": str(date.today()),
                "started_date": "2025-01-01",
                "cancelled_date": "2024-01-01",
            },
            headers=auth,
        )
        assert response.status_code == 422

    def test_rejected_when_the_default_start_date_produces_it(self, client, auth):
        """No started_date, so it defaults to today -- which turns a
        backdated cancellation into exactly the row the schema meant to
        reject. Only the check after the defaults are applied sees it."""
        response = client.post(
            "/subscriptions",
            json={
                "name": "X",
                "cost": "1.00",
                "next_renewal_date": str(date.today()),
                "active": False,
                "cancelled_date": "2020-01-01",
            },
            headers=auth,
        )
        assert response.status_code == 422

    def test_a_partial_update_is_checked_against_the_stored_row(self, client, auth):
        """The bug this suite exists for. The schema can only compare fields
        one request happened to carry, so this was checked against nothing and
        committed."""
        created = add_subscription(client, auth, started_date="2025-06-01")
        response = client.put(
            f"/subscriptions/{created['id']}",
            json={"active": False, "cancelled_date": "2024-01-01"},
            headers=auth,
        )
        assert response.status_code == 422

    def test_a_rejected_update_changes_nothing(self, client, auth):
        """The rollback matters as much as the check: without it the invalid
        values sit on a live ORM object and any later flush writes them."""
        created = add_subscription(client, auth, started_date="2025-06-01")
        client.put(
            f"/subscriptions/{created['id']}",
            json={"active": False, "cancelled_date": "2024-01-01"},
            headers=auth,
        )
        unchanged = client.get(f"/subscriptions/{created['id']}", headers=auth).json()
        assert unchanged["active"] is True
        assert unchanged["cancelled_date"] is None
        assert unchanged["started_date"] == "2025-06-01"

    def test_the_account_stays_readable_after_a_rejected_update(self, client, auth):
        """The reason the invariant is not on the response model. A stored row
        that fails validation on the way out turns one bad field into a 500
        for every route that lists the account -- with no way back through the
        API."""
        created = add_subscription(client, auth, started_date="2025-06-01")
        client.put(
            f"/subscriptions/{created['id']}",
            json={"active": False, "cancelled_date": "2024-01-01"},
            headers=auth,
        )
        assert client.get("/subscriptions", headers=auth).status_code == 200
        assert client.get("/export", headers=auth).status_code == 200


class TestEditingTheStartDate:
    """PUT /subscriptions/{id} with started_date -- the contract behind the
    dashboard's editable start date. Backdating is the whole point of it: a
    plan added today but running since last year contributes nothing to the
    months before today until its start moves back.
    """

    def test_the_start_date_can_be_moved_back(self, client, auth):
        created = add_subscription(client, auth)
        assert created["started_date"] == str(date.today()), "the create default"
        updated = client.put(
            f"/subscriptions/{created['id']}",
            json={"started_date": "2022-03-15"},
            headers=auth,
        ).json()
        assert updated["started_date"] == "2022-03-15"

    def test_clearing_it_records_an_unknown_start(self, client, auth):
        """An explicit null is not "not sent": it is the honest state for a row
        whose start nobody knows, which the spend summary reads as "running in
        every month asked about" rather than inventing a date."""
        created = add_subscription(client, auth, started_date="2022-03-15")
        updated = client.put(
            f"/subscriptions/{created['id']}", json={"started_date": None}, headers=auth
        ).json()
        assert updated["started_date"] is None

    def test_an_edit_that_does_not_mention_it_leaves_it_alone(self, client, auth):
        created = add_subscription(client, auth, started_date="2022-03-15")
        updated = client.put(
            f"/subscriptions/{created['id']}", json={"cost": "19.99"}, headers=auth
        ).json()
        assert updated["started_date"] == "2022-03-15"

    def test_moving_it_past_a_stored_pause_is_rejected(self, client, auth):
        """The invariant from the other side. Every existing case sends a stop
        date against a stored start; the editable field makes the reverse
        reachable -- a start moved forward past a pause that already happened.
        """
        created = add_subscription(client, auth, started_date="2022-03-15")
        client.put(
            f"/subscriptions/{created['id']}",
            json={"status": "paused", "paused_date": "2023-01-01"},
            headers=auth,
        )
        response = client.put(
            f"/subscriptions/{created['id']}",
            json={"started_date": "2024-01-01"},
            headers=auth,
        )
        assert response.status_code == 422
        stored = client.get(f"/subscriptions/{created['id']}", headers=auth).json()
        assert stored["started_date"] == "2022-03-15", "a rejected edit changes nothing"


class TestDeleting:
    def test_delete_removes_it(self, client, auth):
        created = add_subscription(client, auth)
        assert client.delete(f"/subscriptions/{created['id']}", headers=auth).status_code == 204
        assert client.get(f"/subscriptions/{created['id']}", headers=auth).status_code == 404

    def test_deleting_twice_is_404(self, client, auth):
        created = add_subscription(client, auth)
        client.delete(f"/subscriptions/{created['id']}", headers=auth)
        assert client.delete(f"/subscriptions/{created['id']}", headers=auth).status_code == 404
