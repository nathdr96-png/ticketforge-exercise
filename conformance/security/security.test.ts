import { describe, expect, it } from "vitest";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

async function login(email: string) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  return res.json() as Promise<{ token: string; user: { id: string } }>;
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

describe("security", () => {
  it("IDOR: buyer cannot read another buyer's order", async () => {
    const a = await login("buyer09@ticketforge.test");
    const b = await login("buyer10@ticketforge.test");

    const seats = await api(
      "/events/event_arena_2000/seats?availability=available&page=1&page_size=1",
      { token: a.token }
    );
    const seatId = seats.body.data[0].id;
    const hold = await api("/holds", {
      method: "POST",
      token: a.token,
      body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: [seatId] }),
    });
    const order = await api("/orders", {
      method: "POST",
      token: a.token,
      headers: { "Idempotency-Key": `sec-idor-${Date.now()}` },
      body: JSON.stringify({ hold_id: hold.body.id }),
    });
    expect(order.status).toBe(201);

    const denied = await api(`/orders/${order.body.id}`, { token: b.token });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("INSUFFICIENT_PERMISSION");
  });

  it("role escalation: buyer cannot hit revenue", async () => {
    const { token } = await login("buyer11@ticketforge.test");
    const res = await api("/reports/revenue", { token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("INSUFFICIENT_PERMISSION");
  });

  it("SQL injection on section filter does not 500", async () => {
    const { token } = await login("buyer12@ticketforge.test");
    const res = await api(
      `/events/event_arena_2000/seats?section=${encodeURIComponent("A' OR '1'='1")}`,
      { token }
    );
    expect([200, 400]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it("missing auth on hold create", async () => {
    const res = await api("/holds", {
      method: "POST",
      body: JSON.stringify({ event_id: "event_arena_2000", seat_ids: ["x"] }),
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});
