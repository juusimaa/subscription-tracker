# Structured request logging. Before this there was no request log beyond
# uvicorn's own access log, and no path from an unhandled exception or a
# failed /health check to anywhere but stderr -- see TODO.md "No logging".
#
# logfmt-style key=value pairs rather than a JSON formatter: it stays
# grep-able from `docker compose logs` on a laptop, and a real log
# aggregator downstream can still parse key=value if this ever needs to be
# more than that.

import logging
import os

# INFO by default: one line per request is exactly what "no logging" was
# missing, and DEBUG would add SQLAlchemy's own query log on top of it.
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

_configured = False


def configure_logging() -> None:
    """Idempotent so importing app.main more than once (as the test suite
    does indirectly, once per module) doesn't stack duplicate handlers on the
    root logger."""
    global _configured
    if _configured:
        return
    logging.basicConfig(
        level=LOG_LEVEL,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    _configured = True


# One named logger for every request line and everything that used to have
# nowhere to go (the health check's database error, an unhandled exception).
# Named rather than root so a caller can turn this one channel up or down
# without affecting library loggers.
request_logger = logging.getLogger("app.request")
