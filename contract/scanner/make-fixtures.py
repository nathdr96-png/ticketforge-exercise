#!/usr/bin/env python3
"""Generate the edge/scanner family's fixtures from contract/seed/.

    python3 contract/scanner/make-fixtures.py

Writes, all of it derived and none of it hand-maintained:

    contract/scanner/tickets.jsonl          one signed ticket per seated ticket
    contract/scanner/scenarios/index.tsv    the runner's manifest
    contract/scanner/scenarios/<id>/*.txt   the transcript segments
    contract/scanner/scenarios/<id>/initial-state/*  pre-commissioned devices

The scanner family shares the product's fixtures rather than inventing a
parallel set: every ticket below is a seat from `contract/seed/seats.json`,
and every admission window is derived from its event's `starts_at` in
`contract/seed/seed.json`. Change the seed and this regenerates; nothing here
restates a number the seed already owns.

The signature is a keyed FNV-1a-64 digest, specified in full in
contract/scanner/README.md. It is deliberately NOT cryptography — it exists so
that three languages with no shared library can agree byte for byte on whether a
ticket was tampered with. Never ship it at a real door.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent
SEED = ROOT / "contract" / "seed"

SIG_KEY = "tf-scanner-v1"
FNV_OFFSET = 0xCBF29CE484222325
FNV_PRIME = 0x100000001B3
MASK64 = 0xFFFFFFFFFFFFFFFF

# Doors open two hours before the advertised start and the window closes three
# hours after it. Both numbers are declared here and nowhere else; rules.yaml
# refers to them by name.
DOORS_OPEN_BEFORE_S = 7200
DOORS_CLOSE_AFTER_S = 10800


def fnv1a64(data: bytes) -> int:
    h = FNV_OFFSET
    for byte in data:
        h ^= byte
        h = (h * FNV_PRIME) & MASK64
    return h


def sign(ticket_id: str, event_id: str, seat_id: str, valid_from: int, valid_to: int) -> str:
    payload = f"{SIG_KEY}|{ticket_id}|{event_id}|{seat_id}|{valid_from}|{valid_to}"
    return f"{fnv1a64(payload.encode()):016x}"


def blob(ticket_id: str, event_id: str, seat_id: str, valid_from: int, valid_to: int,
         signature: str | None = None) -> str:
    sig = signature if signature is not None else sign(ticket_id, event_id, seat_id, valid_from, valid_to)
    return f"{ticket_id}|{event_id}|{seat_id}|{valid_from}|{valid_to}|{sig}"


def epoch(iso: str) -> int:
    return int(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def load_seed() -> tuple[dict, list[dict]]:
    seed = json.loads((SEED / "seed.json").read_text())
    seats = json.loads((SEED / "seats.json").read_text())["seats"]
    events = {e["id"]: e for e in seed["events"]}
    return events, seats


def ticket_id_for(seat_id: str) -> str:
    # seat_arena_A01-01 -> tkt_arena_A01-01. The seat id is the ticket id's whole
    # identity: one seat, one ticket, which is what makes "admitted exactly once"
    # a statement about the venue and not about a database row.
    assert seat_id.startswith("seat_"), seat_id
    return "tkt_" + seat_id[len("seat_"):]


def main() -> None:
    events, seats = load_seed()

    tickets: dict[str, dict] = {}
    lines: list[str] = []
    for seat in seats:
        event = events[seat["event_id"]]
        start = epoch(event["starts_at"])
        valid_from = start - DOORS_OPEN_BEFORE_S
        valid_to = start + DOORS_CLOSE_AFTER_S
        tid = ticket_id_for(seat["id"])
        rec = {
            "ticket_id": tid,
            "event_id": seat["event_id"],
            "seat_id": seat["id"],
            "valid_from": valid_from,
            "valid_to": valid_to,
            "price_cents": seat["price_cents"],
            "currency": event["currency"],
            "blob": blob(tid, seat["event_id"], seat["id"], valid_from, valid_to),
        }
        tickets[tid] = rec
        lines.append(json.dumps(rec, separators=(",", ":"), sort_keys=True))

    (OUT / "tickets.jsonl").write_text("\n".join(lines) + "\n")
    print(f"wrote contract/scanner/tickets.jsonl ({len(lines)} tickets)")

    arena = events["event_arena_2000"]
    E = epoch(arena["starts_at"])
    write_scenarios(tickets, E)


def t(tickets: dict, tid: str) -> str:
    return tickets[tid]["blob"]


def write_scenarios(tickets: dict, E: int) -> None:
    """Every transcript in the contract, with the expected decision beside each
    SCAN as a comment. The comments are documentation only: the suite grades the
    decisions an implementation actually emitted, never these."""
    scen_dir = OUT / "scenarios"
    if scen_dir.exists():
        shutil.rmtree(scen_dir)
    scen_dir.mkdir(parents=True)

    A = lambda n: t(tickets, f"tkt_arena_A01-{n:02d}")          # noqa: E731
    B = lambda n: t(tickets, f"tkt_arena_B05-{n:02d}")          # noqa: E731
    JAZZ = t(tickets, "tkt_jazz_A01-01")

    doors = E - DOORS_OPEN_BEFORE_S
    close = E + DOORS_CLOSE_AFTER_S
    before_doors = E - 20000          # authoritative time before the window opens
    at_door = E - 3600                # an hour before the show, well inside the window

    scenarios: list[dict] = []

    def add(sid: str, title: str, queue_max: int, segments: list[str],
            initial_state: dict | None = None, readme: str = "") -> None:
        d = scen_dir / sid
        d.mkdir()
        for i, body in enumerate(segments, start=1):
            (d / f"{i:02d}.txt").write_text(body.strip() + "\n")
        if initial_state is not None:
            st = d / "initial-state"
            st.mkdir()
            (st / "counters.json").write_text(json.dumps(initial_state, indent=2) + "\n")
            for name in ("admitted.log", "queue.log", "uploaded.log"):
                (st / name).write_text("")
        (d / "README.md").write_text(readme.strip() + "\n")
        scenarios.append({
            "id": sid, "title": title, "queue_max": queue_max,
            "segments": len(segments), "initial_state": initial_state is not None,
        })

    # ---------------------------------------------------------------- s01
    add(
        "s01-happy-door", "A commissioned gate admitting valid tickets online", 64,
        [f"""
