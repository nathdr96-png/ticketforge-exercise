package com.ticketforge.error;

/**
 * The fixed error-code vocabulary from {@code contract/errors.md}. HTTP status is
 * derived from the code; implementations MUST NOT invent new codes.
 */
public enum ErrorCode {
  UNAUTHENTICATED(401),
  INSUFFICIENT_PERMISSION(403),
  NOT_FOUND(404),
  EVENT_NOT_FOUND(404),
  SEAT_NOT_FOUND(404),
  HOLD_NOT_FOUND(404),
  ORDER_NOT_FOUND(404),
  VALIDATION_ERROR(400),
  SEAT_ALREADY_HELD(409),
  SEAT_NOT_AVAILABLE(409),
  HOLD_EXPIRED(410),
  HOLD_ALREADY_CONVERTED(409),
  IDEMPOTENCY_KEY_REQUIRED(400),
  IDEMPOTENCY_KEY_CONFLICT(409),
  DISCOUNT_INVALID(400),
  DISCOUNT_ALREADY_APPLIED(409),
  RATE_LIMITED(429),
  INTERNAL_ERROR(500);

  private final int status;

  ErrorCode(int status) {
    this.status = status;
  }

  public int status() {
    return status;
  }
}
