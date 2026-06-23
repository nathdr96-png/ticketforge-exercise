{{ config(materialized='view') }}

-- Ordering is NOT in this model. A dbt relation is a table or a view and
-- has no inherent row order; the contract's ORDER BY is applied when the
-- relation is exported, by tools/export.py reading it from
-- contract/analytics/questions.yaml, which orders this one by:
--   ORDER BY p.currency ASC, p.event_id ASC

-- q8_order_value_distribution — Order value distribution by event
--
-- Contract: contract/analytics/questions.yaml, question q8_order_value_distribution.
--
-- The divisor is the number of ORDERS. Joining order_seats before the average
-- would divide by the number of seat lines instead, turning "average order
-- value" into something close to "average seat price" — a number that is wrong
-- and reads as reasonable.
--
-- Averages are rounded half-up at the last step, in numeric. Integer division
-- would truncate: 68482 over 6 orders is 11414, not 11413.

WITH paid_orders AS (
  SELECT o.id, o.event_id, o.currency, o.total_cents
  FROM {{ source('ticketforge', 'orders') }} o
  WHERE o.status = 'paid'
),
seats_per_order AS (
  SELECT os.order_id, COUNT(*) AS seats
  FROM {{ source('ticketforge', 'order_seats') }} os
  WHERE os.order_id IN (SELECT id FROM paid_orders)
  GROUP BY os.order_id
)
SELECT p.event_id                                       AS event_id,
       p.currency                                       AS currency,
       COUNT(*)::bigint                                  AS orders_count,
       COALESCE(SUM(spo.seats), 0)::bigint               AS seats_sold,
       MIN(p.total_cents)::bigint                        AS min_net_cents,
       MAX(p.total_cents)::bigint                        AS max_net_cents,
       ROUND(SUM(p.total_cents)::numeric / COUNT(*))::bigint
                                                        AS avg_net_cents,
       ROUND(COALESCE(SUM(spo.seats), 0)::numeric * 10000 / COUNT(*))::bigint
                                                        AS avg_seats_per_order_bps
FROM paid_orders p
LEFT JOIN seats_per_order spo ON spo.order_id = p.id
GROUP BY p.event_id, p.currency
