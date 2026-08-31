# Per-user isolation: the filter every function in crud.py carries, and the
# entire multi-user security boundary. Without it, a logged-in user reaches
# anyone else's rows by guessing an integer.
#
# The status code is part of what is being asserted. 404, not 403: replying
# "forbidden" would confirm that the id exists and belongs to someone, which
# is a fact a stranger has no business learning.

from conftest import add_subscription


class TestSubscriptionsAreNotReachableAcrossAccounts:
    def test_cannot_read_another_users_subscription(self, client, auth, other_auth):
        theirs = add_subscription(client, other_auth, name="Their Netflix")
        assert client.get(f"/subscriptions/{theirs['id']}", headers=auth).status_code == 404

    def test_cannot_edit_another_users_subscription(self, client, auth, other_auth):
        theirs = add_subscription(client, other_auth, name="Their Netflix", cost="15.99")
        response = client.put(
            f"/subscriptions/{theirs['id']}", json={"cost": "1.00"}, headers=auth
        )
        assert response.status_code == 404
        # The row is not just unreported, it is untouched.
        still_theirs = client.get(f"/subscriptions/{theirs['id']}", headers=other_auth).json()
        assert still_theirs["cost"] == theirs["cost"]

    def test_cannot_delete_another_users_subscription(self, client, auth, other_auth):
        theirs = add_subscription(client, other_auth, name="Their Netflix")
        assert client.delete(f"/subscriptions/{theirs['id']}", headers=auth).status_code == 404
        assert client.get(f"/subscriptions/{theirs['id']}", headers=other_auth).status_code == 200

    def test_listing_shows_only_your_own(self, client, auth, other_auth):
        add_subscription(client, auth, name="Mine")
        add_subscription(client, other_auth, name="Theirs")
        assert [s["name"] for s in client.get("/subscriptions", headers=auth).json()] == ["Mine"]
        assert [s["name"] for s in client.get("/subscriptions", headers=other_auth).json()] == [
            "Theirs"
        ]


class TestTheOtherRoutesAreScopedToo:
    """Isolation is not one check in one place -- every route that reads or
    writes has to carry it, so each is asked separately."""

    def test_summaries_only_count_your_own(self, client, auth, other_auth):
        add_subscription(client, other_auth, name="Theirs", cost="100.00")
        totals = client.get("/subscriptions/summary/monthly-total", headers=auth).json()
        assert totals == {"monthly_total": 0.0, "yearly_total": 0.0}

    def test_upcoming_only_lists_your_own(self, client, auth, other_auth):
        add_subscription(client, other_auth, name="Theirs")
        assert client.get("/subscriptions/upcoming", headers=auth).json()["renewals"] == []

    def test_export_only_contains_your_own(self, client, auth, other_auth):
        add_subscription(client, other_auth, name="Theirs", category="Movies")
        export = client.get("/export", headers=auth).json()
        assert export["subscriptions"] == [] and export["categories"] == []

    def test_cannot_rename_or_delete_another_users_category(self, client, auth, other_auth):
        created = client.post("/categories", json={"name": "Music"}, headers=other_auth)
        theirs = created.json()
        assert (
            client.put(
                f"/categories/{theirs['id']}", json={"name": "Renamed"}, headers=auth
            ).status_code
            == 404
        )
        assert client.delete(f"/categories/{theirs['id']}", headers=auth).status_code == 404
        assert [c["name"] for c in client.get("/categories", headers=other_auth).json()] == [
            "Music"
        ]

    def test_a_category_name_is_not_shared_between_accounts(self, client, auth, other_auth):
        """Two users may both have a "Music" category. The unique constraint
        is on (user_id, name), so the second one is a 201, not a 409."""
        assert (
            client.post("/categories", json={"name": "Music"}, headers=auth).status_code == 201
        )
        assert (
            client.post("/categories", json={"name": "Music"}, headers=other_auth).status_code
            == 201
        )


class TestAuthenticationIsRequired:
    def test_no_token_is_401(self, client):
        assert client.get("/subscriptions").status_code == 401

    def test_a_junk_token_is_401(self, client):
        assert (
            client.get(
                "/subscriptions", headers={"Authorization": "Bearer not-a-real-token"}
            ).status_code
            == 401
        )

    def test_health_needs_no_token(self, client):
        # Docker's healthcheck has no token to present.
        assert client.get("/health").json() == {"status": "ok"}
