-- net = gross - discounts + fees, the RevenueReport definition in
-- contract/openapi.yaml. Any row that fails this is arithmetically impossible,
-- whatever else is wrong with it.
SELECT 'q1' AS model, event_id AS grain, gross_cents, discounts_cents, fees_cents, net_cents
FROM {{ ref('q1_revenue_by_event') }}
WHERE net_cents <> gross_cents - discounts_cents + fees_cents

UNION ALL

SELECT 'q6', code, gross_cents, discounts_cents, fees_cents, net_cents
FROM {{ ref('q6_discount_effectiveness') }}
WHERE net_cents <> gross_cents - discounts_cents + fees_cents
