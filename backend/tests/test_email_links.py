# Email verification and password reset (PLAN.md milestone 9). Every email
# lands in the `outbox` fixture (the memory backend, see conftest.py), and the
# tests pull the token back out of the link the way a user's click would.

import re
from datetime import datetime, timedelta, timezone

import jwt

from app import auth
from tests.conftest import register


def link_token(message: dict, param: str) -> str:
    match = re.search(rf"\?{param}=([\w.-]+)", message["text"])
    assert match, message["text"]
    return match.group(1)


def expired_token(claims: dict) -> str:
    claims = {**claims, "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}
    return jwt.encode(claims, auth.SECRET_KEY, algorithm=auth.ALGORITHM)


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestVerification:
    def test_register_sends_a_verification_link_and_starts_unverified(self, client, outbox):
        headers = register(client, email="new@example.com")

        assert [m["to"] for m in outbox] == ["new@example.com"]
        assert "?verify=" in outbox[0]["text"]
        assert "?verify=" in outbox[0]["html"]
        assert client.get("/me", headers=headers).json()["email_verified"] is False

    def test_the_link_verifies_without_being_signed_in(self, client, outbox):
        headers = register(client, email="new@example.com")
        token = link_token(outbox[0], "verify")

        response = client.post("/verify-email", json={"token": token})

        assert response.status_code == 200
        assert response.json() == {"email": "new@example.com"}
        assert client.get("/me", headers=headers).json()["email_verified"] is True

    def test_opening_the_link_twice_is_fine(self, client, outbox):
        register(client)
        token = link_token(outbox[0], "verify")

        assert client.post("/verify-email", json={"token": token}).status_code == 200
        assert client.post("/verify-email", json={"token": token}).status_code == 200

    def test_an_expired_link_says_expired(self, client, outbox):
        register(client)
        claims = jwt.decode(
            link_token(outbox[0], "verify"), auth.SECRET_KEY, algorithms=[auth.ALGORITHM]
        )

        response = client.post("/verify-email", json={"token": expired_token(claims)})

        assert response.status_code == 400
        assert response.json()["detail"] == "expired"

    def test_garbage_and_reset_tokens_are_invalid_here(self, client, outbox):
        register(client, email="a@example.com")
        client.post("/password-reset", json={"email": "a@example.com"})
        reset_token = link_token(outbox[-1], "reset")

        for token in ("not-a-token", reset_token):
            response = client.post("/verify-email", json={"token": token})
            assert response.status_code == 400
            assert response.json()["detail"] == "invalid"

    def test_resend_sends_a_new_link_until_verified(self, client, outbox):
        headers = register(client)
        assert client.post("/me/verification", headers=headers).status_code == 204
        assert len(outbox) == 2

        client.post("/verify-email", json={"token": link_token(outbox[-1], "verify")})
        assert client.post("/me/verification", headers=headers).status_code == 204
        assert len(outbox) == 2

    def test_resend_needs_a_login(self, client):
        assert client.post("/me/verification").status_code == 401


class TestPasswordReset:
    def test_unknown_address_gets_the_same_answer_and_no_mail(self, client, outbox):
        register(client, email="known@example.com")
        outbox.clear()

        known = client.post("/password-reset", json={"email": "known@example.com"})
        unknown = client.post("/password-reset", json={"email": "nobody@example.com"})

        assert known.status_code == unknown.status_code == 202
        assert known.content == unknown.content == b""
        assert [m["to"] for m in outbox] == ["known@example.com"]

    def test_reset_sets_the_password_signs_in_and_verifies(self, client, outbox):
        old_headers = register(client, email="a@example.com", password="old-password")
        client.post("/password-reset", json={"email": "a@example.com"})
        token = link_token(outbox[-1], "reset")

        response = client.post(
            "/password-reset/confirm", json={"token": token, "new_password": "new-password"}
        )

        assert response.status_code == 200
        new_headers = bearer(response.json()["access_token"])
        assert client.get("/me", headers=new_headers).json()["email_verified"] is True
        # Every session from before the reset is signed out.
        assert client.get("/me", headers=old_headers).status_code == 401
        login = client.post("/token", data={"username": "a@example.com", "password": "new-password"})
        assert login.status_code == 200

    def test_a_reset_link_works_once(self, client, outbox):
        register(client, email="a@example.com")
        client.post("/password-reset", json={"email": "a@example.com"})
        token = link_token(outbox[-1], "reset")
        body = {"token": token, "new_password": "new-password"}

        assert client.post("/password-reset/confirm", json=body).status_code == 200
        second = client.post("/password-reset/confirm", json=body)
        assert second.status_code == 400
        assert second.json()["detail"] == "expired"

    def test_an_expired_reset_link_says_expired(self, client, outbox):
        register(client, email="a@example.com")
        client.post("/password-reset", json={"email": "a@example.com"})
        claims = jwt.decode(
            link_token(outbox[-1], "reset"), auth.SECRET_KEY, algorithms=[auth.ALGORITHM]
        )

        response = client.post(
            "/password-reset/confirm",
            json={"token": expired_token(claims), "new_password": "new-password"},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "expired"

    def test_a_verify_token_cannot_reset_a_password(self, client, outbox):
        register(client)
        token = link_token(outbox[0], "verify")

        response = client.post(
            "/password-reset/confirm", json={"token": token, "new_password": "new-password"}
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "invalid"

    def test_the_new_password_follows_the_usual_rules(self, client, outbox):
        register(client, email="a@example.com")
        client.post("/password-reset", json={"email": "a@example.com"})
        token = link_token(outbox[-1], "reset")

        response = client.post("/password-reset/confirm", json={"token": token, "new_password": "short"})
        assert response.status_code == 422


class TestLinkTokensAreNotLogins:
    def test_neither_emailed_token_works_as_a_bearer_token(self, client, outbox):
        register(client, email="a@example.com")
        client.post("/password-reset", json={"email": "a@example.com"})

        for token in (link_token(outbox[0], "verify"), link_token(outbox[-1], "reset")):
            assert client.get("/me", headers=bearer(token)).status_code == 401


class TestRateLimits:
    def test_reset_requests_are_limited_per_address(self, client):
        from tests.test_rate_limit import rate_limiting_enabled

        with rate_limiting_enabled():
            statuses = [
                client.post("/password-reset", json={"email": "x@example.com"}).status_code
                for _ in range(6)
            ]
        assert statuses == [202] * 5 + [429]
