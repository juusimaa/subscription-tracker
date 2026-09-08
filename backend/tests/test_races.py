# TODO.md item 5: register, create_category and ensure_category all ask
# "does this exist?" and then insert. Two concurrent identical requests can
# both pass that check before either commits, and the second one used to trip
# the unique constraint as a raw, unhandled IntegrityError -- a 500 where the
# sequential path already returns a clean 400/409.
#
# TestClient is synchronous, so there is no way to make two real requests
# collide. Instead, each test monkeypatches the lookup the "does this exist?"
# check (and ensure_category's own check) calls, so it lies and says "no" for
# exactly as many calls as a real race would have -- reproducing the same
# unique-constraint collision on commit that concurrent requests would, without
# needing actual threads.

from app import crud


def test_registering_the_same_email_twice_at_once_conflicts_not_500(client, monkeypatch):
    """Simulates two concurrent /register calls for the same email: both see
    "no such user" from the pre-check, so both reach crud.create_user, and the
    second trips users.email's unique constraint on commit."""
    monkeypatch.setattr(crud, "get_user_by_email", lambda db, email: None)
    payload = {"email": "racer@example.com", "password": "password123"}

    first = client.post("/register", json=payload)
    second = client.post("/register", json=payload)

    assert first.status_code == 201, first.text
    assert second.status_code == 400, second.text
    assert second.json()["detail"] == "Email already registered"


def test_creating_the_same_category_twice_at_once_conflicts_not_500(client, auth, monkeypatch):
    """Same race as above, on POST /categories and uq_categories_user_name."""
    monkeypatch.setattr(crud, "get_category_by_name", lambda db, name, user_id: None)
    payload = {"name": "Movies"}

    first = client.post("/categories", json=payload, headers=auth)
    second = client.post("/categories", json=payload, headers=auth)

    assert first.status_code == 201, first.text
    assert second.status_code == 409, second.text
    assert second.json()["detail"] == "Category already exists"


def _flaky_category_lookup(blind_calls: int):
    """Returns None (as if the name doesn't exist yet) for the first
    `blind_calls` calls, then defers to the real lookup.

    ensure_category has no error branch for "already exists" -- it just
    returns the stored spelling -- so unlike the two tests above, patching it
    to always lie would make the *retry* collide too, since the retry's own
    re-check would never see the row the other side actually committed. Two
    concurrent requests only get one blind check each, so two blind calls is
    the honest amount of lying to do here.
    """
    real_lookup = crud.get_category_by_name
    calls = {"n": 0}

    def lookup(db, name, user_id):
        calls["n"] += 1
        if calls["n"] <= blind_calls:
            return None
        return real_lookup(db, name, user_id)

    return lookup


def test_two_new_subscriptions_racing_the_same_new_category_both_succeed(client, auth, monkeypatch):
    """Two subscriptions created "at once" that both introduce the same brand
    new category name. Neither request is about categories at all, so the
    race must resolve silently: both subscriptions succeed and end up sharing
    one category row, spelled the way whichever commit won first spelled it."""
    monkeypatch.setattr(crud, "get_category_by_name", _flaky_category_lookup(blind_calls=2))

    first = client.post(
        "/subscriptions",
        json={
            "name": "Netflix",
            "cost": "15.99",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-01-01",
            "category": "Movies",
        },
        headers=auth,
    )
    second = client.post(
        "/subscriptions",
        json={
            "name": "Hulu",
            "cost": "9.99",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-01-01",
            "category": "Movies",
        },
        headers=auth,
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["category"] == second.json()["category"] == "Movies"

    categories = client.get("/categories", headers=auth).json()
    assert sum(1 for c in categories if c["name"].lower() == "movies") == 1


def test_two_updates_racing_the_same_new_category_both_succeed(client, auth, monkeypatch):
    """Same race as above, on PUT /subscriptions/{id} instead of create --
    update_subscription's retry has to re-fetch and redo the whole edit, not
    just the category, since rollback() discards the in-memory changes too."""
    first = client.post(
        "/subscriptions",
        json={
            "name": "Netflix",
            "cost": "15.99",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-01-01",
        },
        headers=auth,
    ).json()
    second = client.post(
        "/subscriptions",
        json={
            "name": "Hulu",
            "cost": "9.99",
            "billing_cycle": "monthly",
            "next_renewal_date": "2026-01-01",
        },
        headers=auth,
    ).json()

    monkeypatch.setattr(crud, "get_category_by_name", _flaky_category_lookup(blind_calls=2))

    updated_first = client.put(
        f"/subscriptions/{first['id']}", json={"category": "Streaming"}, headers=auth
    )
    updated_second = client.put(
        f"/subscriptions/{second['id']}", json={"category": "Streaming"}, headers=auth
    )

    assert updated_first.status_code == 200, updated_first.text
    assert updated_second.status_code == 200, updated_second.text
    assert updated_first.json()["category"] == updated_second.json()["category"] == "Streaming"
