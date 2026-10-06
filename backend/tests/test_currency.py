"""Multi-currency support (PLAN.md milestone 10).

Every subscription keeps the currency it is billed in; the summaries convert
into the user's currency at European Central Bank reference rates, one
charge at a time, each at its own day's rate. The rate source is the
`frankfurter` fake from conftest.py -- nothing here reaches the network.
"""

from datetime import date, timedelta

from app import fx
from tests.conftest import add_subscription, money

TODAY = date.today()


def set_currency(client, auth, code):
    response = client.patch("/me", json={"currency": code}, headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


def spend(client, auth, **params):
    response = client.get("/subscriptions/summary/spend", params=params, headers=auth)
    assert response.status_code == 200, response.text
    return response.json()


class TestTheCurrencyOfASubscription:
    def test_defaults_to_the_users_currency(self, client, auth):
        assert add_subscription(client, auth)["currency"] == "EUR"
        set_currency(client, auth, "SEK")
        assert add_subscription(client, auth, name="Viaplay")["currency"] == "SEK"

    def test_an_explicit_one_wins_and_is_stored_upper_case(self, client, auth):
        assert add_subscription(client, auth, currency=" usd")["currency"] == "USD"

    def test_only_ecb_currencies_are_accepted(self, client, auth):
        response = client.post(
            "/subscriptions",
            json={"name": "Coin", "cost": "5", "next_renewal_date": str(TODAY), "currency": "BTC"},
            headers=auth,
        )
        assert response.status_code == 422
        assert "Unsupported currency" in response.text

    def test_cannot_be_changed_by_an_edit(self, client, auth):
        created = add_subscription(client, auth, currency="USD")
        response = client.put(
            f"/subscriptions/{created['id']}", json={"currency": "GBP"}, headers=auth
        )
        assert response.status_code == 422
        assert "restore it as a new run" in response.text
        assert client.get(f"/subscriptions/{created['id']}", headers=auth).json()["currency"] == "USD"

    def test_repeating_the_stored_currency_is_fine(self, client, auth):
        created = add_subscription(client, auth, currency="USD")
        response = client.put(
            f"/subscriptions/{created['id']}",
            json={"currency": "usd", "cost": "21.00"},
            headers=auth,
        )
        assert response.status_code == 200, response.text
        assert money(response.json()["cost"]) == money("21.00")

    def test_a_restored_run_can_start_in_another_currency(self, client, auth):
        created = add_subscription(client, auth, currency="USD", started_date=str(TODAY - timedelta(days=60)))
        client.put(f"/subscriptions/{created['id']}", json={"status": "cancelled"}, headers=auth)
        restored = client.post(
            f"/subscriptions/{created['id']}/restore",
            json={"currency": "GBP", "cost": "15.00"},
            headers=auth,
        )
        assert restored.status_code == 201, restored.text
        assert restored.json()["currency"] == "GBP"
        assert client.get(f"/subscriptions/{created['id']}", headers=auth).json()["currency"] == "USD"

    def test_a_restored_run_keeps_the_currency_by_default(self, client, auth):
        created = add_subscription(client, auth, currency="USD", started_date=str(TODAY - timedelta(days=60)))
        client.put(f"/subscriptions/{created['id']}", json={"status": "cancelled"}, headers=auth)
        restored = client.post(f"/subscriptions/{created['id']}/restore", headers=auth)
        assert restored.json()["currency"] == "USD"


class TestTheUsersCurrency:
    def test_starts_as_euros_and_can_be_changed(self, client, auth):
        assert client.get("/me", headers=auth).json()["currency"] == "EUR"
        assert set_currency(client, auth, "gbp")["currency"] == "GBP"
        assert client.get("/me", headers=auth).json()["currency"] == "GBP"

    def test_an_unsupported_one_is_refused(self, client, auth):
        assert client.patch("/me", json={"currency": "XYZ"}, headers=auth).status_code == 422

    def test_changing_it_leaves_every_subscription_alone(self, client, auth):
        created = add_subscription(client, auth)
        set_currency(client, auth, "USD")
        assert client.get(f"/subscriptions/{created['id']}", headers=auth).json()["currency"] == "EUR"


class TestSpendConversion:
    """A USD plan from 15 Jan 2025, $20 a month, against rates chosen so each
    charge lands on a different one."""

    def setup_rates(self, frankfurter):
        frankfurter.set("USD", "2025-01-10", 1.0)
        # Friday. The Saturday charge on 15 Feb must use this, not Monday's.
        frankfurter.set("USD", "2025-02-14", 1.25)
        frankfurter.set("USD", "2025-02-17", 4.0)
        frankfurter.set("USD", "2025-03-03", 2.5)
        frankfurter.set("USD", str(TODAY), 2.0)

    def test_each_charge_uses_its_own_days_rate(self, client, auth, frankfurter):
        self.setup_rates(frankfurter)
        add_subscription(
            client, auth, name="ChatGPT", cost="20.00", currency="USD",
            started_date="2025-01-15", next_renewal_date="2025-01-15",
        )
        months = spend(client, auth, year=2025)["months"]
        assert [money(m["total"]) for m in months[:3]] == [
            money("20.00"),  # 20 / 1.0
            money("16.00"),  # 20 / 1.25, Friday's rate for a Saturday
            money("8.00"),  # 20 / 2.5
        ]
        assert months[0]["by_currency"] == [{"currency": "USD", "native": 20.0, "converted": 20.0}]

    def test_the_users_currency_leads_and_the_totals_add_up(self, client, auth, frankfurter):
        self.setup_rates(frankfurter)
        add_subscription(
            client, auth, name="ChatGPT", cost="20.00", currency="USD",
            started_date="2025-01-15", next_renewal_date="2025-01-15",
        )
        add_subscription(
            client, auth, name="Netflix", cost="15.99",
            started_date="2025-01-20", next_renewal_date="2025-01-20",
        )
        summary = spend(client, auth, year=2025, month=1)
        assert summary["currency"] == "EUR"
        assert [line["currency"] for line in summary["by_currency"]] == ["EUR", "USD"]
        assert money(summary["total"]) == money("35.99")
        assert summary["rates_stale"] is False

    def test_rounding_happens_per_charge(self, client, auth, frankfurter):
        frankfurter.set("GBP", "2025-01-02", 3.0)
        frankfurter.set("GBP", str(TODAY), 3.0)
        for name in ("A", "B", "C"):
            add_subscription(
                client, auth, name=name, cost="10.00", currency="GBP",
                started_date="2025-01-15", next_renewal_date="2025-01-15",
            )
        month = spend(client, auth, year=2025, month=1)["months"][0]
        # Three times 3.33, never one 10.00: the lines and the total agree.
        assert money(month["total"]) == money("9.99")
        assert month["by_currency"][0]["converted"] == 9.99

    def test_cross_rates_when_the_user_is_not_in_euros(self, client, auth, frankfurter):
        frankfurter.set("USD", "2025-01-02", 1.25)
        frankfurter.set("GBP", "2025-01-02", 0.8)
        frankfurter.set("USD", str(TODAY), 1.25)
        frankfurter.set("GBP", str(TODAY), 0.8)
        set_currency(client, auth, "USD")
        add_subscription(client, auth, name="E", cost="10.00", currency="EUR", started_date="2025-01-15", next_renewal_date="2025-01-15")
        add_subscription(client, auth, name="G", cost="10.00", currency="GBP", started_date="2025-01-15", next_renewal_date="2025-01-15")
        summary = spend(client, auth, year=2025, month=1)
        assert summary["currency"] == "USD"
        # €10 -> $12.50; £10 -> 10 / 0.8 * 1.25 = $15.625 -> $15.63
        assert money(summary["total"]) == money("28.13")

    def test_one_currency_never_asks_for_a_rate(self, client, auth, frankfurter):
        add_subscription(client, auth)
        spend(client, auth)
        client.get("/subscriptions/upcoming", headers=auth)
        client.get("/rates", headers=auth)
        assert frankfurter.calls == []


class TestWhenTheRateSourceFails:
    def test_stored_rates_are_used_and_called_stale(self, client, auth, frankfurter):
        frankfurter.set("USD", str(TODAY - timedelta(days=30)), 2.0)
        add_subscription(client, auth, cost="20.00", currency="USD")
        this_month = {"month": TODAY.month}
        assert spend(client, auth, **this_month)["rates_stale"] is True
        frankfurter.down = True
        fx.reset()
        summary = spend(client, auth, **this_month)
        assert summary["rates_stale"] is True
        assert summary["rates_as_of"] == str(TODAY - timedelta(days=30))
        assert money(summary["total"]) == money("10.00")

    def test_a_currency_with_no_rate_is_left_out_not_guessed(self, client, auth, frankfurter):
        frankfurter.down = True
        add_subscription(client, auth, name="Netflix", cost="15.99")
        add_subscription(client, auth, name="ChatGPT", cost="20.00", currency="USD")
        summary = spend(client, auth, month=TODAY.month)
        assert money(summary["total"]) == money("15.99")
        usd = next(line for line in summary["by_currency"] if line["currency"] == "USD")
        assert usd == {"currency": "USD", "native": 20.0, "converted": None}
        assert summary["rates_stale"] is True

    def test_a_dead_provider_is_not_asked_again_on_every_request(self, client, auth, frankfurter):
        frankfurter.down = True
        add_subscription(client, auth, cost="20.00", currency="USD")
        spend(client, auth)
        calls = len(frankfurter.calls)
        spend(client, auth)
        client.get("/subscriptions/upcoming", headers=auth)
        assert len(frankfurter.calls) == calls


class TestUpcomingAndRates:
    def test_upcoming_converts_at_the_latest_rate(self, client, auth, frankfurter):
        frankfurter.set("USD", str(TODAY), 1.25)
        add_subscription(client, auth, name="ChatGPT", cost="20.00", currency="USD")
        add_subscription(client, auth, name="Netflix", cost="15.99")
        body = client.get("/subscriptions/upcoming?days=1", headers=auth).json()
        by_name = {r["subscription"]["name"]: r for r in body["renewals"]}
        assert money(by_name["ChatGPT"]["cost"]) == money("20.00")
        assert by_name["ChatGPT"]["converted_cost"] == 16.0
        assert money(body["total"]) == money("31.99")
        assert body["currency"] == "EUR"

    def test_rates_lists_only_the_currencies_in_use(self, client, auth, frankfurter):
        frankfurter.set("USD", "2025-06-02", 1.1)
        frankfurter.set("GBP", "2025-06-02", 0.85)
        frankfurter.set("USD", str(TODAY), 1.2)
        frankfurter.set("GBP", str(TODAY), 0.86)
        add_subscription(client, auth, cost="20.00", currency="USD", started_date="2025-06-10", next_renewal_date="2025-06-10")
        body = client.get("/rates", headers=auth).json()
        assert body["currency"] == "EUR"
        assert set(body["rates"]) == {"USD"}
        assert body["rates"]["USD"][0] == ["2025-06-02", 1.1]
        assert body["rates"]["USD"][-1] == [str(TODAY), 1.2]
        assert body["stale"] is False

    def test_monthly_total_converts_at_todays_rate(self, client, auth, frankfurter):
        frankfurter.set("USD", str(TODAY), 2.0)
        add_subscription(client, auth, cost="120.00", currency="USD", billing_cycle="yearly")
        body = client.get("/subscriptions/summary/monthly-total", headers=auth).json()
        assert body == {"monthly_total": 5.0, "yearly_total": 60.0, "currency": "EUR"}


class TestBackups:
    def test_export_carries_the_currency(self, client, auth):
        add_subscription(client, auth, currency="USD")
        backup = client.get("/export", headers=auth).json()
        assert backup["version"] == 4
        assert backup["subscriptions"][0]["currency"] == "USD"
        csv_text = client.get("/export", params={"format": "csv"}, headers=auth).text
        assert csv_text.splitlines()[0].endswith(",currency")
        assert csv_text.splitlines()[1].endswith(",USD")

    def test_an_older_file_imports_in_the_users_currency(self, client, auth):
        set_currency(client, auth, "SEK")
        response = client.post(
            "/import",
            json={
                "version": 3,
                "subscriptions": [
                    {"name": "Old", "cost": "9.00", "billing_cycle": "monthly", "next_renewal_date": str(TODAY)}
                ],
            },
            headers=auth,
        )
        assert response.status_code == 200, response.text
        assert client.get("/subscriptions", headers=auth).json()[0]["currency"] == "SEK"

    def test_a_merge_updates_the_currency_from_the_file(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        body = {
            "version": 4,
            "subscriptions": [
                {"name": "Netflix", "cost": "15.99", "currency": "usd", "billing_cycle": "monthly", "next_renewal_date": str(TODAY), "started_date": str(TODAY)}
            ],
        }
        result = client.post("/import", json=body, headers=auth).json()
        assert result["subscriptions_updated"] == 1
        assert client.get("/subscriptions", headers=auth).json()[0]["currency"] == "USD"

    def test_an_unknown_code_is_refused(self, client, auth):
        body = {
            "version": 4,
            "subscriptions": [
                {"name": "X", "cost": "1.00", "currency": "ABC", "billing_cycle": "monthly", "next_renewal_date": str(TODAY)}
            ],
        }
        assert client.post("/import", json=body, headers=auth).status_code == 422
