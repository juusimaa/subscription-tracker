# Account management: changing a password and deleting an account. Both are
# self-service and both require the current password again, even though the
# request already carries a valid Bearer token -- see the docstrings on
# schemas.PasswordChange and schemas.AccountDelete for why.

import uuid

import jwt

from app.auth import ALGORITHM, SECRET_KEY
from conftest import add_subscription, register


class TestChangePassword:
    def test_changes_the_password(self, client):
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        auth = register(client, email=email, password="old-password")

        response = client.put(
            "/me/password",
            json={"current_password": "old-password", "new_password": "new-password"},
            headers=auth,
        )
        assert response.status_code == 200, response.text
        # A fresh token for the device that made the change -- its old one is
        # now stale too (see the next test).
        new_token = response.json()["access_token"]
        assert new_token and new_token != auth["Authorization"].removeprefix("Bearer ")

        # The new password logs in...
        login = client.post("/token", data={"username": email, "password": "new-password"})
        assert login.status_code == 200

        # ...and the old one no longer does.
        old_login = client.post("/token", data={"username": email, "password": "old-password"})
        assert old_login.status_code == 401

    def test_signs_out_other_devices_but_not_the_one_that_changed_it(self, client):
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        auth = register(client, email=email, password="old-password")
        # A second "device": same account, its own token from a second login.
        other_token = client.post(
            "/token", data={"username": email, "password": "old-password"}
        ).json()["access_token"]
        other_device = {"Authorization": f"Bearer {other_token}"}

        response = client.put(
            "/me/password",
            json={"current_password": "old-password", "new_password": "new-password"},
            headers=auth,
        )
        new_auth = {"Authorization": f"Bearer {response.json()['access_token']}"}

        # The device that changed it keeps working on its new token...
        assert client.get("/me", headers=new_auth).status_code == 200
        # ...the token it used to make the change is now stale...
        assert client.get("/me", headers=auth).status_code == 401
        # ...and so is every other device's.
        assert client.get("/me", headers=other_device).status_code == 401

    def test_pre_migration_token_with_no_tv_claim_still_works(self, client):
        """A token minted before migration 0004 added the "tv" claim carries no
        such claim at all. The migration backfills token_version as 0 and its
        docstring promises that backfill doesn't sign anyone out -- so a fresh
        account (token_version still 0) with a "tv"-less token must be accepted
        exactly like one carrying an explicit tv=0 (TODO item 12)."""
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        auth = register(client, email=email, password="password123")
        user_id = client.get("/me", headers=auth).json()["id"]

        legacy_token = jwt.encode({"sub": str(user_id)}, SECRET_KEY, algorithm=ALGORITHM)
        legacy_auth = {"Authorization": f"Bearer {legacy_token}"}

        assert client.get("/me", headers=legacy_auth).status_code == 200

    def test_wrong_current_password_is_rejected(self, client, auth):
        response = client.put(
            "/me/password",
            json={"current_password": "not-it", "new_password": "new-password"},
            headers=auth,
        )
        assert response.status_code == 401

    def test_a_short_new_password_is_422(self, client, auth):
        response = client.put(
            "/me/password",
            json={"current_password": "password123", "new_password": "short"},
            headers=auth,
        )
        assert response.status_code == 422

    def test_requires_a_token(self, client):
        response = client.put(
            "/me/password",
            json={"current_password": "x", "new_password": "new-password"},
        )
        assert response.status_code == 401


class TestPasswordByteLimit:
    """bcrypt's limit is 72 *bytes*, not characters (TODO item 14). "€" is 3
    bytes in UTF-8, so 25 of them is only 25 characters -- comfortably under
    any character-based limit -- but 75 bytes, over bcrypt's limit. Before the
    fix, that passed schema validation and was silently truncated by bcrypt
    before hashing, so the account's real password became "€" * 24 rather
    than what the user actually typed. 24 of them is exactly 72 bytes and
    must still work.
    """

    def test_registering_with_a_too_many_bytes_password_is_422(self, client):
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        response = client.post(
            "/register", json={"email": email, "password": "€" * 25}
        )
        assert response.status_code == 422

    def test_changing_to_a_too_many_bytes_password_is_422(self, client, auth):
        response = client.put(
            "/me/password",
            json={"current_password": "password123", "new_password": "€" * 25},
            headers=auth,
        )
        assert response.status_code == 422

    def test_exactly_72_bytes_of_multi_byte_characters_registers_and_logs_in(
        self, client
    ):
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        password = "€" * 24  # 24 characters, exactly 72 bytes encoded.
        assert len(password.encode("utf-8")) == 72

        response = client.post(
            "/register", json={"email": email, "password": password}
        )
        assert response.status_code == 201, response.text

        login = client.post("/token", data={"username": email, "password": password})
        assert login.status_code == 200

    def test_exactly_72_bytes_of_multi_byte_characters_is_accepted_on_change(
        self, client, auth
    ):
        password = "€" * 24
        response = client.put(
            "/me/password",
            json={"current_password": "password123", "new_password": password},
            headers=auth,
        )
        assert response.status_code == 200, response.text

    def test_ordinary_ascii_passwords_are_unaffected(self, client):
        # The 8-character minimum still applies...
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        short = client.post(
            "/register", json={"email": email, "password": "short"}
        )
        assert short.status_code == 422

        # ...and an ordinary password well under both limits still works.
        auth = register(client, email=email, password="password123")
        assert client.get("/me", headers=auth).status_code == 200


class TestDeleteAccount:
    def test_deletes_the_account_and_its_data(self, client):
        email = f"user-{uuid.uuid4().hex[:12]}@example.com"
        auth = register(client, email=email, password="password123")
        add_subscription(client, auth, name="Netflix")
        client.post("/categories", json={"name": "Streaming"}, headers=auth)

        response = client.request(
            "DELETE", "/me", json={"password": "password123"}, headers=auth
        )
        assert response.status_code == 204

        # The token is still technically valid (nothing revokes it -- see
        # auth.TOKEN_EXPIRE_HOURS) but the user it names is gone, so
        # get_current_user rejects it rather than reanimating the account.
        assert client.get("/me", headers=auth).status_code == 401

        # And the email is free again.
        assert (
            client.post(
                "/register", json={"email": email, "password": "password123"}
            ).status_code
            == 201
        )

    def test_wrong_password_is_rejected_and_nothing_is_deleted(self, client, auth):
        response = client.request(
            "DELETE", "/me", json={"password": "not-it"}, headers=auth
        )
        assert response.status_code == 401
        assert client.get("/me", headers=auth).status_code == 200

    def test_does_not_affect_other_accounts(self, client, auth, other_auth):
        add_subscription(client, other_auth, name="Theirs")

        response = client.request(
            "DELETE", "/me", json={"password": "password123"}, headers=auth
        )
        assert response.status_code == 204

        assert client.get("/me", headers=other_auth).status_code == 200
        assert [s["name"] for s in client.get("/subscriptions", headers=other_auth).json()] == [
            "Theirs"
        ]

    def test_requires_a_token(self, client):
        response = client.request("DELETE", "/me", json={"password": "x"})
        assert response.status_code == 401
