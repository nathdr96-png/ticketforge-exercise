{{ config(materialized='view') }}

-- Ordering is NOT in this model. A dbt relation is a table or a view and
-- has no inherent row order; the contract's ORDER BY is applied when the
-- relation is exported, by tools/export.py reading it from
-- contract/analytics/questions.yaml, which orders this one by:
--   ORDER BY r.currency ASC, r.rank ASC

-- q5_top_buyers_by_currency — Top buyers, per currency
--
-- Contract: contract/analytics/questions.yaml, question q5_top_buyers_by_currency.
--
-- Ranking is PARTITIONed by currency. A EUR buyer and a USD buyer are not
-- comparable, and a single global ranking would have to add euros to dollars to
-- produce one.
--
-- Seat counts are aggregated per order before the buyer rollup, for the same
-- reason as q1: joining order_seats to orders would multiply net_cents by the
-- seat count and quietly reorder the leaderboard.
--
-- Paid orders only, so a buyer whose only order was refunded does not appear.
-- Ties break on buyer_id so the ranking is deterministic.

WITH paid_orders AS (
  SELECT o.id, o.buyer_id, o.currency, o.total_cents
  FROM {{ source('ticketforge', 'orders') }} o
  WHERE o.status = 'paid'
),
seats_per_order AS (
  SELECT os.order_id, COUNT(*) AS seats
  FROM {{ source('ticketforge', 'order_seats') }} os
  WHERE os.order_id IN (SELECT id FROM paid_orders)
  GROUP BY os.order_id
),
per_buyer AS (
  SELECT p.currency,
         p.buyer_id,
         COUNT(*)                       AS orders_count,
         COALESCE(SUM(spo.seats), 0)    AS seats_purchased,
         SUM(p.total_cents)             AS net_cents
  FROM paid_orders p
  LEFT JOIN seats_per_order spo ON spo.order_id = p.id
  GROUP BY p.currency, p.buyer_id
),
ranked AS (
  SELECT b.*,
         ROW_NUMBER() OVER (
           PARTITION BY b.currency
           ORDER BY b.net_cents DESC, b.buyer_id ASC
         ) AS rank
  FROM per_buyer b
)
SELECT r.currency                 AS currency,
       r.rank::bigint             AS rank,
       r.buyer_id                 AS buyer_id,
       u.email                    AS email,
       r.orders_count::bigint     AS orders_count,
       r.seats_purchased::bigint  AS seats_purchased,
       r.net_cents::bigint        AS net_cents
FROM ranked r
JOIN {{ source('ticketforge', 'users') }} u ON u.id = r.buyer_id
WHERE r.rank <= 3
