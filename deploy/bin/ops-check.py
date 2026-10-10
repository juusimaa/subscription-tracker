#!/usr/bin/env python3
"""Operational alerts for the production server (contracts/ops-alerts.md).

Run by the ops-check-*.timer units as the deploy user:

    ops-check.py frequent   memory and root disk, every 5 minutes
    ops-check.py hourly     database size against the plan's storage
    ops-check.py daily      TLS certificate expiry on both hosts

Each check is either firing or not. An email goes to ALERT_EMAIL when a check
starts firing and again when it recovers; nothing is sent while it stays the
same, because these emails share Resend's 100/day free quota with the app.
The state lives in ops-state.json and only advances after a send succeeds,
so a failed send is retried on the next run.

A check that cannot run at all (psql or TLS errors) counts as a failure of
that check, not as a firing alert; three in a row fire `check_error`, so a
blind check is not mistaken for a healthy one.

Standard library only, on purpose (Principle V): it runs on the host's
python3, outside any image, and must not need pip on the server. Every
outside dependency (files, clock, psql, TLS, email) comes in through `Deps`,
so the tests in deploy/tests/test_ops_check.py replace them all.
"""

import json
import os
import socket
import ssl
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

ENV_FILE = Path("/etc/subscription-tracker/.env")
STATE_FILE = Path("/var/lib/subscription-tracker/ops-state.json")

# "Over 80%" in contracts/ops-alerts.md. Compared as integers
# (used * 100 > total * 80) so float rounding never decides the boundary.
THRESHOLD_PERCENT = 80
# Caddy renews at 30 days left. Under 14 means renewal has been failing for
# two weeks, with two left to fix it.
CERT_MIN_LEFT = timedelta(days=14)
# One failed run is usually a restart or a network blip; three in a row means
# the check is blind.
FAILURES_BEFORE_CHECK_ERROR = 3
GIB = 2**30
RUNBOOK = "deploy/README.md § Alerts"


class CheckFailed(Exception):
    """The check could not measure anything; counts toward check_error."""


@dataclass
class Deps:
    config: dict
    state_path: Path
    now: Callable[[], datetime]
    read_meminfo: Callable[[], str]
    statvfs: Callable[[str], os.statvfs_result]
    run_psql: Callable[[str, str], str]
    cert_not_after: Callable[[str], datetime]
    send_email: Callable[[str, str], None]
    http_get: Callable[[str], None]


@dataclass
class Result:
    check: str
    firing: bool
    detail: str
    threshold: str


# --- checks ------------------------------------------------------------------


def check_memory(deps):
    fields = {}
    for line in deps.read_meminfo().splitlines():
        name, _, rest = line.partition(":")
        fields[name] = int(rest.split()[0])
    total, available = fields["MemTotal"], fields["MemAvailable"]
    # MemAvailable, not MemFree: the kernel's own estimate of what can be
    # handed out without swapping, page cache included.
    used = total - available
    return [
        Result(
            "memory",
            used * 100 > total * THRESHOLD_PERCENT,
            f"{used * 100 / total:.1f}% of memory in use",
            f"over {THRESHOLD_PERCENT}%",
        )
    ]


def check_disk(deps):
    st = deps.statvfs("/")
    # df's definition: blocks reserved for root count as neither used nor
    # available, so "100%" is what an unprivileged writer would see.
    used = (st.f_blocks - st.f_bfree) * st.f_frsize
    available = st.f_bavail * st.f_frsize
    size = used + available
    return [
        Result(
            "disk",
            used * 100 > size * THRESHOLD_PERCENT,
            f"{used * 100 / size:.1f}% of / in use",
            f"over {THRESHOLD_PERCENT}%",
        )
    ]


def check_db_size(deps):
    storage_gib = int(deps.config["DB_STORAGE_GIB"])
    try:
        size = int(
            deps.run_psql(
                libpq_url(deps.config["DATABASE_URL"]),
                "SELECT pg_database_size(current_database())",
            ).strip()
        )
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise CheckFailed(f"psql: {type(exc).__name__}") from exc
    limit = storage_gib * GIB
    return [
        Result(
            "db_size",
            size * 100 > limit * THRESHOLD_PERCENT,
            f"{size / GIB:.1f} GiB of {storage_gib} GiB ({size * 100 / limit:.1f}%)",
            f"over {THRESHOLD_PERCENT}% of DB_STORAGE_GIB",
        )
    ]


def check_certs(deps):
    results = []
    failed = []
    for host in (deps.config["APP_HOST"], deps.config["API_HOST"]):
        check = f"cert:{host}"
        threshold = f"under {CERT_MIN_LEFT.days} days left"
        try:
            left = deps.cert_not_after(host) - deps.now()
        except ssl.SSLCertVerificationError:
            # Expired, wrong host, untrusted: exactly what this alert is for.
            results.append(Result(check, True, "certificate invalid", threshold))
            continue
        except OSError:
            failed.append(host)
            continue
        results.append(Result(check, left < CERT_MIN_LEFT, f"expires in {left.days} days", threshold))
    if failed:
        # Reported after the hosts that did answer, so their results still
        # count.
        raise CheckFailed(f"TLS probe failed for {', '.join(failed)}", results)
    return results


# Which checks each timer runs, and the name a failure is counted under.
CHECKS = {
    "frequent": [("memory", check_memory), ("disk", check_disk)],
    "hourly": [("db_size", check_db_size)],
    "daily": [("cert", check_certs)],
}


# --- state and transitions -----------------------------------------------------


def load_state(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}


