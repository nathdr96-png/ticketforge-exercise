-- The contract's grain for q1 is one row per (event, currency). A duplicate means
-- the group-by lost a key, which is how a report starts double-reporting an event.
SELECT event_id, currency, COUNT(*) AS rows
FROM {{ ref('q1_revenue_by_event') }}
GROUP BY event_id, currency
HAVING COUNT(*) > 1
