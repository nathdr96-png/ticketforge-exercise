import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * The security family's conformance assertions.
 *
 * `security.test.ts` next to this file holds the four assertions every backend
 * slot is graded on. This file is the rest of them, and it exists because the
 * security family's whole grading surface is "the API refuses what it must
 * refuse, and still does its job".
 *
 * Every test here is written the same way round as the four originals: it names
 * a request the API must NOT honour, and asserts the refusal — the status, the
 * contract error code, and where it matters a positive control proving the
 * legitimate version of the same request still works. A candidate who closes a
 * hole by denying everyone fails the control and the scorecard says so.
 *
 * Collected by `vitest.hardening.config.ts`, NOT by the default config
 * ---------------------------------------------------------------------
 * The filename ends in `.security-test.ts`, not `.test.ts`, so vitest's default
 * include pattern does not match it:
 *
 *   vitest.config.ts            default include — `*.test.ts`  (security.test.ts)
 *   vitest.hardening.config.ts  `security.test.ts` + `*.security-test.ts`
 *
 * A bare `npx vitest run` in this directory therefore keeps collecting exactly
 * the four tests it always has, and no backend slot's measured defect→test map
 * moves because the security family arrived. The security slot declares
 * `security:vitest.hardening.config.ts` instead, which runs the four originals
 * AND these — a security candidate has to keep both green.
 *
 *   BASE_URL=http://127.0.0.1:3100 npx vitest run --config vitest.hardening.config.ts
 */

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const ARENA = "event_arena_2000";
const CLUB = "event_club_100";

/** Every code contract/errors.md defines. A refusal must use one of these. */
const CONTRACT_CODES = new Set([
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
]);

/**
 * Things no response body may ever contain, with the reason each one is here.
 * Checked against the raw response text rather than the parsed object, so a leak
 * nested three levels down in `details` is still caught.
 */
