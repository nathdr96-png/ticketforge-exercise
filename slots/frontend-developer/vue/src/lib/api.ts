/**
 * Typed client for the TicketForge API (contract/openapi.yaml).
 *
 * Every non-2xx answer is turned into an `ApiError` that carries the `code` from
 * the envelope in contract/errors.md, so a view can render
 * `error-banner[data-error-code]` straight from what the server said instead of
 * inventing its own wording. A transport failure (CORS, DNS, connection reset)
 * has no envelope, so it is reported as `INTERNAL_ERROR` — the contract has no
 * code for "the browser could not reach you".
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

/** Set in .env / the build environment; Vite inlines it at build time. */
export const API_BASE_URL: string = (
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:3000"
).replace(/\/+$/, "");

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type QueryValue = string | number | undefined | null;

function queryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

interface Call {
  method?: "GET" | "POST" | "DELETE";
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send<T>(path: string, call: Call = {}): Promise<T> {
  const headers: Record<string, string> = { ...call.headers };
  if (call.token) headers.authorization = `Bearer ${call.token}`;
  if (call.body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: call.method ?? "GET",
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: call.signal,
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ApiError(0, "INTERNAL_ERROR", `Cannot reach the TicketForge API: ${reason}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(
        response.status,
        "INTERNAL_ERROR",
        text.slice(0, 200) || `Malformed response (HTTP ${response.status})`,
      );
    }
  }

  if (!response.ok) {
    const envelope = (payload as ErrorEnvelope | undefined)?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? "INTERNAL_ERROR",
      envelope?.message ?? `Request failed with status ${response.status}`,
      envelope?.details,
    );
  }

  return payload as T;
}

export interface SeatFilter {
  section?: Section | "";
  availability?: SeatStatus | "";
}

export const api = {
  health: () => send<{ status: "ok" }>("/health"),

  login: (email: string, password: string) =>
    send<LoginResponse>("/auth/login", { method: "POST", body: { email, password } }),

  listEvents: (token: string, page: number, pageSize: number) =>
    send<Paged<TfEvent>>(`/events${queryString({ page, page_size: pageSize })}`, { token }),

  getEvent: (token: string, eventId: string, signal?: AbortSignal) =>
    send<TfEvent>(`/events/${encodeURIComponent(eventId)}`, { token, signal }),

  listSeats: (
    token: string,
    eventId: string,
    page: number,
    pageSize: number,
    signal?: AbortSignal,
  ) =>
    send<Paged<Seat>>(
      `/events/${encodeURIComponent(eventId)}/seats${queryString({ page, page_size: pageSize })}`,
      { token, signal },
    ),

  /**
   * The whole seat map, in as few round trips as the contract allows.
   *
   * `GET /events/{id}/seats` is paginated and caps `page_size` at 200, so the
   * 2,000-seat arena is ten requests. Page 1 comes back first because it carries
   * `total`; the remaining nine then go out together instead of in sequence,
   * which is the difference between a seat map that is ready in a second and one
   * that takes ten. Filtering afterwards happens in memory over this snapshot,
   * so changing a filter costs no request at all.
   */
  async listAllSeats(
    token: string,
    eventId: string,
    signal?: AbortSignal,
  ): Promise<Seat[]> {
    const first = await api.listSeats(token, eventId, 1, MAX_PAGE_SIZE, signal);
    const pageCount = Math.max(1, Math.ceil(first.total / MAX_PAGE_SIZE));
    if (pageCount === 1) return first.data;
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_ignored, index) =>
        api.listSeats(token, eventId, index + 2, MAX_PAGE_SIZE, signal),
      ),
    );
    const all = first.data.slice();
    for (const page of rest) all.push(...page.data);
    return all;
  },

  createHold: (token: string, eventId: string, seatIds: string[]) =>
    send<Hold>("/holds", {
      method: "POST",
      token,
      body: { event_id: eventId, seat_ids: seatIds },
    }),

  releaseHold: (token: string, holdId: string) =>
    send<void>(`/holds/${encodeURIComponent(holdId)}`, { method: "DELETE", token }),

  /**
   * `POST /orders`. The contract REQUIRES an `Idempotency-Key` header
   * (contract/errors.md: IDEMPOTENCY_KEY_REQUIRED), and a retry of the same
   * checkout must send the same one so the API replays the original order
   * instead of charging twice (T3-02) — so the key is a required argument here
   * rather than something this function invents per call.
   */
  createOrder: (
    token: string,
    idempotencyKey: string,
    holdId: string,
    discountCode: string | null,
  ) =>
    send<Order>("/orders", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": idempotencyKey },
      body: discountCode
        ? { hold_id: holdId, discount_code: discountCode }
        : { hold_id: holdId },
    }),

  getOrder: (token: string, orderId: string) =>
    send<Order>(`/orders/${encodeURIComponent(orderId)}`, { token }),

  revenueReport: (token: string) => send<RevenueReport>("/reports/revenue", { token }),
};
