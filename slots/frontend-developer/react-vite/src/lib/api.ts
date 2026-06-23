/**
 * Typed TicketForge API client, written against contract/openapi.yaml.
 *
 * - Base URL comes from VITE_API_BASE_URL (see .env.example).
 * - Every non-2xx response is normalised into an `ApiError` carrying the
 *   contract error `code` so the UI can render `error-banner[data-error-code]`
 *   straight from the envelope defined in contract/errors.md.
 */

import type {
  CreateHoldRequest,
  CreateOrderRequest,
  ErrorBody,
  ErrorCode,
  EventList,
  Hold,
  ListEventsQuery,
  ListSeatsQuery,
  LoginRequest,
  LoginResponse,
  Order,
  RevenueReport,
  Seat,
  SeatList,
  TfEvent,
} from "./contract";
import { MAX_PAGE_SIZE } from "./contract";

export const API_BASE_URL: string = (
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000"
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

/** Network / CORS / JSON failures still need a contract code to display. */
function transportError(err: unknown): ApiError {
  const message = err instanceof Error ? err.message : String(err);
  return new ApiError(0, "INTERNAL_ERROR", `Cannot reach the TicketForge API: ${message}`);
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", token, body, headers = {}, signal } = options;
  const init: RequestInit = { method, headers: { ...headers }, signal };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (token) {
    (init.headers as Record<string, string>).authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (err) {
    throw transportError(err);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new ApiError(res.status, "INTERNAL_ERROR", text.slice(0, 200) || res.statusText);
      }
      throw new ApiError(res.status, "INTERNAL_ERROR", "Malformed JSON response from API");
    }
  }

  if (!res.ok) {
    const envelope = parsed as ErrorBody | undefined;
    const error = envelope?.error;
    throw new ApiError(
      res.status,
      (error?.code as ErrorCode | undefined) ?? "INTERNAL_ERROR",
      error?.message ?? `Request failed with status ${res.status}`,
      error?.details,
    );
  }

  return parsed as T;
}

/** Status code of the last `createOrder` call: 201 = created, 200 = idempotent replay. */
export interface CreateOrderResult {
  order: Order;
  replayed: boolean;
}

export const api = {
  health: () => request<{ status: "ok" }>("/health"),

  login: (payload: LoginRequest) =>
    request<LoginResponse>("/auth/login", { method: "POST", body: payload }),

  listEvents: (token: string, q: ListEventsQuery = {}) =>
    request<EventList>(
      `/events${query({ page: q.page, page_size: q.page_size, status: q.status })}`,
      { token },
    ),

  getEvent: (token: string, eventId: string) =>
    request<TfEvent>(`/events/${encodeURIComponent(eventId)}`, { token }),

  listSeats: (token: string, eventId: string, q: ListSeatsQuery = {}, signal?: AbortSignal) =>
    request<SeatList>(
      `/events/${encodeURIComponent(eventId)}/seats${query({
        page: q.page,
        page_size: q.page_size,
        section: q.section,
        availability: q.availability,
      })}`,
      { token, signal },
    ),

  /**
   * Walk the paginated seat endpoint until the whole map is loaded.
   * Page 1 is fetched first (it carries `total`), then the remaining pages are
   * requested concurrently — 2,000 seats is 10 round trips at the contract max
   * page size, which keeps the seat map interactive.
   */
  async listAllSeats(
    token: string,
    eventId: string,
    q: Omit<ListSeatsQuery, "page" | "page_size"> = {},
    signal?: AbortSignal,
  ): Promise<Seat[]> {
    const pageSize = MAX_PAGE_SIZE;
    const first = await api.listSeats(token, eventId, { ...q, page: 1, page_size: pageSize }, signal);
    const pageCount = Math.max(1, Math.ceil(first.total / pageSize));
    if (pageCount === 1) return first.data;
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_unused, i) =>
        api.listSeats(token, eventId, { ...q, page: i + 2, page_size: pageSize }, signal),
      ),
    );
    return first.data.concat(...rest.map((p) => p.data));
  },

  createHold: (token: string, payload: CreateHoldRequest) =>
    request<Hold>("/holds", { method: "POST", token, body: payload }),

  getHold: (token: string, holdId: string) =>
    request<Hold>(`/holds/${encodeURIComponent(holdId)}`, { token }),

  releaseHold: (token: string, holdId: string) =>
    request<void>(`/holds/${encodeURIComponent(holdId)}`, { method: "DELETE", token }),

  /** POST /orders — `Idempotency-Key` is required by the contract. */
  createOrder: (token: string, idempotencyKey: string, payload: CreateOrderRequest) =>
    request<Order>("/orders", {
      method: "POST",
      token,
      body: payload,
      headers: { "Idempotency-Key": idempotencyKey },
    }),

  getOrder: (token: string, orderId: string) =>
    request<Order>(`/orders/${encodeURIComponent(orderId)}`, { token }),

  revenueReport: (token: string, q: { event_id?: string; from?: string; to?: string } = {}) =>
    request<RevenueReport>(`/reports/revenue${query(q)}`, { token }),
};
