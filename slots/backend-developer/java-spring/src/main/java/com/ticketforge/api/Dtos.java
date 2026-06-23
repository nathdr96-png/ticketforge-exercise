package com.ticketforge.api;

import java.util.List;
import java.util.Map;

/**
 * Wire shapes from {@code contract/openapi.yaml}. Field names are snake_case exactly as the
 * contract spells them; money is {@code long} cents; timestamps are pre-formatted UTC
 * ISO-8601 strings (see {@link com.ticketforge.config.Iso}) so no Jackson date policy can
 * turn them into epoch millis.
 */
public final class Dtos {

  private Dtos() {}

  public record UserDto(String id, String email, String role, String name) {}

  public record LoginRequest(String email, String password) {}

  public record LoginResponse(String token, Map<String, Object> user) {}

  public record EventDto(
      String id,
      String organizer_id,
      String title,
      String description,
      String venue,
      String starts_at,
      String currency,
      long base_price_cents,
      String status,
      long seat_count) {}

  public record SeatDto(
      String id,
      String event_id,
      String section,
      String row,
      int number,
      String status,
      long price_cents) {}

  /** Paginated envelope: {@code { data, page, page_size, total }}. */
  public record PageDto<T>(List<T> data, int page, int page_size, long total) {}

  public record CreateHoldRequest(String event_id, List<String> seat_ids) {}

  public record HoldDto(
      String id,
      String event_id,
      String buyer_id,
      List<String> seat_ids,
      String status,
      String expires_at,
      String created_at) {}

  public record CreateOrderRequest(String hold_id, String discount_code) {}

  public record OrderDto(
      String id,
      String hold_id,
      String buyer_id,
      String event_id,
      List<String> seat_ids,
      long subtotal_cents,
      long fee_cents,
      long discount_cents,
      long total_cents,
      String currency,
      String discount_code,
      String status,
      String created_at) {}

  public record RevenueByEvent(
      String event_id, long order_count, long gross_cents, long net_cents) {}

  public record RevenueReport(
      String currency,
      long gross_cents,
      long fees_cents,
      long discounts_cents,
      long net_cents,
      List<RevenueByEvent> by_event) {}
}
