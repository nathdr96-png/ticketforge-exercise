# conformance/data — the data/analytics suite

Black-box and stack-agnostic, like every other suite in `conformance/`. It never
reads an implementation. It reads the **result files** an implementation wrote and
compares them to committed expected answers, so a SQL slot, a dbt
project and a pandas script are graded by exactly the same bar.

## The interface

An implementation writes one file per question id into a results directory:

```
$RESULTS_DIR/
  q1_revenue_by_event.json
  q2_daily_sales_utc.json
  ...
```

Each file is a JSON array of row objects, **in the order the contract requires**.
The questions, columns, types, orderings and edge-case rules are in
[`contract/analytics/questions.yaml`](../../contract/analytics/questions.yaml);
the file-format rules are in
[`contract/analytics/README.md`](../../contract/analytics/README.md).

## Running it

```bash
cd conformance/data && npm install

DATABASE_URL="postgres://you@127.0.0.1:5432/your_db" \
RESULTS_DIR="../../slots/data-engineer/sql-analytics/results" \
npx vitest run
```

Both variables are required. `RESULTS_DIR` has no default on purpose: silently
grading the wrong directory is worse than refusing to run. `DATABASE_URL` is used
for one thing only — a fingerprint check that the database really is the dataset
the answers are defined against, so a half-seeded database reports *that* instead
of eight confusing wrong answers.

## How the comparison works

- **Order-aware.** Rows are compared position by position, and the declared
  `order_by` is separately verified. "The right rows in the wrong order" is a
  different answer — it is what a missing window-function partition or a
  forgotten tiebreak looks like.
- **Integer-exact.** Money is integer minor units. A `bigint` arrives as a string
  through some drivers and a number through others, so both spellings are
  accepted and then compared as integers. There is **no floating-point
  tolerance**: a value with a decimal point in a money column is a failure, not
  something to round.
- **Columns are exact.** No missing keys, no extra keys.
- **Invariants as well as values.** `net = gross - discounts + fees` on every row
  that reports all four, the daily report must sum to the per-event report, the
  discount report must agree with the revenue report per currency, hold statuses
  must account for every hold created. These hold for any correct implementation
  on any dataset, and they are what catches two reports built on two different
  definitions.

## Expected fixtures

The expected answers in `expected/` are generated from the contract and the seed
data and committed; do not edit them by hand.

Not every question has an expected answer here. The questions without one are
assessed at review. The published answers are your feedback loop; the rest are
what distinguish a real implementation from one that selects literals.
