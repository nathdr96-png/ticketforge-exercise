# Tier 4 — Performance & query plans

## T4-01 Seat map p95
Given a warm instance and authenticated buyer
When they issue 50 sequential `GET /events/event_arena_2000/seats?page=1&page_size=100`
Then p95 latency is < 150ms (see `perf-budget.yaml`)

## T4-02 Index scan
Given Postgres
When `EXPLAIN` is run for the seat-map query filtered by `event_id` (+ optional section/status)
Then the plan uses an Index Scan / Index Only Scan / Bitmap Index Scan on a seats index
And does **not** use a plain Seq Scan on `seats` as the primary access method for the 2000-row event

## T4-03 No N+1
Given instrumentation or query logging during `GET /events/event_arena_2000/seats?page_size=100`
Then the number of SQL round-trips is bounded (≤ 3) — not one query per seat

## T4-04 Revenue report
Given organizer `org1` and at least one paid order on their events
When they `GET /reports/revenue`
Then the response is 200
And `gross_cents`, `fees_cents`, `discounts_cents`, `net_cents` are integers
And `by_event` aggregates match the sum of orders
And buyer role receives 403 `INSUFFICIENT_PERMISSION`
