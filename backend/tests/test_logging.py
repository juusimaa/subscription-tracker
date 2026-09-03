# app/main.py's log_requests middleware is the thing TODO.md's "No logging"
# item was about: one structured line per request, since before this a 500 in
# production was only visible in uvicorn's own output.

import logging

import pytest

from app.main import app


class TestRequestLogging:
    def test_logs_method_path_and_status_for_an_ordinary_request(self, client, caplog):
        with caplog.at_level(logging.INFO, logger="app.request"):
            response = client.get("/health")
        assert response.status_code == 200
        messages = [record.getMessage() for record in caplog.records]
        assert any(
            "method=GET" in message and "path=/health" in message and "status=200" in message
            for message in messages
        )

    def test_logs_an_exception_that_escapes_every_route(self, client, caplog):
        # A route that raises something no exception handler catches is the
        # "genuinely unhandled" case log_requests' except branch exists for --
        # everything else in this app (validation errors, 404s, the health
        # check's own 503) is handled long before it gets there. Registered
        # and torn down within the test since nothing like it exists for real.
        async def boom():
            raise RuntimeError("kaboom")

        route = app.get("/__test_boom")(boom)
        try:
            with caplog.at_level(logging.ERROR, logger="app.request"):
                # TestClient re-raises a server-side exception into the test
                # by default -- that re-raise *is* what "unhandled" looks like
                # from the caller's side, so it's expected here, not a failure.
                with pytest.raises(RuntimeError, match="kaboom"):
                    client.get("/__test_boom")
        finally:
            app.router.routes.remove(
                next(r for r in app.router.routes if getattr(r, "endpoint", None) is route)
            )

        assert any(
            record.levelname == "ERROR" and "status=500" in record.getMessage()
            for record in caplog.records
        )
