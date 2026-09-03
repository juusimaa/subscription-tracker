# TODO.md item 4: allow_origins used to be a hardcoded
# ["http://localhost:5173"], which was correct for local Compose and wrong
# everywhere else. It now comes from CORS_ORIGINS (comma-separated, same
# env-var-with-a-local-default pattern as DATABASE_URL), and the point of
# this test is to prove the browser-facing behaviour, not just that a list
# gets built: an allowed origin is echoed back, everything else is not.

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_configured_origin_is_allowed():
    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_other_origins_are_not_allowed():
    response = client.options(
        "/health",
        headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in response.headers
