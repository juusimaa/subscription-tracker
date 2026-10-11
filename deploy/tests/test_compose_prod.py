"""compose.prod.yml as Compose resolves it, checked for what the server
relies on but no running test can show. `docker compose config` only parses
the files, so this needs the Docker CLI but no daemon.
"""

import json
import os
import subprocess
from pathlib import Path

import pytest

DEPLOY = Path(__file__).resolve().parents[1]
CA = "/etc/subscription-tracker/upcloud-ca.pem"


@pytest.fixture(scope="module")
def config():
    result = subprocess.run(
        ["docker", "compose", "-f", str(DEPLOY / "compose.prod.yml"),
         "--env-file", str(DEPLOY / "tests" / "sample.env"),
         "config", "--format", "json"],
        capture_output=True, text=True, check=True,
        # On the server these come from image-tag.env and the default
        # ENV_FILE; any valid tag and the sample env do here.
        env={**os.environ, "IMAGE_TAG": "sha-0000000",
             "ENV_FILE": str(DEPLOY / "tests" / "sample.env")},
    )
    return json.loads(result.stdout)


def test_backend_can_read_the_database_ca_that_sslrootcert_names(config):
    # Without it, DATABASE_URL's sslrootcert points at nothing inside the
    # container and every connection fails (research R4: verify-full).
    mounts = config["services"]["backend"].get("volumes", [])
    assert {"type": "bind", "source": CA, "target": CA, "read_only": True} in [
        {k: m.get(k) for k in ("type", "source", "target", "read_only")}
        for m in mounts
    ]


def test_backend_mounts_nothing_else_from_the_config_directory(config):
    # The secrets file sits beside the CA; only the app's env carries them.
    mounts = config["services"]["backend"].get("volumes", [])
    assert [m["source"] for m in mounts
            if m["source"].startswith("/etc/subscription-tracker")] == [CA]


def test_caddy_reads_other_apps_site_files_read_only(config):
    # The Caddyfile's `import /etc/caddy/sites/*.caddy` reads what the
    # provisioning runbook copies to /opt/edge/sites (Gym Notebook's site
    # file). Read-only: nothing in the container may change another app's
    # config.
    mounts = config["services"]["caddy"].get("volumes", [])
    assert {"type": "bind", "source": "/opt/edge/sites", "target": "/etc/caddy/sites",
            "read_only": True} in [
        {k: m.get(k) for k in ("type", "source", "target", "read_only")}
        for m in mounts
    ]


def test_caddy_joins_the_shared_edge_network_and_its_own(config):
    # `edge` reaches Gym Notebook's containers; `default` is still needed
    # for this stack's backend and frontend.
    assert set(config["services"]["caddy"]["networks"]) == {"default", "edge"}


def test_edge_network_is_external_so_down_never_removes_it(config):
    # Shared with Gym Notebook's stack: created once by hand, owned by
    # neither project.
    edge = config["networks"]["edge"]
    assert edge.get("external") is True
    assert edge["name"] == "edge"


@pytest.mark.parametrize("service", ["backend", "frontend"])
def test_only_caddy_joins_the_edge_network(config, service):
    # Docker gives every service its name as an alias on each network it
    # joins. On `edge`, this backend could answer for another app's upstream
    # name or the reverse, and another app's container could reach it
    # without going through Caddy.
    assert set(config["services"][service].get("networks", {})) == {"default"}