# The ordinary case: the gate is commissioned, the link is up, authoritative
# time has been obtained, and four valid arena tickets walk through.
GATE event_arena_2000
LINK up
NOW {at_door}
TIME {at_door}
SCAN {A(1)}
#   -> 1 tkt_arena_A01-01 ADMIT OK
SCAN {A(2)}
#   -> 2 tkt_arena_A01-02 ADMIT OK
SCAN {A(3)}
#   -> 3 tkt_arena_A01-03 ADMIT OK
SYNC
#   -> SYNC 3 0
TICK 60
SCAN {A(4)}
#   -> 4 tkt_arena_A01-04 ADMIT OK
SYNC
#   -> SYNC 1 0
SYNC
#   -> SYNC 0 0        a sync with an empty queue uploads nothing
"""],
        readme="""
# s01-happy-door

The baseline. Nothing is offline, nothing is wrong, nothing is skewed. It exists
so that a failure anywhere else in the corpus can be read as "that rule", not as
"the device does not work at all".

The last two `SYNC`s are the point: uploading an empty queue must upload nothing
rather than re-uploading what was already acknowledged.
""",
    )

    # ---------------------------------------------------------------- s02
    add(
        "s02-duplicate-at-the-door", "A ticket is admitted exactly once", 64,
        [f"""
