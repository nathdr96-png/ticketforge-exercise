# contract/scanner — the turnstile scanner

This directory is to the **edge** family what [`../openapi.yaml`](../openapi.yaml)
is to the backend family: the whole of what an implementation is graded on, with
the reason a reviewer would care written next to each rule.

TicketForge sells time-limited seat holds that become tickets, and tickets get
presented at a door. The door has a scanner on it. The network at a venue door is
unreliable, so the scanner decides admissions **by itself** and reconciles later.
That is the product requirement; everything below falls out of it.

| File | What it is |
| --- | --- |
| [`interface.yaml`](./interface.yaml) | The process interface: argv, the transcript grammar, the ticket blob, the decision lines, the state files, the run protocol |
| [`rules.yaml`](./rules.yaml) | The 17 graded rules with stable ids, plus the four that could **not** be graded objectively and why |
| [`scenarios/`](./scenarios/) | The transcripts, one directory per scenario, with `index.tsv` as the runner's manifest |
| [`tickets.jsonl`](./tickets.jsonl) | 2230 signed tickets, one per seat in `../seed/seats.json` |
| [`make-fixtures.py`](./make-fixtures.py) | Regenerates `tickets.jsonl` and `scenarios/` from `../seed/` |
| [`run-scenarios.sh`](./run-scenarios.sh) | Drives one device binary through every scenario and writes the declared outputs |

Nothing here invents fixtures. Every ticket is a seat from `../seed/seats.json`,
and every admission window is derived from its event's `starts_at` in
`../seed/seed.json` — doors open two hours before the advertised start and close
three hours after it. Change the seed, run `make-fixtures.py`, and the scanner
family follows. That is deliberate: this is the same product, so it is the same
inventory.

## Why the grading surface is a transcript

A turnstile scanner is embedded software, and the obvious ways to grade embedded
software are all bad ways to grade a candidate. Hardware is not reproducible. A
simulator is a second implementation nobody has verified. "Read the code and form
an impression" is not a bar, it is a conversation.

So the device is specified as a program that reads a **deterministic transcript
of events on stdin** and writes **decisions to stdout and state to files**. Feed
it a fixed transcript, get a fixed answer. There is no clock to race, no socket to
bind, no device to plug in, and no reason a C scanner and a Rust scanner should
produce different bytes.

What that buys, in order of how much it matters:

- **Objectivity.** The decision sequence is exact. "It mostly works" is not a
  state the suite can be in.
- **Language independence.** `slots/embedded-systems-developer/scanner-c` and `slots/embedded-systems-developer/scanner-rust`
  are driven by the *same* [`run-scenarios.sh`](./run-scenarios.sh), so a
  divergence between them is a difference in the device, never a difference in
  how it was exercised.
- **Restart and power loss become ordinary test inputs.** A scenario is a *list*
  of transcript segments, and each segment is a separate process against the same
  state directory. A segment boundary is therefore a restart — a real one, with a
  real empty address space. And the `ABORT` event terminates a process
  immediately, with no flush and no exit handler, which is the only honest way to
  put a power cut in a test fixture.

The one thing it does not buy is physical behaviour: real flash, real latency,
real RAM pressure. Those are in `rules.yaml` under `not_graded`, with the reason
each one resisted objective measurement. They are interview questions, not test
cases, and pretending otherwise would be the worse failure.

## The interface in one page

The device is `scanner --state <dir> --queue-max <n>`. It reads the transcript
from stdin, writes decisions to stdout, and keeps everything it knows in
`<dir>`.

### Input: one event per line

```
GATE event_arena_2000                     commission this gate to one event
LINK up | LINK down                       connectivity
TICK 60                                   60 seconds of monotonic elapsed time
NOW 1788285600                            the local wall clock jumps here (UNTRUSTED)
TIME 1788285600                           authoritative time from upstream (needs LINK up)
SCAN tkt_arena_A01-01|event_arena_2000|seat_arena_A01-01|1788282000|1788300000|c382b9bf8d6d7bd4
SYNC                                      upload the queue, in order, and clear it
REPLAY tkt_arena_B05-07 1788285500        upstream says another gate admitted this
ABORT                                     the mains go: terminate NOW, flush nothing
```

`#` starts a comment, blank lines are ignored, and an event verb the device has
never heard of is skipped, counted and survived — because one day a newer server
will send it one.

