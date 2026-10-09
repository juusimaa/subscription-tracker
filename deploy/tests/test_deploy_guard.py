"""deploy.sh is the only thing CI's SSH key can run on the server
(contracts/deploy-interface.md). These tests run it for real, with fake
`docker`, `curl` and `flock` first on PATH, each recording its arguments and
exiting with whatever the test chose. No Docker, network or server needed.
"""

import os
import stat
import subprocess
from pathlib import Path

import pytest

DEPLOY_SH = Path(__file__).resolve().parents[1] / "bin" / "deploy.sh"

# Seeded into the fake env file. Nothing deploy.sh prints may contain it.
SENTINEL = "s3ntinel-must-never-be-printed"

FAKE_DOCKER = """#!/bin/sh
# Records each call with the tag image-tag.env held at that moment, so tests
# can see which version an `up` was asked to start.
tag=$(sed -n 's/^IMAGE_TAG=//p' "$STATE_DIR/image-tag.env" 2>/dev/null)
echo "docker $* [tag=$tag]" >> "$FAKE_LOG"
case " $* " in
  *" pull"*) exit "${FAKE_PULL_EXIT:-0}" ;;
  *" up "*)
    n=$(cat "$FAKE_LOG.ups" 2>/dev/null || echo 0)
    n=$((n + 1))
    echo "$n" > "$FAKE_LOG.ups"
    # The first FAKE_UP_FAILS `up` calls fail, the rest succeed.
    if [ "$n" -le "${FAKE_UP_FAILS:-0}" ]; then exit 1; fi
    exit 0 ;;
esac
exit 0
"""

FAKE_CURL = """#!/bin/sh
echo "curl $*" >> "$FAKE_LOG"
exit "${FAKE_CURL_EXIT:-0}"
"""

FAKE_FLOCK = """#!/bin/sh
echo "flock $*" >> "$FAKE_LOG"
exit 0
"""


@pytest.fixture
def server(tmp_path):
    """A fake server: state dir with a running tag, an env file holding the
    sentinel, and the fakes on PATH."""
    bin_dir = tmp_path / "fakebin"
    bin_dir.mkdir()
    for name, body in (("docker", FAKE_DOCKER), ("curl", FAKE_CURL), ("flock", FAKE_FLOCK)):
        path = bin_dir / name
        path.write_text(body)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)

    state = tmp_path / "state"
    state.mkdir()
    (state / "image-tag.env").write_text("IMAGE_TAG=sha-aaaaaaa\n")
    env_file = tmp_path / "secrets.env"
    env_file.write_text(f"SECRET_KEY={SENTINEL}\nAPI_HOST=api.example.test\n")

    log = tmp_path / "calls.log"
    base_env = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "STATE_DIR": str(state),
        "ENV_FILE": str(env_file),
        "COMPOSE_FILE": str(tmp_path / "compose.prod.yml"),
        "FAKE_LOG": str(log),
    }

    def run(tag, **fake):
        env = dict(base_env, SSH_ORIGINAL_COMMAND=tag, **{k: str(v) for k, v in fake.items()})
        result = subprocess.run(
            ["bash", str(DEPLOY_SH)], env=env, capture_output=True, text=True, timeout=30
        )
        calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    run.state = state
    return run


def running_tag(server):
    return (server.state / "image-tag.env").read_text().strip()


@pytest.mark.parametrize(
    "tag",
    ["", "latest", "sha-ABCDEFG", "sha-1234567; rm -rf /", "sha-1234567 extra", "$(id)", "sha-1234567\n"],
)
def test_anything_but_a_short_sha_is_refused_before_any_command_runs(server, tag):
    """The deploy key must only ever start a CI-built image (FR-016). An
    invalid tag exits 64 having run nothing at all, not even the lock, so a
    crafted argument has no command to ride along on."""
    result, calls = server(tag)
    assert result.returncode == 64
    assert calls == []
    assert running_tag(server) == "IMAGE_TAG=sha-aaaaaaa"


