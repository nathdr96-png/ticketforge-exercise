"""TicketForge domain service.

Concurrency strategy (Postgres only — no Redis anywhere in this port):

    BEGIN
      SELECT ... FROM seats WHERE id = ANY(...) ORDER BY id FOR UPDATE
      re-check every seat is 'available'
      insert hold, mark seats held
    COMMIT

Locking the seat rows in a deterministic order (``ORDER BY id``) inside the
transaction makes concurrent hold attempts serialise on the same rows and
removes any lock-ordering deadlock between multi-seat requests. The row lock is
authoritative: the status re-check happens *after* the lock is granted, so only
one of N racing buyers can observe a seat as ``available``.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import uuid
from typing import Any

from psycopg.types.json import Jsonb

from .auth import AuthUser
from .config import compute_discount_cents, compute_fee_cents, config
from .db import execute, fetch_all, fetch_one, transaction
from .errors import AppError

SECTIONS = ("A", "B", "C", "D")
SEAT_STATUSES = ("available", "held", "sold")
EVENT_STATUSES = ("draft", "published", "cancelled")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(value: dt.datetime | str) -> str:
    """UTC ISO-8601 with milliseconds and a ``Z`` suffix."""
    if isinstance(value, str):
        value = parse_iso(value)
    value = value.astimezone(dt.timezone.utc)
    return f"{value:%Y-%m-%dT%H:%M:%S}.{value.microsecond // 1000:03d}Z"


def parse_iso(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def hash_body(body: dict[str, Any]) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


# --------------------------------------------------------------------------- #
# events
# --------------------------------------------------------------------------- #


def _map_event(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "organizer_id": row["organizer_id"],
        "title": row["title"],
        "description": row["description"],
        "venue": row["venue"],
        "starts_at": iso(row["starts_at"]),
        "currency": row["currency"],
        "base_price_cents": int(row["base_price_cents"]),
        "status": row["status"],
        "seat_count": int(row["seat_count"]),
    }


async def list_events(page: int, page_size: int, status: str | None = None) -> dict[str, Any]:
    params: list[Any] = []
    if status:
        if status not in EVENT_STATUSES:
            raise AppError("VALIDATION_ERROR", "Invalid status filter")
        params.append(status)
        where = "WHERE status = %s::event_status"
    else:
        where = "WHERE status = 'published'"

    count_row = await fetch_one(
        f"SELECT COUNT(*)::bigint AS count FROM events {where}", list(params)
    )
    total = int(count_row["count"]) if count_row else 0

    rows = await fetch_all(
        f"""
        SELECT e.id, e.organizer_id, e.title, e.description, e.venue, e.starts_at,
               e.currency, e.base_price_cents, e.status::text AS status,
               (SELECT COUNT(*)::int FROM seats s WHERE s.event_id = e.id) AS seat_count
        FROM events e
        {where}
        ORDER BY e.starts_at ASC
        LIMIT %s OFFSET %s
        """,
        [*params, page_size, page * page_size],
    )
    return {
        "data": [_map_event(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


async def get_event(event_id: str, conn: Any | None = None) -> dict[str, Any]:
    row = await fetch_one(
        """
        SELECT e.id, e.organizer_id, e.title, e.description, e.venue, e.starts_at,
               e.currency, e.base_price_cents, e.status::text AS status,
               (SELECT COUNT(*)::int FROM seats s WHERE s.event_id = e.id) AS seat_count
        FROM events e WHERE e.id = %s
        """,
        [event_id],
        conn,
    )
    if row is None:
        raise AppError("EVENT_NOT_FOUND", "Event not found")
    return _map_event(row)


async def list_seats(
    event_id: str,
    page: int,
    page_size: int,
    section: str | None = None,
    availability: str | None = None,
) -> dict[str, Any]:
    await get_event(event_id)
    if section and section not in SECTIONS:
        raise AppError("VALIDATION_ERROR", "Invalid section filter")
    if availability and availability not in SEAT_STATUSES:
        raise AppError("VALIDATION_ERROR", "Invalid availability filter")

    params: list[Any] = [event_id]
    filters = ["event_id = %s"]
    if section:
        params.append(section)
        filters.append("section = %s::seat_section")
    if availability:
        params.append(availability)
        filters.append("status = %s::seat_status")
    where = " AND ".join(filters)

    count_row = await fetch_one(
        f"SELECT COUNT(*)::bigint AS count FROM seats WHERE {where}", list(params)
    )
    total = int(count_row["count"]) if count_row else 0

    rows = await fetch_all(
        f"""
        SELECT id, event_id, section::text AS section, row_label AS row, number,
               status::text AS status, price_cents
        FROM seats
        WHERE {where}
        ORDER BY section, row_label, number
        LIMIT %s OFFSET %s
        """,
        [*params, page_size, (page - 1) * page_size],
    )
    return {
        "data": [
            {
                "id": r["id"],
                "event_id": r["event_id"],
                "section": r["section"],
                "row": r["row"],
                "number": int(r["number"]),
                "status": r["status"],
                "price_cents": int(r["price_cents"]),
            }
            for r in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


# --------------------------------------------------------------------------- #
# holds
# --------------------------------------------------------------------------- #


async def create_hold(user: AuthUser, event_id: str, seat_ids: list[str]) -> dict[str, Any]:
    if not seat_ids:
        raise AppError("VALIDATION_ERROR", "seat_ids required")

    unique = sorted(set(seat_ids))

    async with transaction() as conn:
        await get_event(event_id, conn)

        # Deterministic lock order (ORDER BY id) => no deadlocks between
        # overlapping multi-seat requests.
        seats = await fetch_all(
            """
            SELECT id, event_id, status::text AS status, price_cents
            FROM seats
            WHERE id = ANY(%s::text[])
            ORDER BY id
            FOR UPDATE
            """,
            [unique],
            conn,
        )

        if len(seats) != len(unique):
            raise AppError("SEAT_NOT_FOUND", "One or more seats not found")

        for seat in seats:
            if seat["event_id"] != event_id:
                raise AppError(
                    "VALIDATION_ERROR",
                    "Seat does not belong to event",
                    {"seat_id": seat["id"]},
                )
            if seat["status"] == "held":
                raise AppError(
                    "SEAT_ALREADY_HELD", "Seat is currently held", {"seat_id": seat["id"]}
                )
            if seat["status"] == "sold":
                raise AppError("SEAT_NOT_AVAILABLE", "Seat is sold", {"seat_id": seat["id"]})

        hold_id = _new_id("hold")
        now = now_utc()
        expires = now + dt.timedelta(seconds=config.hold_ttl_seconds)

        await execute(
            """
            INSERT INTO holds (id, event_id, buyer_id, status, expires_at, created_at)
            VALUES (%s, %s, %s, 'active', %s, %s)
            """,
            [hold_id, event_id, user["id"], expires, now],
            conn,
        )
        for seat_id in unique:
            await execute(
                "INSERT INTO hold_seats (hold_id, seat_id) VALUES (%s, %s)",
                [hold_id, seat_id],
                conn,
            )
            await execute(
                """
                UPDATE seats SET status = 'held', hold_id = %s, version = version + 1
                WHERE id = %s
                """,
                [hold_id, seat_id],
                conn,
            )

        await execute(
            "INSERT INTO outbox_events (event_type, payload) VALUES ('hold.created', %s)",
            [
                Jsonb(
                    {
                        "event_type": "hold.created",
                        "hold_id": hold_id,
                        "event_id": event_id,
                        "buyer_id": user["id"],
                        "seat_ids": unique,
                        "expires_at": iso(expires),
                        "occurred_at": iso(now),
                    }
                )
            ],
            conn,
        )

        return {
            "id": hold_id,
            "event_id": event_id,
            "buyer_id": user["id"],
            "seat_ids": unique,
            "status": "active",
            "expires_at": iso(expires),
            "created_at": iso(now),
        }


async def _fetch_hold(hold_id: str, conn: Any | None = None) -> dict[str, Any]:
    row = await fetch_one(
        """
        SELECT h.id, h.event_id, h.buyer_id, h.status::text AS status,
               h.expires_at, h.created_at,
               COALESCE(
                 array_agg(hs.seat_id ORDER BY hs.seat_id)
                   FILTER (WHERE hs.seat_id IS NOT NULL),
                 '{}'
               ) AS seat_ids
        FROM holds h
        LEFT JOIN hold_seats hs ON hs.hold_id = h.id
        WHERE h.id = %s
        GROUP BY h.id
        """,
        [hold_id],
        conn,
    )
    if row is None:
        raise AppError("HOLD_NOT_FOUND", "Hold not found")
    return {
        "id": row["id"],
        "event_id": row["event_id"],
        "buyer_id": row["buyer_id"],
        "seat_ids": list(row["seat_ids"] or []),
        "status": row["status"],
        "expires_at": iso(row["expires_at"]),
        "created_at": iso(row["created_at"]),
    }


async def get_hold(user: AuthUser, hold_id: str) -> dict[str, Any]:
    hold = await _fetch_hold(hold_id)
    if user["role"] != "admin" and hold["buyer_id"] != user["id"]:
        raise AppError("INSUFFICIENT_PERMISSION", "Not your hold")
    if hold["status"] == "active" and parse_iso(hold["expires_at"]) <= now_utc():
        await expire_hold(hold_id)
        raise AppError("HOLD_EXPIRED", "Hold has expired")
    return hold


async def release_hold(user: AuthUser, hold_id: str) -> None:
    async with transaction() as conn:
        hold = await _fetch_hold(hold_id, conn)
        if user["role"] != "admin" and hold["buyer_id"] != user["id"]:
            raise AppError("INSUFFICIENT_PERMISSION", "Not your hold")
        if hold["status"] in ("expired", "released"):
            raise AppError("HOLD_EXPIRED", "Hold has expired")
        if hold["status"] == "converted":
            raise AppError("HOLD_ALREADY_CONVERTED", "Hold already converted")

        await execute("UPDATE holds SET status = 'released' WHERE id = %s", [hold_id], conn)
        await execute(
            """
            UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
            WHERE hold_id = %s
            """,
            [hold_id],
            conn,
        )
        await execute("DELETE FROM hold_seats WHERE hold_id = %s", [hold_id], conn)


async def expire_hold(hold_id: str) -> None:
    async with transaction() as conn:
        hold = await fetch_one(
            """
            SELECT id, event_id, buyer_id, status::text AS status
            FROM holds WHERE id = %s FOR UPDATE
            """,
            [hold_id],
            conn,
        )
        if hold is None or hold["status"] != "active":
            return

        seat_rows = await fetch_all(
            "SELECT seat_id FROM hold_seats WHERE hold_id = %s", [hold_id], conn
        )
        seat_ids = [r["seat_id"] for r in seat_rows]

        await execute("UPDATE holds SET status = 'expired' WHERE id = %s", [hold_id], conn)
        await execute(
            """
            UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
            WHERE hold_id = %s AND status = 'held'
            """,
            [hold_id],
            conn,
        )
        await execute("DELETE FROM hold_seats WHERE hold_id = %s", [hold_id], conn)
        await execute(
            "INSERT INTO outbox_events (event_type, payload) VALUES ('hold.expired', %s)",
            [
                Jsonb(
                    {
                        "event_type": "hold.expired",
                        "hold_id": hold_id,
                        "event_id": hold["event_id"],
                        "buyer_id": hold["buyer_id"],
                        "seat_ids": seat_ids,
                        "occurred_at": iso(now_utc()),
                    }
                )
            ],
            conn,
        )


async def expire_due_holds(limit: int = 100) -> int:
    rows = await fetch_all(
        """
        SELECT id FROM holds
        WHERE status = 'active' AND expires_at <= NOW()
        ORDER BY expires_at
        LIMIT %s
        """,
        [limit],
    )
    for row in rows:
        await expire_hold(row["id"])
    return len(rows)


# --------------------------------------------------------------------------- #
# orders
# --------------------------------------------------------------------------- #


async def create_order(
    user: AuthUser,
    idempotency_key: str | None,
    body: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    """Returns ``(order, replay)``; ``replay`` selects HTTP 200 over 201."""
    if not idempotency_key or len(idempotency_key) < 8:
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required")

    hold_id: str = body["hold_id"]
    discount_code: str | None = body.get("discount_code")
    request_hash = hash_body({"hold_id": hold_id, "discount_code": discount_code})

    async with transaction() as conn:
        existing = await fetch_one(
            """
            SELECT request_hash, order_id FROM idempotency_records
            WHERE buyer_id = %s AND idempotency_key = %s
            FOR UPDATE
            """,
            [user["id"], idempotency_key],
            conn,
        )
        if existing is not None:
            if existing["request_hash"] != request_hash:
                raise AppError(
                    "IDEMPOTENCY_KEY_CONFLICT",
                    "Idempotency key reused with a different body",
                )
            return await _fetch_order(existing["order_id"], conn), True

        hold = await _fetch_hold(hold_id, conn)
        if hold["buyer_id"] != user["id"] and user["role"] != "admin":
            raise AppError("INSUFFICIENT_PERMISSION", "Not your hold")

        await execute("SELECT id FROM holds WHERE id = %s FOR UPDATE", [hold_id], conn)

        seat_rows = await fetch_all(
            """
            SELECT id, price_cents, status::text AS status
            FROM seats WHERE id = ANY(%s::text[]) ORDER BY id FOR UPDATE
            """,
            [hold["seat_ids"]],
            conn,
        )

        # Integer cents only — sum of ints is an int.
        subtotal_cents = sum(int(s["price_cents"]) for s in seat_rows)

        # TODO(FEAT-18): discount codes are not implemented yet.
        discount_cents = 0
        applied_code: str | None = None

        after_discount_cents = subtotal_cents - discount_cents
        fee_cents = compute_fee_cents(after_discount_cents)
        total_cents = after_discount_cents + fee_cents

        event_row = await fetch_one(
            "SELECT currency FROM events WHERE id = %s", [hold["event_id"]], conn
        )
        currency = event_row["currency"] if event_row else "USD"

        order_id = _new_id("ord")
        now = now_utc()

        await execute(
            """
            INSERT INTO orders
              (id, hold_id, buyer_id, event_id, subtotal_cents, fee_cents, discount_cents,
               total_cents, currency, discount_code, status, idempotency_key, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'paid',%s,%s)
            """,
            [
                order_id,
                hold_id,
                user["id"],
                hold["event_id"],
                subtotal_cents,
                fee_cents,
                discount_cents,
                total_cents,
                currency,
                applied_code,
                idempotency_key,
                now,
            ],
            conn,
        )

        for seat in seat_rows:
            await execute(
                "INSERT INTO order_seats (order_id, seat_id) VALUES (%s, %s)",
                [order_id, seat["id"]],
                conn,
            )
            await execute(
                """
                UPDATE seats SET status = 'sold', hold_id = NULL, version = version + 1
                WHERE id = %s
                """,
                [seat["id"]],
                conn,
            )

        await execute("UPDATE holds SET status = 'converted' WHERE id = %s", [hold_id], conn)

        await execute(
            """
            INSERT INTO idempotency_records (buyer_id, idempotency_key, request_hash, order_id)
            VALUES (%s,%s,%s,%s)
            """,
            [user["id"], idempotency_key, request_hash, order_id],
            conn,
        )

        await execute(
            "INSERT INTO outbox_events (event_type, payload) VALUES ('order.paid', %s)",
            [
                Jsonb(
                    {
                        "event_type": "order.paid",
                        "order_id": order_id,
                        "hold_id": hold_id,
                        "event_id": hold["event_id"],
                        "buyer_id": user["id"],
                        "total_cents": total_cents,
                        "currency": currency,
                        "occurred_at": iso(now),
                    }
                )
            ],
            conn,
        )

        return await _fetch_order(order_id, conn), False


async def _fetch_order(order_id: str, conn: Any | None = None) -> dict[str, Any]:
    row = await fetch_one(
        """
        SELECT o.id, o.hold_id, o.buyer_id, o.event_id, o.subtotal_cents, o.fee_cents,
               o.discount_cents, o.total_cents, o.currency, o.discount_code,
               o.status::text AS status, o.created_at,
               COALESCE(
                 array_agg(os.seat_id ORDER BY os.seat_id)
                   FILTER (WHERE os.seat_id IS NOT NULL),
                 '{}'
               ) AS seat_ids
        FROM orders o
        LEFT JOIN order_seats os ON os.order_id = o.id
        WHERE o.id = %s
        GROUP BY o.id
        """,
        [order_id],
        conn,
    )
    if row is None:
        raise AppError("ORDER_NOT_FOUND", "Order not found")
    return {
        "id": row["id"],
        "hold_id": row["hold_id"],
        "buyer_id": row["buyer_id"],
        "event_id": row["event_id"],
        "seat_ids": list(row["seat_ids"] or []),
        "subtotal_cents": int(row["subtotal_cents"]),
        "fee_cents": int(row["fee_cents"]),
        "discount_cents": int(row["discount_cents"]),
        "total_cents": int(row["total_cents"]),
        "currency": row["currency"],
        "discount_code": row["discount_code"],
        "status": row["status"],
        "created_at": iso(row["created_at"]),
    }


async def get_order(user: AuthUser, order_id: str) -> dict[str, Any]:
    order = await _fetch_order(order_id)
    if user["role"] == "admin" or order["buyer_id"] == user["id"]:
        return order

    if user["role"] == "organizer":
        row = await fetch_one(
            "SELECT organizer_id FROM events WHERE id = %s", [order["event_id"]]
        )
        if row and row["organizer_id"] == user["id"]:
            return order

    raise AppError("INSUFFICIENT_PERMISSION", "Not allowed to view this order")


# --------------------------------------------------------------------------- #
# reports
# --------------------------------------------------------------------------- #


async def revenue_report(user: AuthUser, filters: dict[str, Any]) -> dict[str, Any]:
    if user["role"] not in ("organizer", "admin"):
        raise AppError("INSUFFICIENT_PERMISSION", "Organizer role required")

    params: list[Any] = []
    clauses = ["o.status = 'paid'"]

    if user["role"] == "organizer":
        params.append(user["id"])
        clauses.append("e.organizer_id = %s")
    if filters.get("event_id"):
        params.append(filters["event_id"])
        clauses.append("o.event_id = %s")
    if filters.get("from"):
        params.append(filters["from"])
        clauses.append("o.created_at >= %s::timestamptz")
    if filters.get("to"):
        params.append(filters["to"])
        clauses.append("o.created_at <= %s::timestamptz")

    where = " AND ".join(clauses)
    rows = await fetch_all(
        f"""
        SELECT o.event_id,
               COUNT(*)::int AS order_count,
               COALESCE(SUM(o.subtotal_cents),0)::bigint AS gross_cents,
               COALESCE(SUM(o.fee_cents),0)::bigint AS fees_cents,
               COALESCE(SUM(o.discount_cents),0)::bigint AS discounts_cents,
               COALESCE(SUM(o.total_cents),0)::bigint AS net_cents,
               MIN(e.currency) AS currency
        FROM orders o
        JOIN events e ON e.id = o.event_id
        WHERE {where}
        GROUP BY o.event_id
        ORDER BY o.event_id
        """,
        params,
    )

    by_event = [
        {
            "event_id": r["event_id"],
            "order_count": int(r["order_count"]),
            "gross_cents": int(r["gross_cents"]),
            "net_cents": int(r["net_cents"]),
        }
        for r in rows
    ]

    return {
        "currency": (rows[0]["currency"] if rows else None) or "USD",
        "gross_cents": sum(r["gross_cents"] for r in by_event),
        "fees_cents": sum(int(r["fees_cents"]) for r in rows),
        "discounts_cents": sum(int(r["discounts_cents"]) for r in rows),
        "net_cents": sum(r["net_cents"] for r in by_event),
        "by_event": by_event,
    }
