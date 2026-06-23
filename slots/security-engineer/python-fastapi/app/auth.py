"""Password verification (bcrypt, cost 10) and JWT issue/verify."""

from __future__ import annotations

import asyncio
import datetime as dt
from typing import Any, TypedDict

import bcrypt
import jwt

from .config import config
from .db import fetch_one
from .errors import AppError

BCRYPT_ROUNDS = 10


class AuthUser(TypedDict):
    id: str
    email: str
    role: str
    name: str


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode(
        "utf-8"
    )


def _verify_password_sync(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


async def verify_password(password: str, password_hash: str) -> bool:
    # bcrypt is intentionally slow; keep the event loop free.
    return await asyncio.to_thread(_verify_password_sync, password, password_hash)


def sign_token(user_id: str, role: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(now.timestamp()) + config.jwt_ttl_seconds,
    }
    return jwt.encode(payload, config.jwt_secret, algorithm="HS256")


def verify_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, config.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AppError("UNAUTHENTICATED", "Invalid or expired token") from exc


async def login(email: str, password: str) -> dict[str, Any]:
    row = await fetch_one(
        "SELECT id, email, role::text AS role, name, password_hash FROM users WHERE email = %s",
        [email],
    )
    if row is None or not await verify_password(password, row["password_hash"]):
        raise AppError("UNAUTHENTICATED", "Invalid email or password")

    # One place to change when the user record grows a field.
    user = AuthUser(**row)
    return {"token": sign_token(user["id"], user["role"]), "user": user}


async def load_user(user_id: str) -> AuthUser:
    row = await fetch_one(
        "SELECT id, email, role::text AS role, name FROM users WHERE id = %s",
        [user_id],
    )
    if row is None:
        raise AppError("UNAUTHENTICATED", "User not found")
    return {
        "id": row["id"],
        "email": row["email"],
        "role": row["role"],
        "name": row["name"],
    }
