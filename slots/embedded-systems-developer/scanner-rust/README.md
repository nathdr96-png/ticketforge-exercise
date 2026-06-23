# edge/scanner-rust — TicketForge turnstile scanner in Rust

Safe Rust, `#![forbid(unsafe_code)]`, no dependencies, one binary. Reads a
transcript of door events on stdin, writes decisions to stdout, and keeps
everything it knows in a state directory.

It produces **byte-identical** decision streams to
[`../scanner-c`](../scanner-c/), because both are driven by the same
[`contract/scanner/run-scenarios.sh`](../../../contract/scanner/run-scenarios.sh)
and graded against the same expectations. The contract is
[`contract/scanner/`](../../../contract/scanner/) and the family is described in
[`../_SPEC.md`](../_SPEC.md).

## Running it

```bash
make install            # checks for cargo; there is nothing to fetch
make build              # -> build/scanner
SCAN_OUT_DIR=./out make run
make test               # cargo test
make lint               # -D warnings, plus three things rustc cannot see
```

Then grade it:

```bash
cd ../../../conformance/edge && npm install
SCAN_OUT_DIR=../../slots/embedded-systems-developer/scanner-rust/out \
SCANNER_BIN=../../slots/embedded-systems-developer/scanner-rust/build/scanner npx vitest run
```

`SCAN_OUT_DIR` has no default in the runner or the suite. There is no `migrate`
and no `seed`: the device has no database.

If `cargo` is not on `PATH`, the Makefile falls back to
`$HOME/.local/toolchains/rust/bin/cargo`, which is where this repository
provisions Rust alongside Go, the JDK and Maven. The crate has **no
dependencies**, so every cargo invocation passes `--offline` and a cold registry
is not a problem.

## Layout

It mirrors the C slot file for file, so the two can be read side by side:

| File | What is in it |
| --- | --- |
| `src/ticket.rs` | The ticket blob: the keyed FNV-1a-64 digest, the parser, the declared field maxima |
| `src/state.rs` | The device's flash: the admitted set, the bounded queue, the counters, the four state files |
| `src/decide.rs` | The admission decision, in one function, in the declared precedence order |
| `src/main.rs` | argv, the transcript loop, and the output. The only place that prints |

Unit tests live in `#[cfg(test)]` modules beside the code they test, which is
where a Rust reviewer looks for them.

## What is different from the C slot, and what deliberately is not

**Memory safety comes from the language, not from a sanitizer.** Rule SCAN-R14
is graded as "every segment of every scenario exits 0 and writes nothing to
stderr", and `contract/scanner/run-scenarios.sh` detects the *mechanism* from
the binary rather than taking a slot's word for it: the C slot is recorded as
`asan,ubsan`, this one as `rust`. `#![forbid(unsafe_code)]` is therefore not
decoration — it is the whole of this slot's claim, and `make lint` fails without
it. `overflow-checks` stays on in the release profile for the same reason.

The fixed-size field buffer in `src/ticket.rs` is kept rather than replaced with
a `String` sized from the input, even though a `String` could not overflow. It
is there because the length check in front of it is the thing being graded
(SCAN-R13), because the device really does have 64 KiB of RAM, and because the
same mistake should mean the same thing in every stack: moving the check below
the copy is a silent overwrite in C and a panic here, and the suite is satisfied
by neither.

**Nothing writes to stderr.** On this slot that channel carries a panic, which
is how a bounds violation becomes visible to the grader. `make lint` greps for
`eprintln!` and friends.

**`ABORT` is `process::exit(0)`**, which runs no destructor and flushes nothing.
That is what losing the mains at a turnstile looks like, and a device that only
gets its state right because of the code that runs on the way out has not got it
right (SCAN-R03). `make lint` refuses a `Drop` impl on `State` for the same
reason. Note that Rust's stdout is line-buffered, so each decision is already
flushed when it is printed — the explicit flush in `emit` is there so that
remains true if that ever changes.

## Docker

```bash
docker build -t ticketforge-scanner-rust .
docker run --rm -v "$PWD/../../..:/repo" -w /repo/slots/embedded-systems-developer/scanner-rust \
  -e SCAN_OUT_DIR=/repo/slots/embedded-systems-developer/scanner-rust/out ticketforge-scanner-rust make run
```

The image is a toolchain, not a service: there is no port and nothing to serve.
