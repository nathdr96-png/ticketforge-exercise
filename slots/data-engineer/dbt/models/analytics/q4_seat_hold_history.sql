{{ config(materialized='view') }}

-- Ordering is NOT in this model. A dbt relation is a table or a view and
-- has no inherent row order; the contract's ORDER BY is applied when the
-- relation is exported, by tools/export.py reading it from
-- contract/analytics/questions.yaml, which orders this one by:
--   ORDER BY event_id ASC

-- q4_seat_hold_history — Seat-level hold history from the event log
--
-- Contract: contract/analytics/questions.yaml, question q4_seat_hold_history.
--
-- `hold_seats` cannot answer this. Its rows are DELETED when a hold expires or
-- is released, so by the time anyone asks, current state has forgotten the
-- majority of the hold history. The surviving record is `outbox_events`:
-- hold.created and hold.expired both carry a `seat_ids` JSON array.
--
-- Two deliberate consequences, both in the contract:
--   * released holds emit no outbox event, so they cannot appear here at all;
--   * published_at is a delivery detail of the publisher and is NULL for the
--     newest rows. Filtering on it would silently drop live holds.

WITH created AS (
  SELECT oe.payload ->> 'event_id'                            AS event_id,
         oe.payload ->> 'hold_id'                             AS hold_id,
         jsonb_array_elements_text(oe.payload -> 'seat_ids')  AS seat_id
  FROM {{ source('ticketforge', 'outbox_events') }} oe
  WHERE oe.event_type = 'hold.created'
),
expired AS (
  SELECT oe.payload ->> 'event_id'                            AS event_id,
         jsonb_array_elements_text(oe.payload -> 'seat_ids')  AS seat_id
  FROM {{ source('ticketforge', 'outbox_events') }} oe
  WHERE oe.event_type = 'hold.expired'
),
-- Every seat that ever reached an order, refunded ones included: a seat that
-- expired out of one hold and was sold later did get as far as an order.
ordered_seats AS (
  SELECT DISTINCT os.seat_id
  FROM {{ source('ticketforge', 'order_seats') }} os
),
expired_never_ordered AS (
  SELECT x.event_id,
         COUNT(DISTINCT x.seat_id) AS seats
  FROM expired x
  WHERE NOT EXISTS (
    SELECT 1 FROM ordered_seats o WHERE o.seat_id = x.seat_id
  )
  GROUP BY x.event_id
)
SELECT c.event_id                                AS event_id,
       COUNT(DISTINCT c.hold_id)::bigint          AS holds_observed,
       COUNT(*)::bigint                           AS seat_hold_pairs,
       COUNT(DISTINCT c.seat_id)::bigint          AS seats_ever_held,
       COALESCE(eno.seats, 0)::bigint             AS seats_expired_never_ordered
FROM created c
LEFT JOIN expired_never_ordered eno ON eno.event_id = c.event_id
GROUP BY c.event_id, eno.seats
