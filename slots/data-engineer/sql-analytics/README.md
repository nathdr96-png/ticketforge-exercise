# data/sql-analytics

Answers the eight questions in
[`contract/analytics/questions.yaml`](../../../contract/analytics/questions.yaml)
in plain Postgres SQL — one file per question, no warehouse, no framework.

A complete implementation of the data slot, checked by the visible suite in
[`conformance/data/`](../../../conformance/data/).

## Setup

Postgres is the only requirement. `psql` and `python3` (standard library only)
are the whole toolchain — there is nothing to install and nothing to build.

```bash
cp .env.example .env            # then edit DATABASE_URL
export DATABASE_URL="postgres://you@127.0.0.1:5432/ticketforge_analytics"

make install                    # checks psql + python3 are on PATH
make migrate                    # schema from contract/schema.sql
make seed                       # contract/seed + contract/analytics/fixture.sql
make run                        # execute every query -> results/
make test                       # check the answers
make lint                       # static checks on the SQL
```

`make seed` **drops and recreates the `public` schema**, so point `DATABASE_URL`
at a database you own.

## Layout

```
queries/      one .sql file per question id — this is the actual work
tools/run.py  executes every query, writes results/<id>.json
tools/check.py `make test`: compares answers and checks contract invariants
tools/seed.py  loads contract/seed + contract/analytics/fixture.sql via psql
tools/lint.py  `make lint`: ORDER BY present, no float casts, no bare ::date
results/      generated, git-ignored
```

## The output interface

`make run` writes one file per question id into `$RESULTS_DIR` (default
`./results`):

```
results/q1_revenue_by_event.json
results/q2_daily_sales_utc.json
...
```

Each file is a JSON array of row objects, in the order the contract requires.
That directory is the entire interface to the grader
([`conformance/data/`](../../../conformance/data/)) — it never reads these `.sql`
files, so an implementation in dbt or pandas is graded by exactly the same bar.
Full format rules are in
[`contract/analytics/README.md`](../../../contract/analytics/README.md).

Two deliberate choices in `tools/run.py`:

- Rows are serialised one per line with `row_to_json` and reassembled into an
  array here, rather than with `json_agg`. `json_agg` is shorter and silently
  discards the subquery's `ORDER BY`, because the order an aggregate consumes its
  input in is not guaranteed. Ordering is part of the contract.
- Stale result files are deleted before anything runs. A leftover file is worse
  than a missing one: the grader would score yesterday's answer to a question
  this implementation no longer answers.

## Why the queries look the way they do

Every query carries a header comment naming its question and the trap it is
avoiding. The recurring ones:

- **Seat counts are aggregated before the money rollup.** `order_seats` has one
  row per seat, so joining it to `orders` repeats the order once per seat and
  multiplies every money column by the seat count. A four-seat order reports four
  times its revenue, and the report still looks plausible. `q1`, `q5` and `q8`
  all pre-aggregate in a CTE for this reason.
- **`WHERE status = 'paid'`, consistently.** Refunded orders are excluded from
  money but still own seats — which is the entire subject of `q7`.
- **Event status does not gate revenue.** `event_cancelled` took GBP money before
  it was cancelled. That money was collected, so it is reported.
- **Day buckets say `AT TIME ZONE 'UTC'` out loud.** The session timezone is not
  guaranteed, and the fixture has orders at 00:30Z and 02:15Z specifically so a
  query bucketed anywhere else lands them on the wrong day.
- **Hold history comes from `outbox_events`.** `hold_seats` rows are deleted when
  a hold expires, so current state has already forgotten most of it.
- **Averages round half-up in `numeric`.** Integer division truncates, which is a
  different answer.

## Money

Integer minor units everywhere, and never mixed across currencies. The
definitions of gross / discounts / fees / net are the ones in
`RevenueReport` in [`contract/openapi.yaml`](../../../contract/openapi.yaml) —
this slot does not invent a second set. `make test` asserts
`net = gross - discounts + fees` on every row that reports all four.