GATE event_arena_2000
LINK up
NOW {at_door}
TIME {at_door}
SCAN {A(1)}
#   -> 1 tkt_arena_A01-01 ADMIT OK
SCAN {A(1)}
#   -> 2 tkt_arena_A01-01 REFUSE DUPLICATE
SCAN {A(2)}
#   -> 3 tkt_arena_A01-02 ADMIT OK
TICK 5
SCAN {A(1)}
#   -> 4 tkt_arena_A01-01 REFUSE DUPLICATE
SYNC
#   -> SYNC 4 0
"""],
        readme="""
# s02-duplicate-at-the-door

One seat, one admission. A refused duplicate is still a scan: it gets a sequence
number, it is counted, and it is queued for upload, because a ticket presented
twice is exactly the thing the back office wants to see.
""",
    )

    # ---------------------------------------------------------------- s03
    add(
        "s03-restart-remembers", "A clean restart does not forget who came in", 64,
        [f"""
GATE event_arena_2000
LINK up
NOW {at_door}
TIME {at_door}
SCAN {A(1)}
#   -> 1 tkt_arena_A01-01 ADMIT OK
SCAN {A(2)}
#   -> 2 tkt_arena_A01-02 ADMIT OK
LINK down
SCAN {A(3)}
#   -> 3 tkt_arena_A01-03 ADMIT OK
""",
         f"""
# Segment 2 is a NEW PROCESS against the same state directory. Nothing is
# repeated here: the gate, the link state, the time anchor, the sequence number
# and the admitted set all have to come off the disk.
SCAN {A(1)}
#   -> 4 tkt_arena_A01-01 REFUSE DUPLICATE
SCAN {A(4)}
#   -> 5 tkt_arena_A01-04 ADMIT OK
LINK up
TIME {at_door + 600}
SYNC
#   -> SYNC 5 0
"""],
        readme="""
# s03-restart-remembers

A scanner at a door gets power-cycled, re-flashed and rebooted mid-event. The
second segment is a fresh process with an empty memory and the same state
directory, and it must pick up exactly where the first left off — including the
sequence counter, the queue, the link state and the trusted-time anchor.

Note that nothing in segment 2 re-commissions the gate or re-fetches the time.
A device that keeps commissioning in RAM admits a ticket for the wrong event
after every reboot.
""",
    )

    # ---------------------------------------------------------------- s04
    add(
        "s04-power-loss", "An unclean power loss does not forget who came in", 64,
        [f"""
GATE event_arena_2000
LINK up
NOW {at_door}
TIME {at_door}
LINK down
SCAN {A(1)}
#   -> 1 tkt_arena_A01-01 ADMIT OK
SCAN {A(2)}
#   -> 2 tkt_arena_A01-02 ADMIT OK
SCAN {A(2)}
#   -> 3 tkt_arena_A01-02 REFUSE DUPLICATE
ABORT
# The mains go. No flush, no cleanup, no exit handler: everything the device has
# already answered for must ALREADY be on the disk.
""",
         f"""
SCAN {A(1)}
#   -> 4 tkt_arena_A01-01 REFUSE DUPLICATE
SCAN {A(3)}
#   -> 5 tkt_arena_A01-03 ADMIT OK
LINK up
TIME {at_door + 100}
SYNC
#   -> SYNC 5 0
"""],
        readme="""
# s04-power-loss

The difference between this and `s03-restart-remembers` is the whole point of
the scenario. There the device reaches end of input and exits normally, so a
buffered implementation gets away with flushing on the way out. Here `ABORT`
terminates the process immediately — no stdio flush, no atexit handler, no
destructor — which is what losing the mains at a turnstile actually looks like.

So every decision has to be durable *before* it is announced. A device that
batches its writes passes s03 and fails here, which is precisely the bug worth
catching: it is invisible until the one night it matters.
""",
    )

    # ---------------------------------------------------------------- s05
    offline = "\n".join(
        f"SCAN {A(n)}\n#   -> {n} tkt_arena_A01-{n:02d} ADMIT OK" for n in range(1, 13)
    )
    add(
        "s05-offline-queue-and-sync", "Scans taken offline replay in order, exactly once", 64,
        [f"""
