# web/vue — TicketForge buyer UI

Vue 3 + Vite 5 + TypeScript single-page app for the TicketForge web slot. It
consumes the API described by `contract/openapi.yaml`, exposes every
`data-testid` from `contract/testids.md`, and is driven unchanged by
`conformance/e2e/web.spec.ts`.

It is a complete, idiomatic Vue implementation of the web slot, written from the
contract rather than translated from another framework.

## What it does

| Journey | Where |
|---|---|
| Login with a seeded user, JWT in `localStorage`, auth errors in the error banner | `src/components/LoginView.vue`, `src/stores/session.ts` |
| Paginated event list with a page-size control and machine-readable page state | `src/components/EventsView.vue` |
| 2,000-seat map, filterable by section and availability | `src/components/EventView.vue`, `src/components/SeatMap.vue` |
| Place / release a hold, UTC-anchored 600s countdown, `SEAT_ALREADY_HELD` surfaced with the map refreshed | `src/components/EventView.vue`, `src/components/HoldCountdown.vue` |
| Convert a hold to an order with a stable `Idempotency-Key`, exact integer-cent breakdown | `src/components/EventView.vue`, `src/components/MoneyBreakdown.vue` |
| Discount code preview + the server's recomputed total | `src/lib/discounts.ts`, `src/lib/money.ts` |
| Organizer/admin revenue report, hidden from buyers | `src/components/ReportsView.vue` |

Seeded credentials: any user from `contract/seed/seed.json` with password
`password123` (e.g. `buyer01@ticketforge.test`, `org1@ticketforge.test`).

## Configuration

```sh
cp .env.example .env
```

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the TicketForge API, no trailing slash. Vite **inlines** it at build time, so rebuild after changing it. Defaults to `http://127.0.0.1:3000`. |
| `PORT` | Port for `make run` / `npm run preview` (read by `vite.config.ts`). |

## Commands

```sh
make install                 # npm ci (falls back to npm install)
make run                     # vite dev server on $PORT (default 5173)
make build                   # vue-tsc --noEmit + vite build -> dist/
make test                    # vitest unit tests (integer-cent money)
make lint                    # vue-tsc --noEmit
```

Serving the production build:

```sh
VITE_API_BASE_URL=http://127.0.0.1:8080 make build
PORT=4321 npm run preview
```

Docker (the API URL is a build arg because it is inlined):

```sh
docker build --build-arg VITE_API_BASE_URL=http://127.0.0.1:8080 -t ticketforge-web-vue .
docker run --rm -p 3000:3000 ticketforge-web-vue
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

# 3. the suite (playwright.config.ts reads WEB_BASE_URL, not BASE_URL)
cd ../../../conformance/e2e && npm install && npx playwright install chromium
WEB_BASE_URL=http://127.0.0.1:4321 npx playwright test
```

The browser suites hold and buy **named** seats and are not idempotent against a
dirty database: re-seed the API's database before a second run, or the
tests that need a named seat to be `available` will fail on seats the previous
run sold.

## Design notes

**Money never touches a float.** `src/lib/money.ts` works only on integer cents.
The one division on the money path goes through `divFloor(numerator,
denominator)`, which keeps both operands whole and divides once — so the result
cannot depend on how a binary float rounds a percentage like `0.05`. The display
string is assembled from an integer major part and an integer remainder, so
`4282` cents can only render as `42.82`; there is no `toFixed` and no
`parseFloat` in the module. `assertCents` throws rather than letting a float
through. The contract formulas are implemented exactly as
`contract/scenarios/T3-orders-money.md` writes them
(`discount = floor(subtotal × percent / 100)`,
`fee = floor(after_discount × 5 / 100) + 30`,
`total = after_discount + fee`), and `src/lib/money.spec.ts` pins the one price
where floor and round disagree (4050c → fee 232, never 233).

**Discount preview vs. authority.** The API has no "price this discount"
endpoint, so applying a recognised code recomputes the total locally from the
contract formula against the advertised catalogue in `src/lib/discounts.ts`,
clearly labelled as a preview. A code scoped to one event previews only on that
event. An unrecognised code previews as "the server will check this" rather than
as a silent zero, and the `Order` returned by `POST /orders` is always what the
confirmation panel renders. A code the API rejects comes back as
`DISCOUNT_INVALID` in the banner **with the hold intact**.

**Idempotency.** One key per *(hold, discount code)* pair, minted by
`mintIdempotencyKey()` at exactly the moments the pair changes: a new hold, a
changed code, a release, a placed order. Deliberately **not** minted in the
checkout failure path — retrying the same purchase has to send the same key, or
the API cannot recognise the retry and the buyer is charged twice (T3-02).
Changing the discount code *is* a different request body, so it gets a fresh key
instead of provoking `IDEMPOTENCY_KEY_CONFLICT`. The live key is exposed as
`data-testid="idempotency-key"`.

