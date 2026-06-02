# Stable `data-testid` attributes for web / e2e conformance

Playwright suites MUST select only by these ids. Web UI slots MUST expose them.

## Core

| testid | Element |
|---|---|
| `login-email` | Email input on login |
| `login-password` | Password input on login |
| `login-submit` | Login submit button |
| `event-list` | Container for the event list |
| `event-card` | Individual event row/card (`data-event-id` required) |
| `seat-map` | Seat map container |
| `seat` | Individual seat (`data-seat-id` required; also set `data-section` to the seat's section letter and `data-status` to `available` \| `held` \| `sold`) |
| `seat-available` | Marker class/state — seat is available (also set `data-status="available"`) |
| `hold-button` | Button to place hold on selected seats |
| `hold-countdown` | Remaining hold TTL display (`data-seconds-remaining` required — whole seconds derived from the hold's UTC `expires_at`) |
| `checkout-button` | Convert hold → order |
| `idempotency-key` | Hidden/visible field carrying the idempotency key (optional UI) |
| `order-confirmation` | Order success panel (`data-order-id` required) |
| `order-total` | Order total in minor units (`data-cents` required) |
| `error-banner` | Visible error message (`data-error-code` required) |
| `nav-events` | Nav link to events |
| `nav-orders` | Nav link to orders |

## Event list pagination

| testid | Element |
|---|---|
| `events-prev` | Previous-page control (disabled on the first page) |
| `events-next` | Next-page control (disabled on the last page) |
| `events-page` | Current page indicator (`data-page`, `data-page-count` and `data-page-size` required) |
| `events-page-size` | Page-size selector; its value is the `page_size` sent to the API |
| `event-total` | Total number of events the API reports (`data-total` required) |

## Seat map filters

| testid | Element |
|---|---|
| `filter-section` | Section filter; value is a section letter (`A`..`D`), empty string = all sections |
| `filter-availability` | Availability filter; value is a seat status (`available` \| `held` \| `sold`), empty string = any |
| `seat-count-visible` | Number of seats currently shown by the active filters |
| `seat-map-empty` | Rendered instead of seats when the active filters match nothing |

## Hold, discount and money breakdown

| testid | Element |
|---|---|
| `release-button` | Release the current hold and return its seats to available |
| `discount-code` | Discount code input |
| `discount-apply` | Apply the entered discount code |
| `discount-clear` | Remove the applied discount code |
| `checkout-subtotal` | Pre-order subtotal preview (`data-cents` required) |
| `checkout-discount` | Pre-order discount preview (`data-cents` required) |
| `checkout-fee` | Pre-order fee preview (`data-cents` required) |
| `checkout-total` | Pre-order total preview (`data-cents` required) |
| `order-subtotal` | Confirmed order subtotal (`data-cents` required) |
| `order-discount` | Confirmed order discount (`data-cents` required) |
| `order-fee` | Confirmed order fee (`data-cents` required) |

## Reporting

| testid | Element |
|---|---|
| `nav-reports` | Nav link to the revenue report. MUST NOT render for a `buyer` |
| `revenue-report` | Revenue report panel. MUST NOT render for a `buyer` |

All `data-cents` values are integer minor units, exactly as the API returned
them (or, for the `checkout-*` preview rows, exactly as the formula in
`contract/scenarios/T3-orders-money.md` computes them). No formatted strings, no
floats.
