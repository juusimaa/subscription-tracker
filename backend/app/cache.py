# A small Redis cache-aside layer for the read-heavy, per-user GET endpoints
# (currently /subscriptions and /categories -- see main.py). This is the only
# file that imports redis; every other module goes through the functions
# below, so the whole feature can be removed by deleting this file, the
# handful of calls into it, and the `redis` service/dependency/env var. See
# the project's own note-to-self on this: it was added for the learning
# value, not because this app has a real performance problem to solve.
#
# Why cache-aside (read: check cache, miss: read Postgres, then fill the
# cache) rather than, say, having Postgres itself cache: the app already owns
# the read path (crud.py), so it can decide per-endpoint what is worth
# caching and for how long, without anything upstream of it needing to know
# the cache exists at all.

import json
import os
from typing import Any

import redis
from dotenv import load_dotenv

load_dotenv()

# Same pattern as DATABASE_URL in database.py: a default that matches
# docker-compose.yml so the app still works if REDIS_URL isn't set, and a
# real value injected by Compose (pointing at the "redis" service, not
# "localhost") when running in containers.
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# decode_responses=True gets back str instead of bytes, matching what
# json.loads/dumps below expect. Short timeouts matter here specifically
# because caching is optional: a slow-to-fail connection would make every
# request pay Redis's timeout on top of the Postgres query it was trying to
# avoid, which is worse than not caching at all. redis.from_url() doesn't
# connect yet -- the actual TCP connection (and any failure) happens lazily,
# on the first real command below.
redis_client = redis.from_url(
    REDIS_URL, decode_responses=True, socket_connect_timeout=1, socket_timeout=1
)

# Deliberately short. This is a belt-and-suspenders expiry, not the primary
# way entries go stale -- writes call invalidate_user() below, which retires
# every cached entry for that user immediately. The TTL only matters if that
# call is ever missed (a route added later that forgets to invalidate) or if
# Redis and the app disagree about time; either way, an entry is never wrong
# for longer than this.
CACHE_TTL_SECONDS = 60


def _version_key(user_id: int) -> str:
    return f"user:{user_id}:cache_version"


def _version(user_id: int) -> int:
    try:
        raw = redis_client.get(_version_key(user_id))
    except redis.RedisError:
        # Redis unreachable: treat every user as permanently on version 0.
        # build_key() below then always produces the same key, get_json()
        # always misses (see the same except there), and the app falls back
        # to hitting Postgres on every request -- slower, but correct. A
        # cache is allowed to fail; the API is not.
        return 0
    return int(raw) if raw is not None else 0


def build_key(user_id: int, name: str, **params: Any) -> str:
    """A cache key scoped to one user, one endpoint, and one set of filters.

    The version number folded into the key is what makes invalidate_user()
    cheap: bumping it (an INCR) instantly makes every key built with the old
    version unreachable, without Redis having to find and delete them one by
    one -- which matters because the filter params on /subscriptions mean
    there is no fixed, enumerable set of keys per user to delete. The
    orphaned old-version entries aren't deleted either; they just sit unread
    until CACHE_TTL_SECONDS expires them.

    Params are sorted and None values dropped so the same filters passed in
    a different order, or left out vs. explicitly set to their default,
    still land on the same key.
    """
    version = _version(user_id)
    filters = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if v is not None)
    return f"user:{user_id}:v{version}:{name}:{filters}"


def get_json(key: str) -> Any | None:
    """Returns the cached value, or None on a miss -- including a Redis
    outage, which this deliberately treats the same as a miss rather than
    raising. A cache with a mandatory dependency on its own backing store
    being reachable is just a second database with extra steps; the whole
    point of a cache-aside layer is that the route still works without it.
    """
    try:
        raw = redis_client.get(key)
    except redis.RedisError:
        return None
    return json.loads(raw) if raw is not None else None


def set_json(key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
    """Best-effort write. If Redis is down, the request that computed `value`
    still got its response from Postgres a moment ago -- failing here would
    throw that away over a problem with the cache, not the data."""
    try:
        redis_client.setex(key, ttl, json.dumps(value))
    except redis.RedisError:
        pass


def invalidate_user(user_id: int) -> None:
    """Retires every cached entry for this user. Called after every write to
    that user's subscriptions or categories (see main.py) -- deliberately
    coarse rather than figuring out exactly which cached filter combinations
    a given write could have affected, since a rename or a status change can
    ripple into /categories' subscription_count as easily as /subscriptions'
    own listing. One INCR is cheap enough that being coarse here isn't a real
    cost, and it is a lot easier to convince yourself is correct.
    """
    try:
        redis_client.incr(_version_key(user_id))
    except redis.RedisError:
        # Nothing to fall back to here, but that's fine: the entries this
        # would have orphaned are still reachable, so worst case some are
        # served stale until CACHE_TTL_SECONDS catches up on its own.
        pass
