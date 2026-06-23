package com.ticketforge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ticketforge.api.Dtos;
import com.ticketforge.config.AppProperties;
import com.ticketforge.config.Iso;
import com.ticketforge.config.Money;
import com.ticketforge.error.AppException;
import com.ticketforge.error.ErrorCode;
import com.ticketforge.security.AuthUser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Events, seats, holds, orders and revenue — the domain behind {@code contract/openapi.yaml}.
 *
 * <h2>Concurrency strategy</h2>
 *
 * Postgres row locks are the single authority for seat exclusivity. A Redis SET-NX
 * advisory lock would only ever be a best-effort fast-fail that has to degrade without
 * Redis anyway, so this service has none:
 *
 * <ol>
 *   <li>open a transaction;
 *   <li>{@code SELECT ... FROM seats WHERE id IN (...) ORDER BY id FOR UPDATE} — the
 *       deterministic {@code ORDER BY id} is what prevents deadlocks between two buyers
 *       requesting overlapping seat sets in different orders;
 *   <li>re-check each seat's status under the lock, then mark it {@code held};
 *   <li>commit. A loser blocks on the lock, then sees {@code held} and gets 409.
 * </ol>
 *
 * The same ordered-{@code FOR UPDATE} pattern guards hold→order conversion, so overselling
 * is impossible without Redis.
 */
@Service
public class TicketForgeService {

  private static final Set<String> SECTIONS = Set.of("A", "B", "C", "D");
  private static final Set<String> SEAT_STATUSES = Set.of("available", "held", "sold");

  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final AppProperties props;
  private final ObjectMapper mapper;
  private final HoldExpiryService holdExpiry;

  public TicketForgeService(
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      AppProperties props,
      ObjectMapper mapper,
      HoldExpiryService holdExpiry) {
    this.jdbc = jdbc;
    this.named = named;
    this.props = props;
    this.mapper = mapper;
    this.holdExpiry = holdExpiry;
  }

  // ---------------------------------------------------------------- events

  public Dtos.PageDto<Dtos.EventDto> listEvents(int page, int pageSize, String status) {
    List<Object> params = new ArrayList<>();
    String where;
    if (status != null && !status.isBlank()) {
      where = "WHERE status = ?::event_status";
      params.add(status);
    } else {
      where = "WHERE status = 'published'";
    }

    Long total =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM events " + where, Long.class, params.toArray());

    List<Object> pageParams = new ArrayList<>(params);
    pageParams.add(pageSize);
    pageParams.add((long) page * pageSize);
    List<Dtos.EventDto> data =
        jdbc.query(
            """
            SELECT e.id, e.organizer_id, e.title, e.description, e.venue, e.starts_at,
                   e.currency, e.base_price_cents, e.status::text AS status,
                   (SELECT COUNT(*) FROM seats s WHERE s.event_id = e.id) AS seat_count
            FROM events e
            """
                + where
                + " ORDER BY e.starts_at ASC LIMIT ? OFFSET ?",
            (rs, i) ->
                new Dtos.EventDto(
                    rs.getString("id"),
                    rs.getString("organizer_id"),
                    rs.getString("title"),
                    rs.getString("description"),
                    rs.getString("venue"),
                    Iso.format(rs.getObject("starts_at", OffsetDateTime.class)),
                    rs.getString("currency"),
                    rs.getLong("base_price_cents"),
                    rs.getString("status"),
                    rs.getLong("seat_count")),
            pageParams.toArray());

    return new Dtos.PageDto<>(data, page, pageSize, total == null ? 0 : total);
  }

