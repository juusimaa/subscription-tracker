# conftest.py sets RATE_LIMIT_ENABLED=false for the whole suite, since nearly
# every other test creates an account via the register() helper and a
# 5-per-minute budget shared across a full pytest run would start rejecting
# registrations for reasons unrelated to what those tests check. This file is
# the one place that turns the limiter back on, for exactly as long as it
# needs it, and always resets its counters afterwards so it never leaks into
# whatever test happens to run next.

import uuid
from contextlib import contextmanager

from app.main import limiter


@contextmanager
def rate_limiting_enabled():
    limiter.enabled = True
    limiter.reset()
    try:
        yield
    finally:
        limiter.enabled = False
        limiter.reset()


def _unique_email() -> str:
    return f"user-{uuid.uuid4().hex[:12]}@example.com"


class TestRateLimit:
    def test_register_is_throttled_after_five_attempts_per_minute(self, client):
        with rate_limiting_enabled():
            for _ in range(5):
                response = client.post(
                    "/register",
                    json={"email": _unique_email(), "password": "password123"},
                )
                assert response.status_code == 201, response.text
            # The 6th request in the same window is refused before it ever
            # reaches crud.create_user -- a fresh, never-seen-before email
            # would otherwise succeed.
            response = client.post(
                "/register",
                json={"email": _unique_email(), "password": "password123"},
            )
            assert response.status_code == 429

    def test_token_is_throttled_after_five_attempts_per_minute(self, client):
        email = _unique_email()
        password = "password123"
        # Created with the limiter off, so this setup call doesn't eat into
        # the budget the assertions below are actually about.
        assert (
            client.post("/register", json={"email": email, "password": password}).status_code
            == 201
        )

        with rate_limiting_enabled():
            for _ in range(5):
                response = client.post(
                    "/token", data={"username": email, "password": "wrong-password"}
                )
                assert response.status_code == 401
            # Proves this throttles by remote address, not by failure count:
            # the 6th attempt is refused even with the *correct* password.
            response = client.post("/token", data={"username": email, "password": password})
            assert response.status_code == 429

    def test_disabled_by_default_for_the_rest_of_the_suite(self, client):
        # Guards the fixture itself: if RATE_LIMIT_ENABLED stopped being read,
        # or a previous test in this file left the limiter enabled, this
        # would start failing here instead of silently passing everywhere
        # that matters.
        assert limiter.enabled is False
        for _ in range(6):
            response = client.post(
                "/register",
                json={"email": _unique_email(), "password": "password123"},
            )
            assert response.status_code == 201, response.text
