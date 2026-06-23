/**
 * Shared plumbing for the TicketForge QA suite.
 *
 * Everything here is black box: HTTP against `$BASE_URL` and the fixtures
 * described in `contract/seed/`. Nothing in this suite may import from a slot,
 * read the database, or know what language the server is written in — that is
 * what makes the same suite usable against every stack.
 *
 * ## Fixture facts this suite relies on (contract/seed/README.md)
 *
 * | Fixture              | Facts used here                                        |
 * |----------------------|--------------------------------------------------------|
 * | `event_arena_2000`   | 2000 seats, sections A–D × 500, USD, organizer `org1`   |
 * | `event_club_100`     | 100 seats, all section A @ 2500c, USD, organizer `org1` |
 * | `event_jazz_eur`     | 100 seats, EUR, organizer `org2`                        |
 * | `SAVE10` / `ARENA20` | 10% any event / 20% `event_arena_2000` only              |
 * | `EXPIRED0`           | inactive code                                           |
 *
 * ## Actor allocation
 *
 * Each spec file owns a disjoint block of the 50 seeded buyers, so no file can
 * make another file fail — hold ownership and idempotency keys are both scoped
 * per buyer. Within a file the actors are named for their part in the scenario
 * (owner, rival, stranger) and reused, because every test creates and cleans up
 * its own holds and never asserts on "this buyer's holds" as a set.
 *
 * | Spec file                    | Buyers | Also uses              |
 * |------------------------------|--------|------------------------|
 * | `health-and-auth.spec.ts`    | 01     |                        |
 * | `catalog-pagination.spec.ts` | 02     |                        |
 * | `seat-map.spec.ts`           | 03     |                        |
 * | `holds.spec.ts`              | 04–06  | admin                  |
 * | `orders-money.spec.ts`       | 07–08  | org1, org2, admin      |
 * | `discounts.spec.ts`          | 09     |                        |
 * | `idempotency.spec.ts`        | 10–11  |                        |
 * | `revenue-report.spec.ts`     | 12–13  | org1, org2, admin      |
 */

import { expect } from "vitest";

/* ------------------------------------------------------------------ config */

export function baseUrl(): string {
  const raw = process.env.BASE_URL?.trim();
  if (!raw || raw === "/") return "http://127.0.0.1:3000";
  return raw.replace(/\/$/, "");
}

/**
 * Contract parameters, read from the environment rather than hardcoded, because
 * a deployment can be configured with a different fee formula and hold TTL. A
 * suite that bakes in 5% and 600s would start failing for reasons that are not
 * bugs.
 */
export const FEE_PERCENT = Number(process.env.FEE_PERCENT ?? 5);
export const FEE_FIXED_CENTS = Number(process.env.FEE_FIXED_CENTS ?? 30);
export const HOLD_TTL_SECONDS = Number(process.env.HOLD_TTL_SECONDS ?? 600);

export const ARENA = "event_arena_2000";
export const CLUB = "event_club_100";
export const JAZZ = "event_jazz_eur";

/** Events owned by each seeded organizer, used for the authorization boundaries. */
export const ORGANIZER_EVENTS: Record<string, string[]> = {
  "org1@ticketforge.test": [ARENA, CLUB],
  "org2@ticketforge.test": [JAZZ, "event_draft"],
};

/* --------------------------------------------------------------- contract money */

/** `fee_cents = floor(subtotal_after_discount * FEE_PERCENT / 100) + FEE_FIXED_CENTS` */
export function expectedFeeCents(subtotalAfterDiscount: number): number {
  return Math.floor((subtotalAfterDiscount * FEE_PERCENT) / 100) + FEE_FIXED_CENTS;
}

/** `discount_cents = floor(subtotal * percent_off / 100)` */
export function expectedDiscountCents(subtotal: number, percentOff: number): number {
  return Math.floor((subtotal * percentOff) / 100);
}

/* ------------------------------------------------------------------- types */

export type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};

export type Seat = {
  id: string;
  event_id: string;
  section: string;
  row: string;
  number: number;
  status: "available" | "held" | "sold";
  price_cents: number;
};

export type Event = {
  id: string;
  organizer_id: string;
  title: string;
  venue: string;
  starts_at: string;
  currency: string;
  base_price_cents: number;
  status: string;
  seat_count: number;
};

export type Hold = {
  id: string;
  event_id: string;
  buyer_id: string;
  seat_ids: string[];
  status: "active" | "expired" | "released" | "converted";
  expires_at: string;
  created_at: string;
};

