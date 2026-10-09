"""ops-check.py's alert rules (contracts/ops-alerts.md): the 80% thresholds,
the 14-day certificate window, one email per crossing, retry on a failed
send, and check_error after three failed runs.

Every collaborator is a fake: /proc/meminfo text, statvfs, psql, the TLS
probe, the email sender and the clock. Nothing touches the host, the network
or the wall clock (Principle II).
"""

import importlib.util
import json
import os
import ssl
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "ops-check.py"
spec = importlib.util.spec_from_file_location("ops_check", SCRIPT)
ops_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops_check)

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
GIB = 2**30


class Fakes:
    """Mutable fakes the tests adjust between runs."""

    def __init__(self, tmp_path):
        self.mem_total_kb = 1_000_000
        self.mem_available_kb = 500_000
        self.disk = os.statvfs_result((4096, 4096, 1000, 500, 500, 0, 0, 0, 0, 255))
        self.db_bytes = 1 * GIB
        self.psql_error = None
        self.cert_expiry = {"app.test": NOW + timedelta(days=60), "api.test": NOW + timedelta(days=60)}
        self.cert_error = {}
        self.send_ok = True
        self.sent = []
        self.gets = []
        self.now = NOW
        self.state_path = tmp_path / "ops-state.json"
        self.config = {
            "ALERT_EMAIL": "ops@example.test",
            "EMAIL_FROM": "Alerts <alerts@example.test>",
            "RESEND_API_KEY": "fake",
            "DB_STORAGE_GIB": "10",
            "DATABASE_URL": "postgresql+psycopg://u:p@db.test:5432/app",
            "APP_HOST": "app.test",
            "API_HOST": "api.test",
        }

    def meminfo(self):
        return (
            f"MemTotal:       {self.mem_total_kb} kB\n"
            f"MemFree:          12345 kB\n"
            f"MemAvailable:   {self.mem_available_kb} kB\n"
        )

    def psql(self, url, sql):
        if self.psql_error:
            raise self.psql_error
        return str(self.db_bytes)

    def cert_not_after(self, host):
        if host in self.cert_error:
            raise self.cert_error[host]
        return self.cert_expiry[host]

    def send(self, subject, body):
        if not self.send_ok:
            raise OSError("resend unreachable")
        self.sent.append((subject, body))

    def deps(self):
        return ops_check.Deps(
            config=self.config,
            state_path=self.state_path,
            now=lambda: self.now,
            read_meminfo=self.meminfo,
            statvfs=lambda path: self.disk,
            run_psql=self.psql,
            cert_not_after=self.cert_not_after,
            send_email=self.send,
            http_get=self.gets.append,
        )

    def run(self, kind):
        return ops_check.run(kind, self.deps())

    def state(self):
        return json.loads(self.state_path.read_text()) if self.state_path.exists() else {}

    def subjects(self):
        return [s for s, _ in self.sent]


@pytest.fixture
def fakes(tmp_path):
    return Fakes(tmp_path)


# --- thresholds: exactly 80% is fine, anything over fires ---------------------


def test_memory_at_exactly_80_percent_does_not_fire(fakes):
    """The rule is "over 80%", so the boundary itself stays quiet; integer
    arithmetic keeps float rounding from deciding it."""
    fakes.mem_available_kb = 200_000
    fakes.run("frequent")
    assert fakes.sent == []


def test_memory_just_over_80_percent_fires(fakes):
    """FR-028: memory pressure is reported before the OOM killer acts."""
    fakes.mem_available_kb = 199_999
    fakes.run("frequent")
    assert fakes.subjects() == ["[subscriptionstrack] ALERT memory: 80.0% of memory in use"]


def test_disk_at_exactly_80_percent_does_not_fire(fakes):
    """Used / (used + available), as df reports it: 800 used, 200 free."""
    fakes.disk = os.statvfs_result((4096, 4096, 1000, 200, 200, 0, 0, 0, 0, 255))
    fakes.run("frequent")
    assert fakes.sent == []


def test_disk_just_over_80_percent_fires(fakes):
    """Edge case "disk full": the warning comes while there is still room to act."""
    fakes.disk = os.statvfs_result((4096, 4096, 1000, 199, 199, 0, 0, 0, 0, 255))
    fakes.run("frequent")
    assert fakes.subjects() == ["[subscriptionstrack] ALERT disk: 80.1% of / in use"]


def test_database_at_exactly_80_percent_of_plan_storage_does_not_fire(fakes):
    fakes.db_bytes = 8 * GIB
    fakes.run("hourly")
    assert fakes.sent == []


def test_database_just_over_80_percent_of_plan_storage_fires(fakes):
    """FR-028: the plan's storage must be grown before the database fills it."""
    fakes.db_bytes = 8 * GIB + 1
    fakes.run("hourly")
    assert fakes.subjects() == ["[subscriptionstrack] ALERT db_size: 8.0 GiB of 10 GiB (80.0%)"]


# --- certificates: under 14 days fires ----------------------------------------


def test_certificate_with_exactly_14_days_left_does_not_fire(fakes):
    fakes.cert_expiry["app.test"] = NOW + timedelta(days=14)
    fakes.run("daily")
    assert fakes.sent == []


def test_certificate_with_13_days_23_hours_left_fires(fakes):
    """Caddy renews at 30 days left; 14 means renewal has been failing for
    two weeks and there are two left to fix it."""
    fakes.cert_expiry["api.test"] = NOW + timedelta(days=13, hours=23)
    fakes.run("daily")
    assert fakes.subjects() == ["[subscriptionstrack] ALERT cert:api.test: expires in 13 days"]


