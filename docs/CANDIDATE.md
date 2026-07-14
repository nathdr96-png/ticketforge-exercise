# TicketForge — candidate brief

TicketForge is a small event-ticketing platform: events, seats, time-limited seat
holds, and orders. You will work on one part of it in one stack.

**If there is an `ASSIGNMENT.md` in the root of what you were given, read that
first — it is your actual task, and it overrides the "building from scratch"
section below.**

Two things are true in both cases:

- `contract/` is the source of truth and you must not edit it. If you think it is
  wrong, say so in your write-up.
- `conformance/` is how every candidate in every stack is compared. Do not edit it.
  Add your own tests next to the code you change.

---

## If you were given a working codebase (real-project mode)

You are joining a running project. Nobody expects you to have written it.

What we are looking at is how you work inside code you did not write: how you
reproduce a problem, how you find its cause, and how small and safe you can make
the change that fixes it.

### Setup

```bash
cd slots/<your-slot>
make install
make migrate && make seed     # needs Postgres and DATABASE_URL — see below
make run
```

The backend and data slots need a Postgres 16 database you can create tables in,
named by `DATABASE_URL`. From the repository root, `docker compose up -d postgres`
starts one, and the matching URL is
`postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge`. Any other
Postgres 16 works just as well — export its URL instead. Slots under
`slots/embedded-systems-developer/`, `slots/ai-ml-engineer/`, `slots/devops-cloud-engineer/` and `slots/blockchain-developer/` need no
database at all; your `ASSIGNMENT.md` says which targets your slot has.

Then, from the repository root, see where you are starting (this is the backend
suite; the other families are described below, and your `ASSIGNMENT.md` names
the suites that check your slot):

```bash
cd conformance/api && npm install
BASE_URL=http://127.0.0.1:<your port> npx vitest run
```

Some tests fail right now. That is expected — they relate to your tickets.

Do not assume the failing tests are the whole story. A green suite is not proof that
a ticket is fixed: read the ticket, reproduce what the reporter described, and
confirm the behaviour yourself.

**If your slot is under `slots/data-engineer/`**, there is no server to boot. `make run`
executes the work, writes one result file per question into `results/` and exits.
Your contract is [`contract/analytics/questions.yaml`](../contract/analytics/questions.yaml),
which gives each question's output columns, required ordering and edge-case rules,
and your suite reads the files rather than an API:

```bash
cd conformance/data && npm install
RESULTS_DIR=../../slots/<your-slot>/results npx vitest run
```

`make test` inside the slot checks the same answers, so you can work without
leaving the slot directory.

**If your slot is under `slots/blockchain-developer/`**, there is also no server to boot and
no database. `make run` compiles your contracts, deploys them to an in-process
local development chain, writes `deployment/deployment.json` and exits — that
file records every transaction your deployer sent, and it is your whole
interface with the suite, which starts a chain of its own and replays them.
Nothing in this family touches the network: no testnet, no RPC endpoint, no
faucet, no fork, and no private key from the environment. Your contract is
[`contract/onchain/rules.yaml`](../contract/onchain/rules.yaml), and the seats,
events, prices and discount codes come from `contract/seed/` like everybody
else's:

```bash
cd conformance/blockchain && npm install
CHAIN_DEPLOYMENT=../../slots/<your-slot>/deployment/deployment.json npx vitest run
```

Three of those tests generate sequences of calls and check the invariants after
every step rather than asserting one example, because most of the interesting
mistakes in on-chain code are only reachable through an ordering. `make test`
passing is not evidence of much on its own.

**If your slot is under `slots/embedded-systems-developer/`**, you are working on a turnstile scanner
and there is no server, no database and no hardware. It is a program: it reads a
transcript of door events on stdin, writes its decisions to stdout, and keeps
everything it knows in files. `make build` compiles it and `make run` drives it
through every scenario in
[`contract/scanner/scenarios/`](../contract/scanner/scenarios/), writing the
decisions, the state files, the exit status and the stderr of every run into
`out/`:

```bash
cd slots/<your-slot>
make install && make build
SCAN_OUT_DIR=./out make run

cd ../../../conformance/edge && npm install
SCAN_OUT_DIR=../../slots/<your-slot>/out \
SCANNER_BIN=../../slots/<your-slot>/build/scanner npx vitest run
```

Your contract is [`contract/scanner/`](../contract/scanner/) —
`interface.yaml` for the transcript grammar, the decision format and the state
file formats, `rules.yaml` for every rule you are graded on with its reason, and
the tickets come from `contract/seed/` like everybody else's. Read it before you
start; it also lists, under `not_graded`, four rules that could not be measured
objectively, so you know what the suite is *not* telling you.

Three things about this family are easy to miss:

- **A scenario is a list of transcript segments, and a segment boundary is a
  restart.** Each segment is a separate process against the same state
  directory, so everything the device knows has to come off the disk. The
  `ABORT` event goes further: it is a power cut, so whatever the device has
  already printed must *already* be durable.
