# Your assignment

Welcome. You are working in `slots/ai-ml-engineer/fraud-scoring`.

This is a running codebase, not a blank page. Nobody expects you to have
written it. What we want to see is how you work inside code you did not
write: how you reproduce a problem, how you find its cause, and how small
and safe you can make the change that fixes it.

## Setup

```
cd slots/ai-ml-engineer/fraud-scoring
make install
make run                      # trains, writes ./predictions/run1 and run2
```

Then, from the repository root, run the suite to see where you are starting:

```
cd conformance/ml && npm install
PREDICTIONS_DIR=../../slots/ai-ml-engineer/fraud-scoring/predictions npx vitest run
```

There is nothing to boot and no database — `make run` trains on
`contract/risk/data/train.csv`, writes its predictions and exits. It
writes TWO runs, `run1/` and `run2/`, because we cannot execute your
code twice and determinism has to be measurable from the outside.

The metric tests in that suite will not run for you: the holdout's
labels are withheld, and we grade them. `make test` and
`python -m risk --report` in the slot measure you on a temporal split
of `train.csv` instead, which is the honest version of the same
question.

Read `contract/risk/` first. It is to this role what
`contract/openapi.yaml` is to the backend: every rule you are graded
on is written down there, with the reason a reviewer would care. The
interesting mistakes in this work are methodological, not algorithmic.

Some of those tests fail right now. That is expected — see your tickets.
Do not assume the failing tests are the whole story: a green suite is not
proof a ticket is fixed. Reproduce what the reporter described.

## Tickets assigned to you

- **Bug** — `issues/BUG-802-same-order-gets-a-different-risk-score-each-time.md`
- **Feature** — `issues/FEAT-806-risk-score-should-look-at-the-account.md`

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
