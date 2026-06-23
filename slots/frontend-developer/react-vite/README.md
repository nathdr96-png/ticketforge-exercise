# web/react-vite — TicketForge buyer UI

React 18 + Vite 5 + TypeScript single-page app for the TicketForge web slot.
It consumes the API described by `contract/openapi.yaml`, exposes every
`data-testid` from `contract/testids.md`, and is driven by
`conformance/e2e/web.spec.ts`.

## What it does

| Journey | Where |
|---|---|
| Login with a seeded user, JWT kept in `localStorage`, auth errors shown in the error banner | `src/components/LoginPage.tsx`, `src/state/session.tsx` |
| Paginated event list, with a selectable page size | `src/components/EventsPage.tsx` |
| Seat map for the 2,000-seat arena, filterable by section and availability | `src/components/EventPage.tsx`, `src/components/SeatMap.tsx` |
| Place / release a hold, 600s TTL countdown, `SEAT_ALREADY_HELD` surfaced | `src/components/EventPage.tsx`, `src/components/HoldCountdown.tsx` |
| Convert a hold to an order with an `Idempotency-Key`, money breakdown | `src/components/EventPage.tsx`, `src/components/MoneyBreakdown.tsx` |
| Discount code preview + the server's recomputed total | `src/lib/discounts.ts`, `src/lib/money.ts` |
| Organizer/admin revenue report (hidden from buyers) | `src/components/ReportsPage.tsx` |

Seeded credentials: any user from `contract/seed/seed.json` with password
`password123` (e.g. `buyer01@ticketforge.test`, `org1@ticketforge.test`).

## Configuration

```sh
cp .env.example .env
```

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the TicketForge API, no trailing slash. Vite **inlines** it at build time, so rebuild after changing it. Defaults to `http://localhost:3000`. |
| `PORT` | Port for `npm run dev` / `npm run preview` (read by `vite.config.ts`). |

## Commands

```sh
make install                 # npm ci (falls back to npm install)
make run                     # vite dev server on $PORT (default 5173)
make build                   # tsc --noEmit + vite build -> dist/
make test                    # vitest unit/component tests
make lint                    # tsc --noEmit
```

Serving the production build:

```sh
VITE_API_BASE_URL=http://127.0.0.1:8080 make build
PORT=4321 npm run preview
```

Docker (the API URL is a build arg because it is inlined):

```sh
docker build --build-arg VITE_API_BASE_URL=http://127.0.0.1:8080 -t ticketforge-web .
docker run --rm -p 3000:3000 ticketforge-web
```

## Running the conformance suite

