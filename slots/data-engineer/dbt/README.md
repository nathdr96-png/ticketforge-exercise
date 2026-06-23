# data/dbt

The same eight questions as
[`../sql-analytics`](../sql-analytics/), answered as a dbt-core project against
Postgres. Working in dbt rather than in raw SQL is measured on exactly the same
bar, because the suite in [`conformance/data/`](../../../conformance/data/) only
ever looks at the exported answers.

Reference for the questions, the rules and the output format:
[`contract/analytics/questions.yaml`](../../../contract/analytics/questions.yaml)
and [`contract/analytics/README.md`](../../../contract/analytics/README.md).

## Setup

```bash
export DATABASE_URL="postgres://you@127.0.0.1:5432/ticketforge_dbt"

make install                    # virtualenv + dbt-core and dbt-postgres
make migrate                    # schema from contract/schema.sql
make seed                       # contract/seed + contract/analytics/fixture.sql
make run                        # dbt run, then export to results/
make test                       # dbt test
make lint                       # dbt parse + dbt compile
```

`make install` builds a slot-local `.venv`, the way the node slots keep a
slot-local `node_modules`. `make migrate` and `make seed` deliberately use `psql`
and the system `python3`, so a fresh clone can load the database before the
virtualenv exists.

`make seed` **drops and recreates the `public` schema**. Point `DATABASE_URL` at a
database you own.

## Layout

```
dbt_project.yml          views, not tables — see below
models/sources.yml       the contract tables, declared as sources and read-only
models/analytics/*.sql   one model per question id
models/analytics/schema.yml  not_null / unique / accepted_values per column
tests/*.sql              the contract's invariants as singular dbt tests
tools/profile.py         generates .dbt/profiles.yml from DATABASE_URL
tools/export.py          exports each model to results/<id>.json
tools/seed.py            loads the contract seed and the analytics fixture
```

## Three decisions worth knowing

**Views, not tables.** These are reporting queries over a small operational
database. Materialising them would buy nothing and introduce a staleness problem
the questions do not have.

**No ORDER BY in the models.** A dbt relation is a table or a view and has no
inherent row order: `SELECT * FROM a_view` may come back in any order the planner
likes, whatever the view was defined with. Ordering is a property of the *exported
answer*, so `tools/export.py` applies it — and reads it straight out of
`contract/analytics/questions.yaml` rather than restating it, so the two cannot
drift. Each model's header comment records the clause that moved.

**One connection string.** dbt wants host/port/user/dbname spelled out in a
profile; the rest of this repo and the conformance suites pass a single `DATABASE_URL`.
`tools/profile.py` generates the profile from the URL on every invocation, into a
git-ignored `.dbt/`, so there is only one place to configure the database and a
real password never lands in a committed file.

## Testing

`make test` is `dbt test`: the column tests in `models/analytics/schema.yml` plus
the singular tests in `tests/`, which are the contract's invariants written as SQL
that must return no rows —

- revenue reconciles (`net = gross - discounts + fees`) in both reports that
  publish all four figures;
- the daily report and the per-event revenue report agree, order for order;
- the hold funnel's four outcomes account for every hold created, and the
  conversion figure is the half-up rounding the contract specifies;
- seat statuses partition the seat map, and the reconciliation discrepancy is
  never negative;
- average order value sits inside the observed range and reconstructs the
  collected total, which is what fails if the divisor is seat lines instead of
  orders;
- a promo code with no currency reports no money.

That is the same set of properties the plain-SQL data slot checks in its
`tools/check.py`, expressed the way a dbt project expresses them.

## Checking the answers

`make run` writes `results/<id>.json`; the visible suite in
[`conformance/data/`](../../../conformance/data/) grades those files and nothing
else, so it never reads the models themselves. Because the models carry no
`ORDER BY` and ordering is applied by `tools/export.py` from
`contract/analytics/questions.yaml`, row order in the answers is decided in exactly
one place.
