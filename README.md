# TicketForge

A small event-ticketing platform: events, seats, time-limited seat holds,
orders. It is implemented several times over — one implementation per stack we
hire for — against one shared contract and one shared test suite.

## Start here

**[CHOOSE-YOUR-STACK.md](./CHOOSE-YOUR-STACK.md)** — which directory is yours,
and what to install. Read it before anything else; it takes a minute.

Then `slots/<your-stack>/ASSIGNMENT.md`, then your ticket(s) in `issues/`.

## Layout

| Path | What it is |
|---|---|
| `CHOOSE-YOUR-STACK.md` | Role → directory → prerequisites. Start here. |
| `contract/` | The source of truth: API spec, database schema, fixtures, error codes, performance budget, and the per-family specs (`analytics/`, `deploy/`, `scanner/`, `risk/`, `onchain/`). Read it; never edit it. |
| `slots/` | One directory per stack. 20 of them. Work in exactly one. |
| `conformance/` | How every implementation of this product is checked. Do not edit it — add your own tests beside the code you change. |
| `issues/` | The tickets, as the reporters filed them. |
| `docs/CANDIDATE.md` | What we look at when we review. |
| `docs/TIERS.md` | Time budget. |
| `CONTRIBUTING.md` | How we expect commits and branches. |
| `Makefile`, `docker-compose.yml`, `.devcontainer/` | Optional local conveniences: PostgreSQL 16 and a Prism mock of the API. `make help` lists the targets. |

Money is always integer minor units — no floating point anywhere near a price,
fee, discount or total. Timestamps are UTC, ISO-8601.

## If your stack needs Postgres

`CHOOSE-YOUR-STACK.md` says which do. Every such slot reads its database from
`DATABASE_URL`. `docker compose up -d postgres` (or `make up`) starts one that
matches the URL below; any other database you can create tables in works too.
Then let the slot own the schema:

```bash
docker compose up -d postgres
export DATABASE_URL="postgres://ticketforge:ticketforge@localhost:5432/ticketforge"
cd slots/<your-stack> && make install && make migrate && make seed
```

`docker compose up -d mock` adds a Prism mock of the API from
`contract/openapi.yaml` — useful for layout work, but it holds no state, so the
seat-hold and checkout journeys need a real API.

Seat exclusivity rests on Postgres row locks; no stack needs Redis to be
correct.

Questions about the contract are fair game: ask, or note the ambiguity in your
write-up. We would rather hear it than have you guess silently.
