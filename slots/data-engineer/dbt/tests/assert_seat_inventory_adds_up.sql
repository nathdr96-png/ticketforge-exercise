-- Seat statuses partition the seat map, and the discrepancy is never negative:
-- no more seats can be in paid orders than the seat map calls sold.
SELECT event_id, seats_total, seats_available, seats_held, seats_sold_status,
       seats_in_paid_orders, unreconciled_seats
FROM {{ ref('q7_inventory_reconciliation') }}
WHERE seats_available + seats_held + seats_sold_status <> seats_total
   OR unreconciled_seats <> seats_sold_status - seats_in_paid_orders
   OR unreconciled_seats < 0
