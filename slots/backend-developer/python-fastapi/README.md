# TicketForge backend — Python + FastAPI

A full implementation of the TicketForge backend slot. The contract in
`contract/` is authoritative: `openapi.yaml` for the REST surface,
`schema.sql` for the DDL (applied verbatim), `errors.md` for the error
envelope, and `seed/*.json` for the fixtures.

## Layout

| Path | Purpose |
|---|---|
| `app/config.py` | Env config + the canonical integer money math |
| `app/errors.py` | `AppError` and the code → HTTP status table from `contract/errors.md` |
| `app/db.py` | psycopg 3 async pool, `transaction()` helper |
| `app/auth.py` | bcrypt (cost 10) password verify, JWT issue/verify, user loading |
| `app/models.py` | Pydantic request/response models |
| `app/service.py` | Domain logic: events, seats, holds, orders, revenue |
| `app/routes.py` | HTTP routes, auth dependency, pagination coercion |
| `app/worker.py` | Background hold-expiry sweep |
| `app/main.py` | App factory + the exception handlers that enforce the envelope |
| `app/migrate.py` | Applies `contract/schema.sql` |
| `app/seed.py` | Deterministic loader for `contract/seed/*.json` |
| `tests/` | Unit tests for money math, error envelope, timestamps |

## Setup

```bash
make install          # creates .venv and installs requirements.txt
# any Postgres database you can create tables in; `docker compose up -d postgres`
# from the repo root gives you this one
export DATABASE_URL="postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge"
make migrate          # drops + recreates public, applies contract/schema.sql
make seed             # migrate + load contract/seed/*.json (also re-runs migrate)
PORT=8080 make run    # uvicorn on :8080
make test             # pytest unit tests
make lint             # ruff
```

`make seed` runs `migrate` first, so a fresh database needs only `make seed`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://ticketforge:ticketforge@localhost:5432/ticketforge` | |
| `JWT_SECRET` | `ticketforge-dev-secret-change-me` | HS256 |
| `JWT_TTL_SECONDS` | `43200` | 12h |
| `HOLD_TTL_SECONDS` | `600` | |
| `FEE_PERCENT` | `5` | |
| `FEE_FIXED_CENTS` | `30` | |
| `HOLD_EXPIRY_INTERVAL_MS` | `1000` | Expiry worker tick |
| `CONTRACT_DIR` | repo `contract/` | Where `schema.sql` and `seed/` live |

Redis is **not** used. Correctness rests entirely on Postgres row locks.

## Money

Integer minor units end to end — request, computation, storage, response. No
`float` and no `Decimal` anywhere on the money path; all division is Python
floor division (`//`).

```
discount_cents = floor(subtotal_cents * percent_off / 100)
fee_cents      = floor((subtotal_cents - discount_cents) * FEE_PERCENT / 100) + FEE_FIXED_CENTS
total_cents    = (subtotal_cents - discount_cents) + fee_cents
```

The fee is computed on the **post-discount** subtotal.

## Concurrency: how a seat is held exactly once

Postgres row locking only — no Redis, no advisory locks, no optimistic retry.

```sql
BEGIN;
  SELECT id, event_id, status, price_cents
    FROM seats
   WHERE id = ANY($1::text[])
   ORDER BY id              -- deterministic lock order => no deadlocks
     FOR UPDATE;            -- blocks competing holders on the same rows
  -- re-check status AFTER the lock is granted
  INSERT INTO holds ...; UPDATE seats SET status='held', hold_id=... ;
COMMIT;
```

Because the status re-check happens after the lock is granted, only one of N
racing buyers can ever see a seat as `available`; the rest get
`SEAT_ALREADY_HELD` (409). Ordering the lock acquisition by `id` means two
overlapping multi-seat requests take the rows in the same order and cannot
deadlock.

`POST /orders` locks the hold row (`SELECT ... FOR UPDATE`) and then the seat
rows in the same `ORDER BY id` fashion before marking them `sold`, so a hold
cannot be converted twice and seats cannot be oversold.

Expired holds are released by the background worker in `app/worker.py` (one
sweep per second over `holds WHERE status='active' AND expires_at <= NOW()`),
and lazily by `GET /holds/{id}` and `POST /orders` whenever they encounter a
hold that is past its TTL.

## Error envelope

FastAPI's default `422` body does not match `contract/errors.md`, so
`app/main.py` installs handlers for `AppError`, `RequestValidationError`,
`StarletteHTTPException` (which covers router 404/405) and bare `Exception`.
Every one of them renders through `AppError.to_json()`:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
```

`details` is omitted when empty. Request bodies are read as raw JSON and
validated explicitly inside the handlers rather than via a declared body
parameter, so an unauthenticated request with a bad body still answers
`401 UNAUTHENTICATED` — authentication is checked before the body is
validated.

## Timestamps

Always UTC ISO-8601 with milliseconds and a `Z` suffix:
`2026-09-01T19:00:00.000Z`.

## Conformance

From the repo root, with the app running:

```bash
export BASE_URL="http://127.0.0.1:<port>"
export DATABASE_URL="postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge"   # same DB the app uses
(cd conformance/api      && npm install --silent && npx vitest run)
(cd conformance/security && npm install --silent && npx vitest run)
(cd conformance/db       && npm install --silent && npx vitest run)
```

Some properties are also assessed at review.

Seeded credentials: every user's password is `password123`
(`admin@ticketforge.test`, `org1@ticketforge.test`, `buyer01@ticketforge.test`, …).
