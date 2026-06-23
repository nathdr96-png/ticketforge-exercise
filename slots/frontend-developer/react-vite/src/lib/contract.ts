/**
 * Types hand-written against contract/openapi.yaml (OpenAPI 3.1, TicketForge API 1.0.0).
 * Money is ALWAYS an integer number of minor units (cents) — never a float.
 * Timestamps are ALWAYS UTC ISO-8601 strings with a `Z` suffix.
 *
 * Keep this file in sync with the contract; it is the single source of truth for
 * every request/response shape the UI touches.
 */

/** Integer minor units (cents). Never a float. */
export type MoneyCents = number;

export type Role = "admin" | "organizer" | "buyer";
export type EventStatus = "draft" | "published" | "cancelled";
export type SeatSection = "A" | "B" | "C" | "D";
export type SeatStatus = "available" | "held" | "sold";
export type HoldStatus = "active" | "expired" | "released" | "converted";
export type OrderStatus = "paid" | "refunded";
export type Currency = "USD" | "EUR" | "GBP";

/** contract/errors.md — implementations MUST NOT invent new codes. */
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

export interface ErrorBody {
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

export interface LoginRequest {
  email: string;
  password: string;
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
  base_price_cents: MoneyCents;
  status: EventStatus;
  seat_count: number;
}

export interface Seat {
  id: string;
  event_id: string;
  section: SeatSection;
  row: string;
  number: number;
  status: SeatStatus;
  price_cents: MoneyCents;
}

export interface Page<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
}

export type EventList = Page<TfEvent>;
export type SeatList = Page<Seat>;

export interface CreateHoldRequest {
  event_id: string;
  /** 1..10 seat ids */
  seat_ids: string[];
}

export interface Hold {
  id: string;
  event_id: string;
  buyer_id: string;
  seat_ids: string[];
  status: HoldStatus;
  expires_at: string;
  created_at: string;
}

export interface CreateOrderRequest {
  hold_id: string;
  discount_code?: string | null;
}

export interface Order {
  id: string;
  hold_id: string;
  buyer_id: string;
  event_id: string;
  seat_ids: string[];
  subtotal_cents: MoneyCents;
  fee_cents: MoneyCents;
  discount_cents: MoneyCents;
  total_cents: MoneyCents;
  currency: Currency;
  discount_code?: string | null;
  status: OrderStatus;
  created_at: string;
}

export interface RevenueByEvent {
  event_id: string;
  order_count: number;
  gross_cents: MoneyCents;
  net_cents: MoneyCents;
}

export interface RevenueReport {
  currency: string;
  gross_cents: MoneyCents;
  fees_cents: MoneyCents;
  discounts_cents: MoneyCents;
  net_cents: MoneyCents;
  by_event: RevenueByEvent[];
}

export interface ListEventsQuery {
  page?: number;
  page_size?: number;
  status?: EventStatus;
}

export interface ListSeatsQuery {
  page?: number;
  page_size?: number;
  section?: SeatSection;
  availability?: SeatStatus;
}

/** Contract maximum for `page_size` (components.parameters.pageSize). */
export const MAX_PAGE_SIZE = 200;

/** Default hold TTL in seconds (contract/errors.md money & time invariants). */
export const HOLD_TTL_SECONDS = 600;

export const SECTIONS: SeatSection[] = ["A", "B", "C", "D"];
export const SEAT_STATUSES: SeatStatus[] = ["available", "held", "sold"];
