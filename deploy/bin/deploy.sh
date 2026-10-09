#!/usr/bin/env bash
# The deploy key's forced command: every SSH login with CI's key runs this,
# whatever command the client asked for (contracts/deploy-interface.md). The
# requested command arrives only as $SSH_ORIGINAL_COMMAND and must be an image
# tag CI built, `sha-` plus 7 hex digits. Anything else exits 64 before any
# other command runs, so the key cannot be used to run arbitrary commands
# (FR-016).
#
# Then: take the lock, remember the running tag, start the new one, check it
# through Caddy, and roll back to the remembered tag if anything fails.
#
# Exit codes, which CI shows as the job result:
#   0  new tag live and healthy
#   1  new tag failed; previous tag restored and running
#   2  rollback failed too; production is degraded (README § Manual rollback)
#   64 invalid tag; nothing ran
#   75 image pull failed; nothing changed
#
# The tag lives in image-tag.env under STATE_DIR, not in the secrets file:
# /etc/subscription-tracker/.env is root:deploy 0640, so this script (running
# as deploy) can read secrets but not write them. Keeping the one value it
# must write in a file it owns avoids giving it write access to the secrets.
#
# It never prints the env file or any value from it: this output goes to the
# CI log.

set -euo pipefail

tag="${SSH_ORIGINAL_COMMAND-}"
# Bash's =~ uses POSIX extended regexes, where `$` matches only at the very
# end, so a trailing newline or a second line is rejected too. The value is
# not echoed back: it is attacker-chosen and the log gains nothing from it.
if [[ ! "$tag" =~ ^sha-[0-9a-f]{7}$ ]]; then
    echo "deploy: refused; expected an image tag like sha-1a2b3c4" >&2
    exit 64
fi

# Production paths by default. Overridable only so the tests can point them
# at a temp dir; that is safe because an SSH client cannot set them: the
# key's `restrict` option and sshd's default `PermitUserEnvironment no` keep
# the client's environment out of this process.
STATE_DIR="${STATE_DIR:-/var/lib/subscription-tracker}"
ENV_FILE="${ENV_FILE:-/etc/subscription-tracker/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/subscription-tracker/compose.prod.yml}"
TAG_FILE="$STATE_DIR/image-tag.env"
# compose.prod.yml reads it for the backend's env_file.
export ENV_FILE

compose() {
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --env-file "$TAG_FILE" "$@"
}

# Written to a temp file and renamed, so a crash mid-write never leaves an
# empty tag file that the next `up` would refuse.
write_tag() {
    printf 'IMAGE_TAG=%s\n' "$1" > "$TAG_FILE.tmp"
    mv "$TAG_FILE.tmp" "$TAG_FILE"
}

# Two merges in quick succession queue here instead of running compose at
# the same time. CI also serializes deploys (concurrency group), but a
# manual run over the deploy key would not.
exec 9> "$STATE_DIR/deploy.lock"
flock 9

previous="$(sed -n 's/^IMAGE_TAG=//p' "$TAG_FILE" 2>/dev/null || true)"
printf '%s\n' "$previous" > "$STATE_DIR/previous-tag"

restore_tag() {
    if [[ -n "$previous" ]]; then
        write_tag "$previous"
    else
        rm -f "$TAG_FILE"
    fi
}

echo "deploy: ${previous:-nothing} -> $tag"
write_tag "$tag"

if ! compose pull --quiet; then
    restore_tag
    echo "deploy: could not pull $tag; nothing changed" >&2
    exit 75
fi

# The public health check goes through Caddy with the hostname pinned to
# this machine, so it tests what users reach (TLS, proxy, backend, database)
# without depending on DNS, which may still point elsewhere during the
# cutover. Read with sed so nothing else from the env file is ever loaded.
api_host="$(sed -n 's/^API_HOST=//p' "$ENV_FILE" | tail -n 1)"

# --wait returns only once every service with a healthcheck is healthy; the
# backend's runs a SELECT 1, so this includes reaching the database. 120 s
# covers image start plus migrations with room to spare.
if compose up -d --wait --wait-timeout 120 \
    && curl -fsS -o /dev/null --max-time 10 --retry 5 --retry-delay 2 --retry-all-errors \
        --resolve "$api_host:443:127.0.0.1" "https://$api_host/health"; then
    echo "deploy: $tag is live"
    exit 0
fi

echo "deploy: $tag failed its health checks; rolling back to ${previous:-nothing}" >&2
if [[ -z "$previous" ]]; then
    echo "deploy: no previous tag to roll back to" >&2
    exit 2
fi
restore_tag
# No pull first: `up` pulls the previous image itself if the weekly prune
# removed it (systemd/image-prune.service).
if compose up -d --wait --wait-timeout 120; then
    echo "deploy: rolled back to $previous" >&2
    exit 1
fi
echo "deploy: rollback to $previous failed; see deploy/README.md § Manual rollback" >&2
exit 2
