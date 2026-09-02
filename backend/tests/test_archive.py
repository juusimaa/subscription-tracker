# Archiving: visibility only, and only ever on a cancelled row (TODO.md
# item 7). The invariant -- archived_date can never be set on a row that
# isn't cancelled -- is the thing worth pinning down from every direction it
# can be approached: the dedicated routes, a direct write, and a status
# change that moves a row off cancelled out from under an archived_date.

from datetime import date

from conftest import add_subscription

TODAY = date.today()


def get(client, auth, subscription_id: int) -> dict:
    response = client.get(f"/subscriptions/{subscription_id}", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


def put(client, auth, subscription_id: int, **body):
    return client.put(f"/subscriptions/{subscription_id}", json=body, headers=auth)


def cancel(client, auth, subscription_id: int) -> dict:
    response = put(client, auth, subscription_id, status="cancelled")
    assert response.status_code == 200, response.text
    return response.json()


def archive(client, auth, subscription_id: int):
    return client.post(f"/subscriptions/{subscription_id}/archive", headers=auth)


def unarchive(client, auth, subscription_id: int):
    return client.post(f"/subscriptions/{subscription_id}/unarchive", headers=auth)


class TestArchiveRoute:
    def test_archiving_a_cancelled_row_stamps_today(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        response = archive(client, auth, created["id"])
        assert response.status_code == 200, response.text
        assert response.json()["archived_date"] == str(TODAY)
        assert response.json()["status"] == "cancelled"

    def test_archiving_a_running_row_is_refused(self, client, auth):
        created = add_subscription(client, auth)
        response = archive(client, auth, created["id"])
        assert response.status_code == 409, response.text
        assert get(client, auth, created["id"])["archived_date"] is None

    def test_archiving_twice_is_refused(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        archive(client, auth, created["id"])
        assert archive(client, auth, created["id"]).status_code == 409

    def test_archiving_an_unknown_row_is_404(self, client, auth):
        assert archive(client, auth, 999999).status_code == 404


class TestUnarchiveRoute:
    def test_unarchiving_clears_the_date_and_stays_cancelled(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        archive(client, auth, created["id"])

        response = unarchive(client, auth, created["id"])
        assert response.status_code == 200, response.text
        assert response.json()["archived_date"] is None
        # "Restore to list" un-archives only -- it does not reactivate.
        assert response.json()["status"] == "cancelled"

    def test_unarchiving_a_row_that_is_not_archived_is_refused(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        assert unarchive(client, auth, created["id"]).status_code == 409


class TestTheInvariantHoldsEverywhere:
    def test_reactivating_an_archived_row_un_archives_it_too(self, client, auth):
        """Reactivate (cancelled -> active) is unrelated to archiving, but an
        active row can never carry an archived_date -- so bringing a plan
        back has to clear it as a side effect, not leave a row the API's own
        rules say cannot exist."""
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        archive(client, auth, created["id"])

        response = put(client, auth, created["id"], status="active")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "active"
        assert response.json()["archived_date"] is None

    def test_an_explicit_archived_date_is_accepted_on_a_cancelled_row(self, client, auth):
        created = add_subscription(client, auth)
        cancel(client, auth, created["id"])
        response = put(client, auth, created["id"], archived_date=str(TODAY))
        assert response.status_code == 200, response.text
        assert response.json()["archived_date"] == str(TODAY)

    def test_an_explicit_archived_date_on_a_running_row_is_rejected(self, client, auth):
        created = add_subscription(client, auth)
        response = put(client, auth, created["id"], archived_date=str(TODAY))
        assert response.status_code == 422, response.text
        assert get(client, auth, created["id"])["archived_date"] is None

    def test_creating_an_archived_but_not_cancelled_row_is_rejected(self, client, auth):
        response = client.post(
            "/subscriptions",
            json={
                "name": "Netflix",
                "cost": "9.99",
                "next_renewal_date": str(TODAY),
                "archived_date": str(TODAY),
            },
            headers=auth,
        )
        assert response.status_code == 422, response.text
