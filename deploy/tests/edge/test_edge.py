"""What the public edge promises (contracts/edge-http.md), checked against
the production Compose file and Caddyfile with both images built from this
checkout. See compose.edge.yml for how the test stack differs from
production, and why those differences don't touch what is tested here.

Requests go to Caddy's published port on 127.0.0.1 with the real hostname
as SNI and Host, verified against Caddy's internal root certificate rather
than with verification turned off, so TLS is exercised too.
"""

import http.client
import json
import os
import socket
import ssl
import subprocess
import time
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.edge

DEPLOY = Path(__file__).resolve().parents[2]
APP_HOST = "app.localhost"
API_HOST = "api.localhost"
MAINTENANCE_TEXT = "We'll be right back"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Stack:
    def __init__(self, flags_dir):
        self.flags_dir = flags_dir
        self.port = free_port()
        self.project = f"edge-{uuid.uuid4().hex[:8]}"
        self.env = {
            **os.environ,
            # Relative to deploy/, the project directory.
            "ENV_FILE": "tests/sample.env",
            "CADDY_TEST_GLOBALS": "local_certs",
            "EDGE_HTTPS_PORT": str(self.port),
            "EDGE_FLAGS_DIR": str(flags_dir),
        }
        self.context = None

    def compose(self, *args, check=True):
        return subprocess.run(
            [
                "docker", "compose", "-p", self.project,
                "-f", str(DEPLOY / "compose.prod.yml"),
                "-f", str(DEPLOY / "tests" / "edge" / "compose.edge.yml"),
                "--env-file", str(DEPLOY / "tests" / "sample.env"),
                *args,
            ],
            env=self.env, capture_output=True, text=True, check=check, timeout=900,
        )

    def trust_caddy_root(self):
        """Caddy creates its internal CA on first start; wait for it, then
        trust only that root."""
        for _ in range(60):
            result = self.compose(
                "exec", "-T", "caddy", "cat", "/data/caddy/pki/authorities/local/root.crt", check=False
            )
            if result.returncode == 0 and "BEGIN CERTIFICATE" in result.stdout:
                self.context = ssl.create_default_context(cadata=result.stdout)
                return
            time.sleep(1)
        raise RuntimeError("Caddy's internal root certificate never appeared")

    def request(self, host, method, path, body=None, headers=None):
        """One HTTPS request to `host` through Caddy's published port."""
        last_error = None
        # Certificates for the two sites are issued just after start; retry
        # the handshake briefly rather than racing it.
        for _ in range(30):
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=10)
            try:
                tls = self.context.wrap_socket(sock, server_hostname=host)
            except (ssl.SSLError, ConnectionError) as exc:
                sock.close()
                last_error = exc
                time.sleep(1)
                continue
            conn = http.client.HTTPConnection(host, self.port, timeout=10)
            conn.sock = tls
            conn.request(method, path, body=body, headers={"Host": host, **(headers or {})})
            response = conn.getresponse()
            text = response.read().decode("utf-8", "replace")
            conn.close()
            return response.status, response.headers, text
        raise last_error

    def wait_for_status(self, host, status):
        """Polls `GET /` until it answers `status`, for up to 5 s. The flag is
        a host file seen through a bind mount; on Docker Desktop (macOS) a
        change can take a moment to reach the container. Still no reload or
        restart is involved, which is what the tests check."""
        for _ in range(50):
            if self.request(host, "GET", "/")[0] == status:
                return
            time.sleep(0.1)
        raise AssertionError(f"{host} never answered {status}")

    def inspect(self, service, template):
        cid = self.compose("ps", "-q", service).stdout.strip()
        return subprocess.run(
            ["docker", "inspect", "-f", template, cid],
            capture_output=True, text=True, check=True,
        ).stdout.strip()

    def started_at(self, service):
        return self.inspect(service, "{{.State.StartedAt}}")

    def published_ports(self, service):
        """The container's host port bindings, read from Docker itself:
        `docker compose port`'s text for an unpublished port differs between
        Compose versions."""
        return json.loads(self.inspect(service, "{{json .HostConfig.PortBindings}}")) or {}


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    flags = tmp_path_factory.mktemp("flags")
    stack = Stack(flags)
    try:
        up = stack.compose("up", "-d", "--build", "--wait", "--wait-timeout", "300", check=False)
        if up.returncode != 0:
            logs = stack.compose("logs", "--no-color", check=False).stdout
            pytest.fail(f"edge stack did not start:\n{up.stderr}\n{logs[-4000:]}")
        stack.trust_caddy_root()
        yield stack
    finally:
        stack.compose("down", "-v", "--remove-orphans", check=False)


