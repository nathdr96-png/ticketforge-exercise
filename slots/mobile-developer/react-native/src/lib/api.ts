/**
 * TicketForge API client, written against `contract/openapi.yaml`.
 *
 * Every non-2xx answer is normalised into an `ApiError` carrying the `code`
 * from the `contract/errors.md` envelope, so a screen can render
 * `error-banner[data-error-code]` straight from what it caught. A transport
 * failure — which on a phone is the common case, not the exotic one — becomes
 * an `ApiError` too, with `INTERNAL_ERROR` and the offline hint, rather than a
 * raw `TypeError: Network request failed`.
 */

import type {
  ErrorCode,
  ErrorEnvelope,
  Hold,
  LoginResponse,
  Order,
  Paged,
  RevenueReport,
  Seat,
  SeatStatus,
  Section,
  TfEvent,
} from "./contract";
import { MAX_PAGE_SIZE } from "./contract";

/**
 * Vite inlines `VITE_*` at build time, which on a real device build is exactly
 * right: the app ships pointing at one API and cannot be talked into pointing
 * somewhere else at runtime.
 */
export const API_BASE_URL: string = (
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:3000"
).replace(/\/+$/, "");

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function queryString(params: Record<string, string | number | null | undefined>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

interface Call {
  method?: "GET" | "POST" | "DELETE";
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function call<T>(path: string, options: Call = {}): Promise<T> {
  const { method = "GET", token, body, headers = {}, signal } = options;
  const requestHeaders: Record<string, string> = { ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    throw new ApiError(
      0,
      "INTERNAL_ERROR",
      `Cannot reach TicketForge: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(
        response.status,
        "INTERNAL_ERROR",
        text.slice(0, 200) || response.statusText || "Malformed response",
      );
    }
  }

  if (!response.ok) {
    const envelope = payload as ErrorEnvelope | undefined;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "INTERNAL_ERROR",
      envelope?.error?.message ?? `Request failed with status ${response.status}`,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

export interface SeatQuery {
  section?: Section | "";
  availability?: SeatStatus | "";
}

export const api = {
  health: () => call<{ status: string }>("/health"),

  login: (email: string, password: string) =>
    call<LoginResponse>("/auth/login", { method: "POST", body: { email, password } }),

  listEvents: (token: string, page: number, pageSize: number) =>
    call<Paged<TfEvent>>(`/events${queryString({ page, page_size: pageSize })}`, { token }),

  getEvent: (token: string, eventId: string) =>
    call<TfEvent>(`/events/${encodeURIComponent(eventId)}`, { token }),

  listSeats: (
    token: string,
    eventId: string,
    page: number,
    pageSize: number,
    query: SeatQuery = {},
    signal?: AbortSignal,
  ) =>
    call<Paged<Seat>>(
      `/events/${encodeURIComponent(eventId)}/seats${queryString({
        page,
        page_size: pageSize,
        section: query.section,
        availability: query.availability,
      })}`,
      { token, signal },
    ),

  /**
   * The whole seat map, in as few round trips as the contract allows.
   *
   * `page_size` is capped at 200, so the 2,000-seat arena is ten requests. Page
   * one is fetched first because it is the only one that reports `total`; the
   * remaining nine then go out together. Doing this serially on a phone turns a
   * sub-second map into a visible stall, and fetching only page one — which is
   * the mistake the conformance suite looks for — silently hides 90% of the
   * inventory.
   */
  async listAllSeats(
    token: string,
    eventId: string,
    query: SeatQuery = {},
    signal?: AbortSignal,
  ): Promise<Seat[]> {
    const first = await api.listSeats(token, eventId, 1, MAX_PAGE_SIZE, query, signal);
    const pageCount = Math.max(1, Math.ceil(first.total / MAX_PAGE_SIZE));
    if (pageCount === 1) return first.data;
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_unused, index) =>
        api.listSeats(token, eventId, index + 2, MAX_PAGE_SIZE, query, signal),
      ),
    );
    const seats = first.data.slice();
    for (const page of rest) seats.push(...page.data);
    return seats;
  },

  createHold: (token: string, eventId: string, seatIds: readonly string[]) =>
    call<Hold>("/holds", {
      method: "POST",
      token,
      body: { event_id: eventId, seat_ids: [...seatIds] },
    }),

  releaseHold: (token: string, holdId: string) =>
    call<void>(`/holds/${encodeURIComponent(holdId)}`, { method: "DELETE", token }),

  /** `Idempotency-Key` is required by the contract; see lib/idempotency.ts. */
  createOrder: (
    token: string,
    idempotencyKey: string,
    holdId: string,
    discountCode: string | null,
  ) =>
    call<Order>("/orders", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": idempotencyKey },
      body: discountCode ? { hold_id: holdId, discount_code: discountCode } : { hold_id: holdId },
    }),

  getOrder: (token: string, orderId: string) =>
    call<Order>(`/orders/${encodeURIComponent(orderId)}`, { token }),

  revenueReport: (token: string) => call<RevenueReport>("/reports/revenue", { token }),
};