export type Order = {
  id: string;
  hold_id: string;
  buyer_id: string;
  event_id: string;
  seat_ids: string[];
  subtotal_cents: number;
  fee_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: string;
  discount_code: string | null;
  status: string;
  created_at: string;
};

export type RevenueReport = {
  currency: string;
  gross_cents: number;
  fees_cents: number;
  discounts_cents: number;
  net_cents: number;
  by_event: { event_id: string; order_count: number; gross_cents: number; net_cents: number }[];
};

export type Page<T> = { data: T[]; page: number; page_size: number; total: number };

export type Res<T> = {
  status: number;
  body: T;
  /** Unparsed response text — used to prove money is serialized as integers. */
  text: string;
  headers: Headers;
};

/* --------------------------------------------------------------------- http */

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<Res<T>> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  } catch (cause) {
    throw new Error(
      `${init.method ?? "GET"} ${path} could not reach ${baseUrl()} — is the server up? (${
        (cause as Error).message
      })`
    );
  }
  const text = await res.text();
  let body = undefined as T;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = text as unknown as T;
    }
  }
  return { status: res.status, body, text, headers: res.headers };
}

export async function login(email: string, password = "password123") {
  const res = await api<{ token: string; user: { id: string; role: string; email: string } }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) }
  );
  if (res.status !== 200) {
    throw new Error(`login as ${email} failed: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return res.body;
}

/** Log in and return just the bearer token — the common case. */
export async function tokenFor(email: string): Promise<string> {
  return (await login(email)).token;
}

/**
 * Assert an error response precisely: HTTP status *and* the contract error code.
 * Checking only the status lets a server pass by returning the right number with
 * the wrong, or invented, code — `contract/errors.md` forbids new codes.
 */
export function expectError(
  res: Res<unknown>,
  status: number,
  code: string,
  what: string
): void {
  const body = res.body as ErrorBody | undefined;
  expect(
    { status: res.status, code: body?.error?.code },
    `${what}: expected ${status} ${code}, got ${res.status} ${
      body?.error?.code ?? "<no error.code>"
    } — body was ${res.text.slice(0, 300)}`
  ).toEqual({ status, code });
}

/** Assert that each named field is present and an integer number of cents. */
export function expectIntegerCents(obj: Record<string, unknown>, keys: string[], what: string) {
  for (const key of keys) {
    const value = obj[key];
    expect(
      Number.isInteger(value),
      `${what}: ${key} must be an integer number of cents, got ${JSON.stringify(value)}`
    ).toBe(true);
  }
}

/** A fresh idempotency key. The contract requires at least 8 characters. */
let keySequence = 0;
export function idempotencyKey(prefix: string): string {
  keySequence += 1;
  return `qa-${prefix}-${Date.now().toString(36)}-${keySequence}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/* ----------------------------------------------------------- domain helpers */

export async function getEvent(token: string, eventId: string): Promise<Event> {
  const res = await api<Event>(`/events/${eventId}`, { token });
  expect(res.status, `GET /events/${eventId} should be 200, got ${res.status}`).toBe(200);
  return res.body;
}

export async function seatPage(
  token: string,
  eventId: string,
  query: Record<string, string | number> = {}
): Promise<Page<Seat>> {
  const qs = new URLSearchParams(
    Object.entries({ page: 1, page_size: 200, ...query }).map(([k, v]) => [k, String(v)])
  );
  const res = await api<Page<Seat>>(`/events/${eventId}/seats?${qs}`, { token });
  expect(
    res.status,
    `GET /events/${eventId}/seats?${qs} should be 200, got ${res.status}: ${res.text.slice(0, 200)}`
  ).toBe(200);
  return res.body;
}

/** Every seat of an event, following pagination to the end. */
export async function allSeats(
  token: string,
  eventId: string,
  query: Record<string, string | number> = {}
): Promise<Seat[]> {
  const seats: Seat[] = [];
  for (let page = 1; page <= 50; page++) {
    const body = await seatPage(token, eventId, { ...query, page, page_size: 200 });
    seats.push(...body.data);
    if (seats.length >= body.total || body.data.length === 0) break;
  }
  return seats;
}

export async function seatById(token: string, eventId: string, seatId: string): Promise<Seat> {
  const seat = (await allSeats(token, eventId)).find((s) => s.id === seatId);
  expect(seat, `seat ${seatId} should exist in the ${eventId} seat map`).toBeTruthy();
  return seat!;
}

/** Candidate seats to hold: available right now, cheapest page first. */
export async function availableSeats(
  token: string,
  eventId: string,
  count: number,
  priceCents?: number
): Promise<Seat[]> {
  const found: Seat[] = [];
  for (let page = 1; page <= 50 && found.length < count; page++) {
    const body = await seatPage(token, eventId, { availability: "available", page, page_size: 200 });
    for (const seat of body.data) {
      if (priceCents === undefined || seat.price_cents === priceCents) found.push(seat);
      if (found.length >= count) break;
    }
    if (body.data.length === 0) break;
  }
  expect(
    found.length,
    `fixtures must offer ${count} available seat(s)` +
      (priceCents === undefined ? "" : ` priced ${priceCents}c`) +
      ` on ${eventId}; found ${found.length}`
  ).toBeGreaterThanOrEqual(count);
  return found.slice(0, count);
}

export async function createHold(
  token: string,
  eventId: string,
  seatIds: string[]
): Promise<Res<Hold>> {
  return api<Hold>("/holds", {
    method: "POST",
    token,
    body: JSON.stringify({ event_id: eventId, seat_ids: seatIds }),
  });
}

/**
 * Hold `count` available seats, retrying with the next candidates if another
 * buyer took them between the lookup and the hold. Polling rather than sleeping:
 * the race is resolved by asking again, not by hoping it has passed.
 */
export async function holdAvailableSeats(
  token: string,
  eventId: string,
  count = 1,
  priceCents?: number
): Promise<{ hold: Hold; seats: Seat[] }> {
  let last = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const seats = await availableSeats(token, eventId, count * attempt, priceCents).then((s) =>
      s.slice((attempt - 1) * count, (attempt - 1) * count + count)
    );
    if (seats.length < count) break;
    const res = await createHold(
      token,
      eventId,
      seats.map((s) => s.id)
    );
    if (res.status === 201) return { hold: res.body, seats };
    last = `${res.status} ${res.text.slice(0, 200)}`;
    if (res.status !== 409) break;
  }
  throw new Error(`could not hold ${count} seat(s) on ${eventId} after 5 attempts; last: ${last}`);
}

export async function releaseHold(token: string, holdId: string): Promise<Res<unknown>> {
  return api(`/holds/${holdId}`, { method: "DELETE", token });
}

export async function getHold(token: string, holdId: string): Promise<Res<Hold>> {
  return api<Hold>(`/holds/${holdId}`, { token });
}

export async function placeOrder(
  token: string,
  body: { hold_id: string; discount_code?: string },
  key = idempotencyKey("order")
): Promise<Res<Order>> {
  return api<Order>("/orders", {
    method: "POST",
    token,
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

/** Hold a seat and pay for it; fails loudly if either step is refused. */
export async function buySeats(
  token: string,
  eventId: string,
  opts: { count?: number; priceCents?: number; discountCode?: string } = {}
): Promise<{ order: Order; seats: Seat[] }> {
  const { hold, seats } = await holdAvailableSeats(
    token,
    eventId,
    opts.count ?? 1,
    opts.priceCents
  );
  const body: { hold_id: string; discount_code?: string } = { hold_id: hold.id };
  if (opts.discountCode) body.discount_code = opts.discountCode;
  const res = await placeOrder(token, body);
  expect(
    res.status,
    `POST /orders for hold ${hold.id} should be 201, got ${res.status}: ${res.text.slice(0, 300)}`
  ).toBe(201);
  return { order: res.body, seats };
}

export async function revenueReport(
  token: string,
  query: Record<string, string> = {}
): Promise<RevenueReport> {
  const qs = new URLSearchParams(query);
  const res = await api<RevenueReport>(
    `/reports/revenue${qs.toString() ? `?${qs}` : ""}`,
    { token }
  );
  expect(
    res.status,
    `GET /reports/revenue should be 200, got ${res.status}: ${res.text.slice(0, 200)}`
  ).toBe(200);
  return res.body;
}

/** `2026-10-07T06:29:58.826Z` — UTC, with the Z suffix the contract requires. */
export function expectUtcIso(value: unknown, what: string) {
  expect(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value),
    `${what} must be a UTC ISO-8601 timestamp ending in Z, got ${JSON.stringify(value)}`
  ).toBe(true);
}