const MUST_NOT_LEAK: { what: string; pattern: RegExp }[] = [
  { what: "a stack frame", pattern: /\bat\s+\S+\s*\(?\S+\.(?:ts|js|mjs|cjs|py|go|java|rb|php|cs):\d+/ },
  // The frame above is the Node shape. A source location leaks the same thing in
  // any language, and in raw JSON text the usual separators are escaped: a Java
  // trace reads `\n\tat com.x.Y(Y.java:12)` (no word boundary before `at`), a
  // Python one `File \"/app/x.py\", line 12`, a Go panic `/app/orders.go:12`.
  {
    what: "a source file location",
    pattern: /[\w./\\-]+\.(?:ts|js|mjs|cjs|py|go|java|kt|rb|php|cs)(?::\d+|\\?",\s+line\s+\d+)/,
  },
  { what: "SQL text", pattern: /\b(?:SELECT\s+.*\bFROM\b|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)/i },
  { what: "a database identifier", pattern: /\brelation\s+"|\bpg_[a-z_]+\b|\bduplicate key value\b/i },
  { what: "a connection string", pattern: /\b(?:postgres|postgresql|redis|mysql):\/\// },
  { what: "a password hash column", pattern: /password_hash/i },
  { what: "a bcrypt hash", pattern: /\$2[aby]\$\d{2}\$/ },
];

// --------------------------------------------------------------------- client

async function login(email: string) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status}`);
  return (await res.json()) as { token: string; user: { id: string; role: string } };
}

async function api<T = any>(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let body: T = undefined as T;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = text as unknown as T;
    }
  }
  return { status: res.status, body, text };
}

/** Hold one available seat for this buyer and return the hold and the seat. */
async function holdOneSeat(token: string, eventId = ARENA) {
  const seats = await api<{ data: { id: string; price_cents: number }[] }>(
    `/events/${eventId}/seats?availability=available&page=1&page_size=1`,
    { token }
  );
  expect(seats.status, "the seat map must be readable to set this test up").toBe(200);
  const seat = seats.body.data[0];
  expect(seat, `fixtures must leave an available seat in ${eventId}`).toBeTruthy();
  const hold = await api<{ id: string }>("/holds", {
    method: "POST",
    token,
    body: JSON.stringify({ event_id: eventId, seat_ids: [seat.id] }),
  });
  expect(hold.status, `could not hold ${seat.id} to set this test up`).toBe(201);
  return { hold: hold.body, seat };
}

async function buyOneSeat(email: string, eventId = ARENA) {
  const buyer = await login(email);
  const { hold, seat } = await holdOneSeat(buyer.token, eventId);
  const order = await api<{ id: string; buyer_id: string }>("/orders", {
    method: "POST",
    token: buyer.token,
    headers: { "Idempotency-Key": `sec-hard-${email}-${Date.now()}` },
    body: JSON.stringify({ hold_id: hold.id }),
  });
  expect(order.status, "could not buy a seat to set this test up").toBe(201);
  return { buyer, order: order.body, seat };
}

// ------------------------------------------------------------------- tokens
//
// The three token tests need tokens the API never issued. They are built here by
// hand rather than mutated with a library so the suite stays dependency-free and
// so what each one claims is readable in the test that uses it.

const b64url = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64url = (value: string) =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

function claims(sub: string, role: string) {
  const now = Math.floor(Date.now() / 1000);
  return { sub, role, iat: now, exp: now + 3600 };
}

/** A structurally valid HS256 token signed with a key that is not the API's. */
function signedWithAnotherKey(sub: string, role: string): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims(sub, role)));
  const sig = createHmac("sha256", "not-the-key-this-api-signs-with")
    .update(`${head}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${head}.${body}.${sig}`;
}

/** A token that declares it is not signed at all. */
function unsigned(sub: string, role: string): string {
  return `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(
    JSON.stringify(claims(sub, role))
  )}.`;
}

/** A real token with its subject rewritten and its original signature kept. */
function subjectSwapped(token: string, sub: string): string {
  const [head, body, sig] = token.split(".");
  const payload = { ...(JSON.parse(unb64url(body)) as Record<string, unknown>), sub };
  return `${head}.${b64url(JSON.stringify(payload))}.${sig}`;
}

// --------------------------------------------------------------------- tests

describe("security: ownership", () => {
  it("an organizer cannot read an order for an event they do not run", async () => {
    // event_arena_2000 belongs to org1. org2 runs a different show entirely.
    const { buyer, order } = await buyOneSeat("buyer31@ticketforge.test", ARENA);

    const other = await login("org2@ticketforge.test");
    const denied = await api<{ error: { code: string } }>(`/orders/${order.id}`, {
      token: other.token,
    });
    expect(
      denied.status,
      `org2 does not run ${ARENA}, so reading ${order.id} must be refused`
    ).toBe(403);
    expect(denied.body.error.code).toBe("INSUFFICIENT_PERMISSION");

    // The control: the organizer who DOES run the event still sees the order,
    // and so does the buyer who placed it. Closing this hole by refusing every
    // organizer is not a fix.
    const owner = await login("org1@ticketforge.test");
    const allowed = await api<{ id: string }>(`/orders/${order.id}`, { token: owner.token });
    expect(allowed.status, `org1 runs ${ARENA} and must still be able to read ${order.id}`).toBe(200);
    expect(allowed.body.id).toBe(order.id);

    const mine = await api<{ id: string }>(`/orders/${order.id}`, { token: buyer.token });
    expect(mine.status, "the buyer must still be able to read their own order").toBe(200);
  });

  it("an organizer's revenue report contains only their own events", async () => {
    // Make sure there is money on org1's books for org2 to leak.
    await buyOneSeat("buyer32@ticketforge.test", ARENA);

    const other = await login("org2@ticketforge.test");
    const report = await api<{
      gross_cents: number;
      net_cents: number;
      by_event: { event_id: string; gross_cents: number; net_cents: number }[];
    }>("/reports/revenue", { token: other.token });
    expect(report.status).toBe(200);

    const leaked = report.body.by_event.filter((row) => row.event_id === ARENA || row.event_id === CLUB);
    expect(
      leaked,
      `org2 does not run ${ARENA} or ${CLUB}; their report returned ${JSON.stringify(leaked)}`
    ).toEqual([]);

    // Naming someone else's event explicitly must not get round the scoping
    // either: the filter narrows what you may see, it does not widen it.
    const probed = await api<{
      gross_cents: number;
      net_cents: number;
      by_event: unknown[];
    }>(`/reports/revenue?event_id=${ARENA}`, { token: other.token });
    expect(probed.status).toBe(200);
    expect(
      probed.body.by_event,
      `filtering by ${ARENA} must give org2 nothing, not org1's figures`
    ).toEqual([]);
    expect(probed.body.gross_cents).toBe(0);
    expect(probed.body.net_cents).toBe(0);

    // The control: the organizer who runs the event still gets their figures.
    const owner = await login("org1@ticketforge.test");
    const own = await api<{ by_event: { event_id: string }[] }>(
      `/reports/revenue?event_id=${ARENA}`,
      { token: owner.token }
    );
    expect(own.status).toBe(200);
    expect(
      own.body.by_event.map((row) => row.event_id),
      `org1 runs ${ARENA} and must still see it in their own report`
    ).toEqual([ARENA]);
  });
});

