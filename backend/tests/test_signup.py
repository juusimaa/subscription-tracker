# Open signup: no invite code, so the protections that replace it -- a
# confirmed address before sign-in, answers that don't reveal which addresses
# have accounts, caps on outgoing email, and the Turnstile bot check.

from contextlib import contextmanager

from app import auth, crud, mailer, models, turnstile
from app.database import SessionLocal
from tests.conftest import register
from tests.test_email_links import bearer, link_token, sign_in, signup


class TestConfirmBeforeSignIn:
    def test_an_unconfirmed_address_cannot_sign_in(self, client):
        signup(client, "new@example.com")

        response = sign_in(client, "new@example.com")

        assert response.status_code == 403
        assert response.json()["detail"] == "email_not_verified"

    def test_a_wrong_password_still_gets_the_generic_401(self, client):
        # The "confirm first" answer only comes after the password checks
        # out, so it tells a stranger nothing about the address.
        signup(client, "new@example.com")

        response = sign_in(client, "new@example.com", "wrong-password")

        assert response.status_code == 401
        assert response.json()["detail"] == "Incorrect email or password"

    def test_a_token_issued_before_the_rule_stops_working(self, client):
        signup(client, "new@example.com")
        with SessionLocal() as db:
            user = crud.get_user_by_email(db, "new@example.com")
            token = auth.create_access_token(user.id, user.token_version)

        assert client.get("/me", headers=bearer(token)).status_code == 401


class TestNoEnumeration:
    def test_a_taken_address_gets_the_same_answer(self, client):
        register(client, email="taken@example.com")

        taken = client.post("/register", json={"email": "taken@example.com", "password": "password123"})
        fresh = client.post("/register", json={"email": "fresh@example.com", "password": "password123"})

        assert taken.status_code == fresh.status_code == 202
        assert taken.content == fresh.content == b""

    def test_a_verified_owner_is_told_by_email_and_keeps_their_password(self, client, outbox):
        register(client, email="taken@example.com", password="owner-password")
        outbox.clear()

        client.post("/register", json={"email": "taken@example.com", "password": "intruder-pass"})

        assert [m["subject"] for m in outbox] == ["You already have a Subscription Tracker account"]
        assert "?verify=" not in outbox[0]["text"] and "?reset=" not in outbox[0]["text"]
        assert sign_in(client, "taken@example.com", "owner-password").status_code == 200
        assert sign_in(client, "taken@example.com", "intruder-pass").status_code == 401

    def test_an_unconfirmed_account_is_finished_by_choosing_a_password(self, client, outbox):
        # Someone signed up with an address they don't own. When the real
        # owner signs up, the link they get sets *their* password, so the
        # squatter's no longer works.
        signup(client, "squat@example.com", "squatter-pass")
        client.post("/register", json={"email": "squat@example.com", "password": "owner-password"})

        assert outbox[-1]["subject"] == "Finish creating your Subscription Tracker account"
        response = client.post(
            "/password-reset/confirm",
            json={"token": link_token(outbox[-1], "reset"), "new_password": "owner-password"},
        )
        assert response.status_code == 200
        assert sign_in(client, "squat@example.com", "owner-password").status_code == 200
        assert sign_in(client, "squat@example.com", "squatter-pass").status_code == 401


def sent_to(outbox, address: str) -> int:
    return sum(1 for m in outbox if m["to"] == address)


class TestEmailCaps:
    def test_one_address_gets_at_most_five_a_day(self, client, outbox):
        signup(client, "a@example.com")
        for _ in range(10):
            client.post("/password-reset", json={"email": "a@example.com"})

        assert sent_to(outbox, "a@example.com") == mailer.EMAILS_PER_ADDRESS_PER_DAY

    def test_the_cap_answers_the_same(self, client, outbox):
        signup(client, "a@example.com")
        statuses = {
            client.post("/password-reset", json={"email": "a@example.com"}).status_code
            for _ in range(8)
        }
        assert statuses == {202}

    def test_the_whole_app_stops_at_the_daily_cap(self, client, outbox, monkeypatch):
        monkeypatch.setattr(mailer, "EMAIL_DAILY_CAP", 3)
        for n in range(5):
            signup(client, f"user{n}@example.com")

        assert len(outbox) == 3

    def test_addresses_are_not_stored(self, client):
        signup(client, "private@example.com")
        with SessionLocal() as db:
            recipients = [row.recipient for row in db.query(models.EmailSend)]
        assert len(recipients) == 1
        assert "private" not in recipients[0]


@contextmanager
def turnstile_on(monkeypatch, accepted: set[str]):
    calls = []

    def fake_siteverify(token, remote_ip):
        calls.append((token, remote_ip))
        return {"success": token in accepted}

    monkeypatch.setattr(turnstile, "SECRET_KEY", "test-secret")
    monkeypatch.setattr(turnstile, "_siteverify", fake_siteverify)
    yield calls


class TestTurnstile:
    def test_off_by_default(self):
        assert turnstile.SECRET_KEY is None

    def test_register_needs_a_passing_token(self, client, outbox, monkeypatch):
        with turnstile_on(monkeypatch, {"good"}):
            missing = client.post("/register", json={"email": "a@example.com", "password": "password123"})
            bad = client.post(
                "/register",
                json={"email": "a@example.com", "password": "password123", "turnstile_token": "bad"},
            )
            good = client.post(
                "/register",
                json={"email": "a@example.com", "password": "password123", "turnstile_token": "good"},
            )

        assert missing.status_code == bad.status_code == 400
        assert missing.json()["detail"] == "captcha"
        assert good.status_code == 202
        assert sent_to(outbox, "a@example.com") == 1

    def test_password_reset_needs_one_too(self, client, outbox, monkeypatch):
        register(client, email="a@example.com")
        outbox.clear()
        with turnstile_on(monkeypatch, {"good"}):
            bad = client.post("/password-reset", json={"email": "a@example.com"})
            good = client.post(
                "/password-reset", json={"email": "a@example.com", "turnstile_token": "good"}
            )

        assert bad.status_code == 400
        assert good.status_code == 202
        assert len(outbox) == 1

    def test_cloudflare_unreachable_fails_closed(self, client, monkeypatch):
        def down(token, remote_ip):
            raise RuntimeError("cloudflare is down")

        monkeypatch.setattr(turnstile, "SECRET_KEY", "test-secret")
        monkeypatch.setattr(turnstile, "_siteverify", down)
        response = client.post(
            "/register",
            json={"email": "a@example.com", "password": "password123", "turnstile_token": "x"},
        )
        assert response.status_code == 400