@pytest.fixture
def maintenance(stack):
    flag = stack.flags_dir / "maintenance"
    flag.touch()
    stack.wait_for_status(APP_HOST, 503)
    try:
        yield flag
    finally:
        flag.unlink(missing_ok=True)


def test_spoofed_forwarded_for_cannot_dodge_the_token_rate_limit(stack):
    """FR-009: /token allows 5 attempts a minute per client. Caddy replaces
    any client-sent X-Forwarded-For with the real peer, so a fresh fake
    address per request must not buy a fresh budget: the 6th is 429."""
    statuses = []
    for i in range(6):
        status, _, _ = stack.request(
            API_HOST, "POST", "/token",
            body="username=nobody%40example.test&password=wrong-password",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Forwarded-For": f"203.0.113.{i + 1}",
            },
        )
        statuses.append(status)
    assert 429 not in statuses[:5], statuses
    assert statuses[5] == 429, statuses


@pytest.mark.parametrize("host", [APP_HOST, API_HOST])
def test_maintenance_flag_answers_503_on_both_hosts(stack, maintenance, host):
    """FR-005: during the cutover or a pause, no request reaches the app.
    503 with Retry-After says "temporary" to browsers and crawlers, and
    no-store keeps the page from outliving the window in a cache."""
    status, headers, body = stack.request(host, "GET", "/")
    assert status == 503
    assert headers["Retry-After"] == "600"
    assert headers["Cache-Control"] == "no-store"
    assert MAINTENANCE_TEXT in body
    assert "Palaamme pian" in body


def test_health_passes_through_during_maintenance(stack, maintenance):
    """Smoke tests and UptimeRobot must tell "maintenance" from "broken",
    so the API's /health still reaches the backend."""
    status, _, body = stack.request(API_HOST, "GET", "/health")
    assert status == 200
    assert MAINTENANCE_TEXT not in body


def test_removing_the_flag_restores_service_without_reload(stack):
    """`rm` ends maintenance on the next request: no Caddy reload and no
    container restart, so ending it can't itself go wrong."""
    caddy_started = stack.started_at("caddy")
    flag = stack.flags_dir / "maintenance"
    flag.touch()
    stack.wait_for_status(APP_HOST, 503)
    flag.unlink()
    stack.wait_for_status(APP_HOST, 200)

    status, _, body = stack.request(APP_HOST, "GET", "/")
    assert status == 200
    assert 'id="root"' in body
    status, _, _ = stack.request(API_HOST, "GET", "/openapi.json")
    assert status == 200
    assert stack.started_at("caddy") == caddy_started


@pytest.mark.parametrize("service", ["backend", "frontend"])
def test_backend_and_frontend_ports_are_not_published(stack, service):
    """Only Caddy may reach the app. A published backend port would let a
    client skip Caddy and choose its own X-Forwarded-For (contracts/
    edge-http.md § Client address)."""
    assert stack.published_ports(service) == {}


def test_caddy_https_port_is_published(stack):
    """The control for the test above: the same lookup does see a published
    port, so an empty answer there means "not published"."""
    bindings = stack.published_ports("caddy")
    assert [b["HostPort"] for b in bindings["443/tcp"]] == [str(stack.port)]
