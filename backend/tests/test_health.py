# /health is the one route Docker calls, and the only one whose *failure* is
# the interesting case: a healthcheck that cannot go red is decoration.

import logging

import pytest
from sqlalchemy.exc import OperationalError

from app.database import get_db
from app.main import app


class UnreachableSession:
    """Stands in for a session whose database is not there.

    A real outage surfaces at the first statement, not at SessionLocal():
    SQLAlchemy connects lazily, so `get_db` itself succeeds even with Postgres
    stopped. That is exactly why the old `return {"status": "ok"}` could not
    fail -- it never asked the database anything -- and it is why this fake
    raises from execute() rather than from the constructor.
    """

    def execute(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    def close(self):
        pass


@pytest.fixture
def unreachable_database():
    """Points the route's `db` dependency at a database that is not answering."""
    app.dependency_overrides[get_db] = lambda: UnreachableSession()
    yield
    app.dependency_overrides.pop(get_db)


class TestHealth:
    def test_reports_ok_when_the_database_answers(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_reports_503_when_the_database_is_unreachable(
        self, client, unreachable_database
    ):
        response = client.get("/health")
        # 503, not 500: the app is up, its dependency is not.
        assert response.status_code == 503
        assert response.json()["detail"] == "Database unavailable"

    def test_the_failure_body_leaks_no_connection_details(
        self, client, unreachable_database
    ):
        # SQLAlchemy's exception text quotes the URL it tried, credentials
        # included, and /health is unauthenticated -- so nothing from the
        # original exception may reach the response.
        body = client.get("/health").text
        assert "connection refused" not in body
        assert "postgresql" not in body
        assert "OperationalError" not in body

    def test_the_failure_is_logged_for_whoever_reads_the_container_output(
        self, client, unreachable_database, caplog
    ):
        # This is the case the comment in main.py calls out specifically: the
        # route converts the SQLAlchemyError into a clean HTTPException, so it
        # never reaches log_requests' except branch as an "unhandled"
        # exception. Without the explicit request_logger.exception call in
        # health() itself, the real cause would appear nowhere -- not in the
        # response (deliberately), and not in any log either.
        with caplog.at_level(logging.ERROR, logger="app.request"):
            client.get("/health")
        assert any(
            record.levelname == "ERROR" and "database unreachable" in record.getMessage()
            for record in caplog.records
        )