describe("security: tokens", () => {
  it("a token signed with a key the API does not use is refused", async () => {
    const forged = signedWithAnotherKey("user_admin", "admin");
    const res = await api<{ error: { code: string } }>("/reports/revenue", { token: forged });
    expect(
      res.status,
      "a bearer token this API never issued must not authenticate anyone"
    ).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("a token that declares it is unsigned is refused", async () => {
    const res = await api<{ error: { code: string } }>("/reports/revenue", {
      token: unsigned("user_admin", "admin"),
    });
    expect(res.status, 'a token with alg "none" carries no evidence of anything').toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("a real token with its subject rewritten is refused", async () => {
    const buyer = await login("buyer33@ticketforge.test");
    const swapped = subjectSwapped(buyer.token, "user_admin");
    expect(swapped, "the test must actually have changed the token").not.toBe(buyer.token);

    const res = await api<{ error: { code: string } }>("/reports/revenue", { token: swapped });
    expect(
      res.status,
      "the signature no longer matches the claims, so the claims must not be believed"
    ).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");

    // The control: the untouched token still works for what that buyer may do.
    const ok = await api("/events?page=1&page_size=1", { token: buyer.token });
    expect(ok.status, "the buyer's genuine token must still be accepted").toBe(200);
  });
});

describe("security: the server owns the money", () => {
  it("an order's money and status come from the server, not the request body", async () => {
    const buyer = await login("buyer34@ticketforge.test");
    const { hold } = await holdOneSeat(buyer.token);

    const order = await api<{
      id: string;
      buyer_id: string;
      status: string;
      subtotal_cents: number;
      fee_cents: number;
      discount_cents: number;
      total_cents: number;
    }>("/orders", {
      method: "POST",
      token: buyer.token,
      headers: { "Idempotency-Key": `sec-hard-assign-${Date.now()}` },
      // Everything here beyond hold_id is a server-owned field. The request is
      // not malformed — it is a client asking for a price and a state it is not
      // entitled to choose, which is what a careless handler will grant.
      body: JSON.stringify({
        hold_id: hold.id,
        total_cents: 1,
        fee_cents: 0,
        discount_cents: 999_999,
        subtotal_cents: 1,
        status: "refunded",
        buyer_id: "user_admin",
      }),
    });

    expect(order.status, "a request with extra fields is still a valid checkout").toBe(201);
    const o = order.body;
    expect(o.status, 'the order must be "paid" because the server charged for it').toBe("paid");
    expect(o.buyer_id, "the order belongs to whoever is authenticated").toBe(buyer.user.id);
    expect(o.total_cents, "total_cents must not be whatever the client asked to pay").not.toBe(1);
    expect(o.discount_cents, "no discount was applied, so none may be recorded").toBe(0);
    expect(
      o.total_cents,
      `total must be subtotal - discount + fee (${o.subtotal_cents} - ${o.discount_cents} + ${o.fee_cents})`
    ).toBe(o.subtotal_cents - o.discount_cents + o.fee_cents);

    // Read it back: the response ignoring the extra fields is not the same as
    // the stored row ignoring them, and it is the stored row we get paid on.
    const stored = await api<typeof o>(`/orders/${o.id}`, { token: buyer.token });
    expect(stored.status).toBe(200);
    expect(stored.body.total_cents, "the stored total must match what was charged").toBe(o.total_cents);
    expect(stored.body.status).toBe("paid");
    expect(stored.body.buyer_id).toBe(buyer.user.id);
  });
});

describe("security: holds cannot be reused", () => {
  it("a released hold cannot be turned into an order", async () => {
    const buyer = await login("buyer35@ticketforge.test");
    const { hold, seat } = await holdOneSeat(buyer.token);

    const released = await api(`/holds/${hold.id}`, { method: "DELETE", token: buyer.token });
    expect(released.status, "releasing one's own hold must work").toBe(204);

    const order = await api<{ error: { code: string }; id?: string }>("/orders", {
      method: "POST",
      token: buyer.token,
      headers: { "Idempotency-Key": `sec-hard-released-${Date.now()}` },
      body: JSON.stringify({ hold_id: hold.id }),
    });
    expect(
      order.status,
      `hold ${hold.id} was released, so it is no longer a claim on ${seat.id}`
    ).toBe(410);
    expect(order.body.error?.code).toBe("HOLD_EXPIRED");
    expect(order.body.id, "no order may exist for a hold that was given up").toBeUndefined();

    // The control, and the proof the refusal was real: the seat went back into
    // inventory, so it can be held again.
    const again = await api<{ id: string }>("/holds", {
      method: "POST",
      token: buyer.token,
      body: JSON.stringify({ event_id: ARENA, seat_ids: [seat.id] }),
    });
    expect(
      again.status,
      `${seat.id} was released and never sold, so it must be available again`
    ).toBe(201);
    await api(`/holds/${again.body.id}`, { method: "DELETE", token: buyer.token });
  });

  it("a hold that has already been paid for cannot be charged again", async () => {
    const buyer = await login("buyer36@ticketforge.test");
    const { hold } = await holdOneSeat(buyer.token);

    const first = await api<{ id: string; total_cents: number }>("/orders", {
      method: "POST",
      token: buyer.token,
      headers: { "Idempotency-Key": `sec-hard-conv-a-${Date.now()}` },
      body: JSON.stringify({ hold_id: hold.id }),
    });
    expect(first.status).toBe(201);

    // A new idempotency key, so this is not a retry the API may replay — it is a
    // second charge against a hold that has already been converted.
    const second = await api<{ error: { code: string }; id?: string }>("/orders", {
      method: "POST",
      token: buyer.token,
      headers: { "Idempotency-Key": `sec-hard-conv-b-${Date.now()}` },
      body: JSON.stringify({ hold_id: hold.id }),
    });
    expect(
      second.status,
      `hold ${hold.id} became order ${first.body.id}; charging it again must be refused`
    ).toBe(409);
    expect(second.body.error?.code).toBe("HOLD_ALREADY_CONVERTED");
    expect(second.body.id, "a second order must not exist for one hold").toBeUndefined();

    // The control: the genuine order is untouched and still readable.
    const stored = await api<{ id: string; total_cents: number }>(`/orders/${first.body.id}`, {
      token: buyer.token,
    });
    expect(stored.status).toBe(200);
    expect(stored.body.total_cents).toBe(first.body.total_cents);
  });
});

describe("security: responses say nothing extra", () => {
  it("a refusal carries a contract error code and no internal detail", async () => {
    const buyer = await login("buyer37@ticketforge.test");

    const probes: { what: string; res: { status: number; body: any; text: string } }[] = [
      {
        what: "an event id that does not exist",
        res: await api("/events/no_such_event_at_all", { token: buyer.token }),
      },
      {
        what: "an order id that does not exist",
        res: await api("/orders/ord_no_such_order", { token: buyer.token }),
      },
      {
        what: "a section filter that is not a section",
        res: await api(
          `/events/${ARENA}/seats?section=${encodeURIComponent("D'; DROP TABLE seats; --")}`,
          { token: buyer.token }
        ),
      },
      {
        // A backend may answer this one with 500 INTERNAL_ERROR where
        // 400 VALIDATION_ERROR would be the better reading of contract/errors.md.
        // This test deliberately does not pin the status: what it is here to
        // assert is that the generic failure path says nothing it should not, and
        // tightening the status is a contract question for the platform team
        // rather than something to settle inside a security assertion.
        what: "a body that is not JSON",
        res: await api("/holds", {
          method: "POST",
          token: buyer.token,
          headers: { "Content-Type": "application/json" },
          body: '{"event_id": ',
        }),
      },
      {
        what: "a password that is wrong",
        res: await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: "buyer37@ticketforge.test", password: "not-the-password" }),
        }),
      },
    ];

    for (const { what, res } of probes) {
      expect(res.status, `${what} must be refused, not accepted`).toBeGreaterThanOrEqual(400);
      expect(
        res.body?.error?.code,
        `${what} answered with ${res.status} and body ${res.text.slice(0, 300)} — ` +
          `every error must use the shape in contract/errors.md`
      ).toBeTruthy();
      expect(
        CONTRACT_CODES.has(res.body.error.code),
        `${what} answered with code ${res.body.error.code}, which contract/errors.md does not define`
      ).toBe(true);
      for (const { what: leak, pattern } of MUST_NOT_LEAK) {
        expect(
          pattern.test(res.text),
          `the answer to ${what} contains ${leak}: ${res.text.slice(0, 300)}`
        ).toBe(false);
      }
    }
  });

  it("no response carries credential material", async () => {
    const res = await api<{ token: string; user: Record<string, unknown> }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "buyer38@ticketforge.test", password: "password123" }),
    });
    expect(res.status).toBe(200);
    expect(
      Object.keys(res.body.user).sort(),
      "the user object may carry id, email, role and name — nothing else"
    ).toEqual(["email", "id", "name", "role"]);

    for (const { what, pattern } of MUST_NOT_LEAK) {
      expect(
        pattern.test(res.text),
        `the login response contains ${what}: ${res.text.slice(0, 300)}`
      ).toBe(false);
    }

    const { buyer, order } = await buyOneSeat("buyer39@ticketforge.test");
    const read = await api(`/orders/${order.id}`, { token: buyer.token });
    expect(read.status).toBe(200);
    for (const { what, pattern } of MUST_NOT_LEAK) {
      expect(
        pattern.test(read.text),
        `the order response contains ${what}: ${read.text.slice(0, 300)}`
      ).toBe(false);
    }
  });
});
