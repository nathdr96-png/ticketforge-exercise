#!/usr/bin/env python3
"""`make test` — check the result files before handing them to the grader.

    python3 tools/check.py

Two kinds of check, and the second is the one worth having:

1. **Comparison** against the expected fixtures published in
   conformance/data/expected/, for every question that has one, so they catch a
   regression immediately.

2. **Invariants** on all eight answers, derived from the contract rather than
   from a stored answer: a report whose parts do not add up is wrong even if
   nobody has an expected value for it. These are what catch a wrong answer to
   a question with no published fixture, and they are the checks that still
   mean something after the seed data changes.

Exits non-zero on the first category of failure found, printing every failure.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

SLOT = pathlib.Path(__file__).resolve().parents[1]
ROOT = SLOT.parents[2]
EXPECTED = ROOT / "conformance" / "data" / "expected"

QUESTIONS = [
    "q1_revenue_by_event",
    "q2_daily_sales_utc",
    "q3_hold_funnel_by_event",
    "q4_seat_hold_history",
    "q5_top_buyers_by_currency",
    "q6_discount_effectiveness",
    "q7_inventory_reconciliation",
    "q8_order_value_distribution",
]

# (column, descending) sort keys the contract requires.
ORDERING: dict[str, list[tuple[str, bool]]] = {
    "q1_revenue_by_event": [("currency", False), ("net_cents", True), ("event_id", False)],
    "q2_daily_sales_utc": [("sales_day", False), ("event_id", False)],
    "q3_hold_funnel_by_event": [("event_id", False)],
    "q4_seat_hold_history": [("event_id", False)],
    "q5_top_buyers_by_currency": [("currency", False), ("rank", False)],
    "q6_discount_effectiveness": [("code", False), ("currency", False)],
    "q7_inventory_reconciliation": [("event_id", False)],
    "q8_order_value_distribution": [("currency", False), ("event_id", False)],
}

MONEY_SUFFIX = "_cents"
INT_COLUMNS = {
    "orders_count", "seats_sold", "holds_created", "holds_converted", "holds_expired",
    "holds_released", "holds_active", "conversion_bps", "holds_observed",
    "seat_hold_pairs", "seats_ever_held", "seats_expired_never_ordered", "rank",
    "seats_purchased", "percent_off", "seats_total", "seats_available", "seats_held",
    "seats_sold_status", "seats_in_paid_orders", "unreconciled_seats",
    "avg_seats_per_order_bps",
}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def as_int(value, where: str) -> int:
    """Integers only. A decimal point anywhere in a money column is a failure,
    not something to round away."""
    if isinstance(value, bool):
        fail(f"{where}: boolean where an integer was expected")
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, str) and (value.lstrip("-").isdigit()):
        return int(value)
    fail(f"{where}: {value!r} is not an integer")
    return 0


def results_dir() -> pathlib.Path:
    raw = os.environ.get("RESULTS_DIR") or str(SLOT / "results")
    path = pathlib.Path(raw)
    if not path.is_absolute():
        path = (SLOT / path).resolve()
    return path


def sort_key(row: dict, keys: list[tuple[str, bool]]):
    out = []
    for col, desc in keys:
        v = row.get(col)
        if v is None:
            # NULLS LAST in both directions, matching the contract's q6 ordering.
            out.append((1, ""))
            continue
        if col in INT_COLUMNS or col.endswith(MONEY_SUFFIX):
            n = as_int(v, f"sort key {col}")
            out.append((0, -n if desc else n))
        else:
            out.append((0, v))
    return out


def check_ordering(qid: str, rows: list[dict]) -> None:
    keys = ORDERING[qid]
    for i in range(1, len(rows)):
        prev, cur = sort_key(rows[i - 1], keys), sort_key(rows[i], keys)
        # Mixed tuple element types would raise; the shapes here are uniform.
        if prev > cur:
            fail(f"{qid}: row {i} is out of the order the contract requires "
                 f"({[k for k, _ in keys]})")
            return


def check_types(qid: str, rows: list[dict]) -> None:
    for i, row in enumerate(rows):
        for col, value in row.items():
            if col in INT_COLUMNS or col.endswith(MONEY_SUFFIX):
                n = as_int(value, f"{qid} row {i} column {col}")
                if col.endswith(MONEY_SUFFIX) and n < 0:
                    fail(f"{qid} row {i}: {col} is negative ({n})")


def reconciles(qid: str, rows: list[dict]) -> None:
    for i, row in enumerate(rows):
        if not {"gross_cents", "discounts_cents", "fees_cents", "net_cents"} <= row.keys():
            continue
        g = as_int(row["gross_cents"], f"{qid}.gross_cents")
        d = as_int(row["discounts_cents"], f"{qid}.discounts_cents")
        f = as_int(row["fees_cents"], f"{qid}.fees_cents")
        n = as_int(row["net_cents"], f"{qid}.net_cents")
        if n != g - d + f:
            fail(f"{qid} row {i}: net_cents {n} != gross {g} - discounts {d} + fees {f} "
                 f"(RevenueReport definition in contract/openapi.yaml)")


def invariants(qid: str, rows: list[dict]) -> None:
    check_types(qid, rows)
    check_ordering(qid, rows)
    reconciles(qid, rows)

    if qid == "q1_revenue_by_event":
        seen = set()
        for row in rows:
            key = (row["event_id"], row["currency"])
            if key in seen:
                fail(f"{qid}: duplicate grain {key} — one row per (event, currency)")
            seen.add(key)
            if as_int(row["orders_count"], qid) < 1:
                fail(f"{qid}: {row['event_id']} has no paid orders and must not appear")

    if qid == "q3_hold_funnel_by_event":
        for row in rows:
            created = as_int(row["holds_created"], qid)
            parts = sum(as_int(row[k], qid) for k in
                        ("holds_converted", "holds_expired", "holds_released", "holds_active"))
            if parts != created:
                fail(f"{qid}: {row['event_id']} statuses sum to {parts}, holds_created is {created}")
            converted = as_int(row["holds_converted"], qid)
            # Half-up, the contract's rule.
            want = (converted * 10000 * 2 + created) // (created * 2)
            if as_int(row["conversion_bps"], qid) != want:
                fail(f"{qid}: {row['event_id']} conversion_bps is "
                     f"{row['conversion_bps']}, half-up gives {want}")

    if qid == "q4_seat_hold_history":
        for row in rows:
            if as_int(row["seat_hold_pairs"], qid) < as_int(row["seats_ever_held"], qid):
                fail(f"{qid}: {row['event_id']} has fewer (hold, seat) pairs than distinct seats")

    if qid == "q5_top_buyers_by_currency":
        by_currency: dict[str, list[dict]] = {}
        for row in rows:
            by_currency.setdefault(row["currency"], []).append(row)
        for currency, group in by_currency.items():
            if [as_int(r["rank"], qid) for r in group] != list(range(1, len(group) + 1)):
                fail(f"{qid}: {currency} ranks are not 1..{len(group)}")
            nets = [as_int(r["net_cents"], qid) for r in group]
            if nets != sorted(nets, reverse=True):
                fail(f"{qid}: {currency} is not ordered by net_cents descending")
            if len(group) > 3:
                fail(f"{qid}: {currency} has {len(group)} rows, the contract asks for three")

    if qid == "q6_discount_effectiveness":
        for row in rows:
            if as_int(row["orders_count"], qid) == 0:
                if row["currency"] is not None:
                    fail(f"{qid}: {row['code']} has no orders but a currency of "
                         f"{row['currency']!r} — the contract says null")
                if any(as_int(row[c], qid) for c in
                       ("gross_cents", "discounts_cents", "fees_cents", "net_cents")):
                    fail(f"{qid}: {row['code']} has no orders but non-zero money")

    if qid == "q7_inventory_reconciliation":
        for row in rows:
            total = as_int(row["seats_total"], qid)
            parts = sum(as_int(row[k], qid) for k in
                        ("seats_available", "seats_held", "seats_sold_status"))
            if parts != total:
                fail(f"{qid}: {row['event_id']} seat statuses sum to {parts}, total is {total}")
            want = as_int(row["seats_sold_status"], qid) - as_int(row["seats_in_paid_orders"], qid)
            if as_int(row["unreconciled_seats"], qid) != want:
                fail(f"{qid}: {row['event_id']} unreconciled_seats is not "
                     f"seats_sold_status - seats_in_paid_orders")

    if qid == "q8_order_value_distribution":
        for row in rows:
            lo = as_int(row["min_net_cents"], qid)
            hi = as_int(row["max_net_cents"], qid)
            avg = as_int(row["avg_net_cents"], qid)
            if not lo <= avg <= hi:
                fail(f"{qid}: {row['event_id']} average {avg} is outside [{lo}, {hi}]")


def compare(qid: str, got: list[dict], want: list[dict]) -> None:
    if len(got) != len(want):
        fail(f"{qid}: {len(got)} rows, expected {len(want)}")
    for i in range(min(len(got), len(want))):
        g, w = got[i], want[i]
        if set(g) != set(w):
            fail(f"{qid} row {i}: columns {sorted(g)} != expected {sorted(w)}")
            continue
        for col in w:
            gv, wv = g[col], w[col]
            if col in INT_COLUMNS or col.endswith(MONEY_SUFFIX):
                if as_int(gv, f"{qid}.{col}") != as_int(wv, f"{qid}.{col}"):
                    fail(f"{qid} row {i}: {col} is {gv}, expected {wv}")
            elif gv != wv:
                fail(f"{qid} row {i}: {col} is {gv!r}, expected {wv!r}")


def main() -> None:
    out_dir = results_dir()
    print(f"results: {out_dir}")

    compared = 0
    for qid in QUESTIONS:
        path = out_dir / f"{qid}.json"
        if not path.is_file():
            fail(f"{qid}: no result file at {path} — did `make run` answer this question?")
            continue
        try:
            rows = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            fail(f"{qid}: result file is not valid JSON ({exc})")
            continue
        if not isinstance(rows, list):
            fail(f"{qid}: result file must be a JSON array of row objects")
            continue

        invariants(qid, rows)

        expected_path = EXPECTED / f"{qid}.json"
        if expected_path.is_file():
            compare(qid, rows, json.loads(expected_path.read_text()))
            compared += 1
        else:
            print(f"  {qid}: {len(rows)} rows — invariants only "
                  f"(no published expected fixture)")

    print(f"compared {compared} of {len(QUESTIONS)} answers against "
          f"conformance/data/expected/")

    if failures:
        print(f"\n{len(failures)} failure(s):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("all checks passed")


if __name__ == "__main__":
    main()
