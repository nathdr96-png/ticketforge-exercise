-- q2_daily_sales_utc — Daily sales by event, in UTC
--
-- Contract: contract/analytics/questions.yaml, question q2_daily_sales_utc.
--
-- `created_at` is timestamptz. Casting it straight to ::date would bucket it in
-- whatever the session's TimeZone happens to be, which is not guaranteed to be
-- UTC and is not the same for the reporting job and the person checking it. The
-- AT TIME ZONE 'UTC' is the whole point of the query, not decoration: two orders
-- in the fixture sit at 00:30Z and 02:15Z, and any Americas timezone moves them
-- to the previous day.
--
-- Only days on which an event actually took money appear. No gap filling.

SELECT (o.created_at AT TIME ZONE 'UTC')::date AS sales_day,
       o.event_id                              AS event_id,
       o.currency                              AS currency,
       COUNT(*)::bigint                         AS orders_count,
       SUM(o.subtotal_cents)::bigint            AS gross_cents,
       SUM(o.total_cents)::bigint               AS net_cents
FROM orders o
WHERE o.status = 'paid'
GROUP BY (o.created_at AT TIME ZONE 'UTC')::date, o.event_id, o.currency
ORDER BY sales_day ASC, event_id ASC;
