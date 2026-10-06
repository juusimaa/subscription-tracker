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
# whose answers carry the hostname example.com, so local testing sets
# TURNSTILE_HOSTNAMES=example.com alongside them.
#
# A passing answer must also name the form it was solved on (the widget's
# action) and a hostname of ours: Cloudflare says a token is good, not that
# it came from this site's signup form. A token solved on some other page
# that uses the same site key, or on the reset form, doesn't open the other.

import logging
import os

import httpx

logger = logging.getLogger("app.turnstile")

SECRET_KEY = os.getenv("TURNSTILE_SECRET_KEY") or None
# The frontend hostnames a token may be solved on, comma-separated. Production
# lists only its own domains, never localhost.
HOSTNAMES = {
    host.strip() for host in os.getenv("TURNSTILE_HOSTNAMES", "").split(",") if host.strip()
}
SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _siteverify(token: str, remote_ip: str) -> dict:
    response = httpx.post(
        SITEVERIFY_URL,
        data={"secret": SECRET_KEY, "response": token, "remoteip": remote_ip},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def passes(token: str | None, remote_ip: str, action: str) -> bool:
    """True when the check is off, or Cloudflare accepts this token as solved
    on the `action` form at one of HOSTNAMES.

    Fails closed: if Cloudflare can't be reached, or HOSTNAMES was left
    empty, signup and reset requests wait until that's fixed, rather than
    the check quietly switching itself off.
    """
    if SECRET_KEY is None:
        return True
    if not HOSTNAMES:
        logger.error("TURNSTILE_SECRET_KEY is set but TURNSTILE_HOSTNAMES is empty")
        return False
    if not token or len(token) > 2048:
        return False
    try:
        result = _siteverify(token, remote_ip)
    except Exception:
        logger.exception("turnstile siteverify failed")
        return False
    if not result.get("success"):
        logger.info("turnstile rejected: %s", result.get("error-codes"))
        return False
    if result.get("hostname") not in HOSTNAMES:
        logger.info("turnstile token from another hostname: %s", result.get("hostname"))
        return False
    # Cloudflare's test secrets answer without an action, and a real secret
    # never gets a test answer, so only those skip the action check.
    testing = (result.get("metadata") or {}).get("result_with_testing_key") is True
    if result.get("action") != action and not testing:
        logger.info("turnstile token for another action: %s", result.get("action"))
        return False
    return True
