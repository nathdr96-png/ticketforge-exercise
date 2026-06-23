/**
 * Hand-written types for the TicketForge API (contract/openapi.yaml, OpenAPI 3.1).
 *
 * Two invariants from the contract are load-bearing everywhere below:
 *   - every `*_cents` field is an INTEGER number of minor units, never a float;
 *   - every timestamp is a UTC ISO-8601 string with a trailing `Z`.
 */

/** Integer minor units. A `Cents` that is not a safe integer is a bug. */
export type Cents = number;

export type Role = "admin" | "organizer" | "buyer";
export type EventStatus = "draft" | "published" | "cancelled";
export type Section = "A" | "B" | "C" | "D";
export type SeatStatus = "available" | "held" | "sold";
export type HoldStatus = "active" | "expired" | "released" | "converted";
export type OrderStatus = "paid" | "refunded";
export type Currency = "USD" | "EUR" | "GBP";

/** contract/errors.md. An implementation MUST NOT invent codes outside this set. */
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
  /** UTC ISO-8601 with a `Z`. The countdown is derived from THIS, never a local clock. */
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

export interface RevenueRow {
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
  by_event: RevenueRow[];
}

/** components.parameters.pageSize maximum in contract/openapi.yaml. */
export const MAX_PAGE_SIZE = 200;

/** Hold TTL in seconds (contract/scenarios/T2-holds.md). */
export const HOLD_TTL_SECONDS = 600;

/** CreateHoldRequest.seat_ids maxItems. */
export const MAX_SEATS_PER_HOLD = 10;

export const ALL_SECTIONS: Section[] = ["A", "B", "C", "D"];
export const ALL_SEAT_STATUSES: SeatStatus[] = ["available", "held", "sold"];

/**
 * Page sizes offered by `events-page-size`.
 *
 * The small options are not decoration: an installation with a handful of
 * published events must still be navigable page by page, and the conformance
 * suite drives pagination through this control rather than assuming how much
 * seed data a deployment happens to have.
 */
export const EVENT_PAGE_SIZES = [2, 5, 10, 25] as const;
export const DEFAULT_EVENT_PAGE_SIZE = 10;
