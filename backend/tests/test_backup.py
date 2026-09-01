# The backup routes: what a file carries, and what reading one back does.
#
# These matter more than their size suggests, because /export and /import are
# the only pair in the API where the same data goes out and comes back. A
# round trip that does not reproduce the account is not a backup, and the two
# ways it can fail quietly -- a field that never makes it into the file, and a
# merge that writes something other than what the file says -- are what most
# of the tests below are watching for.

import csv
import io
from datetime import date, timedelta

from conftest import add_subscription, money

TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)


def export(client, auth, **params):
    response = client.get("/export", headers=auth, params=params)
    assert response.status_code == 200, response.text
    return response


def rows(csv_text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(csv_text)))


class TestCsvExport:
    def test_columns_are_the_ones_the_handoff_pins_plus_the_dates(self, client, auth):
        add_subscription(client, auth)
        header = rows(export(client, auth, format="csv").text)[0]
        assert list(header) == [
            "name",
            "category",
            "status",
            "cycle",
            "cost",
            "next_renewal",
            "started_date",
            "cancelled_date",
            "paused_date",
        ]

    def test_a_row_says_what_the_json_says(self, client, auth):
        add_subscription(
            client,
            auth,
            name="Spotify",
            cost="10.99",
            billing_cycle="yearly",
            category="Music",
            started_date=str(YESTERDAY),
        )
        [row] = rows(export(client, auth, format="csv").text)
        [json_row] = export(client, auth).json()["subscriptions"]
        assert row["name"] == json_row["name"] == "Spotify"
        assert money(row["cost"]) == money(json_row["cost"])
        assert row["cycle"] == json_row["billing_cycle"] == "yearly"
        assert row["next_renewal"] == json_row["next_renewal_date"]
        assert row["status"] == json_row["status"] == "active"
        assert row["category"] == "Music"

    def test_an_absent_date_is_an_empty_cell_not_the_word_none(self, client, auth):
        add_subscription(client, auth, category=None)
        [row] = rows(export(client, auth, format="csv").text)
        assert row["cancelled_date"] == "" and row["paused_date"] == ""
        assert row["category"] == ""

    def test_a_comma_in_a_name_survives(self, client, auth):
        # The reason this uses csv.writer rather than joining strings: a
        # subscription called "Netflix, shared" is ordinary, and a torn row
        # would import as two broken ones.
        add_subscription(client, auth, name="Netflix, shared")
        assert rows(export(client, auth, format="csv").text)[0]["name"] == "Netflix, shared"

    def test_a_category_nothing_uses_is_lost_which_json_is_for(self, client, auth):
        client.post("/categories", json={"name": "Transport"}, headers=auth)
        add_subscription(client, auth, category="Streaming")
        csv_categories = {row["category"] for row in rows(export(client, auth, format="csv").text)}
        assert csv_categories == {"Streaming"}
        # Documented, not a bug: a CSV has one row per subscription and so
        # nowhere to put a category nothing is using. The JSON keeps it.
        assert "Transport" in export(client, auth).json()["categories"]

    def test_both_formats_name_the_file_they_are(self, client, auth):
        add_subscription(client, auth)
        json_response = export(client, auth)
        csv_response = export(client, auth, format="csv")
        stamp = TODAY.isoformat()
        assert f'filename="subscriptions-{stamp}.json"' in json_response.headers["content-disposition"]
        assert f'filename="subscriptions-{stamp}.csv"' in csv_response.headers["content-disposition"]
        assert csv_response.headers["content-type"].startswith("text/csv")

    def test_an_unknown_format_is_refused_rather_than_guessed(self, client, auth):
        assert client.get("/export", headers=auth, params={"format": "xlsx"}).status_code == 422


