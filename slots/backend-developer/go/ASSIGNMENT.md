# Your assignment

Welcome. You are working in `slots/backend-developer/go`.

This is a running codebase, not a blank page. Nobody expects you to have
written it. What we want to see is how you work inside code you did not
write: how you reproduce a problem, how you find its cause, and how small
and safe you can make the change that fixes it.

## Setup

```
cd slots/backend-developer/go
make install
export DATABASE_URL=postgres://ticketforge:ticketforge@localhost:5432/ticketforge
make migrate && make seed   # creates the schema and loads contract/seed
make run
```

Your slot needs PostgreSQL 16 and reads its connection string from
`DATABASE_URL`. `docker compose up -d postgres` (or `make up`), run from the
repository root, starts one that matches the URL above. Any other database
you can create tables in works too: set `DATABASE_URL` to it instead. Every
variable the slot reads is listed in `slots/backend-developer/go/.env.example`.

Then, from the repository root, run the suite to see where you are starting:

```
cd conformance/api && npm install && BASE_URL=http://127.0.0.1:<port> npx vitest run
```

Some of those tests fail right now. That is expected — see your tickets.
Do not assume the failing tests are the whole story: a green suite is not
proof a ticket is fixed. Reproduce what the reporter described.

Not every failing test is yours. This code is shared with another team,
which has open tickets of its own in it. A failure unrelated to your
tickets belongs to them: leave it alone. It is not part of your review,
either way.

## Tickets assigned to you

- **Bug** — `issues/BUG-162-pagination-skips-events.md`
- **Feature** — `issues/FEAT-18-discount-codes.md`

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
