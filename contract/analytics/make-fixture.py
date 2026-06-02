#!/usr/bin/env python3
"""Generate contract/analytics/fixture.sql — the deterministic activity layer.

contract/seed/ gives every run the same users, events, seats and discount codes,
but no holds and no orders: a freshly seeded database has nothing to report on.
The analytics contract needs a transaction history, so this script writes one.

It is generated rather than hand-written for one reason: the money has to be
internally consistent with the pricing rules in contract/schema.sql
(`discount = floor(subtotal * percent / 100)`,
 `fee = floor((subtotal - discount) * 5 / 100) + 30`,
 `total = subtotal - discount + fee`).
Hand-maintaining forty consistent integers is how a fixture quietly stops
agreeing with the contract it is supposed to illustrate.

    python3 contract/analytics/make-fixture.py

Both this script and its output are committed. The published expected answers
in conformance/data/expected/ are derived from its output, so they have to be
regenerated too if you change anything here.

SEAT OWNERSHIP
--------------
This fixture and the browser suites share one seat inventory on an integrated
run, and neither of them owns it. The boundary is declared once, in
conformance/reserved-seats.json: rows 01 and 02 of every section of every event
belong to the browser suites, which hold and buy NAMED seats; everything from
row 03 up is this fixture's territory.

`check_seat_ownership()` below enforces that mechanically — it greps the seat ids
out of the interactive suites and refuses to write fixture.sql if either side has
crossed the line. The boundary is by row and not by section on purpose: seat price
depends on (event, section) only, so this fixture can move up a row without
moving a single number in contract/analytics/questions.yaml.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

OUT = pathlib.Path(__file__).resolve().parent / "fixture.sql"
ROOT = pathlib.Path(__file__).resolve().parents[2]
RESERVED_MANIFEST = ROOT / "conformance" / "reserved-seats.json"

FEE_PERCENT = 5
FEE_FIXED = 30

# Seat prices, mirrored from contract/seed/seats.json. Asserted against the real
# seed file at the bottom of this script so the two cannot drift.
PRICES = {
    "event_arena_2000": {"A": 7000, "B": 6000, "C": 5000, "D": 4500},
    "event_club_100": {"A": 2500},
    "event_jazz_eur": {"A": 4000, "B": 3500},
    "event_draft": {"A": 1000},
    "event_cancelled": {"A": 4000},
}
CURRENCY = {
    "event_arena_2000": "USD",
    "event_club_100": "USD",
    "event_jazz_eur": "EUR",
    "event_draft": "USD",
    "event_cancelled": "GBP",
}
SEAT_PREFIX = {
    "event_arena_2000": "seat_arena_",
    "event_club_100": "seat_club_",
    "event_jazz_eur": "seat_jazz_",
    "event_draft": "seat_draft_",
    "event_cancelled": "seat_canc_",
}
PERCENT_OFF = {"SAVE10": 10, "ARENA20": 20, "EXPIRED0": 50}

# Holds that are still running when the snapshot is taken. Deliberately far in
# the future: a hold whose expiry is near "now" would make every answer depend on
# the wall clock of whoever runs the suite.
#
# Beyond any plausible run date on purpose, not merely "later this year". On an
# integrated run a real backend is live against this same database, and its hold
# sweeper releases every `active` hold whose expires_at has passed. Once that
# happens the holds change status and the seats go back in the pool, which moves
# q3, q4 and q7 — a date-triggered failure that would look like a backend bug.
# The expiry itself is not an input to any answer, so a far date costs nothing.
FAR_FUTURE = "2099-12-31T23:59:59Z"


def seat(event: str, code: str) -> str:
    return SEAT_PREFIX[event] + code


def price(event: str, code: str) -> int:
    return PRICES[event][code[0]]


# (hold_id, event, buyer, [seat codes], created_at, expires_at, hold status,
#  order spec or None)
# An order spec is (order_id, discount code or None, order status, created_at).
HOLDS: list[tuple] = [
    # ---------------------------------------------------------------- arena, USD
    ("hold_a1", "event_arena_2000", "user_buyer_01", ["A03-01"],
     "2026-07-01T00:20:00Z", "2026-07-01T00:30:00Z", "converted",
     ("ord_a1", None, "paid", "2026-07-01T00:30:00Z")),
    # A03-02 was held by hold_ax3 at 09:00 and timed out; this hold sold it an
    # hour later. q4 must NOT count it as "expired and never ordered".
    ("hold_a2", "event_arena_2000", "user_buyer_02", ["A03-02", "A03-03"],
     "2026-07-01T09:55:00Z", "2026-07-01T10:05:00Z", "converted",
     ("ord_a2", "SAVE10", "paid", "2026-07-01T10:05:00Z")),
    ("hold_a3", "event_arena_2000", "user_buyer_03", ["B03-01", "B03-02", "B03-03"],
     "2026-07-02T14:10:00Z", "2026-07-02T14:20:00Z", "converted",
     ("ord_a3", "ARENA20", "paid", "2026-07-02T14:20:00Z")),
    # Paid at 02:15Z.
    ("hold_a4", "event_arena_2000", "user_buyer_01", ["C03-01", "C03-02", "C03-03", "C03-04"],
     "2026-07-03T02:05:00Z", "2026-07-03T02:15:00Z", "converted",
     ("ord_a4", None, "paid", "2026-07-03T02:15:00Z")),
    # 4500c with SAVE10.
    ("hold_a5", "event_arena_2000", "user_buyer_04", ["D03-01"],
     "2026-07-03T23:35:00Z", "2026-07-03T23:45:00Z", "converted",
     ("ord_a5", "SAVE10", "paid", "2026-07-03T23:45:00Z")),
    # Refunded.
    ("hold_a6", "event_arena_2000", "user_buyer_05", ["A04-01", "A04-02"],
     "2026-07-02T08:50:00Z", "2026-07-02T09:00:00Z", "converted",
     ("ord_a6", None, "refunded", "2026-07-02T09:00:00Z")),
    # A04-01 resold after the refund: one seat, two orders.
    ("hold_a7", "event_arena_2000", "user_buyer_06", ["A04-01"],
     "2026-07-04T10:50:00Z", "2026-07-04T11:00:00Z", "converted",
     ("ord_a7", None, "paid", "2026-07-04T11:00:00Z")),
    ("hold_ax1", "event_arena_2000", "user_buyer_07", ["D04-01", "D04-02"],
     "2026-07-01T08:00:00Z", "2026-07-01T08:10:00Z", "expired", None),
    ("hold_ax2", "event_arena_2000", "user_buyer_08", ["C07-01"],
     "2026-07-02T12:00:00Z", "2026-07-02T12:10:00Z", "expired", None),
    ("hold_ax3", "event_arena_2000", "user_buyer_09", ["A03-02"],
     "2026-07-01T09:00:00Z", "2026-07-01T09:10:00Z", "expired", None),
    # Released: no outbox event at all. Only the holds row remembers it.
    ("hold_ar1", "event_arena_2000", "user_buyer_10", ["B04-01", "B04-02"],
     "2026-07-03T09:00:00Z", "2026-07-03T09:10:00Z", "released", None),
    # Still-running holds leave their seats `held` in the seat map, and a held seat
    # is counted by the browser suites' availability filter. They are parked in the
    # one section per event that conformance/e2e never counts — see
    # analytics_hold_sections in conformance/reserved-seats.json. An active hold
    # has no order, so its section is not an input to any answer.
    ("hold_an1", "event_arena_2000", "user_buyer_11", ["C05-01", "C05-02", "C05-03"],
     "2026-07-05T12:00:00Z", FAR_FUTURE, "active", None),
    ("hold_an2", "event_arena_2000", "user_buyer_12", ["C12-01"],
     "2026-07-05T12:30:00Z", FAR_FUTURE, "active", None),
    # ----------------------------------------------------------------- club, USD
    ("hold_c1", "event_club_100", "user_buyer_13", ["A03-01", "A03-02"],
     "2026-07-02T17:50:00Z", "2026-07-02T18:00:00Z", "converted",
     ("ord_c1", None, "paid", "2026-07-02T18:00:00Z")),
    ("hold_c2", "event_club_100", "user_buyer_14", ["A04-01"],
     "2026-07-04T08:20:00Z", "2026-07-04T08:30:00Z", "converted",
     ("ord_c2", "SAVE10", "paid", "2026-07-04T08:30:00Z")),
    ("hold_cx1", "event_club_100", "user_buyer_15", ["A05-01", "A05-02"],
     "2026-07-02T19:00:00Z", "2026-07-02T19:10:00Z", "expired", None),
    # ----------------------------------------------------------------- jazz, EUR
    ("hold_j1", "event_jazz_eur", "user_buyer_16", ["A03-01", "A03-02"],
     "2026-07-01T19:50:00Z", "2026-07-01T20:00:00Z", "converted",
     ("ord_j1", None, "paid", "2026-07-01T20:00:00Z")),
    # SAVE10 again, but in EUR. Collapsing SAVE10 to one row adds EUR to USD.
    ("hold_j2", "event_jazz_eur", "user_buyer_17", ["B03-01"],
     "2026-07-03T05:50:00Z", "2026-07-03T06:00:00Z", "converted",
     ("ord_j2", "SAVE10", "paid", "2026-07-03T06:00:00Z")),
    ("hold_j3", "event_jazz_eur", "user_buyer_18", ["A04-01", "A04-02", "A04-03"],
     "2026-07-04T18:50:00Z", "2026-07-04T19:00:00Z", "converted",
     ("ord_j3", None, "paid", "2026-07-04T19:00:00Z")),
    ("hold_jn1", "event_jazz_eur", "user_buyer_19", ["B04-01", "B04-02"],
     "2026-07-05T13:00:00Z", FAR_FUTURE, "active", None),
    ("hold_jr1", "event_jazz_eur", "user_buyer_20", ["A05-01"],
     "2026-07-02T11:00:00Z", "2026-07-02T11:10:00Z", "released", None),
    # ------------------------------------------- cancelled event, GBP, sold first
    ("hold_x1", "event_cancelled", "user_buyer_21", ["A03-01", "A03-02"],
     "2026-07-01T14:50:00Z", "2026-07-01T15:00:00Z", "converted",
     ("ord_x1", None, "paid", "2026-07-01T15:00:00Z")),
    ("hold_x2", "event_cancelled", "user_buyer_22", ["A04-01"],
     "2026-07-02T14:50:00Z", "2026-07-02T15:00:00Z", "converted",
     ("ord_x2", None, "refunded", "2026-07-02T15:00:00Z")),
    # event_cancelled has only four rows, so the expired hold shares row 04 with
    # hold_x2 rather than moving to a row that does not exist.
    ("hold_xx1", "event_cancelled", "user_buyer_23", ["A04-02"],
     "2026-07-02T20:00:00Z", "2026-07-02T20:10:00Z", "expired", None),
    # event_draft has no activity at all — q7 must still report it.
]


def q(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def money(event: str, seat_codes: list[str], code: str | None) -> dict[str, int]:
    subtotal = sum(price(event, c) for c in seat_codes)
    discount = 0
    if code:
        discount = subtotal * PERCENT_OFF[code] // 100
    after = subtotal - discount
    fee = after * FEE_PERCENT // 100 + FEE_FIXED
    return {
        "subtotal_cents": subtotal,
        "discount_cents": discount,
        "fee_cents": fee,
        "total_cents": subtotal - discount + fee,
    }


def build() -> str:
    lines: list[str] = [
        "-- TicketForge analytics fixture — GENERATED by contract/analytics/make-fixture.py",
        "-- Do not edit by hand. Money is derived from the pricing rules in",
        "-- contract/schema.sql, so editing a number here silently breaks the contract.",
        "--",
        "-- Loads on top of contract/seed (users, events, seats, discounts) and adds the",
        "-- transaction history the analytics questions are defined against: holds in all",
        "-- four states, paid and refunded orders across three currencies, a seat refunded",
        "-- and resold, and the outbox trail that is the only surviving record of holds",
        "-- whose hold_seats rows were deleted on expiry.",
        "",
        "BEGIN;",
        "",
    ]

    def emit(sql: str) -> None:
        lines.append(sql)

    held_seats: list[tuple[str, str]] = []   # (seat_id, hold_id) still on hold
    sold_seats: set[str] = set()
    outbox: list[tuple[str, dict, str, bool]] = []  # (type, payload, created_at, published)

    for hold_id, event, buyer, codes, created, expires, status, order in HOLDS:
        seat_ids = [seat(event, c) for c in codes]
        emit(
            "INSERT INTO holds (id, event_id, buyer_id, status, expires_at, created_at) VALUES "
            f"({q(hold_id)}, {q(event)}, {q(buyer)}, {q(status)}, {q(expires)}, {q(created)});"
        )
        # hold_seats survives only for holds that are still active or converted;
        # expiry and release delete the rows, as the backend does.
        if status in ("active", "converted"):
            for sid in seat_ids:
                emit(
                    "INSERT INTO hold_seats (hold_id, seat_id) VALUES "
                    f"({q(hold_id)}, {q(sid)});"
                )
        outbox.append((
            "hold.created",
            {
                "event_type": "hold.created",
                "hold_id": hold_id,
                "event_id": event,
                "buyer_id": buyer,
                "seat_ids": seat_ids,
                "expires_at": expires,
                "occurred_at": created,
            },
            created,
            status != "active",
        ))
        if status == "expired":
            outbox.append((
                "hold.expired",
                {
                    "event_type": "hold.expired",
                    "hold_id": hold_id,
                    "event_id": event,
                    "buyer_id": buyer,
                    "seat_ids": seat_ids,
                    "occurred_at": expires,
                },
                expires,
                True,
            ))
        if status == "active":
            held_seats.extend((sid, hold_id) for sid in seat_ids)

        if order is None:
            continue
        order_id, code, order_status, order_at = order
        m = money(event, codes, code)
        emit(
            "INSERT INTO orders (id, hold_id, buyer_id, event_id, subtotal_cents, fee_cents,"
            " discount_cents, total_cents, currency, discount_code, status, idempotency_key,"
            " created_at) VALUES ("
            f"{q(order_id)}, {q(hold_id)}, {q(buyer)}, {q(event)}, {m['subtotal_cents']},"
            f" {m['fee_cents']}, {m['discount_cents']}, {m['total_cents']},"
            f" {q(CURRENCY[event])}, {q(code)}, {q(order_status)}, {q('ik_' + order_id)},"
            f" {q(order_at)});"
        )
        for sid in seat_ids:
            emit(
                "INSERT INTO order_seats (order_id, seat_id) VALUES "
                f"({q(order_id)}, {q(sid)});"
            )
            sold_seats.add(sid)
        emit(
            "INSERT INTO idempotency_records (buyer_id, idempotency_key, request_hash, order_id,"
            f" created_at) VALUES ({q(buyer)}, {q('ik_' + order_id)},"
            f" {q('hash_' + order_id)}, {q(order_id)}, {q(order_at)});"
        )
        # order.paid carries no seat list — seat-level sales come from order_seats.
        if order_status == "paid":
            outbox.append((
                "order.paid",
                {
                    "event_type": "order.paid",
                    "order_id": order_id,
                    "hold_id": hold_id,
                    "event_id": event,
                    "buyer_id": buyer,
                    "total_cents": m["total_cents"],
                    "currency": CURRENCY[event],
                    "occurred_at": order_at,
                },
                order_at,
                True,
            ))

    emit("")
    emit("-- Seat map state. A refunded order's seats stay 'sold': there is no refund")
    emit("-- path that returns them to the pool, which is the discrepancy q7 reports.")
    for sid in sorted(sold_seats):
        emit(f"UPDATE seats SET status = 'sold', hold_id = NULL, version = version + 1 WHERE id = {q(sid)};")
    for sid, hold_id in sorted(held_seats):
        emit(
            f"UPDATE seats SET status = 'held', hold_id = {q(hold_id)}, version = version + 1"
            f" WHERE id = {q(sid)};"
        )

    emit("")
    emit("-- Event log. published_at is a delivery detail: the newest rows have not been")
    emit("-- dispatched yet, and analytics must not filter on it.")
    outbox.sort(key=lambda r: (r[2], r[0], json.dumps(r[1], sort_keys=True)))
    for event_type, payload, created_at, published in outbox:
        published_at = created_at if published else None
        emit(
            "INSERT INTO outbox_events (event_type, payload, created_at, published_at) VALUES ("
            f"{q(event_type)}, {q(json.dumps(payload, separators=(',', ':')))}::jsonb,"
            f" {q(created_at)}, {q(published_at)});"
        )

    emit("")
    emit("COMMIT;")
    emit("")
    return "\n".join(lines)


def row_of(seat_id: str, pattern: re.Pattern[str]) -> str:
    """The row label inside a seat id: seat_arena_B03-07 -> "03"."""
    if not pattern.fullmatch(seat_id):
        raise SystemExit(
            f"{seat_id!r} is not a TicketForge seat id — if the id scheme changed, update "
            f"seat_id_pattern in {RESERVED_MANIFEST.relative_to(ROOT)}"
        )
    return seat_id.rsplit("-", 1)[0][-2:]


def check_seat_ownership() -> None:
    """Fail loudly if this fixture and the interactive suites want the same seat.

    The failure this exists to prevent: contract/analytics/fixture.sql sells the
    seat conformance/e2e is about to hold, so 7 of 14 browser tests fail the first
    time the whole product is booted as one system against one database — and the
    symptom looks like a backend bug, not a fixture bug. It survived four
    completed role families before anybody noticed, so convention is not enough;
    the collision has to be impossible to reintroduce silently.

    Three ways to fail, all of them loud:
      1. this fixture touches a seat in an interactive row;
      2. this fixture touches any seat id an interactive spec names, whatever its
         row (belt as well as braces, in case the row rule is ever widened);
      3. an interactive spec names a seat OUTSIDE the interactive rows, which is
         the same collision approaching from the other side.
    Plus one blindness guard: a spec file that yields no seat ids at all means the
    grep has stopped seeing the suite, and a check that cannot see is worse than
    no check.
    """
    if not RESERVED_MANIFEST.is_file():
        raise SystemExit(
            f"{RESERVED_MANIFEST.relative_to(ROOT)} is missing. It is the one place the seat "
            "boundary between this fixture and the browser suites is declared, and this "
            "fixture is not safe to regenerate without it."
        )
    manifest = json.loads(RESERVED_MANIFEST.read_text())
    interactive_rows = set(manifest["interactive_rows"])
    pattern = re.compile(manifest["seat_id_pattern"])
    glob = manifest.get("spec_glob", "*.spec.ts")

    reserved_ids: dict[str, str] = {}   # seat id -> the file that named it
    scanned: list[str] = []
    # The declared owners must exist and must be visible to the grep. Beyond
    # them, any other directory under conformance/ that holds browser specs
    # addressing named seats is an owner too — found by looking rather than
    # listed, so that a suite added later cannot be forgotten here.
    owners = list(manifest["owners"])
    for d in sorted((ROOT / "conformance").iterdir()):
        rel = str(d.relative_to(ROOT))
        if d.is_dir() and rel not in owners and d.name != "node_modules" and any(d.glob(glob)):
            owners.append(rel)
    for owner in owners:
        owner_dir = ROOT / owner
        if not owner_dir.is_dir():
            raise SystemExit(
                f"{owner} is declared in {RESERVED_MANIFEST.relative_to(ROOT)} but does not "
                "exist: the seat-ownership check would be blind to it."
            )
        specs = sorted(owner_dir.glob(glob))
        if not specs:
            raise SystemExit(
                f"{owner} contains no {glob} files: the seat-ownership check has gone blind. "
                f"Fix spec_glob in {RESERVED_MANIFEST.relative_to(ROOT)}."
            )
        for spec in specs:
            found = set(pattern.findall(spec.read_text()))
            if not found:
                raise SystemExit(
                    f"{spec.relative_to(ROOT)} names no seat ids. Either the suite stopped "
                    f"addressing seats by their seeded id — in which case this check no longer "
                    f"protects anything and must be rethought — or seat_id_pattern in "
                    f"{RESERVED_MANIFEST.relative_to(ROOT)} no longer matches them."
                )
            scanned.append(f"{spec.relative_to(ROOT)} ({len(found)})")
            for sid in found:
                reserved_ids.setdefault(sid, str(spec.relative_to(ROOT)))

    # (3) the interactive suites must stay inside their own rows.
    trespassers = sorted(
        (sid, where) for sid, where in reserved_ids.items()
        if row_of(sid, pattern) not in interactive_rows
    )
    if trespassers:
        listing = "\n".join(f"    {sid}  (named by {where})" for sid, where in trespassers)
        raise SystemExit(
            "the interactive suites name seats outside their reserved rows "
            f"{sorted(interactive_rows)}:\n{listing}\n"
            "  Those rows belong to contract/analytics/fixture.sql. Move the test onto a "
            "reserved row, or widen interactive_rows in "
            f"{RESERVED_MANIFEST.relative_to(ROOT)} and move this fixture out of the way."
        )

    # (1) and (2): this fixture must stay out of interactive territory.
    collisions: list[str] = []
    for hold_id, event, _, codes, *_ in HOLDS:
        for code in codes:
            sid = seat(event, code)
            if row_of(sid, pattern) in interactive_rows:
                collisions.append(
                    f"    {sid}  ({hold_id}) is in reserved row {row_of(sid, pattern)}"
                )
            elif sid in reserved_ids:
                collisions.append(
                    f"    {sid}  ({hold_id}) is named by {reserved_ids[sid]}"
                )
    if collisions:
        raise SystemExit(
            "the analytics fixture would touch seats the interactive suites own:\n"
            + "\n".join(collisions)
            + f"\n  Rows {sorted(interactive_rows)} of every section belong to "
            + ", ".join(owners)
            + f" — see {RESERVED_MANIFEST.relative_to(ROOT)}. Move these holds to row 03 or "
              "higher in the SAME section (price is per section, so the answers do not move)."
        )

    # The second boundary: where a seat may be left in `held` status. The browser
    # suites count held seats per section, so a row rule cannot express this one —
    # see the SECOND BOUNDARY note in the manifest.
    hold_sections: dict[str, str] = manifest.get("analytics_hold_sections") or {}
    stray_holds: list[str] = []
    for hold_id, event, _, codes, _, _, status, _ in HOLDS:
        if status != "active":
            continue          # only an active hold leaves its seats `held`
        allowed = hold_sections.get(event)
        for code in codes:
            if allowed is None:
                stray_holds.append(
                    f"    {seat(event, code)}  ({hold_id}) — {event} declares no "
                    f"analytics hold section"
                )
            elif code[0] != allowed:
                stray_holds.append(
                    f"    {seat(event, code)}  ({hold_id}) is in section {code[0]}, "
                    f"but {event} parks analytics holds in section {allowed}"
                )
    if stray_holds:
        raise SystemExit(
            "the analytics fixture would leave seats `held` outside its declared sections:\n"
            + "\n".join(stray_holds)
            + "\n  A held seat is counted by the browser suites' availability filter, which "
              "asserts a count per SECTION, so a row boundary cannot separate them. Park the "
              "active hold in the section this event declares in "
            + f"{RESERVED_MANIFEST.relative_to(ROOT)}, or move that declaration. An active "
              "hold has no order, so its section changes no answer."
        )

    print(f"seat ownership: rows {sorted(interactive_rows)} reserved; "
          f"{len(reserved_ids)} ids read from " + ", ".join(scanned))
    print("  analytics holds parked in: "
          + ", ".join(f"{ev} section {sec}" for ev, sec in sorted(hold_sections.items())))


def check_against_seed() -> None:
    """Fail loudly if contract/seed no longer matches what this fixture assumes."""
    root = pathlib.Path(__file__).resolve().parents[2]
    seats = json.loads((root / "contract" / "seed" / "seats.json").read_text())["seats"]
    by_id = {s["id"]: s for s in seats}
    seed = json.loads((root / "contract" / "seed" / "seed.json").read_text())
    currencies = {e["id"]: e["currency"] for e in seed["events"]}
    percents = {d["code"]: d["percent_off"] for d in seed["discounts"]}

    for event, cur in CURRENCY.items():
        if currencies.get(event) != cur:
            raise SystemExit(f"currency drift: {event} is {currencies.get(event)}, fixture assumes {cur}")
    for code, pct in PERCENT_OFF.items():
        if percents.get(code) != pct:
            raise SystemExit(f"discount drift: {code} is {percents.get(code)}%, fixture assumes {pct}%")
    for _, event, _, codes, *_ in HOLDS:
        for c in codes:
            sid = seat(event, c)
            s = by_id.get(sid)
            if s is None:
                raise SystemExit(f"seat {sid} is not in contract/seed/seats.json")
            if s["price_cents"] != price(event, c):
                raise SystemExit(
                    f"price drift: {sid} is {s['price_cents']}c, fixture assumes {price(event, c)}c"
                )

    seen: set[tuple[str, str]] = set()
    for hold_id, event, _, codes, *_ in HOLDS:
        for c in codes:
            key = (hold_id, c)
            if key in seen:
                raise SystemExit(f"{hold_id} lists seat {c} twice")
            seen.add(key)


def main() -> None:
    check_against_seed()
    check_seat_ownership()
    OUT.write_text(build())
    print(f"wrote {OUT.relative_to(pathlib.Path(__file__).resolve().parents[2])}")


if __name__ == "__main__":
    main()
