-- q3_hold_funnel_by_event — Hold-to-order funnel by event
--
-- Contract: contract/analytics/questions.yaml, question q3_hold_funnel_by_event.
--
-- Counted from `holds` joined to the seats each hold covers, so the funnel
-- reflects seat-level demand.
--
-- `holds.status` is authoritative. Re-deriving the outcome from expires_at
-- against NOW() would make the answer depend on when the report ran.
--
-- Nothing here touches orders or money: a held seat is not a sold seat.

SELECT h.event_id                                                  AS event_id,
       COUNT(*)::bigint                                             AS holds_created,
       (COUNT(*) FILTER (WHERE h.status = 'converted'))::bigint      AS holds_converted,
       (COUNT(*) FILTER (WHERE h.status = 'expired'))::bigint        AS holds_expired,
       (COUNT(*) FILTER (WHERE h.status = 'released'))::bigint       AS holds_released,
       (COUNT(*) FILTER (WHERE h.status = 'active'))::bigint         AS holds_active,
       -- Basis points, rounded half-up. numeric ROUND, not integer division:
       -- 7 of 13 holds is 5385 bps, and truncating would say 5384.
       ROUND(
         (COUNT(*) FILTER (WHERE h.status = 'converted'))::numeric * 10000
         / COUNT(*)
       )::bigint                                                    AS conversion_bps
FROM holds h
JOIN hold_seats hs ON hs.hold_id = h.id
GROUP BY h.event_id
ORDER BY h.event_id ASC;
