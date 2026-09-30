# Your assignment

Welcome. You are working in `slots/embedded-systems-developer/scanner-rust`.

This is a running codebase, not a blank page. Nobody expects you to have
written it. What we want to see is how you work inside code you did not
write: how you reproduce a problem, how you find its cause, and how small
and safe you can make the change that fixes it.

## Setup

```
cd slots/embedded-systems-developer/scanner-rust
make install
make build
SCAN_OUT_DIR=./out make run   # runs every scenario, writes ./out
```

Then, from the repository root, run the suite to see where you are starting:

```
cd conformance/edge && npm install
SCAN_OUT_DIR=../../slots/embedded-systems-developer/scanner-rust/out \
SCANNER_BIN=../../slots/embedded-systems-developer/scanner-rust/build/scanner npx vitest run
```

There is nothing to boot and nothing to connect to. `make run` drives
your scanner through every scenario in
`contract/scanner/scenarios/` — each one a list of transcript
segments, where a segment boundary is a **restart** — and writes the
decisions, the state files, the exit status and the stderr of every
segment into `out/`. The suite reads that directory. `make test` in
the slot runs the device's own unit tests.

Read `contract/scanner/` first. It is to this role what
`contract/openapi.yaml` is to the backend: `interface.yaml` has the
transcript grammar, the decision format and the state file formats,
and `rules.yaml` has every rule you are graded on with the reason a
reviewer would care — including the four it says cannot be graded
objectively, which are interview questions rather than test cases.

Memory safety is part of correctness here and it is graded, not
linted: every segment of every scenario must exit 0 and write
**nothing** to stderr, with the whole corpus run under
AddressSanitizer and UndefinedBehaviorSanitizer. That is also why the
device must never log to stderr itself.

Some of those tests fail right now. That is expected — see your tickets.
Do not assume the failing tests are the whole story: a green suite is not
proof a ticket is fixed. Reproduce what the reporter described.

## Tickets assigned to you

- **Bug** — `issues/BUG-1102-scanner-storage-fills-up-overnight.md`
- **Feature** — `issues/FEAT-1112-scanner-must-verify-the-ticket-signature.md`

Read the ticket, not just the failing test. The ticket is what the
reporter actually experienced.

## How we review this

- Does the bug actually stop happening, and did you fix the cause rather
  than suppress the symptom?
- Did anything else break? The whole suite must still pass.
- Is the change proportionate? We look at the size and shape of the diff.
- Did you add a test that would have caught this?
- Does the code look like it belongs in this codebase?
- Your commit history. Commit as you work; see CONTRIBUTING.md.

## Ground rules

- Do not edit `contract/` or `conformance/`. Add your own tests beside
  the code you change.
- Time-box: see `docs/TIERS.md`. Stop when the time is up and write down
  what you would do next — an honest note beats a rushed half-fix.
- AI assistance is allowed. Note where you used it in the message you
  send with your fork's URL. We will ask you to change something live in
  the debrief.

Provisioned 2026-10-10.
