# qa/playwright-suite — black-box API regression suite

A contract-driven suite for the TicketForge API. It talks HTTP to `$BASE_URL` and
nothing else: no database access, no imports from any slot, no knowledge of the
language behind the endpoint. That is what lets the same suite run against any
backend implementation of the contract unchanged.

**This slot is graded differently from every other slot.** Elsewhere we run our
tests against your implementation. Here you write the tests, and they are scored
by how many real bugs they catch — see [`../_SPEC.md`](../_SPEC.md).

## Running it

First bring up a running TicketForge API (the URL you were given, or any backend
built from the contract), freshly seeded from `contract/seed/`. Then, from this
directory:

```bash
cp .env.example .env
make install
BASE_URL=http://127.0.0.1:3100 make test      # or `make run` for the verbose list
make lint                                      # typecheck
```

`make test` exits non-zero if anything fails. `make run` prints every test name,
which is the fastest way to see what is covered.

## Layout

| File | What it covers |
|---|---|
| `tests/helpers.ts` | HTTP plumbing, contract money formulas, seat/hold/order helpers, the fixture facts and actor allocation the suite relies on |
| `tests/health-and-auth.spec.ts` | liveness, login, token rejection, the authorization gate on every protected route |
| `tests/catalog-pagination.spec.ts` | walking the events collection without losing or repeating a row; event representation |
| `tests/seat-map.spec.ts` | section and availability filters, section pricing, the seat map partitioning the event, filter validation |
| `tests/holds.spec.ts` | exclusivity, all-or-nothing multi-seat holds, TTL, release returning inventory, ownership |
| `tests/orders-money.spec.ts` | pricing, the floored booking fee, fee-after-discount ordering, integer money on the wire, fulfilment, visibility |
| `tests/discounts.spec.ts` | percentage discounts, event-scoped codes, unknown and inactive codes, and that a refused discount sells nothing |
| `tests/idempotency.spec.ts` | missing/short keys, replay, conflict on a mutated body, per-buyer key scoping |
| `tests/revenue-report.spec.ts` | the reconciliation identity, per-event sums, organizer scoping, filtering |

## How this suite is written, and why

**Assert behaviour, not implementation.** Every assertion is something a buyer, an
organizer or an integrator would notice: the seat came back on sale, the buyer was
charged the quoted amount, the retry did not create a second order. Nothing here
asserts a SQL shape, a header the contract does not define, or an id format.

**Make failures diagnose themselves.** Every `expect` carries a message naming the
actual value, the expected value and the rule. A failure should be readable from a
CI log without opening the test — compare:

```
expected 143 to be 142
fee on 2250c must be floor(2250 × 5 / 100) + 30 = 142c; got 143c, which is what
rounding the half-cent up would produce
```

**No order dependence.** Each spec file owns a disjoint block of buyer accounts,
each test creates the holds and orders it needs and releases them in a `finally`,
and no test asserts on global state it did not create. The suite passes when run
in any order, and `vitest.config.ts` pins serial execution only because seats are
a finite shared resource — not because the tests need a particular sequence.

**Poll, never sleep.** The one genuine race here — another buyer taking the seat
between the lookup and the hold — is resolved by asking again
(`holdAvailableSeats`), not by a `setTimeout` that is both slow and still wrong
under load.

**No retries.** `retry: 0` is deliberate. A retried test converts an intermittent
production bug into a green build, and this suite exists to be believed.

**Read the contract's constants from the environment.** `FEE_PERCENT`,
`FEE_FIXED_CENTS` and `HOLD_TTL_SECONDS` come from env with the contract defaults,
because a deployment is free to configure them differently.

**Prove the fixture actually exercises the case.** The floored-fee test asserts
that the chosen price really leaves a sub-cent remainder, so it can never quietly
become a test that passes for both the right and the wrong implementation.

## Deliberately not covered

Worth knowing, because a coverage claim is only honest if its edges are stated:

- **Hold expiry by TTL.** The contract's TTL is 600 seconds, and a test that waits
  it out is not a test anyone will run. Covering it needs a variant with a short
  `HOLD_TTL_SECONDS`; `conformance/` has the same gap.
- **Concurrency under real load.** Two buyers racing for one seat is covered
  sequentially (one holds, the other is refused). True simultaneity needs a load
  generator (see the `k6-load` slot).
- **Performance budgets.** `contract/perf-budget.yaml` is the `k6-load` slot's job.
- **The browser UI.** `conformance/e2e/` drives the web slot; this suite is the API
  surface.
