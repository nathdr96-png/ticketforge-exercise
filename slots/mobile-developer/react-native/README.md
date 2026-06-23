# mobile/react-native — TicketForge buyer app

A React Native app for the TicketForge mobile slot, **rendered to the web with
`react-native-web`** so that the existing Playwright conformance suites can grade
it. It consumes the API described by `contract/openapi.yaml`, exposes every
`data-testid` in `contract/testids.md`, and is driven unchanged by
`conformance/e2e/web.spec.ts`.

## What this grading surface does and does not cover

Stated here rather than left implied, because the coverage is easy to oversell.

The suites grade, objectively and with no human in the loop: every screen and
state transition the contract describes; client-side money (exact integer-cent
subtotal / discount / fee / total, the contract's floor rules, no floating-point
arithmetic on the money path); API interaction (all ten seat pages, a stable
`Idempotency-Key` across retries, UTC-anchored hold expiry, contract error codes
surfaced rather than swallowed); and client state after a *failed* mutation.

They do **not** grade any of this:

- native permissions — camera for ticket scanning, notifications, location;
- push notifications — registration, tokens, a hold expiring while backgrounded;
- background tasks — `AppState` transitions, keeping a countdown honest across
  suspend/resume, iOS background execution limits;
- platform gestures and navigation — swipe-back, a real stack navigator,
  Android hardware back, keyboard avoidance, safe-area insets;
- offline storage and sync — `AsyncStorage`/SQLite persistence, an offline-first
  seat map, conflict resolution on reconnect;
- deep links — the real `Linking` plumbing, universal links, App Links,
  cold start from a URL;
- build, signing and release — Gradle, Xcode, provisioning, store metadata, OTA;
- device performance and native rendering — every number in this README was
  measured in a desktop browser.

**An app can pass every browser test and still be weak at device-specific
work.** The suites are the objective floor, not the whole role; everything in
the list above needs a device-driven test setup (Detox, Maestro, an emulator)
or a human look before it can be called covered. The family spec
in `slots/mobile-developer/_SPEC.md` carries the same statement at more length, plus why
the trade is still worth making.

This is real React Native code that happens to render to the web, not a web app
wearing React Native's name. The component tree is `View` / `Text` / `Pressable`
/ `TextInput` / `ScrollView` / `FlatList`, styled with `StyleSheet.create`, with
one `AppRegistry.registerComponent` entry point. There is no `div`, no `span`, no
`className` and no stylesheet in `src/`. Platform is confined to three places:
the bundler alias in `vite.config.ts`, the host half of `src/index.tsx`, and the
`Platform.OS` guard in `src/lib/navigation.ts`.

## What it does

| Journey | Where |
|---|---|
| Sign in with a seeded user, auth errors surfaced with their contract code | `src/screens/LoginScreen.tsx`, `src/state/session.tsx` |
| Paginated event list with a page-size control and machine-readable page state | `src/screens/EventsScreen.tsx` |
| 2,000-seat map in a `FlatList`, filterable by section and availability | `src/screens/EventScreen.tsx`, `src/components/SeatMap.tsx` |
| Place / release a hold; UTC-anchored 600s countdown | `src/screens/EventScreen.tsx`, `src/components/HoldCountdown.tsx` |
| `SEAT_ALREADY_HELD` surfaced with the map refreshed | `src/screens/EventScreen.tsx` (`placeHold`) |
| Hold → order with a stable `Idempotency-Key`, exact integer-cent breakdown | `src/lib/idempotency.ts`, `src/components/MoneyBreakdown.tsx` |
| Discount quote before purchase, server's recomputed total after | `src/lib/discounts.ts`, `src/lib/money.ts` |
| Organizer/admin revenue report, no tab and no figures for a buyer | `src/screens/ReportsScreen.tsx`, `src/components/NavBar.tsx` |

Seeded credentials: any user from `contract/seed/seed.json` with password
`password123` (e.g. `buyer01@ticketforge.test`, `org1@ticketforge.test`).

## Commands

```sh
make install                 # npm ci (falls back to npm install)
make run                     # dev server on $PORT (default 5173)
make build                   # tsc --noEmit + bundle -> dist/
make test                    # vitest unit tests (integer-cent money)
make lint                    # tsc --noEmit
```

Serving the production bundle:

```sh
VITE_API_BASE_URL=http://127.0.0.1:8080 make build
PORT=4321 npm run preview
```

Docker (the API URL is a build arg because it is inlined):

```sh
docker build --build-arg VITE_API_BASE_URL=http://127.0.0.1:8080 -t ticketforge-mobile-rn .
docker run --rm -p 3000:3000 ticketforge-mobile-rn
```

## Configuration