GATE event_arena_2000
LINK up
NOW {at_door}
TIME {at_door}
LINK down
{offline}
SYNC
#   -> SYNC 0 12       nothing can be uploaded with the link down
LINK up
TIME {at_door + 600}
SYNC
#   -> SYNC 12 0
SYNC
#   -> SYNC 0 0        idempotent: the acknowledged records are gone, not resent
SCAN {A(13)}
#   -> 13 tkt_arena_A01-13 ADMIT OK
SYNC
#   -> SYNC 1 0
"""],
        readme="""
# s05-offline-queue-and-sync

The reason the device exists. The network at a venue door is unreliable, so the
door keeps working and the records wait. When the link comes back they go up in
the order they were taken, each exactly once, and the queue empties.

`uploaded.log` is the artifact that proves it: thirteen records, record ids
ascending with no gaps and no repeats. A device that re-sends on every sync, or
that drains the queue before the upload is acknowledged, shows up there.
""",
    )

    # ---------------------------------------------------------------- s06
    flood = "\n".join(
        f"SCAN {A(n)}\n#   -> {n} tkt_arena_A01-{n:02d} ADMIT OK" for n in range(1, 21)
    )
    add(
        "s06-queue-bound", "At the storage bound the door stays open and the loss is counted", 8,
        [f"""
# queue_max = 8. Twenty people arrive while the link is down.
GATE event_arena_2000
LINK up
NOW {at_door}
TIME {at_door}
LINK down
{flood}
LINK up
TIME {at_door + 900}
SYNC
#   -> SYNC 8 0        the eight newest records; twelve were evicted and counted
"""],
        initial_state=None,
        readme="""
# s06-queue-bound

The device has finite flash. Twenty scans, room for eight.

The contract's answer is that **the door never closes**: all twenty people are
admitted, because refusing entry to a paying customer because a log is full is a
worse failure than losing a reconciliation record. What must not happen is
losing the record *silently*, so the oldest unsynced record is dropped and
`queue_evicted_total` counts every drop. Finance can then see exactly how much
of the night is unaccounted for instead of discovering a gap later.

The admitted set is never evicted. It is the authority for "this ticket has
already been used" and dropping an entry from it would let somebody in twice.
""",
    )

    # ---------------------------------------------------------------- s07
    add(
        "s07-clock-skew", "Validity comes from the ticket's signed window, not the local clock", 64,
        [f"""
GATE event_arena_2000
LINK up
NOW {at_door}
# Authoritative time says the doors have not opened yet, even though the local
# wall clock (NOW, above) says they have.
TIME {before_doors}
SCAN {A(5)}
#   -> 1 tkt_arena_A01-05 REFUSE NOT_YET_VALID
TIME {at_door}
SCAN {A(1)}
#   -> 2 tkt_arena_A01-01 ADMIT OK
LINK down
# The battery-backed clock dies and comes back reading 2030.
NOW 1893456000
SCAN {A(2)}
#   -> 3 tkt_arena_A01-02 ADMIT OK
# Now it reads 1970.
NOW 0
SCAN {A(3)}
#   -> 4 tkt_arena_A01-03 ADMIT OK
# Five hours of real elapsed time: the trusted clock is now past valid_to.
TICK 18000
SCAN {A(4)}
#   -> 5 tkt_arena_A01-04 REFUSE EXPIRED
# "Correcting" the wall clock back into the window must not reopen the gate.
NOW {at_door}
SCAN {A(6)}
#   -> 6 tkt_arena_A01-06 REFUSE EXPIRED
SCAN {A(1)}
#   -> 7 tkt_arena_A01-01 REFUSE DUPLICATE
LINK up
TIME {at_door + 18000}
SYNC
#   -> SYNC 7 0
"""],
        readme=f"""
# s07-clock-skew

