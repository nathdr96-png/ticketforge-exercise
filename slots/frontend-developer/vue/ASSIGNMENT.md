# Your assignment

Welcome. You are working in `slots/frontend-developer/vue`.

This is a running codebase, not a blank page. Nobody expects you to have
written it. What we want to see is how you work inside code you did not
write: how you reproduce a problem, how you find its cause, and how small
and safe you can make the change that fixes it.

## Setup

```
cd slots/frontend-developer/vue
make install
VITE_API_BASE_URL=<the API URL you were given> make run
```

Then, from the repository root, run the suite to see where you are starting:

```
cd conformance/e2e && npm install && npx playwright install chromium
WEB_BASE_URL=http://127.0.0.1:5173 npx playwright test
```

You need a running TicketForge API behind the app; we gave you one, and
its URL came with this package. `docker compose up -d mock` also gives
you a Prism mock on port 4010 from `contract/openapi.yaml` — fine for
layout work, but it has no state, so the hold and checkout journeys need
the real one.

Some of those tests fail right now. That is expected — see your tickets.
Do not assume the failing tests are the whole story: a green suite is not
proof a ticket is fixed. Reproduce what the reporter described.

## Tickets assigned to you

- **Bug** — `issues/BUG-404-lost-seat-still-looks-available.md`
- **Feature** — `issues/FEAT-30-discount-preview-at-checkout.md`

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
