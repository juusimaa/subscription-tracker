# Authentication: password hashing, JWT creation and decoding, and the FastAPI
# dependency that turns an incoming "Authorization: Bearer ..." header into a
# User row. Kept out of main.py so the route handlers stay focused on HTTP
# concerns, the same way crud.py keeps the SQL out of them.

import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app import models

# Importing database also runs its load_dotenv() call, so variables from a
# local .env file are already in os.environ by the time SECRET_KEY is read
# below. Under Docker Compose they're injected as real env vars instead.
from app.database import get_db

# The key that signs every token. Read from the environment with no fallback
# value on purpose: a hardcoded default would get committed, and anyone who
# read the repo could then mint a valid token for any account. Refusing to
# start is much safer than running with a publicly known secret.
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Generate one with:\n"
        '  python -c "import secrets; print(secrets.token_hex(32))"\n'
        "then add it to your .env file (see .env.example)."
    )

ALGORITHM = "HS256"
# Short-ish on purpose: nothing invalidates an already-issued token, so the
# expiry is the only thing that ever revokes one.
TOKEN_EXPIRE_HOURS = 12

# Tells FastAPI to expect "Authorization: Bearer <token>" and where tokens
# come from. tokenUrl is also what wires up the "Authorize" button in the
# auto-generated API docs at /docs.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def hash_password(password: str) -> str:
    """Hash a password for storage. bcrypt generates a random salt per call
    and embeds it in the resulting string, so two users with the same password
    still get different hashes, and none of them is reversible."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """Re-hashes the supplied password with the salt stored inside `hashed`
    and compares the results in constant time."""
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_access_token(user_id: int) -> str:
    """Build a signed token identifying one user.

    The payload is signed, *not* encrypted -- anyone holding the token can
    read these claims (try pasting one into jwt.io). That's fine for an id and
    an expiry; never put anything secret in here. What the signature buys is
    that nobody can change "sub" to another user's id without SECRET_KEY.
    """
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    # "sub" (subject) and "exp" (expiry) are standard JWT claim names; the jwt
    # library enforces exp automatically on decode. sub must be a string.
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> models.User:
    """FastAPI dependency: any route that declares it receives the logged-in
    User, and automatically returns 401 for a missing, malformed, expired or
    forged token."""
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        # Part of the Bearer spec: tells the client which scheme to retry with.
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        # Covers a bad signature and an expired token alike. Deliberately the
        # same error for both, so the response never tells a caller which of
        # the two went wrong.
        raise credentials_error

    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_error

    # The user is loaded fresh on every request rather than trusted from the
    # token's contents, so a deleted account stops working immediately instead
    # of staying valid until its token happens to expire.
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None:
        raise credentials_error
    return user
