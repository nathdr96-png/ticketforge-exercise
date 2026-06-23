# edge/scanner-c — TicketForge turnstile scanner in C

C11, no dependencies, one binary. Reads a transcript of door events on stdin,
writes decisions to stdout, and keeps everything it knows in a state directory.

The contract is [`contract/scanner/`](../../../contract/scanner/) and the family
is described in [`../_SPEC.md`](../_SPEC.md). Every rule this slot is graded on
has a stable id in
[`contract/scanner/rules.yaml`](../../../contract/scanner/rules.yaml), and the
source refers to those ids where it matters.

## Running it

```bash
make install            # checks for a C compiler; there is nothing to fetch
make build              # -> build/scanner, instrumented
SCAN_OUT_DIR=./out make run
make test               # the device's own unit tests
make lint               # a strict compile, plus two things gcc cannot see
```

Then grade it:

```bash
cd ../../../conformance/edge && npm install
SCAN_OUT_DIR=../../slots/embedded-systems-developer/scanner-c/out \
SCANNER_BIN=../../slots/embedded-systems-developer/scanner-c/build/scanner npx vitest run
```

`SCAN_OUT_DIR` has no default in the runner or the suite. There is no `migrate`
and no `seed`: the device has no database.

## Layout

| File | What is in it |
| --- | --- |
| `src/ticket.c` / `.h` | The ticket blob: the keyed FNV-1a-64 digest, the parser, and the declared field maxima. Every length is checked **before** anything is copied — rule SCAN-R13 |
| `src/state.c` / `.h` | The device's flash: the admitted set, the bounded queue, the counters, and the four state files. Nothing lives only in memory |
| `src/decide.c` / `.h` | The admission decision, in one function, in the declared precedence order. Depends on no file and no clock of its own, so the unit tests call it directly |
| `src/main.c` | argv, the transcript loop, and the output. The only place that prints |
| `tests/unit.c` | `make test`. Built with the same sanitizers as the device |

## Three decisions in this implementation worth knowing about

**The build is instrumented by default.** `make build` compiles with
`-fsanitize=address,undefined` because memory safety is a graded property of the
run (SCAN-R14): the suite asserts that every segment of every scenario exits 0
with an empty stderr, and that assertion is worth nothing against an
uninstrumented binary. `contract/scanner/run-scenarios.sh` detects the
instrumentation in the binary and records it in `out/device.txt`, and the suite
checks the finding. `make build RELEASE=1` produces the uninstrumented build a
real device would ship.

That is also why **this program never writes to stderr**. stderr is where
AddressSanitizer and UndefinedBehaviorSanitizer report, so a device that logs
there makes the measurement impossible. `make lint` greps for it.

**State is written before the decision is announced, not after.** Every handler
in `main.c` calls `tf_state_persist()` and *then* prints. The `ABORT` event is
`_exit(0)` — no stdio flush, no `atexit` handler — because that is what losing
the mains at a turnstile looks like, and a device that only gets its state right
because of the code that runs on the way out has not got it right (SCAN-R03).
`make lint` refuses an `atexit` for the same reason.

**counters.json is written and read by a JSON reader of about forty lines.**
Deliberately not a library: the file is written by this program and read back by
this program, the keys are declared in `contract/scanner/interface.yaml`, and a
general parser would be more code to get wrong on a device with no way to report
an error. `queue_depth` and `admitted_known` are written for a reader's benefit
but are *not* read back — they are derived from `queue.log` and `admitted.log`,
so a disagreement resolves in favour of what is actually on the flash rather
than whichever file was written last.

## Memory layout, and what it is not

The admitted set is an open-addressing hash table that doubles at 70% load; the
queue is a fixed ring of `--queue-max` records allocated once. Neither grows
with input the device cannot bound: the queue cannot, by rule, and the admitted
set grows only with distinct tickets admitted at this door.

What this slot does **not** claim is a peak-RSS figure. That is
`SCAN-X01` in `contract/scanner/rules.yaml`, under the rules that could not be
graded objectively: AddressSanitizer inflates RSS by design, the grading host is
a laptop under load, and any threshold tight enough to catch a real regression
would fail on a slower machine. It is read in review, not measured.

## Docker

```bash
docker build -t ticketforge-scanner-c .
docker run --rm -v "$PWD/../../..:/repo" -w /repo/slots/embedded-systems-developer/scanner-c \
  -e SCAN_OUT_DIR=/repo/slots/embedded-systems-developer/scanner-c/out ticketforge-scanner-c make run
```

The image is a toolchain, not a service: there is no port and nothing to serve.
