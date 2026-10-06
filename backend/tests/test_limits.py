# How much one account may store (issue #105). Signup is open and the whole
# app shares Neon's 0.5 GB free tier, so every route that adds rows -- and
# the request body itself -- has a ceiling.
#
# The limits are lowered to 3 for these tests. The real numbers (500 and 100)
# would mean hundreds of requests per test to reach them, and what is being
# checked is where the check runs, not the number.

import pytest

from app import crud, main
from conftest import add_subscription

LIMIT = 3


@pytest.fixture(autouse=True)
def small_limits(monkeypatch):
    monkeypatch.setattr(crud, "MAX_SUBSCRIPTIONS", LIMIT)
    monkeypatch.setattr(crud, "MAX_CATEGORIES", LIMIT)


SUBSCRIPTION_LIMIT = f"An account can hold at most {LIMIT} subscriptions"
CATEGORY_LIMIT = f"An account can hold at most {LIMIT} categories"


def names(client, auth, path="/subscriptions") -> list[str]:
    return sorted(row["name"] for row in client.get(path, headers=auth).json())


def fill(client, auth, n=LIMIT):
    for i in range(n):
        add_subscription(client, auth, name=f"Service {i}")


def backup(subscriptions=(), categories=()):
    return {
        "version": 4,
        "exported_at": "2026-10-06T00:00:00Z",
        "categories": list(categories),
        "subscriptions": [
            {"name": name, "cost": "5.00", "billing_cycle": "monthly",
             "next_renewal_date": "2026-11-01", "status": "active"}
            for name in subscriptions
        ],
    }


class TestSubscriptions:
    def test_one_past_the_limit_is_409_and_nothing_is_saved(self, client, auth):
        fill(client, auth)
        response = client.post(
            "/subscriptions",
            json={"name": "One too many", "cost": "1.00", "billing_cycle": "monthly",
                  "next_renewal_date": "2026-11-01"},
            headers=auth,
        )
        assert response.status_code == 409
        assert response.json()["detail"] == SUBSCRIPTION_LIMIT
        assert len(names(client, auth)) == LIMIT

    def test_deleting_one_makes_room_again(self, client, auth):
        fill(client, auth)
        first = client.get("/subscriptions", headers=auth).json()[0]
        client.delete(f"/subscriptions/{first['id']}", headers=auth)
        add_subscription(client, auth, name="Back in")

    def test_another_accounts_rows_do_not_count(self, client, auth, other_auth):
        fill(client, other_auth)
        fill(client, auth)

    def test_a_restore_adds_a_row_so_it_counts(self, client, auth):
        fill(client, auth)
        first = client.get("/subscriptions", headers=auth).json()[0]
        client.put(f"/subscriptions/{first['id']}", json={"status": "cancelled"}, headers=auth)
        response = client.post(f"/subscriptions/{first['id']}/restore", headers=auth)
        assert response.status_code == 409
        assert response.json()["detail"] == SUBSCRIPTION_LIMIT
        assert len(names(client, auth)) == LIMIT


class TestCategories:
    def fill(self, client, auth):
        for i in range(LIMIT):
            assert client.post("/categories", json={"name": f"Cat {i}"}, headers=auth).status_code == 201

    def test_one_past_the_limit_is_409(self, client, auth):
        self.fill(client, auth)
        response = client.post("/categories", json={"name": "One too many"}, headers=auth)
        assert response.status_code == 409
        assert response.json()["detail"] == CATEGORY_LIMIT

    def test_a_subscription_naming_a_new_category_is_refused_whole(self, client, auth):
        # The category would be added alongside the subscription, so neither is.
        self.fill(client, auth)
        response = client.post(
            "/subscriptions",
            json={"name": "Netflix", "cost": "1.00", "billing_cycle": "monthly",
                  "next_renewal_date": "2026-11-01", "category": "Brand new"},
            headers=auth,
        )
        assert response.status_code == 409
        assert response.json()["detail"] == CATEGORY_LIMIT
        assert names(client, auth) == []
        assert len(names(client, auth, "/categories")) == LIMIT

    def test_an_existing_category_is_still_usable_at_the_limit(self, client, auth):
        self.fill(client, auth)
        add_subscription(client, auth, category="cat 0")

    def test_an_edit_to_a_new_category_is_refused(self, client, auth):
        self.fill(client, auth)
        created = add_subscription(client, auth, category="Cat 0")
        response = client.put(
            f"/subscriptions/{created['id']}", json={"category": "Brand new"}, headers=auth
        )
        assert response.status_code == 409
        stored = client.get(f"/subscriptions/{created['id']}", headers=auth).json()
        assert stored["category"] == "Cat 0"


