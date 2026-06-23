"""Async Postgres access (psycopg 3) with an explicit transaction helper.

Row-level locking is the *only* concurrency primitive this service relies on:
``SELECT ... FOR UPDATE`` on ``seats`` ordered by ``id`` inside a transaction.
No Redis, no advisory locks, no optimistic retry loop.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator, Sequence
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import config

_pool: AsyncConnectionPool | None = None


async def _configure(conn: psycopg.AsyncConnection[Any]) -> None:
    # Autocommit by default: transactions are opened explicitly via
    # `transaction()` so the locking scope of every write is obvious.
    await conn.set_autocommit(True)
    conn.row_factory = dict_row


def get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            conninfo=config.database_url,
            min_size=2,
            max_size=20,
            open=False,
            configure=_configure,
            kwargs={"row_factory": dict_row},
        )
    return _pool


async def open_pool() -> None:
    pool = get_pool()
    await pool.open(wait=True, timeout=30)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@contextlib.asynccontextmanager
async def connection() -> AsyncIterator[psycopg.AsyncConnection[Any]]:
    async with get_pool().connection() as conn:
        yield conn


@contextlib.asynccontextmanager
async def transaction() -> AsyncIterator[psycopg.AsyncConnection[Any]]:
    """BEGIN / COMMIT, rolling back on any exception."""
    async with get_pool().connection() as conn:
        async with conn.transaction():
            yield conn


async def fetch_all(
    sql: str,
    params: Sequence[Any] | None = None,
    conn: psycopg.AsyncConnection[Any] | None = None,
) -> list[dict[str, Any]]:
    if conn is not None:
        cur = await conn.execute(sql, params)
        return await cur.fetchall()
    async with connection() as c:
        cur = await c.execute(sql, params)
        return await cur.fetchall()


async def fetch_one(
    sql: str,
    params: Sequence[Any] | None = None,
    conn: psycopg.AsyncConnection[Any] | None = None,
) -> dict[str, Any] | None:
    rows = await fetch_all(sql, params, conn)
    return rows[0] if rows else None


async def execute(
    sql: str,
    params: Sequence[Any] | None = None,
    conn: psycopg.AsyncConnection[Any] | None = None,
) -> None:
    if conn is not None:
        await conn.execute(sql, params)
        return
    async with connection() as c:
        await c.execute(sql, params)
