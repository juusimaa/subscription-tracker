# Account management: changing a password and deleting an account. Both are
# self-service and both require the current password again, even though the
# request already carries a valid Bearer token -- see the docstrings on
# schemas.PasswordChange and schemas.AccountDelete for why.

import uuid

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
        assert response.json()["email"] == email

        # The new password logs in...
        login = client.post("/token", data={"username": email, "password": "new-password"})
        assert login.status_code == 200

        # ...and the old one no longer does.
        old_login = client.post("/token", data={"username": email, "password": "old-password"})
        assert old_login.status_code == 401

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