def save_state(path, state):
    # Temp file in the same directory, then rename: a crash mid-write leaves
    # the old file, never a truncated one that would re-send every alert.
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".ops-state.")
    with os.fdopen(fd, "w") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def transition(result, state, deps):
    """Sends ALERT or RECOVERED if the check changed, then records it.
    Returns False if a needed email could not be sent."""
    entry = state.setdefault(result.check, {"firing": False, "since": None, "detail": ""})
    if result.firing == entry["firing"]:
        return True
    now = deps.now().isoformat()
    word = "ALERT" if result.firing else "RECOVERED"
    subject = f"[subscriptionstrack] {word} {result.check}: {result.detail}"
    body = (
        f"{word}: {result.check}\n\n"
        f"Measured:  {result.detail}\n"
        f"Threshold: {result.threshold}\n"
        f"Time:      {now}\n\n"
        f"What to do: {RUNBOOK}\n"
    )
    try:
        deps.send_email(subject, body)
    except Exception as exc:  # noqa: BLE001 - any failure means "retry next run"
        print(f"ops-check: could not send {word} {result.check}: {type(exc).__name__}", file=sys.stderr)
        return False
    entry.update(firing=result.firing, since=now, detail=result.detail)
    return True


def run(kind, deps):
    state = load_state(deps.state_path)
    ok = True
    results = []

    for name, check in CHECKS[kind]:
        counter = state.setdefault(f"errors:{name}", {"consecutive": 0})
        try:
            results.extend(check(deps))
            counter["consecutive"] = 0
        except CheckFailed as exc:
            if len(exc.args) > 1:
                results.extend(exc.args[1])
            counter["consecutive"] += 1
            print(f"ops-check: {name} could not run: {exc.args[0]}", file=sys.stderr)

    blind = sorted(
        key.removeprefix("errors:")
        for key, value in state.items()
        if key.startswith("errors:") and value["consecutive"] >= FAILURES_BEFORE_CHECK_ERROR
    )
    results.append(
        Result(
            "check_error",
            bool(blind),
            f"{', '.join(blind)} could not run {FAILURES_BEFORE_CHECK_ERROR} times in a row" if blind else "every check runs",
            f"{FAILURES_BEFORE_CHECK_ERROR} consecutive failed runs",
        )
    )

    for result in results:
        ok = transition(result, state, deps) and ok

    save_state(deps.state_path, state)

    url = deps.config.get("UPTIMEROBOT_HEARTBEAT_URL")
    if kind == "frequent" and url:
        try:
            deps.http_get(url)
        except OSError as exc:
            # The heartbeat monitor alerts on its own when pings stop; one
            # missed ping is not worth failing the run for.
            print(f"ops-check: heartbeat failed: {type(exc).__name__}", file=sys.stderr)

    return 0 if ok else 1


# --- real collaborators ----------------------------------------------------------


def read_env_file(path):
    """KEY=VALUE lines, # comments, optional surrounding quotes. Compose's
    env-file format, as far as this file uses it; no third-party dotenv."""
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def libpq_url(url):
    """DATABASE_URL is written for SQLAlchemy (postgresql+psycopg://...);
    psql only accepts the plain scheme."""
    scheme, sep, rest = url.partition("://")
    return scheme.split("+")[0] + sep + rest


def real_psql(url, sql):
    # psql from the same postgres:18 image the runbooks use, so the host
    # needs no client package. The URL travels as an environment variable,
    # never as an argument, so it doesn't show in `ps`. The config directory
    # is mounted for sslrootcert=/etc/subscription-tracker/upcloud-ca.pem.
    return subprocess.run(
        [
            "docker", "run", "--rm", "-e", "PSQL_URL",
            "-v", "/etc/subscription-tracker:/etc/subscription-tracker:ro",
            "postgres:18", "sh", "-c", 'exec psql "$PSQL_URL" -tAc "$0"', sql,
        ],
        env={**os.environ, "PSQL_URL": url},
        capture_output=True, text=True, timeout=60, check=True,
    ).stdout


def real_cert_not_after(host):
    # Verified like a browser would, so an expired or mismatched certificate
    # raises SSLCertVerificationError, which check_certs reports as invalid.
    context = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=10) as sock:
        with context.wrap_socket(sock, server_hostname=host) as tls:
            not_after = tls.getpeercert()["notAfter"]
    return datetime.fromtimestamp(ssl.cert_time_to_seconds(not_after), timezone.utc)


def make_sender(config):
    def send(subject, body):
        request = urllib.request.Request(
            "https://api.resend.com/emails",
            data=json.dumps(
                {"from": config["EMAIL_FROM"], "to": [config["ALERT_EMAIL"]], "subject": subject, "text": body}
            ).encode(),
            headers={"Authorization": f"Bearer {config['RESEND_API_KEY']}", "Content-Type": "application/json"},
            method="POST",
        )
        # urlopen raises on any non-2xx, which is what marks the send failed.
        with urllib.request.urlopen(request, timeout=15):
            pass

    return send


def real_http_get(url):
    with urllib.request.urlopen(url, timeout=10):
        pass


def main(argv):
    if len(argv) != 2 or argv[1] not in CHECKS:
        print(f"usage: {argv[0]} {{{'|'.join(CHECKS)}}}", file=sys.stderr)
        return 64
    config = read_env_file(ENV_FILE)
    deps = Deps(
        config=config,
        state_path=STATE_FILE,
        now=lambda: datetime.now(timezone.utc),
        read_meminfo=lambda: Path("/proc/meminfo").read_text(),
        statvfs=os.statvfs,
        run_psql=real_psql,
        cert_not_after=real_cert_not_after,
        send_email=make_sender(config),
        http_get=real_http_get,
    )
    return run(argv[1], deps)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