**Seat-map performance.** `GET /events/{id}/seats` caps `page_size` at 200, so
the 2,000-seat arena is ten requests: page 1 first (it carries `total`), then the
remaining nine concurrently. Filtering happens in memory over that snapshot, so
changing a filter costs no round trip. The map is rendered as 2,000 plain
`<button>` elements emitted straight from `SeatMap.vue`'s template rather than
2,000 child components — 2,000 reactive scopes to create and tear down on every
filter change is the expensive way to do this — and the snapshot is a
`shallowRef`, so there is no deep reactive proxy per seat. Rows opt into
`content-visibility: auto` with `contain`, which lets the browser skip layout and
paint for everything scrolled out of view.

**Bundle size.** `contract/perf-budget.yaml` allows **250 kB** gzipped initial
JS. This build is **37.1 kB gzipped** (100.7 kB raw) plus 2.1 kB of CSS — about
15% of the budget. There are no runtime dependencies beyond Vue itself: the
router is a forty-line hash router (`src/lib/router.ts`), the session store is
three module-scope refs (no Pinia), and there is no component or icon library.

**Error handling.** Every non-2xx response is normalised into an `ApiError`
carrying the `code` from the `contract/errors.md` envelope, then into a
`DisplayError` with the code and message as separate text nodes — which is what
guarantees the banner can never read `[object Object]`. Exactly one view renders
at a time and each renders at most one `error-banner`, so a strict-mode selector
always resolves.

**Authorization.** `nav-reports` renders only for `organizer`/`admin`, but that
is a courtesy. `#/reports` is rendered for anyone who types it, so the refusal is
the API's `INSUFFICIENT_PERMISSION` in the banner and no revenue numbers —
rather than a client-side redirect that merely hides the route.

## Layout

```
src/
  lib/
    contract.ts     types and constants mirroring contract/openapi.yaml
    api.ts          typed fetch client + ApiError normalisation
    errors.ts       ApiError/unknown -> DisplayError for the banner
    money.ts        integer-cent maths and formatting (+ money.spec.ts)
    discounts.ts    advertised promo catalogue, preview only
    idempotency.ts  Idempotency-Key minting
    router.ts       minimal hash router, one module-scope ref
  stores/
    session.ts      auth session + remembered order ids, no Pinia
  components/       LoginView, NavBar, EventsView, EventView, SeatMap,
                    HoldCountdown, MoneyBreakdown, OrdersView, ReportsView,
                    ErrorBanner
  App.vue           auth gate + router outlet
  main.ts           mount
  styles.css        one stylesheet, no framework
```

## testid coverage (contract/testids.md)

Every id in the contract is exposed, with no additions to the contract.

Core: `login-email`, `login-password`, `login-submit`, `event-list`,
`event-card` (`data-event-id`), `seat-map`, `seat` (`data-seat-id`,
`data-section`, `data-status`), `seat-available` (marker class on the seat plus a
label element carrying the testid), `hold-button`, `hold-countdown`
(`data-seconds-remaining`), `checkout-button`, `idempotency-key`,
`order-confirmation` (`data-order-id`), `order-total` (`data-cents`),
`error-banner` (`data-error-code`), `nav-events`, `nav-orders`.

Pagination: `events-prev`, `events-next`, `events-page`
(`data-page` / `data-page-count` / `data-page-size`), `events-page-size`,
`event-total` (`data-total`).

Filters: `filter-section`, `filter-availability`, `seat-count-visible`,
`seat-map-empty`.

Hold, discount and money: `release-button`, `discount-code`, `discount-apply`,
`discount-clear`, `checkout-subtotal` / `-discount` / `-fee` / `-total`,
`order-subtotal` / `-discount` / `-fee` (all `data-cents`).

Reporting: `nav-reports`, `revenue-report` — neither renders for a buyer.

Extra non-contract ids, safe to ignore: `event-title`, `seat-counts`,
`seat-map-loading`, `selection-list`, `checkout-breakdown`, `order-breakdown`,
`discount-applied`, `hold-id`, `order-new`, `current-user`, `logout`,
`revenue-gross` / `-fees` / `-discounts` / `-net`, `revenue-row`,
`revenue-forbidden`, `event-list-empty`, `order-list`, `order-card`,
`order-list-empty`.

### Page size

`events-page-size` offers 2 / 5 / 10 / 25 (default 10) and its value is the
`page_size` sent to `GET /events`. Changing it returns to page 1 — staying on
page 4 of a list that now has two pages would show nothing. The small options
matter: the conformance suite drives pagination through this control rather than
assuming how much seed data a deployment happens to have.
