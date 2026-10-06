# Cloudflare Turnstile: the bot check on the two routes that send email to an
# address nobody has proven yet, /register and /password-reset. Rate limits
# key on an address a botnet has thousands of; this is what stops a script
# from walking a list of other people's addresses through either route.
#
# Off unless TURNSTILE_SECRET_KEY is set, which is what local dev and the
# test suite run. The frontend shows the widget only when its own
# TURNSTILE_SITE_KEY is set, so the two are switched on together. For local
# testing, Cloudflare publishes keys that always pass:
#   site key   1x00000000000000000000AA
#   secret     1x0000000000000000000000000000000AA

import logging
import os

import httpx

logger = logging.getLogger("app.turnstile")

SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY") or None
SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _siteverify(token: str, remote_ip: str) -> dict:
    response = httpx.post(
        SITEVERIFY_URL,
        data={"secret": SECRET_KEY, "response": token, "remoteip": remote_ip},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def passes(token: str | None, remote_ip: str) -> bool:
    """True when the check is off, or Cloudflare accepts this token.

    Fails closed: if Cloudflare can't be reached, signup and reset requests
    wait until it can, rather than the check quietly switching itself off.
    """
    if SECRET_KEY is None:
        return True
    if not token:
        return False
    try:
        result = _siteverify(token, remote_ip)
    except Exception:
        logger.exception("turnstile siteverify failed")
        return False
    if not result.get("success"):
        logger.info("turnstile rejected: %s", result.get("error-codes"))
        return False
    return True
