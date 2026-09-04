# INVITE_CODE (see app/main.py, PLAN.md milestone 7) is unset for the whole
# suite by default, so every other test's register() call -- which sends no
# invite_code at all -- keeps working unmodified. This file is the one place
# that turns the gate on, for exactly as long as it needs it, and always
# clears it afterwards so it never leaks into whatever test runs next.

from contextlib import contextmanager

import app.main as main


@contextmanager
def invite_code_set(code: str):
    main.INVITE_CODE = code
    try:
        yield
    finally:
        main.INVITE_CODE = None


class TestInviteCode:
    def test_disabled_by_default_for_the_rest_of_the_suite(self):
        # Guards the fixture itself: if INVITE_CODE stopped being read, or a
        # previous test in this file left it set, this would start failing
        # here instead of silently passing everywhere else that matters.
        assert main.INVITE_CODE is None

    def test_register_rejected_without_a_code_when_one_is_required(self, client):
        with invite_code_set("let-me-in"):
            response = client.post(
                "/register", json={"email": "nocode@example.com", "password": "password123"}
            )
            assert response.status_code == 403

    def test_register_rejected_with_the_wrong_code(self, client):
        with invite_code_set("let-me-in"):
            response = client.post(
                "/register",
                json={
                    "email": "wrongcode@example.com",
                    "password": "password123",
                    "invite_code": "not-it",
                },
            )
            assert response.status_code == 403

    def test_register_succeeds_with_the_right_code(self, client):
        with invite_code_set("let-me-in"):
            response = client.post(
                "/register",
                json={
                    "email": "rightcode@example.com",
                    "password": "password123",
                    "invite_code": "let-me-in",
                },
            )
            assert response.status_code == 201, response.text

    def test_wrong_code_rejected_before_the_email_uniqueness_check(self, client):
        # If the invite check ran after the email lookup, re-registering a
        # taken address without a code would come back 400 ("Email already
        # registered") instead of 403, leaking that the address is taken to a
        # caller who never proved they hold a valid invite code.
        taken_email = "taken@example.com"
        assert (
            client.post(
                "/register", json={"email": taken_email, "password": "password123"}
            ).status_code
            == 201
        )
        with invite_code_set("let-me-in"):
            response = client.post(
                "/register", json={"email": taken_email, "password": "password123"}
            )
            assert response.status_code == 403
