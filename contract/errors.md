# TicketForge Error Codes

Every error response MUST use this shape:

```json
{
  "error": {
    "code": "SEAT_ALREADY_HELD",
    "message": "Human-readable explanation",
    "details": {}
  }
}
```

HTTP status is chosen by the code below. Implementations MUST NOT invent new codes.
`details` is optional and may carry structured context (e.g. `seat_id`, `hold_id`).

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing or invalid credentials / bearer token |
| `INSUFFICIENT_PERMISSION` | 403 | Authenticated but role/ownership does not allow the action |
| `NOT_FOUND` | 404 | Resource does not exist (generic; prefer specific codes when listed) |
| `EVENT_NOT_FOUND` | 404 | Event id not found |
| `SEAT_NOT_FOUND` | 404 | Seat id not found |
| `HOLD_NOT_FOUND` | 404 | Hold id not found |
| `ORDER_NOT_FOUND` | 404 | Order id not found |
| `VALIDATION_ERROR` | 400 | Request body/query failed schema or business validation |
| `SEAT_ALREADY_HELD` | 409 | One or more requested seats are currently held by another buyer |
| `SEAT_NOT_AVAILABLE` | 409 | Seat is sold or otherwise not available to hold |
| `HOLD_EXPIRED` | 410 | Hold TTL elapsed; seats released |
| `HOLD_ALREADY_CONVERTED` | 409 | Hold was already turned into an order |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | `Idempotency-Key` header missing on `POST /orders` |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same key reused with a different request body |
| `DISCOUNT_INVALID` | 400 | Discount code unknown, expired, or not applicable |
| `DISCOUNT_ALREADY_APPLIED` | 409 | Discount cannot be stacked / already used on this order |
| `RATE_LIMITED` | 429 | Too many requests (optional; not required for T1–T3) |
| `INTERNAL_ERROR` | 500 | Unexpected server failure |

## Money & time invariants (enforced by conformance)

- All monetary amounts are **integer minor units** (cents). No floats in request, response, or storage on the money path.
- All timestamps are **UTC ISO-8601** with `Z` suffix (e.g. `2026-06-15T19:00:00.000Z`).
- Default hold TTL is **600 seconds** (10 minutes) unless overridden by configuration (`HOLD_TTL_SECONDS`).
