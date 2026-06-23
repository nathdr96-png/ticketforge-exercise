-- An average order value must sit inside the observed range and must reconstruct
-- the collected total to within half a cent per order. Divide by order_seats rows
-- instead of orders and it lands below the minimum.
SELECT d.event_id, d.currency, d.orders_count, d.min_net_cents, d.max_net_cents,
       d.avg_net_cents, r.net_cents
FROM {{ ref('q8_order_value_distribution') }} d
JOIN {{ ref('q1_revenue_by_event') }} r
  ON r.event_id = d.event_id AND r.currency = d.currency
WHERE d.avg_net_cents < d.min_net_cents
   OR d.avg_net_cents > d.max_net_cents
   OR d.orders_count <> r.orders_count
   OR d.seats_sold   <> r.seats_sold
   OR ABS(d.avg_net_cents * d.orders_count - r.net_cents) * 2 > d.orders_count
