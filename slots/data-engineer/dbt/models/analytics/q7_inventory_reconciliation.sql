{{ config(materialized='view') }}

-- Ordering is NOT in this model. A dbt relation is a table or a view and
-- has no inherent row order; the contract's ORDER BY is applied when the
-- relation is exported, by tools/export.py reading it from
-- contract/analytics/questions.yaml, which orders this one by:
--   ORDER BY e.id ASC

-- q7_inventory_reconciliation — Seat inventory reconciliation
--
-- Contract: contract/analytics/questions.yaml, question q7_inventory_reconciliation.
--
-- EVERY event appears, including event_draft (no activity whatsoever) and
-- event_cancelled. Those rows are zeros, not absences — an event that silently
-- vanished from a reconciliation report is the one nobody checks.
--
-- The discrepancy this report exists to surface: there is no refund path that
-- returns a seat to the pool, so a refunded order's seats stay `sold` in the
-- seat map while belonging to no paid order. seats_in_paid_orders counts
-- DISTINCT seats, because a seat refunded and then resold belongs to two orders.

WITH seat_rollup AS (
  SELECT e.id                                                  AS event_id,
         COUNT(s.id)                                           AS seats_total,
         COUNT(s.id) FILTER (WHERE s.status = 'available')      AS seats_available,
         COUNT(s.id) FILTER (WHERE s.status = 'held')           AS seats_held,
         COUNT(s.id) FILTER (WHERE s.status = 'sold')           AS seats_sold_status
  FROM {{ source('ticketforge', 'events') }} e
  LEFT JOIN {{ source('ticketforge', 'seats') }} s ON s.event_id = e.id
  GROUP BY e.id
),
paid_seats AS (
  SELECT o.event_id                       AS event_id,
         COUNT(DISTINCT os.seat_id)       AS seats_in_paid_orders
  FROM {{ source('ticketforge', 'orders') }} o
  JOIN {{ source('ticketforge', 'order_seats') }} os ON os.order_id = o.id
  WHERE o.status = 'paid'
  GROUP BY o.event_id
)
SELECT e.id                                                     AS event_id,
       e.status::text                                           AS event_status,
       e.currency                                               AS currency,
       r.seats_total::bigint                                    AS seats_total,
       r.seats_available::bigint                                AS seats_available,
       r.seats_held::bigint                                     AS seats_held,
       r.seats_sold_status::bigint                              AS seats_sold_status,
       COALESCE(p.seats_in_paid_orders, 0)::bigint              AS seats_in_paid_orders,
       (r.seats_sold_status - COALESCE(p.seats_in_paid_orders, 0))::bigint
                                                                AS unreconciled_seats
FROM {{ source('ticketforge', 'events') }} e
JOIN seat_rollup r ON r.event_id = e.id
LEFT JOIN paid_seats p ON p.event_id = e.id
