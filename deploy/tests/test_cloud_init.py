"""cloud-init.yaml's users and groups, applied by real cloud-init in an
Ubuntu 24.04 container (the server's image). Only the users_groups module
runs: the rest of the file installs packages and writes system files, which
a container can't show meaningfully, and is proved by provisioning instead.

Regression: admin joins `deploy` before the deploy user exists, so cloud-init
created the group first and `useradd deploy` then failed on the first real
provision, leaving no deploy user.
"""

import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.edge

CLOUD_INIT = Path(__file__).resolve().parents[1] / "cloud-init.yaml"
# Any syntactically valid ed25519 key body; nothing logs in with it.
KEY = "AAAAC3NzaC1lZDI1NTE5AAAAIMwrbfKc7B6gGI7usdOUrReJ9fPxjQ8heYihPKpBjHAL"

SCRIPT = """
set -e
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cloud-init >/dev/null 2>&1
cloud-init schema -c /t/user-data >&2
cloud-init single --name users_groups --frequency always --file /t/user-data >&2
echo "admin $(id -nG admin)"
echo "deploy $(id -gn deploy) $(id -nG deploy)"
"""


@pytest.fixture(scope="module")
def groups(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("cloud-init")
    text = CLOUD_INIT.read_text()
    text = text.replace("<ADMIN_PUBKEY>", f"ssh-ed25519 {KEY} test")
    text = text.replace("<DEPLOY_PUBKEY>", KEY)
    (tmp / "user-data").write_text(text)
    result = subprocess.run(
        ["docker", "run", "--rm", "-v", f"{tmp}:/t:ro", "ubuntu:24.04",
         "bash", "-c", SCRIPT],
        capture_output=True, text=True, timeout=600,
    )
    assert result.returncode == 0, result.stderr[-3000:]
    lines = dict(line.split(" ", 1) for line in result.stdout.splitlines())
    return {user: rest.split() for user, rest in lines.items()}


def test_deploy_user_exists_with_deploy_as_primary_group(groups):
    primary, *member_of = groups["deploy"]
    assert primary == "deploy"
    assert "docker" in member_of


def test_admin_can_sudo_run_docker_and_read_the_env_file(groups):
    assert {"sudo", "docker", "deploy"} <= set(groups["admin"])