  public Dtos.EventDto getEvent(String eventId) {
    List<Dtos.EventDto> rows =
        jdbc.query(
            """
            SELECT e.id, e.organizer_id, e.title, e.description, e.venue, e.starts_at,
                   e.currency, e.base_price_cents, e.status::text AS status,
                   (SELECT COUNT(*) FROM seats s WHERE s.event_id = e.id) AS seat_count
            FROM events e WHERE e.id = ?
            """,
            (rs, i) ->
                new Dtos.EventDto(
                    rs.getString("id"),
                    rs.getString("organizer_id"),
                    rs.getString("title"),
                    rs.getString("description"),
                    rs.getString("venue"),
                    Iso.format(rs.getObject("starts_at", OffsetDateTime.class)),
                    rs.getString("currency"),
                    rs.getLong("base_price_cents"),
                    rs.getString("status"),
                    rs.getLong("seat_count")),
            eventId);
    if (rows.isEmpty()) {
      throw new AppException(ErrorCode.EVENT_NOT_FOUND, "Event not found");
    }
    return rows.get(0);
  }

  // ----------------------------------------------------------------- seats

  public Dtos.PageDto<Dtos.SeatDto> listSeats(
      String eventId, int page, int pageSize, String section, String availability) {
    getEvent(eventId); // 404 EVENT_NOT_FOUND before any filter work

    // Enum-valued filters are validated against an allowlist, never interpolated — this is
    // why `?section=A' OR '1'='1` is a clean 400 and not a 500 or an injection.
    if (section != null && !section.isBlank() && !SECTIONS.contains(section)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, "Invalid section filter");
    }
    if (availability != null && !availability.isBlank() && !SEAT_STATUSES.contains(availability)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, "Invalid availability filter");
    }

    List<Object> params = new ArrayList<>();
    StringBuilder where = new StringBuilder("WHERE event_id = ?");
    params.add(eventId);
    if (section != null && !section.isBlank()) {
      where.append(" AND section = ?::seat_section");
      params.add(section);
    }
    if (availability != null && !availability.isBlank()) {
      where.append(" AND status = ?::seat_status");
      params.add(availability);
    }

    Long total =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM seats " + where, Long.class, params.toArray());

    List<Object> pageParams = new ArrayList<>(params);
    pageParams.add(pageSize);
    pageParams.add((long) (page - 1) * pageSize);
    List<Dtos.SeatDto> data =
        jdbc.query(
            """
            SELECT id, event_id, section::text AS section, row_label, number,
                   status::text AS status, price_cents
            FROM seats
            """
                + where
                + " ORDER BY section, row_label, number LIMIT ? OFFSET ?",
            (rs, i) ->
                new Dtos.SeatDto(
                    rs.getString("id"),
                    rs.getString("event_id"),
                    rs.getString("section"),
                    rs.getString("row_label"),
                    rs.getInt("number"),
                    rs.getString("status"),
                    rs.getLong("price_cents")),
            pageParams.toArray());

    return new Dtos.PageDto<>(data, page, pageSize, total == null ? 0 : total);
  }

  // ----------------------------------------------------------------- holds

  @Transactional
  public Dtos.HoldDto createHold(AuthUser user, String eventId, List<String> seatIds) {
    if (seatIds == null || seatIds.isEmpty()) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, "seat_ids required");
    }
    // Deduplicate and sort: the sorted order is the deadlock-avoidance lock order.
    List<String> unique = new ArrayList<>(new TreeSet<>(seatIds));

    getEvent(eventId);

    List<Map<String, Object>> seats =
        named.queryForList(
            """
            SELECT id, event_id, status::text AS status, price_cents
            FROM seats
            WHERE id IN (:ids)
            ORDER BY id
            FOR UPDATE
            """,
            new MapSqlParameterSource("ids", unique));

    if (seats.size() != unique.size()) {
      throw new AppException(ErrorCode.SEAT_NOT_FOUND, "One or more seats not found");
    }

    for (Map<String, Object> seat : seats) {
      String seatId = (String) seat.get("id");
      if (!eventId.equals(seat.get("event_id"))) {
        throw AppException.of(
            ErrorCode.VALIDATION_ERROR, "Seat does not belong to event", "seat_id", seatId);
      }
      String status = (String) seat.get("status");
      if ("held".equals(status)) {
        throw AppException.of(
            ErrorCode.SEAT_ALREADY_HELD, "Seat is currently held", "seat_id", seatId);
      }
      if ("sold".equals(status)) {
        throw AppException.of(ErrorCode.SEAT_NOT_AVAILABLE, "Seat is sold", "seat_id", seatId);
      }
    }

    String holdId = "hold_" + shortId();
    Instant now = Instant.now();
    Instant expires = now.plusSeconds(props.getHoldTtlSeconds());

    jdbc.update(
        """
        INSERT INTO holds (id, event_id, buyer_id, status, expires_at, created_at)
        VALUES (?,?,?,'active',?,?)
        """,
        holdId,
        eventId,
        user.id(),
        OffsetDateTime.ofInstant(expires, java.time.ZoneOffset.UTC),
        OffsetDateTime.ofInstant(now, java.time.ZoneOffset.UTC));

    for (String seatId : unique) {
      jdbc.update("INSERT INTO hold_seats (hold_id, seat_id) VALUES (?,?)", holdId, seatId);
      jdbc.update(
          "UPDATE seats SET status = 'held', hold_id = ?, version = version + 1 WHERE id = ?",
          holdId,
          seatId);
    }

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("event_type", "hold.created");
    payload.put("hold_id", holdId);
    payload.put("event_id", eventId);
    payload.put("buyer_id", user.id());
    payload.put("seat_ids", unique);
    payload.put("expires_at", Iso.format(expires));
    payload.put("occurred_at", Iso.format(now));
    jdbc.update(
        "INSERT INTO outbox_events (event_type, payload) VALUES ('hold.created', ?::jsonb)",
        toJson(payload));

    return new Dtos.HoldDto(
        holdId,
        eventId,
        user.id(),
        unique,
        "active",
        Iso.format(expires),
        Iso.format(now));
  }

  public Dtos.HoldDto getHold(AuthUser user, String holdId) {
    Dtos.HoldDto hold = fetchHold(holdId);
    if (!user.isAdmin() && !hold.buyer_id().equals(user.id())) {
      throw new AppException(ErrorCode.INSUFFICIENT_PERMISSION, "Not your hold");
    }
    if ("active".equals(hold.status()) && !Instant.parse(hold.expires_at()).isAfter(Instant.now())) {
      holdExpiry.expireHold(holdId);
      throw new AppException(ErrorCode.HOLD_EXPIRED, "Hold has expired");
    }
    return hold;
  }

  @Transactional
  public void releaseHold(AuthUser user, String holdId) {
    Dtos.HoldDto hold = fetchHold(holdId);
    if (!user.isAdmin() && !hold.buyer_id().equals(user.id())) {
      throw new AppException(ErrorCode.INSUFFICIENT_PERMISSION, "Not your hold");
    }
    if ("expired".equals(hold.status()) || "released".equals(hold.status())) {
      throw new AppException(ErrorCode.HOLD_EXPIRED, "Hold has expired");
    }
    if ("converted".equals(hold.status())) {
      throw new AppException(ErrorCode.HOLD_ALREADY_CONVERTED, "Hold already converted");
    }

    jdbc.update("UPDATE holds SET status = 'released' WHERE id = ?", holdId);
    jdbc.update(
        """
        UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
        WHERE hold_id = ?
        """,
        holdId);
    jdbc.update("DELETE FROM hold_seats WHERE hold_id = ?", holdId);
  }

  private Dtos.HoldDto fetchHold(String holdId) {
    List<Dtos.HoldDto> rows =
        jdbc.query(
            """
            SELECT id, event_id, buyer_id, status::text AS status, expires_at, created_at
            FROM holds WHERE id = ?
            """,
            (rs, i) ->
                new Dtos.HoldDto(
                    rs.getString("id"),
                    rs.getString("event_id"),
                    rs.getString("buyer_id"),
                    List.of(),
                    rs.getString("status"),
                    Iso.format(rs.getObject("expires_at", OffsetDateTime.class)),
                    Iso.format(rs.getObject("created_at", OffsetDateTime.class))),
            holdId);
    if (rows.isEmpty()) {
      throw new AppException(ErrorCode.HOLD_NOT_FOUND, "Hold not found");
    }
    Dtos.HoldDto base = rows.get(0);
    List<String> seatIds =
        jdbc.queryForList(
            "SELECT seat_id FROM hold_seats WHERE hold_id = ? ORDER BY seat_id",
            String.class,
            holdId);
    return new Dtos.HoldDto(
        base.id(),
        base.event_id(),
        base.buyer_id(),
        seatIds,
        base.status(),
        base.expires_at(),
        base.created_at());
  }

  /** Ids of active holds whose TTL has elapsed — polled by the background worker. */
  public List<String> findExpiredHoldIds(int limit) {
    return jdbc.queryForList(
        """
        SELECT id FROM holds
        WHERE status = 'active' AND expires_at <= NOW()
        ORDER BY expires_at
        LIMIT ?
        """,
        String.class,
        limit);
  }

  // ---------------------------------------------------------------- orders

  /** {@code replay=true} ⇒ the caller should answer 200 instead of 201. */
  public record OrderResult(Dtos.OrderDto order, boolean replay) {}

  @Transactional
  public OrderResult createOrder(AuthUser user, String idempotencyKey, Dtos.CreateOrderRequest body) {
    if (idempotencyKey == null || idempotencyKey.length() < 8) {
      throw new AppException(
          ErrorCode.IDEMPOTENCY_KEY_REQUIRED, "Idempotency-Key header required");
    }
    String requestHash = hashBody(body);

    // Lock the idempotency row so two concurrent replays cannot both create an order.
    List<Map<String, Object>> existing =
        jdbc.queryForList(
            """
            SELECT request_hash, order_id FROM idempotency_records
            WHERE buyer_id = ? AND idempotency_key = ? FOR UPDATE
            """,
            user.id(),
            idempotencyKey);
    if (!existing.isEmpty()) {
      String storedHash = (String) existing.get(0).get("request_hash");
      if (!requestHash.equals(storedHash)) {
        throw new AppException(
            ErrorCode.IDEMPOTENCY_KEY_CONFLICT, "Idempotency key reused with a different body");
      }
      return new OrderResult(fetchOrder((String) existing.get(0).get("order_id")), true);
    }

    String holdId = body == null ? null : body.hold_id();
    Dtos.HoldDto hold = fetchHold(holdId);
    if (!hold.buyer_id().equals(user.id()) && !user.isAdmin()) {
      throw new AppException(ErrorCode.INSUFFICIENT_PERMISSION, "Not your hold");
    }

    jdbc.queryForList("SELECT id FROM holds WHERE id = ? FOR UPDATE", holdId);

    List<Map<String, Object>> seatRows =
        hold.seat_ids().isEmpty()
            ? List.of()
            : named.queryForList(
                """
                SELECT id, price_cents, status::text AS status
                FROM seats WHERE id IN (:ids) ORDER BY id FOR UPDATE
                """,
                new MapSqlParameterSource("ids", hold.seat_ids()));

    long subtotal = 0L;
    for (Map<String, Object> seat : seatRows) {
      subtotal += ((Number) seat.get("price_cents")).longValue();
    }

    // TODO(FEAT-18): discount codes are not implemented yet. Checkout ignores
    // body.discount_code() entirely and every order is priced at full price.
    long discountCents = 0L;
    String discountCode = null;

    long afterDiscount = subtotal - discountCents;
    long feeCents = Money.feeCents(afterDiscount, props.getFeePercent(), props.getFeeFixedCents());
    long totalCents = Money.totalCents(subtotal, discountCents, feeCents);

    String currency =
        jdbc.queryForObject(
            "SELECT currency FROM events WHERE id = ?", String.class, hold.event_id());

    String orderId = "ord_" + shortId();
    Instant now = Instant.now();

    jdbc.update(
        """
        INSERT INTO orders
          (id, hold_id, buyer_id, event_id, subtotal_cents, fee_cents, discount_cents,
           total_cents, currency, discount_code, status, idempotency_key, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'paid',?,?)
        """,
        orderId,
        holdId,
        user.id(),
        hold.event_id(),
        subtotal,
        feeCents,
        discountCents,
        totalCents,
        currency,
        discountCode,
        idempotencyKey,
        OffsetDateTime.ofInstant(now, java.time.ZoneOffset.UTC));

    for (Map<String, Object> seat : seatRows) {
      String seatId = (String) seat.get("id");
      jdbc.update("INSERT INTO order_seats (order_id, seat_id) VALUES (?,?)", orderId, seatId);
      jdbc.update(
          "UPDATE seats SET status = 'sold', hold_id = NULL, version = version + 1 WHERE id = ?",
          seatId);
    }

    jdbc.update("UPDATE holds SET status = 'converted' WHERE id = ?", holdId);

    jdbc.update(
        """
        INSERT INTO idempotency_records (buyer_id, idempotency_key, request_hash, order_id)
        VALUES (?,?,?,?)
        """,
        user.id(),
        idempotencyKey,
        requestHash,
        orderId);

    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("event_type", "order.paid");
    payload.put("order_id", orderId);
    payload.put("hold_id", holdId);
    payload.put("event_id", hold.event_id());
    payload.put("buyer_id", user.id());
    payload.put("total_cents", totalCents);
    payload.put("currency", currency);
    payload.put("occurred_at", Iso.format(now));
    jdbc.update(
        "INSERT INTO outbox_events (event_type, payload) VALUES ('order.paid', ?::jsonb)",
        toJson(payload));

    return new OrderResult(fetchOrder(orderId), false);
  }

  private Dtos.OrderDto fetchOrder(String orderId) {
    List<Dtos.OrderDto> rows =
        jdbc.query(
            """
            SELECT id, hold_id, buyer_id, event_id, subtotal_cents, fee_cents, discount_cents,
                   total_cents, currency, discount_code, status::text AS status, created_at
            FROM orders WHERE id = ?
            """,
            (rs, i) ->
                new Dtos.OrderDto(
                    rs.getString("id"),
                    rs.getString("hold_id"),
                    rs.getString("buyer_id"),
                    rs.getString("event_id"),
                    List.of(),
                    rs.getLong("subtotal_cents"),
                    rs.getLong("fee_cents"),
                    rs.getLong("discount_cents"),
                    rs.getLong("total_cents"),
                    rs.getString("currency"),
                    rs.getString("discount_code"),
                    rs.getString("status"),
                    Iso.format(rs.getObject("created_at", OffsetDateTime.class))),
            orderId);
    if (rows.isEmpty()) {
      throw new AppException(ErrorCode.ORDER_NOT_FOUND, "Order not found");
    }
    Dtos.OrderDto o = rows.get(0);
    List<String> seatIds =
        jdbc.queryForList(
            "SELECT seat_id FROM order_seats WHERE order_id = ? ORDER BY seat_id",
            String.class,
            orderId);
    return new Dtos.OrderDto(
        o.id(),
        o.hold_id(),
        o.buyer_id(),
        o.event_id(),
        seatIds,
        o.subtotal_cents(),
        o.fee_cents(),
        o.discount_cents(),
        o.total_cents(),
        o.currency(),
        o.discount_code(),
        o.status(),
        o.created_at());
  }

  /** Owner, the event's organizer, or an admin. Anything else is 403 (no 404 leak either way). */
  public Dtos.OrderDto getOrder(AuthUser user, String orderId) {
    Dtos.OrderDto order = fetchOrder(orderId);
    if (user.isAdmin() || order.buyer_id().equals(user.id())) {
      return order;
    }
    if (user.isOrganizer()) {
      List<String> organizerIds =
          jdbc.queryForList(
              "SELECT organizer_id FROM events WHERE id = ?", String.class, order.event_id());
      if (!organizerIds.isEmpty() && organizerIds.get(0).equals(user.id())) {
        return order;
      }
    }
    throw new AppException(ErrorCode.INSUFFICIENT_PERMISSION, "Not allowed to view this order");
  }

  // --------------------------------------------------------------- reports

  public Dtos.RevenueReport revenueReport(AuthUser user, String eventId, String from, String to) {
    if (!user.isOrganizer() && !user.isAdmin()) {
      throw new AppException(ErrorCode.INSUFFICIENT_PERMISSION, "Organizer role required");
    }

    List<Object> params = new ArrayList<>();
    List<String> clauses = new ArrayList<>();
    clauses.add("o.status = 'paid'");

    // An organizer only ever sees their own events; admins see everything.
    if (user.isOrganizer()) {
      clauses.add("e.organizer_id = ?");
      params.add(user.id());
    }
    if (eventId != null && !eventId.isBlank()) {
      clauses.add("o.event_id = ?");
      params.add(eventId);
    }
    if (from != null && !from.isBlank()) {
      clauses.add("o.created_at >= ?");
      params.add(parseTimestamp(from, "from"));
    }
    if (to != null && !to.isBlank()) {
      clauses.add("o.created_at <= ?");
      params.add(parseTimestamp(to, "to"));
    }

    List<Map<String, Object>> rows =
        jdbc.queryForList(
            """
            SELECT o.event_id,
                   COUNT(*) AS order_count,
                   COALESCE(SUM(o.subtotal_cents),0) AS gross_cents,
                   COALESCE(SUM(o.fee_cents),0) AS fees_cents,
                   COALESCE(SUM(o.discount_cents),0) AS discounts_cents,
                   COALESCE(SUM(o.total_cents),0) AS net_cents,
                   MIN(e.currency) AS currency
            FROM orders o
            JOIN events e ON e.id = o.event_id
            """
                + " WHERE "
                + String.join(" AND ", clauses)
                + " GROUP BY o.event_id ORDER BY o.event_id",
            params.toArray());

    List<Dtos.RevenueByEvent> byEvent = new ArrayList<>();
    long gross = 0L;
    long fees = 0L;
    long discounts = 0L;
    long net = 0L;
    for (Map<String, Object> r : rows) {
      long g = num(r.get("gross_cents"));
      long n = num(r.get("net_cents"));
      byEvent.add(
          new Dtos.RevenueByEvent(
              (String) r.get("event_id"), num(r.get("order_count")), g, n));
      gross += g;
      net += n;
      fees += num(r.get("fees_cents"));
      discounts += num(r.get("discounts_cents"));
    }

    String currency = rows.isEmpty() ? "USD" : String.valueOf(rows.get(0).get("currency"));
    return new Dtos.RevenueReport(currency, gross, fees, discounts, net, byEvent);
  }

  // --------------------------------------------------------------- helpers

  private static long num(Object value) {
    return value == null ? 0L : ((Number) value).longValue();
  }

  private OffsetDateTime parseTimestamp(String raw, String field) {
    try {
      return OffsetDateTime.parse(raw);
    } catch (DateTimeParseException e) {
      try {
        return Instant.parse(raw).atOffset(java.time.ZoneOffset.UTC);
      } catch (DateTimeParseException e2) {
        throw AppException.of(
            ErrorCode.VALIDATION_ERROR, "Invalid timestamp for '" + field + "'", field, raw);
      }
    }
  }

  private static String shortId() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
  }

  /**
   * sha256 over the canonical body — {@code {"hold_id":"…"}} plus {@code "discount_code"}
   * only when one was supplied, i.e. {@code sha256(JSON.stringify(body))} of the request
   * body, so a replay with the same body matches and a
   * mutated body yields {@code IDEMPOTENCY_KEY_CONFLICT}.
   */
  private String hashBody(Dtos.CreateOrderRequest body) {
    Map<String, Object> canonical = new LinkedHashMap<>();
    canonical.put("hold_id", body == null ? null : body.hold_id());
    if (body != null && body.discount_code() != null) {
      canonical.put("discount_code", body.discount_code());
    }
    byte[] digest =
        sha256(toJson(canonical).getBytes(StandardCharsets.UTF_8));
    return HexFormat.of().formatHex(digest);
  }

  private static byte[] sha256(byte[] input) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(input);
    } catch (Exception e) {
      throw new IllegalStateException("SHA-256 unavailable", e);
    }
  }

  private String toJson(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException("Cannot serialise JSON", e);
    }
  }
}