### Output: one line per SCAN, one line per SYNC

```
1 tkt_arena_A01-01 ADMIT OK
2 tkt_arena_A01-01 REFUSE DUPLICATE
7 - REFUSE MALFORMED
SYNC 12 0
```

The sequence number starts at 1 on a fresh device, survives restarts, and
increments once per scan — including refusals, duplicates and malformed blobs,
because "how many people did this door see" and "how many did it let in" are
different questions and the venue asks both.

The refusal reasons are `DUPLICATE`, `NOT_YET_VALID`, `EXPIRED`, `WRONG_EVENT`,
`BAD_SIGNATURE`, `MALFORMED`, `NO_TRUSTED_TIME`, `NOT_COMMISSIONED`, and they are
checked in that **declared precedence**:

```
MALFORMED → BAD_SIGNATURE → NOT_COMMISSIONED → WRONG_EVENT
          → DUPLICATE → NO_TRUSTED_TIME → NOT_YET_VALID → EXPIRED → OK
```

Two of those orderings are decisions rather than conveniences.
`MALFORMED` comes first so an over-long field is rejected on its length before
anything reads it. `DUPLICATE` comes before the time checks so that a ticket
which has already been through the turnstile reads `DUPLICATE` whatever the clock
says — "already used" does not depend on the time, and it is the answer the person
on the door can act on.

### The ticket is self-verifying

```
<ticket_id>|<event_id>|<seat_id>|<valid_from>|<valid_to>|<signature>
```

The device holds **no ticket database**. It cannot: it is offline. Everything it
needs to decide is in the blob, and the signature is what stops the blob being
edited. `signature` is a keyed FNV-1a-64 digest over
`tf-scanner-v1|<ticket_id>|<event_id>|<seat_id>|<valid_from>|<valid_to>`, printed
as 16 lowercase hex digits; the algorithm is spelled out in
[`interface.yaml`](./interface.yaml).

> It is **not** cryptography. It is a checksum with a key, chosen so that C, Rust
> and MicroPython can agree byte for byte without a shared crypto library on a
> device with 64 KiB of RAM. A real product signs with Ed25519 against a public
> key burned into the device. `rules.yaml` records this under `not_graded` as
> `SCAN-X04` so nobody copies it into something that matters.

### The offline queue on disk

```
state/queue.log       <record_id> <ticket_id|-> <scanned_at> <ADMIT|REFUSE> <reason>
state/uploaded.log    the same lines, in the order they were handed upstream
state/admitted.log    <ticket_id> <admitted_at> <LOCAL|REPLAY>
state/counters.json   every counter, exact, including next_seq and next_record_id
```

`queue.log` is FIFO and bounded by `--queue-max`. `uploaded.log` is the artifact
that proves the hard part: a re-sent record or a dropped one is invisible
everywhere else once the queue has drained, and it shows up here as a repeated or
missing record id.

`admitted.log` is append-only and is never evicted, because it is the authority
for "this ticket has already been used" and it is the one file that cannot be
reconstructed from anywhere else.

## The rules, and what each one is really about

The assertable form of each is in [`rules.yaml`](./rules.yaml) with its scenarios.
The short version:

**A ticket is admitted once, and stays admitted** (`SCAN-R01`, `R02`, `R03`).
One seat, one person. The hard part is not the check, it is that the check has to
survive the device being power-cycled, re-flashed and swapped mid-event — so the
admitted set is on the flash, and it is written *before* the decision is
announced, not after. `s03-restart-remembers` ends a process cleanly;
`s04-power-loss` kills one with `ABORT`. A device that buffers its writes passes
the first and fails the second, which is the bug worth catching: it is invisible
until the night the mains go.

**Offline scans are queued, then replayed in order, exactly once** (`R04`,
`R05`, `R08`). The door cannot wait for the network, so the records wait
instead. Sync is driven by a retry loop that cannot know whether the last attempt
landed, so syncing twice must upload once. And every queued record either went
upstream, is still waiting, or was deliberately dropped and counted —
`queued_total == uploaded_total + queue_depth + queue_evicted_total`, with no
fourth outcome. That conservation law is how the suite checks the queue without
believing the device's own story about it.

