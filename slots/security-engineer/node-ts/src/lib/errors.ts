export type ErrorCode =
  | "UNAUTHENTICATED"
  | "INSUFFICIENT_PERMISSION"
  | "NOT_FOUND"
  | "EVENT_NOT_FOUND"
  | "SEAT_NOT_FOUND"
  | "HOLD_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "SEAT_ALREADY_HELD"
  | "SEAT_NOT_AVAILABLE"
  | "HOLD_EXPIRED"
  | "HOLD_ALREADY_CONVERTED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "DISCOUNT_INVALID"
  | "DISCOUNT_ALREADY_APPLIED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  INSUFFICIENT_PERMISSION: 403,
  NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  SEAT_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  SEAT_ALREADY_HELD: 409,
  SEAT_NOT_AVAILABLE: 409,
  HOLD_EXPIRED: 410,
  HOLD_ALREADY_CONVERTED: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  DISCOUNT_INVALID: 400,
  DISCOUNT_ALREADY_APPLIED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
