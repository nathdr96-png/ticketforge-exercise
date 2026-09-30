# Your assignment

Welcome. You are working in `slots/qa-engineer/playwright-suite`.

This is a running codebase, not a blank page. Nobody expects you to have
written it. What we want to see is how you work inside code you did not
write: how you reproduce a problem, how you find its cause, and how small
and safe you can make the change that fixes it.

## Setup

```
cd slots/qa-engineer/playwright-suite
make install
```

Then, from the repository root, run the suite to see where you are starting:

```
cd slots/qa-engineer/playwright-suite
BASE_URL=<the API URL you were given> make test
```

You are working on **our test suite**, not on the application. The API is
provided and is believed correct; its URL came with this package. Your
suite should pass against it today — if a test of yours fails against
working software, that is a bug in the test.

Do not read `conformance/` for inspiration. That is our suite, it is how
every candidate is compared, and copying it tells us nothing about you.

Everything passes right now. That is precisely the problem: read your
ticket. A green suite is not evidence the software works — it is only
evidence that nothing you wrote disagrees with it.

## Tickets assigned to you

- `issues/QA-396-three-bugs-shipped-undetected.md`

Read the ticket carefully. It describes behaviour that reached customers
without any test noticing. It does not tell you where the code is wrong,
because that is not your job here — your job is that the next time it
happens, a test fails.

## How we review this

- **Does your suite catch the bugs?** We run it against the working
  application and against builds with real defects planted in them. Every
  defect your suite notices counts.
- **Does it stay quiet when the software is correct?** A test that fails on
  working code gets muted by the team, and a muted suite catches nothing.
  False positives cost you more than missing coverage.
- Do your assertions describe behaviour, or restate the implementation?
- When a test fails, does its message tell you what is wrong without
  reading the test?
- Are the tests independent of each other and of execution order?
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