class TestImport:
    def test_a_merge_that_would_go_over_is_refused_whole(self, client, auth):
        add_subscription(client, auth, name="Kept")
        response = client.post(
            "/import", json=backup(["A", "B", "C"], ["New cat"]), headers=auth
        )
        assert response.status_code == 409
        assert response.json()["detail"] == SUBSCRIPTION_LIMIT
        # Nothing from the file was written, categories included.
        assert names(client, auth) == ["Kept"]
        assert names(client, auth, "/categories") == []

    def test_a_merge_counts_matched_rows_once(self, client, auth):
        fill(client, auth)
        response = client.post(
            "/import", json=backup([f"Service {i}" for i in range(LIMIT)]), headers=auth
        )
        assert response.status_code == 200, response.text
        assert response.json()["subscriptions_updated"] == LIMIT

    def test_a_replace_counts_after_the_delete(self, client, auth):
        fill(client, auth)
        response = client.post(
            "/import?mode=replace", json=backup(["A", "B", "C"]), headers=auth
        )
        assert response.status_code == 200, response.text
        assert names(client, auth) == ["A", "B", "C"]

    def test_a_refused_replace_leaves_the_account_as_it_was(self, client, auth):
        fill(client, auth)
        response = client.post(
            "/import?mode=replace", json=backup(["A", "B", "C", "D"]), headers=auth
        )
        assert response.status_code == 409
        assert names(client, auth) == [f"Service {i}" for i in range(LIMIT)]

    def test_too_many_categories_is_refused(self, client, auth):
        response = client.post(
            "/import", json=backup(categories=["A", "B", "C", "D"]), headers=auth
        )
        assert response.status_code == 409
        assert response.json()["detail"] == CATEGORY_LIMIT
        assert names(client, auth, "/categories") == []


class TestBodySize:
    def test_a_declared_length_over_the_limit_is_413(self, client, auth):
        body = b"x" * (main.MAX_BODY_BYTES + 1)
        response = client.post(
            "/import", content=body, headers={**auth, "Content-Type": "application/json"}
        )
        assert response.status_code == 413
        assert response.json()["detail"] == "Request body is larger than 1 MB"

    def test_a_chunked_body_over_the_limit_is_413(self, client, auth):
        # A generator has no length, so httpx sends it chunked with no
        # Content-Length -- the case the header check alone would miss.
        def chunks():
            for _ in range(main.MAX_BODY_BYTES // 65536 + 2):
                yield b"x" * 65536

        response = client.post(
            "/import", content=chunks(), headers={**auth, "Content-Type": "application/json"}
        )
        assert response.status_code == 413

    def test_the_413_carries_cors_headers(self, client, auth):
        # Without them the browser reports a network error instead of the
        # status, and the page cannot say what went wrong.
        origin = main.CORS_ORIGINS[0]
        response = client.post(
            "/import",
            content=b"x" * (main.MAX_BODY_BYTES + 1),
            headers={**auth, "Content-Type": "application/json", "Origin": origin},
        )
        assert response.status_code == 413
        assert response.headers["access-control-allow-origin"] == origin

    def test_a_body_under_the_limit_still_arrives_whole(self, client, auth):
        response = client.post(
            "/import", json=backup(["A"]), headers=auth
        )
        assert response.status_code == 200, response.text
        assert names(client, auth) == ["A"]
