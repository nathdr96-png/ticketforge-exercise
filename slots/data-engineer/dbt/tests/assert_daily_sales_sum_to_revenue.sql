-- The daily digest and the month-end revenue report are read by different people
-- and must be counting the same orders. A disagreement here is two reports built
-- on two definitions, which is worse than one report being wrong.
WITH daily AS (
  SELECT event_id,
         currency,
         SUM(orders_count) AS orders_count,
         SUM(gross_cents)  AS gross_cents,
         SUM(net_cents)    AS net_cents
  FROM {{ ref('q2_daily_sales_utc') }}
  GROUP BY event_id, currency
)
SELECT COALESCE(r.event_id, d.event_id) AS event_id,
       COALESCE(r.currency, d.currency) AS currency,
       r.orders_count AS revenue_orders,
       d.orders_count AS daily_orders,
       r.net_cents    AS revenue_net,
       d.net_cents    AS daily_net
FROM {{ ref('q1_revenue_by_event') }} r
FULL OUTER JOIN daily d
  ON d.event_id = r.event_id AND d.currency = r.currency
WHERE r.event_id IS NULL
   OR d.event_id IS NULL
   OR r.orders_count <> d.orders_count
   OR r.gross_cents  <> d.gross_cents
   OR r.net_cents    <> d.net_cents