def test_an_invalid_certificate_fires_the_cert_alert_at_once(fakes):
    """An expired or wrong certificate fails verification. That is the
    condition this alert exists for, not a check that failed to run."""
    fakes.cert_error["app.test"] = ssl.SSLCertVerificationError("certificate has expired")
    fakes.run("daily")
    assert fakes.subjects() == ["[subscriptionstrack] ALERT cert:app.test: certificate invalid"]


# --- one email per crossing -----------------------------------------------------


def test_a_condition_that_persists_sends_one_email_in_total(fakes):
    """Alert email shares Resend's 100/day with the app's own email; repeats
    every 5 minutes would use it up and bury the signal."""
    fakes.mem_available_kb = 10_000
    for _ in range(4):
        fakes.run("frequent")
    assert len(fakes.sent) == 1


def test_recovery_sends_exactly_one_recovered_email(fakes):
    fakes.mem_available_kb = 10_000
    fakes.run("frequent")
    fakes.mem_available_kb = 500_000
    fakes.run("frequent")
    fakes.run("frequent")
    assert fakes.subjects() == [
        "[subscriptionstrack] ALERT memory: 99.0% of memory in use",
        "[subscriptionstrack] RECOVERED memory: 50.0% of memory in use",
    ]


def test_a_failed_send_leaves_the_state_unchanged_so_the_next_run_retries(fakes):
    """If Resend is down, the alert must not be marked as sent and then
    never arrive."""
    fakes.mem_available_kb = 10_000
    fakes.send_ok = False
    assert fakes.run("frequent") == 1
    assert fakes.state().get("memory", {}).get("firing") is not True
    fakes.send_ok = True
    fakes.run("frequent")
    assert len(fakes.sent) == 1
    assert fakes.state()["memory"]["firing"] is True


def test_state_records_firing_since_and_detail(fakes):
    """The shape data-model.md § Alert state documents, so an operator can
    read the file by eye."""
    fakes.mem_available_kb = 10_000
    fakes.run("frequent")
    entry = fakes.state()["memory"]
    assert entry["firing"] is True
    assert entry["since"] == "2026-10-09T12:00:00+00:00"
    assert entry["detail"] == "99.0% of memory in use"


def test_alert_body_names_value_threshold_time_and_runbook(fakes):
    """The email must be actionable on its own, from a phone."""
    fakes.mem_available_kb = 10_000
    fakes.run("frequent")
    body = fakes.sent[0][1]
    assert "99.0% of memory in use" in body
    assert "over 80%" in body
    assert "2026-10-09T12:00:00+00:00" in body
    assert "deploy/README.md § Alerts" in body


# --- check_error ------------------------------------------------------------------


def test_check_error_fires_only_on_the_third_consecutive_failure(fakes):
    """One failed psql run is noise (a restart, a network blip); three in a
    row means the check is blind, which must not stay silent."""
    fakes.psql_error = OSError("connection refused")
    fakes.run("hourly")
    fakes.run("hourly")
    assert fakes.sent == []
    fakes.run("hourly")
    assert fakes.subjects() == ["[subscriptionstrack] ALERT check_error: db_size could not run 3 times in a row"]


def test_a_successful_run_resets_the_failure_count(fakes):
    fakes.psql_error = OSError("connection refused")
    fakes.run("hourly")
    fakes.run("hourly")
    fakes.psql_error = None
    fakes.run("hourly")
    fakes.psql_error = OSError("connection refused")
    fakes.run("hourly")
    fakes.run("hourly")
    assert fakes.sent == []


def test_check_error_recovers_when_the_check_runs_again(fakes):
    fakes.psql_error = OSError("connection refused")
    for _ in range(3):
        fakes.run("hourly")
    fakes.psql_error = None
    fakes.run("hourly")
    assert fakes.subjects()[-1] == "[subscriptionstrack] RECOVERED check_error: every check runs"


# --- heartbeat ----------------------------------------------------------------------


def test_no_heartbeat_without_a_url(fakes):
    fakes.run("frequent")
    assert fakes.gets == []


def test_frequent_run_pings_the_heartbeat_url_when_set(fakes):
    """A dead server sends no alerts; UptimeRobot's heartbeat monitor notices
    the pings stopping instead (research R8)."""
    fakes.config["UPTIMEROBOT_HEARTBEAT_URL"] = "https://heartbeat.example.test/abc"
    fakes.run("frequent")
    assert fakes.gets == ["https://heartbeat.example.test/abc"]


# --- helpers ----------------------------------------------------------------------------


def test_env_file_parser_reads_plain_and_quoted_values_and_skips_comments(tmp_path):
    """No third-party dotenv (Principle V), so the parser itself is tested."""
    env = tmp_path / ".env"
    env.write_text('# comment\n\nA=1\nB="two words"\nC=\'x\'\nD=a=b\n')
    assert ops_check.read_env_file(env) == {"A": "1", "B": "two words", "C": "x", "D": "a=b"}


def test_psql_url_drops_the_sqlalchemy_driver_suffix():
    """DATABASE_URL is written for SQLAlchemy (postgresql+psycopg://); psql
    only understands postgresql://."""
    assert (
        ops_check.libpq_url("postgresql+psycopg://u:p@h:5432/d?sslmode=require")
        == "postgresql://u:p@h:5432/d?sslmode=require"
    )
