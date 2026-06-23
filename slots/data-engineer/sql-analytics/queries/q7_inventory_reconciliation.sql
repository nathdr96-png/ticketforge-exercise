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
  FROM events e
  LEFT JOIN seats s ON s.event_id = e.id
  GROUP BY e.id
),
paid_seats AS (
  SELECT o.event_id                       AS event_id,
         COUNT(DISTINCT os.seat_id)       AS seats_in_paid_orders
  FROM orders o
  JOIN order_seats os ON os.order_id = o.id
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
FROM events e
JOIN seat_rollup r ON r.event_id = e.id
LEFT JOIN paid_seats p ON p.event_id = e.id
ORDER BY e.id ASC;
