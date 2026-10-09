#!/bin/sh
# Proves two PostgreSQL databases hold the same data: runs verify-copy.sql
# against each and diffs the outputs. Exits 0 on a match, 1 on any
# difference (FR-003; deploy/README.md § Cutover, § Rollback, § Restore).
#
#   OLD_DATABASE_URL=... NEW_DATABASE_URL=... verify-copy.sh
#
# The URLs come from the environment, never from arguments, so they don't
# show in `ps`, and they are never printed. Either SQLAlchemy's
# postgresql+psycopg:// form (as in the env file) or plain postgresql://.
#
# psql runs from the postgres:16 image, so the server needs no client
# package and the client matches the server's major version.
#
# No automated test: it needs two live PostgreSQL servers. The staging
# rehearsal (T021) and the cutover itself prove it.
set -eu

: "${OLD_DATABASE_URL:?set OLD_DATABASE_URL}"
: "${NEW_DATABASE_URL:?set NEW_DATABASE_URL}"

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# sslrootcert in DATABASE_URL points into /etc/subscription-tracker, so the
# container needs that directory. Mounted only where it exists: on a laptop,
# `docker run -v` would otherwise create it as an empty root-owned directory.
config_dir=/etc/subscription-tracker

fingerprint() {
    # psql only understands postgresql://; drop SQLAlchemy's +driver suffix.
    PSQL_URL=$(printf '%s' "$1" | sed 's#^postgresql+[a-z0-9]*://#postgresql://#')
    export PSQL_URL
    if [ -d "$config_dir" ]; then
        docker run --rm -i -e PSQL_URL -v "$config_dir:$config_dir:ro" postgres:16 \
            sh -c 'exec psql "$PSQL_URL" -X -q -A -t -F "|" -v ON_ERROR_STOP=1 -f -' \
            < "$here/verify-copy.sql"
    else
        docker run --rm -i -e PSQL_URL postgres:16 \
            sh -c 'exec psql "$PSQL_URL" -X -q -A -t -F "|" -v ON_ERROR_STOP=1 -f -' \
            < "$here/verify-copy.sql"
    fi
    unset PSQL_URL
}

fingerprint "$OLD_DATABASE_URL" > "$work/old.txt"
fingerprint "$NEW_DATABASE_URL" > "$work/new.txt"

if diff -u "$work/old.txt" "$work/new.txt"; then
    echo "verify-copy: match ($(grep -c '^user|' "$work/new.txt") users)"
    exit 0
fi
echo "verify-copy: MISMATCH (lines above: - old, + new)" >&2
exit 1