- **Memory safety is graded, not reviewed.** Every segment of every scenario must
  exit 0 and write **nothing** to stderr, with the whole corpus run
  instrumented. That is also why the device may never log to stderr itself —
  that channel belongs to the sanitizers. Diagnostics go in a file in the state
  directory.
- **One check feeds your device input that is not in the contract**, built while
  you are being graded. A parser tuned to the published transcripts gets no help
  from it.

**If your slot is under `slots/ai-ml-engineer/`**, there is no server, no database and no
network. `make run` trains on a committed dataset, scores a holdout whose labels
are withheld, and writes CSV files; the suite reads those files and never imports
your code:

```bash
cd slots/<your-slot>
make install && make run        # writes predictions/run1 and predictions/run2

cd ../../../conformance/ml && npm install
PREDICTIONS_DIR=../../slots/<your-slot>/predictions npx vitest run
```

Your contract is [`contract/risk/`](../contract/risk/) — `rules.yaml` for the
dataset, every column and whether it is available at order time, the output
format, the metric and the bars, and twelve rules with stable ids. Read it before
you start. The interesting mistakes in this work are methodological, not
algorithmic, and every rule in there exists because one of them is cheap to make
and expensive to find.

Four things about this family are easy to miss:

- **`make run` runs the whole pipeline twice**, into `run1/` and `run2/`. We
  cannot execute your code twice, so determinism is demonstrated from the inside
  and asserted from the outside. `run1` is the run that is scored.
- **Some columns in the dataset must not be used.** The contract marks each one
  `available: order_time` or `available: post_review`; the second kind is written
  by a human during a fraud investigation and is empty for every order that
  matters in production. This is checked mechanically, not by reading your code.
- **You cannot run the metric tests.** The holdout's labels are withheld. `make
  test` and `python -m risk --report` in the slot measure you on a temporal split
  of the training data instead, which is the honest version of the same question.
- **Accuracy is not the metric and no threshold is graded.** Fraud is about 4% of
  the holdout, so a model that answers "never fraud" is 96% accurate and worth
  nothing. The deliverable is a ranking.

### What we look at

- Does the bug actually stop happening, and did you fix the cause rather than
  suppress the symptom?
- Did anything else break? The whole suite must still pass.
- Is the change proportionate to the problem?
- Did you add a test that would have caught this?
- Does your code look like it belongs in this codebase?
- Your commit history. Commit as you work — see `CONTRIBUTING.md`.

---

## If you were given an empty slot (from-scratch mode)

You are implementing **one slot** of the shared contract.

### Setup

```bash
docker compose up -d postgres mock     # Redis is optional; correctness must not depend on it
cp slots/<your-slot>/.env.example slots/<your-slot>/.env
cd slots/<your-slot> && make run
```

The stub you start from has four Makefile targets — `run`, `test`, `lint` and
`seed` — and only `run` does anything (it serves a placeholder that answers 501).
Add whatever other targets your stack needs (`install`, `migrate`, `build`, …)
and say in your README how to use them.

Backend: `docker compose up -d postgres` gives you
`postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge`. The stub's
`make seed` is a placeholder that only prints a message — loading
`contract/seed/` into your schema is part of the task, not something done for
you.

Frontend / mobile: the Prism mock (`http://localhost:4010`, from
`docker compose up -d mock`) is generated from `contract/openapi.yaml` and is
fine for layout and the read-only screens. It is **stateless**, so holding a seat
and checking out do not work against it: for those journeys you will be given the
URL of a running API.

### Tiers

Go as far as you can before the time limit. The tier you reach cleanly is the
signal — a clean T2 beats a broken T3.

| Tier | Goal |
|---|---|
| T1 | Auth + list events/seats with pagination |
| T2 | Holds without double-booking under concurrency |
| T3 | Idempotent orders, expiry, integer money math |
| T4 | Meet `contract/perf-budget.yaml` |

Details and the per-tier time budget: `docs/TIERS.md`. Acceptance scenarios:
`contract/scenarios/`.

### Self-check

```bash
BASE_URL=http://127.0.0.1:<your port> npm test --prefix conformance/api
```

---

## House rules, both modes

- **Money is always integer minor units.** No floating point anywhere near a price,
  fee, discount or total.
- **Timestamps are UTC, ISO-8601.**
- **Time-box.** When the time is up, stop and write down what you would do next.
  An honest note beats a rushed half-fix — we mean that, and we grade accordingly.
- **AI assistance is allowed.** Note where you used it. In the debrief we will ask
  you to change something live, so work in a way you can explain.

## What we grade

Real-project mode: part of the score is automated (are your tickets resolved,
and did anything else break) and part is a person reading your work (did you fix
the root cause, the tests you added, how the change fits the codebase, your
commit history).

From-scratch mode: part automated (the black-box conformance suite) and part read
by a person (readability, your own tests, your commit history).

Either way the part read by a person is where the decision gets made.
