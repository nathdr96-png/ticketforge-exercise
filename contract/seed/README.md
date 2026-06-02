# Seed fixtures

Deterministic fixtures for every candidate run. **Do not randomize at load time.**

| File | Contents |
|---|---|
| `seed.json` | Users (1 admin, 3 organizers, 50 buyers), 5 events, discounts |
| `seats.json` | Materialized seats (regenerate with `node generate-seats.js`) |
| `generate-seats.js` | Deterministic seat expander |

## Credentials

Every user password is `password123`. Loaders must bcrypt-hash at cost 10.

## Notable events

- `event_arena_2000` — exactly **2000** seats (sections A–D, 25×20 each). Perf / seat-map target.
- `event_club_100` — exactly **100** seats. Oversell concurrency target.
- `event_jazz_eur` — EUR currency.
- `event_draft` / `event_cancelled` — status edge cases.

## Money

Prices are integer cents. Section deltas are applied as
`price_cents = base_price_cents + section_price_delta_cents[section]`.
