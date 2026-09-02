# "One subscription, several runs" (TODO.md item 8): restoring a cancelled
# subscription starts a new, linked row rather than editing the old one in
# place, so the old run's history -- what it cost, when it stopped -- stays
# correct in the spend summary.

from datetime import date, timedelta

from conftest import add_subscription

TODAY = date.today()


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
        cancel(client, auth, created["id"])

        response = restore(client, auth, created["id"])
        assert response.status_code == 201, response.text
        new_row = response.json()
        assert new_row["id"] != created["id"]
        assert new_row["name"] == "Netflix"
        assert new_row["cost"] == created["cost"]
        assert new_row["billing_cycle"] == "yearly"
        assert new_row["category"] == "Streaming"
        assert new_row["status"] == "active"
        assert new_row["started_date"] == str(TODAY)
        assert new_row["next_renewal_date"] == str(TODAY)

    def test_the_old_row_is_left_exactly_as_it_was(self, client, auth):
        created = add_subscription(client, auth)
        cancelled = cancel(client, auth, created["id"])

        restore(client, auth, created["id"])

        unchanged = get(client, auth, created["id"])
        assert unchanged["status"] == "cancelled"
        assert unchanged["cancelled_date"] == cancelled["cancelled_date"]
        assert unchanged["started_date"] == cancelled["started_date"]

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
        first_new = restore(client, auth, created["id"]).json()
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
