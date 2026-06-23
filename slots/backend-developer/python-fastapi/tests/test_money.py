"""Money-math unit tests.

The money path is integer-only: every value below must be an ``int``, never a
``float`` and never a ``Decimal`` that round-trips through a float.
"""

from __future__ import annotations

import pytest

from app.config import compute_discount_cents, compute_fee_cents, config


def test_fee_is_floor_percent_plus_fixed() -> None:
    # fee_cents = floor(subtotal * 5 / 100) + 30
    assert compute_fee_cents(5000) == 280
    assert compute_fee_cents(0) == 30
    assert compute_fee_cents(99) == 34
    assert compute_fee_cents(1) == 30
    assert compute_fee_cents(19) == 30
    assert compute_fee_cents(20) == 31


def test_fee_matches_configured_formula() -> None:
    for subtotal in (0, 1, 7, 19, 20, 999, 1234, 7500, 123_456_789):
        expected = (subtotal * config.fee_percent) // 100 + config.fee_fixed_cents
        assert compute_fee_cents(subtotal) == expected


def test_discount_is_floor_percent() -> None:
    assert compute_discount_cents(5000, 10) == 500
    assert compute_discount_cents(3333, 10) == 333
    assert compute_discount_cents(7000, 20) == 1400
    assert compute_discount_cents(1234, 0) == 0
    assert compute_discount_cents(1234, 100) == 1234


@pytest.mark.parametrize("subtotal", [0, 1, 99, 2000, 3333, 5000, 7500, 1_000_003])
@pytest.mark.parametrize("percent", [0, 1, 10, 20, 33, 50, 100])
def test_everything_stays_an_int(subtotal: int, percent: int) -> None:
    discount = compute_discount_cents(subtotal, percent)
    fee = compute_fee_cents(subtotal - discount)
    total = subtotal - discount + fee
    for value in (discount, fee, total):
        assert type(value) is int  # not bool, not float, not Decimal
    assert 0 <= discount <= subtotal
    assert total >= 0


def test_order_total_identity() -> None:
    subtotal = 7500
    discount = compute_discount_cents(subtotal, 10)
    fee = compute_fee_cents(subtotal - discount)
    total = subtotal - discount + fee
    assert discount == 750
    assert total == 6750 + compute_fee_cents(6750)
    assert total == 6750 + 367


def test_fee_is_computed_after_discount_not_before() -> None:
    subtotal = 10_000
    discount = compute_discount_cents(subtotal, 20)
    assert compute_fee_cents(subtotal - discount) == 430
    assert compute_fee_cents(subtotal) == 530
