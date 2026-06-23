-- q1_revenue_by_event — Revenue by event
--
-- Contract: contract/analytics/questions.yaml, question q1_revenue_by_event.
--
-- Paid orders only. Every event with at least one paid order appears, whatever
-- the event's own status: `event_cancelled` sold GBP tickets before it was
-- cancelled and that money was really collected.
--
-- The seat count is aggregated in its own CTE and joined back one-row-per-order.
-- Joining order_seats directly would repeat each order once per seat and
-- multiply every money column by the seat count — a four-seat order would
-- report four times its revenue, and the report would still look plausible.

WITH paid_orders AS (
  SELECT o.id,
         o.event_id,
         o.currency,
         o.subtotal_cents,
         o.discount_cents,
         o.fee_cents,
         o.total_cents
  FROM orders o
  WHERE o.status = 'paid'
),
seats_per_order AS (
  SELECT os.order_id,
         COUNT(*) AS seats
  FROM order_seats os
  WHERE os.order_id IN (SELECT id FROM paid_orders)
  GROUP BY os.order_id
)
SELECT e.id                                     AS event_id,
       e.organizer_id                           AS organizer_id,
       p.currency                               AS currency,
       COUNT(*)::bigint                          AS orders_count,
       COALESCE(SUM(spo.seats), 0)::bigint       AS seats_sold,
       SUM(p.subtotal_cents)::bigint             AS gross_cents,
       SUM(p.discount_cents)::bigint             AS discounts_cents,
       SUM(p.fee_cents)::bigint                  AS fees_cents,
       SUM(p.total_cents)::bigint                AS net_cents
FROM paid_orders p
JOIN events e ON e.id = p.event_id
LEFT JOIN seats_per_order spo ON spo.order_id = p.id
GROUP BY e.id, e.organizer_id, p.currency
ORDER BY p.currency ASC, SUM(p.total_cents) DESC, e.id ASC;
