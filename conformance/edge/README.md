# conformance/edge — the edge/scanner suite

Black-box and stack-agnostic, like every other suite in `conformance/`. It never
reads an implementation. It reads the **output directory** a turnstile scanner
wrote — the decisions it printed, the state files it left behind, the exit status
of every segment and what it put on stderr — so a C scanner, a Rust scanner and a
MicroPython script are graded by exactly the same bar.

## The interface

A scanner is a program, not a service:

```
scanner --state <dir> --queue-max <n>  < transcript  > decisions
```

`make run` in the slot drives it through every scenario in
[`contract/scanner/scenarios/`](../../contract/scanner/scenarios/) via the
contract's own [`run-scenarios.sh`](../../contract/scanner/run-scenarios.sh), and
writes:

```
$SCAN_OUT_DIR/
  manifest.tsv            the scenarios that were run
  device.txt              the binary, its size, and its DETECTED memory-safety mechanism
  <id>/decisions.txt      every segment's stdout, concatenated in segment order
  <id>/stderr.log         every segment's stderr, concatenated in segment order
  <id>/exit-codes.txt     "<segment> <exit status>" per segment
  <id>/state/             the state directory as it stands at the end of the run
  <id>/after-NN/          a snapshot of the state directory after each segment
```

The grammar, the decision format, the state file formats and the limits are all
in [`contract/scanner/interface.yaml`](../../contract/scanner/interface.yaml);
the rules, each with a stable id this suite names in its test titles, are in
[`contract/scanner/rules.yaml`](../../contract/scanner/rules.yaml).

## Running it

```bash
cd conformance/edge && npm install

SCAN_OUT_DIR="../../slots/embedded-systems-developer/scanner-c/out" \
SCANNER_BIN="../../slots/embedded-systems-developer/scanner-c/build/scanner" \
npx vitest run
```

`SCAN_OUT_DIR` is **required and has no default**, in the runner and here.
Silently grading the wrong directory is worse than refusing to run, and a green
run against last week's output is the failure nobody notices. There is one test
whose only job is to confirm that refusal still happens.

`SCANNER_BIN` is needed by the one check that feeds the device input the contract
does not contain. Set both when you run the suite.

## What a scenario is

A scenario is a **list of transcript segments**, and each segment is a separate
process against the same state directory. A segment boundary is therefore a
restart — a real one, with an empty address space — which is the only honest way
to measure whether anything was actually persisted.

Two scenarios differ only in how the first process ends, and that difference is
the point:

- `s03-restart-remembers` reaches end of input and exits normally. A device that
  buffers its writes and flushes on the way out passes it.
- `s04-power-loss` is terminated by the `ABORT` event, which exits immediately
  with no flush and no exit handler. The same device fails it.

One scenario, `s09-counter-bounds`, ships an `initial-state/` directory: a device
that has already seen four billion scans. Every accounting law in this suite is
therefore a law about the **delta** across a run rather than about absolute
values — otherwise the seeded scenario would have to be exempted from all of
them, which is exactly the scenario you least want exempted.

## How the comparison works

- **Exact.** The decision stream is compared line for line against a committed
  fixture. "The right decisions in the wrong order" is a different answer.
- **Invariants as well as values.** Several laws hold for any correct device on
  any corpus, and they are what catch an implementation that is internally
  consistent and wrong:
  - `queued_total == uploaded_total + queue_depth + queue_evicted_total` — every
    queued record went upstream, is still waiting, or was dropped and counted.
    There is no fourth outcome.
  - `scans_total == admitted_total + refused_total`, and every scan is queued.
  - `admitted_known == local admissions + absorbed replays`, and it equals the
    number of lines in `admitted.log`.
  - the sequence number increments by exactly one per scan and `next_seq` is one
    past the last.
  - the queue never holds more than its declared bound, in any segment.
- **Integer-exact.** Counters are compared as `BigInt`, and a value that is not
  an exact integer or that has left the declared 2^53-1 range is a failure rather
  than something to round. That is how a counter serialised through a float, or
  one narrowed to 32 bits, is caught.
- **Memory safety is part of the grade, not a lint.** See below.

## Memory safety

Three tests, all language-agnostic:

1. every segment of every scenario exited 0;
2. no segment wrote anything to stderr;
3. a **hostile transcript built at grade time** — field lengths at and over every
   declared boundary, a 1024-byte line, an over-long line, malformed verbs,
   followed by a restart — is refused line by line, and the device still exits 0
   with an empty stderr.

Those three are only worth something if something was watching, so a fourth
checks the mechanism. `contract/scanner/run-scenarios.sh` probes the binary and
records what it finds in `device.txt`: `asan`/`ubsan` when the sanitizer runtimes
are linked in, `rust` when the panic machinery is, which means the bounds and
overflow checks are in the language and cannot be dropped from a build. The suite
requires one of them. An uninstrumented C build fails, because an empty stderr
from a binary with nothing watching it is not evidence.

This is also why the contract forbids the device from writing to stderr at all:
that channel belongs to the sanitizers and to a panic, and a device that logs
there makes the measurement impossible. Diagnostics belong in a file in the state
directory.

Check (3) is the reason `SCANNER_BIN` exists. A parser can be tuned to a
published corpus; it cannot be tuned to a transcript the grader writes while
grading.

## Expected fixtures

The expected decisions in `expected/` are generated from
`contract/scanner/scenarios/` and committed; do not edit them by hand.

Publishing the expected decisions is deliberate, for the same reason
`conformance/data/expected/` is published: the answers are derivable from the
rules and the transcripts anyway, so the fixtures are your feedback loop. What
distinguishes a real device from one written to the fixtures is the invariants
above and the hostile transcript; some further properties, each of them a rule
in `contract/scanner/rules.yaml` that a device can violate while passing
everything here, are also assessed at review.

## No database

This suite touches no database and needs no server, a port, a browser or a
container runtime. Postgres is irrelevant to the edge family: the device is
offline by definition and holds no ticket table, so this family needs no scratch
database at all.