class TestImportMode:
    def test_mode_and_the_older_replace_flag_mean_the_same_thing(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        file = export(client, auth).json()
        add_subscription(client, auth, name="Gym")

        by_mode = client.post("/import?mode=replace", json=file, headers=auth).json()
        assert by_mode["mode"] == "replace" and by_mode["subscriptions_removed"] == 2

        add_subscription(client, auth, name="Gym")
        by_flag = client.post("/import?replace=true", json=file, headers=auth).json()
        assert by_flag["mode"] == "replace" and by_flag["subscriptions_removed"] == 2

    def test_neither_means_merge(self, client, auth):
        assert client.post(
            "/import", json={"version": 2, "categories": [], "subscriptions": []}, headers=auth
        ).json()["mode"] == "merge"

    def test_the_two_agreeing_is_fine(self, client, auth):
        response = client.post(
            "/import?mode=merge&replace=false",
            json={"version": 2, "categories": [], "subscriptions": []},
            headers=auth,
        )
        assert response.status_code == 200 and response.json()["mode"] == "merge"

    def test_the_two_disagreeing_is_refused_rather_than_resolved(self, client, auth):
        # Guessing here empties an account. 422, the same answer a `status` /
        # `active` contradiction gets on a write.
        add_subscription(client, auth, name="Netflix")
        response = client.post(
            "/import?mode=merge&replace=true",
            json={"version": 2, "categories": [], "subscriptions": []},
            headers=auth,
        )
        assert response.status_code == 422
        assert len(client.get("/subscriptions", headers=auth).json()) == 1


class TestMerge:
    def test_a_matching_name_is_updated_not_skipped(self, client, auth):
        add_subscription(client, auth, name="Netflix", cost="15.99")
        file = export(client, auth).json()
        file["subscriptions"][0]["cost"] = "19.99"

        result = client.post("/import?mode=merge", json=file, headers=auth).json()
        assert (result["subscriptions_updated"], result["subscriptions_imported"]) == (1, 0)
        [stored] = client.get("/subscriptions", headers=auth).json()
        assert money(stored["cost"]) == money("19.99")

    def test_matching_ignores_case_and_surrounding_space(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        file = export(client, auth).json()
        file["subscriptions"][0]["name"] = "  netflix  "

        result = client.post("/import", json=file, headers=auth).json()
        assert result["subscriptions_imported"] == 0
        # The file's spelling wins on an update: it is an edit like any other.
        assert client.get("/subscriptions", headers=auth).json()[0]["name"] == "netflix"

    def test_importing_the_same_file_twice_writes_nothing_the_second_time(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        add_subscription(client, auth, name="Spotify", cost="10.99")
        file = export(client, auth).json()

        first = client.post("/import", json=file, headers=auth).json()
        assert (first["subscriptions_unchanged"], first["subscriptions_updated"]) == (2, 0)
        second = client.post("/import", json=file, headers=auth).json()
        assert second == first
        assert len(client.get("/subscriptions", headers=auth).json()) == 2

    def test_a_row_with_no_counterpart_is_added(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        file = export(client, auth).json()
        file["subscriptions"].append({**file["subscriptions"][0], "name": "Dropbox"})

        result = client.post("/import", json=file, headers=auth).json()
        assert (result["subscriptions_imported"], result["subscriptions_unchanged"]) == (1, 1)

    def test_two_rows_of_the_same_name_pair_off_in_order(self, client, auth):
        # Two Netflix accounts are a real thing to track (TODO.md D4), so the
        # file's first one has to update the account's first one rather than
        # both landing on whichever the lookup happened to find.
        add_subscription(client, auth, name="Netflix", cost="15.99")
        add_subscription(client, auth, name="Netflix", cost="7.99")
        file = export(client, auth).json()
        file["subscriptions"] = sorted(file["subscriptions"], key=lambda s: money(s["cost"]))
        assert len(file["subscriptions"]) == 2

        result = client.post("/import", json=file, headers=auth).json()
        assert result["subscriptions_imported"] == 0
        costs = sorted(money(s["cost"]) for s in client.get("/subscriptions", headers=auth).json())
        assert costs == [money("7.99"), money("15.99")]

    def test_a_third_row_of_that_name_is_added(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        file = export(client, auth).json()
        file["subscriptions"] = file["subscriptions"] * 3

        result = client.post("/import", json=file, headers=auth).json()
        assert result["subscriptions_imported"] == 2
        assert len(client.get("/subscriptions", headers=auth).json()) == 3

    def test_an_update_does_not_stamp_todays_dates_over_the_files(self, client, auth):
        # The whole reason import does not call _sync_status_dates: a
        # cancellation dated last year is history, and rewriting it to today
        # invents a year of spend that never happened.
        long_ago = TODAY - timedelta(days=400)
        add_subscription(client, auth, name="Netflix", started_date=str(long_ago))
        file = export(client, auth).json()
        # `active` comes out of the export alongside `status` and the two
        # must not contradict (schemas.resolve_status), so editing one means
        # dropping the other -- which is what the frontend's parser does too.
        file["subscriptions"][0].pop("active")
        file["subscriptions"][0]["status"] = "cancelled"
        file["subscriptions"][0]["cancelled_date"] = str(YESTERDAY)

        client.post("/import", json=file, headers=auth)
        [stored] = client.get("/subscriptions", headers=auth).json()
        assert stored["cancelled_date"] == str(YESTERDAY)
        assert stored["started_date"] == str(long_ago)


class TestReplace:
    def test_the_account_ends_up_matching_the_file(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        file = export(client, auth).json()
        add_subscription(client, auth, name="Gym")

        result = client.post("/import?mode=replace", json=file, headers=auth).json()
        assert result["subscriptions_removed"] == 2
        assert result["subscriptions_imported"] == 1
        assert [s["name"] for s in client.get("/subscriptions", headers=auth).json()] == ["Netflix"]

    def test_nothing_is_reported_as_updated_or_unchanged(self, client, auth):
        add_subscription(client, auth, name="Netflix")
        file = export(client, auth).json()
        result = client.post("/import?mode=replace", json=file, headers=auth).json()
        assert result["subscriptions_updated"] == 0
        assert result["subscriptions_unchanged"] == 0


class TestRoundTrip:
    def test_export_then_replace_import_reproduces_the_account(self, client, auth):
        add_subscription(client, auth, name="Netflix", category="Streaming", cost="15.99")
        add_subscription(
            client,
            auth,
            name="Gym",
            cost="39.00",
            billing_cycle="yearly",
            category="Health",
            started_date=str(YESTERDAY),
        )
        paused = add_subscription(client, auth, name="Figma", cost="12.00")
        client.put(
            f"/subscriptions/{paused['id']}",
            json={"status": "paused", "paused_date": str(YESTERDAY)},
            headers=auth,
        )
        client.post("/categories", json={"name": "Empty"}, headers=auth)

        before_subs = client.get("/subscriptions", headers=auth).json()
        before_cats = client.get("/categories", headers=auth).json()
        file = export(client, auth).json()

        client.post("/import?mode=replace", json=file, headers=auth)

        after_subs = client.get("/subscriptions", headers=auth).json()
        after_cats = client.get("/categories", headers=auth).json()
        # Ids are reassigned by the insert -- they are deliberately not in the
        # file, so a backup can be restored into a different account.
        strip = lambda subs: [{k: v for k, v in s.items() if k != "id"} for s in subs]  # noqa: E731
        assert strip(after_subs) == strip(before_subs)
        assert [c["name"] for c in after_cats] == [c["name"] for c in before_cats]
