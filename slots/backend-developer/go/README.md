# backend/go — TicketForge backend in Go

A complete implementation of the TicketForge contract in Go,
built on the standard library's `net/http` router plus `pgx` for Postgres.
It implements the whole contract in `contract/`: the REST surface from
`openapi.yaml`, the canonical DDL from `schema.sql`, and the fixed error
envelope from `errors.md`.

## Dependencies

Deliberately small — two direct modules:

| Module | Why |
|---|---|
| `github.com/jackc/pgx/v5` | Postgres driver + pool (`FOR UPDATE`, `CopyFrom`) |
| `golang.org/x/crypto` | bcrypt password hashing |

Routing, JSON and the HS256 JWT are standard library. There is **no Redis
dependency**: seat exclusivity is enforced with Postgres row locks alone.

## Layout

```
cmd/ticketforge/      serve | migrate | seed | healthcheck
internal/config/      environment loading, contract/ discovery
internal/apperr/      the closed error-code set and its HTTP mapping
internal/store/       pool, transaction helper, migrate, seed
internal/auth/        bcrypt login, HS256 JWT issue/verify
internal/money/       integer-cents fee and discount math (+ unit tests)
internal/service/     events, seats, holds, orders, revenue
internal/api/         router, middleware, handlers
internal/worker/      background hold-expiry sweep
```

## Run it

```bash
# any Postgres database you can create tables in; `docker compose up -d postgres`
# from the repo root gives you this one
export DATABASE_URL="postgres://ticketforge:ticketforge@127.0.0.1:5432/ticketforge"
export PORT=3000

make install   # go mod download
make migrate   # apply contract/schema.sql verbatim
make seed      # migrate, then load contract/seed/*.json
make run       # start the API
make build     # -> bin/ticketforge
make test      # go test ./...
make lint      # gofmt -l + go vet
```

`migrate` and `seed` read the contract straight from the repo. The directory is
found by walking up from the working directory; override with `CONTRACT_DIR`.
`seed` runs `migrate` first, so a seed always starts from a clean schema and is
deterministic and repeatable.

Health check:

```bash
curl -s localhost:3000/health          # {"status":"ok"}
curl -s -X POST localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"buyer01@ticketforge.test","password":"password123"}'
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `DATABASE_URL` | `postgres://ticketforge:ticketforge@localhost:5432/ticketforge` | Postgres connection string |
| `JWT_SECRET` | `ticketforge-dev-secret-change-me` | HS256 signing key — **set this in production** |
| `HOLD_TTL_SECONDS` | `600` | Seat hold lifetime |
| `FEE_PERCENT` | `5` | Percentage component of the booking fee |
| `FEE_FIXED_CENTS` | `30` | Fixed component of the booking fee |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `CONTRACT_DIR` | auto-detected | Path to the repo's `contract/` directory |
| `DB_MAX_CONNS` | `20` | Pool size |
| `BCRYPT_COST` | `10` | Seed password hashing cost (fixtures require 10) |
| `HOLD_EXPIRY_TICK_MS` | `1000` | Hold-expiry sweep interval |

## Money

Every amount is an integer number of cents. There is no `float` anywhere on the
money path — not in the request, the arithmetic, the storage, or the response.
`internal/money` is the single place the formulas live:

```
discount_cents = floor(subtotal * percent_off / 100)
fee_cents      = floor(subtotal_after_discount * FEE_PERCENT / 100) + FEE_FIXED_CENTS
total_cents    = (subtotal - discount) + fee
```

The fee is charged on the **post-discount** subtotal. Go's integer division
truncates toward zero, which equals `floor` for the non-negative values this
domain permits, so the result is floored and never rounded —
`floor(4050 * 5 / 100) + 30 = 232`, not 233. `internal/money/money_test.go`
pins this down, including the half-cent cases where floor and round disagree.

## Concurrency: Postgres row locks only

Seat exclusivity never depends on an external lock service. Every path that
mutates seat state does this:

1. open a transaction;
2. `SELECT ... FROM seats WHERE id = ANY($1) ORDER BY id FOR UPDATE`;
3. re-check each seat's status *under the lock* before writing.

Ordering the lock acquisition by `id` gives every transaction the same global
order, so concurrent requests for overlapping seats serialise instead of
deadlocking: the loser blocks until the winner commits, then observes the seat
as `held` and returns `SEAT_ALREADY_HELD`. Oversell is therefore impossible
without any advisory lock. `ReleaseHold`, `ExpireHold` and `CreateOrder` take
the same ordered locks before mutating.

Holds past their TTL are swept by a background worker (every
`HOLD_EXPIRY_TICK_MS`), which marks them `expired` and returns their seats to
`available`. Reads and order conversion also expire a stale hold on the spot,
so a client never sees a hold that has outlived its TTL.

## Idempotency

`POST /orders` requires an `Idempotency-Key` header
(`IDEMPOTENCY_KEY_REQUIRED` otherwise). The key is stored in
`idempotency_records` alongside a SHA-256 hash of the canonical request body:

- same key, same body → the original order, `200`;
- same key, different body → `IDEMPOTENCY_KEY_CONFLICT`, `409`;
- new key → a new order, `201`.

The idempotency lookup happens *first*, before the hold is validated, so a
replay is unaffected by the hold having since been converted. The record is
written inside the same transaction as the order, so an order and its key
commit together or not at all; a concurrent request that loses the unique-index
race retries once and observes the winner's order.

## Implementation notes

Two internal choices worth noting:

- **No Redis.** Some implementations put a best-effort advisory lock (for
  example a Redis `SET NX`) in front of the Postgres locks. Since Postgres
  locking is authoritative, that layer is simply absent here.
- **Batched writes.** Rather than looping per seat, this implementation uses
  set-based statements (`unnest`, `= ANY`) and `CopyFrom` for the seed. Same
  effect, fewer round trips.