def test_a_valid_tag_is_pulled_started_and_health_checked(server):
    """The happy path: the tag becomes IMAGE_TAG, then pull, up --wait and
    the public health check through Caddy, in that order."""
    result, calls = server("sha-1234567")
    assert result.returncode == 0, result.stderr
    assert running_tag(server) == "IMAGE_TAG=sha-1234567"
    assert (server.state / "previous-tag").read_text().strip() == "sha-aaaaaaa"
    pull = next(i for i, c in enumerate(calls) if " pull" in c)
    up = next(i for i, c in enumerate(calls) if " up " in c)
    curl = next(i for i, c in enumerate(calls) if c.startswith("curl"))
    assert pull < up < curl
    assert "[tag=sha-1234567]" in calls[up]
    assert "--wait" in calls[up]
    assert "https://api.example.test/health" in calls[curl]


def test_deploys_are_serialized_by_the_lock(server):
    """Two merges in quick succession must not run compose concurrently:
    the lock is taken before anything touches the running state."""
    _, calls = server("sha-1234567")
    assert calls[0].startswith("flock")


def test_a_failed_start_rolls_back_to_the_previous_tag_and_exits_1(server):
    """A new version that never gets healthy must not stay live: the
    previous tag is restored and started again, and CI sees a failure."""
    result, calls = server("sha-1234567", FAKE_UP_FAILS=1)
    assert result.returncode == 1
    ups = [c for c in calls if " up " in c]
    assert len(ups) == 2
    assert "[tag=sha-1234567]" in ups[0]
    assert "[tag=sha-aaaaaaa]" in ups[1]
    assert running_tag(server) == "IMAGE_TAG=sha-aaaaaaa"


def test_a_failed_public_health_check_also_rolls_back(server):
    """Containers healthy inside Docker are not enough: if the site isn't
    answering through Caddy, the deploy failed."""
    result, calls = server("sha-1234567", FAKE_CURL_EXIT=22)
    assert result.returncode == 1
    ups = [c for c in calls if " up " in c]
    assert "[tag=sha-aaaaaaa]" in ups[-1]
    assert running_tag(server) == "IMAGE_TAG=sha-aaaaaaa"


def test_a_failed_rollback_exits_2(server):
    """Exit 2 is the "production is degraded, a human must act" signal
    (deploy/README.md § Manual rollback); it must not look like exit 1."""
    result, _ = server("sha-1234567", FAKE_UP_FAILS=2)
    assert result.returncode == 2


def test_a_failed_pull_exits_75_and_leaves_the_running_tag(server):
    """A registry or network failure is retryable and changes nothing: no
    container is touched and the recorded tag stays the running one."""
    result, calls = server("sha-1234567", FAKE_PULL_EXIT=1)
    assert result.returncode == 75
    assert not [c for c in calls if " up " in c]
    assert running_tag(server) == "IMAGE_TAG=sha-aaaaaaa"


@pytest.mark.parametrize("fake", [{}, {"FAKE_UP_FAILS": 1}, {"FAKE_UP_FAILS": 2}, {"FAKE_PULL_EXIT": 1}])
def test_output_never_contains_the_env_file(server, fake):
    """deploy.sh's output lands in the CI log, which is far more widely
    readable than the server. No path may print a secret."""
    result, _ = server("sha-1234567", **fake)
    assert SENTINEL not in result.stdout
    assert SENTINEL not in result.stderr


def test_an_invalid_tag_does_not_echo_it_back(server):
    """The refused value is attacker-chosen; repeating it into the CI log
    gains nothing."""
    result, _ = server("sha-1234567; rm -rf /")
    assert "rm -rf" not in result.stdout + result.stderr


def test_the_script_is_executable():
    """sshd runs the forced command directly; a lost executable bit would
    break every deploy with a confusing permission error."""
    assert os.access(DEPLOY_SH, os.X_OK)
