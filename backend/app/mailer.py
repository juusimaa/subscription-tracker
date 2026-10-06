# Outgoing email: verification and password-reset links (PLAN.md milestone 9).
# Named mailer rather than email so it can never shadow the standard
# library's `email` package, which email-validator imports.
#
# One send_email() behind an EMAIL_BACKEND switch, so the provider is one
# function to replace rather than something the routes know about:
#
#   console  (default) logs the message, link included. Enough for local dev:
#            the link is in `docker compose logs backend`.
#   resend   one HTTPS POST to Resend's API (production).
#   memory   appends to `outbox` below. The test suite's choice.
#
# Routes call these from FastAPI BackgroundTasks, after the response is
# built, so a slow provider never slows a request and response timing never
# reveals whether an address has an account. A failed send is logged, never
# raised: there is no request left to fail by then.

import html
import logging
import os

import httpx

logger = logging.getLogger("app.mailer")

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "console").lower()
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
EMAIL_FROM = os.getenv("EMAIL_FROM", "Subscription Tracker <no-reply@localhost>")
# Where links in emails point: the frontend, not this API. The frontend reads
# ?verify= and ?reset= on load (frontend/src/linkParams.js).
APP_URL = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")

RESEND_ENDPOINT = "https://api.resend.com/emails"

# Caps on what any one day can send (crud.claim_email_slot, applied by the
# routes before they queue a message). Resend's free tier allows 100 a day;
# stopping short of that keeps the provider from refusing mail outright,
# which would take password reset down with it. Per address, enough for a
# real person's signup, a couple of resends and a reset, and too few to
# flood anyone's inbox.
EMAIL_DAILY_CAP = int(os.getenv("EMAIL_DAILY_CAP", "90"))
EMAILS_PER_ADDRESS_PER_DAY = 5

# Every message the memory backend has "sent", oldest first.
outbox: list[dict] = []

if EMAIL_BACKEND == "resend" and not RESEND_API_KEY:
    # Same reasoning as SECRET_KEY in auth.py: a production deploy that
    # silently sends nothing is worse than one that refuses to start.
    raise RuntimeError("EMAIL_BACKEND=resend needs RESEND_API_KEY to be set.")


def send_email(to: str, subject: str, text: str, html_body: str) -> None:
    message = {"to": to, "subject": subject, "text": text, "html": html_body}
    try:
        if EMAIL_BACKEND == "resend":
            response = httpx.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={
                    "from": EMAIL_FROM,
                    "to": [to],
                    "subject": subject,
                    "text": text,
                    "html": html_body,
                },
                timeout=10,
            )
            response.raise_for_status()
        elif EMAIL_BACKEND == "memory":
            outbox.append(message)
        else:
            logger.info("email to=%s subject=%r\n%s", to, subject, text)
    except Exception:
        # The address is logged, the body is not: the body holds a live link.
        logger.exception("email send failed to=%s subject=%r", to, subject)


def _html(lead: str, rest: list[str], link: str, button: str) -> str:
    """The HTML part: system font, one square Ink button, no images and no
    tracking pixel. Mail clients ignore most CSS, so it is all inline."""
    ink = "#201e1d"

    def para(text: str) -> str:
        return f'<p style="margin:0 0 16px">{html.escape(text)}</p>'

    return (
        '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\','
        f'Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:{ink};'
        'max-width:520px">'
        f"{para(lead)}"
        f'<p style="margin:24px 0"><a href="{html.escape(link)}" '
        f'style="display:inline-block;background:{ink};color:#f3f2f2;'
        'padding:12px 20px;text-decoration:none;font-weight:700">'
        f"{html.escape(button)}</a></p>"
        f"{''.join(para(p) for p in rest)}"
        '<p style="margin:0;font-size:13px;color:#605d5d">'
        f"Or paste this link into your browser:<br>{html.escape(link)}</p>"
        "</div>"
    )


def send_verification_email(to: str, token: str) -> None:
    link = f"{APP_URL}/?verify={token}"
    lead = f"Confirm that {to} is your address for Subscription Tracker."
    rest = [
        "The link works for 48 hours. Once your address is confirmed, you "
        "can reset your password by email if you ever forget it.",
        "If you didn't create a Subscription Tracker account, ignore this "
        "email. Nothing will happen.",
    ]
    text = "\n\n".join([lead, link, *rest])
    send_email(
        to,
        "Confirm your email for Subscription Tracker",
        text,
        _html(lead, rest, link, "Confirm email"),
    )


def send_password_reset_email(to: str, token: str) -> None:
    link = f"{APP_URL}/?reset={token}"
    lead = f"Someone asked to reset the Subscription Tracker password for {to}."
    rest = [
        "The link works once, for 1 hour. Setting a new password signs you "
        "out on every other device.",
        "If you didn't ask for this, ignore this email. Your password has "
        "not changed.",
    ]
    text = "\n\n".join([lead, link, *rest])
    send_email(
        to,
        "Reset your Subscription Tracker password",
        text,
        _html(lead, rest, link, "Choose a new password"),
    )


def send_already_registered_email(to: str) -> None:
    """Sent when someone signs up with an address that already has a verified
    account. /register answers the same either way, so this email is the
    only place that says the account exists, and only its owner reads it."""
    link = f"{APP_URL}/"
    lead = f"Someone tried to create a Subscription Tracker account for {to}, but you already have one."
    rest = [
        "If that was you, sign in instead. If you've forgotten your password, "
        "choose \"Forgot password?\" on the sign-in screen.",
        "If it wasn't you, ignore this email. Nothing about your account has changed.",
    ]
    text = "\n\n".join([lead, link, *rest])
    send_email(
        to,
        "You already have a Subscription Tracker account",
        text,
        _html(lead, rest, link, "Sign in"),
    )


def send_finish_signup_email(to: str, token: str) -> None:
    """Sent when someone signs up with an address whose account was created
    but never confirmed. The link is a password-reset link: whoever reads this
    inbox chooses the password, so an account someone else opened with this
    address can't be confirmed with *their* password still on it."""
    link = f"{APP_URL}/?reset={token}"
    lead = f"Finish creating your Subscription Tracker account for {to} by choosing a password."
    rest = [
        "This address was used to sign up before, but never confirmed. The "
        "link works once, for 1 hour, and confirms your address too.",
        "If you didn't sign up, ignore this email. Nothing will happen.",
    ]
    text = "\n\n".join([lead, link, *rest])
    send_email(
        to,
        "Finish creating your Subscription Tracker account",
        text,
        _html(lead, rest, link, "Choose a password"),
    )
