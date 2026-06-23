"""Error-envelope and timestamp-format unit tests."""

from __future__ import annotations

import datetime as dt

import pytest

from app.errors import STATUS_BY_CODE, AppError
from app.service import hash_body, iso, parse_iso


def test_envelope_shape_without_details() -> None:
    err = AppError("SEAT_ALREADY_HELD", "Seat is currently held")
    assert err.status == 409
    assert err.to_json() == {
        "error": {"code": "SEAT_ALREADY_HELD", "message": "Seat is currently held"}
    }


def test_envelope_shape_with_details() -> None:
    err = AppError("SEAT_NOT_AVAILABLE", "Seat is sold", {"seat_id": "seat_arena_A01-01"})
    assert err.to_json()["error"]["details"] == {"seat_id": "seat_arena_A01-01"}


def test_unknown_code_is_rejected() -> None:
    with pytest.raises(ValueError):
        AppError("NOT_A_REAL_CODE", "nope")


def test_contract_status_mapping() -> None:
    assert STATUS_BY_CODE["IDEMPOTENCY_KEY_REQUIRED"] == 400
    assert STATUS_BY_CODE["IDEMPOTENCY_KEY_CONFLICT"] == 409
    assert STATUS_BY_CODE["HOLD_EXPIRED"] == 410
    assert STATUS_BY_CODE["DISCOUNT_INVALID"] == 400
    assert STATUS_BY_CODE["INSUFFICIENT_PERMISSION"] == 403


def test_iso_is_utc_with_milliseconds_and_z() -> None:
    stamp = dt.datetime(2026, 9, 1, 19, 0, 0, 123_456, tzinfo=dt.timezone.utc)
    assert iso(stamp) == "2026-09-01T19:00:00.123Z"
    offset = dt.datetime(2026, 9, 1, 21, 0, 0, tzinfo=dt.timezone(dt.timedelta(hours=2)))
    assert iso(offset) == "2026-09-01T19:00:00.000Z"
    assert iso("2026-09-01T19:00:00.000Z") == "2026-09-01T19:00:00.000Z"


def test_iso_round_trip() -> None:
    stamp = dt.datetime(2026, 1, 2, 3, 4, 5, 678_000, tzinfo=dt.timezone.utc)
    assert parse_iso(iso(stamp)) == stamp


def test_hold_ttl_window() -> None:
    created = dt.datetime(2026, 9, 1, 19, 0, 0, tzinfo=dt.timezone.utc)
    expires = created + dt.timedelta(seconds=600)
    assert (parse_iso(iso(expires)) - parse_iso(iso(created))).total_seconds() == 600


def test_body_hash_is_order_independent_but_value_sensitive() -> None:
    a = hash_body({"hold_id": "hold_1", "discount_code": None})
    b = hash_body({"discount_code": None, "hold_id": "hold_1"})
    c = hash_body({"hold_id": "hold_1", "discount_code": "SAVE10"})
    d = hash_body({"hold_id": "hold_2", "discount_code": None})
    assert a == b
    assert a != c
    assert a != d