```sh
cp .env.example .env
```

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Base URL of the TicketForge API, no trailing slash. **Inlined at build time**, so rebuild after changing it — which is also how a device build works. Defaults to `http://127.0.0.1:3000`. |
| `PORT` | Port for `make run` / `npm run preview` (read by `vite.config.ts`). |

## Running the conformance suite

Holds and checkout need a real, stateful API: point the app at a running
TicketForge API (the URL you were given), freshly seeded from `contract/seed/`.
The Prism mock on `:4010` (from the repo's `docker-compose.yml`) is stateless and
is only good for browsing.

```sh
# 1. a running TicketForge API, e.g. on http://127.0.0.1:8080

# 2. this app (from this directory)
PORT=4321 VITE_API_BASE_URL=http://127.0.0.1:8080 make run

# 3. the suite (playwright.config.ts reads WEB_BASE_URL, not BASE_URL)
cd ../../../conformance/e2e && npm install && npx playwright install chromium
WEB_BASE_URL=http://127.0.0.1:4321 npx playwright test
```

The browser suites hold and buy **named** seats and are not idempotent against a
dirty database: re-seed the API's database before a second run, or the
tests that need a named seat to be `available` will fail on seats the previous
run sold.

## How React Native becomes a web bundle

Three settings in `vite.config.ts`, and nothing else:

1. **`resolve.alias`**: `react-native` → `react-native-web`, so `View`, `Text`,
   `Pressable`, `FlatList` and `StyleSheet` resolve to the DOM
   implementations. The real `react-native` package is never bundled — its
   sources are Flow-typed and would not parse, and its peer range wants React 19
   and an Android/iOS toolchain.
2. **`resolve.extensions`**: `.web.tsx`/`.web.ts`/`.web.jsx`/`.web.js` ahead of
   the bare extension, which is React Native's own platform-extension
   resolution. This is what selects `@react-native-picker/picker`'s web
   implementation. The same list is repeated under
   `optimizeDeps.esbuildOptions.resolveExtensions`, because pre-bundling runs
   through esbuild and does not read `resolve.extensions`.
3. **`define`**: `__DEV__` is a React Native global; `global` is assumed by a few
   modules that predate ESM.

`.npmrc` sets `legacy-peer-deps=true`, with the reason in the file: npm installs
peer dependencies eagerly, and `@react-native-picker/picker` declares
`react-native: "*"` — the very package this build deliberately does not resolve.

### `testID` → `data-testid`, verified rather than assumed

`react-native-web`'s `createDOMProps` emits `data-testid` from `testID`, and
`data-<hyphenated-key>` for each entry in the `dataSet` prop
(`dataSet={{ seatId }}` → `data-seat-id`). Both were confirmed against the
installed package by rendering a probe app and reading the real DOM, before any
of this app was written:

| What the contract needs | What `react-native-web` produces | Verified |
|---|---|---|
| `data-testid` | `testID="seat"` → `data-testid="seat"` | yes |
| `data-seat-id`, `data-status`, `data-cents`, `data-error-code`, … | `dataSet={{ seatId, status, cents, errorCode }}` → hyphenated `data-*` | yes |
| a control Playwright's `selectOption` can drive | `@react-native-picker/picker` (web) → `<select>` with `<option>` children | yes |
| `toBeDisabled()` on `events-prev` / `events-next` | `Pressable role="button" disabled` → `<button disabled aria-disabled="true">` | yes |
| `fill()` / `inputValue()` on the login fields and `idempotency-key` | `TextInput` → `<input>`; `editable={false}` → `readonly` | yes |
| `secureTextEntry` on the password field | `<input type="password">` | yes |

The `role="button"` on `AppButton` is the load-bearing one. `react-native-web`
maps an accessibility role onto a semantic element, so a `Pressable` with
`role="button"` is a real `<button>` and its `disabled` prop is a real `disabled`
attribute. A plain `View` would only have carried `aria-disabled`, and the
contract's two pagination controls are asserted as *disabled*.

No testid in `contract/testids.md` was unsatisfiable, and the contract was not
modified.

## The 2,000-seat `FlatList`

This is the interesting part of the app, and it pulls in two directions.

`contract/testids.md` requires the whole map to be addressable at once: every
seat carries `data-seat-id`, and `seat-count-visible` is a count over all of
them. `conformance/e2e` asserts 2,000 `seat` elements for the arena. So
**windowing is off** — `initialNumToRender` covers the list, `windowSize` is
effectively unbounded, `removeClippedSubviews` is `false`. A virtualised list
would report a 200-seat arena, and on a device it would show blank rows to
anyone who scrolls fast.

The cost is paid down four other ways, in `src/components/SeatMap.tsx`:

1. **The list is 100 items, not 2,000.** Seats are grouped into `(section, row)`
   items of 20, which is also how a seat map is read. One cell per seat would
   mean 2,000 `CellRenderer` wrappers with their own layout and key bookkeeping,
   for no visual gain.
2. **`getItemLayout` returns a constant.** Row height is derived from
   `theme.seatSize`, so no row is ever measured and `FlatList` skips the
   `onLayout` pass entirely. On a long list this is the single biggest win and
   the one most often left on the table.
3. **Every leaf is memoised on primitives.** `SeatTile` takes strings, numbers
   and booleans — never the `Seat` object, never the selection `Set` — so
   selecting one seat re-renders one tile. `SeatRow` is memoised the same way,
   with its selection collapsed into one string so `memo`'s shallow compare can
   see it.
4. **The press handler is stable.** `onToggle` is a `useCallback` in the screen,
   passed down unchanged, handing the seat id back on press, so no tile ever
   re-renders because its callback was re-created.

Seat status comes from one in-memory snapshot of all 2,000 seats
(`api.listAllSeats`: page 1 first for `total`, then the remaining nine
concurrently), and both filters run over that snapshot, so changing a filter
costs no round trip.

**Measured, honestly labelled.** Three runs of the production bundle against a
running TicketForge API, headless Chromium at 1280×720, on a developer machine under
heavy unrelated load — which is why these are ranges and not single figures:

| Step, on the 2,000-seat arena | Measured |
|---|---|
| Open the event → 2,000 `seat` nodes in the tree (ten seat requests included) | 1.4 – 2.9 s |
| Filter to section B (2,000 → 500 seats) | 0.32 – 0.93 s |
| Clear the filter (500 → 2,000 seats) | 0.63 – 1.35 s |
| Select one seat | 0.43 – 0.69 s |

Read them with two caveats. The seat-selection figure is end-to-end through
Playwright, so most of it is the driver's scroll-into-view and actionability
wait, not rendering: the render itself touches one memoised tile. And they are
**web** numbers. They say the data flow and the memoisation are sound; they say
nothing certain about the same list on a mid-range Android device, where the JS
thread and real memory pressure are what decide — see the coverage note at the
top of this file.

The reproducible measurement is the conformance suite itself: `conformance/e2e`
gives the 2,000-seat map test 180 s, and it passes with the whole map addressable
and both filters composed.

## Design notes

**Money never touches a float.** `src/lib/money.ts` works only on integer cents.
The single division on the money path goes through `floorDiv(numerator,
denominator)`, which keeps both operands whole and divides once — so the result
cannot depend on how a binary float represents a percentage like `0.05`. The
display string is assembled from an integer major part and an integer remainder,
so `4282` cents can only render as `42.82`; there is no `toFixed` and no
`parseFloat` in the module. `assertCents` throws rather than letting a float
through. The contract formulas are transcribed exactly from
`contract/scenarios/T3-orders-money.md`, and `src/lib/money.test.ts` pins the one
fixture price where floor and round disagree (4050c → fee 232, never 233).

**Discount quote vs. authority.** The API has no "price this discount" endpoint,
so an advertised code is priced locally from the catalogue in
`src/lib/discounts.ts` and labelled as a quote. A code scoped to one event
quotes only on that event. An unrecognised code quotes as "the server will check
this" rather than as a silent zero, is forwarded to `POST /orders` untouched, and
a `DISCOUNT_INVALID` comes back in the banner **with the hold intact**. The
`Order` the API returns is always what the confirmation panel renders. Note that
`autoCapitalize="characters"` on the input is a soft-keyboard hint and nothing
more — it does not change the value and does nothing to a pasted code, so
`normaliseCode` is still what makes `save10` work.

**Idempotency.** One key per *(hold, discount code)* pair, minted at exactly the
moments that pair changes. Deliberately **not** minted in the checkout failure
path: on a phone the common failure is losing the response, not the request, and
a buyer who taps Checkout again has to send the same key or be charged twice
(T3-02). Changing the code *is* a different request body, so it gets a fresh key
instead of provoking `IDEMPOTENCY_KEY_CONFLICT`. The live key is exposed as a
read-only `TextInput` carrying `data-testid="idempotency-key"`.

**The hold countdown is UTC-anchored.** `secondsLeft()` recomputes from the
server's `expires_at` on every tick rather than decrementing a starting number,
so a backgrounded app, a throttled timer or a drifting device clock cannot
inflate the time a buyer believes they have. `Date.parse` of a string with a `Z`
offset is an absolute instant in Hermes, JavaScriptCore and V8 alike, which is
what makes the answer the same in Berlin, New York and on a UTC CI box.

**No navigator dependency.** `src/lib/navigation.ts` is a deep-link path plus a
subscribable current route, in about ninety lines. Five screens and one
parameter do not justify `@react-navigation/native` plus a gesture handler and
reanimated against the bundle budget. The pure half (`parsePath`, `pathFor`)
knows nothing about either platform; the platform half is three functions, which
is the seam where `Linking.addEventListener("url")` and an in-memory stack would
go on a device. No screen touches a URL.

**Error handling.** Every non-2xx response becomes an `ApiError` carrying the
`code` from the `contract/errors.md` envelope, then a `DisplayError` whose code
and message reach the banner as separate `Text` children — which is what makes
`[object Object]` unreachable. Exactly one screen is mounted at a time and each
renders at most one `error-banner`, so a strict-mode selector always resolves. A
transport failure becomes an `ApiError` too, with `INTERNAL_ERROR` and the
unreachable-host message, rather than a raw `Network request failed`.

**Authorization.** `nav-reports` renders only for `organizer`/`admin`, but that
is a courtesy. `#/reports` is mounted for anyone who deep-links to it, so the
refusal is the API's `INSUFFICIENT_PERMISSION` in the banner and no figures —
rather than a client-side redirect that only hides the route from people who do
not know it is there.

**Session persistence is absent on purpose.** `src/state/session.tsx` keeps the
token in memory, so a cold start signs the buyer out. A shipped app would use
`@react-native-async-storage/async-storage`. That is a device concern this slot
does not implement, and the coverage note above lists it as ungraded rather
than this README pretending the omission is a design choice.

**No types from the `react-native` package.** `react-native-web` ships no
TypeScript types, and adding `react-native` as a dev dependency purely for its
`.d.ts` files drags ~100 MB of native toolchain into a web build. So the API
surface this app uses is declared by hand in `src/types/react-native.d.ts`, and
`make lint` checks every call against it. It is deliberately narrow: adding a
primitive means declaring it first, which stops the app quietly depending on
something that exists on one platform only. The one non-core prop in there is
`dataSet`, which is `react-native-web`'s mapping to HTML data attributes and is
inert on a device — exactly right for test metadata.

**Bundle size.** `contract/perf-budget.yaml` allows **250 kB** gzipped initial
JS. This build is **106.1 kB gzipped** (334.8 kB raw), about 42% of the budget.
For comparison: `web/react-vite` is 54.5 kB and `web/vue` is 37.1 kB. The
difference is `react-native-web` itself — a style registry, the
`Pressable`/responder system and `VirtualizedList` are not free, and that is the
honest price of running one codebase on three platforms. The app adds no runtime
dependency beyond React, `react-native-web` and the picker: no navigator, no
state library, no component or icon kit.

## Layout

```
app.json              React Native app name, read by AppRegistry
index.html            web host document (the only HTML in the slot)
src/
  index.tsx           AppRegistry.registerComponent + runApplication
  App.tsx             auth gate + one mounted screen
  theme.ts            colour, spacing, type scale, seat geometry
  types/
    react-native.d.ts the React Native API surface this app uses
  lib/
    contract.ts       wire types and constants from contract/openapi.yaml
    api.ts            typed fetch client + ApiError normalisation
    errors.ts         anything thrown -> DisplayError for the banner
    money.ts          integer-cent maths and formatting (+ money.test.ts)
    discounts.ts      advertised promo catalogue, quote only
    idempotency.ts    Idempotency-Key minting
    navigation.ts     deep-link path + subscribable route
  state/
    session.tsx       auth session + remembered order ids
  screens/            LoginScreen, EventsScreen, EventScreen, OrdersScreen,
                      ReportsScreen
  components/         NavBar, SeatMap, HoldCountdown, MoneyBreakdown,
                      ErrorBanner, AppButton, SelectField
```

## testid coverage (contract/testids.md)

Every id in the contract is exposed, with no additions to the contract.

Core: `login-email`, `login-password`, `login-submit`, `event-list`,
`event-card` (`data-event-id`), `seat-map`, `seat` (`data-seat-id`,
`data-section`, `data-status`), `seat-available` (the tile's own label, so a tap
on it is a tap on the seat), `hold-button`, `hold-countdown`
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

Extra non-contract ids, safe to ignore: `event-title`, `seat-map-loading`,
`selection-list`, `checkout-breakdown`, `order-breakdown`, `discount-applied`,
`hold-id`, `order-new`, `current-user`, `sign-out`, `revenue-gross` / `-fees` /
`-discounts` / `-net`, `revenue-row`, `revenue-forbidden`, `event-list-empty`,
`order-list`, `order-card`, `order-list-empty`.

### Page size

`events-page-size` offers 2 / 5 / 10 / 25 (default 10) and its value is the
`page_size` sent to `GET /events`. Changing it returns to page 1 — staying on
page 4 of a list that now has two pages would show an empty screen and read as a
broken app. The small options matter: the conformance suite drives pagination
through this control rather than assuming how much seed data a deployment
happens to carry.
