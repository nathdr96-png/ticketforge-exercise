package com.ticketforge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ticketforge.config.Iso;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Expiring a hold releases its seats. Lives in its own bean so that
 * {@link Propagation#REQUIRES_NEW} is honoured when it is called from inside another
 * transaction that is about to roll back (e.g. {@code POST /orders} on an expired hold) —
 * the release must survive even though the caller's transaction does not.
 */
@Service
public class HoldExpiryService {

  private static final Logger log = LoggerFactory.getLogger(HoldExpiryService.class);

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  public HoldExpiryService(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void expireHold(String holdId) {
    // Lock the hold row first so two workers (or a worker and a request) cannot both expire it.
    List<Map<String, Object>> holds =
        jdbc.queryForList(
            "SELECT id, event_id, buyer_id, status::text AS status FROM holds WHERE id = ? FOR UPDATE",
            holdId);
    if (holds.isEmpty() || !"active".equals(holds.get(0).get("status"))) {
      return;
    }
    Map<String, Object> hold = holds.get(0);

    List<String> seatIds =
        jdbc.queryForList(
            "SELECT seat_id FROM hold_seats WHERE hold_id = ? ORDER BY seat_id",
            String.class,
            holdId);

    jdbc.update("UPDATE holds SET status = 'expired' WHERE id = ?", holdId);
    jdbc.update(
        """
        UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
        WHERE hold_id = ? AND status = 'held'
        """,
        holdId);
    jdbc.update("DELETE FROM hold_seats WHERE hold_id = ?", holdId);

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("event_type", "hold.expired");
    payload.put("hold_id", holdId);
    payload.put("event_id", hold.get("event_id"));
    payload.put("buyer_id", hold.get("buyer_id"));
    payload.put("seat_ids", seatIds);
    payload.put("occurred_at", Iso.format(Instant.now()));
    jdbc.update(
        "INSERT INTO outbox_events (event_type, payload) VALUES ('hold.expired', ?::jsonb)",
        toJson(payload));

    log.debug("Expired hold {} releasing {} seat(s)", holdId, seatIds.size());
  }

  private String toJson(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException("Cannot serialise outbox payload", e);
    }
  }
}