Holds and checkout need a real, stateful API: point the app at a running
TicketForge API (the URL you were given), freshly seeded from `contract/seed/`.
The Prism mock on `:4010` (from the repo's `docker-compose.yml`) is stateless and
is only good for browsing.

```sh
# 1. a running TicketForge API, e.g. on http://127.0.0.1:8080

# 2. this app (from this directory)
VITE_API_BASE_URL=http://127.0.0.1:8080 make build
PORT=4321 npm run preview

# 3. the suite (playwright.config.ts reads WEB_BASE_URL)
cd ../../../conformance/e2e && npm install && npx playwright install chromium
WEB_BASE_URL=http://127.0.0.1:4321 npx playwright test
```

## Design notes

**Money never touches a float.** `src/lib/money.ts` works only on integer cents:
amounts are split into major/minor units with integer division and the display
string is assembled by hand, so `7001` cents can only render as `70.01`. The
contract formulas are implemented exactly as written in
`contract/scenarios/T3-orders-money.md`
(`discount = floor(subtotal × percent / 100)`,
`fee = floor(after_discount × 5 / 100) + 30`,
`total = after_discount + fee`) and `assertIntegerCents` throws rather than
silently rounding a float that slipped in. `src/lib/money.test.ts` and
`src/components/MoneyBreakdown.test.tsx` cover this.

**Discount preview vs. authority.** The API has no "price this discount"
endpoint, so applying a code recomputes the total locally from the contract
formula using the advertised promo catalogue in `src/lib/discounts.ts`, clearly
labelled as a preview. The `Order` returned by `POST /orders` is what the
confirmation panel renders, and a code the server rejects comes back as
`DISCOUNT_INVALID` in the error banner.

**Idempotency.** One key per *(hold, discount code)* pair. Retrying the same
checkout reuses the key so the API replays the original order (T3-02); changing
the discount code is a different request body and therefore gets a fresh key
instead of provoking `IDEMPOTENCY_KEY_CONFLICT`. The live key is exposed as
`data-testid="idempotency-key"`.

**Seat-map performance.** The map is loaded by walking
`GET /events/{id}/seats` at the contract's maximum `page_size` of 200 — page 1
first (it carries `total`), then the remaining pages concurrently — so 2,000
seats arrive in ~1–2s. Filtering then happens in memory over that snapshot, so
changing section/availability is instant instead of another round trip. Each
seat is a `React.memo` component with primitive props, and the rows use CSS
`content-visibility: auto` + `contain` so off-screen rows cost no layout or
paint. Measured: seat map ready in ~1.9s, section filter ~0.13s.

**Bundle size.** `contract/perf-budget.yaml` allows 250 kB gzipped initial JS;
the production build is **~54 kB gzipped** (171 kB raw) plus ~2.3 kB of CSS.
There are no runtime dependencies beyond React — routing is a 40-line hash
router (`src/lib/router.ts`) and there is no component or icon library.

**Error handling.** Every non-2xx response is normalised into an `ApiError`
carrying the `code` from the `contract/errors.md` envelope, and exactly one
`error-banner[data-error-code]` is rendered at a time so a strict-mode selector
always resolves.

**Authorization.** `nav-reports` only renders for `organizer`/`admin`. A buyer
who reaches `#/reports` by URL sees the API's `INSUFFICIENT_PERMISSION` in the
banner and no revenue numbers.

## Layout

```
src/
  lib/
    contract.ts     types mirroring contract/openapi.yaml
    api.ts          typed fetch client + ApiError normalisation
    money.ts        integer-cent maths and formatting (+ money.test.ts)
    discounts.ts    advertised promo codes, preview only
    idempotency.ts  Idempotency-Key generation
    router.ts       minimal hash router
  state/session.tsx auth/session context, remembered order ids
  components/       LoginPage, Nav, EventsPage, EventPage, SeatMap,
                    HoldCountdown, MoneyBreakdown, OrdersPage, ReportsPage,
                    ErrorBanner
```

## testid coverage (contract/testids.md)

Every id in the contract is exposed. Core: `login-email`, `login-password`,
`login-submit`, `event-list`, `event-card` (`data-event-id`), `seat-map`, `seat`
(`data-seat-id`, `data-section`, `data-status`), `seat-available` (marker class on
the seat plus a label element with the same testid), `hold-button`,
`hold-countdown` (`data-seconds-remaining`), `checkout-button`,
`idempotency-key`, `order-confirmation` (`data-order-id`), `order-total`
(`data-cents`), `error-banner` (`data-error-code`), `nav-events`, `nav-orders`.

Pagination: `events-prev`, `events-next`, `events-page`
(`data-page`/`data-page-count`/`data-page-size`), `events-page-size`,
`event-total` (`data-total`).

Filters: `filter-section`, `filter-availability`, `seat-count-visible`,
`seat-map-empty`.

Hold, discount and money: `release-button`, `discount-code`, `discount-apply`,
`discount-clear`, `checkout-subtotal`/`-discount`/`-fee`/`-total`,
`order-subtotal`/`-discount`/`-fee` (all `data-cents`).

Reporting: `nav-reports`, `revenue-report` — neither renders for a buyer.

Extra non-contract ids used by the UI (safe to ignore): `event-title`,
`seat-counts`, `seat-map-loading`, `selection-list`, `checkout-breakdown`,
`order-breakdown`, `discount-applied`, `hold-id`, `order-new`, `current-user`,
`logout`, `revenue-gross`/`-fees`/`-discounts`/`-net`, `revenue-row`,
`revenue-forbidden`, `event-list-empty`.

### Page size

`events-page-size` offers 2 / 5 / 10 / 25 (default 10) and is the `page_size` sent
to `GET /events`. Changing it returns to page 1 — staying on page 4 of a list that
now has two pages would show nothing. The small options matter: an installation
with a handful of published events must still be navigable page by page, and the
conformance suite drives pagination through this control rather than assuming how
much seed data exists.
