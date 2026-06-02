# Tier 3 — Idempotent purchase, expiry, money math

## T3-01 Convert hold to order
Given buyer01 has an active hold on seats totaling subtotal S cents
When they `POST /orders` with header `Idempotency-Key: key-001` and body `{ "hold_id": "..." }`
Then the response is 201
And `subtotal_cents` = S (integer)
And `fee_cents` = floor(S * 5 / 100) + 30
And `discount_cents` = 0
And `total_cents` = (S - 0) + fee_cents
And seats are `sold`
And hold status is `converted`

## T3-02 Idempotent replay
Given an order created with Idempotency-Key `key-002` and body B
When the same buyer retries `POST /orders` with the same key and same body B
Then the response is 200
And the returned `id` equals the original order id
And no second charge / no duplicate order row

## T3-03 Idempotency key conflict
Given an order created with key `key-003` and body B1
When the same buyer `POST /orders` with key `key-003` and different body B2
Then the response is 409 with `IDEMPOTENCY_KEY_CONFLICT`

## T3-04 Missing idempotency key
When `POST /orders` without `Idempotency-Key`
Then the response is 400 with `IDEMPOTENCY_KEY_REQUIRED`

## T3-05 Expired hold cannot purchase
Given a hold whose `expires_at` is in the past (or TTL forced short by the test environment)
When the buyer `POST /orders` for that hold
Then the response is 410 with `HOLD_EXPIRED`
And seats are `available` again

## T3-06 Discount SAVE10
Given an active hold with subtotal S
When they order with `discount_code: "SAVE10"`
Then `discount_cents` = floor(S * 10 / 100)
And `fee_cents` = floor((S - discount_cents) * 5 / 100) + 30
And `total_cents` = (S - discount_cents) + fee_cents

## T3-07 Invalid discount
When they order with `discount_code: "NOPE"`
Then the response is 400 with `DISCOUNT_INVALID`

## T3-08 Money never float
Across all order responses in this tier, every `*_cents` field is a JSON integer (not number with fractional part).
