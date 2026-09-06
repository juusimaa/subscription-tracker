# Category CRUD, and specifically the D6 bug: the count that decides whether
# DELETE /categories/{id} 409s used to include cancelled subscriptions, while
# CategoriesDialog.jsx only ever treated a *live* subscription (anything but
# cancelled) as reason to block deletion. A category used only by cancelled
# plans looked deletable in the UI and then 409'd anyway.

from conftest import add_subscription


def test_delete_category_used_only_by_cancelled_plans_succeeds(client, auth):
    add_subscription(client, auth, category="Movies", status="cancelled")

    response = client.delete("/categories/1", headers=auth)

    assert response.status_code == 204, response.text


def test_delete_category_used_only_by_cancelled_plans_detaches_them(client, auth):
    created = add_subscription(client, auth, category="Movies", status="cancelled")

    client.delete("/categories/1", headers=auth)

    subscription = client.get(f"/subscriptions/{created['id']}", headers=auth).json()
    assert subscription["category"] is None


def test_delete_category_still_blocked_by_a_live_subscription(client, auth):
    add_subscription(client, auth, category="Movies", status="active")

    response = client.delete("/categories/1", headers=auth)

    assert response.status_code == 409
    assert "1 subscription" in response.json()["detail"]


def test_delete_category_blocked_by_trial_or_paused_too(client, auth):
    """Live spans three statuses, not one -- only cancelled is exempt."""
    add_subscription(client, auth, category="Movies", status="trial")

    response = client.delete("/categories/1", headers=auth)

    assert response.status_code == 409
