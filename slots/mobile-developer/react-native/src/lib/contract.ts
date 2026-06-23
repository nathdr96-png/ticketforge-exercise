/**
 * TicketForge wire types, written by hand against `contract/openapi.yaml`
 * (OpenAPI 3.1, TicketForge API 1.0.0).
 *
 * Two invariants hold everywhere in this file and everywhere it is used:
 *
 *   * money is an INTEGER number of minor units (cents). Never a float, never a
 *     formatted string. See lib/money.ts for the arithmetic.
 *   * timestamps are UTC ISO-8601 with a trailing `Z`. The hold countdown is
 *     derived from one of them, so the `Z` is load-bearing, not decoration.
 */

/** Integer minor units. */
export type Cents = number;

export type Role = "admin" | "organizer" | "buyer";
export type EventStatus = "draft" | "published" | "cancelled";
export type Section = "A" | "B" | "C" | "D";
export type SeatStatus = "available" | "held" | "sold";
export type HoldStatus = "active" | "expired" | "released" | "converted";
export type OrderStatus = "paid" | "refunded";
export type Currency = "USD" | "EUR" | "GBP";

/** `contract/errors.md`. An implementation must not invent a code. */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "INSUFFICIENT_PERMISSION",
  "NOT_FOUND",
  "EVENT_NOT_FOUND",
  "SEAT_NOT_FOUND",
  "HOLD_NOT_FOUND",
  "ORDER_NOT_FOUND",
  "VALIDATION_ERROR",
  "SEAT_ALREADY_HELD",
  "SEAT_NOT_AVAILABLE",
  "HOLD_EXPIRED",
  "HOLD_ALREADY_CONVERTED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_CONFLICT",
  "DISCOUNT_INVALID",
  "DISCOUNT_ALREADY_APPLIED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface User {
  id: string;
  email: string;
  role: Role;
  name: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface TfEvent {
  id: string;
  organizer_id: string;
  title: string;
  description?: string;
  venue: string;
  starts_at: string;
  currency: Currency;
  base_price_cents: Cents;
  status: EventStatus;
  seat_count: number;
}

export interface Seat {
  id: string;
  event_id: string;
  section: Section;
  row: string;
  number: number;
  status: SeatStatus;
  price_cents: Cents;
}

export interface Paged<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface Hold {
  id: string;
  event_id: string;
  buyer_id: string;
  seat_ids: string[];
  status: HoldStatus;
  /** UTC ISO-8601. The only input to the hold countdown. */
  expires_at: string;
  created_at: string;
}

export interface Order {
  id: string;
  hold_id: string;
  buyer_id: string;
  event_id: string;
  seat_ids: string[];
  subtotal_cents: Cents;
  fee_cents: Cents;
  discount_cents: Cents;
  total_cents: Cents;
  currency: Currency;
  discount_code?: string | null;
  status: OrderStatus;
  created_at: string;
}

export interface RevenueByEvent {
  event_id: string;
  order_count: number;
  gross_cents: Cents;
  net_cents: Cents;
}

export interface RevenueReport {
  currency: string;
  gross_cents: Cents;
  fees_cents: Cents;
  discounts_cents: Cents;
  net_cents: Cents;
  by_event: RevenueByEvent[];
}

/** `components.parameters.pageSize` maximum. Ten requests cover the arena. */
export const MAX_PAGE_SIZE = 200;

/** Default hold TTL, in seconds. */
export const HOLD_TTL_SECONDS = 600;

/** `CreateHoldRequest.seat_ids` maxItems. */
export const MAX_SEATS_PER_HOLD = 10;

export const SECTIONS: readonly Section[] = ["A", "B", "C", "D"];
export const SEAT_STATUSES: readonly SeatStatus[] = ["available", "held", "sold"];

/** The currency symbol the app prefixes amounts with. */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};