Turnstile hardware keeps time with a coin cell, and coin cells die. The local
wall clock in this transcript reads 2030, then 1970, then the right time again;
none of it changes a single decision.

What the device decides against is its **trusted clock**: the last
authoritative time it was handed over the link, carried forward by elapsed
monotonic time. That is why `TICK 18000` expires a ticket and `NOW` never does.

The window itself is in the ticket and is signed, so a skewed device cannot
widen it. Arena tickets are valid from {doors} to {close} — doors two hours
before the advertised start, closing three hours after it.

The last scan is deliberate: a ticket that has already been admitted reads
`DUPLICATE` and not `EXPIRED`. "Already used" is independent of what time it is,
and it is the answer the person on the door can act on.
""",
    )

    # ---------------------------------------------------------------- s08
    add(
        "s08-reconnect-replay-idempotent", "Replay after reconnect is idempotent", 64,
        [f"""
GATE event_arena_2000
LINK up
NOW {at_door}
TIME {at_door}
SCAN {A(1)}
#   -> 1 tkt_arena_A01-01 ADMIT OK
SCAN {A(2)}
#   -> 2 tkt_arena_A01-02 ADMIT OK
SYNC
#   -> SYNC 2 0
LINK down
SCAN {A(3)}
#   -> 3 tkt_arena_A01-03 ADMIT OK
LINK up
TIME {at_door + 50}
SYNC
#   -> SYNC 1 0
# The link flaps and upstream re-pushes records it already holds. None of this
# is new information and none of it may change anything.
REPLAY tkt_arena_A01-01 {at_door}
REPLAY tkt_arena_A01-01 {at_door}
REPLAY tkt_arena_A01-02 {at_door}
SCAN {A(1)}
#   -> 4 tkt_arena_A01-01 REFUSE DUPLICATE
""",
         f"""
# A ticket admitted at the OTHER gate arrives as a replay. The device has never
# seen it, so it must absorb it — the person is already inside.
REPLAY tkt_arena_B05-07 {at_door - 100}
SCAN {B(7)}
#   -> 5 tkt_arena_B05-07 REFUSE DUPLICATE
SCAN {A(4)}
#   -> 6 tkt_arena_A01-04 ADMIT OK
LINK up
TIME {at_door + 200}
SYNC
#   -> SYNC 3 0      the duplicate queued at the end of segment 1 is still here
"""],
        readme="""
# s08-reconnect-replay-idempotent

Two things the server does on reconnect, both of which have broken real
devices:

1. **It re-sends records the device already synced.** Replaying
   `tkt_arena_A01-01` twice must change nothing at all — not the admitted set,
   not the queue, not `admitted_total`. A device that treats an inbound record
   as "new information" and re-queues it duplicates every record it ever
   uploaded, and one that *resets* its admitted set from the inbound batch lets
   the same ticket in twice.

2. **It pushes records from other gates.** `tkt_arena_B05-07` was admitted at
   the far door and this device has never seen it. Absorbing it is what makes a
   multi-gate venue safe: the next scan of that ticket here is a `DUPLICATE`.

`replay_total` counts every inbound record and `replay_absorbed_total` counts
the ones that were new, so the two cases above are separately visible. Local
throughput (`admitted_total`) deliberately does not move for a replay: it is a
count of people this door let in.
""",
    )

    # ---------------------------------------------------------------- s09
    seeded = {
        "gate_event_id": "event_arena_2000",
        "link_up": False,
        "trusted_epoch": at_door,
        "trusted_anchor_mono": 0,
        "mono": 0,
        "wall": at_door,
        "next_seq": 4294967290,
        "next_record_id": 281474976710650,
        "scans_total": 4294967289,
        "admitted_total": 4294967289,
        "refused_total": 0,
        "refused_by_reason": {},
        "queued_total": 4294967289,
        "uploaded_total": 4294967289,
        "queue_evicted_total": 0,
        "queue_depth": 0,
        "replay_total": 0,
        "replay_absorbed_total": 0,
        "admitted_known": 0,
        "sync_offline_total": 0,
        "time_rejected_total": 0,
        "unknown_event_total": 0,
    }
    bound = "\n".join(
        f"SCAN {A(n)}\n#   -> {4294967289 + n + (1 if n > 2 else 0)} tkt_arena_A01-{n:02d} ADMIT OK"
        for n in [1, 2]
    )
    add(
        "s09-counter-bounds", "Counters are exact across the 32-bit boundary", 64,
        [f"""
