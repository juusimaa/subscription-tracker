# "One subscription, several runs" (TODO.md item 8): restoring a cancelled
# subscription starts a new, linked row rather than editing the old one in
# place, so the old run's history -- what it cost, when it stopped -- stays
# correct in the spend summary.

from datetime import date, timedelta

from conftest import add_subscription

TODAY = date.today()
LAST_YEAR = TODAY.year - 1


def get(client, auth, subscription_id: int) -> dict:
    response = client.get(f"/subscriptions/{subscription_id}", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


def cancel(client, auth, subscription_id: int) -> dict:
    response = client.put(
        f"/subscriptions/{subscription_id}", json={"status": "cancelled"}, headers=auth
    )
    assert response.status_code == 200, response.text
    return response.json()


def restore(client, auth, subscription_id: int, **body):
    return client.post(f"/subscriptions/{subscription_id}/restore", json=body or None, headers=auth)


class TestRestoreRoute:
    def test_restoring_a_running_row_is_refused(self, client, auth):
        created = add_subscription(client, auth)
        assert restore(client, auth, created["id"]).status_code == 409

    def test_restoring_an_unknown_row_is_404(self, client, auth):
        assert restore(client, auth, 999999).status_code == 404

    def test_restore_creates_a_new_active_row_copying_the_service(self, client, auth):
        created = add_subscription(
            client, auth, name="Netflix", cost="15.99", billing_cycle="yearly", category="Streaming"
        )
        cancelled = cancel(client, auth, created["id"])

        response = restore(client, auth, created["id"])
        assert response.status_code == 201, response.text
        new_row = response.json()
        assert new_row["id"] != created["id"]
        assert new_row["name"] == "Netflix"
        assert new_row["cost"] == created["cost"]
        assert new_row["billing_cycle"] == "yearly"
        assert new_row["category"] == "Streaming"
        assert new_row["status"] == "active"
        first_charge = max(TODAY, date.fromisoformat(cancelled["next_renewal_date"]))
        assert new_row["started_date"] == str(first_charge)
        assert new_row["next_renewal_date"] == str(first_charge)
        assert client.get("/subscriptions/summary/monthly-total", headers=auth).json()[
            "monthly_total"
        ] == 0.0

        # A user can change their mind before the new run begins. It never
        # charged, so cancelling it must leave its stop date empty.
        cancelled_new = cancel(client, auth, new_row["id"])
        assert cancelled_new["cancelled_date"] is None
        assert get(client, auth, created["id"])["cost"] == created["cost"]
        rescheduled = restore(client, auth, new_row["id"])
        assert rescheduled.status_code == 201, rescheduled.text
        assert rescheduled.json()["started_date"] == str(first_charge)

    def test_changed_terms_preserve_the_old_paid_run(self, client, auth):
        old = add_subscription(
            client,
            auth,
            name="Service",
            cost="150.00",
            billing_cycle="yearly",
            started_date=f"{LAST_YEAR}-01-01",
            next_renewal_date=f"{LAST_YEAR}-01-01",
        )
        response = client.put(
            f"/subscriptions/{old['id']}",
            json={"status": "cancelled", "cancelled_date": f"{LAST_YEAR}-12-01"},
            headers=auth,
        )
        assert response.status_code == 200, response.text
        prior_spend = client.get(
            "/subscriptions/summary/spend", params={"year": LAST_YEAR}, headers=auth
        ).json()

        new = restore(
            client,
            auth,
            old["id"],
            cost="15.00",
            billing_cycle="monthly",
            started_date=f"{LAST_YEAR + 1}-01-01",
            next_renewal_date=f"{LAST_YEAR + 1}-01-01",
        )
        assert new.status_code == 201, new.text
        new = new.json()
        assert new["cost"] == "15.00"
        assert new["billing_cycle"] == "monthly"
        assert new["group_id"] == get(client, auth, old["id"])["group_id"]
        old_after = get(client, auth, old["id"])
        assert old_after["status"] == "cancelled"
        assert old_after["cost"] == "150.00"
        assert old_after["billing_cycle"] == "yearly"
        assert client.get(
            "/subscriptions/summary/spend", params={"year": LAST_YEAR}, headers=auth
        ).json() == prior_spend
        new_spend = client.get(
            "/subscriptions/summary/spend", params={"year": LAST_YEAR + 1}, headers=auth
        ).json()
        assert [month["total"] for month in new_spend["months"]] == [15.0] * 12

    def test_default_first_charge_uses_the_actual_paid_term(self, client, auth):
        """An old renewal anchor can differ from the first charge date."""
        old = add_subscription(
            client,
            auth,
            cost="150.00",
            billing_cycle="yearly",
            started_date=f"{TODAY.year}-01-01",
            next_renewal_date=f"{TODAY.year}-03-15",
        )
        cancelled = cancel(client, auth, old["id"])
        next_charge = f"{TODAY.year + 1}-01-01"
        assert cancelled["next_renewal_date"] == next_charge

        new = restore(client, auth, old["id"], cost="15.00", billing_cycle="monthly")
        assert new.status_code == 201, new.text
        assert new.json()["started_date"] == next_charge
        assert new.json()["next_renewal_date"] == next_charge
        old_spend = client.get(
            "/subscriptions/summary/spend", params={"year": TODAY.year}, headers=auth
        ).json()
        assert old_spend["total"] == 150.0

    def test_invalid_new_terms_leave_the_old_run_alone(self, client, auth):
        old = add_subscription(client, auth)
        cancelled = cancel(client, auth, old["id"])
        for body in ({"cost": "0"}, {"cost": "0.001"}, {"billing_cycle": "weekly"}):
            response = restore(client, auth, old["id"], **body)
            assert response.status_code == 422, response.text
        assert get(client, auth, old["id"]) == cancelled
        assert len(client.get("/subscriptions", headers=auth).json()) == 1

    def test_the_old_row_is_left_exactly_as_it_was(self, client, auth):
        created = add_subscription(client, auth)
        cancelled = cancel(client, auth, created["id"])

        restore(client, auth, created["id"])

        unchanged = get(client, auth, created["id"])
        assert unchanged["status"] == "cancelled"
        assert unchanged["cancelled_date"] == cancelled["cancelled_date"]
        assert unchanged["started_date"] == cancelled["started_date"]

    def test_an_old_run_cannot_create_a_second_current_run(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        first = restore(client, auth, created["id"])
        assert first.status_code == 201, first.text

        duplicate = restore(client, auth, created["id"], cost="25.00")
        assert duplicate.status_code == 409, duplicate.text
        rows = client.get("/subscriptions", headers=auth).json()
        assert len(rows) == 2
        assert next(row for row in rows if row["id"] == created["id"])["status"] == "cancelled"

    def test_first_restore_creates_a_group_linking_both_rows(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])

        new_row = restore(client, auth, created["id"]).json()
        old_row = get(client, auth, created["id"])

        assert old_row["group_id"] is not None
        assert new_row["group_id"] == old_row["group_id"]

    def test_a_second_restore_reuses_the_same_group(self, client, auth):
        """Netflix, cancelled, restored, cancelled again, restored again: all
        three rows are one group, not two separate pairs."""
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        first_new = restore(
            client, auth, created["id"], started_date=str(TODAY), next_renewal_date=str(TODAY)
        ).json()
        group_id = get(client, auth, created["id"])["group_id"]

        cancel(client, auth, first_new["id"])
        second_new = restore(client, auth, first_new["id"]).json()

        assert second_new["group_id"] == group_id
        assert get(client, auth, first_new["id"])["group_id"] == group_id

    def test_a_row_never_restored_has_no_group(self, client, auth):
        created = add_subscription(client, auth)
        assert created["group_id"] is None

    def test_explicit_dates_override_todays_default(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        future = str(TODAY + timedelta(days=7))

        response = restore(
            client, auth, created["id"], started_date=future, next_renewal_date=future
        )
        assert response.status_code == 201, response.text
        assert response.json()["started_date"] == future
        assert response.json()["next_renewal_date"] == future
