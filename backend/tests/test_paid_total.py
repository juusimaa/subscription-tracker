"""paid_total: what each run has been billed so far.

The dashboard sums it across a group's runs into a lifetime total (issue #49),
so it has to count charges exactly the way the spend summary does. Fixed dates
in the past keep these from depending on what today happens to be.
"""

from datetime import date

from conftest import add_subscription, money


def listed(client, auth, subscription_id: int) -> dict:
    rows = client.get("/subscriptions", headers=auth).json()
    return next(row for row in rows if row["id"] == subscription_id)


def test_a_cancelled_run_counts_every_charge_up_to_its_stop(client, auth):
    """Monthly from 15 Jan, cancelled on 15 Apr: the charge on the stopping
    day still happened, so that is four charges, not three."""
    created = add_subscription(
        client,
        auth,
        cost="10.00",
        started_date="2024-01-15",
        next_renewal_date="2024-02-15",
        status="cancelled",
        cancelled_date="2024-04-15",
    )
    assert money(created["paid_total"]) == money("40.00")


def test_a_running_plan_counts_its_charges_up_to_today(client, auth):
    """Started today, so the first charge has been taken and nothing else."""
    created = add_subscription(client, auth, cost="99.00", billing_cycle="yearly")
    assert money(listed(client, auth, created["id"])["paid_total"]) == money("99.00")


def test_a_trial_has_paid_nothing(client, auth):
    created = add_subscription(
        client, auth, status="trial", started_date="2024-01-01", next_renewal_date=str(date.today())
    )
    assert money(created["paid_total"]) == 0


def test_an_unknown_start_has_no_total(client, auth):
    """Only a row restored from a backup taken before the start date column
    existed can lack one. Its schedule extends backwards without end, so
    there is no honest total to report."""
    add_subscription(client, auth)
    file = client.get("/export", headers=auth).json()
    file["subscriptions"][0]["started_date"] = None
    response = client.post("/import?mode=replace", json=file, headers=auth)
    assert response.status_code == 200, response.text
    [row] = client.get("/subscriptions", headers=auth).json()
    assert row["started_date"] is None
    assert row["paid_total"] is None


def test_a_new_run_starts_its_own_total_and_leaves_the_old_one(client, auth):
    first = add_subscription(
        client,
        auth,
        cost="10.00",
        started_date="2024-01-15",
        next_renewal_date="2024-02-15",
        status="cancelled",
        cancelled_date="2024-02-20",
    )
    response = client.post(
        f"/subscriptions/{first['id']}/restore",
        json={"started_date": str(date.today()), "next_renewal_date": str(date.today())},
        headers=auth,
    )
    assert response.status_code == 201, response.text
    second = response.json()

    assert second["group_id"] == listed(client, auth, first["id"])["group_id"]
    assert money(listed(client, auth, first["id"])["paid_total"]) == money("20.00")
    assert money(second["paid_total"]) == money("10.00")
