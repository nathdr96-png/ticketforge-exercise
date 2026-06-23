-- A code that was never redeemed has no currency and must therefore report no
-- money. Money attached to a null currency is money that has been added across
-- currencies somewhere upstream.
SELECT code, currency, gross_cents, discounts_cents, fees_cents, net_cents
FROM {{ ref('q6_discount_effectiveness') }}
WHERE currency IS NULL
  AND (orders_count <> 0 OR gross_cents <> 0 OR discounts_cents <> 0
       OR fees_cents <> 0 OR net_cents <> 0)
