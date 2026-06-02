# Analytics contract

The source of truth for the **data / analytics** role family, the way
[`../openapi.yaml`](../openapi.yaml) is the source of truth for the backend
family. Everything in here is additive: it does not change the REST surface, the
schema or the seed, and the backend stacks are unaffected by it.

| File | What it is |
|---|---|
| [`questions.yaml`](./questions.yaml) | The eight business questions: stable id, the question in plain English, the exact output columns and types, the required ordering, and the edge-case rules that decide which rows belong. |
| [`fixture.sql`](./fixture.sql) | The deterministic transaction history the answers are defined against. **Generated** — do not hand-edit. |
| [`make-fixture.py`](./make-fixture.py) | Regenerates `fixture.sql`. Refuses to run if `contract/seed/` has drifted away from what it assumes, or if the fixture and the browser suites want the same seats. |

## Sharing one database with the other families

This fixture is not the only thing that writes to the seeded inventory. On an
integrated run a real backend, the web app and
the browser suites are live against the same database. Two resources are
contended, and they are divided in two different ways.

**Seats — divided by territory.** The browser suites (such as `conformance/e2e`)
hold, release and buy *named* seats, because a browser suite that takes "the
first available seat" is order-dependent and flaky. This fixture *sells* named
seats, because the analytics answers are defined over an exact history. The
boundary is declared once, in
[`../../conformance/reserved-seats.json`](../../conformance/reserved-seats.json):
rows **01 and 02** of every section of every event belong to the interactive
suites; rows **03 and up** belong to this fixture. `make-fixture.py` greps the
seat ids out of the interactive specs and refuses to write `fixture.sql` if
either side has crossed the line — including the case where a spec file names no
seats at all, which would mean the check had stopped seeing the suite.

Why rows and not sections: seat price is a function of (event, section) only, so
every hold in this fixture moved up two rows *inside its own section* when the
boundary was introduced, and not one figure in `questions.yaml` changed. The
regenerated answers in `conformance/data/expected/` were byte-identical.

**Orders — divided by ordering.** There is no territory to give here:
`conformance/data` asserts the exact transaction set ("holds: 24, orders_paid:
12, …"), so a single order created by `conformance/api`, the browser suites or
the QA suite invalidates every answer in this contract. Scoping the questions to
exclude later orders was considered and rejected: it would mean rewriting the
questions and every implementation to carry a time window that exists only to
tolerate test pollution, and the dataset assertion in `conformance/data` would
still fail. Instead the analytics family is **graded first, on a database no
interactive suite has run against**, and the integrated run enforces that order
rather than documenting it.

One consequence worth knowing: the `active` holds in this fixture expire in 2099
on purpose. A live backend sweeps every `active` hold whose `expires_at` has
passed, and the moment that happens the hold statuses change and the seats go
back in the pool — which would move q3, q4 and q7 on a date, not on a code
change. The expiry is not an input to any answer, so a far date costs nothing.

## Why there is a fixture at all

`contract/seed/` gives every run the same 54 users, 5 events, 2230 seats and 3
discount codes — and **no holds and no orders**. A freshly seeded database has
nothing to report on, so every analytics answer would be the empty set.

`fixture.sql` adds the activity layer: 24 holds across all four hold states,
12 paid and 2 refunded orders in USD, EUR and GBP, a seat that was refunded and
then resold, a seat that timed out of a hold and was sold later, and the
`outbox_events` trail that is the only surviving record of the holds whose
`hold_seats` rows were deleted on expiry.

Money in the fixture is derived from the pricing rules in
`contract/schema.sql` rather than typed in, so `discount = floor(subtotal *
percent / 100)`, `fee = floor((subtotal - discount) * 5 / 100) + 30` and
`total = subtotal - discount + fee` hold on every order. That is also why the
file is generated: forty hand-maintained integers is how a fixture quietly stops
agreeing with the contract it illustrates.

## Money definitions

Not redefined here. They are the ones already given for `RevenueReport` in
`../openapi.yaml`:

```
gross_cents     = SUM(orders.subtotal_cents)
discounts_cents = SUM(orders.discount_cents)
fees_cents      = SUM(orders.fee_cents)
net_cents       = SUM(orders.total_cents) = gross - discounts + fees
```

If a question's figures do not reconcile that way, the question is wrong.

## The results interface

An implementation answers the questions by writing **one file per question id**
into a results directory:

```
$RESULTS_DIR/
  q1_revenue_by_event.json
  q2_daily_sales_utc.json
  ...
  q8_order_value_distribution.json
```

Each file is a JSON array of objects, one object per result row, **in the
required order**. Keys are exactly the declared column names — no extras, none
missing. Integer columns may be a JSON number or a string of digits (Postgres
`bigint` commonly serialises as a string); both are compared exactly as
integers, never with floating-point tolerance. Dates are `YYYY-MM-DD` in UTC.
Nullable columns that are null are JSON `null`.

That is the whole contract between an implementation and the grader. How you
produce the files — SQL, dbt, pandas, a shell script — is entirely up to you.
The visible suite is [`../../conformance/data/`](../../conformance/data/).

## The traps, stated plainly

These are in `questions.yaml` as rules, and they are the point of the exercise.
A query that ignores them returns a plausible-looking wrong number.

| Trap | Where it bites |
|---|---|
| **Join fan-out** | `order_seats` has one row per seat. Joining it to `orders` multiplies every money column by the seat count. q1, q5, q8. |
| **Holds are not sales** | A held seat is not a sold seat, and a hold on four seats is one hold. q3. |
| **Which rows count** | `orders.status` includes `refunded`; `events.status` includes `draft` and `cancelled`. Event status does not gate revenue — a cancelled event's earlier sales were real. q1, q6, q7. |
| **Currency** | `event_jazz_eur` is EUR, `event_cancelled` is GBP. Money is never summed across currencies, and `SAVE10` has been redeemed in two of them. q1, q5, q6, q8. |
| **Day boundaries** | Timestamps are UTC. Orders sit either side of UTC midnight on purpose; bucketing in any other zone moves them. q2. |
| **Vanished history** | `hold_seats` rows are deleted on expiry and release. Hold history comes from `outbox_events`; releases leave no outbox event at all. q4. |
| **Integer rounding** | Averages round half-up at the last step. Truncating integer division is a different answer. q3, q8. |
