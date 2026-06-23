-- Every hold ends up in exactly one of the four outcomes. If the counts do not
-- add up, holds are either being double-counted or disappearing.
SELECT event_id, holds_created,
       holds_converted + holds_expired + holds_released + holds_active AS accounted_for
FROM {{ ref('q3_hold_funnel_by_event') }}
WHERE holds_converted + holds_expired + holds_released + holds_active <> holds_created
   OR ROUND(holds_converted::numeric * 10000 / holds_created) <> conversion_bps