# This device is handed to us already commissioned and already old: see
# initial-state/counters.json. Its next sequence number is 4294967290, six short
# of 2^32, and its next record id is six short of 2^48.
LINK down
{bound}
SCAN {A(2)}
#   -> 4294967292 tkt_arena_A01-02 REFUSE DUPLICATE
SCAN {A(3)}
#   -> 4294967293 tkt_arena_A01-03 ADMIT OK
SCAN {A(4)}
#   -> 4294967294 tkt_arena_A01-04 ADMIT OK
SCAN {A(5)}
#   -> 4294967295 tkt_arena_A01-05 ADMIT OK        2^32 - 1
SCAN {A(6)}
#   -> 4294967296 tkt_arena_A01-06 ADMIT OK        2^32: a 32-bit counter is 0 here
SCAN {A(7)}
#   -> 4294967297 tkt_arena_A01-07 ADMIT OK
SCAN {A(8)}
#   -> 4294967298 tkt_arena_A01-08 ADMIT OK
SCAN {A(9)}
#   -> 4294967299 tkt_arena_A01-09 ADMIT OK
LINK up
TIME {at_door}
SYNC
#   -> SYNC 10 0
"""],
        initial_state=seeded,
        readme="""
# s09-counter-bounds

A scanner that has been on a door for three seasons has large counters. This
one starts six scans short of 2^32 and its record ids six short of 2^48, so a
`uint32_t` sequence number wraps to zero in the middle of the transcript and an
`int` record id goes negative.

Both numbers are read off the disk at boot and written back to it, so the bound
is reachable in ten lines instead of four billion. Nothing here is synthetic
about the arithmetic: the device really does have to carry a 2^32 sequence
number through a scan, a persist and a reload.

The declared safe bound is 2^53 - 1 — every counter is exchanged as a JSON
number and must survive the round trip exactly.

The seeded state has lifetime totals in the billions and an **empty**
`admitted.log`, which is not a contradiction: the admitted set is scoped to the
event this gate is commissioned to, and last season's log was archived off the
device. `admitted_known` and `queue_depth` are derived from the two logs rather
than read back from `counters.json`, so a device always believes what is
actually on its flash over what the last summary claimed.
""",
    )

    # ---------------------------------------------------------------- s10
    tampered = blob("tkt_arena_A01-01", "event_arena_2000",
                    "seat_arena_A01-01", doors, close, signature="0" * 16)
    # Window widened by a day, signature left as it was: the classic forgery.
    widened = blob("tkt_arena_A01-01", "event_arena_2000", "seat_arena_A01-01",
                   doors, close + 86400,
                   signature=sign("tkt_arena_A01-01", "event_arena_2000",
                                  "seat_arena_A01-01", doors, close))
    # Two different over-long ticket ids, and the difference between them is the
    # whole point. This one is 200 bytes in a blob of 243, so the blob is legal
    # and the FIELD is not: a parser that measures the blob and then copies the
    # field is memory-unsafe exactly here, and nowhere else in the corpus.
    long_id_legal_blob = "tkt_" + ("X" * 196)
    overflow = blob(long_id_legal_blob, "e", "s", doors, close)
    # And this one is 310 bytes in a blob of 370, over the blob maximum, so it is
    # refused before any field is looked at.
    long_id = "tkt_arena_" + ("X" * 300)
    overlong = blob(long_id, "event_arena_2000", "seat_arena_A01-01", doors, close)
    inverted = blob("tkt_arena_A01-99", "event_arena_2000", "seat_arena_A01-99", close, doors)
    huge = "Z" * 900
    add(
        "s10-bad-tickets", "Everything that is not a valid ticket, in precedence order", 64,
        [f"""