**Replay after reconnect is idempotent** (`R06`). On reconnect the server
re-pushes records it already holds, and pushes what the *other* gates admitted.
Both have broken real devices: treat an inbound record as new and the device
duplicates its own upload stream; rebuild the admitted set from the inbound batch
and the same ticket walks in at both doors. Absorbing an unknown replay is what
makes a multi-gate venue safe.

**The queue is bounded, and the door still opens** (`R07`). The device has
finite flash. The contract's answer at the bound is that the oldest unsynced
record is evicted and `queue_evicted_total` counts it — because refusing entry to
a paying customer because a log is full is a worse failure than losing a
reconciliation line, and losing it *silently* is worse than both. Bounded,
counted, reportable. The admitted set is never evicted.

**The clock is not to be trusted** (`R09`, `R10`). Turnstile hardware keeps
time with a coin cell and coin cells die. Validity is decided against the
ticket's own **signed** window and the device's *trusted* clock — the last
authoritative time from upstream, carried forward by monotonic elapsed time. In
`s07-clock-skew` the local clock reads 2030, then 1970, then the right time, and
not one decision changes. The clock is also the only input somebody standing at
the door can influence, which is the real reason this is a rule and not a
preference.

**Hostile bytes are ordinary input** (`R12`, `R13`). A damaged barcode, a
foreign ticketing system and a half-upgraded server all look the same from the
device's side: bytes that are not a ticket. `s10-bad-tickets` presents three of
them, and the order of the checks is what makes one of the three matter.

A **200-byte ticket id inside a 243-byte blob** is the load-bearing case. The
blob is under its declared 256-byte maximum, so a device that measures the blob
and then copies the field without measuring *it* gets all the way to the copy.
The other two — a 310-byte id in a 370-byte blob, and a 900-byte line — are over
their own maxima and are refused before any field is looked at; they are there to
make the precedence visible rather than to stress the parser. Refusing all three
is necessary and not sufficient: the process also has to come out clean, which is
the next rule.

**Memory safety is correctness, not hygiene** (`R14`). A leak on a device with
64 KiB of RAM is a crash at the busiest moment of the evening, and a crash at a
turnstile is a queue in the street. So it is graded as a property of the run:
every segment of every scenario exits 0 and writes **nothing** to stderr, with
the whole corpus executed under AddressSanitizer and UndefinedBehaviorSanitizer.
That is also why the device may never log to stderr itself — stderr is the
sanitizers' channel, and a device that writes there makes the measurement
impossible. Diagnostics go in a file in the state directory.

**Counters do not wrap** (`R15`, `R16`). Nobody tests the four-billionth scan.
So `s09-counter-bounds` hands the device a state directory that has already seen
one: `next_seq` six short of 2^32, `next_record_id` six short of 2^48. Both have
to cross the boundary exactly, through a persist and a reload. A `uint32_t`
sequence number is zero in the middle of that transcript, and a sequence number
that wraps makes the door log unorderable and two different scans
indistinguishable.

**The evidence is append-only** (`R17`). `admitted.log` after segment *N* is a
byte-exact prefix of `admitted.log` after segment *N+1*. A device that rewrites it
on startup — to compact it, to sort it, to rebuild it from the queue — destroys
the one record that cannot be reconstructed, at exactly the moment nobody is
watching.

## Running it

From a slot:

```bash
cd slots/embedded-systems-developer/scanner-c
make install && make build
SCAN_OUT_DIR=./out make run
```

From the contract directly, against any device binary:

```bash
SCANNER_BIN=slots/embedded-systems-developer/scanner-c/build/scanner \
SCAN_OUT_DIR=/tmp/scan-out \
contract/scanner/run-scenarios.sh
```

Then grade it:

```bash
cd conformance/edge && npm install
SCAN_OUT_DIR=../../slots/embedded-systems-developer/scanner-c/out npx vitest run
```

`SCAN_OUT_DIR` is required by both the runner and the suite and has no default in
either. Silently grading the wrong directory is worse than refusing to run.

## Adding a scenario

Edit [`make-fixtures.py`](./make-fixtures.py) and regenerate — never hand-edit
`scenarios/` or `tickets.jsonl`, both of which are generated so they cannot drift
from `../seed/`:

```bash
python3 contract/scanner/make-fixtures.py
```

The expected decisions in `conformance/edge/expected/` are generated and
committed; do not edit them by hand.