NOW {at_door}
SCAN {A(1)}
#   -> 1 tkt_arena_A01-01 REFUSE NOT_COMMISSIONED
GATE event_arena_2000
SCAN {A(1)}
#   -> 2 tkt_arena_A01-01 REFUSE NO_TRUSTED_TIME
LINK up
TIME {at_door}
SCAN {tampered}
#   -> 3 tkt_arena_A01-01 REFUSE BAD_SIGNATURE
SCAN {widened}
#   -> 4 tkt_arena_A01-01 REFUSE BAD_SIGNATURE       window widened, signature not
SCAN {JAZZ}
#   -> 5 tkt_jazz_A01-01 REFUSE WRONG_EVENT
SCAN tkt_arena_A01-01|event_arena_2000|seat_arena_A01-01
#   -> 6 - REFUSE MALFORMED                          three fields, not six
SCAN {overflow}
#   -> 7 - REFUSE MALFORMED       200-byte ticket id inside a legal 243-byte blob
SCAN {overlong}
#   -> 8 - REFUSE MALFORMED       310-byte ticket id inside a 370-byte blob
SCAN
#   -> 9 - REFUSE MALFORMED                          no ticket at all
SCAN {inverted}
#   -> 10 - REFUSE MALFORMED                         valid_from after valid_to
SCAN {huge}
#   -> 11 - REFUSE MALFORMED                         900-byte line
NOT-AN-EVENT whatever
# ignored and counted in unknown_event_total; the device keeps reading
SCAN {A(1)}
#   -> 12 tkt_arena_A01-01 ADMIT OK
SCAN {A(1)}
#   -> 13 tkt_arena_A01-01 REFUSE DUPLICATE
SYNC
#   -> SYNC 13 0
"""],
        readme="""
# s10-bad-tickets

Everything a turnstile gets presented with that is not a ticket, in the order
the contract checks it. The precedence matters as much as the individual
answers: a 310-byte ticket id is `MALFORMED` and never reaches the signature
check, and a ticket for the jazz night is `WRONG_EVENT` at the arena door even
though it is perfectly valid at its own.

Three lines here exist to be hostile to the parser rather than to the rules, and
the first of them is the one that matters:

- a **200-byte ticket id inside a 243-byte blob**. The blob is under the declared
  256-byte maximum, so a parser that checks the blob's length and then copies the
  field without checking it reaches this line and writes 200 bytes into a 64-byte
  field. The suite runs the whole corpus under AddressSanitizer for this one
  line, and being refused is not enough: the process must also come out clean.
- a **310-byte ticket id inside a 370-byte blob**, which is over the blob maximum
  and is therefore refused before any field is looked at. It is here to make the
  precedence visible, not to stress the parser.
- a **900-byte line**, against a declared 1024-byte line maximum.

The last three lines matter too. An unknown event type is skipped, counted and
survived, because a newer server will one day send this device a verb it has
never heard of and the door must not stop. And after all of that, a real ticket
still gets in.
""",
    )

    index = ["# scenario_id\tqueue_max\tsegments\tinitial_state\ttitle"]
    for s in scenarios:
        index.append(
            f"{s['id']}\t{s['queue_max']}\t{s['segments']}\t"
            f"{'yes' if s['initial_state'] else 'no'}\t{s['title']}"
        )
    (scen_dir / "index.tsv").write_text("\n".join(index) + "\n")
    print(f"wrote contract/scanner/scenarios/index.tsv ({len(scenarios)} scenarios)")
    for s in scenarios:
        print(f"  {s['id']}  queue_max={s['queue_max']}  segments={s['segments']}")


if __name__ == "__main__":
    main()
